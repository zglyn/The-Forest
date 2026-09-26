# Ownership structure: subsidiaries of first-buyer companies, and parents of in-shed first buyers (Tradeverifyd affiliates)
import sys, json, re, csv; sys.path.insert(0, "R"); import tv_client as tv
ROOTS = {"ADM": ["ef83a71f-8cd6-41e3-ad31-d4661984b070"],
         "Cargill": ["8ca03db7-bc8b-4c84-9308-2a32e3e0959e", "54e2d42b-b36e-4cec-8e6f-67bffe40dffb", "1d6c3f2b-06ad-475b-9628-6855c00c474a", "f10bfb12-80fa-4c59-90d8-5e1ed91595e8"],
         "Ingredion": ["a09a0258-4be9-4267-b125-ce0f3e85f7ef"], "Kent Corporation": ["03fd2edd-9354-4ff9-a177-ff15db43f893"],
         "Big River Resources": ["dadfbe75-641d-46d1-b724-c48549a38f4f"], "POET": ["e01c0443-7302-4d35-a404-db9899b5829e"]}
tv.init()
def pages(tool, **kw):
    out, p = [], 1
    while True:
        r = tv.call(tool, page=p, page_size=100, **kw); out += r.get("affiliate_relationships", [])
        if p >= r.get("total_pages", 1) or p >= 5: return out
        p += 1
def addr(eid):
    try:
        a = tv.call("entity_addresses", entity_id=eid, page_size=1).get("addresses", []); return a[0] if a else {}
    except Exception: return {}
subs, seen = [], set()
for parent, ids in ROOTS.items():
    for rid in ids:
        for x in pages("entity_affiliate_relationships", entity_id=rid, direction="out"):
            k = (parent, x["related_entity_id"])
            if k in seen: continue
            seen.add(k); a = addr(x["related_entity_id"])
            subs.append({"root_parent": parent, "root_entity_id": rid, "entity_id": x["related_entity_id"], "name": x["related_entity_name"],
                         "rel": x["relationship_type"], "city": a.get("city"), "state": a.get("state_province"), "country": a.get("jurisdiction")})
# In-shed first buyers: resolve and look up parents
norm = lambda s: re.sub(r"[^a-z0-9]", "", re.sub(r"\b(inc|llc|l l c|co|company|corporation|corp|ltd|cooperative|co-operative)\b\.?", "", s.lower()))
buyers = list(csv.DictReader(open("data/derived/buyers_list.csv")))
shed = []
for b in buyers:
    r = tv.call("search_entities", name=b["name"], jurisdiction="US", limit=5)
    hit = None
    for e in r.get("results", []):
        names = [e["name"]] + e.get("aliases", [])
        if any(norm(n) == norm(b["name"]) for n in names):
            a = tv.call("entity_addresses", entity_id=e["entity_id"], state_province="IA", page_size=1)
            if a.get("total_records", 0) > 0: hit = e; break
    rec = {"buyer": b["name"], "buyer_parent_model": b["parent"], "type": b["type"], "entity_id": hit["entity_id"] if hit else None,
           "tv_name": hit["name"] if hit else None, "parents": []}
    if hit:
        rec["parents"] = [{"entity_id": p["related_entity_id"], "name": p["related_entity_name"], "rel": p["relationship_type"]}
                          for p in pages("entity_affiliate_relationships", entity_id=hit["entity_id"], direction="in")]
    shed.append(rec)
json.dump({"roots": ROOTS, "subsidiaries": subs, "shed_buyers": shed}, open("data/raw/tradeverifyd/affiliates.json", "w"), indent=1)
from collections import Counter
print("subsidiaries:", Counter(s["root_parent"] for s in subs))
print("sub countries:", Counter(s["country"] for s in subs).most_common(10))
print("shed buyers matched:", sum(1 for s in shed if s["entity_id"]), "of", len(shed), "| with parents:", sum(1 for s in shed if s["parents"]))
for s in shed:
    if s["parents"]: print("  ", s["buyer"], "->", [p["name"] for p in s["parents"]][:4])
