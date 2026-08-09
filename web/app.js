/* ──────────────────────────────────────────────────────────────────────────
   Almaty Aerobiology

   Two rules this file is built around:

   1. No data numeral is written here. Every figure — including the threshold
      scale itself — is fetched. `levelOf()` reads its band edges from
      /api/meta, so a scale change on the server cannot leave the interface
      lying.
   2. Every screen ends with exactly one action, and the copy describes rather
      than prescribes: "есть смысл обсудить с аллергологом", never "начните".

   State lives in memory. Nothing is written to storage.
   ────────────────────────────────────────────────────────────────────────── */

import { seasonChart, shiftToYear } from '/chart.js';
import { tape } from '/tape.js';
import { makeExplorer } from '/explorer.js';

// ── helpers ──────────────────────────────────────────────────────────────

const $ = (s, r = document) => r.querySelector(s);
const add = (p, ...kids) => {
  for (const k of kids.flat()) {
    if (k === null || k === undefined || k === false) continue;
    p.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return p;
};
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  add(n, ...kids);
  return n;
};
const clear = (n) => {
  while (n.firstChild) n.removeChild(n.firstChild);
  return n;
};

const RU = new Intl.NumberFormat('ru-RU');
const num = (n) => RU.format(n);
const D_FULL = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const D_SHORT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const parseDate = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (s) => D_FULL.format(parseDate(s));
const fmtShort = (s) => D_SHORT.format(parseDate(s));
const dayDiff = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const isoAdd = (iso, n) => {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const todayISO = () => new Date().toISOString().slice(0, 10);

function plural(n, one, few, many) {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}

/** "Artemisia (полынь)" → readable label; a "(неопред.)" gloss names nothing. */
function splitName(taxon) {
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(taxon);
  return m ? { latin: m[1], ru: m[2] } : { latin: taxon, ru: null };
}
function label(taxon) {
  const { latin, ru } = splitName(taxon);
  if (!ru || /^неопред/i.test(ru)) return latin;
  return ru.charAt(0).toUpperCase() + ru.slice(1);
}

const LEVEL_WORD = ['нет', 'низкий', 'умеренный', 'высокий', 'критический'];
const STATE_WORD = {
  not_started: 'ещё не начался',
  ramping: 'нарастает',
  peak: 'на пике',
  declining: 'идёт на спад',
  ended: 'закончился',
  undetermined: 'нельзя определить'
};
const CONF_WORD = { insufficient: 'данных мало', low: 'низкая', medium: 'средняя', high: 'высокая' };
const CONF_STEPS = { insufficient: 0, low: 1, medium: 2, high: 3 };

// ── icons: inline, 1.5px stroke, one visual language ─────────────────────

const svg = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  today: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5"/>'),
  trigger: svg('<path d="M12 21s-7-4.6-7-10a7 7 0 0 1 14 0c0 5.4-7 10-7 10Z"/><circle cx="12" cy="11" r="2.5"/>'),
  season: svg('<path d="M3 17l4.5-5 3.5 3.5L21 6"/>'),
  year: svg('<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  flat: svg('<path d="M5 12h14"/>'),
  arrow: svg('<path d="M5 12h13M13 6l6 6-6 6"/>')
};

// ── network ──────────────────────────────────────────────────────────────

let announcedCache = false;
const memo = new Map();

async function api(path, opts = {}) {
  const { method = 'GET', body = null, memoise = true } = opts;
  if (memoise && method === 'GET' && memo.has(path)) return memo.get(path);
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.headers.get('X-From-Cache') === '1' && !announcedCache) {
    announcedCache = true;
    const n = $('#net');
    if (n) n.hidden = false;
  }
  if (!res.ok) {
    const e = new Error(`${path} → ${res.status}`);
    e.status = res.status;
    try {
      e.payload = await res.json();
    } catch {
      /* body was not json */
    }
    throw e;
  }
  const json = await res.json();
  if (memoise && method === 'GET') memo.set(path, json);
  return json;
}

async function pool(items, worker, size = 6) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await worker(items[k], k);
      }
    })
  );
  return out;
}

// ── state ────────────────────────────────────────────────────────────────

const S = {
  meta: null,
  bands: [],
  view: 'today',
  drawn: new Set(),
  log: [],
  logCursor: 0,
  logDates: [],
  profile: null
};

/** Band index for a count, from the scale the API publishes. */
function levelOf(count) {
  for (let i = 0; i < S.bands.length; i++) {
    const b = S.bands[i];
    const max = b.max === null ? Infinity : b.max;
    if (count >= b.min && count <= max) return i;
  }
  return 0;
}

// ── shared pieces ────────────────────────────────────────────────────────

const statusNode = (t) => el('div', { class: 'status', text: t });
const emptyNode = (title, body) => el('div', { class: 'empty' }, el('strong', { text: title }), body);

function errorNode(e) {
  const off = e?.status === 503 || e instanceof TypeError;
  return emptyNode(
    off ? 'Нет соединения' : 'Не удалось получить данные',
    off
      ? 'Этот блок ещё ни разу не загружался, поэтому в кэше его нет. Подключитесь к сети и обновите.'
      : e?.payload?.message || e?.message || 'Повторите позже.'
  );
}

/** Four cells, first n filled. The level survives with colour removed. */
function stepper(lvl) {
  const s = el('span', { class: 'stepper', 'aria-hidden': 'true' });
  for (let i = 1; i <= 4; i++) s.append(el('span', { class: 'stepper__cell', 'data-on': String(i <= lvl) }));
  return s;
}

/** The verdict chip. Colour rides here — never on the digits. */
function verdict(lvl) {
  return el(
    'span',
    {
      class: 'verdict',
      style: `--f: var(--lvl-${lvl}); --on-f: var(--on-lvl-${lvl})`,
      'aria-label': `Уровень ${lvl} из 4: ${LEVEL_WORD[lvl]}`
    },
    stepper(lvl),
    el('span', { text: LEVEL_WORD[lvl] })
  );
}

/** The action that closes every screen. */
function action(text, hint, onClick) {
  return el(
    'div',
    { class: 'action' },
    hint ? el('p', { class: 'action__hint', text: hint }) : null,
    el(
      'button',
      { class: 'btn btn--block', type: 'button', onclick: onClick },
      el('span', { text }),
      el('span', { html: ICONS.arrow, style: 'width:20px;height:20px;display:inline-flex' })
    )
  );
}

function levelKey(withGap = true) {
  const k = el('div', { class: 'key' });
  if (withGap) add(k, el('span', {}, el('i', { 'data-gap': 'true' }), 'нет измерений'));
  for (let i = 1; i <= 4; i++) add(k, el('span', {}, el('i', { style: `--f: var(--lvl-${i})` }), LEVEL_WORD[i]));
  return k;
}

/**
 * The second reading beside a taxon's count: the concentration at which
 * sensitised people are reported to start noticing symptoms.
 *
 * Returns null — drawing nothing — for any taxon the literature does not cover.
 * That is the whole rule: no borrowed value, no "similar to birch", no dash
 * standing in for a number we do not have.
 *
 * Where it does draw, it names the laboratory level in words on the same line.
 * The bar's colour already encodes that level, but this is the one place in the
 * product where two scales meet, and "умеренный · выше порога симптомов" only
 * reads as two answers to two questions if both are actually spelled out.
 */
function clinicalLine(t) {
  const c = t.clinical;
  if (!c) return null;

  const POSITION = {
    above: 'выше порога появления симптомов у чувствительных',
    within: 'в пределах порога появления симптомов у чувствительных',
    below: 'ниже порога появления симптомов'
  };

  return el(
    'div',
    { class: 'bar__clinical' },
    el('span', { class: 'bar__lab', text: `${LEVEL_WORD[levelOf(t.count_per_m3)]} по лабораторной шкале` }),
    el(
      'span',
      { class: 'bar__lit' },
      el('span', { class: 'bar__litmark', text: 'из литературы' }),
      // The range and the source travel together — a threshold without the
      // study it came from would read as a settled fact, which it is not.
      `порог симптомов ${num(c.low)}–${num(c.high)} · ${c.source} — ${POSITION[c.position]}`,
      c.note ? el('span', { class: 'bar__litnote', text: c.note }) : null
    )
  );
}

