# National export destinations for shed-derived products (UN Comtrade via Tradeverifyd tia_trade_flow)
import sys, json; sys.path.insert(0, "R"); import tv_client as tv
HS6 = {"100590": "Corn (maize)", "120190": "Soybeans", "230400": "Soybean meal", "150790": "Soybean oil",
       "220720": "Fuel ethanol (denatured)", "230330": "DDGS / brewing & distilling residues", "110812": "Corn starch",
       "170230": "Glucose & glucose syrup", "100490": "Oats"}
tv.init(); raw = {}
for hs in HS6:
    raw[hs] = tv.call("tia_trade_flow", hs_code=hs, reporter="USA", years=5)
json.dump({"hs6": HS6, "raw": raw}, open("data/raw/tradeverifyd/trade_flow_usa.json", "w"))
for hs, r in raw.items():
    if not isinstance(r, dict): print(hs, "non-JSON:", str(r)[:120]); continue
    f = r.get("flows", []); dirs = sorted({x["flow_direction"] for x in f}); yrs = sorted({x["year"] for x in f})
    exp = [x for x in f if x["flow_direction"] == "export"]
    print(hs, HS6[hs][:22].ljust(22), "years", yrs, "| flows", len(f), "| export partners", len({x["partner_country"] for x in exp}),
          "| export $B", round(sum(x["trade_value_usd"] for x in exp) / 1e9, 2), "| dirs", dirs, "| qty?", any(x.get("quantity") for x in f))
