import Mathlib.Tactic
import Ducat.Kernel

/-!
# Integer division with rounding: `divRound(p, d)` for every rounding mode

`Rounds m p d q` says that `q` is `p / d` rounded with mode `m` (for `d > 0`), stated with the error
`e = p - d*q` so it is a plain integer inequality:

* `floor`: `0 ≤ e < d`, i.e. `q ≤ p/d < q + 1`. `ceil`: `-d < e ≤ 0`.
* `trunc` is floor for `p ≥ 0` and ceil below; `expand` the other way round.
* The half modes are within one half: `|2e| ≤ d`, i.e. `|p/d - q| ≤ 1/2`, and the tie (`|2e| = d`) goes
  where the mode says: `halfCeil` up, `halfFloor` down, `halfExpand` away from zero, `halfTrunc` towards
  zero, `halfEven` to the even neighbour.
* `unnecessary` only succeeds when the division is exact: `e = 0`.

`kernel m` is the code ducat ships (printed by `Gen.lean` into `src/generated/kernel.ts`). The theorems:

* `kernel_sound`: whatever the kernel returns satisfies `Rounds`.
* `kernel_fails_iff`: it fails exactly for `unnecessary` with an inexact division.
* `rounds_unique`: `Rounds` determines `q`, so "satisfies the spec" means "is the right answer".
-/

namespace Ducat

inductive Mode where
  | halfEven | halfExpand | halfTrunc | halfCeil | halfFloor
  | expand | trunc | ceil | floor | unnecessary
  deriving DecidableEq, Repr

def Mode.all : List Mode :=
  [.halfEven, .halfExpand, .halfTrunc, .halfCeil, .halfFloor, .expand, .trunc, .ceil, .floor, .unnecessary]

/-- The rounding-mode string used by the TypeScript API (the same strings as `Intl.NumberFormat`). -/
def Mode.tsName : Mode → String
  | .halfEven => "halfEven" | .halfExpand => "halfExpand" | .halfTrunc => "halfTrunc"
  | .halfCeil => "halfCeil" | .halfFloor => "halfFloor" | .expand => "expand" | .trunc => "trunc"
  | .ceil => "ceil" | .floor => "floor" | .unnecessary => "unnecessary"

/-- The specification. -/
def Rounds (m : Mode) (p d q : Int) : Prop :=
  match m with
  | .floor => 0 ≤ p - d * q ∧ p - d * q < d
  | .ceil => -d < p - d * q ∧ p - d * q ≤ 0
  | .trunc => if 0 ≤ p then 0 ≤ p - d * q ∧ p - d * q < d else -d < p - d * q ∧ p - d * q ≤ 0
  | .expand => if 0 ≤ p then -d < p - d * q ∧ p - d * q ≤ 0 else 0 ≤ p - d * q ∧ p - d * q < d
  | .halfCeil => -d ≤ 2 * (p - d * q) ∧ 2 * (p - d * q) < d
  | .halfFloor => -d < 2 * (p - d * q) ∧ 2 * (p - d * q) ≤ d
  | .halfExpand =>
    if 0 ≤ p then -d ≤ 2 * (p - d * q) ∧ 2 * (p - d * q) < d else -d < 2 * (p - d * q) ∧ 2 * (p - d * q) ≤ d
  | .halfTrunc =>
    if 0 ≤ p then -d < 2 * (p - d * q) ∧ 2 * (p - d * q) ≤ d else -d ≤ 2 * (p - d * q) ∧ 2 * (p - d * q) < d
  | .halfEven =>
    -d ≤ 2 * (p - d * q) ∧ 2 * (p - d * q) ≤ d ∧ (2 * (p - d * q) = d ∨ 2 * (p - d * q) = -d → 2 ∣ q)
  | .unnecessary => p - d * q = 0

/-! ## The kernels

Variables: `dividend` = 0, `divisor` = 1, then `quotient = dividend / divisor` (truncated) = 2,
`remainder = dividend - quotient * divisor` = 3, `twiceRemainder = 2 * |remainder|` = 4. -/

