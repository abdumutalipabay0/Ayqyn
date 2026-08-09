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

### Loading strategy — as built

```
web/fonts/
  geist-var.woff2        variable [wght 100..900], Latin + Cyrillic   34 KB
  geist-mono-400.woff2   static 400, Latin + Cyrillic                 10 KB
```

1. **Vendored variable woff2**, subset with `pyftsubset` from the upstream
   `Geist[wght].ttf` to Latin + Cyrillic + the punctuation and symbols this
   interface actually sets (`³ · × — ≥ → « » №`). 313 glyphs, 98 of them
   Cyrillic. The full licence and author list ship beside it as `OFL.txt` and
   `AUTHORS.txt`, because OFL requires it.
2. The variable axis is the point: the earlier build shipped two static cuts,
   400 and 600, so a `font-weight: 590` would have snapped to 600. With the
   axis, 590 is 590 — and 590 is the cap.
3. `@font-face` with `font-display: swap`. Both files are precached by the
   Service Worker, so the interface is fully typeset offline.
4. `<link rel="preload">` for the sans only. The mono carries labels and can
   swap a frame later without moving the layout.
5. Fallback stack `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

**Cost of the change.** Two static cuts were 26.5 KB; the variable file is
34 KB. That is 7.8 KB more for the whole weight axis and the ability to stop
using weight as the hierarchy signal.

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

Line heights: 1.15 hero · 1.22 headings · 1.6 body · 1.4 dense rows.
Weights used: **400** body · **500** labels and nav · **590** headings and the
hero value. Nothing heavier, ever. Weight is not how hierarchy is signalled
here — size, colour and space are; 700+ is also too dense for Cyrillic at small
sizes.

**Tracking.** Negative as text grows, slightly positive as it shrinks:

```css
--track-hero:  -0.022em;   /* 52–80px */
--track-h1:    -0.014em;   /* 24–34px */
--track-h2:    -0.012em;   /* 18–22px */
--track-body:   0.004em;   /* body — see below */
--track-label:  0.06em;    /* uppercase mono eyebrows */
```

The positive value on body text is not an oversight. On a near-black ground the
strokes of light text bloom slightly and close up the counters; a fraction of a
point of extra tracking gives them air. Large text has the opposite problem and
gets pulled tight.

**Numerals.** `font-variant-numeric: tabular-nums` + `font-feature-settings:
"tnum" 1` on **columns** — table rows, axis ticks, the composition values, the
diary. The **hero value uses proportional figures**. This is a deliberate split:
tabular gives every digit the width of a `0`, which makes a standalone `41` look
gappy at 80px. This follows the dataviz skill over the research note, which said
tabular everywhere.

---

## 3. Colour

Cool near-black, one desaturated accent, and a four-step **ordinal** ramp. No
pure `#ffffff` and no pure `#000000` anywhere.

Three rules hold the dark mode together, and they are enforced in
`web/tokens.css` rather than remembered:

1. **Never pure black.** The ground is `#0a0c0e` — near-black with a cool
   undertone. `#000` halates around light text and flattens every depth cue.
2. **Depth is lighter layers, not shadow.** A shadow on a near-black ground is
   invisible. Each elevation step raises lightness about four points instead:
   `--bg` → `--surface` → `--surface-2`. There is exactly one shadow token in
   the system and it is on the bottom bar, which genuinely floats.
3. **One accent, and it never fills a block.** Amber appears on focus rings,
   links, the sign of a delta and the "now" marker. Nothing else.

### Neutrals and accent (dark — the primary mode)

| Token | OKLCH | hex | Contrast on `--surface` |
|---|---|---|---|
| `--bg` | `oklch(0.152 0.005 255)` | `#0a0c0e` | — |
| `--surface` | `oklch(0.192 0.005 255)` | `#131416` | — |
| `--surface-2` | `oklch(0.232 0.006 255)` | `#1b1c1f` | — |
| `--ink` | `oklch(0.915 0.004 255)` | `#e1e3e5` | **14.33:1** |
| `--ink-2` | `oklch(0.735 0.006 255)` | `#a7a9ad` | **7.83:1** |
| `--ink-3` | `oklch(0.615 0.008 255)` | `#818589` | **4.96:1** |
| `--border` | `oklch(1 0 0 / 0.09)` | white 9% | hairline |
| `--border-strong` | `oklch(1 0 0 / 0.16)` | white 16% | hairline |
| `--accent` | `oklch(0.765 0.072 66)` | `#d3aa82` | **8.64:1** |

Text is `#e1e3e5`, not white. Pure white on near-black halates, which costs
most in long reading and for anyone with astigmatism.

`--ink-3` carries the explanatory copy, so it was raised until it cleared
4.5:1 on **both** `--surface` and `--surface-2` (4.96 and 4.51). Its previous
value measured 4.44 and was a real failure, not a rounding argument.

### The primary action is neutral, not the accent

The obvious move is an amber button. It is the wrong move here: amber is also
the severity ramp, and a filled amber block reads as "critical" before it reads
as "button". So the primary action is an off-white block on near-black —
`--action` / `--action-ink` — and the accent is spent only on affordances.

This also retires the previous build's teal. Two accents were one too many.

### The pollen level ramp — ordinal, one hue

Amber → rust, the colour of the material itself. Dark mode **flips the anchor**:
on a dark surface the light end is the loud one, so level 1 sits nearest the
surface and level 4 is the most luminous. Keeping the light-mode order would
make "низкий" pop harder than "критический" — the severity would read
backwards.

Chroma is pulled well below the previous build so the ramp stops glowing;
lightness does the work.

| Level | OKLCH (dark) | hex | Relative luminance |
|---|---|---|---|
| `--lvl-0` измеренный ноль | `oklch(0.245 0.006 255)` | — | 0.015 |
| `--lvl-1` низкий | `oklch(0.425 0.048 66)` | `#614932` | 0.075 |
| `--lvl-2` умеренный | `oklch(0.545 0.064 60)` | `#8c674a` | 0.158 |
| `--lvl-3` высокий | `oklch(0.675 0.076 52)` | `#bd8a6b` | 0.301 |
| `--lvl-4` критический | `oklch(0.82 0.082 46)` | `#f2b497` | 0.538 |

Validator, `--ordinal --mode dark --surface #0a0c0e`: **ALL CHECKS PASS**
(monotone lightness, every adjacent ΔL ≥ 0.06, light end clears the surface,
hue spread 19°).

Validator, `--ordinal --mode light --surface #f9fafb`: **ALL CHECKS PASS**.
The light ramp's first step needed retuning — at `L 0.775` its contrast on the
surface measured 1.98:1, below the 2:1 floor, and it was darkened to `L 0.745`
(2.20:1).

Luminance rises monotonically across the whole ramp with gaps of 0.06 to 0.24,
which is what makes the level survive greyscale. The four-cell stepper is the
belt to that braces: you can count filled cells with the colour gone.

### Colour on data

Reserved for the sign of a delta and for alerts. The headline delta is the only
coloured figure on the Today screen — amber when the count rose, plain ink when
it fell or held, and it always carries an arrow and a sign so the colour is
never the only channel. Sparklines are one colour for every row; colouring them
by level would double-encode what the number beside them already says.

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
