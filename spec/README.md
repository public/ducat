# @ducatjs/money-spec

Language-neutral conformance vectors for [`@ducatjs/money`](../README.md): test cases as JSON, with
where each expected value came from, a JSON Schema, and the rules for running them. ducat's
TypeScript is the first implementation that runs them, and so far the only one.

The package is data only: no code and no dependencies. It is private for now, so the
repository's `spec/` directory is the only copy.

```
spec/
  README.md                    this file: the format and how to run it
  schema/vectors.schema.json   JSON Schema (draft 2020-12) for every vector file
  vectors/<area>/<name>.json   the vectors, one area per directory
```

| area       | file                    | cases | source | what it covers                                                                |
| ---------- | ----------------------- | ----: | ------ | ----------------------------------------------------------------------------- |
| `core`     | `battery.json`          |    41 | hand   | the cross-library battery: exponents, allocation, tax, ties, 2^53, mismatches |
| `fixed`    | `battery.json`          |    28 | hand   | the same checks for plain decimals, without currencies                        |
| `allocate` | `allocate-lean.json`    | 1,500 | Lean   | allocation by weights, every remainder strategy                               |
| `allocate` | `instalments-lean.json` | 1,200 | Lean   | instalments with a unit, every remainder strategy                             |
| `allocate` | `chunk-lean.json`       | 1,200 | Lean   | tranches of at most a maximum                                                 |
| `allocate` | `schedule-lean.json`    | 1,500 | Lean   | fixed, percentage and rest tranches, and the ones that fail                   |
| `cash`     | `increment-lean.json`   | 1,500 | Lean   | rounding to an increment, every rounding mode                                 |
| `excel`    | `xnpv-lean.json`        |   120 | Lean   | XNPV's exact bounds and its rounded value in every mode                       |
| `excel`    | `xirr-lean.json`        |    35 | Lean   | XIRR floored to a number of digits, or no root                                |

The other areas the schema names (`rounding`, `tax`, `convert`, `format`, `words`, `parse`, `exact`,
`finance`) are where ducat's remaining vectors move next.

## Running the suite

An implementation runs every file the same way:

1. Validate the file against `schema/vectors.schema.json`. A file that fails is an error, not a
   skip.
2. For each case, look up its `op`. An operation the implementation doesn't know is an error: a
   runner that silently skips cases proves nothing.
3. Build the arguments from `args`, call the operation, and compare what it returns, or the error
   it raises, with `expect` (see [Expectations](#expectations)).

ducat's runner is `test/spec.test.ts`. It also counts the cases in each area, so a lost vector
fails the build.

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
- **Interval:** an irrational result (a rate, a period count, XIRR) given exactly:
  `{ "lower": "…", "upper": "…", "tolerance": "…" }`, rationals with lower ≤ value ≤ upper.
  An implementation's answer passes when it lies within `tolerance` of the interval.

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

## Table operations

Each table operation names the fields of its rows. Unless a row has a `currency`, its amounts are
integer strings of minor units of a currency with scale 2 (the Lean models work in integers, and
EUR serves). `null` where a result is expected means the operation raises an error of the kind
given.

| op                        | inputs                                         | expected                                                                                                    |
| ------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `allocate.byRemainder`    | `amount`, `weights` (integer strings ≥ 0)      | the parts, in order, for each remainder strategy: `largest`, `first`, `last`, `toFirst`, `toLast`           |
| `instalments.byRemainder` | `total`, `count`, `unit`                       | the `count` instalments for each strategy: `first`, `last`, `toFirst`, `toLast`                             |
| `chunk`                   | `total`, `max`                                 | `chunks`: every one `max` but the last, which is positive; `[0]` for a zero total                           |
| `schedule`                | `total`, `tranches`                            | `result`: one part per tranche, or `null` (`range`)                                                         |
| `roundToIncrement.byMode` | `amount`, `step`                               | the multiple of `step` for each rounding mode, by its name, or `null` (`rounding`, for `unnecessary`)       |
| `xnpv.scaled`             | `currency`, `rate`, `days`, `values`, `digits` | `bounds` (an interval in major units, or `null`: `range`) and `rounded` (minor units by rounding mode)      |
| `xirr.floor`              | `currency`, `days`, `values`, `digits`         | `lower`: the rate floored to `digits` places, as an integer string scaled by 10^digits, or `null` (`range`) |

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

| source                    | meaning                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `hand`                    | worked out by hand from exact decimal arithmetic                                                        |
| `lean`                    | evaluated from a Lean model whose properties are proved                                                 |
| `python-fractions`        | computed exactly with Python's `fractions`                                                              |
| `python-decimal`          | Python's `decimal` module, the reference implementation of the General Decimal Arithmetic specification |
| `libreoffice-calc`        | computed by LibreOffice Calc                                                                            |
| `microsoft-documentation` | copied from Microsoft's documentation of an Excel function                                              |
| `dectest`                 | the General Decimal Arithmetic test cases                                                               |
| `icu`                     | ICU's own output, on CLDR data                                                                          |

`generator` names the program that wrote the file and its version, or is `null` for values
written by hand or copied. Expected values never come from ducat's own output: a vector that
ducat fails is investigated, not regenerated.

Where the expected values depend on reference data, `provenance.data` gives its version:
`iso4217` (the ISO 4217 List One publication date), `cldr`, `icu`, and `runtimeIntl` when the
results also depend on the runtime's own Intl data.

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
