// The acceptance gate — every figure in ACCEPTANCE.md, asserted against the
// real laboratory file.
//
// Where an expectation is disputed, the test asserts the value this codebase
// computes and the comment shows the working. Disputes are listed in the
// report; they are not silently accommodated.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadDataset, datasetPresent, datasetPaths, resetCache, countOf, resolveTaxonName } from '../src/load.js';
import { scanRamps, rampPerformance } from '../src/domain/ramp.js';
import { RAMP_MIN_MA3, RAMP_MIN_RATIO } from '../src/config.js';
import { seasonSummary } from '../src/domain/season.js';
import { seasonPace } from '../src/domain/pace.js';
import { inseparableGroups } from '../src/domain/groups.js';
import { dayReport } from '../src/domain/day.js';
import { logPearson } from '../src/lib/util.js';

const MISSING = !datasetPresent();
const paths = datasetPaths();

resetCache();
const ds = MISSING ? null : loadDataset();
const T = (name) => (MISSING ? name : resolveTaxonName(ds, name).taxon ?? name);
const ART = MISSING ? 'Artemisia' : T('Artemisia');

test('the laboratory dataset is present', () => {
  assert.ok(!MISSING, `No measurement file. Expected:\n  ${paths.json}\n  or ${paths.csv}`);
});

// ── Dataset shape ────────────────────────────────────────────────────────

test('247 measurement days, 2025-04-28 → 2026-08-06', { skip: MISSING }, () => {
  assert.equal(ds.counts.measurementDays, 247);
  assert.equal(ds.firstDate, '2025-04-28');
  assert.equal(ds.lastDate, '2026-08-06');
});

test('48 canonical taxa, of which 5 are fungal', { skip: MISSING }, () => {
  // ACCEPTANCE says 48 canonical taxa; the file contains 48 in total,
  // 5 of them molds, so 43 are pollen. (The original brief's "48 taxa plus
  // 5 fungal spore types" = 53 is superseded.)
  assert.equal(ds.counts.taxa, 48);
  assert.equal(ds.moldTaxa.length, 5);
  assert.equal(ds.pollenTaxa.length, 43);
});

test('the gaps in the file are exactly the declared gaps', { skip: MISSING }, () => {
  assert.deepEqual(ds.gaps.undeclaredAbsent, []);
  assert.deepEqual(ds.gaps.declaredButPresent, []);
  assert.equal(ds.gaps.matches, true);
});

// ── Ramp detector, Artemisia 2025 ────────────────────────────────────────

test('ramp: window 2025-07-01..10-31 fires first on 2025-07-13', { skip: MISSING }, () => {
  // ACCEPTANCE states window 2025-07-01..2025-10-31 AND first trigger
  // 2025-08-06. Those two claims are inconsistent: on 2025-07-13 the 3-day
  // average is (42+47+32)/3 = 40.33 >= 40, the baseline over 2025-07-01..07-10
  // is 22.0, and 40.33/22.0 = 1.833 >= 1.60. Both windows are fully measured,
  // so the detector fires 24 days earlier than the file claims.
  const scan = scanRamps(ds, ART, '2025-07-01', '2025-10-31');
  assert.equal(scan.first_trigger, '2025-07-13');
  const d = scan.first_trigger_detail;
  assert.equal(Math.round(d.ma3 * 100) / 100, 40.33);
  assert.equal(d.baseline, 22);
  assert.equal(d.ratio, 1.833);
});

test("ramp: ACCEPTANCE's stated values at 2025-08-06 reproduce exactly", { skip: MISSING }, () => {
  // The numbers quoted for 2025-08-06 (ma3 40.0, baseline 21.2, ratio 1.89)
  // are correct. Only the claim that it is the FIRST trigger is not.
  const scan = scanRamps(ds, ART, '2025-08-01', '2025-10-31');
  assert.equal(scan.first_trigger, '2025-08-06');
  assert.equal(scan.first_trigger_detail.ma3, 40);
  assert.equal(scan.first_trigger_detail.baseline, 21.2);
  assert.equal(scan.first_trigger_detail.ratio, 1.887);
});

