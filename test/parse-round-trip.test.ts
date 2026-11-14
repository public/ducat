// What format writes, parse reads back: every locale Node's Intl ships (CLDR's available
// locales, as Intl supports them), a deterministic sample of currencies in each, every display,
// both signs, and positive, negative and zero amounts. The sign is asserted on its own, beside the
// exact value: a parse that turns a positive amount negative is the worst of these failures.
import '../src/plugins/core.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ISO_EXPONENTS, ISO_NON_MONETARY } from '../src/currency.js';
import { isNegative, isZero, money, toDecimal, type Money } from '../src/fn.js';
import { format } from '../src/format.js';
import { parse } from '../src/parse.js';

const available = JSON.parse(
  readFileSync(new URL('../data/cldr/availableLocales.json', import.meta.url), 'utf8'),
) as { availableLocales: { full: string[] } };
const LOCALES = Intl.NumberFormat.supportedLocalesOf(available.availableLocales.full);
const CODES = Object.keys(ISO_EXPONENTS).filter(
  (code) => !(ISO_NON_MONETARY as readonly string[]).includes(code),
);
/** The numbering systems whose digits parse reads (docs/reference/parse.md). */
const READ = new Set([
  'latn',
  'arab',
  'arabext',
  'nkoo',
  'deva',
  'beng',
  'guru',
  'gujr',
  'orya',
  'tamldec',
  'telu',
  'knda',
  'mlym',
  'thai',
  'laoo',
  'tibt',
  'mymr',
  'khmr',
  'mong',
  'fullwide',
]);
const DISPLAYS = ['symbol', 'narrowSymbol', 'code', 'name'] as const;
const SIGNS = ['standard', 'accounting'] as const;

/** Four currencies in every locale, and five more that rotate with the locale's position. */
function currenciesFor(index: number): string[] {
  const rotated = [0, 1, 2, 3, 4].map((k) => CODES[(index * 7 + k * 31) % CODES.length]!);
  return [...new Set(['USD', 'EUR', 'JPY', 'KWD', ...rotated])];
}

function amounts(currency: string): string[] {
  const exponent = ISO_EXPONENTS[currency as keyof typeof ISO_EXPONENTS];
  const fraction = exponent === 0 ? '' : `.${'8'.repeat(exponent)}`;
  const zero = exponent === 0 ? '0' : `0.${'0'.repeat(exponent)}`;
  return [`1234567${fraction}`, `-1234567${fraction}`, zero];
}

const signOf = (amount: Money<string>) => (isZero(amount) ? 0 : isNegative(amount) ? -1 : 1);

describe('parse reads back what format writes', () => {
  it(`covers ${LOCALES.length} locales`, () => {
    expect(LOCALES.length).toBeGreaterThan(600);
  });

  it.each(LOCALES.map((locale, index) => [locale, index] as const))('%s', (locale, index) => {
    if (!READ.has(new Intl.NumberFormat(locale).resolvedOptions().numberingSystem)) {
      return;
    }
    const failures: string[] = [];
    for (const currency of currenciesFor(index)) {
      for (const amount of amounts(currency)) {
        const written = money(amount, currency);
        for (const currencyDisplay of DISPLAYS) {
          for (const currencySign of SIGNS) {
            const text = format(written, locale, { currencyDisplay, currencySign });
            let read;
            try {
              read = parse(text, currency, locale);
            } catch (error) {
              if (/no Intl data/.test((error as Error).message)) {
                return;
              }
              failures.push(
                `${currency} ${currencyDisplay} ${currencySign} ${JSON.stringify(text)}: ${(error as Error).message}`,
              );
              continue;
            }
            if (signOf(read) !== signOf(written)) {
              failures.push(
                `${currency} ${currencyDisplay} ${currencySign} ${JSON.stringify(text)}: sign ${signOf(read)}`,
              );
            }
            if (toDecimal(read) !== toDecimal(written)) {
              failures.push(
                `${currency} ${currencyDisplay} ${currencySign} ${JSON.stringify(text)}: ${toDecimal(read)}`,
              );
            }
          }
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });
});
