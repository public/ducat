# `@ducatjs/money/convert`

Currency conversion at exact rates, rate providers, and multi-currency totals. **Installs:** `convert` on `Money`.

Related: [How to convert currencies](../how-to/convert-currencies.md) · [How to use historical rates](../how-to/use-historical-rates.md) · [Rate sources](rate-sources.md) · [About rounding](../explanation/rounding.md)

A conversion multiplies by an exact rational rate and rounds once, at the end. Rates are never floats: a JS number is read at its shortest decimal form, and a decimal string keeps every digit the source published. Inverses and chains of rates are exact; nothing is rounded until an amount is converted.

## Converting

### convert

`convert<From extends string, To extends string>(money: Money<From>, rate: Rate<NoInfer<From>, To>, rounding?: RoundingInput, options?: ConvertOptions): Money<To>`

`convert<To extends CurrencyInput>(money: Money<string>, to: To, rate: Factor, rounding?: RoundingInput, options?: ConvertOptions): Money<To>`

`convert<To extends CurrencyInput>(money: Money<string>, to: To, provider: RateProvider, rounding?: RoundingInput, options?: ProviderConvertOptions): Money<To>`

Method: `money.convert(rate, rounding?, options?)`, `money.convert(to, rate, rounding?, options?)`, `money.convert(to, provider, rounding?, options?)`.

