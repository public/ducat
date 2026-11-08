// Exchange rates as exact rationals with metadata. A Rate never loses digits: inverses,
// compositions and margins are exact products of ratios, and rounding happens once, when an amount
// is converted.
import { currencyExponent } from './currency.js';
import {
  formatScaled,
  POW10,
  pow10n,
  ratio,
  ratioToDecimal,
  normalizeMinor,
  type Factor,
  type Ratio,
} from './decimal.js';
import {
  CurrencyMismatchError,
  make,
  roundWithPolicy,
  type CurrencyInput,
  type Money,
  type RoundingInput,
  type RoundingPolicy,
} from './money.js';
import {
  DEFAULT_ROUNDING,
  divideAndRound,
  divideAndRoundBigint,
  type RoundingMode,
} from './rounding.js';

const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

/** How a rate was quoted. `inverse()` swaps 'bid' and 'ask'. */
export type RateType = 'mid' | 'bid' | 'ask' | (string & {});

/**
 * How a source published a rate, kept with the Rate for audit and display. The published direction
 * is `from` → `to`, or `to` → `from` when `inverted`.
 */
export interface RateQuote {
  /** The number exactly as published, trailing zeros included ('136.80'). */
  readonly rate: string;
  /**
   * How many units of the published direction's first currency the number is for: 100 for "NOK
   * per 100 JPY". Omitted for 1.
   */
  readonly per?: number;
  /** The source quoted `to` → `from`; this Rate is its exact inverse. */
  readonly inverted?: boolean;
}

/**
 * Where a rate came from. `asOf`, `availableAt` and `validUntil` are ISO-8601 dates ('2026-11-06')
 * or instants.
 */
export interface RateInfo {
  readonly source?: string;
  /** The date or time the rate applies to. */
  readonly asOf?: string | Date;
  /**
   * When the rate was published. A lookup for an earlier time doesn't get it, so a historical
   * lookup sees only what was known then. A date means from the start of that UTC day.
   */
  readonly availableAt?: string | Date;
  /** The last date or time the rate applies to. A date is valid all day (UTC). */
  readonly validUntil?: string | Date;
  readonly type?: RateType;
  /** The rate as the source published it. */
  readonly quote?: RateQuote;
}

/** Options for converting an amount. */
export interface ConvertOptions {
  /** Result scale (default: the target currency's exponent). */
  readonly scale?: number;
  /**
   * Throw RateExpiredError when the rate has a `validUntil` that has passed (by the system clock).
   * Off by default: ducat reads no clock unless asked to.
   */
  readonly strictValidity?: boolean;
}

/** Thrown by a strict-validity conversion with a rate past its `validUntil`. */
export class RateExpiredError extends RangeError {
  readonly validUntil: string;

  constructor(from: string, to: string, validUntil: string) {
    super(`Exchange rate ${from}→${to} expired at ${validUntil}`);
    this.name = 'RateExpiredError';
    this.validUntil = validUntil;
  }
}

/** The JSON form of a Rate: the exact decimal string, or "num/den" when it doesn't terminate. */
export interface RateJSON {
  from: string;
  to: string;
  rate: string;
  source?: string;
  asOf?: string;
  availableAt?: string;
  validUntil?: string;
  type?: string;
  /** Present only when it says more than `rate` does: a `per` or an inverted quote. */
  quote?: RateQuote;
  derivedFrom?: RateJSON[];
}

type MutableInfo = {
  source?: string;
  asOf?: string;
  availableAt?: string;
  validUntil?: string;
  type?: RateType;
  quote?: RateQuote;
};
/** RateInfo that may also hold explicit undefineds (as optional parameters do). */
type LooseInfo = { readonly [Key in keyof RateInfo]?: RateInfo[Key] | undefined };

const OPPOSITE_SIDE: Record<string, RateType> = { bid: 'ask', ask: 'bid' };

const ISO_DATE = /^\d{4}-\d\d-\d\d$/;

/**
 * @internal
 * A date stays as given ('2026-11-06'); an instant becomes UTC ISO ('2026-11-06T15:00:00.000Z'), so
 * that times with different offsets compare correctly as strings.
 */
