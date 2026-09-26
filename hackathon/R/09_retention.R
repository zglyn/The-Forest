# Economic value retained in the supply shed: farm-gate sales minus spending that leaks outside the shed,
# plus the share of sales going to locally owned first buyers.
suppressPackageStartupMessages({library(dplyr); library(tidyr); library(sf)})
r  <- readRDS("data/derived/results.rds"); fm <- readRDS("data/derived/farms.rds")
ls <- read.csv("data/params/local_shares.csv"); own <- read.csv("data/params/buyer_ownership.csv")
LAND <- fm$params$land
# ---- ERS cost-category shares (2025) mapped to local-share categories ----
map <- c("Seed" = "Seed", "Fertilizer" = "Fertilizer", "Chemicals" = "Chemicals", "Fuel, lube, and electricity" = "Fuel & energy",
         "Repairs" = "Repairs", "Capital recovery of machinery and equipment" = "Machinery ownership", "Custom services" = "Custom services",
         "Hired labor" = "Hired labor", "Opportunity cost of unpaid labor" = "Operator labor", "Interest on operating capital" = "Interest",
         "Interest on operating inputs" = "Interest", "Taxes and insurance" = "Taxes & insurance", "General farm overhead" = "General overhead",
         "Purchased feed" = "Purchased feed", "Homegrown harvested feed" = "Homegrown & grazed feed", "Grazed feed" = "Homegrown & grazed feed",
         "Veterinary and medicine" = "Veterinary & medicine", "Marketing" = "Marketing & packaging", "Bedding and litter" = "Other",
         "Cattle for backgrounding" = "Other", "Other variable expenses" = "Other", "Purchased irrigation water" = "Other")
ers_src <- c(corn = "corn", soybeans = "soybeans", oats = "oats", wheat = "wheat", barley = "barley", alfalfa = "oats",
             cattle = "cow-calf", sheep = "cow-calf", goats = "cow-calf")
reg <- c(corn = "Heartland", soybeans = "Heartland", oats = "Heartland", wheat = "Heartland", barley = "Northern Crescent", "cow-calf" = "Heartland")
shares <- bind_rows(lapply(unique(ers_src), function(f) read.csv(file.path("data/raw/ers", paste0(f, ".csv"))) |>
    filter(Year == max(Year), Region == reg[[f]], trimws(Item) %in% names(map), !is.na(Value)) |>
    transmute(ers = f, category = unname(map[trimws(Item)]), v = Value))) |>
  filter(!(ers == "cow-calf" & category == "Homegrown & grazed feed" & FALSE)) |>
  group_by(ers, category) |> summarise(v = sum(v), .groups = "drop") |> group_by(ers) |> mutate(share = v / sum(v)) |> ungroup()
shares <- bind_rows(lapply(names(ers_src), function(k) filter(shares, ers == ers_src[[k]]) |> mutate(commodity = k)),
  # Apples: approximate category split of the Univ. of Missouri G712 full-production budget
  tibble(commodity = "apples", category = c("Operator labor", "Chemicals", "Fertilizer", "Machinery ownership", "Marketing & packaging", "Fuel & energy", "Interest", "Taxes & insurance", "Other"),
         share = c(0.25, 0.07, 0.02, 0.30, 0.15, 0.04, 0.11, 0.04, 0.02)))
# ---- Per-acre cost by category, retained and leaked ----
pa <- fm$per_acre |> select(scenario, commodity, acres, value, val_ac, cost_ac)
cat_ac <- pa |> left_join(select(shares, commodity, category, share), by = "commodity", relationship = "many-to-many") |>
  mutate(cost = acres * cost_ac * share) |> select(scenario, commodity, category, cost) |>
  bind_rows(pa |> transmute(scenario, commodity, category = "Land", cost = acres * LAND)) |>
  left_join(ls, by = "category")
leak <- cat_ac |> group_by(scenario, group) |> summarise(leak = sum(cost * (1 - local_share)), leak_lo = sum(cost * (1 - high)), leak_hi = sum(cost * (1 - low)), .groups = "drop")
tot <- pa |> group_by(scenario) |> summarise(gross = sum(value), acres = sum(acres), .groups = "drop") |>
  left_join(leak |> group_by(scenario) |> summarise(across(c(leak, leak_lo, leak_hi), sum)), by = "scenario") |>
  mutate(retained = gross - leak, retained_lo = gross - leak_hi, retained_hi = gross - leak_lo, pct = retained / gross, per_ac = retained / acres)
by_comm <- cat_ac |> group_by(scenario, commodity) |> summarise(leak = sum(cost * (1 - local_share)), .groups = "drop") |>
  left_join(select(pa, scenario, commodity, value, acres), by = c("scenario", "commodity")) |> mutate(retained = value - leak)
# ---- First-buyer ownership ----
b <- st_read("data/derived/buyers.gpkg", quiet = TRUE) |> st_drop_geometry()
b$ownership <- sapply(seq_len(nrow(b)), function(i) { k <- which(sapply(own$parent_pattern, function(p) grepl(p, b$parent[i]) || grepl(p, b$name[i])))[1]; own$ownership[k] })
b$hq <- sapply(seq_len(nrow(b)), function(i) { k <- which(sapply(own$parent_pattern, function(p) grepl(p, b$parent[i]) || grepl(p, b$name[i])))[1]; own$hq[k] })
fb <- r$buyer_sum |> left_join(select(b, buyer_id, ownership, hq), by = "buyer_id") |>
  group_by(scenario, ownership) |> summarise(value = sum(value), .groups = "drop") |> group_by(scenario) |> mutate(share = value / sum(value)) |> ungroup()
saveRDS(list(total = tot, leak = leak, by_comm = by_comm, first_buyer = fb, buyers_own = select(b, name, parent, type, ownership, hq)), "data/derived/retention.rds")
print(as.data.frame(tot |> mutate(across(c(gross, leak, retained, retained_lo, retained_hi), ~ round(.x / 1e6)), pct = round(pct, 3), per_ac = round(per_ac))))
print(as.data.frame(leak |> mutate(across(starts_with("leak"), ~ round(.x / 1e6)))))
print(as.data.frame(fb |> mutate(value = round(value / 1e6), share = round(share, 3))))
