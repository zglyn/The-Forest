# Scenario model: production, farm-gate value, GHG (farm + haul to first buyer), buyer concentration
suppressPackageStartupMessages({library(sf); library(dplyr); library(tidyr)})
hex    <- st_read("data/derived/hex.gpkg", quiet = TRUE)
buyers <- st_read("data/derived/buyers.gpkg", quiet = TRUE)
nass   <- readRDS("data/derived/nass.rds")
cm     <- read.csv("data/params/commodities.csv")
fx     <- read.csv("data/params/factors.csv"); f <- setNames(fx$value, fx$key)
stopifnot(abs(sum(cm$s2_share) - 1) < 1e-9)

# ---- Yields and prices (NASS, 2021-2025 means for yields; latest marketing year for prices) ----
sv <- nass$state
yld_state <- function(pat) sv |> filter(grepl(pat, short_desc), grepl("YIELD", short_desc)) |>
  group_by(level) |> summarise(v = mean(value, na.rm = TRUE)) |> arrange(level != "STATE") |> pull(v) |> first()
price <- function(pat) sv |> filter(grepl(pat, short_desc), grepl("PRICE", short_desc), period == "MARKETING YEAR") |>
  arrange(level != "STATE", desc(year)) |> slice(1)
yield_tbl <- c(oats = yld_state("^OATS"), wheat = yld_state("^WHEAT"), barley = yld_state("^BARLEY"),
               alfalfa = yld_state("^HAY, ALFALFA"), apples = yld_state("^APPLES"))
pr <- bind_rows(
  corn = price("^CORN, GRAIN"), soybeans = price("^SOYBEANS"), oats = price("^OATS"), wheat = price("^WHEAT"),
  barley = price("^BARLEY"), alfalfa = price("^HAY, ALFALFA"), apples = price("^APPLES"),
  cattle = price("^CATTLE, CALVES"), sheep = price("^WOOL"), .id = "commodity")
if (!"sheep" %in% pr$commodity) pr <- bind_rows(pr, sv |> filter(grepl("^WOOL", short_desc)) |> arrange(desc(year)) |> slice(1) |> mutate(commodity = "sheep"))
pr <- pr |> mutate(price_per_unit = ifelse(grepl("CWT", short_desc), value / 100, value),
                   price_source = paste0("NASS ", tolower(level), " ", year, " ", tolower(period)))
cm <- cm |> left_join(select(pr, commodity, price_per_unit, price_source), by = "commodity") |>
  mutate(price_per_unit = coalesce(price_assumed, price_per_unit),
         price_source = ifelse(!is.na(price_assumed), "USDA AMS Kalona auction (Sep 23 2026)", price_source))
cy <- nass$county_yield |> group_by(commodity, GEOID) |> summarise(y = mean(value), .groups = "drop")
cy_fill <- function(k, geo) { v <- cy$y[cy$commodity == k][match(geo, cy$GEOID[cy$commodity == k])]; ifelse(is.na(v), yld_state(if (k == "corn") "^CORN" else "^SOYBEANS"), v) }

# ---- Land by hex and scenario (only current corn + soybean pixels are in scope) ----
h <- st_drop_geometry(hex) |> mutate(ac_cs = ac_corn + ac_soybeans)
s1 <- bind_rows(transmute(h, hex_id, GEOID, commodity = "corn", acres = ac_corn),
                transmute(h, hex_id, GEOID, commodity = "soybeans", acres = ac_soybeans)) |> mutate(scenario = "S1")
s2 <- tidyr::crossing(h |> select(hex_id, GEOID, ac_cs), select(cm, commodity, s2_share)) |>
  transmute(hex_id, GEOID, commodity, acres = ac_cs * s2_share, scenario = "S2")
land <- bind_rows(s1, s2) |> left_join(cm, by = "commodity") |>
  mutate(yield = case_when(commodity %in% c("corn", "soybeans") ~ mapply(cy_fill, commodity, GEOID),
                           commodity %in% names(yield_tbl) ~ unname(yield_tbl[commodity]),
                           TRUE ~ head_per_ac * output_per_head),
         heads = ifelse(is.na(head_per_ac), 0, acres * head_per_ac),
         qty = acres * yield, tons = qty * lb_per_unit / 2000, value = qty * price_per_unit)

# ---- Farm emissions (kg CO2e) ----
n2o_per_kgN <- (f["ef1_direct"] + f["frac_gasf"] * f["ef4_volat"] + f["frac_leach"] * f["ef5_leach"]) * 44 / 28 * f["gwp_n2o"]
land <- land |> mutate(
  kgN = acres * n_rate_lb_ac * 0.453592,
  ghg_fert_n2o = kgN * n2o_per_kgN,
  ghg_enteric  = heads * case_when(commodity == "cattle" ~ f["enteric_cattle"], commodity == "sheep" ~ f["enteric_sheep"], commodity == "goats" ~ f["enteric_goats"], TRUE ~ 0) * f["gwp_ch4"],
  ghg_manure   = heads * case_when(commodity == "cattle" ~ f["manure_cattle"], commodity == "sheep" ~ f["manure_sheep"], commodity == "goats" ~ f["manure_goats"], TRUE ~ 0) * f["gwp_ch4"])

