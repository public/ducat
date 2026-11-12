# How to use historical exchange rates

This guide shows you how to load published exchange rates (ECB, Bank of Canada, Federal Reserve H.10, HMRC, Bank of England) and look up the rate that was known on a past date, in the form the source published it. Publication times and missing values work in `@ducatjs/money/convert` itself; quoted tables and ranges are in the opt-in `@ducatjs/money/convert/history`, so converting at rates you already hold doesn't pay for them.

## Load a date range and look a rate up

Parse the source's file, then hand the tables to `rateHistory`. It answers synchronously, falls back per pair (a currency missing on a holiday comes from the day before) up to `lookback` days (default 4), and `lookup()` says why it fell back: `noTable`, `notYetAvailable`, `expired`, `missing` or `notQuoted`.

<!-- doctest: setup import { readFileSync } from 'node:fs'; const ecbXml = readFileSync('test/fixtures/ecb/eurofxref-hist-2d.xml', 'utf8'); -->

```ts
import { parseEcbXml } from '@ducatjs/money/convert/ecb';
import { quotedTable, rateHistory } from '@ducatjs/money/convert/history';

const history = rateHistory(parseEcbXml(ecbXml)); // e.g. eurofxref-hist-90d.xml
const sunday = history.lookup('EUR', 'USD', { asOf: '2026-11-08' });
sunday.rate?.asOf; // → '2026-11-06'
sunday.skipped.map((fallback) => fallback.day); // → ['2026-11-08', '2026-11-07']
sunday.skipped[0]?.reason; // → 'noTable' (a weekend: no table that day)

const nok = quotedTable({
  base: 'NOK',
  asOf: '2026-11-06',
  rates: { JPY: { rate: '6.50', per: 100, inverted: true }, ISK: null },
});
nok.rate('NOK', 'JPY')?.inverse().toString(); // → '0.065'
nok.rate('NOK', 'JPY')?.quote; // → { rate: '6.50', per: 100, inverted: true }
nok.missing; // → ['ISK']
```

If a source quotes the other way round (CAD per USD) or per 100 units (NOK per 100 JPY), build the table with `quotedTable({ base, inverted: true, rates })` or per-entry `{ rate, per, inverted }`, as above: it stores the exact rate in the table's direction and keeps the published quote. If a feed strips trailing zeros, `{ rate, decimals }` rebuilds them (`'1.175'` with 4 decimals is `'1.1750'`). Mark a currency the source listed without a value (a holiday, `ND`, `N/A`) with `null`; the table lists it in `missing`.

## Hide rates until they were published

A lookup for a past date should see only what was known then. Set `availableAt` on a rate or a table to hide it from lookups before then, so a query for 09:00 on a publication day gets the day before. A date query covers the whole day. A table with `validUntil` (a monthly rate, say) answers any day up to that date and nothing after it, whatever the lookback. `snapshots()` skips tables not yet published, too.

## Load the ECB's euro reference rates

Parse the daily, 90-day or full-history eurofxref XML or CSV files with `parseEcbXml` / `parseEcbCsv`, or a Data Portal SDMX-CSV file (any range back to 1999) with `parseEcbSdmxCsv`. To download them, use the opt-in fetchers in `@ducatjs/money/convert/fetch`: `fetchEcb()` for the eurofxref files and `fetchEcbRange({ start, end, currencies })` for the Data Portal, which needs no key and allows browsers (CORS). They use the platform `fetch` with a 30-second default timeout. Nothing else in ducat touches the network.

The ECB's files give no publication time. If you need historical lookups that respect it, pass `availableAt: true` (to the parsers, `fetchEcb` or `fetchEcbRange`) for the documented 16:00 CET, which is Frankfurt time (15:00 UTC in winter, 14:00 in summer), or a function of the day for your own.

<!-- doctest: setup import { readFileSync } from 'node:fs'; const sdmxCsv = readFileSync('test/fixtures/ecb-sdmx/exr-d-full.csv', 'utf8'); -->

