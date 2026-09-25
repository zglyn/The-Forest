import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { TavilySearch } from "@langchain/tavily";
import { createAgent, toolStrategy } from "langchain";
import { TraceSchema } from "./schema.js";
import { env, provider } from "./config.js";
import { sayariToken } from "./sayari-auth.js";
import { sayariApiTools } from "./sayari-tools.js";

const SYSTEM_PROMPT = `You are a supply-chain analyst. Your tools:
- Tradeverifyd (names start with "tradeverifyd__"): bills of lading, customs and shipment records.
- Sayari (names start with "sayari__"): corporate ownership, trade-network graph and risk flags.
- Web search (tavily_search), if available: only to fill gaps the two data tools can't, such as the coordinates or city of a port or facility. Never use it for shipment volumes, values, emissions or risk ratings.

When the user asks about a company:
1. In Tradeverifyd, find the company's inbound shipments and list the resources it buys.
2. For each major resource, find the suppliers, the ports of loading and discharge, the transport mode, and the totals the records give: weight in tonnes, declared value and its currency, number of shipments, and the date range.
3. Resolve each supplier in Sayari and go upstream one or two tiers where the data allows.
4. Return every entity and port as a node (with the city and country from its record) and every movement as a flow.

Locations: every node needs coordinates to appear on the map. Use coordinates from the Tradeverifyd or Sayari record if it has them. Otherwise, if web search is available, search for the exact port, airport or facility and take coordinates from a reliable page (port authority, the company's site, a gazetteer), and give that page as coordSourceUrl. If you can't find coordinates for the specific place, leave lat and lon null. Don't use a city or country centre in place of a site.

Emissions: if Tradeverifyd reports CO2 or emissions for shipments, put the total in reportedCo2Kg. Otherwise leave it null.

Risk: for each node, copy every risk rating Tradeverifyd or Sayari returned into riskSignals, exactly as the tool gave it, together with the scale or the full list of levels the tool uses. If the tool doesn't document its scale, use its tool description or ask it; if you still can't tell, leave the scale fields null.

Rules:
- Report only what the tools returned. Use null for anything they didn't give. Never estimate weights, values, coordinates or scores, and never invent suppliers.
- For follow-up questions, answer the question and return the full, updated trace.
- Keep the answer short and concrete.`;

let built = null; // { agent, client, toolNames, expires }

async function build() {
  // Tradeverifyd always via MCP. Sayari via MCP if SAYARI_MCP_URL is set, otherwise via its REST API.
  const useSayariMcp = Boolean(env("SAYARI_MCP_URL"));
  const sayari = useSayariMcp ? await sayariToken() : { expires: Infinity };
  const mcpServers = {
    tradeverifyd: {
      transport: "http",
      url: env("TRADEVERIFYD_MCP_URL"),
      headers: { Authorization: `Bearer ${env("TRADEVERIFYD_API_KEY")}` },
    },
  };
  if (useSayariMcp) {
    mcpServers.sayari = {
      transport: "http",
      url: env("SAYARI_MCP_URL"),
      headers: { Authorization: `Bearer ${sayari.token}` },
    };
  }
  const client = new MultiServerMCPClient({
    mcpServers,
    prefixToolNameWithServerName: true,
    throwOnLoadError: true, // fail loudly if a data source can't load
  });
  const tools = await client.getTools();
  if (!useSayariMcp) tools.push(...sayariApiTools());
  if (env("TAVILY_API_KEY")) tools.push(new TavilySearch({ maxResults: 5, tavilyApiKey: env("TAVILY_API_KEY") }));
  console.log(`[agent] ${provider()} model ${env("MODEL")}; Sayari via ${useSayariMcp ? "MCP" : "API"}`);
  console.log(`[agent] ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);

  const agent = createAgent({
    model:
      provider() === "openai"
        ? new ChatOpenAI({ model: env("MODEL"), apiKey: env("OPENAI_API_KEY") })
        : new ChatAnthropic({ model: env("MODEL"), apiKey: env("ANTHROPIC_API_KEY"), maxTokens: 16000 }),
    tools,
    systemPrompt: SYSTEM_PROMPT,
    // The trace comes back as a final tool call. The alternative (OpenAI's native JSON
    // schema mode) forces "strict" on every tool, which OpenAI then rejects for MCP tools
    // that have optional parameters, like Tradeverifyd's search_entities.
    responseFormat: toolStrategy(TraceSchema),
  });
  return { agent, client, toolNames: new Set(tools.map((t) => t.name)), expires: sayari.expires };
}

async function getAgent() {
  if (built && Date.now() < built.expires) return built;
  await built?.client.close().catch(() => {});
  built = await build(); // rebuilt when the Sayari token expires
  return built;
}

const serverOf = (name) =>
  name.startsWith("tradeverifyd__") ? "tradeverifyd" : name.startsWith("sayari__") ? "sayari" : name.startsWith("tavily") ? "web" : "other";

/** Yields { type: "tool", ... } for each tool call, then { type: "trace", data }. */
export async function* runAgent(messages) {
  const { agent, toolNames } = await getAgent();
  const stream = await agent.stream({ messages }, { streamMode: "values", recursionLimit: 80 });
  const seen = new Set();
  let last;
  for await (const state of stream) {
    last = state;
    for (const m of state.messages ?? []) {
      for (const call of m.tool_calls ?? []) {
        if (!call.id || seen.has(call.id) || !toolNames.has(call.name)) continue;
        seen.add(call.id);
        yield { type: "tool", server: serverOf(call.name), name: call.name.replace(/^[a-z]+__/, ""), args: call.args };
      }
    }
  }
  if (!last?.structuredResponse) throw new Error("The agent finished without returning a trace.");
  yield { type: "trace", data: last.structuredResponse };
}

export async function closeAgent() {
  await built?.client.close().catch(() => {});
}
