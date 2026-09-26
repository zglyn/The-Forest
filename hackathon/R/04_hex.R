suppressPackageStartupMessages({library(sf); library(terra); library(dplyr); library(exactextractr)})
shed <- st_read("data/derived/shed.gpkg", quiet = TRUE)
cty  <- st_read("data/derived/shed_counties.gpkg", quiet = TRUE)
cdl  <- rast("data/raw/CDL_2025_shed.tif")
# 5 km flat-to-flat hexagons clipped to the shed
hex <- st_make_grid(shed, cellsize = 5000, square = FALSE) |> st_sf(geometry = _) |>
  st_intersection(st_geometry(shed)) |> st_collection_extract("POLYGON") |> mutate(hex_id = sprintf("H%04d", row_number()))
# Pixel counts for classes of interest (CDL codes: 1 corn, 5 soybeans, 28 oats, 36 alfalfa, 37 other hay, 176 grass/pasture)
codes <- c(corn = 1, soybeans = 5, oats = 28, alfalfa = 36, hay = 37, pasture = 176)
cnt <- exact_extract(cdl, hex, function(v, cov) sapply(codes, function(k) sum(cov[v %in% k], na.rm = TRUE)), progress = FALSE)
cnt <- as.data.frame(t(cnt)); names(cnt) <- paste0("px_", names(codes))
hex <- bind_cols(hex, cnt) |> mutate(across(starts_with("px_"), ~ .x * 900 / 4046.856, .names = "{sub('px_', 'ac_', .col)}"))
# County assignment by centroid (for county yields)
hex$GEOID <- cty$GEOID[st_nearest_feature(st_centroid(hex), cty)]
st_write(hex, "data/derived/hex.gpkg", delete_dsn = TRUE, quiet = TRUE)
cat(nrow(hex), "hexes\n"); print(round(colSums(select(st_drop_geometry(hex), starts_with("ac_"))) / 1e6, 3))
