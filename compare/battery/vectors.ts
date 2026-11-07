// The cross-library correctness battery: the same vectors, run against ducat and every other money
// and decimal library through one adapter per library (see libraries.ts). test/battery.test.ts runs
// these same vectors against ducat, so the suite and the comparison cannot drift apart.
//
// Each vector returns a value check, or throws:
// - NotSupported when the library has no such capability (shown as "n/a", never emulated);
// - anything else, which is a pass for vectors that expect a throw and an error otherwise.

/** Thrown by an adapter, or by a vector, when a library has no such capability. */
export class NotSupported extends Error {}

export type RoundingName = 'halfEven' | 'halfExpand';

/**
 * One library, driven the way its own README teaches. Every method is optional: a missing method
 * means the library lacks the capability, and the vector reports "n/a".
 */
export interface MoneyLibrary<Value = unknown> {
  readonly name: string;
  /** a decimal library: values carry no currency and no exponent table */
  readonly isDecimalLibrary?: boolean;
  /** values carry no currency code, so mismatches cannot be detected */
  readonly hasNoCurrency?: boolean;
  /** the library has no currency exponent table */
  readonly hasNoExponentTable?: boolean;

  /** an amount in major units, from a decimal string */
  fromDecimal?(decimal: string, currency: string): Value;
  /** an amount in major units, from a JS number (the "float input" path) */
  fromFloat?(amount: number, currency: string): Value;
  /** an amount in minor units */
  fromMinor?(minorUnits: number | bigint, currency: string): Value;
  /** the amount as a decimal string in major units (trailing zeros are normalised away) */
  toDecimal(value: Value): string;

  add?(first: Value, second: Value): Value;
  subtract?(first: Value, second: Value): Value;
  /** rounded to the currency's scale */
  multiply?(value: Value, factor: string, mode: RoundingName): Value;
  divide?(value: Value, divisor: string, mode: RoundingName): Value;
  allocate?(value: Value, weights: number[]): Value[];
  split?(value: Value, count: number): Value[];
  convert?(value: Value, target: string, rate: string, mode: RoundingName): Value;
  compare?(first: Value, second: Value): number;
  equals?(first: Value, second: Value): boolean;
  /** the library's own currency exponent table */
  exponent?(currency: string): number;
}

export type Outcome = 'pass' | 'fail' | 'lossy' | 'error' | 'unsupported';

interface Check {
  /** true: correct; false: a wrong value, returned silently; 'lossy': accepted but lossy */
  readonly ok: boolean | 'lossy';
  readonly got: string;
  readonly note?: string;
}

export interface Vector {
  readonly id: string;
  readonly group: string;
  readonly description: string;
  /** a throw (other than NotSupported) is the correct behaviour */
  readonly expectsThrow?: boolean;
  /** a throw is acceptable, though a correct value also passes */
  readonly throwIsAcceptable?: boolean;
  check(library: MoneyLibrary): Check;
}

export interface VectorResult {
  readonly outcome: Outcome;
  readonly got: string;
  readonly note?: string;
}

/** Trailing fraction zeros and a negative zero removed, so "1000.50" and "1000.5" compare equal. */
export function normalizeDecimal(value: unknown): string {
  let text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    return text;
  }
  if (text.includes('.')) {
    text = text.replace(/0+$/, '').replace(/\.$/, '');
  }
  if (text === '-0') {
    text = '0';
  }
  return text;
}

function sameDecimal(actual: unknown, expected: string): boolean {
  return normalizeDecimal(actual) === normalizeDecimal(expected);
}

function valueCheck(actual: unknown, expected: string): Check {
  return { ok: sameDecimal(actual, expected), got: normalizeDecimal(actual) };
}

/** Exact sum of decimal strings, in bigint at the widest scale: an oracle independent of any library. */
export function sumOfDecimals(values: string[]): string {
  const normalized = values.map(normalizeDecimal);
  const scale = Math.max(0, ...normalized.map((value) => (value.split('.')[1] ?? '').length));

  let total = 0n;
  for (const value of normalized) {
    const [integerPart, fractionPart = ''] = value.replace('-', '').split('.');
    const units = BigInt(integerPart! + fractionPart.padEnd(scale, '0'));
    total += value.startsWith('-') ? -units : units;
  }

  const isNegative = total < 0n;
  const magnitude = isNegative ? -total : total;
  let digits = magnitude.toString().padStart(scale + 1, '0');
  if (scale > 0) {
    digits = digits.slice(0, -scale) + '.' + digits.slice(-scale);
  }
  return normalizeDecimal(isNegative ? '-' + digits : digits);
}

