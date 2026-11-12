# What is proved

This page explains what the Lean proofs in `proofs/` establish about ducat, and what is tested instead. How the test suite is built is in [How ducat is tested](how-ducat-is-tested.md).

`proofs/` holds [Lean 4](https://lean-lang.org) proofs (with Mathlib) of two kinds:

- **Proved code.** The bigint rounding kernels are written once in Lean, as values of a small expression language (`proofs/Ducat/Kernel.lean`). The theorems are about those values, and `pnpm gen:kernel` prints the same values as TypeScript into `src/generated/kernel.ts`. They print as one function, `divideAndRoundBigint`: the steps every mode shares, then a `switch` with each mode's proved decision (`kernel_shared` states that the shared steps really are the same). The TypeScript `divideAndRoundBigint` in `src/rounding.ts` calls it; it is the bigint path of every rounded operation. What you have to trust is the printer (about 60 lines of Lean) and the fact that JS `bigint` `+ - * /` agree with Lean's `Int` (`/` truncates, as `Int.tdiv` does).
- **Proved models.** Allocation, instalments, chunks, schedules, cash rounding, tax and scale changes are proved about Lean models of what the TypeScript does, not about the TypeScript itself. The allocation, instalment, chunk, schedule and increment models are compiled into an oracle that prints generated cases to `test/fixtures/<model>.oracle.json`. The tests require the TypeScript to match each one exactly (`allocate` on both its number and bigint paths). The TypeScript for tax, scale and conversion is tested, not proved (see below).

`pnpm gen:check`, which runs in every check without Lean, fails in two cases. One is any unfinished proof (`sorry`, `admit`, a new `axiom`, `native_decide`). The other is a generated file that was edited by hand or not regenerated after `proofs/` changed: each generated file carries a hash of the Lean sources it came from. `pnpm gen:kernel:check` needs Lean, and CI runs it. It rebuilds the proofs, checks that the headline theorems depend only on Lean's standard axioms (`propext`, `Classical.choice`, `Quot.sound`), and fails if either generated file differs from what the proofs print.

## Rounding kernels: proved code (`proofs/Ducat/Rounding.lean`)

`Rounds m p d q` is the specification: "`q` is `p / d` rounded with mode `m`", written as integer inequalities on the error `p − d·q`. For example, `floor` means `q ≤ p/d < q + 1`. The half modes mean `|p/d − q| ≤ ½`, with the tie going where the mode says. `unnecessary` means the division is exact. For a divisor `d > 0`:

- `kernel_sound`: whatever the generated kernel returns is correctly rounded.
- `rounds_unique`: the specification has at most one answer, so "correctly rounded" means "the right answer".
- `kernel_fails_iff`: the kernel throws exactly for `unnecessary` on an inexact division, and never otherwise.
- `kernel_correct`: so whenever a correctly rounded answer exists, the kernel returns it.

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

## XNPV's bounds: proved model (`proofs/Ducat/Xnpv.lean`)

`xnpvBounds`, `xnpv` and `xirr` in `@ducatjs/money/excel` bracket each discount factor `(1 + rate)^(n/m)` in integer arithmetic at a fixed-point scale `S = 2^bits` and sum the terms' bounds. The model states those steps; the loop is the one `fixedPower` runs, and the Calc and Microsoft tests compare the TypeScript with Excel's values.

- `root_floor_inside`, `root_bracket`: flooring `a·S^m / b` before the integer `m`th root changes nothing, so the root `R` satisfies `R^m·b ≤ a·S^m < (R + 1)^m·b`, that is `R/S ≤ g^(1/m) < (R + 1)/S`.
- `mulFloor_le`, `le_mulCeil`: a floored fixed-point product of lower bounds is a lower bound of the exact product, and a ceiled product of upper bounds an upper bound.
- `fixedPower_floor_le`, `le_fixedPower_ceil`: the square-and-multiply loop with every product floored (or ceiled), started from a lower (or upper) bound of `X`, is a lower (or upper) bound of `X^n`, for every `n`. With `R` and `R + 1`, they bracket `g^(n/m)`.
- `quotient_bounds`, `grid_bounds`, `sum_bounds`: a term `v / F` with `F` in `[Fl, Fh]` lies between `v / Fh` and `v / Fl` (swapped for `v < 0`), flooring and ceiling to the grid keeps it inside, and the terms' bounds sum to bounds on the sum.

So the interval `xnpvBounds` returns contains XNPV at every precision. That `xnpv`'s rounded value is right then needs only that rounding is monotone (two ends that round alike pin everything between), which is argued in [the finance design](finance-design.md), not proved here.

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
