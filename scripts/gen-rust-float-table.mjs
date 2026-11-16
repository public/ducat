#!/usr/bin/env node
/**
 * Writes rust/crates/ducat/tests/it/floats_table.rs: the bits of ducat's floats out (toNumber,
 * toMinorNumber with and without lossy, Fixed#toNumber, ExactMoney#toNumber), as the built
 * TypeScript gives them under Node, for the Rust port's to_f64 and to_minor_f64 to match bit for
 * bit. Run it after `pnpm build`: node scripts/gen-rust-float-table.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const { money } = await import(path.join(dist, 'index.js'));
const { toNumber, toMinorNumber } = await import(path.join(dist, 'fn.js'));
const { fromScaled } = await import(path.join(dist, 'fixed.js'));
const { exact } = await import(path.join(dist, 'plugins/exact.js'));
const { ratio } = await import(path.join(dist, 'decimal.js'));

/** The IEEE 754 bits of a double, as a Rust hex literal. */
function bitsOf(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return `0x${view.getBigUint64(0).toString(16).padStart(16, '0')}`;
}

/** A double as a comment: -0 is spelled out, and long values are cut. */
function show(value) {
  const text = Object.is(value, -0) ? '-0' : String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** The exact decimal string of units × 10^-scale. */
function decimal(units, scale) {
  const negative = units < 0n;
  let digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  if (scale > 0) {
    digits = `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
  }
  return negative ? `-${digits}` : digits;
}

/** The name of what a thunk throws, or the bits of what it returns. */
function outcome(thunk) {
  try {
    return `Ok(${bitsOf(thunk())})`;
  } catch (error) {
    return `Err("${error.name}")`;
  }
}

const SAFE_END = 2n ** 53n;
const LARGEST_MIDPOINT = 2n ** 1024n - 2n ** 970n;

// 0.1, 1.005, 2^53 + 1, ties to even, tiny scales (to 0 and -0), subnormals, the largest double,
// its midpoint (Infinity) and beyond, and a long decimal just above a tie.
const DECIMALS = [
  [1n, 1],
  [1005n, 3],
  [1234n, 2],
  [-5n, 2],
  [0n, 2],
  [0n, 0],
  [SAFE_END + 1n, 0],
  [SAFE_END + 3n, 0],
  [-(SAFE_END + 1n), 0],
  [SAFE_END + 1n, 2],
  [1n, 1000],
  [-1n, 1000],
  [5n, 324],
  [-5n, 324],
  [25n, 325],
  [24n, 325],
  [1n, 400],
  [-1n, 400],
  [1n, 307],
  [22250738585072014n, 324],
  [10n ** 400n, 0],
  [-(10n ** 400n), 0],
  [17976931348623157n, 0],
  [179769313486231570000n * 10n ** 288n, 0],
  [LARGEST_MIDPOINT, 0],
  [LARGEST_MIDPOINT - 1n, 0],
  [1000000000000000055511151231257827021181583404541015625n, 55],
  [(SAFE_END + 1n) * 10n ** 50n + 1n, 50],
  [123456789012345678901234567890n, 10],
  [-999999999999999999999n, 3],
  [3n, 1000],
  [10n ** 1000n, 1000],
  [1n, 0],
  [-1n, 0],
  [100n, 2],
];

const MINORS = [
  ['EUR', 1234n, 2],
  ['EUR', 12345n, 3],
  ['EUR', 12340n, 3],
  ['EUR', SAFE_END - 1n, 2],
  ['EUR', -(SAFE_END - 1n), 2],
  ['EUR', SAFE_END, 2],
  ['EUR', SAFE_END + 1n, 2],
  ['EUR', -(SAFE_END + 1n), 2],
  ['EUR', SAFE_END + 3n, 2],
  ['EUR', 10n ** 400n, 2],
  ['EUR', -(10n ** 400n), 2],
  ['EUR', 10n ** 20n * 1000n + 1n, 3],
  ['JPY', 10000n, 2],
  ['JPY', 5n, 1],
  ['EUR', 5n, 0],
  ['EUR', 0n, 5],
  ['KWD', 1n, 3],
  ['EUR', (SAFE_END + 1n) * 10n, 3],
  ['EUR', 1n, 1000],
  ['EUR', 10n ** 1000n, 1000],
];

// Both of ExactMoney's paths (safe integers and bigints), subnormals, ties, and overflow.
const RATIOS = [
  [10n, 3n],
  [1n, 3n],
  [-2n, 3n],
  [1n, 10n],
  [10n ** 30n, 7n],
  [1n, 10n ** 320n],
  [-1n, 10n ** 320n],
  [7n, 10n ** 315n],
  [1n, 10n ** 400n],
  [-1n, 10n ** 400n],
  [10n ** 400n, 3n],
  [-(10n ** 400n), 7n],
  [SAFE_END + 1n, 1n],
  [SAFE_END + 3n, 1n],
  [SAFE_END - 1n, SAFE_END - 2n],
  [(SAFE_END + 1n) * 3n, 3n],
  [LARGEST_MIDPOINT, 1n],
  [LARGEST_MIDPOINT - 1n, 1n],
  [1n, 2n ** 1074n],
  [1n, 2n ** 1075n],
  [3n, 2n ** 1076n],
  [1n, 3n ** 600n],
  [123456789n, 1000n],
  [0n, 1n],
  [2n ** 70n + 1n, 2n ** 17n],
  [5n, 1n],
  [-5n, 1n],
];

const decimals = DECIMALS.map(([units, scale]) => {
  const amount = money(decimal(units, scale), 'EUR', { scale });
  const value = toNumber(amount);
  const others = [fromScaled(units, scale).toNumber(), Number(decimal(units, scale))];
  if (others.some((other) => !Object.is(other, value))) {
    throw new Error(`toNumber, Fixed#toNumber and Number disagree on ${units}e-${scale}`);
  }
  return `    ("${units}", ${scale}, ${bitsOf(value)}), // ${show(value)}`;
});

const minors = MINORS.flatMap(([code, units, scale]) => {
  const amount = money(decimal(units, scale), code, { scale });
  return [false, true].map((lossy) => {
    const result = outcome(() => toMinorNumber(amount, { lossy }));
    return `    ("${code}", "${units}", ${scale}, ${lossy}, ${result}),`;
  });
});

const one = exact(money('1', 'EUR'));
const exacts = RATIOS.map(([num, den]) => {
  const value = one.multiply(ratio(num, den)).toNumber();
  return `    ("${num}", "${den}", ${bitsOf(value)}), // ${show(value)}`;
});

const lines = [
  '// generated by scripts/gen-rust-float-table.mjs from the built TypeScript: do not edit',
  '',
  '/// (units, scale, bits): `toNumber` of EUR at that scale, and `Fixed#toNumber`.',
  'pub const DECIMALS: &[(&str, u16, u64)] = &[',
  ...decimals,
  '];',
  '',
  '/// (currency, units, scale, lossy, bits or the error ducat throws): `toMinorNumber`.',
  "pub type MinorRow = (&'static str, &'static str, u16, bool, Result<u64, &'static str>);",
  '',
  'pub const MINOR: &[MinorRow] = &[',
  ...minors,
  '];',
  '',
  '/// (numerator, denominator, bits): `ExactMoney#toNumber` of numerator/denominator EUR.',
  'pub const EXACT: &[(&str, &str, u64)] = &[',
  ...exacts,
  '];',
  '',
];
fs.writeFileSync(path.join(root, 'rust/crates/ducat/tests/it/floats_table.rs'), lines.join('\n'));
