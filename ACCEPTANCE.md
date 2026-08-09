# Acceptance values — verified against `almaty_trap_clean.csv`

All figures below were recomputed on the final canonicalised dataset
(247 days, 48 taxa, 2025-04-28 → 2026-08-06). Treat them as the contract:
if the implementation disagrees, the implementation is wrong.

## Dataset shape

| Property | Value |
|---|---|
| Days with measurements | 247 |
| Canonical taxa | 48 (43 pollen + 5 fungal) |
| Date range | 2025-04-28 → 2026-08-06 |
| Data gaps | 2025-06-02..06-29, 2025-09-01..09-28, 2025-11-17..2026-03-25, 2026-06-01..06-30, 2026-07-09..07-12 |

## Ramp detector — Artemisia, 2025 season

Window: 2025-07-01 .. 2025-10-31
Rule: 3-day moving average ≥ 40 grains/m³ **AND** that average ÷ baseline ≥ 1.60

Baseline must NOT overlap the 3-day window. Both non-overlapping definitions
(d-13..d-3 and d-12..d-3) produce identical results, so either is acceptable.
The overlapping variant d-10..d-1 produces 2025-08-07 and is incorrect.

| Assertion | Expected |
|---|---|
| First ramp trigger | **2025-07-13** (ma3 = 40.333, baseline = 22.000, ratio = 1.833) |
| Total triggers in window | **12** |
| First sustained-sequence trigger | **2025-08-06** (ma3 = 40.0, baseline = 21.2, ratio = 1.887) |
| First critical day (>200) | **2025-08-15**, value **223** |
| Lead time from 2025-08-06 | **9 days** |
| Precision (critical day within 10 days of a trigger) | **11 of 12 = 92%** |
| Known false alarm | **2025-07-13** |

Corrections applied 2026-08-08, all three verified against the shipped file:

- The first trigger is 2025-07-13, not 2025-08-06. The earlier figure came
  from a scan that started fourteen rows into the window and never evaluated
  that date. The quoted values for 2025-08-06 were themselves correct; it is
  simply not the first trigger. 2025-07-13 is isolated — the next trigger is
  24 days later — so 2025-08-06 remains the first trigger of a sustained
  sequence, and it is that date the 9-day lead time is measured from.
- The count is 12, not 14. The earlier figure used positional windows that
  stepped across the 28-day September gap, adding 2025-09-29, 09-30 and
  10-01. Windows are calendar-aware: a 3-day average is never computed from
  days either side of a gap. Those three days are reported as not evaluable —
  neither triggers nor non-triggers.
- Thresholds stay at ma3 >= 40 and ratio >= 1.60. Raising the floor to 45
  removes the false alarm and prints 100% precision, but a threshold chosen
  on the only season available to evaluate it measures nothing. 92% is the
  honest figure.

These figures are served by `GET /api/ramp-performance` and computed on every
request. None of them is stored as a constant.

## Season integral — Artemisia

| Assertion | Expected |
|---|---|
| SPIn, 2025-07-01..2025-10-31 | **7023** |
| Peak | **1662** grains/m³ on **2025-09-29** |
| Season bounds (2.5% / 97.5%) | **2025-07-09** → **2025-10-23** |
| All-time total, both seasons | 7592 (do **not** use as SPIn) |

## Season pace — Artemisia, as of 2026-08-06

Two figures. Report both; surface the gap-adjusted one to users.

| Method | 2025 | 2026 | Ratio prev/cur |
|---|---|---|---|
| Raw cumulative from 1 July | 920 (37 days) | 511 (33 days) | 1.80 |
| **Matched dates only** (gap-adjusted) | **777** | **511** | **1.52** |

The 2026 window is missing 4 days (2026-07-09..07-12). The raw ratio
therefore overstates how far behind the current season is. The gap-adjusted
comparison is the honest one and must be the number shown in the UI.

## Collinear taxon pairs (log-scale Pearson, r ≥ 0.80)

Thirteen pairs cross r >= 0.80 on the final dataset. Nine of them rest on
fewer than 20 days where both taxa were present — Cedrus + Convolvulus scores
r = 1.00 on seven shared days — and a correlation estimated from a handful of
days is not evidence of collinearity. Grouping therefore requires both
r >= 0.80 and at least 20 co-occurring non-zero days.

Four pairs pass both tests, forming two groups:

| r | co-nonzero days | Pair | Group |
|---|---|---|---|
| 0.893 | 29 | Salix (ива) + Ulmus (вяз) | Corylus+Salix+Ulmus |
| 0.847 | 25 | Corylus (лещина) + Salix (ива) | Corylus+Salix+Ulmus |
| 0.828 | 25 | Corylus (лещина) + Ulmus (вяз) | Corylus+Salix+Ulmus |
| 0.823 | 72 | Cannabaceae (коноплёвые) + Chenopodiaceae (маревые) | Cannabaceae+Chenopodiaceae |

Corylus joins Salix and Ulmus transitively, so that group has three members,
not two. Rejected for sparsity, in descending r: Cedrus+Convolvulus (1.000,
7 days), Lavatera+Papaveraceae (0.999, 14), Apiaceae+Lavatera (0.921, 14),
Apiaceae+Papaveraceae (0.921, 14), Acacia+Sedum (0.897, 4),
Lamiaceae+Sedum (0.845, 5), Platanus+Quercus (0.833, 16),
Populus+Quercus (0.817, 15), Campanulaceae+Hypericum (0.802, 1).

The 20-day guard is a judgement call, not a value derived from the data. The
full list and the rejected pairs are returned by the API so the decision stays
auditable.

Correlated but **below** threshold, and therefore kept separate:
Artemisia + Chenopodiaceae (0.73), Ambrosia + Artemisia (0.71).

## Spot values for tests

| Date | Assertion |
|---|---|
| 2025-08-15 | Artemisia = **223** |
| 2026-08-06 | total pollen = **107**, total mold = **85** |
| any | Alternaria max over dataset = **67** (clinical threshold 100) |
| any | Cladosporium max over dataset = **124** (clinical threshold 3000) |

Mold never reaches its clinical thresholds anywhere in this dataset. Do not
apply the pollen level scale to mold, and do not present mold as hazardous.

## Thresholds

Pollen (grains/m³): 1–10 low · 11–50 moderate · 51–200 high · >200 critical
Mold (spores/m³), Gravesen 1979: Alternaria 100 · Cladosporium 3000
