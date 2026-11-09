// Functions named after Excel's (npv, irr) must give Excel's values. Ground truth: Microsoft's
// worked examples (test/fixtures/excel/microsoft.json, copied from the function pages), then a broad
// set computed by LibreOffice Calc (test/vectors/finance-calc.json, scripts/gen-calc-vectors.py).
// Spreadsheets compute in doubles, so values are compared at 15 significant digits, and IRR at
// Excel's stated accuracy (0.00001 percent).
import '../src/plugins/core.js'; // the tests below use the Money methods
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ratio, type Ratio } from '../src/decimal.js';
import type { ExactMoney } from '../src/exact.js';
import { discountedSumExact, irr, npv, npvExact } from '../src/finance.js';
import { abs, add, money, type Money } from '../src/money.js';

interface Microsoft {
  npv: {
    source: string;
    examples: {
      formula: string;
      rate: string;
      values: string[];
      outside: string;
      result: string;
    }[];
  };
  irr: {
    source: string;
    accuracy: string;
    examples: { formula: string; values: string[]; guess?: string; result: string }[];
  };
}

interface Calc {
  calc: string;
  npv: { rate: string; flows: string[]; calc: string }[];
  irr: { flows: string[]; calc: string }[];
}

const microsoft = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'excel', 'microsoft.json'), 'utf8'),
) as Microsoft;
const calc = JSON.parse(
  readFileSync(join(import.meta.dirname, 'vectors', 'finance-calc.json'), 'utf8'),
) as Calc;

const usd = (amount: string): Money => money(amount, 'USD');

