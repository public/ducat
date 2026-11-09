/**
 * `@ducatjs/money/convert`: currency conversion at exact rates. Importing this module adds
 * `Money#convert`.
 */
// every ISO 4217 code, as for every entry except /fn
import './iso.js';
import { convert } from '../convert.js';
import type { Factor } from '../decimal.js';
import type { Money } from '../index.js';
import { extendMoney, type CurrencyInput, type RoundingInput } from '../money.js';
import type { ProviderConvertOptions } from '../convert.js';
import type { RateProvider } from '../provider.js';
import type { ConvertOptions, Rate } from '../rate.js';

export * from '../convert.js';

declare module '../index.js' {
  interface Money<C extends string> {
    /** Converts at a Rate, rounding once: `eur.convert(eurUsd, 'halfEven')`. */
    convert<To extends string>(
      rate: Rate<NoInfer<C>, To>,
      rounding?: RoundingInput,
      options?: ConvertOptions,
    ): Money<To>;
    /** Converts at an exact decimal-string rate: `eur.convert('USD', '1.0832', 'halfEven')`. */
    convert<To extends CurrencyInput>(
      to: To,
      rate: Factor,
      rounding?: RoundingInput,
      options?: ConvertOptions,
    ): Money<To>;
    /**
     * Converts through a provider, rounding once: `usd.convert('JPY', via('EUR', ecb),
     * 'halfEven')`.
     */
    convert<To extends CurrencyInput>(
      to: To,
      provider: RateProvider,
      rounding?: RoundingInput,
      options?: ProviderConvertOptions,
    ): Money<To>;
  }
}

extendMoney(
  {
    convert(this: Money, ...args: [never, never?, never?, never?]) {
      return (convert as (money: Money, ...rest: unknown[]) => Money)(this, ...args);
    },
  },
  { owner: '@ducatjs/money/convert' },
);
