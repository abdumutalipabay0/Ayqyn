// Dates and descriptive statistics. No I/O, no domain knowledge.

// ── Dates ────────────────────────────────────────────────────────────────
// Every date in this codebase is a 'YYYY-MM-DD' string in UTC. We never
// construct a local-time Date from a bare date string.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function toUTC(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`);
}

export function fromUTC(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const d = toUTC(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

export function diffDays(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/** Inclusive calendar range. Does not consult the dataset. */
export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function yearOf(dateStr) {
  return Number(dateStr.slice(0, 4));
}

/** Same month and day, in a different year. Returns null for 29 Feb in a
 *  non-leap year rather than silently sliding to 1 March. */
export function sameDayInYear(dateStr, year) {
  const md = dateStr.slice(5);
  const candidate = `${year}-${md}`;
  return isDateString(candidate) ? candidate : null;
}

// ── Descriptive statistics ───────────────────────────────────────────────

export function sum(xs) {
  let t = 0;
  for (const x of xs) t += x;
  return t;
}

export function mean(xs) {
  if (xs.length === 0) return null;
  return sum(xs) / xs.length;
}

export function log1p(x) {
  return Math.log1p(x);
}

/**
 * Pearson correlation. Returns null when it is undefined rather than 0 —
 * a constant series has no correlation, and reporting 0 would be a claim we
 * cannot support.
 */
export function pearson(xs, ys) {
  if (xs.length !== ys.length) {
    throw new Error(`pearson: length mismatch ${xs.length} vs ${ys.length}`);
  }
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Pearson on log1p-transformed values, which is how collinearity is defined
 *  for this dataset (concentrations are heavily right-skewed). */
export function logPearson(xs, ys) {
  return pearson(xs.map(log1p), ys.map(log1p));
}

export function round(x, dp = 0) {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

/** Connected components over an undirected graph given as an edge list.
 *  Used to collapse mutually collinear taxa into one feature: if A~B and
 *  B~C are both inseparable, then A, B and C form a single group even when
 *  A~C sits below the threshold. */
export function connectedComponents(nodes, edges) {
  const parent = new Map(nodes.map((n) => [n, n]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const [a, b] of edges) {
    if (parent.has(a) && parent.has(b)) union(a, b);
  }
  const byRoot = new Map();
  for (const n of nodes) {
    const r = find(n);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(n);
  }
  return [...byRoot.values()].map((g) => g.slice().sort());
}
