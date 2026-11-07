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

Variables: `p` = 0, `d` = 1, then `q = p / d` (truncated) = 2, `r = p - q*d` = 3, `a = 2|r|` = 4. -/

namespace K
def p : E := .var 0
def d : E := .var 1
def q : E := .var 2
def r : E := .var 3
def a : E := .var 4
def one : E := .lit 1
def zero : E := .lit 0
def neg : B := .lt p zero
def exact : B := .eq r zero
/-- one step away from zero -/
def away : E := .ite neg (.sub q one) (.add q one)
/-- q is odd: `(q / 2) * 2 !== q` -/
def odd : B := .not (.eq (.mul (.tdiv q (.lit 2)) (.lit 2)) q)
/-- the half modes step away from zero when `a > d`, and on a tie (`a = d`) when `tie` holds -/
def half (tie : B) : E := .ite (.or (.lt d a) (.and (.eq a d) tie)) away q
def yes : B := .eq zero zero
def no : B := .not yes
end K

def kernelRet : Mode → E
  | .trunc => K.q
  | .expand => .ite K.exact K.q K.away
  | .ceil => .ite (.or K.exact K.neg) K.q (.add K.q K.one)
  | .floor => .ite (.or K.exact (.not K.neg)) K.q (.sub K.q K.one)
  | .unnecessary => .ite K.exact K.q .fail
  | .halfEven => K.half K.odd
  | .halfExpand => K.half K.yes
  | .halfTrunc => K.half K.no
  | .halfCeil => K.half (.not K.neg)
  | .halfFloor => K.half K.neg

def capitalize (s : String) : String := s.capitalize

def kernel (m : Mode) : Prog where
  name := s!"divRound{capitalize m.tsName}"
  doc := s!"p / d rounded '{m.tsName}' (d > 0). Generated from proofs/Ducat/Rounding.lean; proved there."
  params := ["p", "d"]
  lets := [("q", .tdiv K.p K.d), ("r", .sub K.p (.mul K.q K.d)), ("a", .ite (.lt K.r K.zero) (.mul (.lit (-2)) K.r) (.mul (.lit 2) K.r))]
  ret := kernelRet m

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

theorem even_iff (q : Int) : q.tdiv 2 * 2 = q ↔ 2 ∣ q := by
  constructor
  · intro h; exact ⟨q.tdiv 2, by linarith⟩
  · intro h; exact Int.tdiv_mul_cancel h

/-! ## Soundness: whatever the kernel returns is correctly rounded -/

theorem kernel_sound (m : Mode) (p d : Int) (hd : 0 < d) (q : Int)
    (h : (kernel m).eval [p, d] = some q) : Rounds m p d q := by
  obtain ⟨hpos, hneg⟩ := tdiv_facts p d hd
  have hev := even_iff (p.tdiv d)
  by_cases hrn : p < p.tdiv d * d <;>
  cases m <;>
  simp [kernel, kernelRet, Prog.eval, evalLets, E.eval, B.eval, K.p, K.d, K.q, K.r, K.a, K.one, K.zero,
    K.neg, K.exact, K.away, K.odd, K.half, K.yes, K.no, hrn] at h <;>
  generalize p.tdiv d = t at * <;>
  unfold Rounds <;>
  (try split_ifs at h) <;> (try simp only [Option.some.injEq] at h) <;> (try subst h) <;> (try split_ifs) <;>
  (try simp only [not_lt, not_le, ne_eq, not_not, not_or, not_and] at *) <;>
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

/-- `Rounds` pins down the result: two values that both satisfy the spec are equal. -/
theorem rounds_unique (m : Mode) (p d q q' : Int) (hd : 0 < d)
    (h : Rounds m p d q) (h' : Rounds m p d q') : q = q' := by
  cases m <;> simp only [Rounds] at h h' <;> (try split_ifs at h h') <;>
  first
  | exact pin_lt hd (by linarith) (by linarith)
  | (obtain ⟨a1, a2, a3⟩ := h
     obtain ⟨b1, b2, b3⟩ := h'
     rcases pin_le hd (by linarith) (by linarith) with e | e | e
     · exact e.symm
     · subst e
       simp only [mul_add, mul_one] at b1 b2 b3
       have ta : 2 * (p - d * q) = d := by linarith
       have tb : 2 * (p - (d * q + d)) = -d := by linarith
       have := a3 (Or.inl ta); have := b3 (Or.inr tb); omega
     · subst e
       simp only [mul_sub, mul_one] at b1 b2 b3
       have ta : 2 * (p - d * q) = -d := by linarith
       have tb : 2 * (p - (d * q - d)) = d := by linarith
       have := a3 (Or.inr ta); have := b3 (Or.inl tb); omega)
  | exact pin_lt hd (by linarith) (by linarith)

/-! ## The kernel fails exactly when it must -/

/-- The kernel returns a value for every mode except `unnecessary` on an inexact division. -/
theorem kernel_fails_iff (m : Mode) (p d : Int) (hd : 0 < d) :
    (kernel m).eval [p, d] = none ↔ (m = .unnecessary ∧ ¬ d ∣ p) := by
  have hdvd : d ∣ p ↔ p - p.tdiv d * d = 0 := by
    rw [Int.dvd_iff_tmod_eq_zero, Int.tmod_def]
    constructor <;> intro h <;> linarith [mul_comm d (p.tdiv d)]
  rw [hdvd]
  cases m <;>
  simp [kernel, kernelRet, Prog.eval, evalLets, E.eval, B.eval, K.p, K.d, K.q, K.r, K.a, K.one, K.zero,
    K.neg, K.exact, K.away, K.odd, K.half, K.yes, K.no] <;>
  (try split_ifs) <;> simp

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

end Ducat
