// Season descriptors: Seasonal Pollen Integral (SPIn), season bounds by the
// 2.5% / 97.5% cumulative method, and the peak.
//
// SPIn is an integral over a SEASON WINDOW, not over a calendar year. For
// Artemisia the window is 1 July – 31 October. Summing the whole record
// instead gives the all-time total across both seasons, which is a different
// quantity and must never be presented as SPIn.
//
// Because the record has gaps, SPIn is a lower bound on the true integral and
// every response says so.

import { SEASON_START_PCT, SEASON_END_PCT, SEASON_WINDOWS } from '../config.js';
import { dateRange, yearOf } from '../lib/util.js';
import { countOf } from '../load.js';

/** Latin part of "Artemisia (полынь)". */
export function latinOf(taxon) {
  return taxon.split(' (')[0].trim();
}

/** The season window for a taxon in a given year, and where it came from. */
export function seasonWindow(taxon, year, override = {}) {
  if (override.from && override.to) {
    return { from: override.from, to: override.to, window_source: 'request' };
  }
  const cfg = SEASON_WINDOWS[latinOf(taxon)];
  if (cfg) {
    return {
      from: `${year}-${cfg.fromMonthDay}`,
      to: `${year}-${cfg.toMonthDay}`,
      window_source: 'configured season window'
    };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31`, window_source: 'calendar year (no season window configured)' };
}

/**
 * @returns {{ series, spin, season_start, season_end, peak, ... } | null}
 */
export function seasonSummary(ds, taxon, year, override = {}) {
  if (!ds.byTaxon.has(taxon)) return null;

  const win = seasonWindow(taxon, year, override);
  const calendar = dateRange(win.from, win.to);
  const measured = calendar.filter((d) => ds.observedDates.has(d));
  const unmeasured = calendar.filter((d) => !ds.observedDates.has(d));

  const series = measured.map((date) => ({
    date,
    count_per_m3: countOf(ds, taxon, date) ?? 0
  }));
  const spin = series.reduce((a, r) => a + r.count_per_m3, 0);

  // Peak within the window; ties resolved to the earliest date so the answer
  // is deterministic.
  let peak = null;
  for (const r of series) {
    if (peak === null || r.count_per_m3 > peak.count_per_m3) {
      peak = { date: r.date, count_per_m3: r.count_per_m3 };
    }
  }
  if (peak && peak.count_per_m3 === 0) peak = null;

  // Cumulative bounds within the window. With a zero integral the season is
  // undefined, not day one.
  let seasonStart = null;
  let seasonEnd = null;
  if (spin > 0) {
    const startTarget = SEASON_START_PCT * spin;
    const endTarget = SEASON_END_PCT * spin;
    let cum = 0;
    for (const r of series) {
      cum += r.count_per_m3;
      if (seasonStart === null && cum >= startTarget) seasonStart = r.date;
      if (seasonEnd === null && cum >= endTarget) {
        seasonEnd = r.date;
        break;
      }
    }
  }

  const allTime = ds.dates.reduce((a, d) => a + (countOf(ds, taxon, d) ?? 0), 0);
  const calendarYear = ds.dates
    .filter((d) => yearOf(d) === year)
    .reduce((a, d) => a + (countOf(ds, taxon, d) ?? 0), 0);

  return {
    taxon,
    year,
    window: { from: win.from, to: win.to, source: win.window_source },
    series,
    seasonal_pollen_integral: spin,
    spi_unit: 'grains*day/m3',
    spi_is_lower_bound: unmeasured.length > 0,
    measured_days: measured.length,
    unmeasured_days_in_window: unmeasured.length,
    unmeasured_dates_in_window: unmeasured,
    season_start: seasonStart,
    season_end: seasonEnd,
    season_method: `cumulative ${SEASON_START_PCT * 100}% / ${SEASON_END_PCT * 100}% within the window`,
    peak,
    // Reported alongside so the two are never confused with SPIn.
    calendar_year_total: calendarYear,
    all_time_total: allTime,
    totals_note:
      'seasonal_pollen_integral covers the season window only. all_time_total spans every measured day in the record and is not an SPIn.'
  };
}
