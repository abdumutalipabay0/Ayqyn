// Collinearity handling.
//
// Correlations are COMPUTED from the file, on log1p-transformed counts, over
// days where both taxa were measured. The declared pairs in config are used
// only to cross-check the computation and to surface disagreement.
//
// Taxa at r >= 0.80 are collapsed into one feature before any model is fitted.
// Grouping is transitive (connected components): if A~B and B~C are both
// inseparable, A, B and C are one feature even when r(A,C) is lower. Fitting
// separate weights to collinear taxa would produce a confident-looking
// distinction — "birch, not hazel" — that the data cannot support.

import { INSEPARABLE_R, DECLARED_CORRELATIONS, MIN_CO_NONZERO_DAYS } from '../config.js';
import { connectedComponents, logPearson, round } from '../lib/util.js';
import { pairedValues } from './series.js';

/** Log-scale Pearson r for every taxon pair that can be evaluated.
 *  `co_nonzero` counts days on which BOTH taxa were actually present; it is
 *  the effective sample size behind r, and it is usually far smaller than n. */
export function correlationMatrix(ds, taxa) {
  const pairs = [];
  for (let i = 0; i < taxa.length; i++) {
    for (let j = i + 1; j < taxa.length; j++) {
      const { a, b, dates } = pairedValues(ds, taxa[i], taxa[j]);
      const r = logPearson(a, b);
      if (r === null) continue;
      let coNonZero = 0;
      for (let k = 0; k < a.length; k++) if (a[k] > 0 && b[k] > 0) coNonZero++;
      pairs.push({ a: taxa[i], b: taxa[j], r, n: dates.length, co_nonzero: coNonZero });
    }
  }
  return pairs;
}

/** Strongest correlate of each taxon, above `minR`. */
export function strongestCorrelates(pairs, minR = 0) {
  const best = new Map();
  for (const p of pairs) {
    if (p.r < minR) continue;
    for (const [x, y] of [
      [p.a, p.b],
      [p.b, p.a]
    ]) {
      const cur = best.get(x);
      if (!cur || p.r > cur.r) best.set(x, { taxon: y, r: p.r, n: p.n });
    }
  }
  return best;
}

/**
 * Groups taxa that cannot be statistically separated.
 * @returns {{groups:{id:string, taxa:string[], inseparable:boolean,
 *                    correlations:{a:string,b:string,r:number}[]}[],
 *           pairs:*[], declaredCheck:*[]}}
 */
export function inseparableGroups(ds, taxa, threshold = INSEPARABLE_R, minCoNonZero = MIN_CO_NONZERO_DAYS) {
  const pairs = correlationMatrix(ds, taxa);

  // Two filters, both required to group. The correlation says the taxa move
  // together; the co-occurrence count says we have enough days to believe it.
  const strong = pairs.filter((p) => p.r >= threshold);
  const grouping = strong.filter((p) => p.co_nonzero >= minCoNonZero);
  const rejectedForSparsity = strong
    .filter((p) => p.co_nonzero < minCoNonZero)
    .map((p) => ({
      pair: `${p.a}+${p.b}`,
      r: round(p.r, 3),
      co_nonzero: p.co_nonzero,
      reason: `r is above threshold but rests on only ${p.co_nonzero} day(s) where both taxa were present; not treated as inseparable`
    }))
    .sort((x, y) => y.r - x.r);

  const edges = grouping.map((p) => [p.a, p.b]);
  const components = connectedComponents(taxa, edges);

  const groups = components.map((members) => {
    const within = pairs
      .filter((p) => members.includes(p.a) && members.includes(p.b))
      .map((p) => ({ a: p.a, b: p.b, r: round(p.r, 3), n: p.n, co_nonzero: p.co_nonzero }))
      .sort((x, y) => y.r - x.r);
    return {
      id: members.join('+'),
      taxa: members,
      inseparable: members.length > 1,
      correlations: members.length > 1 ? within.filter((c) => c.r >= threshold) : []
    };
  });

  // Cross-check against the values supplied with the dataset. Names in the
  // file carry a Russian gloss, so match on the Latin part.
  const latin = (t) => t.split(' (')[0].trim().toLowerCase();
  const declaredCheck = DECLARED_CORRELATIONS.map((d) => {
    const found = pairs.find(
      (p) =>
        (latin(p.a) === d.a.toLowerCase() && latin(p.b) === d.b.toLowerCase()) ||
        (latin(p.a) === d.b.toLowerCase() && latin(p.b) === d.a.toLowerCase())
    );
    return {
      pair: `${d.a}+${d.b}`,
      declared_r: d.r,
      computed_r: found ? round(found.r, 3) : null,
      agrees: found ? Math.abs(found.r - d.r) <= 0.005 : null,
      note: found ? null : 'pair not evaluable in this dataset'
    };
  });

  // Everything at or above threshold, whether or not it survived the
  // co-occurrence filter. Published so the grouping decision is auditable.
  const allAboveThreshold = strong
    .map((p) => ({
      pair: `${p.a}+${p.b}`,
      r: round(p.r, 3),
      co_nonzero: p.co_nonzero,
      grouped: p.co_nonzero >= minCoNonZero
    }))
    .sort((x, y) => y.r - x.r);

  return {
    groups,
    pairs,
    threshold,
    min_co_nonzero_days: minCoNonZero,
    declaredCheck,
    allAboveThreshold,
    rejectedForSparsity
  };
}
