<p align="center"><img src="assets/logo.png" width="128" height="128" alt="A gold ducat of Doge Francesco Foscari, 1423–1457"></p>
<p align="center"><sub>Gold ducat of Francesco Foscari, Venice, 1423–1457. Photo: Francesco Bini, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, via Wikimedia Commons (<a href="assets/CREDITS.md">credits</a>).</sub></p>

# ducat

An exact, fast, typed Money type for TypeScript. It has zero runtime dependencies and runs on Node, Bun, Deno and browsers.

```ts
import { money } from '@ducatjs/money';

const price = money('19.99', 'EUR'); // Money<'EUR'>
const total = price.add(money('5.01', 'EUR')); // 25.00 EUR
total.multiply('1.075'); // 26.88 EUR (26.875 rounds half away from zero by default)
total.multiply('1.075', 'halfEven'); // 26.88 EUR (any of 10 modes, or 'unnecessary' to throw)
money('100', 'EUR').allocate([1, 1, 1]); // 33.34, 33.33, 33.33 (sums to 100.00, always)
money('12', 'GBP').extractTax(20); // { net: 10.00, tax: 2.00, gross: 12.00 }
total.convert('JPY', '162.457'); // 4061 JPY
total.format('de-DE'); // "25,00 €"
price.add(money('1', 'USD')); // compile error, and a runtime error if types are erased
```

Every method is also a free function of the same name (`add(price, fee)`, `allocate(m, [1, 1, 1])`), for pipelines and for code that prefers that style.

