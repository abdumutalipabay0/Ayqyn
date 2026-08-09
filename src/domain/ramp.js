// Ramp detector and season-state classifier.
//
// Ramp fires when BOTH hold:
//   (a) 3-day moving average >= 40 grains/m3
//   (b) that average / mean of the preceding 10 days >= 1.60
//
// Both windows must be fully measured. On a day where either window touches a
// gap the detector returns "undetermined" — never false. Reporting "no ramp"
// when we simply could not look is how a season gets missed.

import {
  RAMP_MA_DAYS,
  RAMP_MIN_MA3,
  RAMP_BASELINE_DAYS,
  RAMP_MIN_RATIO,
  RAMP_BASELINE_ANCHOR,
  RAMP_PRECISION_HORIZON_DAYS,
  RAMP_SUSTAINED_MAX_GAP_DAYS,
  CRITICAL_ABOVE,
  STATE_PEAK_FRACTION,
  STATE_ENDED_FRACTION
} from '../config.js';
import { addDays, dateRange, diffDays, yearOf } from '../lib/util.js';
import { countOf } from '../load.js';
import { movingAverage, windowMean } from './series.js';

/** Calendar window of the baseline, per the configured anchor. */
export function baselineWindow(date) {
  if (RAMP_BASELINE_ANCHOR === 'day') {
    return { from: addDays(date, -RAMP_BASELINE_DAYS), to: addDays(date, -1) };
  }
  // 'window': the 10 days immediately before the 3-day moving-average window.
  const maStart = addDays(date, -(RAMP_MA_DAYS - 1));
  return { from: addDays(maStart, -RAMP_BASELINE_DAYS), to: addDays(maStart, -1) };
}

/**
 * @returns {{status:'fired'|'not_fired'|'undetermined', ma3:number|null,
 *            baseline:number|null, ratio:number|null, reason?:string}}
 */
export function evaluateRamp(ds, taxon, date) {
  const ma = movingAverage(ds, taxon, date, RAMP_MA_DAYS);
  if (!ma.ok) {
    return { status: 'undetermined', ma3: null, baseline: null, ratio: null, reason: ma.reason };
  }
  const bw = baselineWindow(date);
  const base = windowMean(ds, taxon, bw.from, bw.to);
  if (!base.ok) {
    return {
      status: 'undetermined',
      ma3: ma.mean,
      baseline: null,
      ratio: null,
      reason: base.reason
    };
  }

  const condA = ma.mean >= RAMP_MIN_MA3;
  // A zero baseline makes the ratio undefined. Any rise off a true zero is an
  // unbounded increase, so condition (b) is satisfied; we report the ratio as
  // null rather than printing Infinity.
  const ratio = base.mean === 0 ? null : ma.mean / base.mean;
  const condB = base.mean === 0 ? ma.mean > 0 : ratio >= RAMP_MIN_RATIO;

  return {
    status: condA && condB ? 'fired' : 'not_fired',
    ma3: ma.mean,
    baseline: base.mean,
    ratio,
    baseline_window: bw,
    conditions: { ma3_at_least: condA, ratio_at_least: condB }
  };
}

/**
 * Every ramp trigger for `taxon` inside a window, plus the days the detector
 * could not evaluate.
 *
 * The scan window matters: it is not a cosmetic filter. Artemisia fires on
 * 2025-07-13 as well as 2025-08-06, so a July-start window and an August-start
 * window give different "first trigger" answers. The window used is always
 * returned with the result.
 */
export function scanRamps(ds, taxon, from, to) {
  const triggers = [];
  const undetermined = [];
  for (const date of ds.dates) {
    if (date < from || date > to) continue;
    const r = evaluateRamp(ds, taxon, date);
    if (r.status === 'undetermined') {
      undetermined.push({ date, reason: r.reason });
      continue;
    }
    if (r.status === 'fired') {
      triggers.push({
        date,
        ma3: r.ma3,
        baseline: r.baseline,
        ratio: r.ratio === null ? null : Math.round(r.ratio * 1000) / 1000
      });
    }
  }
  return {
    window: { from, to },
    triggers,
    trigger_count: triggers.length,
    first_trigger: triggers[0]?.date ?? null,
    first_trigger_detail: triggers[0] ?? null,
    days_not_evaluable: undetermined.length,
    not_evaluable_dates: undetermined
  };
}

/** First date in `year` on which the ramp fired for `taxon`, or null.
 *  Days the detector could not evaluate are listed separately. */
