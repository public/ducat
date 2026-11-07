// Representation shoot-out: the same seven operations implemented four ways.
// Used to pick the library's internal representation. Not part of the library.
import { bench, log, runtimeName, type Result } from './harness.ts';

const MAX = Number.MAX_SAFE_INTEGER;

// --- shared: ratio 1.075 as n/d, half-even division -------------------------------
function divHalfEvenNum(p: number, d: number): number {
  let q = Math.trunc(p / d);
  let r = p - q * d;
  if (r !== 0 && r < 0 !== p < 0) {
    q += p < 0 ? 1 : -1;
    r = p - q * d;
  }
  const twice = Math.abs(r) * 2;
  if (twice > d || (twice === d && q % 2 !== 0)) q += p < 0 ? -1 : 1;
  return q;
}
function divHalfEvenBig(p: bigint, d: bigint): bigint {
  let q = p / d;
  const r = p - q * d;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice > d || (twice === d && q % 2n !== 0n)) q += p < 0n ? -1n : 1n;
  return q;
}

// --- A: integer minor units in a number, bigint only on overflow -------------------
class A {
  constructor(
    readonly currency: string,
    readonly minor: number | bigint,
    readonly scale: number,
  ) {}
}
class AF {
  constructor(
    readonly currency: string,
    readonly minor: number | bigint,
    readonly scale: number,
  ) {
    Object.freeze(this);
  }
}
type AMoney = A | AF;
function aAdd<T extends AMoney>(
  C: new (c: string, m: number | bigint, s: number) => T,
  x: T,
  y: T,
): T {
  if (x.currency !== y.currency) throw new TypeError('mismatch');
  const a = x.minor,
    b = y.minor;
  if (typeof a === 'number' && typeof b === 'number') {
    const r = a + b;
    if (r <= MAX && r >= -MAX) return new C(x.currency, r, x.scale);
  }
  return new C(x.currency, BigInt(a) + BigInt(b), x.scale);
}
function aMul<T extends AMoney>(
  C: new (c: string, m: number | bigint, s: number) => T,
  x: T,
  n: number,
  d: number,
): T {
  const a = x.minor;
  if (typeof a === 'number') {
    const p = a * n;
    if (p <= MAX && p >= -MAX) return new C(x.currency, divHalfEvenNum(p, d), x.scale);
  }
  return new C(x.currency, divHalfEvenBig(BigInt(a) * BigInt(n), BigInt(d)), x.scale);
}
function aAlloc<T extends AMoney>(
  C: new (c: string, m: number | bigint, s: number) => T,
  x: T,
  ratios: number[],
): T[] {
  const a = x.minor as number;
  let total = 0;
  for (const r of ratios) total += r;
  const out: T[] = new Array(ratios.length);
  let rem = a;
  for (let i = 0; i < ratios.length; i++) {
    const share = Math.floor((a * ratios[i]!) / total);
    out[i] = new C(x.currency, share, x.scale);
    rem -= share;
  }
  for (let i = 0; rem > 0; i++, rem--)
    out[i] = new C(x.currency, (out[i]!.minor as number) + 1, x.scale);
  return out;
}
function aFormat(x: AMoney): string {
  const a = x.minor as number,
    s = x.scale;
  const neg = a < 0;
  const str = String(neg ? -a : a).padStart(s + 1, '0');
  return (neg ? '-' : '') + str.slice(0, str.length - s) + '.' + str.slice(str.length - s);
}
function aParse<T extends AMoney>(
  C: new (c: string, m: number | bigint, s: number) => T,
  str: string,
  cur: string,
  s: number,
): T {
  const dot = str.indexOf('.');
  const int = dot < 0 ? str : str.slice(0, dot);
  const frac = dot < 0 ? '' : str.slice(dot + 1);
  const digits = int + frac.padEnd(s, '0');
  const n = Number(digits);
  return new C(cur, Number.isSafeInteger(n) ? n : BigInt(digits), s);
}
function aCmp(x: AMoney, y: AMoney): number {
  const a = x.minor,
    b = y.minor;
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- B: bigint everywhere -----------------------------------------------------------
class B {
  constructor(
    readonly currency: string,
    readonly minor: bigint,
    readonly scale: number,
  ) {}
}
const bAdd = (x: B, y: B) => {
  if (x.currency !== y.currency) throw new TypeError('mismatch');
  return new B(x.currency, x.minor + y.minor, x.scale);
};
const bMul = (x: B, n: bigint, d: bigint) =>
  new B(x.currency, divHalfEvenBig(x.minor * n, d), x.scale);
function bAlloc(x: B, ratios: bigint[]): B[] {
  let total = 0n;
  for (const r of ratios) total += r;
  const out: B[] = new Array(ratios.length);
  let rem = x.minor;
  for (let i = 0; i < ratios.length; i++) {
    const share = (x.minor * ratios[i]!) / total;
    out[i] = new B(x.currency, share, x.scale);
    rem -= share;
  }
  for (let i = 0; rem > 0n; i++, rem--) out[i] = new B(x.currency, out[i]!.minor + 1n, x.scale);
  return out;
}
function bFormat(x: B): string {
  const neg = x.minor < 0n;
  const str = (neg ? -x.minor : x.minor).toString().padStart(x.scale + 1, '0');
  return (
    (neg ? '-' : '') + str.slice(0, str.length - x.scale) + '.' + str.slice(str.length - x.scale)
  );
}
function bParse(str: string, cur: string, s: number): B {
  const dot = str.indexOf('.');
  const int = dot < 0 ? str : str.slice(0, dot);
  const frac = dot < 0 ? '' : str.slice(dot + 1);
  return new B(cur, BigInt(int + frac.padEnd(s, '0')), s);
}
const bCmp = (x: B, y: B) => (x.minor < y.minor ? -1 : x.minor > y.minor ? 1 : 0);

// --- C: decimal string as the stored value (arithmetic via bigint on demand) --------
class S {
  constructor(
    readonly currency: string,
    readonly amount: string,
  ) {}
}
const sToBig = (s: string, scale: number) => bParse(s, '', scale).minor;
const sFromBig = (v: bigint, scale: number) => bFormat(new B('', v, scale));
const sAdd = (x: S, y: S) => {
  if (x.currency !== y.currency) throw new TypeError('mismatch');
  return new S(x.currency, sFromBig(sToBig(x.amount, 2) + sToBig(y.amount, 2), 2));
};
const sMul = (x: S, n: bigint, d: bigint) =>
  new S(x.currency, sFromBig(divHalfEvenBig(sToBig(x.amount, 2) * n, d), 2));
const sAlloc = (x: S, r: bigint[]) =>
  bAlloc(new B(x.currency, sToBig(x.amount, 2), 2), r).map((b) => new S(x.currency, bFormat(b)));
const sCmp = (x: S, y: S) =>
  bCmp(new B('', sToBig(x.amount, 2), 2), new B('', sToBig(y.amount, 2), 2));

// --- run ---------------------------------------------------------------------------
const N = 1000;
const ints = Array.from({ length: N }, (_, i) => ((i * 7919) % 1_000_000) + 1);
const strs = ints.map((i) => aFormat(new A('EUR', i, 2)));
const ratios = [1, 1, 1];
const ratiosB = [1n, 1n, 1n];

function suite<T>(
  label: string,
  mk: (i: number) => T,
  ops: Record<string, (xs: T[]) => unknown>,
): Result[] {
  const xs = ints.map(mk);
  return Object.entries(ops).map(([op, f]) => {
    const r = bench(`${label} ${op}`, () => f(xs), N);
    return r;
  });
}

const results: Record<string, Record<string, number>> = {};
function record(rs: Result[]) {
  for (const r of rs) {
    const [design, op] = r.name.split(' ');
    (results[op!] ??= {})[design!] = r.nsPerOp;
  }
}

for (const [label, C] of [
  ['A:number+bigint', A],
  ['A+freeze', AF],
] as const) {
  record(
    suite(label, (i) => new (C as any)('EUR', i, 2) as AMoney, {
      construct: (_xs) => {
        let last;
        for (let i = 0; i < N; i++) last = new (C as any)('EUR', ints[i]!, 2);
        return last;
      },
      add: (xs) => {
        let acc = xs[0]!;
        for (let i = 1; i < N; i++) acc = aAdd(C as any, acc, xs[i]!);
        return acc;
      },
      mulRatio: (xs) => {
        let last;
        for (let i = 0; i < N; i++) last = aMul(C as any, xs[i]!, 1075, 1000);
        return last;
      },
      allocate3: (xs) => {
        let last;
        for (let i = 0; i < N; i++) last = aAlloc(C as any, xs[i]!, ratios);
        return last;
      },
      format: (xs) => {
        let last;
        for (let i = 0; i < N; i++) last = aFormat(xs[i]!);
        return last;
      },
      parse: () => {
        let last;
        for (let i = 0; i < N; i++) last = aParse(C as any, strs[i]!, 'EUR', 2);
        return last;
      },
      compare: (xs) => {
        let c = 0;
        for (let i = 1; i < N; i++) c += aCmp(xs[i - 1]!, xs[i]!);
        return c;
      },
    }),
  );
}
record(
  suite('B:bigint', (i) => new B('EUR', BigInt(i), 2), {
    construct: () => {
      let last;
      for (let i = 0; i < N; i++) last = new B('EUR', BigInt(ints[i]!), 2);
      return last;
    },
    add: (xs) => {
      let acc = xs[0]!;
      for (let i = 1; i < N; i++) acc = bAdd(acc, xs[i]!);
      return acc;
    },
    mulRatio: (xs) => {
      let last;
      for (let i = 0; i < N; i++) last = bMul(xs[i]!, 1075n, 1000n);
      return last;
    },
    allocate3: (xs) => {
      let last;
      for (let i = 0; i < N; i++) last = bAlloc(xs[i]!, ratiosB);
      return last;
    },
    format: (xs) => {
      let last;
      for (let i = 0; i < N; i++) last = bFormat(xs[i]!);
      return last;
    },
    parse: () => {
      let last;
      for (let i = 0; i < N; i++) last = bParse(strs[i]!, 'EUR', 2);
      return last;
    },
    compare: (xs) => {
      let c = 0;
      for (let i = 1; i < N; i++) c += bCmp(xs[i - 1]!, xs[i]!);
      return c;
    },
  }),
);
record(
  suite('C:string', (i) => new S('EUR', strs[ints.indexOf(i)]!), {
    construct: () => {
      let last;
      for (let i = 0; i < N; i++) last = new S('EUR', strs[i]!);
      return last;
    },
    add: (xs) => {
      let acc = xs[0]!;
      for (let i = 1; i < N; i++) acc = sAdd(acc, xs[i]!);
      return acc;
    },
    mulRatio: (xs) => {
      let last;
      for (let i = 0; i < N; i++) last = sMul(xs[i]!, 1075n, 1000n);
      return last;
    },
    allocate3: (xs) => {
      let last;
      for (let i = 0; i < N; i++) last = sAlloc(xs[i]!, ratiosB);
      return last;
    },
    format: (xs) => {
      let last;
      for (let i = 0; i < N; i++) last = xs[i]!.amount;
      return last;
    },
    parse: () => {
      let last;
      for (let i = 0; i < N; i++) last = new S('EUR', strs[i]!);
      return last;
    },
    compare: (xs) => {
      let c = 0;
      for (let i = 1; i < N; i++) c += sCmp(xs[i - 1]!, xs[i]!);
      return c;
    },
  }),
);

// overflow path: the cost of the bigint fallback in design A once amounts exceed 2^53
{
  const big = ints.map((i) => new A('EUR', BigInt(i) * 10n ** 15n, 2));
  record([
    bench(
      'A:bigint-path add',
      () => {
        let acc = big[0]!;
        for (let i = 1; i < N; i++) acc = aAdd(A, acc, big[i]!);
        return acc;
      },
      N,
    ),
    bench(
      'A:bigint-path mulRatio',
      () => {
        let last;
        for (let i = 0; i < N; i++) last = aMul(A, big[i]!, 1075, 1000);
        return last;
      },
      N,
    ),
  ]);
}

const designs = ['A:number+bigint', 'A+freeze', 'B:bigint', 'C:string', 'A:bigint-path'];
log(`### ${runtimeName()} — ns/op, lower is better`);
log('');
log(`| op | ${designs.join(' | ')} |`);
log(`|---|${designs.map(() => '---:').join('|')}|`);
for (const [op, row] of Object.entries(results)) {
  log(
    `| ${op} | ${designs.map((d) => (row[d] === undefined ? '' : row[d]!.toFixed(1))).join(' | ')} |`,
  );
}
