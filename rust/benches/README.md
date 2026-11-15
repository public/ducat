# ducat-benches

Criterion benchmarks of the `ducat` crate against other Rust money and decimal libraries. Not published, not a
dependency of anything, and never run in CI (CI lints it once and excludes it from every `--workspace` command, so
its dependencies never unify features with the libraries' builds).

```sh
cd rust
cargo bench -p ducat-benches                  # every benchmark, about 7.5 minutes
cargo bench -p ducat-benches -- '^divide/'    # one group
python3 benches/collect.py "$CARGO_TARGET_DIR/criterion" run.json   # medians, ns per iteration
```

Before any timing, `check_agreement` in `benches/money.rs` asserts that the libraries return the same values
wherever their semantics are the same (and pins the values where they differ), so no benchmark times a different
computation from the others without that being visible in the code.

## Measured on Alex's 5800X PC (pc5800), Hyper-V VM

These numbers come from one machine, a VM, at one point in time. They are not comparable with the TypeScript
numbers measured on the Genoa runner: different hardware, runtime and harness.

- Host: AMD Ryzen 7 5800X (Zen 3) under Hyper-V; the benchmarks ran in a gVisor sandbox with 2 vCPUs and 6 GiB.
  `lscpu` reports `Vendor ID: AuthenticAMD`, `CPU family: 25`, `Model: 33` (Zen 3, Vermeer), `Model name: unknown`
  (gVisor hides it), `Hypervisor vendor: Microsoft`, 2 CPUs, 1 thread per core. The frequency governor isn't
  readable from the sandbox.
- Load: `/proc/loadavg` read `0.00 0.00 0.00` before and after every run, but gVisor reports the sandbox's own load,
  not the host's, so it doesn't show whether other VMs or sandboxes were busy on the node. The shared volume's used
  space grew by about 7 GB during the session while this sandbox wrote under 0.5 GB, so other work was probably
  running on the node. The spread between runs (below) is the only noise measure available. No CPU pinning.
- Toolchain: rustc 1.99.1 (2026-10-13), the `bench` profile (release: opt-level 3, no LTO, 16 codegen units, the
  workspace's defaults), `CARGO_BUILD_JOBS` unset.
- Harness: criterion 0.5.1 with default features off (no rayon, no plotters, no HTML reports), 2 s warm-up, 4 s
  measurement, 100 samples per benchmark. Inputs pass through `std::hint::black_box`.
- Versions (Cargo.lock): ducat at this commit, rust_decimal 1.43.0, rusty-money 0.4.2 (on rust_decimal 1.43.0),
  bigdecimal 0.4.11 (num-bigint 0.4.6), fixed 1.30.0.
- Date: 2026-11-15.

Method: the whole suite ran 3 times in a row (each run as two `cargo bench` invocations, the first four groups and
then the rest, with the criterion directory cleared before each run so no run compares itself with another).
For each benchmark the table gives the median over the 3 runs of criterion's median time per iteration. Spread is
(max − min) / median over the 3 runs' medians. One benchmark has a spread above 10% and is marked †:
`convert/ducat/big`, 12.8% (160.8, 177.0, 156.5 ns). Every other spread is at most 6.2% (`convert/bigdecimal/big`),
and all but three are under 5%.

## Inputs

Every library gets the same values, EUR at scale 2:

| case | values |
|---|---|
| parse, to string | `1234.56` |
| add | `1234.56 + 789.01` |
| multiply | `1234.56 × 1.075`, half-even to 2 decimals: `1327.15` |
| divide | `1234.56 ÷ 3`, half-even to 2 decimals: `411.52` |
| split / allocate | `100.00` into 3 equal parts, and by weights 1, 2, 3 |
| convert | `1234.56` EUR at 1.0832 USD per EUR, half-even to 2 decimals: `1337.28` USD |
| sum | 1,000 amounts from 0.13 to 9,991.08 (`(i × 7919 + 13) mod 10^6` cents) |
| big (past i128) | `4412345678901234567890123456789012345678.12` (4.4 × 10^41 cents; `i128::MAX` ≈ 1.7 × 10^38) and `987654321098765432109876543210987654321.09`; for split/allocate `4412345678901234567890123456789012345678.00`; the big sum adds the first to each of the 1,000 amounts |

Factors and rates are parsed once, outside the timed loop, by every library (ducat: a `Ratio` and a
`Rate<Eur, Usd>`). Only ducat and bigdecimal can hold the big values; rust_decimal holds 96 bits (28–29 digits),
fixed's `I64F64` and the baseline's `i64` less than that.

## Results

ns per operation, median of the 3 runs' medians. In brackets: ducat's time divided by the library's, so 2.00 means
ducat took twice as long and 0.50 half as long. "n/a": the library has no such operation or can't hold the value.

### Normal size

| operation | ducat | rust_decimal | rusty-money | bigdecimal | fixed (I64F64) | i64 minor units |
|---|---|---|---|---|---|---|
| parse | 48.8 | 9.8 (4.97) | 124 (0.39) | 74.0 (0.66) | 85.0 (0.57) | 9.0 (5.41) |
| add | 10.0 | 5.3 (1.90) | 10.7 (0.94) | 42.7 (0.24) | 1.3 (7.93) | 0.6 (15.87) |
| multiply, half-even | 41.5 | 15.9 (2.62) | 75.0 (0.55) | 86.8 (0.48) | 2.7 (15.20) ‡ | 5.4 (7.75) |
| divide by 3, half-even | 53.7 | 15.4 (3.50) | 41.1 (1.31) | 41.0 (1.31) | 5.2 (10.25) ‡ | 5.1 (10.58) |
| split 100.00 into 3 | 167 | n/a | 300 (0.56) § | n/a | n/a | 69.6 (2.41) |
| allocate 100.00 by 1, 2, 3 | 217 | n/a | 271 (0.80) § | n/a | n/a | 70.2 (3.09) |
| convert at a rate | 53.7 | 16.8 (3.20) | 37.2 (1.45) | 85.2 (0.63) | 2.7 (19.70) ‡ | 5.0 (10.81) |
| to string | 57.0 | 45.7 (1.25) | 271 (0.21) | 72.9 (0.78) | 65.0 (0.88) | 49.2 (1.16) |
| sum of 1,000 | 9,959 | 4,608 (2.16) | 10,428 (0.96) | 18,883 (0.53) | 222 (44.84) | 215 (46.40) |

### Past i128 (ducat's heap path)

| operation | ducat | bigdecimal |
|---|---|---|
| parse | 241 | 150 (1.61) |
| add | 92.8 | 53.4 (1.74) |
| multiply, half-even | 123 | 181 (0.68) |
| divide by 3, half-even | 136 | 2,772 (0.05) |
| split into 3 | 667 | n/a |
| allocate by 1, 2, 3 | 694 | n/a |
| convert at a rate | 161 † | 181 (0.89) |
| to string | 126 | 132 (0.96) |
| sum of 1,000 | 91,471 | 24,920 (3.67) |

† spread above 10% (12.8%). ‡ does not round to cents (see fixed below). § different result: whole euros, not
cents (see rusty-money below).

### Where ducat is slower, and why

- Against rust_decimal (1.25–4.97 times as long) and the i64 baseline (1.16–46 times): ducat's amounts are an enum
  of `i128` and a boxed `BigInt` plus a `u16` scale, and every operation checks for overflow and promotes to the
  heap path instead of failing. Multiply, divide and convert go through an exact `Ratio` (numerator and
  denominator) and one rounding step to the currency's exponent; rust_decimal multiplies 96-bit mantissas and the
  baseline does one `i128` multiply and divide. Parse is ducat's full grammar (exponents, signs, a scale check
  against the currency); rust_decimal's `from_str_exact` and the baseline parse fewer forms.
- Sum of 1,000: ducat's `Sum` folds with `+`, which creates a new value and aligns scales at every step, about
  10 ns per addition; rust_decimal is about 4.6 ns and the integers about 0.2 ns. Past i128 the gap to bigdecimal
  (3.67 times) is because each ducat addition allocates a new `BigInt`, where bigdecimal's `Sum` adds into the accumulator it owns, reusing its buffer.
- Past i128, parse and add are 1.6–1.7 times bigdecimal's, for the same reason: ducat builds a new boxed
  `BigInt` per result and checks whether it fits back into `i128`.
- ducat is faster than bigdecimal on big division (0.05) because bigdecimal divides to its default precision of
  100 significant digits before the rounding to 2 decimals, where ducat computes the exact quotient's rounding
  directly.

## What each library does, and does less

- **ducat**: the currency is in the type (`Money<Eur>`, `Rate<Eur, Usd>`), so mixing currencies doesn't compile.
  Exact arithmetic of any size, no floats. Every rounding operation takes the mode. Parsing rejects more decimals
  than the currency has (`Rounding::Unnecessary`). `to_decimal` returns `"1234.56"`; `Display` would append the
  code.
- **rust_decimal 1.43.0**: no currency. 96-bit mantissa: the big values don't fit (`from_str` errors).
  `checked_add`/`checked_mul`/`checked_div` are used so overflow is an error, as in the others; rounding is a
  separate `round_dp_with_strategy(2, MidpointNearestEven)` call after the operation. Division first rounds the
  quotient to 28 significant digits, so a quotient that is exactly a tie only after more digits would be rounded
  twice; it doesn't happen with these inputs (the check asserts the same result). The sum uses its `Sum`, which
  panics on overflow.
- **rusty-money 0.4.2**: rust_decimal inside, plus a runtime currency reference. `+` panics on a currency mismatch
  rather than returning an error. Multiply and divide take a factor and apply it without rounding; the benchmark
  then calls `round(2, Round::HalfEven)`. Its multiply and divide turn the factor into a string and parse it back
  on every call, which is part of its cost here. Parsing follows the currency's locale, so EUR is given
  `"1234,56"` (comma decimal) and parsing builds several strings. `to_string` formats for display (`"€1.234,56"`,
  symbol and grouping), more work than the others' plain decimal. Allocation (`allocate_to`, `allocate`)
  distributes the remainder in whole major units: 100.00 splits as 34, 33, 33 euros and by 1, 2, 3 as 17, 33, 50,
  where ducat and the baseline give 33.34, 33.33, 33.33 and 16.67, 33.33, 50.00; an amount with cents left over
  after the floor (100.01 into 3) panics. So those two timings are not of the same result. `ExchangeRate::convert`
  checks the source currency and doesn't round; the benchmark rounds after it. Past i128: n/a (rust_decimal).
- **bigdecimal 0.4.11**: arbitrary precision, no currency. Rounding is `with_scale_round(2, HalfEven)` after the
  operation. Division is computed to 100 significant digits (its default) and then rounded. No allocation:
  n/a.
- **fixed 1.30.0** (`I64F64`, binary fixed point in an `i128`): included for reference; it doesn't fit money use.
  Decimal fractions such as 0.01 aren't representable: `1234.56` is stored as the nearest multiple of 2^−64 and
  printed back as the shortest decimal that reads back to it. Multiply, divide and convert are rounded to 2^−64,
  never to cents, and there is no decimal rounding mode, so those three timings (‡) do less than the others. No
  currency, no allocation, no values past about 9.2 × 10^18.
- **i64 minor units**: the baseline, written in `benches/money.rs`. Cents in an `i64` with `i128` intermediates;
  the caller tracks currency and scale. Strict parse (at most 2 decimals), checked overflow, half-even
  multiply/divide/convert with the factor as an integer ratio (1075/1000, 10832/10000), largest-remainder
  allocation with ties to the earlier part (the same as ducat's `Remainder::Largest`), and `to_string` by
  `format!`. No values past `i64` (and the products past `i128`).
