// Personal day index.
//
// The index is a weighted average of per-taxon severity scores, where the
// score maps a concentration onto 0..1 piecewise-linearly THROUGH THE
// LABORATORY BREAKPOINTS. So an index of 50 corresponds to the taxon sitting
// exactly on the 'high' boundary, not to an arbitrary normalisation.
//
// Mold never passes through the pollen mapping. It is scored against its own
// clinical threshold, and because this dataset never exceeds those thresholds
// its contribution is correspondingly small — which is the correct result,
// not a bug.

import { PERSONAL_BREAKPOINTS, MOLD_THRESHOLDS } from '../config.js';
import { round } from '../lib/util.js';
import { countOf, resolveTaxonName } from '../load.js';
import { isMold, pollenLevel } from './levels.js';

/** Piecewise-linear interpolation across the lab breakpoints. */
export function pollenScore(count) {
  const bp = PERSONAL_BREAKPOINTS;
  if (count <= bp[0].count) return bp[0].score;
  for (let i = 1; i < bp.length; i++) {
    if (count <= bp[i].count) {
      const lo = bp[i - 1];
      const hi = bp[i];
      const t = (count - lo.count) / (hi.count - lo.count);
      return lo.score + t * (hi.score - lo.score);
    }
  }
  return 1;
}

/**
 * Inverse of pollenScore: the concentration a given 0..1 severity corresponds
 * to. Used to place the personal index on the laboratory scale, so a profile
 * index can be labelled with a band without inventing a second scale.
 */
export function scoreToCount(score) {
  const bp = PERSONAL_BREAKPOINTS;
  if (score <= bp[0].score) return bp[0].count;
  for (let i = 1; i < bp.length; i++) {
    if (score <= bp[i].score) {
      const lo = bp[i - 1];
      const hi = bp[i];
      const t = (score - lo.score) / (hi.score - lo.score);
      return lo.count + t * (hi.count - lo.count);
    }
  }
  return bp[bp.length - 1].count;
}

/** Mold is scored as a fraction of its clinical threshold, capped at 1. */
export function moldScore(taxon, count) {
  const th = MOLD_THRESHOLDS[taxon];
  if (th === undefined) return null;
  return Math.min(count / th, 1);
}

/**
 * Parses `artemisia:1,betula:0.5` or `Artemisia:1,Betula:0.5`.
 * Matching is case-insensitive against the taxa actually in the dataset;
 * unknown names are reported, not silently dropped to zero.
 */
export function parseProfile(ds, raw) {
  const weights = new Map();
  const unknown = [];
  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    return { weights, unknown, empty: true };
  }
  for (const part of raw.split(',')) {
    const [nameRaw, wRaw] = part.split(':');
    const name = (nameRaw ?? '').trim();
    if (!name) continue;
    // Names in the file carry a Russian gloss, so "Artemisia" must resolve to
    // "Artemisia (полынь)". Ambiguity is reported, never guessed.
    const res = resolveTaxonName(ds, name);
    if (!res.ok) {
      unknown.push(res.reason === 'ambiguous' ? `${name} (ambiguous: ${res.candidates.join(', ')})` : name);
      continue;
    }
    const canonical = res.taxon;
    const w = wRaw === undefined ? 1 : Number(wRaw);
    if (!Number.isFinite(w) || w < 0) {
      unknown.push(`${name} (bad weight "${wRaw}")`);
      continue;
    }
    if (w > 0) weights.set(canonical, w);
  }
  return { weights, unknown, empty: weights.size === 0 };
}

export function personalIndex(ds, date, profileRaw) {
  if (!ds.observedDates.has(date)) {
    return {
      date,
      measured: false,
      index: null,
      reason: 'no measurement on this date'
    };
  }

  const { weights, unknown, empty } = parseProfile(ds, profileRaw);
  if (empty) {
    return {
      date,
      measured: true,
      index: null,
      unknown_taxa: unknown,
      reason:
        'profile is empty or contains no taxon present in this dataset; ' +
        'pass ?profile=Taxon:weight,Taxon:weight'
    };
  }

  const contributions = [];
  let weighted = 0;
  let totalWeight = 0;

  for (const [taxon, w] of weights) {
    const count = countOf(ds, taxon, date);
    if (count === undefined) continue;
    const group = ds.taxonGroup.get(taxon);
    const mold = ds.taxonIsMold.get(taxon) ?? isMold(group);
    const score = mold ? moldScore(taxon, count) : pollenScore(count);
    if (score === null) continue;
    weighted += w * score;
    totalWeight += w;
    contributions.push({
      taxon,
      group,
      weight: w,
      count_per_m3: count,
      unit: mold ? 'spores/m3' : 'grains/m3',
      level: mold ? null : pollenLevel(count),
      score: round(score, 4),
      contribution: round((w * score) / (totalWeight || 1), 4)
    });
  }

  if (totalWeight === 0) {
    return {
      date,
      measured: true,
      index: null,
      unknown_taxa: unknown,
      reason: 'none of the profile taxa were scoreable on this date'
    };
  }

  const meanScore = weighted / totalWeight;
  const index = meanScore * 100;
  // Placed back on the laboratory scale so the figure can carry a band that
  // describes THIS profile, not the day's overall pollen total.
  const equivalent = scoreToCount(meanScore);
  const level = pollenLevel(Math.round(equivalent));

  // Recompute contribution shares now that the denominator is final.
  for (const c of contributions) {
    c.contribution_share = round((c.weight * c.score) / weighted || 0, 4);
    delete c.contribution;
  }
  contributions.sort((a, b) => b.contribution_share - a.contribution_share);

  return {
    date,
    measured: true,
    index: round(index, 1),
    level,
    equivalent_count_per_m3: round(equivalent, 1),
    level_note:
      'level describes the profile-weighted exposure, not the overall pollen total for the day. The two differ whenever the profile covers taxa that are out of season.',
    index_scale: '0-100, weighted mean of per-taxon severity through the laboratory breakpoints',
    profile_taxa: [...weights.keys()],
    unknown_taxa: unknown,
    contributions
  };
}
