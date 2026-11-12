import Ducat.Xnpv
import Ducat.Search
import Ducat.Rounding

/-!
# A model of `xnpvScaled` and of `xnpvBounds`, `xnpv` and `xirr`

The integer steps of `src/excel.ts`, for flows on days `d ≥ 0` after the first date with Excel's
day count (`d / 365` years), written with the definitions the theorems in `Ducat/Xnpv.lean` and
`Ducat/Search.lean` are about: the roots are `floorRoot`, the powers `loop` with `mulFloor` or
`mulCeil`, the rate search `bisectRate`. `Oracle.lean` prints it on generated cases to
`test/fixtures/xnpv.oracle.json` and `xirr.oracle.json`, which the TypeScript must match exactly.

* `split`: a year fraction `n/m` as `W + Σ r/q` over `m`'s prime powers `q` (ascending primes), by
  the CRT, with the identity checked as the code checks it.
* `rootLow`, `factorLow`, `factorHigh`: each prime power's root `R = ⌊qth root of ⌊a·S^q / b⌋⌋`, and a
  group's factor `Π g^(r/q)` multiplied left to right from `fixedPower(R, r)` floored and
  `fixedPower(R + 1, r)` ceiled, at `S = 2^bits`. `factorLow_le` and `le_factorHigh`: they bracket
  the real factor.
* `scaled`: the exact coefficient of each irrational part (flows with the same part summed first),
  then the bounds on the sum, or the exact value when every irrational coefficient is 0.
* `xnpvBounds`, `xnpv`, `xirr`: the public functions, from 64 to 2,048 bits.

The coefficients are kept in ℚ: only their values reach the floors and ceilings, so it doesn't
matter that the code keeps them over a common denominator. Not modelled: other day counts, the
defensive caps on root size and order (no Excel day count reaches them), a caller's `bracket`, and
`'unnecessary'` rounding.
-/

namespace Ducat.XnpvModel

open Ducat.Xnpv Ducat.Search

/-! ## The split -/

/-- `p` divided out of `rest`: its power, and what is left. -/
def stripPrime (p : ℕ) : ℕ → ℕ → ℕ × ℕ
  | 0, rest => (1, rest)
  | f + 1, rest =>
    if 1 < p ∧ 0 < rest ∧ rest % p = 0 then
      ((stripPrime p f (rest / p)).1 * p, (stripPrime p f (rest / p)).2)
    else (1, rest)

/-- The prime powers whose product is `rest`, by trial division from `p`, as `primePowers` finds
them: in ascending primes. -/
def primePowersFrom : ℕ → ℕ → ℕ → List ℕ
  | 0, _, rest => if 1 < rest then [rest] else []
  | f + 1, p, rest =>
    if rest < p * p then (if 1 < rest then [rest] else [])
    else if rest % p = 0 then
      (stripPrime p rest rest).1 :: primePowersFrom f (p + 1) (stripPrime p rest rest).2
    else primePowersFrom f (p + 1) rest

def primePowers (m : ℕ) : List ℕ := primePowersFrom m 2 m

/-- `c⁻¹ mod q`, by search: the root orders are small. -/
def invMod (c q : ℕ) : ℕ := ((List.range q).find? fun x => c * x % q = 1).getD 0

/-- `splitExponent`: `n/m` (reduced) as the whole part `W` and the `(q, r)` with `r ≠ 0`; `none`
where the code's check of `n = W·m + Σ r·(m/q)` fails. -/
def split (n m : ℕ) : Option (ℤ × List (ℕ × ℕ)) :=
  if m = 1 then some (n, [])
  else
    let parts := (primePowers m).map fun q => (q, n % q * invMod (m / q) q % q, m / q)
    let covered : ℤ := (parts.map fun p => ((p.2.1 * p.2.2 : ℕ) : ℤ)).sum
    if ((n : ℤ) - covered) % m ≠ 0 then none
    else some (((n : ℤ) - covered) / m, (parts.filter fun p => p.2.1 ≠ 0).map fun p => (p.1, p.2.1))

/-! ## Flows by date -/

/-- Adds a flow on day `d` to flows sorted by day, combining flows on one day. -/
def insertDay (d : ℕ) (v : ℤ) : List (ℕ × ℤ) → List (ℕ × ℤ)
  | [] => [(d, v)]
  | (d', v') :: rest =>
    if d = d' then (d', v' + v) :: rest
    else if d < d' then (d, v) :: (d', v') :: rest
    else (d', v') :: insertDay d v rest

def groupDays (flows : List (ℕ × ℤ)) : List (ℕ × ℤ) :=
  flows.foldl (fun acc f => insertDay f.1 f.2 acc) []

