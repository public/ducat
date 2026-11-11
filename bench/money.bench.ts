// CodSpeed / vitest benchmarks for the library's hot paths.
// Each case processes N pre-built values so a single iteration is meaningful under simulation.
// Run locally with `pnpm bench:vitest`; the cross-library comparison lives in `pnpm bench`.
// every ISO 4217 code: this file imports src modules directly, which register none
import '../src/plugins/iso.js';
import { bench, describe } from 'vitest';
// Each function is imported from the module that defines it. Under vitest an import is a getter
// on that module's export object, and /fn's object grows with every module, so going through /fn
// made these numbers drift as modules were added. Real code is bundled or runs as native ESM, where
// neither applies.
import {
  type MoneyJSON,
  add,
  compare,
  divide,
  fromJSON,
  fromMinor,
  money,
  multiply,
  round,
  subtract,
  sum,
  toDecimal,
  toScale,
} from '../src/money.ts';
import { addTax, extractTax, percentage } from '../src/tax.ts';
import { allocate, instalments, split } from '../src/allocate.ts';
import { cashRound, roundToIncrement } from '../src/cash.ts';
import { exchangeRate } from '../src/rate.ts';
import { format } from '../src/format.ts';
import { parse } from '../src/parse.ts';
import { ratio } from '../src/decimal.ts';
import { fromAdyen, toAdyen } from '../src/adyen.ts';
import { fromScaled } from '../src/fixed.ts';
import { exact, sumExact } from '../src/exact.ts';
import { fromStripe, toStripe } from '../src/stripe.ts';

const N = 1000;
const cents = Array.from({ length: N }, (_, i) => ((i * 7919) % 10_000_000) + 1);
const eur = cents.map((c) => fromMinor(c, 'EUR'));
const eur2 = cents.map((c) => fromMinor(10_000_000 - c, 'EUR'));
const strs = eur.map((m) => toDecimal(m));
const big = cents.map((c) => fromMinor(10n ** 20n + BigInt(c), 'EUR'));
const bigStrs = big.map((m) => toDecimal(m));
const fixeds = cents.map((c) => fromScaled(c, 2));
const usd = cents.map((c) => fromMinor(c, 'USD'));
const chf = cents.map((c) => fromMinor(c, 'CHF'));
const json = eur.map((m) => JSON.parse(JSON.stringify(m)) as MoneyJSON<'EUR'>);
const formatted = eur.map((m) => format(m, 'de-DE'));
const rate = ratio('1.075');
const eurUsd = exchangeRate('EUR', 'USD', '1.0832');
const fiveCents = money('0.05', 'CHF');
const exacts = eur.map((m) => exact(m));
const thirds = exacts.map((value) => value.divide(3));
// exact inputs: every division below leaves no remainder, so rounding returns before the mode is used
const eurBy4 = cents.map((c) => fromMinor(c * 4, 'EUR'));
const eurScale3 = cents.map((c) => fromMinor(c * 10, 'EUR', 3));

let sink: unknown;

describe('construction', () => {
  bench('fromMinor', () => {
    for (let i = 0; i < N; i++) sink = fromMinor(cents[i]!, 'EUR');
  });
  bench('money (decimal string)', () => {
    for (let i = 0; i < N; i++) sink = money(strs[i]!, 'EUR');
  });
  bench('money (bigint-range string)', () => {
    for (let i = 0; i < N; i++) sink = money(bigStrs[i]!, 'EUR');
  });
  bench('fromJSON', () => {
    for (let i = 0; i < N; i++) sink = fromJSON(json[i]!);
  });
});

describe('arithmetic', () => {
  bench('add', () => {
    for (let i = 0; i < N; i++) sink = add(eur[i]!, eur2[i]!);
  });
  bench('add (bigint)', () => {
    for (let i = 0; i < N; i++) sink = add(big[i]!, eur[i]!);
  });
  bench('subtract', () => {
    for (let i = 0; i < N; i++) sink = subtract(eur[i]!, eur2[i]!);
  });
  bench('sum', () => {
    sink = sum(eur);
  });
  bench('multiply by ratio (halfEven)', () => {
    for (let i = 0; i < N; i++) sink = multiply(eur[i]!, rate, 'halfEven');
  });
  bench('multiply by string factor', () => {
    for (let i = 0; i < N; i++) sink = multiply(eur[i]!, '1.075', 'halfExpand');
  });
  bench('divide', () => {
    for (let i = 0; i < N; i++) sink = divide(eur[i]!, 3, 'halfEven');
  });
  bench("divide by string '7'", () => {
    for (let i = 0; i < N; i++) sink = divide(eur[i]!, '7', 'halfEven');
  });
  bench("divide by decimal '1.5'", () => {
    for (let i = 0; i < N; i++) sink = divide(eur[i]!, '1.5', 'halfEven');
  });
  bench("divide by decimal '1.075'", () => {
    for (let i = 0; i < N; i++) sink = divide(eur[i]!, '1.075', 'halfEven');
  });
  bench('divide by a negative integer', () => {
    for (let i = 0; i < N; i++) sink = divide(eur[i]!, -3, 'halfEven');
  });
  bench('divide beyond 2^53 (bigint path)', () => {
    for (let i = 0; i < N; i++) sink = divide(big[i]!, 3, 'halfEven');
  });
  bench('compare', () => {
    let s = 0;
    for (let i = 0; i < N; i++) s += compare(eur[i]!, eur2[i]!);
    sink = s;
  });
  bench('toScale (up and down)', () => {
    for (let i = 0; i < N; i++) sink = toScale(toScale(eur[i]!, 4), 2, 'halfEven');
  });
});

