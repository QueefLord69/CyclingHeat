"use strict";

const byId = id => document.getElementById(id);
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const km = value => number.format(value) + " km";
const metres = value => number.format(value) + " m";
const filters = ["year", "country", "distance", "category"].map(byId);
const modeButtons = [...document.querySelectorAll("[data-mode]")];
const mapShell = byId("mapShell");
const map = L.map("map", { zoomControl: false, minZoom: 2 }).setView([53, 13], 4);
L.control.zoom({ position: "topright" }).addTo(map);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
}).addTo(map);
const tracks = L.layerGroup().addTo(map);
const markers = L.layerGroup().addTo(map);
let routes = [];
let visible = [];
let selected = null;
let mode = "all";
let replay = null;
let heatLayer;
let profileMarker;
let tileFailures = 0;
map.eachLayer(layer => {
  if (layer instanceof L.TileLayer) {
    layer.on("tileerror", () => {
      if (++tileFailures === 4) {
        const notice = L.control({ position: "bottomright" });
        notice.onAdd = () => {
          const element = node("p", "Basemap unavailable");
          element.style.cssText = "background:white;color:#222;padding:.3rem .5rem;border-radius:4px";
          return element;
        };
        notice.addTo(map);
      }
    });
  }
});

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function coordinates(segments) {
  return segments.map(segment => segment.map(([lat, lon]) => [lat, lon]));
}

function routeMetrics(route) {
  const gain = route.gain === null ? "Elevation unavailable" :
    (route.partialElevation ? "≥ " : "+") + metres(route.gain);
  return km(route.distance) + " · " + gain;
}

function heatPoints(routesToDraw) {
  return routesToDraw.flatMap(route => route.segments.flatMap(segment =>
    segment.flatMap((point, index) => {
      if (!index) return [[point[0], point[1], 0.36]];
      const previous = segment[index - 1];
      const steps = Math.max(1, Math.ceil((point[3] - previous[3]) / 0.25));
      return Array.from({ length: steps }, (_, step) => {
        const t = (step + 1) / steps;
        return [previous[0] + t * (point[0] - previous[0]), previous[1] + t * (point[1] - previous[1]), 0.36];
      });
    })
  ));
}

function drawMap() {
  tracks.clearLayers();
  markers.clearLayers();
  profileMarker = null;
  if (heatLayer) {
    heatLayer.remove();
    heatLayer = null;
  }
  const shown = mode === "single" ? (selected ? [selected] : []) : visible;
  if (mode === "heat") {
    heatLayer = L.heatLayer(heatPoints(shown), {
      radius: 20, blur: 16, maxZoom: 11, minOpacity: 0.3,
      gradient: { 0.18: "#5d7f61", 0.45: "#a9bd68", 0.7: "#f9c35b", 1: "#ca5135" }
    }).addTo(map);
    return;
  }
  for (const route of shown) {
    const active = route === selected;
    const path = coordinates(route.segments);
    L.polyline(path, { color: "#23362c", weight: active ? 8 : 6, opacity: 0.82, interactive: false }).addTo(tracks);
    L.polyline(path, { color: active ? "#efff95" : "#5cac7f", weight: active ? 4.5 : 3.5 })
      .on("click", () => selectRoute(route, false)).addTo(tracks);
  }
  if (selected && shown.includes(selected)) {
    const start = selected.segments[0][0];
    L.circleMarker(start.slice(0, 2), { radius: 5, weight: 2, color: "#23362c", fillColor: "#efff95", fillOpacity: 1, interactive: false }).addTo(markers);
  }
}

function fit(list = mode === "single" ? (selected ? [selected] : []) : visible) {
  const bounds = L.latLngBounds([]);
  for (const route of list) {
    for (const segment of route.segments) {
      for (const [lat, lon] of segment) bounds.extend([lat, lon]);
    }
  }
  if (bounds.isValid()) {
    const detail = byId("detail");
    const bottom = detail.hidden ? 74 : Math.min(detail.offsetHeight + 87, mapShell.clientHeight * .58);
    map.fitBounds(bounds, { paddingTopLeft: [35, 72], paddingBottomRight: [54, bottom], maxZoom: 13, animate: false });
  }
}