# ---- Huff allocation of each hex's output to eligible first buyers ----
bc <- st_transform(buyers, 5070); hc <- st_centroid(st_geometry(hex))
D <- st_distance(hc, bc) |> units::drop_units() / 1609.344 * f["circuity"]  # road miles
D <- pmax(D, 2); rownames(D) <- hex$hex_id; colnames(D) <- buyers$buyer_id
elig <- lapply(setNames(nm = unique(cm$buyer_key)), function(k) which(sapply(strsplit(buyers$commodities, ";"), function(x) k %in% x)))
truck_kg <- f["truck_co2"] + f["truck_ch4"] / 1000 * f["gwp_ch4"] + f["truck_n2o"] / 1000 * f["gwp_n2o"]
flows <- land |> filter(qty > 0) |> group_by(commodity, buyer_key) |> group_modify(function(d, k) {
  j <- elig[[k$buyer_key]]; Dj <- D[d$hex_id, j, drop = FALSE]
  W <- sweep(Dj^-f["huff_beta"], 2, buyers$attract[j], "*"); P <- W / rowSums(W)
  out <- data.frame(hex_id = rep(d$hex_id, times = length(j)), scenario = rep(d$scenario, times = length(j)),
                    buyer_id = rep(buyers$buyer_id[j], each = nrow(d)), p = as.vector(P), miles = as.vector(Dj),
                    tons = rep(d$tons, times = length(j)), value = rep(d$value, times = length(j)))
  out |> filter(p > 1e-4) |> mutate(tons = tons * p, value = value * p, ghg_transport = tons * miles * truck_kg)
}) |> ungroup() |> left_join(st_drop_geometry(buyers) |> select(buyer_id, buyer = name, parent, type, blat = lat, blon = long), by = "buyer_id")

# ---- Summaries ----
hhi <- function(v) { s <- v / sum(v) * 100; sum(s^2) }
by_comm <- land |> group_by(scenario, commodity, label, group) |>
  summarise(acres = sum(acres), qty = sum(qty), tons = sum(tons), value = sum(value), heads = sum(heads),
            ghg_fert_n2o = sum(ghg_fert_n2o), ghg_enteric = sum(ghg_enteric), ghg_manure = sum(ghg_manure), .groups = "drop") |>
  left_join(flows |> group_by(scenario, commodity) |> summarise(ghg_transport = sum(ghg_transport), ton_miles = sum(tons * miles), .groups = "drop"), by = c("scenario", "commodity"))
conc_parent <- flows |> group_by(scenario, parent) |> summarise(value = sum(value), .groups = "drop") |>
  group_by(scenario) |> mutate(share = value / sum(value)) |> arrange(scenario, desc(share)) |> ungroup()
conc_comm <- flows |> group_by(scenario, commodity, parent) |> summarise(tons = sum(tons), .groups = "drop") |>
  group_by(scenario, commodity) |> summarise(hhi = hhi(tons), n_buyers = n(), .groups = "drop")
kpi <- by_comm |> group_by(scenario) |> summarise(acres = sum(acres), value = sum(value),
  ghg_farm = sum(ghg_fert_n2o + ghg_enteric + ghg_manure), ghg_transport = sum(ghg_transport, na.rm = TRUE), .groups = "drop") |>
  left_join(conc_parent |> group_by(scenario) |> summarise(hhi = hhi(value), n_parents = n(), .groups = "drop"), by = "scenario") |>
  left_join(flows |> group_by(scenario) |> summarise(n_buyers = n_distinct(buyer_id)), by = "scenario") |>
  mutate(ghg_total = ghg_farm + ghg_transport, eff_buyers = 10000 / hhi)
hex_sum <- land |> group_by(scenario, hex_id) |> summarise(value = sum(value), ghg_farm = sum(ghg_fert_n2o + ghg_enteric + ghg_manure), acres = sum(acres), .groups = "drop") |>
  left_join(flows |> group_by(scenario, hex_id) |> summarise(ghg_transport = sum(ghg_transport), .groups = "drop"), by = c("scenario", "hex_id")) |>
  left_join(land |> group_by(scenario, hex_id) |> slice_max(acres, n = 1, with_ties = FALSE) |> select(scenario, hex_id, top = label), by = c("scenario", "hex_id"))
top_flow <- flows |> group_by(scenario, hex_id, buyer_id, buyer, parent, type, blat, blon) |> summarise(value = sum(value), tons = sum(tons), .groups = "drop") |>
  group_by(scenario, hex_id) |> slice_max(value, n = 1, with_ties = FALSE) |> ungroup()
buyer_sum <- flows |> group_by(scenario, buyer_id, buyer, parent, type, blat, blon) |>
  summarise(value = sum(value), tons = sum(tons), commodities = paste(sort(unique(commodity)), collapse = ", "), .groups = "drop")
big2 <- flows |> filter(parent %in% c("Cargill", "ADM")) |> left_join(select(h, hex_id, GEOID), by = "hex_id") |>
  group_by(scenario, hex_id, GEOID, commodity, buyer_id, buyer, parent, blat, blon) |>
  summarise(tons = sum(tons), value = sum(value), miles = weighted.mean(miles, tons), ghg_transport = sum(ghg_transport), .groups = "drop")
land_hex <- land |> select(scenario, hex_id, commodity, acres, heads, qty, value, ghg_fert_n2o, ghg_enteric, ghg_manure)
saveRDS(list(kpi = kpi, big2 = big2, land_hex = land_hex, by_comm = by_comm, conc_parent = conc_parent, conc_comm = conc_comm, hex_sum = hex_sum,
             top_flow = top_flow, buyer_sum = buyer_sum, cm = cm, factors = fx, n2o_per_kgN = unname(n2o_per_kgN),
             truck_kg = unname(truck_kg)), "data/derived/results.rds")
print(as.data.frame(kpi |> mutate(across(c(acres, value, ghg_farm, ghg_transport, ghg_total), ~ signif(.x, 4)))))
print(as.data.frame(by_comm |> transmute(scenario, commodity, acres = round(acres), value_M = round(value / 1e6, 1),
  farm_t = round((ghg_fert_n2o + ghg_enteric + ghg_manure) / 1000), trans_t = round(ghg_transport / 1000))))
print(select(cm, commodity, price_per_unit, price_source))
