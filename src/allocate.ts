import { parseDecimal, pow10n, normalizeMinor } from './decimal.js';
import {
  CurrencyMismatchError,
  compare,
  make,
  negate,
  scaleUp,
  subtract,
  toScale,
  type Money,
} from './money.js';

const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

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
  const parsed = ws.map((weight) => {
    if (typeof weight === 'bigint') {
      return { digits: weight, scale: 0 };
    }
    if (typeof weight === 'number' && Number.isSafeInteger(weight)) {
      return { digits: BigInt(weight), scale: 0 };
    }
    const item = parseDecimal(String(weight));
    return item;
  });
  for (const item of parsed) {
    if (item.digits < 0n) {
      throw new RangeError('Allocation weights must not be negative');
    }
    if (item.scale > scale) {
      scale = item.scale;
    }
  }
  return { ws: parsed.map((item) => item.digits * pow10n(scale - item.scale)), scale };
}

/**
 * Distributes `rem` extra units among the buckets; `frac` are the per-bucket remainders (for
 * 'largest').
 */
function distribute<T extends number | bigint>(
  shares: T[],
  rem: number,
  weights: readonly (number | bigint)[],
  frac: readonly (number | bigint)[] | null,
  mode: Remainder,
  one: T,
): void {
  if (rem === 0) {
    return;
  }
  const count = shares.length;
  const eligible: number[] = [];
  for (let i = 0; i < count; i++) {
    if (weights[i]! > 0) {
      eligible.push(i);
    }
  }
  const plus = (i: number, k: number) => {
    shares[i] = (
      typeof one === 'number' ? (shares[i] as number) + k : (shares[i] as bigint) + BigInt(k)
    ) as T;
  };
  switch (mode) {
    case 'toFirst':
      return plus(eligible[0]!, rem);
    case 'toLast':
      return plus(eligible[eligible.length - 1]!, rem);
    case 'first':
      for (let k = 0; k < rem; k++) {
        plus(eligible[k]!, 1);
      }
      return;
    case 'last':
      for (let k = 0; k < rem; k++) {
        plus(eligible[eligible.length - 1 - k]!, 1);
      }
      return;
    case 'largest': {
      const remainders = frac!;
      // Largest remainder first; equal remainders keep bucket order.
      eligible.sort((left, right) => {
        if (remainders[left]! !== remainders[right]!) {
          return remainders[left]! > remainders[right]! ? -1 : 1;
        }
        return left - right;
      });
      for (let k = 0; k < rem; k++) {
        plus(eligible[k]!, 1);
      }
      return;
    }
  }
  throw new RangeError(`Unknown remainder strategy "${String(mode)}"`);
}

/**
 * Splits `m` into parts proportional to `weights`. Exact: the parts always sum to `m`, and zero
 * weights get zero. With 'largest' each part is less than one minor unit from its exact share; with
 * 'first' and 'last', at most one unit. Negative amounts are allocated as the negation of the
 * positive allocation. These properties are proved for a Lean model of this function
 * (proofs/Ducat/Allocate.lean), and test/allocate.oracle.test.ts checks this code against that
 * model.
 *
 *     allocate(money('100', 'EUR'), [1, 1, 1])        // 33.34, 33.33, 33.33
 *     allocate(money('0.05', 'EUR'), ['70', '30'])    // 0.04, 0.01
 */
export function allocate<C extends string>(
  money: Money<C>,
  weights: readonly Weight[],
  options?: AllocateOptions,
): Money<C>[] {
  const count = weights.length;
  if (count === 0) {
    throw new RangeError('allocate() needs at least one weight');
  }
  const mode = options?.remainder ?? 'largest';
  if (money.minor < 0) {
    return allocate(negate(money), weights, options).map(negate);
  }
  const minor = money.minor;

  // fast path: integer weights whose products with the amount fit exactly in a double
  if (typeof minor === 'number') {
    let total = 0;
    let maxWeight = 0;
    let ok = true;
    for (let i = 0; i < count; i++) {
      const weight = weights[i];
      if (typeof weight !== 'number' || !(weight >= 0) || !Number.isSafeInteger(weight)) {
        ok = false;
        break;
      }
      total += weight;
      if (weight > maxWeight) {
        maxWeight = weight;
      }
    }
    if (ok && total > 0 && total <= MAX_SAFE_MINOR && minor * maxWeight <= MAX_SAFE_MINOR - total) {
      const ws = weights as readonly number[];
      const shares = new Array<number>(count);
      const frac = new Array<number>(count);
      let rem = minor;
      for (let i = 0; i < count; i++) {
        const product = minor * ws[i]!;
        let quotient = Math.floor(product / total);
        let remainder = product - quotient * total;
        if (remainder < 0) {
          quotient -= 1;
          remainder += total;
        } else if (remainder >= total) {
          quotient += 1;
          remainder -= total;
        } // float-quotient fix-up
        shares[i] = quotient;
        frac[i] = remainder;
        rem -= quotient;
      }
      if (rem > 0) {
        if (mode === 'largest' && count <= 32) {
          // selection instead of sort: rem < number of non-zero weights, n small
          for (; rem > 0; rem--) {
            let best = -1;
            for (let i = 0; i < count; i++) {
              if (ws[i]! > 0 && frac[i]! >= 0 && (best < 0 || frac[i]! > frac[best]!)) {
                best = i;
              }
            }
            shares[best]! += 1;
            frac[best] = -1;
          }
        } else {
          distribute(shares, rem, ws, frac, mode, 1);
        }
      }
      const out = new Array<Money<C>>(count);
      for (let i = 0; i < count; i++) {
        out[i] = make(money.currency, shares[i]!, money.scale);
      }
      return out;
    }
  }

  const ws = weightsToBig(weights);
  let total = 0n;
  for (const weight of ws) {
    total += weight;
  }
  if (total === 0n) {
    throw new RangeError('Allocation weights must not all be zero');
  }
  const xb = BigInt(minor);
  const shares: bigint[] = new Array(count);
  const frac: bigint[] = new Array(count);
  let assigned = 0n;
  for (let i = 0; i < count; i++) {
    const product = xb * ws[i]!;
    shares[i] = product / total;
    frac[i] = product % total;
    assigned += shares[i]!;
  }
  distribute(shares, Number(xb - assigned), ws, frac, mode, 1n);
  return shares.map((share) => make(money.currency, share, money.scale));
}