function renderList() {
  byId("count").textContent = visible.length + " of " + routes.length;
  const rows = visible.map(route => {
    const button = node("button", null, "route");
    button.type = "button";
    button.dataset.route = route.id;
    button.setAttribute("aria-pressed", String(route === selected));
    button.append(node("strong", route.name),
      node("span", [route.country, route.category, route.date?.slice(0, 4) || "Undated", route.demo ? "Demo" : ""].filter(Boolean).join(" · "), "meta"),
      node("span", routeMetrics(route), "routeMetrics"));
    button.addEventListener("click", () => {
      selectRoute(route, true);
      if (matchMedia("(max-width: 760px)").matches) mapShell.scrollIntoView({ block: "start" });
    });
    return button;
  });
  byId("list").replaceChildren(...(rows.length ? rows : [node("p", "No routes match these filters.", "empty")]));
}

function syncMode() {
  for (const button of modeButtons) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
}

function svgNode(tag, attributes) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function renderProfile(route) {
  const wrap = node("div", null, "profile");
  const elevated = route.segments.flat().filter(point => point[2] !== null);
  if (elevated.length === 0) {
    wrap.append(node("p", "No elevation data recorded.", "meta"));
    return wrap;
  }
  const min = elevated.reduce((value, point) => Math.min(value, point[2]), Infinity);
  const max = elevated.reduce((value, point) => Math.max(value, point[2]), -Infinity);
  const total = route.segments.at(-1).at(-1)[3] || 1;
  const x = point => 5 + point[3] / total * 390;
  const y = point => 54 - (point[2] - min) / (max - min || 1) * 48;
  const svg = svgNode("svg", { viewBox: "0 0 400 60", preserveAspectRatio: "none", "aria-hidden": "true" });
  for (const lineY of [6, 30, 54]) {
    svg.append(svgNode("line", { x1: 5, x2: 395, y1: lineY, y2: lineY, stroke: "var(--border)" }));
  }
  for (const segment of route.segments) {
    let move = true;
    const path = segment.map(point => {
      if (point[2] === null) {
        move = true;
        return "";
      }
      const command = (move ? "M" : "L") + x(point) + " " + y(point);
      move = false;
      return command;
    }).join(" ");
    svg.append(svgNode("path", { d: path, fill: "none", stroke: "var(--accent)", "stroke-width": 2, "stroke-linecap": "round" }));
  }
  const indicator = svgNode("circle", { r: 4, fill: "var(--accent)" });
  svg.append(indicator);
  const slider = node("input");
  slider.type = "range";
  slider.min = 0;
  slider.max = elevated.length - 1;
  slider.value = 0;
  slider.setAttribute("aria-label", "Explore elevation along the route");
  const output = node("output");
  function inspect(markMap) {
    const point = elevated[Number(slider.value)];
    indicator.setAttribute("cx", x(point));
    indicator.setAttribute("cy", y(point));
    output.textContent = km(point[3]) + " · " + metres(point[2]) + " elevation";
    slider.setAttribute("aria-valuetext", output.textContent);
    if (markMap) {
      if (!profileMarker) {
        profileMarker = L.circleMarker(point.slice(0, 2), { radius: 7, color: "#26382b", fillColor: "#f9d779", fillOpacity: 1 }).addTo(markers);
      } else {
        profileMarker.setLatLng(point.slice(0, 2));
      }
    }
  }
  slider.addEventListener("input", () => inspect(true));
  function inspectPointer(event) {
    const rect = svg.getBoundingClientRect();
    const distance = ((event.clientX - rect.left) / rect.width * 400 - 5) / 390 * total;
    let lower = 0;
    let upper = elevated.length - 1;
    while (lower < upper) {
      const mid = (lower + upper) >>> 1;
      if (elevated[mid][3] < distance) lower = mid + 1;
      else upper = mid;
    }
    slider.value = lower > 0 && distance - elevated[lower - 1][3] < elevated[lower][3] - distance ? lower - 1 : lower;
    inspect(true);
  }
  svg.addEventListener("pointermove", event => {
    if (event.pointerType === "mouse" || event.buttons) inspectPointer(event);
  });
  svg.addEventListener("pointerdown", inspectPointer);
  wrap.append(svg, slider, output);
  inspect(false);
  return wrap;
}

