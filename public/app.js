/* global d3 */
import { createMap, renderLegend, METRICS } from "./map.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const log = $("#log");
const form = $("#composer");
const input = $("#q");
const sendBtn = $("#send");
const metricSel = $("#metric");
const resourceSel = $("#resource");
const detail = $("#detail");

const history = [];
let trace = null;
let busy = false;

const map = createMap($("#map"), { onSelect: showDetail, tooltipEl: $("#tooltip") });

// ---------- setup check ----------
let ready = false;
async function checkStatus() {
  const s = await fetch("/api/status").then((r) => r.json());
  ready = s.ready;
  const src = [
    ["Tradeverifyd", true], ["Sayari", true], ["World Bank", true],
    ["Web search", s.optional.tavily], ["OpenStreetMap", s.optional.geocoding], ["UK GHG factors", s.optional.emissionFactors],
  ];
  $("#sources").innerHTML = src
    .filter(([, on]) => on)
    .map(([n]) => `<span class="${s.ready ? "on" : ""}">${n}</span>`).join("");
  const box = $("#setup");
  if (s.ready) { box.hidden = true; sendBtn.disabled = false; return; }
  const items = [
    ...s.missing.map((m) => `<li><code>${esc(m.name)}</code>: ${esc(m.label)}</li>`),
    ...s.nearMisses.map((n) => `<li><code>${esc(n)}</code> is ignored. Rename it to <code>${esc(n.toUpperCase())}</code>.</li>`),
    ...s.errors.map((e) => `<li>${esc(e)}</li>`),
  ];
  box.innerHTML = items.length
    ? `<strong>Finish setup before asking.</strong> Add these to <code>.env</code>, then restart the server:<ul>${items.join("")}</ul>`
    : `<strong>Loading public reference data…</strong>`;
  box.hidden = false;
  sendBtn.disabled = true;
  if (!items.length) setTimeout(checkStatus, 2000);
}
checkStatus().catch(() => {});

// ---------- chat ----------
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy || !ready) return;
  input.value = "";
  $(".intro")?.remove();
  addMsg("user", `<div>${esc(text)}</div>`);
  history.push({ role: "user", content: text });
  await ask();
});

function addMsg(kind, html) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.innerHTML = html;
  log.append(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

async function ask() {
  busy = true;
  sendBtn.disabled = true;
  const box = addMsg("ai", `<ul class="steps"></ul><div class="working">Looking up shipments</div>`);
  const steps = box.querySelector(".steps");
  let stepCount = 0;

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}. Check the server log.`);

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    let gotResult = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === "tool") {
          stepCount++;
          const li = document.createElement("li");
          const tag = { tradeverifyd: "Tradeverifyd", sayari: "Sayari", web: "Web" }[ev.server] ?? "Tool";
          li.innerHTML = `<span class="tag ${ev.server}">${tag}</span><span class="args">${esc(ev.name.replace(/_/g, " "))} ${esc(argSummary(ev.args))}</span>`;
          steps.append(li);
          box.querySelector(".working").textContent = ev.server === "sayari" ? "Tracing ownership" : ev.server === "web" ? "Searching the web" : "Reading trade records";
          log.scrollTop = log.scrollHeight;
        } else if (ev.type === "progress") {
          const li = document.createElement("li");
          li.innerHTML = `<span class="tag data">Data</span><span class="args">${esc(ev.text)}</span>`;
          steps.append(li);
          box.querySelector(".working").textContent = ev.text;
          log.scrollTop = log.scrollHeight;
        } else if (ev.type === "result") {
          gotResult = true;
          onResult(ev.data, box, steps, stepCount);
        } else if (ev.type === "error") {
          throw new Error(ev.message);
        }
      }
    }
    if (!gotResult) throw new Error("The connection closed before a trace came back. Try again.");
  } catch (err) {
    box.querySelector(".working")?.remove();
    addMsg("err", esc(err.message));
    history.pop(); // let the user retry the same question
  } finally {
    busy = false;
    sendBtn.disabled = !ready;
    input.focus();
  }
}

function argSummary(args) {
  if (!args) return "";
  const v = Object.values(args).filter((x) => typeof x === "string" || typeof x === "number");
  return v.length ? `“${v.slice(0, 2).join(", ")}”` : "";
}

function onResult(data, box, steps, stepCount) {
  trace = data;
  box.querySelector(".working")?.remove();

  // Collapse the tool steps under a summary once the answer is in.
  const wrap = document.createElement("details");
  wrap.className = "steps-wrap";
  wrap.innerHTML = `<summary>Used ${stepCount} tool call${stepCount === 1 ? "" : "s"} and ${steps.querySelectorAll(".tag.data").length} data lookups</summary>`;
  steps.replaceWith(wrap);
  wrap.append(steps);

  const answer = document.createElement("div");
  answer.innerHTML = data.answer.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("") +
    (data.unlocated.length ? `<p class="note">Couldn't place on the map: ${data.unlocated.map(esc).join(", ")}.</p>` : "");
  box.append(answer);

  if (data.resources.length) {
    const chips = document.createElement("div");
    chips.className = "chips";
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Show one resource on the map");
    chips.innerHTML = data.resources.map((r) => `<button type="button" class="chip" data-r="${esc(r.id)}" aria-pressed="false">${esc(r.name)}</button>`).join("");
    chips.addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      setResource(resourceSel.value === b.dataset.r ? "all" : b.dataset.r);
    });
    box.append(chips);
  }
  log.scrollTop = log.scrollHeight;

  // Keep a compact copy of the trace in the conversation so follow-ups can refer to it.
  const compact = JSON.stringify({
    company: data.company.name,
    resources: data.resources.map((r) => r.name),
    nodes: data.nodes.map((n) => `${n.id}:${n.name} (${n.role}, ${n.country})`),
  });
  history.push({ role: "assistant", content: (data.answer + "\n\nTrace so far: " + compact).slice(0, 5900) });

  resourceSel.innerHTML = `<option value="all">All resources</option>` +
    data.resources.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
  resourceSel.disabled = false;
  resourceSel.value = "all";
  $("#empty").hidden = true;
  detail.hidden = true;

  map.setTrace(data).then(refreshLegend);
  renderSummary();
}