/** A sort key for same-scale decimal strings: the digits as one integer. */
function scaledKey(value: string): bigint {
  return BigInt(value.replace('.', '').padEnd(30, '0'));
}

/** Exact numeric sort of decimal strings, for comparing split results as multisets. */
function sortedDecimals(values: string[]): string[] {
  return values.map(normalizeDecimal).toSorted((first, second) => {
    const firstKey = scaledKey(first);
    const secondKey = scaledKey(second);
    if (firstKey === secondKey) {
      return 0;
    }
    return firstKey < secondKey ? -1 : 1;
  });
}

function sameMultiset(actual: string[], expected: string[]): Check {
  const matches = sortedDecimals(actual).join() === sortedDecimals(expected).join();
  return { ok: matches, got: actual.map(normalizeDecimal).join(' ') };
}

/** The method, or NotSupported when the library lacks it. */
function requireMethods(library: MoneyLibrary, ...names: (keyof MoneyLibrary)[]): void {
  for (const name of names) {
    if (typeof library[name] !== 'function') {
      throw new NotSupported(`no ${name}`);
    }
  }
}

/** An amount from a decimal string when the library parses them, otherwise from minor units. */
function amountOf(library: MoneyLibrary, decimal: string, currency: string, minorUnits: number | bigint): unknown {
  if (library.fromDecimal) {
    return library.fromDecimal(decimal, currency);
  }
  if (library.fromMinor) {
    // minor-unit APIs take JS numbers; beyond 2^53 this is where precision is lost
    return library.fromMinor(Number(minorUnits), currency);
  }
  throw new NotSupported('no constructor');
}

function splitInto(library: MoneyLibrary, amount: unknown, count: number): unknown[] {
  if (library.split) {
    return library.split(amount, count);
  }
  if (library.allocate) {
    return library.allocate(
      amount,
      Array.from({ length: count }, () => 1),
    );
  }
  throw new NotSupported('no split or allocate');
}

function decimalsOf(library: MoneyLibrary, values: unknown[]): string[] {
  return values.map((value) => library.toDecimal(value));
}

function exponentOf(library: MoneyLibrary, currency: string): string {
  requireMethods(library, 'exponent');
  try {
    return String(library.exponent!(currency));
  } catch (error) {
    if (error instanceof NotSupported) {
      throw error;
    }
    return `not in table (${(error as Error).message.slice(0, 50)})`;
  }
}

function multiplyCheck(
  library: MoneyLibrary,
  decimal: string,
  minorUnits: number,
  factor: string,
  mode: RoundingName,
  expected: string,
): Check {
  requireMethods(library, 'multiply');
  const amount = amountOf(library, decimal, 'EUR', minorUnits);
  return valueCheck(library.toDecimal(library.multiply!(amount, factor, mode)), expected);
}

/** split(amount, count) as a multiset check against the expected parts */
function splitCheck(
  library: MoneyLibrary,
  decimal: string,
  currency: string,
  minorUnits: number | bigint,
  count: number,
  expected: string[],
): Check {
  const amount = amountOf(library, decimal, currency, minorUnits);
  return sameMultiset(decimalsOf(library, splitInto(library, amount, count)), expected);
}

/** A EUR decimal string ("-12.3", "4") as exact cents. */
function centsOf(decimal: string): bigint {
  const normalized = normalizeDecimal(decimal);
  const isNegative = normalized.startsWith('-');
  const [integerPart, fractionPart = ''] = normalized.replace('-', '').split('.');
  const cents = BigInt(integerPart! + fractionPart.padEnd(2, '0'));
  return isNegative ? -cents : cents;
}

/**
 * The battery's seeded linear congruential generator, in bigint: its product overflows 2^53, so in
 * doubles it would not be the generator it claims to be.
 */
function seededRandom(seed: number): (limit: number) => number {
  let state = BigInt(seed);
  return (limit) => {
    state = (state * 1103515245n + 12345n) % 2147483648n;
    return Number(state % BigInt(limit));
  };
}

