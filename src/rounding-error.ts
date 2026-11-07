/**
 * Thrown when an operation would have to round but the rounding mode is `'unnecessary'`. It lives in its
 * own module so the generated kernels can throw it without importing `rounding.ts`, which imports them.
 */
export class RoundingError extends RangeError {
  override name = 'RoundingError';
}
