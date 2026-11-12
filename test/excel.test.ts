// Functions named after Excel's (npv, irr) must give Excel's values; periodicRate and annualRate
// aren't Excel names, but must agree with Excel's RRI and EFFECT examples and Calc's POWER. Ground truth: Microsoft's
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
import { annualRate, discountedSumExact, periodicRate } from '../src/finance.js';
import {
  fv,
  fvExact,
  irr,
  nper,
  npv,
  npvExact,
  pmt,
  pmtExact,
  pv,
  pvExact,
  rate,
  type PaymentTiming,
  xirr,
  xnpv,
  xnpvBounds,
} from '../src/excel.js';
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
  rri: {
    source: string;
    examples: { formula: string; nper: string; pv: string; fv: string; result: string }[];
  };
  effect: {
    source: string;
    examples: { formula: string; nominal: string; npery: string; result: string }[];
  };
  fv: { source: string; examples: AnnuityExample[] };
  pv: { source: string; examples: AnnuityExample[] };
  pmt: { source: string; examples: AnnuityExample[] };
  nper: { source: string; examples: AnnuityExample[] };
  rate: {
    source: string;
    accuracy: string;
    examples: (AnnuityExample & { places: number; times?: number })[];
  };
  xnpv: { source: string; examples: DatedExample[] };
  xirr: { source: string; accuracy: string; examples: DatedExample[] };
}

/** XNPV and XIRR examples: values and their dates, as printed. */
interface DatedExample {
  formula: string;
  rate?: string;
  values: string[];
  dates: string[];
  places: number;
  result: string;
}

/** Excel's annuity arguments, as a spreadsheet cell holds them ('0.08/12' is A2/12). */
interface AnnuityExample {
  formula: string;
  rate?: string;
  nper?: number;
  pmt?: string;
  pv?: string;
  fv?: string;
  type?: PaymentTiming;
  result: string;
}

/** An annuity vector: Calc's inputs as text, and its result. */
interface AnnuityVector {
  rate: string;
  nper: number;
  pmt: string;
  pv: string;
  fv: string;
  type: PaymentTiming;
  calc: string;
}

interface Calc {
  calc: string;
  npv: { rate: string; flows: string[]; calc: string }[];
  irr: { flows: string[]; calc: string }[];
  periodicRate: { annual: string; perYear: number; calc: string; calcOnePlus: string }[];
  annualRate: { periodic: string; perYear: number; calc: string }[];
  fv: AnnuityVector[];
  pv: AnnuityVector[];
  pmt: AnnuityVector[];
  nper: AnnuityVector[];
  rate: Omit<AnnuityVector, 'rate'>[];
  xnpv: { rate: string; values: string[]; dates: string[]; calc: string }[];
  xirr: { values: string[]; dates: string[]; calc: string }[];
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

  it(`RRI as periodicRate (${microsoft.rri.source})`, () => {
    for (const example of microsoft.rri.examples) {
      // RRI(n, pv, fv) = (fv / pv)^(1/n) − 1: the periodic rate of an annual growth of fv / pv − 1
      const growth = ratio(BigInt(example.fv) - BigInt(example.pv), BigInt(example.pv));
      const { lower } = periodicRate(growth, { perYear: Number(example.nper), digits: 15 });
      expect([example.formula, roundDecimal(ratio(lower), 7)]).toEqual([
        example.formula,
        example.result,
      ]);
    }
  });

  /** '0.08/12' (a cell divided by 12, as the pages write it) as an exact ratio */
  const cellRate = (text: string | undefined): Ratio => {
    const [rateText, divisor] = (text ?? '0').split('/');
    return ratio(rateText!, divisor ?? 1);
  };
  const optional = (amount: string | undefined) => (amount === undefined ? undefined : usd(amount));

