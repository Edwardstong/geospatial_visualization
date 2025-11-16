// Import Mapbox + D3 as ES modules
import mapboxgl from "https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// ----------------- CONFIG -----------------

// TODO: paste YOUR Mapbox public token here
mapboxgl.accessToken = "pk.eyJ1IjoiZWR0b25nIiwiYSI6ImNtaTEzcndtNzE1cmgyam9tcTRpeXl5OGYifQ.QsKGAtUl_sGspD76o5AaEw";

const INPUT_BLUEBIKES_STATIONS_URL =
  "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";

const INPUT_BLUEBIKES_TRIPS_URL =
  "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";

// Global state
let stations = [];
let trips = [];
let timeFilter = -1; // -1 = any time

// Color & size scales (Step 4 & 6)
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
const radiusScale = d3.scaleSqrt().range([0, 25]);

// ----------------- HELPERS -----------------

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Filter trips within +/-60 minutes of selected time
function filterTripsByTime(allTrips, minute) {
  if (minute === -1) return allTrips; // no filter

  const min = minute - 60;
  const max = minute + 60;

  return allTrips.filter((trip) => {
    const startM = minutesSinceMidnight(trip.started_at);
    const endM = minutesSinceMidnight(trip.ended_at);
    return (
      (startM >= min && startM <= max) ||
      (endM >= min && endM <= max)
    );
  });
}

// Given a time filter, compute arrivals/departures/total per station
function computeStationTraffic(currentTime) {
  const activeTrips = filterTripsByTime(trips, currentTime);

  const departures = d3.rollup(
    activeTrips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    activeTrips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    const id = station.short_name;
    const dep = departures.get(id) ?? 0;
    const arr = arrivals.get(id) ?? 0;
    return {
      ...station,
      departures: dep,
      arrivals: arr,
      totalTraffic: dep + arr,
    };
  });
}

// Format minutes since midnight as "10:09 AM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleTimeString("en-US", { timeStyle: "short" });
}

// ----------------- MAPBOX SETUP -----------------

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

console.log("Mapbox GL JS Loaded:", mapboxgl.version);

// Project station lon/lat to map pixel coordinates
function project(station) {
  const lngLat = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(lngLat);
  return { cx: x, cy: y };
}

// ----------------- MAIN LOGIC -----------------

map.on("load", async () => {
  // 1) Bike lanes – Boston
  map.addSource("boston_route", {
    type: "geojson",
    data: "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson",
  });

  map.addLayer({
    id: "bike-lanes-boston",
    type: "line",
    source: "boston_route",
    paint: {
      "line-color": "green",
      "line-width": 3,
      "line-opacity": 0.4,
    },
  });

  // 2) Bike lanes – Cambridge (updated URL)
  map.addSource("cambridge_route", {
    type: "geojson",
    data: "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson",
  });

  map.addLayer({
    id: "bike-lanes-cambridge",
    type: "line",
    source: "cambridge_route",
    paint: {
      "line-color": "green",
      "line-width": 3,
      "line-opacity": 0.4,
    },
  });

  // 3) SVG overlay
  const svg = d3
    .select("#map")
    .append("svg")
    .style("position", "absolute")
    .style("inset", 0)
    .style("width", "100%")
    .style("height", "100%")
    .style("pointer-events", "none");

  // ----------------- LOAD DATA -----------------

  try {
    const jsonData = await d3.json(INPUT_BLUEBIKES_STATIONS_URL);
    stations = jsonData.data.stations;
    console.log("Stations Array:", stations);
  } catch (error) {
    console.error("Error loading stations JSON:", error);
    return;
  }

  try {
    trips = await d3.csv(INPUT_BLUEBIKES_TRIPS_URL, (d) => ({
      ...d,
      started_at: new Date(d.started_at),
      ended_at: new Date(d.ended_at),
    }));
    console.log("Trips count:", trips.length);
  } catch (error) {
    console.error("Error loading trips CSV:", error);
    return;
  }

  // Initial traffic (any time)
  let stationsWithTraffic = computeStationTraffic(-1);

  // Set radius domain based on all-time traffic
  radiusScale.domain([
    0,
    d3.max(stationsWithTraffic, (d) => d.totalTraffic),
  ]);

  // ----------------- DRAW STATION CIRCLES -----------------

  let circles = svg
    .selectAll("circle")
    .data(stationsWithTraffic, (d) => d.short_name)
    .join("circle")
    .attr("cx", (d) => project(d).cx)
    .attr("cy", (d) => project(d).cy)
    .attr("r", (d) => radiusScale(d.totalTraffic))
    .style("--departure-ratio", (d) =>
      stationFlow(
        d.totalTraffic > 0 ? d.departures / d.totalTraffic : 0
      )
    )
    .each(function (d) {
      d3.select(this)
        .append("title")
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });

  // Keep circles aligned when the map moves
  function updatePositions() {
    circles
      .attr("cx", (d) => project(d).cx)
      .attr("cy", (d) => project(d).cy);
  }

  map.on("move", updatePositions);
  map.on("zoom", updatePositions);
  map.on("resize", updatePositions);
  map.on("moveend", updatePositions);

  // ----------------- SLIDER + FILTERING -----------------

  const timeSlider = document.getElementById("time-slider");
  const selectedTime = document.getElementById("selected-time");
  const anyTimeLabel = document.getElementById("any-time");

  function updateScatterPlot(currentTime) {
    stationsWithTraffic = computeStationTraffic(currentTime);

    // Use a slightly larger size range when filtering
    if (currentTime === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]);
    }

    // Rebind data to circles and update position, size, color, tooltip
    circles = svg
      .selectAll("circle")
      .data(stationsWithTraffic, (d) => d.short_name)
      .join(
        (enter) =>
          enter
            .append("circle")
            .attr("cx", (d) => project(d).cx)
            .attr("cy", (d) => project(d).cy)
            .attr("r", (d) => radiusScale(d.totalTraffic))
            .style("--departure-ratio", (d) =>
              stationFlow(
                d.totalTraffic > 0
                  ? d.departures / d.totalTraffic
                  : 0
              )
            )
            .each(function (d) {
              d3.select(this)
                .append("title")
                .text(
                  `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
                );
            }),
        (update) =>
          update
            .attr("cx", (d) => project(d).cx)
            .attr("cy", (d) => project(d).cy)
            .attr("r", (d) => radiusScale(d.totalTraffic))
            .style("--departure-ratio", (d) =>
              stationFlow(
                d.totalTraffic > 0
                  ? d.departures / d.totalTraffic
                  : 0
              )
            )
            .each(function (d) {
              d3.select(this)
                .select("title")
                .text(
                  `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
                );
            }),
        (exit) => exit.remove()
      );
  }

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = "";
      anyTimeLabel.style.display = "inline";
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = "none";
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener("input", updateTimeDisplay);
  updateTimeDisplay(); // initialize
});