Converts `money` at a `Rate`, at a bare rate (units of `to` per unit of `money`'s currency), or through a `RateProvider`, which is asked for `money.currency` → `to` as of `options.asOf`.

- **Rounds:** once. With a mode (default `'halfExpand'`), to the target currency's exponent, or `options.scale`. With a rounding policy, to the policy's scale and increment.
- **Throws:** `CurrencyMismatchError` when the `Rate`'s `from` isn't `money`'s currency (a compile error for literal currencies); `RateUnavailableError` when the provider has no rate; `RangeError` when a bare rate isn't positive; `RateExpiredError` with `strictValidity: true` and a rate past its `validUntil`; `RoundingError` with `'unnecessary'` when the result needs rounding; `TypeError` for `options.scale` together with a rounding policy.

```ts
import { money } from '@ducatjs/money';
import { exchangeRate } from '@ducatjs/money/convert';

money('100', 'EUR').convert('JPY', '162.457', 'halfEven'); // → 16246 JPY
exchangeRate('EUR', 'USD', '1.1165').convert(money('100', 'EUR'), 'halfEven'); // → 111.65 USD
```

### convertDetailed

`convertDetailed<From extends string, To extends string>(money: Money<From>, rate: Rate<NoInfer<From>, To>, rounding?: RoundingInput, options?: ConvertOptions): DetailedConversion<From, To>`

Converts like `convert` with a `Rate`, and also returns what rounding left out: `value + residual` is exactly `money × rate`, so a ledger can book the difference. With a rounding policy, `value` is on the policy's scale and increment, and `residual` is still the exact difference.

- **Rounds:** `value` once, as `convert` does. `residual` is an unrounded `ExactMoney`.
- **Throws:** as `convert` with a `Rate`, except that with a rounding mode `strictValidity` is ignored: `RateExpiredError` is thrown only when a rounding policy is passed.

### multiplyByRatioAtScale

`multiplyByRatioAtScale(minor: number | bigint, rate: Ratio, scaleShift: number, rounding: RoundingMode): number | bigint`

The kernel of every conversion: `minor × rate × 10^scaleShift`, rounded once with `rounding`, where `scaleShift` is the result scale minus the input scale. It is pure, and works on minor units without a currency.

- **Rounds:** once, with `rounding`.
- **Throws:** `RoundingError` with `'unnecessary'` when the product isn't exact at the result scale.

## Rates

### exchangeRate

`exchangeRate<From extends CurrencyInput, To extends CurrencyInput>(from: From, to: To, rate: Factor, info?: RateInfo): Rate<From, To>`

An exact rate pinned to a currency pair: one unit of `from` is worth `rate` units of `to`. The rate is a decimal string (every digit kept), an `'a/b'` string, a bigint, a `Ratio`, a `Fixed`, or a JS number read at its shortest decimal form. `info` is optional metadata. Instants are stored in UTC, and dates stay as given.

- **Throws:** `RangeError` when the rate isn't positive, when a date in `info` isn't a valid date or time, or when `info.quote` doesn't describe this rate. The currency codes aren't checked against the registry.

```ts
import { exchangeRate } from '@ducatjs/money/convert';

exchangeRate('EUR', 'HUF', '363.90').toString(); // → '363.90'
exchangeRate('EUR', 'USD', '1.1165').inverse().toString(); // → '2000/2233'
```

### impliedRate

`impliedRate<From extends string, To extends string>(presented: Money<From>, settled: Money<To>, info?: RateInfo): Rate<From, To>`

The exact rate a processor applied: `settled ÷ presented`. Use it to audit a quoted rate, which after the processor's own rounding often doesn't reproduce the settled amount.

- **Throws:** `RangeError` when the quotient isn't positive (a zero or negative amount on either side).

### isRate

`isRate(value: unknown): value is Rate<string, string>`

Whether `value` is a `Rate` built by this copy of the package.

### rateFromJSON

`rateFromJSON(json: RateJSON): Rate<string, string>`

Rebuilds a `Rate`, with its metadata and its `derivedFrom` audit chain, from `rate.toJSON()`.

### Rate

`class Rate<From extends string, To extends string>`

An exact exchange rate. Build it with `exchangeRate()`; the constructor isn't exported. Derived rates (`inverse`, `andThen`, `withMargin`, `round`) keep their inputs in `derivedFrom`. A derived rate takes the oldest `asOf`, the latest `availableAt` and the earliest `validUntil` of its inputs, so staleness can't hide in a chain.

Fields (all readonly):

- `from: From`, `to: To`: the pair.
- `ratio: Ratio`: the exact rate, reduced.
- `source?: string`, `type?: RateType`: where it came from and how it was quoted.
- `asOf?: string`, `availableAt?: string`, `validUntil?: string`: the date or instant it applies to, when it was published, and the last date or instant it applies to.
- `quote?: RateQuote`: the rate as the source published it.
- `derivedFrom?: readonly Rate[]`: the rates a derived rate was built from.

Methods:

- `inverse(): Rate<To, From>`: the exact reciprocal. A `'bid'` becomes an `'ask'` and vice versa.
- `andThen<Next>(next: Rate<To, Next>): Rate<From, Next>`: the exact composite. Nothing is rounded. (Named `andThen`, not `then`, so a Rate is never mistaken for a promise.) Throws `CurrencyMismatchError` when `next.from` isn't `to`.
- `withMargin(margin: Factor): Rate<From, To>`: this rate × (1 + margin), exactly. `withMargin('-0.02')` gives 2% less `to` per `from`.
- `round(places: number, rounding?: RoundingMode): Rate<From, To>`: a new rate rounded to `places` decimals, for businesses that quote rounded rates.
- `toDecimal(places: number, rounding?: RoundingMode): string`: the rate with exactly `places` decimals, for display. The rate itself keeps every digit.
- `toString(): string`: the exact rate, such as `'1.1165'`, or `'2000/2233'` when its decimal expansion doesn't terminate. A rate keeps the digits it was given (`'136.80'`).
- `toJSON(): RateJSON`: the rate, its metadata and its audit chain. `rateFromJSON` reverses it.
- `isExpired(now?: string | Date): boolean`: whether `validUntil` has passed at `now` (default: the system clock). A date is valid all day (UTC).
- `isAvailable(at: string | Date): boolean`: whether the rate had been published by `at`; always true without an `availableAt`. A date `at` means by the end of that UTC day.
- `convert(money: Money<From>, rounding?: RoundingInput, options?: ConvertOptions): Money<To>`: converts, rounding once (see `convert`). Throws `CurrencyMismatchError` for another currency, and `RateExpiredError` with `strictValidity: true` past `validUntil`.

`validUntil` is checked only when a conversion passes `{ strictValidity: true }`: ducat reads the clock only when asked to.

## Providers

A `RateProvider` answers `rate(from, to, { asOf })` synchronously, or with `undefined`. Loading is async and stays outside providers.

### rateTable

`rateTable(spec: readonly Rate[] | RateTableSpec): RateTable`

A fixed table: one base currency against many (`{ base, rates: { USD: '1.1165' } }`, as the ECB publishes), or a list of `Rate`s. Only the pairs given are answered; wrap it in `reversed()` or `via()` for the others. A `null` in `rates` marks a currency the source listed without a value; the table lists it in `missing`. A query with an `asOf` gets nothing from a rate that doesn't apply then: one dated after it, one published (`availableAt`) after it, or one whose `validUntil` has passed. Days are UTC days, and a date query covers the whole day, so without an `availableAt` a query at any time on the rate's day gets it, even before the source published it.

- **Throws:** `CurrencyMismatchError` when a `Rate` given in `rates` isn't `base` → that currency; `RangeError` for a rate that isn't positive.

### chain

`chain(...providers: readonly RateProvider[]): RateProvider`

Asks each provider in turn; the first with an answer wins.

### reversed

`reversed(provider: RateProvider): RateProvider`

Answers `to` → `from` lookups with the exact inverse of the provider's `from` → `to` rate.

### via

`via(base: string, provider: RateProvider): RateProvider`

Triangulates through `base`: `from` → `base`, then `base` → `to`, composed exactly. Each leg is looked up directly or as an exact inverse, so an ECB table (EUR → X only) answers X → Y.

### identity

`identity(): RateProvider`

Answers 1 for a currency to itself, and nothing otherwise.

### rateOf

`rateOf<From extends string, To extends string>(provider: RateProvider, from: From, to: To, query?: RateQuery): Rate<From, To>`

The provider's rate for the pair, for a lookup that must succeed.

- **Throws:** `RateUnavailableError` when the provider has none; `CurrencyMismatchError` when the provider answers with a rate for another pair.

### snapshots

`snapshots(load: (day: string) => Promise<RateProvider | undefined>, options?: SnapshotOptions): Snapshots`

Dated tables from a loader you supply: `load('2026-11-06')` resolves to that day's table, or to `undefined` when there is none. `at(asOf)` resolves to the latest table at or before `asOf` within the lookback, so it looks back over weekends and holidays. Days are UTC days, and a table answers for its whole day, including the hours before it was published, unless it has an `availableAt`. Loaded days are cached (least recently used dropped beyond `max`); misses and failures aren't, so a table not yet published is tried again. A table whose `availableAt` is after the instant asked for is passed over, so a lookup at 09:00 on a publication day gets the day before.

- **Throws:** `RangeError` from `snapshots` for a `lookback` that isn't a non-negative integer or a `max` that isn't a positive integer. `at()` rejects with `RangeError` for an invalid `asOf`, with `RateUnavailableError` when no day within the lookback has a table, and with the loader's own error when the loader throws: it never falls back to an older day after a failure, so an outage can't silently become a stale rate.

### snapshotsFrom

`snapshotsFrom(tables: readonly RateTable[], options?: SnapshotOptions): Snapshots`

`snapshots` over tables you already hold (an ECB 90-day history, for example), keyed by their `asOf` day.

## Totals in several currencies

### bag

`bag(...items: Money<string>[]): MoneyBag`

An immutable set of per-currency totals: `bag(eur10, usd5, eur2).get('EUR')` is 12.00 EUR.

### MoneyBag

`MoneyBag`: the class `bag()` returns. Its constructor isn't exported.

- `add(...items: Money<string>[]): MoneyBag`: a new bag with `items` added.
- `get<C>(currency: C): Money<C> | undefined`: the total in `currency`, or `undefined`.
- `currencies(): string[]`: the currencies held, in first-seen order.
- `values(): Money<string>[]`: the per-currency totals, in first-seen order.
- `exactTotal<To>(to: To, provider: RateProvider, options?: { asOf? }): ExactMoney<To>`: every entry converted exactly into `to` and summed. Nothing is rounded.
- `total<To>(to: To, provider: RateProvider, rounding: RoundingMode, options?: TotalOptions): Money<To>`: the same, rounded once: `bag.total('EUR', fx, 'halfEven')`. Throws `RateUnavailableError` when a rate is missing.
- `toJSON(): unknown[]`: the totals as a list of Money JSON values.

### sumByCurrency

`sumByCurrency(items: Iterable<Money<string>>): Map<string, Money<string>>`

Per-currency totals of `items`, in first-seen order.

### comparator

`comparator(provider: RateProvider, options: ComparatorOptions): (money: Money<string>, other: Money<string>) => -1 | 0 | 1`

Compares amounts in any currencies as their exact values in `options.base` (no rounding, so rounding makes no ties). With one rate per currency the order is consistent, so `list.sort(comparator(fx, { base: 'USD' }))` works. Pairwise rates are not: with bid/ask or slightly inconsistent mid rates, A < B < C < A can happen, and `Array#sort` then gives engine-dependent results. Rates are looked up once per currency, lazily.

- **Throws:** `RateUnavailableError` from inside `sort` when a rate is missing, after the list may already be partly reordered.

### sortByValue

`sortByValue<Item extends Money>(items: Iterable<Item>, provider: RateProvider, options: ComparatorOptions): Item[]`

A new array of `items` in ascending order of their value in `options.base`, as `comparator` orders them. Every amount is converted once, before sorting.

- **Throws:** `RateUnavailableError` before anything is reordered when a rate is missing.

## Errors

- `RateUnavailableError` (extends `Error`): no provider has a rate for the pair. Fields `from`, `to`, `asOf`.
- `RateExpiredError` (extends `Error`): a strict-validity conversion with a rate past its `validUntil`. Field `validUntil`.

## Types

- `Rate<From, To>`: see [Rate](#rate).
- `RateInfo`: `{ source?: string; asOf?: string | Date; availableAt?: string | Date; validUntil?: string | Date; type?: RateType; quote?: RateQuote }`. Dates are ISO-8601 dates (`'2026-11-06'`) or instants. `availableAt` hides the rate from lookups before then; a date means from the start of that UTC day.
- `RateType`: `'mid' | 'bid' | 'ask'` or any other string (`'reference'`). `inverse()` swaps `'bid'` and `'ask'`.
- `RateQuote`: `{ rate: string; per?: number; inverted?: boolean }`: the number exactly as published (trailing zeros kept), how many units of the published direction's first currency it is for (100 for "NOK per 100 JPY"; omitted for 1), and whether the source quoted `to` → `from`.
- `RateJSON`: `{ from; to; rate: string; source?; asOf?; availableAt?; validUntil?; type?; quote?; derivedFrom?: RateJSON[] }`. `rate` is the exact decimal string, or `'num/den'`; `quote` is present only when it says more than `rate`.
- `ConvertOptions`: `{ scale?: number; strictValidity?: boolean }`. `scale` is the result scale (default: the target currency's exponent).
- `ProviderConvertOptions`: `ConvertOptions` and `{ asOf?: string | Date }`.
- `DetailedConversion<From, To>`: `{ value: Money<To>; residual: ExactMoney<To>; rate: Rate<From, To> }`.
- `RateProvider`: `{ rate(from, to, query?: RateQuery): Rate | undefined }`.
- `RateQuery`: `{ asOf?: string | Date }`.
- `RateTable`: a `RateProvider` with `rates: readonly Rate[]`, and `base?`, `asOf?`, `availableAt?`, `validUntil?` and `missing?: readonly string[]`.
- `RateTableSpec`: `RateInfo` without `quote`, plus `{ base: string; rates: Record<string, Factor | Rate | null> }`. `rates.USD` is the number of USD per 1 `base`.
- `SnapshotOptions`: `{ lookback?: number; max?: number }`. `lookback` (default 4, which covers Good Friday to Easter Monday) is how many earlier days to try; `max` (default 32) how many loaded days to keep.
- `Snapshots`: `{ at(asOf: string | Date): Promise<RateProvider> }`.
- `ComparatorOptions`: `{ base: string; asOf?: string | Date }`.
- `TotalOptions`: `{ asOf?: string | Date; scale?: number }`.
