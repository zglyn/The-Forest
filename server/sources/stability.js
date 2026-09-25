// Country stability from the World Bank's Worldwide Governance Indicators (API source 3).
// The indicator is found by name at startup rather than by a fixed code, so a renamed
// code in a future WGI release doesn't break the app.
import { env } from "../config.js";
import { loadCache, saveCache } from "./cache.js";

let indicator = null; // { id, name }
let cache;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
  return res.json();
}

export async function loadStabilityIndicator() {
  if (indicator) return indicator;
  const base = env("WORLD_BANK_API");
  const [, list] = await getJson(`${base}/sources/3/indicators?format=json&per_page=500`);
  const hit = list?.find((i) => /political stability/i.test(i.name) && /score \(0-100\)/i.test(i.name));
  if (!hit) throw new Error("World Bank political stability score (0-100) indicator not found.");
  indicator = { id: hit.id, name: hit.name };
  console.log(`[stability] using ${indicator.id}: ${indicator.name}`);
  return indicator;
}

/**
 * Returns { score, year, riskScore } for an ISO 3166 alpha-2 country code.
 * The WGI score is 0 (least stable) to 100 (most stable), so risk = 100 - score.
 */
export async function countryStability(iso2) {
  if (!iso2) return null;
  cache ??= await loadCache("stability");
  const key = `${indicator.id}:${iso2}`;
  if (key in cache) return cache[key];
  const base = env("WORLD_BANK_API");
  const url = `${base}/country/${iso2}/indicator/${indicator.id}?source=3&format=json&mrnev=1`;
  let out = null;
  try {
    const [, rows] = await getJson(url);
    const row = rows?.find((r) => r.value != null);
    if (row) out = { score: row.value, year: +row.date, riskScore: 100 - row.value, country: row.country?.value };
  } catch (e) {
    console.warn(`[stability] ${iso2}: ${e.message}`);
  }
  cache[key] = out;
  await saveCache("stability", cache);
  return out;
}

// ---------- country codes ----------
// The World Bank's own country list maps names and codes, so no lookup table is kept here.
let countries = null;
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

async function loadCountries() {
  if (countries) return countries;
  const [, list] = await getJson(`${env("WORLD_BANK_API")}/country?format=json&per_page=400`);
  countries = (list ?? []).filter((c) => c.region?.value !== "Aggregates");
  return countries;
}

/** Returns an ISO alpha-2 code the World Bank recognises, from a code or a country name. */
export async function countryCodeFor(code, name) {
  const list = await loadCountries();
  if (code) {
    const c = code.trim().toUpperCase();
    const hit = list.find((x) => x.iso2Code === c || x.id === c);
    if (hit) return hit.iso2Code;
  }
  if (!name) return null;
  const n = norm(name);
  const exact = list.find((x) => norm(x.name) === n);
  if (exact) return exact.iso2Code;
  // World Bank names put the qualifier after a comma, e.g. "Korea, Rep."; match on the main part.
  const partial = list.filter((x) => norm(x.name.split(",")[0]) === n || n.includes(norm(x.name.split(",")[0])));
  return partial.length === 1 ? partial[0].iso2Code : null;
}
