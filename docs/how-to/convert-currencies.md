# How to convert between currencies

This guide shows you how to convert amounts at exact rates, round once at the end, look rates up from a provider, book the rounding residual, and total amounts in several currencies. Everything here is in `@ducatjs/money/convert`. For rates on past dates, see [How to use historical exchange rates](use-historical-rates.md).

## Convert at a rate

Build a `Rate` with `exchangeRate(from, to, rate, info?)`. Write rates as decimal strings, with every digit the source published: a rate keeps the digits it was given, and a string says what was meant. The pair is in the rate's type, so converting the wrong currency is a compile error.

```ts
import { money } from '@ducatjs/money';
import { exchangeRate } from '@ducatjs/money/convert';

const eurUsd = exchangeRate('EUR', 'USD', '1.1165', {
  source: 'ECB',
  asOf: '2026-11-06',
  type: 'reference',
});
const usdJpy = exchangeRate('USD', 'JPY', '158.33');
eurUsd.convert(money('100', 'EUR'), 'halfEven'); // → 111.65 USD
eurUsd.inverse().toString(); // → '2000/2233': exact, not 0.8956...
eurUsd.andThen(usdJpy); // EUR → JPY, exact, with both rates kept in `derivedFrom`
eurUsd.withMargin('-0.02'); // 2% less USD per EUR, exactly
```

Inverses and chains of rates are exact too: nothing is rounded until an amount is converted. If you only have a rate as a string, `m.convert('JPY', '162.457')` (from the README's first example) converts at it directly. The result is always at the target currency's scale, rounded once; [Where money arithmetic goes wrong](../explanation/footguns.md#conversions-at-the-wrong-scale) shows a library where it isn't.

## Land a conversion on a cash increment or a fixed number of decimals

Pass a rounding policy wherever a rounding mode goes:

```ts
import { money } from '@ducatjs/money';
import { cashPolicy } from '@ducatjs/money/cash';
import { exchangeRate } from '@ducatjs/money/convert';

const eurChf = exchangeRate('EUR', 'CHF', '0.9143');
money('10.07', 'EUR').convert(eurChf, cashPolicy('CHF')); // → 9.20 CHF (9.207001, to 0.05)
```

## Look rates up from a provider

A `RateProvider` answers `rate(from, to, { asOf })` synchronously, or with `undefined`. Hold a fixed set of rates in `rateTable()`, then combine: `chain(...)` takes the first answer, `reversed(p)` inverts, `via('EUR', p)` triangulates through one currency, and `identity()` answers 1 for a currency to itself. Keep loading outside providers: it is async. `snapshots(load)` gives the latest table at or before a day, looks back over weekends and holidays, and caches loaded days.

<!-- doctest: setup import { readFileSync } from 'node:fs'; const xml90Days = readFileSync('test/fixtures/ecb/eurofxref-hist-2d.xml', 'utf8'); -->

```ts
import { money } from '@ducatjs/money';
import { snapshotsFrom, via } from '@ducatjs/money/convert';
import { parseEcbXml } from '@ducatjs/money/convert/ecb';

const history = snapshotsFrom(parseEcbXml(xml90Days));
const fx = via('EUR', await history.at('2026-11-08')); // a Sunday: Friday's table
money('100', 'USD').convert('JPY', fx, 'halfEven'); // → 15833 JPY, through EUR, rounded once
```

If a loader throws, the lookup fails instead of falling back to an older day, so an outage can't silently become a stale rate.

## Check that a rate is still valid

A rate's `validUntil` is checked only when you pass `{ strictValidity: true }`, because ducat reads the clock only when asked to. A derived rate takes the oldest `asOf`, the latest `availableAt` and the earliest `validUntil` of its inputs.

## Book the rounding residual

If a ledger has to book what rounding cost, use `convertDetailed()`:

```ts
import { money } from '@ducatjs/money';
import { convertDetailed, exchangeRate } from '@ducatjs/money/convert';

const eurUsd = exchangeRate('EUR', 'USD', '1.1165');
const { value, residual } = convertDetailed(money('0.07', 'EUR'), eurUsd, 'halfEven');
value; // → 0.08 USD
residual; // → -369/200000 USD (value + residual is the exact conversion)
```

For a longer chain that should round once at the end, keep the intermediate values as `ExactMoney` ([How to round to a policy](round-to-a-policy.md)).

## Total and sort amounts in several currencies

`bag(...amounts)` keeps per-currency totals, and `bag.total('EUR', fx, 'halfEven')` converts every entry exactly, sums and rounds once. To order amounts in different currencies, use `comparator(fx, { base: 'USD' })`, which compares them through one base currency. With one rate per currency the order is consistent. If your rates are pairwise (bid/ask, or slightly inconsistent mid rates), A < B < C < A can happen and `Array#sort` then gives engine-dependent results, so use `sortByValue(list, fx, { base })`, which looks every rate up before it reorders anything.

## Related

- Reference: [`@ducatjs/money/convert`](../reference/convert.md), [rate sources and loaders](../reference/rate-sources.md), [`@ducatjs/money/exact`](../reference/exact.md)
- Explanation: [About rounding](../explanation/rounding.md), [About exactness](../explanation/exactness.md)