export function firstRamp(ds, taxon, year, window = null) {
  const from = window?.from ?? `${year}-01-01`;
  const to = window?.to ?? `${year}-12-31`;
  const scan = scanRamps(ds, taxon, from, to);
  return {
    date: scan.first_trigger,
    detail: scan.first_trigger_detail,
    undetermined_before: scan.not_evaluable_dates.filter(
      (u) => scan.first_trigger === null || u.date < scan.first_trigger
    ),
    scan
  };
}

/**
 * How well the detector performed over a window.
 *
 * A trigger is CONFIRMED when a critical day (>200 grains/m3) falls within
 * RAMP_PRECISION_HORIZON_DAYS after it. Forward-only: a critical day that
 * precedes the trigger does not vindicate it.
 *
 * A trigger with no critical day in its horizon is a FALSE ALARM only if that
 * horizon was fully measured. If the horizon runs into a gap we could not have
 * seen a critical day even had there been one, so the trigger is UNVERIFIABLE
 * and is excluded from the denominator rather than counted against the
 * detector. Charging the detector for days the trap did not run would
 * understate it just as silently as bridging a gap would overstate it.
 *
 * Nothing here is tuned. Raising the moving-average floor from 40 to 45 would
 * remove the one false alarm and print 100%, but a threshold chosen on the
 * only season available to evaluate it is not a measurement of anything.
 */
export function rampPerformance(ds, taxon, from, to) {
  const scan = scanRamps(ds, taxon, from, to);

  const criticalDays = ds.dates
    .filter((d) => d >= from && d <= to)
    .filter((d) => (countOf(ds, taxon, d) ?? 0) > CRITICAL_ABOVE)
    .map((d) => ({ date: d, count_per_m3: countOf(ds, taxon, d) }));
  const criticalDates = criticalDays.map((c) => c.date);

  const evaluated = scan.triggers.map((t) => {
    const horizonEnd = addDays(t.date, RAMP_PRECISION_HORIZON_DAYS);
    const horizon = dateRange(t.date, horizonEnd);
    const hit = criticalDates.find((c) => c >= t.date && c <= horizonEnd) ?? null;
    const unmeasuredInHorizon = horizon.filter(
      (d) => d >= ds.firstDate && d <= ds.lastDate && !ds.observedDates.has(d)
    );
    let outcome;
    if (hit) outcome = 'confirmed';
    else if (unmeasuredInHorizon.length > 0) outcome = 'unverifiable';
    else outcome = 'false_alarm';
    return {
      ...t,
      outcome,
      horizon: { from: t.date, to: horizonEnd },
      critical_day: hit,
      lead_time_days: hit ? diffDays(t.date, hit) : null,
      unmeasured_days_in_horizon: unmeasuredInHorizon
    };
  });

  const confirmed = evaluated.filter((t) => t.outcome === 'confirmed');
  const falseAlarms = evaluated.filter((t) => t.outcome === 'false_alarm');
  const unverifiable = evaluated.filter((t) => t.outcome === 'unverifiable');
  const denominator = confirmed.length + falseAlarms.length;

  // First trigger that begins a run, rather than an isolated spike.
  let firstSustained = null;
  for (let i = 0; i < scan.triggers.length - 1; i++) {
    if (diffDays(scan.triggers[i].date, scan.triggers[i + 1].date) <= RAMP_SUSTAINED_MAX_GAP_DAYS) {
      firstSustained = scan.triggers[i].date;
      break;
    }
  }

  const firstCritical = criticalDays[0] ?? null;

  return {
    taxon,
    window: { from, to },
    detector: {
      moving_average_days: RAMP_MA_DAYS,
      min_moving_average: RAMP_MIN_MA3,
      baseline_days: RAMP_BASELINE_DAYS,
      min_ratio: RAMP_MIN_RATIO,
      baseline_anchor: 'non-overlapping: the 10 days immediately before the 3-day window',
      thresholds_note:
        'Thresholds are fixed, not tuned on this season. Raising min_moving_average to 45 would remove the single false alarm and report 100% precision; that figure would be fitted to the one season available to evaluate it.'
    },
    triggers: evaluated,
    trigger_count: scan.trigger_count,
    first_trigger: scan.first_trigger,
    first_sustained_trigger: firstSustained,
    sustained_definition: `a trigger followed by another within ${RAMP_SUSTAINED_MAX_GAP_DAYS} days`,
    critical_days: criticalDays,
    first_critical_day: firstCritical,
    lead_time_from_first_sustained_days:
      firstSustained && firstCritical ? diffDays(firstSustained, firstCritical.date) : null,
    precision: {
      definition: `a critical day (>${CRITICAL_ABOVE} grains/m3) within ${RAMP_PRECISION_HORIZON_DAYS} days after the trigger`,
      horizon_days: RAMP_PRECISION_HORIZON_DAYS,
      critical_above: CRITICAL_ABOVE,
      confirmed: confirmed.length,
      false_alarms: falseAlarms.length,
      unverifiable: unverifiable.length,
      denominator,
      value: denominator === 0 ? null : confirmed.length / denominator,
      percent: denominator === 0 ? null : Math.round((confirmed.length / denominator) * 100),
      note:
        unverifiable.length > 0
          ? `${unverifiable.length} trigger(s) had a gap inside the verification horizon and are excluded from the denominator.`
          : null
    },
    false_alarm_dates: falseAlarms.map((t) => t.date),
    unverifiable_dates: unverifiable.map((t) => t.date),
    days_not_evaluable: scan.days_not_evaluable,
    not_evaluable_dates: scan.not_evaluable_dates,
    not_evaluable_note:
      'These days fall inside the window but the 3-day or baseline window overlapped a measurement gap, so the detector could not be evaluated. They are neither triggers nor non-triggers.'
  };
}

