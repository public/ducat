// The fixed-point battery: the money battery's vectors that do not depend on currencies (ties in
// both modes and both signs, float traps, amounts beyond 2^53, exact division, scale changes),
// stated for plain decimals. Every vector uses only parse, add, multiply, divide, round, compare
// and toString, with an explicit rounding mode. The vectors are data, from @ducatjs/money-spec.
import fixedFile from '@ducatjs/money-spec/vectors/fixed/battery.json' with { type: 'json' };
import type { Expectation, SpecCase, SpecFile } from '../../test/spec/format.ts';
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

type Compute = (library: FixedLibrary, args: SpecCase['args']) => string;

const text = (args: SpecCase['args'], key: string) => args[key] as string;
const scaleAndMode = (args: SpecCase['args']) =>
  [args['scale'] as number, args['mode'] as FixedRounding] as const;

/** Each neutral operation, driven through the library's adapter. */
const OPERATIONS: Record<string, Compute> = {
  'fixed.multiply': (library, args) =>
    library.toString(
      library.multiply(
        library.parse(text(args, 'value')),
        text(args, 'factor'),
        ...scaleAndMode(args),
      ),
    ),
  'fixed.divide': (library, args) =>
    library.toString(
      library.divide(
        library.parse(text(args, 'value')),
        text(args, 'divisor'),
        ...scaleAndMode(args),
      ),
    ),
  'fixed.round': (library, args) =>
    library.toString(library.round(library.parse(text(args, 'value')), ...scaleAndMode(args))),
  'fixed.add': (library, args) =>
    library.toString(
      library.add(library.parse(text(args, 'first')), library.parse(text(args, 'second'))),
    ),
  'fixed.roundTrip': (library, args) => library.toString(library.parse(text(args, 'value'))),
  'fixed.compare': (library, args) =>
    String(
      library.compare(library.parse(text(args, 'first')), library.parse(text(args, 'second'))),
    ),
};

function expectedText(expect: Expectation): string {
  if (expect.decimal !== undefined) {
    return expect.decimal;
  }
  if (expect.integer !== undefined) {
    return String(expect.integer);
  }
  throw new Error(`the fixed-point battery can't judge against ${JSON.stringify(expect)}`);
}

function vectorOf(specCase: SpecCase): FixedVector {
  const compute = OPERATIONS[specCase.op];
  if (!compute) {
    throw new Error(
      `the fixed-point battery has no operation ${specCase.op} (vector ${specCase.id})`,
    );
  }
  return {
    id: specCase.id,
    group: specCase.group ?? '',
    description: specCase.description,
    compute: (library) => compute(library, specCase.args),
    expected: expectedText(specCase.expect),
  };
}

/** The fixed-point battery: @ducatjs/money-spec's vectors/fixed/battery.json, in its order. */
export const FIXED_VECTORS: FixedVector[] = (fixedFile as unknown as SpecFile).cases!.map(vectorOf);

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
