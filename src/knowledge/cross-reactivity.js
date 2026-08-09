/* ──────────────────────────────────────────────────────────────────────────
   KNOWLEDGE LAYER — NOT MEASUREMENT.

   Everything else in src/ computes from data/almaty_trap_clean.csv. This file
   does not. It is a static table compiled from allergology literature, and it
   lives in its own directory for exactly that reason: nothing here may ever be
   mistaken for something the trap counted.

   Three rules keep the boundary visible:

     1. This module imports nothing from the dataset and is imported by nothing
        that computes a measured figure.
     2. Every response built from it carries `measured: false` and
        `source_kind: 'literature'` at the top level, not buried in a footnote.
     3. A taxon absent from the table returns an explicit "no established data"
        result. It never returns an empty list, because an empty list reads as
        "no cross-reactivity exists" — a claim this table cannot make.

   Cross-reactivity is IgE recognising similar proteins in pollen and food. It
   is a population-level association reported in the literature, not a property
   of any individual, and this module never says otherwise.
   ────────────────────────────────────────────────────────────────────────── */

export const TABLE_NOTE =
  'Таблица составлена по аллергологической литературе, а не по измерениям ловушки. ' +
  'Перекрёстная реактивность — популяционная закономерность, а не свойство конкретного человека.';

/**
 * Keyed by the Latin part of the canonical taxon name, so it survives the
 * Russian gloss the dataset carries ("Artemisia (полынь)").
 */
/**
 * `evidence` is part of the record, not a footnote:
 *   'established' - a named syndrome with a named allergen behind it.
 *   'limited'     - reported, but thin, contested, or extrapolated from a
 *                   relative. The interface says so on the row itself.
 * A row that cannot honestly claim 'established' is not promoted to it, and a
 * taxon whose food association is not established at all is simply absent -
 * the absent branch already says the right thing.
 */
