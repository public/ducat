# @ducatjs/money-spec

Language-neutral conformance vectors for [`@ducatjs/money`](../README.md): test cases as JSON, with
where each expected value came from, a JSON Schema, and the rules for running them. ducat's
TypeScript is the first implementation that runs them; the Rust port in [`rust/`](../rust) is the second
(`rust/crates/ducat/tests/spec.rs`).

The package is data only: no code and no dependencies. It is private for now, so the
repository's `spec/` directory is the only copy.

```
spec/
  README.md                    this file: the format and how to run it
  schema/vectors.schema.json   JSON Schema (draft 2020-12) for every vector file
  vectors/<area>/<name>.json   the vectors, one area per directory
```

| area         | file                    | cases | source             | what it covers                                                                                  |
| ------------ | ----------------------- | ----: | ------------------ | ----------------------------------------------------------------------------------------------- |
| `core`       | `battery.json`          |    41 | hand               | the cross-library battery: exponents, allocation, tax, ties, 2^53, mismatches                   |
| `fixed`      | `battery.json`          |    28 | hand               | the same checks for plain decimals, without currencies                                          |
| `allocate`   | `allocate-lean.json`    | 1,500 | Lean               | allocation by weights, every remainder strategy                                                 |
| `allocate`   | `instalments-lean.json` | 1,200 | Lean               | instalments with a unit, every remainder strategy                                               |
| `allocate`   | `chunk-lean.json`       | 1,200 | Lean               | tranches of at most a maximum                                                                   |
| `allocate`   | `schedule-lean.json`    | 1,500 | Lean               | fixed, percentage and rest tranches, and the ones that fail                                     |
| `cash`       | `increment-lean.json`   | 1,500 | Lean               | rounding to an increment, every rounding mode                                                   |
| `cash`       | `rules.json`            |   514 | reference data     | the cash-rounding rules by currency and country, and amounts rounded through them               |
| `processors` | `rules.json`            | 2,372 | reference data     | each payment processor's exponents and multiples, and amounts to and from its API               |
| `wire`       | `formats.json`          |   610 | Python `fractions` | google.type.Money, ISO 20022 amounts, ISO minor units and dinero.js objects, both ways          |
| `currency`   | `data.json`             | 1,367 | reference data     | ISO exponents and numeric codes, historic codes, CLDR cash fractions, territories, crypto units |
| `excel`      | `xnpv-lean.json`        |   120 | Lean               | XNPV's exact bounds and its rounded value in every mode                                         |
| `excel`      | `xirr-lean.json`        |    35 | Lean               | XIRR floored to a number of digits, or no root                                                  |
| `rounding`   | `pydecimal.json`        |   750 | Python `decimal`   | multiply, divide and rescale, every rounding mode                                               |
| `convert`    | `pydecimal.json`        |   250 | Python `decimal`   | conversion at a rate, every rounding mode                                                       |
| `convert`    | `rates-fractions.json`  |   600 | Python `fractions` | rate inverses and chains, and converting through a chain with the residual                      |
| `convert`    | `sources.json`          |   393 | reference data     | the rate-source parsers on spec/fixtures/, quoted rates, dated lookups, Stripe and Adyen rates  |
| `convert`    | `providers.json`        | 1,434 | Python `fractions` | rate metadata and its JSON, validity at UTC day boundaries, rate providers, multi-currency bags |
| `exact`      | `fractions.json`        | 1,000 | Python `fractions` | exact amounts: divide and round with the residual, exact decimals, tax, multiply                |
| `tax`        | `pydecimal.json`        | 1,000 | Python `decimal`   | percentages, discounts, adding and extracting tax                                               |
| `finance`    | `fractions.json`        | 2,420 | Python `fractions` | day counts, interest, amortisation, proration, NPV and IRR                                      |
| `finance`    | `exact-fractions.json`  |   300 | Python `fractions` | exact simple interest and exact discounted sums                                                 |
| `rounding`   | `policy-fractions.json` | 1,050 | Python `fractions` | rounding policies in multiply, divide, round, convert, tax and exact amounts                    |
| `pricing`    | `fractions.json`        |   300 | Python `fractions` | retail price endings, and graduated and volume tiered pricing                                   |
| `math`       | `fractions.json`        |   750 | Python `fractions` | averages, shares, integral division, trimming the scale, exact ratio arithmetic                 |
| `excel`      | `fractions.json`        |   757 | Python `fractions` | FV, PV, PMT, NPER, RATE, XNPV and XIRR, with Calc's edge cases                                  |
| `excel`      | `libreoffice-calc.json` | 1,943 | LibreOffice Calc   | the same functions in doubles, and RRI and EFFECT, with the shared edge cases                   |
| `excel`      | `microsoft.json`        |    23 | Microsoft's pages  | the worked examples on Excel's function pages                                                   |
| `words`      | `rbnf.json`             | 2,808 | ICU 79.1           | numbers spelled out by ICU on its own CLDR 49 data, each language's main rule sets              |
| `words`      | `rbnf-data.json`        | 4,096 | ICU 74.2           | the same on the CLDR 49 rule text ducat ships, for the other public rule sets                   |

The other areas the schema names (`format`, `parse`) have no vectors yet.

The General Decimal Arithmetic test cases (decTest), which `test/dectest.test.ts` runs, aren't in
the suite: they are IBM's copyright, so `scripts/fetch-dectest.mjs` downloads them at test time
instead of the repository holding a copy.

## Running the suite

An implementation runs every file the same way:

1. Validate the file against `schema/vectors.schema.json`. A file that fails is an error, not a
   skip.
2. For each case, look up its `op`. An operation the implementation doesn't know is an error: a
   runner that silently skips cases proves nothing.