export function toIsoString(time: string | Date): string {
  if (typeof time === 'string' && ISO_DATE.test(time)) {
    return time;
  }
  const date = time instanceof Date ? time : new Date(time);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid date or time ${String(time)}`);
  }
  return date.toISOString();
}

/** A date as the first instant of its UTC day; an instant as it is. */
function asInstant(time: string): string {
  return ISO_DATE.test(time) ? `${time}T00:00:00.000Z` : time;
}

/**
 * @internal
 * Whether `time` has come by `at`. A date `at` means the whole of that UTC day, so anything on or
 * before that day counts; a date `time` means the start of its day.
 */
export function hasStarted(time: string, at: string | Date): boolean {
  const instant = toIsoString(at);
  if (ISO_DATE.test(instant)) {
    return time.slice(0, 10) <= instant;
  }
  return asInstant(time) <= instant;
}

/** @internal Whether `validUntil` (a date: valid all day, UTC) has passed at `at`. */
export function hasEnded(validUntil: string, at: string | Date): boolean {
  const instant = asInstant(toIsoString(at));
  if (ISO_DATE.test(validUntil)) {
    return instant.slice(0, 10) > validUntil;
  }
  return instant > validUntil;
}

/**
 * The earlier of two ISO-8601 strings (one format compares lexicographically), or the later one
 * with `later`; undefined = no limit.
 */
function earlier(
  first: string | undefined,
  second: string | undefined,
  later?: boolean,
): string | undefined {
  if (first === undefined) {
    return second;
  }
  if (second === undefined) {
    return first;
  }
  if (later === true) {
    return first >= second ? first : second;
  }
  return first <= second ? first : second;
}

/**
 * minor × rate × 10^scaleShift, rounded once with `rounding`. This is the kernel of every
 * conversion: `scaleShift` is the result scale minus the input scale. Pure, and `rate.den > 0` by
 * construction.
 */
export function multiplyByRatioAtScale(
  minor: number | bigint,
  rate: Ratio,
  scaleShift: number,
  rounding: RoundingMode,
): number | bigint {
  // Fast path: all factors are safe integers, so a product that stays in the safe range is exact.
  // `rate.n === rate.n` is false only for NaN, which marks a numerator that isn't a safe integer.
  const rateIsSafe = rate.n === rate.n && rate.d === rate.d;
  if (typeof minor === 'number' && rateIsSafe && scaleShift >= -15 && scaleShift <= 15) {
    let numerator = rate.n;
    let denominator = rate.d;
    if (scaleShift > 0) {
      numerator *= POW10[scaleShift]!;
    } else if (scaleShift < 0) {
      denominator *= POW10[-scaleShift]!;
    }

    if (numerator <= MAX_SAFE_MINOR && denominator <= MAX_SAFE_MINOR) {
      const product = minor * numerator;
      if (product <= MAX_SAFE_MINOR && product >= -MAX_SAFE_MINOR) {
        return divideAndRound(product, denominator, rounding);
      }
    }
  }

  // Slow path: the same single division, in bigint.
  let numerator = BigInt(minor) * rate.num;
  let denominator = rate.den;
  if (scaleShift > 0) {
    numerator *= pow10n(scaleShift);
  } else if (scaleShift < 0) {
    denominator *= pow10n(-scaleShift);
  }
  return normalizeMinor(divideAndRoundBigint(numerator, denominator, rounding));
}

/**
 * An exact exchange rate: one unit of `from` is worth `ratio` units of `to`. Build it with
 * `exchangeRate()`. Derived rates (`inverse`, `andThen`, `withMargin`, `round`) keep their inputs
 * in `derivedFrom`, the audit chain. Their `asOf` is the oldest input's, so staleness can't hide,
 * and their `validUntil` is the earliest.
 */
export class Rate<From extends string = string, To extends string = string> {
  readonly from: From;
  readonly to: To;
  readonly ratio: Ratio;
  // The optional fields are `declare`d, so only the ones that are set exist on an instance: class
  // field semantics would otherwise define them all as undefined.
  declare readonly source?: string;
  declare readonly asOf?: string;
  declare readonly availableAt?: string;
  declare readonly validUntil?: string;
  declare readonly type?: RateType;
  declare readonly quote?: RateQuote;
  declare readonly derivedFrom?: readonly Rate[];

  /** @internal use exchangeRate() */
  constructor(from: From, to: To, rate: Ratio, info?: RateInfo, derivedFrom?: readonly Rate[]) {
    // Rebuilt so that a hand-made Ratio object is reduced, has a positive denominator, and has
    // number fields that match its bigints (the fast path relies on them).
    const normalized = ratio(rate.num, rate.den);
    if (normalized.num <= 0n) {
      throw new RangeError('Exchange rate must be positive');
    }
    this.from = from;
    this.to = to;
    this.ratio = normalized;

    // Only defined fields are assigned, so rates compare and serialise without undefined keys.
    const writable = this as { -readonly [Key in keyof Rate]?: unknown };
    const quote = info?.quote;
    if (quote !== undefined) {
      // toString prints a one-for-one quote, so it must be this rate. (rateFromQuote derives a
      // scaled or inverted rate from its quote, so that one can't disagree.)
      const direct = quote.per === undefined && quote.inverted !== true;
      // ratio() caches strings, so for a rate built from the same text this is two lookups.
      const quoted = direct ? ratio(quote.rate) : normalized;
      if (quoted.num !== normalized.num || quoted.den !== normalized.den) {
        throw new RangeError(`Quote ${quote.rate} isn't the rate ${from}→${to}`);
      }
    }
    if (info !== undefined) {
      Object.assign(this, infoOf(info));
    }
    if (derivedFrom !== undefined) {
      writable.derivedFrom = derivedFrom;
    }
  }

  /** The exact reciprocal, `to` → `from`. A bid becomes an ask and vice versa. */
  inverse(): Rate<To, From> {
    let type = this.type;
    if (type !== undefined) {
      type = OPPOSITE_SIDE[type] ?? type;
    }
    const reciprocal = ratio(this.ratio.den, this.ratio.num);
    let info = timingOf(this, type);
    // The published number reads the other way round now, so the inverse of a quoted rate keeps
    // its digits too: the inverse of CAD→USD quoted as 1.3650 inverted prints '1.3650'.
    const quote = this.quote;
    if (quote !== undefined) {
      const { inverted, ...rest } = quote;
      info = { ...info, quote: inverted === true ? rest : { ...rest, inverted: true } };
    }
    return new Rate(this.to, this.from, reciprocal, info, [this]);
  }

  /**
   * The exact composite `from` → `next.to`. Nothing is rounded: converting with it rounds once.
   * (Named `andThen`, not `then`, so that a Rate is never mistaken for a promise.)
   */
  andThen<Next extends string>(next: Rate<To, Next>): Rate<From, Next> {
    if (next.from !== this.to) {
      throw new CurrencyMismatchError(this.to, next.from);
    }
    const product = ratio(this.ratio.num * next.ratio.num, this.ratio.den * next.ratio.den);

    // A composite keeps a type only when both legs agree, so it can't be mislabelled.
    let type: RateType | undefined;
    if (this.type === next.type) {
      type = this.type;
    }
    // A composite is known only once both legs are, and is valid only while both are.
    const asOf = earlier(this.asOf, next.asOf);
    const availableAt = earlier(this.availableAt, next.availableAt, true);
    const validUntil = earlier(this.validUntil, next.validUntil);
    const info = timing(asOf, availableAt, validUntil, type);
    return new Rate(this.from, next.to, product, info, [this, next]);
  }

  /** This rate × (1 + margin), exactly: `withMargin('-0.02')` gives 2% less `to` per `from`. */
  withMargin(margin: Factor): Rate<From, To> {
    const marginRatio = ratio(margin);
    const numerator = this.ratio.num * (marginRatio.den + marginRatio.num);
    const denominator = this.ratio.den * marginRatio.den;
    return new Rate(this.from, this.to, ratio(numerator, denominator), timingOf(this), [this]);
  }

  /**
   * A new Rate rounded to `places` decimals, for businesses that quote rounded (e.g. inverse)
   * rates.
   */
  round(places: number, rounding: RoundingMode = 'halfEven'): Rate<From, To> {
    const rounded = ratio(this.toDecimal(places, rounding));
    return new Rate(this.from, this.to, rounded, timingOf(this, this.type), [this]);
  }

  /** The rate with exactly `places` decimals, for display. The Rate itself keeps every digit. */
  toDecimal(places: number, rounding: RoundingMode = 'halfEven'): string {
    const scaled = divideAndRoundBigint(this.ratio.num * pow10n(places), this.ratio.den, rounding);
    return formatScaled(scaled, places);
  }

  /**
   * The exact rate: '1.1165', or '2000/2233' when its decimal expansion doesn't terminate. A rate
   * published one unit for one unit keeps the published digits ('136.80').
   */
  toString(): string {
    const quote = this.quote;
    if (quote !== undefined && quote.per === undefined && quote.inverted !== true) {
      return quote.rate;
    }
    return ratioToDecimal(this.ratio) ?? `${this.ratio.num}/${this.ratio.den}`;
  }

  /** The rate, its metadata and its audit chain as JSON. `rateFromJSON` reverses it. */
  toJSON(): RateJSON {
    const { quote, ...info } = infoOf(this);
    const json: RateJSON = { from: this.from, to: this.to, rate: this.toString(), ...info };
    // A direct quote is the `rate` string itself, so only a scaled or inverted one is written.
    if (quote !== undefined && (quote.per !== undefined || quote.inverted === true)) {
      json.quote = quote;
    }
    if (this.derivedFrom !== undefined) {
      json.derivedFrom = this.derivedFrom.map((input) => input.toJSON());
    }
    return json;
  }

  /**
   * Whether `validUntil` has passed at `now` (default: the system clock). A date is valid all day
   * (UTC).
   */
  isExpired(now: string | Date = new Date()): boolean {
    if (this.validUntil === undefined) {
      return false;
    }
    return hasEnded(this.validUntil, now);
  }

  /**
   * Whether the rate had been published by `at`: always, without an `availableAt`. A date `at`
   * means by the end of that UTC day.
   */
  isAvailable(at: string | Date): boolean {
    if (this.availableAt === undefined) {
      return true;
    }
    return hasStarted(this.availableAt, at);
  }

  /**
   * Converts `money`, rounding once: with a mode, to the target currency's exponent (or
   * `options.scale`); with a rounding policy, to the policy's scale and increment.
   */
  convert(
    money: Money<From>,
    rounding: RoundingInput = DEFAULT_ROUNDING,
    options?: ConvertOptions,
  ): Money<To> {
    if (money.currency !== this.from) {
      throw new CurrencyMismatchError(this.from, money.currency);
    }
    if (options?.strictValidity === true && this.validUntil !== undefined && this.isExpired()) {
      throw new RateExpiredError(this.from, this.to, this.validUntil);
    }
    if (typeof rounding === 'function') {
      return convertWithPolicy(money, this.to, this.ratio, rounding, options);
    }
    const scale = options?.scale ?? currencyExponent(this.to);
    const minor = multiplyByRatioAtScale(money.minor, this.ratio, scale - money.scale, rounding);
    return make(this.to, minor, scale);
  }
}

