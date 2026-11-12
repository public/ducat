import Mathlib.Tactic
import Mathlib.Analysis.SpecialFunctions.Pow.NthRootLemmas

/-!
# The integer searches behind XNPV, XIRR, IRR and RATE

* `newton`, `newton_spec`, `newton_eq_nthRoot`: `floorRoot` in `src/excel.ts` finds the floor of a
  `k`th root by integer Newton, from a start above the root, stepping while the guess falls. From
  any start `guess` with `a < (guess + 1)^k` the loop ends at the floor of the root: `r^k ≤ a <
  (r + 1)^k`, Mathlib's `Nat.nthRoot k a`. So the double that seeds the TypeScript loop (raised
  until it is above the root) can't change the result. `floorRoot` is the model's version, seeded
  from a power of two.
* `bisect`, `bisect_spec`, `bisectRate`, `bisectRate_spec`: `bisectRate` in `src/finance-shared.ts`
  (shared by `irr`, `rate` and `xirr`) without a bracket. For flows with one sign change it starts
  from 0, searches below it (down to the excluded end −1) or doubles above it, then bisects on the
  grid. Whatever it returns is a grid point where the sign is 0, or where the sign is nonzero and
  the next grid point has the opposite sign.

Not modelled: the path with a caller's `bracket` (`bracketToGrid`). The theorems are about signs at
grid points; that a root of the real function lies between two points of opposite sign needs its
continuity, which is not proved here.
-/

namespace Ducat.Search

/-! ## Integer Newton for the floor of a root -/

/-- One integer Newton step towards the `(n + 2)`th root of `a`: `floorRoot`'s
`((k − 1)·guess + a / guess^(k − 1)) / k` for `k = n + 2`, the operands in the order Mathlib's
`Nat.nthRoot.go` takes them. -/
def newtonStep (n a guess : ℕ) : ℕ := (a / guess ^ (n + 1) + (n + 1) * guess) / (n + 2)

/-- `floorRoot`'s loop: step while the guess falls, and return the guess when it stops falling. -/
def newton (n a guess : ℕ) : ℕ :=
  if h : newtonStep n a guess < guess then newton n a (newtonStep n a guess) else guess
termination_by guess
decreasing_by omega

/-- From any start above the root, the loop ends at the floor of the root. -/
theorem newton_spec (n a : ℕ) :
    ∀ guess, a < (guess + 1) ^ (n + 2) →
      newton n a guess ^ (n + 2) ≤ a ∧ a < (newton n a guess + 1) ^ (n + 2) := by
  intro guess
  induction guess using Nat.strong_induction_on with
  | _ guess ih =>
    intro hlt
    rw [newton]
    split_ifs with h
    · rcases Nat.eq_zero_or_pos guess with h0 | h0
      · subst h0
        omega
      · apply ih _ h
        have key := Nat.nthRoot.lt_pow_go_succ_aux (n := n + 1) (a := a) (b := guess) h0.ne'
        first
        | exact key
        | simpa [newtonStep] using key
    · refine ⟨?_, hlt⟩
      have h1 : guess * (n + 2) ≤ a / guess ^ (n + 1) + (n + 1) * guess :=
        (Nat.le_div_iff_mul_le (by omega)).mp (not_lt.mp h)
      have h2 : guess ≤ a / guess ^ (n + 1) := by nlinarith
      have h3 := Nat.mul_le_of_le_div _ _ _ h2
      calc guess ^ (n + 2) = guess * guess ^ (n + 1) := by ring
        _ ≤ a := h3

/-- So every start above the root gives the same answer, Mathlib's floor root. -/
theorem newton_eq_nthRoot (n a guess : ℕ) (h : a < (guess + 1) ^ (n + 2)) :
    newton n a guess = Nat.nthRoot (n + 2) a := by
  obtain ⟨h1, h2⟩ := newton_spec n a guess h
  apply le_antisymm
  · exact (Nat.le_nthRoot_iff (by omega)).mpr h1
  · by_contra hc
    have hc' : newton n a guess + 1 ≤ Nat.nthRoot (n + 2) a := by omega
    have h3 := (Nat.le_nthRoot_iff (n := n + 2) (by omega)).mp hc'
    omega

