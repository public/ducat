import Mathlib.Tactic

/-!
# XNPV's guaranteed bounds

Models of the integer steps `xnpvBounds`, `xnpv` and `xirr` in `src/excel.ts` take to bracket
`Σ vᵢ / g^(nᵢ/mᵢ)` for `g = a/b`, at a fixed-point scale `S = 2^P`:

* `root_floor_inside`: flooring `a·S^m / b` before the integer `m`th root changes nothing, so the
  root `R` the code finds satisfies `R^m·b ≤ a·S^m < (R + 1)^m·b`, i.e. `R/S ≤ g^(1/m) < (R + 1)/S`.
* `mulFloor_le`, `le_mulCeil`: one fixed-point product, floored or ceiled, is a lower or an upper
  bound of the exact product of what its factors bound.
* `loop_floor_le`, `le_loop_ceil`: the square-and-multiply loop `fixedPower` runs, with every product
  floored (or ceiled), is a lower (or upper) bound of `X^n` when it starts from a lower (or upper)
  bound of `X`. With `R` and `R + 1`, they bracket `g^(n/m)`.
* `quotient_bounds`: a term `v / F` with `F` in `[Fl, Fh]` lies between `v / Fh` and `v / Fl` (or the
  other way round for `v < 0`), and flooring and ceiling to the grid keeps it inside.
* `sum_bounds`: the terms' bounds sum to bounds on the sum.

So `[Σ lowᵢ, Σ highᵢ] / S` contains XNPV: the interval `xnpvBounds` returns is sound at every
precision, which is the error bound. That rounding is monotone in every mode (so two ends that
round alike pin the rounded value) is argued in docs/explanation/finance-design.md §3d.
-/

namespace Ducat.Xnpv

/-! ## The root -/

/-- Flooring inside the root: `R^m ≤ ⌊N / D⌋ ↔ R^m·D ≤ N`. -/
theorem root_floor_inside (R m N D : ℕ) (hD : 0 < D) : R ^ m ≤ N / D ↔ R ^ m * D ≤ N :=
  Nat.le_div_iff_mul_le hD

/-- The root bracket, multiplied out: from the floor of the `m`th root of `⌊a·S^m / b⌋`. -/
theorem root_bracket (R m a b S : ℕ) (hb : 0 < b)
    (hlow : R ^ m ≤ a * S ^ m / b) (hhigh : a * S ^ m / b < (R + 1) ^ m) :
    R ^ m * b ≤ a * S ^ m ∧ a * S ^ m < (R + 1) ^ m * b :=
  ⟨(Nat.le_div_iff_mul_le hb).mp hlow, (Nat.div_lt_iff_lt_mul hb).mp hhigh⟩

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
theorem div_as_square (x S : ℚ) (hS : S ≠ 0) : x / S = x * S / (S * S) :=
  (mul_div_mul_right x S hS).symm

/-- A floored product of lower bounds is a lower bound of the product. -/
theorem mulFloor_le (S a b : ℕ) (hS : 0 < S) (A B : ℚ) (hA : (a : ℚ) / S ≤ A)
    (hB : (b : ℚ) / S ≤ B) : (mulFloor S a b : ℚ) / S ≤ A * B := by
  have hS' : (0 : ℚ) < S := by exact_mod_cast hS
  have key : ((mulFloor S a b * S : ℕ) : ℚ) ≤ ((a * b : ℕ) : ℚ) := by
    exact_mod_cast mulFloor_mul_le S a b
  push_cast at key
  have ha : (0 : ℚ) ≤ (a : ℚ) / S := by positivity
  have hb : (0 : ℚ) ≤ (b : ℚ) / S := by positivity
  calc (mulFloor S a b : ℚ) / S = (mulFloor S a b : ℚ) * S / (S * S) :=
        div_as_square _ _ hS'.ne'
    _ ≤ (a : ℚ) * b / (S * S) := div_le_div_of_nonneg_right key (by positivity)
    _ = ((a : ℚ) / S) * ((b : ℚ) / S) := (div_mul_div_comm _ _ _ _).symm
    _ ≤ A * B := mul_le_mul hA hB hb (le_trans ha hA)

