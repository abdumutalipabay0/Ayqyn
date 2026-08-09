// Route handlers. Each returns {status, body}. No framework, no middleware
// chain — the surface is small enough that a plain table is clearer.

import {
  RAMP_MIN_MA3,
  RAMP_MIN_RATIO,
  RAMP_BASELINE_DAYS,
  RAMP_MA_DAYS,
  PACE_TAXON,
  POLLEN_SCALE,
  MOLD_THRESHOLDS,
  MOLD_THRESHOLD_SOURCE
} from './config.js';
import { isDateString, yearOf } from './lib/util.js';
import { loadDataset, resolveTaxonName } from './load.js';
import { dayReport, pollenTotalSeries } from './domain/day.js';
import { seasonSummary, seasonWindow } from './domain/season.js';
import { seasonState, scanRamps, rampPerformance } from './domain/ramp.js';
import { seasonPace } from './domain/pace.js';
import { attribute } from './domain/attribute.js';
import { personalIndex } from './domain/personal.js';
import { discriminatingDays } from './domain/discriminating.js';
// Knowledge layer, deliberately imported last and from its own directory:
// nothing below this line computes a measured figure.
import { crossReactivityFor, TABLE_NOTE } from './knowledge/cross-reactivity.js';
import { SYMPTOM_THRESHOLDS, THRESHOLD_NOTE } from './knowledge/symptom-thresholds.js';

const bad = (msg, extra = {}) => ({ status: 400, body: { error: msg, ...extra } });
const notFound = (msg, extra = {}) => ({ status: 404, body: { error: msg, ...extra } });

/** Resolves a taxon or returns a ready-made error response. */
function taxonOr(ds, name) {
  const r = resolveTaxonName(ds, name);
  if (r.ok) return { taxon: r.taxon };
  if (r.reason === 'ambiguous') {
    return { err: bad(`"${name}" matches more than one taxon`, { candidates: r.candidates }) };
  }
  return { err: notFound(`Unknown taxon "${name}"`, { known_taxa: ds.taxa }) };
}

/** GET /api/meta — what the record actually contains. */
export function getMeta() {
  const ds = loadDataset();
  return {
    status: 200,
    body: {
      source_file: ds.source,
      record: { first_date: ds.firstDate, last_date: ds.lastDate },
      counts: ds.counts,
      // `groups` is the laboratory's own classification, carried through from
      // the CSV rather than re-derived here. A taxon whose row carried no
      // group lands in `null` and is not quietly filed under "травы".
      taxa: {
        pollen: ds.pollenTaxa,
        mold: ds.moldTaxa,
        // Ranked by the highest single-day count in the record. Published so a
        // client can offer "the taxa worth naming" without fetching 48 series
        // to find out which those are.
        by_peak: ds.taxa
          .map((t) => {
            let peak = 0;
            let total = 0;
            for (const rows of ds.byDate.values()) {
              const r = rows.find((x) => x.taxon === t);
              if (!r) continue;
              if (r.count_per_m3 > peak) peak = r.count_per_m3;
              total += r.count_per_m3;
            }
            return { taxon: t, peak, total, is_mold: ds.moldTaxa.includes(t) };
          })
          .sort((a, b) => b.peak - a.peak),
        groups: Object.fromEntries(
          [...new Set(ds.taxa.map((t) => ds.taxonGroup.get(t) ?? null))].map((g) => [
            g ?? 'без группы',
            ds.taxa.filter((t) => (ds.taxonGroup.get(t) ?? null) === g)
          ])
        )
      },
      // The threshold scale is data, not presentation. It is published here so
      // no client has to hard-code a band edge.
      scale: {
        pollen: POLLEN_SCALE.map((b) => ({
          level: b.level,
          min: b.min,
          max: Number.isFinite(b.max) ? b.max : null
        })),
        pollen_unit: 'grains/m3',
        mold: MOLD_THRESHOLDS,
        mold_unit: 'spores/m3',
        mold_threshold_source: MOLD_THRESHOLD_SOURCE,
        mold_note:
          'Mold is judged against single clinical thresholds, never against the pollen scale.'
      },
      // Published symptom thresholds are a SECOND, independent reading. They
      // are kept out of `scale` on purpose: `scale` is the laboratory
      // instrument the product grades by, this is literature about people.
      symptom_thresholds: {
        measured: false,
        source_kind: 'literature',
        unit: 'grains/m3',
        note: THRESHOLD_NOTE,
        taxa: SYMPTOM_THRESHOLDS
      },
      gaps: {
        ranges: ds.gaps.ranges,
        total_unmeasured_days: ds.gaps.absentDates.length,
        declared_matches_file: ds.gaps.matches,
        undeclared_absent_dates: ds.gaps.undeclaredAbsent,
        declared_gap_dates_present_in_file: ds.gaps.declaredButPresent
      }
    }
  };
}