describe('exact divisions', () => {
  bench('divide exact (by 4)', () => {
    for (let i = 0; i < N; i++) sink = divide(eurBy4[i]!, 4, 'halfEven');
  });
  bench('multiply exact (by 0.5)', () => {
    for (let i = 0; i < N; i++) sink = multiply(eurBy4[i]!, '0.5', 'halfEven');
  });
  bench('round exact (scale 3 to 2)', () => {
    for (let i = 0; i < N; i++) sink = round(eurScale3[i]!, 'halfEven');
  });
  bench('toScale down exact', () => {
    for (let i = 0; i < N; i++) sink = toScale(eurScale3[i]!, 2, 'halfExpand');
  });
  bench('allocate exact [1, 1]', () => {
    for (let i = 0; i < N; i++) sink = allocate(eurBy4[i]!, [1, 1]);
  });
});

describe('allocation', () => {
  bench('allocate [1, 1, 1]', () => {
    for (let i = 0; i < N; i++) sink = allocate(eur[i]!, [1, 1, 1]);
  });
  bench('allocate weighted strings', () => {
    for (let i = 0; i < N; i++) sink = allocate(eur[i]!, ['12.5', '37.5', '50']);
  });
  bench('split into 7', () => {
    for (let i = 0; i < N; i++) sink = split(eur[i]!, 7);
  });
  bench('instalments 12', () => {
    for (let i = 0; i < 100; i++) sink = instalments(eur[i]!, 12);
  });
});

describe('ops', () => {
  bench('addTax 20%', () => {
    for (let i = 0; i < N; i++) sink = addTax(eur[i]!, 20, 'halfEven');
  });
  bench('extractTax 20%', () => {
    for (let i = 0; i < N; i++) sink = extractTax(eur[i]!, 20, 'halfEven');
  });
  bench('percentage 12.5%', () => {
    for (let i = 0; i < N; i++) sink = percentage(eur[i]!, '12.5', 'halfEven');
  });
  bench('convert EUR->USD (exchangeRate)', () => {
    for (let i = 0; i < N; i++) sink = eurUsd.convert(eur[i]!, 'halfEven');
  });
  bench('convert EUR->USD (exchangeRate built inline)', () => {
    for (let i = 0; i < N; i++) {
      sink = exchangeRate('EUR', 'USD', '1.0830').convert(eur[i]!, 'halfEven');
    }
  });
  bench('cashRound CHF', () => {
    for (let i = 0; i < N; i++) sink = cashRound(chf[i]!);
  });
  bench('roundToIncrement CHF 0.05', () => {
    for (let i = 0; i < N; i++) sink = roundToIncrement(chf[i]!, fiveCents, 'halfExpand');
  });
});

describe('formatting', () => {
  bench('toDecimal', () => {
    for (let i = 0; i < N; i++) sink = toDecimal(eur[i]!);
  });
  bench('toDecimal (bigint)', () => {
    for (let i = 0; i < N; i++) sink = toDecimal(big[i]!);
  });
  bench('format en-US', () => {
    for (let i = 0; i < N; i++) sink = format(eur[i]!, 'en-US');
  });
  bench('format with options (decimal style)', () => {
    for (let i = 0; i < N; i++) sink = format(eur[i]!, 'en-US', { style: 'decimal' });
  });
  bench('parse de-DE', () => {
    for (let i = 0; i < N; i++) sink = parse(formatted[i]!, 'EUR', 'de-DE');
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

describe('fixed', () => {
  bench('Fixed divide by 3', () => {
    for (let i = 0; i < N; i++) sink = fixeds[i]!.divide(3, 'halfEven');
  });
  bench("Fixed divide by decimal '1.5'", () => {
    for (let i = 0; i < N; i++) sink = fixeds[i]!.divide('1.5', 'halfEven');
  });
  bench("Fixed multiply by '1.075'", () => {
    for (let i = 0; i < N; i++) sink = fixeds[i]!.multiply('1.075', 'halfEven');
  });
});

describe('ExactMoney', () => {
  bench('exact()', () => {
    for (let i = 0; i < N; i++) sink = exact(eur[i]!);
  });
  bench('ExactMoney add', () => {
    for (let i = 1; i < N; i++) sink = exacts[i]!.add(exacts[i - 1]!);
  });
  bench("ExactMoney multiply by '1.075'", () => {
    for (let i = 0; i < N; i++) sink = exacts[i]!.multiply(rate);
  });
  bench('ExactMoney divide by 3', () => {
    for (let i = 0; i < N; i++) sink = exacts[i]!.divide(3);
  });
  bench('ExactMoney chain ÷3 ×1.19 +x, rounded once', () => {
    for (let i = 1; i < N; i++) {
      sink = exacts[i]!.divide(3)
        .multiply('1.19')
        .add(exacts[i - 1]!)
        .round('halfEven');
    }
  });
  bench('ExactMoney round', () => {
    for (let i = 0; i < N; i++) sink = thirds[i]!.round('halfEven');
  });
  bench('sumExact of thirds', () => {
    sink = sumExact(thirds);
  });
});

export { sink };
