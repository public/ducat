# How to add your own methods to Money

This guide shows you how to add a method to `Money` from your own module, the way ducat's opt-in modules add theirs, so `m.half()` type-checks and runs.

## Declare the method and install it

1. Augment the `Money` interface with a `declare module '@ducatjs/money'` block, so TypeScript knows the method.
2. Install it with `extendMoney(methods, { owner })`.

```ts
import { extendMoney, money, type Money } from '@ducatjs/money';

declare module '@ducatjs/money' {
  interface Money<C extends string> {
    half(): Money<C>;
  }
}
extendMoney(
  {
    half(this: Money) {
      return this.divide(2);
    },
  },
  { owner: 'my-app/half' },
);
money('10', 'EUR').half(); // → 5.00 EUR
```

Pass `{ owner: 'your-package/module' }` so that a second copy of the same module (hot reload, two installed copies) replaces its own methods instead of throwing.

## Choose a name nobody else uses

`extendMoney` refuses names Money already has (its own methods, or ones another module added) and the names every object inherits, so two modules can't silently fight over a name. Prefix names in a library you publish.

## Import it where it's used

Like ducat's own modules, the method is installed for the whole program at run time, but TypeScript only knows about it in a program that includes the import. Import your module in each file that uses the method.

## If your code must not change any prototype

A library built on ducat can use the plain functions from `@ducatjs/money/fn` instead ([How to keep bundles small](keep-bundles-small.md)).

## Related

- Reference: [`extendMoney`](../reference/money.md)
- Explanation: [About modules and plugins](../explanation/modules.md)