```ts
import { parseEcbSdmxCsv } from '@ducatjs/money/convert/ecb';
import { rateHistory } from '@ducatjs/money/convert/history';

// what fetchEcbRange({ start: '2025-12-22', end: '2026-01-06' }) parses
const history = rateHistory(parseEcbSdmxCsv(sdmxCsv));
history.rate('EUR', 'ISK', { asOf: '2026-01-06' })?.toString(); // → '147.20' (the API sends 147.2)
history.rate('EUR', 'USD', { asOf: '2025-12-26' })?.asOf; // → '2025-12-24' (Christmas)
```

## Load the Bank of Canada's daily rates

Parse the Valet API's JSON with `parseBankOfCanadaJson` (`@ducatjs/money/convert/boc`), or fetch it with `fetchBankOfCanada()` (keyless and CORS-enabled):

<!-- doctest: setup import { readFileSync } from 'node:fs'; const valetJson = readFileSync('test/fixtures/boc/fx-rates-daily.json', 'utf8'); -->

```ts
import { parseBankOfCanadaJson } from '@ducatjs/money/convert/boc';

const [latest] = parseBankOfCanadaJson(valetJson); // what fetchBankOfCanada() parses
latest?.rate('CAD', 'USD')?.inverse().toString(); // → '1.3789' (CAD per USD, as published)
latest?.availableAt; // → '2026-01-06T21:30:00.000Z' (16:30 in Toronto)
```

The Bank quotes four decimals (up to six for small rates), so a small rate has only about four significant digits: JPY `0.008760`, KRW `0.000929`, and IDR `0.000082` with two. For those currencies, prefer a source that quotes them the other way round.

## Load the Federal Reserve's H.10 rates

Download the CSV from the Board's Data Download Program yourself (release H10, series in columns, with labels), and parse it with `parseFedH10Csv` (`@ducatjs/money/convert/fed`). There is no fetcher: the Board is retiring the Data Download Program in favour of FRED, whose terms (an API key, no storing or caching, no commercial use without consent) rule one out.

<!-- doctest: setup import { readFileSync } from 'node:fs'; const h10Csv = readFileSync('test/fixtures/fed/h10-daily.csv', 'utf8'); -->

```ts
import { parseFedH10Csv } from '@ducatjs/money/convert/fed';

const [latest] = parseFedH10Csv(h10Csv); // a DDP download of H.10
latest?.rate('USD', 'JPY')?.toString(); // → '156.7000' (yen per USD, as published)
latest?.rate('USD', 'EUR')?.inverse().toString(); // → '1.1689' (USD per euro, as published)
```

## Load sterling rates from HMRC or the Bank of England

For the UK's customs and VAT rates, parse HMRC's monthly CSV with `parseHmrcMonthlyCsv` (`@ducatjs/money/convert/hmrc`). Each month's table is valid for that month only:

<!-- doctest: setup import { readFileSync } from 'node:fs'; const hmrcCsv = readFileSync('test/fixtures/hmrc/monthly_csv_2026-11.csv', 'utf8'); -->

```ts
import { rateHistory } from '@ducatjs/money/convert/history';
import { parseHmrcMonthlyCsv } from '@ducatjs/money/convert/hmrc';

const hmrc = rateHistory(parseHmrcMonthlyCsv(hmrcCsv)); // monthly_csv_2026-11.csv
hmrc.rate('GBP', 'EUR', { asOf: '2026-11-27' })?.toString(); // → '1.1930' (valid all November)
hmrc.rate('GBP', 'EUR', { asOf: '2026-12-01' }); // → undefined (December has its own file)
```

For the Bank of England's daily spot rates, download CSV from its database and parse it with `parseBankOfEnglandCsv` (`@ducatjs/money/convert/boe`). ducat ships no Bank of England data and no fetcher, and **you must check the licence of every Bank of England series you load** before you use or republish it.

## Load any other source

Any other source is a small loader that returns a `rateTable`.

## Related

- Reference: [rate sources, parsers and fetchers](../reference/rate-sources.md) (publication times, quoting and licences per source), [`@ducatjs/money/convert`](../reference/convert.md)
- How-to: [How to convert currencies](convert-currencies.md)
