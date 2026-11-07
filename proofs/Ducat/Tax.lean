import Ducat.Rounding

/-!
# Tax, scale changes and conversion, on top of the proved rounding kernel

`divRound m p d` below is the generated kernel (`kernel m`, for `d > 0`). In `src/`, every rounded
operation is one call to it: `mulRatio(x, num/den)` is `divRound(x * num * 10^up, den * 10^down)`;
`addTax`, `extractTax`, `toScale` and `convert` are built on `mulRatio`. The theorems:

* `addTax_gross`, `extractTax_gross`: net + tax = gross, exactly.
* `addTax_bound`: the tax is the exact tax `net * r` correctly rounded (so within half a unit for
  the half modes and under one unit for the directed ones: `Rounds`).
* `extractTax_bound`: the extracted net is `gross / (1 + r)` correctly rounded, so the tax is off
  from the exact tax by the same error with the sign flipped.
* `toScale_roundtrip`: raising the scale and lowering it back gives the original amount, in every
  mode (including `unnecessary`, which does not fail).
* `divRound_mul_left`: scaling numerator and denominator by the same `k > 0` gives the same result,
  so reducing a rate (`num/den` by their gcd), or composing rates exactly, cannot change a conversion:
  it is rounded once, from the exact rational product.
* `rounds_half_bound`, `rounds_directed_bound`: what `Rounds` means as an error bound.
-/

namespace Ducat

/-- The kernel as a function; `0` stands in for the failure case, which the theorems exclude. -/
def divRound (m : Mode) (p d : Int) : Int := ((kernel m).eval [p, d]).getD 0

theorem divRound_spec (m : Mode) (p d : Int) (hd : 0 < d) (q : Int) (hq : Rounds m p d q)
    (hok : m ≠ .unnecessary ∨ d ∣ p) : divRound m p d = q := by
  simp [divRound, kernel_correct m p d hd q hq hok]

/-- When the kernel succeeds, `divRound` is its answer and satisfies `Rounds`. -/
theorem divRound_rounds (m : Mode) (p d : Int) (hd : 0 < d) (hok : m ≠ .unnecessary ∨ d ∣ p) :
    Rounds m p d (divRound m p d) := by
  cases hk : (kernel m).eval [p, d] with
  | none =>
    have := (kernel_fails_iff m p d hd).mp hk
    rcases hok with h | h
    · exact absurd this.1 h
    · exact absurd h this.2
  | some q => simp only [divRound, hk, Option.getD_some]; exact kernel_sound m p d hd q hk

/-! ## Error bounds -/

def Mode.isHalf : Mode → Bool
  | .halfEven | .halfExpand | .halfTrunc | .halfCeil | .halfFloor => true
  | _ => false

/-- Half modes: `|p/d - q| ≤ 1/2`. -/
theorem rounds_half_bound (m : Mode) (hm : m.isHalf) (p d q : Int) (h : Rounds m p d q) :
    -d ≤ 2 * (p - d * q) ∧ 2 * (p - d * q) ≤ d := by
  cases m <;> simp only [Mode.isHalf, Bool.false_eq_true] at hm <;> simp only [Rounds] at h <;> (try split_ifs at h) <;>
    omega

/-- Every mode: `|p/d - q| < 1`. -/
theorem rounds_directed_bound (m : Mode) (p d q : Int) (hd : 0 < d) (h : Rounds m p d q) :
    -d < p - d * q ∧ p - d * q < d := by
  cases m <;> simp only [Rounds] at h <;> (try split_ifs at h) <;> omega

/-! ## Tax -/

/-- `addTax(net, r = num/den)`: `tax = round(net * num / den)`, `gross = net + tax`. -/
def addTax (m : Mode) (net num den : Int) : Int × Int × Int :=
  let tax := divRound m (net * num) den
  (net, tax, net + tax)

/-- `extractTax(gross, r = num/den)`: `net = round(gross * den / (den + num))`, `tax = gross - net`. -/
def extractTax (m : Mode) (gross num den : Int) : Int × Int × Int :=
  let net := divRound m (gross * den) (den + num)
  (net, gross - net, gross)

theorem addTax_gross (m : Mode) (net num den : Int) :
    let (n, t, g) := addTax m net num den; n + t = g := by simp [addTax]

