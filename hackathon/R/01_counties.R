suppressPackageStartupMessages({library(sf); library(tigris); library(dplyr)})
options(tigris_use_cache = TRUE)
shed <- st_read("data/derived/shed.gpkg", quiet = TRUE)
ia <- counties("IA", cb = TRUE, year = 2023, progress_bar = FALSE) |> st_transform(5070)
cty <- ia[st_intersects(ia, shed, sparse = FALSE)[, 1], ]
cty$share_in_shed <- as.numeric(st_area(st_intersection(cty, st_geometry(shed))) / st_area(cty))
st_write(cty[, c("GEOID", "NAME", "share_in_shed")], "data/derived/shed_counties.gpkg", delete_dsn = TRUE, quiet = TRUE)
print(st_drop_geometry(cty[, c("NAME", "share_in_shed")]) |> arrange(-share_in_shed))