Status: this is a prototype. The API is meant to be small, but it is not yet frozen. See [What's missing](#whats-missing-honest-list).

---

## Design

### Representation: integer minor units in a JS number, with a bigint fallback

A `Money<C>` has three readonly fields:

| field                     | meaning                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `currency: C`             | ISO 4217 code (or a code registered with `defineCurrency`). It is a type parameter, so `Money<'EUR'>` and `Money<'USD'>` don't mix.                                                       |
| `minor: number \| bigint` | Integer count of 10^-scale units. It is a **number whenever it is a safe integer** (                                                                                                      | v   | ≤ 2^53−1) and a **bigint only beyond that**. The invariant is enforced everywhere, so ordinary amounts never allocate a bigint and huge amounts never lose a digit. |
| `scale: number`           | Decimal places. Defaults to the currency's ISO exponent (EUR 2, JPY 0, KWD 3, CLF 4). It can be larger for sub-minor precision (unit prices, FX intermediates). `round()` brings it back. |

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
- **Allocation is exact.** The parts always sum to the whole, and the remainder is distributed deterministically. This is property-tested across every remainder strategy, with weights up to 2^40 and amounts up to 10^25.
- **Currency mismatch** is a compile-time error for literal currency types (`add(eur, usd)`, `sum([eur, usd])`, `compare`, `exchangeRate(...).convert`). When types are erased (`Money<string>`) it is a runtime `CurrencyMismatchError`. `equals()` across currencies returns `false`.

---

## API

Everything is exported from `@ducatjs/money`, as methods on `Money` and as free functions. The processor views are in `@ducatjs/money/stripe`, `@ducatjs/money/adyen`, `@ducatjs/money/checkout`, `@ducatjs/money/paypal`, `@ducatjs/money/braintree` and `@ducatjs/money/klarna`, and the DB helpers in `@ducatjs/money/prisma`.

**Create**

- `money(amount: string | number | bigint, currency, { scale?, rounding? })`: the amount is in major units. A string is the recommended form. An integer number means major units (`money(12,'EUR')` is 12.00).
- `fromMinor(minor: number | bigint, currency, scale?)`: from cents, e.g. a BIGINT column.
- `zero(currency)`, `fromJSON({ amount, currency } | string)`, `isMoney(x)`

**Arithmetic.** All of these are immutable and return new values.

- `add`, `subtract`, `sum(list, currency?)`, `negate`, `abs`
- `multiply(m, factor, rounding?)`, `divide(m, divisor, rounding?)`
- `round(m, rounding, scale = ISO exponent)`, `toScale(m, scale, rounding?)`
- `percentage(m, percent, rounding?)`, `discount(price, percent, rounding?)`
- `addTax(net, percent, rounding?)` and `extractTax(gross, percent, rounding?)` both return `{ net, tax, gross }`, and net + tax is always exactly gross.
- `convert(m, to, rate, rounding?, { scale? })`, `exchangeRate(from, to, rate)` returns `.convert(m, rounding)` and `.inverse()`. Rates are decimal strings: `'1.0832'`.

**Compare**

- `compare` (returns −1, 0 or 1), `equals`, `lessThan`, `lessThanOrEqual`, `greaterThan`, `greaterThanOrEqual`
- `isZero`, `isPositive`, `isNegative`, `sign`, `min`, `max`, `clamp`

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
- The currency always comes from the argument and is never guessed from the text. A `parse(format(x)) == x` property test runs across 12 locales.

**Serialise**

- `toDecimal(m)` gives `"12.34"` for NUMERIC/DECIMAL and wire formats.
- `toMinor(m)` gives a bigint for BIGINT columns. `toMinorNumber(m)` gives a number and throws if it isn't safe.
- `JSON.stringify(m)` gives `{"amount":"12.34","currency":"EUR"}`, and `fromJSON` reverses it. The amount is a string so it survives JSON parsers that turn numbers into floats.

**Currencies**

- `currencyExponent(code)`, `isCurrency(code)`, `ISO_EXPONENTS`, `ISO_4217_PUBLISHED`
- `defineCurrency('BTC', 8)` adds a non-ISO code. To also get it in the `CurrencyCode` type, augment `interface CustomCurrencies`.

### Payment processors: the amount you send

```ts
import { toStripe, toStripeAmount, fromStripe } from '@ducatjs/money/stripe';
import { toAdyen, fromAdyen } from '@ducatjs/money/adyen';
import { toCheckout, fromCheckout } from '@ducatjs/money/checkout';
import { toPayPal, fromPayPal } from '@ducatjs/money/paypal';
import { toBraintree, fromBraintree } from '@ducatjs/money/braintree';
import { toKlarna, fromKlarna } from '@ducatjs/money/klarna';

toStripe(money('10.99', 'USD')); // { amount: 1099, currency: 'usd' }
toStripeAmount(money('5', 'ISK')); // 500     (Stripe: two-decimal value ending in 00)
toStripeAmount(money('10.45', 'HUF'), { payout: true }); // throws: payouts must be whole HUF
toStripeAmount(money('5.124', 'KWD'), { rounding: 'halfEven' }); // 5120 (last digit must be 0)
toAdyen(money('15000', 'IDR')); // { value: 15000, currency: 'IDR' }  (Adyen: IDR has 0 decimals)
toAdyen(money('5000', 'CLP')); // { value: 500000, ... }            (Adyen: CLP has 2 decimals)
toCheckout(money('5000', 'CLP')); // { amount: 500000, currency: 'CLP' } (Checkout.com: 2 decimals, must end in 00)
toCheckout(money('1.001', 'BHD')); // throws: Checkout.com needs the last digit 0
toPayPal(money('10.99', 'USD')); // { currency_code: 'USD', value: '10.99' }  (PayPal: exact decimal string)
toPayPal(money('1000', 'HUF')); // { currency_code: 'HUF', value: '1000' }  (PayPal: HUF takes no decimals)
toBraintree(money('5000', 'LAK')); // '5000'  (Braintree: LAK is zero-decimal; the merchant account sets the currency)
toKlarna(money('1000', 'HUF')); // 100000  (Klarna: ISO minor units, so HUF in fillér)
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
- `fromDecimal` rejects values with more decimals than the currency allows (e.g. `12.3456` in NUMERIC(19,4) for EUR) unless you pass `{ scale }` or `{ rounding }`. Trailing zeros are fine.

Prisma client extension (from `examples/prisma`, which runs end to end against SQLite):

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
  data: { ...toMinorColumns(total, 'totalMinor', 'currency'), shipping: toDecimalValue(fee, Prisma.Decimal) },
});
(await db.order.findFirstOrThrow()).total; // Money
```

`src/prisma.ts` does not import `@prisma/client`. It types Decimal structurally, as `{ toFixed(): string }`, so it also works with decimal.js and big.js. `examples/prisma/typecheck.ts` checks the helpers against Prisma's generated extension types.

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

- `npm run gen` (`scripts/gen-currencies.mjs`) turns these into `src/generated/*.ts`.
- `npm run gen:check` fails if the generated files are stale. It also runs inside the test suite.
- `npm run gen:fetch` downloads the live SIX list and diffs it against the snapshot (no differences on 2026-11-07).
- Tests assert every ISO exponent against the published list of non-2 exponents:
  - 0: BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF
  - 3: BHD IQD JOD KWD LYD OMR TND
  - 4: CLF UYW
- Tests also check the Adyen differences, the consistency of every Stripe rule, and that `format()` shows ISO digits for every code on every engine.

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

## Tests

`npm test` runs vitest: 171 tests in 9 files.

- Unit tests use real-world vectors:
  - the `java.math.RoundingMode` table for all modes
  - UK VAT 1/6 extraction, German 19% and 7% VAT
  - the HMRC 9.99 case, the classic `2.675` float trap
  - the allocation splits from Fowler and dinero
  - Stripe and Adyen doc examples, the statutory cash-rounding thresholds for SE, NO, DK, HU and CA
  - Intl output for de, fr, ja, ar and en-IN
- fast-check property tests cover:
  - `divRound` against an independent floor-based bigint oracle over the full safe range, including float-quotient edge cases
  - rounding-mode invariants (floor ≤ x ≤ ceil, half modes within ½)
  - add associativity, commutativity and identity, and agreement with bigint arithmetic
  - the number-iff-safe representation invariant
  - decimal, JSON and minor-unit round trips
  - multiply against exact rationals
  - allocation: sums are exact, each part is within one unit of its ideal share, results are deterministic, and largest-remainder order holds
  - instalment sums, tax breakdowns that add up
  - `parse(format(x))` across 12 locales
  - the Intl hand-off being bit-identical
- `npm run typecheck` compiles `test/types.ts`. Its `@ts-expect-error` lines prove that currency mismatch, readonly fields and unknown rounding modes are compile errors.
- `npm run test:runtimes` runs:
  - the **full suite on Node 22, Bun 1.4 (via `bun test`) and Deno 2.9**: all pass
  - a bundled smoke test on Node 22, Node 18, Bun, Deno and the **SpiderMonkey and JavaScriptCore shells** (installed with jsvu): all pass. On Node 18, `format()` of amounts above 2^53 is lossy (no Intl string input).

## Benchmarks (indicative only)

> These were run on a shared, noisy 4-vCPU Broadwell VPS. Runs are deliberately short, and run-to-run variation is ±20–30%, sometimes 2x. Use them to compare designs and libraries by order of magnitude, not as absolute numbers. To reproduce: `npm run bench` (writes `bench/RESULTS.md`).

ns per operation, this lib vs the fastest and slowest alternatives (full tables for all 7 libraries × 5 engines are in [bench/RESULTS.md](bench/RESULTS.md)):

| op                        | Node 22 (V8) | Bun (JSC) | SpiderMonkey |               best alternative (Node) | dinero.js 2 (Node) |
| ------------------------- | -----------: | --------: | -----------: | ------------------------------------: | -----------------: |
| add                       |       **21** |    **19** |       **46** |                            big.js 314 |               2275 |
| multiply 1.075, half-even |       **74** |    **60** |      **116** | currency.js 686 (float, half-up only) |               3533 |
| allocate [1,1,1]          |      **156** |   **230** |      **471** |                      currency.js 2579 |              10949 |
| parse "12345.67"          |      **106** |   **134** |      **116** |                            big.js 451 |  n/a (hand-rolled) |
| toDecimal                 |       **75** |   **111** |       **88** |                          ts-money 240 |               4548 |
| compare                   |        **7** |     **7** |       **21** |                currency.js 19 (float) |               1606 |
| format (Intl, en-US)      |         1531 |       784 |          684 |                       currency.js 940 |               3115 |

- On arithmetic, this library is 10–100x faster than dinero.js and the decimal libraries on every engine.
- It is on par with currency.js and ts-money on compare and format, but those two use floats.
- `format` is dominated by Intl itself (about 0.7–1.5 µs on every engine).
- Bundle size (esbuild, minified + gzip):
  - `money, add, multiply, toDecimal` alone: **3.1 kB**, of which about 1.3 kB is the ISO table
  - the whole library: **9.0 kB**
  - the same snippet with dinero.js (EUR only): 1.7 kB

---

## Decisions

- **JSON is a decimal string plus the currency, never minor units**: `{"amount":"12.34","currency":"EUR"}`. Minor units only mean something to a reader who knows the exponent, and the exponent isn't fixed:
  - Processors disagree with ISO. Stripe sends ISK and UGX as two-decimal; Adyen has its own exceptions.
  - ISO exponents change over time.
  - Generic consumers (other languages, `NUMERIC` and `Decimal` columns, logs) expect a decimal amount.

  Minor units remain available, but only through explicit, named conversions, where the owner of the exponent is known: `toMinor`, `toStripeAmount`, `toAdyenAmount`, and the BIGINT column helpers.

  Evidence from a comparison of the npm money libraries (2026-11): by default, `JSON.stringify` of 12.34 EUR gives minor units in dinero.js 2 (`{"amount":1234,"currency":{"code":"EUR","base":10,"exponent":2},"scale":2}`; with the bigint calculator it throws "Do not know how to serialize a BigInt"), dinero.js 1 (`{"amount":1234,"currency":"EUR","precision":2}`), js-money, ts-money and @screeny05/ts-money (`{"amount":1234,"currency":"EUR"}`, with no exponent, so the reader must know it) and monetra (`{"amount":"1234","currency":"EUR","precision":2}`). The decimal libraries and money-math give `"12.34"`, and bigint-money gives `["12.34","EUR"]`. Related dinero.js issues: #22 (`JSON.stringify` gave `{}`, then `toJSON` was debated), #636 (deserialising needs the full currency object from a dynamic code), and #771 (`allocate` hangs on a value deserialised at scale 19).

- **The package is called `ducat`.** The ducat was the Venetian gold trade coin, used across Europe for about 600 years.
- **Methods on `Money`**, because free functions alone are awkward to use: `price.add(fee).multiply('1.075').split(3)`. Each method is the free function of the same name, and the free functions stay exported. Operands are `Money` only, never bare numbers (monetra's `add(5)` means 5 minor units, a trap we avoid).
- **Default rounding is `'halfExpand'`** (ties away from zero) for arithmetic, the most common default. It is the default of decimal.js, Prisma.Decimal, big.js, bignumber.js and `Intl.NumberFormat`, and what currency.js, js-money and ts-money intend with `Math.round` (which differs for negative ties). The minority defaults: half-even (dinero.js 1, bigint-money), throw (monetra), truncate (dinero.js 2 `transformScale`). Parsing (`money('1.005','EUR')`, `fromDecimal`) and processor amounts (`toStripeAmount`, `toAdyen`) still throw unless a mode is passed, as ts-money and monetra do for input. The default is exported as `DEFAULT_ROUNDING`.
- **Stripe UGX is ×100.** Stripe's docs: "UGX transitioned to a zero-decimal currency, but backwards compatibility requires you to represent it as a two-decimal value, where the decimal amount is always 00. For example, to charge 5 UGX, provide an amount value of 500. You can't charge fractions of UGX. For invoices where the amount is fractional after prorations, coupons, or taxes, Stripe automatically rounds that amount to the nearest number evenly divisible by 100." That is what `toStripeAmount` encodes. An amount with fractional UGX throws unless a rounding mode is passed.
- **ESM only; Node ≥ 24.** Every supported Node can `require()` an ES module, so CommonJS callers still work, and a single build avoids the dual-package hazard: with separate CJS and ESM copies, `isMoney()` and `instanceof Money` fail across the two. Node 24 also formats exactly beyond 2^53 (Intl.NumberFormat v3). Browsers set the language floor, not Node: output targets ES2023.
- **Withdrawn and non-ISO codes** go in an opt-in `@ducatjs/money/historic` table (ANG, STD, BGN, HRK, ZWL, SLL, CUC, CNH, VEF…), with withdrawal dates.
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
- **The ISO table is always bundled** (about 1.3 kB gz). Per-currency imports like dinero's would make the minimum bundle smaller.
- **Minor-unit columns can't round-trip values with a non-ISO scale.** `toMinorColumns` refuses them by design. There is no `scale` column helper.
- **No docs site and no CI config yet.**