const redraws = new Set();
const onResize = (fn) => redraws.add(fn);

// ── SCREEN 1 — Сегодня ───────────────────────────────────────────────────

async function drawToday() {
  const date = S.meta.record.last_date;

  try {
    const day = await api(`/api/day/${date}`);
    let prev = null;
    if (day.previous_measured_date) {
      try {
        prev = await api(`/api/day/${day.previous_measured_date}`);
      } catch {
        /* the comparison is optional; its absence is stated, never faked */
      }
    }

    let personal = null;
    if (S.profile) {
      personal = await api(`/api/personal-index?${new URLSearchParams({ date, profile: S.profile })}`, { memoise: false });
    }
    const usePersonal = personal && personal.index !== null;

    const value = usePersonal ? personal.index : day.pollen.total_per_m3;
    const lvl = usePersonal ? levelOf(personal.equivalent_count_per_m3) : levelOf(day.pollen.total_per_m3);
    const dominant = day.pollen.dominant ? label(day.pollen.dominant) : null;

    let compare = null;
    if (prev?.measured && !usePersonal) {
      const before = prev.pollen.total_per_m3;
      const d = day.pollen.total_per_m3 - before;
      const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
      const word = d === 0 ? 'столько же, сколько' : d > 0 ? `на ${num(d)} больше, чем` : `на ${num(-d)} меньше, чем`;
      compare = el(
        'p',
        { class: 'hero__compare' },
        el('span', { html: ICONS[dir], style: 'width:18px;height:18px;display:inline-flex;color:var(--ink-3)' }),
        el('span', { text: `${word} ${fmtShort(day.previous_measured_date)}` })
      );
    }

    add(
      clear($('#t-hero')),
      el(
        'div',
        { class: 'tile' },
        el('span', { class: 'hero__label', text: usePersonal ? 'Сегодня для вас' : 'Пыльцы в воздухе' }),
        el('strong', { class: 'hero__value', text: num(value) }),
        el('p', {
          class: 'hero__unit',
          text: usePersonal ? 'из 100 — по вашему профилю' : // Dash, not a bare noun: "больше всего полынь" needs the genitive, and taxon
// names arrive from the API undeclined.
`зёрен/м³${dominant ? ` · больше всего — ${dominant.toLowerCase()}` : ''}`
        }),
        verdict(lvl),
        compare,
        usePersonal
          ? el('p', {
              class: 'note',
              text: `Для вас это сопоставимо с ${num(personal.equivalent_count_per_m3)} зёрен/м³. Общий уровень в этот день — ${num(day.pollen.total_per_m3)}: он считается по всем таксонам, а не по вашим.`
            })
          : null,
        S.profile
          ? action('Посмотреть, что именно вас задевает', null, () => show('trigger'))
          : action('Отметить, как вы себя чувствуете', 'Несколько отмеченных дней — и это число начнёт считаться по вашим таксонам.', () => show('trigger'))
      )
    );

    // Что в воздухе
    const pollen = day.taxa.filter((t) => t.unit === 'grains/m3');
    const max = pollen.length ? pollen[0].count_per_m3 : 0;
    const bars = el('div', { class: 'bars' });
    let anyClinical = false;

    // Grouped by the laboratory's own classification, which arrives in
    // /api/meta. Ten flat bars are a list; grouped, they answer "деревья или
    // травы?" — the first question anyone with hay fever asks.
    const groupOf = new Map();
    for (const [g, list] of Object.entries(S.meta.taxa.groups ?? {})) for (const t of list) groupOf.set(t, g);
    // Every pollen group in the record appears, including the ones at zero. On
    // a measured day a taxon missing from the payload was counted and found at
    // zero — the day itself is not a gap — so "древесные · 0" is a measurement,
    // and for someone allergic to birch it is the answer they came for.
    const moldSet = new Set(S.meta.taxa.mold);
    const allGroups = Object.entries(S.meta.taxa.groups ?? {})
      .filter(([, list]) => list.some((t) => !moldSet.has(t)))
      .map(([g]) => g);
    const byGroup = allGroups
      .map((g) => ({ g, taxa: pollen.filter((t) => (groupOf.get(t.taxon) ?? 'без группы') === g) }))
      .sort((a, b) => b.taxa.reduce((s, t) => s + t.count_per_m3, 0) - a.taxa.reduce((s, t) => s + t.count_per_m3, 0));

    for (const { g, taxa } of byGroup) {
      const sum = taxa.reduce((a, t) => a + t.count_per_m3, 0);
      add(
        bars,
        el(
          'div',
          { class: 'bars__group', 'data-empty': String(sum === 0) },
          el('span', { class: 'bars__gname', text: g }),
          el('span', {
            class: 'bars__gsum tnum',
            text: sum === 0 ? 'сегодня не обнаружено' : `${num(sum)} зёрен/м³`
          })
        )
      );
      for (const t of taxa) {
      if (t.clinical) anyClinical = true;
      add(
        bars,
        el(
          'div',
          { class: 'bar' },
          el('div', { class: 'bar__name' }, label(t.taxon), ' ', el('span', { class: 'bar__latin', text: splitName(t.taxon).latin })),
          el('div', { class: 'bar__value tnum', text: num(t.count_per_m3) }),
          el(
            'div',
            { class: 'bar__track' },
            el('span', {
              class: 'bar__fill',
              style: `width:${max ? (t.count_per_m3 / max) * 100 : 0}%; --f: var(--lvl-${levelOf(t.count_per_m3)})`
            })
          ),
          clinicalLine(t)
        )
      );
      }
    }
    add(
      clear($('#t-air')),
      el(
        'div',
        { class: 'tile' },
        el('span', { class: 'eyebrow', text: 'Что в воздухе' }),
        el('h2', { text: `${pollen.length} ${plural(pollen.length, 'таксон', 'таксона', 'таксонов')} с ненулевым счётом` }),
        pollen.length ? bars : emptyNode('Пыльцы не обнаружено', 'Ловушка работала, но ни один таксон не дал ненулевого счёта.'),
        levelKey(false),
        // The caveat text comes from /api/meta, like every other figure here,
        // so the interface cannot drift from what the API actually claims.
        anyClinical && S.meta.symptom_thresholds
          ? el('p', { class: 'note note--lit', text: S.meta.symptom_thresholds.note })
          : null
      )
    );

    // Споры грибов
    const anyOver = day.mold.taxa.some((m) => m.exceeds_clinical_threshold);
    add(
      clear($('#t-mold')),
      el(
        'div',
        { class: 'tile' },
        el('span', { class: 'eyebrow', text: 'Споры грибов' }),
        el('strong', { class: 'mold__value tnum', text: num(day.mold.total_per_m3) }),
        el('p', { class: 'lede', text: 'спор/м³' }),
        el(
          'div',
          { class: 'rows' },
          day.mold.taxa.map((m) =>
            el(
              'div',
              { class: 'row' },
              el(
                'div',
                {},
                el('span', { class: 'row__name', text: splitName(m.taxon).latin }),
                el('span', {
                  class: 'row__sub',
                  text:
                    m.threshold === null
                      ? 'клинический порог не опубликован'
                      : `порог ${num(m.threshold)} · ${m.exceeds_clinical_threshold ? 'превышен' : 'не превышен'}`
                }),
                m.threshold === null ? null : el('div', { class: 'meter' }, el('span', { style: `width:${Math.min(100, m.fraction_of_threshold * 100)}%` }))
              ),
              el('div', { class: 'row__right tnum', text: num(m.count_per_m3) })
            )
          )
        ),
        el('p', {
          class: 'note',
          text: anyOver
            ? 'Есть таксон выше клинического порога.'
            : 'Ниже клинических порогов. У спор собственные пороги — четырёхступенчатая шкала пыльцы к ним не применяется.'
        })
      )
    );
  } catch (e) {
    add(clear($('#t-hero')), el('div', { class: 'tile' }, errorNode(e)));
  }

  // Стадия сезона
  try {
    const st = await api(`/api/season-state?date=${date}`);
    const ACTIVE = new Set(['ramping', 'peak', 'declining']);
    const moving = st.taxa.filter((t) => ACTIVE.has(t.state));
    const done = st.taxa.filter((t) => t.state === 'ended');
    const rising = moving.find((t) => t.state === 'ramping' || t.state === 'peak');

    add(
      clear($('#t-state')),
      el(
        'div',
        { class: 'tile' },
        el('span', { class: 'eyebrow', text: 'Стадия сезона' }),
        el('h2', { text: `${moving.length} ${plural(moving.length, 'таксон', 'таксона', 'таксонов')} в движении` }),
        moving.length
          ? el(
              'div',
              { class: 'rows' },
              moving.map((t) =>
                el(
                  'div',
                  { class: 'row' },
                  el('div', {}, el('span', { class: 'row__name', text: label(t.taxon) }), el('span', { class: 'row__sub', text: splitName(t.taxon).latin })),
                  el('div', { class: 'row__right', text: STATE_WORD[t.state] ?? t.state })
                )
              )
            )
          : emptyNode('Ничего не нарастает', 'Ни один таксон сейчас не движется.'),
        done.length
          ? el('p', { class: 'note', text: `Ещё у ${done.length} ${plural(done.length, 'таксона', 'таксонов', 'таксонов')} сезон закончился.` })
          : null,
        rising
          ? el('p', {
              class: 'note',
              text: `${label(rising.taxon)} ${STATE_WORD[rising.state]} — есть смысл заранее обсудить профилактику с аллергологом.`
            })
          : null
      )
    );
  } catch (e) {
    add(clear($('#t-state')), el('div', { class: 'tile' }, errorNode(e)));
  }

  // Лента
  try {
    const span = 28;
    const from = isoAdd(date, -(span - 1));
    const dom = S.meta.taxa.pollen.find((t) => t.startsWith('Artemisia')) ?? S.meta.taxa.pollen[0];
    const s = await api(`/api/taxon/${encodeURIComponent(dom)}/season?${new URLSearchParams({ year: date.slice(0, 4), from, to: date })}`);
    const vals = new Map(s.series.map((r) => [r.date, r.count_per_m3]));

    const tip = el('p', { class: 'tip', role: 'status', 'aria-live': 'polite' });
    const holder = el('div');
    add(
      clear($('#t-tape')),
      el(
        'div',
        { class: 'tile' },
        el('span', { class: 'eyebrow', text: `Лента ловушки · ${span} дней` }),
        el('h2', { text: label(dom) }),
        el('p', {
          class: 'lede',
          text: 'Барабан Буркарда протягивает клейкую ленту мимо приёмного отверстия — один оборот в неделю. В дни, когда ловушка не работала, ленты нет: такие дни показаны просветом.'
        }),
        holder,
        tip,
        levelKey(true)
      )
    );

    const draw = () => {
      const w = holder.clientWidth || 320;
      const t = tape({
        from,
        to: date,
        valueFor: (d) => vals.get(d),
        levelOf,
        width: w,
        onPick: (h) => {
          tip.textContent = h.measured
            ? `${fmt(h.date)} — ${num(h.value)} зёрен/м³, ${LEVEL_WORD[levelOf(h.value)]}`
            : `${fmt(h.date)} — ловушка не работала`;
        }
      });
      [...t.querySelectorAll('.tape__day')].forEach((c, i) => c.style.setProperty('--i', i));
      clear(holder).append(t);
    };
    draw();
    onResize(draw);
  } catch (e) {
    add(clear($('#t-tape')), el('div', { class: 'tile' }, errorNode(e)));
  }
}

