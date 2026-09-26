# Level-2 buyers: Tradeverifyd outbound trade relationships of the first-buyer companies, filtered to shed-commodity HS codes
import sys, json, time; sys.path.insert(0, "R"); import tv_client as tv
HS = {"1005": "Corn", "1201": "Soybeans", "1004": "Oats", "1104": "Worked grains (rolled oats)", "1108": "Starch", "1702": "Glucose / HFCS",
      "2207": "Ethanol", "2303": "Corn gluten feed / DDGS", "2304": "Soybean meal", "1507": "Soybean oil", "1515": "Corn oil (other veg. oils)",
      "2106": "Food preparations (soy protein)", "3505": "Modified starch", "2309": "Animal feed preparations"}
L1 = {"ADM": ["ef83a71f-8cd6-41e3-ad31-d4661984b070"],
      "Cargill": ["f10bfb12-80fa-4c59-90d8-5e1ed91595e8", "b20f037d-bd56-4114-845e-6e85a7cada47", "58574b3c-241c-4d0f-ba6e-ad2449173ca9",
                  "df16f4b0-34d7-4bf6-9c78-30b98ebe4eb5", "3509a3da-7bc5-4258-85ab-dfea5a36424e"],
      "Ingredion": ["a09a0258-4be9-4267-b125-ce0f3e85f7ef", "f4c88397-6fe1-43b6-b66d-41f3405449a1"],
      "Kent Corporation": ["03fd2edd-9354-4ff9-a177-ff15db43f893"],
      "PepsiCo": ["527acae7-72ba-4658-a8d7-140247183ec5"]}
tv.init(); edges = []
for parent, ids in L1.items():
    for eid in ids:
        page = 1
        while True:
            r = tv.call("entity_trade_relationships", entity_id=eid, direction="out", hs_codes=list(HS), page=page, page_size=100)
            for x in r.get("trade_relationships", []):
                hs4 = sorted({c[:4] for c in x["hs_codes"] if c[:4] in HS})
                edges.append({"l1_parent": parent, "l1_entity_id": eid, "l2_entity_id": x["related_entity_id"], "l2_name": x["related_entity_name"], "hs4": hs4})
            if page >= r.get("total_pages", 1): break
            page += 1
# Addresses for level-2 entities (first primary/any address)
addr = {}
for e in {x["l2_entity_id"] for x in edges}:
    try:
        a = tv.call("entity_addresses", entity_id=e, page_size=1).get("addresses", [])
        addr[e] = a[0] if a else {}
    except Exception as ex:
        addr[e] = {}
for x in edges:
    a = addr.get(x["l2_entity_id"], {})
    x.update({"city": a.get("city"), "state": a.get("state_province"), "country": a.get("jurisdiction")})
json.dump({"hs": HS, "level1_entities": L1, "edges": edges}, open("data/raw/tradeverifyd/level2.json", "w"), indent=1)
from collections import Counter
print(len(edges), "edges;", len(addr), "level-2 entities")
print(Counter(x["l1_parent"] for x in edges)); print(Counter(x["country"] for x in edges).most_common(12))