/**
 * @internal
 * money × rate in `to`, rounded once by a policy. The amount is relabelled `to` at its own scale,
 * so the policy rounds the product exactly as it would a multiplication in `to`: to its scale
 * (default `to`'s exponent) and increment, checking its currency against `to`.
 */
export function convertWithPolicy<To extends string>(
  money: Money,
  to: To,
  rate: Ratio,
  policy: RoundingPolicy,
  options?: ConvertOptions,
): Money<To> {
  // Two scales would leave it unclear which one the result has.
  if (options?.scale !== undefined) {
    throw new TypeError('A rounding policy sets the scale; leave options.scale out');
  }
  return roundWithPolicy(make(to, money.minor, money.scale), rate, policy);
}

/** The metadata fields of `info` that are defined (no undefined keys). */
function infoOf(info: LooseInfo): MutableInfo {
  const defined: MutableInfo = {};
  if (info.source !== undefined) {
    defined.source = info.source;
  }
  if (info.asOf !== undefined) {
    defined.asOf = toIsoString(info.asOf);
  }
  if (info.availableAt !== undefined) {
    defined.availableAt = toIsoString(info.availableAt);
  }
  if (info.validUntil !== undefined) {
    defined.validUntil = toIsoString(info.validUntil);
  }
  if (info.type !== undefined) {
    defined.type = info.type;
  }
  if (info.quote !== undefined) {
    defined.quote = info.quote;
  }
  return defined;
}

