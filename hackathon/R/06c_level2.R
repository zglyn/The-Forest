# Level-2 buyers (Tradeverifyd) -> tidy table with coordinates
suppressPackageStartupMessages({library(dplyr); library(jsonlite); library(tidygeocoder); library(sf)})
j  <- fromJSON("data/raw/tradeverifyd/level2.json", simplifyVector = FALSE)
hs <- unlist(j$hs)
e  <- bind_rows(lapply(j$edges, function(x) tibble(l1_parent = x$l1_parent, l2_entity_id = x$l2_entity_id, l2_name = x$l2_name,
        hs4 = paste(unlist(x$hs4), collapse = ";"), city = x$city %||% NA, state = x$state %||% NA, country = x$country %||% NA)))
ov <- read.csv("data/params/tv_location_overrides.csv")
e  <- e |> left_join(ov, by = "l2_name", suffix = c("", "_ov")) |>
  mutate(flag = case_when(!is.na(country_ov) ~ paste("Country corrected:", reason),
                          country %in% c("SC", "SS") ~ "Location implausible for this trade; not mapped",
                          grepl("hospital", l2_name, ignore.case = TRUE) ~ "Entity name inconsistent with commodity trade; likely record-merge error",
                          TRUE ~ ""),
         city = ifelse(!is.na(country_ov) & country_ov != country, NA, city), country = coalesce(country_ov, country)) |> select(-country_ov, -reason)
# Geocode: city + state + country, falling back to country
e$q_city <- ifelse(is.na(e$city), NA, paste(e$city, ifelse(is.na(e$state), "", e$state), e$country, sep = ", "))
uc <- unique(na.omit(e$q_city)); ucn <- unique(na.omit(e$country))
gc <- geocode(tibble(q = uc), address = q, method = "osm", quiet = TRUE, progress_bar = FALSE)
gn <- geocode(tibble(q = ucn), country = q, method = "osm", quiet = TRUE, progress_bar = FALSE)
e <- e |> left_join(rename(gc, q_city = q, lat_c = lat, lon_c = long), by = "q_city") |>
  left_join(rename(gn, country = q, lat_n = lat, lon_n = long), by = "country") |>
  mutate(lat = coalesce(lat_c, lat_n), lon = coalesce(lon_c, lon_n), loc_precision = ifelse(!is.na(lat_c), "city", "country centroid"),
         mapped = flag == "" | grepl("^Country corrected", flag)) |> select(-starts_with("lat_"), -starts_with("lon_"), -q_city)
e$products <- sapply(strsplit(e$hs4, ";"), function(k) paste(hs[k], collapse = ", "))
e$product_group <- sapply(strsplit(e$hs4, ";"), function(k) {
  g <- unique(ifelse(k %in% c("1201", "1507", "2304", "2106"), "Soy-derived", ifelse(k %in% c("1004", "1104"), "Oat-derived", "Corn-derived")))
  if (length(g) > 1) "Mixed corn & soy" else g })
saveRDS(list(edges = e, hs = hs), "data/derived/level2.rds")
print(count(e, l1_parent, mapped)); print(count(e, product_group)); print(count(e, loc_precision))