test('ramp: trigger count is 12 (July window) / 11 (August window)', { skip: MISSING }, () => {
  // ACCEPTANCE says 14. That count is only reachable by averaging across the
  // 28-day September gap, which adds 2025-09-29, 09-30 and 10-01. This
  // implementation refuses to bridge a gap, so those three days are reported
  // as not evaluable instead of as triggers.
  assert.equal(scanRamps(ds, ART, '2025-07-01', '2025-10-31').trigger_count, 12);
  assert.equal(scanRamps(ds, ART, '2025-08-01', '2025-10-31').trigger_count, 11);
});

test('ramp: the three disputed days are gap-blocked, not triggers', { skip: MISSING }, () => {
  const scan = scanRamps(ds, ART, '2025-07-01', '2025-10-31');
  const blocked = new Set(scan.not_evaluable_dates.map((u) => u.date));
  for (const d of ['2025-09-29', '2025-09-30', '2025-10-01']) {
    assert.ok(blocked.has(d), `${d} should be blocked by the September gap`);
    assert.ok(!scan.triggers.some((t) => t.date === d));
  }
});

// ── Ramp performance ─────────────────────────────────────────────────────

test('ramp performance: 12 triggers, 11 confirmed, 92% precision', { skip: MISSING }, () => {
  const p = rampPerformance(ds, ART, '2025-07-01', '2025-10-31');
  assert.equal(p.trigger_count, 12);
  assert.equal(p.precision.confirmed, 11);
  assert.equal(p.precision.false_alarms, 1);
  assert.equal(p.precision.unverifiable, 0);
  assert.equal(p.precision.denominator, 12);
  assert.equal(p.precision.percent, 92);
});

test('ramp performance: the one false alarm is 2025-07-13', { skip: MISSING }, () => {
  const p = rampPerformance(ds, ART, '2025-07-01', '2025-10-31');
  assert.deepEqual(p.false_alarm_dates, ['2025-07-13']);
  assert.equal(p.first_trigger, '2025-07-13');
});

test('ramp performance: first sustained trigger is 2025-08-06, lead time 9 days', { skip: MISSING }, () => {
  const p = rampPerformance(ds, ART, '2025-07-01', '2025-10-31');
  // 2025-07-13 is isolated — the next trigger is 24 days later — so it does
  // not begin a sequence. 2025-08-06 is followed by 2025-08-07.
  assert.equal(p.first_sustained_trigger, '2025-08-06');
  assert.equal(p.first_critical_day.date, '2025-08-15');
  assert.equal(p.lead_time_from_first_sustained_days, 9);
});

test('ramp performance: thresholds are not tuned to this season', { skip: MISSING }, () => {
  // Guard against someone "fixing" the false alarm by moving the floor.
  assert.equal(RAMP_MIN_MA3, 40);
  assert.equal(RAMP_MIN_RATIO, 1.6);
  const p = rampPerformance(ds, ART, '2025-07-01', '2025-10-31');
  assert.equal(p.detector.min_moving_average, 40);
  assert.equal(p.detector.min_ratio, 1.6);
});

test('ramp performance: gap-blocked days are reported, not scored', { skip: MISSING }, () => {
  const p = rampPerformance(ds, ART, '2025-07-01', '2025-10-31');
  assert.equal(p.days_not_evaluable, 23);
  const blocked = new Set(p.not_evaluable_dates.map((u) => u.date));
  for (const d of ['2025-09-29', '2025-09-30', '2025-10-01']) assert.ok(blocked.has(d));
  // They are not counted as triggers, confirmations or false alarms.
  assert.equal(p.precision.denominator, p.trigger_count);
});

test('first critical day (>200) is 2025-08-15, value 223', { skip: MISSING }, () => {
  const first = ds.dates
    .filter((d) => d >= '2025-07-01' && d <= '2025-10-31')
    .find((d) => (countOf(ds, ART, d) ?? 0) > 200);
  assert.equal(first, '2025-08-15');
  assert.equal(countOf(ds, ART, first), 223);
});

