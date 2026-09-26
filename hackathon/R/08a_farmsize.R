# Acre-weighted farm-size distribution in the shed (2022 Census of Agriculture, area operated classes)
suppressPackageStartupMessages({library(dplyr); library(sf); library(tidyr)})
if (!file.exists("data/raw/census2022_area_operated.rds")) {
  rnassqs::nassqs_auth(Sys.getenv("NASSQS_TOKEN"))
  saveRDS(rnassqs::nassqs(list(source_desc = "CENSUS", year = "2022", agg_level_desc = "COUNTY", state_alpha = "IA",
                               commodity_desc = "FARM OPERATIONS", domain_desc = "AREA OPERATED")) |> mutate(GEOID = paste0("19", county_ansi)),
          "data/raw/census2022_area_operated.rds")
}
d <- readRDS("data/raw/census2022_area_operated.rds")
cty <- st_read("data/derived/shed_counties.gpkg", quiet = TRUE) |> st_drop_geometry() |> select(GEOID, share_in_shed)
keep <- c("1.0 TO 9.9", "10.0 TO 49.9", "50.0 TO 69.9", "70.0 TO 99.9", "100 TO 139", "140 TO 179", "180 TO 219", "220 TO 259", "260 TO 499", "500 TO 999", "1,000 TO 1,999", "2,000 OR MORE")
x <- d |> mutate(cls = gsub("AREA OPERATED: [(]| ACRES[)]", "", domaincat_desc), v = suppressWarnings(as.numeric(gsub(",", "", Value)))) |>
  filter(cls %in% keep) |> left_join(cty, by = "GEOID") |>
  mutate(stat = ifelse(grepl("ACRES OPERATED", short_desc), "acres", "ops")) |>
  group_by(cls, stat) |> summarise(n_na = sum(is.na(v)), v = sum(v * share_in_shed, na.rm = TRUE), .groups = "drop") |>
  pivot_wider(names_from = stat, values_from = c(v, n_na))
x <- x[match(keep, x$cls), ] |> mutate(avg = v_acres / v_ops, acre_share = v_acres / sum(v_acres), cum = cumsum(acre_share))
saveRDS(x, "data/derived/farm_size_classes.rds"); print(as.data.frame(x |> mutate(across(where(is.numeric), ~ round(.x, 3)))))
