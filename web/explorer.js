/* ──────────────────────────────────────────────────────────────────────────
   ТАКСОНЫ — the record, made walkable.

   The product held 48 taxa × 247 days and offered no way to ask about one of
   them. Everything here answers that question and nothing else: pick a taxon,
   see its whole season, its peak, where it is right now, and what is known
   about it.

   Same rules as the rest of the interface:
     · no numeral is written in this file — every figure is fetched;
     · a gap is drawn as a gap, never as a zero;
     · literature is marked as literature wherever it appears.

   Helpers arrive by injection rather than import so that app.js stays the one
   place they are defined.
   ────────────────────────────────────────────────────────────────────────── */

export function makeExplorer(D) {
  const { el, add, clear, num, label, splitName, api, pool, levelOf, LEVEL_WORD, fmt, plural, statusNode, emptyNode, seasonChart, sparkline, screenHead, S } = D;

  const state = {
    q: '',
    group: 'все',
    open: null,
    rows: [],
    scaleMax: 1,
    day: null,
    stages: new Map(),
    loaded: false
  };

  /* The sparkline comes from chart.js, which builds it with createElementNS.
     The version that used to live here built <svg> with document.createElement,
     which in an HTML document produces an unknown HTML element rather than a
     real SVG one: the nodes were in the DOM and measured 132px wide, and drew
     nothing at all. */

  /* ── one row in the list ───────────────────────────────────────────────── */
  function row(r) {
    const { latin, ru } = splitName(r.taxon);
    const now = state.day?.get(r.taxon) ?? null;
    const stage = state.stages.get(r.taxon) ?? null;

    return el(
      'button',
      {
        class: 'tx',
        type: 'button',
        'aria-expanded': String(state.open === r.taxon),
        onclick: () => {
          state.open = state.open === r.taxon ? null : r.taxon;
          render();
          if (state.open) requestAnimationFrame(() => document.querySelector('.txd')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
        }
      },
      el(
        'span',
        { class: 'tx__id' },
        el('span', { class: 'tx__name', text: ru ? label(r.taxon) : latin }),
        ru ? el('span', { class: 'tx__latin', text: latin }) : null
      ),
      el('span', { class: 'tx__spark' }, sparkline({ series: r.series, scaleMax: state.scaleMax, log: true })),
      el(
        'span',
        { class: 'tx__now' },
        now === null || now === undefined
          ? el('span', { class: 'tx__none', text: '—' })
          : el('span', { class: 'tx__val tnum', text: num(now) }),
        el('span', { class: 'tx__stage', text: stage ? STAGE_RU[stage] ?? stage : '' })
      )
    );
  }

  const STAGE_RU = {
    not_started: 'не начался',
    ramping: 'нарастает',
    declining: 'идёт на спад',
    ended: 'закончился',
    undetermined: 'нельзя определить'
  };

  /* ── the detail panel ──────────────────────────────────────────────────── */
  function detail(r) {
    const wrap = el('div', { class: 'txd' });
    const { latin } = splitName(r.taxon);
    const peakRow = r.series.reduce((a, b) => (b.count_per_m3 > a.count_per_m3 ? b : a), r.series[0]);

    add(
      wrap,
      el(
        'div',
        { class: 'txd__head' },
        el('h3', { class: 'txd__title' }, label(r.taxon), el('span', { class: 'txd__latin', text: latin })),
        el('span', { class: 'txd__group', text: r.group ?? 'без группы' })
      )
    );

    const chartHost = el('div', { class: 'txd__chart' });
    add(wrap, chartHost);

    // Drawn synchronously, never from requestAnimationFrame: rAF is suspended
    // in a background tab, so a chart scheduled that way silently never
    // appears if the user switches away and back. The first pass uses a
    // fallback width because the node is not in the document yet; a
    // ResizeObserver redraws it at the real width as soon as there is one.
    let lastW = 0;
    const drawChart = (w) => {
      if (w === lastW) return;
      lastW = w;
      clear(chartHost);
      add(
        chartHost,
        seasonChart({
          width: w,
          window: { from: r.series[0].date, to: r.series.at(-1).date },
          primary: { series: r.series, label: label(r.taxon) },
          compact: true
        })
      );
    };
    drawChart(600);
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver((entries) => {
        const w = Math.round(entries[0].contentRect.width);
        if (w > 0) drawChart(w);
      }).observe(chartHost);
    }

    // Facts, each one measured and each one already published by the API.
    add(
      wrap,
      el(
        'dl',
        { class: 'facts' },
        fact('пик', `${num(peakRow.count_per_m3)} зёрен/м³`, fmt(peakRow.date)),
        fact('в записи', `${num(r.measuredDays)} ${plural(r.measuredDays, 'день', 'дня', 'дней')}`, `из них с ненулевым счётом ${num(r.nonZeroDays)}`),
        // Spelled out because a bare "сумма" invites confusion with SPIn, which
        // is computed over a season window and is a different number.
        fact('сумма по всей записи', num(r.total), 'оба сезона, только измеренные дни — это не SPIn'),
        fact('сейчас', state.day?.has(r.taxon) ? num(state.day.get(r.taxon)) : '—', state.stages.get(r.taxon) ? STAGE_RU[state.stages.get(r.taxon)] : 'нет данных на последний день')
      )
    );

    // Literature blocks, loaded on demand and marked as literature.
    const lit = el('div', { class: 'txd__lit' }, statusNode('Загружаем справку…'));
    add(wrap, lit);
    loadLiterature(r.taxon, lit);

    return wrap;
  }

  function fact(k, v, sub) {
    return el('div', { class: 'fact' }, el('dt', { text: k }), el('dd', {}, el('b', { text: String(v) }), sub ? el('span', { text: sub }) : null));
  }

  async function loadLiterature(taxon, host) {
    try {
      const [cross] = await Promise.all([api(`/api/cross-reactivity?taxa=${encodeURIComponent(taxon)}`)]);
      const c = cross.taxa[0];
      const thr = S.meta.symptom_thresholds?.taxa?.[splitName(taxon).latin] ?? null;

      clear(host);
      if (!thr && (!c || !c.has_data)) {
        add(host, el('p', { class: 'note', text: 'Для этого таксона в справочных таблицах записей нет — ни порога симптомов, ни перекрёстных реакций. Это отсутствие записи, а не доказанное отсутствие связи.' }));
        return;
      }

      add(host, el('span', { class: 'eyebrow eyebrow--lit', text: 'Из литературы, не из измерений' }));

      if (thr) {
        add(
          host,
          el('p', { class: 'txd__thr' }, `порог симптомов ${num(thr.low)}–${num(thr.high)} зёрен/м³ · ${thr.source}`),
          thr.note ? el('p', { class: 'note', text: thr.note }) : null
        );
      }

      if (c && c.has_data) {
        add(
          host,
          el('p', { class: 'txd__k', text: 'продукты, с которыми описана перекрёстная реакция' }),
          el('ul', { class: 'chips' }, c.foods.map((f) => el('li', { class: 'chip', text: f }))),
          c.sources.length ? el('p', { class: 'lit__src', text: `Источник: ${c.sources.join(' · ')}` }) : null
        );
      }
    } catch {
      clear(host);
      add(host, el('p', { class: 'note', text: 'Справку не удалось загрузить — нужна сеть. Измеренная часть выше от неё не зависит.' }));
    }
  }

  /* ── filtering ─────────────────────────────────────────────────────────── */
  function visible() {
    const q = state.q.trim().toLowerCase();
    return state.rows.filter((r) => {
      if (state.group !== 'все' && (r.group ?? 'без группы') !== state.group) return false;
      if (!q) return true;
      return r.taxon.toLowerCase().includes(q) || label(r.taxon).toLowerCase().includes(q);
    });
  }

  /* ── render ────────────────────────────────────────────────────────────── */
  let host = null;

  function render() {
    if (!host) return;
    const rows = visible();
    const groups = ['все', ...Object.keys(S.meta.taxa.groups ?? {})];

    clear(host);
    const tile = el('div', { class: 'tile' });
    add(
      tile,
      screenHead({
        eyebrow: 'Таксоны',
        problem:
          'Центральной Азии нет ни в одной открытой системе мониторинга пыльцы. Спросить «а когда пылит берёза в Алматы» негде.',
        title: `Все ${num(state.rows.length)} ${plural(state.rows.length, 'таксон', 'таксона', 'таксонов')} в записи`,
        lede:
          'Найдите любой по русскому или латинскому имени — и увидите его сезон целиком: когда начался, где пик, где ловушка не работала.'
      })
    );

    // One filter row above the list, as the data-vis rules ask.
    const filters = el('div', { class: 'filters' });
    add(
      filters,
      el('input', {
        class: 'search',
        type: 'search',
        value: state.q,
        placeholder: 'Поиск: полынь, Betula…',
        'aria-label': 'Поиск по таксонам',
        oninput: (e) => {
          state.q = e.target.value;
          const keep = e.target.selectionStart;
          render();
          const s = host.querySelector('.search');
          s.focus();
          s.setSelectionRange(keep, keep);
        }
      }),
      el(
        'div',
        { class: 'chipset', role: 'group', 'aria-label': 'Тип' },
        groups.map((g) =>
          el('button', {
            class: 'chip chip--btn',
            type: 'button',
            'aria-pressed': String(state.group === g),
            text: g,
            onclick: () => {
              state.group = g;
              render();
            }
          })
        )
      )
    );
    add(tile, filters);

    if (!rows.length) {
      add(tile, emptyNode('Ничего не нашлось', 'Попробуйте латинское имя — например, Betula.'));
    } else {
      // The legend sits ABOVE the rows it explains. Below them it was arriving
      // after the reader had already decided what the shapes meant.
      add(
        tile,
        el('p', {
          class: 'txscale',
          text: `Все графики-строки — в одном логарифмическом масштабе, общий максимум ${num(state.scaleMax)} зёрен/м³, поэтому их высоту можно сравнивать между строками.`
        }),
        el(
          'div',
          { class: 'txlegend' },
          el('span', { class: 'txlegend__k', text: 'таксон' }),
          el('span', { class: 'txlegend__k txlegend__k--mid', text: 'весь сезон' }),
          el('span', { class: 'txlegend__k txlegend__k--end', text: 'сейчас' })
        )
      );
      const list = el('div', { class: 'txlist' });
      for (const r of rows) {
        add(list, row(r));
        if (state.open === r.taxon) add(list, detail(r));
      }
      add(tile, list);
    }

    add(
      tile,
      el('p', {
        class: 'note',
        text: `Показано ${num(rows.length)} из ${num(state.rows.length)}.`
      })
    );
    add(host, tile);
  }

  /* ── data ──────────────────────────────────────────────────────────────── */
  async function load(mount) {
    host = mount;
    if (state.loaded) return render();

    const m = S.meta;
    add(clear(host), el('div', { class: 'tile' }, el('span', { class: 'eyebrow', text: 'Таксоны' }), statusNode(`Загружаем ряды по ${m.counts.taxa} таксонам…`)));

    const from = m.record.first_date;
    const to = m.record.last_date;
    const all = m.taxa.pollen.concat(m.taxa.mold);
    const groupOf = new Map();
    for (const [g, list] of Object.entries(m.taxa.groups ?? {})) for (const t of list) groupOf.set(t, g);

    const series = await pool(all, async (t) => {
      const s = await api(`/api/taxon/${encodeURIComponent(t)}/season?${new URLSearchParams({ year: to.slice(0, 4), from, to })}`);
      return { taxon: t, series: s.series };
    });

    state.rows = series
      .map(({ taxon, series: s }) => ({
        taxon,
        series: s,
        group: groupOf.get(taxon) ?? null,
        peak: Math.max(0, ...s.map((r) => r.count_per_m3)),
        total: s.reduce((a, r) => a + r.count_per_m3, 0),
        measuredDays: s.length,
        nonZeroDays: s.filter((r) => r.count_per_m3 > 0).length
      }))
      .sort((a, b) => b.peak - a.peak);

    // The one number every sparkline is drawn against.
    state.scaleMax = Math.max(1, ...state.rows.map((r) => r.peak));

    // The day's own counts and each taxon's season stage — both already
    // published; nothing is recomputed in the browser.
    try {
      const day = await api(`/api/day/${to}`);
      state.day = new Map(day.taxa.map((t) => [t.taxon, t.count_per_m3]));
    } catch {
      state.day = null;
    }
    try {
      const st = await api(`/api/season-state?date=${to}`);
      for (const s of st.taxa ?? []) state.stages.set(s.taxon, s.state);
    } catch {
      /* stages are a nicety; the list stands without them */
    }

    state.loaded = true;
    render();
    return state.rows;
  }

  // The month grid below this screen needs the same 48 series. Handing them
  // over halves the requests the screen makes — it used to fetch them twice.
  const rows = () => state.rows;

  return { load, render, rows };
}
