# DESIGN.md — Almaty Aerobiology, visual design decisions

Written before implementation. Every colour below has been run through the
dataviz validator; every claim about the typeface has been checked against the
actual font binary. Where I depart from the research findings I say so and give
the reason.

---

## 0. What the design has to fix

The previous build failed for one identifiable reason: it treated the number as
the design. A 176px "107" sat alone with a unit underneath — no label saying what
it was for, no comparison telling you whether that was bad, no action to take
next. It was a poster, not a product.

The corrective structure, applied to every screen:

> **label → value → verdict → comparison → one action**

Colour rides the **verdict**, never the digits. The digits are always ink.

---

## 1. Typeface

**Geist Sans (UI, headings, hero) + Geist Mono (data columns, axis ticks, dates,
the tape).** Two families from one superfamily, so they share skeleton and
metrics.

**Why, specifically:**

- **It has Cyrillic — I verified this, I did not assume it.** The interface is
  Russian. I extracted the npm `geist@1.7.2` package and read the `cmap` table
  with fontTools: Geist Sans maps 728 glyphs, Geist Mono 889, and both cover
  **А–я 64/64 including ё**. This eliminated my first instinct. Several
  characterful Latin faces (Satoshi, General Sans, Switzer from Fontshare) have
  little or no Cyrillic, which would have left the entire UI rendering in a
  fallback — the worst possible outcome, and invisible until someone loads it.
- **OFL, so it can be vendored into the repo.** The app must run with the
  network off. A CDN font is not an option, and a licence that forbids
  redistribution makes self-hosting a legal problem rather than a technical one.
- **Its numerals are unambiguous at small sizes** — open apertures, a
  single-storey `1` with a foot, a slashed-zero option in the mono. This is a
  product where someone reads `41` and `223` off a phone.
- **A real mono companion** means I need no third family for tabular data.

Not Inter (banned, and the reason it is banned is real). Not a serif (banned;
also the previous build's mistake — dataviz is explicit that a hero figure in a
display or serif face "reads as off-brand decoration").

### Loading strategy

```
web/fonts/
  geist-sans-latin-cyrillic.woff2      variable [wght 400..700], subset
  geist-mono-latin-cyrillic.woff2      variable [wght 400..600], subset
```

1. **Vendor the variable woff2** from the `geist` npm package at build time; the
   files live in the repo. No package is added to the runtime.
2. **Subset with `pyftsubset`** to Latin + Cyrillic + digits + punctuation +
   the few symbols used (`³ · × — ≥ →`). Full Geist variable is ~73 KB each;
   subsetting to the two scripts we actually set should land near 25–35 KB each.
   Both files are precached by the Service Worker.
3. `@font-face` with `font-display: swap` and an explicit `unicode-range` per
   file, so a Latin-only screen never blocks on the Cyrillic range.
4. `<link rel="preload" as="font" type="font/woff2" crossorigin>` for **the two
   files only** — not one per weight; the variable axis covers weight.
5. Fallback stack `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` and
   `ui-monospace, "Cascadia Mono", "SF Mono", monospace`, with
   `size-adjust` tuned so the swap does not reflow.

---

## 2. Type scale

Every `clamp()` preferred value **mixes rem with vw**, so text still scales under
browser zoom (WCAG 1.4.4 — a pure-`vw` preferred value freezes text at 200% zoom
and fails).

```css
--fs-hero:  clamp(3.25rem, 2.2rem + 4.6vw, 5rem);      /* 52 → 80px */
--fs-h1:    clamp(1.5rem, 1.28rem + 0.95vw, 2.125rem); /* 24 → 34px */
--fs-h2:    clamp(1.125rem, 1.06rem + 0.3vw, 1.375rem);/* 18 → 22px */
--fs-lead:  clamp(1rem, 0.97rem + 0.15vw, 1.125rem);   /* 16 → 18px */
--fs-body:  1rem;                                      /* 16px floor, never smaller */
--fs-sm:    clamp(0.875rem, 0.86rem + 0.07vw, 0.9375rem);
--fs-label: 0.75rem;                                   /* eyebrows/units only, uppercase, tracked */
```

Line heights: 1.15 hero · 1.25 headings · 1.55 body · 1.4 dense rows.
Weights used: 400 body · 500 labels and nav · 600 headings and the hero value.
Nothing heavier — Geist's 700+ is too dense for Cyrillic at small sizes.

**Numerals.** `font-variant-numeric: tabular-nums` + `font-feature-settings:
"tnum" 1` on **columns** — table rows, axis ticks, the composition values, the
diary. The **hero value uses proportional figures**. This is a deliberate split:
tabular gives every digit the width of a `0`, which makes a standalone `41` look
gappy at 80px. This follows the dataviz skill over the research note, which said
tabular everywhere.