  it(`FV (${microsoft.fv.source})`, () => {
    for (const example of microsoft.fv.examples) {
      const options = { pv: optional(example.pv), type: example.type };
      const result = fv(cellRate(example.rate), example.nper!, usd(example.pmt!), options);
      expect([example.formula, result.toDecimal()]).toEqual([example.formula, example.result]);
    }
  });

  it(`PV (${microsoft.pv.source})`, () => {
    for (const example of microsoft.pv.examples) {
      const options = { fv: optional(example.fv), type: example.type };
      const result = pv(cellRate(example.rate), example.nper!, usd(example.pmt!), options);
      expect([example.formula, result.toDecimal()]).toEqual([example.formula, example.result]);
    }
  });

  it(`PMT (${microsoft.pmt.source})`, () => {
    for (const example of microsoft.pmt.examples) {
      const options = { fv: optional(example.fv), type: example.type };
      const result = pmt(cellRate(example.rate), example.nper!, usd(example.pv!), options);
      expect([example.formula, result.toDecimal()]).toEqual([example.formula, example.result]);
    }
  });

  it(`NPER (${microsoft.nper.source})`, () => {
    for (const example of microsoft.nper.examples) {
      const places = example.result.split('.')[1]!.length;
      const options = { fv: optional(example.fv), type: example.type, digits: places + 6 };
      const { lower, upper } = nper(
        cellRate(example.rate),
        usd(example.pmt!),
        usd(example.pv!),
        options,
      );
      // the exact value lies in [lower, upper): both round to what the page shows
      expect([
        example.formula,
        roundDecimal(ratio(lower), places),
        roundDecimal(ratio(upper), places),
      ]).toEqual([example.formula, example.result, example.result]);
    }
  });

  it(`RATE (${microsoft.rate.source})`, () => {
    for (const example of microsoft.rate.examples) {
      const { lower } = rate(example.nper!, usd(example.pmt!), usd(example.pv!), { digits: 12 });
      const shown = ratio(ratio(lower).num * BigInt(example.times ?? 1), ratio(lower).den);
      expect([example.formula, roundDecimal(shown, example.places)]).toEqual([
        example.formula,
        example.result,
      ]);
    }
  });

  it(`XNPV (${microsoft.xnpv.source})`, () => {
    for (const example of microsoft.xnpv.examples) {
      const result = xnpv(example.rate!, example.values.map(usd), example.dates);
      expect([example.formula, result.toDecimal()]).toEqual([example.formula, example.result]);
    }
  });

  it(`XIRR (${microsoft.xirr.source})`, () => {
    // Excel stops within 0.000001 percent of the root, which lies in [lower, upper]
    const accuracy = ratio(microsoft.xirr.accuracy);
    for (const example of microsoft.xirr.examples) {
      const { lower, upper } = xirr(example.values.map(usd), example.dates, { digits: 12 });
      const shown = ratio(example.result);
      expect([
        example.formula,
        isGreater(subtract(ratio(lower), shown), accuracy),
        isGreater(subtract(shown, ratio(upper)), accuracy),
      ]).toEqual([example.formula, false, false]);
    }
  });

