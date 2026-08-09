// Discriminating days.
//
// Two taxa that almost always rise together carry almost no information about
// which of them a patient reacts to. The exceptions do: a day when Artemisia
// is high while Chenopodiaceae is low is worth many ordinary days for
// attribution. This endpoint finds those days so a patient can be asked how
// they felt on precisely the dates that would resolve the ambiguity.

import { DISCRIMINATING_MIN_R, DISCRIMINATING_HIGH_AT, DISCRIMINATING_LOW_AT } from '../config.js';
import { log1p, round } from '../lib/util.js';
import { countOf } from '../load.js';
import { correlationMatrix } from './groups.js';
import { pollenLevel } from './levels.js';

/**
 * @param {object} ds
 * @param {{minR?:number, taxon?:string, limit?:number}} opts
 */
export function discriminatingDays(ds, opts = {}) {
  const minR = opts.minR ?? DISCRIMINATING_MIN_R;
  const limit = opts.limit ?? 50;

  // Pollen only: the high/low cut-offs below ARE the pollen scale, so a mold
  // taxon must not be judged by them.
  const taxa = ds.pollenTaxa;
  const pairs = correlationMatrix(ds, taxa).filter((p) => p.r >= minR);

  const results = [];
  for (const p of pairs) {
    if (opts.taxon && p.a !== opts.taxon && p.b !== opts.taxon) continue;
    for (const date of ds.dates) {
      const va = countOf(ds, p.a, date);
      const vb = countOf(ds, p.b, date);
      if (va === undefined || vb === undefined) continue;

      let high;
      let low;
      if (va >= DISCRIMINATING_HIGH_AT && vb <= DISCRIMINATING_LOW_AT) {
        high = { taxon: p.a, count_per_m3: va };
        low = { taxon: p.b, count_per_m3: vb };
      } else if (vb >= DISCRIMINATING_HIGH_AT && va <= DISCRIMINATING_LOW_AT) {
        high = { taxon: p.b, count_per_m3: vb };
        low = { taxon: p.a, count_per_m3: va };
      } else continue;

      // Information value: how far apart the pair sits on the log scale,
      // scaled by how tightly the pair normally moves together. A wide split
      // in a tightly-coupled pair is the most informative day there is.
      const separation = log1p(high.count_per_m3) - log1p(low.count_per_m3);
      results.push({
        date,
        pair: `${p.a}+${p.b}`,
        r: round(p.r, 3),
        high: { ...high, level: pollenLevel(high.count_per_m3) },
        low: { ...low, level: pollenLevel(low.count_per_m3) },
        log_separation: round(separation, 3),
        information_value: round(separation * p.r, 3)
      });
    }
  }

  results.sort(
    (x, y) => y.information_value - x.information_value || (x.date < y.date ? -1 : 1)
  );

  return {
    criteria: {
      min_correlation: minR,
      high_at_least: DISCRIMINATING_HIGH_AT,
      low_at_most: DISCRIMINATING_LOW_AT,
      note: 'thresholds are the laboratory pollen scale: >=51 is high, <=10 is low'
    },
    pairs_examined: pairs.map((p) => ({ pair: `${p.a}+${p.b}`, r: round(p.r, 3), n: p.n })),
    total_found: results.length,
    days: results.slice(0, limit)
  };
}
