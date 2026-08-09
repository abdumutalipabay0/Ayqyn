// Algorithm tests. These run without the laboratory file: they prove the
// arithmetic is right, on synthetic fixtures that are labelled as such.
// The numbers the product actually publishes are asserted in dataset.test.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeDataset, rampFixture } from './fixtures.js';
import { indexRows } from '../src/load.js';
import { pearson, logPearson, connectedComponents, dateRange, sameDayInYear } from '../src/lib/util.js';
import { fitLogisticL2, standardise } from '../src/lib/logreg.js';
import { pollenLevel, moldAssessment, describeObservation } from '../src/domain/levels.js';
import {
  symptomThreshold,
  SYMPTOM_THRESHOLDS,
  THRESHOLD_NOTE
} from '../src/knowledge/symptom-thresholds.js';
import { windowValues, windowMean, movingAverage } from '../src/domain/series.js';
import { evaluateRamp, firstRamp, seasonState } from '../src/domain/ramp.js';
import { seasonSummary } from '../src/domain/season.js';
import { cumulativeSince, seasonPace } from '../src/domain/pace.js';
import { inseparableGroups } from '../src/domain/groups.js';
import { attribute } from '../src/domain/attribute.js';
import { personalIndex, pollenScore } from '../src/domain/personal.js';
import { discriminatingDays } from '../src/domain/discriminating.js';
import { dayReport, pollenTotalSeries } from '../src/domain/day.js';
import {
  crossReactivityFor,
  latinOf,
  TABLE_NOTE,
  CROSS_REACTIVITY
} from '../src/knowledge/cross-reactivity.js';
import { readFileSync } from 'node:fs';

// ── Pollen scale ─────────────────────────────────────────────────────────

test('pollen scale boundaries are exact', () => {
  assert.equal(pollenLevel(0), 'none');
  assert.equal(pollenLevel(1), 'low');
  assert.equal(pollenLevel(10), 'low');
  assert.equal(pollenLevel(11), 'moderate');
  assert.equal(pollenLevel(50), 'moderate');
  assert.equal(pollenLevel(51), 'high');
  assert.equal(pollenLevel(200), 'high');
  assert.equal(pollenLevel(201), 'critical');
  assert.equal(pollenLevel(5000), 'critical');
});

test('mold is never graded on the pollen scale', () => {
  const row = {
    taxon: 'Alternaria alternata',
    group: 'плесень',
    count_per_m3: 250
  };
  const d = describeObservation(row);
  assert.equal(d.level, undefined, 'mold must not carry a pollen level');
  assert.equal(d.unit, 'spores/m3');
  assert.equal(d.threshold, 100);
  assert.equal(d.exceeds_clinical_threshold, true);

  const cl = moldAssessment('Cladosporium herbarum', 2999);
  assert.equal(cl.threshold, 3000);
  assert.equal(cl.exceeds_clinical_threshold, false);

  const unknown = moldAssessment('Curvularia', 10);
  assert.equal(unknown.threshold, null);
  assert.equal(unknown.exceeds_clinical_threshold, null);
});

// ── Gaps are never bridged ───────────────────────────────────────────────

test('a window spanning a gap yields no value, not a partial average', () => {
  const ds = makeDataset({
    start: '2025-08-01',
    taxa: { Artemisia: new Array(10).fill(100) },
    skip: ['2025-08-05']
  });
  const spanning = windowMean(ds, 'Artemisia', '2025-08-04', '2025-08-06');
  assert.equal(spanning.ok, false);
  assert.equal(spanning.reason, 'gap_in_window');
  assert.deepEqual(spanning.missing, ['2025-08-05']);

  const clean = windowMean(ds, 'Artemisia', '2025-08-06', '2025-08-08');
  assert.equal(clean.ok, true);
  assert.equal(clean.mean, 100);
});

test('moving average uses the calendar window, not the previous N rows', () => {
  const ds = makeDataset({
    start: '2025-08-01',
    taxa: { Artemisia: [10, 20, 30, 40, 50, 60] },
    skip: ['2025-08-03']
  });
  // 08-04 needs 08-02..08-04; 08-03 is missing -> undetermined.
  assert.equal(movingAverage(ds, 'Artemisia', '2025-08-04', 3).ok, false);
  // 08-06 needs 08-04..08-06, all present.
  const ok = movingAverage(ds, 'Artemisia', '2025-08-06', 3);
  assert.equal(ok.ok, true);
  assert.equal(ok.mean, (40 + 50 + 60) / 3);
});

test('an unmeasured day reports itself as unmeasured, not as zero', () => {
  const ds = makeDataset({
    start: '2025-08-01',
    taxa: { Artemisia: new Array(6).fill(70) },
    skip: ['2025-08-03']
  });
  const gap = dayReport(ds, '2025-08-03');
  assert.equal(gap.measured, false);
  assert.equal(gap.reason, 'measurement_gap');
  assert.equal(gap.previous_measured_date, '2025-08-02');
  assert.equal(gap.next_measured_date, '2025-08-04');
  assert.ok(!('taxa' in gap), 'must not emit an empty taxon list for a gap day');

  const outside = dayReport(ds, '2024-01-01');
  assert.equal(outside.measured, false);
  assert.equal(outside.reason, 'outside_record');
});