function renderDetail() {
  const detail = byId("detail");
  detail.hidden = !selected;
  detail.replaceChildren();
  if (!selected) return;
  const route = selected;
  const head = node("div", null, "detailHead");
  const label = node("div");
  label.append(node("h2", route.name), node("span", routeMetrics(route), "meta"));
  const actions = node("div", null, "detailActions");
  const download = node("a", "Download GPX", "download");
  download.href = "./" + route.file;
  download.download = route.file.split("/").at(-1);
  const close = node("button", "×", "close");
  close.type = "button";
  close.setAttribute("aria-label", "Close route details");
  close.addEventListener("click", () => {
    stopReplay();
    selected = null;
    if (mode === "single") mode = "all";
    refresh();
    document.querySelector('[data-mode="all"]').focus();
  });
  actions.append(download, close);
  head.append(label, actions);
  detail.append(head);
  if (route.description) detail.append(node("p", route.description));
  if (route.photo) {
    const photo = node("img");
    photo.src = "./" + route.photo;
    photo.alt = route.photoAlt || route.name;
    photo.addEventListener("error", () => photo.remove(), { once: true });
    detail.append(photo);
  }
  detail.append(renderProfile(route));
}

function refresh() {
  syncMode();
  renderList();
  renderDetail();
  drawMap();
}

function selectRoute(route, zoom) {
  stopReplay();
  selected = route;
  if (mode === "heat") mode = "all";
  refresh();
  if (zoom) {
    fit([route]);
    if (!matchMedia("(max-width: 760px)").matches) {
      [...byId("list").children].find(item => item.dataset.route === route.id)?.focus({ preventScroll: true });
    }
  }
}

function matchesDistance(route, distance) {
  if (distance === "short") return route.distance < 25;
  if (distance === "medium") return route.distance >= 25 && route.distance < 50;
  if (distance === "long") return route.distance >= 50;
  return true;
}