theorem extractTax_gross (m : Mode) (gross num den : Int) :
    let (n, t, g) := extractTax m gross num den; n + t = g := by simp [extractTax]

theorem addTax_bound (m : Mode) (net num den : Int) (hd : 0 < den) (hok : m ≠ .unnecessary ∨ den ∣ net * num) :
    Rounds m (net * num) den (addTax m net num den).2.1 :=
  divRound_rounds m _ _ hd hok

/-- The extracted net is correctly rounded; the tax `gross - net` then has the opposite error:
`tax * (den + num) - gross * num = -(net * (den + num) - gross * den)`. -/
theorem extractTax_bound (m : Mode) (gross num den : Int) (hd : 0 < den + num)
    (hok : m ≠ .unnecessary ∨ (den + num) ∣ gross * den) :
    Rounds m (gross * den) (den + num) (extractTax m gross num den).1 ∧
    (extractTax m gross num den).2.1 * (den + num) - gross * num =
      -((extractTax m gross num den).1 * (den + num) - gross * den) :=
  ⟨divRound_rounds m _ _ hd hok, by simp only [extractTax]; ring⟩

/-! ## Scale changes -/

/-- Lowering the scale by `e` digits: one rounded division by `10^e`. -/
def scaleDown (m : Mode) (v : Int) (e : Nat) : Int := divRound m v (10 ^ e)

/-- Raising it is exact. -/
def scaleUp (v : Int) (e : Nat) : Int := v * 10 ^ e

theorem toScale_roundtrip (m : Mode) (v : Int) (e : Nat) : scaleDown m (scaleUp v e) e = v := by
  have hd : (0 : Int) < 10 ^ e := by positivity
  apply divRound_spec m _ _ hd
  · simp only [scaleUp, mul_comm v]
    cases m <;> simp only [Rounds] <;> (try split_ifs) <;> simp [hd.le, hd]
    -- left over: halfEven's tie clause, whose premise `0 = 10 ^ e` is false
    intro h
    omega
  · right; exact ⟨v, by simp only [scaleUp]; ring⟩

/-! ## Rounding once -/

/-- Scaling numerator and denominator by `k > 0` keeps a correctly rounded answer correct. -/
theorem rounds_mul_left (m : Mode) {k : Int} (hk : 0 < k) (p d q : Int) (h : Rounds m p d q) :
    Rounds m (k * p) (k * d) q := by
  have e : k * p - k * d * q = k * (p - d * q) := by ring
  have hp : (0 ≤ k * p ↔ 0 ≤ p) :=
    ⟨fun h' => by by_contra hc; push Not at hc; nlinarith, fun h' => mul_nonneg hk.le h'⟩
  cases m
  case unnecessary =>
    simp only [Rounds] at h ⊢
    rw [e, h, mul_zero]
  case halfEven =>
    simp only [Rounds] at h ⊢
    rw [e]
    generalize p - d * q = x at h ⊢
    obtain ⟨h1, h2, h3⟩ := h
    refine ⟨by nlinarith, by nlinarith, fun ht => h3 ?_⟩
    rcases ht with ht | ht
    · left
      exact mul_left_cancel₀ hk.ne' (by rw [← ht]; ring)
    · right
      exact mul_left_cancel₀ hk.ne' (by rw [mul_neg, ← ht]; ring)
  all_goals
    simp only [Rounds, hp] at h ⊢
    rw [e]
    generalize p - d * q = x at h ⊢
    (try split_ifs at h ⊢)
    all_goals (obtain ⟨h1, h2⟩ := h; constructor <;> nlinarith)

/-- Scaling a fraction by `k > 0` does not change how it rounds. -/
theorem divRound_mul_left (m : Mode) {k : Int} (hk : 0 < k) (p d : Int) (hd : 0 < d)
    (hok : m ≠ .unnecessary ∨ d ∣ p) : divRound m (k * p) (k * d) = divRound m p d := by
  apply divRound_spec m _ _ (by positivity)
  · exact rounds_mul_left m hk p d _ (divRound_rounds m p d hd hok)
  · rcases hok with h | h
    · exact Or.inl h
    · exact Or.inr (mul_dvd_mul_left k h)

end Ducat
