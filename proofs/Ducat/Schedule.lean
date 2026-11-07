import Ducat.Allocate

/-!
# Instalments, chunks and schedules

Models of `instalments(total, count, { unit, remainder })`, `chunk(total, max)` and
`schedule(total, tranches)` in `src/allocate.ts`, for a non-negative total in minor units. Negative totals
are allocated as the mirror image, as in the TypeScript, so they need no theorems of their own.

* `inst_sum`, `chunk_sum`, `sched_sum`: the parts add up to the total.
* `inst_multiple`: with a `unit`, every instalment except the one that takes the leftover is a whole
  number of units. `inst_near` (`first`, `last`): those instalments are `per` or `per + unit`, and the
  leftover is less than one unit.
* `chunk_le`, `chunk_full`, `chunk_last_pos`: no chunk exceeds `max`, every chunk but the last is
  exactly `max`, and the last is positive (unless the total is zero, which gives `[0]`).
* `sched_shares_near`: the percentage shares `schedule` computes are each less than one unit from their
  exact share (that they reach the right tranches is checked by the oracle, not proved).

`inst_multiple`, half of `inst_near`, and `sched_sum` hold by the construction of the models, as net + tax =
gross does for tax: they restate how the TypeScript builds its result, so the oracle comparison is what
ties them to the code.

`Oracle.lean` evaluates these models on generated cases, and the tests check the TypeScript against
them.
-/

namespace Ducat.Sched

open Finset Ducat.Alloc

/-! ## Instalments with a unit -/

/-- Where the leftover goes. `first`/`last` first hand out whole units one at a time. -/
inductive InstMode where
  | first | last | toFirst | toLast
  deriving DecidableEq, Repr

/-- Equal weights, so that `Alloc.chosen` picks buckets by position. -/
def ones (c : ℕ) : Fin c → ℤ := fun _ => 1

def order : InstMode → Remainder
  | .first | .toFirst => .first
  | .last | .toLast => .last

variable {c : ℕ}

/-- The regular instalment: the largest multiple of `u` that fits `c` times. -/
def per (t u : ℤ) (c : ℕ) : ℤ := t / (u * c) * u
/-- What is left after `c` regular instalments. -/
def left0 (t u : ℤ) (c : ℕ) : ℤ := t - per t u c * c
/-- How many whole units `first`/`last` hand out from the leftover. -/
def whole (s : InstMode) (t u : ℤ) (c : ℕ) : ℕ :=
  match s with
  | .first | .last => (left0 t u c / u).toNat
  | .toFirst | .toLast => 0
/-- The sub-unit leftover that goes to the first (or last) instalment. -/
def rest (s : InstMode) (t u : ℤ) (c : ℕ) : ℤ := left0 t u c - whole s t u c * u

/-- The buckets that get one extra unit, and the one that gets the rest. -/
def bonusSet (s : InstMode) (t u : ℤ) (c : ℕ) : Finset (Fin c) :=
  chosen (before 0 (ones c) (order s)) (ones c) (whole s t u c)
def targetSet (s : InstMode) (c : ℕ) : Finset (Fin c) :=
  chosen (before 0 (ones c) (order s)) (ones c) 1

def inst (s : InstMode) (t u : ℤ) (c : ℕ) (i : Fin c) : ℤ :=
  per t u c + (if i ∈ bonusSet s t u c then u else 0) + (if i ∈ targetSet s c then rest s t u c else 0)

theorem elig_ones : elig (ones c) = univ := by ext i; simp [elig, ones]

theorem ones_total : total (ones c) = c := by simp [total, ones]

section
variable {t u : ℤ}

theorem left0_bounds (_ht : 0 ≤ t) (hu : 0 < u) (hc : 0 < c) :
    0 ≤ left0 t u c ∧ left0 t u c < u * c := by
  have hd : 0 < u * c := by positivity
  have h1 := Int.ediv_mul_add_emod t (u * c)
  have h2 := Int.emod_nonneg t hd.ne'
  have h3 := Int.emod_lt_of_pos t hd
  simp only [left0, per]
  constructor <;> nlinarith

