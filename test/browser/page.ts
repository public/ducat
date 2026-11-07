// Runs inside the browser page (bundled by esbuild; see browser.spec.ts). No test framework: each
// check passes or records a failure message, and the spec asserts the list is empty. Property
// checks use fast-check with the seed passed in from the runner, so a failure reproduces with
// DUCAT_SEED.
import DecimalJs from 'decimal.js';
import fc from 'fast-check';
import * as ducat from '../../src/fn.js';

export interface PageResult {
  readonly passed: number;
  readonly failures: string[];
  readonly userAgent: string;
  /** whether Intl formats a decimal string beyond 2^53 exactly (informational) */
  readonly intlFormatsStringsExactly: boolean;
}

const LOCALES = [
  'en-US',
  'en-GB',
  'de-DE',
  'de-CH',
  'fr-FR',
  'fr-CH',
  'es-ES',
  'it-IT',
  'nl-NL',
  'pl-PL',
  'sv-SE',
  'pt-BR',
  'en-IN',
  'ja-JP',
  'ar-EG',
  'hi-IN',
  'fa-IR',
  'th-TH',
];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'JPY', 'KWD', 'CHF', 'INR', 'BRL'];

const Decimal = DecimalJs.clone({ precision: 200, rounding: DecimalJs.ROUND_DOWN });

function serialize(value: unknown): string {
  return JSON.stringify(value, (_, inner) => (typeof inner === 'bigint' ? `${inner}n` : inner));
}

function assertEqual(actual: unknown, expected: unknown): void {
  if (serialize(actual) !== serialize(expected)) {
    throw new Error(`got ${serialize(actual)}, want ${serialize(expected)}`);
  }
}

/** Normalizes the narrow and ordinary no-break spaces engines use as group separators. */
function withPlainSpaces(text: string): string {
  return text.replace(/[  ]/g, ' ');
}

function euro(decimal: string): ducat.Money {
  return ducat.money(decimal, 'EUR');
}

export function run(seed: number, numRuns: number): PageResult {
  let passed = 0;
  const failures: string[] = [];

  function check(description: string, body: () => void): void {
    try {
      body();
      passed++;
    } catch (error) {
      failures.push(`${description}: ${(error as Error).message}`);
    }
  }

  function checkProperty(description: string, property: fc.IPropertyWithHooks<never>): void {
    check(description, () => fc.assert(property, { seed, numRuns }));
  }

  // core arithmetic and the bigint path, in this engine
  check('add', () => {
    assertEqual(ducat.toDecimal(ducat.add(euro('0.10'), euro('0.20'))), '0.30');
  });
  check('overflow to bigint', () => {
    const largest = ducat.fromMinor(Number.MAX_SAFE_INTEGER, 'EUR');
    const total = ducat.add(largest, ducat.fromMinor(1, 'EUR'));
    assertEqual(total.minor, 9007199254740992n);
  });
  check('BIGINT max', () => {
    assertEqual(euro('92233720368547758.07').toMinor(), 2n ** 63n - 1n);
  });
  check('allocate', () => {
    const parts = ducat.allocate(euro('100'), [1, 1, 1]).map(ducat.toDecimal);
    assertEqual(parts, ['33.34', '33.33', '33.33']);
  });
  check('float factor is read at its shortest decimal form', () => {
    assertEqual(ducat.toDecimal(ducat.multiply(euro('0.50'), 1.15, 'halfExpand')), '0.58');
  });

  const minorArb = fc.bigInt({ min: -(10n ** 24n), max: 10n ** 24n });
  const thousandthsArb = fc.integer({ min: -1_000_000, max: 1_000_000 });
  checkProperty(
    'multiply matches decimal.js (halfEven)',
    fc.property(minorArb, thousandthsArb, (minorUnits, thousandths) => {
      const factor = new Decimal(thousandths).div(1000).toFixed();
      const product = ducat.multiply(ducat.fromMinor(minorUnits, 'EUR'), factor, 'halfEven');

      const exact = new Decimal(minorUnits.toString()).mul(factor);
      const expected = exact.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toFixed(0);
      assertEqual(product.toMinor().toString(), expected);
    }) as never,
  );

  const weightsArb = fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 8 });
  checkProperty(
    'allocation sums to the whole',
    fc.property(fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }), weightsArb, (minorUnits, weights) => {
      fc.pre(weights.some((weight) => weight > 0));
      const parts = ducat.allocate(ducat.fromMinor(minorUnits, 'EUR'), weights);
      const total = parts.reduce((sum, part) => sum + part.toMinor(), 0n);
      assertEqual(total, minorUnits);
    }) as never,
  );

  // Intl, per engine: parse() reads back what format() wrote, in every locale. (Comparing format()
  // with Intl.NumberFormat would only restate how format() is implemented.)
  const currencyArb = fc.constantFrom(...CURRENCIES);
  const localeArb = fc.constantFrom(...LOCALES);
  const anyMinorArb = fc.oneof(
    fc.integer({ min: -1e13, max: 1e13 }),
    fc.bigInt({ min: -(10n ** 22n), max: 10n ** 22n }),
  );
  checkProperty(
    'parse(format(amount)) round-trips',
    fc.property(anyMinorArb, currencyArb, localeArb, (minorUnits, currency, locale) => {
      const amount = ducat.fromMinor(minorUnits, currency);
      const expected = ducat.toDecimal(amount);

      const standard = ducat.parse(ducat.format(amount, locale), currency, locale);
      assertEqual(ducat.toDecimal(standard), expected);

      const accountingText = ducat.format(amount, locale, { currencySign: 'accounting' });
      const accounting = ducat.parse(accountingText, currency, locale);
      assertEqual(ducat.toDecimal(accounting), expected);
    }) as never,
  );

  check('format de-DE', () => {
    assertEqual(withPlainSpaces(ducat.format(euro('1234.5'), 'de-DE')), '1.234,50 €');
  });
  check('parse de-DE', () => {
    assertEqual(ducat.parse('1.234,50 €', 'EUR', 'de-DE').minor, 123450);
  });
  check('parse accounting', () => {
    assertEqual(ducat.parse('($5.00)', 'USD', 'en-US').minor, -500);
  });

  const beyondDoubles = ducat.format(ducat.money('123456789012345678.91', 'USD'), 'en-US');
  return {
    passed,
    failures,
    userAgent: navigator.userAgent,
    intlFormatsStringsExactly: beyondDoubles === '$123,456,789,012,345,678.91',
  };
}
