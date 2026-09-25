/* global d3, topojson */
const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// Each metric knows how to read a value from a node and from a flow.
export const METRICS = {
  cost: {
    label: "Declared cost",
    unit: (t) => `${t?.costCurrency ?? ""} per tonne, customs value from Tradeverifyd`.trim(),
    type: "log",
    ramp: (t) => d3.interpolateBlues(0.3 + 0.7 * t),
    node: (n) => n.costPerTonne,
    flow: (f, byId, trace) => ((f.currency ?? "unknown") === trace?.costCurrency ? f.costPerTonne : null),
    fmt: (v) => d3.format(",.0f")(v),
    tick: (v) => d3.format("~s")(v),
  },
  risk: {
    label: "Risk of supply disruption",
    unit: () => "0–100: Tradeverifyd, Sayari and country stability, equal weight",
    type: "linear",
    fixed: [0, 100],
    ramp: (t) => d3.interpolateYlOrRd(0.18 + 0.82 * t),
    node: (n) => n.risk,
    flow: (f, byId) => {
      const v = [byId.get(f.from)?.risk, byId.get(f.to)?.risk].filter((x) => x != null);
      return v.length ? Math.max(...v) : null;
    },
    fmt: (v) => d3.format(".0f")(v),
    tick: (v) => d3.format(".0f")(v),
  },
  co2: {
    label: "CO₂ emissions",
    unit: () => "kg CO₂e per tonne moved, per leg",
    type: "linear",
    ramp: (t) => d3.interpolatePuRd(0.22 + 0.78 * t),
    node: (n) => n.co2PerTonneOut,
    flow: (f) => f.co2PerTonne,
    fmt: (v) => d3.format(",.0f")(v) + " kg",
    tick: (v) => d3.format("~s")(v),
  },
};