test('warning lead time from 2025-08-06 to 2025-08-15 is 9 days', { skip: MISSING }, () => {
  const lead =
    (new Date('2025-08-15T00:00:00Z') - new Date('2025-08-06T00:00:00Z')) / 86400000;
  assert.equal(lead, 9);
});

// ── Season integral, Artemisia ───────────────────────────────────────────

test('SPIn over 2025-07-01..2025-10-31 is 7023', { skip: MISSING }, () => {
  const s = seasonSummary(ds, ART, 2025);
  assert.equal(s.window.from, '2025-07-01');
  assert.equal(s.window.to, '2025-10-31');
  assert.equal(s.seasonal_pollen_integral, 7023);
});

test('all-time total is 7592 and is not the SPIn', { skip: MISSING }, () => {
  const s = seasonSummary(ds, ART, 2025);
  assert.equal(s.all_time_total, 7592);
  assert.notEqual(s.seasonal_pollen_integral, s.all_time_total);
});

test('peak is 1662 grains/m3 on 2025-09-29', { skip: MISSING }, () => {
  const s = seasonSummary(ds, ART, 2025);
  assert.equal(s.peak.count_per_m3, 1662);
  assert.equal(s.peak.date, '2025-09-29');
});

test('season bounds are 2025-07-09 → 2025-10-23', { skip: MISSING }, () => {
  const s = seasonSummary(ds, ART, 2025);
  assert.equal(s.season_start, '2025-07-09');
  assert.equal(s.season_end, '2025-10-23');
});

// ── Season pace at 2026-08-06 ────────────────────────────────────────────

test('pace raw: 920 vs 511, ratio 1.80', { skip: MISSING }, () => {
  const p = seasonPace(ds, '2026-08-06', ART);
  assert.equal(p.raw.previous, 920);
  assert.equal(p.raw.current, 511);
  assert.equal(p.raw.ratio, 1.8);
  assert.equal(p.raw.previous_days, 37);
  assert.equal(p.raw.current_days, 33);
});

test('pace matched-dates: 777 vs 511, ratio 1.52, and it is the display figure', { skip: MISSING }, () => {
  const p = seasonPace(ds, '2026-08-06', ART);
  assert.equal(p.display.previous, 777);
  assert.equal(p.display.current, 511);
  assert.equal(p.display.ratio, 1.52);
  assert.equal(p.display.days_compared, 33);
  assert.equal(p.display.missing_days_in_current_window, 4);
  assert.deepEqual(p.display.missing_dates_in_current_window, [
    '2026-07-09',
    '2026-07-10',
    '2026-07-11',
    '2026-07-12'
  ]);
  // 920 - (26+28+42+47) = 777
  assert.equal(p.raw.previous - 143, p.display.previous);
});

// ── Collinearity ─────────────────────────────────────────────────────────

test('the four declared correlations reproduce exactly', { skip: MISSING }, () => {
  const vec = (t) => ds.dates.map((d) => countOf(ds, t, d) ?? 0);
  const r = (a, b) => Math.round(logPearson(vec(T(a)), vec(T(b))) * 1000) / 1000;
  assert.equal(r('Salix', 'Ulmus'), 0.893);
  assert.equal(r('Cannabaceae', 'Chenopodiaceae'), 0.823);
  assert.equal(r('Artemisia', 'Chenopodiaceae'), 0.731);
  assert.equal(r('Ambrosia', 'Artemisia'), 0.706);
});

