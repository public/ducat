# About the representation

A `Money<C>` is an integer count of minor units, a scale and a currency. The integer is a JS number while it is a safe integer and a bigint beyond, so ordinary amounts stay on the engine's fastest path and very large ones never lose a digit. This page explains why ducat chose that over the alternatives, and what it costs. The fields and every operation on them are in the [reference](../reference/money.md); how exactness follows from this is in [About exactness](exactness.md).

## Integer minor units in a JS number, with a bigint fallback

A `Money<C>` has three readonly fields:

| field                     | meaning                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `currency: C`             | ISO 4217 code (or a code registered with `defineCurrency`). It is a type parameter, so `Money<'EUR'>` and `Money<'USD'>` don't mix.                                                                                                                                    |
| `minor: number \| bigint` | Integer count of 10^-scale units. It is a **number whenever it is a safe integer** (absolute value ≤ 2^53−1) and a **bigint only beyond that**. The invariant is enforced everywhere, so ordinary amounts never allocate a bigint and huge amounts never lose a digit. |
| `scale: number`           | Decimal places. Defaults to the currency's ISO exponent (EUR 2, JPY 0, KWD 3, CLF 4). It can be larger for sub-minor precision (unit prices, FX intermediates). `round()` brings it back.                                                                              |

Why this representation, based on `bench/designs.ts` (the same seven operations written four ways and run on five engines; full tables in [bench/RESULTS.md](https://github.com/public/ducat/blob/main/bench/RESULTS.md)):

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
