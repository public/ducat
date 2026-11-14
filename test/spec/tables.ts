// ducat's side of each table operation in @ducatjs/money-spec (spec/README.md, "Table operations").
// Each one checks every row of a table and returns the mismatches; test/spec.test.ts runs them.
// Where ducat has several input forms for the same value (number, bigint and decimal-string
// weights), every form is checked, since each takes its own code path.
// every ISO 4217 code: these build Money from /fn-level modules, which don't register them
import '../../src/plugins/iso.js';
import { ratio, type Ratio } from '../../src/decimal.js';
import { spellOut, type SpelloutRules } from '../../src/rbnf.js';
import { german } from '../../src/words/de.js';
import { english } from '../../src/words/en.js';
import { spanish } from '../../src/words/es.js';
import { french } from '../../src/words/fr.js';
import { italian } from '../../src/words/it.js';
import { dutch } from '../../src/words/nl.js';
import { portuguese } from '../../src/words/pt.js';
import { xirr, xnpv, xnpvBounds } from '../../src/excel.js';
import {
  addTaxExact,
  exact,
  extractTaxExact,
  multiplyExact,
  type ExactMoney,
} from '../../src/exact.js';
import { convertDetailed } from '../../src/convert.js';
import { discountedSumExact, interestExact, type DayCount } from '../../src/finance.js';
import {
  average,
  divideToIntegral,
  ratioAdd,
  ratioCompare,
  ratioComplement,
  ratioDivide,
  ratioMultiply,
  ratioNegate,
  ratioOf,
  ratioSubtract,
  remainder,
  trimScale,
} from '../../src/math.js';
import { assertScale, roundingPolicy } from '../../src/policy.js';
import { priceEnding, tieredPrice, type PriceTier, type TiersMode } from '../../src/pricing.js';
import { exchangeRate, type Rate } from '../../src/rate.js';
import {
  addTax,
  allocate,
  chunk,
  convert,
  CurrencyMismatchError,
  discount,
  divide,
  extractTax,
  fromMinor,
  instalments,
  multiply,
  percentage,
  round,
  roundToIncrement,
  RoundingError,
  schedule,
  toScale,
  type Money,
  type Remainder,
  type RoundingMode,
  type RoundingPolicy,
  type Tranche,
} from '../../src/fn.js';

type Row = Readonly<Record<string, unknown>>;

/** A table this runner checks row by row. */
export interface CheckedTable {
  /** the row fields that hold expected results (a corruption test changes them) */
  readonly expects: readonly string[];
  /** the mismatches in one row, described; `parameters` are the table's */
  checkRow(row: Row, index: number, parameters: Row): string[];
  /** checks on the table as a whole (that it has both throwing and returning rows, say) */
  checkTable?(rows: readonly Row[]): string[];
}

/**
 * A table whose rows an existing test file checks, with the comparison spec/README.md states for
 * the operation; the runner checks that the file exists and reads that vector file by name.
 */
export interface DelegatedTable {
  readonly runBy: string;
}

export type TableOperation = CheckedTable | DelegatedTable;

const FINANCE_ORACLE = 'test/finance.oracle.test.ts';
const EXCEL_ORACLE = 'test/excel.oracle.test.ts';
const EXCEL = 'test/excel.test.ts';

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
function minorOperation(
  expects: readonly string[],
  compute: (amount: Money, row: Row) => Record<string, string>,
): CheckedTable {
  return {
    expects,
    checkRow(row: Row): string[] {
      const amount = fromMinor(BigInt(row['minor'] as string), row['currency'] as string);
      const actual = compute(amount, row);
      const differs = Object.entries(actual).some(([field, value]) => row[field] !== value);
      return differs ? [`${JSON.stringify(row)} -> got ${JSON.stringify(actual)}`] : [];
    },
  };
}

const modeOf = (row: Row) => row['mode'] as RoundingMode;

// --- exact amounts and rates, from Python's fractions ------------------------------------------------

/** An exact value as the spec writes a rational: reduced `num/den`, or the integer alone. */
function rationalOf(num: bigint, den: bigint): string {
  return den === 1n ? String(num) : `${num}/${den}`;
}

const exactText = (amount: ExactMoney<string>) => rationalOf(amount.num, amount.den);