  it(`EFFECT as annualRate (${microsoft.effect.source})`, () => {
    for (const example of microsoft.effect.examples) {
      // EFFECT(nominal, n) = (1 + nominal / n)^n − 1
      const periodic = ratio(example.nominal, example.npery);
      const effective = annualRate(periodic, { perYear: Number(example.npery) });
      expect([example.formula, roundDecimal(effective, 7)]).toEqual([
        example.formula,
        example.result,
      ]);
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

describe(`LibreOffice Calc's POWER (${calc.calc})`, () => {
  /** |left − right| ≤ bound */
  const within = (left: Ratio, right: Ratio, bound: Ratio) => {
    const difference = subtract(left, right);
    const size = difference.num < 0n ? ratio(-difference.num, difference.den) : difference;
    return !isGreater(size, bound);
  };
  const calcRatio = (text: string) => ratio(text.replace(/E\+?/, 'e'));
  const ulp = ratio(1n, 2n ** 52n);
  /** Half a unit in the 15th significant digit of Calc's text, which is rounded there. */
  const textRounding = (text: string): Ratio => {
    const exponent = Number(/E([+-]\d+)$/.exec(text)?.[1]) - 14;
    return exponent >= 0
      ? ratio(5n * 10n ** BigInt(exponent), 10n)
      : ratio(5n, 10n ** BigInt(1 - exponent));
  };
  const addRatios = (left: Ratio, right: Ratio): Ratio =>
    ratio(left.num * right.den + right.num * left.den, left.den * right.den);
  /** a · 2^-52, the size of `count` units in the last place of a double near 1 */
  const ulps = (count: number): Ratio => ratio(BigInt(count), 2n ** 52n);

  it('periodicRate: 1 + rate at 15 significant digits, and the rate within a double', () => {
    let strict = 0;
    const mismatches = calc.periodicRate.filter((vector) => {
      // at 25 places the floor doesn't reach Calc's digits
      const { lower, upper } = periodicRate(vector.annual, {
        perYear: vector.perYear,
        digits: 25,
      });
      const onePlusLower = add1(ratio(lower));
      // the root is in [lower, upper): when both ends agree at 15 digits, so does the root
      const ours = significant15(onePlusLower);
      if (
        ours === significant15(add1(ratio(upper))) &&
        ours === calcSignificant15(vector.calcOnePlus)
      ) {
        strict++;
      } else {
        // Calc's POWER is within a few units in the last place of 1 + rate (which is below 3, so
        // its unit is at most 2^-51), and its text is rounded to 15 digits
        const bound = addRatios(ulps(8), textRounding(vector.calcOnePlus));
        if (!within(onePlusLower, calcRatio(vector.calcOnePlus), bound)) {
          return true;
        }
      }
      // the rate itself: Calc's subtraction is exact, so the same absolute error bounds it
      const bound = addRatios(ulps(8), textRounding(vector.calc));
      return !within(ratio(lower), calcRatio(vector.calc), bound);
    });
    expect(calc.periodicRate.length).toBe(150);
    expect(strict).toBeGreaterThan(130);
    expect(mismatches).toEqual([]);
  });

  it('annualRate: at 15 significant digits, or within the error of a double power', () => {
    let strict = 0;
    const mismatches = calc.annualRate.filter((vector) => {
      const ours = annualRate(vector.periodic, { perYear: vector.perYear });
      if (significant15(ours) === calcSignificant15(vector.calc)) {
        strict++;
        return false;
      }
      // 1 + p is rounded to a double (relative error 2^-53), the power multiplies that by n, and
      // POWER adds a unit in the last place: (n + 2) · 2^-52 · (1 + annual), plus the subtraction
      const size = add1(ours);
      const doubleError = ratio(
        size.num * BigInt(vector.perYear + 2) + size.den,
        size.den * ulp.den,
      );
      const bound = addRatios(doubleError, textRounding(vector.calc));
      return !within(ours, calcRatio(vector.calc), bound);
    });
    expect(calc.annualRate.length).toBe(150);
    // a power of n ≤ 400 in doubles can be off by n units in the last place, so fewer agree to
    // every digit Calc shows than for NPV
    expect(strict).toBeGreaterThan(80);
    expect(mismatches).toEqual([]);
  });
});

describe(`LibreOffice Calc's FV, PV, PMT, NPER and RATE (${calc.calc})`, () => {
  const calcRatio = (text: string) => ratio(text.replace(/E\+?/, 'e'));
  const epsilon = ratio(1n, 2n ** 52n);
  const textRounding = (text: string): Ratio => {
    const exponent = Number(/E([+-]\d+)$/.exec(text)?.[1]) - 14;
    return exponent >= 0
      ? ratio(5n * 10n ** BigInt(exponent), 10n)
      : ratio(5n, 10n ** BigInt(1 - exponent));
  };
  const magnitude = (value: Ratio): Ratio =>
    value.num < 0n ? ratio(-value.num, value.den) : value;
  const times = (left: Ratio, right: Ratio): Ratio =>
    ratio(left.num * right.num, left.den * right.den);
  const plus = (left: Ratio, right: Ratio): Ratio =>
    ratio(left.num * right.den + right.num * left.den, left.den * right.den);
  const over = (left: Ratio, right: Ratio): Ratio =>
    ratio(left.num * right.den, left.den * right.num);
  const power = (value: Ratio, exponent: number): Ratio =>
    ratio(value.num ** BigInt(exponent), value.den ** BigInt(exponent));
  /** |ours − Calc's| ≤ count · 2^-52 · size + Calc's text rounding */
  const close = (ours: Ratio, text: string, size: Ratio, count: number) =>
    !isGreater(
      magnitude(subtract(ours, calcRatio(text))),
      plus(times(ratio(BigInt(count)), times(epsilon, size)), textRounding(text)),
    );
  const one = ratio(1n);

  /**
   * The parts of an annuity a double computation loses accuracy on: G = (1 + r)^n, |r|, the
   * payment term's size |pmt|·(1 + |r|·type)·(G + 1)/|r| (or |pmt|·n at a rate of 0).
   */
  const sizes = (vector: AnnuityVector) => {
    const periodic = ratio(vector.rate);
    const growth = power(plus(one, periodic), vector.nper);
    const absRate = magnitude(periodic);
    const payment = magnitude(ratio(vector.pmt));
    const paymentTerm =
      periodic.num === 0n
        ? times(payment, ratio(BigInt(vector.nper)))
        : over(
            times(
              times(payment, plus(one, times(absRate, ratio(BigInt(vector.type))))),
              plus(growth, one),
            ),
            absRate,
          );
    return { growth, paymentTerm };
  };

  /** compares at 15 significant digits, else within the double error bound */
  const check = (
    vectors: AnnuityVector[],
    compute: (vector: AnnuityVector) => ExactMoney,
    size: (vector: AnnuityVector) => Ratio,
  ) => {
    let strict = 0;
    const mismatches = vectors.filter((vector) => {
      const ours = exactRatio(compute(vector));
      if (significant15(ours) === calcSignificant15(vector.calc)) {
        strict++;
        return false;
      }
      return !close(ours, vector.calc, size(vector), vector.nper + 8);
    });
    return { strict, mismatches };
  };

  it('FV, PV and PMT: at 15 significant digits, or within the error of doubles', () => {
    const options = (vector: AnnuityVector, other: 'pv' | 'fv') => ({
      [other]: usd(vector[other]),
      type: vector.type,
    });
    const fvResult = check(
      calc.fv,
      (vector) => fvExact(vector.rate, vector.nper, usd(vector.pmt), options(vector, 'pv')),
      (vector) => {
        const { growth, paymentTerm } = sizes(vector);
        return plus(times(magnitude(ratio(vector.pv)), growth), paymentTerm);
      },
    );
    const pvResult = check(
      calc.pv,
      (vector) => pvExact(vector.rate, vector.nper, usd(vector.pmt), options(vector, 'fv')),
      (vector) => {
        const { growth, paymentTerm } = sizes(vector);
        return over(plus(magnitude(ratio(vector.fv)), paymentTerm), growth);
      },
    );
    const pmtResult = check(
      calc.pmt,
      (vector) => pmtExact(vector.rate, vector.nper, usd(vector.pv), options(vector, 'fv')),
      (vector) => {
        // −(pv·G + fv)·r / ((1 + r·type)·(G − 1)): the numerator's size over the denominator,
        // times the relative error of G − 1, (G + 1)/|G − 1|, plus one
        const periodic = ratio(vector.rate);
        const { growth } = sizes(vector);
        const top = plus(times(magnitude(ratio(vector.pv)), growth), magnitude(ratio(vector.fv)));
        if (periodic.num === 0n) {
          return over(top, ratio(BigInt(vector.nper)));
        }
        const bottom = magnitude(
          times(plus(one, times(periodic, ratio(BigInt(vector.type)))), subtract(growth, one)),
        );
        const conditioning = plus(one, over(plus(growth, one), magnitude(subtract(growth, one))));
        return times(over(times(top, magnitude(periodic)), bottom), conditioning);
      },
    );
    for (const [name, result, vectors] of [
      ['fv', fvResult, calc.fv],
      ['pv', pvResult, calc.pv],
      ['pmt', pmtResult, calc.pmt],
    ] as const) {
      expect([name, vectors.length, result.mismatches]).toEqual([name, 150, []]);
    }
    // most agree to every digit Calc shows; (1 + r)^n in doubles, for n up to 480, can be off by
    // n units in the last place, so not all do
    expect([fvResult.strict, pvResult.strict, pmtResult.strict].map((count) => count > 80)).toEqual(
      [true, true, true],
    );
  });

  it('FV, PV and PMT round their exact values once', () => {
    for (const vector of calc.fv.slice(0, 40)) {
      const pvOptions = { pv: usd(vector.pv), type: vector.type };
      const fvOptions = { fv: usd(vector.fv), type: vector.type };
      for (const mode of ['halfEven', 'floor'] as const) {
        expect(fv(vector.rate, vector.nper, usd(vector.pmt), pvOptions, mode)).toEqual(
          fvExact(vector.rate, vector.nper, usd(vector.pmt), pvOptions).round(mode),
        );
        expect(pv(vector.rate, vector.nper, usd(vector.pmt), fvOptions, mode)).toEqual(
          pvExact(vector.rate, vector.nper, usd(vector.pmt), fvOptions).round(mode),
        );
        expect(pmt(vector.rate, vector.nper, usd(vector.pv), fvOptions, mode)).toEqual(
          pmtExact(vector.rate, vector.nper, usd(vector.pv), fvOptions).round(mode),
        );
      }
    }
  });

  it('NPER: the floor at 25 places agrees with Calc at 15 significant digits, or within doubles', () => {
    let strict = 0;
    const mismatches = calc.nper.filter((vector) => {
      const options = { fv: usd(vector.fv), type: vector.type, digits: 25 };
      const { lower, upper, exact } = nper(vector.rate, usd(vector.pmt), usd(vector.pv), options);
      const ours = significant15(ratio(lower));
      if (
        exact !== undefined
          ? significant15(exact) === calcSignificant15(vector.calc)
          : ours === significant15(ratio(upper)) && ours === calcSignificant15(vector.calc)
      ) {
        strict++;
        return false;
      }
      // Excel's closed form in doubles: ln(A) / ln(1 + r), with A's numerator and denominator
      // each a difference, so their relative errors are 4·2^-52 times their terms' sizes over
      // their values, and ln(1 + r) off by 2·2^-52 absolute: the error is below
      // 4 · (errorOfA + 2·2^-52·|nper|) / |ln(1 + r)|, with ln(1 + r) estimated in doubles
      const periodic = ratio(vector.rate);
      const timing = plus(one, times(periodic, ratio(BigInt(vector.type))));
      const paid = times(ratio(vector.pmt), timing);
      const futureTerm = times(ratio(vector.fv), periodic);
      const presentTerm = times(ratio(vector.pv), periodic);
      const relative = (left: Ratio, right: Ratio, value: Ratio) =>
        over(plus(magnitude(left), magnitude(right)), magnitude(value));
      const errorOfA = plus(
        relative(paid, futureTerm, subtract(paid, futureTerm)),
        relative(paid, presentTerm, plus(paid, presentTerm)),
      );
      if (periodic.num === 0n) {
        // −(pv + fv)/pmt: a few roundings, relative to the result
        return !close(ratio(lower), vector.calc, magnitude(ratio(lower)), 8);
      }
      const logOfGrowth = Math.abs(Math.log1p(Number(vector.rate)));
      const periods = magnitude(ratio(lower));
      const size = over(plus(errorOfA, times(ratio(2n), periods)), ratio(String(logOfGrowth)));
      return !close(ratio(lower), vector.calc, size, 8);
    });
    expect(calc.nper.length).toBe(150);
    expect(strict).toBeGreaterThan(100);
    expect(mismatches).toEqual([]);
  });

  it('RATE: within 1e-12 relative, or 5e-12 where Calc stops early, and always a genuine root', () => {
    // Excel documents only that RATE stops within 0.0000001, far looser than most rates (the
    // smallest here is about 1e-9), so the test is much tighter. Most of Calc's values agree with
    // ducat's exact bracket to 1e-12 relative. The rest are where Calc's Newton iteration stops
    // early or loses digits to cancellation (ill-conditioned cases, such as a 1e-9 rate over 360
    // periods): their largest absolute gap is 1.8e-12, so they must be within 5e-12, and ducat's
    // value matches irr on the implied flows to every digit. Every bracket is checked to be a
    // genuine root: f(r) = fv − FV(r) changes sign over [lower, upper]. With payments at the
    // start, RATE's equation also has a root at exactly −1, where the NPV is undefined; Calc can
    // converge to it, and there ducat's rate must still be a genuine root above −1.
    const relative = ratio(1n, 10n ** 12n);
    const early = ratio(5n, 10n ** 12n);
    let strict = 0;
    let atMinusOne = 0;
    const mismatches = calc.rate.filter((vector) => {
      const theirs = calcRatio(vector.calc);
      const spurious = vector.type === 1 && !isGreater(theirs, ratio('-0.999999'));
      // enough places for 1e-12 relative at the smallest rates
      const scale = spurious
        ? 0
        : Math.max(0, Math.ceil(-Math.log10(Math.abs(Number(vector.calc)))));
      const { lower, upper } = rate(vector.nper, usd(vector.pmt), usd(vector.pv), {
        fv: usd(vector.fv),
        type: vector.type,
        digits: Math.min(14 + scale, 40),
      });
      // a genuine root: the NPV of the implied flows has opposite signs (or a zero) at the
      // bracket's ends, by Horner's rule on integers, independently of rate's closed form
      const cents = (amount: string) => BigInt(usd(amount).minor);
      const [payment, present, future] = [cents(vector.pmt), cents(vector.pv), cents(vector.fv)];
      const flows = Array.from({ length: vector.nper + 1 }, () => payment);
      if (vector.type === 1) {
        flows[0] = present + payment;
        flows[vector.nper] = future;
      } else {
        flows[0] = present;
        flows[vector.nper] = payment + future;
      }
      const npvSign = (at: string) => {
        const { num, den } = ratio(at);
        let accumulator = flows[0]!;
        let denominatorPower = 1n;
        for (let index = 1; index < flows.length; index++) {
          denominatorPower *= den;
          accumulator = accumulator * (num + den) + flows[index]! * denominatorPower;
        }
        return Math.sign(Number(accumulator > 0n ? 1n : accumulator < 0n ? -1n : 0n));
      };
      const lowSign = npvSign(lower);
      const highSign = npvSign(upper);
      if (lowSign !== 0 && lowSign === highSign) {
        return true;
      }
      if (spurious) {
        atMinusOne++;
        return !isGreater(ratio(lower), ratio(-1));
      }
      const distance = magnitude(subtract(ratio(lower), theirs));
      const size = magnitude(ratio(lower));
      if (!isGreater(distance, ratio(size.num * relative.num, size.den * relative.den))) {
        strict++;
        return false;
      }
      return isGreater(distance, early);
    });
    expect(calc.rate.length).toBe(150);
    expect(mismatches).toEqual([]);
    expect(strict).toBeGreaterThan(100);
    expect(atMinusOne).toBeLessThan(5);
  });
});

describe(`LibreOffice Calc's XNPV and XIRR (${calc.calc})`, () => {
  const calcRatio = (text: string) => ratio(text.replace(/E\+?/, 'e'));

  it("XNPV: the bounds' midpoint at 15 significant digits, or within Calc's double error", () => {
    let strict = 0;
    const mismatches = calc.xnpv.filter((vector) => {
      const { lower, upper } = xnpvBounds(vector.rate, vector.values.map(usd), vector.dates, {
        digits: 20,
      });
      const middle = ratio(
        lower.num * upper.den + upper.num * lower.den,
        2n * lower.den * upper.den,
      );
      if (significant15(middle) === calcSignificant15(vector.calc)) {
        strict++;
        return false;
      }
      // each term in doubles, v / (1 + r)^(t/365): 1 + r is rounded (2^-53 relative), raised to at
      // most ten years, and the sum adds a unit per term, so the error is below
      // (n + 24) · 2^-52 · Σ |vᵢ| / (1 + r)^tᵢ, with the sizes estimated in doubles (an upper bound
      // at a factor of two). Calc's text adds half a unit in its 15th digit.
      const growth = 1 + Number(vector.rate);
      const start = Date.parse(vector.dates[0]!);
      const size = vector.values.reduce((total, value, index) => {
        const years = (Date.parse(vector.dates[index]!) - start) / (365 * 86_400_000);
        return total + Math.abs(Number(value)) / growth ** years;
      }, 0);
      const exponent = Number(/E([+-]\d+)$/.exec(vector.calc)?.[1]) - 14;
      const textRounding = 5 * 10 ** (exponent - 1);
      const bound = 2 * (vector.values.length + 24) * 2 ** -52 * size + textRounding;
      const difference = Math.abs(
        Number(middle.num) / Number(middle.den) -
          Number(calcRatio(vector.calc).num) / Number(calcRatio(vector.calc).den),
      );
      return !(difference <= bound);
    });
    expect(calc.xnpv.length).toBe(150);
    expect(strict).toBeGreaterThan(100);
    expect(mismatches).toEqual([]);
  });

  it("XIRR: Calc's value lies within 0.000001 percent of [lower, upper]", () => {
    const accuracy = ratio(microsoft.xirr.accuracy);
    let converged = 0;
    const mismatches = calc.xirr.filter((vector) => {
      const { lower, upper } = xirr(vector.values.map(usd), vector.dates, { digits: 12 });
      if (vector.calc.startsWith('Err')) {
        return false;
      }
      converged++;
      const theirs = calcRatio(vector.calc);
      return (
        isGreater(subtract(ratio(lower), theirs), accuracy) ||
        isGreater(subtract(theirs, ratio(upper)), accuracy)
      );
    });
    expect(converged).toBeGreaterThan(140);
    expect(mismatches).toEqual([]);
  });
});

function add1(value: Ratio): Ratio {
  return ratio(value.num + value.den, value.den);
}

function subtract(left: Ratio, right: Ratio): Ratio {
  return ratio(left.num * right.den - right.num * left.den, left.den * right.den);
}

function isGreater(left: Ratio, right: Ratio): boolean {
  return left.num * right.den > right.num * left.den;
}

describe('the 0.3 names in /finance', () => {
  it('are deprecated re-exports of /excel, the same functions', async () => {
    const finance = await import('../src/entries/finance.js');
    const excel = await import('../src/entries/excel.js');
    expect([finance.npv, finance.npvExact, finance.irr]).toEqual([
      excel.npv,
      excel.npvExact,
      excel.irr,
    ]);
    // and /finance carries none of the new Excel functions
    expect(['fv', 'pv', 'pmt', 'nper', 'rate'].filter((name) => name in finance)).toEqual([]);
  });
});
