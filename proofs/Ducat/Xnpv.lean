import Mathlib.Tactic
import Mathlib.Analysis.SpecialFunctions.Pow.Real
import Ducat.Rounding

/-!
# XNPV's guaranteed bounds

Models of the integer steps `xnpvBounds`, `xnpv` and `xirr` in `src/excel.ts` take to bracket
`Σ vᵢ / g^(nᵢ/mᵢ)` for `g = a/b`, at a fixed-point scale `S = 2^P`. The values are real numbers
(`Real.rpow` for the roots), and the bounds are proved over ℝ:

* `exponent_split`, `power_split`: given the exponent identity `n = W·m + Σ r·c` (with `q·c = m` for
  each prime power `q` of the denominator, which the code checks at run time), `n/m = W + Σ r/q`
  and `g^(n/m) = g^W·Π g^(r/q)` for `g > 0`.
* `root_floor_inside`, `root_bracket`: flooring `a·S^q / b` before the integer `q`th root changes
  nothing, so the root `R` the code finds satisfies `R^q·b ≤ a·S^q < (R + 1)^q·b`.
* `real_root_bracket`: that integer inequality puts the real root in `[R/S, (R + 1)/S)`:
  `R/S ≤ (a/b)^(1/q) < (R + 1)/S`.
* `mulFloor_le`, `le_mulCeil`: one fixed-point product, floored or ceiled, is a lower or an upper
  bound of the exact product of what its factors bound.
* `loop_floor_le`, `le_loop_ceil`, `fixedPower_floor_le`, `le_fixedPower_ceil`: the
  square-and-multiply loop `fixedPower` runs, with every product floored (or ceiled), is a lower
  (or upper) bound of `X^n` when it starts from a lower (or upper) bound of `X`.
* `factor_bracket`: hence `fixedPower(R, r)` floored and `fixedPower(R + 1, r)` ceiled bracket
  `S·g^(r/q)`.
* `fold_floor_le`, `le_fold_ceil`: a flow's factors, multiplied left to right with every product
  floored (or ceiled), bound their product `Π g^(r/q)`.
* `sum_regroup`, `group_common_factor`: summing the flows with the same irrational part first, as one
  coefficient over that part, is exact, so a group whose coefficient is 0 contributes exactly 0.
* `quotient_bounds`: a term `v / F` with `F` in `[Fl, Fh]` lies between `v / Fh` and `v / Fl` (or the
  other way round for `v < 0`), and flooring and ceiling to the grid keeps it inside.
