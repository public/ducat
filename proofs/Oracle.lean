import Ducat.Allocate

/-! `lake exe oracle > ../test/fixtures/allocate.oracle.json`: evaluates the proved allocation model
(`Ducat/Allocate.lean`) on generated cases. `test/allocate.oracle.test.ts` checks the TypeScript against it. -/

open Ducat.Alloc

def Remainder.tsName : Remainder → String
  | .largest => "largest" | .first => "first" | .last => "last" | .toFirst => "toFirst" | .toLast => "toLast"

def strategies : List Remainder := [.largest, .first, .last, .toFirst, .toLast]

/-- A small deterministic generator (64-bit LCG), so the fixture is reproducible. -/
def lcg (s : Nat) : Nat := (s * 6364136223846793005 + 1442695040888963407) % 2 ^ 64

def run (x : Int) (ws : List Int) (s : Remainder) : List Int :=
  let w : Fin ws.length → Int := fun i => ws[i]
  (List.finRange ws.length).map (allocS s x w)

def jsonInts (xs : List Int) : String := "[" ++ ",".intercalate (xs.map fun v => s!"\"{v}\"") ++ "]"

/-- Case `k`: up to 7 buckets, weights mostly small with zeros, amounts small, near the safe-integer
limit or beyond 2^64. -/
def gen (k : Nat) : Int × List Int := Id.run do
  let mut s := lcg (k + 1)
  let n := s / 2 ^ 40 % 7 + 1
  let mut ws : List Int := []
  for _ in [0:n] do
    s := lcg s
    let r := s / 2 ^ 33
    let w : Int := match r % 4 with
      | 0 => 0
      | 1 => r / 4 % 4
      | 2 => r / 4 % 1000
      | _ => r / 4 % 2 ^ 20
    ws := ws ++ [w]
  if ws.all (· == 0) then ws := ws.set 0 1
  s := lcg s
  let r := s / 2 ^ 20
  let mag : Int := match r % 4 with
    | 0 => r / 4 % 200
    | 1 => r / 4 % 100000
    | 2 => 2 ^ 53 - 1 - (r / 4 % 1000 : Nat)
    | _ => 10 ^ 25 + (r / 4 : Nat)
  let x := if (s / 2 ^ 19) % 2 == 0 then mag else -mag
  return (x, ws)

def main : IO Unit := do
  IO.println "["
  let cases := List.range 1500
  for k in cases do
    let (x, ws) := gen k
    let outs := strategies.map fun s => s!"\"{s.tsName}\":{jsonInts (run x ws s)}"
    let sep := if k + 1 == cases.length then "" else ","
    IO.println s!"\{\"x\":\"{x}\",\"w\":{jsonInts ws},{",".intercalate outs}}{sep}"
  IO.println "]"
