// Single source of truth for every constant that carries scientific meaning.
// Nothing here may be changed without a corresponding change to the docs and
// the assertions in test/dataset.test.js.

// ── Laboratory threshold scale — POLLEN ONLY (grains/m3) ──────────────────
// 1-10 low | 11-50 moderate | 51-200 high | >200 critical
// Note the scale starts at 1: a count of 0 is "none", not "low".
export const POLLEN_SCALE = [
  { level: 'none', min: 0, max: 0 },
  { level: 'low', min: 1, max: 10 },
  { level: 'moderate', min: 11, max: 50 },
  { level: 'high', min: 51, max: 200 },
  { level: 'critical', min: 201, max: Infinity }
];

// ── Clinical thresholds — MOLD ONLY (spores/m3), Gravesen 1979 ────────────
// These are NOT a 4-step scale. A mold taxon is either below or above its
// single clinical threshold. The pollen scale must never be applied here.
export const MOLD_THRESHOLDS = {
  'Alternaria alternata': 100,
  'Cladosporium herbarum': 3000
};

export const MOLD_THRESHOLD_SOURCE = 'Gravesen 1979';

// ── Declared measurement gaps ────────────────────────────────────────────
// Used ONLY to cross-check what the loaded file actually contains. The
// authoritative gap definition at runtime is "this date is absent from the
// dataset". See src/load.js#reconcileGaps.
export const DECLARED_GAPS = [
  { from: '2025-06-02', to: '2025-06-29' },
  { from: '2025-09-01', to: '2025-09-28' },
  { from: '2025-11-17', to: '2026-03-25' },
  { from: '2026-06-01', to: '2026-06-30' },
  { from: '2026-07-09', to: '2026-07-12' }
];

// ── Declared collinear taxon pairs (log-scale Pearson r) ─────────────────
// Per ACCEPTANCE.md. Cross-check only: correlations used at runtime are
// computed from the data. All four values below reproduce exactly.
export const DECLARED_CORRELATIONS = [
  { a: 'Salix', b: 'Ulmus', r: 0.893 },
  { a: 'Cannabaceae', b: 'Chenopodiaceae', r: 0.823 },
  { a: 'Artemisia', b: 'Chenopodiaceae', r: 0.73 },
  { a: 'Ambrosia', b: 'Artemisia', r: 0.71 }
];

// Taxa at or above this log-scale correlation cannot be statistically
// separated and are collapsed into one feature before model fitting.
export const INSEPARABLE_R = 0.8;

// A correlation estimated from a handful of co-occurring days is not evidence
// of collinearity. Two taxa that are each non-zero on seven days, and happen
// to share those days, score r = 1.00 and mean nothing. Pairs below this many
// days on which BOTH taxa were non-zero are reported but never grouped.
// Judgement call, not derived from the data — see README.
export const MIN_CO_NONZERO_DAYS = 20;

// ── Ramp detector ────────────────────────────────────────────────────────
// Fires when BOTH hold:
//   (a) 3-day moving average >= RAMP_MIN_MA3
//   (b) that average / mean of the preceding RAMP_BASELINE_DAYS >= RAMP_MIN_RATIO
export const RAMP_MA_DAYS = 3;
export const RAMP_MIN_MA3 = 40;
export const RAMP_BASELINE_DAYS = 10;
export const RAMP_MIN_RATIO = 1.6;

// The spec says "the preceding 10 days" without stating what they precede.
// 'window'  → the 10 days immediately before the 3-day window (d-12 .. d-3).
//             Non-overlapping, so the baseline is not contaminated by the rise
//             it is meant to detect. This is the defensible default.
// 'day'     → the 10 days immediately before the evaluated day (d-10 .. d-1),
//             which overlaps the 3-day window by two days.
// Flip this one constant if the dataset assertion says otherwise.
export const RAMP_BASELINE_ANCHOR = 'window';