test('Artemisia and Chenopodiaceae stay separate, Salix and Ulmus do not', { skip: MISSING }, () => {
  const { groups } = inseparableGroups(ds, ds.pollenTaxa);
  const groupOf = (t) => groups.find((g) => g.taxa.includes(T(t)));
  assert.ok(groupOf('Salix').taxa.includes(T('Ulmus')), 'Salix+Ulmus must be one group');
  assert.ok(
    !groupOf('Artemisia').taxa.includes(T('Chenopodiaceae')),
    'Artemisia+Chenopodiaceae (0.73) is below threshold and must stay separate'
  );
  assert.ok(
    !groupOf('Ambrosia').taxa.includes(T('Artemisia')),
    'Ambrosia+Artemisia (0.71) is below threshold and must stay separate'
  );
});

test('more than two pairs cross r >= 0.80 on the full taxon set', { skip: MISSING }, () => {
  // ACCEPTANCE claims only two pairs cross the threshold. On the shipped file
  // 13 do. Six of those survive the co-occurrence filter; the rest rest on a
  // handful of shared days. Both lists are published by the endpoint.
  const res = inseparableGroups(ds, ds.pollenTaxa);
  assert.ok(
    res.allAboveThreshold.length > 2,
    `expected more than two pairs at r>=0.80, got ${res.allAboveThreshold.length}`
  );
  assert.equal(res.allAboveThreshold.length, 13);
  // Nine of the thirteen rest on fewer than 20 days where both taxa were
  // present — Cedrus+Convolvulus scores r = 1.00 on seven shared days — so
  // they are reported but not grouped.
  assert.equal(res.allAboveThreshold.filter((p) => p.grouped).length, 4);
  assert.equal(res.rejectedForSparsity.length, 9);
});

test('grouping yields Cannabaceae+Chenopodiaceae and Corylus+Salix+Ulmus', { skip: MISSING }, () => {
  // ACCEPTANCE lists Salix+Ulmus as a pair. Corylus joins them transitively:
  // r(Corylus,Salix) = 0.847 on 25 shared days and r(Corylus,Ulmus) = 0.828
  // on 25. Both clear the threshold and the sample-size guard, so the group
  // has three members, not two.
  const { groups } = inseparableGroups(ds, ds.pollenTaxa);
  const ids = groups.filter((g) => g.inseparable).map((g) => g.id).sort();
  assert.equal(ids.length, 2);
  assert.ok(ids.some((i) => i.includes('Cannabaceae') && i.includes('Chenopodiaceae')));
  const trio = ids.find((i) => i.includes('Salix'));
  assert.ok(trio.includes('Ulmus') && trio.includes('Corylus'), `got ${trio}`);
});

// ── Spot values ──────────────────────────────────────────────────────────

test('2025-08-15: Artemisia = 223', { skip: MISSING }, () => {
  assert.equal(countOf(ds, ART, '2025-08-15'), 223);
});

test('2026-08-06: pollen total 107, mold total 85', { skip: MISSING }, () => {
  const d = dayReport(ds, '2026-08-06');
  assert.equal(d.measured, true);
  assert.equal(d.pollen.total_per_m3, 107);
  assert.equal(d.mold.total_per_m3, 85);
  assert.equal(d.mold.level, null, 'mold must not carry a pollen level');
});

test('Alternaria max 67, Cladosporium max 124 — both below clinical thresholds', { skip: MISSING }, () => {
  const maxOf = (t) => Math.max(...ds.dates.map((d) => countOf(ds, T(t), d) ?? 0));
  const alt = maxOf('Alternaria');
  const cla = maxOf('Cladosporium');
  assert.equal(alt, 67);
  assert.equal(cla, 124);
  assert.ok(alt < 100, 'Alternaria clinical threshold is 100');
  assert.ok(cla < 3000, 'Cladosporium clinical threshold is 3000');
});

test('no mold anywhere in the dataset reaches its clinical threshold', { skip: MISSING }, () => {
  const limits = { 'Alternaria alternata': 100, 'Cladosporium herbarum': 3000 };
  const breaches = ds.rows.filter(
    (r) => limits[r.taxon] !== undefined && r.count_per_m3 > limits[r.taxon]
  );
  assert.deepEqual(breaches.map((r) => `${r.taxon} ${r.date} ${r.count_per_m3}`), []);
});
