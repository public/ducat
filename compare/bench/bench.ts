// The same eight operations across money libraries. Runs unchanged on Node, Bun and Deno once
// bundled by build.mjs. Each operation processes N = 1000 pre-built values; the result is
// nanoseconds per single operation. The method and its settings (BENCH_MS, BENCH_ROUNDS,
// BENCH_ONLY) are in harness.ts.
import { Decimal as PrismaDecimal } from '@prisma/client/runtime/index-browser';
import { Currencies as ScreenyCurrencies, Money as ScreenyMoney } from '@screeny05/ts-money';
import Big from 'big.js';
import { Money as BigintMoney, Round as BigintRound } from 'bigint-money';
import BigNumber from 'bignumber.js';
import currency from 'currency.js';
import Decimal from 'decimal.js';
import DecimalLight from 'decimal.js-light';
import Dinero1 from 'dinero-v1';
import * as Dinero2 from 'dinero.js';
import * as Dinero2Bigint from 'dinero.js/bigint';
import { EUR as Dinero2BigintEur } from 'dinero.js/bigint/currencies';
import { EUR as Dinero2Eur } from 'dinero.js/currencies';
import JsMoney from 'js-money';
import * as Monetra from 'monetra';
import TsMoneyPackage from 'ts-money';
// the free functions of every module, and (through the plugins) the same operations as methods
import * as ducat from '../../src/fn.ts';
import '../../src/plugins/all.ts';
import { ONLY, runBenchmark } from './harness.ts';

// Library values are opaque here: each implementation only ever sees its own values.
// oxlint-disable-next-line typescript/no-explicit-any
type LibraryValue = any;

interface Implementation {
  fromMinor(cents: number): LibraryValue;
  parse(decimal: string): LibraryValue;
  add(first: LibraryValue, second: LibraryValue): LibraryValue;
  /** times 1.075, rounded half-even to cents (where the library can) */
  mulRatio(value: LibraryValue): LibraryValue;
  allocate3(value: LibraryValue): LibraryValue[];
  toDecimal(value: LibraryValue): string;
  /** Intl, en-US */
  format(value: LibraryValue): string;
  compare(first: LibraryValue, second: LibraryValue): number;
  notes?: string;
}

const N = 1000;

// at least 1.00: @screeny05/ts-money's allocate crashes below 3 cents
const cents = Array.from({ length: N }, (_, index) => ((index * 7919) % 10_000_000) + 100);
const decimals = cents.map((amount) => ducat.toDecimal(ducat.fromMinor(amount, 'EUR')));
const euroFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const { Money: TsMoney, Currencies: TsCurrencies } = TsMoneyPackage;

/** Largest-remainder allocation on top of a decimal type: what an app hand-rolls on big.js & co. */
function decimalAllocate(
  value: LibraryValue,
  ratios: number[],
  floorToCents: (decimal: LibraryValue) => LibraryValue,
  cent: LibraryValue,
  zero: LibraryValue,
): LibraryValue[] {
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
  const parts = ratios.map((ratio) => floorToCents(value.times(ratio).div(total)));

  let remainder = value.minus(parts.reduce((sum, part) => sum.plus(part), zero));
  for (let index = 0; remainder.cmp(zero) > 0; index++) {
    parts[index] = parts[index].plus(cent);
    remainder = remainder.minus(cent);
  }
  return parts;
}

function decimalImplementation(
  DecimalClass: LibraryValue,
  roundToCents: (decimal: LibraryValue, mode: LibraryValue) => LibraryValue,
  roundDown: LibraryValue,
  roundHalfEven: LibraryValue,
): Implementation {
  return {
    fromMinor: (amount) => new DecimalClass(amount).div(100),
    parse: (decimal) => new DecimalClass(decimal),
    add: (first, second) => first.plus(second),
    mulRatio: (value) => roundToCents(value.times('1.075'), roundHalfEven),
    allocate3: (value) =>
      decimalAllocate(
        value,
        [1, 1, 1],
        (decimal) => roundToCents(decimal, roundDown),
        new DecimalClass('0.01'),
        new DecimalClass(0),
      ),
    toDecimal: (value) => value.toFixed(2),
    format: (value) => euroFormat.format(value.toFixed(2)),
    compare: (first, second) => first.cmp(second),
    notes: 'hand-rolled allocation; caller carries currency and scale',
  };
}