export function createMap(el, { onSelect, tooltipEl }) {
  const svg = d3.select(el).insert("svg", ":first-child").attr("role", "img").attr("aria-label", "World map of the traced supply chain");
  const root = svg.append("g");
  const gGrat = root.append("path").attr("class", "graticule");
  const gCountries = root.append("g");
  const gFlows = root.append("g");
  const gNodes = root.append("g");
  const gLabels = root.append("g");

  const projection = d3.geoNaturalEarth1();
  const path = d3.geoPath(projection);
  const graticule = d3.geoGraticule10();

  let countries = [];
  let trace = null;
  let metricKey = "cost";
  let resource = "all";
  let selectedId = null;
  let k = 1;
  let width = 0, height = 0;

  const zoom = d3.zoom().scaleExtent([1, 12]).on("zoom", (e) => {
    k = e.transform.k;
    root.attr("transform", e.transform);
    gNodes.selectAll("circle").attr("r", (d) => radius(d) / k);
    gLabels.selectAll("text").attr("font-size", 11 / k).attr("dy", -9 / k).style("display", k >= 2.2 ? null : "none");
  });
  svg.call(zoom).on("dblclick.zoom", null);

  const ready = d3.json(WORLD_URL).then((topo) => {
    countries = topojson.feature(topo, topo.objects.countries).features;
    resize();
  });

  new ResizeObserver(() => resize()).observe(el);

  function resize() {
    const r = el.getBoundingClientRect();
    width = r.width; height = r.height;
    if (!width || !height) return;
    svg.attr("viewBox", [0, 0, width, height]);
    projection.fitExtent([[8, 8], [width - 8, height - 8]], { type: "Sphere" });
    zoom.translateExtent([[0, 0], [width, height]]).extent([[0, 0], [width, height]]);
    draw();
  }

  // ---------- drawing ----------
  const radius = (n) => (n.role === "company" ? 8 : n.role === "port" || n.role === "hub" ? 4.5 : 6);
  const visibleNode = (n) => resource === "all" || n.role === "company" || n.resourceIds.includes(resource);
  const visibleFlow = (f) => resource === "all" || f.resourceId === resource;

  function colourScale() {
    const m = METRICS[metricKey];
    if (!trace) return null;
    const byId = new Map(trace.nodes.map((n) => [n.id, n]));
    const vals = [
      ...trace.nodes.map(m.node),
      ...trace.flows.map((f) => m.flow(f, byId, trace)),
    ].filter((v) => v != null && isFinite(v) && (m.type !== "log" || v > 0));
    if (!vals.length) return { m, byId, scale: null, domain: null };
    let domain = m.fixed ?? d3.extent(vals);
    if (domain[0] === domain[1]) domain = m.type === "log" ? [domain[0] / 2, domain[1] * 2] : [0, domain[1] || 1];
    if (m.type === "linear" && !m.fixed) domain = [0, domain[1]];
    const base = m.type === "log" ? d3.scaleLog().domain(domain) : d3.scaleLinear().domain(domain);
    const scale = (v) => m.ramp(Math.max(0, Math.min(1, base(v))));
    scale.base = base;
    return { m, byId, scale, domain };
  }

  function draw() {
    if (!width) return;
    gGrat.attr("d", path(graticule));
    const cs = colourScale();

    // Countries: tinted by the highest node value inside them.
    const countryVal = new Map();
    if (trace && cs?.scale) {
      for (const n of trace.nodes) {
        if (!visibleNode(n) || !n._country) continue;
        const v = cs.m.node(n);
        if (v == null) continue;
        countryVal.set(n._country, Math.max(countryVal.get(n._country) ?? -Infinity, v));
      }
    }
    gCountries.selectAll("path").data(countries, (d) => d.id)
      .join("path")
      .attr("class", "country")
      .attr("d", path)
      .style("fill", (d) => (countryVal.has(d.id) ? cs.scale(countryVal.get(d.id)) : null))
      .style("fill-opacity", (d) => (countryVal.has(d.id) ? 0.35 : null));

    if (!trace) return;

    const flows = trace.flows.filter(visibleFlow);
    const maxT = d3.max(trace.flows, (f) => f.tonnes) || 1;
    const w = d3.scaleSqrt().domain([0, maxT]).range([1.5, 7]);

    gFlows.selectAll("path").data(flows, (f) => `${f.from}-${f.to}-${f.resourceId}`)
      .join("path")
      .attr("class", (f) => {
        const v = cs?.m.flow(f, cs.byId, trace);
        return `flow ${f.mode}${v == null || !cs?.scale ? " nodata" : ""}`;
      })
      .attr("d", (f) => {
        const a = cs.byId.get(f.from), b = cs.byId.get(f.to);
        const coords = f.geometry?.length > 1 ? f.geometry : [[a.lon, a.lat], [b.lon, b.lat]];
        return path({ type: "LineString", coordinates: coords });
      })
      .style("stroke", (f) => {
        const v = cs?.m.flow(f, cs.byId, trace);
        return v != null && cs.scale ? cs.scale(v) : null;
      })
      .style("stroke-width", (f) => w(f.tonnes ?? 0) + "px")
      .on("mousemove", (e, f) => showTip(e, flowTip(f, cs)))
      .on("mouseleave", hideTip);

    const nodes = trace.nodes.filter(visibleNode).sort((a, b) => (a.role === "company") - (b.role === "company"));
    gNodes.selectAll("circle").data(nodes, (n) => n.id)
      .join("circle")
      .attr("class", (n) => {
        const v = cs?.m.node(n);
        return `node ${n.role}${v == null || !cs?.scale ? " nodata" : ""}${n.id === selectedId ? " sel" : ""}`;
      })
      .attr("cx", (n) => projection([n.lon, n.lat])[0])
      .attr("cy", (n) => projection([n.lon, n.lat])[1])
      .attr("r", (n) => radius(n) / k)
      .style("fill", (n) => {
        if (n.role === "company") return "var(--ink)";
        const v = cs?.m.node(n);
        return v != null && cs.scale ? cs.scale(v) : null;
      })
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (n) => `${n.name}, ${n.country}`)
      .on("mousemove", (e, n) => showTip(e, nodeTip(n, cs)))
      .on("mouseleave", hideTip)
      .on("click", (e, n) => select(n.id))
      .on("keydown", (e, n) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(n.id); } });

    gLabels.selectAll("text").data(nodes.filter((n) => n.role !== "port" && n.role !== "hub"), (n) => n.id)
      .join("text")
      .attr("class", "nlabel")
      .attr("x", (n) => projection([n.lon, n.lat])[0])
      .attr("y", (n) => projection([n.lon, n.lat])[1])
      .attr("text-anchor", "middle")
      .attr("font-size", 11 / k)
      .attr("dy", -9 / k)
      .style("display", k >= 2.2 ? null : "none")
      .text((n) => n.name);
  }

  // ---------- interaction ----------
  function select(id) {
    selectedId = id;
    draw();
    onSelect?.(trace.nodes.find((n) => n.id === id) ?? null);
  }

  function showTip(e, html) {
    const r = el.getBoundingClientRect();
    tooltipEl.innerHTML = html;
    tooltipEl.hidden = false;
    const x = Math.min(e.clientX - r.left + 14, r.width - tooltipEl.offsetWidth - 8);
    const y = Math.min(e.clientY - r.top + 14, r.height - tooltipEl.offsetHeight - 8);
    tooltipEl.style.left = x + "px";
    tooltipEl.style.top = y + "px";
  }
  function hideTip() { tooltipEl.hidden = true; }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function nodeTip(n, cs) {
    const v = cs?.m.node(n);
    return `<b>${esc(n.name)}</b>${esc([n.city, n.country].filter(Boolean).join(", "))}<br>${cs.m.label}: ${v == null ? "no data" : cs.m.fmt(v) + costUnit()}`;
  }
  const costUnit = () => (metricKey === "cost" ? ` ${trace.costCurrency ?? ""}/t` : "");
  function flowTip(f, cs) {
    const a = cs.byId.get(f.from), b = cs.byId.get(f.to);
    const res = trace.resources.find((r) => r.id === f.resourceId)?.name ?? f.resourceId;
    const v = cs.m.flow(f, cs.byId, trace);
    return `<b>${esc(res)}</b>${esc(a.name)} to ${esc(b.name)}<br>${f.mode}, ${d3.format(",")(f.distanceKm)} km` +
      (f.tonnes != null ? `, ${d3.format(",")(f.tonnes)} t` : "") +
      `<br>${cs.m.label}: ${v == null ? "no data" : cs.m.fmt(v) + costUnit()}`;
  }

  function fitToTrace() {
    if (!trace?.nodes.length || !width) return;
    const pts = trace.nodes.filter(visibleNode).map((n) => projection([n.lon, n.lat]));
    const [x0, x1] = d3.extent(pts, (p) => p[0]);
    const [y0, y1] = d3.extent(pts, (p) => p[1]);
    const pad = 60;
    const s = Math.max(1, Math.min(8, 0.9 / Math.max((x1 - x0 + pad) / width, (y1 - y0 + pad) / height)));
    const t = d3.zoomIdentity.translate(width / 2, height / 2).scale(s).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    svg.transition().duration(matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 750).call(zoom.transform, t);
  }

  // ---------- public API ----------
  return {
    async setTrace(t) {
      await ready;
      trace = t;
      selectedId = null;
      for (const n of trace.nodes) {
        n._country = countries.find((c) => d3.geoContains(c, [n.lon, n.lat]))?.id ?? null;
      }
      draw();
      fitToTrace();
    },
    setMetric(key) { metricKey = key; draw(); },
    setResource(r) { resource = r; draw(); fitToTrace(); },
    select,
    scaleInfo() { const cs = colourScale(); return cs && { metric: cs.m, domain: cs.domain, trace }; },
    zoomBy(f) { svg.transition().duration(250).call(zoom.scaleBy, f); },
    reset() { svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity); },
  };
}

