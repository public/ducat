// The fixed-point battery: the money battery's vectors that do not depend on currencies (ties in
// both modes and both signs, float traps, amounts beyond 2^53, exact division, scale changes),
// stated for plain decimals. Every vector uses only parse, add, multiply, divide, round, compare
// and toString, with an explicit rounding mode.
import { normalizeDecimal, type Outcome, type VectorResult } from '../battery/vectors.ts';
import { FixedNotSupported, type FixedLibrary, type FixedRounding } from './library.ts';

export interface FixedVector {
  readonly id: string;
  readonly group: string;
  readonly description: string;
  /** the value the library returns, as a string (compared after normalising trailing zeros) */
  compute(library: FixedLibrary): string;
  readonly expected: string;
}

function multiplied(factor: string, scale: number, mode: FixedRounding, value: string) {
  return (library: FixedLibrary) => library.toString(library.multiply(library.parse(value), factor, scale, mode));
}

function divided(divisor: string, scale: number, mode: FixedRounding, value: string) {
  return (library: FixedLibrary) => library.toString(library.divide(library.parse(value), divisor, scale, mode));
}

function rounded(scale: number, mode: FixedRounding, value: string) {
  return (library: FixedLibrary) => library.toString(library.round(library.parse(value), scale, mode));
}

function added(first: string, second: string) {
  return (library: FixedLibrary) => library.toString(library.add(library.parse(first), library.parse(second)));
}

function roundTrip(value: string) {
  return (library: FixedLibrary) => library.toString(library.parse(value));
}

function compared(first: string, second: string) {
  return (library: FixedLibrary) => String(library.compare(library.parse(first), library.parse(second)));
}

