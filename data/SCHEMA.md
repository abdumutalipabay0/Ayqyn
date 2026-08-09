# The measurement file

This directory holds the laboratory record and nothing else. **No file in here
may be generated, interpolated, extrapolated or filled in.** The service has no
mock mode: with this directory empty, every data endpoint returns `503
dataset_missing` and the acceptance suite fails. That is the intended
behaviour.

## Expected filename

One of, checked in this order:

```
data/almaty_trap_clean.json
data/almaty_trap_clean.csv
```

`DATASET_PATH=/somewhere/else.csv` overrides the location. It exists for
staging; whatever it points at is served verbatim.

## CSV columns

```
date,taxon,group,count_per_m3,temp_c,humidity_pct,wind_ms
```

| Column | Type | Notes |
|---|---|---|
| `date` | `YYYY-MM-DD` | UTC calendar date |
| `taxon` | string | e.g. `Artemisia`, `Alternaria alternata` |
| `group` | enum | `древесные` \| `травы` \| `плесень` |
| `count_per_m3` | number ≥ 0 | grains/m³ for pollen, spores/m³ for `плесень` |
| `temp_c` | number \| empty | day-level; must agree across that day's rows |
| `humidity_pct` | number \| empty | day-level |
| `wind_ms` | number \| empty | day-level |

JSON is either a bare array of objects with those keys, or
`{ "observations": [...] }`.

## The three rules the loader enforces

1. **A day the trap did not run is simply absent from the file.**
   It is never a row of zeros. `count_per_m3` may not be blank on a row that
   exists — a present row means the count was made, and `0` means the taxon was
   genuinely not found that day. Those are different facts and the API reports
   them differently.

2. **Duplicate `(date, taxon)` is a hard error.** Choosing which of two
   conflicting counts to keep is not a decision this code is entitled to make.

3. **Weather must not contradict itself within a day.** Conflicting `temp_c`
   across rows of the same date is a hard error.

## Expected record, per the data description

- 247 measurement days, 2025-04-28 → 2026-08-06
- 48 pollen taxa + 5 fungal spore types
- Gaps: 2025-06-02…2025-06-29, 2025-09-01…2025-09-28, 2025-11-17…2026-03-25,
  2026-06-01…2026-06-30, 2026-07-09…2026-07-12

`GET /api/meta` reports what the file actually contains and, crucially,
whether its gaps match the declared list. Disagreement is surfaced in
`undeclared_absent_dates` and `declared_gap_dates_present_in_file` rather than
being reconciled silently.