export const CROSS_REACTIVITY = {
  Artemisia: {
    evidence: 'established',
    syndromes: [
      'полынь — сельдерей — специи',
      'полынь — фенхель',
      'полынь — горчица',
      'полынь — персик',
      'полынь — подсолнечник'
    ],
    foods: [
      'сельдерей', 'морковь', 'фенхель', 'кориандр', 'тмин', 'анис',
      'персик', 'подсолнечник', 'горчица', 'перец', 'мёд'
    ],
    allergens: [
      { name: 'Art v 1', note: null },
      { name: 'Art v 3', note: 'связан с системными реакциями на персик' }
    ],
    sources: [
      'Thermo Fisher Allergen Encyclopedia, w6',
      'JACI 2024, «Role of Api g 7 in mugwort pollen-related celery allergy»'
    ]
  },

  Betula: {
    evidence: 'established',
    syndromes: ['берёза — косточковые и орехи (PR-10)'],
    foods: ['яблоко', 'черешня', 'персик', 'фундук', 'морковь', 'сельдерей', 'киви', 'соя'],
    allergens: [
      { name: 'Bet v 1', note: 'белок PR-10; разрушается при нагревании — печёное яблоко часто переносится' }
    ],
    sources: ['Thermo Fisher Allergen Encyclopedia, t3']
  },

  Corylus: {
    evidence: 'established',
    syndromes: ['лещина — фундук и косточковые (PR-10)'],
    foods: ['фундук', 'яблоко', 'черешня', 'персик', 'морковь'],
    allergens: [{ name: 'Cor a 1', note: 'гомолог Bet v 1; та же группа PR-10, что у берёзы' }],
    sources: ['Thermo Fisher Allergen Encyclopedia, t4']
  },

  Alnus: {
    evidence: 'established',
    syndromes: ['ольха — косточковые и орехи (PR-10)'],
    foods: ['яблоко', 'фундук', 'морковь', 'сельдерей', 'черешня'],
    allergens: [{ name: 'Aln g 1', note: 'гомолог Bet v 1' }],
    sources: ['Thermo Fisher Allergen Encyclopedia, t2']
  },

  Poaceae: {
    evidence: 'established',
    syndromes: ['злаковые — томат и бахчевые', 'злаковые — арахис'],
    foods: ['томат', 'дыня', 'арбуз', 'апельсин', 'киви', 'арахис', 'картофель'],
    allergens: [
      { name: 'Phl p 12', note: 'профилин; отвечает за реакции на бахчевые и цитрусовые' },
      { name: 'Phl p 1', note: null }
    ],
    sources: ['Thermo Fisher Allergen Encyclopedia, g6']
  },

  Platanus: {
    evidence: 'established',
    syndromes: ['платан — орехи и косточковые (LTP)'],
    foods: ['фундук', 'персик', 'яблоко', 'арахис', 'нут', 'салат-латук'],
    allergens: [
      { name: 'Pla a 3', note: 'нсLTP; термостабилен, поэтому реакции возможны и на приготовленное' }
    ],
    sources: ['Thermo Fisher Allergen Encyclopedia, t11']
  },

  Cupressaceae: {
    evidence: 'established',
    syndromes: ['кипарисовые — персик', 'кипарисовые — цитрусовые'],
    foods: ['персик', 'цитрусовые'],
    allergens: [
      { name: 'BP14 / Cup s 7', note: 'гиббереллин-регулируемый белок; механизм отличен от LTP' }
    ],
    sources: ['Thermo Fisher Allergen Encyclopedia, t23']
  },

  Chenopodiaceae: {
    evidence: 'established',
    syndromes: ['маревые — бахчевые и косточковые (профилин)'],
    foods: ['дыня', 'банан', 'персик', 'томат'],
    allergens: [
      { name: 'Che a 2', note: 'профилин' },
      { name: 'Che a 3', note: 'полькальцин' }
    ],
    sources: ['Thermo Fisher Allergen Encyclopedia, w10']
  },

  Ambrosia: {
    evidence: 'established',
    syndromes: ['амброзия — бахчевые'],
    foods: ['дыня', 'банан', 'арбуз', 'кабачок'],
    allergens: [{ name: 'Amb a 1', note: null }],
    notes: ['выраженная перекрёстная реактивность с полынью'],
    sources: ['Allergy 2025, «Art v 1 and Amb a 4 Co-Sensitization»']
  },

  Apiaceae: {
    evidence: 'established',
    syndromes: ['зонтичные — сельдерей, морковь, специи'],
    foods: ['сельдерей', 'морковь', 'петрушка', 'укроп', 'фенхель', 'кориандр', 'тмин', 'анис'],
    allergens: [{ name: 'Api g 1', note: 'белок PR-10 сельдерея' }],
    notes: [
      'Перечисленные продукты — растения того же семейства, что и эта пыльца. Связь описана прежде всего в паре с полынью (синдром «полынь — сельдерей — специи»).'
    ],
    sources: ['Thermo Fisher Allergen Encyclopedia, w6']
  },

  Helianthus: {
    evidence: 'limited',
    syndromes: ['подсолнечник — семечки, в связке с полынью'],
    foods: ['семена подсолнечника', 'халва', 'ромашка в составе чая'],
    allergens: [{ name: 'Hel a 2', note: 'профилин' }],
    notes: [
      'Описано в отдельных сериях случаев, преимущественно у людей с аллергией на полынь.'
    ],
    sources: ['Thermo Fisher Allergen Encyclopedia, w204']
  },

  Cannabaceae: {
    evidence: 'limited',
    syndromes: ['коноплёвые — персик и томат (LTP)'],
    foods: ['персик', 'томат', 'фундук'],
    allergens: [{ name: 'Can s 3', note: 'нсLTP' }],
    notes: [
      'Связь описана для конопли (Cannabis sativa). Ловушка считает семейство целиком, а в нём присутствует и хмель, для которого таких данных нет. Перенос вывода с рода на семейство — допущение.'
    ],
    sources: ['Clin Transl Allergy 2019, «Cannabis allergy: what the clinician needs to know»']
  },

  Moraceae: {
    evidence: 'limited',
    syndromes: ['тутовые — инжир'],
    foods: ['инжир'],
    allergens: [],
    notes: [
      'Инжир — растение того же семейства, что шелковица. Число описанных наблюдений невелико.'
    ],
    sources: []
  }
};

/** Latin part of "Artemisia (полынь)". */
export function latinOf(taxon) {
  return String(taxon).split(' (')[0].trim();
}

/**
 * @param {string[]} taxa canonical taxon names
 * @returns {object[]} one entry per input taxon, in input order. A taxon with
 *   no table entry returns has_data:false with a reason — never an empty list.
 */
export function crossReactivityFor(taxa) {
  return taxa.map((taxon) => {
    const latin = latinOf(taxon);
    const e = CROSS_REACTIVITY[latin];
    if (!e) {
      return {
        taxon,
        latin,
        has_data: false,
        reason:
          'Для этого таксона в таблице нет установленных данных о перекрёстной реактивности. ' +
          'Это означает отсутствие записи в таблице, а не доказанное отсутствие перекрёстных реакций.',
        syndromes: null,
        foods: null,
        allergens: null,
        sources: null
      };
    }
    return {
      taxon,
      latin,
      has_data: true,
      evidence: e.evidence,
      evidence_note:
        e.evidence === 'limited'
          ? 'Доказательная база для этой записи ограничена: отдельные наблюдения или перенос с родственного вида.'
          : null,
      syndromes: e.syndromes,
      foods: e.foods,
      allergens: e.allergens,
      notes: e.notes ?? [],
      sources: e.sources,
      sources_note: e.sources.length ? null : 'Источник для этой записи в таблице не указан.'
    };
  });
}
