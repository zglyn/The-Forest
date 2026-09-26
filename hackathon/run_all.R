# Rebuild everything: data pulls -> model -> Quarto HTML. Edit data/params/*.csv to change scenarios.
for (f in c("R/00_shed.R", "R/01_counties.R", "R/02_nass.R", "R/03a_warehouses.R", "R/03_buyers.R", "R/04_hex.R", "R/05_model.R")) {
  message("Running ", f); source(f, local = new.env())
}
# Level-2 buyers from Tradeverifyd (uses the API token in .mcp.json)
system("python3 R/06b_tv_level2.py"); source("R/06c_level2.R", local = new.env())
system("python3 R/07a_tv_tradeflow.py"); source("R/07c_tradeflow.R", local = new.env())
write.csv(sf::st_drop_geometry(sf::st_read("data/derived/buyers.gpkg", quiet = TRUE))[, c("buyer_id", "name", "parent", "type", "city", "state")], "data/derived/buyers_list.csv", row.names = FALSE)
system("python3 R/07b_tv_affiliates.py"); source("R/07d_affiliates.R", local = new.env())
for (f in c("R/08a_farmsize.R", "R/08b_history.R", "R/08c_farms.R")) source(f, local = new.env())   # representative farms
source("R/09_retention.R", local = new.env())   # value retained in the shed
# Climate risk (downloads: RMA colsom/sobcov ZIPs to data/raw/rma, NOAA Storm Events to data/raw/noaa)
source("R/10a_rma.R", local = new.env()); system("python3 R/10b_nfhl.py")
source("R/10c_exposure.R", local = new.env()); source("R/10d_climate.R", local = new.env())
system("quarto render supplyshed_scenarios.qmd")
