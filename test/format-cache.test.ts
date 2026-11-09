import { describe, expect, it } from 'vitest';
import { money } from '../src/index.js';
import { format, formatToParts } from '../src/format.js';

// Counts the NumberFormat constructions format() makes, without changing what they do.
function countConstructions(run: () => void): number {
  const original = Intl.NumberFormat;
  let count = 0;
  class CountingNumberFormat extends original {
    constructor(...args: ConstructorParameters<typeof Intl.NumberFormat>) {
      super(...args);
      count++;
    }
  }
  Intl.NumberFormat = CountingNumberFormat as typeof Intl.NumberFormat;
  try {
    run();
  } finally {
    Intl.NumberFormat = original;
  }
  return count;
}

describe('the formatter cache with options', () => {
  const amounts = ['1.00', '1234.50', '-0.05'].map((amount) => money(amount, 'EUR'));

  it('builds a formatter once for repeated options, even as new objects', () => {
    // a locale no other test uses, so the cache starts cold for it
    const constructions = countConstructions(() => {
      for (let i = 0; i < 100; i++) {
        format(amounts[i % 3]!, 'en-IE', { style: 'decimal' });
      }
    });
    expect(constructions).toBe(1);
  });

  it('keeps separate entries for different options, locales, currencies and scales', () => {
    const constructions = countConstructions(() => {
      for (let i = 0; i < 10; i++) {
        format(amounts[0]!, 'en-AU', { style: 'decimal' });
        format(amounts[0]!, 'en-AU', { currencyDisplay: 'code' });
        format(amounts[0]!, 'en-NZ', { style: 'decimal' });
        format(money('1', 'USD'), 'en-AU', { style: 'decimal' });
        format(money('1', 'EUR', { scale: 4 }), 'en-AU', { style: 'decimal' });
      }
    });
    expect(constructions).toBe(5);
  });

  it('gives the same output as an uncached formatter', () => {
    const cases: [string, Intl.NumberFormatOptions][] = [
      ['de-DE', { style: 'decimal' }],
      ['en-US', { currencyDisplay: 'code' }],
      ['en-US', { currencyDisplay: 'name', useGrouping: false }],
      ['fr-FR', { signDisplay: 'always' }],
    ];
    for (const [locale, options] of cases) {
      for (const amount of amounts) {
        const expected = new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: 'EUR',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          ...options,
        }).format(Number(amount.toDecimal()));
        // twice, so the second call is served from the cache
        expect(format(amount, locale, options)).toBe(expected);
        expect(format(amount, locale, { ...options })).toBe(expected);
      }
    }
    expect(
      formatToParts(amounts[1]!, 'de-DE', { style: 'decimal' })
        .map((part) => part.value)
        .join(''),
    ).toBe('1.234,50');
  });

  it('does not reuse a formatter for an options object mutated between calls', () => {
    const options: Intl.NumberFormatOptions = { style: 'decimal' };
    expect(format(amounts[0]!, 'en-US', options)).toBe('1.00');
    options.style = 'currency';
    options.currencyDisplay = 'code';
    expect(format(amounts[0]!, 'en-US', options)).toMatch(/^EUR\s1\.00$/);
  });

  it('stays bounded', () => {
    const constructions = countConstructions(() => {
      for (let digits = 0; digits < 300; digits++) {
        format(amounts[0]!, 'en-GB', {
          minimumIntegerDigits: (digits % 21) + 1,
          useGrouping: digits < 150,
        });
      }
    });
    // 42 distinct option sets, each built once, well under the bound
    expect(constructions).toBe(42);
  });
});
