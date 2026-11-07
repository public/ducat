// The fixed-point benchmark: six operations across fixed-point decimal libraries, timed with the
// same harness and shuffled rounds as the money benchmark (bench/harness.ts). Each operation
// processes N = 1000 pre-built values; the result is nanoseconds per single operation. An operation
// a library cannot do in the requested rounding mode is reported as null ("n/a"), never emulated.
import { runBenchmark } from '../bench/harness.ts';
import { FixedNotSupported, type FixedLibrary } from './library.ts';
import { FIXED_LIBRARIES } from './libraries.ts';

const N = 1000;

// decimal strings with 2 decimals, from 1.00 upwards, as in the money benchmark
const decimals = Array.from({ length: N }, (_, index) => {
  const cents = ((index * 7919) % 10_000_000) + 100;
  const text = String(cents).padStart(3, '0');
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
});

const OPERATIONS = ['parse', 'add', 'multiply', 'divide', 'compare', 'toString'] as const;
type Operation = (typeof OPERATIONS)[number];

const FACTOR = '1.075';
const DIVISOR = '3';
const SCALE = 2;
const MODE = 'halfExpand';

/** Whether the library can do `attempt` at all; FixedNotSupported means it cannot. */
function supports(attempt: () => unknown): boolean {
  try {
    attempt();
    return true;
  } catch (error) {
    if (error instanceof FixedNotSupported) {
      return false;
    }
    throw error;
  }
}

function operationBodies(library: FixedLibrary): Record<Operation, (() => unknown) | null> {
  const values = decimals.map((text) => library.parse(text));
  const canMultiply = supports(() => library.multiply(values[0], FACTOR, SCALE, MODE));
  const canDivide = supports(() => library.divide(values[0], DIVISOR, SCALE, MODE));

  return {
    parse() {
      let last;
      for (let i = 0; i < N; i++) {
        last = library.parse(decimals[i]!);
      }
      return last;
    },
    add() {
      let total = values[0];
      for (let i = 1; i < N; i++) {
        total = library.add(total, values[i]);
      }
      return total;
    },
    multiply: canMultiply
      ? () => {
          let last;
          for (let i = 0; i < N; i++) {
            last = library.multiply(values[i], FACTOR, SCALE, MODE);
          }
          return last;
        }
      : null,
    divide: canDivide
      ? () => {
          let last;
          for (let i = 0; i < N; i++) {
            last = library.divide(values[i], DIVISOR, SCALE, MODE);
          }
          return last;
        }
      : null,
    compare() {
      let ascending = 0;
      for (let i = 1; i < N; i++) {
        if (library.compare(values[i - 1], values[i]) < 0) {
          ascending++;
        }
      }
      return ascending;
    },
    toString() {
      let last;
      for (let i = 0; i < N; i++) {
        last = library.toString(values[i]);
      }
      return last;
    },
  };
}

/** "12.30" and "12.3" are the same value; libraries differ in trailing zeros. */
function withoutTrailingZeros(text: string): string {
  if (!text.includes('.')) {
    return text;
  }
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

/** Every library must compute the same sum, so no library is timed doing something else. */
function checkAddAgrees(libraries: FixedLibrary[]): void {
  let expected: string | undefined;
  for (const library of libraries) {
    const sum = library.add(library.parse(decimals[0]!), library.parse(decimals[1]!));
    const actual = withoutTrailingZeros(library.toString(sum));
    expected ??= actual;
    if (actual !== expected) {
      throw new Error(`${library.name} add sanity: ${actual} != ${expected}`);
    }
  }
}

checkAddAgrees(FIXED_LIBRARIES);

const librariesByName = new Map(FIXED_LIBRARIES.map((library) => [library.name, library]));

// add and compare work on N - 1 pairs
runBenchmark({
  libraries: [...librariesByName.keys()],
  operations: OPERATIONS,
  bodiesFor: (name) => operationBodies(librariesByName.get(name)!),
  innerCount: (operation) => (operation === 'add' || operation === 'compare' ? N - 1 : N),
  extraFields: { kind: 'fixed', factor: FACTOR, divisor: DIVISOR, scale: SCALE, mode: MODE },
});
