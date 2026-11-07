import { parseDecimal, pow10n, toSafe } from './decimal.js';
import { CurrencyMismatchError, compare, fromMinor, make, negate, scaleUp, subtract, toScale, type Money } from './money.js';

const MAX = Number.MAX_SAFE_INTEGER;

/**
 * Where the indivisible remainder (always fewer minor units than there are non-zero buckets for
 * the spreading strategies) goes:
 * - 'largest'  largest-remainder (Hamilton) method: units go to the buckets with the biggest
 *              fractional part, ties to the earlier bucket. The default; minimises error per bucket.
 * - 'first'    one unit each to the first buckets (with non-zero weight)
 * - 'last'     one unit each to the last buckets
 * - 'toFirst'  the whole remainder to the first bucket
 * - 'toLast'   the whole remainder to the last bucket
 */
export type Remainder = 'largest' | 'first' | 'last' | 'toFirst' | 'toLast';

export interface AllocateOptions {
  readonly remainder?: Remainder;
}

/** A ratio weight: a non-negative integer, bigint or decimal string ('33.3'). */
export type Weight = number | bigint | string;

function weightsToBig(ws: readonly Weight[]): bigint[] {
  return weightsScaled(ws).ws;
}

function weightsScaled(ws: readonly Weight[]): { ws: bigint[]; scale: number } {
  let scale = 0;
  const parsed = ws.map((w) => {
    if (typeof w === 'bigint') return { digits: w, scale: 0 };
    if (typeof w === 'number' && Number.isSafeInteger(w)) return { digits: BigInt(w), scale: 0 };
    const p = parseDecimal(String(w));
    return p;
  });
  for (const p of parsed) {
    if (p.digits < 0n) throw new RangeError('Allocation weights must not be negative');
    if (p.scale > scale) scale = p.scale;
  }
  return { ws: parsed.map((p) => p.digits * pow10n(scale - p.scale)), scale };
}

/** Distributes `rem` extra units among the buckets; `frac` are the per-bucket remainders (for 'largest'). */
function distribute<T extends number | bigint>(shares: T[], rem: number, weights: readonly (number | bigint)[], frac: readonly (number | bigint)[] | null, mode: Remainder, one: T): void {
  if (rem === 0) return;
  const n = shares.length;
  const eligible: number[] = [];
  for (let i = 0; i < n; i++) if (weights[i]! > 0) eligible.push(i);
  const plus = (i: number, k: number) => {
    shares[i] = (typeof one === 'number' ? (shares[i] as number) + k : (shares[i] as bigint) + BigInt(k)) as T;
  };
  switch (mode) {
    case 'toFirst': return plus(eligible[0]!, rem);
    case 'toLast': return plus(eligible[eligible.length - 1]!, rem);
    case 'first': for (let k = 0; k < rem; k++) plus(eligible[k]!, 1); return;
    case 'last': for (let k = 0; k < rem; k++) plus(eligible[eligible.length - 1 - k]!, 1); return;
    case 'largest': {
      const f = frac!;
      eligible.sort((a, b) => (f[a]! > f[b]! ? -1 : f[a]! < f[b]! ? 1 : a - b));
      for (let k = 0; k < rem; k++) plus(eligible[k]!, 1);
      return;
    }
  }
  throw new RangeError(`Unknown remainder strategy "${String(mode)}"`);
}

/**
 * Splits `m` into parts proportional to `weights`. Exact: the parts always sum to `m`; no part
 * differs from its ideal share by a full minor unit or more (for the spreading strategies).
 * Negative amounts are allocated as the negation of the positive allocation.
 *
 *     allocate(money('100', 'EUR'), [1, 1, 1])        // 33.34, 33.33, 33.33
 *     allocate(money('0.05', 'EUR'), ['70', '30'])    // 0.04, 0.01
 */