/** A table whose rows are compared field by field, as text; `null` stands for a RoundingError. */
function exactOperation(
  expects: readonly string[],
  compute: (row: Row) => Record<string, string | null>,
): CheckedTable {
  return {
    expects,
    checkRow(row: Row): string[] {
      const actual = compute(row);
      const differs = Object.entries(actual).some(([field, value]) => row[field] !== value);
      return differs ? [`${JSON.stringify(row)} -> got ${JSON.stringify(actual)}`] : [];
    },
  };
}

/** The money's decimal, or null for a RoundingError (no finite decimal form). */
function decimalOrNull(build: () => Money<string>): string | null {
  try {
    return build().toDecimal();
  } catch (error) {
    if (error instanceof RoundingError) {
      return null;
    }
    throw error;
  }
}

/** The chain of rates along `via`: rates[i] takes via[i] to via[i + 1]. */
function chainOf(row: Row): Rate<string, string> {
  const via = row['via'] as string[];
  const rates = (row['rates'] as string[]).map((rate, index) =>
    exchangeRate(via[index]!, via[index + 1]!, rate),
  );
  return rates.slice(1).reduce((chain, next) => chain.andThen(next), rates[0]!);
}
const text = (row: Row, field: string) => row[field] as string;

// --- rounding policies, pricing and math, from Python's fractions ------------------------------------

/** A decimal in major units as Money at the scale its fraction digits give ('12.340' is scale 3). */
function moneyOf(amount: string, currency: string): Money<string> {
  const [whole, places = ''] = amount.split('.');
  return fromMinor(BigInt(`${whole}${places}`), currency, places.length);
}

function policyOf(row: Row): RoundingPolicy {
  const options = row['policy'] as {
    scale?: number;
    increment: number;
    rounding: RoundingMode;
    currency?: string;
  };
  return roundingPolicy(options);
}

/** The result, or null where it throws an error of `kind` (the spec's null for that kind). */
function orNull<T>(kind: new (...args: never[]) => Error, run: () => T): T | null {
  try {
    return run();
  } catch (error) {
    if (error instanceof kind) {
      return null;
    }
    throw error;
  }
}

/** A table whose rows are compared field by field as JSON text. */
function fieldsOperation(
  expects: readonly string[],
  compute: (row: Row) => Record<string, unknown>,
): CheckedTable {
  return {
    expects,
    checkRow(row: Row): string[] {
      const actual = compute(row);
      const differs = Object.entries(actual).some(
        ([field, value]) => JSON.stringify(row[field]) !== JSON.stringify(value),
      );
      return differs ? [`${JSON.stringify(row)} -> got ${JSON.stringify(actual)}`] : [];
    },
  };
}

const amountOf = (row: Row, field = 'amount') => moneyOf(text(row, field), text(row, 'currency'));
const byPolicy = (run: () => Money<string>) =>
  orNull(CurrencyMismatchError, () => run().toDecimal());
const ratioText = ({ num, den }: Ratio) => rationalOf(num, den);

function checkTiered(row: Row): Record<string, unknown> {
  const currency = text(row, 'currency');
  const tiers = (row['tiers'] as Row[]).map((tier): PriceTier<string> => {
    const priced: { upTo: string | null; unitAmount?: Money; flatAmount?: Money } = {
      upTo: tier['upTo'] as string | null,
    };
    if (tier['unitAmount'] !== undefined) {
      priced.unitAmount = moneyOf(tier['unitAmount'] as string, currency);
    }
    if (tier['flatAmount'] !== undefined) {
      priced.flatAmount = moneyOf(tier['flatAmount'] as string, currency);
    }
    return priced;
  });
  const result = orNull(RangeError, () =>
    tieredPrice(text(row, 'quantity'), {
      mode: row['mode'] as TiersMode,
      tiers,
      rounding: row['rounding'] as RoundingMode,
      ...(row['beyondLastTier'] === undefined
        ? {}
        : { beyondLastTier: row['beyondLastTier'] as 'throw' | 'cap' }),
      ...(row['chargeQuantity'] === undefined
        ? {}
        : { chargeQuantity: row['chargeQuantity'] as string }),
    }),
  );
  if (result === null) {
    return { total: null, exact: null, lines: null };
  }
  return {
    total: String(result.total.minor),
    exact: exactText(result.exact),
    lines: result.lines.map((line) => ({
      tier: line.tier,
      quantity: line.quantity,
      exact: exactText(line.exact),
      amount: String(line.amount.minor),
    })),
  };
}

// --- spelling out numbers, from ICU ------------------------------------------------------------------

const SPELLOUT_RULES: Record<string, SpelloutRules> = {
  en: english,
  de: german,
  fr: french,
  es: spanish,
  it: italian,
  pt: portuguese,
  nl: dutch,
};

