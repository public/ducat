// Reference vectors computed by Python's decimal module (scripts/gen-pydecimal-vectors.py): a
// second implementation of decimal arithmetic, independent of both ducat and decimal.js.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addTax,
  convert,
  discount,
  divide,
  extractTax,
  fromMinor,
  multiply,
  percentage,
  toScale,
  type Money,
  type RoundingMode,
} from '../src/fn.js';

interface VectorCase {
  op: string;
  currency: string;
  minor: string;
  mode: RoundingMode;
  factor?: string;
  divisor?: string;
  scale?: number;
  to?: string;
  rate?: string;
  percent?: string;
  /** minor units; tax operations give two values */
  want: string | [string, string];
}

const vectorPath = join(import.meta.dirname, 'vectors', 'pydecimal.json');
const { cases } = JSON.parse(readFileSync(vectorPath, 'utf8')) as { cases: VectorCase[] };

function minorOf(amount: Money): string {
  return amount.toScaledUnits().toString();
}

function computeWithDucat(vector: VectorCase): string | [string, string] {
  const amount = fromMinor(BigInt(vector.minor), vector.currency);
  const mode = vector.mode;

  switch (vector.op) {
    case 'multiply':
      return minorOf(multiply(amount, vector.factor!, mode));
    case 'divide':
      return minorOf(divide(amount, vector.divisor!, mode));
    case 'toScale':
      return minorOf(toScale(amount, vector.scale!, mode));
    case 'convert':
      return minorOf(convert(amount, vector.to!, vector.rate!, mode));
    case 'percentage':
      return minorOf(percentage(amount, vector.percent!, mode));
    case 'discount':
      return minorOf(discount(amount, vector.percent!, mode));
    case 'addTax': {
      const breakdown = addTax(amount, vector.percent!, mode);
      return [minorOf(breakdown.tax), minorOf(breakdown.gross)];
    }
    case 'extractTax': {
      const breakdown = extractTax(amount, vector.percent!, mode);
      return [minorOf(breakdown.net), minorOf(breakdown.tax)];
    }
  }
  throw new Error(`Unknown operation ${vector.op}`);
}

describe('Python decimal reference vectors', () => {
  const operations = [...new Set(cases.map((vector) => vector.op))];

  it('cover every operation and rounding mode', () => {
    expect(operations.toSorted()).toEqual([
      'addTax',
      'convert',
      'discount',
      'divide',
      'extractTax',
      'multiply',
      'percentage',
      'toScale',
    ]);
    const modes = new Set(cases.map((vector) => vector.mode));
    expect(modes.size).toBe(9);
  });

  it.each(operations)('%s', (operation) => {
    const mismatches: string[] = [];
    for (const vector of cases.filter((candidate) => candidate.op === operation)) {
      const actual = JSON.stringify(computeWithDucat(vector));
      if (actual !== JSON.stringify(vector.want)) {
        mismatches.push(`${JSON.stringify(vector)} -> got ${actual}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