export const FIXED_VECTORS: FixedVector[] = [
  // --- ties, both modes and both signs
  {
    id: 'tie-even',
    group: 'rounding',
    description: '0.25 × 0.5 = 0.125 → half-even 0.12',
    compute: multiplied('0.5', 2, 'halfEven', '0.25'),
    expected: '0.12',
  },
  {
    id: 'tie-even-neg',
    group: 'rounding',
    description: '-0.25 × 0.5 = -0.125 → half-even -0.12',
    compute: multiplied('0.5', 2, 'halfEven', '-0.25'),
    expected: '-0.12',
  },
  {
    id: 'tie-up',
    group: 'rounding',
    description: '0.25 × 0.5 = 0.125 → half-up 0.13',
    compute: multiplied('0.5', 2, 'halfExpand', '0.25'),
    expected: '0.13',
  },
  {
    id: 'tie-up-neg',
    group: 'rounding',
    description: '-0.25 × 0.5 = -0.125 → half-up (away from 0) -0.13',
    compute: multiplied('0.5', 2, 'halfExpand', '-0.25'),
    expected: '-0.13',
  },
  {
    id: 'tie-even-odd',
    group: 'rounding',
    description: '0.35 × 0.5 = 0.175 → half-even 0.18',
    compute: multiplied('0.5', 2, 'halfEven', '0.35'),
    expected: '0.18',
  },

  // --- float traps: products that are just below or above a tie in binary floating point
  {
    id: 'float-mul-1.15',
    group: 'float',
    description: '0.50 × 1.15 = 0.575 → half-up 0.58 (float gives 0.57499…)',
    compute: multiplied('1.15', 2, 'halfExpand', '0.50'),
    expected: '0.58',
  },
  {
    id: 'float-mul-0.7',
    group: 'float',
    description: '0.45 × 0.7 = 0.315 → half-up 0.32 (float gives 0.31499…)',
    compute: multiplied('0.7', 2, 'halfExpand', '0.45'),
    expected: '0.32',
  },
  {
    id: 'float-mul-1.1',
    group: 'float',
    description: '1.15 × 1.1 = 1.265 → half-even 1.26 (float gives 1.26500…01)',
    compute: multiplied('1.1', 2, 'halfEven', '1.15'),
    expected: '1.26',
  },
  {
    id: 'dec-add',
    group: 'float',
    description: '0.10 + 0.20 = 0.30 exactly',
    compute: added('0.10', '0.20'),
    expected: '0.30',
  },

  // --- beyond 2^53
  {
    id: 'big-2^53+1',
    group: 'large',
    description: '90071992547409.93 (2^53+1 hundredths) round-trips',
    compute: roundTrip('90071992547409.93'),
    expected: '90071992547409.93',
  },
  {
    id: 'big-add',
    group: 'large',
    description: '90071992547409.92 + 0.01 = 90071992547409.93',
    compute: added('90071992547409.92', '0.01'),
    expected: '90071992547409.93',
  },
  {
    id: 'bigint-max',
    group: 'large',
    description: '92233720368547758.07 (BIGINT max hundredths) round-trips',
    compute: roundTrip('92233720368547758.07'),
    expected: '92233720368547758.07',
  },
  {
    id: 'big-mul',
    group: 'large',
    description: '123456789012345678.90 × 1.1 = 135802467913580246.79 (half-up)',
    compute: multiplied('1.1', 2, 'halfExpand', '123456789012345678.90'),
    expected: '135802467913580246.79',
  },

  // --- division
  {
    id: 'div-exact',
    group: 'division',
    description: '12.00 ÷ 1.2 = 10.00',
    compute: divided('1.2', 2, 'halfEven', '12.00'),
    expected: '10.00',
  },
  {
    id: 'div-119',
    group: 'division',
    description: '119.00 ÷ 1.19 = 100.00',
    compute: divided('1.19', 2, 'halfEven', '119.00'),
    expected: '100.00',
  },
  {
    id: 'div-tie-even',
    group: 'division',
    description: '9.99 ÷ 1.2 = 8.325 → half-even 8.32',
    compute: divided('1.2', 2, 'halfEven', '9.99'),
    expected: '8.32',
  },
  {
    id: 'div-tie-up',
    group: 'division',
    description: '9.99 ÷ 1.2 = 8.325 → half-up 8.33',
    compute: divided('1.2', 2, 'halfExpand', '9.99'),
    expected: '8.33',
  },
  {
    id: 'div-third',
    group: 'division',
    description: '1 ÷ 3 → 0.33 (half-up)',
    compute: divided('3', 2, 'halfExpand', '1'),
    expected: '0.33',
  },
  {
    id: 'div-neg-third',
    group: 'division',
    description: '-2 ÷ 3 → -0.67 (half-up)',
    compute: divided('3', 2, 'halfExpand', '-2'),
    expected: '-0.67',
  },
  {
    id: 'div-eighth',
    group: 'division',
    description: '1 ÷ 8 = 0.125 at 3 decimals, exactly',
    compute: divided('8', 3, 'halfEven', '1'),
    expected: '0.125',
  },

  // --- scale changes
  {
    id: 'round-even',
    group: 'scale',
    description: '1.005 to 2 decimals, half-even → 1.00',
    compute: rounded(2, 'halfEven', '1.005'),
    expected: '1.00',
  },
  {
    id: 'round-up',
    group: 'scale',
    description: '1.005 to 2 decimals, half-up → 1.01',
    compute: rounded(2, 'halfExpand', '1.005'),
    expected: '1.01',
  },
  {
    id: 'round-up-neg',
    group: 'scale',
    description: '-1.005 to 2 decimals, half-up → -1.01',
    compute: rounded(2, 'halfExpand', '-1.005'),
    expected: '-1.01',
  },
  {
    id: 'round-integer-even',
    group: 'scale',
    description: '2.5 to 0 decimals, half-even → 2',
    compute: rounded(0, 'halfEven', '2.5'),
    expected: '2',
  },

  // --- comparison and negatives
  {
    id: 'cmp-trailing-zero',
    group: 'compare',
    description: 'compare(1.10, 1.1) = 0',
    compute: compared('1.10', '1.1'),
    expected: '0',
  },
  {
    id: 'cmp-neg',
    group: 'compare',
    description: 'compare(-0.01, 0) = -1',
    compute: compared('-0.01', '0'),
    expected: '-1',
  },
  {
    id: 'neg-small',
    group: 'compare',
    description: '-0.05 round-trips as "-0.05"',
    compute: roundTrip('-0.05'),
    expected: '-0.05',
  },
];

function describeError(error: unknown): string {
  const name = (error as Error)?.constructor?.name ?? 'Error';
  return `${name}: ${String((error as Error)?.message).slice(0, 100)}`;
}

/** Runs one fixed-point vector against one library and classifies the outcome. */
export function runFixedVector(vector: FixedVector, library: FixedLibrary): VectorResult {
  try {
    const got = normalizeDecimal(vector.compute(library));
    const outcome: Outcome = got === normalizeDecimal(vector.expected) ? 'pass' : 'fail';
    return { outcome, got };
  } catch (error) {
    if (error instanceof FixedNotSupported) {
      return { outcome: 'unsupported', got: error.message };
    }
    return { outcome: 'error', got: describeError(error) };
  }
}
