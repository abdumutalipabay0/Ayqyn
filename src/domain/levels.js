// Threshold logic. The single rule enforced here: the pollen scale is applied
// to pollen and only to pollen; mold is judged against its own clinical
// thresholds and is never given a low/moderate/high/critical label.

import { POLLEN_SCALE, MOLD_THRESHOLDS, MOLD_THRESHOLD_SOURCE, MOLD_GROUP } from '../config.js';
import { symptomThreshold } from '../knowledge/symptom-thresholds.js';

export function pollenLevel(count) {
  if (count === null || count === undefined) return null;
  for (const band of POLLEN_SCALE) {
    if (count >= band.min && count <= band.max) return band.level;
  }
  return null;
}

/** Accepts a group string or a row. Rows carry is_mold explicitly, because the
 *  JSON export separates molds without recording the pollen subgroup. */
export function isMold(groupOrRow) {
  if (groupOrRow && typeof groupOrRow === 'object') {
    return groupOrRow.is_mold ?? groupOrRow.group === MOLD_GROUP;
  }
  return groupOrRow === MOLD_GROUP;
}

/**
 * Mold assessment. Returns an explicit "no clinical threshold published"
 * rather than falling back to the pollen scale, which would be a category
 * error.
 */
export function moldAssessment(taxon, count) {
  const threshold = MOLD_THRESHOLDS[taxon];
  if (threshold === undefined) {
    return {
      threshold: null,
      threshold_source: null,
      exceeds_clinical_threshold: null,
      note: `No published clinical threshold for ${taxon}; not assessed.`
    };
  }
  return {
    threshold,
    threshold_source: MOLD_THRESHOLD_SOURCE,
    exceeds_clinical_threshold: count > threshold,
    fraction_of_threshold: count / threshold
  };
}

/** Shapes one observation for an API response, applying the correct scale. */
export function describeObservation(row) {
  const base = {
    taxon: row.taxon,
    group: row.group,
    count_per_m3: row.count_per_m3
  };
  if (isMold(row)) {
    return { ...base, unit: 'spores/m3', ...moldAssessment(row.taxon, row.count_per_m3) };
  }
  // `level` is computed first and from the laboratory scale alone. The clinical
  // reading is attached beside it, nested and self-flagged, and is null for
  // every taxon without a published threshold. The two answer different
  // questions and neither is allowed to overwrite the other.
  return {
    ...base,
    unit: 'grains/m3',
    level: pollenLevel(row.count_per_m3),
    clinical: symptomThreshold(row.taxon, row.count_per_m3)
  };
}
