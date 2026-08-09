# Licence for the measurements in `data/`

> **ATTRIBUTION IS INCOMPLETE.** The operating laboratory is not yet named in
> this file. CC BY 4.0 requires that the source be credited by name, so this
> notice is not usable as-is: replace every `[LAB NAME]` below with the
> laboratory's full official name before announcing or sharing this repository.
> Until then the data should be treated as *not cleared for redistribution*.

## What this covers

`data/almaty_trap_clean.csv` and `data/almaty_trap_clean.json` — daily
airborne pollen and fungal spore concentrations for Almaty, Kazakhstan,
28 April 2025 to 6 August 2026: 247 measured days, 48 taxa.

It does not cover the code (MIT, see `LICENSE`) or the fonts
(SIL OFL 1.1, see `web/fonts/OFL.txt`).

## Provenance

The measurements were produced by a **Burkard volumetric spore trap** of the
Hirst type, operated by **[LAB NAME]**. Air is drawn continuously through an
orifice onto an adhesive tape wound on a drum that completes one rotation per
week. The tape is cut into daily segments, mounted on slides, and the grains
and spores are **counted manually under a microscope**, taxon by taxon, day by
day.

The record is used here **with the permission of [LAB NAME]**.

Every gap in the record is real: on those dates the instrument was not
running. No value in these files is generated, interpolated, extrapolated or
filled in. See `data/SCHEMA.md`.

## Licence

The measurements are released under the
**Creative Commons Attribution 4.0 International licence (CC BY 4.0)**.

Full text: https://creativecommons.org/licenses/by/4.0/legalcode
Summary:   https://creativecommons.org/licenses/by/4.0/

You are free to share and adapt the data, including commercially, provided you
give appropriate credit, link to the licence, and indicate whether changes were
made.

## How to cite

> Airborne pollen and fungal spore measurements, Almaty, Kazakhstan,
> 2025–2026. Burkard volumetric trap operated by [LAB NAME].
> Licensed CC BY 4.0.

If you publish work derived from these data, please also state the two limits
the record carries, both documented in `README.md`: the season integral (SPIn)
is a **lower bound** because measured days do not cover the whole season
window, and **two seasons are not enough** for cross-year validation of any
threshold or detector.
