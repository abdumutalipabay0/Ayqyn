// One measurement day.
//
// A date with no measurement returns measured:false with the enclosing gap —
// never an empty taxon list and never zeros. An empty list would read as
// "the trap ran and found nothing", which is a different and false claim.

import { yearOf } from '../lib/util.js';
import { describeObservation, isMold, pollenLevel } from './levels.js';

function enclosingGap(ds, date) {
  return ds.gaps.ranges.find((g) => date >= g.from && date <= g.to) ?? null;
}

function nearestMeasured(ds, date) {
  let before = null;
  let after = null;
  for (const d of ds.dates) {
    if (d < date) before = d;
    else if (d > date) {
      after = d;
      break;
    }
  }
  return { previous_measured_date: before, next_measured_date: after };
}

export function dayReport(ds, date) {
  if (!ds.observedDates.has(date)) {
    const outside = date < ds.firstDate || date > ds.lastDate;
    return {
      date,
      measured: false,
      reason: outside ? 'outside_record' : 'measurement_gap',
      detail: outside
        ? `The record covers ${ds.firstDate} to ${ds.lastDate}.`
        : 'The trap did not run on this date. No value is available and none is inferred.',
      gap: outside ? null : enclosingGap(ds, date),
      record: { first_date: ds.firstDate, last_date: ds.lastDate },
      ...nearestMeasured(ds, date)
    };
  }

  const rows = ds.byDate.get(date) ?? [];
  const nonZero = rows.filter((r) => r.count_per_m3 > 0);

  const pollenRows = nonZero.filter((r) => !isMold(r));
  const moldRows = nonZero.filter((r) => isMold(r));

  const pollenTotal = pollenRows.reduce((a, r) => a + r.count_per_m3, 0);
  const moldTotal = moldRows.reduce((a, r) => a + r.count_per_m3, 0);

  const taxa = nonZero
    .map(describeObservation)
    .sort((a, b) => b.count_per_m3 - a.count_per_m3);

  const weather = ds.weatherByDate.get(date) ?? { temp_c: null, humidity_pct: null, wind_ms: null };

  return {
    date,
    measured: true,
    year: yearOf(date),
    taxa,
    taxa_reported: rows.length,
    taxa_non_zero: nonZero.length,
    pollen: {
      total_per_m3: pollenTotal,
      unit: 'grains/m3',
      // The scale is defined for a taxon count; applied to the daily total it
      // is the standard summary used by the laboratory bulletin.
      level: pollenLevel(pollenTotal),
      dominant: pollenRows.length
        ? pollenRows.reduce((a, b) => (b.count_per_m3 > a.count_per_m3 ? b : a)).taxon
        : null
    },
    mold: {
      total_per_m3: moldTotal,
      unit: 'spores/m3',
      level: null,
      note: 'Mold is not graded on the pollen scale. See per-taxon clinical thresholds.',
      taxa: moldRows.map(describeObservation)
    },
    weather
  };
}