3. Build the arguments from `args`, call the operation, and compare what it returns, or the error
   it raises, with `expect` (see [Expectations](#expectations)).

ducat's runner is `test/spec.test.ts`. It also counts the cases in each area, so a lost vector
fails the build. And it changes one expected value in one row of every table it checks, to show
that the check can fail.

## How a port uses the suite

A port of ducat to another language would use the suite like this:

1. **Take the version that matches.** The spec's major and minor follow ducat's (see
   [Versions](#versions)). A port of ducat 0.4 runs spec 0.4.x, from this directory, or from a
   published copy if there is one later.
2. **Validate every file** with any JSON Schema 2020-12 validator, before running anything.
3. **Map each operation to the port's API.** There is one function per case operation
   ([Operations](#operations)) and one per table operation ([Table operations](#table-operations)),
   each taking the documented arguments.
4. **Map the port's errors** onto the five kinds (`rounding`, `currency-mismatch`, `range`,
   `syntax`, `type`).
5. **Judge results as the spec says**: money by amount, currency and scale; plain decimals by
   value; and each table field by its stated rule.
6. **Fail on anything unknown.** An unknown operation, expectation or error kind is a failure,
   never a skip. Count the cases per area, so a file that goes missing is noticed.

The two battery files (`core/battery.json` and `fixed/battery.json`, 69 cases) are a good first
target. They use only the basic operations, with no generated data and no tables.

A port's runner, in pseudo-code:

```text
MODES = { "halfEven": ROUND_HALF_EVEN, "halfExpand": ROUND_HALF_UP, ... }

def money_of(m):                      # { amount, currency, scale }
    return Money(Decimal(m.amount), m.currency, scale=m.scale)

def as_spec(result):                  # the port's Money as the spec writes one
    return { amount: result.to_decimal_string(), currency: result.currency, scale: result.scale }

CASE_OPS = {
    "money.multiply": lambda a: money_of(a.money).multiply(Decimal(a.factor), MODES[a.mode]),
    "money.add":      lambda a: money_of(a.first).add(money_of(a.second)),
    ...                                 # one entry per operation in the schema
}

def kind_of(error):                   # the port's errors as the spec's kinds
    if error is a RoundingNeeded:     return "rounding"
    if error is a CurrencyMismatch:   return "currency-mismatch"
    ...

for path in every file under spec/vectors:
    doc = read_json(path)
    check_against_schema(doc, "spec/schema/vectors.schema.json")
    for case in doc.cases (if any):
        run = CASE_OPS[case.op]         # a missing key is a failure, not a skip
        alternatives = case.expect.anyOf or [case.expect]
        try:
            result = run(case.args)
        except PortError as error:
            assert kind_of(error) in [e.error for e in alternatives if e.error]
            continue
        assert any(meets(result, e) for e in alternatives if not e.error)
    for table in doc.tables (if any):
        check_row = TABLE_OPS[table.op]
        for row in table.rows:
            assert check_row(row, table.parameters or {})
```

Here `meets` compares as [Expectations](#expectations) says. For the case `half-even` above, it
runs `Money("0.25", "EUR", scale=2).multiply("0.5", ROUND_HALF_EVEN)` and compares
`{ "amount": "0.12", "currency": "EUR", "scale": 2 }` field by field.

## A vector file

```json
{
  "format": 1,
  "area": "core",
  "name": "battery",
  "description": "What the file covers.",
  "provenance": {
    "source": "hand",
    "generator": null,
    "method": "How the expected values were found.",
    "data": { "iso4217": "2026-09-17" }
  },
  "checkedAgainst": "0.4.0",
  "cases": [
    {
      "id": "half-even",
      "group": "rounding",
      "description": "0.25 × 0.5 = 0.125 → half-even 0.12",
      "op": "money.multiply",
      "args": {
        "money": { "amount": "0.25", "currency": "EUR", "scale": 2 },
        "factor": "0.5",
        "mode": "halfEven"
      },
      "expect": { "money": { "amount": "0.12", "currency": "EUR", "scale": 2 } }
    }
  ]
}
```

- `id` is unique within its file. `group` and `description` are for people.
- `checkedAgainst` is the ducat version whose implementation passed every case when the file
  last changed (see [Versions](#versions)).

### Two layouts: cases and tables

A file has either `cases` or `tables`, never both.

- **Cases** (above) suit hand-written vectors: each case names its operation, its arguments and
  one expectation.
- **Tables** suit generated vectors, thousands of rows of the same operation, where one row often
  checks several results (one per rounding mode, say). A table names one table operation, and each
  row holds that operation's inputs and expected results under the field names the operation
  defines:

```json
{
  "format": 1,
  "area": "rounding",
  "name": "increment",
  "description": "…",
  "provenance": { "source": "lean", "generator": { "name": "…", "version": "…" }, "method": "…" },
  "checkedAgainst": "0.4.0",
  "contentSha256": "…",
  "tables": [
    {
      "op": "…",
      "rows": [
        { "amount": "-80132596", "step": "50", "halfEven": "-80132600", "trunc": "-80132550" }
      ]
    }
  ]
}
```

`contentSha256`, when a generator stamps its output, is the SHA-256 of the cases' or rows' text as
the generator wrote it, so an edit by hand is caught. A table may also say where its rows come
from (`source`, such as a documentation page). Each table operation's row fields are documented
with the operation, and the schema checks them.

### Values

Nothing in a file needs a particular language to read it. Above all, no amount is ever a JSON
number:

- **Decimal:** a string of an optional `-`, digits and an optional fraction: `"-12.340"`. There is
  no exponent and no `+`.
- **Money:** `{ "amount": "1.000", "currency": "KWD", "scale": 3 }`. The amount is written with
  exactly `scale` fraction digits. The currency is an ISO 4217 code, and the scale is part of the
  value: JPY has scale 0, KWD 3, and an operation's result has the scale its definition gives it.
- **Minor units:** an integer string, `"9223372036854775807"`, since minor units go beyond 2^53.
- **Binary64 input:** `{ "binary64": "0.30000000000000004", "exact": "0.3000000000000000444…" }`.
  `binary64` is the double's shortest round-trip form (parse it as an IEEE 754 double). `exact` is
  that double's exact decimal value. Cases that use it check what an API does with a
  floating-point argument.
- **Counts, scales and weights** are small JSON integers.
- **Rational:** a decimal, or `"numerator/denominator"` with a positive denominator:
  `"-1329887967/1000"`. Used where a result is an exact fraction.
- **Interval:** an irrational result given exactly, as rationals `{ "lower": "…", "upper": "…" }`
  with lower ≤ value ≤ upper, and `"exact": true` when both are the value itself (XNPV's bounds).
  Most irrational results in the files are instead a floor on a grid: the value floored to
  `digits` places, as an integer string (a rate, a period count, XIRR). Each operation says how its
  results are judged. The schema also allows an interval a `tolerance`, but no file uses one yet.

### Rounding modes

Rounding modes have the names of ECMA-402's `roundingMode`, plus `unnecessary`:

| name         | rounds                          |     | name          | rounds                                         |
| ------------ | ------------------------------- | --- | ------------- | ---------------------------------------------- |
| `halfEven`   | to nearest, ties to even        |     | `expand`      | away from zero                                 |
| `halfExpand` | to nearest, ties away from zero |     | `trunc`       | toward zero                                    |
| `halfTrunc`  | to nearest, ties toward zero    |     | `ceil`        | toward +∞                                      |
| `halfCeil`   | to nearest, ties toward +∞      |     | `floor`       | toward −∞                                      |
| `halfFloor`  | to nearest, ties toward −∞      |     | `unnecessary` | never: an inexact result is a `rounding` error |

### Operations

Each operation rounds at most once, to the scale named, from the exact result.

| op                            | args                                               | returns                                                                             |
| ----------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `currency.exponent`           | `currency`                                         | the currency's ISO 4217 minor unit, as an integer                                   |
| `money.fromMinor`             | `minor`, `currency`                                | the money with that many minor units, at the currency's scale                       |
| `money.fromDecimal`           | `amount` (decimal), `currency`                     | the money at the currency's scale; more digits than that is a `rounding` error      |
| `money.fromBinary64`          | `value` (binary64), `currency`                     | the money for a floating-point amount                                               |
| `money.roundTrip`             | `money`                                            | the money built from `money`, unchanged                                             |
| `money.add`, `money.subtract` | `first`, `second` (money)                          | the sum or difference; different currencies are a `currency-mismatch` error         |
| `money.multiply`              | `money`, `factor` (decimal), `mode`                | money × factor, rounded to the money's scale                                        |
| `money.divide`                | `money`, `divisor` (decimal), `mode`               | money ÷ divisor, rounded to the money's scale                                       |
| `money.convert`               | `money`, `to` (currency), `rate` (decimal), `mode` | money × rate in `to`, rounded to `to`'s scale                                       |
| `money.split`                 | `money`, `count`                                   | `count` parts that sum to the money, differing by at most one minor unit            |
| `money.allocate`              | `money`, `weights`                                 | one part per weight, in order, summing to the money                                 |
| `money.allocate.generated`    | `currency`, `count`, `generator`, `draws`          | allocations drawn from a seeded generator (see [Generated cases](#generated-cases)) |
| `money.compare`               | `first`, `second` (money)                          | −1, 0 or 1                                                                          |
| `money.equals`                | `first`, `second` (money)                          | whether they are the same amount of the same currency                               |
| `fixed.roundTrip`             | `value` (decimal)                                  | the decimal, unchanged                                                              |
| `fixed.add`                   | `first`, `second` (decimal)                        | the exact sum                                                                       |
| `fixed.multiply`              | `value`, `factor`, `scale`, `mode`                 | value × factor, rounded once to `scale` digits                                      |
| `fixed.divide`                | `value`, `divisor`, `scale`, `mode`                | value ÷ divisor, rounded once to `scale` digits                                     |
| `fixed.round`                 | `value`, `scale`, `mode`                           | the value rounded to `scale` digits                                                 |
| `fixed.compare`               | `first`, `second` (decimal)                        | −1, 0 or 1                                                                          |

### Expectations

`expect` has exactly one key:

| key             | passes when                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `money`         | the result has this amount, currency and scale: all three                  |
| `moneyList`     | the parts are these, in this order (amount, currency and scale each)       |
| `moneyMultiset` | the parts are these in some order                                          |
| `sumOfParts`    | the parts sum to this money (the parts themselves aren't specified)        |
| `decimal`       | the result equals this decimal as a number: `"1.5"` and `"1.50"` are equal |
| `integer`       | the result is this integer                                                 |
| `boolean`       | the result is this boolean                                                 |
| `error`         | the operation raises an error of this kind, and returns nothing            |
| `property`      | the named property holds (see [Generated cases](#generated-cases))         |
| `anyOf`         | any one of the listed expectations passes                                  |

**Stricter than before.** The battery was a TypeScript table before it became these files, and it
judged ducat as it judges every other library: amounts compared by value, and any error accepted
where one was expected. The files are stricter: a money result must also have the right currency
and scale, and an error must be of the stated kind. `test/spec.test.ts` holds ducat to that. The
cross-library comparison in `compare/` keeps the looser judgement, since other libraries have no
scales or error kinds to compare.

**Equality.** Money is equal only when amount, currency and scale all match: `"1.50"` EUR at scale
2 is not `"1.5"` at scale 1, because the scale is part of what the operation promises. Plain
decimals (`decimal`, used for the `fixed` operations) compare by numeric value, since the scale of
a plain decimal result is the implementation's choice.

**Errors** are neutral kinds. Each language maps its own errors onto them:

| kind                | means                                                               | ducat (TypeScript)      |
| ------------------- | ------------------------------------------------------------------- | ----------------------- |
| `rounding`          | the exact result doesn't fit the scale, and rounding wasn't allowed | `RoundingError`         |
| `currency-mismatch` | the operands have different currencies                              | `CurrencyMismatchError` |
| `range`             | an argument is out of range                                         | another `RangeError`    |
| `syntax`            | text that doesn't parse                                             | `SyntaxError`           |
| `type`              | an argument of the wrong kind                                       | another `TypeError`     |

### Generated cases

A `money.allocate.generated` case describes many allocations by the generator that draws them,
rather than listing them. The generator is a linear congruential generator in exact integer
arithmetic (the product exceeds 2^53, so use 64-bit or arbitrary-precision integers, never
doubles):

```
state = seed
draw(limit, offset):
    state = (state × multiplier + increment) mod modulus
    return (state mod limit) + offset
```

The `draws` say what each allocation takes, in order: `minor` (the amount in minor units of
`currency`), `weightCount`, then `weights`, drawn `weightCount` times. `count` allocations are
drawn one after another from the same state. The battery's first allocation, from seed 12345, is
306932606 minor units by the 7 weights 925, 574, 179, 460, 193, 794 and 311.

The property `allocation-within-one-unit` holds when, for every allocation of the amount `A`
(minor units) by weights `w` with total `W`, the parts `p` sum to `A`, have the currency's scale,
and each satisfies `|p × W − A × w| ≤ W`: every part is within one minor unit of its exact share.

A correct allocator satisfies the property for any seed, so the property alone doesn't show that a
port draws the same allocations. The first draw above does: ducat's runner checks it, and a port
should too.

## Table operations

Each table operation names the fields of its rows. Unless a row has a `currency`, its amounts are
integer strings of minor units of a currency with scale 2 (the Lean models work in integers, and
EUR serves). `null` where a result is expected means the operation raises an error of the kind
given.

| op                        | inputs                                         | expected                                                                                                         |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `allocate.byRemainder`    | `amount`, `weights` (integer strings ≥ 0)      | the parts, in order, for each remainder strategy: `largest`, `first`, `last`, `toFirst`, `toLast`                |
| `instalments.byRemainder` | `total`, `count`, `unit`                       | the `count` instalments for each strategy: `first`, `last`, `toFirst`, `toLast`                                  |
| `chunk`                   | `total`, `max`                                 | `chunks`: every one `max` but the last, which is positive; `[0]` for a zero total                                |
| `schedule`                | `total`, `tranches`                            | `result`: one part per tranche, or `null` (`range`)                                                              |
| `roundToIncrement.byMode` | `amount`, `step`                               | the multiple of `step` for each rounding mode, by its name, or `null` (`rounding`, for `unnecessary`)            |
| `xnpv.scaled`             | `currency`, `rate`, `days`, `values`, `digits` | `bounds` (an interval in major units, or `null`: `range`) and `rounded` (minor units by rounding mode)           |
| `xirr.floor`              | `currency`, `days`, `values`, `digits`         | `lower`: the rate floored to `digits` places, as an integer string scaled by 10^digits, or `null` (`range`)      |
| `minor.multiply`          | `currency`, `minor`, `mode`, `factor`          | `want`: minor × factor, rounded once to the currency's scale                                                     |
| `minor.divide`            | `currency`, `minor`, `mode`, `divisor`         | `want`: minor ÷ divisor, rounded once to the currency's scale                                                    |
| `minor.toScale`           | `currency`, `minor`, `mode`, `scale`           | `want`: the amount rounded to `scale` digits, in units of 10^−scale                                              |
| `minor.convert`           | `currency`, `minor`, `mode`, `to`, `rate`      | `want`: amount × rate in `to`, rounded once to `to`'s scale                                                      |
| `minor.percentage`        | `currency`, `minor`, `mode`, `percent`         | `want`: amount × percent / 100, rounded once                                                                     |
| `minor.discount`          | `currency`, `minor`, `mode`, `percent`         | `want`: the amount less its rounded percentage                                                                   |
| `minor.addTax`            | `currency`, `minor`, `mode`, `percent`         | `tax`: the rounded percentage of the net amount; `gross`: net + tax                                              |
| `minor.extractTax`        | `currency`, `minor`, `mode`, `percent`         | `net`: gross ÷ (1 + percent / 100), rounded once; `tax`: gross − net                                             |
| `exact.divideRound`       | `currency`, `minor`, `divisor`, `mode`         | `rounded`: amount ÷ divisor rounded once to the currency's scale, in minor units; `residual`: the rest           |
| `exact.toMoney`           | `currency`, `num`, `den`                       | `money`: num/den major units at the smallest scale (at least the exponent) that holds it, or `null` (`rounding`) |
| `exact.addTax`            | `currency`, `minor`, `percent`                 | `tax`: amount × percent / 100 exactly; `gross`: amount + tax                                                     |
| `exact.extractTax`        | `currency`, `minor`, `percent`                 | `net`: amount ÷ (1 + percent / 100) exactly; `tax`: amount − net                                                 |
| `exact.multiplyExact`     | `currency`, `minor`, `factor`                  | `want`: amount × factor at the smallest scale (at least the amount's) that holds it, or `null` (`rounding`)      |
| `rate.inverse`            | `rate`                                         | `inverse`: 1 / rate                                                                                              |
| `rate.chain`              | `via`, `rates`                                 | `composite`: the product of the rates, `rates[i]` taking `via[i]` to `via[i + 1]`                                |
| `rate.convert`            | `via`, `rates`, `minor`, `mode`                | `want`: minor units of `via[0]` through the chain, rounded once to the last currency's scale; `residual`         |

In the `exact.*` and `rate.*` rows, every rational result (`residual`, `tax`, `gross`, `net`, `inverse`,
`composite`) is written reduced, as `num/den` or the integer alone, and in major units; a residual is the exact
value minus the rounded one, so the two add up to it. `minor`, `num` and `den` are integer strings.

In the `minor.*` rows, `minor` is the amount in minor units of `currency` at its ISO 4217 scale
(JPY 0, EUR 2, KWD 3, CLF 4), and every result is in minor units of the result's scale.

**How results are judged.** Unless an operation says otherwise below, every expected field must
equal the result exactly, as text (integer strings, fractions and `null` alike).

### Rounding policies, pricing and math tables

The tables in `rounding/policy-fractions.json`, `pricing/fractions.json` and `math/fractions.json`
follow the definitions in ducat's reference (`docs/reference/policy.md`, `pricing.md`, `math.md`).
An `amount` is a decimal in major units of the row's `currency` at the scale its fraction digits
give (`"12.340"` is scale 3). Every expected field is judged exactly, as text: a decimal result
is written with exactly the scale its definition gives it, and a rational result as reduced
`num/den` or the integer alone.

A `policy` is ducat's `roundingPolicy` options: `increment` (a positive integer count of
10^−scale units), `rounding` (a mode), and optionally `scale` (default: the currency's exponent)
and `currency`. A policy rounds an exact value once, to the nearest multiple of
`increment` × 10^−scale by its mode; a policy whose `currency` isn't the amount's (for `policy.convert`,
the target's) is a `currency-mismatch` error, written `null` in the `policy.*` rows.

| op                      | expected fields and how each is judged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `policy.multiply`       | `want`: `amount` × `factor`, rounded once by `policy`, at the policy's scale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `policy.divide`         | `want`: `amount` ÷ `divisor`, rounded once by `policy`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `policy.round`          | `want`: `amount` rounded once by `policy`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `policy.convert`        | `want`: `amount` × `rate` in the currency `to`, rounded once by `policy` (its scale defaulting to `to`'s exponent, its currency checked against `to`)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `policy.tax`            | `percentage`: `amount` × `percent` / 100 rounded by `policy`; `discount`: `amount` × (1 − `percent` / 100) rounded by `policy`; `addTax`: the gross `amount` × (1 + `percent` / 100) rounded by `policy`, and `tax` = gross − `amount` exactly; `extractTax`: the net `amount` ÷ (1 + `percent` / 100) rounded by `policy`, and `tax` = `amount` − net exactly. A difference has the larger of the two scales                                                                                                                                                                         |
| `policy.exactRound`     | `want`: the exact amount `num` / `den` rounded once by `policy`; `residual`: the exact amount minus `want`, rational                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `policy.check`          | `valid`: whether `amount` is exactly what `policy` produces (ducat's `assertScale`): at the policy's scale and a whole number of increments                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pricing.priceEnding`   | `want`: `amount` moved to the nearest allowed price `ending` + k × `step` by `mode` applied to the count of steps, (`amount` − `ending`) / `step`, at `amount`'s scale; `null` (a `range` error) when `ending` or `step` has more decimals than `amount`                                                                                                                                                                                                                                                                                                                              |
| `pricing.tiered`        | `total` (minor units at the currency's exponent), `exact` (rational) and `lines` (each tier reached: its index `tier`, its `quantity` as a decimal or `num/den`, its `exact` charge, and its `amount` in minor units, each the rounded running total less the one before) of `quantity` priced by `tiers` in `mode`, rounded once by `rounding`; `null` (a `range` error) for a quantity past a bounded last tier without `beyondLastTier: "cap"`. Tier bounds are inclusive, quantity 0 is in the first tier, and a tier's `unitAmount` and `flatAmount` are decimals in major units |
| `math.average`          | `want`: the exact sum of `amounts` divided by their count, rounded once by `mode` at the largest scale among them                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `math.ratioOf`          | `ratio`: `amount` / `other`, rational; `null` (a `range` error) when `other` is zero                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `math.divideToIntegral` | `quotient`: `amount` / `divisor` truncated toward zero, an integer string; `remainder`: `amount` − `divisor` × `quotient`, at the larger scale, with `amount`'s sign; both `null` (a `range` error) for a zero divisor                                                                                                                                                                                                                                                                                                                                                                |
| `math.trimScale`        | `want`: `amount` at the smallest scale that keeps it exact, but not below `minimumScale` (default: the currency's exponent), and never above its own                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `math.ratio`            | for two rationals `left` and `right`: `sum`, `difference`, `product`, `quotient` (`null`, a `range` error, when `right` is zero), `negation` and `complement` (1 − `left`), all rational; `compare`: −1, 0 or 1 as `left` is less than, equal to or greater than `right`                                                                                                                                                                                                                                                                                                              |

### Currency data and cash tables

The tables in `currency/data.json` and `cash/rules.json` are read from ducat's `data/` by
`scripts/gen-currency-data-vectors.py`, which doesn't use ducat's generator. A currency can have
three figures, and each is its own field, never derived from another:

- its **ISO 4217 exponent**, the scale of its amounts (List One; `null` for the N.A. codes such as
  XAU). A withdrawn code has the exponent ISO gave it while it was current (`data/historic.json`);
- **CLDR's** display and cash digits (`data/cldr-cash.json`). That file holds only the currencies
  CLDR cash-rounds, so `null` means "not in the data", not "the same as the exponent";
- its **cash rule** (`data/cash-rounding.json`), with its step in the currency's ISO minor units.

A withdrawal date is the latest date in List Three's entry (a month, a year, or a range such as
`1990-07 to 1990-09`, compared as text); a code withdrawn in several entries takes the entry with the
latest date, and the first of two that tie. Every expected field is judged exactly, as JSON.

| op                     | expected fields and how each is judged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `currency.figures`     | for `code`: `iso` (`exponent`, `null` for N.A., and `numeric`) or `null` when List One doesn't have it; `historic` (`exponent`, `name`, `numeric`, `withdrawn`; `null` numeric and date for non-ISO codes such as CNH) or `null`; `cldr` (`digits`, `cashDigits`, `cashRounding`) or `null`; `cash`, its cash rules in table order (each as `cash.rule`'s `rule`), `[]` without one; `minorUnit`, the size of the minor unit in major units, for an active code with an exponent, else `null`                                                                                                                                                                                                                |
| `currency.fromNumeric` | `currency`: the active code with the numeric code `numeric` (text, trimmed; `"8"` and `"008"` are ALL), `null` for a number ISO doesn't assign, `"throws"` (a `range` error) for text that isn't one to three digits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `territory.currencies` | `currencies`: what `territory` used, newest first, each `{ currency, from, to, tender }` (`null` days where CLDR gives none); without `includeNonTender`, only legal tender; with `on`, only those in use that day (an unknown start counts as always). `null` (a `range` error) for an `on` that isn't `YYYY-MM-DD`                                                                                                                                                                                                                                                                                                                                                                                         |
| `currency.territories` | `territories`: the territories that used `currency`, in code order, with the same `on` and `includeNonTender` rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `crypto.unit`          | `unit`: the crypto table's entry for `code` (`name`, `decimals`, `baseUnit`, `network`, `contract`), or `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `crypto.toBaseUnits`   | `baseUnits`: `amount` (a decimal at its own scale) in base units, 10^−decimals; `null` (a `rounding` error) when it isn't a whole number of them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `crypto.fromBaseUnits` | `amount`: `units` base units at the currency's decimals; `null` (a `syntax` error) unless `units` is an integer with an optional minus sign and no leading zeros                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `cash.rule`            | for `currency` (and `country`, and `includeUnverified`, default true): `rule` (`increment` in ISO minor units, `countries`, `verified`, and `rounding`, the tie rule, `halfExpand` unless the source says otherwise) or `null`; `cashUnit`, the step in major units at the exponent (the minor unit without a rule); `cashDigits`, 0 when the step is whole units, else the exponent; `policy` (`scale` the exponent, `increment`, `rounding`), `null` (a `range` error) without a rule. Without a country, the currency's first rule applies, except for EUR, which has none euro-wide; with one, the first rule that lists it. A rule with `verified: false` doesn't apply with `includeUnverified: false` |
| `cash.round`           | `cashRound`: `amount` rounded to a multiple of the rule's step, ties by `rounding` (or the rule's), at the larger of its scale and the exponent, or unchanged without a rule; `policy`: the same through the cash policy, at the exponent, `null` (a `range` error) without a rule                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Payment-processor tables

`processors/rules.json` holds each processor's rules from ducat's `data/` (`stripe`, `adyen`,
`checkout`, `paypal`, `braintree`, `klarna`), as `scripts/gen-processor-vectors.py` reads them,
independently of ducat's generator, and the definitions in ducat's processor docs. `processor` names
one of them. Stripe, Adyen, Checkout.com and Klarna take an integer at the processor's exponent;
PayPal and Braintree a decimal string in major units. `amount` is a decimal at the scale its fraction
digits give. Every field is judged exactly, as JSON; `error` names the kind of error, or is `null`.

- **Exponents and multiples:** the processor's own, not ISO 4217's where they differ. Stripe: two
  decimals unless zero- or three-decimal, its special cases' API exponents, ISK and UGX a multiple of
  100 (two-decimal values ending in 00), HUF and TWD payouts a multiple of 100, three-decimal
  currencies a multiple of 10. Adyen: its table. Checkout.com: its listed exponents, 2 for the
  others, its payment multiples (CLP 100, three-decimal 10) and the Standalone API's (CLP 1).
  PayPal, Braintree and Klarna: their listed exponents, ISO's for the others. Codes are read
  case-insensitively, except by Adyen.
- **To the processor:** the amount is rescaled to the processor's exponent, rounding once with
  `rounding` when that loses digits, then made a multiple of the multiple (the payout's for Stripe
  with `payout`, the Standalone API's for Checkout.com with `standalone`), rounding once again with
  it. Without `rounding` (`unnecessary`) either step that would round is a `rounding` error. The
  sign is checked after rounding: Checkout.com and PayPal refuse negatives, Braintree zero and
  negatives (`range`). An integer beyond 2^53 − 1, and more than 15 digits before PayPal's point,
  are `range` errors, as is a currency the processor doesn't list.
- **From the processor:** the amount at the currency's exponent when that is exact, else at the
  scale it came with (the processor's exponent, or the string's fraction digits), so extra
  precision is kept. PayPal's strings match `^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$` and are at most
  32 characters; Braintree's `^[0-9]+(\.[0-9]+)?$`; anything else is a `syntax` error.

| op                   | expected fields and how each is judged                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `processor.rule`     | for `currency`: `exponent`, `multiple` (Stripe's charge, Checkout.com's payment, else 1) and `contextMultiple` (Stripe's payout, Checkout.com's Standalone API, else `multiple`), all `null` when the processor doesn't list it |
| `processor.toWire`   | `wire`: the processor's amount for `amount` in `currency` (an integer string, or PayPal's and Braintree's decimal string), with `payout`, `standalone` and `rounding` where given; `null` with `error` `rounding` or `range`    |
| `processor.fromWire` | `amount`: the money a processor's `wire` amount in `currency` is; `null` with `error` `range` (an unlisted currency) or `syntax` (a string outside the format)                                                                  |

### Rate metadata, providers and bags

`convert/providers.json` holds ducat's rates with their metadata, its rate providers and its
multi-currency bags, as `scripts/gen-rate-provider-vectors.py` models them from ducat's convert
reference with Python's `fractions` and `datetime`, independently of ducat. A rate is given as
`exchangeRate(from, to, rate, info)` takes it (`rateSpec`), and expected rates in the JSON form
`toJSON` writes (`rateJson`), whose fields are in that order: `from`, `to`, `rate`, `source`,
`asOf`, `availableAt`, `validUntil`, `type`, `quote` (only when it has a `per` or is `inverted`)
and `derivedFrom`. Every field is judged exactly, as JSON; `error` names the outcome
(`unavailable`, `expired`, `rounding`, `mismatch` or `range`), or is `null`.

- **Rate text:** a published decimal keeps its digits when its canonical form would drop trailing
  zeros (`1.10`, `136.80`); otherwise a rate prints as its exact decimal (`01.50` is `1.5`), or as
  `num/den` when that doesn't terminate. A rounded rate prints canonically.
- **Quotes** are a published positive price for a positive whole number of units, and must
  describe their rate exactly: the rate is `quote ÷ per`, or `per ÷ quote` when `inverted` (`per`
  defaults to 1). A rate with a quote whose number isn't positive, whose `per` isn't a positive
  integer (whatever the signs: a negative number over a negative `per` is refused too), or that
  doesn't describe the rate is refused when it is built (`range`), so its inverse, which flips
  `inverted`, always describes its rate too. The error rows carry such a `per`, including a
  fractional one: the one place a JSON number in these files isn't a small integer, which a port
  must refuse (as ducat does) rather than read.
- **Times:** a date or an instant (`rateTime`); an instant is stored as UTC to the millisecond
  (`2026-11-06T15:00:00.000Z`), a date as given. A date counts as the start of its UTC day for
  `asOf`, `availableAt` and a lookup's start, and as the whole day for `validUntil` and for a date
  `at`: a date `validUntil` is valid through 23:59:59.999Z. An instant `validUntil` is valid at
  itself. Every time in the file is one of these unambiguous forms.
- **Derived rates:** `inverse`, `andThen`, `withMargin` and `round` record their inputs in
  `derivedFrom` and drop `source`. A chain takes the oldest `asOf`, the latest `availableAt` and the
  `validUntil` that ends first, compared as times (the instant form on a tie). `inverse` swaps `bid`
  and `ask` and marks or unmarks the quote as inverted; `andThen` keeps a `type` both inputs share;
  `round` keeps the `type`; `withMargin` keeps neither `type` nor `quote`.
- **Tables:** a `table` is a base against many, its rates as `[currency, rate]` pairs in order (a
  rate text, a ready-made rate, which must be `base` → that currency, or `null` for a missing
  value); its own `source`, timing and `type` go on every rate it builds. A `list` is a list of
  rates. The last rate for a pair wins. A lookup with an `asOf` gets nothing from a rate, or a
  table, dated after that UTC day, published after it, or expired at it.
- **Providers** nest: `identity`, `chain`, `reversed` and `via` (`base`, each leg direct or as an
  exact inverse), as ducat's functions of those names.

| op                   | expected fields and how each is judged                                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rate.derive`        | `json`: the rate after `steps` (`inverse`, `andThen` with `rate`, `withMargin` with `margin`, `round` with `places` and `rounding`); `null` with `error` `range` (not positive, or a quote that doesn't describe the rate) |
| `rate.validity`      | `expired`: `isExpired(at)`, and `available`: `isAvailable(at)`, of a rate with the row's `availableAt` and `validUntil`                                                                                                    |
| `rate.fromJSON`      | `want`: `rateFromJSON(json).toJSON()`; `null` with `error` `range` (not positive, or a quote that doesn't describe the rate, including a `per` of 0, a negative or a fractional one)                                       |
| `rate.strictConvert` | `want`: `amount` converted at `rate` to its target's exponent with `rounding` and strict validity at the instant `now`; `null` with `error` `expired` or `rounding`                                                        |
| `provider.table`     | `header` (`base`, `asOf`, `availableAt`, `validUntil`, `missing`, where present) and `pairs` of the table; `null`s with `error` `mismatch` or `range`                                                                      |
| `provider.rate`      | `rate`: what `rateOf(provider, from, to, { asOf })` returns; `null` with `error` `unavailable`                                                                                                                             |
| `provider.convert`   | `want`: `amount` in `currency` converted to `to` through `provider` as of `asOf`, at `resultScale` (default `to`'s exponent); `null` with `error` `unavailable` or `rounding`                                              |
| `bag.total`          | `totals`: the bag's per-currency totals in first-seen order; `exact`: `exactTotal` in `to`; `total`: rounded once with `rounding` at `resultScale`; `null`s with `error` `unavailable`                                     |
| `bag.sort`           | `order`: the indices of `items` as `sortByValue` orders them by their exact value in `base` (stable); `null` with `error` `unavailable`                                                                                    |

### Rate sources

`convert/sources.json` holds what ducat's rate-source parsers make of the files in `spec/fixtures/`
(each directory's README gives the file's source and fetch date) and of small inline variants, as
`scripts/gen-rate-source-vectors.py` reads them with Python's standard library, independently of
ducat. A row names its `parser` (`ecbXml`, `ecbCsv`, `ecbSdmx`, `boc`, `fed`, `boe`, `hmrc`), its
file (`fixture`, a path under `spec/fixtures/`, or inline `text`) and the parser's `options`
(`decimals` as `[currency, decimals]` pairs, or `decimalsFrom`, a fixture read with
`parseEcbSdmxDecimals`). Rates are in ducat's JSON form, as in `providers.json`. Every field is
judged exactly, as JSON; `error` is `syntax` for a file the parser can't read and `range` for a
rate that isn't positive, or `null`.

- **Tables:** one per day (per period for HMRC), newest first, each with its base, timing, the
  currencies listed without a value (`missing`, in the file's order) and its rates in order. A day
  without any rate is left out.
- **The ECB's XML:** the Cube elements must nest; a day's rates end at its own closing tag, and an
  inner cube is written `<Cube …/>` or `<Cube …></Cube>`. A day is a Cube with only a `time`
  attribute, written with a closing tag: a self-closing `<Cube time='…'/>` is passed over, and a
  file without a day is a `syntax` error.
- **Publication times** are the sources' stated local times: the ECB's 16:00 in Frankfurt (CET, or
  CEST from the last Sunday of March to the last Sunday of October) when asked for, the Bank of
  Canada's 16:30 in Toronto (EST, or EDT from the second Sunday of March to the first Sunday of
  November) by default, and HMRC's the start of the penultimate Thursday of the month before.
- **Lookups** (`history.lookup`) are `rateHistory` over a file's tables: the rate, and the days
  passed over, newest first, as `[day, reason]`.

| op                    | expected fields and how each is judged                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `source.parse`        | `days`: each table's `asOf`, newest first; `null` with `error`                                                                     |
| `source.table`        | `table`: the parsed table at `index` (0 is the newest)                                                                             |
| `source.sdmxDecimals` | `decimals`: `parseEcbSdmxDecimals` of the file, as pairs in the file's order; `null` with `error` `syntax`                         |
| `history.fromQuote`   | `rate`: `rateFromQuote(from, to, quote, info)`; `null` with `error` `range`                                                        |
| `history.lookup`      | `rate` (or `null`) and `skipped` for `from` → `to` as of `asOf`, with `lookback` (default 4), over the tables of `tables`          |
| `fx.stripeRate`       | `rate`: `stripeRate(from, transaction)`, its `exchange_rate` the decimal of a JSON number; `null` with no rate, or `error` `range` |
| `fx.stripeImplied`    | `rate`: `stripeImpliedRate` of `amount` in `currency` and the transaction; `null` with `error` `range`                             |
| `fx.adyenRate`        | `rate`: `adyenRate(row)`, or `null` when the row has no rate                                                                       |

### Wire formats

`wire/formats.json` holds Money to and from the formats other systems send, as
`scripts/gen-wire-vectors.py` computes them from the formats' published definitions with Python's
`fractions`, independently of ducat, the specs' own examples first. A Money is given as `amount` (a
decimal at the scale its fraction digits give) and `currency`; `wire` is the format's JSON shape.
Every field is judged exactly, as JSON; `error` is `rounding` (more decimals than the target takes
without a mode), `range` or `syntax`, or `null`. Readers take `options` (`scale`, default the
currency's exponent, and `rounding`, default `unnecessary`). Malformed input is an error, never a
rounding.

- **google.type.Money**
  ([money.proto](https://github.com/googleapis/googleapis/blob/master/google/type/money.proto)):
  `units` an int64 and `nanos` from −999,999,999 to +999,999,999, with the sign of a non-zero
  `units` (`$-1.75` is `units` −1 and `nanos` −750,000,000). Written in its
  [ProtoJSON](https://protobuf.dev/programming-guides/json/) form, `units` as a string; read from
  numbers or strings, exponent notation included, when the value is an exact integer. A code that
  isn't three capital letters, a fraction, or a value out of range is `range`.
- **ISO 20022 amounts** (ActiveOrHistoricCurrencyAndAmount, `<InstdAmt Ccy="EUR">12.34</InstdAmt>`
  as `{ Ccy, value }`): an `xs:decimal` ([XML Schema 1.0, 3.2.3.1](https://www.w3.org/TR/xmlschema-2/#decimal))
  with at most 5 decimals and 18 digits by value (leading and trailing zeros don't count) and
  minInclusive 0, and an ISO 4217 code, current or withdrawn. Written at the currency's decimals
  (`writeScale` for another, 0 to 5), never negative. Read with an optional sign: `+12.34` and
  `-0` are valid, any other negative is `range`; `12.` and `.5`, which only
  [XSD 1.1's lexical rule](https://www.w3.org/TR/xmlschema11-2/#decimal) allows, are `syntax`, as
  is a malformed code. A code that isn't ISO 4217 is `range`.
- **ISO 4217 minor units**, `{ value, currency }`: an integer at the currency's exponent, at most
  2^53 − 1 in magnitude when written (a JSON number).
- **dinero.js objects** ([`toObject()`](https://v1.dinerojs.com/module-dinero#~toObject)),
  `{ amount, currency, precision }`: `amount` an integer count of 10^−`precision` units, written
  at the Money's scale (at most 2^53 − 1 in magnitude) and read at its precision (0 to 1000).
  `{ amount: 500, currency: 'USD', precision: 2 }` is the documented example.

| op                    | expected fields and how each is judged                                                      |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `wire.toGoogle`       | `wire`: the Money as google.type.Money, rounded to 9 decimals only with `rounding`          |
| `wire.fromGoogle`     | `amount`: the Money a google.type.Money is, at the options' scale                           |
| `wire.toIso20022`     | `wire`: the Money as `{ Ccy, value }`, at the currency's decimals or `writeScale`           |
| `wire.fromIso20022`   | `amount`: the Money an ISO 20022 amount is, at the options' scale                           |
| `wire.toMinorUnits`   | `wire`: the Money as `{ value, currency }` in ISO minor units, rounded only with `rounding` |
| `wire.fromMinorUnits` | `amount`: the Money at the currency's exponent                                              |
| `wire.toDinero`       | `wire`: the Money as `{ amount, currency, precision }`, at its scale                        |
| `wire.fromDinero`     | `amount`: the Money at the object's precision                                               |

### Finance and Excel tables

The tables in `finance/fractions.json` and `excel/fractions.json` follow the definitions in ducat's
reference (`docs/reference/finance.md`, `docs/reference/excel.md`). Amounts are minor units of the
row's `currency`, dates are `YYYY-MM-DD`, and `mode` is the rounding mode. Each expected field is
judged as the last column says. "Exact" means the same text, "rational" means the same value as a
fraction (any form), and "grid" means an integer string counting 10^−digits: the result floored to
`digits` places.

| op                           | expected fields and how each is judged                                                                                                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.yearFraction`       | `want`: the year fraction between `start` and `end` under `convention` (with `maturity` where given) as a reduced `"num/den"`, exact; or `"throws"`, a `range` error                                                                                                       |
| `finance.interest`           | `want`: simple interest, `principal` × `rate` × the year fraction from `from` to `to` under `dayCount`, rounded once; exact                                                                                                                                                |
| `finance.compound`           | `want`: `principal` × (1 + `rate` / `perYear`)^`periods`, rounded once; exact                                                                                                                                                                                              |
| `finance.amortise`           | `payment`, `rows` (the row count), `totalInterest`, `last` (the last row's payment, interest, principal and balance) and `checksum` = Σ (i + 1) × (paymentᵢ + 7 × interestᵢ) over the rows from i = 0, in minor units; all exact                                           |
| `finance.npv`                | `npv`: Excel's NPV of `flows` at `rate`, rounded once; `discountedSum`: the textbook NPV, Σ flowₜ / (1 + rate)ᵗ with the first flow at period 0 not discounted, rounded once; exact                                                                                        |
| `finance.irr`                | `lower`: Excel's IRR of `flows`, grid; the reported rate is that floor                                                                                                                                                                                                     |
| `finance.irrBracketed`       | `lower`: the IRR inside `bracket` (one of two known rational roots), grid                                                                                                                                                                                                  |
| `finance.proration`          | `prorate`: `price` × used days / period days (periods end-exclusive), rounded once; `split`: `price` split at the dates `at` in proportion to the days in each piece, by largest remainder; exact                                                                          |
| `finance.interestExact`      | `want`: `principal` (minor units of `currency`) × `rate` × the year fraction from `from` to `to` under `dayCount` (with `maturity` where given), exactly, rational                                                                                                         |
| `finance.discountedSumExact` | `want`: Σ flowₜ / (1 + `rate`)ᵗ over `flows` (minor units of `currency`), the first at period 0, exactly, rational; `null` (a `range` error) for a rate at or below −1                                                                                                     |
| `finance.paymentDates`       | `dates`: the payment dates of a `count`-payment schedule, `perYear` a year, from `firstPayment`; exact                                                                                                                                                                     |
| `excel.annuities`            | for each of `results.fv`, `.pv` and `.pmt`: `exact`, rational; `rounded`, the value rounded once in each mode, exact                                                                                                                                                       |
| `excel.nper`                 | `lower`, grid, or `"throws"` (a `range` error); `exact`, rational, present exactly when the period count is rational                                                                                                                                                       |
| `excel.rate`                 | `lower`: Excel's RATE, grid                                                                                                                                                                                                                                                |
| `excel.xnpv`                 | where `exact` is given: the bounds are both that value, rational, and marked exact. Otherwise the implementation's guaranteed interval [lower, upper] must contain [`low`, `high`] and be at most 10^−`digits` wide. `rounded`: the value rounded once in each mode, exact |
| `excel.xirr`                 | `lower`: Excel's XIRR of `values` on `dates`, grid                                                                                                                                                                                                                         |

### Microsoft's examples and LibreOffice Calc

Amounts in these two files are decimal strings in major units of USD (`"-1000.00"`), as a
spreadsheet cell holds them, not minor units.

`excel/microsoft.json` holds the worked examples on Microsoft's Excel pages, one table per function,
with the page as the table's `source`. Each row has the page's `formula`, its inputs (a `rate` may
be a cell's `"0.08/12"`) and its printed `result`. `excel/libreoffice-calc.json` holds what
LibreOffice Calc returns for the same functions on random inputs, as `calc`: a double printed to 16
significant digits (`"1.188443412335220E+03"`), or an error (`"Err:523"`, `"#NUM!"`).

Some definitions for the rules below:

- **round(x, p)** rounds x half away from zero to p decimal places.
- **S15(x)** is x rounded half away from zero to 15 significant digits, so Calc's 16th digit (a
  double's noise) is dropped from both sides.
- **ε** = 2^−52.
- **t(c)** = 5 × 10^(e − 15), half a unit in the 15th digit of Calc's text c, whose exponent is e.

An implementation's exact (or bracketed) value is compared with each row as follows. "Passes at
15 digits" means S15(value) = S15(calc). Where the rule continues with "else", a row that fails at
15 digits can still pass within the double-error bound given.

| op                                        | judged                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `excelExample.npv`                        | `outside` + NPV(`rate`, `values`) in USD, rounded to cents half away from zero, is `result`                                                                                                                                                                                                                                                                                                                                                                    |
| `excelExample.irr`                        | the IRR floored at 12 places, then round(·, 3), is `result`                                                                                                                                                                                                                                                                                                                                                                                                    |
| `excelExample.rri`                        | the periodic rate of a growth of (`fv` − `pv`) / `pv` over `nper` periods, floored at 15 places, then round(·, 7), is `result`                                                                                                                                                                                                                                                                                                                                 |
| `excelExample.effect`                     | (1 + `nominal` / `npery`)^`npery` − 1, round(·, 7), is `result`                                                                                                                                                                                                                                                                                                                                                                                                |
| `excelExample.fv`, `.pv`, `.pmt`, `.xnpv` | the value in USD, rounded to cents half away from zero, is `result`                                                                                                                                                                                                                                                                                                                                                                                            |
| `excelExample.nper`                       | with p the decimal places of `result`, both ends of NPER's bracket at p + 6 places, rounded with round(·, p), are `result`                                                                                                                                                                                                                                                                                                                                     |
| `excelExample.rate`                       | RATE floored at 12 places, times `times` (default 1), then round(·, `places`), is `result`                                                                                                                                                                                                                                                                                                                                                                     |
| `excelExample.xirr`                       | with XIRR's bracket [lower, upper] at 12 places: lower − `result` ≤ `accuracy` and `result` − upper ≤ `accuracy` (the table's `parameters`)                                                                                                                                                                                                                                                                                                                    |
| `spreadsheet.npv`                         | passes at 15 digits; else \|NPV − calc\| ≤ (n + 2) ε Σ \|flowᵢ\| / (1 + rate)ⁱ over the n flows, i from 1                                                                                                                                                                                                                                                                                                                                                      |
| `spreadsheet.irr`                         | the IRR's bracket at 12 places has an NPV sign change (or a zero) at its ends. Where `calc` is a number above −1, lower − calc ≤ a and calc − upper ≤ a, with a the `accuracy` of `excelExample.irr`                                                                                                                                                                                                                                                           |
| `spreadsheet.periodicRate`                | with r's bracket [lower, upper) at 25 places: S15(1 + lower) = S15(1 + upper) = S15(`calcOnePlus`), else \|1 + lower − calcOnePlus\| ≤ 8ε + t(calcOnePlus); and \|lower − calc\| ≤ 8ε + t(calc)                                                                                                                                                                                                                                                                |
| `spreadsheet.annualRate`                  | v = (1 + `periodic`)^`perYear` − 1 passes at 15 digits; else \|v − calc\| ≤ ((perYear + 2)(1 + v) + 1) ε + t(calc)                                                                                                                                                                                                                                                                                                                                             |
| `spreadsheet.fv`, `.pv`, `.pmt`           | the exact value passes at 15 digits; else \|value − calc\| ≤ (nper + 8) ε × size + t(calc). With G = (1 + rate)^nper and P = \|pmt\| (1 + \|rate\| type)(G + 1) / \|rate\| (or \|pmt\| × nper at a rate of 0), size is \|pv\| G + P for FV; (\|fv\| + P) / G for PV; and for PMT, (\|pv\| G + \|fv\|) \|rate\| / \|(1 + rate × type)(G − 1)\| × (1 + (G + 1) / \|G − 1\|), or (\|pv\| G + \|fv\|) / nper at a rate of 0                                        |
| `spreadsheet.nper`                        | with NPER's bracket at 25 places (or its exact value when rational): S15 of the exact value, or of both ends, equals S15(calc). Else, at a rate of 0, \|lower − calc\| ≤ 8ε \|lower\| + t(calc). Otherwise, with paid = pmt (1 + rate × type), A = (\|paid\| + \|fv × rate\|) / \|paid − fv × rate\| + (\|paid\| + \|pv × rate\|) / \|paid + pv × rate\|, and L = \|ln(1 + rate)\| computed in binary64: \|lower − calc\| ≤ 8ε (A + 2 \|lower\|) / L + t(calc) |
| `spreadsheet.rate`                        | the bracket [lower, upper] at min(14 + s, 40) places, s = max(0, ⌈−log₁₀ \|calc\|⌉) in binary64, has an NPV sign change (or a zero) at its ends for the implied flows in cents. Where type is 1 and calc ≤ −0.999999 (Calc's root at −1), s = 0 and lower > −1 suffices. Otherwise \|lower − calc\| ≤ 10⁻¹² \|lower\|, or at most 5 × 10⁻¹² where Calc stops early                                                                                             |
| `spreadsheet.xnpv`                        | the midpoint m of XNPV's bounds at 20 places passes at 15 digits; else, in binary64, \|m − calc\| ≤ (n + 4) × 2^−52 × Σ \|valueᵢ\| / (1 + rate)^(daysᵢ / 365) + t(calc)                                                                                                                                                                                                                                                                                        |
| `spreadsheet.xirr`                        | where `calc` is a number, with XIRR's bracket at 12 places: lower − calc ≤ 10⁻¹³ and calc − upper ≤ 10⁻¹³                                                                                                                                                                                                                                                                                                                                                      |
| `spreadsheet.edge.*`                      | each row matches the exact oracle's row with the same `note` in `excel/fractions.json`: its exact value, its grid step [lower, lower + 10^−digits), or its XNPV bounds. Calc agrees when it lies within that range widened by 10⁻¹² × its larger end + 10⁻¹⁵. Rows where Calc's doubles are known to differ, or where both refuse, are listed by note                                                                                                          |

Known gaps:

- The `spreadsheet.edge.*` rows where Calc is known to differ, and the two where both refuse, are
  listed in `test/excel.test.ts` (`differs`, `refuses`), not yet in the vectors.
- Each `spreadsheet.*` test also requires that most rows pass at 15 digits (more than 250 of the
  NPVs, say), as a check that the error bounds aren't doing all the work. Those counts are in the
  tests, not in the spec.

### Spelling out numbers

`words.spellOut` tables come one per language and rule set, named in the table's
`parameters` (`locale`, and `ruleSet` such as `%spellout-cardinal`). Each row's `words` is ICU's
spell-out of the integer `number` by that CLDR rule set, and must be matched exactly, as text.
`words/rbnf.json` comes from ICU's own data. `words/rbnf-data.json` comes from ICU's engine run on
ducat's copy of the CLDR rule text (`data/rbnf`); rule sets that use syntax newer than that ICU are
left out.

What the strategies mean:

- **Remainder strategies.** An allocation first gives each part the floor of its exact share. The
  units left over go:
  - `largest` to the parts with the largest fractional remainders, ties to the earlier part
    (Hamilton's method);
  - `first` and `last` one each, to the first or last parts with a non-zero weight;
  - `toFirst` and `toLast` all to the first or last part.

  A negative amount is allocated as the negation of the positive one.

- **Instalments** are `count` equal regular amounts, each a whole multiple of `unit`, with the
  remainder placed by the strategy.
- **Tranches** are `{ "amount": … }` (a fixed part), `{ "percent": "31.9", "cap": … }` (a share of
  the total, at most `cap`) or `{ "rest": true }`. The percentages are allocated together by
  largest remainder. It is a `range` error to have more than one rest tranche, percentages over
  100, tranches that exceed the total, or a leftover with no rest tranche.
- **XNPV** follows Excel: values on days counted from 2001-01-01, each discounted by
  `(1 + rate)^(days / 365)`. `rate` is a reduced `[numerator, denominator]`. `bounds` is the
  guaranteed interval, at most 10^−digits wide (`exact` when it is the rational value itself).
  `rounded` is the value rounded to the currency's scale in each mode.
- **XIRR** is the rate at which XNPV is zero, floored on the grid of `digits`-place decimals.

## Provenance

Every file says where its expected values come from (`provenance.source`):

| source                    | meaning                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `hand`                    | worked out by hand from exact decimal arithmetic                                                                                           |
| `lean`                    | evaluated from a Lean model whose properties are proved                                                                                    |
| `python-fractions`        | computed exactly with Python's `fractions`                                                                                                 |
| `python-decimal`          | Python's `decimal` module, the reference implementation of the General Decimal Arithmetic specification                                    |
| `libreoffice-calc`        | computed by LibreOffice Calc                                                                                                               |
| `microsoft-documentation` | copied from Microsoft's documentation of an Excel function                                                                                 |
| `dectest`                 | the General Decimal Arithmetic test cases                                                                                                  |
| `icu`                     | ICU's own output, on CLDR data                                                                                                             |
| `reference-data`          | read from the reference data in ducat's `data/` (ISO 4217 lists, CLDR, curated sources), by a program independent of ducat's own generator |

`generator` names the program that wrote the file and its version, or is `null` for values
written by hand or copied. Expected values never come from ducat's own output: a vector that
ducat fails is investigated, not regenerated.

Where the expected values depend on reference data, `provenance.data` gives its version:
`iso4217` (the ISO 4217 List One publication date), `iso4217ListThree` (List Three's, for withdrawn
codes), `cldr`, `icu`, and `runtimeIntl` when the results also depend on the runtime's own Intl data.

## Versions

The spec has its own version (`spec/package.json`), tied to ducat's:

- **Major and minor follow ducat's.** Spec 0.4.x describes ducat 0.4.
- **A patch** adds cases or files, or corrects provenance or wording. No existing case's meaning
  or expected value changes.
- **A changed or removed expectation is a spec change**: it means ducat's behaviour changed, so
  it comes with ducat's next minor version (or major, once ducat is 1.0), and the CHANGELOG says
  so. The one exception is a vector that was itself wrong, which a patch may correct, saying so.
- Each file's `checkedAgainst` is the ducat version in the repository when the file last changed,
  and every ducat commit runs every file, whatever its `checkedAgainst` says.
