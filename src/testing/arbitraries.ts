/**
 * `@ducatjs/money/testing/arbitraries`: fast-check arbitraries for property tests. They cover what
 * hand-written cases tend to miss: amounts beyond 2^53 (bigint minor units), currencies with
 * unusual exponents (JPY 0, KWD 3, CLF 4) and scales above the currency's exponent. fast-check is
 * an optional peer dependency, needed only for this entry.
 */
import fc from 'fast-check';
import { currencyExponent, ISO_EXPONENTS } from '../currency.js';
import { MAX_DECIMAL_SCALE } from '../decimal.js';
import { fromMinor, money, type Money } from '../money.js';

/** A mix of exponents: the common two-decimal currencies and every unusual one. */
const DEFAULT_CURRENCIES = ['EUR', 'USD', 'GBP', 'JPY', 'KRW', 'KWD', 'BHD', 'TND', 'CLF'];

/** Options for `arbCurrency`. */
export interface ArbCurrencyOptions {
  /** Only currencies with one of these exponents (default: the representative mix). */
  readonly exponents?: readonly number[];
  /** Draw from every ISO 4217 code instead of the representative mix. */
  readonly all?: boolean;
  /** More codes to draw from, such as ones registered with `defineCurrency`. */
  readonly extra?: readonly string[];
}

/**
 * Currency codes, by default a representative mix of exponents 0, 2, 3 and 4 (JPY, EUR, KWD,
 * CLF...). `{ all: true }` draws from every ISO 4217 code, `extra` adds codes (custom ones from
 * `defineCurrency`), and `exponents` narrows whichever pool that is.
 */
export function arbCurrency(options: ArbCurrencyOptions = {}): fc.Arbitrary<string> {
  const base = options.all === true ? Object.keys(ISO_EXPONENTS) : DEFAULT_CURRENCIES;
  const pool = [...base, ...(options.extra ?? [])];
  const exponents = options.exponents;
  const codes =
    exponents === undefined
      ? pool
      : pool.filter((code) => exponents.includes(currencyExponent(code)));
  if (codes.length === 0) {
    throw new RangeError('No currency has the requested exponents');
  }
  return fc.constantFrom(...codes);
}

/** Options for `arbMoney`. */
export interface ArbMoneyOptions<C extends string = string> {
  /** The currency, or an arbitrary of currencies (default: `arbCurrency()`). */
  readonly currency?: C | fc.Arbitrary<C>;
  /** The smallest amount, in major units (default: none, down to -10^30 minor units). */
  readonly min?: string | number | bigint;
  /** The largest amount, in major units (default: none, up to 10^30 minor units). */
  readonly max?: string | number | bigint;
  /**
   * The scale, or an arbitrary of scales. By default mostly the currency's exponent, sometimes up
   * to three more decimals.
   */
  readonly scale?: number | fc.Arbitrary<number>;
}

const BIG = 10n ** 30n;
const SAFE = /* @__PURE__ */ BigInt(Number.MAX_SAFE_INTEGER);

/** Minor units weighted toward the interesting places: small, near 2^53, and far beyond it. */
function arbMinor(min: bigint, max: bigint): fc.Arbitrary<bigint> {
  const clamp = (low: bigint, high: bigint) =>
    fc.bigInt({ min: low > min ? low : min, max: high < max ? high : max });
  const parts: fc.Arbitrary<bigint>[] = [];
  if (min <= 10_000n && max >= -10_000n) {
    parts.push(clamp(-10_000n, 10_000n));
  }
  if (min <= SAFE && max >= -SAFE) {
    parts.push(clamp(-SAFE, SAFE));
  }
  // within 1000 of ±2^53, where number and bigint meet
  for (const edge of [SAFE, -SAFE]) {
    if (min <= edge + 1000n && max >= edge - 1000n) {
      parts.push(clamp(edge - 1000n, edge + 1000n));
    }
  }
  parts.push(fc.bigInt({ min, max }));
  return fc.oneof(...parts);
}

/**
 * Money values for property tests: `arbMoney()`, `arbMoney({ currency: 'EUR', min: '0', max:
 * '100' })`. With bounds, every value is within them; without, minor units reach ±10^30.
 */
export function arbMoney<C extends string = string>(
  options: ArbMoneyOptions<C> = {},
): fc.Arbitrary<Money<C>> {
  const given = options.currency;
  let currencies: fc.Arbitrary<C>;
  if (given === undefined) {
    currencies = arbCurrency() as fc.Arbitrary<C>;
  } else if (typeof given === 'string') {
    currencies = fc.constant(given);
  } else {
    currencies = given;
  }

  return currencies.chain((currency) => {
    const exponent = currencyExponent(currency);
    const scaleOption = options.scale;
    let scales: fc.Arbitrary<number>;
    if (typeof scaleOption === 'number') {
      scales = fc.constant(scaleOption);
    } else if (scaleOption === undefined) {
      scales = fc.oneof(
        { weight: 3, arbitrary: fc.constant(exponent) },
        { weight: 1, arbitrary: fc.integer({ min: exponent + 1, max: exponent + 3 }) },
      );
    } else {
      scales = scaleOption;
    }

    return scales.chain((scale) => {
      if (!(Number.isInteger(scale) && scale >= 0 && scale <= MAX_DECIMAL_SCALE)) {
        throw new RangeError(`Invalid scale ${scale}`);
      }
      // Bounds in minor units at this scale; a bound between two units rounds inward.
      const min =
        options.min === undefined
          ? -BIG
          : BigInt(money(options.min, currency, { scale, rounding: 'ceil' }).toScaledUnits());
      const max =
        options.max === undefined
          ? BIG
          : BigInt(money(options.max, currency, { scale, rounding: 'floor' }).toScaledUnits());
      if (min > max) {
        throw new RangeError(`No ${currency} amount at scale ${scale} between min and max`);
      }
      return arbMinor(min, max).map((minor) => fromMinor(minor, currency, scale));
    });
  });
}
