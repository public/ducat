// The fixtures in test/fixtures/ are printed by proofs/Oracle.lean from models whose properties are proved
// in proofs/Ducat/Schedule.lean (instalments, chunk, schedule) and proofs/Ducat/Cash.lean (rounding to an
// increment); regenerate them with `pnpm gen:kernel`. The TypeScript must give exactly the model's answer.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  chunk,
  fromMinor,
  instalments,
  roundToIncrement,
  RoundingError,
  schedule,
  type Money,
  type RoundingMode,
  type Tranche,
} from '../src/fn.js';

function fixture<T>(model: string): T[] {
  const url = new URL(`./fixtures/${model}.oracle.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')).cases;
}

const eur = (minor: string): Money<'EUR'> => fromMinor(BigInt(minor), 'EUR');
const minors = (parts: Money<string>[]): string[] => parts.map((part) => String(part.minor));

type InstalmentMode = 'first' | 'last' | 'toFirst' | 'toLast';
type InstalmentCase = { total: string; count: number; unit: string } & Record<InstalmentMode, string[]>;
type ChunkCase = { total: string; max: string; chunks: string[] };
type TrancheCase = { amount: string } | { percent: string; cap?: string } | { rest: true };
type ScheduleCase = { total: string; tranches: TrancheCase[]; result: string[] | null };
type IncrementCase = { amount: string; step: string } & Record<RoundingMode, string | null>;

describe('instalments, chunk, schedule and roundToIncrement match the proved Lean models', () => {
  it('instalments with a unit, every remainder mode', () => {
    const cases = fixture<InstalmentCase>('instalments');
    expect(cases.length).toBeGreaterThan(1000);
    const mismatches: string[] = [];
    for (const oracleCase of cases) {
      for (const mode of ['first', 'last', 'toFirst', 'toLast'] as const) {
        const parts = instalments(eur(oracleCase.total), oracleCase.count, {
          unit: eur(oracleCase.unit),
          remainder: mode,
        });
        const actual = minors(parts).join();
        const expected = oracleCase[mode].join();
        if (actual !== expected) {
          mismatches.push(`${oracleCase.total} x${oracleCase.count} unit ${oracleCase.unit} ${mode}: ${actual}`);
        }
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it('chunk', () => {
    const cases = fixture<ChunkCase>('chunk');
    expect(cases.length).toBeGreaterThan(1000);
    const mismatches: string[] = [];
    for (const oracleCase of cases) {
      const actual = minors(chunk(eur(oracleCase.total), eur(oracleCase.max))).join();
      if (actual !== oracleCase.chunks.join()) {
        mismatches.push(`${oracleCase.total} by ${oracleCase.max}: ${actual}`);
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it('schedule, including the cases that must throw', () => {
    const cases = fixture<ScheduleCase>('schedule');
    expect(cases.length).toBeGreaterThan(1000);
    expect(cases.some((oracleCase) => oracleCase.result === null)).toBe(true);
    expect(cases.some((oracleCase) => oracleCase.result !== null)).toBe(true);
    const mismatches: string[] = [];
    for (const oracleCase of cases) {
      const tranches: Tranche<'EUR'>[] = oracleCase.tranches.map((tranche) => {
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
        actual = minors(schedule(eur(oracleCase.total), tranches)).join();
      } catch (error) {
        expect(error).toBeInstanceOf(RangeError);
        actual = 'throws';
      }
      const expected = oracleCase.result === null ? 'throws' : oracleCase.result.join();
      if (actual !== expected) {
        mismatches.push(`${oracleCase.total} ${JSON.stringify(oracleCase.tranches)}: ${actual}, expected ${expected}`);
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it('roundToIncrement, every rounding mode', () => {
    const cases = fixture<IncrementCase>('increment');
    expect(cases.length).toBeGreaterThan(1000);
    const modes: RoundingMode[] = [
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
    const mismatches: string[] = [];
    for (const oracleCase of cases) {
      for (const mode of modes) {
        let actual: string | null;
        try {
          actual = String(roundToIncrement(eur(oracleCase.amount), eur(oracleCase.step), mode).minor);
        } catch (error) {
          expect(error).toBeInstanceOf(RoundingError);
          actual = null;
        }
        if (actual !== oracleCase[mode]) {
          mismatches.push(`${oracleCase.amount} to ${oracleCase.step} ${mode}: ${actual}`);
        }
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});
