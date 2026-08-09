// Symptom attribution.
//
// Fits L2-regularised logistic regression of "bad day" on log1p taxon
// concentrations, with collinear taxa collapsed into one feature FIRST, and
// returns those groups flagged as inseparable.
//
// Refusals are deliberate. With too few logged days, or with only one class
// present, a logistic fit still returns numbers — they just mean nothing. We
// return no weights in that case and say why.

import {
  SEVERITY_POSITIVE_AT,
  LOGREG_L2_LAMBDA,
  LOGREG_ITERATIONS,
  LOGREG_LEARNING_RATE,
  ATTRIB_MIN_DAYS,
  ATTRIB_MEDIUM_DAYS,
  ATTRIB_HIGH_DAYS,
  ATTRIB_MIN_PER_CLASS,
  ATTRIB_HIGH_PER_CLASS,
  INSEPARABLE_R
} from '../config.js';
import { isDateString, log1p, round } from '../lib/util.js';
import { fitLogisticL2 } from '../lib/logreg.js';
import { countOf } from '../load.js';
import { inseparableGroups } from './groups.js';

function confidenceOf(n, pos, neg) {
  if (n < ATTRIB_MIN_DAYS || pos < ATTRIB_MIN_PER_CLASS || neg < ATTRIB_MIN_PER_CLASS) {
    return 'insufficient';
  }
  if (n >= ATTRIB_HIGH_DAYS && pos >= ATTRIB_HIGH_PER_CLASS && neg >= ATTRIB_HIGH_PER_CLASS) {
    return 'high';
  }
  if (n >= ATTRIB_MEDIUM_DAYS) return 'medium';
  return 'low';
}

/**
 * @param {object} ds  loaded dataset
 * @param {{date:string, severity:number}[]} log
 */
export function attribute(ds, log, opts = {}) {
  if (!Array.isArray(log)) {
    return { error: 'body must be an array of {date, severity}' };
  }

  const invalid = [];
  const unmeasured = [];
  const entries = [];
  const seenDates = new Set();

  for (const e of log) {
    const date = typeof e?.date === 'string' ? e.date.slice(0, 10) : null;
    const sev = e?.severity;
    if (!date || !isDateString(date) || !Number.isInteger(sev) || sev < 0 || sev > 3) {
      invalid.push(e);
      continue;
    }
    if (seenDates.has(date)) {
      invalid.push({ ...e, reason: 'duplicate date' });
      continue;
    }
    seenDates.add(date);
    // A symptom logged on a day the trap did not run cannot be attributed.
    // It is dropped and reported — never matched to a neighbouring day.
    if (!ds.observedDates.has(date)) {
      unmeasured.push(date);
      continue;
    }
    entries.push({ date, severity: sev });
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : 1));

  // Taxa that actually vary across the logged days; a taxon that is flat or
  // absent on every logged day cannot be a trigger and must not get a weight.
  const candidateTaxa = ds.pollenTaxa
    .concat(ds.moldTaxa)
    .filter((t) => {
      const vals = entries.map((e) => countOf(ds, t, e.date) ?? 0);
      return vals.some((v) => v > 0) && new Set(vals).size > 1;
    })
    .sort();

  const { groups, declaredCheck, threshold } = inseparableGroups(
    ds,
    candidateTaxa,
    opts.threshold ?? INSEPARABLE_R
  );

  const inseparable = groups
    .filter((g) => g.inseparable)
    .map((g) => ({ group: g.id, taxa: g.taxa, correlations: g.correlations }));

  const y = entries.map((e) => (e.severity >= SEVERITY_POSITIVE_AT ? 1 : 0));
  const pos = y.filter((v) => v === 1).length;
  const neg = y.length - pos;
  const confidence = confidenceOf(entries.length, pos, neg);

  const base = {
    logged_days: log.length,
    usable_days: entries.length,
    dropped_unmeasured_days: unmeasured,
    dropped_invalid_entries: invalid.length,
    positive_days: pos,
    negative_days: neg,
    confidence,
    severity_positive_at: SEVERITY_POSITIVE_AT,
    inseparable_groups: inseparable,
    correlation_threshold: threshold,
    declared_correlation_check: declaredCheck,
    model: 'L2-regularised logistic regression on log1p(count), standardised features',
    l2_lambda: LOGREG_L2_LAMBDA
  };

  if (confidence === 'insufficient' || candidateTaxa.length === 0) {
    return {
      ...base,
      triggers: [],
      fitted: false,
      reason:
        candidateTaxa.length === 0
          ? 'No taxon varies across the logged days; nothing can be attributed.'
          : `Not enough usable data: ${entries.length} day(s), ${pos} bad / ${neg} good. ` +
            `Need at least ${ATTRIB_MIN_DAYS} days with ${ATTRIB_MIN_PER_CLASS} of each.`
    };
  }

  // One feature per group: the summed concentration of its members, then
  // log1p. Summing before the log keeps the feature on the scale of a real
  // airborne load rather than averaging logs.
  const featureGroups = groups.filter((g) => g.taxa.some((t) => candidateTaxa.includes(t)));
  const X = entries.map((e) =>
    featureGroups.map((g) => {
      const total = g.taxa.reduce((a, t) => a + (countOf(ds, t, e.date) ?? 0), 0);
      return log1p(total);
    })
  );

  const fit = fitLogisticL2(X, y, {
    lambda: LOGREG_L2_LAMBDA,
    iterations: LOGREG_ITERATIONS,
    learningRate: LOGREG_LEARNING_RATE
  });

  const triggers = featureGroups
    .map((g, j) => ({
      feature: g.id,
      taxa: g.taxa,
      inseparable: g.inseparable,
      weight: round(fit.weights[j], 4),
      direction: fit.weights[j] > 0 ? 'aggravating' : fit.weights[j] < 0 ? 'protective' : 'none'
    }))
    .filter((t) => t.weight !== 0)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  return {
    ...base,
    fitted: true,
    converged: fit.converged,
    iterations: fit.iterations,
    log_loss: round(fit.logLoss, 5),
    weight_space: 'standardised — weights are comparable across features',
    triggers
  };
}