namespace K
def dividend : E := .var 0
def divisor : E := .var 1
def quotient : E := .var 2
def remainder : E := .var 3
def twiceRemainder : E := .var 4
def one : E := .lit 1
def zero : E := .lit 0
def neg : B := .lt dividend zero
def exact : B := .eq remainder zero
/-- one step away from zero -/
def away : E := .ite neg (.sub quotient one) (.add quotient one)
/-- the quotient is odd: `quotient % 2 !== 0` -/
def odd : B := .not (.eq (.tmod quotient (.lit 2)) zero)
/-- the half modes step away from zero when `cond` holds (past the half, or on it for some ties) -/
def half (cond : B) : E := .ite cond away quotient
/-- past the half, or exactly on it and `tie` holds -/
def pastHalfOr (tie : B) : B := .or (.lt divisor twiceRemainder) (.and (.eq twiceRemainder divisor) tie)
end K

/-- What each kernel does when the division is not exact. -/
def kernelRest : Mode → E
  | .trunc => K.quotient
  | .expand => K.away
  | .ceil => .ite K.neg K.quotient (.add K.quotient K.one)
  | .floor => .ite (.not K.neg) K.quotient (.sub K.quotient K.one)
  | .unnecessary => .fail
  | .halfEven => K.half (K.pastHalfOr K.odd)
  | .halfExpand => K.half (.le K.divisor K.twiceRemainder)
  | .halfTrunc => K.half (.lt K.divisor K.twiceRemainder)
  | .halfCeil => K.half (K.pastHalfOr (.not K.neg))
  | .halfFloor => K.half (K.pastHalfOr K.neg)

/-- Every kernel first returns the quotient when the division is exact. `Gen.lean` prints that shared
first branch once, before the switch on the mode (`kernelRet_exact_first`). -/
def kernelRet (m : Mode) : E := .ite K.exact K.quotient (kernelRest m)

theorem kernelRet_exact_first (m : Mode) : kernelRet m = .ite K.exact K.quotient (kernelRest m) := rfl

/-- What each mode does, for the generated JSDoc. -/
def Mode.describe : Mode → String
  | .halfEven => "to the nearest integer, ties to the even neighbour"
  | .halfExpand => "to the nearest integer, ties away from zero"
  | .halfTrunc => "to the nearest integer, ties towards zero"
  | .halfCeil => "to the nearest integer, ties towards +infinity"
  | .halfFloor => "to the nearest integer, ties towards -infinity"
  | .expand => "away from zero"
  | .trunc => "towards zero"
  | .ceil => "towards +infinity"
  | .floor => "towards -infinity"
  | .unnecessary => "not at all: throws RoundingError unless the division is exact"

/-- The `let`s every kernel starts with: quotient, remainder and twice the remainder's magnitude. -/
def sharedLets : List (String × E) :=
  [("quotient", .tdiv K.dividend K.divisor), ("remainder", .sub K.dividend (.mul K.quotient K.divisor)),
    ("twiceRemainder", .ite (.lt K.remainder K.zero) (.mul (.lit (-2)) K.remainder) (.mul (.lit 2) K.remainder))]

def kernel (m : Mode) : Prog where
  name := s!"divideAndRound{m.tsName.capitalize}"
  doc := s!"`dividend / divisor` rounded {m.describe}"
  params := ["dividend", "divisor"]
  lets := sharedLets
  ret := kernelRet m

/-- Every kernel has the same parameters and `let`s, so `Gen.lean` prints them once, followed by a
`switch` on the mode whose cases are the kernels' results. -/
theorem kernel_shared (m : Mode) : (kernel m).params = ["dividend", "divisor"] ∧ (kernel m).lets = sharedLets :=
  ⟨rfl, rfl⟩

/-! ## Facts about truncated division -/

