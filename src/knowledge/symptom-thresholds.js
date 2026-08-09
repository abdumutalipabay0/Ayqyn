/* ──────────────────────────────────────────────────────────────────────────
   KNOWLEDGE LAYER — NOT MEASUREMENT.

   Published concentrations at which sensitised people begin to report
   symptoms. Like src/knowledge/cross-reactivity.js this is a static table
   compiled from the literature, and it obeys the same discipline:

     1. This module imports nothing. It cannot read the dataset, the network,
        or the configuration that defines the laboratory scale.
     2. Every reading built from it carries `measured: false` and
        `source_kind: 'literature'` on the reading itself, not in a footnote.
     3. A taxon absent from the table produces NOTHING. No estimate, no
        borrowed value from a related taxon, no "probably similar to".

   One difference from the cross-reactivity table, and it is deliberate: this
   module IS read by the measured path, because a symptom threshold is only
   meaningful next to the day's count. The boundary is held a different way —
   the reading is attached as a nested object beside the measurement and never
   feeds it. `level`, `count_per_m3`, and every total are computed as if this
   file did not exist, and a test asserts exactly that.

   Why a range and never one number: the published figures disagree. Different
   study populations, different pollen seasons, different definitions of
   "symptom onset", and different statistical treatment produce thresholds that
   vary several-fold for the same taxon. There is no consensus value, so the
   product does not print one.
   ────────────────────────────────────────────────────────────────────────── */

export const THRESHOLD_NOTE =
  'Пороги симптомов взяты из литературы — опубликованных исследований, а не измерений этой ловушки. ' +
  'Значения в разных работах расходятся в несколько раз, единого принятого порога не существует. ' +
  'Это ориентир для групп чувствительных людей, а не граница, обязательная для конкретного человека.';

/**
 * Keyed by the Latin part of the canonical taxon name, so the key survives the
 * Russian gloss the dataset carries ("Artemisia (полынь)").
 *
 * `low`/`high` are grains/m3. Where a source gives one number plus context,
 * both ends come from that same source — nothing here is widened by guesswork.
 */
export const SYMPTOM_THRESHOLDS = {
  Artemisia: {
    low: 5,
    high: 15,
    source: 'de Weger et al. 2013',
    note: null
  },

  Poaceae: {
    low: 20,
    high: 50,
    source: 'Rapiejko et al. 2007',
    note: 'при 20 симптомы отмечает около четверти чувствительных; большинство — около 50'
  },

  Betula: {
    low: 45,
    high: 100,
    source: 'систематический обзор, Aerobiologia 2021',
    note: null
  },

  Ambrosia: {
    low: 10,
    high: 50,
    source: 'диапазон по нескольким исследованиям',
    note: 'разброс между работами особенно велик'
  }
};

/** Latin part of "Artemisia (полынь)". */
export function latinOfTaxon(taxon) {
  return String(taxon).split(' (')[0].trim();
}

/**
 * The clinical reading for one taxon on one day.
 *
 * Returns null — not an empty object and not a zero — when the taxon has no
 * published threshold or the day's count is zero. A caller that gets null
 * renders nothing, which is the honest output: silence, not a guess.
 *
 * @param {string} taxon canonical taxon name
 * @param {number} count grains/m3 measured that day
 */
export function symptomThreshold(taxon, count) {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null;
  const e = SYMPTOM_THRESHOLDS[latinOfTaxon(taxon)];
  if (!e) return null;

  return {
    measured: false,
    source_kind: 'literature',
    low: e.low,
    high: e.high,
    source: e.source,
    note: e.note,
    // Three plain positions relative to the published range. "above" is a
    // statement about a range in the literature, never a warning about the
    // person reading it.
    position: count > e.high ? 'above' : count < e.low ? 'below' : 'within',
    consensus: 'no_consensus'
  };
}
