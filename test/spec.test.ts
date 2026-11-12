// The TypeScript runner for @ducatjs/money-spec, the language-neutral conformance vectors (spec/).
// It checks every vector file against the schema, maps each neutral operation to ducat's API, and
// runs every case. A file with an operation this runner doesn't know, or one that breaks the
// schema, fails the suite; so does a drop in the number of cases in any area.
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { DIAGNOSED_IDS } from '../compare/battery/vectors.ts';
import { fixed } from '../src/fixed.js';
import '../src/plugins/all.js';
import {
  currencyExponent,
  CurrencyMismatchError,
  fromMinor,
  money,
  RoundingError,
  type Money,
  type RoundingMode,
} from '../src/index.js';
import {
  generatedAllocations,
  type ErrorKind,
  type Expectation,
  type SpecCase,
  type SpecFile,
  type SpecMoney,
} from './spec/format.ts';
import { loadVectorFiles, vectorSchema } from './spec/load.ts';

/** Cases per area. A vector may be added (raise the count), never silently lost. */
const CASES_PER_AREA: Record<string, number> = {
  core: 41,
  fixed: 28,
};

const schema = vectorSchema;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

const files = loadVectorFiles();

// --- ducat's side of each operation ----------------------------------------------------------------

/** What an operation returned, before it is compared with the expectation. */
type Result =
  | { readonly money: Money }
  | { readonly parts: Money[] }
  | { readonly decimal: string }
  | { readonly integer: number }
  | { readonly boolean: boolean }
  | { readonly failures: string[] };

type Arguments = SpecCase['args'];

function moneyOf(amount: SpecMoney): Money {
  return money(amount.amount, amount.currency, { scale: amount.scale });
}

const moneyArgument = (args: Arguments, key = 'money') => moneyOf(args[key] as SpecMoney);
const stringArgument = (args: Arguments, key: string) => args[key] as string;
const modeArgument = (args: Arguments) => args['mode'] as RoundingMode;
const scaleOption = (args: Arguments) => ({ scale: args['scale'] as number });

/**
 * Every part is within one minor unit of its exact share, at the whole's scale, and the parts sum
 * to the whole. The result lists the allocations that break it.
 */
function checkGeneratedAllocations(args: Arguments): Result {
  const currency = stringArgument(args, 'currency');
  const failures: string[] = [];
  for (const { minor, weights } of generatedAllocations(args)) {
    const whole = fromMinor(minor, currency);
    const parts = whole.allocate(weights);
    const totalWeight = BigInt(weights.reduce((total, weight) => total + weight, 0));

    const partMinors = parts.map((part) => BigInt(part.toMinor()));
    const sumsToWhole = partMinors.reduce((sum, part) => sum + part, 0n) === minor;
    const keepsScale = parts.every((part) => part.scale === whole.scale);
    const withinOneUnit = partMinors.every((part, index) => {
      const error = part * totalWeight - minor * BigInt(weights[index]!);
      return error <= totalWeight && -error <= totalWeight;
    });
    if (!sumsToWhole || !keepsScale || !withinOneUnit) {
      failures.push(
        `${minor} by [${weights.join(', ')}]: ${parts.map((part) => part.toDecimal()).join(' ')}`,
      );
    }
  }
  return { failures };
}

