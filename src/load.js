// Dataset loader.
//
// Contract, in order of importance:
//   1. If the dataset is absent or malformed, this module THROWS. It never
//      returns a partial, zero-filled or synthesised dataset. There is no
//      "demo mode" and no generator anywhere in this codebase — a missing
//      measurement must surface as a missing measurement all the way to the
//      HTTP response.
//   2. A date is "measured" if and only if it appears in the file. The
//      declared gap list is only ever used to CHECK the file, never to patch
//      it.
//   3. Nothing is interpolated, forward-filled, or averaged across a gap.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECLARED_GAPS, MOLD_GROUP, GROUPS } from './config.js';
import { isDateString, dateRange } from './lib/util.js';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(here, '..', 'data');

// DATASET_PATH overrides the default location. It exists for staging and for
// end-to-end smoke tests against a fixture; it is NOT a way to substitute
// invented numbers for the laboratory file. Whatever it points at is served
// verbatim, so point it only at data you are willing to publish.
const OVERRIDE = process.env.DATASET_PATH ? resolve(process.env.DATASET_PATH) : null;
const JSON_PATH = OVERRIDE && OVERRIDE.endsWith('.json') ? OVERRIDE : resolve(DATA_DIR, 'almaty_trap_clean.json');
const CSV_PATH = OVERRIDE && OVERRIDE.endsWith('.csv') ? OVERRIDE : resolve(DATA_DIR, 'almaty_trap_clean.csv');

export class DatasetMissingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatasetMissingError';
    this.code = 'DATASET_MISSING';
  }
}

export class DatasetInvalidError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatasetInvalidError';
    this.code = 'DATASET_INVALID';
  }
}

// ── Parsing ──────────────────────────────────────────────────────────────

const REQUIRED_COLUMNS = [
  'date',
  'taxon',
  'group',
  'count_per_m3',
  'temp_c',
  'humidity_pct',
  'wind_ms'
];

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) throw new DatasetInvalidError('CSV has no data rows');
  const header = splitCsvLine(lines[0]);
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) {
      throw new DatasetInvalidError(
        `CSV is missing required column "${col}". Found: ${header.join(', ')}`
      );
    }
  }
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return lines.slice(1).map((line, n) => {
    const cells = splitCsvLine(line);
    const row = {};
    for (const col of REQUIRED_COLUMNS) row[col] = cells[idx[col]];
    row.__line = n + 2;
    return row;
  });
}

/**
 * Accepts either a flat array of observations, or the shipped day-oriented
 * export: { days: [{ date, taxa:{name:count}, molds:{name:count}, weather }] }.
 * Only non-zero taxa appear in that form; a taxon absent from a measured day
 * was counted zero, which is a fact about the day, not a missing value.
 */
function flattenJson(parsed, source) {
  const flat = Array.isArray(parsed)
    ? parsed
    : parsed.observations ?? parsed.rows ?? parsed.data ?? null;
  if (Array.isArray(flat)) return flat;

  const days = parsed?.days;
  if (!Array.isArray(days)) {
    throw new DatasetInvalidError(
      `${source}: expected an array of observations, or an object with a "days" array`
    );
  }
  const out = [];
  for (const day of days) {
    const w = day.weather ?? {};
    const emit = (name, count, isMold) =>
      out.push({
        date: day.date,
        taxon: name,
        group: isMold ? MOLD_GROUP : null,
        is_mold: isMold,
        count_per_m3: count,
        temp_c: w.temp_c ?? null,
        humidity_pct: w.humidity_pct ?? null,
        wind_ms: w.wind_ms ?? null
      });
    for (const [name, count] of Object.entries(day.taxa ?? {})) emit(name, count, false);
    for (const [name, count] of Object.entries(day.molds ?? {})) emit(name, count, true);
    // A measured day with no non-zero taxon still has to exist. Anchor it with
    // a zero row so the day is not mistaken for a gap.
    if (Object.keys(day.taxa ?? {}).length === 0 && Object.keys(day.molds ?? {}).length === 0) {
      emit('__measured_day__', 0, false);
    }
  }
  return out;
}

/** A measured value that is genuinely absent stays absent (null). Only an
 *  explicitly written 0 becomes 0. '' / 'NA' / 'null' are absent, never 0. */
function numOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'na' || s.toLowerCase() === 'null' || s === '-') {
    return null;
  }
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normaliseRows(rawRows, source) {
  const rows = [];
  for (const r of rawRows) {
    const date = String(r.date ?? '').trim().slice(0, 10);
    if (!isDateString(date)) {
      throw new DatasetInvalidError(
        `Bad date "${r.date}" at ${source} row ${r.__line ?? '?'}`
      );
    }
    const taxon = String(r.taxon ?? '').trim();
    if (!taxon) {
      throw new DatasetInvalidError(`Empty taxon at ${source} row ${r.__line ?? '?'}`);
    }
    // group may be null when the source is the JSON export, which separates
    // molds from pollen but does not record tree/grass. is_mold is therefore
    // carried explicitly rather than being re-derived from the group string.
    const rawGroup = r.group === null || r.group === undefined ? null : String(r.group).trim();
    const group = rawGroup === '' ? null : rawGroup;
    if (group !== null && !GROUPS.includes(group)) {
      throw new DatasetInvalidError(
        `Unknown group "${group}" at ${source} row ${r.__line ?? '?'}; expected one of ${GROUPS.join(', ')}`
      );
    }
    const isMoldRow = r.is_mold !== undefined ? Boolean(r.is_mold) : group === MOLD_GROUP;
    const count = numOrNull(r.count_per_m3);
    if (count === null) {
      throw new DatasetInvalidError(
        `Missing count_per_m3 for ${taxon} on ${date}. A measured day must carry a number; ` +
          'an unmeasured day must be absent from the file entirely.'
      );
    }
    if (count < 0) {
      throw new DatasetInvalidError(`Negative count ${count} for ${taxon} on ${date}`);
    }
    rows.push({
      date,
      taxon,
      group,
      is_mold: isMoldRow,
      count_per_m3: count,
      temp_c: numOrNull(r.temp_c),
      humidity_pct: numOrNull(r.humidity_pct),
      wind_ms: numOrNull(r.wind_ms)
    });
  }
  return rows;
}

// ── Gap reconciliation ───────────────────────────────────────────────────

function expandDeclaredGaps() {
  const s = new Set();
  for (const g of DECLARED_GAPS) for (const d of dateRange(g.from, g.to)) s.add(d);
  return s;
}

/**
 * Compares the dates actually absent from the file against the declared gap
 * list. Discrepancies are reported, never reconciled. Trusting either side
 * silently is how a fabricated day gets into a public-health product.
 */
export function reconcileGaps(observedDates, firstDate, lastDate) {
  const declared = expandDeclaredGaps();
  const absent = [];
  for (const d of dateRange(firstDate, lastDate)) {
    if (!observedDates.has(d)) absent.push(d);
  }
  const absentSet = new Set(absent);
  const undeclaredAbsent = absent.filter((d) => !declared.has(d));
  const declaredButPresent = [...declared]
    .filter((d) => d >= firstDate && d <= lastDate)
    .filter((d) => !absentSet.has(d))
    .sort();
  return {
    matches: undeclaredAbsent.length === 0 && declaredButPresent.length === 0,
    absentDates: absent,
    undeclaredAbsent,
    declaredButPresent
  };
}

/** Contiguous runs of absent dates, for human-readable reporting. */
function toRanges(dates) {
  const out = [];
  let start = null;
  let prev = null;
  for (const d of dates) {
    if (start === null) {
      start = d;
    } else if (prev !== null && new Date(`${d}T00:00:00Z`) - new Date(`${prev}T00:00:00Z`) !== 86400000) {
      out.push({ from: start, to: prev });
      start = d;
    }
    prev = d;
  }
  if (start !== null) out.push({ from: start, to: prev });
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────

let cache = null;

export function datasetPresent() {
  return existsSync(JSON_PATH) || existsSync(CSV_PATH);
}

export function datasetPaths() {
  return { json: JSON_PATH, csv: CSV_PATH };
}

/**
 * Loads and indexes the dataset. Throws DatasetMissingError if no file is
 * present — callers must surface that, not paper over it.
 */
export function loadDataset({ force = false } = {}) {
  if (cache && !force) return cache;

  let rawRows;
  let source;
  // CSV is preferred: it is the only form that records the древесные/травы
  // distinction. The JSON export separates molds from pollen but does not
  // carry the pollen subgroup, so loading from it leaves `group` null.
  if (existsSync(CSV_PATH)) {
    source = CSV_PATH;
    rawRows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  } else if (existsSync(JSON_PATH)) {
    source = JSON_PATH;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
    } catch (e) {
      throw new DatasetInvalidError(`${JSON_PATH} is not valid JSON: ${e.message}`);
    }
    rawRows = flattenJson(parsed, JSON_PATH);
  } else {
    throw new DatasetMissingError(
      [
        'No measurement file found. Expected one of:',
        `  ${JSON_PATH}`,
        `  ${CSV_PATH}`,
        '',
        'This service has no fallback, no mock mode and no generator: every number it',
        'serves comes from the laboratory file. See data/SCHEMA.md for the required',
        'columns.'
      ].join('\n')
    );
  }

  cache = indexRows(normaliseRows(rawRows, source), source);
  return cache;
}

/**
 * Builds the indexed dataset from already-normalised rows.
 * Exported so tests can construct a dataset in memory. Test fixtures are
 * synthetic by definition and live in test/ — they are never written into
 * data/ and are never served by the running service.
 */
