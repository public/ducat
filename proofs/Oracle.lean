import Ducat.Allocate
import Ducat.Schedule
import Ducat.Cash

/-! `lake env lean --run Oracle.lean <model>` evaluates a proved model on generated cases; `pnpm gen:kernel` writes
`test/fixtures/<model>.oracle.json`, and `test/*.oracle.test.ts` check the TypeScript against them. Models:
`allocate` (`Ducat/Allocate.lean`), `instalments`, `chunk`, `schedule` (`Ducat/Schedule.lean`) and `increment`
(`Ducat/Cash.lean`). -/

open Ducat.Alloc

def Ducat.Alloc.Remainder.tsName : Remainder → String
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
  let mut s : Nat := lcg (k + 1)
  let n : Nat := s / 2 ^ 40 % 7 + 1
  let mut ws : List Int := []
  for _ in [0:n] do
    s := lcg s
    let r : Nat := s / 2 ^ 33
    let w : Nat := match r % 4 with
      | 0 => 0
      | 1 => r / 4 % 4
      | 2 => r / 4 % 1000
      | _ => r / 4 % 2 ^ 20
    ws := ws ++ [Int.ofNat w]
  if ws.all (· == 0) then ws := ws.set 0 1
  s := lcg s
  let r : Nat := s / 2 ^ 20
  let mag : Nat := match r % 4 with
    | 0 => r / 4 % 200
    | 1 => r / 4 % 100000
    | 2 => 2 ^ 53 - 1 - r / 4 % 1000
    | _ => 10 ^ 25 + r / 4
  let x : Int := if (s / 2 ^ 19) % 2 == 0 then Int.ofNat mag else -Int.ofNat mag
  return (x, ws)

def allocateCases : IO Unit := do
  IO.println "["
  let cases := List.range 1500
  for k in cases do
    let (x, ws) := gen k
    let outs := strategies.map fun s => s!"\"{s.tsName}\":{jsonInts (run x ws s)}"
    let sep := if k + 1 == cases.length then "" else ","
    IO.println s!"\{\"amount\":\"{x}\",\"weights\":{jsonInts ws},{",".intercalate outs}}{sep}"
  IO.println "]"

/-! ## Instalments, chunks, schedules, increments -/

open Ducat.Sched

def Ducat.Sched.InstMode.tsName : InstMode → String
  | .first => "first" | .last => "last" | .toFirst => "toFirst" | .toLast => "toLast"

def jsonOpt (o : Option (List Int)) : String := match o with | some xs => jsonInts xs | none => "null"

/-- `count` instalments of `t` with `unit`; negative totals mirror the positive ones. -/
def runInst (s : InstMode) (t u : Int) (c : Nat) : List Int :=
  let parts := (List.finRange c).map (inst s (t.natAbs : Int) u c)
  if t < 0 then parts.map (- ·) else parts

/-- A number in `[0, bound)` from the state, and the next state. -/
def draw (st : Nat) (bound : Nat) : Nat × Nat := let n := lcg st; (n / 2 ^ 20 % bound, n)

/-- Magnitudes for case `k`: one in three small, one near 2^53 (either side), one around 10^20, so both the
number and the bigint paths of the TypeScript are compared. -/
def magnitude (k small : Nat) (st : Nat) : Nat × Nat :=
  let (v, st) := draw st small
  match k % 3 with
  | 0 => (v, st)
  | 1 => (2 ^ 53 - 500 + v % 1000, st)
  | _ => (10 ^ 20 + v, st)

def instalmentCases : IO Unit := do
  IO.println "["
  let n := 1200
  for k in [0:n] do
    let (c, st) := draw (k + 7) 12
    let (u, st) := draw st 1000
    let (mag, st) := magnitude k 10000000 st
    let (sign, _) := draw st 4
    let t : Int := if sign == 0 then -Int.ofNat mag else Int.ofNat mag
    let modes := [InstMode.first, .last, .toFirst, .toLast]
    let outs := modes.map fun s => s!"\"{s.tsName}\":{jsonInts (runInst s t (Int.ofNat (u + 1)) (c + 1))}"
    let sep := if k + 1 == n then "" else ","
    IO.println s!"\{\"total\":\"{t}\",\"count\":{c + 1},\"unit\":\"{u + 1}\",{",".intercalate outs}}{sep}"
  IO.println "]"

