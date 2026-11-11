// Aggregates, ratios and integral division between amounts: average, ratioOf, divideToIntegral,
// remainder and trimScale, and exact arithmetic on Ratio values (ratioAdd, ratioCompare...).
// Everything is exact; only `average` rounds, once, after an exact sum.
import { currencyExponent } from './currency.js';
import { checkScale, ratio, type Factor, type Ratio } from './decimal.js';
import {
  CurrencyMismatchError,
  divide,
  isMoney,
  make,
  scaleUp,
  sum,
  type Money,
  type MoneyOperand,
  type RoundingInput,
  type SingleCurrency,
} from './money.js';
import { DEFAULT_ROUNDING } from './rounding.js';

const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

/**
 * The average of a list of amounts in one currency (any scales): the exact sum divided by the
 * count, rounded once at the sum's scale (the largest scale in the list). Rounding defaults to
 * 'halfExpand'; a rounding policy rounds to its own scale and increment. An empty list throws a
 * RangeError, since it has no average.
 *
 *     average([money('10', 'EUR'), money('10', 'EUR'), money('10.01', 'EUR')]) // 10.00 EUR
 */
export function average<C extends string>(
  amounts: readonly Money<C>[] & SingleCurrency<C>,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  if (amounts.length === 0) {
    throw new RangeError('average() of an empty list');
  }
  // sum is exact at the largest scale, so the division is the only rounding
  return divide(sum(amounts), amounts.length, rounding);
}

function assertSameCurrency(money: Money, other: Money): void {
  if (!isMoney(other)) {
    throw new TypeError(`Expected Money, got ${typeof other}`);
  }
  if (money.currency !== other.currency) {
    throw new CurrencyMismatchError(money.currency, other.currency);
  }
}

/** Both amounts' minor units at their common (larger) scale, as bigints. */
function alignedBigInts(money: Money, other: Money): { left: bigint; right: bigint } {
  const scale = Math.max(money.scale, other.scale);
  return {
    left: BigInt(scaleUp(money.minor, scale - money.scale)),
    right: BigInt(scaleUp(other.minor, scale - other.scale)),
  };
}

function assertNonZero(divisor: Money): void {
  if (divisor.minor == 0) {
    throw new RangeError('Division by zero');
  }
}

/**
 * The exact ratio `money / other` between two amounts in the same currency (any scales), as a
 * reduced `Ratio`: "what share of the total is this". `ratioOf(money('1', 'EUR'), money('3',
 * 'EUR'))` is 1/3 exactly, and it can be passed straight to `multiply` or `allocate`. A zero
 * `other` throws a RangeError.
 */
export function ratioOf<C extends string, O extends string = C>(
  money: Money<C>,
  other: MoneyOperand<NoInfer<C>, O>,
): Ratio {
  assertSameCurrency(money, other);
  assertNonZero(other);
  const { left, right } = alignedBigInts(money, other);
  return ratio(left, right);
}

/**
 * How many whole times `divisor` fits into `money` (same currency, any scales): the quotient
 * truncated toward zero, so `money = divisor × divideToIntegral(money, divisor) + remainder(money,
 * divisor)` exactly. A number while it is a safe integer, a bigint beyond, like `minor`. A zero
 * divisor throws a RangeError.
 */
export function divideToIntegral<C extends string, O extends string = C>(
  money: Money<C>,
  divisor: MoneyOperand<NoInfer<C>, O>,
): number | bigint {
  assertSameCurrency(money, divisor);
  assertNonZero(divisor);
  const dividendMinor = money.minor;
  const divisorMinor = divisor.minor;

  if (
    typeof dividendMinor === 'number' &&
    typeof divisorMinor === 'number' &&
    money.scale === divisor.scale
  ) {
    // % is exact on safe integers, so taking the remainder out first leaves an exact multiple of
    // the divisor, and dividing an exact multiple gives the exact integer quotient (no float
    // rounding near an integer boundary). `+ 0` turns -0 into 0.
    return (dividendMinor - (dividendMinor % divisorMinor)) / divisorMinor + 0;
  }

  // bigint division truncates toward zero, like the fast path
  const { left, right } = alignedBigInts(money, divisor);
  const quotient = left / right;
  if (quotient <= MAX_SAFE_MINOR && quotient >= -MAX_SAFE_MINOR) {
    return Number(quotient);
  }
  return quotient;
}

/**
 * What is left of `money` after taking out `divisor` a whole number of times (same currency, any
 * scales; the result has the larger scale): the remainder of truncating division, so it has
 * `money`'s sign, as JavaScript's `%` does. `remainder(money('10', 'EUR'), money('3', 'EUR'))` is
 * 1.00 EUR and `remainder(money('-10', 'EUR'), money('3', 'EUR'))` is -1.00 EUR. A zero divisor
 * throws a RangeError.
 */
