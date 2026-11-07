import Ducat.Rounding

/-! `lake env lean --run Gen.lean` prints the proved kernels as TypeScript; `pnpm gen:kernel` formats the output with
oxfmt and writes it to `src/generated/kernel.ts`.

All ten kernels share their parameters and `let`s (`kernel_shared`), so they print as one function: the shared
`let`s once, then a `switch` on the mode with each kernel's result as a case. -/

open Ducat

def header : String :=
  "// GENERATED from proofs/Ducat/Rounding.lean by `pnpm gen:kernel`. Do not edit.\n" ++
  "import { RoundingError } from '../rounding-error.js';\n" ++
  "import type { RoundingMode } from '../rounding.js';\n\n" ++
  "const ROUNDING_NECESSARY = 'Rounding necessary: the result is not exact; pass a rounding mode';\n\n"

def doc : String :=
  " * `dividend / divisor` rounded with `mode`; `divisor` must be positive.\n" ++
  " *\n" ++
  " * Each `case` is printed from the Lean kernel for that mode, which is proved correct in\n" ++
  " * proofs/Ducat/Rounding.lean: `kernel_sound` (the result satisfies the specification `Rounds`),\n" ++
  " * `rounds_unique` (only one value does) and `kernel_fails_iff` (it throws only for 'unnecessary' on an\n" ++
  " * inexact division), hence `kernel_correct`. Unknown modes throw a RangeError."

/-- Case order: the same as the number path's mode switch in src/rounding.ts, so gzip can share the two switches. -/
def caseOrder : List Mode :=
  [.halfExpand, .halfEven, .halfTrunc, .halfCeil, .halfFloor, .trunc, .expand, .ceil, .floor, .unnecessary]

def main : IO Unit := do
  IO.print header
  IO.print (switchToTS "divideAndRoundBigint" doc ["dividend", "divisor"] "mode" "RoundingMode" sharedLets
    (caseOrder.map fun m => (m.tsName, s!"rounds {m.describe}", kernelRet m))
    "throw new RangeError(`Unknown rounding mode \"${String(mode)}\"`);")
