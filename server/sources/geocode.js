// OpenStreetMap Nominatim geocoding. Usage policy: at most 1 request per second,
// an identifying User-Agent, and caching of results. All three are done here.
// https://operations.osmfoundation.org/policies/nominatim/
import { env } from "../config.js";
import { loadCache, saveCache } from "./cache.js";

let cache;
let last = 0;

async function throttle() {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

async function search(q) {
  cache ??= await loadCache("geocode");
  if (q in cache) return cache[q];
  await throttle();
  const url = new URL("/search", env("NOMINATIM_URL"));
  url.search = new URLSearchParams({ q, format: "jsonv2", limit: "1", addressdetails: "1", email: env("NOMINATIM_EMAIL") });
  const res = await fetch(url, { headers: { "User-Agent": `tracemap (${env("NOMINATIM_EMAIL")})` } });
  if (!res.ok) throw new Error(`Nominatim returned ${res.status} for "${q}"`);
  const [hit] = await res.json();
  const out = hit
    ? {
        lat: +hit.lat,
        lon: +hit.lon,
        displayName: hit.display_name,
        countryCode: hit.address?.country_code?.toUpperCase() ?? null,
      }
    : null;
  cache[q] = out;
  await saveCache("geocode", cache);
  return out;
}

/**
 * Tries the most specific description first and falls back to broader ones.
 * Returns the match plus which level matched, so the UI can say how precise a point is.
 */
export async function geocodeNode(n) {
  const attempts = [
    ["site", [n.name, n.city, n.country]],
    ["city", [n.city, n.country]],
    ["country", [n.country]],
  ];
  for (const [precision, parts] of attempts) {
    const q = parts.filter(Boolean).join(", ");
    if (!q || (precision !== "country" && !parts[0])) continue;
    const hit = await search(q);
    if (hit) return { ...hit, precision, query: q };
  }
  return null;
}