// ── Ramp performance ─────────────────────────────────────────────────────
// A trigger is confirmed if a critical day follows it within this many days.
// The horizon is forward-only: a warning that arrives after the event is not
// a warning.
export const RAMP_PRECISION_HORIZON_DAYS = 10;

// The pollen scale's critical band is >200, so a critical day is >200 — not
// >=200. Kept as its own constant so the two can never drift apart.
export const CRITICAL_ABOVE = 200;

// A trigger begins a sustained sequence when another trigger follows it within
// this many days. An isolated spike (2025-07-13, 24 days before the next
// trigger) does not.
export const RAMP_SUSTAINED_MAX_GAP_DAYS = 3;

// ── Season bounds ────────────────────────────────────────────────────────
// Season start/end by the cumulative percentage method.
export const SEASON_START_PCT = 0.025;
export const SEASON_END_PCT = 0.975;

// ── Season windows ───────────────────────────────────────────────────────
// SPIn is an integral over a SEASON, not over a calendar year. Summing a whole
// year conflates two seasons and inflates the figure — that is exactly how
// 7592 (all-time, both seasons) was once mistaken for the 2025 SPIn of 7023.
//
// Keyed by the Latin part of the taxon name. Anything not listed falls back to
// the calendar year, and the response always states the window it used.
export const SEASON_WINDOWS = {
  Artemisia: { fromMonthDay: '07-01', toMonthDay: '10-31' },
  Ambrosia: { fromMonthDay: '07-01', toMonthDay: '10-31' },
  Chenopodiaceae: { fromMonthDay: '07-01', toMonthDay: '10-31' },
  Cannabaceae: { fromMonthDay: '07-01', toMonthDay: '10-31' }
};

// ── Season state machine ─────────────────────────────────────────────────
export const STATE_PEAK_FRACTION = 0.8; // >= 80% of peak-to-date => 'peak'
export const STATE_ENDED_FRACTION = 0.25; // < 25% of peak, past peak => 'ended'

// ── Season pace ──────────────────────────────────────────────────────────
export const PACE_TAXON = 'Artemisia';
export const PACE_START_MONTH = 7; // 1 July
export const PACE_START_DAY = 1;

// ── Personal index ───────────────────────────────────────────────────────
// Piecewise-linear mapping of the laboratory scale onto 0..1, so that the
// breakpoints of the index are exactly the breakpoints of the lab scale.
export const PERSONAL_BREAKPOINTS = [
  { count: 0, score: 0 },
  { count: 10, score: 0.25 },
  { count: 50, score: 0.5 },
  { count: 200, score: 0.75 },
  { count: 1000, score: 1 }
];

// ── Attribution model ────────────────────────────────────────────────────
export const SEVERITY_POSITIVE_AT = 2; // severity >= 2 counts as a bad day
export const LOGREG_L2_LAMBDA = 1;
export const LOGREG_ITERATIONS = 4000;
export const LOGREG_LEARNING_RATE = 0.1;

// Confidence banding for attribution, by number of usable logged days and
// class balance. Below MIN we refuse to return weights at all.
export const ATTRIB_MIN_DAYS = 8;
export const ATTRIB_MEDIUM_DAYS = 15;
export const ATTRIB_HIGH_DAYS = 30;
export const ATTRIB_MIN_PER_CLASS = 3;
export const ATTRIB_HIGH_PER_CLASS = 8;

// ── Discriminating days ──────────────────────────────────────────────────
// A pair is worth examining from this correlation upward; a day discriminates
// when one taxon is 'high' or above and its correlate is 'low' or 'none'.
export const DISCRIMINATING_MIN_R = 0.6;
export const DISCRIMINATING_HIGH_AT = 51;
export const DISCRIMINATING_LOW_AT = 10;

// ── Groups present in the dataset ────────────────────────────────────────
export const GROUPS = ['древесные', 'травы', 'плесень'];
export const MOLD_GROUP = 'плесень';

export const PORT = Number(process.env.PORT) || 4000;
