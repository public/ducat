// The cross-library correctness battery: the same vectors, run against ducat and every other money
// and decimal library through one adapter per library (see libraries.ts). test/battery.test.ts runs
// these same vectors against ducat, so the suite and the comparison cannot drift apart.
//
// Each vector returns a value check, or throws:
// - NotSupported when the library has no such capability (shown as "n/a", never emulated);
// - anything else, which is a pass for vectors that expect a throw and an error otherwise.
//
// The vectors themselves are data: @ducatjs/money-spec's vectors/core/battery.json, in the
// language-neutral format of spec/README.md. This file maps each neutral operation to the adapter
// methods, and keeps the comparison's own judgement of other libraries' answers (DIAGNOSES).
import batteryFile from '@ducatjs/money-spec/vectors/core/battery.json' with { type: 'json' };
import {
  generatedAllocations,
  minorUnitsOf,
  type Expectation,
  type SpecCase,
  type SpecFile,
  type SpecMoney,
} from '../../test/spec/format.ts';

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
  /** a throw (other than NotSupported) is a correct behaviour, though a correct value may also pass */
  readonly expectsThrow?: boolean;
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

/** A sort key for decimal strings: the value in units of 10^-30, exactly. */
function scaledKey(value: string): bigint {
  const isNegative = value.startsWith('-');
  const [integerPart, fractionPart = ''] = value.replace('-', '').split('.');
  const units = BigInt(integerPart! + fractionPart.padEnd(30, '0'));
  return isNegative ? -units : units;
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
function amountOf(
  library: MoneyLibrary,
  decimal: string,
  currency: string,
  minorUnits: number | bigint,
): unknown {
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

/** A EUR decimal string ("-12.3", "4") as exact cents. */
function centsOf(decimal: string): bigint {
  const normalized = normalizeDecimal(decimal);
  const isNegative = normalized.startsWith('-');
  const [integerPart, fractionPart = ''] = normalized.replace('-', '').split('.');
  const cents = BigInt(integerPart! + fractionPart.padEnd(2, '0'));
  return isNegative ? -cents : cents;
}

/** One operation's result, as each expectation needs it. */
type Produced =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'parts'; readonly parts: string[] }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'check'; readonly check: Check };

interface Diagnosis {
  /** runs before the operation: a library that can't express the case by design */
  precondition?(library: MoneyLibrary): Check | undefined;
  /** classifies a value returned where a throw (or another value) was expected */
  classify?(stored: string): Check;
}

function mismatchByDesign(got: string): Diagnosis {
  return {
    precondition: (library) =>
      library.hasNoCurrency ? { ok: false, got, note: 'by design' } : undefined,
  };
}

/**
 * How the battery reads other libraries' wrong answers, by vector id: which are lossy rather than
 * wrong, and which can't be expressed by design. This is the comparison's own judgement, kept here
 * rather than in the language-neutral vectors.
 */
const DIAGNOSES: Record<string, Diagnosis> = {
  'jpy-frac': {
    precondition: (library) => {
      if (library.isDecimalLibrary || library.hasNoExponentTable) {
        throw new NotSupported('no currency exponents');
      }
      return undefined;
    },
    classify: (stored) => {
      if (stored === '1000.5') {
        return {
          ok: 'lossy',
          got: stored,
          note: 'kept at a finer scale than the currency (allowed by design)',
        };
      }
      return { ok: false, got: stored };
    },
  },
  'float-in': {
    classify: (stored) => {
      if (stored === '0.3') {
        return { ok: 'lossy', got: stored, note: 'silently rounded to 0.30' };
      }
      if (stored === '0.30000000000000004') {
        return { ok: false, got: stored, note: "accepted, keeping the float's error" };
      }
      return { ok: false, got: stored };
    },
  },
  'float-1.005': {
    classify: (stored) => {
      const roundedSilently = stored === '1.01' || stored === '1';
      return { ok: roundedSilently ? 'lossy' : false, got: stored, note: 'silently rounded' };
    },
  },
  'mix-add': mismatchByDesign('no currency on values: added'),
  'mix-cmp': mismatchByDesign('no currency on values'),
  'mix-eq': mismatchByDesign('true (no currency)'),
};

function amountFrom(library: MoneyLibrary, amount: SpecMoney): unknown {
  return amountOf(library, amount.amount, amount.currency, minorUnitsOf(amount));
}