// ── SCREEN 2 — Мой триггер ───────────────────────────────────────────────

const SEVERITY = [
  { v: 0, t: 'Ничего' },
  { v: 1, t: 'Слегка' },
  { v: 2, t: 'Плохо' },
  { v: 3, t: 'Очень плохо' }
];

async function drawTrigger() {
  if (!S.logDates.length) {
    const dom = S.meta.taxa.pollen.find((t) => t.startsWith('Artemisia')) ?? S.meta.taxa.pollen[0];
    const s = await api(
      `/api/taxon/${encodeURIComponent(dom)}/season?${new URLSearchParams({
        year: S.meta.record.last_date.slice(0, 4),
        from: S.meta.record.first_date,
        to: S.meta.record.last_date
      })}`
    );
    S.logDates = s.series.map((r) => r.date).reverse();
  }
  drawKnown();
  drawLog();
  await drawProfile();
}

/* ── Уже знаю свои аллергены ───────────────────────────────────────────────
   A second, much shorter way into a personal reading.

   The diary fits a model to 14+ answers. Most people with hay fever already
   know at least one of their triggers, and making them tap through two weeks
   of history before the product says anything useful is a bad trade.

   The two paths are kept visibly apart and never merged. This one is DECLARED
   by the person and carries no confidence, no weights, no ranking — it is not
   a model output and the interface never presents it as one. The diary path
   keeps its own label, its own confidence line, and its own copy.
*/

const KNOWN = new Set();
let knownSeq = 0;

function knownProfileString() {
  // Equal weight: the person said "I react to these", not "I react to this one
  // 1.4 times more". Inventing weights here would be inventing data.
  return [...KNOWN].map((t) => `${t}:1`).join(',');
}

/** Weekly maxima of the declared taxa across the record. */
function weeksStrip(seriesByTaxon, lastDate) {
  const weekly = new Map();
  for (const series of seriesByTaxon) {
    for (const r of series) {
      // ISO-ish week key: Monday of that date.
      const d = parseDate(r.date);
      const dow = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - dow);
      const k = d.toISOString().slice(0, 10);
      weekly.set(k, Math.max(weekly.get(k) ?? 0, r.count_per_m3));
    }
  }
  const keys = [...weekly.keys()].sort();
  if (!keys.length) return null;

  const nowD = parseDate(lastDate);
  nowD.setUTCDate(nowD.getUTCDate() - ((nowD.getUTCDay() + 6) % 7));
  const nowKey = nowD.toISOString().slice(0, 10);

  const strip = el('div', { class: 'weeks', role: 'img', 'aria-label': 'Недели записи по вашим таксонам: чем темнее, тем выше максимум за неделю' });
  for (const k of keys) {
    const v = weekly.get(k);
    add(
      strip,
      el('span', {
        class: 'weeks__w',
        'data-now': String(k === nowKey),
        style: `--f: var(--lvl-${levelOf(v)})`,
        title: `неделя с ${fmtShort(k)} — максимум ${num(v)} зёрен/м³`
      })
    );
  }
  return { strip, weekly, keys, nowKey };
}

let knownOut = null;

/** Builds the tile once. Toggling a chip must not rebuild the chip you are
 *  tapping: a fast second tap would land on a node that no longer exists, and
 *  a keyboard user would lose focus mid-selection. Only the output redraws. */
function drawKnown() {
  const sec = $('#g-known');
  const byPeak = (S.meta.taxa.by_peak ?? []).filter((t) => !t.is_mold && t.peak > 0).slice(0, 12);
  if (!byPeak.length) return clear(sec);

  const tile = el('div', { class: 'tile' });
  add(
    tile,
    el('span', { class: 'eyebrow', text: 'Быстрый путь' }),
    el('h2', { text: 'Уже знаете свои аллергены?' }),
    el('p', {
      class: 'lede',
      text: 'Отметьте — и увидите свой сегодняшний день и свои недели сразу, без дневника. Это ваши слова, а не расчёт модели; профиль ниже считается отдельно и с ними не смешивается.'
    })
  );

  const set = el('div', { class: 'chipset chipset--wrap', role: 'group', 'aria-label': 'Известные аллергены' });
  for (const t of byPeak) {
    const btn = el('button', {
      class: 'chip chip--btn',
      type: 'button',
      'aria-pressed': String(KNOWN.has(t.taxon)),
      text: label(t.taxon),
      title: t.taxon,
      onclick: () => {
        if (KNOWN.has(t.taxon)) KNOWN.delete(t.taxon);
        else KNOWN.add(t.taxon);
        btn.setAttribute('aria-pressed', String(KNOWN.has(t.taxon)));
        renderKnownOut();
      }
    });
    add(set, btn);
  }
  add(tile, set);

  knownOut = el('div', { class: 'known__out' });
  add(tile, knownOut);
  add(clear(sec), tile);
  renderKnownOut();
}

