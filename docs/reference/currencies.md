# Currency metadata, territories, historic and crypto codes

Four opt-in entries about currencies themselves: `@ducatjs/money/currencies`, `/territories`, `/historic` and `/crypto`. Each **installs nothing**. The registry functions every entry has (`currencyExponent`, `isCurrency`, `defineCurrency`, `ISO_EXPONENTS`) are in [`@ducatjs/money`](money.md).

Related: [How to use other currencies](../how-to/use-other-currencies.md) · [Currency data](currency-data.md) · [Decisions](../explanation/decisions.md) (withdrawn codes stay out of the core registry)

## `@ducatjs/money/currencies`

ISO 4217 numeric codes both ways, the size of a minor unit, and names and symbols per locale. Numeric codes come from the ISO 4217 List One snapshot. Names and symbols come from the runtime's `Intl`, not a bundled table, so they follow its CLDR version and can differ between runtimes and versions. The smallest coin is `cashUnit(code, { country? })` in [`@ducatjs/money/cash`](cash.md).

### numericCode

`numericCode(currency: string): string | undefined`

The ISO 4217 numeric code of an active currency, three digits as published: `'978'` for EUR, `'008'` for ALL, for card networks, ISO 8583 and ISO 20022 messages. `undefined` for a code ISO doesn't list (a custom or withdrawn currency).

### currencyFromNumeric

`currencyFromNumeric(numeric: string | number): string | undefined`

The active currency with a numeric code: `'978'` and `978` are `'EUR'`; `'008'`, `'8'` and `8` are `'ALL'`. `undefined` for a number ISO doesn't assign.

- **Throws:** `RangeError` for a value that isn't a whole number from 0 to 999.

### minorUnit

`minorUnit(currency: string): string`

The size of the minor unit in major units, as an exact decimal string: `'0.01'` for EUR, `'1'` for JPY, `'0.001'` for KWD. It follows the exponent, so a code registered with `defineCurrency` works too.

- **Throws:** `RangeError` for an unknown code, as `currencyExponent` does.

### currencyName

`currencyName(currency: string, locale: string): string | undefined`

The currency's name in a locale, from `Intl.DisplayNames`: `currencyName('CHF', 'fr')` is `'franc suisse'`. `undefined` when the runtime has no name for the code.

### currencySymbol

`currencySymbol(currency: string, locale: string, options?: CurrencySymbolOptions): string`

The currency's symbol in a locale, from `Intl.NumberFormat`: `'€'` for EUR in en-US, `'US$'` for USD in en-CA, and `'$'` with `{ display: 'narrow' }`. A currency without a symbol in that locale gives its code.

- `CurrencySymbolOptions`: `{ display?: 'symbol' | 'narrow' }`. `'symbol'` (default) is the symbol the locale uses where it must not be ambiguous; `'narrow'` the shortest form, as `Intl.NumberFormat`'s `narrowSymbol`.

## `@ducatjs/money/territories`

Which currencies a territory uses, and since when, from CLDR release 49 (`data/cldr-territories.json`). It is a separate entry because the table is most of its 4.5 KiB gzipped.

### territoryCurrencies

`territoryCurrencies(territory: string, options?: TerritoryOptions): TerritoryCurrency[]`

The currencies a territory (an ISO 3166 alpha-2 code) uses or has used, newest first, with the days CLDR gives. Fund and accounting codes (CHE, USN) are left out unless `includeNonTender` is set. A territory CLDR doesn't know gives `[]`.

- **Throws:** `RangeError` for an `on` that isn't `'YYYY-MM-DD'`.

### currencyTerritories

`currencyTerritories(currency: string, options?: TerritoryOptions): string[]`

The territories that use or used a currency, in code order: `['CH', 'LI']` for CHF. With `{ on }`, only those using it on that day.

- `TerritoryCurrency`: `{ currency: string; from?: string; to?: string; tender: boolean }`: the code, the first and last day of use (`'YYYY-MM-DD'`, where CLDR gives them), and `false` for a code that isn't legal tender there (CHE, USN, CLF).
- `TerritoryOptions`: `{ on?: string; includeNonTender?: boolean }`. `{ on: '2001-06-01' }` gives both EUR and DEM for Germany; without it, every currency CLDR lists, current and past.

## `@ducatjs/money/historic`