export function remainder<C extends string, O extends string = C>(
  money: Money<C>,
  divisor: MoneyOperand<NoInfer<C>, O>,
): Money<C> {
  assertSameCurrency(money, divisor);
  assertNonZero(divisor);
  const dividendMinor = money.minor;
  const divisorMinor = divisor.minor;

  if (
    typeof dividendMinor === 'number' &&
    typeof divisorMinor === 'number' &&
    money.scale === divisor.scale
  ) {
    // % on safe integers is exact and keeps the dividend's sign; `+ 0` turns -0 into 0
    return make(money.currency, (dividendMinor % divisorMinor) + 0, money.scale);
  }

  const { left, right } = alignedBigInts(money, divisor);
  return make(money.currency, left % right, Math.max(money.scale, divisor.scale));
}

/**
 * The same amount at the smallest scale that keeps it exact, but not below `minimumScale` (default:
 * the currency's ISO exponent): `1.2300 EUR` at scale 4 becomes `1.23 EUR`, and `1.2345 EUR` stays
 * as it is. Pass `minimumScale` 0 to trim whole amounts to integers. An amount whose scale is
 * already at or below the minimum is returned unchanged; trimming never adds digits.
 */
export function trimScale<C extends string>(money: Money<C>, minimumScale?: number): Money<C> {
  const minimum = minimumScale ?? currencyExponent(money.currency);
  checkScale(minimum);

  let minor = money.minor;
  let scale = money.scale;
  if (scale <= minimum) {
    return money;
  }

  if (typeof minor === 'number') {
    // dividing a multiple of 10 by 10 is exact for a safe integer
    while (scale > minimum && minor % 10 === 0) {
      minor /= 10;
      scale--;
    }
    return scale === money.scale ? money : make(money.currency, minor + 0, scale);
  }

  while (scale > minimum && minor % 10n === 0n) {
    minor /= 10n;
    scale--;
  }
  return scale === money.scale ? money : make(money.currency, minor, scale);
}

// ---------------------------------------------------------------------------------------------
// Arithmetic on Ratio values: exact and reduced. Each side is any Factor (a Ratio, a Fixed, a
// decimal or 'a/b' string, a number or a bigint), read exactly as `ratio()` reads it.
// ---------------------------------------------------------------------------------------------

/** left + right, exactly: `ratioAdd('0.19', ratio(1, 3))` is 157/300. */
export function ratioAdd(left: Factor, right: Factor): Ratio {
  const leftRatio = ratio(left);
  const rightRatio = ratio(right);
  return ratio(
    leftRatio.num * rightRatio.den + rightRatio.num * leftRatio.den,
    leftRatio.den * rightRatio.den,
  );
}

/** left − right, exactly. */
export function ratioSubtract(left: Factor, right: Factor): Ratio {
  const leftRatio = ratio(left);
  const rightRatio = ratio(right);
  return ratio(
    leftRatio.num * rightRatio.den - rightRatio.num * leftRatio.den,
    leftRatio.den * rightRatio.den,
  );
}

/** left × right, exactly. */
export function ratioMultiply(left: Factor, right: Factor): Ratio {
  const leftRatio = ratio(left);
  const rightRatio = ratio(right);
  return ratio(leftRatio.num * rightRatio.num, leftRatio.den * rightRatio.den);
}

/** left ÷ right, exactly; a zero `right` throws a RangeError. */
export function ratioDivide(left: Factor, right: Factor): Ratio {
  const leftRatio = ratio(left);
  const rightRatio = ratio(right);
  return ratio(leftRatio.num * rightRatio.den, leftRatio.den * rightRatio.num);
}

/** −value. */
export function ratioNegate(value: Factor): Ratio {
  const valueRatio = ratio(value);
  return ratio(-valueRatio.num, valueRatio.den);
}

/** 1 − value: the complement of a share or rate, e.g. `ratioComplement(ratioOf(paid, total))`. */
export function ratioComplement(value: Factor): Ratio {
  const valueRatio = ratio(value);
  return ratio(valueRatio.den - valueRatio.num, valueRatio.den);
}

/** −1, 0 or 1 as left is less than, equal to or greater than right. */
export function ratioCompare(left: Factor, right: Factor): -1 | 0 | 1 {
  const leftRatio = ratio(left);
  const rightRatio = ratio(right);
  // Both denominators are positive, so cross-multiplying keeps the order.
  const difference = leftRatio.num * rightRatio.den - rightRatio.num * leftRatio.den;
  if (difference < 0n) {
    return -1;
  }
  return difference > 0n ? 1 : 0;
}
