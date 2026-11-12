# `@ducatjs/money/all`

The core and every opt-in module that has no optional peer dependency, in one import. **Installs:** the core methods and the methods of every module it includes, and registers every ISO 4217 currency.

Related: [`@ducatjs/money/fn`](fn.md) · [About modules](../explanation/modules.md)

- Exports the same names as [`@ducatjs/money/fn`](fn.md): everything the root entry exports, the core methods as plain functions, and every name of `/policy`, `/allocate`, `/tax`, `/pricing`, `/math`, `/convert`, `/exact`, `/convert/ecb`, `/convert/history`, `/convert/boc`, `/convert/fed`, `/convert/boe`, `/convert/hmrc`, `/stripe-fx`, `/adyen-fx`, `/cash`, `/historic`, `/crypto`, `/currencies`, `/territories`, `/wire`, `/context`, `/words` and its languages, `/finance`, `/format`, `/parse`, `/stripe`, `/adyen`, `/checkout`, `/paypal`, `/braintree`, `/klarna`, `/prisma`, `/fixed` and `/fixed/money`. Each name is documented on its entry's page.
- Installs the methods of `/allocate`, `/tax`, `/math`, `/convert`, `/exact`, `/cash`, `/format`, the six processors, `/prisma` and `/fixed/money`.
- Leaves out `/convert/fetch` (network I/O), the database and schema entries (`/drizzle/*`, `/kysely`, `/typeorm`, `/pg`, `/zod`, `/valibot`) and the testing entries.
- Its size budget is a loose ceiling, not a per-entry budget: 50.5 KiB gzipped for everything.
