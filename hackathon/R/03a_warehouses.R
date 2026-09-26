suppressPackageStartupMessages({library(httr); library(xml2); library(rvest)})
url <- "https://data.iowaagriculture.gov/licensing_lists/grainwarehouse/"
out <- list(); off <- 0
repeat {
  r <- POST(url, body = list(name = "", location = "", county = "", offset = off), encode = "form", user_agent("Mozilla/5.0"))
  tb <- html_table(read_html(content(r, "text")))
  if (!length(tb) || !nrow(tb[[1]])) break
  t <- tb[[1]]; key <- paste(t$Name, t$City)
  if (length(out) && all(key %in% unlist(lapply(out, function(x) paste(x$Name, x$City))))) break
  out[[length(out) + 1]] <- t; off <- off + nrow(t)
  if (off > 2000) break
}
wh <- unique(do.call(rbind, out))
write.csv(wh, "data/raw/ia_licensed_grain_warehouses.csv", row.names = FALSE)
cat(nrow(wh), "licensees\n")