/-- `datedFlows`: each date's summed flow in date order, and its year fraction split. `none` where
the code throws: no positive or no negative value, or a split that fails its check. -/
structure Dated where
  minors : List ℤ
  splits : List (ℤ × List (ℕ × ℕ))

def dated (flows : List (ℕ × ℤ)) : Option Dated :=
  if flows.any (fun f => decide (0 < f.2)) && flows.any (fun f => decide (f.2 < 0)) then
    let groups := groupDays flows
    (groups.mapM fun f => split (f.1 / Nat.gcd f.1 365) (365 / Nat.gcd f.1 365)).map
      fun splits => (⟨groups.map (·.2), splits⟩ : Dated)
  else none

/-! ## Roots and factors -/

/-- The `q`th root of `v` when it is an integer. -/
def exactRoot (v q : ℕ) : Option ℕ :=
  if floorRoot q v ^ q = v then some (floorRoot q v) else none

/-- The floor of `S·g^(1/q)` for `g = num/den`, `S = 2^bits`: the `q`th root of `⌊num·S^q / den⌋`. -/
def rootLow (num den bits q : ℕ) : ℕ := floorRoot q (num * 2 ^ (bits * q) / den)

/-- `rootBracket`: a rational root `a/b` when `num` and `den` are perfect `q`th powers. -/
def rationalRoot (num den q : ℕ) : Option (ℕ × ℕ) :=
  match exactRoot num q, exactRoot den q with
  | some a, some b => some (a, b)
  | _, _ => none

/-- A group's factor `Π g^(r/q)` from below: each power floored, multiplied in floored. -/
def factorLow (num den bits : ℕ) (key : List (ℕ × ℕ)) : ℕ :=
  key.foldl (fun acc p => mulFloor (2 ^ bits) acc
    (loop (mulFloor (2 ^ bits)) (2 ^ bits) (rootLow num den bits p.1) p.2)) (2 ^ bits)

/-- And from above: each power from `R + 1`, ceiled, multiplied in ceiled. -/
def factorHigh (num den bits : ℕ) (key : List (ℕ × ℕ)) : ℕ :=
  key.foldl (fun acc p => mulCeil (2 ^ bits) acc
    (loop (mulCeil (2 ^ bits)) (2 ^ bits) (rootLow num den bits p.1 + 1) p.2)) (2 ^ bits)

/-- The roots bracket `g^(1/q)`: `R^q·den ≤ num·S^q < (R + 1)^q·den` (`floorRoot_spec`,
`root_bracket`). -/
theorem rootLow_bracket (num den bits q : ℕ) (hden : 0 < den) (hq : q ≠ 0) :
    rootLow num den bits q ^ q * den ≤ num * (2 ^ bits) ^ q ∧
      num * (2 ^ bits) ^ q < (rootLow num den bits q + 1) ^ q * den := by
  have hS : (2 ^ bits) ^ q = 2 ^ (bits * q) := (pow_mul 2 bits q).symm
  obtain ⟨h1, h2⟩ := floorRoot_spec q (num * 2 ^ (bits * q) / den) (Nat.pos_of_ne_zero hq)
  have h1' : rootLow num den bits q ^ q ≤ num * (2 ^ bits) ^ q / den := by
    rw [hS]
    exact h1
  have h2' : num * (2 ^ bits) ^ q / den < (rootLow num den bits q + 1) ^ q := by
    rw [hS]
    exact h2
  exact root_bracket (rootLow num den bits q) q num den (2 ^ bits) hden h1' h2'