/-- The model's floor root: `a` itself for `k = 1`, else Newton from `2^(⌊log₂ a⌋ / k + 1)`, a power
of two above the root (or from `a`, should that start be too low). -/
def floorRoot (k a : ℕ) : ℕ :=
  if k ≤ 1 then a
  else if a < (2 ^ (Nat.log2 a / k + 1) + 1) ^ k then newton (k - 2) a (2 ^ (Nat.log2 a / k + 1))
  else newton (k - 2) a a

theorem floorRoot_spec (k a : ℕ) (hk : 1 ≤ k) :
    floorRoot k a ^ k ≤ a ∧ a < (floorRoot k a + 1) ^ k := by
  unfold floorRoot
  by_cases h1 : k ≤ 1
  · have : k = 1 := by omega
    subst this
    simp
  · rw [if_neg h1]
    obtain ⟨n, rfl⟩ : ∃ n, k = n + 2 := ⟨k - 2, by omega⟩
    simp only [Nat.add_sub_cancel]
    split_ifs with h2
    · exact newton_spec n a _ h2
    · apply newton_spec n a a
      calc a < a + 1 := Nat.lt_succ_self a
        _ ≤ (a + 1) ^ (n + 2) := Nat.le_self_pow (by omega) _

/-! ## Bisection on the grid -/

/-- The midpoint as TypeScript computes `(low + high) / 2n`: bigint division truncates towards 0. -/
def midpoint (low high : ℤ) : ℤ :=
  if low + high < 0 then -((-(low + high)) / 2) else (low + high) / 2

theorem midpoint_between (low high : ℤ) (h : 1 < high - low) :
    low < midpoint low high ∧ midpoint low high < high := by
  unfold midpoint
  split_ifs <;> omega

/-- `bisectRate`'s loop: `low` has the sign `lowSign` (or is the excluded end −1), `high` the other. -/
def bisect (signAt : ℤ → ℤ) (lowSign low high : ℤ) : ℤ :=
  if h : 1 < high - low then
    if signAt (midpoint low high) = 0 then midpoint low high
    else if signAt (midpoint low high) = lowSign then
      bisect signAt lowSign (midpoint low high) high
    else bisect signAt lowSign low (midpoint low high)
  else low
termination_by (high - low).toNat
decreasing_by
  all_goals
    have := midpoint_between low high h
    omega

/-- What the search returns: a grid point where the sign is 0, or one with the sign `lowSign` (or
the excluded end `low₀`) where the next point's sign is neither `lowSign` nor 0. -/
def Found (signAt : ℤ → ℤ) (lowSign low₀ r : ℤ) : Prop :=
  signAt r = 0 ∨ ((signAt r = lowSign ∨ r = low₀) ∧ signAt (r + 1) ≠ lowSign ∧ signAt (r + 1) ≠ 0)

theorem bisect_spec (signAt : ℤ → ℤ) (lowSign low₀ : ℤ) :
    ∀ (d : ℕ) (low high : ℤ), (high - low).toNat = d → low < high →
      (signAt low = lowSign ∨ low = low₀) → signAt high ≠ lowSign → signAt high ≠ 0 →
      low ≤ bisect signAt lowSign low high ∧ bisect signAt lowSign low high < high ∧
        Found signAt lowSign low₀ (bisect signAt lowSign low high) := by
  intro d
  induction d using Nat.strong_induction_on with
  | _ d ih =>
    intro low high hd hlt hl hh hh0
    rw [bisect]
    split_ifs with h1 h2 h3
    · have := midpoint_between low high h1
      exact ⟨by omega, by omega, Or.inl h2⟩
    · have hm := midpoint_between low high h1
      obtain ⟨a, b, c⟩ := ih (high - midpoint low high).toNat (by omega) (midpoint low high) high rfl
        hm.2 (Or.inl h3) hh hh0
      exact ⟨by omega, b, c⟩
    · have hm := midpoint_between low high h1
      obtain ⟨a, b, c⟩ := ih (midpoint low high - low).toNat (by omega) low (midpoint low high) rfl
        hm.1 hl h3 h2
      exact ⟨a, by omega, c⟩
    · have : high = low + 1 := by omega
      subst this
      exact ⟨le_refl _, by omega, Or.inr ⟨hl, hh, hh0⟩⟩

