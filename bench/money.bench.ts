// CodSpeed / vitest benchmarks for the library's hot paths.
// Each case processes N pre-built values so a single iteration is meaningful under simulation.
// Run locally with `pnpm bench:vitest`; the cross-library comparison lives in `pnpm bench`.
import { bench, describe } from 'vitest';
// Everything from /fn, which re-exports each function straight from its module: under vitest every
// re-export hop is a getter call inside the loop, so the hop count must stay at one.
import * as M from '../src/fn.ts';
import { fromAdyen, fromStripe, toAdyen, toStripe } from '../src/fn.ts';

const N = 1000;
const cents = Array.from({ length: N }, (_, i) => ((i * 7919) % 10_000_000) + 1);
const eur = cents.map((c) => M.fromMinor(c, 'EUR'));
const eur2 = cents.map((c) => M.fromMinor(10_000_000 - c, 'EUR'));
const strs = eur.map((m) => M.toDecimal(m));
const big = cents.map((c) => M.fromMinor(10n ** 20n + BigInt(c), 'EUR'));
const bigStrs = big.map((m) => M.toDecimal(m));
const usd = cents.map((c) => M.fromMinor(c, 'USD'));
const chf = cents.map((c) => M.fromMinor(c, 'CHF'));
const json = eur.map((m) => JSON.parse(JSON.stringify(m)) as M.MoneyJSON<'EUR'>);
const formatted = eur.map((m) => M.format(m, 'de-DE'));
const rate = M.ratio('1.075');
const eurUsd = M.exchangeRate('EUR', 'USD', '1.0832');
const fiveCents = M.money('0.05', 'CHF');
// exact inputs: every division below leaves no remainder, so rounding returns before the mode is used
const eurBy4 = cents.map((c) => M.fromMinor(c * 4, 'EUR'));
const eurScale3 = cents.map((c) => M.fromMinor(c * 10, 'EUR', 3));

let sink: unknown;

describe('construction', () => {
  bench('fromMinor', () => {
    for (let i = 0; i < N; i++) sink = M.fromMinor(cents[i]!, 'EUR');
  });
  bench('money (decimal string)', () => {
    for (let i = 0; i < N; i++) sink = M.money(strs[i]!, 'EUR');
  });
  bench('money (bigint-range string)', () => {
    for (let i = 0; i < N; i++) sink = M.money(bigStrs[i]!, 'EUR');
  });
  bench('fromJSON', () => {
    for (let i = 0; i < N; i++) sink = M.fromJSON(json[i]!);
  });
});

describe('arithmetic', () => {
  bench('add', () => {
    for (let i = 0; i < N; i++) sink = M.add(eur[i]!, eur2[i]!);
  });
  bench('add (bigint)', () => {
    for (let i = 0; i < N; i++) sink = M.add(big[i]!, eur[i]!);
  });
  bench('subtract', () => {
    for (let i = 0; i < N; i++) sink = M.subtract(eur[i]!, eur2[i]!);
  });
  bench('sum', () => {
    sink = M.sum(eur);
  });
  bench('multiply by ratio (halfEven)', () => {
    for (let i = 0; i < N; i++) sink = M.multiply(eur[i]!, rate, 'halfEven');
  });
  bench('multiply by string factor', () => {
    for (let i = 0; i < N; i++) sink = M.multiply(eur[i]!, '1.075', 'halfExpand');
  });
  bench('divide', () => {
    for (let i = 0; i < N; i++) sink = M.divide(eur[i]!, 3, 'halfEven');
  });
  bench('compare', () => {
    let s = 0;
    for (let i = 0; i < N; i++) s += M.compare(eur[i]!, eur2[i]!);
    sink = s;
  });
  bench('toScale (up and down)', () => {
    for (let i = 0; i < N; i++) sink = M.toScale(M.toScale(eur[i]!, 4), 2, 'halfEven');
  });
});

describe('exact divisions', () => {
  bench('divide exact (by 4)', () => {
    for (let i = 0; i < N; i++) sink = M.divide(eurBy4[i]!, 4, 'halfEven');
  });
  bench('multiply exact (by 0.5)', () => {
    for (let i = 0; i < N; i++) sink = M.multiply(eurBy4[i]!, '0.5', 'halfEven');
  });
  bench('round exact (scale 3 to 2)', () => {
    for (let i = 0; i < N; i++) sink = M.round(eurScale3[i]!, 'halfEven');
  });
  bench('toScale down exact', () => {
    for (let i = 0; i < N; i++) sink = M.toScale(eurScale3[i]!, 2, 'halfExpand');
  });
  bench('allocate exact [1, 1]', () => {
    for (let i = 0; i < N; i++) sink = M.allocate(eurBy4[i]!, [1, 1]);
  });
});

describe('allocation', () => {
  bench('allocate [1, 1, 1]', () => {
    for (let i = 0; i < N; i++) sink = M.allocate(eur[i]!, [1, 1, 1]);
  });
  bench('allocate weighted strings', () => {
    for (let i = 0; i < N; i++) sink = M.allocate(eur[i]!, ['12.5', '37.5', '50']);
  });
  bench('split into 7', () => {
    for (let i = 0; i < N; i++) sink = M.split(eur[i]!, 7);
  });
  bench('instalments 12', () => {
    for (let i = 0; i < 100; i++) sink = M.instalments(eur[i]!, 12);
  });
});

describe('ops', () => {
  bench('addTax 20%', () => {
    for (let i = 0; i < N; i++) sink = M.addTax(eur[i]!, 20, 'halfEven');
  });
  bench('extractTax 20%', () => {
    for (let i = 0; i < N; i++) sink = M.extractTax(eur[i]!, 20, 'halfEven');
  });
  bench('percentage 12.5%', () => {
    for (let i = 0; i < N; i++) sink = M.percentage(eur[i]!, '12.5', 'halfEven');
  });
  bench('convert EUR->USD (exchangeRate)', () => {
    for (let i = 0; i < N; i++) sink = eurUsd.convert(eur[i]!, 'halfEven');
  });
  bench('cashRound CHF', () => {
    for (let i = 0; i < N; i++) sink = M.cashRound(chf[i]!);
  });
  bench('roundToIncrement CHF 0.05', () => {
    for (let i = 0; i < N; i++) sink = M.roundToIncrement(chf[i]!, fiveCents, 'halfExpand');
  });
});

describe('formatting', () => {
  bench('toDecimal', () => {
    for (let i = 0; i < N; i++) sink = M.toDecimal(eur[i]!);
  });
  bench('toDecimal (bigint)', () => {
    for (let i = 0; i < N; i++) sink = M.toDecimal(big[i]!);
  });
  bench('format en-US', () => {
    for (let i = 0; i < N; i++) sink = M.format(eur[i]!, 'en-US');
  });
  bench('parse de-DE', () => {
    for (let i = 0; i < N; i++) sink = M.parse(formatted[i]!, 'EUR', 'de-DE');
  });
});

describe('processors', () => {
  bench('toStripe / fromStripe', () => {
    for (let i = 0; i < N; i++) {
      const s = toStripe(usd[i]!);
      sink = fromStripe(s.amount, s.currency);
    }
  });
  bench('toAdyen / fromAdyen', () => {
    for (let i = 0; i < N; i++) sink = fromAdyen(toAdyen(usd[i]!));
  });
});

export { sink };