/** A minor-unit count as the JS number minor-unit APIs take, or a bigint beyond 2^53. */
function minorArgument(minor: string): number | bigint {
  const units = BigInt(minor);
  const isSafe =
    units <= BigInt(Number.MAX_SAFE_INTEGER) && units >= -BigInt(Number.MAX_SAFE_INTEGER);
  return isSafe ? Number(units) : units;
}

function allocationFuzz(library: MoneyLibrary, args: SpecCase['args']): Check {
  requireMethods(library, 'allocate', 'fromMinor');
  const currency = args['currency'] as string;
  let badCount = 0;
  let firstBad: string | undefined;

  for (const { minor, weights } of generatedAllocations(args)) {
    const amountMinor = Number(minor);
    const totalWeight = BigInt(weights.reduce((total, weight) => total + weight, 0));

    const whole = library.fromMinor!(amountMinor, currency);
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

type Operation = (library: MoneyLibrary, args: SpecCase['args']) => Produced;

function textResult(value: string): Produced {
  return { kind: 'text', text: value };
}

function twoAmounts(library: MoneyLibrary, args: SpecCase['args']): [unknown, unknown] {
  return [
    amountFrom(library, args['first'] as SpecMoney),
    amountFrom(library, args['second'] as SpecMoney),
  ];
}

/** Each neutral operation, driven through the library's adapter. */
const OPERATIONS: Record<string, Operation> = {
  'currency.exponent': (library, args) =>
    textResult(exponentOf(library, args['currency'] as string)),
  'money.fromMinor': (library, args) => {
    requireMethods(library, 'fromMinor');
    const minor = minorArgument(args['minor'] as string);
    return textResult(library.toDecimal(library.fromMinor!(minor, args['currency'] as string)));
  },
  'money.fromDecimal': (library, args) => {
    requireMethods(library, 'fromDecimal');
    const amount = library.fromDecimal!(args['amount'] as string, args['currency'] as string);
    return textResult(library.toDecimal(amount));
  },
  'money.fromBinary64': (library, args) => {
    requireMethods(library, 'fromFloat');
    const { binary64 } = args['value'] as { binary64: string };
    return textResult(
      library.toDecimal(library.fromFloat!(Number(binary64), args['currency'] as string)),
    );
  },
  'money.roundTrip': (library, args) =>
    textResult(library.toDecimal(amountFrom(library, args['money'] as SpecMoney))),
  'money.add': (library, args) => {
    requireMethods(library, 'add');
    const [first, second] = twoAmounts(library, args);
    return textResult(library.toDecimal(library.add!(first, second)));
  },
  'money.subtract': (library, args) => {
    requireMethods(library, 'subtract');
    const [first, second] = twoAmounts(library, args);
    return textResult(library.toDecimal(library.subtract!(first, second)));
  },
  'money.compare': (library, args) => {
    requireMethods(library, 'compare');
    const [first, second] = twoAmounts(library, args);
    return textResult(String(library.compare!(first, second)));
  },
  'money.equals': (library, args) => {
    requireMethods(library, 'equals');
    const [first, second] = twoAmounts(library, args);
    return { kind: 'boolean', value: library.equals!(first, second) };
  },
  'money.multiply': (library, args) => {
    requireMethods(library, 'multiply');
    const amount = amountFrom(library, args['money'] as SpecMoney);
    const mode = args['mode'] as RoundingName;
    return textResult(library.toDecimal(library.multiply!(amount, args['factor'] as string, mode)));
  },
  'money.divide': (library, args) => {
    requireMethods(library, 'divide');
    const amount = amountFrom(library, args['money'] as SpecMoney);
    const mode = args['mode'] as RoundingName;
    return textResult(library.toDecimal(library.divide!(amount, args['divisor'] as string, mode)));
  },
  'money.convert': (library, args) => {
    requireMethods(library, 'convert');
    const amount = amountFrom(library, args['money'] as SpecMoney);
    const mode = args['mode'] as RoundingName;
    const target = args['to'] as string;
    return textResult(
      library.toDecimal(library.convert!(amount, target, args['rate'] as string, mode)),
    );
  },
  'money.split': (library, args) => {
    const amount = amountFrom(library, args['money'] as SpecMoney);
    return {
      kind: 'parts',
      parts: decimalsOf(library, splitInto(library, amount, args['count'] as number)),
    };
  },
  'money.allocate': (library, args) => {
    requireMethods(library, 'allocate');
    const amount = amountFrom(library, args['money'] as SpecMoney);
    const weights = args['weights'] as number[];
    return { kind: 'parts', parts: decimalsOf(library, library.allocate!(amount, weights)) };
  },
  'money.allocate.generated': (library, args) => ({
    kind: 'check',
    check: allocationFuzz(library, args),
  }),
};

function producedText(produced: Produced): string {
  switch (produced.kind) {
    case 'text':
      return produced.text;
    case 'boolean':
      return String(produced.value);
    case 'parts':
      return produced.parts.join(' ');
    case 'check':
      return produced.check.got;
  }
}

function judgeValue(produced: Produced, expect: Expectation): Check {
  if (produced.kind === 'check') {
    return produced.check;
  }
  if (expect.boolean !== undefined && produced.kind === 'boolean') {
    return { ok: produced.value === expect.boolean, got: String(produced.value) };
  }
  if (produced.kind === 'parts') {
    const parts = produced.parts;
    if (expect.moneyMultiset) {
      return sameMultiset(
        parts,
        expect.moneyMultiset.map((part) => part.amount),
      );
    }
    if (expect.moneyList) {
      const normalized = parts.map(normalizeDecimal);
      const expected = expect.moneyList.map((part) => normalizeDecimal(part.amount));
      return { ok: normalized.join() === expected.join(), got: normalized.join(' ') };
    }
    if (expect.sumOfParts) {
      return {
        ok: sumOfDecimals(parts) === normalizeDecimal(expect.sumOfParts.amount),
        got: parts.map(normalizeDecimal).join(' '),
      };
    }
  }
  if (produced.kind === 'text') {
    if (expect.money) {
      return valueCheck(produced.text, expect.money.amount);
    }
    if (expect.integer !== undefined) {
      return valueCheck(produced.text, String(expect.integer));
    }
  }
  throw new Error(`the battery can't judge ${produced.kind} against ${JSON.stringify(expect)}`);
}

/** The battery judges values by numeric equality of the decimals, as other libraries print them. */
function judge(produced: Produced, expect: Expectation, diagnosis: Diagnosis | undefined): Check {
  if (expect.error !== undefined) {
    if (diagnosis?.classify) {
      return diagnosis.classify(normalizeDecimal(producedText(produced)));
    }
    return { ok: false, got: producedText(produced) };
  }
  if (expect.anyOf) {
    const values = expect.anyOf.filter((alternative) => alternative.error === undefined);
    const checks = values.map((alternative) => judgeValue(produced, alternative));
    const passing = checks.find((check) => check.ok === true);
    if (passing) {
      return passing;
    }
    if (diagnosis?.classify) {
      return diagnosis.classify(normalizeDecimal(producedText(produced)));
    }
    return checks[0]!;
  }
  return judgeValue(produced, expect);
}

function expectsThrow(expect: Expectation): boolean {
  return (
    expect.error !== undefined ||
    (expect.anyOf ?? []).some((alternative) => alternative.error !== undefined)
  );
}

function vectorOf(specCase: SpecCase): Vector {
  const operation = OPERATIONS[specCase.op];
  if (!operation) {
    throw new Error(`the battery has no operation ${specCase.op} (vector ${specCase.id})`);
  }
  const diagnosis = DIAGNOSES[specCase.id];
  return {
    id: specCase.id,
    group: specCase.group ?? '',
    description: specCase.description,
    expectsThrow: expectsThrow(specCase.expect),
    check: (library) => {
      const preconditionCheck = diagnosis?.precondition?.(library);
      if (preconditionCheck) {
        return preconditionCheck;
      }
      return judge(operation(library, specCase.args), specCase.expect, diagnosis);
    },
  };
}

/** The battery's vectors: @ducatjs/money-spec's core battery, in its order. */
export const VECTORS: Vector[] = (batteryFile as unknown as SpecFile).cases!.map(vectorOf);

/** Every diagnosis names a vector that exists, so a renamed vector can't silently lose one. */
export const DIAGNOSED_IDS: readonly string[] = Object.keys(DIAGNOSES);

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
    if (vector.expectsThrow) {
      return { outcome: 'pass', got: `throws ${describeError(error, 80)}` };
    }
    return { outcome: 'error', got: describeError(error, 100) };
  }
}