/-- A ceiled product of upper bounds is an upper bound of the product. -/
theorem le_mulCeil (S a b : ℕ) (hS : 0 < S) (A B : ℚ) (hA0 : 0 ≤ A) (hB0 : 0 ≤ B)
    (hA : A ≤ (a : ℚ) / S) (hB : B ≤ (b : ℚ) / S) : A * B ≤ (mulCeil S a b : ℚ) / S := by
  have hS' : (0 : ℚ) < S := by exact_mod_cast hS
  have key : ((a * b : ℕ) : ℚ) ≤ ((mulCeil S a b * S : ℕ) : ℚ) := by
    exact_mod_cast le_mulCeil_mul S a b hS
  push_cast at key
  calc A * B ≤ ((a : ℚ) / S) * ((b : ℚ) / S) := mul_le_mul hA hB hB0 (le_trans hA0 hA)
    _ = (a : ℚ) * b / (S * S) := div_mul_div_comm _ _ _ _
    _ ≤ (mulCeil S a b : ℚ) * S / (S * S) := div_le_div_of_nonneg_right key (by positivity)
    _ = (mulCeil S a b : ℚ) / S := (div_as_square _ _ hS'.ne').symm

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
    ∀ (rest result square : ℕ) (R Q : ℚ), 0 ≤ R → 0 ≤ Q → (result : ℚ) / S ≤ R →
      (square : ℚ) / S ≤ Q → (loop (mulFloor S) result square rest : ℚ) / S ≤ R * Q ^ rest := by
  intro rest
  induction rest using Nat.strong_induction_on with
  | _ rest ih =>
    intro result square R Q hR hQ hres hsq
    rw [loop]
    split_ifs with h0
    · subst h0; simpa using hres
    · have hlt : rest / 2 < rest := by omega
      have hrest : rest = 2 * (rest / 2) + rest % 2 := (Nat.div_add_mod rest 2).symm
      -- the new result bounds R·Q^(rest % 2), the new square Q^2 (or Q when no square is taken)
      have hres' : ((if rest % 2 = 1 then mulFloor S result square else result : ℕ) : ℚ) / S ≤
          R * Q ^ (rest % 2) := by
        split_ifs with hbit
        · rw [hbit, pow_one]; exact mulFloor_le S result square hS R Q hres hsq
        · have : rest % 2 = 0 := by omega
          rw [this, pow_zero, mul_one]; exact hres
      by_cases hmore : rest > 1
      · have hsq' : ((if rest > 1 then mulFloor S square square else square : ℕ) : ℚ) / S ≤
            Q ^ 2 := by
          rw [if_pos hmore, sq]; exact mulFloor_le S square square hS Q Q hsq hsq
        have := ih (rest / 2) hlt _ _ (R * Q ^ (rest % 2)) (Q ^ 2) (by positivity) (by positivity)
          hres' hsq'
        calc _ ≤ R * Q ^ (rest % 2) * (Q ^ 2) ^ (rest / 2) := this
          _ = R * Q ^ rest := by
            rw [← pow_mul, mul_assoc, ← pow_add]; congr 2; omega
      · have h1 : rest = 1 := by omega
        have h2 : rest / 2 = 0 := by omega
        have := ih (rest / 2) hlt _ _ (R * Q ^ (rest % 2)) Q (by positivity) hQ hres'
          (by rw [if_neg hmore]; exact hsq)
        calc _ ≤ R * Q ^ (rest % 2) * Q ^ (rest / 2) := this
          _ = R * Q ^ rest := by rw [h2, h1]; norm_num

/-- With every product ceiled, the loop is an upper bound of `R·Q^rest`. -/
theorem le_loop_ceil (S : ℕ) (hS : 0 < S) :
    ∀ (rest result square : ℕ) (R Q : ℚ), 0 ≤ R → 0 ≤ Q → R ≤ (result : ℚ) / S →
      Q ≤ (square : ℚ) / S → R * Q ^ rest ≤ (loop (mulCeil S) result square rest : ℚ) / S := by
  intro rest
  induction rest using Nat.strong_induction_on with
  | _ rest ih =>
    intro result square R Q hR hQ hres hsq
    rw [loop]
    split_ifs with h0
    · subst h0; simpa using hres
    · have hlt : rest / 2 < rest := by omega
      have hres' : R * Q ^ (rest % 2) ≤
          ((if rest % 2 = 1 then mulCeil S result square else result : ℕ) : ℚ) / S := by
        split_ifs with hbit
        · rw [hbit, pow_one]; exact le_mulCeil S result square hS R Q hR hQ hres hsq
        · have : rest % 2 = 0 := by omega
          rw [this, pow_zero, mul_one]; exact hres
      by_cases hmore : rest > 1
      · have hsq' : Q ^ 2 ≤
            ((if rest > 1 then mulCeil S square square else square : ℕ) : ℚ) / S := by
          rw [if_pos hmore, sq]; exact le_mulCeil S square square hS Q Q hQ hQ hsq hsq
        have := ih (rest / 2) hlt _ _ (R * Q ^ (rest % 2)) (Q ^ 2) (by positivity) (by positivity)
          hres' hsq'
        calc R * Q ^ rest = R * Q ^ (rest % 2) * (Q ^ 2) ^ (rest / 2) := by
              rw [← pow_mul, mul_assoc, ← pow_add]; congr 2; omega
          _ ≤ _ := this
      · have h1 : rest = 1 := by omega
        have h2 : rest / 2 = 0 := by omega
        have := ih (rest / 2) hlt _ _ (R * Q ^ (rest % 2)) Q (by positivity) hQ hres'
          (by rw [if_neg hmore]; exact hsq)
        calc R * Q ^ rest = R * Q ^ (rest % 2) * Q ^ (rest / 2) := by rw [h2, h1]; norm_num
          _ ≤ _ := this

