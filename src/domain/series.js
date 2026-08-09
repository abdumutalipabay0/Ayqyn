// Series access with the no-interpolation guarantee.
//
// Every rolling window in this service goes through windowValues(). A window
// that spans an unmeasured day returns null with a reason — it does NOT
// silently average the days that happen to be present. Averaging 3 "days"
// that are really 2 days either side of a four-week gap is exactly the
// interpolation this product must not do.

import { addDays, dateRange, yearOf } from '../lib/util.js';
import { countOf } from '../load.js';

/**
 * Values for `taxon` over the inclusive calendar window [from, to].
 * @returns {{ok:true, values:number[], dates:string[]}
 *         | {ok:false, reason:string, missing:string[]}}
 */
export function windowValues(ds, taxon, from, to) {
  const dates = dateRange(from, to);
  const missing = dates.filter((d) => !ds.observedDates.has(d));
  if (missing.length > 0) {
    return { ok: false, reason: 'gap_in_window', missing };
  }
  if (dates.some((d) => d < ds.firstDate || d > ds.lastDate)) {
    return {
      ok: false,
      reason: 'outside_record',
      missing: dates.filter((d) => d < ds.firstDate || d > ds.lastDate)
    };
  }
  return { ok: true, dates, values: dates.map((d) => countOf(ds, taxon, d) ?? 0) };
}

/** Mean over a fully-measured calendar window, or null with a reason. */
export function windowMean(ds, taxon, from, to) {
  const w = windowValues(ds, taxon, from, to);
  if (!w.ok) return { ok: false, reason: w.reason, missing: w.missing };
  const s = w.values.reduce((a, b) => a + b, 0);
  return { ok: true, mean: s / w.values.length, n: w.values.length };
}

/** Trailing moving average ending on `date` (inclusive), `days` long. */
export function movingAverage(ds, taxon, date, days) {
  return windowMean(ds, taxon, addDays(date, -(days - 1)), date);
}

/** Measured dates for a taxon within a calendar year, ascending. */
export function taxonYearDates(ds, taxon, year) {
  return ds.dates.filter((d) => yearOf(d) === year);
}

/** Daily series for a taxon within a year, over measured days only.
 *  Unmeasured days are simply not present — they are reported separately by
 *  callers so a consumer can see the shape of the record. */
export function taxonYearSeries(ds, taxon, year) {
  if (!ds.byTaxon.has(taxon)) return null;
  return taxonYearDates(ds, taxon, year).map((date) => ({
    date,
    count_per_m3: countOf(ds, taxon, date) ?? 0
  }));
}

/** Paired measured values for two taxa across every day both were measured. */
export function pairedValues(ds, taxonA, taxonB) {
  const dates = ds.dates.filter(
    (d) => countOf(ds, taxonA, d) !== undefined && countOf(ds, taxonB, d) !== undefined
  );
  return {
    dates,
    a: dates.map((d) => countOf(ds, taxonA, d)),
    b: dates.map((d) => countOf(ds, taxonB, d))
  };
}
