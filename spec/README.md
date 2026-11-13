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

| area       | file                    | cases | source             | what it covers                                                                     |
| ---------- | ----------------------- | ----: | ------------------ | ---------------------------------------------------------------------------------- |
| `core`     | `battery.json`          |    41 | hand               | the cross-library battery: exponents, allocation, tax, ties, 2^53, mismatches      |
| `fixed`    | `battery.json`          |    28 | hand               | the same checks for plain decimals, without currencies                             |
| `allocate` | `allocate-lean.json`    | 1,500 | Lean               | allocation by weights, every remainder strategy                                    |
| `allocate` | `instalments-lean.json` | 1,200 | Lean               | instalments with a unit, every remainder strategy                                  |
| `allocate` | `chunk-lean.json`       | 1,200 | Lean               | tranches of at most a maximum                                                      |
| `allocate` | `schedule-lean.json`    | 1,500 | Lean               | fixed, percentage and rest tranches, and the ones that fail                        |
| `cash`     | `increment-lean.json`   | 1,500 | Lean               | rounding to an increment, every rounding mode                                      |
| `excel`    | `xnpv-lean.json`        |   120 | Lean               | XNPV's exact bounds and its rounded value in every mode                            |
| `excel`    | `xirr-lean.json`        |    35 | Lean               | XIRR floored to a number of digits, or no root                                     |
| `rounding` | `pydecimal.json`        |   750 | Python `decimal`   | multiply, divide and rescale, every rounding mode                                  |
| `convert`  | `pydecimal.json`        |   250 | Python `decimal`   | conversion at a rate, every rounding mode                                          |
| `tax`      | `pydecimal.json`        | 1,000 | Python `decimal`   | percentages, discounts, adding and extracting tax                                  |
| `finance`  | `fractions.json`        | 2,420 | Python `fractions` | day counts, interest, amortisation, proration, NPV and IRR                         |
| `excel`    | `fractions.json`        |   757 | Python `fractions` | FV, PV, PMT, NPER, RATE, XNPV and XIRR, with Calc's edge cases                     |
| `excel`    | `libreoffice-calc.json` | 1,943 | LibreOffice Calc   | the same functions in doubles, and RRI and EFFECT, with the shared edge cases      |
| `excel`    | `microsoft.json`        |    23 | Microsoft's pages  | the worked examples on Excel's function pages                                      |
| `words`    | `rbnf.json`             | 2,808 | ICU 79.1           | numbers spelled out by ICU on its own CLDR 49 data, each language's main rule sets |
| `words`    | `rbnf-data.json`        | 4,096 | ICU 74.2           | the same on the CLDR 49 rule text ducat ships, for the other public rule sets      |

The other areas the schema names (`format`, `parse`, `exact`) have no vectors yet.

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
| `minor.multiply`          | `currency`, `minor`, `mode`, `factor`          | `want`: minor × factor, rounded once to the currency's scale                                                |
| `minor.divide`            | `currency`, `minor`, `mode`, `divisor`         | `want`: minor ÷ divisor, rounded once to the currency's scale                                               |
| `minor.toScale`           | `currency`, `minor`, `mode`, `scale`           | `want`: the amount rounded to `scale` digits, in units of 10^−scale                                         |
| `minor.convert`           | `currency`, `minor`, `mode`, `to`, `rate`      | `want`: amount × rate in `to`, rounded once to `to`'s scale                                                 |
| `minor.percentage`        | `currency`, `minor`, `mode`, `percent`         | `want`: amount × percent / 100, rounded once                                                                |
| `minor.discount`          | `currency`, `minor`, `mode`, `percent`         | `want`: the amount less its rounded percentage                                                              |
| `minor.addTax`            | `currency`, `minor`, `mode`, `percent`         | `tax`: the rounded percentage of the net amount; `gross`: net + tax                                         |
| `minor.extractTax`        | `currency`, `minor`, `mode`, `percent`         | `net`: gross ÷ (1 + percent / 100), rounded once; `tax`: gross − net                                        |

In the `minor.*` rows, `minor` is the amount in minor units of `currency` at its ISO 4217 scale
(JPY 0, EUR 2, KWD 3, CLF 4), and every result is in minor units of the result's scale.

**How results are judged.** Unless an operation says otherwise below, every expected field must
equal the result exactly, as text (integer strings, fractions and `null` alike).

### Finance and Excel tables

The tables in `finance/fractions.json` and `excel/fractions.json` follow the definitions in ducat's
reference (`docs/reference/finance.md`, `docs/reference/excel.md`). Amounts are minor units of the
row's `currency`, dates are `YYYY-MM-DD`, and `mode` is the rounding mode. Each expected field is
judged as the last column says. "Exact" means the same text, "rational" means the same value as a
fraction (any form), and "grid" means an integer string counting 10^−digits: the result floored to
`digits` places.

| op                     | expected fields and how each is judged                                                                                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.yearFraction` | `want`: the year fraction between `start` and `end` under `convention` (with `maturity` where given) as a reduced `"num/den"`, exact; or `"throws"`, a `range` error                                                                                                       |
| `finance.interest`     | `want`: simple interest, `principal` × `rate` × the year fraction from `from` to `to` under `dayCount`, rounded once; exact                                                                                                                                                |
| `finance.compound`     | `want`: `principal` × (1 + `rate` / `perYear`)^`periods`, rounded once; exact                                                                                                                                                                                              |
| `finance.amortise`     | `payment`, `rows` (the row count), `totalInterest`, `last` (the last row's payment, interest, principal and balance) and `checksum` = Σ (i + 1) × (paymentᵢ + 7 × interestᵢ) over the rows from i = 0, in minor units; all exact                                           |
| `finance.npv`          | `npv`: Excel's NPV of `flows` at `rate`, rounded once; `discountedSum`: the textbook NPV, Σ flowₜ / (1 + rate)ᵗ with the first flow at period 0 not discounted, rounded once; exact                                                                                        |
| `finance.irr`          | `lower`: Excel's IRR of `flows`, grid; the reported rate is that floor                                                                                                                                                                                                     |
| `finance.irrBracketed` | `lower`: the IRR inside `bracket` (one of two known rational roots), grid                                                                                                                                                                                                  |
| `finance.proration`    | `prorate`: `price` × used days / period days (periods end-exclusive), rounded once; `split`: `price` split at the dates `at` in proportion to the days in each piece, by largest remainder; exact                                                                          |
| `finance.paymentDates` | `dates`: the payment dates of a `count`-payment schedule, `perYear` a year, from `firstPayment`; exact                                                                                                                                                                     |
| `excel.annuities`      | for each of `results.fv`, `.pv` and `.pmt`: `exact`, rational; `rounded`, the value rounded once in each mode, exact                                                                                                                                                       |
| `excel.nper`           | `lower`, grid, or `"throws"` (a `range` error); `exact`, rational, present exactly when the period count is rational                                                                                                                                                       |
| `excel.rate`           | `lower`: Excel's RATE, grid                                                                                                                                                                                                                                                |
| `excel.xnpv`           | where `exact` is given: the bounds are both that value, rational, and marked exact. Otherwise the implementation's guaranteed interval [lower, upper] must contain [`low`, `high`] and be at most 10^−`digits` wide. `rounded`: the value rounded once in each mode, exact |
| `excel.xirr`           | `lower`: Excel's XIRR of `values` on `dates`, grid                                                                                                                                                                                                                         |

### Microsoft's examples and LibreOffice Calc

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
