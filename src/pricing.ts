/**
 * `@ducatjs/money/pricing`: retail price endings ("charm pricing") and, from `tiers.ts`, tiered
 * and volume pricing. A rule such as "end in .99, rounding up" is a plain value passed explicitly,
 * like a rounding policy, and every result is exact.
 */
import { formatScaled, MAX_DECIMAL_SCALE, parseDecimal, pow10n } from './decimal.js';
import { make, type Money } from './money.js';
import { divideAndRound, divideAndRoundBigint, Rounding, type RoundingMode } from './rounding.js';

const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;
const MODES = /* @__PURE__ */ new Set<unknown>(/* @__PURE__ */ Object.values(Rounding));

/** Options for `priceEnding`. */
export interface PriceEndingOptions {
  /**
   * What prices end in, in major units, as a decimal string or an integer: `'0.99'` for 23.99,
   * `'9.90'` (with `step: 10`) for 29.90, `0` (with `step: 5`) for whole multiples of 5. It must be
   * at least 0 and less than `step`.
   */
  readonly ending: string | number;
  /**
   * The distance between two allowed prices, in major units (default 1): `'0.99'` with step 1 allows
   * 22.99, 23.99, 24.99, ...; with step `'0.5'`, `'0.49'` allows 23.49, 23.99, 24.49, ...
   */
  readonly step?: string | number;
  /**
   * Which allowed price to pick: 'ceil' (default) the nearest one at or above the price, 'floor'
   * the nearest at or below, 'halfCeil' the nearest (ties go up), or any other rounding mode, applied
   * to the count of steps. 'unnecessary' throws unless the price already has the ending.
   */
  readonly rounding?: RoundingMode;
}

/**
 * A price-ending rule, built by `priceEnding()`. It is a function from an amount to the amount
 * with the ending, so `price.with(rule)` and `prices.map(rule)` work.
 */
export interface PriceEnding {
  /** `money` moved to the rule's ending, at `money`'s scale. */
  <C extends string>(money: Money<C>): Money<C>;
  /** The ending, as an exact decimal string in major units. */
  readonly ending: string;
  /** The step between allowed prices, as an exact decimal string in major units. */
  readonly step: string;
  /** How the allowed price is picked. */
  readonly rounding: RoundingMode;
}

/** A decimal in major units: `digits` × 10^-scale. */
interface Decimal {
  readonly digits: bigint;
  readonly scale: number;
}

function readDecimal(name: string, value: string | number): Decimal {
  if (typeof value === 'number') {
    // integers only: a non-integer number would be read through its float form
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Invalid ${name} ${value}; pass a decimal string such as '0.99'`);
    }
    return { digits: BigInt(value), scale: 0 };
  }
  if (typeof value !== 'string') {
    throw new TypeError(`Invalid ${name} ${String(value)}`);
  }
  return parseDecimal(value);
}

/** The decimal in 10^-scale units, or undefined if it has more decimals than `scale`. */
function unitsAt(value: Decimal, scale: number): bigint | undefined {
  if (value.scale <= scale) {
    return value.digits * pow10n(scale - value.scale);
  }
  const divisor = pow10n(value.scale - scale);
  return value.digits % divisor === 0n ? value.digits / divisor : undefined;
}

function decimalString(value: Decimal): string {
  return formatScaled(value.digits, value.scale);
}

/**
 * Builds a price-ending rule: the allowed prices are `ending + k × step` for every integer k, and
 * the rule moves an amount to one of them, chosen by `rounding` (default 'ceil', the next allowed
 * price at or above). The options are checked here, once.
 *
 *     const charm = priceEnding({ ending: '0.99' })
 *     money('23.41', 'EUR').with(charm)                         // 23.99 EUR
 *     priceEnding({ ending: '9.90', step: 10 })                 // 19.90, 29.90, ...
 *     priceEnding({ ending: 0, step: 5, rounding: 'halfCeil' }) // the nearest 5
 *
 * The result keeps the amount's scale. An ending or step with more decimals than the amount (0.99
 * for a whole-yen price) throws a RangeError when the rule is applied.
 */
export function priceEnding(options: PriceEndingOptions): PriceEnding {
  const ending = readDecimal('ending', options.ending);
  const step = readDecimal('step', options.step ?? 1);
  const rounding = options.rounding ?? 'ceil';

  if (step.digits <= 0n) {
    throw new RangeError(`Invalid step ${decimalString(step)}; it must be positive`);
  }
  // compare at a common scale: 0 <= ending < step
  const commonScale = Math.max(ending.scale, step.scale);
  const endingUnits = unitsAt(ending, commonScale)!;
  const stepUnits = unitsAt(step, commonScale)!;
  if (endingUnits < 0n || endingUnits >= stepUnits) {
    throw new RangeError(
      `Invalid ending ${decimalString(ending)}; it must be at least 0 and less than the step ${decimalString(step)}`,
    );
  }
  if (!MODES.has(rounding)) {
    throw new RangeError(`Invalid rounding mode ${String(rounding)}`);
  }

  const apply = <C extends string>(money: Money<C>): Money<C> => {
    const scale = money.scale;
    const offset = unitsAt(ending, scale);
    const stride = unitsAt(step, scale);
    if (offset === undefined || stride === undefined || scale > MAX_DECIMAL_SCALE) {
      throw new RangeError(
        `A price ending ${decimalString(ending)} in steps of ${decimalString(step)} needs more than ${scale} decimal places for ${money.currency}`,
      );
    }

    // The count of whole steps above the ending, rounded once, then back to an amount:
    // ending + round((money - ending) / step) × step.
    const minor = money.minor;
    if (typeof minor === 'number') {
      const offsetNumber = Number(offset);
      const strideNumber = Number(stride);
      const distance = minor - offsetNumber;
      // With |distance| + stride within the safe range, |steps × stride| is at most that sum, so
      // the product is exact; the sum with the offset is then checked like any other addition (a
      // float sum beyond the safe range never rounds back into it).
      if (distance + strideNumber <= MAX_SAFE_MINOR && distance - strideNumber >= -MAX_SAFE_MINOR) {
        const steps = divideAndRound(distance, strideNumber, rounding);
        const result = offsetNumber + steps * strideNumber;
        if (result <= MAX_SAFE_MINOR && result >= -MAX_SAFE_MINOR) {
          return make(money.currency, result + 0, scale);
        }
      }
    }
    const steps = divideAndRoundBigint(BigInt(minor) - offset, stride, rounding);
    return make(money.currency, offset + steps * stride, scale);
  };

  return Object.assign(apply, {
    ending: decimalString(ending),
    step: decimalString(step),
    rounding,
  }) as PriceEnding;
}

export * from './tiers.js';
