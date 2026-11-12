# How ducat is tested

This page describes the suites that keep ducat correct, fast and small: what each runs and what it covers. What is proved rather than tested is in [What is proved](proofs.md), and how ducat compares with other libraries is in [How ducat compares](comparison.md).

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

## Mutation testing

`pnpm test:mutation` runs [Stryker](https://stryker-mutator.io) over `src/`: it changes the code one small edit at a time (a `<` for a `<=`, a condition for `true`, a block emptied, a message blanked) and runs the tests against each change, called a mutant. A mutant the tests fail on is killed; one they pass on survived. CI runs it nightly and keeps the report as the `mutation-report` artifact.

Every surviving mutant is either killed by a test that would catch a real bug of that shape, or is equivalent: no input can tell it from the original. Most equivalent mutants are in fast paths, where a guard sends a call to a safe-integer `number` path and otherwise to the general `bigint` path. Breaking the guard only sends more calls down the general path, which gives the same answer more slowly. Error messages are tested where they name the problem or the fix; elsewhere a test checks the error class and the key phrase.

Equivalent mutants are recorded in one of two places:

- At the site, as `// Stryker disable next-line <mutator>: <reason>`, when every mutant of that kind on that line is equivalent. Stryker then reports them as ignored.
- In the list below, when the same line also has mutants of that kind that the tests kill. Stryker can't disable a single mutant, so these stay "survived" in the report; the list says why each one can't change the result.

### Equivalent mutants

#### money.ts

| where                                                                                                                                                                                               | mutants                                                                                                                                                                                                                                                   | why they are equivalent                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| number fast paths: `scaleUp`, `scaleDown`, `add`, `subtract`, `sum`, `multiply`, `multiplyByRatio`, `divide`, `money()` for safe integers, `majorPart`, `minorPart`, `hasFraction`, `toMinorNumber` | the guard as `false` or its block emptied; a bound `<= MAX_SAFE_MINOR` as `<`, or `>= -MAX_SAFE_MINOR` as `>`; `exponent <= 15` or `scale <= 15` as `< 15`; `sum`'s fast-loop conditions (the NaN marker, the type and scale checks) as `true` or `false` | Each sends more inputs (or the input exactly at ±(2^53 − 1)) to the bigint path, which returns the same value: `normalizeMinor` makes it a number again when it is safe. The checks that matter (the guard as `true`, the bound as `>`) are killed by the ±2^53 tests in `test/money-edges.test.ts`. |
| `isValidScale`                                                                                                                                                                                      | the check as `false`; `<= MAX_SCALE` as `<`                                                                                                                                                                                                               | A scale that fails it goes to `checkScale`, which accepts the same scales and returns them unchanged.                                                                                                                                                                                                |
| `make`, `toBigInt`, `fromScaled`                                                                                                                                                                    | `typeof x === 'bigint'` as `true` or `false`                                                                                                                                                                                                              | `normalizeMinor` returns a safe number unchanged, and `BigInt()` of a bigint is that bigint.                                                                                                                                                                                                         |
| `fromScaled`, `toScale`, `compare`, `equals`, `multiplyByRatio`, `toMinor`                                                                                                                          | a same-scale shortcut removed, or `<`/`>` on scales as `<=`/`>=`                                                                                                                                                                                          | At equal scales the general path multiplies or divides by 10^0 = 1 (or compares at that scale) and gives the same value.                                                                                                                                                                             |
| `toScale`                                                                                                                                                                                           | `!isValidScale(scale)` as `true`                                                                                                                                                                                                                          | `checkScale` returns a valid scale unchanged.                                                                                                                                                                                                                                                        |
| `extendMoney`                                                                                                                                                                                       | `owner !== undefined` as `true`                                                                                                                                                                                                                           | It records `undefined` as the owner; a reinstall only matches a defined owner, so nothing reads it.                                                                                                                                                                                                  |
| `abs`                                                                                                                                                                                               | `minor < 0` as `<= 0`                                                                                                                                                                                                                                     | Negating zero gives zero.                                                                                                                                                                                                                                                                            |
| `divide`                                                                                                                                                                                            | `numerator < 0` as `<= 0`                                                                                                                                                                                                                                 | A zero divisor has already thrown.                                                                                                                                                                                                                                                                   |
| `majorPart`                                                                                                                                                                                         | `+ 0` as `- 0`                                                                                                                                                                                                                                            | `minor - (minor % unit)` is never −0: `x - x` is +0 for every x, −0 included.                                                                                                                                                                                                                        |

#### rounding.ts

Not triaged yet.

#### allocate.ts

| where                                                                          | mutants                                                                                                                                                                                  | why they are equivalent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allocate`'s number fast path (integer weights whose products fit in a double) | the guard and its weight checks as `true` or `false`, the bounds `total <= MAX_SAFE_MINOR` and `minor * maxWeight <= MAX_SAFE_MINOR - total` as `<` or `>`, `weight > maxWeight` as `>=` | Each sends more inputs to the bigint path, which gives the same shares. The bound that matters, `- total` as `+ total`, is killed by the cases near 2^53 in `test/allocate-edges.test.ts`.                                                                                                                                                                                                                                                                                                                                                                  |
| `allocate`'s fast path, the float-quotient fix-up                              | both branches emptied or negated                                                                                                                                                         | `product + total <= 2^53 - 1` on this path, so `Math.floor(product / total)` is exact, by the argument for `divideAndRound` above.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `allocate`'s selection loop (32 weights or fewer)                              | `ws[i] > 0` and `frac[i] >= 0` as `true` or loosened, `rem > 0` as `true` or `>= 0`, the 32 as 31 or no limit, the loop to `<= count`                                                    | The loop picks the largest remaining remainder, and that is always at least 1. The remainders add up to rem × total. Each is below total, and there are at most total buckets with a positive weight, so the top rem remainders are all positive. A zero-weight bucket (remainder 0) or a used one (-1) never wins. After a pick, the unpicked remainders still add up to more than their count, so the largest is at least 2. That is why a used bucket marked `+1` instead of `-1` can't win again either. The sort in `distribute` gives the same order. |
| `distribute`                                                                   | `rem === 0` as `false`; the eligibility loop to `<= count`; `>` as `>=` after the `!==` check                                                                                            | Every strategy adds nothing for 0. `weights[count]` is undefined. Equal remainders were handled just before.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `weightsScaled`                                                                | the bigint and safe-integer shortcuts                                                                                                                                                    | `parseDecimal` reads the same digits at scale 0. Choosing `faithfulDecimal` for a string returns it unchanged, and `>` as `>=` on equal scales changes nothing.                                                                                                                                                                                                                                                                                                                                                                                             |
| `instalments`                                                                  | `scaledTotal.minor < 0` as `<= 0`; `* (neg ? -1n : 1n)` as `/`                                                                                                                           | Zero negated is zero, and x / ±1n is x × ±1n.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `schedule`                                                                     | `pcts.length` as `true`                                                                                                                                                                  | With no percent tranches it allocates the total to one bucket and uses nothing from it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `chunk`                                                                        | `compare(left, max) > 0` as `>= 0`                                                                                                                                                       | At equality, the last part is `max` instead of a `left` of the same value and scale.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

#### decimal.ts

Not triaged yet.

#### parse.ts

Not triaged yet.

#### fixed.ts

Not triaged yet.

#### exact.ts

Not triaged yet.

#### convert.ts

Not triaged yet.

#### rate.ts

Not triaged yet.

## Benchmarks

- Clean-machine numbers against the other money and fixed-point libraries are in [How it compares](https://github.com/public/ducat#how-it-compares) and
  [How ducat compares](comparison.md), generated from [compare/](https://github.com/public/ducat/tree/main/compare) on one quiet AMD EPYC Genoa vCPU under
  Node, Bun and Deno.
- CodSpeed measures every pull request by instruction count, so speed regressions show up even on noisy CI machines.
- The benchmarks in `bench/` are for quick local comparisons; on a shared machine their run-to-run variation is often
  ±20–30%.
- Bundle size (esbuild, minified + gzip; `pnpm size` checks every entry point and snippet against `scripts/size-budgets.json`):
  - `money('1.00', 'EUR').add(…).multiply('1.075', 'halfEven').toDecimal()`: **4.5 KiB**, of which about 0.55 KiB is the ISO table. 0.3 grew it from 4.0 KiB, and the core from 4.9: stricter input validation and clearer errors (the port-test fixes), and the root entry installing the methods and currencies so that `/fn` programs can leave them out
  - the core entry point: 5.5 KiB; everything (`@ducatjs/money/all`): 50.5 KiB
  - `Fixed` alone (`fixed('1.00')`, add, multiply, toString): 3.5 KiB
  - the same snippet with dinero.js (EUR only): 1.8 KiB
  - the same snippet through `/fn`, with `import '@ducatjs/money/iso/EUR'`: 3.0 KiB; create, add and print only: 1.3 KiB
