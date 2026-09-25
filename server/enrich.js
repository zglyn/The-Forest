// Turns the agent's trace into map-ready data using public sources:
// Nominatim (locations), searoute / OSRM (distances), UK government conversion
// factors (CO2) and World Bank WGI (country stability).
import { geocodeNode } from "./sources/geocode.js";
import { routeLeg } from "./sources/routes.js";
import { factorFor, factorSummary } from "./sources/emission-factors.js";
import { countryStability, countryCodeFor } from "./sources/stability.js";
import { optional } from "./config.js";

const progress = (text) => ({ type: "progress", text });
const round = (v, d = 1) => (v == null ? null : +v.toFixed(d));

/** A tool's rating mapped onto 0-100, where 100 is the most risk. Null if the scale wasn't given. */
function normalise(s) {
  if (s.numericValue != null && s.scaleMin != null && s.scaleMax != null && s.scaleMax !== s.scaleMin) {
    let t = (s.numericValue - s.scaleMin) / (s.scaleMax - s.scaleMin);
    t = Math.max(0, Math.min(1, t));
    return (s.higherMeansRiskier ? t : 1 - t) * 100;
  }
  const levels = s.levelsLowToHigh;
  if (levels?.length > 1) {
    const i = levels.findIndex((l) => l.trim().toLowerCase() === s.rating.trim().toLowerCase());
    if (i >= 0) return (i / (levels.length - 1)) * 100; // levels are already ordered least to most severe
  }
  return null;
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export async function* enrich(trace) {
  // ---- 1. Locations ----
  // Coordinates come from the agent's sources (tool records or a cited web page).
  // If Nominatim is configured, it fills in any that are still missing.
  const { geocoding } = optional();
  const needGeo = trace.nodes.filter((n) => n.lat == null || n.lon == null);
  if (geocoding && needGeo.length) {
    yield progress(`Locating ${needGeo.length} places with OpenStreetMap`);
    for (const n of needGeo) {
      const g = await geocodeNode(n);
      if (g) Object.assign(n, { lat: g.lat, lon: g.lon, countryCode: n.countryCode ?? g.countryCode, precision: g.precision, coordSource: "openstreetmap", placeName: g.displayName });
    }
  }
  for (const n of trace.nodes) if (n.lat != null && !n.precision) n.precision = "site";
  const unlocated = trace.nodes.filter((n) => n.lat == null || n.lon == null).map((n) => n.name);
  trace.nodes = trace.nodes.filter((n) => n.lat != null && n.lon != null);
  const byId = new Map(trace.nodes.map((n) => [n.id, n]));
  const droppedFlows = trace.flows.filter((f) => !byId.has(f.from) || !byId.has(f.to)).length;
  trace.flows = trace.flows.filter((f) => byId.has(f.from) && byId.has(f.to));

  // ---- 2. Distances, CO2 and cost per leg ----
  yield progress(`Measuring ${trace.flows.length} legs`);
  for (const f of trace.flows) {
    const r = await routeLeg(byId.get(f.from), byId.get(f.to), f.mode);
    f.distanceKm = Math.round(r.distanceKm);
    f.distanceMethod = r.method;
    f.geometry = r.geometry;
    // CO2: Tradeverifyd's reported figure first; UK government factors if configured; otherwise none.
    const fac = factorFor(f.mode, f.vesselType);
    f.factor = null;
    if (f.reportedCo2Kg != null) {
      f.co2Source = "tradeverifyd";
      f.co2Tonnes = round(f.reportedCo2Kg / 1000);
      f.co2PerTonne = f.tonnes ? round(f.reportedCo2Kg / f.tonnes) : null;
    } else if (fac) {
      f.co2Source = "uk-factors";
      f.factor = fac;
      f.co2PerTonne = round(f.distanceKm * fac.kgPerTonneKm); // kg CO2e per tonne moved
      f.co2Tonnes = f.tonnes != null ? round((f.co2PerTonne * f.tonnes) / 1000) : null;
    } else {
      f.co2Source = null;
      f.co2PerTonne = null;
      f.co2Tonnes = null;
    }
    f.costPerTonne = f.declaredValue != null && f.tonnes ? round(f.declaredValue / f.tonnes, 2) : null;
  }

  // Cost is only comparable within one currency; colour the most common one.
  const costCurrency = mostCommon(trace.flows.filter((f) => f.costPerTonne != null).map((f) => f.currency ?? "unknown"));

  // ---- 3. Country stability ----
  for (const n of trace.nodes) n.countryCode = (await countryCodeFor(n.countryCode, n.country)) ?? null;
  const codes = [...new Set(trace.nodes.map((n) => n.countryCode).filter(Boolean))];
  yield progress(`Looking up political stability for ${codes.length} countries (World Bank)`);
  const stability = new Map();
  for (const c of codes) stability.set(c, await countryStability(c));

  // ---- 4. Per-node values ----
  for (const n of trace.nodes) {
    const out = trace.flows.filter((f) => f.from === n.id);

    // Cost: declared value per tonne of what this node ships, in the common currency.
    const priced = out.filter((f) => f.costPerTonne != null && (f.currency ?? "unknown") === costCurrency);
    const tonnes = priced.reduce((s, f) => s + f.tonnes, 0);
    n.costPerTonne = tonnes ? round(priced.reduce((s, f) => s + f.declaredValue, 0) / tonnes, 2) : null;

    // CO2 of the legs this node ships.
    const withCo2 = out.filter((f) => f.co2PerTonne != null);
    n.co2PerTonneOut = withCo2.length ? Math.max(...withCo2.map((f) => f.co2PerTonne)) : null;
    n.co2TonnesOut = out.some((f) => f.co2Tonnes != null) ? round(out.reduce((s, f) => s + (f.co2Tonnes ?? 0), 0)) : null;

    // Risk: Tradeverifyd, Sayari and country stability, weighted equally.
    const part = (src) => {
      const v = n.riskSignals.filter((s) => s.source === src).map(normalise).filter((x) => x != null);
      return v.length ? round(Math.max(...v)) : null;
    };
    const st = stability.get(n.countryCode);
    n.riskParts = {
      tradeverifyd: part("tradeverifyd"),
      sayari: part("sayari"),
      country: st ? round(st.riskScore) : null,
    };
    n.stability = st;
    const known = Object.values(n.riskParts).filter((v) => v != null);
    n.risk = known.length ? round(known.reduce((a, b) => a + b, 0) / known.length) : null;
    n.riskCoverage = known.length;
  }

  // ---- 5. Totals and provenance ----
  const weighed = trace.flows.filter((f) => f.co2Tonnes != null);
  trace.totals = {
    logisticsCo2Tonnes: weighed.length ? round(weighed.reduce((s, f) => s + f.co2Tonnes, 0)) : null,
    flowsWithWeight: weighed.length,
    flows: trace.flows.length,
  };
  trace.costCurrency = costCurrency;
  trace.unlocated = unlocated;
  trace.droppedFlows = droppedFlows;
  trace.provenance = { emissionFactors: factorSummary() };
  return trace;
}