/** A decimal string rounded half away from zero to `places` places. */
function roundDecimal(value: Ratio, places: number): string {
  const scaled = value.num * 10n ** BigInt(places);
  const magnitude = scaled < 0n ? -scaled : scaled;
  let quotient = magnitude / value.den;
  if ((magnitude % value.den) * 2n >= value.den) {
    quotient += 1n;
  }
  const digits = quotient.toString().padStart(places + 1, '0');
  const text = places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`;
  return scaled < 0n && quotient !== 0n ? `-${text}` : text;
}

/** The exact value at 15 significant digits, as '1.23456789012345E+3' (half away from zero). */
function significant15(value: Ratio): string {
  if (value.num === 0n) {
    return '0';
  }
  const magnitude = value.num < 0n ? -value.num : value.num;
  // the exponent: the number of integer digits of |value|, minus one, found exactly
  let exponent = magnitude.toString().length - value.den.toString().length;
  const compareAt = (power: number) =>
    power >= 0
      ? magnitude >= value.den * 10n ** BigInt(power)
      : magnitude * 10n ** BigInt(-power) >= value.den;
  while (!compareAt(exponent)) {
    exponent--;
  }
  while (compareAt(exponent + 1)) {
    exponent++;
  }
  const shift = 14 - exponent;
  const scaledNumerator = shift >= 0 ? magnitude * 10n ** BigInt(shift) : magnitude;
  const scaledDenominator = shift >= 0 ? value.den : value.den * 10n ** BigInt(-shift);
  let mantissa = scaledNumerator / scaledDenominator;
  if ((scaledNumerator % scaledDenominator) * 2n >= scaledDenominator) {
    mantissa += 1n;
  }
  if (mantissa === 10n ** 15n) {
    mantissa = 10n ** 14n;
    exponent++;
  }
  const text = mantissa.toString();
  const sign = value.num < 0n ? '-' : '';
  return `${sign}${text[0]}.${text.slice(1)}E${exponent >= 0 ? '+' : ''}${exponent}`;
}

/** Calc's 16-digit text ('1.998344948940640E-01') at 15 significant digits. */
function calcSignificant15(text: string): string {
  const match = /^(-?)(\d)\.(\d+)E([+-]\d+)$/.exec(text);
  if (match === null) {
    return text;
  }
  const [, sign, lead, rest, exponentText] = match;
  return significant15(ratio(`${sign}${lead}.${rest}e${Number(exponentText)}`));
}

const exactRatio = (amount: ExactMoney): Ratio => ratio(amount.num, amount.den);

describe("Microsoft's documented examples", () => {
  it(`NPV (${microsoft.npv.source})`, () => {
    for (const example of microsoft.npv.examples) {
      const result = add(usd(example.outside), npv(example.rate, example.values.map(usd)));
      expect([example.formula, result.toDecimal()]).toEqual([example.formula, example.result]);
    }
  });

  it(`IRR (${microsoft.irr.source})`, () => {
    for (const example of microsoft.irr.examples) {
      // the page shows one decimal of a percentage; the exact IRR rounds to it
      const { lower } = irr(example.values.map(usd), { digits: 12 });
      const shown = roundDecimal(ratio(lower), 3);
      expect([example.formula, shown]).toEqual([example.formula, example.result]);
    }
  });
});

describe(`LibreOffice Calc (${calc.calc})`, () => {
  it('NPV: equal at 15 significant digits, or Calc is off by no more than its double rounding', () => {
    let strict = 0;
    const mismatches = calc.npv.filter((vector) => {
      const flows = vector.flows.map(usd);
      const ours = npvExact(vector.rate, flows);
      if (significant15(exactRatio(ours)) === calcSignificant15(vector.calc)) {
        strict++;
        return false;
      }
      // Calc sums in doubles: its error is bounded by a few units in the last place of the sum of
      // the terms' sizes, (n + 2) · 2^-52 · Σ |flowᵢ| / (1 + rate)ⁱ, which cancellation can make
      // larger than the last digits of the result itself
      const sizes = npvExact(
        vector.rate,
        flows.map((flow) => abs(flow)),
      );
      const bound = ratio(
        exactRatio(sizes).num * BigInt(flows.length + 2),
        exactRatio(sizes).den * 2n ** 52n,
      );
      const difference = subtract(exactRatio(ours), ratio(vector.calc.replace(/E\+?/, 'e')));
      const size = difference.num < 0n ? ratio(-difference.num, difference.den) : difference;
      return isGreater(size, bound);
    });
    expect(calc.npv.length).toBeGreaterThan(300);
    // most agree to every digit Calc shows
    expect(strict).toBeGreaterThan(250);
    expect(mismatches).toEqual([]);
  });

  it("IRR agrees within Excel's accuracy wherever Calc finds a rate above -1", () => {
    const accuracy = ratio(microsoft.irr.accuracy);
    const minusOne = ratio(-1);
    let converged = 0;
    let gaveUp = 0;
    let belowMinusOne = 0;
    const mismatches = calc.irr.filter((vector) => {
      const flows = vector.flows.map(usd);
      const { lower, upper } = irr(flows, { digits: 12 });
      // whatever Calc did, our bracket is genuine: one sign change, so the NPV changes sign over it
      const lowerSign = discountedSumExact(lower, flows).sign();
      const upperSign = discountedSumExact(upper, flows).sign();
      if (!(lowerSign === 0 || lowerSign === -upperSign)) {
        return true;
      }
      if (vector.calc.startsWith('Err')) {
        // Calc's Newton iteration gave up (Err:523), as Excel's returns #NUM!
        gaveUp++;
        return false;
      }
      const theirs = ratio(vector.calc.replace(/E\+?/, 'e'));
      if (!isGreater(theirs, minusOne)) {
        // a root of the polynomial at 1 + rate < 0, where no IRR can be: Newton went past -1
        belowMinusOne++;
        return false;
      }
      converged++;
      // |theirs − root| ≤ accuracy, with the root in [lower, upper]
      const belowBy = subtract(ratio(lower), theirs);
      const aboveBy = subtract(theirs, ratio(upper));
      return isGreater(belowBy, accuracy) || isGreater(aboveBy, accuracy);
    });
    expect(converged).toBeGreaterThan(150);
    expect(gaveUp + belowMinusOne).toBeLessThan(60);
    expect(mismatches).toEqual([]);
  });
});

function subtract(left: Ratio, right: Ratio): Ratio {
  return ratio(left.num * right.den - right.num * left.den, left.den * right.den);
}

function isGreater(left: Ratio, right: Ratio): boolean {
  return left.num * right.den > right.num * left.den;
}