/**
 * Season state on `date`, using only information available up to that date.
 *
 *   not_started — nothing measured yet this season, or no ramp and the 3-day
 *                 average is still below the ramp floor
 *   ramping     — ramp has fired and the curve is still climbing toward its
 *                 highest point so far
 *   peak        — 3-day average is within 80% of the highest 3-day average
 *                 seen so far this season
 *   declining   — past that peak, still above 25% of it
 *   ended       — past the peak and below 25% of it
 */
export function seasonState(ds, taxon, date) {
  const year = yearOf(date);
  const upto = ds.dates.filter((d) => yearOf(d) === year && d <= date);
  if (upto.length === 0) {
    return { state: 'not_started', reason: 'no measurements this season' };
  }

  let peakMa = 0;
  let peakDate = null;
  let rampDate = null;
  let latestMa = null;

  for (const d of upto) {
    const ma = movingAverage(ds, taxon, d, RAMP_MA_DAYS);
    if (ma.ok) {
      if (ma.mean > peakMa) {
        peakMa = ma.mean;
        peakDate = d;
      }
      if (d === date) latestMa = ma.mean;
    }
    if (rampDate === null) {
      const r = evaluateRamp(ds, taxon, d);
      if (r.status === 'fired') rampDate = d;
    }
  }

  const seasonTotal = upto.reduce((a, d) => {
    const row = ds.byTaxon.get(taxon)?.get(d);
    return a + (row ? row.count_per_m3 : 0);
  }, 0);

  const detail = {
    ma3: latestMa,
    peak_ma3_to_date: peakMa || null,
    peak_ma3_date: peakDate,
    first_ramp_date: rampDate,
    season_total_to_date: seasonTotal
  };

  if (seasonTotal === 0) return { state: 'not_started', ...detail };
  if (latestMa === null) {
    return { state: 'undetermined', reason: 'latest 3-day window spans a gap', ...detail };
  }

  // Has the season demonstrably begun? Either the detector fired, or the
  // 3-day average cleared the detector's floor at some point.
  //
  // Testing only "the detector never fired AND today is quiet" was wrong: a
  // taxon that rose to a 3-day average of 185, peaked in spring and finished
  // never fires the detector on the day you ask about it, and was being
  // reported as not_started while carrying a season total in the thousands.
  const begun = rampDate !== null || peakMa >= RAMP_MIN_MA3;

  if (!begun) {
    // Under way but still below the floor. It can be rising or already over,
    // but it cannot be at a "peak" — saying so of 27 grains would overstate it.
    if (latestMa === 0) {
      return {
        state: peakMa > 0 && peakDate !== null && date > peakDate ? 'ended' : 'not_started',
        ...detail
      };
    }
    return {
      state: latestMa >= STATE_PEAK_FRACTION * peakMa ? 'ramping' : 'declining',
      ...detail
    };
  }

  if (peakMa > 0 && latestMa >= STATE_PEAK_FRACTION * peakMa) return { state: 'peak', ...detail };
  if (peakDate !== null && date > peakDate) {
    return {
      state: latestMa < STATE_ENDED_FRACTION * peakMa ? 'ended' : 'declining',
      ...detail
    };
  }
  return { state: 'ramping', ...detail };
}