async function renderKnownOut() {
  const out = knownOut;
  if (!out) return;
  clear(out);

  if (!KNOWN.size) {
    add(out, el('p', { class: 'note', text: 'Ничего не отмечено. Если не знаете — это нормально: дневник ниже определит триггеры по вашим ответам.' }));
    return;
  }

  const seq = ++knownSeq;
  add(out, statusNode('Считаем…'));

  try {
    const date = S.meta.record.last_date;
    const profile = knownProfileString();
    const [idx, ...series] = await Promise.all([
      api(`/api/personal-index?${new URLSearchParams({ profile, date })}`),
      ...[...KNOWN].map(async (t) =>
        (
          await api(
            `/api/taxon/${encodeURIComponent(t)}/season?${new URLSearchParams({
              year: date.slice(0, 4),
              from: S.meta.record.first_date,
              to: date
            })}`
          )
        ).series
      )
    ]);
    if (seq !== knownSeq) return;

    clear(out);

    if (idx.index === null) {
      add(out, el('p', { class: 'note', text: idx.reason ?? 'Индекс посчитать не удалось.' }));
    } else {
      add(
        out,
        el(
          'div',
          { class: 'known__idx' },
          el(
            'div',
            {},
            el('span', { class: 'hero__label', text: 'ваш день' }),
            el('strong', { class: 'known__val tnum', text: num(idx.index) }),
            el('span', { class: 'known__of', text: 'из 100' })
          ),
          // The level comes from the endpoint, not from re-grading the index
          // here — that mismatch is exactly what produced "0.6 · ВЫСОКИЙ" once.
          idx.level ? verdict(Math.max(0, S.bands.findIndex((b) => b.level === idx.level))) : null
        ),
        el('p', {
          class: 'note',
          text: `Считано по ${plural(KNOWN.size, 'отмеченному вами таксону', 'отмеченным вами таксонам', 'отмеченным вами таксонам')}: ${[...KNOWN].map(label).join(', ')}. Это пересчёт измерений 6 августа под ваш список, а не оценка вашего состояния.`
        })
      );
    }

    const w = weeksStrip(series, S.meta.record.last_date);
    if (w) {
      const peakWeek = w.keys.reduce((a, b) => (w.weekly.get(b) > w.weekly.get(a) ? b : a), w.keys[0]);
      add(
        out,
        el('p', { class: 'txd__k', text: 'ваши недели по записи' }),
        w.strip,
        el('p', {
          class: 'note',
          text: `Каждая клетка — неделя записи, цвет по максимуму за неделю среди ваших таксонов. Обведена та, в которой мы сейчас. Самая тяжёлая неделя записи началась ${fmtShort(peakWeek)} — ${num(w.weekly.get(peakWeek))} зёрен/м³. Недели, когда ловушка не работала, в полосе отсутствуют.`
        })
      );
    }
  } catch (e) {
    if (seq !== knownSeq) return;
    clear(out);
    add(out, errorNode(e));
  }
}

function drawLog() {
  const date = S.logDates[S.logCursor];
  const done = S.logCursor >= S.logDates.length;

  const grid = el('div', { class: 'severity', role: 'group', 'aria-label': 'Самочувствие' });
  for (const s of SEVERITY) {
    const dots = el('span', { class: 'severity__dots', 'aria-hidden': 'true' });
    for (let i = 1; i <= 3; i++) dots.append(el('i', { 'data-on': String(i <= s.v) }));
    add(grid, el('button', { class: 'severity__btn', type: 'button', onclick: () => logDay(s.v) }, dots, el('span', { text: s.t })));
  }

  add(
    clear($('#g-log')),
    el(
      'div',
      { class: 'tile' },
      el('span', { class: 'eyebrow', text: 'Дневник' }),
      done ? el('h2', { text: 'Все измеренные дни отмечены' }) : el('h2', { text: `Как вы себя чувствовали ${fmt(date)}?` }),
      el('p', {
        class: 'lede',
        text: done
          ? 'Больше дней с измерениями в записи нет.'
          : 'Один тап — один день. Дальше откроется предыдущий день, когда ловушка работала.'
      }),
      done ? null : grid,
      el('p', {
        class: 'note',
        text: `Отмечено дней: ${S.log.length}. Записи живут только в памяти вкладки — при перезагрузке они очистятся.`
      })
    )
  );
}

let attrSeq = 0;
let attrTimer = null;

function logDay(v) {
  const date = S.logDates[S.logCursor];
  if (!date) return;
  S.log = S.log.filter((e) => e.date !== date).concat({ date, severity: v });
  S.logCursor += 1;
  drawLog();
  // The debounce below can hold the profile back through a fast run of taps,
  // and the empty state would sit there reading "Профиля пока нет — отметить
  // первый день" next to a counter saying 23. Retire it on the first entry so
  // the panel never contradicts the number beside it.
  if (S.log.length === 1) {
    add(
      clear($('#g-profile')),
      el(
        'div',
        { class: 'tile' },
        el('span', { class: 'eyebrow', text: 'Профиль триггеров' }),
        statusNode('Считаем…')
      )
    );
  }
  // Coalesce fast taps, and never let an early answer overwrite a later one.
  clearTimeout(attrTimer);
  attrTimer = setTimeout(drawProfile, 250);
}

/** Copy for a collinear group of any size — the three-member group has to read
 *  as naturally as a pair. */
