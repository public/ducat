# Rate sources

The parsers, historical-rate providers, fetchers and processor-rate readers that feed [`@ducatjs/money/convert`](convert.md). Every entry here **installs nothing**. Parsers take text and never fetch; only `@ducatjs/money/convert/fetch` touches the network.

Related: [How to use historical rates](../how-to/use-historical-rates.md) · [How to convert currencies](../how-to/convert-currencies.md)

| entry                            | source                                          | tables                         | `availableAt` by default                 |
| -------------------------------- | ----------------------------------------------- | ------------------------------ | ---------------------------------------- |
| `@ducatjs/money/convert/ecb`     | ECB euro reference rates (eurofxref, SDMX-CSV)  | EUR → currency, one per day    | none (`availableAt: true` for 16:00 CET) |
| `@ducatjs/money/convert/boc`     | Bank of Canada Valet API (JSON)                 | CAD → currency, exact inverses | 16:30 Toronto time                       |
| `@ducatjs/money/convert/fed`     | Federal Reserve H.10 (DDP CSV), parser only     | USD → currency                 | none                                     |
| `@ducatjs/money/convert/hmrc`    | HMRC monthly exchange rates (CSV), parser only  | GBP → currency, one per month  | end of the publication day               |
| `@ducatjs/money/convert/boe`     | Bank of England database (CSV), parser only     | GBP → currency                 | none                                     |
| `@ducatjs/money/convert/fetch`   | network fetchers for the ECB and Bank of Canada | as their parsers               | as their parsers                         |
| `@ducatjs/money/convert/history` | any tables                                      | `rateHistory`, `quotedTable`   | n/a                                      |
| `@ducatjs/money/stripe-fx`       | a Stripe balance transaction                    | one `Rate`                     | n/a                                      |
| `@ducatjs/money/adyen-fx`        | an Adyen settlement details row                 | one `Rate`                     | n/a                                      |