/-- `bisectRate` doubling its upper end from `unit` while the sign stays `lowSign`, at most 1,024
times: the root found exactly (`inl`), the bracket found (`inr`), or `none` where it throws. -/
def doubling (signAt : ℤ → ℤ) (lowSign : ℤ) : ℕ → ℤ → ℤ → Option (ℤ ⊕ (ℤ × ℤ))
  | 0, low, high =>
    if signAt high = 0 then some (.inl high)
    else if signAt high ≠ lowSign then some (.inr (low, high))
    else none
  | f + 1, low, high =>
    if signAt high = 0 then some (.inl high)
    else if signAt high ≠ lowSign then some (.inr (low, high))
    else doubling signAt lowSign f high (2 * high)

theorem doubling_inl (signAt : ℤ → ℤ) (lowSign : ℤ) :
    ∀ (fuel : ℕ) (low high r : ℤ), doubling signAt lowSign fuel low high = some (.inl r) →
      signAt r = 0 := by
  intro fuel
  induction fuel with
  | zero =>
    intro low high r heq
    simp only [doubling] at heq
    split_ifs at heq with h1 h2
    · simp only [Option.some.injEq, Sum.inl.injEq] at heq
      subst heq
      exact h1
    · simp at heq
    · simp at heq
  | succ f ih =>
    intro low high r heq
    simp only [doubling] at heq
    split_ifs at heq with h1 h2
    · simp only [Option.some.injEq, Sum.inl.injEq] at heq
      subst heq
      exact h1
    · simp at heq
    · exact ih high (2 * high) r heq

theorem doubling_inr (signAt : ℤ → ℤ) (lowSign : ℤ) :
    ∀ (fuel : ℕ) (low high l h : ℤ), 0 ≤ low → low < high → signAt low = lowSign →
      doubling signAt lowSign fuel low high = some (.inr (l, h)) →
      0 ≤ l ∧ l < h ∧ signAt l = lowSign ∧ signAt h ≠ lowSign ∧ signAt h ≠ 0 := by
  intro fuel
  induction fuel with
  | zero =>
    intro low high l h h0 hlt hs heq
    simp only [doubling] at heq
    split_ifs at heq with h1 h2
    · simp at heq
    · simp only [Option.some.injEq, Sum.inr.injEq, Prod.mk.injEq] at heq
      obtain ⟨rfl, rfl⟩ := heq
      exact ⟨h0, hlt, hs, h2, h1⟩
    · simp at heq
  | succ f ih =>
    intro low high l h h0 hlt hs heq
    simp only [doubling] at heq
    split_ifs at heq with h1 h2
    · simp at heq
    · simp only [Option.some.injEq, Sum.inr.injEq, Prod.mk.injEq] at heq
      obtain ⟨rfl, rfl⟩ := heq
      exact ⟨h0, hlt, hs, h2, h1⟩
    · exact ih high (2 * high) l h (by omega) (by omega) (not_not.mp h2) heq

/-- `bisectRate` with no bracket, before the result's check: 0 if it is a root; a negative rate,
bisected between the excluded end −1 (`-unit`) and 0, when the sign at 0 is the first flow's; else
a positive one, bracketed by doubling. `none` where the doubling gives up. -/
def bisectFound (signAt : ℤ → ℤ) (unit firstSign : ℤ) : Option ℤ :=
  if signAt 0 = 0 then some 0
  else if signAt 0 = firstSign then some (bisect signAt (-firstSign) (-unit) 0)
  else
    match doubling signAt (signAt 0) 1024 0 unit with
    | some (.inl r) => some r
    | some (.inr (l, h)) => some (bisect signAt (signAt 0) l h)
    | none => none

/-- `bisectRate` with no bracket: `none` where the TypeScript throws, including a result within one
grid step of −1. -/
def bisectRate (signAt : ℤ → ℤ) (unit firstSign : ℤ) : Option ℤ :=
  match bisectFound signAt unit firstSign with
  | some r => if r ≤ -unit then none else some r
  | none => none

