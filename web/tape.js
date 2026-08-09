/* ──────────────────────────────────────────────────────────────────────────
   The tape.

   A Burkard trap pulls one adhesive tape past its orifice, one drum turn per
   week; the lab cuts it into 24-hour segments and reads each under the
   microscope. This component is that object.

   The rule it exists to enforce: a day the trap did not run has NO TAPE. It is
   a cut-out — hatched, transparent, showing the surface through — never a
   pale cell that could be mistaken for "we measured, and it was low".

   Grayscale: level is carried by the ordinal ramp's lightness, so darker still
   reads as higher with colour removed, and the cut-out reads by its texture,
   not its tone. Verified in the grayscale pass.
   ────────────────────────────────────────────────────────────────────────── */

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const parseDate = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (s) => {
  const d = parseDate(s);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const isoAdd = (iso, n) => {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Minimum readable segment. Below this the strip stops being data and becomes
 *  decoration, and the component says so rather than drawing it. */
export const MIN_SEGMENT_PX = 8;

/**
 * @param {object} o
 *   from, to        inclusive calendar range
 *   valueFor(date)  number for a measured day, undefined for an unmeasured one
 *   levelOf(count)  count -> level name, from /api/meta
 *   width           available px; used only to decide feasibility
 *   onPick(payload) tap/hover handler
 */
export function tape(o) {
  const days = [];
  for (let d = o.from; d <= o.to; d = isoAdd(d, 1)) days.push(d);

  const root = document.createElement('div');
  root.className = 'tape';

  // Feasibility, checked rather than assumed. 2px surface gaps between cells.
  const per = (o.width - (days.length - 1) * 2) / days.length;
  if (o.width && per < MIN_SEGMENT_PX) {
    root.dataset.tooDense = 'true';
  }

  const strip = document.createElement('div');
  strip.className = 'tape__strip';
  strip.setAttribute('role', 'img');

  let measured = 0;
  for (let i = 0; i < days.length; i++) {
    const date = days[i];
    const v = o.valueFor(date);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'tape__day';
    // The drum turns once a week; every 7th boundary gets a tick.
    if (i > 0 && i % 7 === 0) cell.dataset.week = 'true';

    if (v === undefined) {
      cell.dataset.gap = 'true';
      cell.setAttribute('aria-label', `${fmt(date)} — ловушка не работала`);
      cell.title = `${fmt(date)} — ловушка не работала`;
    } else {
      measured++;
      const lvl = o.levelOf(v);
      cell.style.setProperty('--f', `var(--lvl-${lvl})`);
      cell.dataset.lvl = String(lvl);
      const t = `${fmt(date)} — ${v} зёрен/м³`;
      cell.setAttribute('aria-label', t);
      cell.title = t;
    }

    const pick = () => o.onPick?.(v === undefined ? { date, measured: false } : { date, measured: true, value: v });
    cell.addEventListener('pointerenter', pick);
    cell.addEventListener('focus', pick);
    cell.addEventListener('click', pick);
    strip.append(cell);
  }

  strip.setAttribute(
    'aria-label',
    `Лента ловушки, ${days.length} дней: измерено ${measured}, без измерений ${days.length - measured}`
  );

  const scale = document.createElement('div');
  scale.className = 'tape__scale';
  scale.innerHTML = `<span>${fmt(o.from)}</span><span>${fmt(o.to)}</span>`;

  root.append(strip, scale);
  root.dataset.measured = String(measured);
  root.dataset.gaps = String(days.length - measured);
  return root;
}