function timing(
  asOf?: string,
  availableAt?: string,
  validUntil?: string,
  type?: RateType,
): RateInfo {
  return infoOf({ asOf, availableAt, validUntil, type });
}

/**
 * A derived rate keeps the timing of its input; the input's source stays with it, in derivedFrom.
 */
function timingOf(input: Rate, type?: RateType): RateInfo {
  return timing(input.asOf, input.availableAt, input.validUntil, type);
}

// A published decimal whose canonical form drops digits: trailing fraction zeros only. Leading
// zeros ('01.50') aren't published digits, so those are left to the canonical form.
const PUBLISHED_DECIMAL = /^(?:0|[1-9]\d*)\.\d*0$/;

/**
 * Keeps the published digits of `text` on a Rate just built from it, when its canonical form would
 * drop some ('1.1650' prints as '1.165'). Assigned directly: the quote is the rate's own text, so
 * there is nothing to check, and building a rate inline stays cheap.
 */
function keepDigits<R extends Rate>(rate: R, text: Factor): R {
  // Only a last character of '0' can be dropped, so most rates are settled by one comparison.
  const dropsDigits =
    typeof text === 'string' &&
    text.charCodeAt(text.length - 1) === 48 &&
    rate.quote === undefined &&
    PUBLISHED_DECIMAL.test(text);
  if (dropsDigits) {
    (rate as { quote?: RateQuote }).quote = { rate: text };
  }
  return rate;
}

