import Ducat.Rounding

/-! `lake env lean --run Gen.lean` prints the proved kernels as TypeScript; `pnpm gen:kernel` formats the output with
oxfmt and writes it to `src/generated/kernel.ts`.

All ten kernels share their parameters and `let`s (`kernel_shared`), so they print as one function: the shared
`let`s, then a `switch` on the mode with each kernel's result as a case. The function is split in two: the first two
`let`s (quotient and remainder), then a call to the switch, which takes them as parameters. That is the same program
with the second part named.

The switch is printed twice: for `bigint`, the proved code, and for `number`, the same terms over doubles. The number
path in src/rounding.ts computes an exact quotient and remainder itself, then calls the `number` copy; the two copies
differ only in their literals, so gzip stores the second almost for free. -/

open Ducat

def header : String :=
  "// GENERATED from proofs/Ducat/Rounding.lean by `pnpm gen:kernel`. Do not edit.\n" ++
  "import { RoundingError } from '../rounding-error.js';\n" ++
  "import type { RoundingMode } from '../rounding.js';\n\n" ++
  "const ROUNDING_NECESSARY = 'Rounding necessary: the result is not exact; pass a rounding mode';\n\n"

def theorems : String :=
  " * Each `case` is printed from the Lean kernel for that mode, which is proved correct in\n" ++
  " * proofs/Ducat/Rounding.lean: `kernel_sound` (the result satisfies the specification `Rounds`),\n" ++
  " * `rounds_unique` (only one value does) and `kernel_fails_iff` (it throws only for 'unnecessary' on an\n" ++
  " * inexact division), hence `kernel_correct`. Unknown modes throw a RangeError."

/-- Case order: the order the modes were listed in before the kernels were generated. -/
def caseOrder : List Mode :=
  [.halfExpand, .halfEven, .halfTrunc, .halfCeil, .halfFloor, .trunc, .expand, .ceil, .floor, .unnecessary]

def unknownMode : String := "throw new RangeError(`Unknown rounding mode \"${String(mode)}\"`);"

def cases : List (String × String × E) := caseOrder.map fun m => (m.tsName, s!"rounds {m.describe}", kernelRet m)

/-- The parameters of the switch: the kernel's own two, then the two `let`s the caller computes. -/
def switchParams : List String := ["dividend", "divisor"] ++ (sharedLets.take 2).map (·.1)

def roundBigint : String :=
  switchToTS true false "roundTruncatedQuotientBigint"
    (" * Rounds the truncated `quotient` of `dividend / divisor` (with `remainder = dividend - quotient * divisor`)\n" ++
     " * with `mode`; `divisor` must be positive.\n *\n" ++ theorems)
    switchParams "mode" "RoundingMode" (sharedLets.drop 2) cases unknownMode

def roundNumber : String :=
  switchToTS false true "roundTruncatedQuotient"
    (" * The same switch over `number`: rounds the truncated `quotient` of `dividend / divisor`, where\n" ++
     " * `remainder = dividend - quotient * divisor` exactly and `divisor` is positive. Every input must be a safe\n" ++
     " * integer. This copy is not proved; test/kernel.test.ts compares it with the `bigint` one.")
    switchParams "mode" "RoundingMode" (sharedLets.drop 2) cases unknownMode

def divideBigint : String :=
  let (body, _) := letsToTS true ["dividend", "divisor"] (sharedLets.take 2)
  "/**\n * `dividend / divisor` rounded with `mode`; `divisor` must be positive.\n *\n" ++ theorems ++ "\n */\n" ++
  "export function divideAndRoundBigint(dividend: bigint, divisor: bigint, mode: RoundingMode): bigint {\n" ++
  body ++ s!"  return roundTruncatedQuotientBigint({", ".intercalate switchParams}, mode);\n}\n"

def main : IO Unit := do
  IO.print header
  IO.println divideBigint
  IO.println roundBigint
  IO.print roundNumber
