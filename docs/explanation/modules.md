# About modules and methods

ducat is one package with many entry points. The core (`@ducatjs/money`) holds construction, arithmetic, rounding, comparison and serialisation. Everything else is an opt-in module that adds methods to `Money` when it is imported. This page explains that design, what it costs, and the plain-function alternative in `@ducatjs/money/fn`. The entries are listed in the [reference](../reference/README.md). The practical steps are in [How to keep bundles small](../how-to/keep-bundles-small.md) and [How to add your own methods](../how-to/add-your-own-methods.md).

## Why methods

Free functions alone are awkward to use: `price.add(fee).multiply('1.075').split(3)` reads in the order things happen. The same operations as plain functions are in `@ducatjs/money/fn`, not in the root entry, so there is one way to write each in ordinary code. Operands are `Money` only, never bare numbers (monetra's `add(5)` means 5 minor units, a trap we avoid).

## Why opt-in modules

Methods on one class pull every feature into every bundle: a bundler can't drop a method nobody calls, because it can't know that. So `Money` carries only the core, and `@ducatjs/money/allocate`, `/tax`, `/format`… add their methods when imported (types through `declare module` augmentation, as dayjs plugins do). Correctness and features come before bundle size. The core keeps the currency table, the comparison methods, bigint support and exact string parsing. Everything else is an opt-in module, and size budgets in CI stop either from growing.

## What installing a method means

Importing a module (`import '@ducatjs/money/allocate'`, or any named import from it) installs its methods on `Money.prototype`, and its `declare module` augmentation makes them type-check. Without the import, `m.allocate()` is a compile error.

The trade-off: the methods are installed for the whole program, so one import anywhere makes them available everywhere at run time, while TypeScript only knows about them in a program that includes the import. Import a module in each file that uses its methods: the import is cheap and installing twice is harmless. It also keeps working where files run in isolation (test runners, workers), where a single import in the entry point would leave `m.allocate` undefined at run time even though the code type-checks.

Installed methods are global at run time, and that is the cost of this design. Two modules could fight over a name, so `extendMoney`, the function every module (and yours) installs through, refuses names Money already has (its own methods, or ones another module added) and the names every object inherits. A module passes an `owner` so that a second copy of the same module (hot reload, two installed copies) replaces its own methods instead of throwing.

## The plain functions: `/fn`

Code that must not change any prototype (a library built on ducat, for example) can use the plain functions from `@ducatjs/money/fn` instead. `/fn` offers the same functions without touching the prototype, for function-level tree-shaking: even the core methods are installed by the root entry rather than written into the class, so `/fn` programs carry only what they call. The core methods (`add`, `round`, `toDecimal`...) work the same way: the root entry `@ducatjs/money` installs them, so a program that imports only `/fn` has Money values without methods and keeps only the functions it calls.

## Currencies are registered by import, too

Currencies work the same way. Every entry except `/fn` registers the whole ISO 4217 table (`/fixed`, `/words` and `/territories` never build Money and don't need it). A program that imports only `/fn` registers what it uses with `import '@ducatjs/money/iso/EUR'` (one module per ISO code) or `import '@ducatjs/money/iso'` (all of them), and any other code throws "Unknown currency", naming the import.

Registration is by import, so it's the same bundled and unbundled. It's per module, not per program: a module that imports only `/fn` and builds Money while it loads (`const FEE = money('0.30', 'EUR')` in a config file) runs before the modules that import it, so it throws even when the app's entry point imports `@ducatjs/money`. Give such a module, and any library built on `/fn`, its own `import '@ducatjs/money/iso'` (or `/iso/EUR`).

The per-code modules are named by the uppercase ISO code: `/iso/eur` may resolve on a case-insensitive file system and then fail elsewhere. The types don't track registration: `/fn` accepts any ISO code at compile time. `defineCurrency` checks the ISO table so ISO codes can't be redefined, so a `/fn` program that calls it carries the table again: about 0.6 kB gzipped with `defineCurrency` itself.

The root entry always bundles the ISO table (about 0.55 KiB gzipped, 1 KiB minified). That is the price of `money('1', 'EUR')` working with no setup. A program written with `/fn` imports only the currencies it uses, like dinero.js's per-currency objects.

## Alternatives considered

- **Everything on the class.** The simplest design. It puts conversion, formatting, processors and finance into every bundle, which is the cost the opt-in modules avoid.
- **Functions only.** Smallest bundles, but chains read inside out (`multiply(add(price, fee), '1.075')`). ducat offers this through `/fn` for code that wants it, and keeps methods as the ordinary way.
- **A global configuration** (default currency, locale, rounding). Rejected for the same reason as global rounding policies (see [About rounding](rounding.md)): the same expression would behave differently depending on what ran earlier. An app that works in one currency binds the plain functions to it with a [currency context](../how-to/work-in-one-currency.md) instead.