/**
 * An exact rate pinned to a currency pair, so converting the wrong currency is a type error. Give
 * the rate as a decimal string ('1.1165', every digit kept), a "num/den" string, a bigint or a
 * Ratio. Numbers are read at their shortest decimal form (1.234 is exactly 1234/1000).
 *
 *     const eurUsd = exchangeRate('EUR', 'USD', '1.1165', { source: 'ECB', asOf: '2026-11-06' });
 *     eurUsd.convert(money('100', 'EUR'), 'halfEven');   // 111.65 USD
 *     eurUsd.inverse().ratio                             // 2000/2233, exactly
 */
export function exchangeRate<From extends CurrencyInput, To extends CurrencyInput>(
  from: From,
  to: To,
  rate: Factor,
  info?: RateInfo,
): Rate<From, To> {
  return keepDigits(new Rate(from, to, ratio(rate), info), rate);
}

/** Rebuilds a Rate, with its audit chain, from `rate.toJSON()`. */
export function rateFromJSON(json: RateJSON): Rate {
  const derivedFrom = json.derivedFrom?.map(rateFromJSON);
  const rate = new Rate(json.from, json.to, ratio(json.rate), infoOf(json), derivedFrom);
  return keepDigits(rate, json.rate);
}

/** Whether `value` is a Rate. */
export function isRate(value: unknown): value is Rate {
  return value instanceof Rate;
}

/**
 * The exact rate a processor actually applied: settled ÷ presented. Use it to audit a quoted rate,
 * which after the processor's own rounding often doesn't reproduce the settled amount.
 *
 *     impliedRate(money('10.00', 'EUR'), money('12.34', 'USD'))   // EUR→USD 1.234
 */
export function impliedRate<From extends string, To extends string>(
  presented: Money<From>,
  settled: Money<To>,
  info?: RateInfo,
): Rate<From, To> {
  // (settled.minor / 10^settled.scale) ÷ (presented.minor / 10^presented.scale)
  const numerator = BigInt(settled.minor) * pow10n(presented.scale);
  const denominator = BigInt(presented.minor) * pow10n(settled.scale);
  return new Rate(presented.currency, settled.currency, ratio(numerator, denominator), info);
}
