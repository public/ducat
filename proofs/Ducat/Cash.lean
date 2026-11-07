import Ducat.Tax

/-!
# Rounding to an increment (cash rounding)

`roundToIncrement(m, increment, mode)` in `src/cash.ts` is one call to the rounding kernel: the number of
increments, `divRound(x, s)`, times the increment `s` (after aligning scales). `cashRound` is
`roundToIncrement` with the legal cash step of the currency (CHF 0.05, SEK 1, ...).

* `increment_multiple`: the result is a whole number of increments.
* `increment_near`: it is less than one increment from the amount, in every mode.
* `increment_half`: in the half modes, at most half an increment.
* `increment_exact`: an amount that already is a multiple is returned unchanged, in every mode
  (`unnecessary` included).
* `increment_idem`: so rounding twice is rounding once.
-/

namespace Ducat

def roundToIncrement (m : Mode) (x s : Int) : Int := divRound m x s * s

variable {x s : Int}

theorem increment_multiple (m : Mode) : s ∣ roundToIncrement m x s :=
  ⟨divRound m x s, by simp [roundToIncrement, mul_comm]⟩

theorem increment_near (m : Mode) (hs : 0 < s) (hok : m ≠ .unnecessary ∨ s ∣ x) :
    -s < x - roundToIncrement m x s ∧ x - roundToIncrement m x s < s := by
  have := rounds_directed_bound m x s _ hs (divRound_rounds m x s hs hok)
  simp only [roundToIncrement]
  constructor <;> linarith [mul_comm s (divRound m x s)]

theorem increment_half (m : Mode) (hm : m.isHalf) (hs : 0 < s) :
    -s ≤ 2 * (x - roundToIncrement m x s) ∧ 2 * (x - roundToIncrement m x s) ≤ s := by
  have hok : m ≠ .unnecessary ∨ s ∣ x := Or.inl (by rintro rfl; simp [Mode.isHalf] at hm)
  have := rounds_half_bound m hm x s _ (divRound_rounds m x s hs hok)
  simp only [roundToIncrement]
  constructor <;> linarith [mul_comm s (divRound m x s)]

theorem increment_exact (m : Mode) (hs : 0 < s) (hx : s ∣ x) : roundToIncrement m x s = x := by
  obtain ⟨k, rfl⟩ := hx
  simp only [roundToIncrement, divRound_exact m k hs]
  ring

theorem increment_idem (m : Mode) (hs : 0 < s) :
    roundToIncrement m (roundToIncrement m x s) s = roundToIncrement m x s :=
  increment_exact m hs (increment_multiple m)

end Ducat