test('day report separates pollen total from mold total', () => {
  const ds = makeDataset({
    start: '2025-08-01',
    taxa: { Artemisia: [100], Betula: [60], 'Alternaria alternata': [40] },
    group: {
      Artemisia: 'травы',
      Betula: 'древесные',
      'Alternaria alternata': 'плесень'
    }
  });
  const d = dayReport(ds, '2025-08-01');
  assert.equal(d.pollen.total_per_m3, 160);
  assert.equal(d.mold.total_per_m3, 40);
  assert.equal(d.mold.level, null);
  assert.equal(d.pollen.dominant, 'Artemisia');
  assert.equal(d.pollen.level, 'high');
});

// ── Ramp detector ────────────────────────────────────────────────────────

test('ramp fires only when both conditions hold', () => {
  const ds = rampFixture();
  // Day 16 (2025-08-16): ma3 = 60 >= 40, baseline = 10, ratio 6.0 >= 1.6.
  const fired = evaluateRamp(ds, 'Artemisia', '2025-08-16');
  assert.equal(fired.status, 'fired');
  assert.equal(fired.ma3, 60);
  assert.equal(fired.baseline, 10);

  // Day 13: flat at 10. ma3 = 10 < 40 -> condition (a) fails.
  const flat = evaluateRamp(ds, 'Artemisia', '2025-08-13');
  assert.equal(flat.status, 'not_fired');
  assert.equal(flat.conditions.ma3_at_least, false);
});

test('a high but flat series does not fire the ramp', () => {
  // ma3 = 100 (>= 40) but ratio = 1.0 (< 1.6): condition (b) fails.
  const ds = makeDataset({ start: '2025-08-01', taxa: { Artemisia: new Array(20).fill(100) } });
  const r = evaluateRamp(ds, 'Artemisia', '2025-08-20');
  assert.equal(r.status, 'not_fired');
  assert.equal(r.conditions.ma3_at_least, true);
  assert.equal(r.conditions.ratio_at_least, false);
  assert.equal(r.ratio, 1);
});

test('a ratio just under 1.60 does not fire, just over does', () => {
  const under = makeDataset({
    start: '2025-08-01',
    taxa: { Artemisia: [...new Array(13).fill(40), 63, 63, 63] } // 63/40 = 1.575
  });
  assert.equal(evaluateRamp(under, 'Artemisia', '2025-08-16').status, 'not_fired');

  const over = makeDataset({
    start: '2025-08-01',
    taxa: { Artemisia: [...new Array(13).fill(40), 64, 64, 64] } // 64/40 = 1.60
  });
  assert.equal(evaluateRamp(over, 'Artemisia', '2025-08-16').status, 'fired');
});

test('ramp is undetermined, never false, when a window touches a gap', () => {
  const ds = makeDataset({
    start: '2025-08-01',
    taxa: { Artemisia: [...new Array(13).fill(10), 60, 60, 60] },
    skip: ['2025-08-15']
  });
  const r = evaluateRamp(ds, 'Artemisia', '2025-08-16');
  assert.equal(r.status, 'undetermined');
  assert.equal(r.reason, 'gap_in_window');
});

test('a finished season is "ended", never "not_started"', () => {
  // A spring taxon: rises to a real season, then goes quiet. Asked about a
  // date months later the detector does not fire — but the season plainly
  // happened, so reporting not_started would contradict a season total in the
  // thousands.
  const counts = [...new Array(20).fill(0), ...new Array(20).fill(180), ...new Array(40).fill(0)];
  const ds = makeDataset({ start: '2026-03-01', taxa: { Ulmus: counts } });
  const last = ds.dates[ds.dates.length - 1];
  const s = seasonState(ds, 'Ulmus', last);
  assert.equal(s.state, 'ended');
  assert.ok(s.season_total_to_date > 3000);
  assert.ok(s.peak_ma3_to_date >= 40);
});

test('a season below the detector floor reads as ramping, not peak', () => {
  // Climbing, at its own maximum so far, but the 3-day average has never
  // cleared 40. Calling that a "peak" would overstate 27 grains.
  const counts = [...new Array(14).fill(5), 20, 25, 30, 35];
  const ds = makeDataset({ start: '2026-07-01', taxa: { Artemisia: counts } });
  const last = ds.dates[ds.dates.length - 1];
  const s = seasonState(ds, 'Artemisia', last);
  assert.equal(s.state, 'ramping');
  assert.ok(s.peak_ma3_to_date < 40, 'fixture must stay below the floor');
  assert.equal(s.first_ramp_date, null);
});

