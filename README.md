# Tracemap

Ask an AI (OpenAI or Anthropic model, via LangChain) about a company. It reads the company's shipments in **Tradeverifyd**, resolves suppliers and owners in **Sayari**, and draws the trace on a **D3** world map. You can colour the map by **cost**, **risk of supply disruption**, or **CO₂ emissions**.

The app contains no built-in data. Every value on the map comes from one of the sources below, and the detail panel for each point shows which.

| What | Source | How it's fetched |
|---|---|---|
| Resources, suppliers, routes, weights, declared values | Tradeverifyd | MCP server, loaded as LangChain tools |
| Ownership, upstream tiers, risk flags | Sayari | REST API via Sayari's official SDK, wrapped as LangChain tools (`server/sayari-tools.js`). MCP is used instead only if `SAYARI_MCP_URL` is set |
| Map coordinates | Tradeverifyd / Sayari records, then Tavily web search (each web coordinate links to its page) | Agent |
| Map coordinates, fallback (optional, off) | OpenStreetMap Nominatim | Only if `NOMINATIM_URL` and `NOMINATIM_EMAIL` are set |
| Sea distances and routes | Eurostat maritime network bundled with `searoute-js`, joined across the Pacific date line | Calculated on the server |
| Road distances (optional) | OSRM routing server | Only if `OSRM_URL` is set |
| CO₂ | Emissions reported by Tradeverifyd | Agent |
| CO₂ per tonne-km (optional, off) | UK government GHG conversion factors (DESNZ) | Only if `GOVUK_CONVERSION_FACTORS_COLLECTION` is set |
| Country stability | World Bank Worldwide Governance Indicators | Political Stability score (0–100) via the World Bank API |

## Run it

On your own computer, in a terminal opened in this folder:

```bash
npm install
cp .env.example .env   # Windows PowerShell: copy .env.example .env
# fill in .env
npm start
```

Then open http://localhost:<PORT>. If anything in `.env` is missing or has the wrong capitalisation, the page lists exactly what to fix, and asking is disabled until it's fixed.

You don't need `mcp-proxy`. The server connects to both MCP servers directly over streamable HTTP.

## How the three map variables are calculated

**Cost** is the declared customs value divided by shipped weight, both totals from Tradeverifyd's records, in the currency the records use. If legs come in different currencies, the map colours the most common one and shows the others as "no data".

**Risk of supply disruption** is the average of three parts on a 0–100 scale, weighted equally:
1. **Tradeverifyd:** the rating Tradeverifyd returned, mapped onto 0–100 using the scale Tradeverifyd documents.
2. **Sayari:** the same treatment for Sayari's rating.
3. **Country stability:** 100 minus the World Bank Political Stability score for the country the point sits in.

If a part is missing, the average uses the parts that exist. The detail panel shows each part and says "from 2 of 3 sources" or similar.

**CO₂** uses the emissions Tradeverifyd reports for a leg, divided by its weight for the per-tonne view. If Tradeverifyd reports none and the UK factors are off, the leg shows "no data". With the UK factors on, legs without a reported figure use distance × a factor in kg CO₂e per tonne-km, as follows.
- For sea legs, the distance follows real shipping lanes.
- For road legs, the distance comes from OSRM if it's configured, otherwise a straight line.
- For rail and air legs, it's the straight-line (great-circle) distance.

The factor is the fleet-average row for the mode, plus the matching well-to-tank row where the file has one. If the shipment record names a vessel type, such as "bulk carrier", that row is used instead. The rules that pick a row are in `MODE` in `server/sources/emission-factors.js`, and each leg in the detail panel shows which row it used.

## Files

```
server/index.js                   Fastify: /api/status, streaming /api/ask
server/config.js                  reads .env, reports missing or wrong-case names
server/agent.js                   loads Tradeverifyd + Sayari MCP tools (+ Tavily), runs the agent
server/sayari-tools.js            Sayari REST API as LangChain tools
server/sayari-auth.js             Sayari bearer token (MCP route only)
server/schema.js                  what the agent must return
server/enrich.js                  locations, distances, CO₂, risk, cost
server/sources/geocode.js         Nominatim (1 request/second, cached)
server/sources/routes.js          searoute / OSRM / great-circle
server/sources/emission-factors.js  GOV.UK conversion factors
server/sources/stability.js       World Bank WGI
public/                           D3 front end
```
