suppressPackageStartupMessages({library(rnassqs); library(dplyr); library(sf)})
nassqs_auth(Sys.getenv("NASSQS_TOKEN"))
cty <- st_read("data/derived/shed_counties.gpkg", quiet = TRUE) |> st_drop_geometry()
q <- function(...) tryCatch(nassqs(list(...)), error = function(e) {message("NASS: ", conditionMessage(e)); NULL})
yrs <- as.character(2021:2025)
# County yields (survey) for crops with county estimates
yl <- list(
  corn     = "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE",
  soybeans = "SOYBEANS - YIELD, MEASURED IN BU / ACRE",
  oats     = "OATS - YIELD, MEASURED IN BU / ACRE",
  alfalfa  = "HAY, ALFALFA - YIELD, MEASURED IN TONS / ACRE")
cy <- bind_rows(lapply(names(yl), function(k) {
  d <- q(source_desc = "SURVEY", agg_level_desc = "COUNTY", state_alpha = "IA", short_desc = yl[[k]], year = yrs)
  if (is.null(d)) return(NULL)
  d |> transmute(commodity = k, year = as.integer(year), GEOID = paste0("19", county_ansi), value = as.numeric(gsub(",", "", Value)))
}))
cy <- filter(cy, GEOID %in% cty$GEOID, !is.na(value))
# State yields and prices received
st_items <- c(
  "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE", "SOYBEANS - YIELD, MEASURED IN BU / ACRE",
  "OATS - YIELD, MEASURED IN BU / ACRE", "WHEAT - YIELD, MEASURED IN BU / ACRE",
  "BARLEY - YIELD, MEASURED IN BU / ACRE", "HAY, ALFALFA - YIELD, MEASURED IN TONS / ACRE",
  "CORN, GRAIN - PRICE RECEIVED, MEASURED IN $ / BU", "SOYBEANS - PRICE RECEIVED, MEASURED IN $ / BU",
  "OATS - PRICE RECEIVED, MEASURED IN $ / BU", "WHEAT - PRICE RECEIVED, MEASURED IN $ / BU",
  "BARLEY - PRICE RECEIVED, MEASURED IN $ / BU", "HAY, ALFALFA - PRICE RECEIVED, MEASURED IN $ / TON",
  "CATTLE, CALVES - PRICE RECEIVED, MEASURED IN $ / CWT", "CATTLE, STEERS & HEIFERS, GE 500 LBS - PRICE RECEIVED, MEASURED IN $ / CWT",
  "SHEEP, INCL LAMBS, WOOL - PRICE RECEIVED, MEASURED IN $ / LB", "WOOL - PRICE RECEIVED, MEASURED IN $ / LB",
  "GOATS, MEAT & OTHER - PRICE RECEIVED, MEASURED IN $ / HEAD",
  "APPLES - PRICE RECEIVED, MEASURED IN $ / LB", "APPLES - YIELD, MEASURED IN LB / ACRE")
sv <- bind_rows(lapply(st_items, function(s) {
  for (lvl in c("STATE", "NATIONAL")) {
    d <- q(source_desc = "SURVEY", agg_level_desc = lvl, short_desc = s, year = yrs,
           state_alpha = if (lvl == "STATE") "IA" else "US", freq_desc = "ANNUAL", reference_period_desc = c("YEAR", "MARKETING YEAR"))
    if (!is.null(d) && nrow(d)) return(d |> transmute(level = lvl, short_desc, year = as.integer(year),
      period = reference_period_desc, value = suppressWarnings(as.numeric(gsub(",", "", Value)))))
  }
  message("none: ", s); NULL
}))
saveRDS(list(county_yield = cy, state = sv), "data/derived/nass.rds")
print(cy |> group_by(commodity, year) |> summarise(n = n(), mean = round(mean(value), 1), .groups = "drop") |> tail(12))
print(sv |> group_by(level, short_desc) |> slice_max(year, n = 1, with_ties = FALSE) |> as.data.frame())