54 codes ISO 4217 has withdrawn (HRK, BGN, ANG, STD, SLL, ZWL, CUC, VEF, the euro's predecessors…) and the offshore yuan CNH, each with the exponent ISO gave it while it was current, so old records and processor listings load. Nothing is registered until you call `defineHistoricCurrencies`. Names, numeric codes and withdrawal months come from ISO 4217 List Three; the exponents come from OpenJDK's ISO-derived currency data, because List Three doesn't carry minor units. Older codes whose minor units aren't sourced are left out; register those with `defineCurrency`.

### defineHistoricCurrencies

`defineHistoricCurrencies(codes?: readonly HistoricCurrencyCode[]): void`

Registers historic codes with `defineCurrency`: all of them, or only `codes`. Registering one again is harmless.

- **Throws:** `RangeError` for a code not in the table; `TypeError`, as `defineCurrency` does, for a code already defined with another exponent.

### historicCurrency

`historicCurrency(code: string): HistoricCurrency | undefined`

The table entry for a code, or `undefined`. `historicCurrency('HRK')?.withdrawn` is `'2023-01'`; CNH, never an ISO code, has no `withdrawn`.

### historicCurrencies

`historicCurrencies(): HistoricCurrency[]`

Every entry of the table, by code.

- `ISO_4217_LIST_THREE_PUBLISHED`: `'2026-01-01'`, the publication date of the List Three snapshot.
- `HistoricCurrency`: `{ code: HistoricCurrencyCode; name: string; exponent: number; numeric?: string; withdrawn?: string }`. `exponent` is its minor-unit exponent while it was current: what stored minor units of it mean. `withdrawn` is the year and month (`'2023-01'`); a code withdrawn country by country has the last date.
- `HistoricCurrencyCode`: a code in the table.
- `HistoricCurrencies`: every historic code, for the `CurrencyCode` type: `interface CustomCurrencies extends HistoricCurrencies {}` in a `declare module '@ducatjs/money'` block.

## `@ducatjs/money/crypto`

BTC (8 decimals, satoshi), ETH (18, wei), SOL (9, lamport) and common Ethereum tokens (USDC, USDT, DAI, WBTC, EURC, PYUSD) as an opt-in table, registered by `defineCryptoCurrencies`. Each unit's decimals are read from the source that defines it, pinned to a release or commit (Bitcoin Core's `COIN`, Ethereum mainnet in ethereum-lists/chains, the Solana SDK, and the Uniswap default token list for tokens). A token's decimals belong to its contract on one network: these are Ethereum mainnet's (USDT has 18 on BNB Chain, 6 here). Define another network's tokens with `defineCurrency`, under codes of your own. Amounts at 18 decimals use Money's bigint path, so they stay exact.

### defineCryptoCurrencies

`defineCryptoCurrencies(codes?: readonly CryptoCurrencyCode[]): void`

Registers crypto codes with `defineCurrency`, with their decimals as the exponent: all of them, or only `codes`. Registering one again is harmless.

- **Throws:** `RangeError` for a code not in the table; `TypeError`, as `defineCurrency` does, for a code already defined with other decimals.

### cryptoUnit

`cryptoUnit(code: string): CryptoUnit | undefined`

The table entry for a code, naming the network and the contract, or `undefined`.

### cryptoUnits

`cryptoUnits(): CryptoUnit[]`

Every entry of the table, by code.

### toBaseUnits

`toBaseUnits(money: Money<string>): bigint`

The exact count of base units (satoshi, wei) as a bigint, for any registered code: the base unit is 10^−exponent.

- **Throws:** `RoundingError` for more decimals than the exponent: there is no fraction of a base unit.

### fromBaseUnits

`fromBaseUnits<C extends CurrencyInput>(units: string | number | bigint, currency: C): Money<C>`

Money from a count of base units, at the currency's exponent: `fromBaseUnits('100000000', 'BTC')` is 1.00000000 BTC. A string is parsed strictly: digits and an optional minus sign only. A hexadecimal quantity from an Ethereum node goes through `BigInt('0x…')` first.

- **Throws:** `SyntaxError` for any other string (spaces, a plus sign, a decimal point, an exponent, separators, leading zeros).

- `CryptoUnit`: `{ code: CryptoCurrencyCode; name: string; decimals: number; baseUnit?: string; network: string; contract?: string }`. `baseUnit` is set for native currencies (`'satoshi'`, `'wei'`, `'lamport'`), `contract` for tokens.
- `CryptoCurrencyCode`: a code in the table.
- `CryptoCurrencies`: every crypto code, for the `CurrencyCode` type, as `HistoricCurrencies`.

```ts
import { cryptoUnit } from '@ducatjs/money/crypto';
import { currencyFromNumeric, minorUnit } from '@ducatjs/money/currencies';
import { currencyTerritories } from '@ducatjs/money/territories';

currencyFromNumeric('008'); // → 'ALL'
minorUnit('JPY'); // → '1'
currencyTerritories('CHF'); // → ['CH', 'LI']
cryptoUnit('USDT')?.decimals; // → 6
currencyFromNumeric(1000); // throws RangeError
```
