import { z } from "zod";

// What the agent must return. Everything here must come from a tool result.
// Coordinates, distances, CO2 and the country-stability part of risk are NOT asked
// of the model; the server looks those up from public data after the agent finishes.

const Resource = z.object({
  id: z.string().describe("short slug, e.g. 'polysilicon'"),
  name: z.string(),
  hsCode: z.string().nullable().describe("HS code as it appears on the shipment records"),
});

const RiskSignal = z.object({
  source: z.enum(["tradeverifyd", "sayari"]),
  rating: z.string().describe("the rating exactly as the tool reported it, e.g. '72' or 'High'"),
  numericValue: z.number().nullable().describe("the rating as a number, if the tool gave a number"),
  scaleMin: z.number().nullable().describe("lowest possible value of that numeric scale, as documented by the tool"),
  scaleMax: z.number().nullable().describe("highest possible value of that numeric scale"),
  levelsLowToHigh: z
    .array(z.string())
    .nullable()
    .describe("if the rating is a level, every level the tool uses, ordered from least to most severe"),
  higherMeansRiskier: z.boolean().describe("true if a higher value or later level means more risk"),
  factors: z.array(z.string()).describe("the reasons the tool gave for this rating"),
});

const Node = z.object({
  id: z.string(),
  name: z.string().describe("entity name, or port / airport name, as it appears in the records"),
  role: z.enum(["company", "supplier", "processor", "origin", "port", "hub"]),
  resourceIds: z.array(z.string()),
  city: z.string().nullable().describe("city from the address or port record"),
  country: z.string().describe("country name from the record"),
  countryCode: z.string().nullable().describe("ISO 3166-1 alpha-2 code, as given in the record or looked up"),
  lat: z.number().nullable().describe("latitude, only if a tool or web source gave it; never guess"),
  lon: z.number().nullable().describe("longitude, only if a tool or web source gave it; never guess"),
  coordSource: z
    .enum(["tradeverifyd", "sayari", "web"])
    .nullable()
    .describe("where lat/lon came from; null if no coordinates"),
  coordSourceUrl: z.string().nullable().describe("the page the coordinates came from, when coordSource is 'web'"),
  riskSignals: z.array(RiskSignal).describe("one entry per risk rating a tool returned for this node; empty if none"),
  source: z.enum(["tradeverifyd", "sayari", "both"]),
});

const Flow = z.object({
  from: z.string().describe("node id"),
  to: z.string().describe("node id"),
  resourceId: z.string(),
  mode: z.enum(["sea", "air", "road", "rail"]),
  vesselType: z.string().nullable().describe("vessel or equipment type if the record states it, e.g. 'container ship', 'bulk carrier'"),
  tonnes: z.number().nullable().describe("total shipped weight in tonnes over the period, from the records"),
  declaredValue: z.number().nullable().describe("total declared customs value over the period, from the records"),
  currency: z.string().nullable().describe("ISO currency code of declaredValue"),
  reportedCo2Kg: z
    .number()
    .nullable()
    .describe("total emissions for these shipments in kg CO2e, only if Tradeverifyd reports them"),
  shipments: z.number().nullable(),
  period: z.string().nullable().describe("the date range these totals cover, e.g. '2025-09 to 2026-08'"),
});

export const TraceSchema = z.object({
  answer: z
    .string()
    .describe("Plain-language answer to the user's latest message, 2-6 sentences. Say which tool each key fact came from and what could not be found."),
  company: z.object({ name: z.string(), country: z.string().nullable() }),
  resources: z.array(Resource),
  nodes: z.array(Node),
  flows: z.array(Flow),
});