function normalize(text) {
  return text.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function applyFilters() {
  stopReplay();
  const [year, country, distance, category] = filters.map(filter => filter.value);
  const term = normalize(byId("search").value);
  visible = routes.filter(route =>
    (!year || year === (route.date?.slice(0, 4) || "Undated")) &&
    (!country || country === route.country) &&
    (!category || category === route.category) &&
    matchesDistance(route, distance) &&
    normalize(route.name).includes(term)
  );
  if (!visible.includes(selected)) selected = mode === "single" ? visible[0] || null : null;
  byId("play").disabled = visible.length === 0;
  refresh();
  fit();
}

function populateFilter(id, label, values) {
  const select = byId(id);
  select.replaceChildren(new Option(label, ""), ...[...new Set(values)].map(value => new Option(value, value)));
}

function renderStats() {
  const totalDistance = routes.reduce((sum, route) => sum + route.distance, 0);
  const totalGain = routes.reduce((sum, route) => sum + (route.gain ?? 0), 0);
  const gain = routes.every(route => route.gain === null) ? "—" :
    (routes.some(route => route.gain === null || route.partialElevation) ? "≥ " : "") + metres(totalGain);
  byId("stats").replaceChildren(...[
    [number.format(routes.length), "Routes"], [km(totalDistance), "Distance"], [gain, "Elevation gain"]
  ].map(([value, label]) => {
    const stat = node("div", null, "stat");
    stat.append(node("strong", value), node("span", label));
    return stat;
  }));
}

function stopReplay(message = "") {
  if (replay) cancelAnimationFrame(replay.frame);
  replay = null;
  byId("play").textContent = "▶ Replay archive";
  byId("play").setAttribute("aria-pressed", "false");
  byId("playStatus").textContent = message;
}

function startReplay() {
  const dated = visible.filter(route => route.date).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  if (!dated.length) {
    stopReplay("No dated routes to replay.");
    return;
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reduced ? 1200 : 2400;
  const start = performance.now();
  replay = { frame: 0, index: -1 };
  byId("play").textContent = "■ Stop replay";
  byId("play").setAttribute("aria-pressed", "true");
  selected = null;
  mode = "all";
  syncMode();
  renderList();
  renderDetail();
  fit(dated);
  if (heatLayer) {
    heatLayer.remove();
    heatLayer = null;
  }
  tracks.clearLayers();
  markers.clearLayers();
  let path;
  function frame(time) {
    const elapsed = time - start;
    const index = Math.min(Math.floor(elapsed / duration), dated.length);
    if (index === dated.length) {
      stopReplay("Replay complete" + (dated.length < visible.length ? " · Undated routes skipped" : ""));
      drawMap();
      return;
    }
    const route = dated[index];
    if (index !== replay.index) {
      path?.setLatLngs(coordinates(dated[replay.index].segments));
      replay.index = index;
      path = L.polyline([], { weight: 5, color: "#33794b", interactive: false }).addTo(tracks);
      byId("playStatus").textContent = route.date + " · " + route.name;
    }
    const maxDistance = route.segments.at(-1).at(-1)[3];
    const covered = maxDistance * (elapsed % duration) / (duration * 0.82);
    const partial = route.segments.map(segment => {
      const end = segment.findIndex(point => point[3] > covered);
      if (end < 0) return segment.map(point => point.slice(0, 2));
      if (end === 0) return [];
      const last = segment[end - 1];
      const next = segment[end];
      const t = (covered - last[3]) / (next[3] - last[3]);
      const line = segment.slice(0, end).map(point => point.slice(0, 2));
      line.push([last[0] + t * (next[0] - last[0]), last[1] + t * (next[1] - last[1])]);
      return line;
    });
    path.setLatLngs(reduced ? coordinates(route.segments) : partial);
    replay.frame = requestAnimationFrame(frame);
  }
  replay.frame = requestAnimationFrame(frame);
}

for (const filter of filters) filter.addEventListener("change", applyFilters);
byId("search").addEventListener("input", applyFilters);
for (const button of modeButtons) {
  button.addEventListener("click", () => {
    stopReplay();
    mode = button.dataset.mode;
    if (mode === "single" && !selected) selected = visible[0] || null;
    refresh();
    fit();
  });
}
byId("fit").addEventListener("click", () => fit());
byId("play").addEventListener("click", () => {
  if (replay) {
    stopReplay("Replay stopped");
    drawMap();
  } else startReplay();
});

function syncFullscreen() {
  const expanded = Boolean(document.fullscreenElement) || mapShell.classList.contains("expanded");
  const label = expanded ? "Exit fullscreen map" : "Enter fullscreen map";
  byId("fullscreen").setAttribute("aria-label", label);
  byId("fullscreen").title = label;
  map.invalidateSize();
}
byId("fullscreen").addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else if (mapShell.classList.contains("expanded")) mapShell.classList.remove("expanded");
  else {
    try {
      await mapShell.requestFullscreen();
    } catch {
      mapShell.classList.add("expanded");
    }
  }
  syncFullscreen();
});
document.addEventListener("fullscreenchange", syncFullscreen);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && mapShell.classList.contains("expanded")) {
    mapShell.classList.remove("expanded");
    syncFullscreen();
  }
});
new ResizeObserver(() => map.invalidateSize()).observe(mapShell);

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const button = byId("theme");
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  button.textContent = theme === "dark" ? "☀" : "☾";
  button.setAttribute("aria-label", label);
  button.title = label;
}
try {
  setTheme(localStorage.getItem("cycling-theme") === "light" ? "light" : "dark");
} catch {
  setTheme("dark");
}
byId("theme").addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  setTheme(theme);
  try { localStorage.setItem("cycling-theme", theme); } catch { /* Storage is optional. */ }
});

async function loadArchive() {
  byId("play").disabled = true;
  try {
    const response = await fetch("./routes-index.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Route index returned " + response.status);
    routes = await response.json();
    routes.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.name.localeCompare(b.name));
    populateFilter("year", "All years", routes.map(route => route.date?.slice(0, 4) || "Undated"));
    populateFilter("country", "All countries", routes.map(route => route.country).sort());
    populateFilter("category", "All categories", routes.map(route => route.category).sort());
    byId("demoBadge").hidden = !routes.some(route => route.demo);
    renderStats();
    selected = routes.find(route => !route.demo) || null;
    if (selected) mode = "single";
    applyFilters();
  } catch (error) {
    byId("count").textContent = "Unavailable";
    byId("list").replaceChildren(node("p", "The route index could not be loaded. Reload the page to retry.", "empty"));
    console.error(error);
  }
}

loadArchive();