/-- `fixedPower(x, n)` floored, from `result = S` (1.0): a lower bound of `X^n` when `x/S ≤ X`. -/
theorem fixedPower_floor_le (S x n : ℕ) (hS : 0 < S) (X : ℚ) (hX : (x : ℚ) / S ≤ X) (hX0 : 0 ≤ X) :
    (loop (mulFloor S) S x n : ℚ) / S ≤ X ^ n := by
  have hS' : (S : ℚ) ≠ 0 := by exact_mod_cast hS.ne'
  simpa using loop_floor_le S hS n S x 1 X zero_le_one hX0 (by rw [div_self hS']) hX

/-- `fixedPower(x, n)` ceiled, from `result = S`: an upper bound of `X^n` when `X ≤ x/S`. -/
theorem le_fixedPower_ceil (S x n : ℕ) (hS : 0 < S) (X : ℚ) (hX : X ≤ (x : ℚ) / S) (hX0 : 0 ≤ X) :
    X ^ n ≤ (loop (mulCeil S) S x n : ℚ) / S := by
  have hS' : (S : ℚ) ≠ 0 := by exact_mod_cast hS.ne'
  simpa using le_loop_ceil S hS n S x 1 X zero_le_one hX0 (by rw [div_self hS']) hX

/-! ## Terms and the sum -/

/-- A term `v / F` with `0 < Fl ≤ F ≤ Fh`: for `v ≥ 0` it lies in `[v / Fh, v / Fl]`, else in
`[v / Fl, v / Fh]`. -/
theorem quotient_bounds (v F Fl Fh : ℚ) (hl : 0 < Fl) (hlo : Fl ≤ F) (hhi : F ≤ Fh) :
    (0 ≤ v → v / Fh ≤ v / F ∧ v / F ≤ v / Fl) ∧ (v < 0 → v / Fl ≤ v / F ∧ v / F ≤ v / Fh) := by
  have hF : 0 < F := lt_of_lt_of_le hl hlo
  have hh : 0 < Fh := lt_of_lt_of_le hF hhi
  refine ⟨fun hv => ⟨?_, ?_⟩, fun hv => ⟨?_, ?_⟩⟩
  · exact div_le_div_of_nonneg_left hv hF hhi
  · exact div_le_div_of_nonneg_left hv hl hlo
  · rw [div_le_div_iff₀ hl hF]; nlinarith
  · rw [div_le_div_iff₀ hF hh]; nlinarith

/-- Flooring and ceiling to the grid keep a value inside: `⌊q⌋ ≤ q ≤ ⌈q⌉`. -/
theorem grid_bounds (q : ℚ) : (⌊q⌋ : ℚ) ≤ q ∧ q ≤ (⌈q⌉ : ℚ) := ⟨Int.floor_le q, Int.le_ceil q⟩

/-- The terms' bounds sum to bounds on the sum. -/
theorem sum_bounds {ι : Type*} (s : Finset ι) (low x high : ι → ℚ)
    (h : ∀ i ∈ s, low i ≤ x i ∧ x i ≤ high i) :
    s.sum low ≤ s.sum x ∧ s.sum x ≤ s.sum high :=
  ⟨Finset.sum_le_sum fun i hi => (h i hi).1, Finset.sum_le_sum fun i hi => (h i hi).2⟩

end Ducat.Xnpv
