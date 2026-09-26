# Minimal JSON-RPC client for the Tradeverifyd MCP endpoint configured in .mcp.json
import json, urllib.request, sys, pathlib
cfg = json.load(open(pathlib.Path(__file__).resolve().parent.parent / ".mcp.json"))["mcpServers"]["tradeverifyd"]
URL, HDR = cfg["url"], dict(cfg["headers"], **{"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
_sid = None; _id = 0
def _post(payload):
    global _sid
    h = dict(HDR)
    if _sid: h["Mcp-Session-Id"] = _sid
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(), headers=h)
    with urllib.request.urlopen(req, timeout=120) as r:
        _sid = r.headers.get("Mcp-Session-Id", _sid); body = r.read().decode()
    if not body.strip(): return None
    if body.lstrip().startswith("{"): return json.loads(body)
    for line in body.splitlines():
        if line.startswith("data:"): return json.loads(line[5:])
def init():
    global _id; _id += 1
    _post({"jsonrpc": "2.0", "id": _id, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "supplyshed", "version": "1"}}})
    _post({"jsonrpc": "2.0", "method": "notifications/initialized"})
def call(tool, **args):
    global _id; _id += 1
    r = _post({"jsonrpc": "2.0", "id": _id, "method": "tools/call", "params": {"name": tool, "arguments": args}})
    if "error" in r: raise RuntimeError(r["error"])
    txt = "".join(c.get("text", "") for c in r["result"]["content"])
    try: return json.loads(txt)
    except Exception: return txt
if __name__ == "__main__":
    init(); print(json.dumps(call(sys.argv[1], **json.loads(sys.argv[2])))[:1500])
