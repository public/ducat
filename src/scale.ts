// Moving an integer between decimal scales, for Fixed. It needs neither Money nor the currency
// table, so the Fixed bundle carries neither. src/money.ts keeps its own copy of these helpers:
// calling them across modules costs Money up to 20% on its benchmarks under vitest, where every
// imported call goes through a getter. test/fixed.test.ts checks that the two copies agree.
import { normalizeMinor, POW10, pow10n } from './decimal.js';
import { divideAndRound, divideAndRoundBigint, type RoundingMode } from './rounding.js';

// A module-local constant, not an import: V8 reads an imported binding through an extra indirection.
const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

/** @internal a minor amount as a bigint */
export const toBigInt = (minor: number | bigint): bigint =>
  typeof minor === 'bigint' ? minor : BigInt(minor);

/** @internal v * 10^e exactly (e >= 0) */
export function scaleUp(minor: number | bigint, exponent: number): number | bigint {
  if (exponent === 0) {
    return minor;
  }
  if (typeof minor === 'number' && exponent <= 15) {
    const scaled = minor * POW10[exponent]!;
    if (scaled <= MAX_SAFE_MINOR && scaled >= -MAX_SAFE_MINOR) {
      return scaled;
    }
  }
  return normalizeMinor(toBigInt(minor) * pow10n(exponent));
}

/** @internal v / 10^e rounded (e >= 0) */
export function scaleDown(
  minor: number | bigint,
  exponent: number,
  mode: RoundingMode,
): number | bigint {
  if (exponent === 0) {
    return minor;
  }
  if (typeof minor === 'number' && exponent <= 15) {
    return divideAndRound(minor, POW10[exponent]!, mode);
  }
  return normalizeMinor(divideAndRoundBigint(toBigInt(minor), pow10n(exponent), mode));
}
