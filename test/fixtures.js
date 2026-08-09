// SYNTHETIC TEST FIXTURES — NOT MEASUREMENTS.
//
// Everything in this file is invented to exercise the arithmetic. It exists
// only so the statistics can be proved correct before the laboratory file
// arrives. It is never written into data/, never loaded by the server, and
// never reaches an API response. The one and only source of real numbers is
// data/almaty_trap_clean.{json,csv}.

import { indexRows } from '../src/load.js';
import { addDays } from '../src/lib/util.js';

/**
 * @param {{start:string, taxa:Record<string, number[]>, skip?:string[],
 *          group?:Record<string,string>, weather?:object}} spec
 * Each taxon maps to an array of daily counts starting at `start`.
 * Dates listed in `skip` are omitted entirely — that is how a gap is
 * represented, exactly as in the real file.
 */
export function makeDataset(spec) {
  const skip = new Set(spec.skip ?? []);
  const rows = [];
  const names = Object.keys(spec.taxa);
  const len = Math.max(...names.map((t) => spec.taxa[t].length));

  for (let i = 0; i < len; i++) {
    const date = addDays(spec.start, i);
    if (skip.has(date)) continue;
    for (const taxon of names) {
      const v = spec.taxa[taxon][i];
      if (v === undefined) continue;
      rows.push({
        date,
        taxon,
        group: spec.group?.[taxon] ?? 'травы',
        count_per_m3: v,
        temp_c: spec.weather?.temp_c ?? 20,
        humidity_pct: spec.weather?.humidity_pct ?? 45,
        wind_ms: spec.weather?.wind_ms ?? 3
      });
    }
  }
  return indexRows(rows, 'SYNTHETIC-FIXTURE');
}

/** Flat baseline then a sharp rise — used to pin the ramp detector.
 *  13 days at 10 (01-13 Aug), then 3 days at 60 (14-16 Aug).
 *    14 Aug: ma3 = (10+10+60)/3 = 26.67  -> below the floor of 40
 *    15 Aug: ma3 = (10+60+60)/3 = 43.33, baseline (03-12 Aug) = 10,
 *            ratio 4.33 -> FIRES. This is the first trigger, not the 16th.
 */
export function rampFixture() {
  const counts = [...new Array(13).fill(10), 60, 60, 60];
  return makeDataset({ start: '2025-08-01', taxa: { Artemisia: counts } });
}
