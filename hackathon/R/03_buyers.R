suppressPackageStartupMessages({library(sf); library(dplyr); library(tigris); library(tidygeocoder)})
options(tigris_use_cache = TRUE)
cur <- read.csv("data/raw/buyers_curated.csv")
wh  <- read.csv("data/raw/ia_licensed_grain_warehouses.csv")
cty <- st_read("data/derived/shed_counties.gpkg", quiet = TRUE)
wh <- wh |> filter(County %in% cty$NAME) |>
  transmute(name = Name, parent = Name, type = "Grain elevator / feed mill (state-licensed)",
            commodities = "corn;soybeans;oats;wheat;barley", address = "", city = City, state = "IA", attract = 1,
            source = "https://data.iowaagriculture.gov/licensing_lists/grainwarehouse/")
b <- bind_rows(cur, wh)
# Street-address geocoding (US Census), town-centroid fallback
g <- b |> filter(address != "") |> mutate(full = paste(address, city, state)) |>
  geocode(address = full, method = "census", quiet = TRUE, progress_bar = FALSE) |> select(name, lat, long)
b <- left_join(b, g, by = "name")
pl <- bind_rows(places("IA", cb = TRUE, year = 2023), places("OH", cb = TRUE, year = 2023)) |>
  st_point_on_surface() |> st_transform(4326)
pl <- data.frame(city = pl$NAME, state = pl$STUSPS, plat = st_coordinates(pl)[, 2], plon = st_coordinates(pl)[, 1])
pl$city[pl$city == "St. Olaf"] <- "Saint Olaf"
b <- left_join(b, distinct(pl, city, state, .keep_all = TRUE), by = c("city", "state")) |>
  mutate(geocode = ifelse(!is.na(lat), "street address", "town centroid"),
         lat = coalesce(lat, plat), long = coalesce(long, plon)) |> select(-plat, -plon)
# Unincorporated towns absent from Census places: OpenStreetMap Nominatim town lookup
miss <- is.na(b$lat)
if (any(miss)) {
  o <- geocode(data.frame(q = paste(b$city[miss], b$state[miss], "USA", sep = ", ")), address = q, method = "osm", quiet = TRUE)
  b$lat[miss] <- o$lat; b$long[miss] <- o$long
}
if (any(is.na(b$lat))) print(b[is.na(b$lat), c("name", "city")])
b <- filter(b, !is.na(lat)) |> mutate(buyer_id = sprintf("B%03d", row_number()))
st_write(st_as_sf(b, coords = c("long", "lat"), crs = 4326, remove = FALSE), "data/derived/buyers.gpkg", delete_dsn = TRUE, quiet = TRUE)
print(count(b, type, geocode))