export function allocate<C extends string>(m: Money<C>, weights: readonly Weight[], options?: AllocateOptions): Money<C>[] {
  const n = weights.length;
  if (n === 0) throw new RangeError('allocate() needs at least one weight');
  const mode = options?.remainder ?? 'largest';
  if (m.minor < 0) return allocate(negate(m), weights, options).map(negate);
  const x = m.minor;

  // fast path: small integer weights, products fit in a double exactly
  if (typeof x === 'number') {
    let total = 0, allInts = true, maxW = 0;
    for (let i = 0; i < n; i++) {
      const w = weights[i];
      if (typeof w !== 'number' || !Number.isSafeInteger(w) || w < 0) { allInts = false; break; }
      total += w;
      if (w > maxW) maxW = w;
    }
    if (allInts && total > 0 && total <= MAX && x * maxW <= MAX - total) {
      const shares: number[] = new Array(n);
      const frac: number[] = new Array(n);
      let assigned = 0;
      for (let i = 0; i < n; i++) {
        const p = x * (weights[i] as number);
        const q = Math.floor(p / total);
        let r = p - q * total;
        let s = q;
        if (r < 0) { s -= 1; r += total; } else if (r >= total) { s += 1; r -= total; } // float-quotient fix-up
        shares[i] = s;
        frac[i] = r;
        assigned += s;
      }
      distribute(shares, x - assigned, weights as number[], frac, mode, 1);
      const out: Money<C>[] = new Array(n);
      for (let i = 0; i < n; i++) out[i] = fromMinor(shares[i]!, m.currency, m.scale);
      return out;
    }
  }

  const ws = weightsToBig(weights);
  let total = 0n;
  for (const w of ws) total += w;
  if (total === 0n) throw new RangeError('Allocation weights must not all be zero');
  const xb = BigInt(x);
  const shares: bigint[] = new Array(n);
  const frac: bigint[] = new Array(n);
  let assigned = 0n;
  for (let i = 0; i < n; i++) {
    const p = xb * ws[i]!;
    shares[i] = p / total;
    frac[i] = p % total;
    assigned += shares[i]!;
  }
  distribute(shares, Number(xb - assigned), ws, frac, mode, 1n);
  return shares.map((s) => make(m.currency, s, m.scale));
}

/** Splits into `count` equal parts; the remainder goes per `remainder` (default 'first'). */
export function split<C extends string>(m: Money<C>, count: number, options?: AllocateOptions): Money<C>[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError(`Invalid count ${count}`);
  const weights = new Array<number>(count).fill(1);
  return allocate(m, weights, { remainder: options?.remainder ?? 'first' });
}

export interface InstalmentOptions<C extends string> {
  /** Where the remainder goes: default 'toFirst' (first instalment absorbs it). */
  readonly remainder?: Exclude<Remainder, 'largest'>;
  /** Make every regular instalment a multiple of this (e.g. money('1', 'EUR') for whole euros). */
  readonly unit?: Money<C>;
}

/**
 * Instalment plan: `count` equal payments, one of which absorbs the remainder.
 *
 *     instalments(money('100', 'EUR'), 3)                                   // 33.34, 33.33, 33.33
 *     instalments(money('100', 'EUR'), 3, { remainder: 'toLast' })          // 33.33, 33.33, 33.34
 *     instalments(money('100', 'EUR'), 3, { unit: money('1', 'EUR') })      // 34.00, 33.00, 33.00
 */
