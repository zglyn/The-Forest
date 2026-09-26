# Tidy Tradeverifyd affiliate data: subsidiaries of first-buyer companies; affiliate links reported for in-shed buyers
suppressPackageStartupMessages({library(dplyr); library(jsonlite); library(countrycode)})
j <- fromJSON("data/raw/tradeverifyd/affiliates.json", simplifyVector = FALSE)
subs <- bind_rows(lapply(j$subsidiaries, function(x) tibble(root = x$root_parent, entity_id = x$entity_id, name = x$name,
          city = x$city %||% NA, country_iso = x$country %||% NA))) |>
  distinct(root, entity_id, .keep_all = TRUE) |>
  mutate(country = coalesce(suppressWarnings(countrycode(country_iso, "iso2c", "country.name")), "Unknown"),
         root = ifelse(root == "Kent Corporation", "Grain Processing Corp. (Kent)", root))
shed <- bind_rows(lapply(j$shed_buyers, function(x) tibble(buyer = x$buyer, type = x$type, matched = !is.null(x$entity_id), tv_name = x$tv_name %||% NA,
          n_links = length(x$parents), links = paste(unique(sapply(x$parents, `[[`, "name")), collapse = "; "))))
saveRDS(list(subs = subs, shed = shed), "data/derived/affiliates.rds")
print(count(subs, root)); print(subs |> count(country, sort = TRUE) |> head(8)); print(filter(shed, n_links > 0) |> select(buyer, links))
