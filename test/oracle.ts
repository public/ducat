// Independent reference implementation of rounding (bigint, floor-based) used to check the library.
import type { RoundingMode } from '../src/index.js';

export function refDivRound(p: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d < 0n) {
    p = -p;
    d = -d;
  }
  const floor = p >= 0n ? p / d : -((-p + d - 1n) / d);
  const r = p - floor * d; // 0 <= r < d
  if (r === 0n) return floor;
  const ceil = floor + 1n;
  const twice = 2n * r;
  const towardZero = p >= 0n ? floor : ceil;
  const awayZero = p >= 0n ? ceil : floor;
  switch (mode) {
    case 'floor':
      return floor;
    case 'ceil':
      return ceil;
    case 'trunc':
      return towardZero;
    case 'expand':
      return awayZero;
    case 'unnecessary':
      throw new RangeError('inexact');
  }
  if (twice < d) return floor;
  if (twice > d) return ceil;
  switch (mode) {
    case 'halfEven':
      return floor % 2n === 0n ? floor : ceil;
    case 'halfExpand':
      return awayZero;
    case 'halfTrunc':
      return towardZero;
    case 'halfCeil':
      return ceil;
    case 'halfFloor':
      return floor;
  }
  throw new Error('mode');
}

export const MODES: RoundingMode[] = [
  'halfEven',
  'halfExpand',
  'halfTrunc',
  'halfCeil',
  'halfFloor',
  'expand',
  'trunc',
  'ceil',
  'floor',
];
