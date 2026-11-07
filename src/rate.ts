// Exchange rates as exact rationals with metadata. A Rate never loses digits: inverses, compositions
// and margins are exact products of ratios, and rounding happens once, when an amount is converted.
import { currencyExponent } from './currency.js';
import { formatScaled, POW10, pow10n, ratio, ratioToDecimal, toSafe, type Factor, type Ratio } from './decimal.js';
import { CurrencyMismatchError, make, type CurrencyInput, type Money } from './money.js';
import { DEFAULT_ROUNDING, divRound, divRoundBig, type RoundingMode } from './rounding.js';

const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

/** How a rate was quoted. `inverse()` swaps 'bid' and 'ask'. */
export type RateType = 'mid' | 'bid' | 'ask' | (string & {});

/** Where a rate came from. `asOf` and `validUntil` are ISO-8601 dates ('2026-11-06') or instants. */
export interface RateInfo {
  readonly source?: string;
  readonly asOf?: string | Date;
  readonly validUntil?: string | Date;
  readonly type?: RateType;
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
  validUntil?: string;
  type?: string;
  derivedFrom?: RateJSON[];
}

type MutableInfo = { source?: string; asOf?: string; validUntil?: string; type?: RateType };
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

/** The earlier of two ISO-8601 strings (one format compares lexicographically); undefined = no limit. */
function earlier(first: string | undefined, second: string | undefined): string | undefined {
  if (first === undefined) {
    return second;
  }
  if (second === undefined || first <= second) {
    return first;
  }
  return second;
}

/**
 * minor × rate × 10^scaleShift, rounded once with `rounding`. This is the kernel of every conversion:
 * `scaleShift` is the result scale minus the input scale. Pure, and `rate.den > 0` by construction.
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
        return divRound(product, denominator, rounding);
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
  return toSafe(divRoundBig(numerator, denominator, rounding));
}

/**
 * An exact exchange rate: one unit of `from` is worth `ratio` units of `to`. Build it with
 * `exchangeRate()`. Derived rates (`inverse`, `andThen`, `withMargin`, `round`) keep their inputs in
 * `derivedFrom`, the audit chain. Their `asOf` is the oldest input's, so staleness can't hide, and
 * their `validUntil` is the earliest.
 */
export class Rate<From extends string = string, To extends string = string> {
  readonly from: From;
  readonly to: To;
  readonly ratio: Ratio;
  // The optional fields are `declare`d, so only the ones that are set exist on an instance: class
  // field semantics would otherwise define them all as undefined.
  declare readonly source?: string;
  declare readonly asOf?: string;
  declare readonly validUntil?: string;
  declare readonly type?: RateType;
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
    if (info?.source !== undefined) {
      writable.source = info.source;
    }
    if (info?.asOf !== undefined) {
      writable.asOf = toIsoString(info.asOf);
    }
    if (info?.validUntil !== undefined) {
      writable.validUntil = toIsoString(info.validUntil);
    }
    if (info?.type !== undefined) {
      writable.type = info.type;
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
    return new Rate(this.to, this.from, reciprocal, timingOf(this, type), [this]);
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
    const asOf = earlier(this.asOf, next.asOf);
    const validUntil = earlier(this.validUntil, next.validUntil);
    return new Rate(this.from, next.to, product, timing(asOf, validUntil, type), [this, next]);
  }

  /** This rate × (1 + margin), exactly: `withMargin('-0.02')` gives 2% less `to` per `from`. */
  withMargin(margin: Factor): Rate<From, To> {
    const marginRatio = ratio(margin);
    const numerator = this.ratio.num * (marginRatio.den + marginRatio.num);
    const denominator = this.ratio.den * marginRatio.den;
    return new Rate(this.from, this.to, ratio(numerator, denominator), timingOf(this), [this]);
  }

  /** A new Rate rounded to `places` decimals, for businesses that quote rounded (e.g. inverse) rates. */
  round(places: number, rounding: RoundingMode = 'halfEven'): Rate<From, To> {
    const rounded = ratio(this.toDecimal(places, rounding));
    return new Rate(this.from, this.to, rounded, timingOf(this, this.type), [this]);
  }

  /** The rate with exactly `places` decimals, for display. The Rate itself keeps every digit. */
  toDecimal(places: number, rounding: RoundingMode = 'halfEven'): string {
    const scaled = divRoundBig(this.ratio.num * pow10n(places), this.ratio.den, rounding);
    return formatScaled(scaled, places);
  }

  /** The exact rate: '1.1165', or '2000/2233' when its decimal expansion doesn't terminate. */
  toString(): string {
    return ratioToDecimal(this.ratio) ?? `${this.ratio.num}/${this.ratio.den}`;
  }

  /** The rate, its metadata and its audit chain as JSON. `rateFromJSON` reverses it. */
  toJSON(): RateJSON {
    const json: RateJSON = { from: this.from, to: this.to, rate: this.toString(), ...infoOf(this) };
    if (this.derivedFrom !== undefined) {
      json.derivedFrom = this.derivedFrom.map((input) => input.toJSON());
    }
    return json;
  }

  /** Whether `validUntil` has passed at `now` (default: the system clock). A date is valid all day (UTC). */
  isExpired(now: string | Date = new Date()): boolean {
    if (this.validUntil === undefined) {
      return false;
    }
    let instant = toIsoString(now);
    if (ISO_DATE.test(instant)) {
      instant = `${instant}T00:00:00.000Z`;
    }
    if (ISO_DATE.test(this.validUntil)) {
      return instant.slice(0, 10) > this.validUntil;
    }
    return instant > this.validUntil;
  }

  /** Converts `money`, rounding once to the target currency's exponent (or `options.scale`). */
  convert(money: Money<From>, rounding: RoundingMode = DEFAULT_ROUNDING, options?: ConvertOptions): Money<To> {
    if (money.currency !== this.from) {
      throw new CurrencyMismatchError(this.from, money.currency);
    }
    if (options?.strictValidity === true && this.validUntil !== undefined && this.isExpired()) {
      throw new RateExpiredError(this.from, this.to, this.validUntil);
    }
    const scale = options?.scale ?? currencyExponent(this.to);
    const minor = multiplyByRatioAtScale(money.minor, this.ratio, scale - money.scale, rounding);
    return make(this.to, minor, scale);
  }
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
  if (info.validUntil !== undefined) {
    defined.validUntil = toIsoString(info.validUntil);
  }
  if (info.type !== undefined) {
    defined.type = info.type;
  }
  return defined;
}

function timing(asOf?: string, validUntil?: string, type?: RateType): RateInfo {
  return infoOf({ asOf, validUntil, type });
}

/** A derived rate keeps the timing of its input; the input's source stays with it, in derivedFrom. */
function timingOf(input: Rate, type?: RateType): RateInfo {
  return timing(input.asOf, input.validUntil, type);
}

/**
 * An exact rate pinned to a currency pair, so converting the wrong currency is a type error. Give the
 * rate as a decimal string ('1.1165', every digit kept), a "num/den" string, a bigint or a Ratio.
 * Numbers are read at their shortest decimal form (1.234 is exactly 1234/1000).
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
  return new Rate(from, to, ratio(rate), info);
}

/** Rebuilds a Rate, with its audit chain, from `rate.toJSON()`. */
export function rateFromJSON(json: RateJSON): Rate {
  const derivedFrom = json.derivedFrom?.map(rateFromJSON);
  return new Rate(json.from, json.to, ratio(json.rate), infoOf(json), derivedFrom);
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
