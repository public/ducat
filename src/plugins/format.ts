/**
 * `@ducatjs/money/format`: locale formatting through Intl. Importing this module adds the methods
 * below.
 */
// every ISO 4217 code, as for every entry except /fn
import './iso.js';
import { format, formatToParts, type FormatOptions } from '../format.js';
import type { Money } from '../index.js';
import { extendMoney } from '../money.js';

export * from '../format.js';

declare module '../index.js' {
  interface Money<C extends string> {
    /**
     * Locale formatting via Intl: `price.format('de-DE')` gives "19,99 €". `{ digits, rounding }`
     * rounds once, exactly, to that many decimals first.
     */
    format(locale?: string, options?: FormatOptions): string;
    formatToParts(locale?: string, options?: FormatOptions): Intl.NumberFormatPart[];
  }
}

extendMoney(
  {
    format(this: Money, locale?: string, options?: FormatOptions) {
      return format(this, locale, options);
    },
    formatToParts(this: Money, locale?: string, options?: FormatOptions) {
      return formatToParts(this, locale, options);
    },
  },
  { owner: '@ducatjs/money/format' },
);
