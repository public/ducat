# How to migrate from dinero.js

This guide moves a codebase from dinero.js 1 or 2 to ducat. The API mapping is the easy part. The work is in three places:

- the data model: amounts kept as numbers at a fixed precision;
- rounding defaults that differ from function to function;
- a few methods with the same name and a different meaning.

Everything below was checked against dinero.js 1.9.1 and 2.0.2. The bug classes dinero.js has had are regression tests in [test/other-libs.test.ts](https://github.com/public/ducat/blob/main/test/other-libs.test.ts).

## Before you start

- **Node 24 or later, or a bundler.** ducat is an ES module only. On Node 24 a CommonJS project can `require('@ducatjs/money')` with no build step, and TypeScript finds the types with any `moduleResolution`. On an older Node, bundle the code that uses ducat (esbuild, Rollup, webpack and Vite all handle ESM), or upgrade first.
- **No global settings.** dinero.js 1 has `Dinero.defaultCurrency`, `defaultPrecision`, `globalLocale`, `globalRoundingMode` and `globalFormatRoundingMode`, and dinero.js 2's helpers close over a calculator. ducat has none of these. A single-currency app uses a [currency context](#a-currency-context-instead-of-global-defaults) instead.
- **Port the tests first.** Several dinero.js names mean something else in ducat (see [Same name, different meaning](#same-name-different-meaning)), and a rename can pass a test suite that never covers zero or a tie.

## The data model

dinero.js 1 code usually keeps amounts as integers at a precision: `Dinero({ amount: 1234, precision: 2 })`, with `getAmount()` and `convertPrecision()` at every boundary. ducat's Money carries its scale with it, so most of those conversions go away:

- arithmetic on Money at different scales works directly: 12.34 + 12.345 is 24.685, at scale 3;
- `round()` or `toScale()` changes the scale where you choose, with a rounding mode you name.

```ts
import { fromMinor, money } from '@ducatjs/money';

// Dinero({ amount: 1234, currency: 'EUR' }), with dinero.js 1's default precision of 2
const price = fromMinor(1234, 'EUR'); // → 12.34 EUR
fromMinor(12345, 'EUR', 3); // → 12.345 EUR
price.add(fromMinor(12345, 'EUR', 3)); // → 24.685 EUR
money('12.34', 'EUR').equals(price); // → true
```

**Precision isn't the currency's exponent.** dinero.js 1 defaults every currency to precision 2, so a codebase that never set `precision` holds JPY in hundredths: `{ amount: 500, currency: 'JPY', precision: 2 }` is ¥5, not ¥500. `fromMinor(amount, currency)` reads at the ISO exponent (0 for JPY), so read such data at its stored precision, then round:

```ts
import { fromMinor } from '@ducatjs/money';

fromMinor(500, 'JPY', 2); // → 5.00 JPY
fromMinor(500, 'JPY', 2).round('unnecessary'); // → 5 JPY
fromMinor(550, 'JPY', 2).round('unnecessary'); // throws RoundingError
```

### Stored amounts and JSON

dinero.js 1's `toJSON()` and `toObject()` both give `{ amount, currency, precision }`, so `JSON.stringify(dinero)` writes that shape. ducat's JSON is `{ "amount": "12.34", "currency": "EUR" }`, with the amount as an exact decimal string. Data you already store keeps working through `@ducatjs/money/wire`:

```ts
import { money } from '@ducatjs/money';
import { fromDineroObject, toDineroObject } from '@ducatjs/money/wire';

fromDineroObject({ amount: 1234, currency: 'EUR', precision: 2 }); // → 12.34 EUR
fromDineroObject({ amount: 500, currency: 'JPY', precision: 2 }); // → 5.00 JPY
toDineroObject(money('12.34', 'EUR')); // → { amount: 1234, currency: 'EUR', precision: 2 }
JSON.stringify(money('12.34', 'EUR')); // → '{"amount":"12.34","currency":"EUR"}'
```

`fromDineroObject` keeps the stored precision as the scale. `toDineroObject` writes the Money's scale and throws beyond 2^53 − 1 units, because dinero.js amounts are numbers. For dinero.js 2's `toSnapshot()`, use `fromMinor(snapshot.amount, snapshot.currency.code, snapshot.scale)`.

**For new columns**, store minor units in a BIGINT next to a currency code, or a decimal in NUMERIC/DECIMAL or a JSON column. A value whose scale varies (from `convertPrecision` calls, for example) needs a scale column too. [How to store money in a database](store-money-in-a-database.md) has the column types, and there are helpers for Prisma, Drizzle, Kysely, node-postgres and TypeORM. A BIGINT holds ±9.2·10^18 minor units, where a JavaScript number is exact only to 2^53.

## API mapping

### dinero.js 1

| dinero.js 1                                 | ducat                                                        | notes                                                                               |
| ------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `Dinero({ amount, currency, precision })`   | `fromMinor(amount, currency, precision)`                     | without `precision`, ducat uses the currency's exponent, not 2                      |
| `getAmount()`                               | `toScaledUnits(m)` (a bigint)                                | `toMinorNumber(m)` for a number in the currency's minor units                       |
| `getCurrency()`, `getPrecision()`           | `m.currency`, `m.scale`                                      |                                                                                     |
| `getLocale()`, `setLocale(l)`               | pass the locale to `format`, or use a context                | nothing is stored on the value                                                      |
| `add`, `subtract`                           | `add`, `subtract`                                            | different scales just work; `normalizePrecision` isn't needed                       |
| `multiply(n, mode)`, `divide(n, mode)`      | `multiply(m, n, 'halfEven')`, `divide(m, n, 'halfEven')`     | see [Rounding](#rounding) for the mode; pass factors as strings (`'0.0605'`)        |
| `percentage(p, mode)`                       | `percentage(m, p, 'halfEven')` (`/tax`)                      | above 100 works                                                                     |
| `allocate(ratios)`                          | `allocate(m, ratios, { remainder: 'first' })` (`/allocate`)  | see [Allocation](#allocation)                                                       |
| `convert(currency, options)`                | `convert(m, to, rate)` or an `exchangeRate` (`/convert`)     | ducat doesn't fetch inside `convert`; `/convert/fetch` and the parsers are separate |
| `equalsTo`, `lessThan`, `greaterThan`...    | `equals`, `lessThan`, `greaterThan`...                       | other currencies throw instead of returning false                                   |
| `isZero`, `isNegative`                      | `isZero`, `isNegative`                                       |                                                                                     |
| `isPositive()`                              | `!isNegative(m)`                                             | **not** `isPositive`: see [below](#same-name-different-meaning)                     |
| `hasSubUnits()`, `hasCents()`               | `hasFraction(m)`                                             |                                                                                     |
| `hasSameCurrency(o)`                        | `a.currency === b.currency`                                  |                                                                                     |
| `hasSameAmount(o)`                          | `equals(a, b)`                                               |                                                                                     |
| `toFormat(format, mode)`                    | `format(m, locale, options)` (`/format`)                     | `Intl.NumberFormat` options instead of a format string                              |
| `toUnit()`                                  | `toNumber(m)`                                                | lossy on purpose; keep it for charts and APIs that take numbers                     |
| `toRoundedUnit(digits, mode)`               | `toNumber(round(m, 'halfExpand', digits))`                   |                                                                                     |
| `toObject()`, `toJSON()`                    | `toDineroObject(m)` (`/wire`) for the old shape, or `toJSON` |                                                                                     |
| `convertPrecision(p, mode)`                 | `toScale(m, p, 'halfExpand')`                                | see [Rounding](#rounding)                                                           |
| `Dinero.minimum(list)`, `maximum(list)`     | `min(...list)`, `max(...list)`                               |                                                                                     |
| `Dinero.defaultCurrency`, `globalLocale`... | a currency context                                           |                                                                                     |

### dinero.js 2

| dinero.js 2                                             | ducat                                                                    | notes                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `dinero({ amount, currency: EUR, scale })`              | `fromMinor(amount, 'EUR', scale)`                                        | currencies are ISO codes as strings; `defineCurrency` for others                                       |
| `toSnapshot(d)`                                         | `toJSON(m)` / `JSON.stringify(m)`, or `m.minor`, `m.currency`, `m.scale` |                                                                                                        |
| `toDecimal(d)`                                          | `toDecimal(m)`                                                           |                                                                                                        |
| `toUnits(d)`                                            | `[majorPart(m), minorPart(m)]`                                           |                                                                                                        |
| `add`, `subtract`, `compare`, `equal`, `greaterThan`... | `add`, `subtract`, `compare`, `equals`, `greaterThan`...                 |                                                                                                        |
| `multiply(d, { amount, scale })`                        | `multiply(m, '0.0605', mode)`, or `exact(m).multiply(...)`               | dinero.js 2 grows the scale; ducat rounds to the Money's scale, and `ExactMoney` keeps the exact value |
| `allocate(d, ratios)`                                   | `allocate(m, ratios)` (`/allocate`)                                      | ratios as decimal strings (`'33.3'`); remainders differ, see [Allocation](#allocation)                 |
| `transformScale(d, s, divide)`                          | `toScale(m, s, 'floor')`                                                 | dinero.js 2 floors by default; name the mode you mean                                                  |
| `normalizeScale`, `trimScale`                           | not needed, `trimScale(m)` (`/math`)                                     |                                                                                                        |
| `convert(d, currency, rates)`                           | `convert(m, to, rate)` (`/convert`)                                      |                                                                                                        |
| `isPositive`, `isNegative`, `isZero`                    | the same                                                                 | dinero.js 2's `isPositive` is `> 0`, as in ducat                                                       |
| `hasSubUnits(d)`                                        | `hasFraction(m)`                                                         |                                                                                                        |
| `haveSameCurrency(list)`                                | compare `m.currency`                                                     |                                                                                                        |
| `minimum(list)`, `maximum(list)`                        | `min(...list)`, `max(...list)`                                           |                                                                                                        |
| rounding functions `halfEven`, `halfUp`...              | the mode names below                                                     |                                                                                                        |

## Rounding

dinero.js rounds differently from function to function, and not always as documented:

| dinero.js call                        | rounds by default                                                                  | ducat call that gives the same results         |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1: `multiply`, `divide`, `percentage` | half to even (`globalRoundingMode`)                                                | pass `'halfEven'`                              |
| 1: `convertPrecision`                 | half away from zero (`globalFormatRoundingMode`), though its docs say half to even | `toScale(m, p, 'halfExpand')`, ducat's default |
| 1: `toFormat`, `toRoundedUnit`        | half away from zero                                                                | `'halfExpand'`                                 |
| 2: `transformScale`                   | down (toward −∞)                                                                   | `'floor'`                                      |
| 2: `multiply`                         | doesn't round (the scale grows)                                                    | `exact(m).multiply(...)`, then `round` once    |

ducat's default everywhere is `'halfExpand'`, half away from zero. The dinero.js 1 modes map to ducat's like this:

| dinero.js 1 | `HALF_EVEN`  | `HALF_AWAY_FROM_ZERO` | `HALF_TOWARDS_ZERO` | `HALF_UP`    | `HALF_DOWN`   | `DOWN`    | `HALF_ODD` |
| ----------- | ------------ | --------------------- | ------------------- | ------------ | ------------- | --------- | ---------- |
| ducat       | `'halfEven'` | `'halfExpand'`        | `'halfTrunc'`       | `'halfCeil'` | `'halfFloor'` | `'floor'` | none       |

dinero.js 2's `halfEven`, `halfAwayFromZero`, `halfTowardsZero`, `halfUp`, `halfDown`, `up` and `down` map the same way, with `up` as `'ceil'` and `down` as `'floor'`.

```ts
import { fromMinor } from '@ducatjs/money';
import '@ducatjs/money/tax';

// dinero.js 1: Dinero({ amount: 15000 }).multiply(0.0605) is 908 (9.075 to even)
fromMinor(15000, 'EUR').multiply('0.0605', 'halfEven'); // → 9.08 EUR
// dinero.js 1: Dinero({ amount: 57 }).percentage(50) is 28 (0.285 to even)
fromMinor(57, 'EUR').percentage(50, 'halfEven'); // → 0.28 EUR
fromMinor(57, 'EUR').percentage(50); // → 0.29 EUR
// dinero.js 1: Dinero({ amount: 12345, precision: 3 }).convertPrecision(2) is 1235
fromMinor(12345, 'EUR', 3).toScale(2, 'halfExpand'); // → 12.35 EUR
// dinero.js 2: transformScale(dinero({ amount: -12345, currency: EUR, scale: 3 }), 2) is -1235
fromMinor(-12345, 'EUR', 3).toScale(2, 'floor'); // → -12.35 EUR
```

**When not to copy the old mode.** Copy it where results are already stored or compared against: invoices that were sent, ledger rows, tests that pin amounts. Don't copy it where the old mode was an accident, such as dinero.js 2's floor on `transformScale`, which takes a cent off every negative amount it rounds. There, pick the mode the business rule names, and note the change.

**Floats.** dinero.js 1 multiplies in floating point before it rounds, so a product that should be a tie can arrive just below or above one. ducat computes the exact product and then rounds, so in those cases it gives the documented answer, not the float's. Run old and new side by side over real data before switching, and pass factors as strings: `multiply(m, '0.0605')`, not `0.0605`.

## Allocation

|                                        | remainder units go to                                       | negative amounts                                                                                        |
| -------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| dinero.js 1 `allocate`                 | one at a time, from the first non-zero ratio                | the shares are floored, so the remainder goes to the first parts upward (−10.03 in two is −5.01, −5.02) |
| dinero.js 2 `allocate`                 | one at a time, from the largest ratio                       | mirrored                                                                                                |
| ducat `allocate` (default `'largest'`) | the parts with the largest fractional remainders (Hamilton) | mirrored                                                                                                |
| ducat `{ remainder: 'first' }`         | one at a time, from the first non-zero weight               | mirrored (−5.02, −5.01)                                                                                 |

So `{ remainder: 'first' }` reproduces dinero.js 1 for amounts of zero or more. No ducat strategy matches dinero.js 2 in general: for 1.00 in the ratio 1:2:3, dinero.js 2 gives 0.16, 0.33, 0.51 and ducat gives 0.17, 0.33, 0.50. Zero weights never receive anything in any of them.

```ts
import { fromMinor } from '@ducatjs/money';
import '@ducatjs/money/allocate';

fromMinor(1003, 'EUR').allocate([50, 50], { remainder: 'first' }).map(String); // → ['5.02 EUR', '5.01 EUR']
fromMinor(1003, 'EUR').allocate([0, 50, 50], { remainder: 'first' }).map(String); // → ['0.00 EUR', '5.02 EUR', '5.01 EUR']
fromMinor(100, 'EUR').allocate([1, 2, 3]).map(String); // → ['0.17 EUR', '0.33 EUR', '0.50 EUR']
```

## Same name, different meaning

- **`isPositive` in dinero.js 1 is `>= 0`; in ducat it is `> 0`**, as in dinero.js 2. A plain rename can pass a whole test suite and still stop zero-amount transfers, or turn a zero balance red. Use `!m.isNegative()` for dinero.js 1's meaning.
- **Duck typing fails silently.** `typeof x.getAmount === 'function'` is false for Money, so code that sniffs for dinero objects quietly takes the other branch. Use `isMoney(x)`, or `isMoneyIn(x, 'EUR')`.
- **Comparing different currencies throws.** dinero.js 1's `equalsTo` returns false for another currency; ducat's `equals` and the other comparisons throw a `CurrencyMismatchError`, and TypeScript rejects them at compile time where the currencies are literal types. Check `a.currency === b.currency` first where mixing is expected.
- **`getAmount()` isn't the minor units.** It's units at the value's precision, which is `toScaledUnits()` in ducat. `toMinor()` is always the currency's minor units, at any scale.

```ts
import { isMoney, money } from '@ducatjs/money';

const nothing = money('0', 'EUR');
nothing.isPositive(); // → false
!nothing.isNegative(); // → true
isMoney(nothing); // → true
money('12.345', 'EUR', { scale: 3 }).toScaledUnits(); // → 12345n
```

## Methods need their module's import

Each module installs its methods when it's imported (`import '@ducatjs/money/allocate'`), and only the root entry's methods are there by default. Import the module in every file that calls its methods, not once at startup: test runners and workers load files on their own, and there `m.allocate` would be undefined even though the code type-checks. Code that must not change any prototype, such as a library, imports plain functions from `@ducatjs/money/fn` instead, together with the currencies it uses (`import '@ducatjs/money/iso'`).

## A currency context instead of global defaults

dinero.js 1's `Dinero.defaultCurrency` and `Dinero.globalLocale` are global. They also leak between test files that share the module. In ducat, bind the currency and locale once, in a module of your own:

```ts
import { currencyContext, type MoneyOf } from '@ducatjs/money/context';

export const eur = currencyContext('EUR', { locale: 'en-IE' });
export type Eur = MoneyOf<typeof eur>;

eur.fromMinor(1234); // → 12.34 EUR
eur.format(eur.money('1234.5')); // → '€1,234.50'
```

It's a frozen plain object, so nothing global changes and tests stay isolated. Pass `parse` from `@ducatjs/money/parse` to give it a `parse` as well.