---

## 3. Colour

Warm neutrals, one accent, and a four-step **ordinal** ramp. No pure `#ffffff`
anywhere.

### Neutrals and accent (light)

| Token | OKLCH | hex | Contrast on `--bg` |
|---|---|---|---|
| `--bg` | `oklch(0.975 0.008 92)` | `#f9f7f1` | — |
| `--surface` | `oklch(0.992 0.004 92)` | `#fdfcf9` | — |
| `--surface-sunk` | `oklch(0.958 0.010 92)` | — | — |
| `--ink` | `oklch(0.255 0.012 70)` | `#27221d` | **14.71:1** |
| `--ink-2` | `oklch(0.505 0.011 70)` | `#69645e` | **5.47:1** |
| `--ink-3` | `oklch(0.635 0.009 70)` | `#8e8a85` | **3.20:1** |
| `--border` | `oklch(0.905 0.008 90)` | `#e2dfda` | 1.24:1 (hairline) |
| `--accent` | `oklch(0.53 0.105 205)` | `#007c89` | **4.62:1** |

The accent is a deep teal — one colour, used for links, the primary button,
focus rings and the current-tab indicator. It is far from the ramp in hue, so an
action can never be mistaken for a severity. My first pick was
`oklch(0.545 …)`; it measured 4.33:1 and I darkened it until it cleared 4.5:1.

### The pollen level ramp — ordinal, one hue

Amber → rust, the colour of the material itself.

| Level | OKLCH | hex | Text on it |
|---|---|---|---|
| `--lvl-0` none (measured zero) | `oklch(0.945 0.006 92)` | — | ink |
| `--lvl-1` низкий | `oklch(0.760 0.085 62)` | `#d9a579` | ink 7.21:1 |
| `--lvl-2` умеренный | `oklch(0.660 0.120 58)` | `#c87e41` | ink 4.89:1 |
| `--lvl-3` высокий | `oklch(0.555 0.140 48)` | `#b25417` | paper 4.90:1 |
| `--lvl-4` критический | `oklch(0.430 0.115 40)` | `#823417` | paper 8.35:1 |
| unmeasured | *no fill* — 45° hatch in `--border` | — | — |

Validator, `--ordinal --mode light --surface #fdfcf9`:

```
[PASS] Lightness monotone     steps read light→dark
[PASS] Adjacent ΔL            all gaps >= 0.06
[PASS] Light-end contrast     #d9a579 at 2.13:1 vs surface
[PASS] Single hue             hue spread 22°
→ ALL CHECKS PASS
```

Dark mode is **selected, not flipped** — its own steps from the same hue,
validated against `#17150f`: `#e9bb8f, #d8965a, #c06a30, #9a4a22`, also
ALL CHECKS PASS.

> **Departure from the research, stated plainly.** The findings say "muted tones
> at roughly equal lightness". I am doing the opposite: **monotone lightness with
> ΔL ≥ 0.06 between every step.** Equal-lightness tones are the correct advice
> for *categorical* colour, where identity must not imply order. Pollen level is
> ordinal — low → critical is a sequence — and encoding a sequence in colours of
> equal lightness means the order is carried by hue alone, which is exactly what
> collapses in grayscale, in CVD, and in `forced-colors`. Equal lightness would
> have failed verification step 4 by construction. So: one hue, ordered
> lightness. It is also not a traffic light — no green, no saturated red, one
> hue family throughout.

Colour is never the only channel. Every level appears as **fill + word + a
four-cell stepper** (see §6).

---

## 4. Radius, spacing, borders

**Radius** — a small system with a rule, not one value everywhere:

```css
--r-tile:    14px;   /* content tiles */
--r-control: 10px;   /* buttons, inputs, chips */
--r-pill:    999px;  /* the verdict chip only */
--r-data:    3px;    /* rounded data-end on bars; square at the baseline */
--r-none:    0;      /* tape segments, heatmap cells — instrument artifacts stay square */
```

The rule: **UI containers are soft, data marks are hard.** Nothing shares
shadcn's default `0.5rem`.

**Spacing** — 4px base, and I use the whole scale rather than defaulting to 16:

```
4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56 · 72
```

Section rhythm 32 mobile / 40 desktop. Tile padding 16 mobile / 20 desktop.

**Borders and elevation.** Separation is done with **1px `--border` hairlines and
a surface step**, not shadows. There is exactly **one** shadow token in the whole
system, and it is used only where an element genuinely floats over scrolling
content — the bottom tab bar and the sticky action bar:

