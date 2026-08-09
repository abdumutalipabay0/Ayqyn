/* ──────────────────────────────────────────────────────────────────────────
   Season chart — hand-rolled SVG.

   Three things a library would have fought me on, and the reason there is no
   library here:

     1. A gap is not a zero and not a straight line. Consecutive rows in the
        series can be weeks apart on the calendar; the path must break there,
        and the break must be drawn as an explicit "нет данных" band rather
        than left as ambiguous whitespace.
     2. Three dated annotations, one of which is a false alarm and has to read
        as prominently as the successes.
     3. The viewBox is the container's real pixel width, so text renders at
        the size it is set in instead of being scaled to 3px on a phone.

   Marks follow the dataviz specs: 2px lines, ≥8px markers with a 2px surface
   ring, hairline solid gridlines one step off surface, selective labels only.
   ────────────────────────────────────────────────────────────────────────── */

const NS = 'http://www.w3.org/2000/svg';
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  return n;
};
const parseDate = (s) => new Date(`${s}T00:00:00Z`);
const dayDiff = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const isoAdd = (iso, n) => {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Split a measured series wherever two consecutive points are not adjacent
 *  days. Each returned run is safe to draw as one continuous path. */
export function runs(series) {
  const out = [];
  let cur = [];
  for (let i = 0; i < series.length; i++) {
    if (i > 0 && dayDiff(series[i - 1].date, series[i].date) > 1) {
      if (cur.length) out.push(cur);
      cur = [];
    }
    cur.push(series[i]);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Calendar ranges inside [from,to] that the series does not cover. These are
 *  drawn as hatched bands and labelled — never left as blank axis. */
export function gapsIn(series, from, to) {
  const have = new Set(series.map((r) => r.date));
  const out = [];
  let start = null;
  for (let d = from; d <= to; d = isoAdd(d, 1)) {
    if (!have.has(d)) {
      if (start === null) start = d;
    } else if (start !== null) {
      out.push({ from: start, to: isoAdd(d, -1) });
      start = null;
    }
  }
  if (start !== null) out.push({ from: start, to });
  return out;
}

/** Rewrite a series' dates into `year`, keeping month and day, so two seasons
 *  can share one calendar axis. Consecutive days stay consecutive, so gap
 *  detection is unaffected. */
export function shiftToYear(series, year) {
  return series.map((r) => ({ ...r, date: `${year}${r.date.slice(4)}`, originalDate: r.date }));
}

/**
 * @param {object} o
 *   width            container width in CSS px
 *   window           {from,to} calendar window
 *   primary          {label, series:[{date,count_per_m3}]}   completed season
 *   secondary        {label, series:[...]} | null            current season
 *   annotations      [{date, text, miss?}]
 *   peak             {date, count_per_m3} | null
 *   onHover          (payload|null) => void
 */
export function seasonChart(o) {
  const W = Math.max(320, Math.round(o.width || 640));
  const narrow = W < 620;
  // `compact` is for a small multiple sitting under a full chart.
  const H = o.compact ? (narrow ? 120 : 150) : narrow ? 240 : 360;
  const M = narrow
    ? { t: 26, r: 12, b: 30, l: 38 }
    : { t: 30, r: 18, b: 34, l: 52 };
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;

  const win = o.window;
  const total = Math.max(1, dayDiff(win.from, win.to));
  const x = (iso) => M.l + (dayDiff(win.from, iso) / total) * iw;

  const all = [...o.primary.series, ...(o.secondary?.series ?? [])];
  const maxY = Math.max(1, ...all.map((r) => r.count_per_m3));
  const y = (v) => M.t + ih - (v / maxY) * ih;

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: W,
    height: H,
    class: 'chart',
    role: 'img',
    'aria-label': o.ariaLabel || 'График сезона'
  });

  // Hatch for unmeasured stretches. The id must be unique per instance — two
  // charts on one page would otherwise both resolve to the first pattern.
  const hatchId = `nodata-${Math.random().toString(36).slice(2, 9)}`;
  const defs = el('defs');
  const pat = el('pattern', {
    id: hatchId,
    width: 7,
    height: 7,
    patternUnits: 'userSpaceOnUse',
    patternTransform: 'rotate(45)'
  });
  pat.append(el('rect', { width: 7, height: 7, fill: 'var(--surface-sunk)' }));
  pat.append(el('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: 'var(--hatch)', 'stroke-width': 1.5 }));
  defs.append(pat);
  svg.append(defs);

  // ── y grid ──────────────────────────────────────────────────────────────
  const ticks = narrow ? 3 : 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (maxY / ticks) * i;
    svg.append(el('line', { class: 'grid', x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) }));
    const t = el('text', { class: 'tick', x: M.l - 7, y: y(v) + 4, 'text-anchor': 'end' });
    t.textContent = Math.round(v).toLocaleString('ru-RU');
    svg.append(t);
  }

  // ── unmeasured bands ────────────────────────────────────────────────────
  // Bands for the primary series, plus any the caller passes explicitly. The
  // second kind exists because an overlay of two seasons has two different
  // sets of missing days, and hiding the overlay's would quietly present an
  // incomplete window as a complete one.
  const bands = gapsIn(o.primary.series, win.from, win.to).map((g) => ({ ...g, label: 'нет данных' }));
  for (const g of o.extraGaps ?? []) bands.push({ ...g, extra: true });

  for (const g of bands) {
    const x0 = x(g.from);
    const x1 = x(g.to);
    if (x1 - x0 < 2) continue;
    svg.append(
      el('rect', { class: 'nodata', x: x0, y: M.t, width: x1 - x0, height: ih, fill: `url(#${hatchId})` })
    );
    if (g.label && x1 - x0 > (narrow ? 30 : 56)) {
      const t = el('text', {
        class: 'nodata-label',
        x: (x0 + x1) / 2,
        y: g.extra ? M.t + 12 : M.t + ih / 2,
        'text-anchor': 'middle'
      });
      t.textContent = g.label;
      svg.append(t);
    }
  }

  // ── x axis: month starts ────────────────────────────────────────────────
  for (let d = win.from; d <= win.to; d = isoAdd(d, 1)) {
    if (d.slice(8) !== '01') continue;
    svg.append(el('line', { class: 'grid', x1: x(d), x2: x(d), y1: M.t, y2: M.t + ih }));
    const t = el('text', { class: 'tick', x: x(d) + 4, y: H - 12 });
    t.textContent = MONTHS_SHORT[parseDate(d).getUTCMonth()];
    svg.append(t);
  }
  svg.append(el('line', { class: 'axis', x1: M.l, x2: W - M.r, y1: M.t + ih, y2: M.t + ih }));

  // ── primary season: wash + 2px stroke, broken at every gap ──────────────
  for (const run of runs(o.primary.series)) {
    if (run.length < 2) {
      const p = run[0];
      svg.append(el('circle', { class: 'dot-primary', cx: x(p.date), cy: y(p.count_per_m3), r: 3 }));
      continue;
    }
    const line = run.map((r, i) => `${i ? 'L' : 'M'}${x(r.date).toFixed(1)},${y(r.count_per_m3).toFixed(1)}`).join('');
    svg.append(
      el('path', {
        class: 'area-primary',
        d: `${line}L${x(run.at(-1).date).toFixed(1)},${y(0)}L${x(run[0].date).toFixed(1)},${y(0)}Z`
      })
    );
    svg.append(el('path', { class: 'line-primary', d: line }));
  }

  // ── secondary season: dashed stroke, no fill. Pattern, not a second hue. ─
  if (o.secondary?.series?.length) {
    for (const run of runs(o.secondary.series)) {
      if (run.length < 2) continue;
      svg.append(
        el('path', {
          class: 'line-secondary',
          d: run.map((r, i) => `${i ? 'L' : 'M'}${x(r.date).toFixed(1)},${y(r.count_per_m3).toFixed(1)}`).join('')
        })
      );
    }
  }

  // ── peak: the one direct label the chart carries ────────────────────────
  if (o.peak && o.peak.count_per_m3 > 0) {
    const px = x(o.peak.date);
    const py = y(o.peak.count_per_m3);
    svg.append(el('circle', { class: 'ring', cx: px, cy: py, r: 6 }));
    svg.append(el('circle', { class: 'dot-primary', cx: px, cy: py, r: 4 }));
    const anchor = px > W * 0.7 ? 'end' : 'start';
    const t = el('text', {
      class: 'peak-label',
      x: px + (anchor === 'end' ? -10 : 10),
      y: py + 4,
      'text-anchor': anchor
    });
    t.textContent = o.peak.count_per_m3.toLocaleString('ru-RU');
    svg.append(t);
  }

  // ── where today sits on this curve ──────────────────────────────────────
  if (o.nowMarker) {
    const nx = x(o.nowMarker.date);
    svg.append(el('line', { class: 'now', x1: nx, x2: nx, y1: M.t, y2: M.t + ih }));
    const anchor = nx > W * 0.62 ? 'end' : 'start';
    const t = el('text', {
      class: 'now-label',
      x: nx + (anchor === 'end' ? -6 : 6),
      y: M.t + 16,
      'text-anchor': anchor
    });
    t.textContent = o.nowMarker.label;
    svg.append(t);
  }

  // ── annotations: numbered keys only; the wording is in the list below ───
  (o.annotations ?? []).forEach((a, i) => {
    const px = x(a.date);
    const pt = o.primary.series.find((r) => r.date === a.date);
    const py = pt ? y(pt.count_per_m3) : M.t + ih;
    const ky = M.t - 12;
    svg.append(
      el('line', { class: `ann${a.miss ? ' ann-miss' : ''}`, x1: px, x2: px, y1: ky + 9, y2: py - 5 })
    );
    svg.append(el('circle', { class: `ann-key${a.miss ? ' ann-key-miss' : ''}`, cx: px, cy: ky, r: 9 }));
    const t = el('text', { class: 'ann-num', x: px, y: ky + 4, 'text-anchor': 'middle' });
    t.textContent = String(i + 1);
    svg.append(t);
  });

  // ── hover layer: crosshair + payload out to the caller ──────────────────
  const cross = el('line', { class: 'cross', x1: 0, x2: 0, y1: M.t, y2: M.t + ih, opacity: 0 });
  const hoverDot = el('circle', { class: 'hover-dot', r: 5, opacity: 0 });
  svg.append(cross, hoverDot);

  const byDate = new Map(o.primary.series.map((r) => [r.date, r]));
  const measured = o.primary.series.map((r) => r.date);

  const locate = (clientX) => {
    const box = svg.getBoundingClientRect();
    const rel = ((clientX - box.left) / box.width) * W;
    const dayIdx = Math.round(((rel - M.l) / iw) * total);
    const iso = isoAdd(win.from, Math.max(0, Math.min(total, dayIdx)));
    return iso;
  };

  const move = (clientX) => {
    const iso = locate(clientX);
    const hit = byDate.get(iso);
    cross.setAttribute('x1', x(iso));
    cross.setAttribute('x2', x(iso));
    cross.setAttribute('opacity', 1);
    if (hit) {
      hoverDot.setAttribute('cx', x(iso));
      hoverDot.setAttribute('cy', y(hit.count_per_m3));
      hoverDot.setAttribute('opacity', 1);
    } else {
      hoverDot.setAttribute('opacity', 0);
    }
    o.onHover?.({
      date: iso,
      measured: !!hit,
      value: hit ? hit.count_per_m3 : null,
      x: x(iso) / W
    });
  };
  const leave = () => {
    cross.setAttribute('opacity', 0);
    hoverDot.setAttribute('opacity', 0);
    o.onHover?.(null);
  };

  svg.addEventListener('pointermove', (e) => move(e.clientX));
  svg.addEventListener('pointerdown', (e) => move(e.clientX));
  svg.addEventListener('pointerleave', leave);

  // Keyboard: the chart is focusable and steps through measured days, so the
  // tooltip is not hover-only.
  svg.setAttribute('tabindex', '0');
  let kb = -1;
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    kb = Math.max(0, Math.min(measured.length - 1, kb + (e.key === 'ArrowRight' ? 1 : -1)));
    const iso = measured[kb];
    const hit = byDate.get(iso);
    cross.setAttribute('x1', x(iso));
    cross.setAttribute('x2', x(iso));
    cross.setAttribute('opacity', 1);
    hoverDot.setAttribute('cx', x(iso));
    hoverDot.setAttribute('cy', y(hit.count_per_m3));
    hoverDot.setAttribute('opacity', 1);
    o.onHover?.({ date: iso, measured: true, value: hit.count_per_m3, x: x(iso) / W });
  });
  svg.addEventListener('blur', leave);

  return svg;
}

