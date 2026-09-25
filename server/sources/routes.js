// Leg distances and geometry.
// - Sea: shortest path over the global maritime network bundled with searoute-js (Eurostat MARNET),
//   with the Pacific date line joined.
// - Road: an OSRM server if OSRM_URL is set.
// - Rail and air, and road without OSRM: great-circle distance, flagged as such.
import { createRequire } from "node:module";
import { env } from "../config.js";

const require = createRequire(import.meta.url);
const PathFinder = require("geojson-path-finder");
// The maritime network (Eurostat MARNET) that ships with searoute-js.
const marnet = require("searoute-js/data/marnet_densified.json");

// The network's lines stop at longitude +180 and -180 without being joined, so a
// route can never cross the Pacific date line. Add zero-length links between the
// matching +180 / -180 endpoints so trans-Pacific routes are possible.
function joinAntimeridian(net) {
  const ends = { "180": new Map(), "-180": new Map() };
  for (const f of net.features) {
    const c = f.geometry.coordinates;
    for (const p of [c[0], c[c.length - 1]]) {
      if (Math.abs(p[0]) === 180) ends[String(p[0])].set(p[1].toFixed(3), p);
    }
  }
  const links = [];
  for (const [lat, east] of ends["180"]) {
    const west = ends["-180"].get(lat);
    if (west) links.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [east, west] } });
  }
  return { type: "FeatureCollection", features: [...net.features, ...links] };
}

const network = joinAntimeridian(marnet);
// Edge weight is distance in km. The library drops zero-weight edges, so the
// date-line links (which have zero length) get a tiny positive weight instead.
const finder = new PathFinder(network, {
  weightFn: (a, b) => Math.max(greatCircleKm({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] }), 1e-6),
});
const vertices = [];
for (const f of network.features) for (const c of f.geometry.coordinates) vertices.push(c);

function nearestVertex(lon, lat) {
  let best = null, bestD = Infinity;
  for (const v of vertices) {
    const d = greatCircleKm({ lon, lat }, { lon: v[0], lat: v[1] });
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

const point = (c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } });

export function greatCircleKm(a, b) {
  const R = 6371.0088; // mean Earth radius, IUGG
  const rad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function seaRoute(a, b) {
  const from = nearestVertex(a.lon, a.lat);
  const to = nearestVertex(b.lon, b.lat);
  const r = finder.findPath(point(from), point(to));
  if (!r?.path?.length) return null;
  let km = 0;
  for (let i = 1; i < r.path.length; i++) {
    const [x0, y0] = r.path[i - 1], [x1, y1] = r.path[i];
    km += greatCircleKm({ lon: x0, lat: y0 }, { lon: x1, lat: y1 });
  }
  // Add the short hops from each port to the shipping lane.
  km += greatCircleKm(a, { lon: from[0], lat: from[1] }) + greatCircleKm({ lon: to[0], lat: to[1] }, b);
  return { distanceKm: km, geometry: [[a.lon, a.lat], ...r.path, [b.lon, b.lat]], method: "searoute" };
}

async function roadRoute(a, b) {
  const base = env("OSRM_URL");
  if (!base) return null;
  const url = new URL(`/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}`, base);
  url.search = "overview=simplified&geometries=geojson";
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const r = j.routes?.[0];
  return r ? { distanceKm: r.distance / 1000, geometry: r.geometry.coordinates, method: "osrm" } : null;
}

export async function routeLeg(a, b, mode) {
  let r = null;
  if (mode === "sea") r = seaRoute(a, b);
  if (mode === "road") r = await roadRoute(a, b);
  return r ?? { distanceKm: greatCircleKm(a, b), geometry: null, method: "great-circle" };
}