test('nothing measured yet this season is still not_started', () => {
  const ds = makeDataset({ start: '2026-07-01', taxa: { Ambrosia: new Array(20).fill(0) } });
  const last = ds.dates[ds.dates.length - 1];
  assert.equal(seasonState(ds, 'Ambrosia', last).state, 'not_started');
});

test('firstRamp returns the earliest firing date, not the first obvious one', () => {
  const ds = rampFixture();
  const r = firstRamp(ds, 'Artemisia', 2025);
  // 15 Aug already satisfies both conditions (ma3 43.33, ratio 4.33) even
  // though the series does not reach its plateau until 16 Aug.
  assert.equal(r.date, '2025-08-15');
  assert.equal(evaluateRamp(ds, 'Artemisia', '2025-08-14').status, 'not_fired');
});

// ── Season summary ───────────────────────────────────────────────────────

test('SPI, peak and 2.5/97.5 bounds on a hand-checkable series', () => {
  // 10 days: 1,1,1,1,1,90,1,1,1,2  -> total 100
  const counts = [1, 1, 1, 1, 1, 90, 1, 1, 1, 2];
  const ds = makeDataset({ start: '2025-08-01', taxa: { Artemisia: counts } });
  const s = seasonSummary(ds, 'Artemisia', 2025);

  assert.equal(s.seasonal_pollen_integral, 100);
  assert.equal(s.peak.count_per_m3, 90);
  assert.equal(s.peak.date, '2025-08-06');

  // cumulative: 1,2,3,4,5,95,96,97,98,100
  // start = first day cum >= 2.5  -> 08-03 (cum 3)
  // end   = first day cum >= 97.5 -> 08-09 (cum 98)
  assert.equal(s.season_start, '2025-08-03');
  assert.equal(s.season_end, '2025-08-09');
});

test('SPI is flagged as a lower bound when the window contains a gap', () => {
  const ds = makeDataset({
    start: '2025-08-01',
    taxa: { Artemisia: new Array(10).fill(5) },
    skip: ['2025-08-04', '2025-08-05']
  });
  const s = seasonSummary(ds, 'Artemisia', 2025, { from: '2025-08-01', to: '2025-08-10' });
  assert.equal(s.spi_is_lower_bound, true);
  assert.equal(s.unmeasured_days_in_window, 2);
  assert.equal(s.measured_days, 8);
  assert.equal(s.seasonal_pollen_integral, 40); // 8 measured days x 5
  assert.equal(s.window.source, 'request');
});

test('SPIn covers the season window, not the calendar year', () => {
  // Two separated bursts: one inside a July-October window, one in December.
  // The window integral must exclude the December burst; all_time_total must
  // include it. Conflating the two is how 7592 was mistaken for 7023.
  const ds = makeDataset({
    start: '2025-07-01',
    taxa: { Artemisia: new Array(200).fill(0).map((_, i) => (i < 10 ? 10 : i >= 165 ? 7 : 0)) }
  });
  const s = seasonSummary(ds, 'Artemisia', 2025, { from: '2025-07-01', to: '2025-10-31' });
  assert.equal(s.seasonal_pollen_integral, 100, 'only the July burst');
  assert.ok(s.all_time_total > s.seasonal_pollen_integral, 'all-time includes the December burst');
  assert.equal(s.all_time_total, 100 + 35 * 7);
});

// ── Season pace ──────────────────────────────────────────────────────────

test('cumulative sums measured days only and reports what is missing', () => {
  const ds = makeDataset({
    start: '2025-07-01',
    taxa: { Artemisia: new Array(10).fill(10) },
    skip: ['2025-07-03', '2025-07-04']
  });
  const c = cumulativeSince(ds, 'Artemisia', '2025-07-01', '2025-07-10');
  assert.equal(c.cumulative, 80);
  assert.equal(c.measured_days, 8);
  assert.equal(c.missing_days, 2);
  assert.deepEqual(c.missing_dates, ['2025-07-03', '2025-07-04']);
});

test('pace ratio is previous/current and exposes the inverse', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) {
    rows.push({ date: `2025-07-0${i + 1}`, v: 100 }); // 2025 -> 600
    rows.push({ date: `2026-07-0${i + 1}`, v: 50 }); // 2026 -> 300
  }
  const two = indexRows(
    rows.map((r) => ({
      date: r.date,
      taxon: 'Artemisia',
      group: 'травы',
      count_per_m3: r.v,
      temp_c: 20,
      humidity_pct: 40,
      wind_ms: 2
    })),
    'SYNTHETIC-FIXTURE'
  );
  const p = seasonPace(two, '2026-07-06', 'Artemisia');
  assert.equal(p.previous.cumulative, 600);
  assert.equal(p.current.cumulative, 300);
  assert.equal(p.ratio, 2);
  assert.equal(p.ratio_current_over_previous, 0.5);
  assert.equal(p.comparable, true);
});

