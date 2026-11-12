# How to store money with Prisma

This guide shows you how to read and write Money through a Prisma client extension, with either a BIGINT minor-units column and a currency column, or a Decimal column. It assumes you have chosen a column layout ([How to store money in a database](store-money-in-a-database.md)).

## Add the result fields and write the columns

Import the helpers from `@ducatjs/money/prisma`, then extend the client so reads return Money. This is from `examples/prisma`, which runs end to end against SQLite:

<!-- doctest: skip (needs a database; examples/prisma runs it) -->

```ts
const db = new PrismaClient().$extends({
  result: {
    order: {
      total: minorMoneyField('totalMinor', 'currency'), // two columns -> Money
      shippingMoney: decimalMoneyField('shipping', { currency: 'EUR' }), // Decimal column -> Money<'EUR'>
    },
  },
});
await db.order.create({
  data: {
    ...toMinorColumns(total, 'totalMinor', 'currency'),
    shipping: toDecimalValue(fee, Prisma.Decimal),
  },
});
(await db.order.findFirstOrThrow()).total; // Money
```

## Keep sub-minor amounts with a scale column

If amounts can have more decimals than the currency, add `amount_scale SMALLINT NOT NULL` and pass its name both ways: `toMinorColumns(m, 'amountMinor', 'currency', { scale: 'amountScale' })` and `minorMoneyField('amountMinor', 'currency', { scale: 'amountScale' })`. Backfill each currency's current exponent for existing rows; a NULL scale throws on read.

## Use it with another Decimal library

`src/prisma.ts` does not import `@prisma/client`. It types Decimal structurally, as `{ toFixed(): string }`, so it also works with decimal.js and big.js. `examples/prisma/typecheck.ts` checks the helpers against Prisma's generated extension types.

## Related

- Reference: [`@ducatjs/money/prisma`](../reference/prisma.md)
- Explanation: [About storing amounts](../explanation/storage.md)