function allocationFuzz(library: MoneyLibrary): Check {
  requireMethods(library, 'allocate', 'fromMinor');
  const randomBelow = seededRandom(12345);
  let badCount = 0;
  let firstBad: string | undefined;

  for (let i = 0; i < 2000; i++) {
    const amountMinor = randomBelow(1_000_000_000) - 100_000_000;
    const weightCount = 2 + randomBelow(6);
    const weights = Array.from({ length: weightCount }, () => 1 + randomBelow(1000));
    const totalWeight = BigInt(weights.reduce((total, weight) => total + weight, 0));

    const whole = library.fromMinor!(amountMinor, 'EUR');
    const parts = decimalsOf(library, library.allocate!(whole, weights));
    const sumsToWhole = sumOfDecimals(parts) === normalizeDecimal(library.toDecimal(whole));

    // each part within one cent of its exact share: |part * W - amount * weight| <= W, exactly
    const withinOneUnit = parts.every((part, index) => {
      const partCents = centsOf(part);
      const scaledError = partCents * totalWeight - BigInt(amountMinor) * BigInt(weights[index]!);
      const distance = scaledError < 0n ? -scaledError : scaledError;
      return distance <= totalWeight;
    });

    if (!sumsToWhole || !withinOneUnit) {
      badCount++;
      firstBad ??= `${amountMinor}c by [${weights}] -> ${parts.join(' ')}`;
    }
  }

  return { ok: badCount === 0, got: badCount ? `${badCount} bad, e.g. ${firstBad}` : '0 bad' };
}

function mismatchByDesign(got: string): Check {
  return { ok: false, got, note: 'by design' };
}

