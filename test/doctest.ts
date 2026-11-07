// Checks used by the README examples that test/readme.test.ts generates.
import { Fixed } from '../src/fixed.js';
import { isMoney } from '../src/money.js';

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

export function checkThrows(line: number, run: () => unknown): void {
  try {
    const value = run();
    failures.push({ line, message: `expected an error, got ${show(value)}` });
  } catch {
    // the documented error
  }
}
