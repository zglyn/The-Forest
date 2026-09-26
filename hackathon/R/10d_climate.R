# Climate-risk metrics by scenario: RMA weather loss costs x scenario output; flood-zone and storm exposure
suppressPackageStartupMessages({library(dplyr); library(tidyr)})
r <- readRDS("data/derived/results.rds"); rma <- readRDS("data/derived/rma_shed.rds"); ex <- readRDS("data/derived/exposure.rds")
lc <- rma$lc
# Barley's Iowa insured value is tiny (~$20k/yr): borrow oats' loss costs
lc <- bind_rows(filter(lc, commodity != "barley"), filter(lc, commodity == "oats") |> mutate(commodity = "barley", scope = "Iowa (oats proxy)"))
yrs <- 2006:2025
# Fill years without data (PRF began in Iowa ~2016) with the commodity's mean loss cost by cause
lcf <- lc |> group_by(commodity, g) |> mutate(lc_mean = sum(ind) / sum(liability)) |> ungroup() |>
  select(commodity, g, year, loss_cost, lc_mean, scope) |>
  complete(nesting(commodity, g, scope), year = yrs) |> group_by(commodity, g) |> mutate(lc_mean = first(na.omit(lc_mean)), filled = is.na(loss_cost), loss_cost = coalesce(loss_cost, lc_mean)) |> ungroup()
val <- r$by_comm |> select(scenario, commodity, label, group, value)
yr <- val |> inner_join(lcf, by = "commodity", relationship = "many-to-many") |> mutate(loss = value * loss_cost)
livestock <- c("cattle", "sheep", "goats")
summ <- function(d) d |> group_by(scenario, year) |> summarise(loss = sum(loss), .groups = "drop") |>
  group_by(scenario) |> summarise(exp_loss = mean(loss), sd = sd(loss), worst = max(loss), worst_year = year[which.max(loss)], .groups = "drop")
tot <- val |> group_by(scenario) |> summarise(gross = sum(value), covered = sum(value[commodity != "apples"]), .groups = "drop")
risk_all <- summ(yr) |> left_join(tot, by = "scenario") |> mutate(version = "All covered commodities")
risk_crop <- summ(filter(yr, !commodity %in% livestock)) |> left_join(val |> filter(!commodity %in% c(livestock, "apples")) |> group_by(scenario) |> summarise(gross = sum(value), covered = gross), by = "scenario") |> mutate(version = "Crops only (no pasture proxy)")
risk <- bind_rows(risk_all, risk_crop) |> mutate(pct = exp_loss / covered, cv = sd / exp_loss)
by_cause <- yr |> group_by(scenario, g) |> summarise(loss = sum(loss) / length(yrs), .groups = "drop")
by_comm  <- yr |> group_by(scenario, commodity, label, scope) |> summarise(value = first(value), loss = sum(loss) / length(yrs), .groups = "drop") |> mutate(lc = loss / value)
series   <- yr |> group_by(scenario, year) |> summarise(loss = sum(loss), .groups = "drop")
# Flood-zone exposure of production (value on SFHA acres) and of first buyers
hv <- r$hex_sum |> select(scenario, hex_id, value) |> left_join(ex$hexfz, by = "hex_id") |> mutate(fz_val = value * coalesce(fz_share, 0))
flood_fields <- hv |> group_by(scenario) |> summarise(fz_val = sum(fz_val), value = sum(value), .groups = "drop") |> mutate(share = fz_val / value)
flood_buyers <- r$buyer_sum |> left_join(ex$buyers |> select(buyer_id, in_sfha, near_sfha_250m, geocode), by = "buyer_id") |>
  group_by(scenario) |> summarise(in_sfha = sum(value[in_sfha]) / sum(value), near = sum(value[near_sfha_250m]) / sum(value), .groups = "drop")
saveRDS(list(risk = risk, by_cause = by_cause, by_comm = by_comm, series = series, lc = lcf, flood_fields = flood_fields, flood_buyers = flood_buyers), "data/derived/climate.rds")
print(as.data.frame(risk |> mutate(across(c(exp_loss, sd, worst, gross, covered), ~ round(.x / 1e6, 1)), pct = round(pct, 4), cv = round(cv, 2))))
print(as.data.frame(by_cause |> mutate(loss = round(loss / 1e6, 1)))); print(flood_fields); print(flood_buyers)
print(as.data.frame(by_comm |> filter(scenario == "S2") |> mutate(loss = round(loss / 1e6, 2), lc = round(lc, 3))))