theorem tdiv_facts (p d : Int) (hd : 0 < d) :
    (0 ≤ p → 0 ≤ p - p.tdiv d * d ∧ p - p.tdiv d * d < d) ∧
    (p < 0 → -d < p - p.tdiv d * d ∧ p - p.tdiv d * d ≤ 0) := by
  have h : p - p.tdiv d * d = p.tmod d := by rw [Int.tmod_def]; ring
  rw [h]
  refine ⟨fun hp => ⟨Int.tmod_nonneg _ hp, Int.tmod_lt_of_pos _ hd⟩, fun hp => ?_⟩
  have h1 : (-p).tmod d = -(p.tmod d) := Int.neg_tmod p d
  have h2 : 0 ≤ (-p).tmod d := Int.tmod_nonneg _ (by omega)
  have h3 : (-p).tmod d < d := Int.tmod_lt_of_pos _ hd
  omega

theorem even_iff (q : Int) : q.tmod 2 = 0 ↔ 2 ∣ q := Int.dvd_iff_tmod_eq_zero.symm

/-! ## Soundness: whatever the kernel returns is correctly rounded -/

theorem kernel_sound (m : Mode) (p d : Int) (hd : 0 < d) (q : Int)
    (h : (kernel m).eval [p, d] = some q) : Rounds m p d q := by
  obtain ⟨hpos, hneg⟩ := tdiv_facts p d hd
  by_cases hrn : p < p.tdiv d * d <;>
  cases m <;>
  simp [kernel, sharedLets, kernelRet, kernelRest, Prog.eval, evalLets, E.eval, B.eval, K.dividend, K.divisor, K.quotient,
    K.remainder, K.twiceRemainder, K.one, K.zero, K.neg, K.exact, K.away, K.odd, K.half, K.pastHalfOr, hrn, even_iff] at h <;>
  generalize p.tdiv d = t at * <;>
  unfold Rounds <;>
  (try split_ifs at h) <;> (try simp only [Option.some.injEq] at h) <;> (try subst h) <;> (try split_ifs) <;>
  (try simp only [not_lt, not_le, not_not, not_or, not_and] at *) <;>
  (try simp only [mul_add, mul_sub, mul_one, mul_comm d t] at *) <;>
  first
  | (refine ⟨by linarith, by linarith⟩)
  | (refine ⟨by linarith, by linarith, ?_⟩; intro; omega)
  | linarith
  | omega
  | (obtain ⟨h1, h2⟩ := h; subst h2; linarith [mul_comm d t])

/-! ## The spec has exactly one answer -/