Every parser returns `RateTable[]`, newest first, reads missing-value markers the same way (they go in the table's `missing`), and throws `SyntaxError` for input it can't read.

## `@ducatjs/money/convert/ecb`

The ECB publishes once per TARGET working day at about 16:00 CET, for information only, so its rates are typed `'reference'`, with `source: 'ECB'` and `asOf` the publication day. Its files give no publication time, so the parsers set no `availableAt` unless asked.

### parseEcbXml

`parseEcbXml(xml: string, options?: EcbOptions): RateTable[]`

Parses `eurofxref-daily.xml`, `eurofxref-hist-90d.xml` or `eurofxref-hist.xml` into one EUR-based table per day. A day without any rates is left out, so a lookback goes on to the day before.

- **Throws:** `SyntaxError` for a rate entry that can't be read.

### parseEcbCsv

`parseEcbCsv(csv: string, options?: EcbOptions): RateTable[]`

Parses `eurofxref.csv` or `eurofxref-hist.csv` (from the ECB's zips) the way `parseEcbXml` does. `'N/A'` and blank cells (currencies not quoted that day) are listed in `missing`; a day with no rates at all is left out.

- **Throws:** `SyntaxError` for a file it can't read.

### parseEcbSdmxCsv

`parseEcbSdmxCsv(csv: string, options?: EcbSdmxOptions): RateTable[]`

Parses the ECB Data Portal's SDMX-CSV (`format=csvdata`) for the daily euro reference rates (dataflow EXR, key `D.<currencies>.EUR.SP00.A`), which has any date range back to 1999 in one file. The Data Portal strips trailing zeros (`147.2` for 147.20), so the published digits are rebuilt from each series' `DECIMALS` attribute: in the file with full detail, or from `options.decimals` for a `detail=dataonly` file. Two series overstate it (THB and LTL) and are padded only to the decimals the ECB published. Without `DECIMALS`, the digits stay as the file gives them; the values are exact either way. An empty or `NaN` value is a missing value. Discontinued series simply end.

- **Throws:** `SyntaxError` for a row for another frequency, rate type or base currency, or with a `UNIT_MULT` other than 0.

### parseEcbSdmxDecimals

`parseEcbSdmxDecimals(csv: string): Record<string, number>`

The `DECIMALS` of each series in an SDMX-CSV file: the data file with full detail, or the series file the API returns with `detail=nodata`. Pass the result as `decimals` to `parseEcbSdmxCsv`.

### Types

- `EcbOptions`: `{ availableAt?: EcbAvailableAt }`. When each day's rates became available, so a historical lookup can't use a rate before it was published. Default: none, so a query at any time on the day gets that day's rates.
- `EcbAvailableAt`: `boolean | ((day: string) => string | Date)`. `true` is the ECB's documented 16:00 CET on the day, which is Frankfurt time (15:00 UTC in winter, 14:00 in summer); a function gives your own, from your own fetch log for example.
- `EcbSdmxOptions`: `EcbOptions` and `{ decimals?: Record<string, number> }`. A `DECIMALS` column in the file takes precedence.

## `@ducatjs/money/convert/history`

Quoted tables and date ranges, for lookups that should see only what was known at a past date, in the form the source published it.

### rateHistory

`rateHistory(tables: readonly RateTable[], options?: RateHistoryOptions): RateHistory`

A provider over many dated tables, answering any day synchronously. A lookup takes the latest table at or before `asOf` that has the pair, was published by then and is still valid, looking back up to `lookback` days. Each pair falls back on its own, so a currency missing on a holiday comes from the day before while the others stay current; the rate's `asOf` says which day it is from. A table with a `validUntil` answers its whole period whatever the lookback. Without an `asOf`, the newest table with the pair answers. Overlapping periods (a mid-month amendment) resolve to the one that started last.

- `history.rate(from, to, query?)`: the `Rate`, or `undefined`.
- `history.lookup(from, to, query?)`: a `RateLookup`: the rate (or `undefined`) and the days passed over, newest first, each with its `FallbackReason`.
- `history.tables`: the tables, newest first.

### quotedTable

`quotedTable(spec: QuotedTableSpec): RateTable`

A `rateTable` from rates as a source published them. Each is stored exactly in the table's direction, base → currency, and keeps its published quote (`rate.quote`). Use it for sources that quote the other way round (CAD per USD) or per 100 units (NOK per 100 JPY), and for feeds that strip trailing zeros (`{ rate: '1.175', decimals: 4 }` is kept as `'1.1750'`). `null` marks a currency listed without a value.

### rateFromQuote

`rateFromQuote<From extends CurrencyInput, To extends CurrencyInput>(from: From, to: To, quote: RateQuote, info?: Omit<RateInfo, 'quote'>): Rate<From, To>`

A `Rate` from one published quote: `per` units and the direction are applied exactly, and the quote is kept on the rate.

```ts
import { rateFromQuote } from '@ducatjs/money/convert/history';

rateFromQuote('JPY', 'NOK', { rate: '6.50', per: 100 }).toString(); // → '0.065'
rateFromQuote('USD', 'EUR', { rate: '1.1650', inverted: true }).toString(); // → '200/233'
```

### Types

- `RateHistory`: a `RateProvider` with `tables` and `lookup`.
- `RateHistoryOptions`: `{ lookback?: number }`. Days to look back for a daily table; default 4, which covers Good Friday to Easter Monday.
- `RateLookup<From, To>`: `{ rate: Rate<From, To> | undefined; skipped: readonly Fallback[] }`.
- `Fallback`: `{ day: string; reason: FallbackReason }`.
- `FallbackReason`: `'noTable'` (no table that day: a weekend or holiday), `'notYetAvailable'` (not published at the time asked for), `'expired'` (its period is over), `'missing'` (listed without a value) or `'notQuoted'` (not listed at all).
- `QuotedTableSpec`: `RateTableSpec` with `rates: Record<string, string | QuotedRate | null>`, and `inverted?: boolean` (every rate is published as base per unit of the currency unless its entry says otherwise) and `decimals?: number`.
- `QuotedRate`: `{ rate: string; per?: number; inverted?: boolean; decimals?: number }`. `per` is how many units the number is for: of `base`, or of the currency when `inverted` ("NOK per 100 JPY" is `{ rate: '6.50', per: 100, inverted: true }` in a NOK table).

## `@ducatjs/money/convert/boc`

### parseBankOfCanadaJson

`parseBankOfCanadaJson(json: string, options?: BankOfCanadaOptions): RateTable[]`

Parses the Bank of Canada's daily rates from the Valet API's JSON (the `FX_RATES_DAILY` group, or single `FX…CAD` series) into one CAD-based table per business day. The Bank quotes CAD per unit of each currency (FXUSDCAD 1.3748), so each table holds the exact inverse, CAD → currency, and keeps the published quote: `rate.inverse()` prints `'1.3748'` again. Rates have `source: 'BoC'`, `type: 'average'` (an average of a day's quotes, not a market rate) and `availableAt` 16:30 Toronto time, when the Bank says it publishes them. A series listed in `seriesDetail` but absent on a day, or with an empty or null value, is in that day's `missing`.

Precision: the Bank quotes four decimals, up to six for small rates, so a small rate has only about four significant digits: JPY `0.008760`, KRW `0.000929`, and IDR `0.000082` with two. The inverse is exact, but no more precise than the quote.

- **Throws:** `SyntaxError` for anything but daily `FX…CAD` series (monthly or annual groups, other data), and for two different values for one series on one day.

- `BankOfCanadaOptions`: `{ availableAt?: false | ((day: string) => string | Date) }`. Default: 16:30 Toronto time that day; `false` for none.

## `@ducatjs/money/convert/fed`

### parseFedH10Csv

`parseFedH10Csv(csv: string): RateTable[]`

Parses the Federal Reserve Board's H.10 daily rates, as CSV from its Data Download Program (release H10, series in columns, with labels), into one USD-based table per day. These are the noon buying rates in New York, certified for US customs, daily since 1971, with `source: 'FRB'` and `type: 'noon buying'`.

- **Direction:** H.10 quotes currency per USD except AUD, EUR, NZD and GBP (series `RXI$US_N.B.*`), which it quotes as USD per unit. Those four are stored as exact inverses with the published quote kept, so every table is USD → currency.
- **Holidays** are rows of `ND`; such a day is left out, and a file of holidays only gives `[]`. A single `ND` cell is a missing value.
- **Digits:** four decimals, trailing zeros kept. **Codes:** the Fed's own (the bolívar is `VEB`).
- **No `availableAt`:** the release is weekly (Mondays, 4:15 p.m. ET) and covers the week before, and the CSV doesn't say when each row was released.
- **Throws:** `SyntaxError` for a file with no observation rows, a column whose Unit, Multiplier or Currency isn't `Currency`, 1 and its series' code, a currency with two columns, or two different values for one day.

There is no fetcher: the Board is retiring the Data Download Program in favour of FRED, whose terms (an API key, no storing or caching, no commercial use without consent) rule one out. Board data itself is public domain.

## `@ducatjs/money/convert/hmrc`

### parseHmrcMonthlyCsv

`parseHmrcMonthlyCsv(csv: string, options?: HmrcOptions): RateTable[]`

Parses HMRC's monthly exchange rates CSV (the UK's rates for customs and VAT, from trade-tariff.service.gov.uk, under the Open Government Licence) into one GBP-based table per period. Each table is valid for its calendar month: `asOf` is the 1st and `validUntil` the last day. Rates are currency units per £1, with `source: 'HMRC'` and `type: 'customs'`, four decimals as published. `availableAt` is the end (UTC) of the Wednesday HMRC publishes the file: the day before the penultimate Thursday of the month before (the `publication_date` the trade tariff service's API gives every monthly file).

- **Throws:** `SyntaxError` for a blank or missing-value cell (HMRC never leaves one), for rows of countries sharing a code (the CFA francs, AED, XCD) that disagree, and for any other unreadable row.

- `HmrcOptions`: `{ availableAt?: false | ((start: string) => string | Date) }`.

## `@ducatjs/money/convert/boe`

### parseBankOfEnglandCsv

`parseBankOfEnglandCsv(csv: string, options?: BankOfEnglandOptions): RateTable[]`

Parses the Bank of England database's CSV of daily spot rates against sterling (series `XUDL…`, downloaded with codes as column titles, `DATE,XUDLUSS,XUDLERS,…`, and dates like `22 Dec 2025`) into one GBP-based table per day. Rates are currency units per £1, with `source: 'BoE'` and `type: 'spot'`. Trailing zeros, which the CSV strips, are rebuilt to `decimals`. Holidays have no row; an empty cell (before a series starts, or after it ends, as for BGN) is a missing value. No `availableAt` is set: the Bank says only that daily rates are updated "no more than two working days after the date to which they relate".

- **Throws:** `SyntaxError` for an unknown series code, a bad date, two different values for a day, or any other unreadable cell.
- **Licence:** the Bank's legal page excludes "selected exchange rate data and series" from its Open Government Licence as third-party data, and its spot rates may come from LSEG, whose content can't be redistributed without consent. So ducat ships no Bank of England data and no fetcher, and **you must check the licence of every Bank of England series you load** before you use or republish it. The Bank also says these "are not official rates".

- `BankOfEnglandOptions`: `{ decimals?: number }` (default 4, as its database shows every spot series).

## `@ducatjs/money/convert/fetch`

Opt-in fetchers, using the platform `fetch` with a timeout. Nothing else in ducat touches the network.

### fetchEcb

`fetchEcb(options?: FetchEcbOptions): Promise<RateTable[]>`

Fetches the ECB's eurofxref XML (`history`: `'daily'`, the default, `'90d'` or `'all'`) and parses it with `parseEcbXml`.

### fetchEcbRange

`fetchEcbRange(options: FetchEcbRangeOptions): Promise<RateTable[]>`

Fetches a date range from the ECB Data Portal, which needs no key and allows browsers (CORS), and parses it with `parseEcbSdmxCsv`, with the published digits. It makes two requests, the series' `DECIMALS` and the observations without attributes, which keeps the full history since 1999 to about 15 MB. They share one timeout and are cancelled together. A range with no rates gives `[]`; start a few days before the first day you need, so a lookback has a table to fall back on.

### fetchBankOfCanada

`fetchBankOfCanada(options?: FetchBankOfCanadaOptions): Promise<RateTable[]>`

Fetches the Bank of Canada's daily rates from its Valet API (keyless, CORS-enabled) and parses them with `parseBankOfCanadaJson`. Without `start`, only the latest day; without `end`, up to the latest. The Bank's rates are "released for statistical and analytical purposes only", and it asks users to keep within request limits it doesn't publish.

- **Throws (all three):** rejects with `FetchRatesError` when the response isn't 2xx, with the platform's abort error on timeout or `signal`, and with the parser's `SyntaxError` for a body it can't read.

### Constants and errors

- `ECB_URLS`: `{ daily, '90d', all }`, the eurofxref file URLs.
- `ECB_DATA_API`: `'https://data-api.ecb.europa.eu/service/data/EXR'`, the Data Portal's SDMX REST API.
- `BANK_OF_CANADA_URL`: the Valet API URL of the `FX_RATES_DAILY` group.
- `FetchRatesError` (extends `Error`): the request completed without a 2xx status. Fields `status` and `url`.

### Types

- `FetchEcbOptions`: `{ history?: 'daily' | '90d' | 'all'; signal?: AbortSignalLike; timeout?: number; fetch?: Fetch; availableAt?: EcbAvailableAt }`. `timeout` is in milliseconds (default 30 000; 0 for none). `fetch` replaces the global one (proxies, retries, tests).
- `FetchEcbRangeOptions`: `FetchEcbOptions` without `history`, plus `{ start: string | Date; end?: string | Date; currencies?: readonly string[] }`. `start` is `'1999-01-04'` at the earliest; `currencies` defaults to every currency, discontinued series included.
- `FetchBankOfCanadaOptions`: `FetchEcbOptions` without `history` and `availableAt`, plus `{ start?: string | Date; end?: string | Date }` (`start` 2017-01-03 at the earliest; `end` needs a `start`).
- `Fetch`: the subset of the platform `fetch` used: `(url, init?: { signal?, headers? }) => Promise<{ ok; status; text() }>`.
- `AbortSignalLike`: the part of `AbortSignal` used, declared structurally so the library needs no DOM or Node types.

## `@ducatjs/money/stripe-fx`

What a Stripe payment actually settled at.

### stripeRate

`stripeRate<From extends string>(from: From, transaction: StripeBalanceTransaction): Rate<Uppercase<From>, Uppercase<string>> | undefined`

The rate Stripe quotes on a balance transaction, from the charge currency `from` to the balance currency ("the amount in currency A, multiplied by the exchange_rate, equals the amount in currency B"). The JSON number is read at its shortest decimal form. `asOf` is the balance transaction's `created` time, the closest timestamp Stripe gives for the conversion. `undefined` when nothing was converted.

### stripeImpliedRate

`stripeImpliedRate<From extends string>(charged: Money<From>, transaction: StripeBalanceTransaction): Rate<From, Uppercase<string>>`

The exact rate Stripe applied: the balance transaction's gross amount ÷ the charged amount.

- `StripeBalanceTransaction`: `{ amount: number; currency: string; exchange_rate?: number | null; created?: number }` (`created` in seconds since the Unix epoch).

## `@ducatjs/money/adyen-fx`

### adyenRate

`adyenRate(row: AdyenSettlementRow, options?: AdyenRateOptions): Rate<string, string> | undefined`

The rate in a settlement details report row, Gross Currency → Net Currency (1 when they are the same), with the decimal string kept exactly. `asOf` comes from Creation Date, which Adyen gives in local time with the zone in the TimeZone column: pass `{ timeZone: 'Europe/Amsterdam' }` (the account's IANA zone) to read it correctly all year. Without it, an unambiguous abbreviation (CET, PST…) or offset (+01:00) is taken literally, and any other label gives the local day. `undefined` when the row has no rate. For externally settled payments Adyen lists its reference rate, not the acquirer's, so check those with `impliedRate()`.

- `AdyenSettlementRow`: `Readonly<Record<string, string | undefined>>`, a report row keyed by column name.
- `AdyenRateOptions`: `{ timeZone?: string }`.
