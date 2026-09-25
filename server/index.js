import "dotenv/config";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { missingConfig, optional } from "./config.js";
import { runAgent, closeAgent } from "./agent.js";
import { enrich } from "./enrich.js";
import { loadEmissionFactors, factorSummary } from "./sources/emission-factors.js";
import { loadStabilityIndicator } from "./sources/stability.js";

const app = Fastify({ logger: { level: "info" } });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
await app.register(fastifyStatic, { root });

// Public reference data, loaded once at startup.
const dataStatus = { emissionFactors: null, stability: null };
async function loadReferenceData() {
  if (optional().emissionFactors) {
    try {
      await loadEmissionFactors();
      dataStatus.emissionFactors = "ok";
    } catch (e) {
      dataStatus.emissionFactors = e.message;
      console.error("[factors]", e.message);
    }
  } else {
    dataStatus.emissionFactors = "off";
    console.log("[factors] UK conversion factors not configured; CO2 uses emissions reported by Tradeverifyd only.");
  }
  try {
    await loadStabilityIndicator();
    dataStatus.stability = "ok";
  } catch (e) {
    dataStatus.stability = e.message;
    console.error("[stability]", e.message);
  }
}

function problems() {
  const { missing, nearMisses } = missingConfig();
  const errors = [];
  if (dataStatus.emissionFactors && !["ok", "off"].includes(dataStatus.emissionFactors)) errors.push(`Emission factors: ${dataStatus.emissionFactors}`);
  if (dataStatus.stability && dataStatus.stability !== "ok") errors.push(`Country stability: ${dataStatus.stability}`);
  return { missing, nearMisses, errors };
}

app.get("/api/status", async () => {
  const p = problems();
  return {
    ready: !p.missing.length && !p.errors.length && ["ok", "off"].includes(dataStatus.emissionFactors) && dataStatus.stability === "ok",
    ...p,
    optional: optional(),
    factors: factorSummary(),
  };
});

const askSchema = {
  body: {
    type: "object",
    required: ["messages"],
    properties: {
      messages: {
        type: "array",
        minItems: 1,
        maxItems: 30,
        items: {
          type: "object",
          required: ["role", "content"],
          properties: {
            role: { enum: ["user", "assistant"] },
            content: { type: "string", minLength: 1, maxLength: 6000 },
          },
        },
      },
    },
  },
};

// Streams newline-delimited JSON: tool calls, enrichment progress, then the result.
app.post("/api/ask", { schema: askSchema }, async (req, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
  const send = (o) => reply.raw.write(JSON.stringify(o) + "\n");
  try {
    const p = problems();
    if (p.missing.length || p.errors.length) {
      throw new Error("Setup incomplete: " + [...p.missing.map((m) => m.name), ...p.errors].join("; "));
    }
    let trace = null;
    for await (const ev of runAgent(req.body.messages)) {
      if (ev.type === "trace") trace = ev.data;
      else send(ev);
    }
    const it = enrich(trace);
    let step;
    while (!(step = await it.next()).done) send(step.value);
    send({ type: "result", data: step.value });
  } catch (err) {
    req.log.error(err);
    send({ type: "error", message: err.message || "The request failed." });
  } finally {
    reply.raw.end();
  }
});

const port = Number(process.env.PORT);
if (!port) {
  console.error("PORT is not set in .env");
  process.exit(1);
}
await app.listen({ port, host: "0.0.0.0" });
await loadReferenceData();
const { missing, nearMisses } = missingConfig();
if (missing.length) console.warn("Missing in .env:", missing.map((m) => m.name).join(", "));
if (nearMisses.length) console.warn("These .env names have the wrong case and are ignored:", nearMisses.join(", "));

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await closeAgent();
    await app.close();
    process.exit(0);
  });
}
