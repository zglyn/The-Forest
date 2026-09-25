// Sayari through its REST API (official @sayari/sdk), exposed as LangChain tools.
// Used when SAYARI_MCP_URL is empty. The SDK signs in with the client ID and
// secret and refreshes the token itself.
import { SayariClient, Sayari } from "@sayari/sdk";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { env } from "./config.js";

const MAX_CHARS = 15000; // keep one tool result from filling the model's context

// Sayari's risk levels, least to most severe. The SDK lists them most severe first.
const RISK_LEVELS_LOW_TO_HIGH = Object.values(Sayari.RiskLevel).reverse();

function client() {
  return new SayariClient({
    clientId: env("SAYARI_CLIENT_ID"),
    clientSecret: env("SAYARI_CLIENT_SECRET"),
    environment: env("SAYARI_AUTH_URL"),
  });
}

async function run(fn) {
  try {
    const out = JSON.stringify(await fn());
    return out.length > MAX_CHARS ? out.slice(0, MAX_CHARS) + " …[truncated]" : out;
  } catch (e) {
    const status = e.statusCode ? ` (${e.statusCode})` : "";
    return `Sayari error${status}: ${e.message}`; // returned to the model so it can try something else
  }
}

export function sayariApiTools() {
  const sayari = client();
  const levels = RISK_LEVELS_LOW_TO_HIGH.join(", ");
  return [
    tool(({ query, limit }) => run(() => sayari.search.searchEntity({ q: query, limit: limit ?? 5 })), {
      name: "sayari__search_entity",
      description: "Search Sayari for companies by name. Returns candidate entities with their Sayari ids, countries and addresses.",
      schema: z.object({ query: z.string(), limit: z.number().int().min(1).max(20).nullable() }),
    }),
    tool(({ id }) => run(() => sayari.entity.entitySummary(id)), {
      name: "sayari__entity_summary",
      description: `Profile of a Sayari entity: names, addresses, countries, identifiers and risk flags. Sayari risk levels, least to most severe: ${levels}.`,
      schema: z.object({ id: z.string().describe("Sayari entity id") }),
    }),
    tool(({ id }) => run(() => sayari.traversal.ubo(id, { limit: 20 })), {
      name: "sayari__beneficial_owners",
      description: "Ultimate beneficial owners of a Sayari entity, with the ownership path and any risk flags on the owners.",
      schema: z.object({ id: z.string() }),
    }),
    tool(
      ({ id, hsCodes, maxDepth }) =>
        run(() => sayari.supplyChain.upstreamTradeTraversal(id, { product: hsCodes ?? undefined, maxDepth: maxDepth ?? 2, limit: 25 })),
      {
        name: "sayari__upstream_suppliers",
        description: "Upstream supply chain of a Sayari entity from trade records: suppliers by tier, their countries, products (HS codes) and risk flags.",
        schema: z.object({
          id: z.string(),
          hsCodes: z.array(z.string()).nullable().describe("limit to these HS codes, e.g. ['7323']"),
          maxDepth: z.number().int().min(1).max(4).nullable(),
        }),
      }
    ),
    tool(({ query }) => run(() => sayari.trade.searchSuppliers({ q: query, limit: 10 })), {
      name: "sayari__search_suppliers",
      description: "Search Sayari trade data for suppliers by name or product description.",
      schema: z.object({ query: z.string() }),
    }),
  ];
}