function inseparableCopy(taxa) {
  const names = taxa.map(label);
  const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} и ${names.at(-1)}`;
  return `${listed} — по имеющимся измерениям их нельзя разделить: они поднимаются и опадают вместе, поэтому модель считает их одним признаком.`;
}

async function drawProfile() {
  const sec = $('#g-profile');
  const diag = $('#g-diag');

  if (S.log.length === 0) {
    add(
      clear(sec),
      el(
        'div',
        { class: 'tile' },
        el('span', { class: 'eyebrow', text: 'Профиль триггеров' }),
        emptyNode(
          'Профиля пока нет',
          'Модель сопоставит ваши ответы с измеренными концентрациями и покажет, какие таксоны с ними связаны.'
        ),
        // An empty screen is an invitation to act, so it closes with the action
        // that resolves the emptiness rather than trailing off.
        action('Отметить первый день', null, () => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          $('.severity__btn')?.focus();
        })
      )
    );
    clear(diag);
    clear($('#g-cross'));
    return;
  }

  const seq = ++attrSeq;
  const stale = () => seq !== attrSeq;
  add(clear(sec), el('div', { class: 'tile' }, el('span', { class: 'eyebrow', text: 'Профиль триггеров' }), statusNode('Считаем…')));

  let r;
  try {
    r = await api('/api/profile/attribute', { method: 'POST', body: S.log, memoise: false });
    if (stale()) return;
  } catch (e) {
    if (stale()) return;
    add(
      clear(sec),
      el(
        'div',
        { class: 'tile' },
        el('span', { class: 'eyebrow', text: 'Профиль триггеров' }),
        // A POST is never replayed from cache — serving a stored answer for a
        // diary the user has since changed would be a fabricated result. So
        // offline this screen says so plainly instead of showing a stale fit.
        e?.status === 503 || e instanceof TypeError
          ? emptyNode(
              'Разбор триггеров требует сети',
              'Расчёт идёт на сервере и намеренно не кэшируется: показать сохранённый ответ для изменившегося дневника значило бы показать выдуманный результат. Ваши отметки сохранены — при подключении профиль пересчитается.'
            )
          : errorNode(e)
      )
    );
    return;
  }

  const steps = CONF_STEPS[r.confidence] ?? 0;
  const conf = el(
    'div',
    {},
    el(
      'div',
      { class: 'confidence', role: 'img', 'aria-label': `Уверенность: ${CONF_WORD[r.confidence]}` },
      [0, 1, 2].map((i) => el('div', { class: 'confidence__tick', 'data-on': String(i < steps) }))
    ),
    el('p', {
      class: 'note',
      text: `Уверенность: ${CONF_WORD[r.confidence]} · дней в расчёте ${r.usable_days} (${r.positive_days} плохих, ${r.negative_days} спокойных)${
        r.dropped_unmeasured_days.length ? ` · отброшено дней без измерений: ${r.dropped_unmeasured_days.length}` : ''
      }`
    })
  );

  const tile = el('div', { class: 'tile' }, el('span', { class: 'eyebrow', text: 'Профиль триггеров' }));

  if (!r.fitted) {
    S.profile = null;
    add(
      tile,
      el('h2', { text: 'Пока рано делать вывод' }),
      el('p', { class: 'lede', text: r.reason }),
      conf,
      action('Отметить ещё один день', null, () => window.scrollTo({ top: 0, behavior: 'smooth' }))
    );
    add(clear(sec), tile);
    clear(diag);
    clear($('#g-cross'));
    return;
  }

  const positives = r.triggers.filter((t) => t.weight > 0);
  S.profile = positives.length ? positives.flatMap((t) => t.taxa.map((x) => `${x}:${t.weight}`)).join(',') : null;
  S.drawn.delete('today');

  const maxW = Math.max(...r.triggers.map((t) => Math.abs(t.weight)));
  add(
    tile,
    el('h2', { text: 'С чем связаны ваши плохие дни' }),
    el('p', {
      class: 'lede',
      text: 'Вес — вклад признака в логистическую модель на стандартизованных признаках. Положительный значит: чем выше концентрация, тем хуже день.'
    }),
    conf,
    el(
      'div',
      { style: 'margin-top: var(--s4)' },
      r.triggers.slice(0, 8).map((t) =>
        el(
          'div',
          { class: 'trigger' },
          el(
            'div',
            { class: 'trigger__head' },
            el('div', { class: 'trigger__name', text: t.taxa.map(label).join(' + ') }),
            el('div', { class: 'trigger__w tnum', text: (t.weight > 0 ? '+' : '') + t.weight.toFixed(2) })
          ),
          el('div', { class: 'trigger__track' }, el('span', { class: 'trigger__bar', 'data-dir': t.direction, style: `width:${(Math.abs(t.weight) / maxW) * 100}%` })),
          t.inseparable ? el('p', { class: 'trigger__note', text: inseparableCopy(t.taxa) }) : null
        )
      )
    ),
    r.confidence === 'high'
      ? action('Сохранить сводку для аллерголога', 'В файл попадут только измерения, ваши отметки и веса модели с числом дней, на которых они держатся.', () => saveExtract(r))
      : action('Отметить ещё один день', 'Чем больше отмеченных дней, тем устойчивее веса.', () => window.scrollTo({ top: 0, behavior: 'smooth' }))
  );
  add(clear(sec), tile);

  await drawDiagnostic(positives[0]?.taxa?.[0] ?? null);
  // Cross-reactivity follows from the attribution, so it is drawn from the
  // fitted triggers and only ever after a fit exists.
  await drawCrossReactivity(positives.slice(0, 5).flatMap((t) => t.taxa), r.confidence);
}

async function drawDiagnostic(taxon) {
  const sec = clear($('#g-diag'));
  const tile = el('div', { class: 'tile' }, el('span', { class: 'eyebrow', text: 'Разделяющий день' }));
  try {
    const qs = new URLSearchParams({ limit: '1' });
    if (taxon) qs.set('taxon', taxon);
    let r = await api(`/api/discriminating-days?${qs}`);
    // The top trigger's pair may have no split day. That is a fact about that
    // pair, not about the record — fall back to the strongest one anywhere and
    // say which pair it belongs to, rather than showing an empty tile while
    // useful days exist.
    let widened = false;
    if (!r.days.length && taxon) {
      r = await api('/api/discriminating-days?limit=1');
      widened = r.days.length > 0;
    }
    if (!r.days.length) {
      add(tile, emptyNode('Разделяющих дней не нашлось', 'Это дни, когда один таксон высоко, а его ближайший спутник — низко. В записи таких дней нет.'));
      sec.append(tile);
      return;
    }
    const d = r.days[0];
    add(
      tile,
      el('h2', { text: fmt(d.date) }),
      widened
        ? el('p', {
            class: 'note',
            style: 'margin-top:0',
            text: 'У вашего верхнего триггера разделяющих дней нет. Показан самый сильный по записи — для другой пары.'
          })
        : null,
      el(
        'p',
        { class: 'lede' },
        `${label(d.high.taxon)} — `,
        el('b', { class: 'tnum', text: num(d.high.count_per_m3) }),
        `, тогда как ${label(d.low.taxon)} — `,
        el('b', { class: 'tnum', text: num(d.low.count_per_m3) }),
        `. Обычно они движутся вместе (r = ${d.r}), поэтому день, когда они разошлись, стоит многих обычных.`
      ),
      action('Отметить этот день', 'Ответ именно за эту дату разводит пару сильнее десятка обычных.', () => {
        const i = S.logDates.indexOf(d.date);
        if (i >= 0) {
          S.logCursor = i;
          drawLog();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      })
    );
  } catch (e) {
    add(tile, errorNode(e));
  }
  sec.append(tile);
}

/**
 * The extract a clinician reads. Measurements, the patient's own entries, and
 * the model weights with the number of days they rest on — and nothing else.
 * No probable cause, no recommendation, no interpretation.
 */
function saveExtract(r) {
  const m = S.meta;
  const L = [];
  L.push('ВЫПИСКА ДАННЫХ — пыльцевой мониторинг, Алматы');
  L.push('');
  L.push('Источник: ловушка Буркарда (Hirst-type), подсчёт под микроскопом.');
  L.push(`Запись: ${fmt(m.record.first_date)} — ${fmt(m.record.last_date)}; измеренных дней ${m.counts.measurementDays}; таксонов ${m.counts.taxa}.`);
  L.push(`Дней без измерений в записи: ${m.gaps.total_unmeasured_days}.`);
  L.push(`Выписка сформирована: ${fmt(todayISO())}.`);
  L.push('');
  L.push('— ОТМЕТКИ ПАЦИЕНТА —');
  L.push('дата\tсамочувствие (0-3)');
  for (const e of [...S.log].sort((a, b) => (a.date < b.date ? -1 : 1))) L.push(`${e.date}\t${e.severity}`);
  L.push('');
  L.push(`Дней в расчёте: ${r.usable_days} (плохих ${r.positive_days}, спокойных ${r.negative_days}).`);
  L.push(`Отброшено дней без измерений: ${r.dropped_unmeasured_days.length}.`);
  L.push(`Порог «плохого дня»: самочувствие >= ${r.severity_positive_at}.`);
  L.push('');
  L.push('— ВЕСА МОДЕЛИ —');
  L.push(`Модель: ${r.model}. L2 lambda = ${r.l2_lambda}. Веса в стандартизованном пространстве.`);
  L.push('признак\tвес\tнеразделимая группа');
  for (const t of r.triggers) L.push(`${t.taxa.join(' + ')}\t${t.weight.toFixed(4)}\t${t.inseparable ? 'да' : 'нет'}`);
  if (r.inseparable_groups.length) {
    L.push('');
    L.push(`— НЕРАЗДЕЛИМЫЕ ГРУППЫ (лог-корреляция >= ${r.correlation_threshold}) —`);
    for (const g of r.inseparable_groups) L.push(g.taxa.join(' + '));
  }
  L.push('');
  L.push('Выписка содержит измерения, отметки пациента и веса модели. Интерпретация — за врачом.');

  const blob = new Blob([L.join('\n')], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pollen-extract-${todayISO()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Cross-reactivity, rendered under the trigger profile.
 *
 * This is the one block in the product that speaks from literature rather than
 * from the trap, and the interface says so before it says anything else. It
 * describes an association; it never tells anyone they are allergic to a food
 * and never tells anyone to avoid one.
 */
async function drawCrossReactivity(triggerTaxa, confidence) {
  const sec = clear($('#g-cross'));
  if (!triggerTaxa.length) return;

  const tile = el('div', { class: 'tile tile--lit' });
  add(
    tile,
    el('span', { class: 'eyebrow eyebrow--lit', text: 'Из литературы, не из измерений' })
  );

  let r;
  try {
    r = await api(`/api/cross-reactivity?${new URLSearchParams({ taxa: triggerTaxa.join(',') })}`);
  } catch (e) {
    add(tile, errorNode(e));
    sec.append(tile);
    return;
  }

  const withData = r.taxa.filter((t) => t.has_data);
  const without = r.taxa.filter((t) => !t.has_data);
  // Nothing to show is a legitimate outcome; the block says so rather than
  // reaching further down the ranking for something quotable.
  if (!withData.length) {
    add(
      tile,
      el('h2', { text: 'Перекрёстные реакции с продуктами' }),
      el('p', {
        class: 'note',
        text:
          `Ни для одного из ваших верхних триггеров (${without.map((t) => label(t.taxon).toLowerCase()).join(', ')}) ` +
          'в таблице нет установленных данных. Это означает отсутствие записи в таблице, а не доказанное отсутствие перекрёстных реакций.'
      }),
      el('p', { class: 'note', text: r.note })
    );
    sec.append(tile);
    return;
  }

  add(
    tile,
    el('h2', { text: 'Перекрёстные реакции с продуктами' }),
    el('p', {
      class: 'lede',
      text: withData.length
        ? 'Белки пыльцы и некоторых продуктов похожи настолько, что иммунная система может отвечать и на те, и на другие. Это популяционная закономерность из литературы, а не вывод о вас.'
        : 'Белки пыльцы и некоторых продуктов бывают похожи настолько, что иммунная система отвечает и на те, и на другие.'
    })
  );

  // A food list derived from a weakly identified trigger deserves the caveat.
  if (confidence === 'low' || confidence === 'insufficient') {
    add(
      tile,
      el('p', {
        class: 'note note--warn',
        text: `Ваш профиль пока опирается на небольшое число отмеченных дней (уверенность: ${CONF_WORD[confidence]}). Список ниже следует из этого профиля, поэтому и он предварительный — отметьте больше дней, чтобы верхний триггер стал устойчивее.`
      })
    );
  }

  for (const t of withData) {
    const body = el('div', { class: 'lit' });
    add(
      body,
      el(
        'h3',
        { class: 'lit__taxon' },
        label(t.taxon),
        label(t.taxon) === t.latin ? null : el('span', { class: 'lit__latin', text: ` ${t.latin}` }),
        // The strength of the evidence rides on the heading, not in a footnote
        // at the bottom of the card that nobody reaches.
        // The leading space is for screen readers, which otherwise run the
        // Latin name and the grade together into one word.
        t.evidence === 'limited'
          ? el('span', { class: 'lit__grade', text: ' ограниченные данные' })
          : null
      )
    );

    if (t.evidence_note) add(body, el('p', { class: 'note', text: t.evidence_note }));

    if (t.syndromes.length) {
      add(
        body,
        el('p', { class: 'lit__k', text: 'описанные синдромы' }),
        el('ul', { class: 'lit__list' }, t.syndromes.map((s) => el('li', { text: s })))
      );
    }

    add(
      body,
      el('p', { class: 'lit__k', text: 'продукты, с которыми описана перекрёстная реакция' }),
      el('ul', { class: 'chips' }, t.foods.map((f) => el('li', { class: 'chip', text: f })))
    );

    if (t.allergens.length) {
      add(
        body,
        el('p', { class: 'lit__k', text: 'белки-аллергены' }),
        el(
          'ul',
          { class: 'lit__list' },
          t.allergens.map((a) => el('li', {}, el('b', { text: a.name }), a.note ? ` — ${a.note}` : null))
        )
      );
    }

    for (const n of t.notes ?? []) add(body, el('p', { class: 'note', text: n }));

    add(
      body,
      t.sources.length
        ? el(
            'p',
            { class: 'lit__src' },
            'Источник: ',
            t.sources.join(' · ')
          )
        : el('p', { class: 'lit__src', text: t.sources_note })
    );
    add(tile, body);
  }

  if (without.length) {
    add(
      tile,
      el(
        'div',
        { class: 'lit' },
        el('p', {
          class: 'note',
          text:
            // Colon-then-list keeps the taxon names in the nominative: "для"
            // would demand the genitive, and these names are not declinable
            // from the table.
            'В таблице нет установленных данных о перекрёстной реактивности для этих таксонов: ' +
            `${without.map((t) => label(t.taxon).toLowerCase()).join(', ')}. ` +
            'Это означает отсутствие записи в таблице, а не доказанное отсутствие перекрёстных реакций.'
        })
      )
    );
  }

  // No action button here on purpose: the screen already has exactly one, in
  // the profile tile above. A second CTA competing with it would be worse than
  // a block that simply ends.
  // The bridge to a clinician, in the product's established modality: it
  // describes a possibility and names who can interpret it. Never "avoid
  // celery", never "you are allergic to celery".
  if (withData.length) {
    // Phrased so taxon names stay in the nominative: declining every Russian
    // taxon name by hand would break on the next entry added to the table.
    const names = withData.map((t) => label(t.taxon));
    const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} и ${names.at(-1)}`;
    add(
      tile,
      el('p', {
        class: 'lede',
        style: 'margin-top: var(--s5)',
        text: `${listed} — при аллергии на ${names.length === 1 ? 'этот таксон' : 'эти таксоны'} возможна перекрёстная реакция на перечисленные продукты. Есть смысл обсудить с аллергологом.`
      })
    );
  }

  add(
    tile,
    el('p', { class: 'note', text: r.note }),
    el('p', {
      class: 'note',
      text: 'В выписку для аллерголога эти сведения не попадают — там только измерения, ваши отметки и веса модели.'
    })
  );
  sec.append(tile);
}