function decimalJsImplementation(DecimalClass: LibraryValue): Implementation {
  return decimalImplementation(
    DecimalClass,
    (decimal, mode) => decimal.toDecimalPlaces(2, mode),
    DecimalClass.ROUND_DOWN,
    DecimalClass.ROUND_HALF_EVEN,
  );
}

const ducatRatio = ducat.ratio('1.075');

function dinero1Compare(first: LibraryValue, second: LibraryValue): number {
  if (first.lessThan(second)) {
    return -1;
  }
  return first.equalsTo(second) ? 0 : 1;
}

const bigNumberImplementation: Implementation = {
  ...decimalImplementation(
    BigNumber,
    (decimal, mode) => decimal.decimalPlaces(2, mode),
    BigNumber.ROUND_DOWN,
    BigNumber.ROUND_HALF_EVEN,
  ),
  // bignumber.js names it comparedTo, not cmp
  compare: (first, second) => first.comparedTo(second),
  allocate3(value) {
    const parts = [1, 1, 1].map((ratio) =>
      value.times(ratio).div(3).decimalPlaces(2, BigNumber.ROUND_DOWN),
    );
    let remainder = value.minus(parts.reduce((sum, part) => sum.plus(part), new BigNumber(0)));
    for (let index = 0; remainder.gt(0); index++) {
      parts[index] = parts[index].plus('0.01');
      remainder = remainder.minus('0.01');
    }
    return parts;
  },
};

