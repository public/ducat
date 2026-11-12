# `@ducatjs/money/fn` and `@ducatjs/money/iso`

`@ducatjs/money/fn` has every operation of ducat and its opt-in modules as a plain function of the same name: `add(price, fee)`, `allocate(total, [1, 1, 1])`. **Installs:** nothing. It changes no prototype and **registers no currencies**. `@ducatjs/money/iso` and `@ducatjs/money/iso/<CODE>` register currencies and export nothing.

Related: [How to keep bundles small](../how-to/keep-bundles-small.md) · [About modules](../explanation/modules.md)

## `@ducatjs/money/fn`

- Exports everything the root entry exports ([money.md](money.md)), plus each core method as a function: `add`, `subtract`, `negate`, `abs`, `multiply`, `divide`, `round`, `toScale`, `compare`, `equals`, `identical`, `lessThan`, `lessThanOrEqual`, `greaterThan`, `greaterThanOrEqual`, `isZero`, `isPositive`, `isNegative`, `sign`, `min`, `max`, `clamp`, `majorPart`, `minorPart`, `hasFraction`, `toDecimal`, `toMinor`, `toMinorNumber`, `toNumber` and `toScaledUnits`. Their signatures are on [money.md](money.md).
- Exports every name of these entries, with the signatures their pages give: [`/policy`](policy.md) (`roundingPolicy`, `isoPolicy`, `assertScale`), [`/allocate`](allocate.md), [`/tax`](tax.md), [`/pricing`](pricing.md), [`/math`](math.md), [`/convert`](convert.md), [`/exact`](exact.md), the rate parsers and settlement rates ([rate-sources.md](rate-sources.md): `/convert/ecb`, `/convert/history`, `/convert/boc`, `/convert/fed`, `/convert/boe`, `/convert/hmrc`, `/stripe-fx`, `/adyen-fx`), [`/cash`](cash.md), the currency data ([currencies.md](currencies.md): `/historic`, `/crypto`, `/currencies`, `/territories`), [`/wire`](wire.md), [`/context`](context.md), [`/words` and every language](words.md), [`/finance`](finance.md), [`/format`](format.md), [`/parse`](parse.md), the six processors ([processors.md](processors.md)), [`/prisma`](prisma.md), [`/fixed`](fixed.md) and `/fixed/money`.
- It doesn't export the network fetchers (`/convert/fetch`), the database and schema integrations (`/drizzle/*`, `/kysely`, `/typeorm`, `/pg`, `/zod`, `/valibot`) or the testing entries: import those from their own entries.
- Money values built by a program that imports only `/fn` have no methods (`m.add` is undefined). Importing any other entry installs the core methods, wherever it is imported.

## `@ducatjs/money/iso`

Registers every ISO 4217 currency in `ISO_EXPONENTS`. Every entry except `/fn` already does (`/fixed`, `/words` and `/territories` never build Money and don't need it), so it matters only to programs that import `/fn` alone.

## `@ducatjs/money/iso/<CODE>`

Registers one ISO 4217 currency, one module per code: `import '@ducatjs/money/iso/EUR'`. The path is the uppercase ISO code; `/iso/eur` may resolve on a case-insensitive file system and then fail elsewhere.

## Registration rules

- Registration is by import, so it is the same bundled and unbundled. It is per module, not per program: a module that imports only `/fn` and builds Money while it loads runs before the modules that import it, so it needs its own `import '@ducatjs/money/iso'` (or `/iso/EUR`).
- Without registration, every function that looks a currency up (`money`, `fromMinor`, `currencyExponent`…) throws a `RangeError`: "Unknown currency", naming the import.
- The types don't track registration: `/fn` accepts any ISO code at compile time.
- `defineCurrency` checks the ISO table so that ISO codes can't be redefined, so a `/fn` program that calls it carries the table: about 0.6 kB gzipped with `defineCurrency` itself.
