<p align="center"><img src="https://raw.githubusercontent.com/public/ducat/main/assets/logo.png" width="128" height="128" alt="A gold ducat of Doge Francesco Foscari, 1423–1457"></p>
<p align="center"><sub>Gold ducat of Francesco Foscari, Venice, 1423–1457. Photo: Francesco Bini, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, via Wikimedia Commons (<a href="assets/CREDITS.md">credits</a>).</sub></p>

# ducat

[![CodSpeed](https://img.shields.io/endpoint?url=https://codspeed.io/badge.json)](https://app.codspeed.io/public/ducat?utm_source=badge)

An exact, fast, typed Money type for TypeScript. It has zero runtime dependencies and runs on Node, Bun, Deno and browsers.

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/allocate'; // opt-in modules add their methods to Money
import '@ducatjs/money/tax';
import '@ducatjs/money/convert';
import '@ducatjs/money/format'; // or import '@ducatjs/money/all' for everything

const price = money('19.99', 'EUR'); // Money<'EUR'>
const total = price.add(money('5.01', 'EUR')); // → 25.00 EUR
total.multiply('1.075'); // → 26.88 EUR (26.875 rounds half away from zero by default)
total.multiply('1.075', 'halfEven'); // → 26.88 EUR (any of 9 modes, or 'unnecessary' to throw)
money('100', 'EUR').allocate([1, 1, 1]); // → [33.34 EUR, 33.33 EUR, 33.33 EUR] (sums to 100.00, always)
money('12', 'GBP').extractTax(20); // → { net: 10.00 GBP, tax: 2.00 GBP, gross: 12.00 GBP }
total.convert('JPY', '162.457'); // → 4061 JPY
total.format('de-DE'); // → '25,00 €'
price.add(money('1', 'USD')); // compile error, and throws if types are erased
```

Operations are methods on `Money`. For pipelines or code that prefers plain functions, `@ducatjs/money/fn` has each of them as a function of the same name (`add(price, fee)`, `allocate(m, [1, 1, 1])`). The core (`@ducatjs/money`) holds construction, arithmetic, rounding, comparison and serialisation; everything else is an opt-in module, so a bundle only pays for what it imports (see [Modules](#modules)).

Status: 0.x. The API is meant to stay small, but until 1.0 a minor version may change it; the [changelog](CHANGELOG.md) lists every breaking change. See [What's missing](#whats-missing-honest-list).

---

## How it compares

The same 41 correctness vectors, the same benchmark and the same bundle snippet for every library. The details, the
other libraries' bugs, the fixed-point libraries and the money libraries in other languages are in
[docs/COMPARISON.md](docs/COMPARISON.md), regenerated from [compare/](compare) for each release.

| library                            | correct (of 41) | wrong, silently |       bundle (gzip) |
| ---------------------------------- | --------------: | --------------: | ------------------: |
| **ducat**                          |          **41** |           **0** |              3.7 kB |
| dinero.js 2 (bigint calculator)    |              34 |               0 |              1.8 kB |
| monetra                            |              34 |               3 |              4.5 kB |
| ts-money / js-money                |              31 |           7 / 6 |       30.7 / 8.8 kB |
| bigint-money                       |              30 |               0 |              1.5 kB |
| dinero.js 2 (number calculator)    |              30 |               4 |              1.8 kB |
| decimal.js / big.js / bignumber.js |              22 |               1 | 12.6 / 2.9 / 8.5 kB |
| currency.js                        |              16 |               6 |              1.3 kB |

- **Correct everywhere:** ducat is the only library that passes every vector, including amounts beyond 2⁵³ minor
  units, float traps and negative allocations.
- **Fastest on arithmetic:** with its methods API, it is the fastest money library on creating, parsing, add, multiply,
  allocate and toDecimal on Node, Bun and Deno, and on compare on Node and Deno. Against the fastest other money library
  the margin ranges from about 1.07× (compare on Node: 7.39 against 7.91 ns) to about 8.7× (allocate on Node: 48
  against bigint-money's 415 ns). Against dinero.js 2 it ranges from 1.6× (creating on Node) to about 30× (add on
  Bun). dinero.js 2 measured unexpectedly slow on Deno in this run (up to 6× slower than in the previous one, while
  every other library got faster), so its Deno numbers are left out of this range.
- **Where it isn't fastest:** formatting on Node and Deno, where currency.js (formatting a float) is 8% and 2% faster
  (on Bun, ducat and dinero.js 1 are level, 269 against 272 ns). On Bun, libraries that compare plain numbers are
  faster at compare (currency.js 6.9 against 10.6 ns).
- **Fixed-point decimals:** ducat is not the fastest fixed-point library. bigdecimal.js is faster on parse, multiply
  and divide, js-big-decimal on parse and `toString`, @formatjs/bigdecimal on parse on Node and Deno, and ethers on
  `toString`; see
  [docs/COMPARISON.md](docs/COMPARISON.md#fixed-point-decimal-libraries).
- **Not the smallest:** currency.js, bigint-money, dinero.js 2, @screeny05/ts-money, big.js and dinero.js 1 are smaller
  for the same snippet. ducat's core includes exact decimal parsing, bigint support and the ISO table; everything else
  is opt-in.
- **Measurement:** speed is from one quiet AMD EPYC Genoa vCPU, on ducat 0.1.0 (commit 69d7fe9) under Node 24.22.2,
  Bun 1.4.4 and Deno 2.9.8; sizes are gzipped KiB.

## Design

### Representation: integer minor units in a JS number, with a bigint fallback

A `Money<C>` has three readonly fields:

| field                     | meaning                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `currency: C`             | ISO 4217 code (or a code registered with `defineCurrency`). It is a type parameter, so `Money<'EUR'>` and `Money<'USD'>` don't mix.                                                                                                                                    |
| `minor: number \| bigint` | Integer count of 10^-scale units. It is a **number whenever it is a safe integer** (absolute value ≤ 2^53−1) and a **bigint only beyond that**. The invariant is enforced everywhere, so ordinary amounts never allocate a bigint and huge amounts never lose a digit. |
| `scale: number`           | Decimal places. Defaults to the currency's ISO exponent (EUR 2, JPY 0, KWD 3, CLF 4). It can be larger for sub-minor precision (unit prices, FX intermediates). `round()` brings it back.                                                                              |

Why this representation, based on `bench/designs.ts` (the same seven operations written four ways and run on five engines; full tables in [bench/RESULTS.md](bench/RESULTS.md)):

| ns/op, indicative                    | **A: number + bigint fallback** | B: bigint everywhere |     C: decimal string | A + `Object.freeze` |
| ------------------------------------ | ------------------------------: | -------------------: | --------------------: | ------------------: |
| add (V8 / JSC)                       |               **12–34 / 16–24** |        25–31 / 38–59 |   806–838 / 1107–1275 |     124–173 / 67–73 |
| multiply by ratio + round (V8 / JSC) |               **23–37 / 16–19** |         49 / 223–262 |   415–444 / 1085–1506 |   145–246 / 115–124 |
| allocate into 3 (V8 / JSC)           |            **91–109 / 116–173** |    288–301 / 474–699 | 1122–1131 / 2250–4100 |   584–788 / 330–528 |
| compare (V8 / JSC)                   |                   **3–4 / 7–8** |       9.5–10 / 10–13 |    397–735 / 589–1034 |            5–11 / 4 |

- **bigint everywhere** is roughly 1.5–2x slower on V8 for add. On JSC it is **10–14x slower for multiply/divide**: JSC's bigint division is much slower than V8's, so a bigint-only design punishes Safari and Bun hardest. Every bigint op also allocates, and V8 can't keep bigints unboxed in object fields.
- **Decimal strings** are fast to store, parse and print, but every arithmetic op has to parse and re-print, which makes them 30–100x slower. They are good as a wire format, not as an in-memory one.
- **number + bigint fallback** is the fastest on every engine. Integer results are exact as long as they stay at or below 2^53: we check the result (`|r| ≤ MAX_SAFE_INTEGER`) and take the bigint path otherwise. The rounding argument for that check is in `src/money.ts`. Once an amount crosses 2^53 the fallback costs about 3–5x on add and 10–20x on multiply, but that only happens for amounts above 90 trillion minor units.
- **`Object.freeze` costs 5–8x on construction and add** on V8 and SpiderMonkey, and about 3x on JSC. Values are therefore _not_ frozen. Immutability comes from `readonly` fields, an API with no mutators, and a non-exported constructor, so `new Money()` can't be called from outside the library. `Symbol.toPrimitive` throws on numeric coercion, so `a + b`, `a > b` and `+a` fail loudly instead of doing float math. Template strings still work (`"12.34 EUR"`).

Engine notes (V8 vs JSC vs SpiderMonkey):

- JSC (Bun/Safari) applies escape analysis to `new Money(...)` in tight loops, which gives 0.7 ns "construction". This is an artefact of how the loop is shaped, not the real cost; V8 and SpiderMonkey sit at 15–80 ns.
- All three keep Smi/double fields unboxed when the field type is stable. A field that holds both numbers and bigints generalises once to "tagged", which we accept: the bigint case is rare.
- Engines handle `Intl.NumberFormat` differently in two ways:
  - **Default currency digits:** V8 uses CLDR digits, so ALL, IQD, RSD and LAK show 0 decimals. JSC uses the ISO digits. We always set the digits explicitly from the value's scale (a test covers every ISO code).
  - **Decimal-string input:** formatting a string is slower than formatting a double on every engine. Below 10^15 minor units we pass `minor / 10^scale`, a single correctly rounded division that is bit-identical to `Number(decimalString)` (property-tested). This display hand-off is the only place a double touches an amount. Larger values go to Intl as an exact decimal string; that path needs Node 19+, Safari 15.4+ or Firefox 116+, and Node 18 loses digits beyond 2^53 there.
- Hot paths avoid allocation:
  - `parse` (`money('12.34','EUR')`) uses a hand-rolled character loop with no regex and no bigint for inputs of 15 digits or fewer.
  - Ratios like `'1.075'` are parsed once and cached. You can also pre-build them with `ratio()`.
  - `allocate` uses a number fast path with in-place selection instead of a sort.

### Correctness rules

- **No float arithmetic on amounts.** Factors, rates and percentages are exact rationals (`ratio('1.075')`, `ratio(1, 3)`, `'1/3'`, bigint, integer). A JS number factor such as `0.1` is read at its shortest decimal form (`"0.1"`, exactly 1/10) and never multiplied as a float. `money(0.1 + 0.2, 'EUR')` **throws**: `0.30000000000000004` has too many decimals, and we don't silently turn it into 0.30.
- **Rounding is never hidden in the representation.** Every operation that may need to round takes a `RoundingMode`. Arithmetic defaults to `'halfExpand'` (ties away from zero, the most common default; see [Decisions](#decisions)); pass `'unnecessary'` to throw `RoundingError` instead. Parsing never rounds by default: `money('1.005', 'EUR')` throws.
- **Allocation is exact.** The parts always sum to the whole, and the remainder is distributed deterministically. A Lean model of it is proved for every remainder strategy, and the TypeScript is checked against that model (see [What is proved](#what-is-proved)) and property-tested with weights up to 2^40 and amounts up to 10^25.
- **Currency mismatch** is a compile-time error for literal currency types (`add(eur, usd)`, `sum([eur, usd])`, `compare`, `exchangeRate(...).convert`). When types are erased (`Money<string>`) it is a runtime `CurrencyMismatchError`. `equals()` across currencies returns `false`.

---

## API

### Modules

| import                              | adds to `Money`                                                    | also exports                                                   |
| ----------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| `@ducatjs/money`                    | the core: arithmetic, rounding, comparison, `toDecimal`, `toJSON`… | `money`, `fromMinor`, `zero`, `sum`, `fromJSON`, ISO exponents |
| `@ducatjs/money/allocate`           | `allocate`, `split`, `instalments`, `schedule`, `chunk`            | the same as plain functions                                    |
| `@ducatjs/money/tax`                | `percentage`, `discount`, `addTax`, `extractTax`                   | the same                                                       |
| `@ducatjs/money/convert`            | `convert`                                                          | `exchangeRate`, providers, `bag`, `comparator`…                |
| `@ducatjs/money/exact`              | `exact`                                                            | `ExactMoney`, `sumExact`                                       |
| `.../convert/ecb`                   | nothing                                                            | `parseEcbXml`, `parseEcbCsv`, `parseEcbSdmxCsv`                |
| `.../convert/history`               | nothing                                                            | `rateHistory`, `quotedTable`, `rateFromQuote`                  |
| `.../convert/boc`                   | nothing                                                            | `parseBankOfCanadaJson`                                        |
| `.../convert/fetch`                 | nothing                                                            | `fetchEcb`, `fetchEcbRange`, `fetchBankOfCanada` (network I/O) |
| `.../stripe-fx`, `adyen-fx`         | nothing                                                            | `stripeRate`, `stripeImpliedRate`, `adyenRate`                 |
| `@ducatjs/money/policy`             | nothing                                                            | `roundingPolicy`, `isoPolicy`, `assertScale`                   |
| `@ducatjs/money/cash`               | `cashRound`, `roundToIncrement`                                    | the same, `cashPolicy`, `cashRule`…                            |
| `@ducatjs/money/format`             | `format`, `formatToParts`                                          | the same                                                       |
| `@ducatjs/money/parse`              | nothing                                                            | `parse`                                                        |
| `@ducatjs/money/stripe`             | `toStripe`, `toStripeAmount`                                       | the same, `fromStripe`, `stripeExponent`…                      |
| `@ducatjs/money/adyen`              | `toAdyen`                                                          | the same, `fromAdyen`, `adyenExponent`…                        |
| `@ducatjs/money/checkout`           | `toCheckout`, `toCheckoutAmount`                                   | the same, `fromCheckout`, `checkoutExponent`…                  |
| `@ducatjs/money/paypal`             | `toPayPal`, `toPayPalValue`                                        | the same, `fromPayPal`, `paypalExponent`…                      |
| `@ducatjs/money/braintree`          | `toBraintree`                                                      | the same, `fromBraintree`, `braintreeExponent`…                |
| `@ducatjs/money/klarna`             | `toKlarna`                                                         | the same, `fromKlarna`, `klarnaExponent`…                      |
| `@ducatjs/money/prisma`             | `toDecimalValue`                                                   | the same, `fromDecimal`, the field helpers                     |
| `.../drizzle/pg`, `mysql`, `sqlite` | nothing                                                            | `moneyMinor`, `moneyDecimal`, `moneyJson` Drizzle columns      |
| `@ducatjs/money/pg`                 | nothing                                                            | `exactTypes`, `moneyTypeSql`, `toNumeric`, composite I/O       |
| `@ducatjs/money/fixed`              | `toFixedPoint`                                                     | `Fixed`, `fixed`, `fromScaled`, `isFixed`, `moneyToFixed`      |
| `@ducatjs/money/zod`                | nothing                                                            | `moneySchema`, `moneyJSONSchema` (Zod, an optional peer)       |
| `@ducatjs/money/valibot`            | nothing                                                            | `moneySchema`, `moneyJSONSchema` (Valibot, an optional peer)   |
| `@ducatjs/money/testing`            | nothing                                                            | matchers, value equality, snapshot serializer                  |
| `.../testing/vitest`, `/jest`       | nothing (installs on `expect`)                                     | the same, set up in one import                                 |
| `.../testing/arbitraries`           | nothing                                                            | `arbMoney`, `arbCurrency` (fast-check)                         |
| `@ducatjs/money/all`                | the methods of every module above                                  | everything except the database, schema and testing entries     |
| `@ducatjs/money/fn`                 | nothing                                                            | every operation as a plain function, core and modules          |

Importing a module (`import '@ducatjs/money/allocate'`, or any named import from it) installs its methods on `Money.prototype`, and its `declare module` augmentation makes them type-check. Without the import, `m.allocate()` is a compile error. The trade-off: the methods are installed for the whole program, so one import anywhere makes them available everywhere at run time, while TypeScript only knows about them in a program that includes the import. Import a module in each file that uses its methods: the import is cheap and installing twice is harmless, and it keeps working where files run in isolation (test runners, workers), where a single import in the entry point would leave `m.allocate` undefined at run time even though the code type-checks. Code that must not change any prototype (a library built on ducat, for example) can use the plain functions from `@ducatjs/money/fn` instead.

Your own module can add methods the same way:

```ts
import { extendMoney, money, type Money } from '@ducatjs/money';

declare module '@ducatjs/money' {
  interface Money<C extends string> {
    half(): Money<C>;
  }
}
extendMoney(
  {
    half(this: Money) {
      return this.divide(2);
    },
  },
  { owner: 'my-app/half' },
);
money('10', 'EUR').half(); // → 5.00 EUR
```

`extendMoney` refuses names Money already has (its own methods, or ones another module added) and the names every object inherits, so two modules can't silently fight over a name. Pass `{ owner: 'your-package/module' }` so that a second copy of the same module (hot reload, two installed copies) replaces its own methods instead of throwing.

The sections below list each operation with its plain-function signature, as `@ducatjs/money/fn` exports it; the method takes the same arguments without the first (`add(a, b)` is `a.add(b)`).

**Create**

- `money(amount: string | number | bigint, currency, { scale?, rounding? })`: the amount is in major units. A string is the recommended form. An integer number means major units (`money(12,'EUR')` is 12.00).
- `fromMinor(minor: number | bigint, currency, scale?)`: from cents, e.g. a BIGINT column.
- `zero(currency)`, `fromJSON({ amount, currency } | string)`, `isMoney(x)`
- `isMoneyIn(x, currency)` and `assertCurrency(m, currency)` narrow a currency known only at run time (`Money<string>`) to a literal one, without a cast. `assertCurrency` throws `CurrencyMismatchError` for another currency.

```ts
import { assertCurrency, fromJSON, isMoneyIn, money } from '@ducatjs/money';

const price = fromJSON({ amount: '12.34', currency: 'EUR' as string }); // Money<string>
if (isMoneyIn(price, 'EUR')) {
  price.add(money('1', 'EUR')); // → 13.34 EUR
}
assertCurrency(price, 'EUR'); // now Money<'EUR'>

const other = fromJSON({ amount: '1', currency: 'USD' as string });
assertCurrency(other, 'EUR'); // throws
```

**Arithmetic.** All of these are immutable and return new values.

- `add`, `subtract`, `sum(list, currency?)`, `negate`, `abs`
- `multiply(m, factor, rounding?)`, `divide(m, divisor, rounding?)`
- `round(m, rounding, scale = ISO exponent)`, `toScale(m, scale, rounding?)`
- `percentage(m, percent, rounding?)`, `discount(price, percent, rounding?)`
- `addTax(net, percent, rounding?)` and `extractTax(gross, percent, rounding?)` both return `{ net, tax, gross }`, and net + tax is always exactly gross.
- `convert(m, to, rate, rounding?, { scale? })` at a decimal-string rate, or `convert(m, exchangeRate(...), rounding?)`. See [Currency conversion](#currency-conversion).
- `m.with(operation)` applies a function to the amount and returns its result, so a rounding step or a conversion reads as one link of a chain.

```ts
import { money, type Money } from '@ducatjs/money';

const toFiveRappen = (value: Money<'CHF'>) => value.divide(5).round('halfExpand').multiply(5);
money('10.00', 'CHF').multiply('1.077').with(toFiveRappen); // → 10.75 CHF
```

**Compare**

- `compare` (returns −1, 0 or 1), `equals`, `lessThan`, `lessThanOrEqual`, `greaterThan`, `greaterThanOrEqual`
- `isZero`, `isPositive`, `isNegative`, `sign`, `min`, `max`, `clamp`
- `identical(a, b)`: like `equals`, but the scale must match too (`1.0` is not identical to `1.00`), for round-trip tests.

```ts
import { money } from '@ducatjs/money';

const one = money('1', 'EUR');
one.equals(money('1', 'EUR', { scale: 1 })); // → true
one.identical(money('1', 'EUR', { scale: 1 })); // → false
```

**Allocate and split**

- `allocate(m, weights, { remainder })`. Weights are integers, bigints or decimal strings (`'33.3'`). The remainder strategies:
  - `'largest'` (the default, Hamilton/largest remainder)
  - `'first'` and `'last'`, which spread one unit at a time
  - `'toFirst'` and `'toLast'`, which give the whole remainder to one bucket
  - Zero weights never receive anything. A negative amount is allocated as the mirror image of the positive one.
- `split(m, n, { remainder })`
- `instalments(total, n, { remainder: 'toFirst' | 'toLast' | 'first' | 'last', unit? })`. For example, 100/6 gives 16.70 then 5 × 16.66. With `unit: money('1','EUR')`, 100/3 gives 34.00, 33.00, 33.00.
- `schedule(total, [{ percent: 30 }, { amount: money('200','EUR') }, { percent: 50, cap: money('100','EUR') }, { rest: true }])`: a mix of fixed amounts, capped percentages and one rest tranche. It is exact and throws if the tranches don't cover the total.
- `chunk(total, max)`: capped tranches, e.g. 1000 with max 300 gives 300, 300, 300, 100.

**Rounding.** The `RoundingMode` strings are the same ones `Intl.NumberFormat` uses for its `roundingMode` option:

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

**Rounding policies** (`@ducatjs/money/policy`). A policy bundles a scale, an increment and a mode ("CHF cash", "4 decimals, half even") into one value that goes wherever a rounding mode goes: `multiply`, `divide`, `round`, `percentage`, `discount`, `addTax`, `extractTax`. The result is rounded once, straight to the policy, so it never rounds twice through the amount's own scale. A policy is also a function that rounds an amount, so `amounts.map(policy)` and `m.with(policy)` work.

- `roundingPolicy({ scale?, increment?, rounding?, currency? })`. The scale defaults to the currency's exponent, the increment (counted in 10^-scale units) to 1, and the mode to `'halfExpand'`. With `currency`, the policy refuses amounts in other currencies.
- `isoPolicy`: the currency's exponent, half up.
- `cashPolicy(currency, { country?, rounding?, includeUnverified? })`, from `@ducatjs/money/cash`, is the cash-rounding rule as a policy, for that currency only. It throws when no rule applies. Unlike `cashRound`, which keeps a larger scale (10.034 CHF gives 10.050), a policy always returns its own scale (10.05).
- `assertScale(m, policy)` throws a `RangeError` unless `m` is already at the policy's scale and on its increment, for example before an amount is booked.
- The tax functions apply a policy to the amount they compute: the **gross** for `addTax` (the amount charged), the **net** for `extractTax`, and the **discounted price** for `discount`. The other part is the exact difference, so net + tax is still exactly gross. With a plain rounding mode, `addTax` and `discount` round the tax and the discount amount, as before.

Policies are passed explicitly, never stored on amounts or set globally. Only policies built by this copy of the package are accepted. A lookalike function, or a policy from a second installed copy of ducat, throws a `TypeError`, just as `isMoney` rejects the other copy's Money.

```ts
import { money } from '@ducatjs/money';
import { assertScale, isoPolicy, roundingPolicy } from '@ducatjs/money/policy';
import { cashPolicy } from '@ducatjs/money/cash';

money('10.00', 'CHF').multiply('1.077', cashPolicy('CHF')); // → 10.75 CHF
const unitPrice = roundingPolicy({ scale: 4, rounding: 'halfEven' });
money('10.00', 'EUR').divide(3, unitPrice); // → 3.3333 EUR
[money('1.234', 'EUR', { scale: 3 })].map(isoPolicy); // → [1.23 EUR]
assertScale(money('1.234', 'EUR', { scale: 3 }), isoPolicy); // throws
```

**Cash rounding**

- `cashRound(m, { country?, rounding?, includeUnverified? })` uses the table in `data/cash-rounding.json`:
  - CHF 0.05, SEK and NOK 1.00, DKK 0.50, CAD and AUD 0.05, NZD 0.10
  - HUF 5, CZK 1, CLP 10, ILS 0.10, MYR 0.05
  - EUR 0.05 in BE, NL, FI, IE, IT, SK, EE and LT, and more.
- Call it **only for cash tenders**: card payments are never rounded in any of these jurisdictions.
- For EUR it needs the `country`, because there is no euro-wide rule.
- `roundToIncrement(m, increment, rounding = 'halfExpand')` and `cashRule(currency, country?)` are also exported.

**Format and parse**

- `format(m, locale?, Intl.NumberFormatOptions?)` and `formatToParts(...)`. Formatters are cached, and the digits shown always match the value's scale.
- `parse('1.234,50 €', 'EUR', 'de-DE')` handles:
  - group and decimal separators per locale
  - NBSP and narrow NBSP, Swiss `’`
  - Arabic-Indic, Persian, Devanagari and Thai digits
  - accounting parentheses and U+2212 minus
- The currency always comes from the argument and is never guessed from the text. A `parse(format(x)) == x` property test runs across 14 locales.

**Serialise**

- `toDecimal(m)` gives `"12.34"` for NUMERIC/DECIMAL and wire formats.
- `toMinor(m)` gives a bigint for BIGINT columns. `toMinorNumber(m)` gives a number and throws if it isn't safe.
- `majorPart(m)` and `minorPart(m)` split the amount at the decimal point, truncating toward zero, and both keep its sign: `money('-12.34', 'EUR').majorPart()` is `-12` and `.minorPart()` is `-34`. Each is a number while it is a safe integer and a bigint beyond, like `minor`.
- `JSON.stringify(m)` gives `{"amount":"12.34","currency":"EUR"}`, and `fromJSON` reverses it. The amount is a string so it survives JSON parsers that turn numbers into floats.

**Validate at API boundaries.** `@ducatjs/money/zod` and `@ducatjs/money/valibot` turn the JSON form into Money inside your request schemas. They accept exactly what `toJSON` writes:

- an exact decimal string (no exponent, plus sign, spaces or grouping) with at most 50 digits (`maxDigits`) and no more decimals than the scale;
- a known currency, or one of `{ currency }`.

The scale is the schema's, not the input's: the currency's exponent, or `{ scale }`. Shorter amounts are padded (`"1.5"` EUR is 1.50 EUR). `{ rounding }` accepts more decimals, as in `money()`. Errors are issues on the `amount` or `currency` path, and keys other than those two are dropped. Bad options throw when the schema is built. The Zod schema is a codec, so `z.encode(schema, price)` writes the JSON back. With Valibot, which has no codecs, use `price.toJSON()`. `moneyJSONSchema` checks the same things but keeps the JSON. Zod (4) and Valibot (1) are optional peer dependencies; no other entry imports them.

```ts
import { z } from 'zod';
import { money } from '@ducatjs/money';
import { moneySchema } from '@ducatjs/money/zod';

const Order = z.object({ total: moneySchema({ currency: ['EUR', 'USD'] }) });
Order.parse({ total: { amount: '12.34', currency: 'EUR' } }).total; // → 12.34 EUR
Order.parse({ total: { amount: '12.345', currency: 'EUR' } }); // throws
z.encode(moneySchema(), money('9.99', 'USD')); // → { amount: '9.99', currency: 'USD' }
```

```ts
import * as v from 'valibot';
import { moneySchema } from '@ducatjs/money/valibot';

v.parse(moneySchema({ currency: 'JPY' }), { amount: '1000', currency: 'JPY' }); // → 1000 JPY
```

**Currencies**

- `currencyExponent(code)`, `isCurrency(code)`, `ISO_EXPONENTS`, `ISO_4217_PUBLISHED`
- `defineCurrency('BTC', 8)` adds a non-ISO code. To also get it in the `CurrencyCode` type, augment `interface CustomCurrencies`.

### Currency conversion

`@ducatjs/money/convert` converts at exact rates and rounds once, at the end. A rate is a `Rate`, an exact rational with the pair in its type, so converting the wrong currency is a compile error. Inverses and chains of rates are exact too: nothing is rounded until an amount is converted.

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

Write rates as decimal strings, with every digit the source published. A JS number is read at its shortest decimal form, so it is exact as well, but a string says what was meant. A rate keeps the digits it was given: `exchangeRate('EUR', 'HUF', '363.90').toString()` is `'363.90'`. A rate carries optional metadata: `source`, `asOf`, `availableAt` (when it was published), `validUntil`, `type` (`'mid'`, `'bid'`, `'ask'`, `'reference'`...) and `quote` (how the source published it). Instants are stored in UTC, and dates stay as given. A derived rate takes the oldest `asOf`, the latest `availableAt` and the earliest `validUntil` of its inputs, so staleness can't hide in a chain. `validUntil` is checked only when you pass `{ strictValidity: true }`, because ducat reads the clock only when asked to.

**Providers.** A `RateProvider` answers `rate(from, to, { asOf })` synchronously, or with `undefined`. `rateTable()` holds a fixed set of rates (one base against many, as the ECB publishes them), and combinators build the rest: `chain(...)` takes the first answer, `reversed(p)` inverts, `via('EUR', p)` triangulates through one currency, and `identity()` answers 1 for a currency to itself. Loading is async and stays outside providers. `snapshots(load)` gives the latest table at or before a day, looks back over weekends and holidays, and caches loaded days. A loader that throws fails the lookup instead of falling back to an older day, so an outage can't silently become a stale rate. Days are UTC days, and a table answers for its whole day, including the hours before it was published, unless it has an `availableAt`.

<!-- doctest: setup import { readFileSync } from 'node:fs'; const xml90Days = readFileSync('test/fixtures/ecb/eurofxref-hist-2d.xml', 'utf8'); -->

```ts
import { money } from '@ducatjs/money';
import { snapshotsFrom, via } from '@ducatjs/money/convert';
import { parseEcbXml } from '@ducatjs/money/convert/ecb';

const history = snapshotsFrom(parseEcbXml(xml90Days));
const fx = via('EUR', await history.at('2026-11-08')); // a Sunday: Friday's table
money('100', 'USD').convert('JPY', fx, 'halfEven'); // → 15833 JPY, through EUR, rounded once
```

**Historical rates.** A lookup for a past date should see only what was known then, in the form the source published it. Publication times and missing values work in `@ducatjs/money/convert` itself; quoted tables and ranges are in the opt-in `@ducatjs/money/convert/history`, so converting at rates you already hold doesn't pay for them.

- **Publication time.** `availableAt` on a rate or a table hides it from lookups before then, so a query for 09:00 on a publication day gets the day before. A date query covers the whole day.
- **How a rate was quoted.** Many central banks quote the other way round (CAD per USD) or per 100 units (NOK per 100 JPY). `quotedTable({ base, inverted: true, rates })` and per-entry `{ rate, per, inverted }` store the exact rate in the table's direction and keep the published quote. `{ rate, decimals }` rebuilds the trailing zeros a feed strips (`'1.175'` with 4 decimals is `'1.1750'`).
- **Missing values.** `null` in a table's `rates` marks a currency the source listed without a value (a holiday, `ND`, `N/A`). The table lists it in `missing`, and every parser reads those markers the same way.
- **Periods.** A table with `validUntil` (a monthly rate, say) answers any day up to that date and nothing after it.
- **Ranges.** `rateHistory(tables)` answers synchronously from a date range loaded in one call. Each pair falls back on its own (a currency missing on a holiday comes from the day before), up to `lookback` days (default 4), and `lookup()` says why it fell back: `noTable`, `notYetAvailable`, `expired`, `missing` or `notQuoted`. A table with a `validUntil` answers its whole period whatever the lookback. `snapshots()` skips tables not yet published, too.

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

**Where rates come from.** ducat ships parsers for the ECB's euro reference rates (`@ducatjs/money/convert/ecb`): the daily, 90-day and full-history eurofxref XML and CSV files, and the ECB Data Portal's SDMX-CSV (`parseEcbSdmxCsv`), which has any date range back to 1999 in one file. The opt-in fetchers are in `@ducatjs/money/convert/fetch`: `fetchEcb()` for the eurofxref files and `fetchEcbRange({ start, end, currencies })` for the Data Portal, which needs no key and allows browsers (CORS). They use the platform `fetch` and have a 30-second default timeout. Nothing else in ducat touches the network. The ECB publishes once per TARGET working day at about 16:00 CET, for information only, so its rates are typed `'reference'`. The Data Portal strips trailing zeros (`147.2` for 147.20), so the parser rebuilds the published digits from each series' `DECIMALS` attribute. The Bank of Canada's daily rates come from its Valet API (`parseBankOfCanadaJson` in `@ducatjs/money/convert/boc`, and `fetchBankOfCanada()`, also keyless and CORS-enabled). The Bank quotes CAD per unit of each currency, so the tables hold exact inverses with the published quote kept, and its rates carry `availableAt` 16:30 Toronto time, when it says it publishes them. It quotes four decimals (up to six for small rates), so a small rate has only about four significant digits: JPY `0.008760`, KRW `0.000929`, and IDR `0.000082` with two. The inverse of such a rate is exact, but no more precise than the quote, so for those currencies prefer a source that quotes them the other way round. For what a payment actually settled at, read the processor's own rate: `stripeRate` and `stripeImpliedRate` from a Stripe balance transaction, and `adyenRate` from an Adyen settlement details row. Any other source is a small loader that returns a `rateTable`.

<!-- doctest: setup import { readFileSync } from 'node:fs'; const sdmxCsv = readFileSync('test/fixtures/ecb-sdmx/exr-d-full.csv', 'utf8'); -->

```ts
import { parseEcbSdmxCsv } from '@ducatjs/money/convert/ecb';
import { rateHistory } from '@ducatjs/money/convert/history';

// what fetchEcbRange({ start: '2025-12-22', end: '2026-01-06' }) parses
const history = rateHistory(parseEcbSdmxCsv(sdmxCsv));
history.rate('EUR', 'ISK', { asOf: '2026-01-06' })?.toString(); // → '147.20' (the API sends 147.2)
history.rate('EUR', 'USD', { asOf: '2025-12-26' })?.asOf; // → '2025-12-24' (Christmas)
```

<!-- doctest: setup import { readFileSync } from 'node:fs'; const valetJson = readFileSync('test/fixtures/boc/fx-rates-daily.json', 'utf8'); -->

```ts
import { parseBankOfCanadaJson } from '@ducatjs/money/convert/boc';

const [latest] = parseBankOfCanadaJson(valetJson); // what fetchBankOfCanada() parses
latest?.rate('CAD', 'USD')?.inverse().toString(); // → '1.3789' (CAD per USD, as published)
latest?.availableAt; // → '2026-01-06T21:30:00.000Z' (16:30 in Toronto)
```

**Exact intermediates and residuals.** `@ducatjs/money/exact` adds `ExactMoney`, a rational amount for chained calculations that should round once at the end. In `@ducatjs/money/convert`, `convertDetailed()` also returns what rounding cost, so a ledger can book it:

```ts
import { money } from '@ducatjs/money';
import { convertDetailed, exchangeRate } from '@ducatjs/money/convert';

const eurUsd = exchangeRate('EUR', 'USD', '1.1165');
const { value, residual } = convertDetailed(money('0.07', 'EUR'), eurUsd, 'halfEven');
value; // → 0.08 USD
residual; // → -369/200000 USD (value + residual is the exact conversion)
```

**Totals in several currencies.** `bag(...amounts)` keeps per-currency totals, and `bag.total('EUR', fx, 'halfEven')` converts every entry exactly, sums and rounds once. To order amounts in different currencies, `comparator(fx, { base: 'USD' })` compares them through one base currency. With one rate per currency the order is consistent. Pairwise rates are not: with bid/ask or slightly inconsistent mid rates, A < B < C < A can happen, and `Array#sort` then gives engine-dependent results. `sortByValue(list, fx, { base })` looks every rate up before it reorders anything.

### Fixed-point decimals

`@ducatjs/money/fixed` gives the engine under Money its own type: `Fixed`, an exact decimal without a currency. It is an integer and a scale, the count of decimal places, so `fixed('12.345')` is 12345 at scale 3. The integer is a JS number while it is a safe integer and a bigint beyond, as for Money, so everyday values stay fast and very large ones stay exact. Use it for quantities, unit prices with more decimals than the currency, rates, and intermediate values that are not money yet.

```ts
import { fixed, fromScaled } from '@ducatjs/money/fixed';

const unitPrice = fixed('0.0425'); // → 0.0425 (scale 4)
const total = unitPrice.multiply(1200); // → 51.0000, exact
const perDay = fixed('100.00').divide(3, 'halfEven'); // → 33.33: rounded once, to this value's scale
fixed('1.5').add('0.25'); // → 1.75: mixed scales align to the larger one
fixed('2.5').round('halfEven'); // → 2: round() defaults to scale 0
fromScaled(12345, 3).toString(); // → '12.345'
JSON.stringify({ unitPrice }); // → '{"unitPrice":"0.0425"}'
```

Input is strict in the same way as `money()`. A string keeps its own scale. A number is read at its shortest decimal form, and only when that has at most 15 significant digits, which a double always holds faithfully. So `fixed(0.1 + 0.2)` throws instead of becoming 0.30000000000000004: pass the decimal as a string, or give `{ scale, rounding }`. With a `scale`, input that has more decimals throws unless `rounding` is also given.

Arithmetic follows Money's rules. `add`, `subtract` and `compare` align to the larger scale exactly. `multiply` and `divide` take exact factors (integers, decimal strings, bigints, `ratio()` or another `Fixed`) and round once, with `'halfExpand'` by default. The result keeps this value's scale unless you pass another: `fixed('9.990').divide('1.2', 'halfEven', { scale: 2 })` is 8.32. Pass the scale instead of calling `toScale` afterwards, which would round twice. `toScale` and `round` take any of the ten rounding modes, including `'unnecessary'`, which throws if digits would be lost.

To convert, `money.toFixedPoint()` gives the exact amount at the money's scale, and `fixedValue.toMoney('EUR')` makes Money at the currency's exponent. That conversion throws RoundingError when it would drop digits, unless a rounding mode is passed: `fixed('1.005').toMoney('EUR', 'halfEven')` is 1.00 EUR.

### Payment processors: the amount you send

```ts
import { money } from '@ducatjs/money';
import { toStripe, toStripeAmount, fromStripe } from '@ducatjs/money/stripe';
import { toAdyen, fromAdyen } from '@ducatjs/money/adyen';
import { toCheckout, fromCheckout } from '@ducatjs/money/checkout';
import { toPayPal, fromPayPal } from '@ducatjs/money/paypal';
import { toBraintree, fromBraintree } from '@ducatjs/money/braintree';
import { toKlarna, fromKlarna } from '@ducatjs/money/klarna';

toStripe(money('10.99', 'USD')); // → { amount: 1099, currency: 'usd' }
toStripeAmount(money('5', 'ISK')); // → 500     (Stripe: two-decimal value ending in 00)
toStripeAmount(money('10.45', 'HUF'), { payout: true }); // throws: payouts must be whole HUF
toStripeAmount(money('5.124', 'KWD'), { rounding: 'halfEven' }); // → 5120 (last digit must be 0)
toAdyen(money('15000', 'IDR')); // → { value: 15000, currency: 'IDR' }  (Adyen: IDR has 0 decimals)
toAdyen(money('5000', 'CLP')); // → { value: 500000, currency: 'CLP' } (Adyen: CLP has 2 decimals)
toCheckout(money('5000', 'CLP')); // → { amount: 500000, currency: 'CLP' } (Checkout.com: 2 decimals, must end in 00)
toCheckout(money('1.001', 'BHD')); // throws: Checkout.com needs the last digit 0
toPayPal(money('10.99', 'USD')); // → { currency_code: 'USD', value: '10.99' }  (PayPal: exact decimal string)
toPayPal(money('1000', 'HUF')); // → { currency_code: 'HUF', value: '1000' }  (PayPal: HUF takes no decimals)
toBraintree(money('5000', 'LAK')); // → '5000'  (Braintree: LAK is zero-decimal; the merchant account sets the currency)
toKlarna(money('1000', 'HUF')); // → 100000  (Klarna: ISO minor units, so HUF in fillér)
```

The same 1000 units of each currency on the wire (from `test/processors.test.ts`):

|     | ISO exp | `toStripeAmount` | `toAdyen().value` | `toCheckoutAmount` | `toPayPalValue` | `toBraintree` | `toKlarna` |
| --- | ------- | ---------------: | ----------------: | -----------------: | --------------: | ------------: | ---------: |
| USD | 2       |           100000 |            100000 |             100000 |       "1000.00" |     "1000.00" |     100000 |
| JPY | 0       |             1000 |              1000 |               1000 |          "1000" |        "1000" |          - |
| ISK | 0       |           100000 |            100000 |               1000 |               - |        "1000" |          - |
| IDR | 2       |           100000 |              1000 |             100000 |               - |     "1000.00" |          - |
| CLP | 0       |             1000 |            100000 |             100000 |               - |        "1000" |          - |
| KWD | 3       |          1000000 |           1000000 |            1000000 |               - |             - |          - |
| HUF | 2       |           100000 |            100000 |             100000 |          "1000" |     "1000.00" |     100000 |

When the processor needs less precision than the value has, the conversion throws unless you pass a rounding mode. This happens for IDR or CVE on Adyen, MGA on Stripe, Stripe's HUF/TWD payouts, CLP payments on Checkout.com, HUF/TWD on PayPal, LAK on Braintree and three-decimal currencies on Stripe and Checkout.com. PayPal and Braintree amounts are decimal strings, built from the exact value and never through a float. `fromStripe`, `fromAdyen`, `fromCheckout`, `fromPayPal`, `fromBraintree` and `fromKlarna` return the value at its ISO scale when that is exact, and otherwise keep the processor's extra precision instead of rounding it away.

Signs follow each processor's docs and are checked after rounding. Checkout.com (a card verification) and PayPal (breakdown fields) take zero, Braintree doesn't ("Amount must be greater than zero"), and none of the three takes negative amounts: refunds are sent as positive amounts. Klarna takes both, because its order lines document negative amounts for discounts ("Negative when type is discount").

### Databases

| storage                              | Postgres                                                      | MySQL             | SQLite                                                                          | helpers                                                                                |
| ------------------------------------ | ------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **minor units + code** (recommended) | `amount_minor BIGINT NOT NULL, currency CHAR(3) NOT NULL`     | `BIGINT, CHAR(3)` | `INTEGER, TEXT`                                                                 | `toMinorColumns(m, 'amountMinor', 'currency')`, `minorMoneyField(...)`, `fromMinor`    |
| **decimal**                          | `NUMERIC(19,4)` for most cases; `NUMERIC(38,8)` for crypto/FX | `DECIMAL(19,4)`   | **avoid** (NUMERIC affinity may store REAL); use TEXT + `toDecimal` if you must | `toDecimalValue(m, Prisma.Decimal)`, `fromDecimal(d, 'EUR')`, `decimalMoneyField(...)` |
| **JSON**                             | `jsonb` `{amount: "12.34", currency}`                         | `JSON`            | `TEXT`                                                                          | `JSON.stringify(m)`, `fromJSON`                                                        |

- BIGINT holds ±9.2·10^18 minor units, which is 92 quadrillion EUR. Postgres's `money` type is locale-dependent; don't use it.
- Choose a NUMERIC scale of at least the largest exponent you store: 4 covers CLF/UYW, and 3 covers BHD/KWD.
- Prisma maps `BigInt` to JS `bigint`. The helpers accept it, and `fromMinor` normalises it back to a number when it is safe.
- **A scale column** makes minor units self-describing: `amount_scale SMALLINT NOT NULL` next to `amount_minor` and `currency`. Write with `toMinorColumns(m, 'amountMinor', 'currency', { scale: 'amountScale' })` and read with `minorMoneyField('amountMinor', 'currency', { scale: 'amountScale' })`. Any scale then round-trips, sub-minor amounts included, which `toMinorColumns` alone refuses. Stored rows also keep their meaning if a currency's exponent changes (see below). To add the column to existing rows, backfill each currency's current exponent in the migration; a missing (NULL) scale throws on read.
- **Exponent changes.** Minor units stored without a scale are read at the currency's exponent in the installed version of ducat, so a changed exponent would silently change what old rows mean: 1234 stored as 12.34 would read as 1.234 or 123.4. So an exponent change is a breaking change (see [Decisions](#decisions)), listed under **Changed** in the changelog with the currencies affected. Before upgrading across one, migrate the affected rows, or store a scale column (or a decimal) so the question never arises. Custom currencies keep the exponent given to `defineCurrency`.
- `fromDecimal` rejects values with more decimals than the currency allows (e.g. `12.3456` in NUMERIC(19,4) for EUR) unless you pass `{ scale }` or `{ rounding }`. Trailing zeros are fine.

Prisma client extension (from `examples/prisma`, which runs end to end against SQLite):

<!-- doctest: skip (needs a database; examples/prisma runs it) -->

```ts
const db = new PrismaClient().$extends({
  result: {
    order: {
      total: minorMoneyField('totalMinor', 'currency'), // two columns -> Money
      shippingMoney: decimalMoneyField('shipping', { currency: 'EUR' }), // Decimal column -> Money<'EUR'>
    },
  },
});
await db.order.create({
  data: {
    ...toMinorColumns(total, 'totalMinor', 'currency'),
    shipping: toDecimalValue(fee, Prisma.Decimal),
  },
});
(await db.order.findFirstOrThrow()).total; // Money
```

`src/prisma.ts` does not import `@prisma/client`. It types Decimal structurally, as `{ toFixed(): string }`, so it also works with decimal.js and big.js. `examples/prisma/typecheck.ts` checks the helpers against Prisma's generated extension types.

#### node-postgres

`@ducatjs/money/pg` keeps every amount node-postgres reads exact. It doesn't import `pg`; you pass `pg.types` in.

- **`exactTypes(pg.types)`** gives type parsers that return BIGINT as a bigint and NUMERIC as its exact string, rejecting `NaN` and `Infinity`. Arrays of both are parsed the same way: pg's default parses `numeric[]` as floats. Other types keep pg's parsers. **The bigint applies to every BIGINT on that client**, `count(*)` and bigserial ids included, and `JSON.stringify` throws on a bigint. To keep pg's exact strings, pass `{ int8: 'string' }`, or give the money parsers their own pool.
- **A composite type**, `(amount numeric, currency text)`. `moneyTypeSql()` returns its DDL plus a `sum` aggregate that throws on mixed currencies. With the type's OIDs, `exactTypes` reads it (and its arrays) as Money, keeping the scale it was stored at. `toMoneyComposite(m)` writes it. Run the DDL once, in a migration: it isn't idempotent. A schema-qualified name (`moneyTypeSql('billing.amount')`) puts the type, its function and the aggregate in that schema. OIDs are looked up once, so after recreating the type, or with one type per tenant schema, pass the new OIDs; a type `exactTypes` doesn't know comes back as pg's raw text. A value with a NULL field, `(,EUR)`, throws when read and makes `sum` raise.
- **`toNumeric(m, { precision, scale })`** gives the decimal for a `NUMERIC(p, s)` parameter, or throws where Postgres would change the value. Postgres rounds extra decimals silently on insert, which is why the guard exists.

<!-- doctest: skip (needs a Postgres server; test/db/pg-types.test.ts runs the same steps) -->

```ts
import pg from 'pg';
import { money } from '@ducatjs/money';
import {
  exactTypes,
  moneyTypeOids,
  moneyTypeSql,
  toMoneyComposite,
  toNumeric,
} from '@ducatjs/money/pg';

const setup = new pg.Client();
await setup.connect();
for (const statement of moneyTypeSql()) await setup.query(statement); // once, in a migration
const oids = await moneyTypeOids(setup);

const client = new pg.Client({ types: exactTypes(pg.types, { money: oids }) });
await client.connect();
await client.query('INSERT INTO items (price) VALUES ($1::ducat_money)', [
  toMoneyComposite(money('12.34', 'EUR')),
]);
(await client.query('SELECT sum(price) AS total FROM items')).rows[0].total; // Money
toNumeric(money('1.23456', 'EUR', { scale: 5 }), { precision: 19, scale: 4 }); // throws
```

#### Drizzle

`@ducatjs/money/drizzle/pg`, `/drizzle/mysql` and `/drizzle/sqlite` give Drizzle ORM column types, so selects return `Money` and inserts take it, with the currency in the column's type:

| column                | Postgres         | MySQL            | SQLite    | value                                          |
| --------------------- | ---------------- | ---------------- | --------- | ---------------------------------------------- |
| `moneyMinor('EUR')`   | `bigint`         | `bigint`         | `integer` | minor units in a fixed currency                |
| `moneyDecimal('EUR')` | `numeric(19, 4)` | `decimal(19, 4)` | `text`    | the exact decimal; pass `{ precision, scale }` |
| `moneyJson()`         | `jsonb`          | `json`           | `text`    | `{"amount":"12.34","currency":"EUR"}`          |

```ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core';
import { money } from '@ducatjs/money';
import { moneyJson, moneyMinor } from '@ducatjs/money/drizzle/sqlite';

const orders = sqliteTable('orders', {
  id: integer('id').primaryKey(),
  total: moneyMinor('EUR')('total_minor').notNull(), // Money<'EUR'>
  refund: moneyJson()('refund'), // Money in any currency, or null
});

const client = new Database(':memory:');
client.defaultSafeIntegers(true); // integers as bigint, exact beyond 2^53
client.exec(
  'CREATE TABLE orders (id INTEGER PRIMARY KEY, total_minor INTEGER NOT NULL, refund TEXT)',
);
const db = drizzle({ client });

const huge = money('92233720368547758.07', 'EUR');
const dollar = money('1', 'USD');
db.insert(orders).values({ id: 1, total: huge }).run();
db.select().from(orders).get()?.total; // → 92233720368547758.07 EUR
db.insert(orders).values({ id: 2, total: dollar }).run(); // compile error, and throws
```

The columns check what the types can't: writing another currency, a value at a scale other than the currency's, or a value a `numeric(p, s)` column would round or clamp throws. Reading rejects driver values that may have lost digits: a BIGINT beyond 2^53 that the driver returned as a number (use bigint or string mode: `defaultSafeIntegers(true)` in better-sqlite3, `supportBigNumbers` with `bigNumberStrings` in mysql2; node-postgres returns strings already), a DECIMAL returned as a number, and `NaN` or `Infinity`. `drizzle-orm` is an optional peer dependency, imported only by these three entries.

- **Currency per row:** a Drizzle column can't read a sibling column, so there is no "minor units plus a currency column" type. Use `moneyJson()`, which stores the currency in each value, or select both columns and build the Money with `fromMinor(row.amountMinor, row.currency)`.
- **Relational queries** (`db.query...findMany({ with: ... })`) return nested rows through JSON, where Postgres and MySQL turn NUMERIC and BIGINT values into JSON numbers. A nested `moneyDecimal` column then throws, and so does a nested `moneyMinor` beyond 2^53 minor units, rather than return a rounded amount. Top-level columns are not affected. For nested money, use `moneyJson`, or a join with `select`.
- **SQLite decimals are TEXT**, so in SQL they compare and sort as text (`'10.00' < '9.00'`), and `sum()` over them is a REAL. Use `moneyMinor` for columns you sort, compare or add up in SQL. For the same reason `/drizzle/sqlite`'s `moneyDecimal` takes no column size.

---

## Currency data: source, generation, verification

| file                        | source                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/iso4217-list-one.xml` | ISO 4217 List One from SIX (the maintenance agency), published **2026-09-17**. It has 178 codes with minor units, plus N.A. codes such as XAU and XDR, which are excluded as non-monetary.                    |
| `data/stripe.json`          | https://docs.stripe.com/currencies, retrieved 2026-11-07, with verbatim quotes for every special case                                                                                                         |
| `data/adyen.json`           | https://docs.adyen.com/development-resources/currency-codes, retrieved 2026-11-07                                                                                                                             |
| `data/checkout.json`        | https://www.checkout.com/docs/payments/accept-payments/format-the-amount-value, the currency-codes page and the API reference, retrieved 2026-11-07, with verbatim quotes                                     |
| `data/paypal.json`          | https://developer.paypal.com/api/rest/reference/currency-codes/, the other currency-codes page and the Orders v2 schema, retrieved 2026-11-07, with verbatim quotes                                           |
| `data/braintree.json`       | https://developer.paypal.com/braintree/docs/reference/general/currencies, the transaction.sale reference, the validation-error list and the GraphQL `Amount` type, retrieved 2026-11-07, with verbatim quotes |
| `data/klarna.json`          | https://docs.klarna.com/acquirer/klarna/get-started/integration-resilience/data-types/, the purchase-countries page and the Payments API reference, retrieved 2026-11-07, with verbatim quotes                |
| `data/cash-rounding.json`   | Central-bank, statute and government pages per rule. Each entry has a `source` URL and a `verified` flag.                                                                                                     |

- `pnpm gen` (`scripts/gen-currencies.mjs`) turns these into `src/generated/*.ts`.
- `pnpm gen:check` fails if the generated files are stale. It also runs inside the test suite.
- `pnpm gen:fetch` downloads the live SIX list and diffs it against the snapshot (no differences on 2026-11-07).
- Tests assert every ISO exponent against the published list of non-2 exponents:
  - 0: BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF
  - 3: BHD IQD JOD KWD LYD OMR TND
  - 4: CLF UYW
- Tests also check the Adyen differences, the consistency of every Stripe rule, and that `format()` shows ISO digits for every code on every engine.

A change to an ISO exponent in this data is a breaking change, because it changes what stored minor units mean (see [Decisions](#decisions) and [Databases](#databases)).

Recent ISO changes that are already encoded:

- Added: ZWG, SLE, VES/VED, XCG (which replaced ANG in 2025-03) and XAD.
- Withdrawn: BGN (Bulgaria moved to the euro on 2026-01-01), HRK, ZWL, SLL, CUC.
- dinero.js 2.0.2 still ships BGN.

Processor differences encoded:

|                     | ISO       | Stripe                                                                       | Adyen         | Checkout.com                                       | PayPal                                 | Braintree                                  | Klarna                               |
| ------------------- | --------- | ---------------------------------------------------------------------------- | ------------- | -------------------------------------------------- | -------------------------------------- | ------------------------------------------ | ------------------------------------ |
| ISK                 | 0         | 2, amount must be a multiple of 100                                          | 2             | 0                                                  | n/a                                    | 0                                          | n/a                                  |
| UGX                 | 0         | 2, amount must be a multiple of 100 (confirmed, see [Decisions](#decisions)) | 0             | 0                                                  | n/a                                    | 0                                          | n/a                                  |
| CLP                 | 0         | 0                                                                            | **2**         | **2**, payments must be a multiple of 100          | n/a                                    | 0                                          | n/a                                  |
| IDR                 | 2         | 2                                                                            | **0**         | 2                                                  | n/a                                    | 2                                          | n/a                                  |
| CVE                 | 2         | 2                                                                            | **0**         | 2                                                  | n/a                                    | 2                                          | n/a                                  |
| MGA                 | 2         | **0**                                                                        | not supported | 2                                                  | n/a                                    | n/a                                        | n/a                                  |
| HUF, TWD            | 2         | 2 for charges; payouts must be a multiple of 100                             | 2             | 2                                                  | **0**, no decimals allowed             | 2                                          | HUF 2 (TWD n/a)                      |
| BHD JOD KWD OMR TND | 3         | 3, last digit must be 0 (UAE accounts only)                                  | 3             | 3, last digit must be 0                            | n/a                                    | n/a                                        | n/a                                  |
| IQD, LYD            | 3         | not supported                                                                | 3             | 3, last digit must be 0                            | n/a                                    | n/a                                        | n/a                                  |
| RUB                 | 2         | 2                                                                            | 2             | n/a                                                | 2 (one of its two currency pages only) | 2                                          | n/a                                  |
| LAK                 | 2         | 2                                                                            | 2             | 2                                                  | n/a                                    | **0**                                      | n/a                                  |
| HRK LTL ZMK ZWD     | withdrawn | n/a                                                                          | n/a           | n/a                                                | n/a                                    | still listed (2)                           | n/a                                  |
| amount format       |           | integer                                                                      | integer       | integer                                            | decimal string                         | decimal string, no sign, no currency field | integer; negative for discount lines |
| ANG, STD            | withdrawn | still listed (2)                                                             | n/a           | n/a                                                | n/a                                    | STD still listed (2)                       | n/a                                  |
| SLL                 | withdrawn | n/a                                                                          | n/a           | still listed (2)                                   | n/a                                    | still listed (2)                           | n/a                                  |
| CNH, VEF            | not ISO   | n/a                                                                          | listed (2)    | n/a                                                | n/a                                    | n/a                                        | n/a                                  |
| XDR                 | N.A.      | n/a                                                                          | n/a           | listed (2)                                         | n/a                                    | n/a                                        | n/a                                  |
| amount limits       |           |                                                                              |               | docs: > 0, ≤ 9 digits; API schema: 0 to 9999999999 | ≤ 15 digits before the point           | > 0; maximum set by the processor          | order ≥ 0; order line ≤ 200000000    |

---

## What is proved

`proofs/` holds [Lean 4](https://lean-lang.org) proofs (with Mathlib) of two kinds:

- **Proved code.** The bigint rounding kernels are written once in Lean, as values of a small expression language (`proofs/Ducat/Kernel.lean`). The theorems are about those values, and `pnpm gen:kernel` prints the same values as TypeScript into `src/generated/kernel.ts`. They print as one function, `divideAndRoundBigint`: the steps every mode shares, then a `switch` with each mode's proved decision (`kernel_shared` states that the shared steps really are the same). The TypeScript `divideAndRoundBigint` in `src/rounding.ts` calls it; it is the bigint path of every rounded operation. What you have to trust is the printer (about 60 lines of Lean) and the fact that JS `bigint` `+ - * /` agree with Lean's `Int` (`/` truncates, as `Int.tdiv` does).
- **Proved models.** Allocation, instalments, chunks, schedules, cash rounding, tax and scale changes are proved about Lean models of what the TypeScript does, not about the TypeScript itself. The allocation, instalment, chunk, schedule and increment models are compiled into an oracle that prints generated cases to `test/fixtures/<model>.oracle.json`. The tests require the TypeScript to match each one exactly (`allocate` on both its number and bigint paths). The TypeScript for tax, scale and conversion is tested, not proved (see below).

`pnpm gen:check`, which runs in every check without Lean, fails in two cases. One is any unfinished proof (`sorry`, `admit`, a new `axiom`, `native_decide`). The other is a generated file that was edited by hand or not regenerated after `proofs/` changed: each generated file carries a hash of the Lean sources it came from. `pnpm gen:kernel:check` needs Lean, and CI runs it. It rebuilds the proofs, checks that the headline theorems depend only on Lean's standard axioms (`propext`, `Classical.choice`, `Quot.sound`), and fails if either generated file differs from what the proofs print.

### Rounding kernels: proved code (`proofs/Ducat/Rounding.lean`)

`Rounds m p d q` is the specification: "`q` is `p / d` rounded with mode `m`", written as integer inequalities on the error `p − d·q`. For example, `floor` means `q ≤ p/d < q + 1`. The half modes mean `|p/d − q| ≤ ½`, with the tie going where the mode says. `unnecessary` means the division is exact. For a divisor `d > 0`:

- `kernel_sound`: whatever the generated kernel returns is correctly rounded.
- `rounds_unique`: the specification has at most one answer, so "correctly rounded" means "the right answer".
- `kernel_fails_iff`: the kernel throws exactly for `unnecessary` on an inexact division, and never otherwise.
- `kernel_correct`: so whenever a correctly rounded answer exists, the kernel returns it.

### Allocation: proved model (`proofs/Ducat/Allocate.lean`)

The model takes an amount `x ≥ 0` and non-negative weights with a positive total `T`. Each bucket gets `⌊x·w/T⌋`, and the leftover units go to the non-zero buckets in the order the strategy fixes.

- `alloc_sum`: the parts add up to `x`, for every remainder strategy.
- `alloc_zero`: a bucket with zero weight gets zero.
- `alloc_near_largest`: with `'largest'` (Hamilton's method), each part is less than one unit from its exact share `x·w/T`.
- `alloc_near`: with `'first'` and `'last'`, each part is at most one unit from its exact share. Exactly one unit can happen: 0.02 split `[2, 1, 1]` with `'first'` gives 0.02, 0, 0.
- `alloc_scale`: multiplying every weight by the same positive number changes nothing, so decimal weights such as `'33.3'`, scaled to integers, are allocated by their exact ratios.
- Negative amounts are the mirror image of positive ones. The model defines them that way, as `allocate` does, so `allocS_neg` only confirms the definition.

### Instalments, chunks and schedules: proved models (`proofs/Ducat/Schedule.lean`)

For a non-negative total; negative totals are the mirror image, as in `allocate`.

- `inst_sum`: the instalments add up to the total, for every remainder mode.
- `inst_multiple`: with a `unit`, every instalment except the one that takes the leftover is a whole number of units. `inst_near`: with `'first'`/`'last'`, those instalments are the regular amount or one unit more (both hold by how the model builds the instalments), and the leftover is less than one unit.
- `chunk_sum`, `chunk_le`, `chunk_full`, `chunk_last_pos`: the chunks add up to the total, none exceeds `max`, every chunk but the last is exactly `max`, and the last is positive (a zero total gives a single zero).
- `sched_sum`: whenever `schedule` succeeds, its tranches add up to the total. This holds by construction, since the rest tranche takes whatever is left, as in the TypeScript. The oracle cases include each way it must fail: two rest tranches, percentages over 100, tranches exceeding the total, and a leftover with no rest tranche.
- `sched_shares_near`: the percentage shares that `schedule` computes, before capping, are each less than one unit from their exact share. That they reach the right tranches, with caps applied, is checked by the oracle cases, not proved.

### Cash rounding: proved model (`proofs/Ducat/Cash.lean`)

The model of `roundToIncrement` (and so of `cashRound`) is one kernel division times the increment. The TypeScript also aligns scales and, for safe integers, takes the number path. The oracle cases compare it with the model on both paths.

- `increment_multiple`: the result is a whole number of increments.
- `increment_near`, `increment_half`: it is less than one increment from the amount in every mode, and at most half an increment in the half modes.
- `increment_exact`, `increment_idem`: an amount that already is a multiple comes back unchanged in every mode, so rounding twice is rounding once.

### Tax, scale and conversion: proved model (`proofs/Ducat/Tax.lean`)

These are stated over the proved kernel (`divRound`):

- `addTax_bound`: the modelled tax is the exact tax, correctly rounded once. `extractTax_bound`: the modelled net is `gross / (1 + rate)` correctly rounded, and the tax carries the same error with the opposite sign. (`addTax_gross` and `extractTax_gross`, net + tax = gross, hold by construction, as in the TypeScript.)
- `rounds_half_bound`, `rounds_directed_bound`: a correctly rounded result is within half a unit of the exact value in the half modes, and under one unit in every mode.
- `toScale_roundtrip`: raising the scale and lowering it again gives back the original value in every mode, and `unnecessary` does not throw.
- `divRound_mul_left`: multiplying the numerator and denominator by the same positive number does not change the result. So reducing a rate by its gcd, or composing exact rates, cannot change a rounded result, provided it is computed as a single division of the exact product.

### Tested, not proved

- **The printer** that turns the Lean kernels into TypeScript, and the `divideAndRoundBigint` dispatch in `src/rounding.ts`. The generated kernels are compared with an independent bigint oracle (`test/kernel.test.ts`).
- **The number fast path** of `divideAndRound`. It computes the exact truncated quotient and remainder itself, then calls `roundTruncatedQuotient`: the same Lean terms as the proved switch, printed over `number`. That is exact while every value is a safe integer, which is the caller's obligation. It is compared with the generated kernels for every `p ∈ [−300, 300]`, `d ∈ [1, 40]` in every mode, and with fast-check over the full safe-integer range, on ties, and on bigints up to 10^30.
- **The TypeScript `allocate`**, number and bigint paths. It is compared with the 1,500-case oracle fixture, plus property tests against a separate bigint largest-remainder allocator (`test/oracle.test.ts`).
- **The TypeScript tax, conversion and `multiplyByRatio` code:**
  - that each rounds with exactly one kernel call on the exact product;
  - the scale shifts;
  - that every call site passes a divisor `d > 0`, with the sign moved to the numerator.

  These are covered by unit vectors and by property tests against decimal.js at 200 significant digits (`test/oracle.test.ts`).

- **The TypeScript `instalments`, `chunk`, `schedule` and `roundToIncrement`**, compared with their models' oracle fixtures, on both the number and bigint paths, including the cases where `schedule` must throw.
- `split` without a unit is `allocate` with equal weights. Decimal parsing, `Intl` formatting and parsing, and the processor and database adapters are tested, not proved.

## Testing your code

`@ducatjs/money/testing` makes Money pleasant to test with Vitest and Jest. One import in a setup file is enough:

<!-- doctest: skip (a setup-file import, shown for its setup) -->

```ts
import '@ducatjs/money/testing/vitest'; // or '@ducatjs/money/testing/jest', or installMoneyMatchers(expect)
```

- **Value equality.** `toEqual`, `toStrictEqual` and nested structures compare Money by value: 1.0 EUR at scale 1 equals 1.00 EUR, and number and bigint minor units compare as equal.
- **Readable output.** Snapshots and failure diffs show `12.34 EUR`, and `console.log` shows `Money(12.34 EUR)`.
- **Matchers**, whose failures read "expected 12.35 EUR to be 12.34 EUR":
  - `toBeMoney(amount, currency)` and `toHaveCurrency(code)`;
  - `toBeGreaterThanMoney`, `toBeGreaterThanOrEqualMoney`, `toBeLessThanMoney` and `toBeLessThanOrEqualMoney`;
  - `toSumTo(total)`, which checks that a list of parts sums exactly to a total, for allocation and instalment tests.
- **Arbitraries** in `@ducatjs/money/testing/arbitraries`, for fast-check property tests. `arbMoney({ currency?, min?, max?, scale? })` and `arbCurrency({ exponents?, all? })` cover minor units beyond 2^53, currencies with exponents 0, 3 and 4, and scales above the currency's exponent.

<!-- doctest: skip (needs a test runner) -->

```ts
import fc from 'fast-check';
import { arbMoney } from '@ducatjs/money/testing/arbitraries';

test('a split always sums to its total', () => {
  fc.assert(fc.property(arbMoney(), (total) => expect(total.split(3)).toSumTo(total)));
});
```

Vitest's types come with the import. For Jest, add the matchers to Jest's `Matchers` in a declaration file, in the form your Jest types use. ducat doesn't do this itself: augmenting Jest's global namespace clashes with Vitest's `Assertion` type (TS2320) in a project that has both.

With `@types/jest` (the global `jest` namespace):

<!-- doctest: skip (a declaration file for Jest projects; type-checked in test/jest-types) -->

```ts
import type { MoneyMatchers } from '@ducatjs/money/testing';
declare global {
  namespace jest {
    interface Matchers<R> extends MoneyMatchers<R> {}
  }
}
```

With `@jest/globals` (Jest's `expect` package, which must be resolvable from your project, so under pnpm add `expect` as a dev dependency):

<!-- doctest: skip (a declaration file for Jest projects) -->

```ts
import type { MoneyMatchers } from '@ducatjs/money/testing';
declare module 'expect' {
  interface Matchers<R> extends MoneyMatchers<R> {}
}
```

Under `bun test`, `installMoneyMatchers(expect)` installs the matchers and the inspect hook. Bun supports neither custom equality testers nor snapshot serializers yet, so `toEqual` compares Money field by field there and snapshots show the fields; use `toBeMoney` instead.

Value equality relies on `isMoney`, so a Money from a second installed copy of ducat is compared field by field, like any other object.

Vitest and fast-check are optional peer dependencies, used only by these entries. Nothing in the core changes, so production bundles are unaffected.

## Tests

`pnpm test` runs the vitest suite.

- Unit tests use real-world vectors:
  - the `java.math.RoundingMode` table for all modes
  - UK VAT 1/6 extraction, German 19% and 7% VAT
  - the HMRC 9.99 case, the classic `2.675` float trap
  - the allocation splits from Fowler and dinero
  - Stripe and Adyen doc examples, the statutory cash-rounding thresholds for SE, NO, DK, HU and CA
  - Intl output for de, fr, ja, ar and en-IN
- fast-check property tests cover:
  - `divideAndRound` against an independent floor-based bigint oracle over the full safe range, including float-quotient edge cases
  - rounding-mode invariants (floor ≤ x ≤ ceil, half modes within ½)
  - add associativity, commutativity and identity, and agreement with bigint arithmetic
  - the number-iff-safe representation invariant
  - decimal, JSON and minor-unit round trips
  - multiply against exact rationals
  - allocation: sums are exact, each part is within one unit of its ideal share, results are deterministic, and largest-remainder order holds
  - instalment sums, tax breakdowns that add up
  - `parse(format(x))` across 14 locales
  - the Intl hand-off being bit-identical
- `pnpm typecheck` compiles `test/types.ts`. Its `@ts-expect-error` lines prove that currency mismatch, readonly fields and unknown rounding modes are compile errors.
- `pnpm test:runtimes` runs:
  - the **full suite on Node 24, Bun 1.4 (via `bun test`) and Deno 2.9**: all pass
  - a bundled smoke test on Node 24, Node 18, Bun, Deno and the **SpiderMonkey and JavaScriptCore shells** (installed with jsvu): all pass. On Node 18, `format()` of amounts above 2^53 is lossy (no Intl string input).
- `pnpm test:db` runs the SQL helpers against real databases: SQLite through Node's built-in `node:sqlite`, and Postgres and MySQL when `DUCAT_PG_URL` and `DUCAT_MYSQL_URL` point at a server (CI runs both as service containers, and sets `DUCAT_REQUIRE_DB=1` so a missing URL fails instead of skipping). It covers BIGINT minor units beyond 2^53 and at the BIGINT limits, `NUMERIC(19,4)` and `NUMERIC(38,4)` columns, Money as JSON/JSONB, values a column rounded silently (rejected on read), NaN and Infinity, and driver defaults that lose precision.
- `pnpm test:browser` runs a smoke and property subset in Chromium, Firefox and WebKit through Playwright, including `parse(format())` round trips in 18 locales; `DUCAT_BROWSER_RUNS` sets the cases per property (default 300) and `DUCAT_SEED` the seed.
- `pnpm test:mutation` runs Stryker over `src/` with property counts capped; CI runs it nightly and keeps the report.

## Benchmarks

- Clean-machine numbers against the other money and fixed-point libraries are in [How it compares](#how-it-compares) and
  [docs/COMPARISON.md](docs/COMPARISON.md), generated from [compare/](compare) on one quiet AMD EPYC Genoa vCPU under
  Node, Bun and Deno.
- CodSpeed measures every pull request by instruction count, so speed regressions show up even on noisy CI machines.
- The benchmarks in `bench/` are for quick local comparisons; on a shared machine their run-to-run variation is often
  ±20–30%.
- Bundle size (esbuild, minified + gzip; `pnpm size` checks every entry point and snippet against `scripts/size-budgets.json`):
  - `money('1.00', 'EUR').add(…).multiply('1.075', 'halfEven').toDecimal()`: **3.7 kB**, of which about 0.55 kB is the ISO table
  - the core entry point: 4.7 kB; everything (`@ducatjs/money/all`): 19.0 kB
  - the same snippet with dinero.js (EUR only): 1.9 kB

---

## Decisions

- **JSON is a decimal string plus the currency, never minor units**: `{"amount":"12.34","currency":"EUR"}`. Minor units only mean something to a reader who knows the exponent, and the exponent isn't fixed:
  - Processors disagree with ISO. Stripe sends ISK and UGX as two-decimal; Adyen has its own exceptions.
  - ISO exponents change over time.
  - Generic consumers (other languages, `NUMERIC` and `Decimal` columns, logs) expect a decimal amount.

  Minor units remain available, but only through explicit, named conversions, where the owner of the exponent is known: `toMinor`, `toStripeAmount`, `toAdyenAmount`, and the BIGINT column helpers.

  Evidence from a comparison of the npm money libraries (2026-11): by default, `JSON.stringify` of 12.34 EUR gives minor units in dinero.js 2 (`{"amount":1234,"currency":{"code":"EUR","base":10,"exponent":2},"scale":2}`; with the bigint calculator it throws "Do not know how to serialize a BigInt"), dinero.js 1 (`{"amount":1234,"currency":"EUR","precision":2}`), js-money, ts-money and @screeny05/ts-money (`{"amount":1234,"currency":"EUR"}`, with no exponent, so the reader must know it) and monetra (`{"amount":"1234","currency":"EUR","precision":2}`). The decimal libraries and money-math give `"12.34"`, and bigint-money gives `["12.34","EUR"]`. Related dinero.js issues: #22 (`JSON.stringify` gave `{}`, then `toJSON` was debated), #636 (deserialising needs the full currency object from a dynamic code), and #771 (`allocate` hangs on a value deserialised at scale 19).

- **The package is `@ducatjs/money`** (the brand and repo stay ducat). npm's name-similarity rule blocks the unscoped `ducat`, and the npm org `ducat` was taken, so it lives under the `ducatjs` org; one package, with opt-in subpath modules. The ducat was the Venetian gold trade coin, used across Europe for about 600 years.
- **Methods on `Money`**, because free functions alone are awkward to use: `price.add(fee).multiply('1.075').split(3)`. The same operations as plain functions are in `@ducatjs/money/fn`, not in the root entry, so there is one way to write each in ordinary code. Operands are `Money` only, never bare numbers (monetra's `add(5)` means 5 minor units, a trap we avoid).
- **The core is small; everything else is an opt-in module that installs methods.** Methods on one class pull every feature into every bundle, so `Money` carries only the core, and `@ducatjs/money/allocate`, `/tax`, `/format`… add their methods when imported (types through `declare module` augmentation, as dayjs plugins do). The cost is that installed methods are global at run time. `@ducatjs/money/fn` offers the same functions without touching the prototype, for function-level tree-shaking.
- **Correctness and features come before bundle size.** The core keeps the currency table, the comparison methods, bigint support and exact string parsing; everything else is an opt-in module, and size budgets in CI stop either from growing.
- **Default rounding is `'halfExpand'`** (ties away from zero) for arithmetic, the most common default. It is the default of decimal.js, Prisma.Decimal, big.js, bignumber.js and `Intl.NumberFormat`, and what currency.js, js-money and ts-money intend with `Math.round` (which differs for negative ties). The minority defaults: half-even (dinero.js 1, bigint-money), throw (monetra), truncate (dinero.js 2 `transformScale`). Parsing (`money('1.005','EUR')`, `fromDecimal`) and processor amounts (`toStripeAmount`, `toAdyen`) still throw unless a mode is passed, as ts-money and monetra do for input. The default is exported as `DEFAULT_ROUNDING`.
- **Rounding policies are explicit values.** A policy (scale, increment and mode) is passed to each operation that rounds, the way a rounding mode is. It is never attached to an amount or installed as a global default: a stored or global policy would make the same expression round differently depending on where a value came from or what ran earlier, which is the kind of action at a distance a money library should rule out.
- **A bundled ISO 4217 exponent change is breaking:** it is listed under **Changed**, and ships only in a minor version before 1.0 and a major version from 1.0. Minor units stored without a scale are read at the installed exponent, so such a change silently changes what stored rows mean.
- **Stripe UGX is ×100.** Stripe's docs: "UGX transitioned to a zero-decimal currency, but backwards compatibility requires you to represent it as a two-decimal value, where the decimal amount is always 00. For example, to charge 5 UGX, provide an amount value of 500. You can't charge fractions of UGX. For invoices where the amount is fractional after prorations, coupons, or taxes, Stripe automatically rounds that amount to the nearest number evenly divisible by 100." That is what `toStripeAmount` encodes. An amount with fractional UGX throws unless a rounding mode is passed.
- **ESM only; Node ≥ 24.** Every supported Node can `require()` an ES module, so CommonJS callers still work, and a single build avoids the dual-package hazard: with separate CJS and ESM copies, `isMoney()` and `instanceof Money` fail across the two. Node 24 also formats exactly beyond 2^53 (Intl.NumberFormat v3). Browsers set the language floor, not Node: output targets ES2023.
- **Withdrawn and non-ISO codes** (ANG, STD, BGN, HRK, ZWL, SLL, CUC, CNH, VEF…) stay out of the core registry. An opt-in table of them with withdrawal dates is planned for a later release; until then, register any you need with `defineCurrency`.
- **Processors:** Stripe, Adyen, Checkout.com, PayPal, Braintree and Klarna, each an opt-in entry point (`@ducatjs/money/<processor>`).
- **Test matrix:** real Postgres, MySQL and SQLite for the DB helpers; real browsers (Chromium, Firefox, WebKit via Playwright) alongside Node, Bun, Deno and the engine shells.

## What's missing (honest list)

- **Stripe three-decimal rule.** The "last digit must be 0" rule comes from a June 2024 archived copy of Stripe's page. The live page no longer has that section (it is marked unverified in `data/stripe.json`).
- **Cash-rounding rules.** Some are backed only by secondary sources (`verified: false`): CHF, DKK, AUD, NZD, ILS, MYR, SGD, FI/IE/IT/SK/LT EUR and several others. `includeUnverified: false` turns them off.
  - Per-jurisdiction tie rules are all `halfExpand`. Singapore's "round down in the customer's favour" practice and USD's state-by-state post-penny rules aren't modelled.
- **Checkout.com currency list.** The currency-codes page calls itself the "major currencies we support"; `toCheckout` refuses anything not on it. Its amount limits (the docs say greater than zero and at most nine digits, the API schema allows 0 for card verification and up to ten digits) aren't enforced.
- **PayPal.** Its two currency pages disagree: the REST reference page lists RUB and the other doesn't (`toPayPal` accepts RUB). The docs don't say whether a zero fraction such as `"100.00"` counts as a decimal for HUF, JPY or TWD, so `toPayPal` always sends whole numbers for them. BRL, CNY and MYR work for in-country accounts only, and that isn't checked. The schema allows a minus sign and the text says amounts are positive; the sign isn't checked either.
- **Braintree.** The currencies page gives only the zero-decimal list, so every other currency is assumed to take its ISO decimals, and the withdrawn codes it still lists (HRK, LTL, SLL, STD, ZMK, ZWD) are assumed to take 2. The GraphQL `Amount` type allows three decimals and the REST reference says `x.xx`; `toBraintree` sends the currency's own decimals, which both accept. Which currencies an account can use depends on its setup, and that isn't checked.
- **Klarna.** Amounts follow ISO 4217 minor units, as its docs say, but no Klarna page gives a HUF example, so HUF in fillér is unconfirmed. Each purchase country has one currency, and the country/currency pairing isn't checked. Only the Payments API schema was read; captures and refunds are assumed to use the same units. `toKlarna` returns a bare integer because Klarna sends the currency once per order (`purchase_currency`), not per amount. Klarna's `tax_rate` (a percentage with two implicit decimals, 2000 = 20%) has no helper.
- **Processor coverage.** Stripe, Adyen, Checkout.com, PayPal (REST APIs), Braintree and Klarna are covered. There is no Adyen Terminal API (it uses major units). There is no per-account-country Stripe currency availability; the table is the union of all countries.
- **Withdrawn and non-ISO codes** (ANG, STD, CNH, VEF, SLL, XDR, HRK, LTL, ZMK, ZWD) aren't in the core registry. Stripe, Adyen, Checkout.com and Braintree list them, so `defineCurrency` is needed to hold them. There is no historical ISO data (validity dates).
- **Formatting gaps:**
  - No pluggable formatter for engines without Intl.
  - `parse` is lenient about group sizes (it accepts `1,23,4.00` in en-US). It also doesn't check the currency symbol in the text against the `currency` argument.
- **Not yet benchmarked:**
  - Browsers themselves; only their engines were tested via the jsvu shells.
  - Memory and GC pressure, which were reasoned about but not measured.
  - dinero.js's bigint calculator.
- **No Money arrays or columnar ops** (e.g. summing a `Float64Array`/`BigInt64Array` of minor units).
- **The ISO table is always bundled** (about 0.55 kB gzipped, 1 kB minified). Per-currency imports like dinero's would make the minimum bundle smaller.
- **Minor-unit columns can't round-trip values with a non-ISO scale.** `toMinorColumns` refuses them by design. There is no `scale` column helper.
- **No docs site yet.**
