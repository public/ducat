# About storing money

An amount outlives the process that computed it: it goes into a database column, a JSON payload, a log line, a message to another system. Each of those is read back later, often by other code and sometimes by another version of ducat. This page explains the forms ducat writes and why, and what can change the meaning of a stored amount. The column types and helpers are in [How to store money in a database](../how-to/store-money-in-a-database.md). The functions are in the [reference](../reference/money.md).

## JSON is a decimal string plus the currency

ducat's JSON is a decimal string plus the currency, never minor units: `{"amount":"12.34","currency":"EUR"}`. Minor units only mean something to a reader who knows the exponent, and the exponent isn't fixed:

- Processors disagree with ISO. Stripe sends ISK and UGX as two-decimal; Adyen has its own exceptions.
- ISO exponents change over time.
- Generic consumers (other languages, `NUMERIC` and `Decimal` columns, logs) expect a decimal amount.

Minor units remain available, but only through explicit, named conversions, where the owner of the exponent is known: `toMinor`, `toStripeAmount`, `toAdyenAmount`, and the BIGINT column helpers. The amount is a string so it survives JSON parsers that turn numbers into floats.

Other libraries chose differently. Evidence from a comparison of the npm money libraries (2026-11): by default, `JSON.stringify` of 12.34 EUR gives minor units in dinero.js 2 (`{"amount":1234,"currency":{"code":"EUR","base":10,"exponent":2},"scale":2}`; with the bigint calculator it throws "Do not know how to serialize a BigInt"), dinero.js 1 (`{"amount":1234,"currency":"EUR","precision":2}`), js-money, ts-money and @screeny05/ts-money (`{"amount":1234,"currency":"EUR"}`, with no exponent, so the reader must know it) and monetra (`{"amount":"1234","currency":"EUR","precision":2}`). The decimal libraries and money-math give `"12.34"`, and bigint-money gives `["12.34","EUR"]`. Related dinero.js issues: #22 (`JSON.stringify` gave `{}`, then `toJSON` was debated), #636 (deserialising needs the full currency object from a dynamic code), and #771 (`allocate` hangs on a value deserialised at scale 19).

## Minor units in SQL, and what they depend on

In a database the trade-off is different. A BIGINT column of minor units next to a currency code is compact, exact, fast to sum and compare, and portable across Postgres, MySQL and SQLite, which is why it is the recommended storage. BIGINT holds ±9.2·10^18 minor units, which is 92 quadrillion EUR. A decimal column (`NUMERIC(19,4)`) is self-describing instead, at the cost of choosing a scale large enough for every currency stored. JSON keeps the scale and the currency together in one value.

Minor units carry the exponent implicitly, and that has a consequence. Minor units stored without a scale are read at the currency's exponent in the installed version of ducat, so a changed exponent would silently change what old rows mean: 1234 stored as 12.34 would read as 1.234 or 123.4. So a bundled ISO 4217 exponent change is a breaking change: it is listed under **Changed** in the changelog, with the currencies affected, and ships only in a minor version before 1.0 and a major version from 1.0. Before upgrading across one, migrate the affected rows, or store a scale column (or a decimal) so the question never arises. Custom currencies keep the exponent given to `defineCurrency`.

A scale column makes minor units self-describing: any scale then round-trips, sub-minor amounts included, and stored rows also keep their meaning if a currency's exponent changes. Only the Prisma helpers have one so far. Elsewhere, store `m.toScaledUnits()` and `m.scale` yourself, or use a decimal, JSON or the node-postgres composite column, which keep the scale. Without a scale, minor-unit columns can't round-trip values at a scale other than the currency's, so the minor-unit writers refuse them by design rather than round.

The same reasoning decides which exponent a withdrawn code gets. Each takes the exponent ISO 4217 gave it while it was current, not CLDR's display digits, which differ for some (CLDR has SLL, STD, MRO and ZMK at 0, where ISO had 2), because stored minor units must mean what they meant when they were written.

## Column types to avoid

- Postgres's `money` type is locale-dependent; don't use it. Its scale and output format come from the server's `lc_monetary` setting rather than from the value.
- SQLite has no exact decimal type: a NUMERIC column's affinity may store a value as REAL, a float. Store minor units as INTEGER, or TEXT with `toDecimal` if you must. TEXT decimals compare and sort as text in SQL (`'10.00' < '9.00'`), and `sum()` over them is a REAL, so columns that are sorted, compared or summed in SQL should be minor units.
- Drivers are the other place digits get lost. A BIGINT beyond 2^53 that a driver returns as a JS number, or a DECIMAL returned as a number, may already be rounded, so ducat's database helpers reject those on read instead of returning a wrong amount. Postgres also rounds extra decimals silently on insert into a `NUMERIC(p, s)`, which is why the writers check a value against the column's size first.

## Why integers, not decimals, in memory

The in-memory form and the stored form are separate choices. In memory ducat uses integer minor units with a bigint fallback, for speed (see [About the representation](representation.md)). Decimal strings are fast to store, parse and print, but every arithmetic op has to parse and re-print, which makes them 30–100x slower. They are good as a wire format, not as an in-memory one. That is why a decimal string is ducat's JSON form and a number is its in-memory one.