/** 1. GET /api/day/:date */
export function getDay(params) {
  const ds = loadDataset();
  const date = params.date;
  if (!isDateString(date)) return bad(`"${date}" is not a YYYY-MM-DD date`);
  return { status: 200, body: dayReport(ds, date) };
}

/** 2. GET /api/taxon/:name/season?year=&from=&to= */
export function getTaxonSeason(params, query) {
  const ds = loadDataset();
  const { taxon, err } = taxonOr(ds, params.name);
  if (err) return err;
  const year = query.year ? Number(query.year) : yearOf(ds.lastDate);
  if (!Number.isInteger(year)) return bad(`"${query.year}" is not a year`);

  const years = [...new Set(ds.dates.map(yearOf))].sort();
  if (!years.includes(year)) {
    return notFound(`No measurements in ${year}`, { years_available: years });
  }
  if ((query.from && !isDateString(query.from)) || (query.to && !isDateString(query.to))) {
    return bad('from/to must be YYYY-MM-DD');
  }
  return {
    status: 200,
    body: seasonSummary(ds, taxon, year, { from: query.from, to: query.to })
  };
}

/** 3. GET /api/season-state?date=&taxa= */
export function getSeasonState(_params, query) {
  const ds = loadDataset();
  const date = query.date ?? ds.lastDate;
  if (!isDateString(date)) return bad(`"${date}" is not a YYYY-MM-DD date`);

  const requested = query.taxa
    ? String(query.taxa)
        .split(',')
        .map((t) => resolveTaxonName(ds, t.trim()))
        .filter((r) => r.ok)
        .map((r) => r.taxon)
    : null;

  // "Major taxa": those that reached the 'high' band at some point this
  // season, PLUS any taxon whose season is currently moving. The second half
  // matters — Artemisia in early August 2026 has a season total in the
  // hundreds and is climbing, but has not yet touched 51 on a single day, and
  // a screen that hid the taxon actually rising would be worse than useless.
  const year = yearOf(date);
  const HIGH_BAND_MIN = POLLEN_SCALE.find((b) => b.level === 'high').min;
  const ACTIVE = new Set(['ramping', 'peak', 'declining']);

  const candidates =
    requested ??
    ds.pollenTaxa.filter((t) =>
      ds.dates.some((d) => yearOf(d) === year && d <= date && (ds.byTaxon.get(t)?.get(d)?.count_per_m3 ?? 0) > 0)
    );

  const evaluated = candidates.map((t) => ({ taxon: t, ...seasonState(ds, t, date) }));

  const shown = requested
    ? evaluated
    : evaluated.filter(
        (t) =>
          ACTIVE.has(t.state) ||
          ds.dates.some(
            (d) =>
              yearOf(d) === year &&
              d <= date &&
              (ds.byTaxon.get(t.taxon)?.get(d)?.count_per_m3 ?? 0) >= HIGH_BAND_MIN
          )
      );

  // Moving seasons first, then by how much of the season has accumulated.
  const rank = (s) => (ACTIVE.has(s.state) ? 0 : 1);
  shown.sort(
    (a, b) => rank(a) - rank(b) || (b.season_total_to_date ?? 0) - (a.season_total_to_date ?? 0)
  );

  return {
    status: 200,
    body: {
      as_of: date,
      as_of_measured: ds.observedDates.has(date),
      latest_measured_date: ds.lastDate,
      detector: {
        moving_average_days: RAMP_MA_DAYS,
        min_moving_average: RAMP_MIN_MA3,
        baseline_days: RAMP_BASELINE_DAYS,
        min_ratio: RAMP_MIN_RATIO
      },
      taxa: shown
    }
  };
}

/** 3b. GET /api/season-state/first-ramp?taxon=&year=&from=&to=
 *  The detector's triggers over a window. The window is not cosmetic: for
 *  Artemisia 2025 a July-start window answers 2025-07-13 and an August-start
 *  window answers 2025-08-06, so the window used is always returned. */