// ── SCREEN 3 — Сезон ─────────────────────────────────────────────────────

async function drawSeason() {
  const m = S.meta;
  const art = m.taxa.pollen.find((t) => t.startsWith('Artemisia'));
  if (!art) {
    add(clear($('#s-chart')), el('div', { class: 'tile' }, emptyNode('Полынь не найдена в записи', 'Этот экран построен вокруг неё.')));
    return;
  }
  const enc = encodeURIComponent(art);
  const asOf = m.record.last_date;
  const curYear = Number(asOf.slice(0, 4));
  const prevYear = curYear - 1;

  try {
    const perf = await api(`/api/ramp-performance?taxon=${enc}&window=${prevYear}`);
    const pace = await api(`/api/season-pace?as_of=${asOf}&taxon=${enc}`);
    const win = perf.window;
    const d = pace.display;

    const paceFrom = pace.current.from;
    const paceTo = pace.current.to;
    const prevFrom = pace.previous.from;
    const prevTo = pace.previous.to;

    const sPrevFull = await api(`/api/taxon/${enc}/season?year=${prevYear}`);
    const sPrevPace = await api(`/api/taxon/${enc}/season?${new URLSearchParams({ year: String(prevYear), from: prevFrom, to: prevTo })}`);
    const sCurPace = await api(`/api/taxon/${enc}/season?${new URLSearchParams({ year: String(curYear), from: paceFrom, to: paceTo })}`);

    // ── LEFT: where the current season stands ─────────────────────────────
    // Identical calendar windows, so the two magnitudes are actually
    // comparable and the pace claim below is visually true rather than
    // asserted. The 2025 peak is 54 days past the right edge of this panel;
    // putting it on the same axis would have made 41 look like nothing.
    const leftTip = el('p', { class: 'tip', role: 'status', 'aria-live': 'polite' });
    const leftHolder = el('div');
    const curOnPrevAxis = shiftToYear(sCurPace.series, prevYear);
    const missing = d.missing_dates_in_current_window;
    const extraGaps = missing.length
      ? [{ from: `${prevYear}${missing[0].slice(4)}`, to: `${prevYear}${missing.at(-1).slice(4)}`, label: `${curYear}: нет данных` }]
      : [];
    const prevPaceMax = sPrevPace.series.length
      ? sPrevPace.series.reduce((a, r) => (r.count_per_m3 > a.count_per_m3 ? r : a))
      : null;

    add(
      clear($('#s-chart')),
      el(
        'div',
        { class: 'tile' },
        el('span', { class: 'eyebrow', text: `Где мы сейчас · ${fmtShort(paceFrom)} — ${fmtShort(paceTo)}` }),
        el('h2', { text: `${curYear} против ${prevYear} на одном отрезке` }),
        el('p', {
          class: 'lede',
          text: `Один и тот же календарный отрезок в оба года, поэтому величины сопоставимы: максимумы здесь ${num(prevPaceMax ? prevPaceMax.count_per_m3 : 0)} и ${num(sCurPace.peak ? sCurPace.peak.count_per_m3 : 0)}.`
        }),
        leftHolder,
        leftTip,
        el(
          'div',
          { class: 'pace' },
          el('div', {}, el('b', { class: 'pace__n tnum', text: num(d.previous) }), el('span', { class: 'pace__k', text: String(pace.previous.year) })),
          el('div', { class: 'pace__mid' }, el('b', { class: 'pace__ratio tnum', text: `×${d.ratio}` }), el('span', { class: 'pace__k', text: 'разница' })),
          el('div', { style: 'text-align:end' }, el('b', { class: 'pace__n tnum', text: num(d.current) }), el('span', { class: 'pace__k', text: String(pace.current.year) }))
        ),
        el('p', {
          class: 'lede',
          text: `Накопленная сумма с ${fmtShort(paceFrom).replace(/\.$/, '')}. Сравниваются только календарные дни, измеренные в обоих сезонах — по ${d.days_compared} ${plural(d.days_compared, 'дню', 'дня', 'дней')} с каждой стороны.`
        }),
        d.missing_days_in_current_window
          ? el('p', {
              class: 'note',
              text: `В окне ${curYear} не хватает ${d.missing_days_in_current_window} ${plural(d.missing_days_in_current_window, 'дня', 'дней', 'дней')} (${missing
                .map(fmtShort)
                .join(', ')}) — ловушка не работала. Соответствующие дни ${prevYear} исключены из суммы, иначе ${
                d.days_compared + d.missing_days_in_current_window
              }-дневная сумма делилась бы на ${d.days_compared}-дневную и отставание выглядело бы больше, чем оно есть.`
            })
          : null,
        el('div', { class: 'legend' }, el('span', {}, el('i', {}), String(prevYear)), el('span', {}, el('i', { 'data-k': 'cur' }), String(curYear)))
      )
    );
    // Only the right-hand panel carries the action: one primary CTA per screen,
    // and it belongs on the panel that closes the argument.

    // ── RIGHT: what came next ─────────────────────────────────────────────
    const rightTip = el('p', { class: 'tip', role: 'status', 'aria-live': 'polite' });
    const rightHolder = el('div');
    const annotations = [
      perf.false_alarm_dates[0] && { date: perf.false_alarm_dates[0], text: 'ложная тревога — критического дня не последовало', miss: true },
      perf.first_sustained_trigger && { date: perf.first_sustained_trigger, text: 'начало устойчивой серии предупреждений' },
      perf.first_critical_day && { date: perf.first_critical_day.date, text: 'первый критический день' }
    ].filter(Boolean);
    const ahead = dayDiff(prevTo, sPrevFull.peak.date);

    add(
      clear($('#s-detector')),
      el(
        'div',
        { class: 'tile' },
        el('span', { class: 'eyebrow', text: `Что было дальше · сезон ${prevYear}` }),
        el('h2', { text: `Пик — ${num(sPrevFull.peak.count_per_m3)} зёрен/м³` }),
        el('p', {
          class: 'lede',
          text: `${fmt(sPrevFull.peak.date)} — через ${ahead} ${plural(ahead, 'день', 'дня', 'дней')} после той точки, на которой мы сейчас. Интеграл сезона за ${fmtShort(win.from)} — ${fmtShort(win.to)} составил ${num(
            sPrevFull.seasonal_pollen_integral
          )}${sPrevFull.spi_is_lower_bound ? ' — нижняя оценка: в окне есть дни без измерений' : ''}.`
        }),
        rightHolder,
        rightTip,
        el(
          'ol',
          { class: 'annos' },
          annotations.map((a, i) => {
            const pt = sPrevFull.series.find((r) => r.date === a.date);
            return el(
              'li',
              { class: `anno${a.miss ? ' anno--miss' : ''}` },
              el('span', { class: 'anno__key', text: String(i + 1) }),
              el('span', {}, el('b', { text: fmt(a.date) }), ' — ', a.text, pt ? el('span', { class: 'row__sub tnum', text: `${num(pt.count_per_m3)} зёрен/м³` }) : null)
            );
          })
        ),
        el(
          'div',
          { class: 'score' },
          el('div', { class: 'score__cell' }, el('b', { class: 'score__n tnum', text: num(perf.trigger_count) }), el('span', { class: 'score__k', text: 'срабатываний' })),
          el('div', { class: 'score__cell' }, el('b', { class: 'score__n tnum', text: num(perf.precision.confirmed) }), el('span', { class: 'score__k', text: 'подтвердились' })),
          el('div', { class: 'score__cell score__cell--miss' }, el('b', { class: 'score__n tnum', text: num(perf.precision.false_alarms) }), el('span', { class: 'score__k', text: 'ложная тревога' })),
          el('div', { class: 'score__cell' }, el('b', { class: 'score__n tnum', text: `${perf.precision.percent}%` }), el('span', { class: 'score__k', text: 'точность' }))
        ),
        el('p', {
          class: 'note',
          text: `Срабатывание считается подтверждённым, если в следующие ${perf.precision.horizon_days} дней был день выше ${num(perf.precision.critical_above)} зёрен/м³. Пороги зафиксированы и не подбирались под этот сезон.`
        }),
        perf.false_alarm_dates.length
          ? el('p', {
              class: 'note',
              text: `Промах ${fmt(perf.false_alarm_dates[0])}: детектор сработал, критического дня не последовало, а окно проверки было измерено полностью — значит это настоящий промах, а не следствие пропуска.`
            })
          : null,
        perf.days_not_evaluable
          ? el('p', {
              class: 'note',
              text: `Ещё ${perf.days_not_evaluable} ${plural(perf.days_not_evaluable, 'день', 'дня', 'дней')} детектор оценить не смог: скользящее или базовое окно попадало на пропуск.`
            })
          : null,
        action('Смотреть все дни сезона', null, () => show('year'))
      )
    );
    clear($('#s-pace'));

    const tipText = (h, tip) => {
      tip.textContent = !h ? '' : h.measured ? `${fmt(h.date)} — ${num(h.value)} зёрен/м³` : `${fmt(h.date)} — ловушка не работала`;
    };

    const draw = () => {
      clear(leftHolder).append(
        seasonChart({
          width: leftHolder.clientWidth || 320,
          window: { from: prevFrom, to: prevTo },
          primary: { label: String(prevYear), series: sPrevPace.series },
          secondary: { label: String(curYear), series: curOnPrevAxis },
          extraGaps,
          annotations: [],
          peak: prevPaceMax,
          ariaLabel: `Полынь с ${fmtShort(paceFrom)} по ${fmtShort(paceTo)}: ${prevYear} — ${d.previous}, ${curYear} — ${d.current}, разница в ${d.ratio} раза.`,
          onHover: (h) => tipText(h, leftTip)
        })
      );
      clear(rightHolder).append(
        seasonChart({
          width: rightHolder.clientWidth || 320,
          window: win,
          primary: { label: String(prevYear), series: sPrevFull.series },
          annotations,
          peak: sPrevFull.peak,
          nowMarker: { date: prevTo, label: `${fmtShort(prevTo)} — здесь мы сейчас` },
          ariaLabel: `Полынь, весь сезон ${prevYear}. Пик ${sPrevFull.peak.count_per_m3} зёрен на кубометр ${fmt(sPrevFull.peak.date)}.`,
          onHover: (h) => tipText(h, rightTip)
        })
      );
    };
    draw();
    onResize(draw);
  } catch (e) {
    add(clear($('#s-chart')), el('div', { class: 'tile' }, errorNode(e)));
  }
}

