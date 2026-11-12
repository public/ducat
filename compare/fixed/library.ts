// The interface every fixed-point decimal library is driven through, shared by the fixed-point
// battery (fixed/vectors.ts, with vectors from @ducatjs/money-spec) and benchmark (fixed/bench.ts).
// Rounding modes are the two that matter for money; a library that cannot round a given way throws
// NotSupported ("n/a").

export type FixedRounding = 'halfEven' | 'halfExpand';

/** Thrown when a library has no such capability or rounding mode; never emulated. */
export class FixedNotSupported extends Error {}

export interface FixedLibrary<Value = unknown> {
  readonly name: string;
  /** a decimal string such as "-12.345" */
  parse(text: string): Value;
  add(first: Value, second: Value): Value;
  /** value x factor, rounded once to `scale` decimals */
  multiply(value: Value, factor: string, scale: number, mode: FixedRounding): Value;
  /** value / divisor, rounded once to `scale` decimals */
  divide(value: Value, divisor: string, scale: number, mode: FixedRounding): Value;
  /** value rounded to `scale` decimals */
  round(value: Value, scale: number, mode: FixedRounding): Value;
  /** -1, 0 or 1 */
  compare(first: Value, second: Value): number;
  /** a plain decimal string (trailing zeros are normalised away by the battery) */
  toString(value: Value): string;
}