theorem bisectFound_spec (signAt : ℤ → ℤ) (unit firstSign : ℤ) (hunit : 0 < unit)
    (hfirst : firstSign = 1 ∨ firstSign = -1)
    (hrange : ∀ x, signAt x = -1 ∨ signAt x = 0 ∨ signAt x = 1) (r : ℤ)
    (h : bisectFound signAt unit firstSign = some r) :
    signAt r = 0 ∨ ∃ s, (s = 1 ∨ s = -1) ∧ (signAt r = s ∨ r = -unit) ∧ signAt (r + 1) ≠ s ∧
      signAt (r + 1) ≠ 0 := by
  unfold bisectFound at h
  split_ifs at h with h0 h1
  · simp only [Option.some.injEq] at h
    subst h
    exact Or.inl h0
  · simp only [Option.some.injEq] at h
    have hs : -firstSign = 1 ∨ -firstSign = -1 := by omega
    obtain ⟨_, _, hf⟩ := bisect_spec signAt (-firstSign) (-unit) _ (-unit) 0 rfl (by omega)
      (Or.inr rfl) (by rw [h1]; omega) (by rw [h1]; omega)
    rw [h] at hf
    rcases hf with hf | ⟨a, b, c⟩
    · exact Or.inl hf
    · exact Or.inr ⟨_, hs, a, b, c⟩
  · have hs : signAt 0 = 1 ∨ signAt 0 = -1 := by
      rcases hrange 0 with e | e | e <;> omega
    cases hd : doubling signAt (signAt 0) 1024 0 unit with
    | none =>
      rw [hd] at h
      simp at h
    | some res =>
      rw [hd] at h
      cases res with
      | inl r' =>
        simp only [Option.some.injEq] at h
        subst h
        exact Or.inl (doubling_inl signAt (signAt 0) 1024 0 unit r' hd)
      | inr p =>
        obtain ⟨l, hi⟩ := p
        simp only [Option.some.injEq] at h
        obtain ⟨hl0, hlt, hls, hhs, hh0⟩ :=
          doubling_inr signAt (signAt 0) 1024 0 unit l hi le_rfl hunit rfl hd
        obtain ⟨_, _, hf⟩ := bisect_spec signAt (signAt 0) l _ l hi rfl hlt (Or.inl hls) hhs hh0
        rw [h] at hf
        rcases hf with hf | ⟨a, b, c⟩
        · exact Or.inl hf
        · refine Or.inr ⟨_, hs, Or.inl ?_, b, c⟩
          rcases a with a | a
          · exact a
          · rw [a]
            exact hls

/-- Whatever `bisectRate` returns is above −1, and either a root on the grid or a grid point with
a nonzero sign whose next point has the opposite sign: the bracket [`lower`, `upper`] the rate
solvers return. -/
theorem bisectRate_spec (signAt : ℤ → ℤ) (unit firstSign : ℤ) (hunit : 0 < unit)
    (hfirst : firstSign = 1 ∨ firstSign = -1)
    (hrange : ∀ x, signAt x = -1 ∨ signAt x = 0 ∨ signAt x = 1) (r : ℤ)
    (h : bisectRate signAt unit firstSign = some r) :
    -unit < r ∧ (signAt r = 0 ∨ signAt r * signAt (r + 1) = -1) := by
  unfold bisectRate at h
  cases hf : bisectFound signAt unit firstSign with
  | none =>
    rw [hf] at h
    simp at h
  | some r' =>
    rw [hf] at h
    simp only at h
    split_ifs at h with hle
    · simp at h
    · simp only [Option.some.injEq] at h
      subst h
      refine ⟨by omega, ?_⟩
      rcases bisectFound_spec signAt unit firstSign hunit hfirst hrange r' hf with
        h0 | ⟨s, hs, ha, hb, hc⟩
      · exact Or.inl h0
      · right
        have hr : signAt r' = s := ha.resolve_right (by omega)
        rw [hr]
        rcases hrange (r' + 1) with e | e | e <;> rw [e] at hb hc ⊢ <;>
          rcases hs with rfl | rfl <;> omega

end Ducat.Search
