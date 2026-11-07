/** `@ducatjs/money/convert`: currency conversion at exact rates. Importing this module adds `Money#convert`. */
import { convert, type ConvertOptions } from '../convert.js';
import type { Factor } from '../decimal.js';
import { extendMoney, type CurrencyInput, type Money } from '../money.js';
import type { RoundingMode } from '../rounding.js';

export * from '../convert.js';

declare module '../money.js' {
  interface Money<C extends string> {
    /** Converts at an exact decimal-string rate: `eur.convert('USD', '1.0832', 'halfEven')`. */
    convert<To extends CurrencyInput>(
      to: To,
      rate: Factor,
      rounding?: RoundingMode,
      options?: ConvertOptions,
    ): Money<To>;
  }
}

extendMoney(
  {
    convert(this: Money, to: string, rate: Factor, rounding?: RoundingMode, options?: ConvertOptions) {
      return convert(this, to, rate, rounding, options);
    },
  },
  { owner: '@ducatjs/money/convert' },
);