const OPERATIONS: Record<string, (args: Arguments) => Result> = {
  'currency.exponent': (args) => ({ integer: currencyExponent(stringArgument(args, 'currency')) }),
  'money.fromMinor': (args) => ({
    money: fromMinor(BigInt(stringArgument(args, 'minor')), stringArgument(args, 'currency')),
  }),
  'money.fromDecimal': (args) => ({
    money: money(stringArgument(args, 'amount'), stringArgument(args, 'currency')),
  }),
  'money.fromBinary64': (args) => {
    const { binary64 } = args['value'] as { binary64: string };
    return { money: money(Number(binary64), stringArgument(args, 'currency')) };
  },
  'money.roundTrip': (args) => ({ money: moneyArgument(args) }),
  'money.add': (args) => ({
    money: moneyArgument(args, 'first').add(moneyArgument(args, 'second')),
  }),
  'money.subtract': (args) => ({
    money: moneyArgument(args, 'first').subtract(moneyArgument(args, 'second')),
  }),
  'money.compare': (args) => ({
    integer: moneyArgument(args, 'first').compare(moneyArgument(args, 'second')),
  }),
  'money.equals': (args) => ({
    boolean: moneyArgument(args, 'first').equals(moneyArgument(args, 'second')),
  }),
  'money.multiply': (args) => ({
    money: moneyArgument(args).multiply(stringArgument(args, 'factor'), modeArgument(args)),
  }),
  'money.divide': (args) => ({
    money: moneyArgument(args).divide(stringArgument(args, 'divisor'), modeArgument(args)),
  }),
  'money.convert': (args) => ({
    money: moneyArgument(args).convert(
      stringArgument(args, 'to'),
      stringArgument(args, 'rate'),
      modeArgument(args),
    ),
  }),
  'money.split': (args) => ({ parts: moneyArgument(args).split(args['count'] as number) }),
  'money.allocate': (args) => ({
    parts: moneyArgument(args).allocate(args['weights'] as number[]),
  }),
  'money.allocate.generated': checkGeneratedAllocations,
  'fixed.roundTrip': (args) => ({ decimal: fixed(stringArgument(args, 'value')).toString() }),
  'fixed.add': (args) => ({
    decimal: fixed(stringArgument(args, 'first'))
      .add(fixed(stringArgument(args, 'second')))
      .toString(),
  }),
  'fixed.multiply': (args) => ({
    decimal: fixed(stringArgument(args, 'value'))
      .multiply(stringArgument(args, 'factor'), modeArgument(args), scaleOption(args))
      .toString(),
  }),
  'fixed.divide': (args) => ({
    decimal: fixed(stringArgument(args, 'value'))
      .divide(stringArgument(args, 'divisor'), modeArgument(args), scaleOption(args))
      .toString(),
  }),
  'fixed.round': (args) => ({
    decimal: fixed(stringArgument(args, 'value'))
      .toScale(args['scale'] as number, modeArgument(args))
      .toString(),
  }),
  'fixed.compare': (args) => ({
    integer: fixed(stringArgument(args, 'first')).compare(fixed(stringArgument(args, 'second'))),
  }),
};

/** ducat's error classes as the spec's neutral kinds. Subclasses first. */
function errorKind(error: unknown): ErrorKind | 'unknown' {
  if (error instanceof RoundingError) {
    return 'rounding';
  }
  if (error instanceof CurrencyMismatchError) {
    return 'currency-mismatch';
  }
  if (error instanceof SyntaxError) {
    return 'syntax';
  }
  if (error instanceof RangeError) {
    return 'range';
  }
  if (error instanceof TypeError) {
    return 'type';
  }
  return 'unknown';
}

// --- comparing with the expectation ----------------------------------------------------------------

function asSpecMoney(amount: Money): SpecMoney {
  return { amount: amount.toDecimal(), currency: amount.currency, scale: amount.scale };
}

/** Plain decimals compare by value: "1.50" and "1.5" are the same number. */
function decimalValue(decimal: string): string {
  let text = decimal;
  if (text.includes('.')) {
    text = text.replace(/0+$/, '').replace(/\.$/, '');
  }
  return text === '-0' ? '0' : text;
}

function sortedMoneys(amounts: readonly SpecMoney[]): SpecMoney[] {
  const key = (amount: SpecMoney) => JSON.stringify(amount);
  return amounts.toSorted((first, second) => key(first).localeCompare(key(second)));
}

/** Whether the result meets one (non-error, non-anyOf) expectation. */
function meets(result: Result, expectation: Expectation): boolean {
  const same = (actual: unknown, expected: unknown) =>
    JSON.stringify(actual) === JSON.stringify(expected);

  if ('failures' in result) {
    return expectation.property !== undefined && result.failures.length === 0;
  }
  if ('money' in result) {
    return expectation.money !== undefined && same(asSpecMoney(result.money), expectation.money);
  }
  if ('parts' in result) {
    const parts = result.parts.map(asSpecMoney);
    if (expectation.moneyList) {
      return same(parts, expectation.moneyList);
    }
    if (expectation.moneyMultiset) {
      return same(sortedMoneys(parts), sortedMoneys(expectation.moneyMultiset));
    }
    if (expectation.sumOfParts) {
      const sum = result.parts.reduce((total, part) => total.add(part));
      return same(asSpecMoney(sum), expectation.sumOfParts);
    }
    return false;
  }
  if ('decimal' in result) {
    return (
      expectation.decimal !== undefined &&
      decimalValue(result.decimal) === decimalValue(expectation.decimal)
    );
  }
  if ('integer' in result) {
    return expectation.integer === result.integer;
  }
  return expectation.boolean === result.boolean;
}

