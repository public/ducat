import Mathlib.Tactic

/-!
# Allocation: splitting an amount in proportion to weights

A model of `allocate(m, weights, { remainder })` in `src/allocate.ts`, on `n` buckets. For an amount
`x ≥ 0` (in minor units) and weights `w i ≥ 0` with total `T > 0`:

* every bucket first gets its floor share `base i = ⌊x * w i / T⌋`, with remainder `frac i = x * w i mod T`;
* the `rem = x - Σ base` units left over go to the eligible buckets (non-zero weight), one each, to the
  first `rem` of them in an order fixed by the strategy: `largest` by `frac` (largest first, ties to
  the earlier bucket), `first` by index, `last` by reverse index; or all at once to the first
  (`toFirst`) or last (`toLast`) eligible bucket.

"The first `k` in an order" is stated without sorting: bucket `i` is chosen when fewer than `k`
eligible buckets come before it. The theorems:

* `alloc_sum`: the parts add up to `x`, for every strategy.
* `alloc_zero`: a bucket with zero weight gets zero.
* `alloc_near` (`first`, `last`): each part is within one unit of its exact share `x * w i / T`:
  `-T < part * T - x * w i ≤ T`.
* `alloc_near_largest`: for `largest` (Hamilton's method) strictly within one unit:
  `|part * T - x * w i| < T`.
* `allocS_neg`: a negative amount is allocated as the mirror image of the positive one.
* `alloc_scale`: multiplying every weight by the same `k > 0` changes nothing, so decimal weights
  (scaled to integers by a power of ten) are allocated as their exact ratios.

The model is executable: `Oracle.lean` evaluates it on generated cases, and `test/allocate.oracle.test.ts`
checks the TypeScript (both its number and bigint paths) against the output.
-/

namespace Ducat.Alloc

open Finset

variable {n : ℕ}

inductive Remainder where
  | largest | first | last | toFirst | toLast
  deriving DecidableEq, Repr

def total (w : Fin n → ℤ) : ℤ := ∑ i, w i
def base (x : ℤ) (w : Fin n → ℤ) (i : Fin n) : ℤ := x * w i / total w
def frac (x : ℤ) (w : Fin n → ℤ) (i : Fin n) : ℤ := x * w i % total w
def rem (x : ℤ) (w : Fin n → ℤ) : ℤ := x - ∑ i, base x w i
def elig (w : Fin n → ℤ) : Finset (Fin n) := univ.filter (fun i => 0 < w i)

/-- `j` comes before `i` in the order the strategy hands out the remainder. -/
def before (x : ℤ) (w : Fin n → ℤ) : Remainder → Fin n → Fin n → Prop
  | .largest => fun j i => frac x w i < frac x w j ∨ (frac x w j = frac x w i ∧ j < i)
  | .first | .toFirst => fun j i => j < i
  | .last | .toLast => fun j i => i < j

instance (x : ℤ) (w : Fin n → ℤ) (s : Remainder) : DecidableRel (before x w s) := by
  cases s <;> simp only [before] <;> infer_instance

/-- How many eligible buckets come before `i`. -/
def rank (r : Fin n → Fin n → Prop) [DecidableRel r] (w : Fin n → ℤ) (i : Fin n) : ℕ :=
  ((elig w).filter (fun j => r j i)).card

/-- The first `k` eligible buckets in the order `r`. -/
def chosen (r : Fin n → Fin n → Prop) [DecidableRel r] (w : Fin n → ℤ) (k : ℕ) : Finset (Fin n) :=
  (elig w).filter (fun i => rank r w i < k)

def alloc (s : Remainder) (x : ℤ) (w : Fin n → ℤ) (i : Fin n) : ℤ :=
  match s with
  | .largest | .first | .last => base x w i + if i ∈ chosen (before x w s) w (rem x w).toNat then 1 else 0
  | .toFirst | .toLast => base x w i + if i ∈ chosen (before x w s) w 1 then rem x w else 0

/-- Any amount: negative amounts are allocated as the negation of the positive allocation. -/
def allocS (s : Remainder) (x : ℤ) (w : Fin n → ℤ) (i : Fin n) : ℤ :=
  if x < 0 then -alloc s (-x) w i else alloc s x w i

/-! ## Arithmetic of the floor shares -/

section
variable {x : ℤ} {w : Fin n → ℤ}

theorem frac_nonneg (hT : 0 < total w) (i : Fin n) : 0 ≤ frac x w i := Int.emod_nonneg _ hT.ne'
theorem frac_lt (hT : 0 < total w) (i : Fin n) : frac x w i < total w := Int.emod_lt_of_pos _ hT

/-- `base i * T - x * w i = -frac i` -/
theorem base_mul (i : Fin n) : base x w i * total w = x * w i - frac x w i := by
  have := Int.ediv_add_emod (x * w i) (total w)
  simp only [base, frac]; linarith [mul_comm (total w) (x * w i / total w)]

theorem frac_zero (i : Fin n) (h : w i = 0) : frac x w i = 0 := by simp [frac, h]
theorem base_zero (i : Fin n) (h : w i = 0) : base x w i = 0 := by simp [base, h]

theorem frac_out (hw : ∀ i, 0 ≤ w i) (i : Fin n) (h : i ∉ elig w) : frac x w i = 0 :=
  frac_zero i (by simp [elig] at h; linarith [hw i])

/-- The leftover, times `T`, is the sum of the remainders. -/
theorem rem_mul : rem x w * total w = ∑ i, frac x w i := by
  have h : ∑ i, base x w i * total w = ∑ i, (x * w i - frac x w i) := sum_congr rfl fun i _ => base_mul i
  rw [sum_sub_distrib, ← mul_sum, ← sum_mul] at h
  simp only [rem, sub_mul]; unfold total at *; linarith

theorem sum_frac_elig (hw : ∀ i, 0 ≤ w i) : ∑ i, frac x w i = ∑ i ∈ elig w, frac x w i := by
  rw [← sum_filter_add_sum_filter_not univ (fun i => 0 < w i)]
  have : ∑ i ∈ univ.filter (fun i => ¬ 0 < w i), frac x w i = 0 :=
    sum_eq_zero fun i hi => frac_zero i (by simp at hi; linarith [hw i])
  rw [this, add_zero]; rfl

theorem rem_nonneg (hT : 0 < total w) : 0 ≤ rem x w := by
  have h := rem_mul (x := x) (w := w)
  have : 0 ≤ ∑ i, frac x w i := sum_nonneg fun i _ => frac_nonneg hT i
  nlinarith

/-- Fewer units are left over than there are eligible buckets. -/
theorem rem_lt (hw : ∀ i, 0 ≤ w i) (hT : 0 < total w) : rem x w < (elig w).card := by
  have h := rem_mul (x := x) (w := w)
  rw [sum_frac_elig hw] at h
  have hle : ∑ i ∈ elig w, frac x w i ≤ ∑ _i ∈ elig w, (total w - 1) :=
    sum_le_sum fun i _ => by linarith [frac_lt (x := x) hT i]
  rw [sum_const, nsmul_eq_mul] at hle
  nlinarith

theorem elig_nonempty (hw : ∀ i, 0 ≤ w i) (hT : 0 < total w) : 0 < (elig w).card := by
  have := rem_lt (x := 0) hw hT
  have := rem_nonneg (x := 0) (w := w) hT
  omega

end

/-! ## Choosing the first `k` in a strict total order -/

/-- A strict total order on the buckets. -/
structure StrictTotal (r : Fin n → Fin n → Prop) : Prop where
  irrefl : ∀ i, ¬ r i i
  trans : ∀ i j k, r i j → r j k → r i k
  total : ∀ i j, i ≠ j → r i j ∨ r j i

section
variable {r : Fin n → Fin n → Prop} [DecidableRel r] {w : Fin n → ℤ}

theorem rank_lt_rank (hr : StrictTotal r) {i j : Fin n} (hi : i ∈ elig w) (h : r i j) :
    rank r w i < rank r w j := by
  apply card_lt_card
  refine ⟨fun a ha => ?_, fun hsub => ?_⟩
  · simp only [mem_filter] at ha ⊢; exact ⟨ha.1, hr.trans _ _ _ ha.2 h⟩
  · have : i ∈ (elig w).filter (fun a => r a i) := hsub (by simp [mem_filter, hi, h])
    simp only [mem_filter] at this; exact hr.irrefl i this.2

theorem rank_lt_card (hr : StrictTotal r) {i : Fin n} (hi : i ∈ elig w) : rank r w i < (elig w).card := by
  apply card_lt_card
  refine ⟨filter_subset _ _, fun hsub => ?_⟩
  have := hsub hi; simp only [mem_filter] at this; exact hr.irrefl i this.2

theorem rank_inj (hr : StrictTotal r) {i j : Fin n} (hi : i ∈ elig w) (hj : j ∈ elig w)
    (h : rank r w i = rank r w j) : i = j := by
  by_contra hne
  rcases hr.total i j hne with h' | h'
  · have := rank_lt_rank hr hi h'; omega
  · have := rank_lt_rank hr hj h'; omega

/-- Choosing the first `k` picks exactly `min k m` of the `m` eligible buckets. -/
theorem card_chosen (hr : StrictTotal r) (k : ℕ) : (chosen r w k).card = min k (elig w).card := by
  have hsurj : ∀ b ∈ range (elig w).card, ∃ a, ∃ _ : a ∈ elig w, rank r w a = b := by
    have := surj_on_of_inj_on_of_card_le (s := elig w) (t := range (elig w).card)
      (fun a _ => rank r w a) (fun a ha => mem_range.2 (rank_lt_card hr ha))
      (fun a b ha hb h => rank_inj hr ha hb h) (by simp)
    intro b hb; obtain ⟨a, ha, e⟩ := this b hb; exact ⟨a, ha, e.symm⟩
  have : (chosen r w k).card = ((range (elig w).card).filter (· < k)).card := by
    apply card_bij (fun a _ => rank r w a)
    · intro a ha; simp only [chosen, mem_filter] at ha
      simp only [mem_filter, mem_range]; exact ⟨rank_lt_card hr ha.1, ha.2⟩
    · intro a ha b hb h; simp only [chosen, mem_filter] at ha hb; exact rank_inj hr ha.1 hb.1 h
    · intro b hb; simp only [mem_filter, mem_range] at hb
      obtain ⟨a, ha, e⟩ := hsurj b (mem_range.2 hb.1)
      exact ⟨a, by simp only [chosen, mem_filter]; exact ⟨ha, e ▸ hb.2⟩, e⟩
  rw [this]
  have : (range (elig w).card).filter (· < k) = range (min k (elig w).card) := by
    ext a; simp only [mem_filter, mem_range]; omega
  rw [this, card_range]

theorem chosen_sub (k : ℕ) : chosen r w k ⊆ elig w := filter_subset _ _

end

theorem before_total (x : ℤ) (w : Fin n → ℤ) (s : Remainder) : StrictTotal (before x w s) := by
  cases s <;> constructor <;> simp only [before] <;> intros <;> (try omega) <;>
    (try (rename_i i j h; rcases lt_or_gt_of_ne h with h | h <;> simp [h]))
  all_goals (rename_i i j h; rcases lt_trichotomy (frac x w i) (frac x w j) with e | e | e <;>
    (try (rcases lt_or_gt_of_ne h with h | h)) <;> simp_all) <;> (try omega)

/-! ## The theorems -/

section
variable {x : ℤ} {w : Fin n → ℤ}

theorem sum_ite_mem (S : Finset (Fin n)) (c : ℤ) :
    ∑ i, (if i ∈ S then c else 0) = S.card * c := by
  rw [sum_ite_mem, univ_inter, sum_const, nsmul_eq_mul]

/-- The parts add up to the whole. -/
theorem alloc_sum (s : Remainder) (hw : ∀ i, 0 ≤ w i) (hT : 0 < total w) :
    ∑ i, alloc s x w i = x := by
  have hr := before_total x w s
  have h0 := rem_nonneg (x := x) hT
  have hlt := rem_lt (x := x) hw hT
  have hpos := elig_nonempty hw hT
  cases s <;> simp only [alloc, sum_add_distrib, sum_ite_mem, card_chosen hr] <;> simp only [rem] at * <;>
    omega

/-- Buckets with zero weight get nothing. -/
theorem alloc_zero (s : Remainder) (i : Fin n) (h : w i = 0) : alloc s x w i = 0 := by
  have hi : ∀ k, i ∉ chosen (before x w s) w k := fun k hc => by
    have := chosen_sub k hc; simp [elig, h] at this
  cases s <;> simp [alloc, base_zero i h, hi]

/-- `first` and `last`: each part is within one unit of its exact share `x * w i / T`. -/
theorem alloc_near (s : Remainder) (hs : s = .first ∨ s = .last) (hT : 0 < total w) (i : Fin n) :
    -total w < alloc s x w i * total w - x * w i ∧ alloc s x w i * total w - x * w i ≤ total w := by
  have hb := base_mul (x := x) (w := w) i
  have h0 := frac_nonneg (x := x) hT i
  have h1 := frac_lt (x := x) hT i
  rcases hs with rfl | rfl <;> simp only [alloc] <;> split_ifs <;> constructor <;> nlinarith

/-- `largest` (Hamilton's method): each part is strictly within one unit of its exact share. -/
theorem alloc_near_largest (hw : ∀ i, 0 ≤ w i) (hT : 0 < total w) (i : Fin n) :
    -total w < alloc .largest x w i * total w - x * w i ∧ alloc .largest x w i * total w - x * w i < total w := by
  have hb := base_mul (x := x) (w := w) i
  have h0 := frac_nonneg (x := x) hT i
  have h1 := frac_lt (x := x) hT i
  simp only [alloc]
  split_ifs with hc
  swap; · constructor <;> nlinarith
  -- a chosen bucket has a positive remainder
  suffices hf : 0 < frac x w i by constructor <;> nlinarith
  by_contra hf
  have hfi : frac x w i = 0 := by omega
  have hr := before_total x w .largest
  set k := (rem x w).toNat
  set C := chosen (before x w .largest) w k
  have hiC : i ∈ elig w ∧ rank (before x w .largest) w i < k := by simpa [C, chosen] using hc
  -- every eligible bucket not chosen comes after `i`, so its remainder is zero too
  have hout : ∀ j ∈ elig w, j ∉ C → frac x w j = 0 := by
    intro j hj hjC
    have hrank : ¬ rank (before x w .largest) w j < k := fun h => hjC (by simp [C, chosen, hj, h])
    have hji : ¬ before x w .largest j i := fun h => hrank (by
      have := rank_lt_rank hr hj h; omega)
    have hne : j ≠ i := fun e => hrank (e ▸ hiC.2)
    have := frac_nonneg (x := x) hT j
    simp only [before, not_or, not_and] at hji
    rcases lt_or_gt_of_ne hne with e | e
    · have := hji.2; have := hji.1; by_contra; exact absurd e (by omega)
    · omega
  have hsum := rem_mul (x := x) (w := w)
  rw [sum_frac_elig hw, ← sum_filter_add_sum_filter_not (elig w) (· ∈ C)] at hsum
  have hz : ∑ j ∈ (elig w).filter (· ∉ C), frac x w j = 0 :=
    sum_eq_zero fun j hj => by simp only [mem_filter] at hj; exact hout j hj.1 hj.2
  have hCe : (elig w).filter (· ∈ C) = C := by
    ext j; simp only [mem_filter]; exact ⟨fun h => h.2, fun h => ⟨chosen_sub k h, h⟩⟩
  rw [hz, add_zero, hCe] at hsum
  have hle : ∑ j ∈ C, frac x w j ≤ ∑ _j ∈ C, (total w - 1) - 1 := by
    rw [← sum_erase_add C _ hc, ← sum_erase_add C (fun _ => total w - 1) hc, hfi]
    have := sum_le_sum (s := C.erase i) fun j _ => by linarith [frac_lt (x := x) hT j]
    linarith
  rw [sum_const, nsmul_eq_mul, card_chosen hr] at hle
  have h0 := rem_nonneg (x := x) hT
  have hlt := rem_lt (x := x) hw hT
  have hk : (min k (elig w).card : ℤ) = rem x w := by simp only [k]; omega
  rw [hk] at hle
  nlinarith

/-- A negative amount is allocated as the mirror image of the positive one. -/
theorem allocS_neg (s : Remainder) (hx : 0 < x) (i : Fin n) : allocS s (-x) w i = -allocS s x w i := by
  simp [allocS, show ¬ x < 0 by omega, hx]

/-- Scaling every weight by `k > 0` changes nothing. -/
theorem alloc_scale (s : Remainder) {k : ℤ} (hk : 0 < k) (i : Fin n) :
    alloc s x (fun j => k * w j) i = alloc s x w i := by
  have ht : total (fun j => k * w j) = k * total w := by simp [total, mul_sum]
  have hb : ∀ j, base x (fun j => k * w j) j = base x w j := fun j => by
    simp only [base, ht, show x * (k * w j) = k * (x * w j) by ring]
    exact Int.mul_ediv_mul_of_pos _ _ hk
  have hf : ∀ j, frac x (fun j => k * w j) j = k * frac x w j := fun j => by
    simp only [frac, ht, show x * (k * w j) = k * (x * w j) by ring]
    exact Int.mul_emod_mul_of_pos _ _ hk
  have he : elig (fun j => k * w j) = elig w := by
    ext j; simp [elig]; constructor <;> intro h <;> nlinarith
  have hr : rem x (fun j => k * w j) = rem x w := by simp [rem, hb]
  have hbe : before x (fun j => k * w j) s = before x w s := by
    cases s <;> funext a b <;> simp only [before, hf] <;>
      simp only [mul_lt_mul_left hk, mul_right_inj' hk.ne']
  cases s <;> simp only [alloc, hb, hr, chosen, rank, he, hbe]

end

end Ducat.Alloc
