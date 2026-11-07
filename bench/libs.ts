// Same seven operations across money libraries. Each op processes N=1000 pre-built values;
// results are ns per single operation (median of 5 short samples). Indicative only: see README.
import { bench, log, runtimeName } from './harness.ts';
import * as M from '../src/plugins/all.ts';
import {
  dinero,
  add as dAdd,
  multiply as dMul,
  allocate as dAlloc,
  transformScale,
  halfEven,
  toDecimal as dToDecimal,
  compare as dCompare,
} from 'dinero.js';
import { EUR } from 'dinero.js/currencies';
import currency from 'currency.js';
import Big from 'big.js';
import { Decimal as DecimalJs } from 'decimal.js';
import { Money as TsMoney, Currencies } from 'ts-money';
import { Decimal as PrismaDecimal } from '@prisma/client/runtime/index-browser';

const N = 1000;
const cents = Array.from({ length: N }, (_, i) => ((i * 7919) % 10_000_000) + 1);
const strs = cents.map((c) => M.toDecimal(M.fromMinor(c, 'EUR')));
const nf = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type Impl<T> = {
  fromMinor: (c: number) => T;
  parse: (s: string) => T;
  add: (a: T, b: T) => T;
  mulRatio: (a: T) => T; // * 1.075, round half-even to cents (where the library can)
  allocate3: (a: T) => T[];
  toDecimal: (a: T) => string;
  format: (a: T) => string; // Intl, en-US
  compare: (a: T, b: T) => number;
};

// big.js / decimal.js have no money semantics: a minimal "Money on a decimal" wrapper with
// largest-remainder allocation, which is what an app would hand-roll on top of them.
function decimalAllocate<
  D extends {
    times(x: number | string | D): D;
    div(x: number | string | D): D;
    minus(x: D): D;
    plus(x: D | number | string): D;
    cmp(x: D): number;
  },
>(x: D, ratios: number[], floor2: (d: D) => D, cent: D, zero: D): D[] {
  const total = ratios.reduce((a, b) => a + b, 0);
  const out = ratios.map((r) => floor2(x.times(r).div(total)));
  let rem = out.reduce((a, b) => a.plus(b), zero);
  rem = x.minus(rem);
  for (let i = 0; rem.cmp(zero) > 0; i++, rem = rem.minus(cent)) out[i] = out[i]!.plus(cent);
  return out;
}

const ratio1075 = M.ratio('1.075');
const impls: Record<string, Impl<any>> = {
  'this lib': {
    fromMinor: (c) => M.fromMinor(c, 'EUR'),
    parse: (s) => M.money(s, 'EUR'),
    add: M.add,
    mulRatio: (a) => M.multiply(a, ratio1075, 'halfEven'),
    allocate3: (a) => M.allocate(a, [1, 1, 1]),
    toDecimal: M.toDecimal,
    format: (a) => M.format(a, 'en-US'),
    compare: M.compare,
  },
  'dinero.js 2': {
    fromMinor: (c) => dinero({ amount: c, currency: EUR }),
    parse: (s) => dinero({ amount: Number(s.replace('.', '')), currency: EUR }), // no parser: hand-rolled
    add: dAdd,
    mulRatio: (a) => transformScale(dMul(a, { amount: 1075, scale: 3 }), 2, halfEven),
    allocate3: (a) => dAlloc(a, [1, 1, 1]),
    toDecimal: (a) => dToDecimal(a),
    format: (a) => dToDecimal(a, ({ value }) => nf.format(Number(value))),
    compare: dCompare,
  },
  'currency.js': {
    fromMinor: (c) => currency(c, { fromCents: true }),
    parse: (s) => currency(s),
    add: (a, b) => a.add(b),
    mulRatio: (a) => a.multiply(1.075), // float multiply, fixed half-up: cannot do half-even
    allocate3: (a) => a.distribute(3),
    toDecimal: (a) => a.toString(),
    format: (a) => nf.format(a.value),
    compare: (a, b) => a.value - b.value,
  },
  'big.js': {
    fromMinor: (c) => new Big(c).div(100),
    parse: (s) => new Big(s),
    add: (a, b) => a.plus(b),
    mulRatio: (a) => a.times('1.075').round(2, Big.roundHalfEven),
    allocate3: (a) => decimalAllocate(a, [1, 1, 1], (d: Big) => d.round(2, Big.roundDown), new Big('0.01'), new Big(0)),
    toDecimal: (a) => a.toFixed(2),
    format: (a) => nf.format(a.toFixed(2)),
    compare: (a, b) => a.cmp(b),
  },
  'decimal.js': {
    fromMinor: (c) => new DecimalJs(c).div(100),
    parse: (s) => new DecimalJs(s),
    add: (a, b) => a.plus(b),
    mulRatio: (a) => a.times('1.075').toDecimalPlaces(2, DecimalJs.ROUND_HALF_EVEN),
    allocate3: (a) =>
      decimalAllocate(
        a,
        [1, 1, 1],
        (d: DecimalJs) => d.toDecimalPlaces(2, DecimalJs.ROUND_DOWN),
        new DecimalJs('0.01'),
        new DecimalJs(0),
      ),
    toDecimal: (a) => a.toFixed(2),
    format: (a) => nf.format(a.toFixed(2)),
    compare: (a, b) => a.cmp(b),
  },
  'Prisma.Decimal': {
    fromMinor: (c) => new PrismaDecimal(c).div(100),
    parse: (s) => new PrismaDecimal(s),
    add: (a, b) => a.plus(b),
    mulRatio: (a) => a.times('1.075').toDecimalPlaces(2, PrismaDecimal.ROUND_HALF_EVEN),
    allocate3: (a) =>
      decimalAllocate(
        a,
        [1, 1, 1],
        (d: PrismaDecimal) => d.toDecimalPlaces(2, PrismaDecimal.ROUND_DOWN),
        new PrismaDecimal('0.01'),
        new PrismaDecimal(0),
      ),
    toDecimal: (a) => a.toFixed(2),
    format: (a) => nf.format(a.toFixed(2)),
    compare: (a, b) => a.cmp(b),
  },
  'ts-money': {
    fromMinor: (c) => new TsMoney(c, Currencies.EUR!),
    parse: (s) => TsMoney.fromDecimal(Number(s), 'EUR'),
    add: (a, b) => a.add(b),
    mulRatio: (a) => a.multiply(1.075, Math.round), // float multiply; Math.round is half-ceil
    allocate3: (a) => a.allocate([1, 1, 1]),
    toDecimal: (a) => a.toString(),
    format: (a) => nf.format(a.toDecimal()),
    compare: (a, b) => a.compare(b),
  },
};