// ── SCREEN 4 — Год ───────────────────────────────────────────────────────

// The explorer owns the top of this screen; the month grid below stays as the
// bird's-eye view of the same record.
let explorer = null;

async function drawYear() {
  explorer ??= makeExplorer({
    el, add, clear, num, label, splitName, api, pool, levelOf, LEVEL_WORD,
    fmt, plural, statusNode, emptyNode, seasonChart, S
  });
  const m = S.meta;
  const sec = $('#y-grid');
  add(clear(sec), el('div', { class: 'tile' }, el('span', { class: 'eyebrow', text: 'Год наблюдений' }), statusNode(`Загружаем ряды по ${m.counts.taxa} таксонам…`)));

  let explorerRows = null;
  try {
    explorerRows = await explorer.load($('#y-explorer'));
  } catch (e) {
    console.error('explorer', e);
    add(clear($('#y-explorer')), el('div', { class: 'tile' }, errorNode(e)));
  }

  try {
    const from = m.record.first_date;
    const to = m.record.last_date;

    // Reuse what the explorer already fetched; only fall back to fetching if
    // it failed, so the grid still works on its own.
    const series =
      explorerRows ??
      (await pool(m.taxa.pollen.concat(m.taxa.mold), async (t) => {
        const s = await api(`/api/taxon/${encodeURIComponent(t)}/season?${new URLSearchParams({ year: to.slice(0, 4), from, to })}`);
        return { taxon: t, series: s.series };
      }));

    const months = [];
    for (let d = `${from.slice(0, 7)}-01`; d <= to; ) {
      months.push(d.slice(0, 7));
      const dt = parseDate(d);
      dt.setUTCMonth(dt.getUTCMonth() + 1);
      d = dt.toISOString().slice(0, 10);
    }

    const measuredByMonth = new Map(months.map((k) => [k, 0]));
    for (const r of series[0]?.series ?? []) {
      const k = r.date.slice(0, 7);
      measuredByMonth.set(k, (measuredByMonth.get(k) ?? 0) + 1);
    }

    const rows = series
      .map(({ taxon, series: s }) => {
        const byMonth = new Map();
        for (const r of s) {
          const k = r.date.slice(0, 7);
          byMonth.set(k, Math.max(byMonth.get(k) ?? 0, r.count_per_m3));
        }
        return { taxon, byMonth, peak: Math.max(0, ...byMonth.values()) };
      })
      .filter((r) => r.peak > 0)
      .sort((a, b) => b.peak - a.peak);

    const MON = new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: 'UTC' });
    const thead = el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { scope: 'col', text: 'Таксон' }),
        months.map((k) =>
          el('th', { scope: 'col', text: MON.format(parseDate(`${k}-01`)), title: `${k} — измеренных дней ${measuredByMonth.get(k) ?? 0}` })
        )
      )
    );
    const tbody = el('tbody');
    for (const r of rows) {
      const tr = el('tr', {}, el('th', { scope: 'row', title: r.taxon, text: label(r.taxon) }));
      for (const k of months) {
        const measured = measuredByMonth.get(k) ?? 0;
        if (measured === 0) {
          add(tr, el('td', { 'data-gap': 'true', title: `${k} — ловушка не работала ни одного дня` }));
          continue;
        }
        const v = r.byMonth.get(k) ?? 0;
        add(tr, el('td', { style: `--f: var(--lvl-${levelOf(v)})`, title: `${label(r.taxon)} · ${k} — максимум ${num(v)} (измерено дней ${measured})` }));
      }
      add(tbody, tr);
    }

    const gapMonths = months.filter((k) => (measuredByMonth.get(k) ?? 0) === 0);

    add(
      clear(sec),
      el(
        'div',
        { class: 'tile' },
        el('span', { class: 'eyebrow', text: 'Год наблюдений' }),
        el('h2', { text: `${rows.length} ${plural(rows.length, 'таксон', 'таксона', 'таксонов')} по месяцам` }),
        el('p', {
          class: 'lede',
          text: `Цвет ячейки — максимум за месяц по лабораторной шкале. Месяцы, в которые ловушка не работала ни одного дня, оставлены просветом${
            gapMonths.length ? `; таких ${gapMonths.length}` : ''
          }.`
        }),
        el('div', { class: 'gridwrap' }, el('table', { class: 'ygrid' }, thead, tbody)),
        levelKey(true),
        el('p', {
          class: 'note',
          text: `Запись: ${fmt(from)} — ${fmt(to)}; измеренных дней ${m.counts.measurementDays}; дней без измерений ${m.gaps.total_unmeasured_days}.`
        }),
        action('Открыть последний измеренный день', null, () => show('today'))
      )
    );
  } catch (e) {
    add(clear(sec), el('div', { class: 'tile' }, errorNode(e)));
  }
}