export function getFirstRamp(_params, query) {
  const ds = loadDataset();
  const { taxon, err } = taxonOr(ds, query.taxon ?? PACE_TAXON);
  if (err) return err;
  const year = query.year ? Number(query.year) : yearOf(ds.lastDate);
  if (!Number.isInteger(year)) return bad(`"${query.year}" is not a year`);
  if ((query.from && !isDateString(query.from)) || (query.to && !isDateString(query.to))) {
    return bad('from/to must be YYYY-MM-DD');
  }
  const win =
    query.from && query.to
      ? { from: query.from, to: query.to, window_source: 'request' }
      : seasonWindow(taxon, year);
  const scan = scanRamps(ds, taxon, win.from, win.to);
  return {
    status: 200,
    body: {
      taxon,
      year,
      window: { from: win.from, to: win.to, source: win.window_source },
      detector: {
        moving_average_days: RAMP_MA_DAYS,
        min_moving_average: RAMP_MIN_MA3,
        baseline_days: RAMP_BASELINE_DAYS,
        min_ratio: RAMP_MIN_RATIO,
        baseline_anchor: 'non-overlapping: the 10 days immediately before the 3-day window'
      },
      first_ramp_date: scan.first_trigger,
      first_ramp_detail: scan.first_trigger_detail,
      trigger_count: scan.trigger_count,
      triggers: scan.triggers,
      days_detector_could_not_evaluate: scan.days_not_evaluable,
      not_evaluable_dates: scan.not_evaluable_dates
    }
  };
}

/**
 * 3c. GET /api/ramp-performance?taxon=&window=
 *
 * `window` accepts "2025-07-01..2025-10-31" or a bare year "2025" (which uses
 * that taxon's configured season window). Defaults to the latest year's
 * season window. Every figure the UI shows comes from here — none of it is a
 * stored constant.
 */
export function getRampPerformance(_params, query) {
  const ds = loadDataset();
  const { taxon, err } = taxonOr(ds, query.taxon ?? PACE_TAXON);
  if (err) return err;

  const raw = String(query.window ?? '').trim();
  let from;
  let to;
  let source;

  if (raw.includes('..')) {
    [from, to] = raw.split('..').map((s) => s.trim());
    if (!isDateString(from) || !isDateString(to)) {
      return bad(`window "${raw}" must be "YYYY-MM-DD..YYYY-MM-DD" or a year`);
    }
    if (from > to) return bad(`window start ${from} is after its end ${to}`);
    source = 'request';
  } else {
    const year = raw === '' ? yearOf(ds.lastDate) : Number(raw);
    if (!Number.isInteger(year)) {
      return bad(`window "${raw}" must be "YYYY-MM-DD..YYYY-MM-DD" or a year`);
    }
    const win = seasonWindow(taxon, year);
    from = win.from;
    to = win.to;
    source = win.window_source;
  }

  const body = rampPerformance(ds, taxon, from, to);
  body.window.source = source;
  return { status: 200, body };
}

/** 4. GET /api/season-pace?as_of=&taxon= */
export function getSeasonPace(_params, query) {
  const ds = loadDataset();
  const asOf = query.as_of ?? ds.lastDate;
  if (!isDateString(asOf)) return bad(`"${asOf}" is not a YYYY-MM-DD date`);
  const { taxon, err } = taxonOr(ds, query.taxon ?? PACE_TAXON);
  if (err) return err;
  return { status: 200, body: seasonPace(ds, asOf, taxon) };
}

/** 5. POST /api/profile/attribute */
export function postAttribute(_params, _query, body) {
  const ds = loadDataset();
  const log = Array.isArray(body) ? body : body?.log;
  if (!Array.isArray(log)) {
    return bad('Body must be an array of {date, severity}, or {"log": [...]}');
  }
  const result = attribute(ds, log);
  if (result.error) return bad(result.error);
  return { status: 200, body: result };
}

/** 6. GET /api/personal-index?profile=&date= */
export function getPersonalIndex(_params, query) {
  const ds = loadDataset();
  const date = query.date ?? ds.lastDate;
  if (!isDateString(date)) return bad(`"${date}" is not a YYYY-MM-DD date`);
  if (!query.profile) {
    return bad('profile is required, e.g. ?profile=Artemisia:1,Betula:0.5', {
      known_taxa: ds.taxa
    });
  }
  return { status: 200, body: personalIndex(ds, date, query.profile) };
}

