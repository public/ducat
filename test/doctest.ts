// Checks used by the README examples that test/readme.test.ts generates.
import { ValiError } from 'valibot';
import { ZodError } from 'zod';
import { FetchRatesError } from '../src/fetch.js';
import { Fixed } from '../src/fixed.js';
import { CurrencyMismatchError, isMoney } from '../src/money.js';
import { RateUnavailableError } from '../src/provider.js';
import { RateExpiredError } from '../src/rate.js';
import { RoundingError } from '../src/rounding-error.js';

/** A value as the README writes it. */
export function show(value: unknown): string {
  if (isMoney(value)) {
    return value.toString();
  }
  if (value instanceof Fixed) {
    return value.toString();
  }
  if (typeof value === 'string') {
    return `'${value}'`;
  }
  if (typeof value === 'bigint') {
    return `${value}n`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(show).join(', ')}]`;
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const entries = Object.entries(value).map(([key, entry]) => `${key}: ${show(entry)}`);
    return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
  }
  return String(value);
}

export interface Failure {
  line: number;
  message: string;
}
export const failures: Failure[] = [];

/** The value must be what the comment starts with, followed by nothing or a note. */
export function check(line: number, value: unknown, expected: string): void {
  const actual = show(value);
  const rest = expected.startsWith(actual) ? expected.slice(actual.length) : undefined;
  if (rest === undefined || !(rest === '' || /^(\s+\(|:\s|,\s|\s+—)/.test(rest))) {
    failures.push({ line, message: `expected ${expected}\n         got ${actual}` });
  }
}

/** The error classes a README `// throws ClassName` comment can name. */
const ERROR_CLASSES: Record<string, abstract new (...args: never[]) => Error> = {
  CurrencyMismatchError,
  FetchRatesError,
  RateExpiredError,
  RateUnavailableError,
  RoundingError,
  ValiError,
  ZodError,
  Error,
  RangeError,
  SyntaxError,
  TypeError,
};

/** `RoundingError` from `// throws RoundingError: note`, or undefined when no class is named. */
export function documentedErrorClass(comment: string): string | undefined {
  return /^([A-Z][A-Za-z0-9]*Error)\b/.exec(comment)?.[1];
}

/**
 * The call must throw, and when `errorName` is given, an instance of that class (a subclass counts:
 * `RoundingError` is a `RangeError`).
 */
export function checkThrows(line: number, run: () => unknown, errorName?: string): void {
  let value: unknown;
  try {
    value = run();
  } catch (error) {
    if (errorName === undefined) {
      return;
    }
    const errorClass = ERROR_CLASSES[errorName];
    if (errorClass === undefined) {
      failures.push({ line, message: `${errorName} is not an error class test/doctest.ts knows` });
    } else if (!(error instanceof errorClass)) {
      const actual =
        error instanceof Error ? `${error.constructor.name}: ${error.message}` : show(error);
      failures.push({ line, message: `expected ${errorName}, got ${actual}` });
    }
    return;
  }
  failures.push({ line, message: `expected an error, got ${show(value)}` });
}
