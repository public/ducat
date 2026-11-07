/-!
# A tiny integer kernel language, its semantics, and its TypeScript printer

The verified kernels of ducat are written as values of `Prog`. The theorems in `Ducat/Rounding.lean`
are about `Prog.eval`, and `Gen.lean` prints the very same values as TypeScript with `switchToTS`, so
the shipped code is the proved code up to this printer and JS `bigint` semantics:

* `+ - *` on `bigint` are exact, like `Int`.
* `a / b` on `bigint` truncates towards zero: `Int.tdiv`; `a % b` takes the sign of `a`: `Int.tmod`. Kernels divide only by a divisor the caller
  guarantees positive, so JS's `RangeError` on division by zero cannot arise.
* `fail` prints as `throw new RoundingError(…)`; in the semantics it is `none`.
* A conditional in result position prints as `if (…) { return …; }`; JS evaluates only the branch
  taken, like `E.eval`. `&&` and `||` short-circuit in JS but not in `B.eval`; that can only differ
  when the skipped operand would fail, and no kernel puts `fail` inside a condition.

The printer is the trusted part (about 60 lines below). It is exercised by `test/kernel.test.ts`,
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
    | tmod : E → E → E
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
    | .tmod a b => do return Int.tmod (← a.eval env) (← b.eval env)
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

/-- Integer literals: `7n` for `bigint`, `7` for `number`. -/
def intLit (big : Bool) (n : Int) : String :=
  let sfx := if big then "n" else ""
  if n < 0 then s!"(-{n.natAbs}{sfx})" else s!"{n}{sfx}"

/-! The printer has two flavours. `big = true` prints for `bigint`, where `/` truncates like `Int.tdiv`
and `%` is `Int.tmod`. `big = false` prints the same terms for `number`, where `%` on integers is also
`Int.tmod` and truncated division is `Math.trunc(a / b)`. The `number` flavour is exact only while every
intermediate value is a safe integer; that is the caller's obligation, and it is tested, not proved. -/

mutual
  def E.toTS (big : Bool) (names : Array String) : E → String
    | .lit n => intLit big n
    | .var i => names.getD i s!"v{i}"
    | .add a b => s!"({a.toTS big names} + {b.toTS big names})"
    | .sub a b => s!"({a.toTS big names} - {b.toTS big names})"
    | .mul a b => s!"({a.toTS big names} * {b.toTS big names})"
    | .tdiv a b =>
      if big then s!"({a.toTS big names} / {b.toTS big names})"
      else s!"Math.trunc({a.toTS big names} / {b.toTS big names})"
    | .tmod a b => s!"({a.toTS big names} % {b.toTS big names})"
    | .neg a => s!"(-{a.toTS big names})"
    | .ite c t e => s!"({c.toTS big names} ? {t.toTS big names} : {e.toTS big names})"
    | .fail => "(() => { throw new RoundingError(ROUNDING_NECESSARY); })()"

  def B.toTS (big : Bool) (names : Array String) : B → String
    | .lt a b => s!"({a.toTS big names} < {b.toTS big names})"
    | .le a b => s!"({a.toTS big names} <= {b.toTS big names})"
    | .eq a b => s!"({a.toTS big names} === {b.toTS big names})"
    | .not (.eq a b) => s!"({a.toTS big names} !== {b.toTS big names})"
    | .not a => s!"!{a.toTS big names}"
    | .and a b => s!"({a.toTS big names} && {b.toTS big names})"
    | .or a b => s!"({a.toTS big names} || {b.toTS big names})"
end

/-- The result expression as statements: a conditional becomes `if (…) { return …; }` followed by the
other branch, so the output has no nested ternaries. -/
def E.toReturn (big : Bool) (names : Array String) (indent : String) : E → String
  | .ite c t e =>
    s!"{indent}if ({c.toTS big names}) \{\n{t.toReturn big names (indent ++ "  ")}{indent}}\n" ++
      e.toReturn big names indent
  | .fail => s!"{indent}throw new RoundingError(ROUNDING_NECESSARY);\n"
  | e => s!"{indent}return {e.toTS big names};\n"

/-- The `const` lines for `lets`, and the variable names in scope after them. -/
def letsToTS (big : Bool) (params : List String) (lets : List (String × E)) : String × Array String := Id.run do
  let mut names : Array String := params.toArray
  let mut body := ""
  for (n, e) in lets do
    body := body ++ s!"  const {n} = {e.toTS big names};\n"
    names := names.push n
  return (body, names)

/-- Several kernels with the same parameters and `let`s as one function: the shared `let`s, then a
`switch` on `selector` whose case `key` is the result of the kernel for that key. Any other key throws.
If every kernel's result is `ite c t rest`, pass `first := some (c, t)` and the `rest`s as the cases:
`if (c) return t;` is printed once, before the `let`s and the switch (`c` and `t` may only use the
parameters).
The `let`s may be split: those listed in `params` beyond the kernel's own are computed by the caller
(see `Gen.lean`), which prints them with the same `letsToTS`. -/
def switchToTS (big : Bool) (exported : Bool) (name doc : String) (params : List String)
    (selector selectorType : String) (lets : List (String × E)) (first : Option (B × E))
    (cases : List (String × String × E)) (otherwise : String) : String :=
  let type := if big then "bigint" else "number"
  let (lines, names) := letsToTS big params lets
  -- a first branch shared by every case is printed once, before the switch
  let shared := match first with
    | some (c, t) => s!"  if ({c.toTS big names}) \{\n    return {t.toTS big names};\n  }\n"
    | none => ""
  -- the `let`s are pure, so the shared branch may come first; it then skips them on exact divisions
  let body := shared ++ lines
  let sig := ", ".intercalate (params.map (· ++ s!": {type}") ++ [s!"{selector}: {selectorType}"])
  let arms := cases.map fun (key, comment, ret) =>
    s!"    // {comment}\n    case '{key}': \{\n{ret.toReturn big names "      "}    }\n"
  let exportKeyword := if exported then "export " else ""
  s!"/**\n{doc}\n */\n{exportKeyword}function {name}({sig}): {type} \{\n{body}\n  switch ({selector}) \{\n" ++
    String.join arms ++ s!"  }\n  {otherwise}\n}\n"

end Ducat