theorem whole_lt (s : InstMode) (ht : 0 ≤ t) (hu : 0 < u) (hc : 0 < c) : whole s t u c < c := by
  obtain ⟨h0, h1⟩ := left0_bounds ht hu hc
  cases s <;> simp only [whole]
  all_goals try omega
  all_goals
    have : left0 t u c / u < c := by
      rw [Int.ediv_lt_iff_lt_mul hu]; linarith [mul_comm u (c : ℤ)]
    omega

theorem rest_bounds (s : InstMode) (ht : 0 ≤ t) (hu : 0 < u) (hc : 0 < c) :
    0 ≤ rest s t u c ∧ (s = .first ∨ s = .last → rest s t u c < u) := by
  obtain ⟨h0, h1⟩ := left0_bounds ht hu hc
  have hq := Int.ediv_mul_add_emod (left0 t u c) u
  have hm0 := Int.emod_nonneg (left0 t u c) hu.ne'
  have hm1 := Int.emod_lt_of_pos (left0 t u c) hu
  have hpos : 0 ≤ left0 t u c / u := Int.ediv_nonneg h0 hu.le
  cases s
  case first | last =>
    simp only [rest, whole, Int.toNat_of_nonneg hpos]
    exact ⟨by linarith, fun _ => by linarith⟩
  case toFirst | toLast =>
    simp only [rest, whole, Nat.cast_zero, zero_mul, sub_zero]
    exact ⟨h0, fun h => by simp at h⟩

/-- The instalments add up to the total. -/
theorem inst_sum (s : InstMode) (ht : 0 ≤ t) (hu : 0 < u) (hc : 0 < c) : ∑ i, inst s t u c i = t := by
  have hr := before_total 0 (ones c) (order s)
  have hw := whole_lt s ht hu hc
  have hm1 : min 1 c = 1 := by omega
  have hmw : min (whole s t u c) c = whole s t u c := by omega
  have hb : (bonusSet s t u c).card = whole s t u c := by
    rw [bonusSet, card_chosen hr, elig_ones, card_univ, Fintype.card_fin, hmw]
  have htg : (targetSet s c).card = 1 := by
    rw [targetSet, card_chosen hr, elig_ones, card_univ, Fintype.card_fin, hm1]
  simp only [inst, sum_add_distrib, sum_indicator, hb, htg, sum_const, card_univ, Fintype.card_fin,
    nsmul_eq_mul, rest, left0]
  push_cast
  ring

/-- Every instalment but the leftover's is a whole number of units. -/
theorem inst_multiple (s : InstMode) (i : Fin c) (hi : i ∉ targetSet s c) : u ∣ inst s t u c i := by
  simp only [inst, hi, ite_false, add_zero, per]
  split_ifs
  · exact ⟨t / (u * c) + 1, by ring⟩
  · exact ⟨t / (u * c), by ring⟩

/-- `first`/`last`: the other instalments are `per` or `per + u`, and the leftover is under one unit. -/
theorem inst_near (s : InstMode) (hs : s = .first ∨ s = .last) (ht : 0 ≤ t) (hu : 0 < u) (hc : 0 < c)
    (i : Fin c) :
    (inst s t u c i = per t u c ∨ inst s t u c i = per t u c + u ∨ i ∈ targetSet s c) ∧
    0 ≤ rest s t u c ∧ rest s t u c < u := by
  obtain ⟨h0, h1⟩ := rest_bounds s ht hu hc
  refine ⟨?_, h0, h1 hs⟩
  by_cases hi : i ∈ targetSet s c
  · exact Or.inr (Or.inr hi)
  · simp only [inst, hi, ite_false, add_zero]
    split_ifs
    · exact Or.inr (Or.inl rfl)
    · exact Or.inl (by ring)

end

/-! ## Chunks -/

/-- `chunk(total, max)` for `0 ≤ t` and `0 < m`: `n` full chunks while more than `m` is left, then the rest. -/
def chunkCount (t m : ℤ) : ℕ := if t ≤ m then 0 else ((t - 1) / m).toNat

def chunkLast (t m : ℤ) : ℤ := t - chunkCount t m * m

def chunk (t m : ℤ) : List ℤ :=
  List.replicate (chunkCount t m) m ++ (if 0 < chunkLast t m ∨ chunkCount t m = 0 then [chunkLast t m] else [])

section
variable {t m : ℤ}

