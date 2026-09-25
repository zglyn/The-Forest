// UK Government GHG conversion factors (DESNZ), downloaded at startup.
// 1. Ask the GOV.UK Content API for the collection page and find the newest yearly publication.
// 2. Ask for that publication and find its "flat file" attachment (the machine-readable version).
// 3. Parse the freight rows (kg CO2e per tonne.km) out of it.
import ExcelJS from "exceljs";
import { env } from "../config.js";
import { loadCache, saveCache } from "./cache.js";

let table = null; // { year, url, title, rows: [...] }

function walk(obj, fn) {
  if (Array.isArray(obj)) obj.forEach((x) => walk(x, fn));
  else if (obj && typeof obj === "object") {
    fn(obj);
    Object.values(obj).forEach((x) => walk(x, fn));
  }
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
  return res.json();
}

async function discoverFlatFile() {
  const collectionUrl = env("GOVUK_CONVERSION_FACTORS_COLLECTION");
  const collection = await getJson(collectionUrl);
  const pubs = [];
  walk(collection, (o) => {
    const m = typeof o.base_path === "string" && o.base_path.match(/conversion-factors-(\d{4})$/);
    if (m) pubs.push({ year: +m[1], path: o.base_path });
  });
  if (!pubs.length) throw new Error("No yearly conversion-factor publications found on GOV.UK.");
  pubs.sort((a, b) => b.year - a.year);

  const origin = new URL(collectionUrl).origin;
  for (const pub of pubs) {
    const page = await getJson(`${origin}/api/content${pub.path}`);
    const files = [];
    walk(page, (o) => {
      if (typeof o.url === "string" && typeof o.title === "string") files.push(o);
    });
    const flat = files.find((f) => /flat file/i.test(f.title) && /\.(xlsx|csv)(\?|$)/i.test(f.url));
    if (flat) return { year: pub.year, title: flat.title, url: new URL(flat.url, origin).href };
  }
  throw new Error("Found conversion-factor publications but none has a flat file attachment.");
}

const clean = (v) => {
  if (v == null) return "";
  if (typeof v === "object" && "result" in v) return String(v.result ?? "");
  if (typeof v === "object" && "richText" in v) return v.richText.map((t) => t.text).join("");
  return String(v).trim();
};

async function parseFlatFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Downloading conversion factors returned ${res.status}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));

  for (const ws of wb.worksheets) {
    // Find the header row: it is the one that names Level 1 and the unit of measure.
    let header = null, headerRow = 0;
    for (let r = 1; r <= Math.min(ws.rowCount, 40) && !header; r++) {
      const cells = ws.getRow(r).values.map(clean);
      if (cells.some((c) => /^level 1$/i.test(c)) && cells.some((c) => /^uom$/i.test(c))) {
        header = cells;
        headerRow = r;
      }
    }
    if (!header) continue;
    const col = (re) => header.findIndex((c) => re.test(c));
    const idx = {
      id: col(/^id$/i),
      l1: col(/^level 1$/i), l2: col(/^level 2$/i), l3: col(/^level 3$/i), l4: col(/^level 4$/i),
      text: col(/^column text$/i), uom: col(/^uom$/i), unit: col(/^ghg\/unit$/i),
      factor: col(/conversion factor/i),
    };
    const rows = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).values.map(clean);
      const factor = parseFloat(v[idx.factor]);
      if (!isFinite(factor)) continue;
      if (!/tonne\.?\s*km/i.test(v[idx.uom]) || !/kg co2e/i.test(v[idx.unit])) continue;
      rows.push({
        id: v[idx.id] || null,
        level1: v[idx.l1], level2: v[idx.l2], level3: v[idx.l3], level4: v[idx.l4],
        text: idx.text > 0 ? v[idx.text] : "",
        factor,
      });
    }
    if (rows.length) return rows;
  }
  throw new Error("Could not find tonne.km freight rows in the conversion-factor file.");
}

export async function loadEmissionFactors() {
  if (table) return table;
  const found = await discoverFlatFile();
  const cache = await loadCache("conversion-factors");
  if (cache.url === found.url && cache.rows?.length) {
    table = cache;
  } else {
    table = { ...found, rows: await parseFlatFile(found.url) };
    await saveCache("conversion-factors", table);
  }
  console.log(`[factors] ${table.title} (${table.year}): ${table.rows.length} freight rows`);
  return table;
}

// ---------- choosing a factor for a leg ----------
// The file has many freight rows per mode. These rules pick one, preferring the
// fleet-average row unless the shipment data says something more specific.
const MODE = {
  sea: { level2: /cargo ship/i, prefer: [/container/i, /average/i] },
  road: { level2: /^hgv/i, prefer: [/all hgv/i, /average laden/i, /average/i] },
  air: { level2: /freight flight/i, prefer: [/international.*non-uk/i, /with rf/i] },
  rail: { level2: /rail/i, prefer: [/freight train/i] },
};

const label = (r) => [r.level2, r.level3, r.level4, r.text].filter(Boolean).join(" / ");

function pick(rows, mode, hint) {
  const rule = MODE[mode];
  let cands = rows.filter((r) => rule.level2.test(r.level2));
  if (!cands.length) return null;
  if (hint) {
    const words = hint.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const hinted = cands.filter((r) => words.some((w) => label(r).toLowerCase().includes(w)));
    if (hinted.length) cands = hinted;
  }
  for (const re of rule.prefer) {
    const narrowed = cands.filter((r) => re.test(label(r)));
    if (narrowed.length) cands = narrowed;
  }
  return cands[0];
}

/** kg CO2e per tonne-km for a leg: direct emissions plus well-to-tank when the file has a matching row. */
export function factorFor(mode, hint) {
  if (!table) return null; // not configured
  const direct = table.rows.filter((r) => /^freighting goods$/i.test(r.level1));
  const wtt = table.rows.filter((r) => /^wtt/i.test(r.level1) && /freight/i.test(r.level1));
  const d = pick(direct, mode, hint);
  if (!d) return null;
  const w = wtt.find((r) => label(r) === label(d));
  return {
    kgPerTonneKm: d.factor + (w?.factor ?? 0),
    includesWtt: Boolean(w),
    label: label(d),
    ids: [d.id, w?.id].filter(Boolean),
    source: `${table.title} (${table.year})`,
  };
}

export function factorSummary() {
  if (!table) return null;
  return {
    source: table.title,
    year: table.year,
    url: table.url,
    byMode: Object.fromEntries(Object.keys(MODE).map((m) => [m, factorFor(m)])),
  };
}