def chunkCases : IO Unit := do
  IO.println "["
  let n := 1200
  for k in [0:n] do
    let (m0, st) := draw (k + 11) 5000
    -- large maxima (10^15 and up) push the totals past 2^53, so the bigint path is compared too
    let m := if k % 3 == 2 then 10 ^ 15 + m0 else m0
    -- total = count * max + part, with count ≤ 40: every branch of `chunk`, without a megabyte of fixture
    let (count, st) := draw st 41
    let (part, _) := draw st (m + 1)
    let t := count * m + part
    let tt : Int := if k % 10 == 0 then 0 else Int.ofNat t
    let sep := if k + 1 == n then "" else ","
    IO.println s!"\{\"total\":\"{tt}\",\"max\":\"{m + 1}\",\"chunks\":{jsonInts (chunk tt (Int.ofNat (m + 1)))}}{sep}"
  IO.println "]"

/-- A tranche as JSON for the test: percentages are printed with one decimal (tenths of a percent). -/
def trancheJson : Tranche → String
  | .amount a => s!"\{\"amount\":\"{a}\"}"
  | .pct w none => s!"\{\"percent\":\"{w / 10}.{w % 10}\"}"
  | .pct w (some c) => s!"\{\"percent\":\"{w / 10}.{w % 10}\",\"cap\":\"{c}\"}"
  | .rest => "{\"rest\":true}"

def scheduleCases : IO Unit := do
  IO.println "["
  let n := 1500
  for k in [0:n] do
    let (len, st0) := draw (k + 13) 5
    let (mag, st0) := magnitude k 1000000 st0
    let t : Int := Int.ofNat mag
    let mut st := st0
    let mut ts : List Tranche := []
    let mut rests := 0
    for _ in [0:len + 1] do
      let (kind, st1) := draw st 10
      let (v, st2) := draw st1 400
      let (capKind, st3) := draw st2 3
      let (capV, st4) := draw st3 300000
      st := st4
      if kind < 4 then
        ts := ts ++ [.pct (Int.ofNat v) (if capKind == 0 then some (Int.ofNat capV) else none)]
      else if kind < 7 then
        ts := ts ++ [.amount (Int.ofNat (capV % 200000))]
      else if kind < 9 || rests == 0 then
        if rests < 2 then
          ts := ts ++ [.rest]
          rests := rests + 1
    let result := schedule t 1000 ts
    let sep := if k + 1 == n then "" else ","
    IO.println s!"\{\"total\":\"{t}\",\"tranches\":[{",".intercalate (ts.map trancheJson)}],\"result\":{jsonOpt result}}{sep}"
  IO.println "]"

/-- `roundToIncrement` for every mode: `null` where the kernel fails (`unnecessary`, inexact). -/
def incrementCases : IO Unit := do
  IO.println "["
  let n := 1500
  for k in [0:n] do
    let (stepIx, st) := draw (k + 17) 8
    let (mag, st) := magnitude k 100000000 st
    let (sign, _) := draw st 2
    let step : Int := [1, 2, 5, 10, 25, 50, 100, 500][stepIx]!
    let x : Int := if sign == 0 then -Int.ofNat mag else Int.ofNat mag
    let outs := Ducat.Mode.all.map fun m =>
      let r := match (Ducat.kernel m).eval [x, step] with
        | some q => s!"\"{q * step}\""
        | none => "null"
      s!"\"{m.tsName}\":{r}"
    let sep := if k + 1 == n then "" else ","
    IO.println s!"\{\"amount\":\"{x}\",\"step\":\"{step}\",{",".intercalate outs}}{sep}"
  IO.println "]"

def models : List (String × IO Unit) :=
  [("allocate", allocateCases), ("instalments", instalmentCases), ("chunk", chunkCases),
    ("schedule", scheduleCases), ("increment", incrementCases)]

/-- `Oracle.lean <dir>` writes `<dir>/<model>.json` for every model in one run, so Mathlib is loaded once;
`Oracle.lean <model>` prints one model to stdout. -/
def main (args : List String) : IO UInt32 := do
  match args with
  | [arg] =>
    match models.lookup arg with
    | some run => run; return 0
    | none =>
      for (name, run) in models do
        let handle ← IO.FS.Handle.mk s!"{arg}/{name}.json" .write
        let previous ← IO.setStdout (IO.FS.Stream.ofHandle handle)
        run
        let _ ← IO.setStdout previous
        handle.flush
      return 0
  | _ => IO.eprintln "usage: Oracle.lean <model> | <output dir>"; return 2