```css
--shadow-bar: 0 -1px 0 var(--border), 0 -10px 28px -20px oklch(0.25 0.02 70 / 0.4);
```

No shadow on tiles. No blur. No glass.

---

## 5. Composition of Today

### 390px — one column, bottom tab bar

```
┌────────────────────────────────────────────┐
│ измерено 6 августа · 2 дня назад       ⟳   │ ← freshness disclosure, always visible
├────────────────────────────────────────────┤
│ СЕГОДНЯ ДЛЯ ВАС                            │ ← label (what this number is for)
│                                            │
│ 41                                         │ ← value, --fs-hero, INK, proportional
│ зёрен/м³ · полынь                          │ ← unit + what drives it
│                                            │
│ ▮▮▯▯  УМЕРЕННЫЙ                            │ ← verdict chip: stepper + word (COLOURED)
│                                            │
│ ↓ на 6 меньше, чем вчера                   │ ← comparison
│ ────────────────────────────────────────── │
│ [ Что это значит для меня          → ]     │ ← ONE action, accent
├────────────────────────────────────────────┤
│ ЧТО В ВОЗДУХЕ                    все 10 →  │
│ Полынь        ▇▇▇▇▇▇▇▇▇▇▇▇  41             │ ← horizontal bars, ≤24px, top 5
│ Крапивные     ▇▇▇  12                      │
│ …                                          │
├────────────────────────────────────────────┤
│ СЕЗОН                                      │
│ Полынь        ▮▮▯▯  нарастает              │
│ Крапивные     ▮▯▯▯  идёт на спад           │
├────────────────────────────────────────────┤
│ СПОРЫ ГРИБОВ                     85 спор/м³│
│ ниже клинических порогов                   │
│ шкала пыльцы к спорам не применяется       │
├────────────────────────────────────────────┤
│ ЛЕНТА ЛОВУШКИ · 28 дней                    │
│ ▓▓▓▒▒░░╱╱╱░░▒▒▓▓▓▓▒▒░                      │ ← gaps are cut-outs
└────────────────────────────────────────────┘
│ ⌂ Сегодня  ◈ Триггер  ∿ Сезон  ▦ Год       │ ← bottom tab bar, 56px + safe-area
└────────────────────────────────────────────┘
```

Tab bar: 4 items, icon **and** label, ≥48px targets, `env(safe-area-inset-bottom)`,
current item marked by accent fill + weight (not colour alone). Content gets
`padding-bottom` equal to the bar height so nothing hides behind it.

### 1280px — bento, deliberately unequal

```
grid-template-columns: minmax(0,1.15fr) minmax(0,0.85fr) minmax(0,0.95fr);
```

```
┌──────────────────────────────────────┬─────────────────┐
│  HERO — dominant tile, 2 cols × 2 rows│  СЕЗОН          │
│  label · 41 · verdict · comparison    │  (tall, all     │
│  [ Что это значит для меня → ]        │   moving taxa)  │
│                                       │                 │
├──────────────────┬────────────────────┤                 │
│ ЧТО В ВОЗДУХЕ    │ СПОРЫ ГРИБОВ       │                 │
│ (bars, all 10)   │ 85 · пороги        │                 │
├──────────────────┴────────────────────┴─────────────────┤
│  ЛЕНТА ЛОВУШКИ — 28 дней, full bleed                    │
└─────────────────────────────────────────────────────────┘
```

One dominant tile plus smaller supporting tiles. The three column tracks are
**1.15 / 0.85 / 0.95** — never equal, so it cannot read as three identical
columns, and no row ever contains four identical cards. Navigation moves from the
bottom bar into the header as a segmented control at ≥900px; the bar is a phone
affordance and a projector does not have a thumb.

Container queries size the tiles' internals, so the composition bars switch from
stacked to `label │ track │ value` based on **the tile's** width, not the
viewport's — which is what broke the previous build at 1280.

---

## 6. Charts — and the library decision

**No chart library. Hand-rolled SVG, as now.**

The research names Recharts for React at this volume and visx for the calendar
heatmap. I am departing, and this is the largest departure in the document, so
here is the whole reasoning:

- **The app has zero runtime dependencies and must survive with the network
  off.** Recharts pulls React + ReactDOM + d3 modules — roughly 150–200 KB
  gzipped that must be precached, parsed and executed on a phone before a
  hay-fever sufferer sees a number. The Service Worker budget is the constraint
  the whole product is built around.
- **It would be two libraries, not one.** Recharts has no calendar heatmap;
  that is visx. Adding a React runtime plus two chart libraries to draw three
  chart forms is the wrong trade.
