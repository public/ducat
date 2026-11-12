# Where money arithmetic goes wrong

Most money bugs come from a short list of mistakes: a float where a decimal was meant, a rounding step nobody chose, an intermediate value that quietly overflows. This page goes through them one class at a time. Each section says why it happens, shows a JavaScript library that does it today, with the wrong result it really returns, and shows what ducat does instead.

Every wrong result here was taken from ducat's [comparison battery](https://github.com/public/ducat/blob/main/compare/results/battery.json) (each row's `got` field, by vector id), from the linked issue, or by running the snippet against the version named above it. The versions are those in [`compare/package.json`](https://github.com/public/ducat/blob/main/compare/package.json). Several of these behaviours are documented design choices rather than bugs, and the page says so where they are. Where a mistake can happen with ducat too, or where ducat's strictness costs you something, it says that as well.

Each class has a regression test in ducat's suite: [`test/other-libs.test.ts`](https://github.com/public/ducat/blob/main/test/other-libs.test.ts) for the money libraries and [`test/decimal-libs.test.ts`](https://github.com/public/ducat/blob/main/test/decimal-libs.test.ts) for the decimal libraries. [How ducat compares](comparison.md) has the battery's totals per library.

## Floats in, floats out

A JavaScript number is a binary fraction, so `0.1`, `1.15` and most other decimal amounts are stored as the nearest double, and arithmetic on them rounds again in binary. A library that accepts floats keeps the error, or rounds it in a direction you can't see.

The decimal libraries accept a float and keep its error ([battery](https://github.com/public/ducat/blob/main/compare/results/battery.json) vector `float-in`, the same for big.js, bignumber.js, decimal.js-light and Prisma's `Decimal`):

```js
// decimal.js 10.6.0
import Decimal from 'decimal.js';

new Decimal(0.1 + 0.2).toString(); // → '0.30000000000000004'
```

js-money, ts-money and @screeny05/ts-money multiply minor units by a float, so 0.50 × 1.15 (exactly 0.575) is 57.49999999999999 cents before the rounding function sees it. Passing a correct rounding function doesn't help (vector `float-mul-1.15`):

```js
// ts-money 0.4.8
import { Money } from 'ts-money';

new Money(50, 'EUR').multiply(1.15, Math.round).amount; // → 57
```

ducat reads a number at its shortest decimal form, so `0.1 + 0.2` is 0.30000000000000004, which has more decimals than EUR and is refused unless you say how to round. A factor is used at its decimal digits:

```ts
import { money } from '@ducatjs/money';

money(0.1 + 0.2, 'EUR'); // throws RangeError (0.30000000000000004 has 17 decimals)
money('0.50', 'EUR').multiply('1.15'); // → 0.58 EUR
money('0.50', 'EUR').multiply(1.15); // → 0.58 EUR (read as its shortest form, 1.15)
```

**What to do instead.** Pass amounts and factors as decimal strings. If a value really is a float with more digits than the currency has, say how to round it: `money(0.1 + 0.2, 'EUR', { rounding: 'halfExpand' })`.

**Where ducat shares the risk.** A number like `17.955` is read as its shortest decimal form, 17.955, not as the double it stands for (17.954999…). That is usually what the writer meant, but it is a choice: if the number came out of float arithmetic, the error happened before ducat saw it. The [exactness explanation](exactness.md) has the rules.

## Scaling a decimal through a float

Turning major units into minor units by multiplying by 100 goes through a float too: `78.43 * 100` is `7843.000000000001`, and `1.005 * 100` is `100.49999999999999`.

js-money 0.6.3 checks that the result is an integer, so ordinary prices throw ([js-money #10](https://github.com/davidkalosi/js-money/issues/10), [#28](https://github.com/davidkalosi/js-money/issues/28)); ts-money 0.4.8 rounds the product, which fixes 78.43 but rounds 1.005 down ([ts-money #1](https://github.com/macor161/ts-money/issues/1)):

```js
// js-money 0.6.3
import Money from 'js-money';

Money.fromDecimal(78.43, 'EUR'); // throws TypeError: Amount must be an integer
```

```js
// ts-money 0.4.8
import { Money } from 'ts-money';

Money.fromDecimal(1.005, 'EUR', Math.round).amount; // → 100
```

The double nearest 1.005 is a little below it, so 100 is the right rounding of that double; it is not the right rounding of the 1.005 that was written. ducat moves the decimal point in the digits, never by multiplying:

```ts
import { money } from '@ducatjs/money';

money('78.43', 'EUR'); // → 78.43 EUR
money('1.005', 'EUR', { rounding: 'halfExpand' }); // → 1.01 EUR
money('1.005', 'EUR'); // throws RoundingError: three decimals for a two-decimal currency
```

## Rounding at every step, and a default you didn't choose

Every operation that returns an amount at the currency's scale has to round, so a chain of operations rounds once per step, and the errors add up. Which way each step rounds is set by a default that is easy not to notice.

dinero.js 1.9.1 rounds 99.99 ÷ 119 to the cent before multiplying by 100 ([dinero.js #177](https://github.com/dinerojs/dinero.js/issues/177)). Its `multiply` and `divide` round half to even by default, which is documented, while its `toFormat` documentation described half away from zero, so 50 × 0.0605 = 3.025 became 3.02 ([dinero.js #157](https://github.com/dinerojs/dinero.js/issues/157)):

```js
// dinero.js 1.9.1
import Dinero from 'dinero.js';

Dinero({ amount: 9999 }).divide(119).multiply(100).getAmount(); // → 8400
Dinero({ amount: 5000 }).multiply(0.0605).getAmount(); // → 302
```

**This applies to ducat's `Money` too.** It rounds each step to the cent, as dinero.js does. To round once, keep the intermediate value exact with `@ducatjs/money/exact` and round at the end. ducat's default mode is half away from zero (`'halfExpand'`), and every operation that rounds takes a mode:

```ts
import { money } from '@ducatjs/money';
import { exact } from '@ducatjs/money/exact';

money('99.99', 'EUR').divide(119).multiply(100); // → 84.00 EUR (rounded at each step)
exact(money('99.99', 'EUR')).divide(119).multiply(100).round(); // → 84.03 EUR
money('50', 'EUR').multiply('0.0605'); // → 3.03 EUR
money('50', 'EUR').multiply('0.0605', 'halfEven'); // → 3.02 EUR
```

decimal.js and decimal.js-light round every result to a configured number of significant digits, 20 by default, even when adding (big.js and bignumber.js add exactly). That is documented (`Decimal.precision`), and easy to forget when amounts get long:

```js
// decimal.js 10.6.0
import Decimal from 'decimal.js';

new Decimal('100.000000000000000000').add('0.000000000000000001').toString(); // → '100'
```

ducat's `Fixed` adds, subtracts and multiplies exactly at any size:

```ts
import { fixed } from '@ducatjs/money/fixed';

fixed('100.000000000000000000').add('0.000000000000000001'); // → 100.000000000000000001
```

A rounding that changes only what is shown is a step that never happened. currency.js's `increment` option rounds the formatted string and leaves the stored value alone; its documentation describes it as a display option, and [currency.js #365](https://github.com/scurker/currency.js/issues/365) is the confusion it causes:

```js
// currency.js 2.0.4
import currency from 'currency.js';

currency(10.02, { increment: 0.05 }).value; // → 10.02
currency(10.02, { increment: 0.05 }).format(); // → '$10.00'
```

ducat rounds the amount itself, so what is stored is what is shown:

```ts
import { money, roundToIncrement } from '@ducatjs/money/fn';
import '@ducatjs/money/iso';

roundToIncrement(money('10.02', 'CHF'), money('0.05', 'CHF')); // → 10.00 CHF
```

[About rounding](rounding.md) explains why ducat rounds explicitly, and [How to round to a policy](../how-to/round-to-a-policy.md#keep-intermediate-values-exact-and-round-once) shows rounding once at the end.

## Negative halves

`Math.round` rounds a half toward positive infinity, so `Math.round(2.5)` is 3 but `Math.round(-2.5)` is −2. A library built on it rounds a negative tie differently from its positive mirror.

currency.js 2.0.4 rounds 0.125 to 0.13 and −0.125 to −0.12 (vector `half-up-neg`; [currency.js #517](https://github.com/scurker/currency.js/issues/517), open). money-math 2.6.3 gives −0.11 for −0.25 × 0.50, which is not a tie rule at all (vector `half-up-neg`):

```js
// currency.js 2.0.4
import currency from 'currency.js';

currency(0.125).toString(); // → '0.13'
currency(-0.125).toString(); // → '-0.12'
```

```js
// money-math 2.6.3
import moneyMath from 'money-math';

moneyMath.mul('-0.25', '0.50'); // → '-0.11'
```

ducat's half modes are symmetric unless their name says otherwise (`'halfCeil'` and `'halfFloor'` lean one way on purpose):

```ts
import { money } from '@ducatjs/money';

money('0.25', 'EUR').multiply('0.5'); // → 0.13 EUR
money('-0.25', 'EUR').multiply('0.5'); // → -0.13 EUR
money('-0.25', 'EUR').multiply('0.5', 'halfEven'); // → -0.12 EUR
```

## Allocation that loses or invents a cent

Splitting an amount means dividing, rounding each part and then handing out what is left over. Get the sign of the remainder wrong and a cent disappears; hand remainders out without looking at the weights and a part that should get nothing gets a cent.

monetra 2.3.0 splits −100.00 three ways into −33.33 three times, which sums to −99.99 (vector `split3-neg`). js-money 0.6.3 and ts-money 0.4.8 give a remainder cent to a part whose weight is zero ([js-money PR #5](https://github.com/davidkalosi/js-money/pull/5) and [ts-money PR #5](https://github.com/macor161/ts-money/pull/5), neither merged). @screeny05/ts-money 1.2.0 throws when asked to split one cent three ways (vector `split-cent`):

```js
// monetra 2.3.0
import { Money } from 'monetra';

const parts = Money.fromMajor('-100.00', 'EUR').split(3);
parts.map((part) => part.toDecimalString()); // → ['-33.33', '-33.33', '-33.33']
```

```js
// js-money 0.6.3
import Money from 'js-money';

new Money(1001, 'EUR').allocate([0, 1, 1]).map((part) => part.amount); // → [1, 500, 500]
```

```js
// @screeny05/ts-money 1.2.0
import { Money } from '@screeny05/ts-money';

new Money(1, 'EUR').allocate([1, 1, 1]); // throws TypeError: Cannot read properties of undefined (reading 'amount')
```

Which part gets the remainder is a choice, not a bug, as long as the parts add up: dinero.js 1.9.1 gives it to the first parts, and dinero.js 2.0.2 gives it to the largest fractional shares ([dinero.js #776](https://github.com/dinerojs/dinero.js/issues/776)). ducat's parts always sum to the whole, a zero weight always gets zero, a negative amount is the mirror of the positive one, and the remainder goes to the parts with the largest fractional remainders (Hamilton's method) unless you pick another strategy:

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/allocate';

money('-100', 'EUR').split(3); // → [-33.34 EUR, -33.33 EUR, -33.33 EUR]
money('10.01', 'EUR').allocate([0, 1, 1]); // → [0.00 EUR, 5.01 EUR, 5.00 EUR]
money('0.01', 'EUR').split(3); // → [0.01 EUR, 0.00 EUR, 0.00 EUR]
```

[How to split and allocate](../how-to/split-and-allocate.md#split-evenly-or-by-weights) lists the remainder strategies.

## Intermediate products that overflow

An allocation computes `amount × weight ÷ total`. Even when every input and every output is a safe integer, the product in the middle can pass 2⁵³ and be rounded as a double.

dinero.js 2.0.2's number calculator splits 3 cents by these weights into 3, 0 and 0; the exact shares are 1.99…, 0.66… and 0.33…, so the right answer is 2, 1 and 0 ([dinero.js #892](https://github.com/dinerojs/dinero.js/issues/892), open). Its bigint calculator (`dinero.js/bigint`) returns 2, 1 and 0 for the same weights:

```js
// dinero.js 2.0.2
import { allocate, dinero, toSnapshot } from 'dinero.js';
import { USD } from 'dinero.js/currencies';

const weights = [3002399751580333, 1000000000000000, 501199875790167];
allocate(dinero({ amount: 3, currency: USD }), weights).map((part) => toSnapshot(part).amount); // → [3, 0, 0]
```

ducat computes the shares exactly:

```ts
import { allocate, fromMinor } from '@ducatjs/money/fn';
import '@ducatjs/money/iso';

allocate(fromMinor(3, 'USD'), [3002399751580333, 1000000000000000, 501199875790167]); // → [0.02 USD, 0.01 USD, 0.00 USD]
```

## Amounts past 2⁵³ minor units

A JavaScript number holds every integer exactly only up to 2⁵³ (9,007,199,254,740,992). In cents that is about 90 trillion: more than most businesses handle, but not more than a national budget, a crypto token in its smallest unit, or a total in a currency with many minor units per dollar.

Past it, libraries that keep minor units in a number are silently wrong. currency.js 2.0.4, js-money 0.6.3 and both ts-money packages turn 90,071,992,547,409.93 into …409.94 (vector `big-2^53+1`). dinero.js 2.0.2's number calculator adds a cent to 90,071,992,547,409.92 and gets …409.92 (vector `big-add`); dinero.js 2 also ships a bigint calculator (`dinero.js/bigint`), which gets these right:

```js
// currency.js 2.0.4
import currency from 'currency.js';

currency('90071992547409.93').toString(); // → '90071992547409.94'
```

```js
// js-money 0.6.3
import Money from 'js-money';

new Money(1e23, 'EUR').toString(); // → '999999999999999868928.00'
```

ducat keeps a number while the amount is safe and switches to a bigint beyond, without being asked:

```ts
import { money } from '@ducatjs/money';

money('90071992547409.93', 'EUR'); // → 90071992547409.93 EUR
money('90071992547409.92', 'EUR').add(money('0.01', 'EUR')); // → 90071992547409.93 EUR
money('1000000000000000000000', 'EUR'); // → 1000000000000000000000.00 EUR
```

[About the representation](representation.md) explains the number and bigint paths.

## 32-bit truncation

JavaScript's bitwise operators (`~~x`, `x | 0`) truncate to a signed 32-bit integer, so they are wrong above 2,147,483,647.

currency.js 2.0.4 uses `~~` in `dollars()` and `cents()`. The stored value is intact; only those two accessors are wrong ([currency.js #226](https://github.com/scurker/currency.js/issues/226), closed, still in 2.0.4):

```js
// currency.js 2.0.4
import currency from 'currency.js';

currency('3000000000.50').value; // → 3000000000.5
currency('3000000000.50').dollars(); // → -1294967296
```

ducat's `majorPart` and `minorPart` give the whole units and the minor units:

```ts
import { majorPart, minorPart, money } from '@ducatjs/money/fn';
import '@ducatjs/money/iso';

majorPart(money('3000000000.50', 'EUR')); // → 3000000000
minorPart(money('3000000000.50', 'EUR')); // → 50
```

## Minor and major units mixed up

A bare number doesn't say whether it means 1 euro or 1 cent. When a library lets the same number mean either, depending on a flag set somewhere else, a cent becomes a euro.

currency.js's `fromCents` option belongs to the value, so it also applies to the plain numbers later passed to `add` and `subtract`: 4.51 minus 1 is 4.50 ([currency.js #425](https://github.com/scurker/currency.js/issues/425), [#318](https://github.com/scurker/currency.js/issues/318) and [#319](https://github.com/scurker/currency.js/issues/319), open):

```js
// currency.js 2.0.4
import currency from 'currency.js';

currency(451, { fromCents: true }).subtract(1).toString(); // → '4.50'
```

ducat has a separate constructor for each unit, and its operations take Money, never a bare number of either unit:

```ts
import { fromMinor, money } from '@ducatjs/money';

fromMinor(451, 'EUR').subtract(money('1', 'EUR')); // → 3.51 EUR
fromMinor(451, 'EUR').subtract(fromMinor(1, 'EUR')); // → 4.50 EUR
fromMinor(10.5, 'EUR'); // throws RangeError: minor units are whole
```

When you store or send amounts, name the unit in the column or field. [How to store money in a database](../how-to/store-money-in-a-database.md#choose-a-column-layout) compares the layouts, and [How to send amounts to payment processors](../how-to/send-amounts-to-payment-processors.md) covers each processor's unit.

## Currencies with other exponents, and cash rounding

Not every currency has two decimals: JPY has none, KWD has three, CLF has four. A library that assumes two, or makes the caller supply the number, gets these wrong as soon as the caller forgets.

dinero.js 1.9.1 has no exponent table and takes a `precision` that defaults to 2 for every currency, so 500 yen built without it print as five yen ([dinero.js #203](https://github.com/dinerojs/dinero.js/issues/203) is the same output with the precision given). That is documented; it is still easy to miss. currency.js 2.0.4 has no currencies at all, and with the precision supplied rounds a fractional yen without saying so (vector `jpy-frac`). monetra 2.3.0 and js-money 0.6.3 have no CLF (vector `exp-CLF`):

```js
// dinero.js 1.9.1
import Dinero from 'dinero.js';

Dinero({ amount: 500, currency: 'JPY' }).toFormat(); // → '¥5.00'
Dinero({ amount: 500, currency: 'JPY', precision: 0 }).toFormat(); // → '¥500.00'
```

```js
// currency.js 2.0.4
import currency from 'currency.js';

currency('1000.5', { precision: 0 }).toString(); // → '1001'
```

dinero.js 2 keeps 1000.5 JPY at scale 1 instead (vector `jpy-frac`): a documented design that keeps every digit and leaves rounding to the caller. ducat knows every ISO 4217 exponent and refuses a fraction the currency doesn't have unless you say how to round it:

```ts
import { money } from '@ducatjs/money';

money('500', 'JPY'); // → 500 JPY
money('1.234', 'KWD'); // → 1.234 KWD
money('1000.5', 'JPY'); // throws RoundingError
money('1000.5', 'JPY', { rounding: 'halfExpand' }); // → 1001 JPY
```

Cash is another exponent again: a Swiss price is in rappen, but coins go down to 0.05 CHF. None of the other money libraries measured has per-country cash rules (currency.js's `increment`, above, rounds only the display); [How to round cash payments](../how-to/round-cash.md#round-a-cash-amount) shows ducat's rules, and [How to use other currencies](../how-to/use-other-currencies.md) covers codes ISO doesn't list.

## The case of currency codes

ISO 4217 codes are upper case, but `Intl` accepts `usd`, so lower-case codes slip in from user input and old data. If a library compares codes as strings, `usd` and `USD` are two currencies.

dinero.js 1.9.1 formats `usd` as dollars but won't add it to `USD` ([dinero.js #637](https://github.com/dinerojs/dinero.js/issues/637)):

```js
// dinero.js 1.9.1
import Dinero from 'dinero.js';

Dinero({ amount: 100, currency: 'usd' }).toFormat(); // → '$1.00'
Dinero({ amount: 100, currency: 'usd' }).equalsTo(Dinero({ amount: 100, currency: 'USD' })); // → false
```

ducat rejects a code it doesn't know, lower-case ones included, when the amount is created:

```ts
import { money } from '@ducatjs/money';

money('1', 'usd' as string); // throws RangeError: Unknown currency "usd"
```

## Negative zero

IEEE doubles have a −0, and rounding a small negative amount can produce it. It compares equal to 0 but prints as `-0.00`.

dinero.js 1.9.1 multiplies −1 cent by 0.4 and formats the result as minus zero dollars. decimal.js prints `-0.00` for −0.001 to two places, as `Number#toFixed` does, which is consistent with JavaScript but rarely what a receipt wants:

```js
// dinero.js 1.9.1
import Dinero from 'dinero.js';

Dinero({ amount: -1 }).multiply(0.4).toFormat(); // → '-$0.00'
```

```js
// decimal.js 10.6.0
import Decimal from 'decimal.js';

new Decimal(-0.001).toFixed(2); // → '-0.00'
```

ducat has no negative zero: a result that rounds to zero is zero.

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/format';

money('-0.004', 'EUR', { rounding: 'halfExpand' }); // → 0.00 EUR
money('-0.01', 'EUR').multiply('0.4').format('en-US'); // → '€0.00'
```

## Is zero positive?

Zero is neither positive nor negative, but a test written as `amount >= 0` says otherwise, and code that branches on "positive" then charges or refunds nothing.

dinero.js 1.9.1's `isPositive` returns true for zero, as its documentation says; dinero.js 2 changed it to false ([dinero.js #728](https://github.com/dinerojs/dinero.js/pull/728)). decimal.js 10.6.0 follows signed zero, so `isPositive` is true for 0 and `isNegative` true for −0:

```js
// dinero.js 1.9.1
import Dinero from 'dinero.js';

Dinero({ amount: 0 }).isPositive(); // → true
```

```js
// decimal.js 10.6.0
import Decimal from 'decimal.js';

new Decimal(0).isPositive(); // → true
```

In ducat, zero has sign 0:

```ts
import { money } from '@ducatjs/money';

money('0', 'EUR').isPositive(); // → false
money('0', 'EUR').isNegative(); // → false
money('0', 'EUR').sign(); // → 0
```

## Formatting that drops decimals or misplaces symbols

A format mask written by hand has to know each currency's decimals and each locale's symbol position. Masks that don't match what the library expects fail quietly.

dinero.js 1.9.1's `toFormat` doesn't recognise a mask with the symbol after the number, and prints a rounded integer with no symbol ([dinero.js #774](https://github.com/dinerojs/dinero.js/issues/774)); with the default mask it prints yen with two decimals (above, and [dinero.js #203](https://github.com/dinerojs/dinero.js/issues/203)):

```js
// dinero.js 1.9.1
import Dinero from 'dinero.js';

Dinero({ amount: 1051, currency: 'EUR' }).setLocale('de-DE').toFormat('0,0.00 $'); // → '11'
```

ducat formats with `Intl.NumberFormat`, which knows the currency's decimals and where the locale puts the symbol, and passes it the exact decimal string:

```ts
import { fromMinor, money } from '@ducatjs/money';
import '@ducatjs/money/format';

money('10.51', 'EUR').format('de-DE'); // → '10,51 €'
fromMinor(500, 'JPY').format('en-US'); // → '¥500'
```

[How to format amounts](../how-to/format-amounts.md#format-in-a-locale) covers symbols, digits and parts.

## Lenient parsing that misreads input

A parser that strips what it doesn't recognise turns junk into a number, and one that treats the other locale's decimal mark as a grouping separator multiplies the amount by 100.

currency.js 2.0.4 strips letters ([currency.js #184](https://github.com/scurker/currency.js/issues/184), open), reads an empty string as zero, returns `NaN` for exponent notation it can't read, and with a comma as the decimal mark reads `78.00` as 7,800 ([currency.js #390](https://github.com/scurker/currency.js/issues/390)):

```js
// currency.js 2.0.4
import currency from 'currency.js';

currency('123.sd').toString(); // → '123.00'
currency('').toString(); // → '0.00'
currency('1e-7').toString(); // → 'NaN'
currency('2.443233038698408e+21').toString(); // → '2.44'
currency('78.00', { separator: '.', decimal: ',' }).toString(); // → '7800.00'
```

ducat's `money()` takes a strict decimal grammar, exponents included, and `parse()` requires group separators where the locale puts them:

```ts
import { money } from '@ducatjs/money';
import { parse } from '@ducatjs/money/parse';

money('123.sd', 'EUR'); // throws SyntaxError
money('', 'EUR'); // throws SyntaxError
money('1e-7', 'EUR'); // throws RoundingError (read exactly: too many decimals for EUR)
money('2.443233038698408e+21', 'EUR'); // → 2443233038698408000000.00 EUR
parse('78.00', 'EUR', 'de-DE'); // throws SyntaxError
parse('1.234,56', 'EUR', 'de-DE'); // → 1234.56 EUR
parse('1.5', 'EUR', 'de-DE', { lenient: true }); // → 15.00 EUR (asked for: see below)
```

**Where ducat shares the risk.** `parse(text, currency, locale, { lenient: true })` accepts looser grouping, and with it `parse('1.5', 'EUR', 'de-DE', { lenient: true })` is 15.00 EUR, the same misreading. Use it only for input a person checks. [How to parse amounts people type](../how-to/parse-user-input.md#parse-text-formatted-for-a-locale) has the details.

## Conversions at the wrong scale

A rate has more decimals than either currency, so a conversion's exact result has more decimals than the target currency. If the library keeps them, the caller has to remember to round; if it rounds at the source currency's scale, the result is wrong for the target.

dinero.js 2.0.2 keeps the full scale: 1.234 KWD at 485.123 is 598.641782 JPY, at scale 6. This is its documented design, and `transformScale` brings the result to the currency's scale; until you call it, a yen amount has six decimals:

```js
// dinero.js 2.0.2
import { convert, dinero, toDecimal } from 'dinero.js';
import { JPY, KWD } from 'dinero.js/currencies';

const yen = convert(dinero({ amount: 1234, currency: KWD }), JPY, {
  JPY: { amount: 485123, scale: 3 },
});
toDecimal(yen); // → '598.641782'
```

ducat's `convert` lands on the target currency's scale by default, rounding once with the mode you give (half away from zero by default):

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/convert';

money('1.234', 'KWD').convert('JPY', '485.123'); // → 599 JPY
money('1000', 'JPY').convert('KWD', '0.00206'); // → 2.060 KWD
```

If you need the unrounded result, or the residual to book, see [How to convert currencies](../how-to/convert-currencies.md#book-the-rounding-residual).

## Not covered here

Two classes from other libraries' trackers are left out because the installed versions don't reproduce them:

- **Catastrophic backtracking in a format mask.** [dinero.js #837](https://github.com/dinerojs/dinero.js/issues/837) reported it against dinero.js 1's `toFormat`; the maintainers pointed out that v2 removed the mask parser. The report's own input formats in milliseconds on 1.9.1 here.
- **Values that only look like money.** Checks by shape rather than by class, and `instanceof` across two installed copies of a package, are a known hazard, but this page has no reproduced example of a wrong result from one. ducat's `isMoney` is also `false` for Money from a second installed copy; it ships a single ES module build so that one install doesn't have two copies (see [Decisions](decisions.md)).
