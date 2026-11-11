# About exactness

ducat's first promise is that an amount is never a float. This page explains what that means in practice: how numbers, strings and factors get in, why some inputs are refused, and how a value leaves when a float is genuinely wanted. The grammar and the functions are in the [reference](../reference/money.md). Parsing text as people write it is in [How to parse user input](../how-to/parse-user-input.md).

## No float arithmetic on amounts

Factors, rates and percentages are exact rationals (`ratio('1.075')`, `ratio(1, 3)`, `'1/3'`, bigint, integer). A JS number factor such as `0.1` is read at its shortest decimal form (`"0.1"`, exactly 1/10) and never multiplied as a float. `money(0.1 + 0.2, 'EUR')` **throws**: `0.30000000000000004` has too many decimals, and we don't silently turn it into 0.30.

Other libraries multiply through floats, and that is where they go wrong: multiplying through floats turns 0.50 × 1.15 into 0.57. An exact rational avoids the problem altogether, and the [representation](representation.md) makes it cheap: integer minor units on a number fast path, with a bigint fallback, keep integer arithmetic exact at every size.

`Symbol.toPrimitive` throws on numeric coercion, so `a + b`, `a > b` and `+a` fail loudly instead of doing float math. Template strings still work (`"12.34 EUR"`). The same holds for `Fixed`: `Number(fixed)` and `+fixed` throw, so a float never slips in unnoticed. `toNumber()` is the named way to accept one, where a chart or a UI library wants a number.

## Numbers: the 15-digit rule

A JS number is accepted as input, but only where it says exactly one decimal. ducat reads a number at its shortest decimal form, the digits `String(n)` prints, which is the decimal the author most likely typed. For `Fixed`, a number is read at its shortest decimal form, and only when that has at most 15 significant digits, which a double always holds faithfully. So `fixed(0.1 + 0.2)` throws instead of becoming 0.30000000000000004: pass the decimal as a string, or give `{ scale, rounding }`. With a `scale`, input that has more decimals throws unless `rounding` is also given.

Fifteen is the precision every double keeps through a decimal round trip. Below it, the shortest form of a number is exactly what was written. Beyond it, a number may already be the nearest double to something else, and reading it would mean guessing. Refusing it is the only answer that can't be wrong, and a decimal string is always available.

A string is the recommended form, and for a `Fixed` a string keeps its own scale (`fixed('12.30')` is 12.30, not 12.3). Rates are the same: write them as decimal strings, with every digit the source published. A JS number is read at its shortest decimal form, so it is exact as well, but a string says what was meant.

## The decimal-string grammar is strict on purpose

`money()`, `fixed()`, `ratio()` and every other place that takes an amount or a factor as a string accept exactly one grammar: an optional sign, digits, an optional point followed by digits, and an optional exponent. `'.5'`, `'5.'`, `'-.5'`, grouping (`'1,000'`, `'1_000'`), other scripts' digits and surrounding whitespace are refused with a `SyntaxError`, because each is more often a truncated or mangled value than a deliberate one. A comma in `'1,000'` might be a thousands separator or a decimal point, depending on who wrote it. A decimal string from another locale can parse as 100 times the amount, which is one of the silent errors other libraries make.

Exponents are accepted because they're unambiguous and other systems write them: `String(1e-7)`, Java's `BigDecimal.toString()` and Python's `str(Decimal)` all do. The exponent is at most 1000 either way, and so is the number of decimal places once it is applied.

Text as people write it, with grouping, symbols or another locale's separators, is a different problem, and `parse()` solves it with the locale stated: it never guesses the currency or the separators.

## Rates keep the digits they were given

A rate is an exact rational, and it also keeps the digits it was given: `exchangeRate('EUR', 'HUF', '363.90').toString()` is `'363.90'`. Trailing zeros carry no value, but they carry provenance. They say how precisely the source quoted the rate, and an audit compares rates digit for digit with the published table. That is also why the ECB Data Portal parser rebuilds the trailing zeros the feed strips (`147.2` for 147.20) from each series' `DECIMALS` attribute. Inverses and chains stay exact as rationals (`eurUsd.inverse()` is `'2000/2233'`, not 0.8956...), so nothing is rounded until an amount is converted.

## Leaving exactness on purpose

Sometimes a float is the right output: a chart, a PDF, an API that takes numbers. `toNumber(m)` gives the amount in major units as the nearest double, and `toMinorNumber(m, { lossy: true })` the minor units as the nearest double instead of throwing beyond 2^53. Both are lossy on purpose and named so; ducat never uses them itself, and arithmetic on the result loses the exactness. Each rounds once, so `toNumber` of 100000 at scale 18 is 100000, not the 99999.99999999999 of dividing by 10^18 as a float. `Fixed#toNumber()` is the same named exit for a `Fixed`.

The one place a double touches an amount inside ducat is the display hand-off to `Intl.NumberFormat`, below 10^15 minor units, where a single correctly rounded division is bit-identical to `Number(decimalString)` (property-tested). The details are in [About the representation](representation.md).

## Allocation is exact

The parts always sum to the whole, and the remainder is distributed deterministically. A Lean model of it is proved for every remainder strategy, and the TypeScript is checked against that model (see [What is proved](proofs.md)) and property-tested with weights up to 2^40 and amounts up to 10^25.

## Currency mismatch

Exactness covers currencies too. Currency mismatch is a compile-time error for literal currency types (`add(eur, usd)`, `sum([eur, usd])`, `compare`, `exchangeRate(...).convert`). When types are erased (`Money<string>`) it is a runtime `CurrencyMismatchError`. `equals()` across currencies returns `false`. Adding euros to dollars has no exact answer without a rate, so ducat refuses it rather than produce a number with a currency attached.
