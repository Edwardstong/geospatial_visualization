// Import Mapbox as an ESM module (Step 1.1)
import mapboxgl from 'https://cdn.jsdelivr.net/npm/[email protected]/+esm';

// Import D3 as an ESM module (Step 3, "Import D3 as an ES Module")
import * as d3 from 'https://cdn.jsdelivr.net/npm/[email protected]/+esm';

// --- Time & traffic helpers (Steps 5 & 4) ---

// Global time filter value; -1 means "any time"
let timeFilter = -1;

// Efficient time buckets for performance (Step 5.4)
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Convert minutes since midnight to a formatted time string (Step 5.2)
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Convert a Date object to minutes since midnight (Step 5.3/5.4)
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Efficiently retrieve trips within +/- 60 minutes, using buckets (Step 5.4)
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    // No filtering: return all trips
    return tripsByMinute.flat();
  }

  // Normalize min and max minutes to [0, 1439]
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    // Wrap across midnight
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Quantize scale for traffic flow [0..1] → {0, 0.5, 1} (Step 6.1)
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// Radius scale for circle sizes (Step 4.3)
const radiusScale = d3.scaleSqrt().range([0, 25]); // domain set after we know traffic

// --- Mapbox setup (Step 1.3) ---

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.pk.eyJ1IjoiZWR0b25nIiwiYSI6ImNtaTEzcndtNzE1cmgyam9tcTRpeXl5OGYifQ.QsKGAtUl_sGspD76o5AaEw';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // You can swap to a custom style later
  center: [-71.09415, 42.36027], // [longitude, latitude] (Cambridge/Boston area)
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Check that Mapbox GL JS is loaded (Step 1.1)
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Helper: project station lon/lat to SVG coordinates (Step 3.2)
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Compute arrivals/departures/total per station using bucketed trips (Step 5.4)
function computeStationTraffic(stations, currentTimeFilter = -1) {
  // Retrieve filtered trips efficiently
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, currentTimeFilter),
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, currentTimeFilter),
    (v) => v.length,
    (d) => d.end_station_id
  );

  // Update station data with counts (Step 4.2 logic)
  return stations.map((station) => {
    const id = station.short_name;
    const arrivalsCount = arrivals.get(id) ?? 0;
    const departuresCount = departures.get(id) ?? 0;

    station.arrivals = arrivalsCount;
    station.departures = departuresCount;
    station.totalTraffic = arrivalsCount + departuresCount;

    return station;
  });
}

// --- Main logic: wait for map load (Step 2.1 & 3.1) ---

map.on('load', async () => {
  // 1) Add Boston bike lanes as a line layer (Step 2.1)
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4,
    },
  });

  // 2) Cambridge bike lanes (Step 2.3, similar to above)
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/master/Transportation/Bike/bike_facilities/geojson/bike_facilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4,
    },
  });

  // 3) Set up SVG overlay and D3 (Step 3.2 & 3.3)
  const svg = d3.select('#map').select('svg');

  // Load stations JSON (Step 3.1)
  let stationsData;
  try {
    const jsonData = await d3.json(
      'https://dsc106.com/labs/lab07/data/bluebikes-stations.json'
    );
    stationsData = jsonData.data.stations;
    console.log('Stations Array:', stationsData);
  } catch (error) {
    console.error('Error loading stations JSON:', error);
    return;
  }

  // Load trips CSV and bucket them by minute (Steps 4.1 & 5.4)
  let trips;
  try {
    trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);

        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);

        departuresByMinute[startedMinutes].push(trip);
        arrivalsByMinute[endedMinutes].push(trip);

        return trip;
      }
    );
    console.log('Trips count:', trips.length);
  } catch (error) {
    console.error('Error loading trips CSV:', error);
    return;
  }

  // Compute traffic for all trips initially (timeFilter = -1)
  let stations = computeStationTraffic(stationsData, -1);

  // Set radius scale domain based on total traffic (Step 4.3)
  radiusScale.domain([0, d3.max(stations, (d) => d.totalTraffic)]);

  // Append circles for each station (Step 3.3 and 4.x)
  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .each(function (d) {
      // Tooltips (Step 4.4)
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    })
    // Color based on flow (Step 6.1)
    .style('--departure-ratio', (d) =>
      stationFlow(d.totalTraffic > 0 ? d.departures / d.totalTraffic : 0)
    );

  // Position circles based on map projection (Step 3.3)
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  // Initial positioning
  updatePositions();

  // Keep markers aligned when the map moves/zooms/resizes (Step 3.3)
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // --- Time slider wiring (Step 5.2 & 5.3) ---

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  // Update circles based on a time filter (Step 5.3, using the optimized computeStationTraffic)
  function updateScatterPlot(currentTimeFilter) {
    const filteredStations = computeStationTraffic(stationsData, currentTimeFilter);

    // Adjust circle size range depending on filtering (Step 5.3/5.4)
    currentTimeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy)
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .each(function (d) {
        // Make sure tooltip text stays updated
        const title =
          d3.select(this).select('title').node() ??
          d3.select(this).append('title').node();
        d3.select(title).text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
      })
      .style('--departure-ratio', (d) =>
        stationFlow(d.totalTraffic > 0 ? d.departures / d.totalTraffic : 0)
      );
  }

  // Update UI and call updateScatterPlot when slider moves (Step 5.2)
  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block'; // Show "(any time)"
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay(); // Initialize display & scatterplot
});
