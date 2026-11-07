// test/fixtures/allocate.oracle.json is printed by proofs/Oracle.lean from the allocation model whose
// properties are proved in proofs/Ducat/Allocate.lean (regenerate with `pnpm gen:kernel`). The TypeScript,
// on its number fast path and on its bigint path, must give exactly the model's answer for every case.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allocate, fromMinor, money, type Remainder } from '../src/fn.js';

type OracleCase = { amount: string; weights: string[] } & Record<Remainder, string[]>;

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/allocate.oracle.json', import.meta.url), 'utf8'),
);
const cases: OracleCase[] = fixture.cases;
const STRATEGIES: Remainder[] = ['largest', 'first', 'last', 'toFirst', 'toLast'];

describe('allocate matches the proved Lean model', () => {
  it('has enough cases', () => {
    expect(cases.length).toBeGreaterThan(1000);
  });

  for (const strategy of STRATEGIES) {
    it(`remainder: '${strategy}'`, () => {
      const mismatches: string[] = [];
      for (const oracleCase of cases) {
        const amount = fromMinor(BigInt(oracleCase.amount), 'EUR');
        const expected = oracleCase[strategy].join();
        // number weights take the fast path when the products fit in a double; bigint and decimal-string
        // weights always take the bigint path
        const weightForms = {
          number: oracleCase.weights.map(Number),
          bigint: oracleCase.weights.map(BigInt),
          decimal: oracleCase.weights.map((weight) => `${weight}.0`),
        };
        for (const [form, weights] of Object.entries(weightForms)) {
          const parts = allocate(amount, weights, { remainder: strategy });
          const actual = parts.map((part) => String(part.minor)).join();
          if (actual !== expected) {
            mismatches.push(
              `${oracleCase.amount} by [${oracleCase.weights}] (${form}): ${actual}, expected ${expected}`,
            );
          }
        }
      }
      expect(mismatches.slice(0, 5)).toEqual([]);
    });
  }

  it('reads as expected on a familiar case', () => {
    const parts = allocate(money('100', 'EUR'), [1, 1, 1]);
    expect(parts.map(String)).toEqual(['33.34 EUR', '33.33 EUR', '33.33 EUR']);
  });
});