theorem chunkLast_bounds (ht : 0 ≤ t) (hm : 0 < m) :
    chunkLast t m ≤ m ∧ (0 < t → 0 < chunkLast t m) ∧ 0 ≤ chunkLast t m := by
  unfold chunkLast chunkCount
  split_ifs with h
  · simp only [Nat.cast_zero, zero_mul, sub_zero]; omega
  · have hq := Int.ediv_mul_add_emod (t - 1) m
    have hm0 := Int.emod_nonneg (t - 1) hm.ne'
    have hm1 := Int.emod_lt_of_pos (t - 1) hm
    have hpos : 0 ≤ (t - 1) / m := Int.ediv_nonneg (by omega) hm.le
    rw [Int.toNat_of_nonneg hpos]
    refine ⟨by linarith, fun _ => by linarith, by linarith⟩

/-- The chunks add up to the total. -/
theorem chunk_sum (ht : 0 ≤ t) (hm : 0 < m) : (chunk t m).sum = t := by
  obtain ⟨_, _, h0⟩ := chunkLast_bounds ht hm
  unfold chunk
  split_ifs with h
  · simp only [List.sum_append, List.sum_replicate, List.sum_singleton, nsmul_eq_mul, chunkLast]
    ring
  · simp only [not_or, not_lt] at h
    simp only [chunkLast] at h h0
    simp only [List.sum_append, List.sum_replicate, List.sum_nil, add_zero, nsmul_eq_mul]
    linarith [h.1]

/-- No chunk exceeds `max`. -/
theorem chunk_le (ht : 0 ≤ t) (hm : 0 < m) : ∀ x ∈ chunk t m, x ≤ m := by
  obtain ⟨h1, _, _⟩ := chunkLast_bounds ht hm
  intro x hx
  unfold chunk at hx
  simp only [List.mem_append, List.mem_replicate] at hx
  rcases hx with ⟨_, rfl⟩ | hx
  · exact le_refl _
  · split_ifs at hx
    · simp only [List.mem_singleton] at hx; omega
    · simp at hx

/-- Every chunk but the last is exactly `max`. -/
theorem chunk_full (t m : ℤ) : ∀ x ∈ (chunk t m).dropLast, x = m := by
  intro x hx
  unfold chunk at hx
  split_ifs at hx
  · rw [List.dropLast_concat] at hx; exact (List.mem_replicate.1 hx).2
  · rw [List.append_nil] at hx; exact (List.mem_replicate.1 ((List.dropLast_sublist _).subset hx)).2

/-- The last chunk is positive, unless the total is zero. -/
theorem chunk_last_pos (ht : 0 < t) (hm : 0 < m) : ∀ x ∈ chunk t m, 0 < x := by
  obtain ⟨_, h2, _⟩ := chunkLast_bounds ht.le hm
  intro x hx
  unfold chunk at hx
  simp only [List.mem_append, List.mem_replicate] at hx
  rcases hx with ⟨_, rfl⟩ | hx
  · exact hm
  · split_ifs at hx
    · simp only [List.mem_singleton] at hx; subst hx; exact h2 ht
    · simp at hx

end

/-! ## Schedules -/

/-- One tranche: a fixed amount, a percentage (scaled to an integer weight, with an optional cap), or the
rest. -/
inductive Tranche where
  | amount (a : ℤ)
  | pct (w : ℤ) (cap : Option ℤ)
  | rest
  deriving Repr

/-- Fill the non-rest tranches: amounts as given, percentages from `parts` in order (capped). The rest
tranche is `none` here. -/
def fill : List Tranche → List ℤ → List (Option ℤ)
  | [], _ => []
  | .amount a :: ts, ps => some a :: fill ts ps
  | .pct _ cap :: ts, p :: ps => some (match cap with | some c => min p c | none => p) :: fill ts ps
  | .pct _ _ :: ts, [] => some 0 :: fill ts []
  | .rest :: ts, ps => none :: fill ts ps

def isRest : Tranche → Bool
  | .rest => true
  | _ => false

def weights (ts : List Tranche) : List ℤ := ts.filterMap fun | .pct w _ => some w | _ => none

/-- The percentage shares: `allocate(total, [...weights, hundred - Σ weights])` with largest remainder;
`hundred` is 100 scaled like the weights. -/
def pctParts (t hundred : ℤ) (ts : List Tranche) : List ℤ :=
  let ws := weights ts ++ [hundred - (weights ts).sum]
  List.ofFn (allocS .largest t (fun i : Fin ws.length => ws[i]))