test('pace flags windows that are not comparable', () => {
  const rows = [];
  for (let i = 1; i <= 6; i++) {
    rows.push({ date: `2025-07-0${i}`, v: 100 });
    if (i !== 3) rows.push({ date: `2026-07-0${i}`, v: 100 }); // 2026 missing a day
  }
  const two = indexRows(
    rows.map((r) => ({
      date: r.date,
      taxon: 'Artemisia',
      group: 'травы',
      count_per_m3: r.v,
      temp_c: 20,
      humidity_pct: 40,
      wind_ms: 2
    })),
    'SYNTHETIC-FIXTURE'
  );
  const p = seasonPace(two, '2026-07-06', 'Artemisia');
  assert.equal(p.comparable, false);
  assert.match(p.comparability_note, /unmeasured day/);
});

test('29 February has no counterpart and is reported, not slid to 1 March', () => {
  assert.equal(sameDayInYear('2024-02-29', 2025), null);
  assert.equal(sameDayInYear('2025-08-06', 2024), '2024-08-06');
});

// ── Correlation and grouping ─────────────────────────────────────────────

test('pearson matches a hand-computed value and rejects constants', () => {
  assert.equal(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  assert.equal(Math.round(pearson([1, 2, 3, 4], [4, 3, 2, 1]) * 1000) / 1000, -1);
  assert.equal(pearson([1, 1, 1, 1], [1, 2, 3, 4]), null, 'constant series has no correlation');
  assert.equal(pearson([1, 2], [2, 4]), null, 'n<3 is not enough');
});

test('log-scale correlation linearises a multiplicative relationship', () => {
  // b grows as a squared. On the raw scale that curve is not a straight line;
  // on the log scale it is. This is why collinearity here is defined on logs.
  const a = [1, 2, 4, 8, 16];
  const b = [1, 4, 16, 64, 256];
  const raw = pearson(a, b);
  const log = logPearson(a, b);
  assert.ok(raw < 0.98, `raw r should show the curvature, got ${raw}`);
  assert.ok(log > 0.99, `log r should be near-linear, got ${log}`);
  assert.ok(log > raw);

  // Definitional: logPearson is exactly pearson applied to log1p values.
  assert.equal(log, pearson(a.map((x) => Math.log1p(x)), b.map((x) => Math.log1p(x))));
});

test('grouping is transitive across the threshold', () => {
  // A~B and B~C are above threshold, A~C is not; all three must be one group.
  const groups = connectedComponents(
    ['A', 'B', 'C', 'D'],
    [
      ['A', 'B'],
      ['B', 'C']
    ]
  );
  const sizes = groups.map((g) => g.length).sort();
  assert.deepEqual(sizes, [1, 3]);
  assert.deepEqual(groups.find((g) => g.length === 3), ['A', 'B', 'C']);
});

test('collinear taxa are collapsed into one feature', () => {
  // Two taxa that move together almost exactly, plus one independent.
  const n = 30;
  const a = [];
  const b = [];
  const c = [];
  for (let i = 0; i < n; i++) {
    const base = 5 + ((i * 37) % 100);
    a.push(base);
    b.push(base + (i % 2)); // near-identical -> r ~ 1
    c.push(5 + ((i * 11) % 90)); // unrelated pattern
  }
  const ds = makeDataset({ start: '2025-08-01', taxa: { Salix: a, Ulmus: b, Artemisia: c } });
  const { groups } = inseparableGroups(ds, ['Salix', 'Ulmus', 'Artemisia'], 0.8);
  const collapsed = groups.find((g) => g.inseparable);
  assert.ok(collapsed, 'expected one inseparable group');
  assert.deepEqual(collapsed.taxa, ['Salix', 'Ulmus']);
  assert.ok(groups.some((g) => g.taxa.length === 1 && g.taxa[0] === 'Artemisia'));
});

// ── Logistic regression ──────────────────────────────────────────────────

test('standardise centres and scales, and flags constant columns', () => {
  const { Z, mu, sd, constant } = standardise([
    [1, 5],
    [3, 5],
    [5, 5]
  ]);
  assert.equal(mu[0], 3);
  assert.equal(sd[0], Math.sqrt(8 / 3));
  assert.deepEqual(constant, [1]);
  assert.equal(Z[1][0], 0);
  assert.equal(Z[0][1], 0, 'constant column collapses to 0');
});

test('logistic regression recovers the sign of a real effect', () => {
  const X = [];
  const y = [];
  for (let i = 0; i < 40; i++) {
    const hi = i % 2 === 0;
    X.push([hi ? 5 : 0.1]);
    y.push(hi ? 1 : 0);
  }
  const fit = fitLogisticL2(X, y, { lambda: 0.01, iterations: 4000, learningRate: 0.3 });
  assert.ok(fit.weights[0] > 0, `expected positive weight, got ${fit.weights[0]}`);
  assert.ok(fit.logLoss < 0.4, `expected a good fit, log loss ${fit.logLoss}`);
});

test('L2 shrinks weights as lambda grows', () => {
  const X = [];
  const y = [];
  for (let i = 0; i < 40; i++) {
    const hi = i % 2 === 0;
    X.push([hi ? 5 : 0.1]);
    y.push(hi ? 1 : 0);
  }
  const weak = fitLogisticL2(X, y, { lambda: 0.01, iterations: 3000, learningRate: 0.3 });
  const strong = fitLogisticL2(X, y, { lambda: 100, iterations: 3000, learningRate: 0.3 });
  assert.ok(
    Math.abs(strong.weights[0]) < Math.abs(weak.weights[0]),
    `expected shrinkage: ${strong.weights[0]} vs ${weak.weights[0]}`
  );
});

test('a constant feature never receives a weight', () => {
  const X = [];
  const y = [];
  for (let i = 0; i < 20; i++) {
    X.push([i % 2 === 0 ? 5 : 0, 7]);
    y.push(i % 2 === 0 ? 1 : 0);
  }
  const fit = fitLogisticL2(X, y, { lambda: 1 });
  assert.equal(fit.weights[1], 0);
});

// ── Attribution ──────────────────────────────────────────────────────────

test('attribution refuses to fit when there is too little data', () => {
  const ds = makeDataset({ start: '2025-08-01', taxa: { Artemisia: [1, 90, 1, 90] } });
  const r = attribute(ds, [
    { date: '2025-08-01', severity: 0 },
    { date: '2025-08-02', severity: 3 }
  ]);
  assert.equal(r.fitted, false);
  assert.equal(r.confidence, 'insufficient');
  assert.deepEqual(r.triggers, []);
  assert.match(r.reason, /Not enough usable data/);
});

test('attribution drops symptom days that have no measurement', () => {
  const ds = makeDataset({
    start: '2025-08-01',
    taxa: { Artemisia: new Array(12).fill(10) },
    skip: ['2025-08-05']
  });
  const r = attribute(ds, [
    { date: '2025-08-05', severity: 3 },
    { date: '2025-08-06', severity: 1 }
  ]);
  assert.deepEqual(r.dropped_unmeasured_days, ['2025-08-05']);
  assert.equal(r.usable_days, 1);
});

test('attribution ranks the true trigger first and flags inseparable pairs', () => {
  const n = 40;
  const trigger = [];
  const twin = [];
  const noise = [];
  const log = [];
  for (let i = 0; i < n; i++) {
    const bad = i % 2 === 0;
    trigger.push(bad ? 300 : 2);
    twin.push(bad ? 290 : 3); // moves with the trigger -> inseparable
    noise.push((i * 17) % 60); // unrelated
  }
  const ds = makeDataset({
    start: '2025-08-01',
    taxa: { Artemisia: trigger, Chenopodiaceae: twin, Betula: noise },
    group: { Artemisia: 'травы', Chenopodiaceae: 'травы', Betula: 'древесные' }
  });
  for (let i = 0; i < n; i++) {
    log.push({ date: ds.dates[i], severity: i % 2 === 0 ? 3 : 0 });
  }
  const r = attribute(ds, log);
  assert.equal(r.fitted, true);
  assert.equal(r.confidence, 'high');
  assert.equal(r.usable_days, n);

  const group = r.inseparable_groups.find((g) => g.taxa.includes('Artemisia'));
  assert.ok(group, 'Artemisia and its twin must be reported as inseparable');
  assert.deepEqual(group.taxa.sort(), ['Artemisia', 'Chenopodiaceae']);

  const top = r.triggers[0];
  assert.ok(top.taxa.includes('Artemisia'), `top trigger was ${top.feature}`);
  assert.equal(top.inseparable, true);
  assert.ok(top.weight > 0);

  // The two collinear taxa must never appear as two separate triggers.
  const features = r.triggers.map((t) => t.feature);
  assert.equal(
    features.filter((f) => f.includes('Artemisia') || f.includes('Chenopodiaceae')).length,
    1,
    'collinear taxa must be one feature, not two'
  );
});

// ── Personal index ───────────────────────────────────────────────────────

test('personal score passes exactly through the laboratory breakpoints', () => {
  assert.equal(pollenScore(0), 0);
  assert.equal(pollenScore(10), 0.25);
  assert.equal(pollenScore(50), 0.5);
  assert.equal(pollenScore(200), 0.75);
  assert.equal(pollenScore(1000), 1);
  assert.equal(pollenScore(5000), 1, 'capped, not extrapolated');
});

test('two different profiles give different numbers on the same date', () => {
  const ds = makeDataset({
    start: '2025-08-01',
    taxa: { Artemisia: [400], Betula: [3] },
    group: { Artemisia: 'травы', Betula: 'древесные' }
  });
  const a = personalIndex(ds, '2025-08-01', 'Artemisia:1');
  const b = personalIndex(ds, '2025-08-01', 'Betula:1');
  const mixed = personalIndex(ds, '2025-08-01', 'Artemisia:1,Betula:1');
  assert.notEqual(a.index, b.index);
  assert.ok(a.index > mixed.index && mixed.index > b.index);
  assert.equal(a.contributions[0].taxon, 'Artemisia');
});

test('personal index refuses an unmeasured date and reports unknown taxa', () => {
  const ds = makeDataset({
    start: '2025-08-01',
    taxa: { Artemisia: [400, 400, 400] },
    skip: ['2025-08-02']
  });
  const gap = personalIndex(ds, '2025-08-02', 'Artemisia:1');
  assert.equal(gap.measured, false);
  assert.equal(gap.index, null);

  const unknown = personalIndex(ds, '2025-08-01', 'Nothosuchus:1');
  assert.equal(unknown.index, null);
  assert.deepEqual(unknown.unknown_taxa, ['Nothosuchus']);
});

test('mold in a profile is scored against its clinical threshold, not the pollen scale', () => {
  const ds = makeDataset({
    start: '2025-08-01',
    taxa: { 'Alternaria alternata': [50] },
    group: { 'Alternaria alternata': 'плесень' }
  });
  const r = personalIndex(ds, '2025-08-01', 'Alternaria alternata:1');
  // 50 spores against a 100 threshold = 0.5 -> index 50, and no pollen level.
  assert.equal(r.index, 50);
  assert.equal(r.contributions[0].level, null);
  assert.equal(r.contributions[0].unit, 'spores/m3');
});

// ── Discriminating days ──────────────────────────────────────────────────

test('discriminating days find the split day in a correlated pair', () => {
  // A realistic record: concentrations span orders of magnitude, the pair
  // moves together for 60 days, then comes apart on one day. Real series look
  // like this, and the wide dynamic range is what keeps r high (0.94) despite
  // the exception.
  const a = [];
  const b = [];
  for (let i = 0; i < 60; i++) {
    const v = Math.round(Math.exp((((i * 7) % 40) / 40) * Math.log(500)));
    a.push(v);
    b.push(Math.max(1, Math.round(v * 1.1)));
  }
  a.push(300);
  b.push(2);
  const ds = makeDataset({ start: '2025-08-01', taxa: { Artemisia: a, Chenopodiaceae: b } });
  const r = discriminatingDays(ds, { minR: 0.5 });
  assert.ok(r.total_found >= 1, `expected at least one discriminating day, got ${r.total_found}`);
  const top = r.days[0];
  assert.equal(top.date, '2025-09-30'); // 61st day from 1 Aug
  assert.equal(top.high.taxon, 'Artemisia');
  assert.equal(top.high.level, 'critical');
  assert.equal(top.low.taxon, 'Chenopodiaceae');
  assert.equal(top.low.level, 'low');
});

test('a pair whose correlation is destroyed by its own exceptions is not examined', () => {
  // Twenty background days and one extreme exception drag log-scale r to
  // about -0.08, so the pair falls below the examination threshold. This is a
  // real property of the method, not a defect: with a short record, a single
  // split day removes the very correlation that made it informative. The
  // endpoint must report nothing rather than assert a pairing it cannot show.
  const a = [];
  const b = [];
  for (let i = 0; i < 20; i++) {
    const v = 20 + ((i * 13) % 80);
    a.push(v);
    b.push(v + 1);
  }
  a.push(300);
  b.push(2);
  const ds = makeDataset({ start: '2025-08-01', taxa: { Artemisia: a, Chenopodiaceae: b } });
  const r = discriminatingDays(ds, { minR: 0.5 });
  assert.equal(r.total_found, 0);
  assert.equal(r.pairs_examined.length, 0);
});

// ── Utility ──────────────────────────────────────────────────────────────

test('dateRange is inclusive and UTC-safe across a DST boundary', () => {
  const r = dateRange('2025-03-29', '2025-03-31');
  assert.deepEqual(r, ['2025-03-29', '2025-03-30', '2025-03-31']);
  assert.equal(dateRange('2025-12-31', '2026-01-02').length, 3);
});

// ── Knowledge layer: literature, not measurement ─────────────────────────

test('cross-reactivity is flagged as literature, never as measured', () => {
  const r = crossReactivityFor(['Artemisia (полынь)']);
  assert.equal(r.length, 1);
  assert.equal(r[0].has_data, true);
  assert.ok(r[0].sources.length > 0, 'a literature entry must carry its source');
  assert.ok(TABLE_NOTE.includes('литератур'), 'the table states its own provenance');
});

test('a taxon absent from the table gets an explicit no-data answer', () => {
  // An empty list would read as "no cross-reactivity exists" — a claim this
  // table cannot make. It must say the entry is missing instead.
  // Rumex is a real taxon in the record with no entry in the table — the case
  // this branch exists for. Do not swap it for a taxon the table might later
  // cover, or the assertion stops testing anything.
  const r = crossReactivityFor(['Rumex (щавель)']);
  assert.equal(r[0].has_data, false);
  assert.equal(r[0].foods, null);
  assert.ok(/нет установленных данных/.test(r[0].reason));
  assert.ok(/не доказанное отсутствие/.test(r[0].reason));
});

test('Artemisia carries its syndromes, foods, allergens and sources', () => {
  const [a] = crossReactivityFor(['Artemisia (полынь)']);
  assert.ok(a.syndromes.some((s) => s.includes('сельдерей')));
  assert.ok(a.foods.includes('сельдерей'));
  assert.ok(a.foods.includes('персик'));
  const artv3 = a.allergens.find((x) => x.name === 'Art v 3');
  assert.ok(artv3, 'Art v 3 must be listed');
  assert.ok(/персик/.test(artv3.note), 'its systemic-reaction note must survive');
  assert.ok(a.sources.some((s) => /Thermo Fisher/.test(s)));
});

test('the Latin key survives the Russian gloss', () => {
  assert.equal(latinOf('Artemisia (полынь)'), 'Artemisia');
  assert.equal(latinOf('Alternaria alternata'), 'Alternaria alternata');
  const [b] = crossReactivityFor(['Betula (берёза)']);
  assert.equal(b.has_data, true);
  assert.deepEqual(b.allergens.map((x) => x.name), ['Bet v 1']);
  // No citation was supplied for the Moraceae entry, and the table says so
  // rather than inventing one.
  const [m] = crossReactivityFor(['Moraceae (тутовые)']);
  assert.equal(m.sources.length, 0);
  assert.ok(/не указан/.test(m.sources_note));
});

test('the knowledge table never touches the measurement path', () => {
  // A crude but effective guard: the module must not import the dataset.
  const src = readFileSync(new URL('../src/knowledge/cross-reactivity.js', import.meta.url), 'utf8');
  assert.ok(!/from '\.\.\/load\.js'/.test(src), 'must not import the loader');
  assert.ok(!/countOf|loadDataset|byTaxon/.test(src), 'must not read measurements');
});

test('every table row is graded, and only a graded row may claim evidence', () => {
  // The grade is what lets the interface separate a named syndrome from a case
  // series. A row without one would silently render as if it were established.
  for (const [latin, e] of Object.entries(CROSS_REACTIVITY)) {
    assert.ok(
      e.evidence === 'established' || e.evidence === 'limited',
      `${latin} must be graded established or limited, got ${e.evidence}`
    );
    assert.ok(Array.isArray(e.foods) && e.foods.length > 0, `${latin} must list foods`);
    if (e.evidence === 'limited') {
      assert.ok(e.notes && e.notes.length > 0, `${latin} is limited and must say why`);
    }
  }
});

test('a limited row carries its caveat into the response', () => {
  const [c] = crossReactivityFor(['Cannabaceae (коноплёвые)']);
  assert.equal(c.evidence, 'limited');
  assert.ok(/ограничена/.test(c.evidence_note));
  // The extrapolation from genus to family is stated, not glossed over.
  assert.ok(c.notes.some((n) => /допущение/.test(n)));

  const [p] = crossReactivityFor(['Poaceae (злаковые)']);
  assert.equal(p.evidence, 'established');
  assert.equal(p.evidence_note, null);
});

test('the knowledge module never reaches the dataset', () => {
  // The boundary is the whole point of the layer, so it is asserted, not
  // trusted: a future import of load.js here would make literature look
  // measured.
  const raw = readFileSync(new URL('../src/knowledge/cross-reactivity.js', import.meta.url), 'utf8');
  // The header comment names the dataset in order to say it is NOT used here,
  // so the boundary is asserted against code, not prose.
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  assert.ok(!/\bimport\b/.test(code), 'the table must import nothing at all');
  assert.ok(!/almaty_trap|readFile|fetch\(/.test(code), 'must not read the dataset or the network');
});

// ── Symptom thresholds: a second reading that never touches the first ────

test('the clinical reading never alters the laboratory level', () => {
  // The whole safety property of this feature in one assertion: a taxon with a
  // published threshold and one without must be graded identically by the
  // laboratory scale, because the scale is the credibility anchor.
  const withEntry = describeObservation({
    taxon: 'Artemisia (полынь)',
    group: 'травы',
    count_per_m3: 41
  });
  const withoutEntry = describeObservation({
    taxon: 'Urticaceae (крапивные)',
    group: 'травы',
    count_per_m3: 41
  });
  assert.equal(withEntry.level, 'moderate');
  assert.equal(withoutEntry.level, 'moderate');
  assert.equal(withEntry.level, pollenLevel(41));
  assert.equal(withEntry.count_per_m3, 41);
  // 41 is above the published 5-15, and the level still says moderate. Both
  // statements are true and neither is allowed to rewrite the other.
  assert.equal(withEntry.clinical.position, 'above');
});

test('a taxon with no published threshold gets null, not an estimate', () => {
  const o = describeObservation({ taxon: 'Cyperaceae (осоковые)', group: 'травы', count_per_m3: 80 });
  assert.equal(o.clinical, null, 'absence must be null, never a borrowed range');
  assert.equal(symptomThreshold('Cyperaceae (осоковые)', 80), null);
});

test('a zero count produces no clinical reading', () => {
  // Nothing measured means nothing to compare against a threshold.
  assert.equal(symptomThreshold('Artemisia (полынь)', 0), null);
  assert.equal(symptomThreshold('Artemisia (полынь)', null), null);
});

test('every threshold entry is a range carrying its source', () => {
  for (const [latin, e] of Object.entries(SYMPTOM_THRESHOLDS)) {
    assert.ok(Number.isFinite(e.low) && Number.isFinite(e.high), `${latin} needs numeric bounds`);
    assert.ok(e.low <= e.high, `${latin}: low must not exceed high`);
    assert.ok(typeof e.source === 'string' && e.source.length > 0, `${latin} must name its source`);
  }
  // A single hard number is exactly what the literature does not support, so
  // the reading always exposes both ends and the citation.
  const r = symptomThreshold('Artemisia (полынь)', 41);
  assert.equal(r.low, 5);
  assert.equal(r.high, 15);
  assert.match(r.source, /de Weger/);
  assert.equal(r.measured, false);
  assert.equal(r.source_kind, 'literature');
  assert.equal(r.consensus, 'no_consensus');
});

test('position is decided by the range ends, not by one of them', () => {
  assert.equal(symptomThreshold('Betula (берёза)', 44).position, 'below');
  assert.equal(symptomThreshold('Betula (берёза)', 45).position, 'within');
  assert.equal(symptomThreshold('Betula (берёза)', 100).position, 'within');
  assert.equal(symptomThreshold('Betula (берёза)', 101).position, 'above');
});

test('the threshold table reaches neither the dataset nor the scale', () => {
  const raw = readFileSync(new URL('../src/knowledge/symptom-thresholds.js', import.meta.url), 'utf8');
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  assert.ok(!/\bimport\b/.test(code), 'the table must import nothing at all');
  assert.ok(!/POLLEN_SCALE|almaty_trap|readFile|fetch\(/.test(code), 'must not read the scale or the dataset');
  assert.ok(/литератур/.test(THRESHOLD_NOTE), 'the note must state its provenance');
  assert.ok(/консенсус|расход/.test(THRESHOLD_NOTE), 'the note must state the lack of consensus');
});

test('the daily-total series carries measured days only', () => {
  // The sparkline under the headline number must be the same quantity as the
  // number, and a gap must be absent from the array rather than a zero — a
  // zero would draw a plunge to the floor on a day nobody counted.
  const ds = makeDataset({
    start: '2025-08-01',
    taxa: { Artemisia: [10, 20, 30, 40], 'Alternaria alternata': [5, 5, 5, 5] },
    group: { Artemisia: 'травы', 'Alternaria alternata': 'плесень' },
    skip: ['2025-08-03']
  });
  const s = pollenTotalSeries(ds, '2025-08-01', '2025-08-04');
  assert.deepEqual(s.map((r) => r.date), ['2025-08-01', '2025-08-02', '2025-08-04']);
  assert.ok(!s.some((r) => r.date === '2025-08-03'), 'the gap day must be absent, not zero');
  // Mold is excluded: it is not on the pollen scale and must not inflate a
  // pollen total.
  assert.equal(s[0].total_per_m3, 10);
  assert.equal(s[0].level, 'low');
});

test('a measured day names its neighbours too', () => {
  // The delta beside the headline needs the previous MEASURED day, not
  // yesterday: on this record yesterday is frequently a gap.
  const ds = makeDataset({
    start: '2025-08-01',
    taxa: { Artemisia: [10, 20, 30, 40] },
    skip: ['2025-08-03']
  });
  const d = dayReport(ds, '2025-08-04');
  assert.equal(d.measured, true);
  assert.equal(d.previous_measured_date, '2025-08-02', 'must skip the gap, not point at it');
  assert.equal(d.next_measured_date, null);
});

test('a declined fit returns a code and its thresholds, not only English prose', () => {
  // A localised interface must be able to say why without parsing English or
  // restating the thresholds itself.
  const ds = makeDataset({ start: '2025-08-01', taxa: { Artemisia: [10, 20, 30, 40] } });
  const r = attribute(ds, [
    { date: '2025-08-01', severity: 3 },
    { date: '2025-08-02', severity: 0 }
  ]);
  assert.equal(r.fitted, false);
  assert.equal(r.reason_code, 'insufficient_data');
  assert.equal(r.requirements.min_days, 8);
  assert.equal(r.requirements.min_per_class, 3);
  assert.ok(r.reason.length > 0, 'the English prose stays for API readers');
});

test('a diary with no variation is named as such', () => {
  const ds = makeDataset({ start: '2025-08-01', taxa: { Artemisia: new Array(12).fill(0) } });
  const r = attribute(
    ds,
    Array.from({ length: 12 }, (_, i) => ({
      date: `2025-08-${String(i + 1).padStart(2, '0')}`,
      severity: i % 2 ? 3 : 0
    }))
  );
  assert.equal(r.fitted, false);
  assert.equal(r.reason_code, 'no_variation');
});
