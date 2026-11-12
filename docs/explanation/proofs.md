# What is proved

This page explains what the Lean proofs in `proofs/` establish about ducat, and what is tested instead. How the test suite is built is in [How ducat is tested](how-ducat-is-tested.md).

`proofs/` holds [Lean 4](https://lean-lang.org) proofs (with Mathlib) of two kinds:

- **Proved code.** The bigint rounding kernels are written once in Lean, as values of a small expression language (`proofs/Ducat/Kernel.lean`). The theorems are about those values, and `pnpm gen:kernel` prints the same values as TypeScript into `src/generated/kernel.ts`. They print as one function, `divideAndRoundBigint`: the steps every mode shares, then a `switch` with each mode's proved decision (`kernel_shared` states that the shared steps really are the same). The TypeScript `divideAndRoundBigint` in `src/rounding.ts` calls it; it is the bigint path of every rounded operation. What you have to trust is the printer (about 60 lines of Lean) and the fact that JS `bigint` `+ - * /` agree with Lean's `Int` (`/` truncates, as `Int.tdiv` does).
- **Proved models.** Allocation, instalments, chunks, schedules, cash rounding, tax and scale changes are proved about Lean models of what the TypeScript does, not about the TypeScript itself. The allocation, instalment, chunk, schedule, increment, XNPV and XIRR models are compiled into an oracle that prints generated cases to `test/fixtures/<model>.oracle.json`. The tests require the TypeScript to match each one exactly (`allocate` on both its number and bigint paths). The TypeScript for tax, scale and conversion is tested, not proved (see below).

`pnpm gen:check`, which runs in every check without Lean, fails in two cases. One is any unfinished proof (`sorry`, `admit`, a new `axiom`, `native_decide`). The other is a generated file that was edited by hand or not regenerated after `proofs/` changed: each generated file carries a hash of the Lean sources it came from. `pnpm gen:kernel:check` needs Lean, and CI runs it. It rebuilds the proofs, checks that the headline theorems depend only on Lean's standard axioms (`propext`, `Classical.choice`, `Quot.sound`), and fails if either generated file differs from what the proofs print.

## Rounding kernels: proved code (`proofs/Ducat/Rounding.lean`)

`Rounds m p d q` is the specification: "`q` is `p / d` rounded with mode `m`", written as integer inequalities on the error `p − d·q`. For example, `floor` means `q ≤ p/d < q + 1`. The half modes mean `|p/d − q| ≤ ½`, with the tie going where the mode says. `unnecessary` means the division is exact. For a divisor `d > 0`:

- `kernel_sound`: whatever the generated kernel returns is correctly rounded.
- `rounds_unique`: the specification has at most one answer, so "correctly rounded" means "the right answer".
- `kernel_fails_iff`: the kernel throws exactly for `unnecessary` on an inexact division, and never otherwise.
- `kernel_correct`: so whenever a correctly rounded answer exists, the kernel returns it.

`RoundsR m x q` is the same specification for a real value `x`, with the error `x − q`; `rounds_toReal`: a `Rounds` result for `p/d` is a `RoundsR` result for the real `p/d`, and by `roundsR_unique` the only one. Rounding is monotone in every mode:

- `roundsR_mono`, `rounds_mono`: if `x ≤ y`, then `x` rounded is at most `y` rounded, for reals and for fractions over a positive divisor.
- `roundsR_between`, `rounds_between`: the values that round to `q` form an interval, so when two ends round to `q`, every real value between them rounds to `q` too. `roundsR_unique`: that `q` is the value's only rounding.

## Allocation: proved model (`proofs/Ducat/Allocate.lean`)

The model takes an amount `x ≥ 0` and non-negative weights with a positive total `T`. Each bucket gets `⌊x·w/T⌋`, and the leftover units go to the non-zero buckets in the order the strategy fixes.

- `alloc_sum`: the parts add up to `x`, for every remainder strategy.
- `alloc_zero`: a bucket with zero weight gets zero.
- `alloc_near_largest`: with `'largest'` (Hamilton's method), each part is less than one unit from its exact share `x·w/T`.
- `alloc_near`: with `'first'` and `'last'`, each part is at most one unit from its exact share. Exactly one unit can happen: 0.02 split `[2, 1, 1]` with `'first'` gives 0.02, 0, 0.
- `alloc_scale`: multiplying every weight by the same positive number changes nothing, so decimal weights such as `'33.3'`, scaled to integers, are allocated by their exact ratios.
- Negative amounts are the mirror image of positive ones. The model defines them that way, as `allocate` does, so `allocS_neg` only confirms the definition.

## Instalments, chunks and schedules: proved models (`proofs/Ducat/Schedule.lean`)

For a non-negative total; negative totals are the mirror image, as in `allocate`.

- `inst_sum`: the instalments add up to the total, for every remainder mode.
- `inst_multiple`: with a `unit`, every instalment except the one that takes the leftover is a whole number of units. `inst_near`: with `'first'`/`'last'`, those instalments are the regular amount or one unit more (both hold by how the model builds the instalments), and the leftover is less than one unit.
- `chunk_sum`, `chunk_le`, `chunk_full`, `chunk_last_pos`: the chunks add up to the total, none exceeds `max`, every chunk but the last is exactly `max`, and the last is positive (a zero total gives a single zero).
- `sched_sum`: whenever `schedule` succeeds, its tranches add up to the total. This holds by construction, since the rest tranche takes whatever is left, as in the TypeScript. The oracle cases include each way it must fail: two rest tranches, percentages over 100, tranches exceeding the total, and a leftover with no rest tranche.
- `sched_shares_near`: the percentage shares that `schedule` computes, before capping, are each less than one unit from their exact share. That they reach the right tranches, with caps applied, is checked by the oracle cases, not proved.

## Cash rounding: proved model (`proofs/Ducat/Cash.lean`)

The model of `roundToIncrement` (and so of `cashRound`) is one kernel division times the increment. The TypeScript also aligns scales and, for safe integers, takes the number path. The oracle cases compare it with the model on both paths.

- `increment_multiple`: the result is a whole number of increments.
- `increment_near`, `increment_half`: it is less than one increment from the amount in every mode, and at most half an increment in the half modes.
- `increment_exact`, `increment_idem`: an amount that already is a multiple comes back unchanged in every mode, so rounding twice is rounding once.

## Tax, scale and conversion: proved model (`proofs/Ducat/Tax.lean`)

These are stated over the proved kernel (`divRound`):

- `addTax_bound`: the modelled tax is the exact tax, correctly rounded once. `extractTax_bound`: the modelled net is `gross / (1 + rate)` correctly rounded, and the tax carries the same error with the opposite sign. (`addTax_gross` and `extractTax_gross`, net + tax = gross, hold by construction, as in the TypeScript.)
- `rounds_half_bound`, `rounds_directed_bound`: a correctly rounded result is within half a unit of the exact value in the half modes, and under one unit in every mode.
- `toScale_roundtrip`: raising the scale and lowering it again gives back the original value in every mode, and `unnecessary` does not throw.
- `divRound_mul_left`: multiplying the numerator and denominator by the same positive number does not change the result. So reducing a rate by its gcd, or composing exact rates, cannot change a rounded result, provided it is computed as a single division of the exact product.

## XNPV's bounds: proved model (`proofs/Ducat/Xnpv.lean`, `XnpvModel.lean`, `Search.lean`)

`xnpvBounds`, `xnpv` and `xirr` in `@ducatjs/money/excel` bracket XNPV in integer arithmetic at a fixed-point scale `S = 2^bits`. Each step of `xnpvScaled` and its theorem:

| step in `src/excel.ts`                                                                                                           | theorem                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| the split `n/m = W + Σ r/q` over `m`'s prime powers `q`, given the identity `n = W·m + Σ r·(m/q)` the code checks                | `exponent_split`, and the real-power law `g^(n/m) = g^W·Π g^(r/q)`: `power_split`                                               |
| each prime power `q`'s root `R = ⌊qth root of ⌊a·S^q / b⌋⌋` by integer Newton from above: the floor root from any start above it | `newton_spec`, `newton_eq_nthRoot`, `floorRoot_spec`                                                                            |
| the integer inequality `R^q·b ≤ a·S^q < (R + 1)^q·b`                                                                             | `root_floor_inside`, `root_bracket`, `rootLow_bracket`                                                                          |
| the real root: `R/S ≤ g^(1/q) < (R + 1)/S` for `g = a/b`                                                                         | `real_root_bracket`                                                                                                             |
| `g^(r/q)` by square-and-multiply, every product floored (or ceiled)                                                              | `mulFloor_le`, `le_mulCeil`, `fixedPower_floor_le`, `le_fixedPower_ceil`, `factor_bracket`                                      |
| a flow's factors `Π g^(r/q)` multiplied left to right, floored (or ceiled)                                                       | `fold_floor_le`, `le_fold_ceil`; for the model's own roots, powers and products, `factorLow_le`, `le_factorHigh`                |
| flows with the same irrational part summed first as one coefficient, a zero coefficient dropped                                  | `sum_regroup`, `group_common_factor`                                                                                            |
| a group's term `C / F` between `C / F_high` and `C / F_low` (swapped for `C < 0`), floored and ceiled to the grid                | `quotient_bounds`, `grid_bounds`                                                                                                |
| the groups' bounds summed                                                                                                        | `sum_bounds`                                                                                                                    |
| `xnpv`'s single rounding: both ends round alike, so the value rounds to that amount                                              | `xnpv_rounds` (from `rounds_between`)                                                                                           |
| `xirr`, `irr` and `rate` without a bracket: from 0, below it to −1 or doubling above it, then bisection on the grid              | `bisect_spec`, `bisectRate_spec`: the result is a root on the grid, or the sign there is nonzero and opposite at the next point |

The bounds are over ℝ, with `Real.rpow` for the roots, so they apply to the irrational factors `g^(r/q)`, their products and `C / F` themselves.

`XnpvModel.lean` is a model of `xnpvScaled`, `xnpvBounds`, `xnpv` and `xirr` (Excel's day count, no bracket) built from the definitions those theorems are about: `floorRoot`, the fixed-point powers and products, and `bisectRate`. `Oracle.lean` prints it on 120 XNPV and 30 XIRR cases (`test/fixtures/xnpv.oracle.json`, `xirr.oracle.json`). The TypeScript must give the same bounds at the same precision, the same `exact`, the same rounded value in every mode and the same floored rate, and throw where the model has no value.

**Not proved:**

- That the model's interval contains the real XNPV, as one statement: each group's factor is bracketed (`factorLow_le`, `le_factorHigh`), and the term and sum steps are proved separately, but they are not composed through the model's grouping into one theorem.
- The CRT computation of the split. `splitExponent` checks the identity `n = W·m + Σ r·(m/q)` at run time and throws if it fails, so `power_split` takes the identity as a hypothesis.
- That a root of the real function lies between two grid points of opposite sign: `bisectRate_spec` is about the signs at grid points, and the step to a root needs continuity. It holds for any sign function with values in {−1, 0, 1}: that each solver's sign is its NPV's sign is not proved, and where XIRR's sign doesn't settle within 2,048 bits the model, like the code, has no value. `irr` and `rate` share the search but have no model or fixture here.
- A caller's `bracket` (`bracketToGrid`), other day counts and the defensive caps on root size: not in the model.
- That the TypeScript is the model: as for the other proved models, the oracle fixtures test it on generated cases.

## Tested, not proved

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
