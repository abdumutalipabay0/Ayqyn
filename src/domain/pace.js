// Season pace: cumulative Artemisia since 1 July, this season against last,
// on the same calendar date.
//
// Gaps are the whole difficulty here. If one of the two windows is missing
// days and the other is not, the ratio compares unlike things. We therefore
// report the measured-day count and the missing dates for each side, and set
// comparable=false when they differ, instead of quietly dividing.

import { PACE_START_MONTH, PACE_START_DAY, PACE_TAXON } from '../config.js';
import { dateRange, round, sameDayInYear, yearOf } from '../lib/util.js';
import { countOf } from '../load.js';


function pad(n) {
  return String(n).padStart(2, '0');
}

function windowStart(year) {
  return `${year}-${pad(PACE_START_MONTH)}-${pad(PACE_START_DAY)}`;
}

/** Cumulative sum over measured days only, plus the shape of the window. */
export function cumulativeSince(ds, taxon, from, to) {
  const all = dateRange(from, to);
  const measured = all.filter((d) => ds.observedDates.has(d));
  const missing = all.filter((d) => !ds.observedDates.has(d));
  const outsideRecord = all.filter((d) => d < ds.firstDate || d > ds.lastDate);
  const total = measured.reduce((a, d) => a + (countOf(ds, taxon, d) ?? 0), 0);
  return {
    from,
    to,
    cumulative: total,
    measured_days: measured.length,
    missing_days: missing.length,
    missing_dates: missing,
    days_outside_record: outsideRecord.length
  };
}

/**
 * @param {string} asOf  evaluation date; defaults to the latest measured day
 */
export function seasonPace(ds, asOf, taxon = PACE_TAXON) {
  const currentYear = yearOf(asOf);
  const previousYear = currentYear - 1;
  const prevAsOf = sameDayInYear(asOf, previousYear);

  if (prevAsOf === null) {
    return {
      taxon,
      as_of: asOf,
      comparable: false,
      reason: `${asOf} has no counterpart in ${previousYear} (29 February)`
    };
  }

  const current = cumulativeSince(ds, taxon, windowStart(currentYear), asOf);
  const previous = cumulativeSince(ds, taxon, windowStart(previousYear), prevAsOf);

  // Matched-dates comparison: keep only calendar days (month-day) that were
  // measured in BOTH seasons. This is the honest figure. The raw comparison
  // divides a 37-day sum by a 33-day sum and so overstates the gap purely
  // because four days are missing from the current season.
  const dayKey = (d) => d.slice(5);
  const curMeasured = dateRange(windowStart(currentYear), asOf).filter((d) =>
    ds.observedDates.has(d)
  );
  const prevMeasured = dateRange(windowStart(previousYear), prevAsOf).filter((d) =>
    ds.observedDates.has(d)
  );
  const curKeys = new Set(curMeasured.map(dayKey));
  const prevKeys = new Set(prevMeasured.map(dayKey));
  const shared = [...curKeys].filter((k) => prevKeys.has(k));
  const sharedSet = new Set(shared);

  const matchedCurrentDates = curMeasured.filter((d) => sharedSet.has(dayKey(d)));
  const matchedPreviousDates = prevMeasured.filter((d) => sharedSet.has(dayKey(d)));
  const matchedCurrent = matchedCurrentDates.reduce((a, d) => a + (countOf(ds, taxon, d) ?? 0), 0);
  const matchedPrevious = matchedPreviousDates.reduce((a, d) => a + (countOf(ds, taxon, d) ?? 0), 0);

  const excludedFromPrevious = prevMeasured.filter((d) => !sharedSet.has(dayKey(d)));
  const excludedFromCurrent = curMeasured.filter((d) => !sharedSet.has(dayKey(d)));

  // Headline ratio is previous / current: "last season was N times ahead of
  // this one at the same point". The inverse is returned alongside so the
  // consumer never has to guess which way round it is.
  const rawRatio = current.cumulative === 0 ? null : previous.cumulative / current.cumulative;
  const matchedRatio = matchedCurrent === 0 ? null : matchedPrevious / matchedCurrent;
  const matchedInverse = matchedPrevious === 0 ? null : matchedCurrent / matchedPrevious;

  const bothCovered = previous.days_outside_record === 0 && current.days_outside_record === 0;
  const sameShape = previous.missing_days === current.missing_days;

  return {
    taxon,
    as_of: asOf,
    window: `since ${pad(PACE_START_DAY)}.${pad(PACE_START_MONTH)}`,

    // ── The figure intended for display ──────────────────────────────────
    display: {
      method: 'matched dates only',
      previous: matchedPrevious,
      current: matchedCurrent,
      ratio: round(matchedRatio, 2),
      ratio_definition: 'previous season / current season, over days measured in both',
      ratio_current_over_previous: round(matchedInverse, 2),
      days_compared: matchedCurrentDates.length,
      missing_days_in_current_window: current.missing_days,
      missing_dates_in_current_window: current.missing_dates,
      excluded_from_previous: excludedFromPrevious,
      excluded_from_current: excludedFromCurrent,
      disclosure:
        current.missing_days > 0
          ? `${current.missing_days} day(s) are unmeasured in the current window (${current.missing_dates.join(', ')}). The matching calendar days have been excluded from the previous season so the two sums cover the same ${matchedCurrentDates.length} days.`
          : 'Both windows are fully measured; matched and raw comparisons coincide.'
    },

    // ── Raw comparison, kept for reference ───────────────────────────────
    raw: {
      method: 'all measured days in each window',
      previous: previous.cumulative,
      current: current.cumulative,
      ratio: round(rawRatio, 2),
      previous_days: previous.measured_days,
      current_days: current.measured_days,
      caveat:
        previous.measured_days === current.measured_days
          ? null
          : `Divides a ${previous.measured_days}-day sum by a ${current.measured_days}-day sum. Overstates the lag. Use display.ratio.`
    },

    current: { year: currentYear, ...current },
    previous: { year: previousYear, ...previous },

    // Backwards-compatible top-level ratio = the raw one, explicitly labelled.
    ratio: round(rawRatio, 2),
    ratio_definition: 'RAW previous/current. For display use display.ratio.',
    ratio_current_over_previous: round(
      previous.cumulative === 0 ? null : current.cumulative / previous.cumulative,
      2
    ),
    comparable: bothCovered && sameShape,
    comparability_note: bothCovered
      ? sameShape
        ? null
        : `Windows differ in coverage: ${current.missing_days} unmeasured day(s) this season vs ${previous.missing_days} last season. Raw ratio compares unequal windows; display.ratio does not.`
      : 'At least one window extends outside the measured record.'
  };
}
