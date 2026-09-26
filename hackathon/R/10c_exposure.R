# Extreme-event exposure: FEMA flood zones (fields & first buyers) and NOAA Storm Events (shed counties), 2006-2025
suppressPackageStartupMessages({library(sf); library(terra); library(dplyr); library(exactextractr); library(data.table)})
sf_use_s2(FALSE)
shed <- st_read("data/derived/shed.gpkg", quiet = TRUE); hex <- st_read("data/derived/hex.gpkg", quiet = TRUE)
cty  <- st_read("data/derived/shed_counties.gpkg", quiet = TRUE)
fz <- st_read("data/raw/fema/nfhl_sfha_shed.geojson", quiet = TRUE) |> st_make_valid() |> st_collection_extract("POLYGON") |> st_transform(5070)
# County coverage check (unmapped counties would understate exposure)
cov <- cty |> mutate(n_sfha = lengths(st_intersects(st_geometry(cty), fz)))
# Corn+soy pixels inside SFHA, per hex
cdl <- rast("data/raw/CDL_2025_shed.tif")
fzr <- rasterize(vect(fz), cdl, field = 1, background = 0)
cs  <- (cdl == 1 | cdl == 5) * 1
hex$cs_px   <- exact_extract(cs, hex, "sum", progress = FALSE)
hex$fz_cs_px <- exact_extract(cs * fzr, hex, "sum", progress = FALSE)
hexfz <- st_drop_geometry(hex) |> transmute(hex_id, cs_ac = cs_px * 900 / 4046.856, fz_ac = fz_cs_px * 900 / 4046.856, fz_share = ifelse(cs_px > 0, fz_cs_px / cs_px, NA))
# First buyers in SFHA
b <- st_read("data/derived/buyers.gpkg", quiet = TRUE) |> st_transform(5070)
b$in_sfha <- lengths(st_intersects(b, fz)) > 0
b$near_sfha_250m <- lengths(st_is_within_distance(b, fz, 250)) > 0
bz <- st_drop_geometry(b) |> select(buyer_id, name, parent, type, city, geocode, in_sfha, near_sfha_250m)
# NOAA Storm Events (county and forecast-zone records matched by county name)
cn <- toupper(cty$NAME)
se <- rbindlist(lapply(Sys.glob("data/raw/noaa/StormEvents_details*.csv.gz"), function(f)
  fread(f, select = c("YEAR", "STATE", "CZ_TYPE", "CZ_NAME", "EVENT_TYPE", "DAMAGE_PROPERTY", "DAMAGE_CROPS", "BEGIN_DATE_TIME", "MAGNITUDE"))[STATE == "IOWA"]))
dmg <- function(x) { x <- toupper(trimws(x)); m <- c(K = 1e3, M = 1e6, B = 1e9)[substr(x, nchar(x), nchar(x))]
  v <- suppressWarnings(as.numeric(ifelse(is.na(m), x, substr(x, 1, nchar(x) - 1)))); v[is.na(v)] <- 0; ifelse(is.na(m), v, v * m) }
se <- se[toupper(CZ_NAME) %in% cn][, `:=`(dmg_crop = dmg(DAMAGE_CROPS), dmg_prop = dmg(DAMAGE_PROPERTY), county = tools::toTitleCase(tolower(CZ_NAME)))]
se[, hazard := fcase(EVENT_TYPE %in% c("Thunderstorm Wind", "High Wind", "Strong Wind"), "Damaging wind",
                     EVENT_TYPE == "Hail", "Hail", EVENT_TYPE == "Tornado", "Tornado",
                     EVENT_TYPE %in% c("Flood", "Flash Flood"), "Flood & flash flood",
                     EVENT_TYPE %in% c("Drought"), "Drought", EVENT_TYPE %in% c("Heat", "Excessive Heat"), "Heat", default = NA_character_)]
se <- se[!is.na(hazard)]
saveRDS(list(hexfz = hexfz, coverage = st_drop_geometry(cov) |> select(NAME, share_in_shed, n_sfha), buyers = bz, storms = as.data.frame(se)), "data/derived/exposure.rds")
cat("Corn/soy acres in SFHA:", round(sum(hexfz$fz_ac)), "of", round(sum(hexfz$cs_ac)), sprintf("(%.1f%%)\n", 100 * sum(hexfz$fz_ac) / sum(hexfz$cs_ac)))
print(st_drop_geometry(cov) |> select(NAME, n_sfha) |> arrange(n_sfha) |> head(5))
print(bz |> filter(in_sfha | near_sfha_250m) |> select(name, city, geocode, in_sfha, near_sfha_250m))
print(se[, .(events = .N, crop_M = round(sum(dmg_crop) / 1e6, 1), prop_M = round(sum(dmg_prop) / 1e6, 1)), by = hazard][order(-events)])