export function indexRows(rows, source = 'in-memory') {
  if (rows.length === 0) throw new DatasetInvalidError(`${source} contains no observations`);

  // Reject duplicate (date, taxon) — silently keeping one would be a choice
  // about data we are not entitled to make.
  const seen = new Map();
  for (const r of rows) {
    const k = `${r.date}|${r.taxon}`;
    if (seen.has(k)) {
      throw new DatasetInvalidError(
        `Duplicate observation for ${r.taxon} on ${r.date}. Resolve it in the source file.`
      );
    }
    seen.set(k, r);
  }

  const byDate = new Map();
  const byTaxon = new Map();
  const taxonGroup = new Map();
  const taxonIsMold = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
    if (!byTaxon.has(r.taxon)) byTaxon.set(r.taxon, new Map());
    byTaxon.get(r.taxon).set(r.date, r);
    taxonGroup.set(r.taxon, r.group);
    taxonIsMold.set(r.taxon, r.is_mold);
  }

  const dates = [...byDate.keys()].sort();
  const observedDates = new Set(dates);
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  // Weather is a property of the day, not of the taxon. Take it from the
  // day's rows and verify the file agrees with itself.
  const weatherByDate = new Map();
  for (const [date, dayRows] of byDate) {
    const pick = (field) => {
      const vals = [...new Set(dayRows.map((r) => r[field]).filter((v) => v !== null))];
      if (vals.length === 0) return null;
      if (vals.length > 1) {
        throw new DatasetInvalidError(
          `Conflicting ${field} values on ${date}: ${vals.join(', ')}`
        );
      }
      return vals[0];
    };
    weatherByDate.set(date, {
      temp_c: pick('temp_c'),
      humidity_pct: pick('humidity_pct'),
      wind_ms: pick('wind_ms')
    });
  }

  const gapReport = reconcileGaps(observedDates, firstDate, lastDate);
  const taxa = [...byTaxon.keys()].sort();

  return {
    source,
    rows,
    dates,
    observedDates,
    firstDate,
    lastDate,
    byDate,
    byTaxon,
    taxonGroup,
    taxonIsMold,
    weatherByDate,
    taxa,
    pollenTaxa: taxa.filter((t) => !taxonIsMold.get(t)),
    moldTaxa: taxa.filter((t) => taxonIsMold.get(t)),
    gaps: {
      ...gapReport,
      ranges: toRanges(gapReport.absentDates),
      declared: DECLARED_GAPS
    },
    counts: {
      observations: rows.length,
      measurementDays: dates.length,
      taxa: taxa.length
    }
  };
}

export function resetCache() {
  cache = null;
}

/**
 * Resolves a user-supplied taxon name against the dataset.
 *
 * Names in the file carry a Russian gloss — "Artemisia (полынь)" — so a
 * request for "Artemisia" must match. Resolution is: exact, then
 * case-insensitive exact, then match on the Latin part before " (", then
 * unique case-insensitive prefix. An ambiguous prefix returns the candidates
 * rather than silently picking one.
 *
 * @returns {{ok:true, taxon:string} | {ok:false, reason:'unknown'|'ambiguous', candidates:string[]}}
 */
export function resolveTaxonName(ds, name) {
  const q = String(name ?? '').trim();
  if (!q) return { ok: false, reason: 'unknown', candidates: [] };

  if (ds.byTaxon.has(q)) return { ok: true, taxon: q };

  const lower = q.toLowerCase();
  const latinOf = (t) => t.split(' (')[0].trim().toLowerCase();

  const exactCI = ds.taxa.filter((t) => t.toLowerCase() === lower);
  if (exactCI.length === 1) return { ok: true, taxon: exactCI[0] };

  const byLatin = ds.taxa.filter((t) => latinOf(t) === lower);
  if (byLatin.length === 1) return { ok: true, taxon: byLatin[0] };
  if (byLatin.length > 1) return { ok: false, reason: 'ambiguous', candidates: byLatin };

  const byPrefix = ds.taxa.filter((t) => t.toLowerCase().startsWith(lower));
  if (byPrefix.length === 1) return { ok: true, taxon: byPrefix[0] };
  if (byPrefix.length > 1) return { ok: false, reason: 'ambiguous', candidates: byPrefix };

  return { ok: false, reason: 'unknown', candidates: [] };
}

/** Count for one taxon on one date. Returns undefined when the day was not
 *  measured, and 0 only when the laboratory recorded a zero. The caller must
 *  distinguish the two. */
export function countOf(ds, taxon, date) {
  const series = ds.byTaxon.get(taxon);
  if (!series) return undefined;
  if (!ds.observedDates.has(date)) return undefined;
  const row = series.get(date);
  // The day was measured; a taxon absent from that day's rows was counted zero.
  return row ? row.count_per_m3 : 0;
}
