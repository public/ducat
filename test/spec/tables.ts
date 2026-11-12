// ducat's side of each table operation in @ducatjs/money-spec (spec/README.md, "Table operations").
// Each one checks every row of a table and returns the mismatches; test/spec.test.ts runs them.
// Where ducat has several input forms for the same value (number, bigint and decimal-string
// weights), every form is checked, since each takes its own code path.
// every ISO 4217 code: these build Money from /fn-level modules, which don't register them
import '../../src/plugins/iso.js';
import { ratio, type Ratio } from '../../src/decimal.js';
import { xirr, xnpv, xnpvBounds } from '../../src/excel.js';
import {
  addTax,
  allocate,
  chunk,
  convert,
  discount,
  divide,
  extractTax,
  fromMinor,
  instalments,
  multiply,
  percentage,
  roundToIncrement,
  RoundingError,
  schedule,
  toScale,
  type Money,
  type Remainder,
  type RoundingMode,
  type Tranche,
} from '../../src/fn.js';

type Row = Readonly<Record<string, unknown>>;

export interface TableOperation {
  /** the mismatches in one row, described */
  checkRow(row: Row, index: number): string[];
  /** checks on the table as a whole (that it has both throwing and returning rows, say) */
  checkTable?(rows: readonly Row[]): string[];
}

const eur = (minor: string): Money<'EUR'> => fromMinor(BigInt(minor), 'EUR');
const minors = (parts: Money<string>[]): string[] => parts.map((part) => String(part.minor));

const ROUNDING_MODES: RoundingMode[] = [
  'halfEven',
  'halfExpand',
  'halfTrunc',
  'halfCeil',
  'halfFloor',
  'expand',
  'trunc',
  'ceil',
  'floor',
  'unnecessary',
];

// --- allocation --------------------------------------------------------------------------------------

const REMAINDERS: Remainder[] = ['largest', 'first', 'last', 'toFirst', 'toLast'];

function checkAllocation(row: Row): string[] {
  const amountMinor = row['amount'] as string;
  const weights = row['weights'] as string[];
  const amount = fromMinor(BigInt(amountMinor), 'EUR');
  // number weights take the fast path when the products fit in a double; bigint and decimal-string
  // weights always take the bigint path
  const weightForms = {
    number: weights.map(Number),
    bigint: weights.map(BigInt),
    decimal: weights.map((weight) => `${weight}.0`),
  };

  const mismatches: string[] = [];
  for (const strategy of REMAINDERS) {
    const expected = (row[strategy] as string[]).join();
    for (const [form, formWeights] of Object.entries(weightForms)) {
      const parts = allocate(amount, formWeights, { remainder: strategy });
      const actual = parts.map((part) => String(part.minor)).join();
      if (actual !== expected) {
        mismatches.push(
          `${amountMinor} by [${weights}] ${strategy} (${form}): ${actual}, expected ${expected}`,
        );
      }
    }
  }
  return mismatches;
}

type InstalmentMode = 'first' | 'last' | 'toFirst' | 'toLast';

function checkInstalments(row: Row): string[] {
  const total = row['total'] as string;
  const count = row['count'] as number;
  const unit = row['unit'] as string;
  const mismatches: string[] = [];
  for (const mode of ['first', 'last', 'toFirst', 'toLast'] as InstalmentMode[]) {
    const parts = instalments(eur(total), count, { unit: eur(unit), remainder: mode });
    const actual = minors(parts).join();
    if (actual !== (row[mode] as string[]).join()) {
      mismatches.push(`${total} x${count} unit ${unit} ${mode}: ${actual}`);
    }
  }
  return mismatches;
}

function checkChunk(row: Row): string[] {
  const total = row['total'] as string;
  const max = row['max'] as string;
  const actual = minors(chunk(eur(total), eur(max))).join();
  return actual === (row['chunks'] as string[]).join() ? [] : [`${total} by ${max}: ${actual}`];
}

type TrancheRow = { amount: string } | { percent: string; cap?: string } | { rest: true };

function checkSchedule(row: Row): string[] {
  const rowTranches = row['tranches'] as TrancheRow[];
  const tranches: Tranche<'EUR'>[] = rowTranches.map((tranche) => {
    if ('amount' in tranche) {
      return { amount: eur(tranche.amount) };
    }
    if ('percent' in tranche) {
      return tranche.cap === undefined
        ? { percent: tranche.percent }
        : { percent: tranche.percent, cap: eur(tranche.cap) };
    }
    return { rest: true };
  });

  let actual: string;
  try {
    actual = minors(schedule(eur(row['total'] as string), tranches)).join();
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    actual = 'throws';
  }
  const result = row['result'] as string[] | null;
  const expected = result === null ? 'throws' : result.join();
  if (actual === expected) {
    return [];
  }
  return [`${row['total']} ${JSON.stringify(rowTranches)}: ${actual}, expected ${expected}`];
}

function hasBothOutcomes(rows: readonly Row[], field: string): string[] {
  const throwing = rows.some((row) => row[field] === null);
  const returning = rows.some((row) => row[field] !== null);
  return throwing && returning ? [] : [`expected rows that throw and rows that return (${field})`];
}

// --- cash --------------------------------------------------------------------------------------------

function checkIncrement(row: Row): string[] {
  const amount = row['amount'] as string;
  const step = row['step'] as string;
  const mismatches: string[] = [];
  for (const mode of ROUNDING_MODES) {
    let actual: string | null;
    try {
      actual = String(roundToIncrement(eur(amount), eur(step), mode).minor);
    } catch (error) {
      if (!(error instanceof RoundingError)) {
        throw error;
      }
      actual = null;
    }
    if (actual !== row[mode]) {
      mismatches.push(`${amount} to ${step} ${mode}: ${actual}`);
    }
  }
  return mismatches;
}