function checkSpellOut(row: Row, _index: number, parameters: Row): string[] {
  const locale = parameters['locale'] as string;
  const ruleSet = parameters['ruleSet'] as string;
  const number = row['number'] as string;
  const actual = spellOut(BigInt(number), SPELLOUT_RULES[locale]!, ruleSet);
  return actual === row['words'] ? [] : [`${locale} ${ruleSet} ${number}: ${actual}`];
}

export const TABLE_OPERATIONS: Record<string, TableOperation> = {
  'allocate.byRemainder': { expects: REMAINDERS, checkRow: checkAllocation },
  'instalments.byRemainder': {
    expects: ['first', 'last', 'toFirst', 'toLast'],
    checkRow: checkInstalments,
  },
  chunk: { expects: ['chunks'], checkRow: checkChunk },
  schedule: {
    expects: ['result'],
    checkRow: checkSchedule,
    checkTable: (rows) => hasBothOutcomes(rows, 'result'),
  },
  'roundToIncrement.byMode': { expects: ROUNDING_MODES, checkRow: checkIncrement },
  'xnpv.scaled': { expects: ['bounds', 'rounded'], checkRow: checkXnpv },
  'exact.divideRound': exactOperation(['rounded', 'residual'], (row) => {
    const amount = fromMinor(BigInt(text(row, 'minor')), text(row, 'currency'));
    const { value, residual } = exact(amount)
      .divide(text(row, 'divisor'))
      .roundWithResidual(modeOf(row));
    return { rounded: String(value.minor), residual: exactText(residual) };
  }),
  'exact.toMoney': exactOperation(['money'], (row) => ({
    money: decimalOrNull(() =>
      exact(fromMinor(BigInt(text(row, 'num')), text(row, 'currency'), 0))
        .divide(text(row, 'den'))
        .toMoney(),
    ),
  })),
  'exact.addTax': exactOperation(['tax', 'gross'], (row) => {
    const amount = fromMinor(BigInt(text(row, 'minor')), text(row, 'currency'));
    const { tax, gross } = addTaxExact(amount, text(row, 'percent'));
    return { tax: exactText(tax), gross: exactText(gross) };
  }),
  'exact.extractTax': exactOperation(['net', 'tax'], (row) => {
    const amount = fromMinor(BigInt(text(row, 'minor')), text(row, 'currency'));
    const { net, tax } = extractTaxExact(amount, text(row, 'percent'));
    return { net: exactText(net), tax: exactText(tax) };
  }),
  'exact.multiplyExact': exactOperation(['want'], (row) => ({
    want: decimalOrNull(() =>
      multiplyExact(
        fromMinor(BigInt(text(row, 'minor')), text(row, 'currency')),
        text(row, 'factor'),
      ),
    ),
  })),
  'rate.inverse': exactOperation(['inverse'], (row) => {
    const { num, den } = exchangeRate('EUR', 'USD', text(row, 'rate')).inverse().ratio;
    return { inverse: rationalOf(num, den) };
  }),
  'rate.chain': exactOperation(['composite'], (row) => {
    const { num, den } = chainOf(row).ratio;
    return { composite: rationalOf(num, den) };
  }),
  'rate.convert': exactOperation(['want', 'residual'], (row) => {
    const via = row['via'] as string[];
    const amount = fromMinor(BigInt(text(row, 'minor')), via[0]!);
    const { value, residual } = convertDetailed(amount, chainOf(row), modeOf(row));
    return { want: String(value.minor), residual: exactText(residual) };
  }),
  'minor.multiply': minorOperation(['want'], (amount, row) => ({
    want: minorOf(multiply(amount, text(row, 'factor'), modeOf(row))),
  })),
  'minor.divide': minorOperation(['want'], (amount, row) => ({
    want: minorOf(divide(amount, text(row, 'divisor'), modeOf(row))),
  })),
  'minor.toScale': minorOperation(['want'], (amount, row) => ({
    want: minorOf(toScale(amount, row['scale'] as number, modeOf(row))),
  })),
  'minor.convert': minorOperation(['want'], (amount, row) => ({
    want: minorOf(convert(amount, text(row, 'to'), text(row, 'rate'), modeOf(row))),
  })),
  'minor.percentage': minorOperation(['want'], (amount, row) => ({
    want: minorOf(percentage(amount, text(row, 'percent'), modeOf(row))),
  })),
  'minor.discount': minorOperation(['want'], (amount, row) => ({
    want: minorOf(discount(amount, text(row, 'percent'), modeOf(row))),
  })),
  'minor.addTax': minorOperation(['tax', 'gross'], (amount, row) => {
    const breakdown = addTax(amount, text(row, 'percent'), modeOf(row));
    return { tax: minorOf(breakdown.tax), gross: minorOf(breakdown.gross) };
  }),
  'minor.extractTax': minorOperation(['net', 'tax'], (amount, row) => {
    const breakdown = extractTax(amount, text(row, 'percent'), modeOf(row));
    return { net: minorOf(breakdown.net), tax: minorOf(breakdown.tax) };
  }),
  'finance.yearFraction': { runBy: FINANCE_ORACLE },
  'finance.interest': { runBy: FINANCE_ORACLE },
  'finance.compound': { runBy: FINANCE_ORACLE },
  'finance.amortise': { runBy: FINANCE_ORACLE },
  'finance.npv': { runBy: FINANCE_ORACLE },
  'finance.irr': { runBy: FINANCE_ORACLE },
  'finance.irrBracketed': { runBy: FINANCE_ORACLE },
  'finance.proration': { runBy: FINANCE_ORACLE },
  'finance.paymentDates': { runBy: FINANCE_ORACLE },
  'excel.annuities': { runBy: EXCEL_ORACLE },
  'excel.nper': { runBy: EXCEL_ORACLE },
  'excel.rate': { runBy: EXCEL_ORACLE },
  'excel.xnpv': { runBy: EXCEL_ORACLE },
  'excel.xirr': { runBy: EXCEL_ORACLE },
  'spreadsheet.npv': { runBy: EXCEL },
  'spreadsheet.irr': { runBy: EXCEL },
  'spreadsheet.periodicRate': { runBy: EXCEL },
  'spreadsheet.annualRate': { runBy: EXCEL },
  'spreadsheet.fv': { runBy: EXCEL },
  'spreadsheet.pv': { runBy: EXCEL },
  'spreadsheet.pmt': { runBy: EXCEL },
  'spreadsheet.nper': { runBy: EXCEL },
  'spreadsheet.rate': { runBy: EXCEL },
  'spreadsheet.xnpv': { runBy: EXCEL },
  'spreadsheet.xirr': { runBy: EXCEL },
  'spreadsheet.edge.fv': { runBy: EXCEL },
  'spreadsheet.edge.pv': { runBy: EXCEL },
  'spreadsheet.edge.pmt': { runBy: EXCEL },
  'spreadsheet.edge.nper': { runBy: EXCEL },
  'spreadsheet.edge.rate': { runBy: EXCEL },
  'spreadsheet.edge.xnpv': { runBy: EXCEL },
  'spreadsheet.edge.xirr': { runBy: EXCEL },
  'excelExample.npv': { runBy: EXCEL },
  'excelExample.irr': { runBy: EXCEL },
  'excelExample.rri': { runBy: EXCEL },
  'excelExample.effect': { runBy: EXCEL },
  'excelExample.fv': { runBy: EXCEL },
  'excelExample.pv': { runBy: EXCEL },
  'excelExample.pmt': { runBy: EXCEL },
  'excelExample.nper': { runBy: EXCEL },
  'excelExample.rate': { runBy: EXCEL },
  'excelExample.xnpv': { runBy: EXCEL },
  'excelExample.xirr': { runBy: EXCEL },
  'words.spellOut': { expects: ['words'], checkRow: checkSpellOut },
  'policy.multiply': fieldsOperation(['want'], (row) => ({
    want: byPolicy(() => multiply(amountOf(row), text(row, 'factor'), policyOf(row))),
  })),
  'policy.divide': fieldsOperation(['want'], (row) => ({
    want: byPolicy(() => divide(amountOf(row), text(row, 'divisor'), policyOf(row))),
  })),
  'policy.round': fieldsOperation(['want'], (row) => ({
    want: byPolicy(() => round(amountOf(row), policyOf(row))),
  })),
  'policy.convert': fieldsOperation(['want'], (row) => ({
    want: byPolicy(() => convert(amountOf(row), text(row, 'to'), text(row, 'rate'), policyOf(row))),
  })),
  'policy.tax': fieldsOperation(['percentage', 'discount', 'addTax', 'extractTax'], (row) => {
    const amount = amountOf(row);
    const percent = text(row, 'percent');
    const policy = policyOf(row);
    return {
      percentage: byPolicy(() => percentage(amount, percent, policy)),
      discount: byPolicy(() => discount(amount, percent, policy)),
      addTax: orNull(CurrencyMismatchError, () => {
        const { tax, gross } = addTax(amount, percent, policy);
        return { tax: tax.toDecimal(), gross: gross.toDecimal() };
      }),
      extractTax: orNull(CurrencyMismatchError, () => {
        const { net, tax } = extractTax(amount, percent, policy);
        return { net: net.toDecimal(), tax: tax.toDecimal() };
      }),
    };
  }),
  'policy.exactRound': fieldsOperation(['want', 'residual'], (row) => {
    const amount = exact(fromMinor(BigInt(text(row, 'num')), text(row, 'currency'), 0)).divide(
      text(row, 'den'),
    );
    const rounded = orNull(CurrencyMismatchError, () => amount.roundWithResidual(policyOf(row)));
    return {
      want: rounded === null ? null : rounded.value.toDecimal(),
      residual: rounded === null ? null : exactText(rounded.residual),
    };
  }),
  'policy.check': fieldsOperation(['valid'], (row) => ({
    valid: orNull(RangeError, () => (assertScale(amountOf(row), policyOf(row)), true)) ?? false,
  })),
  'pricing.priceEnding': fieldsOperation(['want'], (row) => {
    const rule = priceEnding({
      ending: text(row, 'ending'),
      step: text(row, 'step'),
      rounding: modeOf(row),
    });
    return { want: orNull(RangeError, () => rule(amountOf(row)).toDecimal()) };
  }),
  'pricing.tiered': fieldsOperation(['total', 'exact', 'lines'], checkTiered),
  'math.average': fieldsOperation(['want'], (row) => ({
    want: average(
      (row['amounts'] as string[]).map((amount) => moneyOf(amount, text(row, 'currency'))),
      modeOf(row),
    ).toDecimal(),
  })),
  'math.ratioOf': fieldsOperation(['ratio'], (row) => ({
    ratio: orNull(RangeError, () => ratioText(ratioOf(amountOf(row), amountOf(row, 'other')))),
  })),
  'math.divideToIntegral': fieldsOperation(['quotient', 'remainder'], (row) => {
    const [amount, divisor] = [amountOf(row), amountOf(row, 'divisor')];
    return {
      quotient: orNull(RangeError, () => String(divideToIntegral(amount, divisor))),
      remainder: orNull(RangeError, () => remainder(amount, divisor).toDecimal()),
    };
  }),
  'math.trimScale': fieldsOperation(['want'], (row) => ({
    want: trimScale(amountOf(row), row['minimumScale'] as number | undefined).toDecimal(),
  })),
  'math.ratio': fieldsOperation(
    ['sum', 'difference', 'product', 'quotient', 'compare', 'negation', 'complement'],
    (row) => {
      const [left, right] = [text(row, 'left'), text(row, 'right')];
      return {
        sum: ratioText(ratioAdd(left, right)),
        difference: ratioText(ratioSubtract(left, right)),
        product: ratioText(ratioMultiply(left, right)),
        quotient: orNull(RangeError, () => ratioText(ratioDivide(left, right))),
        compare: ratioCompare(left, right),
        negation: ratioText(ratioNegate(left)),
        complement: ratioText(ratioComplement(left)),
      };
    },
  ),
  'finance.interestExact': fieldsOperation(['want'], (row) => {
    const principal = fromMinor(BigInt(text(row, 'principal')), text(row, 'currency'));
    const period = {
      from: text(row, 'from'),
      to: text(row, 'to'),
      dayCount: row['dayCount'] as DayCount,
      ...(row['maturity'] === undefined ? {} : { maturity: row['maturity'] as boolean }),
    };
    return { want: exactText(interestExact(principal, text(row, 'rate'), period)) };
  }),
  'finance.discountedSumExact': fieldsOperation(['want'], (row) => {
    const flows = (row['flows'] as string[]).map((flow) =>
      fromMinor(BigInt(flow), text(row, 'currency')),
    );
    return {
      want: orNull(RangeError, () => exactText(discountedSumExact(text(row, 'rate'), flows))),
    };
  }),
  'xirr.floor': {
    expects: ['lower'],
    checkRow: checkXirr,
    checkTable: (rows) => {
      const returning = rows.filter((row) => row['lower'] !== null).length;
      return returning > 20 ? [] : [`only ${returning} rows with a rate`];
    },
  },
};
