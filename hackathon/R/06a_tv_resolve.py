import json, sys; sys.path.insert(0, "R"); import tv_client as tv
tv.init()
queries = {"Cargill": ["Cargill Incorporated", "Cargill Inc", "Cargill"], "ADM": ["Archer Daniels Midland"], "Ingredion": ["Ingredion Incorporated", "Penford"],
           "PepsiCo (Quaker)": ["Quaker Oats Company", "PepsiCo Inc"], "POET": ["POET LLC", "POET Biorefining"], "Big River Resources": ["Big River Resources", "Big River United Energy"],
           "Kent Corporation (GPC)": ["Grain Processing Corporation"]}
out = {}
for co, qs in queries.items():
    cands = {}
    for q in qs:
        r = tv.call("search_entities", name=q, jurisdiction="US", limit=10)
        for e in r.get("results", []):
            cands[e["entity_id"]] = e
    rows = sorted(cands.values(), key=lambda e: -(e.get("direct_outbound_relationships", 0) + e.get("direct_inbound_relationships", 0)))
    out[co] = [{k: e.get(k) for k in ("entity_id", "name", "naics", "industry", "direct_outbound_relationships", "direct_inbound_relationships", "affiliate_relationship_count")}
               | {"alias_hit": any(w.lower() in " ".join(e.get("aliases", [])).lower() + " " + e["name"].lower() for w in [qs[0].split()[0]])} for e in rows[:6]]
json.dump(out, open("data/raw/tradeverifyd/resolve.json", "w"), indent=1)
for co, rows in out.items():
    print("==", co)
    for e in rows: print(f"  {e['entity_id']} | {e['name'][:45]:45} | out {e['direct_outbound_relationships']:>4} in {e['direct_inbound_relationships']:>4} | {str(e['industry'])[:40]} | hit={e['alias_hit']}")