* `sum_bounds`: the terms' bounds sum to bounds on the sum.
* `xnpv_rounds`: when the two ends of the bracket round alike (`Rounds`, the proved kernels' spec),
  the real value rounds to that amount too (`RoundsR`, monotonicity in `Ducat/Rounding.lean`).

Not proved here: the CRT computation of the split (`splitExponent` checks the identity at run time
and throws if it fails, so the identity is a hypothesis of `power_split`), and the exact bigint
arithmetic of `g^(−W)`, rational roots and the rational remainder. The TypeScript is checked
against this model by tests, not by proof.
-/

namespace Ducat.Xnpv

/-! ## The split

`splitExponent` in `src/excel.ts` writes a year fraction `n/m` as `W + Σ r/q` over the prime powers
`q` of `m`, with cofactor `c = m/q`: each part is a triple `(q, r, c)`. It computes `r` by the CRT
and checks `n = W·m + Σ r·c` at run time, throwing if it fails; that identity is the hypothesis
here. -/

/-- The exponent identity, divided by `m`: `n/m = W + Σ r/q`. -/
theorem exponent_split (n W : ℤ) (m : ℕ) (hm : 0 < m) (parts : List (ℕ × ℕ × ℕ))
    (hparts : ∀ p ∈ parts, p.1 * p.2.2 = m)
    (hid : n = W * m + (parts.map fun p => (p.2.1 : ℤ) * p.2.2).sum) :
    (n : ℝ) / m = W + (parts.map fun p => (p.2.1 : ℝ) / p.1).sum := by
  have hm' : (m : ℝ) ≠ 0 := by exact_mod_cast hm.ne'
  have key : ∀ l : List (ℕ × ℕ × ℕ), (∀ p ∈ l, p.1 * p.2.2 = m) →
      (((l.map fun p => (p.2.1 : ℤ) * p.2.2).sum : ℤ) : ℝ) =
        m * (l.map fun p => (p.2.1 : ℝ) / p.1).sum := by
    intro l
    induction l with
    | nil => intro _; simp
    | cons p ps ih =>
      intro h
      have hp := h p (List.mem_cons_self ..)
      have hq0 : p.1 ≠ 0 := by
        intro h0
        rw [h0, zero_mul] at hp
        omega
      have hq : (p.1 : ℝ) ≠ 0 := by exact_mod_cast hq0
      have hp' : (p.1 : ℝ) * p.2.2 = m := by exact_mod_cast hp
      simp only [List.map_cons, List.sum_cons, Int.cast_add, Int.cast_mul, Int.cast_natCast]
      rw [ih (fun q hq => h q (List.mem_cons_of_mem _ hq)), ← hp']
      field_simp
      all_goals ring
  have hid' := congrArg (fun z : ℤ => (z : ℝ)) hid
  simp only [Int.cast_add, Int.cast_mul, Int.cast_natCast] at hid'
  rw [hid', key parts hparts]
  field_simp
  all_goals ring

/-- `g` to a sum is the product of the powers. -/
theorem rpow_list_sum {α : Type*} (g : ℝ) (hg : 0 < g) (f : α → ℝ) :
    ∀ l : List α, g ^ (l.map f).sum = (l.map fun x => g ^ f x).prod
  | [] => by simp
  | x :: xs => by
    rw [List.map_cons, List.sum_cons, Real.rpow_add hg, rpow_list_sum g hg f xs, List.map_cons,
      List.prod_cons]

/-- The real-power law behind the split: `g^(n/m) = g^W·Π g^(r/q)` for `g > 0`. -/
theorem power_split (g : ℝ) (hg : 0 < g) (n W : ℤ) (m : ℕ) (hm : 0 < m)
    (parts : List (ℕ × ℕ × ℕ)) (hparts : ∀ p ∈ parts, p.1 * p.2.2 = m)
    (hid : n = W * m + (parts.map fun p => (p.2.1 : ℤ) * p.2.2).sum) :
    g ^ ((n : ℝ) / m) = g ^ W * (parts.map fun p => g ^ ((p.2.1 : ℝ) / p.1)).prod := by
  rw [exponent_split n W m hm parts hparts hid, Real.rpow_add hg, Real.rpow_intCast,
    rpow_list_sum g hg]

/-! ## The root -/

/-- Flooring inside the root: `R^m ≤ ⌊N / D⌋ ↔ R^m·D ≤ N`. -/
theorem root_floor_inside (R m N D : ℕ) (hD : 0 < D) : R ^ m ≤ N / D ↔ R ^ m * D ≤ N :=
  Nat.le_div_iff_mul_le hD

/-- The root bracket, multiplied out: from the floor of the `m`th root of `⌊a·S^m / b⌋`. -/
theorem root_bracket (R m a b S : ℕ) (hb : 0 < b)
    (hlow : R ^ m ≤ a * S ^ m / b) (hhigh : a * S ^ m / b < (R + 1) ^ m) :
    R ^ m * b ≤ a * S ^ m ∧ a * S ^ m < (R + 1) ^ m * b :=
  ⟨(Nat.le_div_iff_mul_le hb).mp hlow, (Nat.div_lt_iff_lt_mul hb).mp hhigh⟩

/-- The real root step: the integer inequality puts `g^(1/q)` for `g = a/b` in `[R/S, (R + 1)/S)`,
since `x ↦ x^(1/q)` is monotone for `x ≥ 0`. -/
theorem real_root_bracket (R q a b S : ℕ) (hq : q ≠ 0) (hb : 0 < b) (hS : 0 < S)
    (hlow : R ^ q * b ≤ a * S ^ q) (hhigh : a * S ^ q < (R + 1) ^ q * b) :
    (R : ℝ) / S ≤ ((a : ℝ) / b) ^ ((q : ℝ)⁻¹) ∧
      ((a : ℝ) / b) ^ ((q : ℝ)⁻¹) < ((R : ℝ) + 1) / S := by
  have hb' : (0 : ℝ) < b := by exact_mod_cast hb
  have hS' : (0 : ℝ) < S := by exact_mod_cast hS
  have hSq : (0 : ℝ) < (S : ℝ) ^ q := by positivity
  have hlow' : (R : ℝ) ^ q * b ≤ a * (S : ℝ) ^ q := by exact_mod_cast hlow
  have hhigh' : (a : ℝ) * (S : ℝ) ^ q < ((R : ℝ) + 1) ^ q * b := by exact_mod_cast hhigh
  have hinv : (0 : ℝ) < (q : ℝ)⁻¹ := by
    have : (0 : ℝ) < q := by exact_mod_cast Nat.pos_of_ne_zero hq
    exact inv_pos.mpr this
  have hpow_low : ((R : ℝ) / S) ^ q ≤ (a : ℝ) / b := by
    rw [div_pow, div_le_div_iff₀ hSq hb']
    linarith
  have hpow_high : (a : ℝ) / b < (((R : ℝ) + 1) / S) ^ q := by
    rw [div_pow, div_lt_div_iff₀ hb' hSq]
    linarith
  constructor
  · calc (R : ℝ) / S = (((R : ℝ) / S) ^ q) ^ ((q : ℝ)⁻¹) :=
          (Real.pow_rpow_inv_natCast (by positivity) hq).symm
      _ ≤ ((a : ℝ) / b) ^ ((q : ℝ)⁻¹) := Real.rpow_le_rpow (by positivity) hpow_low hinv.le
  · calc ((a : ℝ) / b) ^ ((q : ℝ)⁻¹) < ((((R : ℝ) + 1) / S) ^ q) ^ ((q : ℝ)⁻¹) :=
          Real.rpow_lt_rpow (by positivity) hpow_high hinv
      _ = ((R : ℝ) + 1) / S := Real.pow_rpow_inv_natCast (by positivity) hq

/-! ## Fixed-point products -/

/-- A product at scale `S`, floored: `a·b / S`. -/
def mulFloor (S a b : ℕ) : ℕ := a * b / S

/-- A product at scale `S`, ceiled: `(a·b + S − 1) / S`. -/
def mulCeil (S a b : ℕ) : ℕ := (a * b + S - 1) / S

theorem mulFloor_mul_le (S a b : ℕ) : mulFloor S a b * S ≤ a * b := Nat.div_mul_le_self _ _

theorem le_mulCeil_mul (S a b : ℕ) (hS : 0 < S) : a * b ≤ mulCeil S a b * S := by
  unfold mulCeil
  have h := Nat.lt_div_mul_add (a := a * b + S - 1) hS
  omega

/-- `x / S` as `x·S / S²`, and a product of two `/ S` as one `/ S²`. -/
theorem div_as_square (x S : ℝ) (hS : S ≠ 0) : x / S = x * S / (S * S) :=
  (mul_div_mul_right x S hS).symm

/-- A floored product of lower bounds is a lower bound of the product. -/
theorem mulFloor_le (S a b : ℕ) (hS : 0 < S) (A B : ℝ) (hA : (a : ℝ) / S ≤ A)
    (hB : (b : ℝ) / S ≤ B) : (mulFloor S a b : ℝ) / S ≤ A * B := by
  have hS' : (0 : ℝ) < S := by exact_mod_cast hS
  have key : ((mulFloor S a b * S : ℕ) : ℝ) ≤ ((a * b : ℕ) : ℝ) := by
    exact_mod_cast mulFloor_mul_le S a b
  push_cast at key
  have ha : (0 : ℝ) ≤ (a : ℝ) / S := by positivity
  have hb : (0 : ℝ) ≤ (b : ℝ) / S := by positivity
  calc (mulFloor S a b : ℝ) / S = (mulFloor S a b : ℝ) * S / (S * S) :=
        div_as_square _ _ hS'.ne'
    _ ≤ (a : ℝ) * b / (S * S) := div_le_div_of_nonneg_right key (by positivity)
    _ = ((a : ℝ) / S) * ((b : ℝ) / S) := (div_mul_div_comm _ _ _ _).symm
    _ ≤ A * B := mul_le_mul hA hB hb (le_trans ha hA)

/-- A ceiled product of upper bounds is an upper bound of the product. -/
theorem le_mulCeil (S a b : ℕ) (hS : 0 < S) (A B : ℝ) (hA0 : 0 ≤ A) (hB0 : 0 ≤ B)
    (hA : A ≤ (a : ℝ) / S) (hB : B ≤ (b : ℝ) / S) : A * B ≤ (mulCeil S a b : ℝ) / S := by
  have hS' : (0 : ℝ) < S := by exact_mod_cast hS
  have key : ((a * b : ℕ) : ℝ) ≤ ((mulCeil S a b * S : ℕ) : ℝ) := by
    exact_mod_cast le_mulCeil_mul S a b hS
  push_cast at key
  calc A * B ≤ ((a : ℝ) / S) * ((b : ℝ) / S) := mul_le_mul hA hB hB0 (le_trans hA0 hA)
    _ = (a : ℝ) * b / (S * S) := div_mul_div_comm _ _ _ _
    _ ≤ (mulCeil S a b : ℝ) * S / (S * S) := div_le_div_of_nonneg_right key (by positivity)
    _ = (mulCeil S a b : ℝ) / S := (div_as_square _ _ hS'.ne').symm

/-! ## The square-and-multiply loop

`fixedPower` in `src/excel.ts`: `result` starts at `S` (1.0), `square` at the base; for each bit of
the exponent from the lowest, multiply `result` by `square` when the bit is 1, and square `square`
unless this was the last bit. -/

def loop (mul : ℕ → ℕ → ℕ) (result square rest : ℕ) : ℕ :=
  if rest = 0 then result
  else
    loop mul (if rest % 2 = 1 then mul result square else result)
      (if rest > 1 then mul square square else square) (rest / 2)
termination_by rest
decreasing_by omega

/-- With every product floored, the loop is a lower bound of `R·Q^rest`. -/
theorem loop_floor_le (S : ℕ) (hS : 0 < S) :
    ∀ (rest result square : ℕ) (R Q : ℝ), 0 ≤ R → 0 ≤ Q → (result : ℝ) / S ≤ R →
      (square : ℝ) / S ≤ Q → (loop (mulFloor S) result square rest : ℝ) / S ≤ R * Q ^ rest := by
  intro rest
  induction rest using Nat.strong_induction_on with
  | _ rest ih =>
    intro result square R Q hR hQ hres hsq
    rw [loop]
    by_cases h0 : rest = 0
    · rw [if_pos h0]
      subst h0
      simpa using hres
    rw [if_neg h0]
    have hlt : rest / 2 < rest := by omega
    have hsplit : rest % 2 + 2 * (rest / 2) = rest := by omega
    -- the new result bounds R·Q^(rest % 2)
    obtain ⟨r', hr', hr'eq⟩ : ∃ r' : ℕ, (r' : ℝ) / S ≤ R * Q ^ (rest % 2) ∧
        (if rest % 2 = 1 then mulFloor S result square else result) = r' := by
      by_cases hbit : rest % 2 = 1
      · refine ⟨mulFloor S result square, ?_, if_pos hbit⟩
        rw [hbit, pow_one]
        exact mulFloor_le S result square hS R Q hres hsq
      · refine ⟨result, ?_, if_neg hbit⟩
        have hzero : rest % 2 = 0 := by omega
        rw [hzero, pow_zero, mul_one]
        exact hres
    rw [hr'eq]
    by_cases hmore : rest > 1
    · rw [if_pos hmore]
      have hsq' : (mulFloor S square square : ℝ) / S ≤ Q ^ 2 := by
        rw [sq]
        exact mulFloor_le S square square hS Q Q hsq hsq
      have step := ih (rest / 2) hlt r' (mulFloor S square square) (R * Q ^ (rest % 2)) (Q ^ 2)
        (by positivity) (by positivity) hr' hsq'
      calc (loop (mulFloor S) r' (mulFloor S square square) (rest / 2) : ℝ) / S
          ≤ R * Q ^ (rest % 2) * (Q ^ 2) ^ (rest / 2) := step
        _ = R * Q ^ rest := by
          rw [← pow_mul, mul_assoc, ← pow_add, hsplit]
    · rw [if_neg hmore]
      have h1 : rest = 1 := by omega
      have step := ih (rest / 2) hlt r' square (R * Q ^ (rest % 2)) Q (by positivity) hQ hr' hsq
      calc (loop (mulFloor S) r' square (rest / 2) : ℝ) / S
          ≤ R * Q ^ (rest % 2) * Q ^ (rest / 2) := step
        _ = R * Q ^ rest := by
          rw [h1]
          norm_num

/-- With every product ceiled, the loop is an upper bound of `R·Q^rest`. -/
theorem le_loop_ceil (S : ℕ) (hS : 0 < S) :
    ∀ (rest result square : ℕ) (R Q : ℝ), 0 ≤ R → 0 ≤ Q → R ≤ (result : ℝ) / S →
      Q ≤ (square : ℝ) / S → R * Q ^ rest ≤ (loop (mulCeil S) result square rest : ℝ) / S := by
  intro rest
  induction rest using Nat.strong_induction_on with
  | _ rest ih =>
    intro result square R Q hR hQ hres hsq
    rw [loop]
    by_cases h0 : rest = 0
    · rw [if_pos h0]
      subst h0
      simpa using hres
    rw [if_neg h0]
    have hlt : rest / 2 < rest := by omega
    have hsplit : rest % 2 + 2 * (rest / 2) = rest := by omega
    obtain ⟨r', hr', hr'eq⟩ : ∃ r' : ℕ, R * Q ^ (rest % 2) ≤ (r' : ℝ) / S ∧
        (if rest % 2 = 1 then mulCeil S result square else result) = r' := by
      by_cases hbit : rest % 2 = 1
      · refine ⟨mulCeil S result square, ?_, if_pos hbit⟩
        rw [hbit, pow_one]
        exact le_mulCeil S result square hS R Q hR hQ hres hsq
      · refine ⟨result, ?_, if_neg hbit⟩
        have hzero : rest % 2 = 0 := by omega
        rw [hzero, pow_zero, mul_one]
        exact hres
    rw [hr'eq]
    by_cases hmore : rest > 1
    · rw [if_pos hmore]
      have hsq' : Q ^ 2 ≤ (mulCeil S square square : ℝ) / S := by
        rw [sq]
        exact le_mulCeil S square square hS Q Q hQ hQ hsq hsq
      have step := ih (rest / 2) hlt r' (mulCeil S square square) (R * Q ^ (rest % 2)) (Q ^ 2)
        (by positivity) (by positivity) hr' hsq'
      calc R * Q ^ rest = R * Q ^ (rest % 2) * (Q ^ 2) ^ (rest / 2) := by
            rw [← pow_mul, mul_assoc, ← pow_add, hsplit]
        _ ≤ (loop (mulCeil S) r' (mulCeil S square square) (rest / 2) : ℝ) / S := step
    · rw [if_neg hmore]
      have h1 : rest = 1 := by omega
      have step := ih (rest / 2) hlt r' square (R * Q ^ (rest % 2)) Q (by positivity) hQ hr' hsq
      calc R * Q ^ rest = R * Q ^ (rest % 2) * Q ^ (rest / 2) := by
            rw [h1]
            norm_num
        _ ≤ (loop (mulCeil S) r' square (rest / 2) : ℝ) / S := step

/-- `fixedPower(x, n)` floored, from `result = S` (1.0): a lower bound of `X^n` when `x/S ≤ X`. -/
theorem fixedPower_floor_le (S x n : ℕ) (hS : 0 < S) (X : ℝ) (hX : (x : ℝ) / S ≤ X) (hX0 : 0 ≤ X) :
    (loop (mulFloor S) S x n : ℝ) / S ≤ X ^ n := by
  have hS' : (S : ℝ) ≠ 0 := by exact_mod_cast hS.ne'
  simpa using loop_floor_le S hS n S x 1 X zero_le_one hX0 (by rw [div_self hS']) hX

/-- `fixedPower(x, n)` ceiled, from `result = S`: an upper bound of `X^n` when `X ≤ x/S`. -/
theorem le_fixedPower_ceil (S x n : ℕ) (hS : 0 < S) (X : ℝ) (hX : X ≤ (x : ℝ) / S) (hX0 : 0 ≤ X) :
    X ^ n ≤ (loop (mulCeil S) S x n : ℝ) / S := by
  have hS' : (S : ℝ) ≠ 0 := by exact_mod_cast hS.ne'
  simpa using le_loop_ceil S hS n S x 1 X zero_le_one hX0 (by rw [div_self hS']) hX

/-- One irrational factor: with `R` from the root step, `fixedPower(R, r)` floored and
`fixedPower(R + 1, r)` ceiled bracket `S·g^(r/q)`, as `g^(r/q) = (g^(1/q))^r`. -/
theorem factor_bracket (R q r a b S : ℕ) (hq : q ≠ 0) (hb : 0 < b) (hS : 0 < S)
    (hlow : R ^ q * b ≤ a * S ^ q) (hhigh : a * S ^ q < (R + 1) ^ q * b) :
    (loop (mulFloor S) S R r : ℝ) / S ≤ ((a : ℝ) / b) ^ ((r : ℝ) / q) ∧
      ((a : ℝ) / b) ^ ((r : ℝ) / q) ≤ (loop (mulCeil S) S (R + 1) r : ℝ) / S := by
  obtain ⟨h1, h2⟩ := real_root_bracket R q a b S hq hb hS hlow hhigh
  have hg : (0 : ℝ) ≤ (a : ℝ) / b := by positivity
  have hX0 : (0 : ℝ) ≤ ((a : ℝ) / b) ^ ((q : ℝ)⁻¹) := Real.rpow_nonneg hg _
  have hexp : (r : ℝ) / q = (q : ℝ)⁻¹ * r := by ring
  have hpow : ((a : ℝ) / b) ^ ((r : ℝ) / q) = (((a : ℝ) / b) ^ ((q : ℝ)⁻¹)) ^ r := by
    rw [hexp, Real.rpow_mul_natCast hg]
  rw [hpow]
  refine ⟨fixedPower_floor_le S R r hS _ h1 hX0, le_fixedPower_ceil S (R + 1) r hS _ ?_ hX0⟩
  push_cast
  exact h2.le

/-! ## Composing the brackets of one flow's factors

A flow's irrational factor is a product `Π g^(r/q)` over its denominator's prime powers. `xnpvScaled`
starts from `S` (1.0) and multiplies in each factor's lower bound with a floored product (and each
upper bound with a ceiled one), left to right: a left fold. -/

/-- The floored left fold of fixed-point products is a lower bound of the product of the bounds. -/
theorem fold_floor_le (S : ℕ) (hS : 0 < S) :
    ∀ (xs : List (ℕ × ℝ)) (acc : ℕ) (A : ℝ), 0 ≤ A → (acc : ℝ) / S ≤ A →
      (∀ p ∈ xs, (p.1 : ℝ) / S ≤ p.2 ∧ 0 ≤ p.2) →
      ((xs.foldl (fun a p => mulFloor S a p.1) acc : ℕ) : ℝ) / S ≤ A * (xs.map Prod.snd).prod := by
  intro xs
  induction xs with
  | nil => intro acc A _ hacc _; simpa using hacc
  | cons p ps ih =>
    intro acc A hA hacc hxs
    have hp := hxs p (List.mem_cons_self ..)
    have step := mulFloor_le S acc p.1 hS A p.2 hacc hp.1
    have rest := ih (mulFloor S acc p.1) (A * p.2) (mul_nonneg hA hp.2) step
      (fun q hq => hxs q (List.mem_cons_of_mem _ hq))
    simpa [List.foldl, List.map, List.prod_cons, mul_assoc] using rest

/-- The ceiled left fold of fixed-point products is an upper bound of the product of the bounds. -/
theorem le_fold_ceil (S : ℕ) (hS : 0 < S) :
    ∀ (xs : List (ℕ × ℝ)) (acc : ℕ) (A : ℝ), 0 ≤ A → A ≤ (acc : ℝ) / S →
      (∀ p ∈ xs, p.2 ≤ (p.1 : ℝ) / S ∧ 0 ≤ p.2) →
      A * (xs.map Prod.snd).prod ≤ ((xs.foldl (fun a p => mulCeil S a p.1) acc : ℕ) : ℝ) / S := by
  intro xs
  induction xs with
  | nil => intro acc A _ hacc _; simpa using hacc
  | cons p ps ih =>
    intro acc A hA hacc hxs
    have hp := hxs p (List.mem_cons_self ..)
    have step := le_mulCeil S acc p.1 hS A p.2 hA hp.2 hacc hp.1
    have rest := ih (mulCeil S acc p.1) (A * p.2) (mul_nonneg hA hp.2) step
      (fun q hq => hxs q (List.mem_cons_of_mem _ hq))
    simpa [List.foldl, List.map, List.prod_cons, mul_assoc] using rest

/-! ## Exact cancellation

`xnpvScaled` sums the flows with the same irrational part first, as one coefficient over that part,
and drops a group whose coefficient is exactly 0. That is a regrouping of the sum and a common
factor, both exact. -/

/-- Regrouping a sum by a key (the irrational part) is exact. -/
theorem sum_regroup {ι κ : Type*} [DecidableEq κ] (s : Finset ι) (key : ι → κ) (f : ι → ℝ) :
    s.sum f = (s.image key).sum fun k => (s.filter fun i => key i = k).sum f :=
  (Finset.sum_fiberwise_of_maps_to (fun i hi => Finset.mem_image_of_mem key hi) f).symm

/-- Within a group, the terms share their factor: `Σ cᵢ / F = (Σ cᵢ) / F`, so a coefficient of
exactly 0 contributes exactly 0. -/
theorem group_common_factor {ι : Type*} (s : Finset ι) (c : ι → ℝ) (F : ℝ) :
    (s.sum fun i => c i / F) = s.sum c / F :=
  (Finset.sum_div s c F).symm

/-! ## Terms and the sum -/

/-- A term `v / F` with `0 < Fl ≤ F ≤ Fh`: for `v ≥ 0` it lies in `[v / Fh, v / Fl]`, else in
`[v / Fl, v / Fh]`. -/
theorem quotient_bounds (v F Fl Fh : ℝ) (hl : 0 < Fl) (hlo : Fl ≤ F) (hhi : F ≤ Fh) :
    (0 ≤ v → v / Fh ≤ v / F ∧ v / F ≤ v / Fl) ∧ (v < 0 → v / Fl ≤ v / F ∧ v / F ≤ v / Fh) := by
  have hF : 0 < F := lt_of_lt_of_le hl hlo
  have hh : 0 < Fh := lt_of_lt_of_le hF hhi
  refine ⟨fun hv => ⟨?_, ?_⟩, fun hv => ⟨?_, ?_⟩⟩
  · exact div_le_div_of_nonneg_left hv hF hhi
  · exact div_le_div_of_nonneg_left hv hl hlo
  · rw [div_le_div_iff₀ hl hF]; nlinarith
  · rw [div_le_div_iff₀ hF hh]; nlinarith

/-- Flooring and ceiling to the grid keep a value inside: `⌊q⌋ ≤ q ≤ ⌈q⌉`. -/
theorem grid_bounds (q : ℝ) : (⌊q⌋ : ℝ) ≤ q ∧ q ≤ (⌈q⌉ : ℝ) := ⟨Int.floor_le q, Int.le_ceil q⟩

/-- The terms' bounds sum to bounds on the sum. -/
theorem sum_bounds {ι : Type*} (s : Finset ι) (low x high : ι → ℝ)
    (h : ∀ i ∈ s, low i ≤ x i ∧ x i ≤ high i) :
    s.sum low ≤ s.sum x ∧ s.sum x ≤ s.sum high :=
  ⟨Finset.sum_le_sum fun i hi => (h i hi).1, Finset.sum_le_sum fun i hi => (h i hi).2⟩

/-! ## The single rounding

`xnpv` rounds the two ends of the bracket, `low / scale` and `high / scale`, with the proved
kernels, and returns that amount when they agree. Rounding is monotone, so the real value between
them rounds to the same amount: it is the value rounded once. -/

/-- When both ends of a bracket round to `q`, so does the real value inside it. -/
theorem xnpv_rounds (m : Mode) (low high d q : ℤ) (hd : 0 < d) (X : ℝ)
    (hlow : (low : ℝ) / d ≤ X) (hhigh : X ≤ (high : ℝ) / d)
    (hl : Rounds m low d q) (hh : Rounds m high d q) : RoundsR m X q :=
  rounds_between m low high d q hd X hlow hhigh hl hh

end Ducat.Xnpv
