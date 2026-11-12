# How to keep bundles small

This guide shows you how to make a bundle carry only the operations and currencies it uses: with opt-in modules, and with the plain functions of `@ducatjs/money/fn` plus the per-currency `/iso` modules.

## Import only the modules you use

The core (`@ducatjs/money`) holds construction, arithmetic, rounding, comparison and serialisation; everything else is an opt-in module, so a bundle only pays for what it imports. Import a module in each file that uses its methods (`import '@ducatjs/money/allocate'`): the import is cheap and installing twice is harmless. It also keeps working where files run in isolation (test runners, workers), where a single import in the entry point would leave `m.allocate` undefined at run time even though the code type-checks. If you want every method of every module except the integrations that need optional peers, import `@ducatjs/money/all` instead.

## Use plain functions with `/fn`

For the smallest bundles, import each operation as a function of the same name from `@ducatjs/money/fn` (`add(price, fee)`, `allocate(m, [1, 1, 1])`): a bundle keeps only the functions it imports, and a program that only creates, adds and prints amounts is about 1.3 KiB gzipped. `/fn` installs no methods, so its Money values have none, and it registers no currencies.

1. Import the functions you call from `@ducatjs/money/fn`.
2. Import the currencies you use: `import '@ducatjs/money/iso/EUR'` (one module per ISO code), or `@ducatjs/money/iso` for all of them. Name the module by the uppercase code: `/iso/eur` may resolve on a case-insensitive file system and then fail elsewhere.

<!-- doctest: skip (a /fn-only program: the doctest process has already loaded the root entry) -->

```ts
import { add, money, toDecimal } from '@ducatjs/money/fn';
import '@ducatjs/money/iso/EUR';

toDecimal(add(money('19.99', 'EUR'), money('5.01', 'EUR'))); // '25.00'
```

Without the currency import, the code throws "Unknown currency", naming the import. The types don't track registration: `/fn` accepts any ISO code at compile time.

## Register currencies in every module that builds Money while it loads

Registration is per module, not per program. If a module that imports only `/fn` builds Money while it loads (`const FEE = money('0.30', 'EUR')` in a config file), it runs before the modules that import it, so it throws even when the app's entry point imports `@ducatjs/money`. Give such a module, and any library built on `/fn`, its own `import '@ducatjs/money/iso'` (or `/iso/EUR`).

## If you call `defineCurrency` from `/fn`

`defineCurrency` checks the ISO table so ISO codes can't be redefined, so a `/fn` program that calls it carries the table again: about 0.6 kB gzipped with `defineCurrency` itself.

## Check the sizes

`pnpm size` in the ducat repository checks every entry point and snippet against `scripts/size-budgets.json`; the current numbers are in [How ducat is tested](../explanation/how-ducat-is-tested.md).

## Related

- Reference: [`@ducatjs/money/fn` and `/iso`](../reference/fn.md), [`@ducatjs/money/all`](../reference/all.md)
- Explanation: [About modules and plugins](../explanation/modules.md)