/-- The floored factor is a lower bound of `Π g^(r/q)`. -/
theorem factorLow_le (num den bits : ℕ) (hden : 0 < den) (key : List (ℕ × ℕ))
    (hkey : ∀ p ∈ key, p.1 ≠ 0) :
    (factorLow num den bits key : ℝ) / ((2 ^ bits : ℕ) : ℝ) ≤
      (key.map fun p => ((num : ℝ) / den) ^ ((p.2 : ℝ) / p.1)).prod := by
  have hS : 0 < 2 ^ bits := by positivity
  have hS' : ((2 ^ bits : ℕ) : ℝ) ≠ 0 := by positivity
  let xs := key.map fun p =>
    (loop (mulFloor (2 ^ bits)) (2 ^ bits) (rootLow num den bits p.1) p.2,
      ((num : ℝ) / den) ^ ((p.2 : ℝ) / p.1))
  have hfold : factorLow num den bits key = xs.foldl (fun a p => mulFloor (2 ^ bits) a p.1) (2 ^ bits) := by
    simp only [factorLow, xs, List.foldl_map]
    all_goals rfl
  have hprod : (key.map fun p => ((num : ℝ) / den) ^ ((p.2 : ℝ) / p.1)) = xs.map Prod.snd := by
    simp only [xs, List.map_map]
    all_goals rfl
  have h := fold_floor_le (2 ^ bits) hS xs (2 ^ bits) 1 zero_le_one (by rw [div_self hS'])
    (by
      intro p hp
      simp only [xs, List.mem_map] at hp
      obtain ⟨k, hk, rfl⟩ := hp
      obtain ⟨b1, b2⟩ := rootLow_bracket num den bits k.1 hden (hkey k hk)
      exact ⟨(factor_bracket _ k.1 k.2 num den (2 ^ bits) (hkey k hk) hden hS b1 b2).1,
        Real.rpow_nonneg (by positivity) _⟩)
  rw [hfold, hprod]
  simpa using h

/-- The ceiled factor is an upper bound of `Π g^(r/q)`. -/
theorem le_factorHigh (num den bits : ℕ) (hden : 0 < den) (key : List (ℕ × ℕ))
    (hkey : ∀ p ∈ key, p.1 ≠ 0) :
    (key.map fun p => ((num : ℝ) / den) ^ ((p.2 : ℝ) / p.1)).prod ≤
      (factorHigh num den bits key : ℝ) / ((2 ^ bits : ℕ) : ℝ) := by
  have hS : 0 < 2 ^ bits := by positivity
  have hS' : ((2 ^ bits : ℕ) : ℝ) ≠ 0 := by positivity
  let xs := key.map fun p =>
    (loop (mulCeil (2 ^ bits)) (2 ^ bits) (rootLow num den bits p.1 + 1) p.2,
      ((num : ℝ) / den) ^ ((p.2 : ℝ) / p.1))
  have hfold : factorHigh num den bits key = xs.foldl (fun a p => mulCeil (2 ^ bits) a p.1) (2 ^ bits) := by
    simp only [factorHigh, xs, List.foldl_map]
    all_goals rfl
  have hprod : (key.map fun p => ((num : ℝ) / den) ^ ((p.2 : ℝ) / p.1)) = xs.map Prod.snd := by
    simp only [xs, List.map_map]
    all_goals rfl
  have h := le_fold_ceil (2 ^ bits) hS xs (2 ^ bits) 1 zero_le_one (by rw [div_self hS'])
    (by
      intro p hp
      simp only [xs, List.mem_map] at hp
      obtain ⟨k, hk, rfl⟩ := hp
      obtain ⟨b1, b2⟩ := rootLow_bracket num den bits k.1 hden (hkey k hk)
      exact ⟨(factor_bracket _ k.1 k.2 num den (2 ^ bits) (hkey k hk) hden hS b1 b2).2,
        Real.rpow_nonneg (by positivity) _⟩)
  rw [hfold, hprod]
  simpa using h

/-! ## The sum -/

/-- `g^e` for an integer `e`. -/
def qpow (g : ℚ) (e : ℤ) : ℚ := if 0 ≤ e then g ^ e.toNat else (g ^ (-e).toNat)⁻¹

/-- A flow's exact coefficient `v·g^(−W)` divided by its rational roots' powers, and its irrational
part: the `(q, r)` whose roots are irrational, in the split's order. -/
def term (num den : ℕ) (minor whole : ℤ) (parts : List (ℕ × ℕ)) : List (ℕ × ℕ) × ℚ :=
  parts.foldl (fun acc p =>
    match rationalRoot num den p.1 with
    | some (a, b) => (acc.1, acc.2 * ((b : ℚ) / a) ^ p.2)
    | none => (acc.1 ++ [p], acc.2)) (([] : List (ℕ × ℕ)), (minor : ℚ) * qpow ((num : ℚ) / den) (-whole))

/-- Adds a coefficient to its irrational part's group. -/
def addTo (key : List (ℕ × ℕ)) (c : ℚ) : List (List (ℕ × ℕ) × ℚ) → List (List (ℕ × ℕ) × ℚ)
  | [] => [(key, c)]
  | (k, v) :: rest => if k = key then (k, v + c) :: rest else (k, v) :: addTo key c rest

def groups (num den : ℕ) (d : Dated) : List (List (ℕ × ℕ) × ℚ) :=
  (d.minors.zip d.splits).foldl (fun acc f =>
    if f.1 = 0 then acc
    else addTo (term num den f.1 f.2.1 f.2.2).1 (term num den f.1 f.2.1 f.2.2).2 acc) []

/-- `xnpvScaled`'s result: the exact value (in minor units), or bounds at `2^−bits`. -/
inductive Scaled where
  | exact (v : ℚ)
  | bounds (low high : ℤ)

/-- `xnpvScaled`: `none` while a factor's lower end floors to 0. -/
def scaled (num den bits : ℕ) (d : Dated) : Option Scaled :=
  let gs := (groups num den d).filter fun g => g.2 ≠ 0
  let rational : ℚ := ((gs.filter fun g => g.1 = []).map (·.2)).sum
  let irrational := gs.filter fun g => g.1 ≠ []
  if irrational = [] then some (.exact rational)
  else if irrational.any (fun g => factorLow num den bits g.1 = 0) then none
  else
    let unit : ℚ := 2 ^ bits
    let low := irrational.map fun g =>
      (g.2 * unit * unit / ((if 0 ≤ g.2 then factorHigh num den bits g.1 else factorLow num den bits g.1 : ℕ) : ℚ)).floor
    let high := irrational.map fun g =>
      (g.2 * unit * unit / ((if 0 ≤ g.2 then factorLow num den bits g.1 else factorHigh num den bits g.1 : ℕ) : ℚ)).ceil
    some (.bounds (low.sum + (rational * unit).floor) (high.sum + (rational * unit).ceil))

/-! ## The public functions -/

/-- `refine`'s bits: 64, 128, … 2,048 bits, the first that settles. -/
def refineBits {α : Type} (attempt : ℕ → Option α) : Option α :=
  [64, 128, 256, 512, 1024, 2048].findSome? attempt

/-- `xnpvBounds` at `1 + rate = num/den` for flows in minor units of a currency with exponent `e`:
`lower`, `upper` (major units) and `exact`. -/
def xnpvBounds (num den e digits : ℕ) (flows : List (ℕ × ℤ)) : Option (ℚ × ℚ × Bool) :=
  (dated flows).bind fun d => refineBits fun bits =>
    match scaled num den bits d with
    | none => none
    | some (.exact v) => some (v / 10 ^ e, v / 10 ^ e, true)
    | some (.bounds low high) =>
      if (high - low) * 10 ^ digits ≤ (2 ^ bits * 10 ^ e : ℤ) then
        some ((low : ℚ) / (2 ^ bits * 10 ^ e), (high : ℚ) / (2 ^ bits * 10 ^ e), false)
      else none

/-- A value in major units rounded to the exponent `e` with mode `m`, by the proved kernel. -/
def roundMajor (m : Mode) (v : ℚ) (e : ℕ) : Option ℤ :=
  (kernel m).eval [(v * 10 ^ e).num, ((v * 10 ^ e).den : ℤ)]

/-- `xnpv`: the value rounded once, once both ends of the bounds round alike. -/
def xnpv (m : Mode) (num den e : ℕ) (flows : List (ℕ × ℤ)) : Option ℤ :=
  (dated flows).bind fun d => refineBits fun bits =>
    match scaled num den bits d with
    | none => none
    | some (.exact v) => roundMajor m (v / 10 ^ e) e
    | some (.bounds low high) =>
      match roundMajor m ((low : ℚ) / (2 ^ bits * 10 ^ e)) e,
        roundMajor m ((high : ℚ) / (2 ^ bits * 10 ^ e)) e with
      | some a, some b => if a = b then some a else none
      | _, _ => none

def qsign (v : ℚ) : ℤ := if 0 < v then 1 else if v < 0 then -1 else 0

/-- `xnpvSign`: the sign once the bounds exclude 0; 2 if no precision settles it (the code throws). -/
def xnpvSign (num den : ℕ) (d : Dated) : ℤ :=
  (refineBits fun bits =>
    match scaled num den bits d with
    | none => none
    | some (.exact v) => some (qsign v)
    | some (.bounds low high) => if 0 < low then some 1 else if high < 0 then some (-1) else none).getD 2

/-- The number of sign changes and the first nonzero sign. -/
def signChanges (xs : List ℤ) : ℕ × ℤ :=
  let signs := (xs.filter (· ≠ 0)).map fun x => if 0 < x then (1 : ℤ) else -1
  (((signs.zip signs.tail).filter fun p => p.1 ≠ p.2).length, signs.headD 0)

/-- `xirr` without a bracket: the rate floored to `digits` places, as an integer count of
`10^−digits`; `none` where the code throws. The NPV's sign at a grid point `k` is taken at
`1 + rate = (10^digits + k) / 10^digits`, unreduced, as the code does. -/
def xirr (digits : ℕ) (flows : List (ℕ × ℤ)) : Option ℤ :=
  (dated flows).bind fun d =>
    if d.minors.all (· = 0) then none
    else if (signChanges d.minors).1 ≠ 1 then none
    else
      bisectRate (fun k => xnpvSign (10 ^ digits + k).toNat (10 ^ digits) d) (10 ^ digits)
        (signChanges d.minors).2

end Ducat.XnpvModel
