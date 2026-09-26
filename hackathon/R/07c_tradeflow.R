# Tidy UN Comtrade export flows (Tradeverifyd tia_trade_flow): US exports of shed-derived products, by partner
suppressPackageStartupMessages({library(dplyr); library(jsonlite)})
j <- fromJSON("data/raw/tradeverifyd/trade_flow_usa.json", simplifyVector = FALSE)
tf <- bind_rows(lapply(names(j$raw), function(hs) bind_rows(lapply(j$raw[[hs]]$flows, function(x)
  tibble(hs6 = hs, product = j$hs6[[hs]], partner = x$partner_country, year = x$year, flow = x$flow_direction, value = x$trade_value_usd))))) |>
  filter(flow == "export") |> group_by(hs6, product, partner, year) |> summarise(value = sum(value), .groups = "drop") |>
  mutate(group = ifelse(hs6 %in% c("120190", "230400", "150790"), "Soy & soy products", ifelse(hs6 == "100490", "Oats", "Corn & corn products")))
ctr <- tibble(partner = c("China", "Mexico", "Japan", "Rep. of Korea"), partner_lab = c("China", "Mexico", "Japan", "South Korea"),
              lat = c(35.0, 23.6, 36.2, 36.5), lon = c(104.2, -102.5, 138.3, 127.9))   # approximate country centroids
tf <- left_join(tf, ctr, by = "partner")
saveRDS(tf, "data/derived/tradeflow.rds")
print(tf |> group_by(partner_lab) |> summarise(B = round(sum(value) / 1e9, 2)) |> arrange(-B))
