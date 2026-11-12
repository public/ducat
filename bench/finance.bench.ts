// CodSpeed / vitest benchmarks for @ducatjs/money/finance. The IRR case is the documented worst
// case: 360 monthly flows at the default 10 digits.
// every ISO 4217 code: this file imports src modules directly, which register none
import '../src/plugins/iso.js';
import { bench, describe } from 'vitest';
import { amortise, yearFraction } from '../src/finance.ts';
import { irr, npv } from '../src/excel.ts';
import { fromMinor, money } from '../src/money.ts';

const mortgage = [
  fromMinor(-20_000_000, 'EUR'),
  ...Array.from({ length: 360 }, () => fromMinor(101_337, 'EUR')),
];
const loan = money('200000', 'EUR');
const dates = Array.from(
  { length: 100 },
  (_, i) => `20${String(10 + (i % 40))}-0${1 + (i % 9)}-28`,
);

let sink: unknown;

describe('finance', () => {
  bench('irr: 360 monthly flows, digits 10', () => {
    sink = irr(mortgage);
  });
  bench('npv: 360 monthly flows', () => {
    sink = npv('0.00375', mortgage);
  });
  bench('amortise: 300 monthly payments', () => {
    sink = amortise(loan, { rate: '0.045', perYear: 12, periods: 300 });
  });
  bench('yearFraction: 100 pairs, ACT/ACT ISDA', () => {
    for (let i = 0; i < 99; i++)
      sink = yearFraction(
        dates[i]! < dates[i + 1]! ? dates[i]! : dates[i + 1]!,
        dates[i]! < dates[i + 1]! ? dates[i + 1]! : dates[i]!,
        'ACT/ACT ISDA',
      );
  });
});

export { sink };