- **The three forms are small and already built and tested**: a season line that
  must break at gaps, horizontal composition bars, and a taxa×month grid.
- **Most decisive:** a library would not have prevented a single defect that
  actually occurred in the previous build — those were CSS specificity, Service
  Worker lifecycle, and gap semantics. And the one thing this product must get
  right — *a gap in the record is not a zero* — is a semantic I have to own
  regardless. `connectNulls={false}` is a prop; "these two days are not adjacent
  even though they are consecutive rows" is domain logic.

Marks follow the dataviz specs: bars ≤24px with a 3px rounded data-end and a
square baseline, lines 2px, markers ≥8px with a 2px surface ring, 2px surface
gaps between touching marks, hairline solid gridlines one step off surface,
selective direct labels only. Season comparison uses **fill vs dashed stroke**
(pattern), not two hues. Every chart gets a hover/tap tooltip and an
`aria-label` summary; the composition list *is* the table view.

Horizontal bars for composition. No pie, no donut, anywhere.

---

## 7. Three decisions that make this interface itself

**1. The tape.** A Burkard trap pulls a single adhesive tape past its orifice,
one drum revolution per week; the lab cuts it into 24-hour segments and reads
each under the microscope. The interface carries that object literally: a
horizontal band, one segment per day, square-cornered, set in the mono. **A day
the trap did not run has no tape — it is a cut-out, hatched, showing the page
through.** This turns "gaps render as gaps" from a caveat in a footnote into the
structure of the component, and it is the one element on screen that could not
have come from any other product. It appears on Today (28 days), under the season
chart, and it is the entire logic of the year calendar.

**2. Colour rides the verdict, never the digits.** The hero number is always
`--ink`. The level colour lives in a chip beside it that carries the stepper, the
word, and nothing else. This is the direct fix for the failure: a coloured
number tells you the temperature of the data; a labelled chip tells you what to
do about it. It also means the four-step ramp only ever appears where it encodes
level — chips, bars, tape, heatmap — and never as decoration.

**3. The four-cell stepper.** Level is drawn as `▮▮▯▯` — four cells, the first
*n* filled. Position carries the value, the fill carries it again, the word
carries it a third time. Remove all colour and the level is still readable,
because you count filled cells. This is the grayscale test answered in the
component rather than checked after the fact, and it is why the ramp could be
ordered by lightness without losing anything.

**One orchestrated motion**, not scattered effects: on first paint the tape draws
left to right over ~500 ms — the drum turning. Charts animate once on first
render, never on re-render. Micro-interactions 160 ms ease-out, exits ~110 ms.
`transform`/`opacity` only, never `transition: all`. Screen changes use the View
Transitions API where supported and cross-fade where not. All of it inside
`@media (prefers-reduced-motion: no-preference)`.

---

## 8. Preserved from the current build

Non-negotiable, carried over unchanged:

- **Every displayed figure comes from an endpoint**, including the threshold
  scale itself (`GET /api/meta → scale`). No data numeral is typed into a
  component.
- **"измерено 6 августа · 2 дня назад"** stays visible at the top of Today.
- **Mold keeps its own block and its own note** — its own clinical thresholds,
  never the pollen scale, never a level word, and the statement that the
  thresholds were never exceeded in this record.
- **Guidance describes, never prescribes.** "Полынь нарастает — есть смысл
  обсудить профилактику с аллергологом", never "начните профилактику".
- **Gaps render as gaps.** Rolling windows still refuse to span one.
- **Service Worker** precaches the shell, the two font files and `/api/meta`,
  network-first for `/api/*`, `offline.html` as the navigation fallback.

## 9. Departures from the research findings — the full list

| Finding | What I am doing | Why |
|---|---|---|
| Recharts / visx | Hand-rolled SVG, no library | Offline budget; two libraries for three forms; wouldn't have prevented any real defect |
| shadcn/ui + Base UI + Lucide | No component library; ~10 hand-built components, inline SVG icons at 1.5px stroke | Same; also nothing to override if nothing is imported |
| Pollen levels at roughly equal lightness | Monotone lightness, ΔL ≥ 0.06, one hue | Level is ordinal, not categorical; equal lightness fails grayscale and CVD by construction |
| `tabular-nums` on every figure | Tabular in columns; **proportional** for the hero value | dataviz: tabular makes a standalone 80px number look gappy |
| Geist *or* Satoshi / General Sans / Switzer | Geist, and only after checking the `cmap` | The Fontshare faces have little or no Cyrillic; the UI is Russian |

Everything else in the research I am following as given.
