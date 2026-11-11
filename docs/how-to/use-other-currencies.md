# How to use custom, historic and crypto currencies

This guide shows you how to work with codes beyond the current ISO 4217 table: your own codes, currencies ISO has withdrawn (HRK, ITL, BGN…), crypto currencies and tokens. It also shows how to look up currency metadata: numeric codes, names, symbols and the currencies a territory uses.

## Define your own code

Call `defineCurrency('BTC', 8)` with the code and its exponent. To also get it in the `CurrencyCode` type, augment `interface CustomCurrencies`.

## Load withdrawn ISO codes

Import `@ducatjs/money/historic` and register the codes you need with `defineHistoricCurrencies` (a list of codes, or none for all of them). Nothing is registered until you call it. Each takes the exponent ISO gave it while it was current:

```ts
import { money } from '@ducatjs/money';
import { defineHistoricCurrencies, historicCurrency } from '@ducatjs/money/historic';

defineHistoricCurrencies(['HRK', 'ITL']);
money('7.53', 'HRK'); // → 7.53 HRK
money('1936.27', 'ITL', { rounding: 'halfExpand' }); // → 1936 ITL (the lira had no minor unit)
historicCurrency('HRK')?.withdrawn; // → '2023-01'
historicCurrency('CNH')?.withdrawn; // → undefined (not an ISO code)
```

To have the codes in the `CurrencyCode` type as well:

```ts
import type { HistoricCurrencies } from '@ducatjs/money/historic';

declare module '@ducatjs/money' {
  interface CustomCurrencies extends HistoricCurrencies {}
}
```

If an older code isn't in the table (its minor units aren't sourced), register it with `defineCurrency`.

## Use crypto currencies and tokens

Import `@ducatjs/money/crypto` and register the units with `defineCryptoCurrencies`. Convert to and from base units (satoshi, wei) with `toBaseUnits` and `fromBaseUnits`, which accepts digits and an optional minus sign only:

```ts
import { money } from '@ducatjs/money';
import { defineCryptoCurrencies, fromBaseUnits, toBaseUnits } from '@ducatjs/money/crypto';

defineCryptoCurrencies(['BTC', 'ETH']);
toBaseUnits(money('0.00000001', 'BTC')); // → 1n
fromBaseUnits('1500000000000000000', 'ETH'); // → 1.500000000000000000 ETH
money('0.1', 'ETH').add(money('0.2', 'ETH')).toDecimal(); // → '0.300000000000000000'
fromBaseUnits('1e18', 'ETH'); // throws SyntaxError
```

The token decimals are Ethereum mainnet's (USDT has 18 on BNB Chain, 6 here); `cryptoUnit(code)` names the network and the contract. If you hold another network's tokens, define them with `defineCurrency`, under codes of your own.

## Look up numeric codes, names, symbols and territories

```ts
import { cashUnit } from '@ducatjs/money/cash';
import {
  currencyFromNumeric,
  currencySymbol,
  minorUnit,
  numericCode,
} from '@ducatjs/money/currencies';
import { territoryCurrencies } from '@ducatjs/money/territories';

numericCode('EUR'); // → '978'
currencyFromNumeric(8); // → 'ALL'
minorUnit('KWD'); // → '0.001'
currencySymbol('USD', 'en-CA'); // → 'US$'
cashUnit('CHF'); // → '0.05'
territoryCurrencies('DE', { on: '2001-06-01' }).map((use) => use.currency); // → ['EUR', 'DEM']
```

Names and symbols come from the runtime's `Intl`, so they follow its CLDR version. `@ducatjs/money/territories` is a separate entry because its table is most of its 4.5 KiB gzipped; import it only if you need it.

## Related

- Reference: [currency entries](../reference/currencies.md), [`defineCurrency` and `CustomCurrencies`](../reference/money.md), [currency data](../reference/currency-data.md), [known limitations](../reference/limitations.md)
- Explanation: [Decisions](../explanation/decisions.md) (withdrawn codes, minor units as powers of ten)