const only = (globalThis as any).BENCH_ONLY as string[] | undefined;
const ops = ['fromMinor', 'parse', 'add', 'mulRatio', 'allocate3', 'toDecimal', 'format', 'compare'] as const;
const table: Record<string, Record<string, number>> = {};
for (const [name, impl] of Object.entries(impls)) {
  if (only && !only.includes(name)) continue;
  const xs = cents.map(impl.fromMinor);
  // sanity check: every library computes the same thing for the exact ops
  const check = impl.toDecimal(impl.add(xs[0], xs[1]));
  if (check !== M.toDecimal(M.add(M.fromMinor(cents[0]!, 'EUR'), M.fromMinor(cents[1]!, 'EUR'))))
    throw new Error(`${name} add mismatch: ${check}`);
  const run: Record<(typeof ops)[number], () => unknown> = {
    fromMinor: () => {
      let l;
      for (let i = 0; i < N; i++) l = impl.fromMinor(cents[i]!);
      return l;
    },
    parse: () => {
      let l;
      for (let i = 0; i < N; i++) l = impl.parse(strs[i]!);
      return l;
    },
    add: () => {
      let acc = xs[0];
      for (let i = 1; i < N; i++) acc = impl.add(acc, xs[i]);
      return acc;
    },
    mulRatio: () => {
      let l;
      for (let i = 0; i < N; i++) l = impl.mulRatio(xs[i]);
      return l;
    },
    allocate3: () => {
      let l;
      for (let i = 0; i < N; i++) l = impl.allocate3(xs[i]);
      return l;
    },
    toDecimal: () => {
      let l;
      for (let i = 0; i < N; i++) l = impl.toDecimal(xs[i]);
      return l;
    },
    format: () => {
      let l;
      for (let i = 0; i < N; i++) l = impl.format(xs[i]);
      return l;
    },
    compare: () => {
      let c = 0;
      for (let i = 1; i < N; i++) c += impl.compare(xs[i - 1], xs[i]) < 0 ? 1 : 0;
      return c;
    },
  };
  for (const op of ops)
    (table[op] ??= {})[name] = bench(`${name} ${op}`, run[op], op === 'add' || op === 'compare' ? N - 1 : N).nsPerOp;
}

const names = Object.keys(impls).filter((n) => !only || only.includes(n));
log(`### ${runtimeName()}`);
log('');
log(`| ns/op (lower is better) | ${names.join(' | ')} |`);
log(`|---|${names.map(() => '---:').join('|')}|`);
for (const op of ops) log(`| ${op} | ${names.map((n) => fmt(table[op]![n]!)).join(' | ')} |`);
log('');
function fmt(x: number): string {
  return x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
}