/** 7. GET /api/discriminating-days?taxon=&min_r=&limit= */
export function getDiscriminatingDays(_params, query) {
  const ds = loadDataset();
  let taxon = null;
  if (query.taxon) {
    const r = taxonOr(ds, query.taxon);
    if (r.err) return r.err;
    taxon = r.taxon;
  }
  const minR = query.min_r !== undefined ? Number(query.min_r) : undefined;
  if (minR !== undefined && !Number.isFinite(minR)) return bad(`"${query.min_r}" is not a number`);
  const limit = query.limit !== undefined ? Number(query.limit) : undefined;
  if (limit !== undefined && !Number.isInteger(limit)) return bad(`"${query.limit}" is not an integer`);
  return { status: 200, body: discriminatingDays(ds, { taxon, minR, limit }) };
}

/**
 * 8. GET /api/cross-reactivity?taxa=
 *
 * The one endpoint in this API that does not compute anything from the
 * measurement file. It reads a static table compiled from allergology
 * literature, and it says so at the top level of every response so a consumer
 * cannot mistake it for something the trap counted.
 */
export function getCrossReactivity(_params, query) {
  const ds = loadDataset();
  const raw = String(query.taxa ?? '').trim();
  if (!raw) {
    return bad('taxa is required, e.g. ?taxa=Artemisia,Betula', { known_taxa: ds.taxa });
  }

  const requested = raw.split(',').map((t) => t.trim()).filter(Boolean);
  const resolved = [];
  const unknown = [];
  for (const name of requested) {
    const r = resolveTaxonName(ds, name);
    if (r.ok) resolved.push(r.taxon);
    else unknown.push(name);
  }
  if (!resolved.length) {
    return notFound('None of the requested taxa are in this dataset', { unknown, known_taxa: ds.taxa });
  }

  return {
    status: 200,
    body: {
      // Flagged here, not in a footnote. Everything else this API returns is
      // measured; this is not.
      measured: false,
      source_kind: 'literature',
      note: TABLE_NOTE,
      requested: requested,
      unknown_taxa: unknown,
      taxa: crossReactivityFor(resolved)
    }
  };
}

/** 11. GET /api/series/pollen-total?from=&to= — the headline number, as a series. */
export function getPollenTotalSeries(_params, query) {
  const ds = loadDataset();
  const from = query.from ?? ds.firstDate;
  const to = query.to ?? ds.lastDate;
  if (!isDateString(from) || !isDateString(to)) return bad('from and to must be YYYY-MM-DD dates');
  const series = pollenTotalSeries(ds, from, to);
  return {
    status: 200,
    body: {
      from,
      to,
      unit: 'grains/m3',
      // Days the trap did not run are absent from `series`, not zero. The
      // count is published so a client can say how many are missing instead
      // of silently drawing a shorter line.
      measured_days: series.length,
      unmeasured_days_in_window: ds.gaps.absentDates.filter((d) => d >= from && d <= to).length,
      max_per_m3: series.reduce((a, r) => Math.max(a, r.total_per_m3), 0),
      series
    }
  };
}

export const ROUTES = [
  { method: 'GET', pattern: '/api/meta', handler: getMeta },
  { method: 'GET', pattern: '/api/day/:date', handler: getDay },
  { method: 'GET', pattern: '/api/taxon/:name/season', handler: getTaxonSeason },
  { method: 'GET', pattern: '/api/season-state/first-ramp', handler: getFirstRamp },
  { method: 'GET', pattern: '/api/ramp-performance', handler: getRampPerformance },
  { method: 'GET', pattern: '/api/season-state', handler: getSeasonState },
  { method: 'GET', pattern: '/api/season-pace', handler: getSeasonPace },
  { method: 'POST', pattern: '/api/profile/attribute', handler: postAttribute },
  { method: 'GET', pattern: '/api/personal-index', handler: getPersonalIndex },
  { method: 'GET', pattern: '/api/discriminating-days', handler: getDiscriminatingDays },
  { method: 'GET', pattern: '/api/cross-reactivity', handler: getCrossReactivity },
  { method: 'GET', pattern: '/api/series/pollen-total', handler: getPollenTotalSeries }
];