export const VECTORS: Vector[] = [
  // --- currencies and minor units
  {
    id: 'exp-JPY',
    group: 'currency',
    description: 'library knows JPY has 0 decimals',
    check: (library) => valueCheck(exponentOf(library, 'JPY'), '0'),
  },
  {
    id: 'exp-KWD',
    group: 'currency',
    description: 'library knows KWD has 3 decimals',
    check: (library) => valueCheck(exponentOf(library, 'KWD'), '3'),
  },
  {
    id: 'exp-CLF',
    group: 'currency',
    description: 'library knows CLF has 4 decimals',
    check: (library) => valueCheck(exponentOf(library, 'CLF'), '4'),
  },
  {
    id: 'exp-ISK',
    group: 'currency',
    description: 'library knows ISK has 0 decimals (ISO)',
    check: (library) => valueCheck(exponentOf(library, 'ISK'), '0'),
  },
  {
    id: 'jpy-1000',
    group: 'currency',
    description: '1000 JPY round-trips as "1000"',
    check: (library) => {
      requireMethods(library, 'fromMinor');
      return valueCheck(library.toDecimal(library.fromMinor!(1000, 'JPY')), '1000');
    },
  },
  {
    id: 'jpy-frac',
    group: 'currency',
    description: '"1000.5" JPY is rejected (not silently rounded)',
    expectsThrow: true,
    check: (library) => {
      if (library.isDecimalLibrary || library.hasNoExponentTable) {
        throw new NotSupported('no currency exponents');
      }
      requireMethods(library, 'fromDecimal');
      const stored = normalizeDecimal(library.toDecimal(library.fromDecimal!('1000.5', 'JPY')));
      if (stored === '1000.5') {
        return { ok: 'lossy', got: stored, note: 'kept at a finer scale than the currency (allowed by design)' };
      }
      return { ok: false, got: stored };
    },
  },
  {
    id: 'kwd-1.234',
    group: 'currency',
    description: '"1.234" KWD = 1234 fils, round-trips',
    check: (library) => {
      requireMethods(library, 'fromMinor');
      return valueCheck(library.toDecimal(library.fromMinor!(1234, 'KWD')), '1.234');
    },
  },
  {
    id: 'kwd-split3',
    group: 'currency',
    description: '1.000 KWD split 3 → 0.334, 0.333, 0.333',
    check: (library) => splitCheck(library, '1.000', 'KWD', 1000, 3, ['0.334', '0.333', '0.333']),
  },
  {
    id: 'jpy-split3',
    group: 'currency',
    description: '100 JPY split 3 → 34, 33, 33',
    check: (library) => splitCheck(library, '100', 'JPY', 100, 3, ['34', '33', '33']),
  },

  // --- allocation
  {
    id: 'split3',
    group: 'allocation',
    description: '100.00 EUR split 3 → 33.34, 33.33, 33.33',
    check: (library) => splitCheck(library, '100.00', 'EUR', 10000, 3, ['33.34', '33.33', '33.33']),
  },
  {
    id: 'split3-neg',
    group: 'allocation',
    description: '-100.00 EUR split 3 → -33.34, -33.33, -33.33',
    check: (library) => splitCheck(library, '-100.00', 'EUR', -10000, 3, ['-33.34', '-33.33', '-33.33']),
  },
  {
    id: 'split-cent',
    group: 'allocation',
    description: '0.01 EUR split 3 → 0.01, 0, 0',
    check: (library) => splitCheck(library, '0.01', 'EUR', 1, 3, ['0.01', '0', '0']),
  },
  {
    id: 'alloc-zero-w',
    group: 'allocation',
    description: '10.00 EUR by [1,0,1] → 5, 0, 5 (zero weight gets nothing)',
    check: (library) => {
      requireMethods(library, 'allocate');
      const amount = amountOf(library, '10.00', 'EUR', 1000);
      const parts = decimalsOf(library, library.allocate!(amount, [1, 0, 1])).map(normalizeDecimal);
      return { ok: parts.join() === '5,0,5', got: parts.join(' ') };
    },
  },
  {
    id: 'alloc-fuzz',
    group: 'allocation',
    description: '2,000 seeded random allocations: parts sum to the whole, each within 1 unit of its share',
    check: allocationFuzz,
  },

  // --- tax
  {
    id: 'vat-12',
    group: 'tax',
    description: 'VAT 20% extracted from 12.00 GBP: net 10.00 (gross ÷ 1.2)',
    check: (library) => {
      requireMethods(library, 'divide');
      const gross = amountOf(library, '12.00', 'GBP', 1200);
      return valueCheck(library.toDecimal(library.divide!(gross, '1.2', 'halfEven')), '10.00');
    },
  },
  {
    id: 'vat-9.99-even',
    group: 'tax',
    description: 'HMRC 9.99 GBP ÷ 1.2 = 8.325 → half-even 8.32',
    check: (library) => {
      requireMethods(library, 'divide');
      const gross = amountOf(library, '9.99', 'GBP', 999);
      return valueCheck(library.toDecimal(library.divide!(gross, '1.2', 'halfEven')), '8.32');
    },
  },
  {
    id: 'vat-9.99-up',
    group: 'tax',
    description: 'HMRC 9.99 GBP ÷ 1.2 = 8.325 → half-up 8.33',
    check: (library) => {
      requireMethods(library, 'divide');
      const gross = amountOf(library, '9.99', 'GBP', 999);
      return valueCheck(library.toDecimal(library.divide!(gross, '1.2', 'halfExpand')), '8.33');
    },
  },
  {
    id: 'vat-119',
    group: 'tax',
    description: 'German 19%: 119.00 EUR ÷ 1.19 → net 100.00',
    check: (library) => {
      requireMethods(library, 'divide');
      const gross = amountOf(library, '119.00', 'EUR', 11900);
      return valueCheck(library.toDecimal(library.divide!(gross, '1.19', 'halfEven')), '100.00');
    },
  },

  // --- rounding at .5 boundaries
  {
    id: 'half-even',
    group: 'rounding',
    description: '0.25 × 0.5 = 0.125 → half-even 0.12',
    check: (library) => multiplyCheck(library, '0.25', 25, '0.5', 'halfEven', '0.12'),
  },
  {
    id: 'half-up',
    group: 'rounding',
    description: '0.25 × 0.5 = 0.125 → half-up 0.13',
    check: (library) => multiplyCheck(library, '0.25', 25, '0.5', 'halfExpand', '0.13'),
  },
  {
    id: 'half-up-neg',
    group: 'rounding',
    description: '-0.25 × 0.5 = -0.125 → half-up (away from 0) -0.13',
    check: (library) => multiplyCheck(library, '-0.25', -25, '0.5', 'halfExpand', '-0.13'),
  },
  {
    id: 'half-even-neg',
    group: 'rounding',
    description: '-0.25 × 0.5 = -0.125 → half-even -0.12',
    check: (library) => multiplyCheck(library, '-0.25', -25, '0.5', 'halfEven', '-0.12'),
  },
  {
    id: 'float-mul-1.15',
    group: 'rounding',
    description: '0.50 × 1.15 = 0.575 → half-up 0.58 (float gives 57.49999999999999)',
    check: (library) => multiplyCheck(library, '0.50', 50, '1.15', 'halfExpand', '0.58'),
  },
  {
    id: 'float-mul-0.7',
    group: 'rounding',
    description: '0.45 × 0.7 = 0.315 → half-up 0.32 (float gives 31.499999999999996)',
    check: (library) => multiplyCheck(library, '0.45', 45, '0.7', 'halfExpand', '0.32'),
  },
  {
    id: 'float-mul-1.1',
    group: 'rounding',
    description: '1.15 × 1.1 = 1.265 → half-even 1.26 (float gives 126.50000000000001)',
    check: (library) => multiplyCheck(library, '1.15', 115, '1.1', 'halfEven', '1.26'),
  },
  {
    id: 'fx-jpy',
    group: 'rounding',
    description: '100.00 EUR → JPY at 162.457 → 16246 (half-up)',
    check: (library) => {
      requireMethods(library, 'convert');
      const amount = amountOf(library, '100.00', 'EUR', 10000);
      const converted = library.convert!(amount, 'JPY', '162.457', 'halfExpand');
      return valueCheck(library.toDecimal(converted), '16246');
    },
  },
  {
    id: 'fx-float',
    group: 'rounding',
    description: '1.15 EUR → USD at 1.1 → 1.26 (half-even; float gives 1.27)',
    check: (library) => {
      requireMethods(library, 'convert');
      const amount = amountOf(library, '1.15', 'EUR', 115);
      const converted = library.convert!(amount, 'USD', '1.1', 'halfEven');
      return valueCheck(library.toDecimal(converted), '1.26');
    },
  },

  // --- large amounts
  {
    id: 'big-2^53+1',
    group: 'large',
    description: '90071992547409.93 EUR (2^53+1 cents) round-trips',
    check: (library) => {
      const amount = amountOf(library, '90071992547409.93', 'EUR', 9007199254740993n);
      return valueCheck(library.toDecimal(amount), '90071992547409.93');
    },
  },
  {
    id: 'big-add',
    group: 'large',
    description: '90071992547409.92 + 0.01 = 90071992547409.93',
    check: (library) => {
      requireMethods(library, 'add');
      const amount = amountOf(library, '90071992547409.92', 'EUR', 9007199254740992n);
      const cent = amountOf(library, '0.01', 'EUR', 1);
      return valueCheck(library.toDecimal(library.add!(amount, cent)), '90071992547409.93');
    },
  },
  {
    id: 'gdp',
    group: 'large',
    description: 'world GDP: 125000000000000.00 USD + 0.01 = …000.01',
    check: (library) => {
      requireMethods(library, 'add');
      const amount = amountOf(library, '125000000000000.00', 'USD', 12500000000000000n);
      const cent = amountOf(library, '0.01', 'USD', 1);
      return valueCheck(library.toDecimal(library.add!(amount, cent)), '125000000000000.01');
    },
  },
  {
    id: 'gdp-split3',
    group: 'large',
    description: 'world GDP 125000000000000.00 USD split 3 sums to the whole',
    check: (library) => {
      const amount = amountOf(library, '125000000000000.00', 'USD', 12500000000000000n);
      const parts = decimalsOf(library, splitInto(library, amount, 3));
      return { ok: sumOfDecimals(parts) === '125000000000000', got: parts.map(normalizeDecimal).join(' ') };
    },
  },
  {
    id: 'bigint-max',
    group: 'large',
    description: '92233720368547758.07 EUR (BIGINT max cents) round-trips',
    check: (library) => {
      const amount = amountOf(library, '92233720368547758.07', 'EUR', 9223372036854775807n);
      return valueCheck(library.toDecimal(amount), '92233720368547758.07');
    },
  },

  // --- negatives
  {
    id: 'neg-add',
    group: 'negative',
    description: '-5.00 + 2.50 = -2.50',
    check: (library) => {
      requireMethods(library, 'add');
      const first = amountOf(library, '-5.00', 'EUR', -500);
      const second = amountOf(library, '2.50', 'EUR', 250);
      return valueCheck(library.toDecimal(library.add!(first, second)), '-2.50');
    },
  },
  {
    id: 'neg-sub',
    group: 'negative',
    description: '2.50 − 5.00 = -2.50',
    check: (library) => {
      requireMethods(library, 'subtract');
      const first = amountOf(library, '2.50', 'EUR', 250);
      const second = amountOf(library, '5.00', 'EUR', 500);
      return valueCheck(library.toDecimal(library.subtract!(first, second)), '-2.50');
    },
  },
  {
    id: 'neg-small',
    group: 'negative',
    description: '-0.05 round-trips as "-0.05"',
    check: (library) => valueCheck(library.toDecimal(amountOf(library, '-0.05', 'EUR', -5)), '-0.05'),
  },

  // --- float input
  {
    id: 'float-in',
    group: 'float',
    description: 'money(0.1 + 0.2) is rejected, not stored (0.30000000000000004 has 17 decimals)',
    expectsThrow: true,
    check: (library) => {
      requireMethods(library, 'fromFloat');
      const stored = normalizeDecimal(library.toDecimal(library.fromFloat!(0.1 + 0.2, 'EUR')));
      if (stored === '0.3') {
        return { ok: 'lossy', got: stored, note: 'silently rounded to 0.30' };
      }
      return { ok: false, got: stored };
    },
  },
  {
    id: 'dec-add',
    group: 'float',
    description: '0.10 + 0.20 = 0.30 exactly',
    check: (library) => {
      requireMethods(library, 'add');
      const first = amountOf(library, '0.10', 'EUR', 10);
      const second = amountOf(library, '0.20', 'EUR', 20);
      return valueCheck(library.toDecimal(library.add!(first, second)), '0.30');
    },
  },
  {
    id: 'float-1.005',
    group: 'float',
    description: 'money(1.005) (really 1.00499999999999989…) is rejected or exact',
    expectsThrow: true,
    check: (library) => {
      requireMethods(library, 'fromFloat');
      const stored = normalizeDecimal(library.toDecimal(library.fromFloat!(1.005, 'EUR')));
      const roundedSilently = stored === '1.01' || stored === '1';
      return { ok: roundedSilently ? 'lossy' : false, got: stored, note: 'silently rounded' };
    },
  },

  // --- currency mismatch
  {
    id: 'mix-add',
    group: 'mismatch',
    description: 'EUR + USD throws',
    expectsThrow: true,
    check: (library) => {
      if (library.hasNoCurrency) {
        return mismatchByDesign('no currency on values: added');
      }
      requireMethods(library, 'add');
      const euro = amountOf(library, '1.00', 'EUR', 100);
      const dollar = amountOf(library, '1.00', 'USD', 100);
      return { ok: false, got: library.toDecimal(library.add!(euro, dollar)) };
    },
  },
  {
    id: 'mix-cmp',
    group: 'mismatch',
    description: 'compare(EUR, USD) throws',
    expectsThrow: true,
    check: (library) => {
      if (library.hasNoCurrency) {
        return mismatchByDesign('no currency on values');
      }
      requireMethods(library, 'compare');
      const euro = amountOf(library, '1.00', 'EUR', 100);
      const dollars = amountOf(library, '2.00', 'USD', 200);
      return { ok: false, got: String(library.compare!(euro, dollars)) };
    },
  },
  {
    id: 'mix-eq',
    group: 'mismatch',
    description: 'equals(1 EUR, 1 USD) is false',
    throwIsAcceptable: true,
    check: (library) => {
      if (library.hasNoCurrency) {
        return mismatchByDesign('true (no currency)');
      }
      requireMethods(library, 'equals');
      const euro = amountOf(library, '1.00', 'EUR', 100);
      const dollar = amountOf(library, '1.00', 'USD', 100);
      const isEqual = library.equals!(euro, dollar);
      return { ok: isEqual === false, got: String(isEqual) };
    },
  },
];

function describeError(error: unknown, maxLength: number): string {
  const name = (error as Error)?.constructor?.name ?? 'Error';
  const message = String((error as Error)?.message).slice(0, maxLength);
  return `${name}: ${message}`;
}

/** Runs one vector against one library and classifies the outcome. */
export function runVector(vector: Vector, library: MoneyLibrary): VectorResult {
  try {
    const result = vector.check(library);
    if (result.ok === true) {
      return { outcome: 'pass', got: result.got };
    }
    const outcome = result.ok === 'lossy' ? 'lossy' : 'fail';
    // only rows that carry a note have the key (exactOptionalPropertyTypes)
    if (result.note === undefined) {
      return { outcome, got: result.got };
    }
    return { outcome, got: result.got, note: result.note };
  } catch (error) {
    if (error instanceof NotSupported) {
      return { outcome: 'unsupported', got: error.message };
    }
    if (vector.expectsThrow || vector.throwIsAcceptable) {
      return { outcome: 'pass', got: `throws ${describeError(error, 80)}` };
    }
    return { outcome: 'error', got: describeError(error, 100) };
  }
}
