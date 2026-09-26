# Download FEMA NFHL Special Flood Hazard Areas (SFHA_TF = 'T') intersecting the shed bounding box, paged GeoJSON
import json, urllib.request, urllib.parse, time
base = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"
feats, off = [], 0
while True:
    q = {"where": "SFHA_TF='T'", "geometry": "-92.65,41.25,-90.65,42.70", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
         "spatialRel": "esriSpatialRelIntersects", "outFields": "FLD_ZONE,ZONE_SUBTY", "outSR": 4326, "maxAllowableOffset": 0.0003,
         "resultOffset": off, "resultRecordCount": 1000, "f": "geojson"}
    req = urllib.request.Request(base + "?" + urllib.parse.urlencode(q), headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r: d = json.load(r); break
        except Exception as e:
            print("retry", off, e); time.sleep(5)
    f = d.get("features", []); feats += f; print(off, len(f), flush=True)
    if len(f) < 1000: break
    off += 1000
json.dump({"type": "FeatureCollection", "features": feats}, open("data/raw/fema/nfhl_sfha_shed.geojson", "w"))
print("total", len(feats))