function describeResult(result: Result): unknown {
  if ('money' in result) {
    return asSpecMoney(result.money);
  }
  if ('parts' in result) {
    return result.parts.map(asSpecMoney);
  }
  return result;
}

/** "pass", or what went wrong. */
function runCase(specCase: SpecCase): string {
  const operation = OPERATIONS[specCase.op]!;
  const alternatives = specCase.expect.anyOf ?? [specCase.expect];
  const errorKinds = alternatives.flatMap((alternative) => alternative.error ?? []);

  let result: Result;
  try {
    result = operation(specCase.args);
  } catch (error) {
    if (errorKinds.length === 0) {
      throw error;
    }
    const kind = errorKind(error);
    return errorKinds.includes(kind as ErrorKind) ? 'pass' : `raised a ${kind} error: ${error}`;
  }

  const values = alternatives.filter((alternative) => alternative.error === undefined);
  if (values.some((alternative) => meets(result, alternative))) {
    return 'pass';
  }
  return `got ${JSON.stringify(describeResult(result), (_, value: unknown) => (typeof value === 'bigint' ? String(value) : value))}`;
}

// --- the suite ---------------------------------------------------------------------------------------

/**
 * The operations of each table layout, by name. None yet: ducat's tables of generated cases move
 * here with their files.
 */
const TABLE_OPERATIONS: Record<string, (row: Readonly<Record<string, unknown>>) => string> = {};

function unknownOperations(file: SpecFile): string[] {
  const caseOps = (file.cases ?? []).map((specCase) => specCase.op);
  const unknownCaseOps = caseOps.filter((op) => !(op in OPERATIONS));
  const tableOps = (file.tables ?? []).map((table) => table.op);
  return [...unknownCaseOps, ...tableOps.filter((op) => !(op in TABLE_OPERATIONS))];
}

function caseCount(file: SpecFile): number {
  const rows = (file.tables ?? []).reduce((total, table) => total + table.rows.length, 0);
  return (file.cases?.length ?? 0) + rows;
}

/** The exact decimal value of a double: its significand times a power of two, in bigint. */
function exactDecimalOf(double: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, double);
  const bits = view.getBigUint64(0);
  const isNegative = bits >> 63n === 1n;
  const biasedExponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const significand = biasedExponent === 0 ? fraction : fraction | (1n << 52n);
  const exponent = (biasedExponent === 0 ? 1 : biasedExponent) - 1075;

  let digits: string;
  if (exponent >= 0) {
    digits = String(significand << BigInt(exponent));
  } else {
    // m / 2^k = m * 5^k / 10^k, exactly
    const scale = -exponent;
    const scaled = String(significand * 5n ** BigInt(scale)).padStart(scale + 1, '0');
    digits = `${scaled.slice(0, -scale)}.${scaled.slice(-scale)}`.replace(/\.?0+$/, '');
  }
  return isNegative && digits !== '0' ? `-${digits}` : digits;
}

