// The shape of a vector file in @ducatjs/money-spec (spec/schema/vectors.schema.json) as TypeScript
// types, with the helpers every reader needs. compare/ and test/spec.test.ts both read the vectors
// through these types; nothing here touches the file system, so compare/'s bundle stays portable.

export type ErrorKind = 'rounding' | 'currency-mismatch' | 'range' | 'syntax' | 'type';

export type SpecRoundingMode =
  | 'halfEven'
  | 'halfExpand'
  | 'halfTrunc'
  | 'halfCeil'
  | 'halfFloor'
  | 'expand'
  | 'trunc'
  | 'ceil'
  | 'floor'
  | 'unnecessary';

/** An amount of money: an exact decimal string with `scale` fraction digits, and its currency. */
export interface SpecMoney {
  readonly amount: string;
  readonly currency: string;
  readonly scale: number;
}

/** Exactly one key is present (the schema enforces it). */
export interface Expectation {
  readonly money?: SpecMoney;
  readonly moneyList?: readonly SpecMoney[];
  readonly moneyMultiset?: readonly SpecMoney[];
  readonly sumOfParts?: SpecMoney;
  readonly decimal?: string;
  readonly integer?: number;
  readonly boolean?: boolean;
  readonly error?: ErrorKind;
  readonly property?: 'allocation-within-one-unit';
  readonly anyOf?: readonly Expectation[];
}

export interface SpecCase {
  readonly id: string;
  readonly group?: string;
  readonly description: string;
  readonly op: string;
  /** the operation's arguments; their shape per operation is in the schema */
  readonly args: Readonly<Record<string, unknown>>;
  readonly expect: Expectation;
}

export interface Provenance {
  readonly source: string;
  readonly generator: { readonly name: string; readonly version: string } | null;
  readonly method: string;
  readonly data?: Readonly<Record<string, string>>;
}

export interface SpecFile {
  readonly format: 1;
  readonly area: string;
  readonly name: string;
  readonly description: string;
  readonly provenance: Provenance;
  readonly checkedAgainst: string;
  readonly contentSha256?: string;
  /** a file has cases or tables, never both */
  readonly cases?: readonly SpecCase[];
  readonly tables?: readonly SpecTable[];
}

/** Rows of one table operation: each row holds its inputs and expected results by field name. */
export interface SpecTable {
  readonly op: string;
  readonly description?: string;
  readonly source?: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

/** The draws of a money.allocate.generated case, from its seeded generator. */
export interface AllocationDraws {
  readonly minor: bigint;
  readonly weights: number[];
}

interface Generator {
  readonly seed: number;
  readonly multiplier: number;
  readonly increment: number;
  readonly modulus: number;
}

interface Draw {
  readonly name: string;
  readonly limit: number;
  readonly offset: number;
  readonly repeat?: string;
}

/**
 * The cases of a money.allocate.generated vector, drawn from its linear congruential generator in
 * exact integer arithmetic (the product overflows 2^53, so not in doubles).
 */
export function generatedAllocations(args: SpecCase['args']): AllocationDraws[] {
  const generator = args['generator'] as Generator;
  const [minorDraw, countDraw, weightDraw] = args['draws'] as [Draw, Draw, Draw];
  let state = BigInt(generator.seed);

  const draw = ({ limit, offset }: Draw): bigint => {
    state =
      (state * BigInt(generator.multiplier) + BigInt(generator.increment)) %
      BigInt(generator.modulus);
    return (state % BigInt(limit)) + BigInt(offset);
  };

  return Array.from({ length: args['count'] as number }, () => {
    const minor = draw(minorDraw);
    const weightCount = Number(draw(countDraw));
    const weights = Array.from({ length: weightCount }, () => Number(draw(weightDraw)));
    return { minor, weights };
  });
}

/** The amount in minor units: the decimal's digits at its scale. */
export function minorUnitsOf(money: SpecMoney): bigint {
  const [integerPart, fractionPart = ''] = money.amount.replace('-', '').split('.');
  const units = BigInt(integerPart! + fractionPart.padEnd(money.scale, '0'));
  return money.amount.startsWith('-') ? -units : units;
}
