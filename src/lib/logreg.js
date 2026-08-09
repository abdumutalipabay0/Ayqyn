// L2-regularised binary logistic regression, fitted by full-batch gradient
// descent on standardised features.
//
// Written by hand rather than pulled from a library so the service has zero
// runtime dependencies and cannot fail during an offline demo. The maths is
// standard and is covered by test/unit.test.js, including a check against a
// closed-form separable case and a check that the L2 penalty shrinks weights.
//
// The intercept is NOT penalised — penalising it would make the fit depend on
// the arbitrary base rate of bad days.

function sigmoid(z) {
  // Numerically stable on both tails.
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

/**
 * Standardise columns to zero mean / unit variance so that a single L2
 * penalty is fair across features measured on different scales.
 * Zero-variance columns are reported, not silently kept: a feature that never
 * varies carries no information and must not be assigned a weight.
 */
export function standardise(X) {
  const n = X.length;
  const p = n === 0 ? 0 : X[0].length;
  const mu = new Array(p).fill(0);
  const sd = new Array(p).fill(0);
  const constant = [];

  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j];
    mu[j] = s / n;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const d = X[i][j] - mu[j];
      v += d * d;
    }
    sd[j] = Math.sqrt(v / n);
    if (sd[j] === 0) constant.push(j);
  }

  const Z = X.map((row) => row.map((x, j) => (sd[j] === 0 ? 0 : (x - mu[j]) / sd[j])));
  return { Z, mu, sd, constant };
}

/**
 * @param {number[][]} X  n x p design matrix (unstandardised)
 * @param {number[]}   y  n binary labels (0/1)
 * @returns {{weights:number[], intercept:number, iterations:number,
 *            converged:boolean, logLoss:number, constantFeatures:number[]}}
 *          weights are in STANDARDISED space, so they are directly comparable
 *          across features and can be ranked by magnitude.
 */
export function fitLogisticL2(X, y, opts = {}) {
  const lambda = opts.lambda ?? 1;
  const iterations = opts.iterations ?? 4000;
  const lr = opts.learningRate ?? 0.1;
  const tol = opts.tolerance ?? 1e-9;

  const n = X.length;
  if (n === 0) throw new Error('fitLogisticL2: empty design matrix');
  const p = X[0].length;
  if (y.length !== n) throw new Error('fitLogisticL2: X/y length mismatch');

  const { Z, mu, sd, constant } = standardise(X);

  let w = new Array(p).fill(0);
  let b = 0;
  let prevLoss = Infinity;
  let converged = false;
  let it = 0;

  for (; it < iterations; it++) {
    const gw = new Array(p).fill(0);
    let gb = 0;
    let loss = 0;

    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < p; j++) z += w[j] * Z[i][j];
      const pi = sigmoid(z);
      const err = pi - y[i];
      gb += err;
      for (let j = 0; j < p; j++) gw[j] += err * Z[i][j];
      // Clamped log-loss; pi can reach 0/1 in floating point.
      const eps = 1e-12;
      loss -= y[i] * Math.log(Math.max(pi, eps)) + (1 - y[i]) * Math.log(Math.max(1 - pi, eps));
    }

    loss /= n;
    let pen = 0;
    for (let j = 0; j < p; j++) pen += w[j] * w[j];
    loss += (lambda / (2 * n)) * pen;

    for (let j = 0; j < p; j++) gw[j] = gw[j] / n + (lambda / n) * w[j];
    gb /= n;

    for (let j = 0; j < p; j++) w[j] -= lr * gw[j];
    b -= lr * gb;

    if (Math.abs(prevLoss - loss) < tol) {
      converged = true;
      prevLoss = loss;
      it++;
      break;
    }
    prevLoss = loss;
  }

  // A constant feature must carry no weight, whatever gradient noise did.
  for (const j of constant) w[j] = 0;

  return {
    weights: w,
    intercept: b,
    iterations: it,
    converged,
    logLoss: prevLoss,
    constantFeatures: constant,
    mu,
    sd
  };
}

export function predictProba(fit, xRow) {
  let z = fit.intercept;
  for (let j = 0; j < xRow.length; j++) {
    const zj = fit.sd[j] === 0 ? 0 : (xRow[j] - fit.mu[j]) / fit.sd[j];
    z += fit.weights[j] * zj;
  }
  return sigmoid(z);
}