// ---------- controls ----------
metricSel.addEventListener("change", () => {
  map.setMetric(metricSel.value);
  refreshLegend();
  if (!detail.hidden && detail.dataset.id) showDetail(trace.nodes.find((n) => n.id === detail.dataset.id));
});
resourceSel.addEventListener("change", () => setResource(resourceSel.value));

function setResource(r) {
  resourceSel.value = r;
  map.setResource(r);
  document.querySelectorAll(".chip[data-r]").forEach((c) => c.setAttribute("aria-pressed", c.dataset.r === r));
  renderSummary();
}
function refreshLegend() { renderLegend($("#legend"), map.scaleInfo()); }

$("#zin").addEventListener("click", () => map.zoomBy(1.6));
$("#zout").addEventListener("click", () => map.zoomBy(1 / 1.6));
$("#zreset").addEventListener("click", () => map.reset());
renderLegend($("#legend"), null);

// ---------- detail panel ----------
function showDetail(n) {
  if (!n) { detail.hidden = true; return; }
  const byId = new Map(trace.nodes.map((x) => [x.id, x]));
  const resName = (id) => trace.resources.find((r) => r.id === id)?.name ?? id;
  const inbound = trace.flows.filter((f) => f.to === n.id);
  const outbound = trace.flows.filter((f) => f.from === n.id);
  const nd = "No data";
  const num = (v, f = ",.0f") => (v == null ? nd : d3.format(f)(v));
  const how = { searoute: "sea lanes", osrm: "road route", "great-circle": "straight line" };
  const leg = (f, other) => `<li>${esc(resName(f.resourceId))}: ${esc(other.name)}, ${f.mode}, ${num(f.distanceKm)} km by ${how[f.distanceMethod]}` +
    (f.co2PerTonne != null ? `, ${num(f.co2PerTonne)} kg CO₂e/t` : f.co2Tonnes != null ? `, ${num(f.co2Tonnes, ",.1f")} t CO₂e` : "") +
    (f.co2Source === "tradeverifyd" ? `<br><small>CO₂ as reported by Tradeverifyd</small>` : "") +
    (f.factor ? `<br><small>Factor: ${esc(f.factor.label)}${f.factor.includesWtt ? " incl. well-to-tank" : ""}</small>` : "") + `</li>`;
  const sourceName = { tradeverifyd: "Tradeverifyd", sayari: "Sayari", both: "Tradeverifyd and Sayari" }[n.source];
  const precision = { site: "the site", city: "the city centre", country: "the country centre" }[n.precision];
  const coordFrom = { tradeverifyd: "Tradeverifyd record", sayari: "Sayari record", web: "web source", openstreetmap: "OpenStreetMap" }[n.coordSource];
  const coordLink = n.coordSourceUrl ? ` (<a href="${esc(n.coordSourceUrl)}" target="_blank" rel="noopener">page</a>)` : "";
  const rp = n.riskParts;
  const signals = n.riskSignals.flatMap((s) => [`${s.source === "sayari" ? "Sayari" : "Tradeverifyd"} rating: ${s.rating}`, ...s.factors]);

  detail.dataset.id = n.id;
  detail.innerHTML = `
    <button type="button" class="close" aria-label="Close details">×</button>
    <h3>${esc(n.name)}</h3>
    <div class="where">${esc([n.city, n.country].filter(Boolean).join(", "))}. ${esc(n.role)}. From ${esc(sourceName)}. Placed at ${esc(precision)} using ${esc(coordFrom ?? "unknown source")}${coordLink}.</div>
    <dl>
      <dt>Declared cost</dt><dd>${n.costPerTonne == null ? nd : num(n.costPerTonne) + " " + esc(trace.costCurrency ?? "") + "/t"}</dd>
      <dt>Disruption risk</dt><dd>${n.risk == null ? nd : `${num(n.risk)} / 100`}</dd>
      <dt>Outbound leg CO₂</dt><dd>${n.co2PerTonneOut == null ? nd : num(n.co2PerTonneOut) + " kg/t"}</dd>
      <dt>Outbound CO₂ total</dt><dd>${n.co2TonnesOut == null ? nd : num(n.co2TonnesOut, ",.1f") + " t"}</dd>
    </dl>
    <h4>Risk, from ${n.riskCoverage} of 3 sources</h4>
    <dl>
      <dt>Tradeverifyd</dt><dd>${num(rp.tradeverifyd)}</dd>
      <dt>Sayari</dt><dd>${num(rp.sayari)}</dd>
      <dt>Country stability${n.stability ? ` (WGI ${n.stability.year})` : ""}</dt><dd>${num(rp.country)}</dd>
    </dl>
    ${signals.length ? `<ul>${signals.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
    ${n.resourceIds.length ? `<h4>Resources</h4><div>${n.resourceIds.map((r) => esc(resName(r))).join(", ")}</div>` : ""}
    ${inbound.length ? `<h4>Receives from</h4><ul>${inbound.map((f) => leg(f, byId.get(f.from))).join("")}</ul>` : ""}
    ${outbound.length ? `<h4>Ships to</h4><ul>${outbound.map((f) => leg(f, byId.get(f.to))).join("")}</ul>` : ""}`;
  detail.hidden = false;
  detail.querySelector(".close").addEventListener("click", () => { detail.hidden = true; });
}

// ---------- summary strip ----------
function renderSummary() {
  if (!trace) return;
  const r = resourceSel.value;
  const flows = trace.flows.filter((f) => r === "all" || f.resourceId === r);
  const nodes = trace.nodes.filter((n) => n.role !== "company" && (r === "all" || n.resourceIds.includes(r)));
  const suppliers = nodes.filter((n) => ["supplier", "processor", "origin"].includes(n.role));
  const weighed = flows.filter((f) => f.co2Tonnes != null);
  const co2 = d3.sum(weighed, (f) => f.co2Tonnes);
  const riskiest = d3.greatest(nodes.filter((n) => n.risk != null), (n) => n.risk);
  const countries = new Set(nodes.map((n) => n.country));
  $("#summary").innerHTML = [
    `<span><b>${esc(trace.company.name)}</b></span>`,
    `<span><b>${suppliers.length}</b> suppliers in <b>${countries.size}</b> countries</span>`,
    `<span><b>${flows.length}</b> legs</span>`,
    weighed.length ? `<span>Logistics CO₂ <b>${d3.format(",.0f")(co2)} t</b> (${weighed.length} of ${flows.length} legs have weights)</span>` : `<span>No shipment weights, so no CO₂ total</span>`,
    riskiest ? `<span>Highest risk <b>${esc(riskiest.name)}</b> (${d3.format(".0f")(riskiest.risk)})</span>` : "",
    trace.provenance?.emissionFactors ? `<span>CO₂ factors: ${esc(trace.provenance.emissionFactors.source)}</span>` : `<span>CO₂ from Tradeverifyd where reported</span>`,
  ].join("");
}
