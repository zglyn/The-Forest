# Representative-farm economics (S1 vs S2) and hex-level change metrics
suppressPackageStartupMessages({library(dplyr); library(tidyr); library(sf)})
r   <- readRDS("data/derived/results.rds"); cm <- r$cm
fc  <- read.csv("data/params/farm_costs.csv")
his <- readRDS("data/derived/history.rds")
LAND <- 274; CROP_SHARE <- 0.85; ACCESS_MI <- 30
sizes <- tibble(farm = c("Small", "Median", "Large"), operated = c(362, 687, 1346)) |> mutate(acres = round(operated * CROP_SHARE))

# ---- Shed-average per-acre economics by commodity & scenario ----
tr <- r$by_comm |> transmute(scenario, commodity, trans_ac = ghg_transport / acres)
pa <- r$land_hex |> group_by(scenario, commodity) |>
  summarise(across(c(acres, heads, value, ghg_fert_n2o, ghg_enteric, ghg_manure), sum), .groups = "drop") |>
  left_join(fc, by = "commodity") |> left_join(tr, by = c("scenario", "commodity")) |>
  mutate(val_ac = value / acres, head_ac = heads / acres,
         cost_ac = coalesce(cost_per_acre_nonland, 0) + coalesce(cost_per_head_nonland, 0) * head_ac + coalesce(pasture_cost_per_acre, 0),
         ghg_ac = (ghg_fert_n2o + ghg_enteric + ghg_manure) / acres + trans_ac,
         share = acres / ave(acres, scenario, FUN = sum))

# ---- Buyer access: distinct buyer companies within 30 road miles, per hex & commodity ----
hex <- st_read("data/derived/hex.gpkg", quiet = TRUE); buyers <- st_read("data/derived/buyers.gpkg", quiet = TRUE)
D <- units::drop_units(st_distance(st_centroid(st_geometry(hex)), st_transform(st_geometry(buyers), 5070))) / 1609.344 * 1.3
keys <- setNames(cm$buyer_key, cm$commodity)
acc <- bind_rows(lapply(names(keys), function(k) {
  j <- which(sapply(strsplit(buyers$commodities, ";"), function(x) keys[[k]] %in% x))
  tibble(hex_id = hex$hex_id, commodity = k, n_co = apply(D[, j, drop = FALSE], 1, function(d) n_distinct(buyers$parent[j][d <= ACCESS_MI])))
}))

# ---- Hex-level change (option 3) ----
hx <- r$land_hex |> left_join(select(pa, scenario, commodity, cost_ac), by = c("scenario", "commodity")) |>
  left_join(acc, by = c("hex_id", "commodity")) |>
  group_by(scenario, hex_id) |>
  summarise(net = sum(value - acres * (cost_ac + LAND)), acres = sum(acres), val = sum(value),
            ghg = sum(ghg_fert_n2o + ghg_enteric + ghg_manure), access = ifelse(sum(value) > 0, weighted.mean(n_co, value), NA),
            thin = ifelse(sum(value) > 0, sum(value[n_co <= 2]) / sum(value), NA), .groups = "drop")
hxc <- hx |> pivot_wider(names_from = scenario, values_from = c(val, net, ghg, access, thin, acres)) |>
  filter(acres_S1 > 0) |>
  transmute(hex_id, acres = acres_S1, d_val_ac = (val_S2 - val_S1) / acres, d_net_ac = (net_S2 - net_S1) / acres,
            d_ghg_ac = (ghg_S2 - ghg_S1) / acres / 1000, access_S1, access_S2, d_access = access_S2 - access_S1, thin_S2)

# ---- Representative farms ----
med_acc <- acc |> group_by(commodity) |> summarise(n_co = median(n_co))
# Revenue index by year: detrended yield ratio x log-detrended price ratio (joint years keep correlations)
idx_series <- function(d, kind) { fit <- if (kind == "yield") lm(value ~ year, d) else lm(log(value) ~ year, d)
  d$ratio <- if (kind == "yield") d$value / fitted(fit) else exp(log(d$value) - fitted(fit)); select(d, year, ratio) }
ix <- his |> filter(!is.na(value)) |> group_by(commodity, kind) |> group_modify(~ idx_series(.x, .y$kind)) |> ungroup() |>
  select(commodity, kind, year, ratio) |> pivot_wider(names_from = kind, values_from = ratio) |>
  mutate(yield = coalesce(yield, 1))
goat <- ix |> filter(commodity == "cattle") |> mutate(commodity = "goats")          # goat prices proxied by calf-price index
ix <- bind_rows(ix, goat) |> mutate(rev_idx = yield * price)
years <- sort(Reduce(intersect, split(ix$year, ix$commodity)))
farm_year <- tidyr::crossing(sizes, scenario = c("S1", "S2"), year = years) |>
  left_join(select(pa, scenario, commodity, share, val_ac, cost_ac), by = "scenario", relationship = "many-to-many") |>
  left_join(select(ix, commodity, year, rev_idx), by = c("commodity", "year")) |>
  mutate(ac = acres * share, rev = ac * val_ac * rev_idx, cost = ac * cost_ac) |>
  group_by(farm, operated, acres, scenario, year) |> summarise(rev = sum(rev), cost = sum(cost), .groups = "drop") |>
  mutate(net = rev - cost - acres * LAND)
farm <- tidyr::crossing(sizes, scenario = c("S1", "S2")) |>
  left_join(pa |> select(scenario, commodity, share, val_ac, cost_ac, ghg_ac), by = "scenario", relationship = "many-to-many") |>
  left_join(med_acc, by = "commodity") |>
  mutate(ac = acres * share, rev = ac * val_ac, cost = ac * cost_ac, ghg = ac * ghg_ac) |>
  group_by(farm, operated, acres, scenario) |>
  summarise(n_enterprises = sum(ac > 0), gross = sum(rev), costs = sum(cost), ghg_t = sum(ghg) / 1000,
            rev_hhi = sum((rev / sum(rev) * 100)^2), buyers_30mi = weighted.mean(n_co, rev), thin_share = sum(rev[n_co <= 2]) / sum(rev), .groups = "drop") |>
  mutate(land = acres * LAND, ret_land = gross - costs, net = ret_land - land) |>
  left_join(farm_year |> group_by(farm, scenario) |> summarise(net_sd = sd(net), net_p05 = quantile(net, .05), net_worst = min(net),
                                                                 p_loss = mean(net < 0), .groups = "drop"), by = c("farm", "scenario"))
saveRDS(list(farm = farm, farm_year = farm_year, per_acre = pa, hexchg = hxc, sizes = sizes, years = range(years),
             params = list(land = LAND, crop_share = CROP_SHARE, access_mi = ACCESS_MI)), "data/derived/farms.rds")
print(as.data.frame(farm |> transmute(farm, scenario, acres, gross = round(gross), ret_land = round(ret_land), net = round(net), net_sd = round(net_sd), p_loss = round(p_loss, 2),
                                      ghg_t = round(ghg_t), rev_hhi = round(rev_hhi), buyers_30mi = round(buyers_30mi, 1), thin = round(thin_share, 2))))
print(as.data.frame(pa |> filter(scenario == "S2") |> transmute(commodity, val_ac = round(val_ac), cost_ac = round(cost_ac), net_ac = round(val_ac - cost_ac - LAND))))
cat("years:", range(years), "\n"); print(summary(hxc[, c("d_val_ac", "d_net_ac", "d_ghg_ac", "d_access")]))