// ── navigation ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'today', t: 'Сегодня', icon: ICONS.today },
  { id: 'trigger', t: 'Мой триггер', icon: ICONS.trigger },
  { id: 'season', t: 'Сезон', icon: ICONS.season },
  // The id stays `year` so existing links and history entries keep working;
  // the screen is now the taxon explorer with the month grid beneath it.
  { id: 'year', t: 'Таксоны', icon: ICONS.year }
];
const DRAW = { today: drawToday, trigger: drawTrigger, season: drawSeason, year: drawYear };

function buildTabs() {
  const bar = clear($('#tabbar'));
  for (const t of TABS) {
    add(
      bar,
      el(
        'button',
        { class: 'tabbar__item', type: 'button', 'data-view': t.id, onclick: () => show(t.id) },
        el('span', { html: t.icon, style: 'display:inline-flex' }),
        el('span', { text: t.t })
      )
    );
  }
}

async function show(view, { push = true } = {}) {
  S.view = view;
  for (const b of document.querySelectorAll('.tabbar__item')) {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  for (const t of TABS) $(`#view-${t.id}`).hidden = t.id !== view;
  if (push && location.hash.slice(1) !== view) history.pushState({ view }, '', `#${view}`);
  window.scrollTo({ top: 0 });

  if (S.drawn.has(view)) return;
  S.drawn.add(view);
  try {
    await DRAW[view]();
  } catch (e) {
    S.drawn.delete(view);
    console.error(view, e);
  }
}

let rTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(rTimer);
  rTimer = setTimeout(() => redraws.forEach((f) => f()), 160);
});

// ── boot ─────────────────────────────────────────────────────────────────

async function boot() {
  buildTabs();
  window.addEventListener('popstate', (e) => show(e.state?.view ?? 'today', { push: false }));

  try {
    S.meta = await api('/api/meta');
    S.bands = S.meta.scale.pollen;
  } catch (e) {
    $('#freshness-text').textContent = 'Запись недоступна';
    add(clear($('#t-hero')), el('div', { class: 'tile' }, errorNode(e)));
    return;
  }

  const last = S.meta.record.last_date;
  const lag = dayDiff(last, todayISO());
  $('#freshness').dataset.stale = String(lag > 0);
  add(
    clear($('#freshness-text')),
    'Измерено ',
    el('b', { text: fmt(last) }),
    lag <= 0 ? ' — это самое свежее измерение' : ` — ${lag} ${plural(lag, 'день', 'дня', 'дней')} назад; сегодняшних данных нет`
  );

  const start = TABS.some((t) => t.id === location.hash.slice(1)) ? location.hash.slice(1) : 'today';
  await show(start, { push: false });
  warm();
}

/** On a first visit the worker installs while the page is already loading, so
 *  that page's own calls can bypass it. Re-request what Today needs once a
 *  controller exists, or offline would need a second visit. */
function warm() {
  const m = S.meta;
  if (!m) return;
  const urls = ['/api/meta', `/api/day/${m.record.last_date}`, `/api/season-state?date=${m.record.last_date}`];
  const run = () => urls.forEach((u) => fetch(u).catch(() => {}));
  if (navigator.serviceWorker?.controller) run();
  else navigator.serviceWorker?.addEventListener('controllerchange', run, { once: true });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((reg) => {
      // Ask for an update check on every load. Without it the browser can keep
      // serving a worker from a previous build for a long time — which on a
      // demo machine means presenting yesterday's code without knowing it.
      reg.update().catch(() => {});
    })
    .catch((e) => console.warn('[sw]', e));

  // A new worker taking control mid-session would leave the page half on the
  // old build. Reload once, and only once, when that happens.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

boot();
