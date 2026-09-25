// All settings come from .env. Nothing has a built-in fallback value:
// if something required is missing, the app says so and refuses to run a trace.

const REQUIRED = [
  ["MODEL", "model name from your OpenAI or Anthropic account"],
  ["TRADEVERIFYD_MCP_URL", "Tradeverifyd MCP server URL"],
  ["TRADEVERIFYD_API_KEY", "Tradeverifyd API key"],
  ["WORLD_BANK_API", "World Bank API base URL"],
];

export function env(name) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

export function missingConfig() {
  const missing = REQUIRED.filter(([k]) => !env(k)).map(([k, label]) => ({ name: k, label }));
  const llmKeys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"].filter(env);
  if (!llmKeys.length) missing.push({ name: "OPENAI_API_KEY (or ANTHROPIC_API_KEY)", label: "model provider key" });
  if (llmKeys.length > 1) missing.push({ name: "OPENAI_API_KEY or ANTHROPIC_API_KEY", label: "set only one of these, not both" });
  // Sayari: the REST API needs client credentials; the MCP route can also use SAYARI_API_KEY.
  const hasClientCreds = env("SAYARI_CLIENT_ID") && env("SAYARI_CLIENT_SECRET");
  if (!env("SAYARI_MCP_URL") && !hasClientCreds) {
    missing.push({ name: "SAYARI_CLIENT_ID + SAYARI_CLIENT_SECRET", label: "Sayari API credentials" });
  }
  if (env("SAYARI_MCP_URL") && !hasClientCreds && !env("SAYARI_API_KEY")) {
    missing.push({ name: "SAYARI_CLIENT_ID + SAYARI_CLIENT_SECRET (or SAYARI_API_KEY)", label: "Sayari credentials" });
  }
  if (hasClientCreds && !env("SAYARI_AUTH_URL")) {
    missing.push({ name: "SAYARI_AUTH_URL", label: "Sayari sign-in URL" });
  }
  // Catch the common mistake of a lower-case or mixed-case name in .env.
  const nearMisses = Object.keys(process.env).filter((k) => {
    const up = k.toUpperCase();
    const known = ["SAYARI_", "TAVILY_", "OPENAI_", "ANTHROPIC_", "TRADEVERIFYD_", "NOMINATIM_"];
    return k !== up && (REQUIRED.some(([r]) => r === up) || known.some((p) => up.startsWith(p)));
  });
  return { missing, nearMisses };
}

export function provider() {
  return env("OPENAI_API_KEY") ? "openai" : env("ANTHROPIC_API_KEY") ? "anthropic" : null;
}

export function optional() {
  return {
    tavily: Boolean(env("TAVILY_API_KEY")),
    osrm: Boolean(env("OSRM_URL")),
    geocoding: Boolean(env("NOMINATIM_URL") && env("NOMINATIM_EMAIL")),
    emissionFactors: Boolean(env("GOVUK_CONVERSION_FACTORS_COLLECTION")),
  };
}
