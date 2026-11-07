/-!
# A tiny integer kernel language, its semantics, and its TypeScript printer

The verified kernels of ducat are written as values of `Prog`. The theorems in `Ducat/Rounding.lean`
are about `Prog.eval`, and `Gen.lean` prints the very same values as TypeScript with `Prog.toTS`, so
the shipped code is the proved code up to this printer and JS `bigint` semantics:

* `+ - *` on `bigint` are exact, like `Int`.
* `a / b` on `bigint` truncates towards zero: `Int.tdiv`. Kernels divide only by a divisor the caller
  guarantees positive, so JS's `RangeError` on division by zero cannot arise.
* `fail` prints as `throw new RoundingError(…)`; in the semantics it is `none`.
* A conditional in result position prints as `if (…) { return …; }`; JS evaluates only the branch
  taken, like `E.eval`. `&&` and `||` short-circuit in JS but not in `B.eval`; that can only differ
  when the skipped operand would fail, and no kernel puts `fail` inside a condition.

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
    | .fail => "(() => { throw new RoundingError(ROUNDING_NECESSARY); })()"

  def B.toTS (names : Array String) : B → String
    | .lt a b => s!"({a.toTS names} < {b.toTS names})"
    | .le a b => s!"({a.toTS names} <= {b.toTS names})"
    | .eq a b => s!"({a.toTS names} === {b.toTS names})"
    | .not a => s!"!{a.toTS names}"
    | .and a b => s!"({a.toTS names} && {b.toTS names})"
    | .or a b => s!"({a.toTS names} || {b.toTS names})"
end

/-- The result expression as statements: a conditional becomes `if (…) { return …; }` followed by the
other branch, so the output has no nested ternaries. -/
def E.toReturn (names : Array String) (indent : String) : E → String
  | .ite c t e =>
    s!"{indent}if ({c.toTS names}) \{\n{t.toReturn names (indent ++ "  ")}{indent}}\n" ++ e.toReturn names indent
  | .fail => s!"{indent}throw new RoundingError(ROUNDING_NECESSARY);\n"
  | e => s!"{indent}return {e.toTS names};\n"

/-- The `const` lines for `lets`, and the variable names in scope after them. -/
def letsToTS (params : List String) (lets : List (String × E)) : String × Array String := Id.run do
  let mut names : Array String := params.toArray
  let mut body := ""
  for (n, e) in lets do
    body := body ++ s!"  const {n} = {e.toTS names};\n"
    names := names.push n
  return (body, names)

def Prog.toTS (p : Prog) : String :=
  let (body, names) := letsToTS p.params p.lets
  let sig := ", ".intercalate (p.params.map (· ++ ": bigint"))
  s!"/** {p.doc} */\nexport function {p.name}({sig}): bigint \{\n{body}\n{p.ret.toReturn names "  "}}\n"

/-- Several kernels with the same parameters and `let`s as one function: the shared `let`s, then a
`switch` on `selector` whose case `key` is the result of the kernel for that key. Any other key throws. -/
def switchToTS (name doc : String) (params : List String) (selector selectorType : String)
    (lets : List (String × E)) (cases : List (String × String × E)) (otherwise : String) : String :=
  let (body, names) := letsToTS params lets
  let sig := ", ".intercalate (params.map (· ++ ": bigint") ++ [s!"{selector}: {selectorType}"])
  let arms := cases.map fun (key, comment, ret) =>
    s!"    // {comment}\n    case '{key}': \{\n{ret.toReturn names "      "}    }\n"
  s!"/**\n{doc}\n */\nexport function {name}({sig}): bigint \{\n{body}\n  switch ({selector}) \{\n" ++
    String.join arms ++ s!"  }\n  {otherwise}\n}\n"

end Ducat