// --- Excel's XNPV and XIRR -----------------------------------------------------------------------------

/** The rows' day numbers count from this date. */
const DAY_ZERO = Date.UTC(2001, 0, 1);
const dateOf = (day: number): string =>
  new Date(DAY_ZERO + day * 86_400_000).toISOString().slice(0, 10);

function flowsOf(row: Row): { values: Money[]; dates: string[] } {
  const currency = row['currency'] as string;
  return {
    values: (row['values'] as string[]).map((minor): Money => fromMinor(BigInt(minor), currency)),
    dates: (row['days'] as number[]).map(dateOf),
  };
}

const fraction = (value: Ratio): string => `${value.num}/${value.den}`;

/** The result, or null where it throws a RangeError. */
function attempt<T>(run: () => T): T | null {
  try {
    return run();
  } catch (error) {
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }
}

function checkXnpv(row: Row, index: number): string[] {
  const { values, dates } = flowsOf(row);
  const [numerator, denominator] = row['rate'] as [string, string];
  const rate = ratio(BigInt(numerator), BigInt(denominator));
  const mismatches: string[] = [];

  const bounds = attempt(() =>
    xnpvBounds(rate, values, dates, { digits: row['digits'] as number }),
  );
  const actualBounds =
    bounds === null
      ? null
      : { lower: fraction(bounds.lower), upper: fraction(bounds.upper), exact: bounds.exact };
  if (JSON.stringify(actualBounds) !== JSON.stringify(row['bounds'])) {
    mismatches.push(`row ${index} bounds: ${JSON.stringify(actualBounds)}`);
  }

  const rounded = row['rounded'] as Partial<Record<RoundingMode, string | null>>;
  for (const [mode, want] of Object.entries(rounded)) {
    const result = attempt(() => xnpv(rate, values, dates, {}, mode as RoundingMode));
    const actual = result === null ? null : result.toMinor().toString();
    if (actual !== want) {
      mismatches.push(`row ${index} ${mode}: ${actual} != ${want}`);
    }
  }
  return mismatches;
}

function checkXirr(row: Row, index: number): string[] {
  const { values, dates } = flowsOf(row);
  const result = attempt(() => xirr(values, dates, { digits: row['digits'] as number }));
  const actual = result === null ? null : BigInt(result.lower.replace('.', '')).toString();
  return actual === row['lower'] ? [] : [`row ${index}: ${actual}, expected ${row['lower']}`];
}

// --- money in minor units, from Python's decimal -----------------------------------------------------

/** The amount in minor units at its own scale. */
const minorOf = (amount: Money): string => amount.toScaledUnits().toString();

/** One minor.* operation: ducat's results by field name, compared exactly with the row's. */
function minorOperation(compute: (amount: Money, row: Row) => Record<string, string>) {
  return {
    checkRow(row: Row): string[] {
      const amount = fromMinor(BigInt(row['minor'] as string), row['currency'] as string);
      const actual = compute(amount, row);
      const differs = Object.entries(actual).some(([field, value]) => row[field] !== value);
      return differs ? [`${JSON.stringify(row)} -> got ${JSON.stringify(actual)}`] : [];
    },
  };
}

const modeOf = (row: Row) => row['mode'] as RoundingMode;
const text = (row: Row, field: string) => row[field] as string;

export const TABLE_OPERATIONS: Record<string, TableOperation> = {
  'allocate.byRemainder': { checkRow: checkAllocation },
  'instalments.byRemainder': { checkRow: checkInstalments },
  chunk: { checkRow: checkChunk },
  schedule: {
    checkRow: checkSchedule,
    checkTable: (rows) => hasBothOutcomes(rows, 'result'),
  },
  'roundToIncrement.byMode': { checkRow: checkIncrement },
  'xnpv.scaled': { checkRow: checkXnpv },
  'minor.multiply': minorOperation((amount, row) => ({
    want: minorOf(multiply(amount, text(row, 'factor'), modeOf(row))),
  })),
  'minor.divide': minorOperation((amount, row) => ({
    want: minorOf(divide(amount, text(row, 'divisor'), modeOf(row))),
  })),
  'minor.toScale': minorOperation((amount, row) => ({
    want: minorOf(toScale(amount, row['scale'] as number, modeOf(row))),
  })),
  'minor.convert': minorOperation((amount, row) => ({
    want: minorOf(convert(amount, text(row, 'to'), text(row, 'rate'), modeOf(row))),
  })),
  'minor.percentage': minorOperation((amount, row) => ({
    want: minorOf(percentage(amount, text(row, 'percent'), modeOf(row))),
  })),
  'minor.discount': minorOperation((amount, row) => ({
    want: minorOf(discount(amount, text(row, 'percent'), modeOf(row))),
  })),
  'minor.addTax': minorOperation((amount, row) => {
    const breakdown = addTax(amount, text(row, 'percent'), modeOf(row));
    return { tax: minorOf(breakdown.tax), gross: minorOf(breakdown.gross) };
  }),
  'minor.extractTax': minorOperation((amount, row) => {
    const breakdown = extractTax(amount, text(row, 'percent'), modeOf(row));
    return { net: minorOf(breakdown.net), tax: minorOf(breakdown.tax) };
  }),
  'xirr.floor': {
    checkRow: checkXirr,
    checkTable: (rows) => {
      const returning = rows.filter((row) => row['lower'] !== null).length;
      return returning > 20 ? [] : [`only ${returning} rows with a rate`];
    },
  },
};
