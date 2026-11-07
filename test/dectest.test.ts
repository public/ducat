// General Decimal Arithmetic test cases (IEEE 754-2008 decimal; the suite behind Python's decimal
// and IBM's decNumber), run against ducat. `npm run fetch:dectest` downloads the pinned files.
//
// A decTest case rounds to a precision (significant digits); ducat rounds to a scale. The two agree
// at the result's own exponent: if r is the correctly rounded result with exponent q, then r is
// also the exact value rounded once at exponent q, even when rounding carried into a new digit
// (99995 -> 1.000E+5). So each case runs in ducat at scale -q with the same rounding mode, and must
// give r exactly. Cases are skipped when ducat has no equivalent: special values, exponents above 0
// (a negative scale), clamping, 05up rounding, or results the spec flags as overflow, underflow,
// subnormal or invalid.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  add,
  convert,
  divide,
  money,
  multiply,
  negate,
  ratio,
  RoundingError,
  subtract,
  toScale,
  type Money,
  type RoundingMode,
} from '../src/index.js';

const VECTOR_DIRECTORY = join(import.meta.dirname, 'vectors', 'dectest');

/** decTest rounding names and ducat's; 05up has no ducat equivalent */
const DUCAT_MODES: Record<string, RoundingMode> = {
  half_up: 'halfExpand',
  half_down: 'halfTrunc',
  half_even: 'halfEven',
  up: 'expand',
  down: 'trunc',
  ceiling: 'ceil',
  floor: 'floor',
};

/** cases needing a larger scale than this are skipped (the suite probes exponents to +-999) */
const MAX_SCALE = 60;

/** conditions that still leave an exact, finite result ducat can be compared against */
const ACCEPTED_CONDITIONS = new Set(['Inexact', 'Rounded']);

interface DecimalNumber {
  /** signed coefficient */
  coefficient: bigint;
  exponent: number;
}

interface TestCase {
  id: string;
  operation: string;
  left: DecimalNumber;
  right: DecimalNumber;
  expected: DecimalNumber;
  mode: RoundingMode;
  isInexact: boolean;
}

/** A finite decTest number (1.23E+4, -0.00, 12) as coefficient and exponent; null for specials. */
function parseNumber(text: string): DecimalNumber | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) {
    return null;
  }

  const [, sign, integerDigits, fractionDigits = '', exponentText = '0'] = match;
  if (integerDigits === '' && fractionDigits === '') {
    return null;
  }

  const magnitude = BigInt((integerDigits || '0') + fractionDigits);
  return {
    coefficient: sign === '-' ? -magnitude : magnitude,
    exponent: Number(exponentText) - fractionDigits.length,
  };
}

/** A plain decimal string with exactly `scale` decimals; needs exponent >= -scale. */
function toPlainString(value: DecimalNumber, scale: number): string {
  const isNegative = value.coefficient < 0n;
  const magnitude = isNegative ? -value.coefficient : value.coefficient;
  const scaled = magnitude * 10n ** BigInt(value.exponent + scale);

  let digits = scaled.toString().padStart(scale + 1, '0');
  if (scale > 0) {
    digits = digits.slice(0, -scale) + '.' + digits.slice(-scale);
  }
  return isNegative ? '-' + digits : digits;
}

/** The number of decimals needed to write a value exactly. */
function scaleOf(value: DecimalNumber): number {
  return Math.max(0, -value.exponent);
}

function moneyAtScale(value: DecimalNumber, scale: number): Money {
  return money(toPlainString(value, scale), 'EUR', { scale });
}

/** The line without its "--" comment; a "--" inside a quoted operand such as '--1' is kept. */
function withoutComment(line: string): string {
  let isQuoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === "'" || character === '"') {
      isQuoted = !isQuoted;
    } else if (!isQuoted && character === '-' && line[index + 1] === '-') {
      return line.slice(0, index);
    }
  }
  return line;
}

function removeQuotes(text: string): string {
  return text.replace(/^'|'$/g, '');
}

function isApplicable(values: (DecimalNumber | null)[], expected: DecimalNumber | null, conditions: string[]): boolean {
  if (values.some((value) => value === null) || expected === null) {
    return false;
  }
  if (expected.exponent > 0) {
    return false;
  }
  if (conditions.some((condition) => !ACCEPTED_CONDITIONS.has(condition))) {
    return false;
  }
  return [...values, expected].every((value) => Math.abs(value!.exponent) <= MAX_SCALE);
}

function loadCases(fileName: string): { cases: TestCase[]; skippedCount: number } {
  const cases: TestCase[] = [];
  let skippedCount = 0;
  let rounding = 'half_up';
  let clamp = 0;

  const text = readFileSync(join(VECTOR_DIRECTORY, fileName), 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = withoutComment(rawLine).trim();
    if (!line) {
      continue;
    }

    // directives such as "rounding: half_even" apply to the cases that follow
    const directive = /^(\w+):\s*(\S+)/.exec(line);
    if (directive) {
      const name = directive[1]!.toLowerCase();
      if (name === 'rounding') {
        rounding = directive[2]!.toLowerCase();
      }
      if (name === 'clamp') {
        clamp = Number(directive[2]);
      }
      continue;
    }

    const casePattern = /^(\S+)\s+(add|subtract|multiply|divide|quantize)\s+(\S+)\s+(\S+)\s+->\s+(\S+)\s*(.*)$/i;
    const parsed = casePattern.exec(line);
    if (!parsed) {
      continue;
    }

    const [, id, operation, leftText, rightText, expectedText, conditionText = ''] = parsed;
    const left = parseNumber(removeQuotes(leftText!));
    const right = parseNumber(removeQuotes(rightText!));
    const expected = parseNumber(removeQuotes(expectedText!));
    const conditions = conditionText.split(/\s+/).filter(Boolean);
    const mode = DUCAT_MODES[rounding];
    const isDivisionByZero = operation === 'divide' && right?.coefficient === 0n;

    if (!mode || clamp !== 0 || isDivisionByZero || !isApplicable([left, right], expected, conditions)) {
      skippedCount++;
      continue;
    }

    cases.push({
      id: id!,
      operation: operation!.toLowerCase(),
      left: left!,
      right: right!,
      expected: expected!,
      mode,
      isInexact: conditions.includes('Inexact'),
    });
  }
  return { cases, skippedCount };
}

