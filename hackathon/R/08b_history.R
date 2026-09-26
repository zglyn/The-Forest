# 20-year yield and price history (NASS) for revenue-risk simulation
suppressPackageStartupMessages({library(rnassqs); library(dplyr)})
nassqs_auth(Sys.getenv("NASSQS_TOKEN")); yrs <- as.character(2006:2025)
q <- function(sd, lvl, st = "IA", period = c("YEAR", "MARKETING YEAR")) tryCatch(
  nassqs(list(source_desc = "SURVEY", agg_level_desc = lvl, short_desc = sd, year = yrs, freq_desc = "ANNUAL", reference_period_desc = period,
              state_alpha = if (lvl == "STATE") st else "US")) |>
    transmute(year = as.integer(year), value = suppressWarnings(as.numeric(gsub(",", "", Value))), period = reference_period_desc),
  error = function(e) NULL)
spec <- tribble(~commodity, ~kind, ~sd, ~lvl,
  "corn", "yield", "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE", "STATE",
  "soybeans", "yield", "SOYBEANS - YIELD, MEASURED IN BU / ACRE", "STATE",
  "oats", "yield", "OATS - YIELD, MEASURED IN BU / ACRE", "STATE",
  "alfalfa", "yield", "HAY, ALFALFA - YIELD, MEASURED IN TONS / ACRE", "STATE",
  "wheat", "yield", "WHEAT - YIELD, MEASURED IN BU / ACRE", "NATIONAL",
  "barley", "yield", "BARLEY - YIELD, MEASURED IN BU / ACRE", "NATIONAL",
  "apples", "yield", "APPLES - YIELD, MEASURED IN LB / ACRE", "NATIONAL",
  "corn", "price", "CORN, GRAIN - PRICE RECEIVED, MEASURED IN $ / BU", "STATE",
  "soybeans", "price", "SOYBEANS - PRICE RECEIVED, MEASURED IN $ / BU", "STATE",
  "oats", "price", "OATS - PRICE RECEIVED, MEASURED IN $ / BU", "STATE",
  "alfalfa", "price", "HAY, ALFALFA - PRICE RECEIVED, MEASURED IN $ / TON", "STATE",
  "wheat", "price", "WHEAT - PRICE RECEIVED, MEASURED IN $ / BU", "NATIONAL",
  "barley", "price", "BARLEY - PRICE RECEIVED, MEASURED IN $ / BU", "NATIONAL",
  "apples", "price", "APPLES - PRICE RECEIVED, MEASURED IN $ / LB", "NATIONAL",
  "cattle", "price", "CATTLE, CALVES - PRICE RECEIVED, MEASURED IN $ / CWT", "NATIONAL",
  "sheep", "price", "WOOL - PRICE RECEIVED, MEASURED IN $ / LB", "STATE")
h <- bind_rows(lapply(seq_len(nrow(spec)), function(i) {
  d <- q(spec$sd[i], spec$lvl[i]); if (is.null(d) || !nrow(d)) { message("none: ", spec$sd[i]); return(NULL) }
  d <- d |> group_by(year) |> arrange(desc(period == "MARKETING YEAR")) |> slice(1) |> ungroup()   # prefer marketing-year prices
  mutate(d, commodity = spec$commodity[i], kind = spec$kind[i], level = spec$lvl[i]) }))
saveRDS(h, "data/derived/history.rds")
print(h |> group_by(commodity, kind, level) |> summarise(n = n(), first = min(year), last = max(year), .groups = "drop"), n = 30)
