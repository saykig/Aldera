#!/usr/bin/env Rscript

# One-time acquisition helper for the exact official artifacts. Aldera itself
# remains a Node/TypeScript program; R is needed here because ICBe publishes the
# authoritative event table as RDS and does not include a CSV/TSV equivalent.

args <- commandArgs(trailingOnly = TRUE)
if (!(length(args) %in% c(3, 5))) {
  stop("usage: extract-stage3a-native.R <ICBe RDS> <UCDP CSV> <output directory> [from YYYY-MM-DD] [to YYYY-MM-DD]")
}
if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("the R jsonlite package is required for this one-time extraction")
}

icbe_path <- args[[1]]
ucdp_path <- args[[2]]
output_directory <- args[[3]]
dir.create(output_directory, recursive = TRUE, showWarnings = FALSE)

date_bound <- function(day, month, year, end = FALSE) {
  if (is.na(year) || !grepl("^[0-9]{4}$", year)) return(as.Date(NA))
  if (is.na(month) || !grepl("^[0-9]{1,2}$", month) || as.integer(month) < 1 || as.integer(month) > 12) {
    return(as.Date(sprintf("%s-%s", year, if (end) "12-31" else "01-01"), format = "%Y-%m-%d"))
  }
  if (is.na(day) || !grepl("^[0-9]{1,2}$", day) || as.integer(day) < 1 || as.integer(day) > 31) {
    first <- as.Date(sprintf("%s-%02d-01", year, as.integer(month)), format = "%Y-%m-%d")
    if (!end) return(first)
    return(seq(first, by = "month", length.out = 2)[[2]] - 1)
  }
  as.Date(sprintf("%s-%02d-%02d", year, as.integer(month), as.integer(day)), format = "%Y-%m-%d")
}

icbe <- readRDS(icbe_path)
if (!all(c("crisno", "sentence_number_int_aligned", "sentence_span_text") %in% names(icbe))) {
  stop("unexpected ICBe event-table schema")
}

starts <- mapply(
  date_bound,
  icbe$date_earliest_day,
  icbe$date_earliest_month,
  icbe$date_earliest_year,
  MoreArgs = list(end = FALSE)
)
ends <- mapply(function(ed, em, ey, ld, lm, ly) {
  if (!is.na(ly) && ly != "") date_bound(ld, lm, ly, TRUE) else date_bound(ed, em, ey, TRUE)
},
icbe$date_earliest_day,
icbe$date_earliest_month,
icbe$date_earliest_year,
icbe$date_latest_day,
icbe$date_latest_month,
icbe$date_latest_year)
starts <- as.Date(starts, origin = "1970-01-01")
ends <- as.Date(ends, origin = "1970-01-01")

selection_from <- as.Date(if (length(args) == 5) args[[4]] else "2014-04-07")
selection_to <- as.Date(if (length(args) == 5) args[[5]] else "2014-04-24")
if (is.na(selection_from) || is.na(selection_to) || selection_from > selection_to) {
  stop("invalid extraction date window")
}
geography <- grepl(
  "donbass|donbas|donetsk|luhansk",
  paste(icbe$interact_location, icbe$sentence_span_text),
  ignore.case = TRUE
)
icbe_indices <- which(
  icbe$crisno == 471 &
    !is.na(icbe$event_type) &
    geography &
    !is.na(starts) &
    starts <= selection_to &
    ends >= selection_from
)

as_native_list <- function(row) {
  values <- as.list(row)
  lapply(values, function(value) {
    if (length(value) == 0 || is.na(value)) NA else unname(value)
  })
}

icbe_output <- unname(lapply(icbe_indices, function(index) list(
  source_row = index,
  native = as_native_list(icbe[index, , drop = FALSE])
)))

# The UCDP artifact is official CSV, so this does not create an Aldera runtime
# dependency. Reading all columns as text preserves the native CSV values.
ucdp <- read.csv(
  ucdp_path,
  header = TRUE,
  stringsAsFactors = FALSE,
  colClasses = "character",
  check.names = FALSE,
  na.strings = character()
)
required_ucdp <- c("id", "country", "adm_1", "date_start", "date_end")
if (!all(required_ucdp %in% names(ucdp))) stop("unexpected UCDP GED schema")
ucdp_keep <-
  ucdp$country == "Ukraine" &
  ucdp$adm_1 %in% c("Donetsk oblast", "Luhansk oblast") &
  substr(ucdp$date_start, 1, 10) <= format(selection_to, "%Y-%m-%d") &
  substr(ucdp$date_end, 1, 10) >= format(selection_from, "%Y-%m-%d")
ucdp_indices <- which(ucdp_keep)
ucdp_output <- unname(lapply(ucdp_indices, function(index) list(
  source_row = index,
  native = as_native_list(ucdp[index, , drop = FALSE])
)))

jsonlite::write_json(
  icbe_output,
  file.path(output_directory, "icbe-native.json"),
  auto_unbox = TRUE,
  pretty = TRUE,
  na = "null",
  digits = NA
)
jsonlite::write_json(
  ucdp_output,
  file.path(output_directory, "ucdp-native.json"),
  auto_unbox = TRUE,
  pretty = TRUE,
  na = "null",
  digits = NA
)

message(sprintf(
  "selected %d ICBe rows and %d UCDP rows for %s through %s",
  length(icbe_indices),
  length(ucdp_indices),
  selection_from,
  selection_to
))