const implementations: Record<string, Implementation> = {
  'ducat methods': {
    fromMinor: (amount) => ducat.fromMinor(amount, 'EUR'),
    parse: (decimal) => ducat.money(decimal, 'EUR'),
    add: (first, second) => first.add(second),
    mulRatio: (value) => value.multiply(ducatRatio, 'halfEven'),
    allocate3: (value) => value.allocate([1, 1, 1]),
    toDecimal: (value) => value.toDecimal(),
    format: (value) => value.format('en-US'),
    compare: (first, second) => first.compare(second),
    notes: 'method calls',
  },
  'ducat functions': {
    fromMinor: (amount) => ducat.fromMinor(amount, 'EUR'),
    parse: (decimal) => ducat.money(decimal, 'EUR'),
    add: ducat.add,
    mulRatio: (value) => ducat.multiply(value, ducatRatio, 'halfEven'),
    allocate3: (value) => ducat.allocate(value, [1, 1, 1]),
    toDecimal: ducat.toDecimal,
    format: (value) => ducat.format(value, 'en-US'),
    compare: ducat.compare,
    notes: 'free functions',
  },
  'dinero.js 2': {
    fromMinor: (amount) => Dinero2.dinero({ amount, currency: Dinero2Eur }),
    // no parser in dinero.js: strip the "." and pass minor units
    parse: (decimal) =>
      Dinero2.dinero({ amount: Number(decimal.replace('.', '')), currency: Dinero2Eur }),
    add: Dinero2.add,
    mulRatio: (value) =>
      Dinero2.transformScale(
        Dinero2.multiply(value, { amount: 1075, scale: 3 }),
        2,
        Dinero2.halfEven,
      ),
    allocate3: (value) => Dinero2.allocate(value, [1, 1, 1]),
    toDecimal: (value) => Dinero2.toDecimal(value),
    format: (value) =>
      Dinero2.toDecimal(value, ({ value: decimal }) => euroFormat.format(Number(decimal))),
    compare: Dinero2.compare,
    notes: 'no parser: parse = strip "." and pass minor units',
  },
  'dinero.js 2 bigint': {
    fromMinor: (amount) =>
      Dinero2Bigint.dinero({ amount: BigInt(amount), currency: Dinero2BigintEur }),
    parse: (decimal) =>
      Dinero2Bigint.dinero({
        amount: BigInt(decimal.replace('.', '')),
        currency: Dinero2BigintEur,
      }),
    add: Dinero2Bigint.add,
    mulRatio: (value) =>
      Dinero2Bigint.transformScale(
        Dinero2Bigint.multiply(value, { amount: 1075n, scale: 3n }),
        2n,
        Dinero2Bigint.halfEven,
      ),
    allocate3: (value) => Dinero2Bigint.allocate(value, [1n, 1n, 1n]),
    toDecimal: (value) => Dinero2Bigint.toDecimal(value),
    format: (value) =>
      Dinero2Bigint.toDecimal(value, ({ value: decimal }) => euroFormat.format(decimal)),
    compare: Dinero2Bigint.compare,
  },
  'dinero.js 1': {
    fromMinor: (amount) => Dinero1({ amount, currency: 'EUR' }),
    parse: (decimal) => Dinero1({ amount: Number(decimal.replace('.', '')), currency: 'EUR' }),
    add: (first, second) => first.add(second),
    mulRatio: (value) => value.multiply(1.075, 'HALF_EVEN'),
    allocate3: (value) => value.allocate([1, 1, 1]),
    toDecimal: (value) => value.toUnit().toFixed(2),
    format: (value) => euroFormat.format(value.toUnit()),
    compare: dinero1Compare,
    notes: 'float multiply; toUnit() is a float',
  },
  'currency.js': {
    fromMinor: (amount) => currency(amount, { fromCents: true }),
    parse: (decimal) => currency(decimal),
    add: (first, second) => first.add(second),
    mulRatio: (value) => value.multiply(1.075),
    allocate3: (value) => value.distribute(3),
    toDecimal: (value) => value.toString(),
    format: (value) => euroFormat.format(value.value),
    compare: (first, second) => first.value - second.value,
    notes: 'float; fixed half-up, no half-even',
  },
  'js-money': {
    fromMinor: (amount) => new JsMoney(amount, JsMoney.EUR),
    parse: (decimal) => JsMoney.fromDecimal(Number(decimal), 'EUR', Math.round),
    add: (first, second) => first.add(second),
    mulRatio: (value) => value.multiply(1.075, Math.round),
    allocate3: (value) => value.allocate([1, 1, 1]),
    toDecimal: (value) => value.toString(),
    format: (value) => euroFormat.format(value.toDecimal()),
    compare: (first, second) => first.compare(second),
    notes: 'float multiply; Math.round',
  },
  'ts-money': {
    fromMinor: (amount) => new TsMoney(amount, TsCurrencies.EUR),
    parse: (decimal) => TsMoney.fromDecimal(Number(decimal), 'EUR'),
    add: (first, second) => first.add(second),
    mulRatio: (value) => value.multiply(1.075, Math.round),
    allocate3: (value) => value.allocate([1, 1, 1]),
    toDecimal: (value) => value.toString(),
    format: (value) => euroFormat.format(value.toDecimal()),
    compare: (first, second) => first.compare(second),
    notes: 'float multiply; Math.round',
  },
  '@screeny05/ts-money': {
    fromMinor: (amount) => new ScreenyMoney(amount, ScreenyCurrencies.EUR),
    parse: (decimal) => ScreenyMoney.fromDecimal(Number(decimal), 'EUR'),
    add: (first, second) => first.add(second),
    mulRatio: (value) => value.multiply(1.075, Math.round),
    allocate3: (value) => value.allocate([1, 1, 1]),
    toDecimal: (value) => value.toString(),
    format: (value) => euroFormat.format(value.toDecimal()),
    compare: (first, second) => first.compare(second),
    notes: 'float multiply; Math.round',
  },
  monetra: {
    fromMinor: (amount) => Monetra.Money.fromMinor(amount, 'EUR'),
    parse: (decimal) => Monetra.Money.fromMajor(decimal, 'EUR'),
    add: (first, second) => first.add(second),
    mulRatio: (value) => value.multiply('1.075', { rounding: Monetra.RoundingMode.HALF_EVEN }),
    allocate3: (value) => value.allocate([1, 1, 1]),
    toDecimal: (value) => value.toDecimalString(),
    format: (value) => euroFormat.format(value.toDecimalString()),
    compare: (first, second) => first.compare(second),
  },
  'bigint-money': {
    fromMinor: (amount) => new BigintMoney(BigInt(amount), 'EUR').divide(100),
    parse: (decimal) => new BigintMoney(decimal, 'EUR', BigintRound.HALF_TO_EVEN),
    add: (first, second) => first.add(second),
    mulRatio: (value) =>
      new BigintMoney(value.multiply('1.075').toFixed(2), 'EUR', BigintRound.HALF_TO_EVEN),
    allocate3: (value) => value.allocate(3, 2),
    toDecimal: (value) => value.toFixed(2),
    format: (value) => euroFormat.format(value.toFixed(2)),
    compare: (first, second) => first.compare(second),
  },
  'big.js': decimalImplementation(
    Big,
    (decimal, mode) => decimal.round(2, mode),
    Big.roundDown,
    Big.roundHalfEven,
  ),
  'bignumber.js': bigNumberImplementation,
  'decimal.js': decimalJsImplementation(Decimal),
  'decimal.js-light': decimalJsImplementation(DecimalLight),
  'Prisma.Decimal': decimalJsImplementation(PrismaDecimal),
};