/-- `schedule`: `none` where the TypeScript throws (two rests, percentages over 100, the tranches
exceeding the total, or something left over with no rest tranche). -/
def schedule (t hundred : ℤ) (ts : List Tranche) : Option (List ℤ) :=
  if 1 < (ts.filter isRest).length ∨ hundred < (weights ts).sum then none else
  let vals := fill ts (pctParts t hundred ts)
  let left := t - (vals.filterMap id).sum
  if left < 0 then none
  else if (ts.filter isRest).length = 0 ∧ left ≠ 0 then none
  else some (vals.map (·.getD left))

theorem fill_none (ts : List Tranche) (ps : List ℤ) :
    ((fill ts ps).filter (·.isNone)).length = (ts.filter isRest).length := by
  induction ts generalizing ps with
  | nil => simp [fill]
  | cons t ts ih =>
    cases t with
    | amount a => simp [fill, isRest, ih]
    | pct w cap => cases ps <;> simp [fill, isRest, ih]
    | rest =>
      rw [List.filter_cons_of_pos (by rfl), List.length_cons]
      simp [fill, ih]

theorem sum_getD (os : List (Option ℤ)) (d : ℤ) :
    (os.map (·.getD d)).sum = (os.filterMap id).sum + (os.filter (·.isNone)).length * d := by
  induction os with
  | nil => simp
  | cons o os ih => cases o <;> simp [ih] <;> ring

/-- When the schedule succeeds, its tranches add up to the total. -/
theorem sched_sum (t hundred : ℤ) (ts : List Tranche) (xs : List ℤ) (h : schedule t hundred ts = some xs) :
    xs.sum = t := by
  unfold schedule at h
  dsimp only at h
  split_ifs at h with h1 h2 h3 <;> simp only [Option.some.injEq, reduceCtorEq] at h
  subst h
  rw [sum_getD, fill_none]
  simp only [not_or, not_lt, not_and, not_not] at h1 h3
  have : (ts.filter isRest).length = 0 ∨ (ts.filter isRest).length = 1 := by omega
  rcases this with h0 | h0
  · have := h3 h0
    rw [h0]; push_cast; linarith
  · rw [h0]; push_cast; ring

/-- The percentage shares `pctParts` that `schedule` computes, before capping, are each less than one unit
from their exact share `t * w / hundred` (Hamilton's method over the percentage weights and the remainder
to 100). That `fill` hands them to the right tranches, and applies the caps, is checked by the oracle
cases, not proved. -/
theorem sched_shares_near (t hundred : ℤ) (ts : List Tranche) (ht : 0 ≤ t) (hw : ∀ w ∈ weights ts, 0 ≤ w)
    (hle : (weights ts).sum ≤ hundred) (hh : 0 < hundred) (k : Fin (weights ts ++ [hundred - (weights ts).sum]).length) :
    let ws := weights ts ++ [hundred - (weights ts).sum]
    let part := allocS .largest t (fun i : Fin ws.length => ws[i]) k
    (-hundred < part * hundred - t * ws[k] ∧ part * hundred - t * ws[k] < hundred) := by
  intro ws part
  have htot : total (fun i : Fin ws.length => ws[i]) = hundred := by
    simp only [total]
    rw [← List.sum_ofFn]
    have hof : List.ofFn (fun i : Fin ws.length => ws[i]) = ws := List.ofFn_getElem
    rw [hof]
    simp only [ws, List.sum_append, List.sum_cons, List.sum_nil, add_zero]
    ring
  have hnn : ∀ i : Fin ws.length, 0 ≤ ws[i] := by
    intro i
    have hmem : ws[i] ∈ ws := List.getElem_mem ..
    simp only [ws, List.mem_append, List.mem_singleton] at hmem
    rcases hmem with h | h
    · exact hw _ h
    · rw [h]; linarith
  have := alloc_near_largest (x := t) (w := fun i : Fin ws.length => ws[i]) hnn (by rw [htot]; exact hh) k
  rw [htot] at this
  simp only [part, allocS, show ¬ t < 0 by omega, ite_false]
  exact this

end Ducat.Sched
