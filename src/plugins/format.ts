/** `@ducatjs/money/format`: locale formatting through Intl. Importing this module adds the methods below. */
import { format, formatToParts } from '../format.js';
import { extendMoney, type Money } from '../money.js';

export * from '../format.js';

declare module '../money.js' {
  interface Money<C extends string> {
    /** Locale formatting via Intl: `price.format('de-DE')` gives "19,99 €" */
    format(locale?: string, options?: Intl.NumberFormatOptions): string;
    formatToParts(locale?: string, options?: Intl.NumberFormatOptions): Intl.NumberFormatPart[];
  }
}

extendMoney({
  format(this: Money, locale?: string, options?: Intl.NumberFormatOptions) {
    return format(this, locale, options);
  },
  formatToParts(this: Money, locale?: string, options?: Intl.NumberFormatOptions) {
    return formatToParts(this, locale, options);
  },
});