describe('@ducatjs/money-spec', () => {
  it('has vector files, found through the package', () => {
    expect(files.size).toBeGreaterThan(0);
  });

  it.each([...files.keys()])('%s follows the schema', (path) => {
    const isValid = validate(files.get(path));
    expect({ path, errors: validate.errors ?? [] }).toEqual({ path, errors: [] });
    expect(isValid).toBe(true);
  });

  it.each([...files.keys()])('%s uses only operations this runner knows', (path) => {
    expect(unknownOperations(files.get(path) as SpecFile)).toEqual([]);
  });

  it('every case id is unique within its file', () => {
    for (const [path, file] of files) {
      const ids = ((file as SpecFile).cases ?? []).map((specCase) => specCase.id);
      expect({ path, unique: new Set(ids).size }).toEqual({ path, unique: ids.length });
    }
  });

  it('keeps every case: the count per area', () => {
    const counts: Record<string, number> = {};
    for (const file of files.values()) {
      const specFile = file as SpecFile;
      counts[specFile.area] = (counts[specFile.area] ?? 0) + caseCount(specFile);
    }
    expect(counts).toEqual(CASES_PER_AREA);
  });

  it("names a real vector in each of compare/'s diagnoses", () => {
    const battery = files.get('core/battery.json') as SpecFile;
    const ids = new Set(battery.cases!.map((specCase) => specCase.id));
    expect(DIAGNOSED_IDS.filter((id) => !ids.has(id))).toEqual([]);
  });

  it('writes every money with exactly its scale in fraction digits', () => {
    const misscaled: string[] = [];
    const visit = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${path}[${index}]`));
        return;
      }
      if (value === null || typeof value !== 'object') {
        return;
      }
      const record = value as Record<string, unknown>;
      if (typeof record['amount'] === 'string' && typeof record['scale'] === 'number') {
        const fractionDigits = (record['amount'].split('.')[1] ?? '').length;
        if (fractionDigits !== record['scale']) {
          misscaled.push(path);
        }
      }
      for (const [key, child] of Object.entries(record)) {
        visit(child, `${path}.${key}`);
      }
    };
    for (const [path, file] of files) {
      visit(file, path);
    }
    expect(misscaled).toEqual([]);
  });

  it("draws the generated allocations spec/README.md's example names", () => {
    const battery = files.get('core/battery.json') as SpecFile;
    const generated = battery.cases!.find(
      (specCase) => specCase.op === 'money.allocate.generated',
    )!;
    const draws = generatedAllocations(generated.args);
    expect(draws).toHaveLength(2000);
    expect(draws[0]).toEqual({ minor: 306932606n, weights: [925, 574, 179, 460, 193, 794, 311] });
  });

  it('gives each binary64 input its exact value', () => {
    for (const file of files.values()) {
      for (const specCase of (file as SpecFile).cases ?? []) {
        const value = specCase.args['value'] as { binary64?: string; exact?: string } | undefined;
        if (value?.binary64 !== undefined) {
          expect({ id: specCase.id, exact: exactDecimalOf(Number(value.binary64)) }).toEqual({
            id: specCase.id,
            exact: value.exact,
          });
        }
      }
    }
  });

  it("knows every operation the schema names, and the schema gives each one's arguments", () => {
    const definitions = (schema as { $defs: Record<string, unknown> }).$defs;
    const operations = (definitions['op'] as { enum: string[] }).enum;
    const when = definitions['when'] as Record<string, { if: { properties: { op: object } } }>;
    const withArguments = Object.values(when).flatMap((clause) => {
      const op = clause.if.properties.op as { const?: string; enum?: string[] };
      return op.enum ?? [op.const!];
    });
    expect(operations.toSorted()).toEqual(Object.keys(OPERATIONS).toSorted());
    expect(withArguments.toSorted()).toEqual(operations.toSorted());
  });

  it('rejects a file that breaks the schema, or has an operation the runner does not know', () => {
    const battery = files.get('core/battery.json') as SpecFile;
    const first = battery.cases![0]!;

    const withFloat = {
      ...battery,
      cases: [{ ...first, op: 'money.fromMinor', args: { minor: 1000, currency: 'JPY' } }],
    };
    expect(validate(withFloat)).toBe(false);

    const withoutProvenance = { ...battery, provenance: undefined };
    expect(validate(JSON.parse(JSON.stringify(withoutProvenance)))).toBe(false);

    const withBothLayouts = { ...battery, tables: [{ op: 'lean.allocate', rows: [{}] }] };
    expect(validate(withBothLayouts)).toBe(false);

    const { cases: _cases, ...envelope } = battery;
    const withUnknownTable = { ...envelope, tables: [{ op: 'lean.teleport', rows: [{}] }] };
    expect(validate(withUnknownTable)).toBe(true);
    expect(unknownOperations(withUnknownTable)).toEqual(['lean.teleport']);

    const withUnknownOp = { ...battery, cases: [{ ...first, op: 'money.teleport' }] };
    expect(validate(withUnknownOp)).toBe(false);
    expect(unknownOperations(withUnknownOp)).toEqual(['money.teleport']);
  });
});

for (const [path, file] of files) {
  const { cases = [] } = file as SpecFile;
  describe(`spec ${path}`, () => {
    it.each(
      cases.map((specCase) => [`${specCase.id}: ${specCase.description}`, specCase] as const),
    )('%s', (_, specCase) => {
      expect(runCase(specCase)).toBe('pass');
    });
  });
}