const OPERATIONS = [
  'fromMinor',
  'parse',
  'add',
  'mulRatio',
  'allocate3',
  'toDecimal',
  'format',
  'compare',
] as const;
type Operation = (typeof OPERATIONS)[number];

function operationBodies(implementation: Implementation): Record<Operation, () => unknown> {
  const values = cents.map((amount) => implementation.fromMinor(amount));

  return {
    fromMinor() {
      let last;
      for (let i = 0; i < N; i++) {
        last = implementation.fromMinor(cents[i]!);
      }
      return last;
    },
    parse() {
      let last;
      for (let i = 0; i < N; i++) {
        last = implementation.parse(decimals[i]!);
      }
      return last;
    },
    add() {
      let total = values[0];
      for (let i = 1; i < N; i++) {
        total = implementation.add(total, values[i]);
      }
      return total;
    },
    mulRatio() {
      let last;
      for (let i = 0; i < N; i++) {
        last = implementation.mulRatio(values[i]);
      }
      return last;
    },
    allocate3() {
      let last;
      for (let i = 0; i < N; i++) {
        last = implementation.allocate3(values[i]);
      }
      return last;
    },
    toDecimal() {
      let last;
      for (let i = 0; i < N; i++) {
        last = implementation.toDecimal(values[i]);
      }
      return last;
    },
    format() {
      let last;
      for (let i = 0; i < N; i++) {
        last = implementation.format(values[i]);
      }
      return last;
    },
    compare() {
      let ascending = 0;
      for (let i = 1; i < N; i++) {
        if (implementation.compare(values[i - 1], values[i]) < 0) {
          ascending++;
        }
      }
      return ascending;
    },
  };
}

/** Every library must compute the same sum, so no library is timed doing something else. */
function checkAddAgrees(names: string[]): void {
  const first = ducat.fromMinor(cents[0]!, 'EUR');
  const second = ducat.fromMinor(cents[1]!, 'EUR');
  const expected = ducat.toDecimal(ducat.add(first, second));

  for (const name of names) {
    const implementation = implementations[name]!;
    const sum = implementation.add(
      implementation.fromMinor(cents[0]!),
      implementation.fromMinor(cents[1]!),
    );
    const actual = implementation.toDecimal(sum);
    if (actual !== expected) {
      throw new Error(`${name} add sanity: ${actual} != ${expected}`);
    }
  }
}

const names = Object.keys(implementations).filter((name) => !ONLY || ONLY.includes(name));
checkAddAgrees(names);

// add and compare work on N - 1 pairs
runBenchmark({
  libraries: Object.keys(implementations),
  operations: OPERATIONS,
  bodiesFor: (name) => operationBodies(implementations[name]!),
  innerCount: (operation) => (operation === 'add' || operation === 'compare' ? N - 1 : N),
});