/** Splits into `count` equal parts; the remainder goes per `remainder` (default 'first'). */
export function split<C extends string>(
  money: Money<C>,
  count: number,
  options?: AllocateOptions,
): Money<C>[] {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError(`Invalid count ${count}`);
  }
  const weights = new Array<number>(count).fill(1);
  return allocate(money, weights, { remainder: options?.remainder ?? 'first' });
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
export function instalments<C extends string>(
  total: Money<C>,
  count: number,
  options?: InstalmentOptions<NoInfer<C>>,
): Money<C>[] {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError(`Invalid count ${count}`);
  }
  const mode = options?.remainder ?? 'toFirst';
  const unit = options?.unit;
  if (!unit) {
    return allocate(total, new Array<number>(count).fill(1), { remainder: mode });
  }
  if (unit.currency !== total.currency) {
    throw new CurrencyMismatchError(total.currency, unit.currency);
  }
  if (!(unit.minor > 0)) {
    throw new RangeError('unit must be positive');
  }
  const scale = Math.max(total.scale, unit.scale);
  const scaledTotal = toScale(total, scale);
  const unitMinor = BigInt(scaleUp(unit.minor, scale - unit.scale));
  const neg = scaledTotal.minor < 0;
  const tv = BigInt(scaledTotal.minor) * (neg ? -1n : 1n);
  const per = (tv / (unitMinor * BigInt(count))) * unitMinor;
  const parts = new Array<bigint>(count).fill(per);
  let left = tv - per * BigInt(count);
  // spread whole units first (for 'first'/'last'), then the sub-unit leftover
  if (mode === 'first' || mode === 'last') {
    for (let k = 0; left >= unitMinor; k++, left -= unitMinor) {
      parts[mode === 'first' ? k : count - 1 - k]! += unitMinor;
    }
  }
  parts[mode === 'toLast' || mode === 'last' ? count - 1 : 0]! += left;
  return parts.map((part) => make(total.currency, neg ? -part : part, scale));
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
export function schedule<C extends string>(
  total: Money<C>,
  tranches: readonly Tranche<NoInfer<C>>[],
): Money<C>[] {
  const pctIdx: number[] = [];
  const pcts: Weight[] = [];
  let restIdx = -1;
  tranches.forEach((tranche, i) => {
    if ('percent' in tranche) {
      pctIdx.push(i);
      pcts.push(tranche.percent);
    } else if ('rest' in tranche) {
      if (restIdx >= 0) {
        throw new RangeError('schedule() allows only one rest tranche');
      }
      restIdx = i;
    }
  });
  const out: (Money<C> | undefined)[] = new Array(tranches.length);
  let left = total;
  if (pcts.length) {
    const { ws, scale } = weightsScaled(pcts);
    let sum = 0n;
    for (const weight of ws) {
      sum += weight;
    }
    const hundred = 100n * pow10n(scale);
    if (sum > hundred) {
      throw new RangeError('schedule() percentages exceed 100');
    }
    const parts = allocate(
      total,
      [...ws, hundred - sum].map((weight) => normalizeMinor(weight)),
    );
    pctIdx.forEach((trancheIndex, k) => {
      let part = parts[k]!;
      const cap = (tranches[trancheIndex] as { cap?: Money<C> }).cap;
      if (cap && compare(part, cap) > 0) {
        part = cap;
      }
      out[trancheIndex] = part;
      left = subtract(left, part);
    });
  }
  tranches.forEach((tranche, i) => {
    if ('amount' in tranche) {
      out[i] = tranche.amount;
      left = subtract(left, tranche.amount);
    }
  });
  if (left.minor < 0) {
    throw new RangeError(`schedule() tranches exceed the total by ${negate(left)}`);
  }
  if (restIdx >= 0) {
    out[restIdx] = left;
  } else if (left.minor != 0) {
    throw new RangeError(`schedule() leaves ${left} unassigned; add { rest: true }`);
  }
  return out as Money<C>[];
}

/** Splits into tranches of at most `max` each: chunk(EUR 1000, EUR 300) -> 300, 300, 300, 100. */
export function chunk<C extends string>(total: Money<C>, max: Money<NoInfer<C>>): Money<C>[] {
  if (!(max.minor > 0)) {
    throw new RangeError('chunk() max must be positive');
  }
  if (total.minor < 0) {
    throw new RangeError('chunk() total must not be negative');
  }
  const out: Money<C>[] = [];
  let left = total;
  while (compare(left, max) > 0) {
    out.push(max as Money<C>);
    left = subtract(left, max);
  }
  if (left.minor > 0 || out.length === 0) {
    out.push(left);
  }
  return out;
}