export function instalments<C extends string>(total: Money<C>, count: number, options?: InstalmentOptions<NoInfer<C>>): Money<C>[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError(`Invalid count ${count}`);
  const mode = options?.remainder ?? 'toFirst';
  const unit = options?.unit;
  if (!unit) return allocate(total, new Array<number>(count).fill(1), { remainder: mode });
  if (unit.currency !== total.currency) throw new CurrencyMismatchError(total.currency, unit.currency);
  if (!(unit.minor > 0)) throw new RangeError('unit must be positive');
  const s = Math.max(total.scale, unit.scale);
  const t = toScale(total, s), u = BigInt(scaleUp(unit.minor, s - unit.scale));
  const neg = t.minor < 0;
  const tv = BigInt(t.minor) * (neg ? -1n : 1n);
  const per = tv / (u * BigInt(count)) * u;
  const parts = new Array<bigint>(count).fill(per);
  let left = tv - per * BigInt(count);
  // spread whole units first (for 'first'/'last'), then the sub-unit leftover
  if (mode === 'first' || mode === 'last') {
    for (let k = 0; left >= u; k++, left -= u) parts[mode === 'first' ? k : count - 1 - k]! += u;
  }
  parts[mode === 'toLast' || mode === 'last' ? count - 1 : 0]! += left;
  return parts.map((p) => make(total.currency, neg ? -p : p, s));
}

export type Tranche<C extends string> =
  | { readonly amount: Money<C> }
  | { readonly percent: Weight; readonly cap?: Money<C> }
  | { readonly rest: true };

/**
 * A payment schedule mixing fixed amounts, percentages of the total (optionally capped) and one
 * `rest` tranche that receives whatever is left. Percent tranches are computed together with
 * largest-remainder allocation, so no rounding mode is needed and the schedule is exact.
 * Throws if the tranches cannot add up to exactly `total`.
 *
 *     schedule(money('1000', 'EUR'), [{ percent: 30 }, { amount: money('200', 'EUR') }, { rest: true }])
 *     // 300.00, 200.00, 500.00
 */
export function schedule<C extends string>(total: Money<C>, tranches: readonly Tranche<NoInfer<C>>[]): Money<C>[] {
  const pctIdx: number[] = [];
  const pcts: Weight[] = [];
  let restIdx = -1;
  tranches.forEach((t, i) => {
    if ('percent' in t) { pctIdx.push(i); pcts.push(t.percent); }
    else if ('rest' in t) {
      if (restIdx >= 0) throw new RangeError('schedule() allows only one rest tranche');
      restIdx = i;
    }
  });
  const out: (Money<C> | undefined)[] = new Array(tranches.length);
  let left = total;
  if (pcts.length) {
    const { ws, scale } = weightsScaled(pcts);
    let sum = 0n;
    for (const w of ws) sum += w;
    const hundred = 100n * pow10n(scale);
    if (sum > hundred) throw new RangeError('schedule() percentages exceed 100');
    const parts = allocate(total, [...ws, hundred - sum].map((w) => toSafe(w)));
    pctIdx.forEach((ti, k) => {
      let p = parts[k]!;
      const cap = (tranches[ti] as { cap?: Money<C> }).cap;
      if (cap && compare(p, cap) > 0) p = cap;
      out[ti] = p;
      left = subtract(left, p);
    });
  }
  tranches.forEach((t, i) => {
    if ('amount' in t) { out[i] = t.amount; left = subtract(left, t.amount); }
  });
  if (left.minor < 0) throw new RangeError(`schedule() tranches exceed the total by ${negate(left)}`);
  if (restIdx >= 0) out[restIdx] = left;
  else if (left.minor != 0) throw new RangeError(`schedule() leaves ${left} unassigned; add { rest: true }`);
  return out as Money<C>[];
}

/** Splits into tranches of at most `max` each: chunk(EUR 1000, EUR 300) -> 300, 300, 300, 100. */
export function chunk<C extends string>(total: Money<C>, max: Money<NoInfer<C>>): Money<C>[] {
  if (!(max.minor > 0)) throw new RangeError('chunk() max must be positive');
  if (total.minor < 0) throw new RangeError('chunk() total must not be negative');
  const out: Money<C>[] = [];
  let left = total;
  while (compare(left, max) > 0) { out.push(max as Money<C>); left = subtract(left, max); }
  if (left.minor > 0 || out.length === 0) out.push(left);
  return out;
}