/** Whether ducat computes this case with the operation itself rounding (so 'unnecessary' applies). */
function roundsDirectly(testCase: TestCase): boolean {
  if (testCase.operation === 'multiply') {
    return -testCase.expected.exponent >= scaleOf(testCase.left);
  }
  return true;
}

/** ducat's answer for a case, at the expected result's scale. */
function computeWithDucat(testCase: TestCase, mode: RoundingMode): Money {
  const { left, right } = testCase;
  const resultScale = -testCase.expected.exponent;
  const leftScale = scaleOf(left);
  const rightScale = scaleOf(right);
  const rightText = toPlainString(right, rightScale);

  switch (testCase.operation) {
    case 'add':
    case 'subtract': {
      const commonScale = Math.max(leftScale, rightScale);
      const leftMoney = moneyAtScale(left, commonScale);
      const rightMoney = moneyAtScale(right, commonScale);
      const exact = testCase.operation === 'add' ? add(leftMoney, rightMoney) : subtract(leftMoney, rightMoney);
      return toScale(exact, resultScale, mode);
    }

    case 'multiply': {
      // directly when the operand fits the result scale; otherwise an exact product, then one rounding
      if (resultScale >= leftScale) {
        return multiply(moneyAtScale(left, resultScale), rightText, mode);
      }
      const exactProduct = multiply(moneyAtScale(left, leftScale + rightScale), rightText, 'unnecessary');
      return toScale(exactProduct, resultScale, mode);
    }

    case 'divide': {
      if (resultScale >= leftScale) {
        return divide(moneyAtScale(left, resultScale), rightText, mode);
      }
      // a / b at a coarser scale than a: convert() rounds once to any scale, at a positive rate,
      // so a negative divisor moves its sign onto the dividend
      const isNegativeDivisor = right.coefficient < 0n;
      const dividend = moneyAtScale(left, leftScale);
      const signedDividend = isNegativeDivisor ? negate(dividend) : dividend;
      const divisorMagnitude = isNegativeDivisor ? rightText.slice(1) : rightText;
      return convert(signedDividend, 'EUR', ratio(1, divisorMagnitude), mode, { scale: resultScale });
    }

    case 'quantize':
      return toScale(moneyAtScale(left, leftScale), resultScale, mode);
  }
  throw new Error(`Unknown operation ${testCase.operation}`);
}

function describeOutcome(run: () => Money): string {
  try {
    return String(run().toMinor());
  } catch (error) {
    if (error instanceof RoundingError) {
      return 'RoundingError';
    }
    return `threw ${(error as Error).message}`;
  }
}

// the files fetch:dectest downloads; each describe is skipped until it has been run
const VECTOR_FILES = ['add.decTest', 'divide.decTest', 'multiply.decTest', 'quantize.decTest', 'rounding.decTest'];

// CI sets DUCAT_REQUIRE_DECTEST=1, so a failed or forgotten fetch fails instead of skipping
const isRequired = process.env.DUCAT_REQUIRE_DECTEST === '1';

describe('decTest files', () => {
  it.skipIf(!isRequired)('are all fetched', () => {
    const missing = VECTOR_FILES.filter((fileName) => !existsSync(join(VECTOR_DIRECTORY, fileName)));
    expect(missing).toEqual([]);
  });
});

for (const fileName of VECTOR_FILES) {
  const isFetched = existsSync(join(VECTOR_DIRECTORY, fileName));
  const { cases, skippedCount } = isFetched ? loadCases(fileName) : { cases: [], skippedCount: 0 };
  const summary = isFetched
    ? `${cases.length} cases, ${skippedCount} not applicable`
    : 'not fetched: run fetch:dectest';

  describe.skipIf(!isFetched)(`decTest ${fileName} (${summary})`, () => {
    it('every case gives the exact result', () => {
      expect(cases.length).toBeGreaterThan(0);

      const mismatches: string[] = [];
      for (const testCase of cases) {
        const outcome = describeOutcome(() => computeWithDucat(testCase, testCase.mode));
        const expected = String(testCase.expected.coefficient);
        if (outcome !== expected) {
          const exponent = testCase.expected.exponent;
          mismatches.push(`${testCase.id}: got ${outcome}, want ${expected}E${exponent}`);
        }
      }
      expect(mismatches).toEqual([]);
    });

    it("'unnecessary' gives the exact cases exactly and throws on the inexact ones", () => {
      const mismatches: string[] = [];
      for (const testCase of cases.filter(roundsDirectly)) {
        const outcome = describeOutcome(() => computeWithDucat(testCase, 'unnecessary'));
        const expected = testCase.isInexact ? 'RoundingError' : String(testCase.expected.coefficient);
        if (outcome !== expected) {
          mismatches.push(`${testCase.id}: got ${outcome}, want ${expected}`);
        }
      }
      expect(mismatches).toEqual([]);
    });
  });
}
