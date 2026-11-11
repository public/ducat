# `@ducatjs/money`

The root entry: the `Money` type, construction, arithmetic, rounding, comparison, serialisation and the currency registry. **Installs:** the core methods on `Money` (every function in [Arithmetic](#arithmetic), [Compare](#compare) and [Serialise](#serialise) as a method), and registers every ISO 4217 currency.

Related: [Your first program](../tutorials/first-steps.md) · [About the representation](../explanation/representation.md) · [About rounding](../explanation/rounding.md) · [About exactness](../explanation/exactness.md)

Each function below is listed with its plain-function signature, as `@ducatjs/money/fn` exports it ([fn.md](fn.md)). The method takes the same arguments without the first: `add(a, b)` is `a.add(b)`. Every operation returns a new value; nothing mutates.

## Money

`Money<C extends string = string>` is an immutable amount: an integer number of 10^-scale units of `currency`. It has three readonly fields:

| field                     | meaning                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `currency: C`             | ISO 4217 code (or a code registered with `defineCurrency`). It is a type parameter, so `Money<'EUR'>` and `Money<'USD'>` don't mix.                                                                                                                                    |
| `minor: number \| bigint` | Integer count of 10^-scale units. It is a **number whenever it is a safe integer** (absolute value ≤ 2^53−1) and a **bigint only beyond that**. The invariant is enforced everywhere, so ordinary amounts never allocate a bigint and huge amounts never lose a digit. |
| `scale: number`           | Decimal places. Defaults to the currency's ISO exponent (EUR 2, JPY 0, KWD 3, CLF 4). It can be larger for sub-minor precision (unit prices, FX intermediates). `round()` brings it back.                                                                              |

- The constructor isn't exported: create values with `money`, `fromMinor`, `zero` or `fromJSON`.
- Values aren't frozen; every field is `readonly` and no operation mutates.
- `toString()` gives `'12.34 EUR'`, and template strings use it.
- `toJSON()` gives `{ amount: '12.34', currency: 'EUR' }` (a `MoneyJSON`), so `JSON.stringify(m)` is `{"amount":"12.34","currency":"EUR"}`.
- Numeric coercion (`a + b`, `a > b`, `+a`) throws a `TypeError`.

```ts
import { money } from '@ducatjs/money';

const price = money('12.34', 'EUR');
price.minor; // → 1234
price.scale; // → 2
price.toString(); // → '12.34 EUR'
JSON.stringify(price); // → '{"amount":"12.34","currency":"EUR"}'
`${price}`; // → '12.34 EUR'
```

## Create

### money

`money<C extends CurrencyInput>(amount: string | number | bigint, currency: C, options?: MoneyOptions): Money<C>`

Money from an amount in **major units**. A string is the recommended form and follows the [decimal-string grammar](#decimal-strings). An integer number or a bigint means major units (`money(12, 'EUR')` is 12.00 EUR). A non-integer number is read at its shortest decimal form (`12.34` is `"12.34"`).

- **Scale:** the currency's exponent, or `options.scale`.
- **Rounds:** never by default. Input with more decimals than the scale throws unless `options.rounding` is given.
- **Throws:** `SyntaxError` for a string outside the grammar; `RangeError` for an exponent or decimal places beyond 1000; `RoundingError` for more decimals than the scale without `rounding`; `RangeError` for a non-finite number, or (without `rounding`) a number whose shortest form has more than 15 significant digits; `RangeError` for an unknown currency; `TypeError` for an amount of another type.

```ts
import { money } from '@ducatjs/money';

money('19.99', 'EUR'); // → 19.99 EUR
money(12, 'EUR'); // → 12.00 EUR
money('1.005', 'EUR'); // throws RoundingError
money('1.005', 'EUR', { rounding: 'halfEven' }); // → 1.00 EUR
money('1.005', 'EUR', { scale: 3 }); // → 1.005 EUR
money(0.1 + 0.2, 'EUR'); // throws RoundingError
```

### fromMinor

`fromMinor<C extends CurrencyInput>(minor: number | bigint, currency: C, scale?: number): Money<C>`

Money from an integer count of 10^-scale units (minor units by default: cents for EUR), as a BIGINT column or a payment processor gives them. A bigint that is a safe integer becomes a number.

- **Throws:** `RangeError` for a number that isn't a safe integer (pass a bigint beyond 2^53) or isn't an integer; `TypeError` for another type; `RangeError` for an unknown currency or an invalid scale.

### zero

`zero<C extends CurrencyInput>(currency: C, scale?: number): Money<C>`

Zero in `currency`, at its exponent or `scale`.

### fromJSON

`fromJSON<C extends CurrencyInput = CurrencyInput>(json: string | MoneyJSON<C>, options?: MoneyOptions): Money<C>`

Reads `{ amount, currency }`, or its JSON text, as `toJSON` writes it. The amount is read as `money()` reads a string, with the same `options` and errors.

- **Throws:** `TypeError` unless `amount` and `currency` are both strings; `SyntaxError` for invalid JSON text or an amount outside the grammar; `RoundingError` as `money()`.

### isMoney

`isMoney(value: unknown): value is Money<string>`

Whether `value` is a Money from this copy of the package. Money from a second installed copy is not.

### isMoneyIn

`isMoneyIn<C extends CurrencyInput>(value: unknown, currency: C): value is Money<C>`

Whether `value` is a Money in `currency`; narrows `Money<string>` (or `unknown`) to `Money<C>`.

### assertCurrency

`assertCurrency<C extends CurrencyInput>(money: Money<string>, currency: C): asserts money is Money<C>`

Narrows `money` to `Money<C>`.

- **Throws:** `CurrencyMismatchError` when `money` is in another currency; `TypeError` when it isn't Money.

```ts
import { assertCurrency, fromJSON, isMoneyIn, money } from '@ducatjs/money';

const price = fromJSON({ amount: '12.34', currency: 'EUR' as string }); // Money<string>
isMoneyIn(price, 'EUR'); // → true
assertCurrency(price, 'EUR'); // now Money<'EUR'>
price.add(money('1', 'EUR')); // → 13.34 EUR
assertCurrency(fromJSON({ amount: '1', currency: 'USD' as string }), 'EUR'); // throws CurrencyMismatchError
```

### Decimal strings

`money()`, `fromJSON()`, `fixed()`, `ratio()` and every other place that takes an amount or a factor as a string accept exactly this, and nothing else:

- an optional sign, `+` or `-`;
- one or more ASCII digits;
- optionally a point followed by one or more digits;
- optionally an exponent: `e` or `E`, an optional sign, and digits.

The exponent is at most 1000 either way, and so is the number of decimal places once it is applied. `'.5'`, `'5.'`, `'-.5'`, grouping (`'1,000'`, `'1_000'`), other scripts' digits and surrounding whitespace throw a `SyntaxError`. A factor can also be written `'a/b'`, two of these strings around a slash. For text as people write it, use [`parse`](parse.md). Why the grammar is this strict: [About exactness](../explanation/exactness.md).

```ts
import { money } from '@ducatjs/money';

money('-12.34', 'EUR'); // → -12.34 EUR
money('+7', 'EUR'); // → 7.00 EUR
money('1.5e3', 'EUR'); // → 1500.00 EUR
money('125E-2', 'EUR'); // → 1.25 EUR
money('.5', 'EUR'); // throws SyntaxError
money('5.', 'EUR'); // throws SyntaxError
money(' 12.34', 'EUR'); // throws SyntaxError
money('1,000', 'EUR'); // throws SyntaxError
```

## Factors and ratios

### ratio

`ratio(value: Factor, den?: Factor): Ratio`

An exact rational: `ratio('1.075')`, `ratio(3, 4)`, `ratio(10n)`, `ratio('1/3')`. A number is read at its shortest decimal form, so `ratio(0.1)` is exactly 1/10. A `Fixed` is read as its scaled integer over 10^scale. The result is reduced, with a positive denominator. Decimal strings are cached (up to 1024 entries); pre-build ratios used in hot loops.

- **Throws:** `RangeError` for a zero denominator, a non-finite number, or a number with more than 15 significant digits (pass a string); `SyntaxError` for a string outside the grammar; `TypeError` for any other value.

```ts
import { ratio } from '@ducatjs/money';

ratio('1.075'); // → { num: 43n, den: 40n, n: 43, d: 40 }
ratio(1, 3); // → { num: 1n, den: 3n, n: 1, d: 3 }
ratio(0.1); // → { num: 1n, den: 10n, n: 1, d: 10 }
```

Every parameter typed `Factor` (`multiply`, `divide`, tax and percentage functions, rates, quantities) accepts the same values and reads them the same way.

## Arithmetic

### add

`add<C extends string>(money: Money<C>, other: Money<NoInfer<C>>): Money<C>`

`money + other`, exactly, at the larger of the two scales.

- **Throws:** `CurrencyMismatchError` for another currency (a compile error for literal currency types); `TypeError` when `other` isn't Money.

### subtract

`subtract<C extends string>(money: Money<C>, other: Money<NoInfer<C>>): Money<C>`

`money − other`, exactly, at the larger of the two scales. Throws as `add`.

### sum

`sum<C extends string>(items: readonly Money<C>[], currency?: C): Money<C>`

The exact sum of a list in one currency, at the largest scale in it. An empty list returns zero in `currency`.

- **Throws:** `RangeError` for an empty list without `currency`; `CurrencyMismatchError` when the items, or the items and `currency`, differ (a compile error for literal types).

### negate

`negate<C extends string>(money: Money<C>): Money<C>`

`−money`. Never returns negative zero.

### abs

`abs<C extends string>(money: Money<C>): Money<C>`

`|money|`.

### multiply

`multiply<C extends string>(money: Money<C>, factor: Factor, rounding?: RoundingInput): Money<C>`

`money × factor`. The factor is exact: an integer, a decimal string (`'1.075'`), an `'a/b'` string, a bigint, a `ratio()` or a `Fixed`.

- **Rounds:** once, to `money`'s scale, with `rounding` (default `'halfExpand'`); with a [rounding policy](policy.md), once to the policy's scale and increment.
- **Throws:** `RoundingError` when `rounding` is `'unnecessary'` and the product is inexact; `TypeError` or `RangeError` for a value that isn't a factor (see [`ratio`](#ratio)); `CurrencyMismatchError` for a policy restricted to another currency.

```ts
import { money } from '@ducatjs/money';

const total = money('25.00', 'EUR');
total.multiply('1.075'); // → 26.88 EUR (26.875 rounds half away from zero by default)
total.multiply('1.075', 'halfEven'); // → 26.88 EUR
total.multiply('1.075', 'unnecessary'); // throws RoundingError
```

### divide

`divide<C extends string>(money: Money<C>, divisor: Factor, rounding?: RoundingInput): Money<C>`

`money ÷ divisor`, rounded as `multiply`. To split an amount so the parts sum to it, use [`allocate`](allocate.md) instead.

- **Throws:** `RangeError` for a zero divisor; otherwise as `multiply`.

### round

`round<C extends string>(money: Money<C>, rounding: RoundingMode, scale?: number): Money<C>`
`round<C extends string>(money: Money<C>, policy: RoundingPolicy): Money<C>`

Rounds to `scale` (default: the currency's exponent) with `rounding`, or to a policy's scale and increment. A value already at or below the scale is returned at that scale exactly.

- **Throws:** `RangeError` for a scale that isn't an integer from 0 to 1000 (a scale is never negative: round to tens or hundreds with a policy's `increment`, or [`roundToIncrement`](cash.md)); `RoundingError` for `'unnecessary'` when digits would be lost.

### toScale

`toScale<C extends string>(money: Money<C>, scale: number, rounding?: RoundingMode): Money<C>`

Changes the scale. Increasing it is exact; decreasing it rounds with `rounding` (default `'halfExpand'`).

- **Throws:** `RangeError` for a scale that isn't an integer from 0 to 1000; `RoundingError` for `'unnecessary'` when digits would be lost.

### with

Method only: `m.with<R>(operation: (money: Money<C>) => R): R`.

Applies `operation` to the amount and returns its result, so a rounding policy, a price ending or a conversion reads as one step of a chain: `price.multiply('1.075').with(policy)`.

## Compare

Comparisons work across scales and across number and bigint minor units.

### compare

`compare<C extends string>(money: Money<C>, other: Money<NoInfer<C>>): -1 | 0 | 1`

- **Throws:** `CurrencyMismatchError` for another currency.

### lessThan, lessThanOrEqual, greaterThan, greaterThanOrEqual

`lessThan<C extends string>(money: Money<C>, other: Money<NoInfer<C>>): boolean`, and `lessThanOrEqual`, `greaterThan` and `greaterThanOrEqual` with the same signature. Throw as `compare`.

### equals

`equals(money: Money<string>, other: Money<string>): boolean`

Same currency and same value: 1.0 EUR at scale 1 equals 1.00 EUR. Another currency gives `false`, never an error.

### identical

`identical(money: Money<string>, other: Money<string>): boolean`

Same currency, value **and** scale (number and bigint minor units count as equal), for round-trip tests.

```ts
import { money } from '@ducatjs/money';

const one = money('1', 'EUR');
one.equals(money('1', 'EUR', { scale: 1 })); // → true
one.identical(money('1', 'EUR', { scale: 1 })); // → false
one.equals(money('1', 'USD')); // → false
```

### isZero, isPositive, isNegative, sign

`isZero(money: Money<string>): boolean`, `isPositive(money: Money<string>): boolean` (greater than zero), `isNegative(money: Money<string>): boolean` (less than zero), and `sign(money: Money<string>): -1 | 0 | 1`.

### min, max

`min<C extends string>(first: Money<C>, ...rest: Money<NoInfer<C>>[]): Money<C>`, and `max` with the same signature: the smallest or largest amount; the first wins ties.

- **Throws:** `CurrencyMismatchError` for mixed currencies.

### clamp

`clamp<C extends string>(money: Money<C>, lo: Money<NoInfer<C>>, hi: Money<NoInfer<C>>): Money<C>`

`money` limited to `[lo, hi]`.

- **Throws:** `RangeError` when `lo > hi`; `CurrencyMismatchError` for mixed currencies.

## Serialise

### toDecimal

`toDecimal(money: Money<string>): string`

The exact decimal string in major units, with every place of the scale: `'12.34'`, `'-0.05'`, `'1000'` for JPY. For NUMERIC/DECIMAL columns and wire formats.

### toMinor

`toMinor(money: Money<string>): bigint`

The amount in the currency's minor units (cents for EUR) as a bigint, whatever the value's scale.

- **Throws:** `RoundingError` when the amount has non-zero digits below the minor unit; `round()` it first.

### toMinorNumber

`toMinorNumber(money: Money<string>, options?: ToMinorNumberOptions): number`

As `toMinor`, as a number.

- **Throws:** `RoundingError` for digits below the minor unit, even with `lossy`; `RangeError` when the result isn't a safe integer, unless `{ lossy: true }`, which gives the nearest double instead (±Infinity beyond the largest double).

### toNumber

`toNumber(money: Money<string>): number`

The amount in major units as the nearest double, rounded once (100000 at scale 18 is `100000`); ±Infinity beyond the largest double, as `Number()` gives. Lossy on purpose, for charts, PDFs and APIs that take numbers. Never throws.

### toScaledUnits

`toScaledUnits(money: Money<string>): bigint`

The amount in units of 10^-scale (12340n for 12.340 EUR at scale 3), to store next to the scale.

```ts
import { fromMinor, money } from '@ducatjs/money';

money('12.340', 'EUR', { scale: 3 }).toMinor(); // → 1234n
money('12.345', 'EUR', { scale: 3 }).toMinor(); // throws RoundingError
money('12.345', 'EUR', { scale: 3 }).toScaledUnits(); // → 12345n
fromMinor(1000000000000000050n, 'USD').toMinorNumber(); // throws RangeError
fromMinor(1000000000000000050n, 'USD').toMinorNumber({ lossy: true }); // → 1000000000000000000
money('12.34', 'EUR').toNumber(); // → 12.34
```

### majorPart, minorPart

`majorPart(money: Money<string>): number | bigint`: the whole major units, truncated toward zero.
`minorPart(money: Money<string>): number | bigint`: the rest, in 10^-scale units, with the amount's sign.

Each is a number while it is a safe integer and a bigint beyond, like `minor`.

```ts
import { money } from '@ducatjs/money';

money('-12.34', 'EUR').majorPart(); // → -12
money('-12.34', 'EUR').minorPart(); // → -34
money('1.005', 'EUR', { scale: 3 }).minorPart(); // → 5
```

### hasFraction

`hasFraction(money: Money<string>): boolean`

Whether the fractional part is non-zero: `true` for 12.34 EUR, `false` for 12.00 EUR at any scale. dinero.js calls it `hasSubUnits`.

## Currencies

The root entry registers every ISO 4217 code. A `/fn`-only program registers the ones it imports from [`@ducatjs/money/iso`](fn.md).

### currencyExponent

`currencyExponent(code: string): number`

The minor-unit exponent of a registered currency: EUR 2, JPY 0, KWD 3.

- **Throws:** `RangeError` for an unregistered code ("Unknown currency", naming the import that registers ISO codes).

### isCurrency

`isCurrency(code: string): code is CurrencyCode`

Whether `code` is registered: an ISO code (all of them wherever an entry other than `/fn` is imported, and in a `/fn`-only program the ones imported from `@ducatjs/money/iso`), or one from `defineCurrency`.

### defineCurrency

`defineCurrency(code: string, exponent: number): void`

Registers a code that isn't in ISO 4217 (crypto, loyalty points, withdrawn codes you hold balances in). Defining a code again with the same exponent does nothing. To have the code in the `CurrencyCode` type, augment `CustomCurrencies`.

- **Throws:** `RangeError` for an exponent that isn't an integer from 0 to 30; `TypeError` for an ISO code (use an explicit `scale` for more precision), a string that can't be a currency code, or a code already defined with another exponent.

### Tables and types

- `ISO_EXPONENTS`: the ISO 4217 exponent of every active code that has one, as a readonly object (`ISO_EXPONENTS.JPY` is `0`).
- `ISO_4217_PUBLISHED`: the publication date of the ISO 4217 List One snapshot the table comes from, `'2026-09-17'`.
- `ISO_NON_MONETARY`: the active codes whose minor unit ISO lists as "N.A." (XAU, XDR, XTS…), which are not in `ISO_EXPONENTS`.
- `IsoCurrencyCode`: the ISO codes, as a union of string literals.
- `CustomCurrencies`: an empty interface to augment with your own codes (`interface CustomCurrencies { BTC: true }`).
- `CurrencyCode`: `IsoCurrencyCode` or a key of `CustomCurrencies`.
- `CurrencyInput`: what constructors accept: a `CurrencyCode` (which autocompletes) or any string.

```ts
import { currencyExponent, ISO_EXPONENTS, isCurrency } from '@ducatjs/money';

currencyExponent('KWD'); // → 3
ISO_EXPONENTS.JPY; // → 0
isCurrency('XYZ'); // → false
currencyExponent('XYZ'); // throws RangeError
```

## Rounding modes

`RoundingMode` is one of these strings, the ones `Intl.NumberFormat` uses for its `roundingMode` option. `Rounding` maps familiar names to them.

| `Rounding.*` alias     | string          | behaviour                                          |
| ---------------------- | --------------- | -------------------------------------------------- |
| `HalfEven` / `Bankers` | `'halfEven'`    | ties go to the even neighbour                      |
| `HalfUp`               | `'halfExpand'`  | ties go away from zero                             |
| `HalfDown`             | `'halfTrunc'`   | ties go toward zero                                |
| `HalfCeil`             | `'halfCeil'`    | ties go toward +∞                                  |
| `HalfFloor`            | `'halfFloor'`   | ties go toward −∞                                  |
| `Up`                   | `'expand'`      | always away from zero                              |
| `Down`                 | `'trunc'`       | always toward zero                                 |
| `Ceil`                 | `'ceil'`        | always toward +∞                                   |
| `Floor`                | `'floor'`       | always toward −∞                                   |
| `Unnecessary`          | `'unnecessary'` | throws `RoundingError` if rounding would be needed |

- `DEFAULT_ROUNDING` is `'halfExpand'`, the mode arithmetic uses when none is given. Parsing (`money('1.005', 'EUR')`) and processor amounts throw unless a mode is passed.
- An invalid mode (possible only from untyped code) throws a `RangeError`, and only when rounding is actually needed.
- `RoundingInput` is a `RoundingMode` or a `RoundingPolicy` ([policy.md](policy.md)): every `rounding` parameter typed `RoundingInput` takes either.

## Errors

- `RoundingError` (extends `RangeError`): an operation would have to round, but the mode is `'unnecessary'` or no mode was given where rounding is never implicit (parsing, `toMinor`, processor amounts).
- `CurrencyMismatchError` (extends `TypeError`): two amounts in different currencies were combined. Its `expected` and `actual` fields hold the two codes.

Other failures use the built-in classes: `SyntaxError` for text outside a grammar, `RangeError` for values out of range (scales, unknown currencies, division by zero), and `TypeError` for arguments of the wrong type.

## Extending Money

### extendMoney

`extendMoney(methods: Record<string, (this: Money<string>, ...args: never[]) => unknown>, options?: ExtendMoneyOptions): void`

Adds methods to every Money, non-enumerable like class methods. This is how the opt-in modules install theirs. Declare their types with `declare module '@ducatjs/money' { interface Money<C extends string> { … } }`. See [How to add your own methods](../how-to/add-your-own-methods.md).

- `ExtendMoneyOptions`: `{ owner?: string }`. Installing again under the same `owner` replaces that owner's methods (hot reload, a second copy of the module); installing the same function again is harmless.
- **Throws:** `TypeError` for a name Money already has (its own methods, or one another owner added), and for a reserved name (the names every object inherits).

## Types

- `Money<C>`: see [Money](#money).
- `MoneyJSON<C>`: `{ amount: string; currency: C }`, the JSON form; `amount` is an exact decimal string in major units.
- `MoneyOptions`: `{ scale?: number; rounding?: RoundingMode }`, for `money()` and `fromJSON()`. `rounding` defaults to `'unnecessary'` (throw).
- `ToMinorNumberOptions`: `{ lossy?: boolean }`, for `toMinorNumber`.
- `Factor`: `number | bigint | string | Ratio | Fixed`.
- `Ratio`: `{ num: bigint; den: bigint; n: number; d: number }`, reduced, `den > 0`; `n` and `d` are the same values as numbers, or `NaN` when not safe integers.
- `RoundingMode`, `RoundingInput`, `RoundingPolicy`: see [Rounding modes](#rounding-modes) and [policy.md](policy.md).
- `CurrencyCode`, `IsoCurrencyCode`, `CurrencyInput`, `CustomCurrencies`: see [Tables and types](#tables-and-types).
- `ExtendMoneyOptions`: see [extendMoney](#extendmoney).