export function renderLegend(el, info) {
  el.innerHTML = "";
  if (!info?.domain) {
    if (info) {
      const why = info.metric.label.startsWith("CO")
        ? "Tradeverifyd didn't report emissions for these shipments, and UK conversion factors are off"
        : "the sources returned no values for this trace";
      el.innerHTML = `<div class="cap">${info.metric.label}: ${why}</div>`;
    }
    return;
  }
  const { metric: m, domain } = info;
  const W = 220, H = 10;
  const cap = document.createElement("div");
  cap.className = "cap";
  cap.textContent = `${m.label} (${m.unit(info.trace)})`;
  el.append(cap);
  const svg = d3.select(el).append("svg").attr("width", W).attr("height", H + 18);
  const id = "lg-" + Math.random().toString(36).slice(2, 7);
  const grad = svg.append("defs").append("linearGradient").attr("id", id);
  d3.range(0, 1.01, 0.1).forEach((t) => grad.append("stop").attr("offset", t).attr("stop-color", m.ramp(t)));
  svg.append("rect").attr("width", W).attr("height", H).attr("rx", 2).attr("fill", `url(#${id})`);
  const x = (m.type === "log" ? d3.scaleLog() : d3.scaleLinear()).domain(domain).range([0, W]);
  svg.append("g").attr("transform", `translate(0,${H})`)
    .call(d3.axisBottom(x).tickValues(legendTicks(x, m, domain)).tickFormat(m.tick).tickSize(4))
    .call((g) => g.select(".domain").remove())
    .call((g) => g.selectAll("line").attr("stroke", "currentColor"));
}

function legendTicks(x, m, domain) {
  if (m.type !== "log") return x.ticks(4);
  const powers = x.ticks().filter((v) => Number.isInteger(Math.log10(v)));
  return powers.length >= 2 ? powers : domain;
}
