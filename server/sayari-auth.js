// Bearer token for the Sayari MCP server.
// With SAYARI_CLIENT_ID / SECRET, exchanges them for a token using Sayari's
// OAuth client-credentials endpoint (tokens last 24 h). Otherwise uses SAYARI_API_KEY as-is.
import { env } from "./config.js";

let token = null;
let expires = 0;

export async function sayariToken() {
  if (!env("SAYARI_CLIENT_ID")) return { token: env("SAYARI_API_KEY"), expires: Infinity };
  if (token && Date.now() < expires) return { token, expires };
  if (!env("SAYARI_AUTH_URL")) throw new Error("SAYARI_AUTH_URL is not set.");
  const url = new URL("/oauth/token", env("SAYARI_AUTH_URL"));
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env("SAYARI_CLIENT_ID"),
      client_secret: env("SAYARI_CLIENT_SECRET"),
      audience: "sayari.com",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Sayari sign-in failed (${res.status}). Check SAYARI_CLIENT_ID and SAYARI_CLIENT_SECRET.`);
  const j = await res.json();
  token = j.access_token;
  expires = Date.now() + (j.expires_in - 300) * 1000;
  return { token, expires };
}
