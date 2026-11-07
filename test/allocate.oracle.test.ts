// test/fixtures/allocate.oracle.json is printed by proofs/Oracle.lean from the allocation model whose
// properties are proved in proofs/Ducat/Allocate.lean (`npm run gen:kernel`). Here the TypeScript, on both its
// number fast path and its bigint path, must give exactly the model's answer.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allocate, fromMinor, money, type Remainder } from '../src/index.js';

interface Case {
  x: string;
  w: string[];
  largest: string[];
  first: string[];
  last: string[];
  toFirst: string[];
  toLast: string[];
}

const cases: Case[] = JSON.parse(readFileSync(new URL('./fixtures/allocate.oracle.json', import.meta.url), 'utf8'));
const STRATEGIES: Remainder[] = ['largest', 'first', 'last', 'toFirst', 'toLast'];

describe('allocate matches the proved Lean model', () => {
  it('has cases', () => expect(cases.length).toBeGreaterThan(1000));

  for (const s of STRATEGIES)
    it(`remainder: '${s}'`, () => {
      let bad = 0;
      for (const c of cases) {
        const x = BigInt(c.x);
        const m = fromMinor(x, 'EUR');
        const want = c[s];
        // number weights take the fast path when they fit; bigint and string weights the bigint path
        const asNumber = c.w.map(Number);
        const asBig = c.w.map(BigInt);
        const asString = c.w.map((w) => `${w}.0`);
        for (const ws of [asNumber, asBig, asString]) {
          const got = allocate(m, ws, { remainder: s }).map((p) => String(p.minor));
          if (got.join() !== want.join() && bad++ < 3) expect({ c: c.x, w: c.w, got }).toEqual({ c: c.x, w: c.w, got: want });
        }
      }
      expect(bad).toBe(0);
    });

  it('a sample case reads as expected', () => {
    expect(allocate(money('100', 'EUR'), [1, 1, 1]).map(String)).toEqual(['EUR 33.34', 'EUR 33.33', 'EUR 33.33']);
  });
});