/**
 * A sparkline: one series, one colour, no frame, no gridlines.
 *
 * `scaleMax` is passed in rather than derived, so a column of sparklines can
 * share one scale. Normalising each line to its own maximum is the classic
 * defect — unequal changes come out looking identical.
 *
 * `log: true` compresses a wide dynamic range. Say so in the caption when you
 * use it; a log axis that is not announced is a lie by omission.
 *
 * Gaps break the path. At this size a bridged gap is invisible and would read
 * as a genuine low.
 */
export function sparkline({ series, valueOf = (r) => r.count_per_m3, scaleMax, width = 132, height = 26, log = false }) {
  if (!series || !series.length) return null;
  const w = width;
  const h = height;
  const top = log ? Math.log1p(Math.max(1, scaleMax)) : Math.max(1, scaleMax);
  const norm = (v) => (log ? Math.log1p(Math.max(0, v)) : Math.max(0, v)) / top;

  const t0 = Date.parse(series[0].date);
  const span = Math.max(1, Date.parse(series.at(-1).date) - t0);
  const x = (d) => ((Date.parse(d) - t0) / span) * (w - 2) + 1;
  const y = (v) => h - 1 - Math.min(1, norm(v)) * (h - 3);

  const runs = [];
  let cur = [];
  for (let i = 0; i < series.length; i++) {
    if (i > 0 && Math.round((Date.parse(series[i].date) - Date.parse(series[i - 1].date)) / 86400000) > 1) {
      if (cur.length) runs.push(cur);
      cur = [];
    }
    cur.push(series[i]);
  }
  if (cur.length) runs.push(cur);

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (const run of runs) {
    const d = run.map((r, i) => `${i ? 'L' : 'M'}${x(r.date).toFixed(1)} ${y(valueOf(r)).toFixed(1)}`).join(' ');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    svg.append(path);
  }
  return svg;
}