theorem pin_lt {d q q' : Int} (hd : 0 < d) (h1 : d * q - d * q' < d) (h2 : d * q' - d * q < d) : q = q' := by
  rcases lt_trichotomy q q' with h | h | h
  · nlinarith
  · exact h
  · nlinarith

theorem pin_le {d q q' : Int} (hd : 0 < d) (h1 : d * q - d * q' ≤ d) (h2 : d * q' - d * q ≤ d) :
    q' = q ∨ q' = q + 1 ∨ q' = q - 1 := by
  rcases lt_trichotomy q' (q - 1) with h | h | h
  · nlinarith
  · right; right; exact h
  · rcases lt_trichotomy q' (q + 1) with g | g | g
    · left; omega
    · right; left; exact g
    · nlinarith

/-- The `halfEven` case of `rounds_unique`: two neighbours cannot both be the even one. -/
theorem half_even_unique {p d q q' : Int} (hd : 0 < d)
    (h : -d ≤ 2 * (p - d * q) ∧ 2 * (p - d * q) ≤ d ∧ (2 * (p - d * q) = d ∨ 2 * (p - d * q) = -d → 2 ∣ q))
    (h' : -d ≤ 2 * (p - d * q') ∧ 2 * (p - d * q') ≤ d ∧ (2 * (p - d * q') = d ∨ 2 * (p - d * q') = -d → 2 ∣ q')) :
    q = q' := by
  obtain ⟨a1, a2, a3⟩ := h
  obtain ⟨b1, b2, b3⟩ := h'
  have hq : d * q - d * q' ≤ d := by linarith
  have hq' : d * q' - d * q ≤ d := by linarith
  rcases pin_le hd hq hq' with e | e | e
  · exact e.symm
  · have e2 : d * q' = d * q + d := by rw [e]; ring
    have ta : 2 * (p - d * q) = d := by linarith
    have tb : 2 * (p - d * q') = -d := by linarith
    have h1 := a3 (Or.inl ta)
    have h2 := b3 (Or.inr tb)
    rw [e] at h2
    omega
  · have e2 : d * q' = d * q - d := by rw [e]; ring
    have ta : 2 * (p - d * q) = -d := by linarith
    have tb : 2 * (p - d * q') = d := by linarith
    have h1 := a3 (Or.inr ta)
    have h2 := b3 (Or.inl tb)
    rw [e] at h2
    omega

/-- `Rounds` pins down the result: two values that both satisfy the spec are equal. -/
theorem rounds_unique (m : Mode) (p d q q' : Int) (hd : 0 < d)
    (h : Rounds m p d q) (h' : Rounds m p d q') : q = q' := by
  cases m
  case halfEven => exact half_even_unique hd h h'
  all_goals
    simp only [Rounds] at h h'
    (try split_ifs at h h')
    all_goals exact pin_lt hd (by linarith) (by linarith)

/-! ## The kernel fails exactly when it must -/

/-- The kernel returns a value for every mode except `unnecessary` on an inexact division. -/
theorem kernel_fails_iff (m : Mode) (p d : Int) (_hd : 0 < d) :
    (kernel m).eval [p, d] = none ↔ (m = .unnecessary ∧ ¬ d ∣ p) := by
  have hdvd : d ∣ p ↔ p - p.tdiv d * d = 0 := by
    rw [Int.dvd_iff_tmod_eq_zero, Int.tmod_def]
    constructor <;> intro h <;> linarith [mul_comm d (p.tdiv d)]
  rw [hdvd]
  cases m <;>
  simp [kernel, sharedLets, kernelRet, kernelRest, Prog.eval, evalLets, E.eval, B.eval, K.dividend, K.divisor, K.quotient,
    K.remainder, K.twiceRemainder, K.one, K.zero, K.neg, K.exact, K.away, K.odd, K.half, K.pastHalfOr] <;>
  (try split_ifs) <;> (try simp) <;>
  -- name the truncated quotients so that what is left is linear
  generalize (p.tdiv d).tmod 2 = u at * <;> generalize p.tdiv d * d = s at * <;> generalize p.tdiv d = t at * <;>
  omega

/-- Hence, whenever a correctly rounded answer exists (every mode, or `unnecessary` on an exact
division), the kernel returns exactly that answer. -/
theorem kernel_correct (m : Mode) (p d : Int) (hd : 0 < d) (q : Int) (hq : Rounds m p d q)
    (hok : m ≠ .unnecessary ∨ d ∣ p) : (kernel m).eval [p, d] = some q := by
  cases hk : (kernel m).eval [p, d] with
  | none =>
    have := (kernel_fails_iff m p d hd).mp hk
    rcases hok with h | h
    · exact absurd this.1 h
    · exact absurd h this.2
  | some q' => rw [rounds_unique m p d q' q hd (kernel_sound m p d hd q' hk) hq]

/-! ## Rounding a real number, and monotonicity

`RoundsR m x q` is `Rounds` for a real `x` in place of `p/d`: the error is `x - q`. A fraction `p/d`
rounds the same either way (`rounds_toReal`). Rounding is monotone in every mode
(`roundsR_mono`, `rounds_mono`), and the values that round to one `q` form an interval
(`roundsR_between`): so when the two ends of a bracket round alike, every real value between them
rounds to that amount (`rounds_between`), and it is the only rounding of that value
(`roundsR_unique`). -/

/-- The specification for a real value `x`: `Rounds` with `p/d` replaced by `x`. -/
noncomputable def RoundsR (m : Mode) (x : ℝ) (q : Int) : Prop :=
  match m with
  | .floor => 0 ≤ x - q ∧ x - q < 1
  | .ceil => -1 < x - q ∧ x - q ≤ 0
  | .trunc => if 0 ≤ x then 0 ≤ x - q ∧ x - q < 1 else -1 < x - q ∧ x - q ≤ 0
  | .expand => if 0 ≤ x then -1 < x - q ∧ x - q ≤ 0 else 0 ≤ x - q ∧ x - q < 1
  | .halfCeil => -1 ≤ 2 * (x - q) ∧ 2 * (x - q) < 1
  | .halfFloor => -1 < 2 * (x - q) ∧ 2 * (x - q) ≤ 1
  | .halfExpand =>
    if 0 ≤ x then -1 ≤ 2 * (x - q) ∧ 2 * (x - q) < 1 else -1 < 2 * (x - q) ∧ 2 * (x - q) ≤ 1
  | .halfTrunc =>
    if 0 ≤ x then -1 < 2 * (x - q) ∧ 2 * (x - q) ≤ 1 else -1 ≤ 2 * (x - q) ∧ 2 * (x - q) < 1
  | .halfEven =>
    -1 ≤ 2 * (x - q) ∧ 2 * (x - q) ≤ 1 ∧ (2 * (x - q) = 1 ∨ 2 * (x - q) = -1 → 2 ∣ q)
  | .unnecessary => x - q = 0

/-- An integer is at most -1, 0, or at least 1, as reals. -/
theorem int_cases_real (q : Int) : (q : ℝ) ≤ -1 ∨ (q : ℝ) = 0 ∨ 1 ≤ (q : ℝ) := by
  rcases (by omega : q ≤ -1 ∨ q = 0 ∨ 1 ≤ q) with h | h | h
  · left; exact_mod_cast h
  · right; left; exact_mod_cast h
  · right; right; exact_mod_cast h

/-- `p/d` rounded as a real is `p/d` rounded as a fraction. -/
theorem rounds_toReal (m : Mode) (p d q : Int) (hd : 0 < d) (h : Rounds m p d q) :
    RoundsR m ((p : ℝ) / d) q := by
  have hd' : (0 : ℝ) < d := by exact_mod_cast hd
  have hd0 : (d : ℝ) ≠ 0 := hd'.ne'
  have hsign : (0 : ℝ) ≤ (p : ℝ) / d ↔ 0 ≤ p := by
    rw [le_div_iff₀ hd', zero_mul, Int.cast_nonneg]
  -- the error `x - q` is `(p - d·q) / d`
  have hx : (p : ℝ) / d - q = (((p - d * q : ℤ)) : ℝ) / d := by
    push_cast
    field_simp
    all_goals ring
  obtain ⟨e, he⟩ : ∃ e : ℤ, p - d * q = e := ⟨_, rfl⟩
  have ht : (e : ℝ) / d * d = e := div_mul_cancel₀ _ hd0
  cases m <;> simp only [Rounds, RoundsR, hsign, hx, he] at h ⊢ <;> (try split_ifs at h ⊢) <;>
    generalize (e : ℝ) / d = t at * <;> rify at h <;>
  first
  | (obtain ⟨h1, h2⟩ := h; constructor <;> nlinarith)
  | (obtain ⟨h1, h2, h3⟩ := h
     refine ⟨by nlinarith, by nlinarith, ?_⟩
     intro hor
     apply h3
     rcases hor with h4 | h4
     · left
       have h5 : (2 * e : ℝ) = d := by linear_combination (d : ℝ) * h4 - 2 * ht
       exact_mod_cast h5
     · right
       have h5 : (2 * e : ℝ) = -d := by linear_combination (d : ℝ) * h4 - 2 * ht
       exact_mod_cast h5)
  | nlinarith

/-- Rounding is monotone in every mode. -/
theorem roundsR_mono (m : Mode) (x y : ℝ) (q q' : Int) (hxy : x ≤ y) (h : RoundsR m x q)
    (h' : RoundsR m y q') : q ≤ q' := by
  by_contra hlt
  have hq1 : q' + 1 ≤ q := by omega
  have hq : (q' : ℝ) + 1 ≤ q := by exact_mod_cast hq1
  have hq0 := int_cases_real q
  cases m
  case halfEven =>
    obtain ⟨a1, a2, a3⟩ := h
    obtain ⟨b1, b2, b3⟩ := h'
    have e1 : (q : ℝ) = q' + 1 := by linarith
    have e2 : q = q' + 1 := by exact_mod_cast e1
    have t1 : 2 * (x - q) = -1 := by linarith
    have t2 : 2 * (y - q') = 1 := by linarith
    have d1 := a3 (Or.inr t1)
    have d2 := b3 (Or.inl t2)
    omega
  all_goals
    simp only [RoundsR] at h h'
    (try split_ifs at h h')
    all_goals
      (try obtain ⟨h1, h2⟩ := h)
      (try obtain ⟨h3, h4⟩ := h')
      rcases hq0 with h0 | h0 | h0 <;> linarith

/-- The values that round to `q` form an interval: between two of them, every value rounds to `q`. -/
theorem roundsR_between (m : Mode) (x y z : ℝ) (q : Int) (hxz : x ≤ z) (hzy : z ≤ y)
    (hx : RoundsR m x q) (hy : RoundsR m y q) : RoundsR m z q := by
  have hq0 := int_cases_real q
  cases m
  case halfEven =>
    obtain ⟨a1, a2, a3⟩ := hx
    obtain ⟨b1, b2, b3⟩ := hy
    refine ⟨by linarith, by linarith, ?_⟩
    rintro (t | t)
    · exact b3 (Or.inl (by linarith))
    · exact a3 (Or.inr (by linarith))
  all_goals
    simp only [RoundsR] at hx hy ⊢
    (try split_ifs at hx hy ⊢)
    all_goals
      (try obtain ⟨h1, h2⟩ := hx)
      (try obtain ⟨h3, h4⟩ := hy)
      rcases hq0 with h0 | h0 | h0 <;> first | linarith | (constructor <;> linarith)

/-- A real value has at most one rounding in each mode. -/
theorem roundsR_unique (m : Mode) (x : ℝ) (q q' : Int) (h : RoundsR m x q) (h' : RoundsR m x q') :
    q = q' :=
  le_antisymm (roundsR_mono m x x q q' le_rfl h h') (roundsR_mono m x x q' q le_rfl h' h)

/-- Rounding a fraction is monotone in every mode. -/
theorem rounds_mono (m : Mode) (p p' d q q' : Int) (hd : 0 < d) (hp : p ≤ p')
    (h : Rounds m p d q) (h' : Rounds m p' d q') : q ≤ q' := by
  have hd' : (0 : ℝ) < d := by exact_mod_cast hd
  have hp' : (p : ℝ) ≤ p' := by exact_mod_cast hp
  exact roundsR_mono m _ _ q q' (div_le_div_of_nonneg_right hp' hd'.le)
    (rounds_toReal m p d q hd h) (rounds_toReal m p' d q' hd h')

/-- When `low/d` and `high/d` both round to `q`, so does every real value between them: two ends
that round alike pin the rounded value. -/
theorem rounds_between (m : Mode) (low high d q : Int) (hd : 0 < d) (X : ℝ)
    (hlow : (low : ℝ) / d ≤ X) (hhigh : X ≤ (high : ℝ) / d)
    (hl : Rounds m low d q) (hh : Rounds m high d q) : RoundsR m X q :=
  roundsR_between m _ _ X q hlow hhigh (rounds_toReal m low d q hd hl)
    (rounds_toReal m high d q hd hh)

end Ducat
