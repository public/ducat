/-!
# A tiny integer kernel language, its semantics, and its TypeScript printer

The verified kernels of ducat are written as values of `Prog`. The theorems in `Ducat/Rounding.lean`
are about `Prog.eval`, and `Gen.lean` prints the very same values as TypeScript with `Prog.toTS`, so
the shipped code is the proved code up to this printer and JS `bigint` semantics:

* `+ - *` on `bigint` are exact, like `Int`.
* `a / b` on `bigint` truncates towards zero: `Int.tdiv`. Kernels divide only by a divisor the caller
  guarantees positive, so JS's `RangeError` on division by zero cannot arise.
* `fail` prints as a call to `fail()`, which throws; in the semantics it is `none`.

The printer is the trusted part (about 40 lines below). It is exercised by `test/kernel.test.ts`,
which compares the generated code against an independent TypeScript oracle.
-/

namespace Ducat

mutual
  /-- Integer expressions. Variables are positional: 0 = first argument, then later `let`s. -/
  inductive E where
    | lit : Int → E
    | var : Nat → E
    | add : E → E → E
    | sub : E → E → E
    | mul : E → E → E
    | tdiv : E → E → E
    | neg : E → E
    | ite : B → E → E → E
    | fail : E

  /-- Boolean conditions. -/
  inductive B where
    | lt : E → E → B
    | le : E → E → B
    | eq : E → E → B
    | not : B → B
    | and : B → B → B
    | or : B → B → B
end

mutual
  def E.eval (env : List Int) : E → Option Int
    | .lit n => some n
    | .var i => env[i]?
    | .add a b => do return (← a.eval env) + (← b.eval env)
    | .sub a b => do return (← a.eval env) - (← b.eval env)
    | .mul a b => do return (← a.eval env) * (← b.eval env)
    | .tdiv a b => do return Int.tdiv (← a.eval env) (← b.eval env)
    | .neg a => do return -(← a.eval env)
    | .ite c t e => do if (← c.eval env) then t.eval env else e.eval env
    | .fail => none

  def B.eval (env : List Int) : B → Option Bool
    | .lt a b => do return decide ((← a.eval env) < (← b.eval env))
    | .le a b => do return decide ((← a.eval env) ≤ (← b.eval env))
    | .eq a b => do return decide ((← a.eval env) = (← b.eval env))
    | .not a => do return !(← a.eval env)
    | .and a b => do return (← a.eval env) && (← b.eval env)
    | .or a b => do return (← a.eval env) || (← b.eval env)
end

/-- A kernel: named parameters, a sequence of `const` bindings, and a result. -/
structure Prog where
  name : String
  doc : String
  params : List String
  lets : List (String × E)
  ret : E

/-- Evaluate the `let`s left to right, each one appended to the environment. -/
def evalLets (env : List Int) : List (String × E) → Option (List Int)
  | [] => some env
  | (_, e) :: rest => do evalLets (env ++ [← e.eval env]) rest

def Prog.eval (p : Prog) (args : List Int) : Option Int :=
  (evalLets args p.lets).bind p.ret.eval

/-! ## Printer -/

def intLit (n : Int) : String := if n < 0 then s!"(-{n.natAbs}n)" else s!"{n}n"

mutual
  def E.toTS (names : Array String) : E → String
    | .lit n => intLit n
    | .var i => names.getD i s!"v{i}"
    | .add a b => s!"({a.toTS names} + {b.toTS names})"
    | .sub a b => s!"({a.toTS names} - {b.toTS names})"
    | .mul a b => s!"({a.toTS names} * {b.toTS names})"
    | .tdiv a b => s!"({a.toTS names} / {b.toTS names})"
    | .neg a => s!"(-{a.toTS names})"
    | .ite c t e => s!"({c.toTS names} ? {t.toTS names} : {e.toTS names})"
    | .fail => "fail()"

  def B.toTS (names : Array String) : B → String
    | .lt a b => s!"({a.toTS names} < {b.toTS names})"
    | .le a b => s!"({a.toTS names} <= {b.toTS names})"
    | .eq a b => s!"({a.toTS names} === {b.toTS names})"
    | .not a => s!"!{a.toTS names}"
    | .and a b => s!"({a.toTS names} && {b.toTS names})"
    | .or a b => s!"({a.toTS names} || {b.toTS names})"
end

def Prog.toTS (p : Prog) : String := Id.run do
  let mut names : Array String := p.params.toArray
  let mut body := ""
  for (n, e) in p.lets do
    body := body ++ s!"  const {n} = {e.toTS names};\n"
    names := names.push n
  let sig := ", ".intercalate (p.params.map (· ++ ": bigint"))
  return s!"/** {p.doc} */\nexport function {p.name}({sig}): bigint \{\n{body}  return {p.ret.toTS names};\n}\n"

end Ducat
