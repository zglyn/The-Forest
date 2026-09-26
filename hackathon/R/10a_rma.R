# RMA cause-of-loss (indemnities by cause) and Summary of Business (liability, acres) for shed counties, 2006-2025
suppressPackageStartupMessages({library(dplyr); library(sf); library(data.table)})
cty <- st_read("data/derived/shed_counties.gpkg", quiet = TRUE) |> st_drop_geometry() |> select(GEOID, share_in_shed)
rd <- function(f, cols, names) { x <- fread(cmd = paste("unzip -p", f), sep = "|", header = FALSE, quote = "", select = cols, col.names = names,
                                            colClasses = "character", fill = TRUE); x[x$st == "19", ] }
col <- rbindlist(lapply(Sys.glob("data/raw/rma/colsom_*.zip"), function(f)
  rd(f, c(1, 2, 4, 7, 12, 13, 14, 29), c("year", "st", "cty", "crop", "cause_code", "cause", "month", "indemnity"))))
sob <- rbindlist(lapply(Sys.glob("data/raw/rma/sobcov_*.zip"), function(f)
  rd(f, c(1, 2, 4, 7, 18, 19, 21, 27), c("year", "st", "cty", "crop", "qtype", "acres", "liability", "indemnity"))))
fix <- function(d) d |> mutate(GEOID = paste0("19", trimws(cty)), crop = trimws(tools::toTitleCase(tolower(trimws(crop)))), year = as.integer(year)) |>
  left_join(cty, by = "GEOID") |> mutate(share_in_shed = coalesce(share_in_shed, 0))
col <- fix(col) |> mutate(indemnity = as.numeric(indemnity), cause = trimws(cause))
sob <- fix(sob) |> mutate(across(c(acres, liability, indemnity), as.numeric))
saveRDS(list(col = col, sob = sob), "data/derived/rma_shed.rds")

# ---- Loss cost by crop-year: climate-cause indemnity / liability (shed for corn & soybeans; Iowa statewide for minor crops) ----
climate <- c("Drought", "Heat", "Hot Wind", "Excess Moisture/Precipitation/Rain", "Flood", "Wind/Excess Wind", "Hail", "Cold Wet Weather",
             "Frost", "Freeze", "Cold Winter", "Tornado", "Other (Snow, Lightning, Etc.)", "Cyclone", "Excess Sun")
grp <- function(cause) case_when(cause %in% c("Drought", "Heat", "Hot Wind", "Excess Sun") ~ "Drought & heat",
                                 cause %in% c("Excess Moisture/Precipitation/Rain", "Flood", "Cold Wet Weather") ~ "Excess moisture & flood",
                                 cause %in% c("Wind/Excess Wind", "Hail", "Tornado", "Cyclone", "Other (Snow, Lightning, Etc.)") ~ "Wind, hail & storms",
                                 cause %in% c("Frost", "Freeze", "Cold Winter") ~ "Frost & freeze", TRUE ~ NA_character_)
map <- tibble(commodity = c("corn", "soybeans", "oats", "wheat", "barley", "alfalfa", "cattle", "sheep", "goats", "apples"),
              crop = c("Corn", "Soybeans", "Oats", "Wheat", "Barley", "Forage Production", rep("Pasture,Rangeland,Forage", 3), "Apples"),
              scope = c("Shed", "Shed", rep("Iowa", 8)))
lc <- bind_rows(lapply(seq_len(nrow(map)), function(i) {
  w <- if (map$scope[i] == "Shed") function(d) d$share_in_shed else function(d) rep(1, nrow(d))
  s1 <- sob |> filter(crop == map$crop[i]); c1 <- col |> filter(crop == map$crop[i])
  if (!nrow(s1)) return(NULL)
  liab <- s1 |> mutate(w = w(s1)) |> group_by(year) |> summarise(liability = sum(liability * w, na.rm = TRUE), acres = sum(acres * w, na.rm = TRUE), ind_all = sum(indemnity * w, na.rm = TRUE), .groups = "drop")
  ind <- c1 |> mutate(w = w(c1), g = grp(cause)) |> filter(!is.na(g)) |> group_by(year, g) |> summarise(ind = sum(indemnity * w, na.rm = TRUE), .groups = "drop")
  if (map$crop[i] == "Pasture,Rangeland,Forage")   # rainfall-index product: all indemnities are weather-driven
    ind <- liab |> transmute(year, g = "Drought & heat", ind = ind_all)
  tidyr::crossing(liab, g = c("Drought & heat", "Excess moisture & flood", "Wind, hail & storms", "Frost & freeze")) |>
    left_join(ind, by = c("year", "g")) |> mutate(ind = coalesce(ind, 0), commodity = map$commodity[i], scope = map$scope[i], rma_crop = map$crop[i])
}))
lc <- lc |> mutate(loss_cost = ifelse(liability > 0, ind / liability, NA))
saveRDS(list(col = col, sob = sob, lc = lc, map = map), "data/derived/rma_shed.rds")
print(lc |> group_by(commodity, scope) |> summarise(yrs = n_distinct(year[liability > 0]), liab_M = round(mean(liability) / 1e6, 2),
        lc_mean = round(sum(ind) / sum(liability[!duplicated(year)]) , 4), .groups = "drop"))
