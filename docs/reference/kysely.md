# `@ducatjs/money/kysely`

Exact Money in Kysely, without the plugin having to understand your queries. **Installs:** nothing. `kysely` is an optional peer dependency.

Related: [How to store money with Kysely](../how-to/kysely.md) · [How to store money in a database](../how-to/store-money-in-a-database.md)

A money value is selected as a JSON object built in SQL, which carries a marker, the amount as exact text, and the currency. `MoneyResultPlugin` turns exactly those objects into Money, wherever they appear: unions, CTEs, subqueries, nested `jsonArrayFrom` rows, every `stream()` chunk, and with `CamelCasePlugin`. A raw column keeps its driver type and is never typed as Money. Markers carry a random nonce chosen when the module loads, and the plugin converts only objects with exactly the marker's keys and this process's nonce, so data that merely looks like a marker, in a JSON or text column, stays as it is, and the nonce never appears in results.

## Writes

### setMoney

`setMoney<A extends string, K extends string>(money: Money<string>, amount: A, currency: K): { [A]: string; [K]: string }`

`setMoney<A extends string, C extends string>(money: Money<C>, amount: A, currency: FixedCurrency<C>): { [A]: string }`

`setMoney<A extends string, K extends string, S extends string>(money: Money<string>, amount: A, currency: K, options: ScaleColumnOption<S>): { [A]: string; [K]: string; [S]: number }`

`setMoney<A extends string, C extends string, S extends string>(money: Money<C>, amount: A, currency: FixedCurrency<C>, options: ScaleColumnOption<S>): { [A]: string; [S]: number }`

Column values for `values()`, `set()` and upserts: the minor units as an integer string, which every driver binds exactly, and the currency, unless it is fixed for the column with `fixed()`. With `{ scale: 'amount_scale' }`, as with the Prisma helpers' option of the same name, any scale is stored: the units at the money's own scale (`toScaledUnits()`), and the scale in the integer column `amount_scale`.

- **Rounds:** never.
- **Throws:** with `fixed()`, `CurrencyMismatchError` for Money in another currency (also a compile error); `RangeError` beyond the BIGINT range, and, without a scale column, for a value not at the currency's exponent: `round()` it first.

### setDecimalMoney

`setDecimalMoney<A extends string, K extends string>(money: Money<string>, amount: A, currency: K, size?: DecimalColumnSize): { [A]: string; [K]: string }`

`setDecimalMoney<A extends string, C extends string>(money: Money<C>, amount: A, currency: FixedCurrency<C>, size?: DecimalColumnSize): { [A]: string }`

Like `setMoney`, for a NUMERIC/DECIMAL amount column: the exact decimal. Pass the column's size (NUMERIC(19,4) by default) so a value it would round or clamp throws. On SQLite, where decimals are TEXT, the size only limits what is written.

- **Throws:** as `setMoney` for the currency; `RangeError` for a value the column would round or clamp.

### fixed

`fixed<C extends CurrencyInput>(currency: C): FixedCurrency<C>`

Marks a column's currency as fixed instead of stored in another column: `selectMoney(eb, 'total_minor', fixed('EUR'))` is typed `Money<'EUR'>`.

## Reads, filters and sums

### moneyHelpers

`moneyHelpers(dialect: MoneyDialect): MoneyHelpers`

The read, filter and sum helpers for `'postgres'`, `'mysql'` or `'sqlite'`, which differ in their JSON and cast syntax. On Postgres the values are `jsonb`, so `UNION`, `DISTINCT` and `GROUP BY` work on them.

`MoneyHelpers` has:

- `selectMoney(eb, amount, currency, options?)`: the Money in a minor-units column, with the currency from a column or `fixed()`. Typed `Money<C>`, or `Money<C> | null` for a nullable amount column. Needs `MoneyResultPlugin`. Without a scale column the units are read at the currency's exponent; with `{ scale: 'amount_scale' }` (a `ScaleColumnOption`), at the scale stored in that column, which a NULL scale makes throw (`RangeError`) when read.
- `selectDecimalMoney(eb, amount, currency)`: the same for a NUMERIC/DECIMAL (SQLite TEXT) column.
- `compareMoney(eb, amount, currency, op, money)`: a condition comparing a stored amount with Money, currency and amount together, so 5 USD never matches 500 JPY. `op` is a `MoneyComparison`. With a currency column, `=` and the ordering comparisons also require the same currency, and `<>` holds when either differs. Parameters are cast exactly to an integer or a wide DECIMAL, so the comparison never depends on the server's string conversion rules. SQL's three-valued logic applies: a row with a NULL currency or amount matches no comparison, `<>` included. There is no `in`-list form; combine comparisons with `eb.or`. With `fixed()`, Money in another currency throws `CurrencyMismatchError`.
- `compareDecimalMoney(eb, amount, currency, op, money, size?)`: the same for a NUMERIC/DECIMAL column of the given size (NUMERIC(19,4) by default); throws `RangeError` where the column would round or clamp the value. SQLite allows only `=` and `<>`, which compare the text, so they match only values written with `setDecimalMoney` (`'5.0'` is not `'5.00'`); ordering comparisons throw there.
- `sumMoney(eb, amount, currency)`: the sum of a minor-units column as Money, or null over no rows. Rows in more than one currency, or an amount without a currency, make the result throw when read, so group by the currency column to sum per currency.

`compareMoney` and `sumMoney` take no scale column: integers counted at different scales can't be compared or added as they are. Over a table with a scale column, they treat every row as being at the currency's exponent, so add a condition on the scale column (`eb('amount_scale', '=', 2)`), or read the rows with `selectMoney` and compare or add the Money.

- `sumDecimalMoney(eb, amount, currency)`: the same for a NUMERIC/DECIMAL column. Not available on SQLite (TEXT): it throws there.

`min`, `max` and `coalesce` over a money expression aren't supported: they would compare the JSON objects.

### MoneyResultPlugin

`class MoneyResultPlugin implements KyselyPlugin`

Turns the values built by `moneyHelpers` into Money, in every row and in JSON nested inside rows. It keeps no state between queries and doesn't touch the query, so it works with streams, prepared and repeated queries, and other plugins.

- `transformQuery(args)`: returns the query unchanged.
- `transformResult(args)`: converts the money values in every row.

For nested JSON that SQLite returns as text (`jsonArrayFrom`), put `ParseJSONResultsPlugin` before `MoneyResultPlugin`.

## Constants and types

- `DEFAULT_DECIMAL_SIZE`: `{ precision: 19, scale: 4 }`.
- `DecimalColumnSize`: `{ precision: number; scale: number }`.
- `MoneyDialect`: `'postgres' | 'mysql' | 'sqlite'`.
- `MoneyComparison`: `'=' | '<>' | '<' | '<=' | '>' | '>='`.
- `MinorUnitsColumn`: the column type of a BIGINT (SQLite INTEGER) column of minor units: drivers return a string, a number or a bigint; `setMoney` writes integer strings.
- `DecimalAmountColumn`: the column type of a NUMERIC/DECIMAL (SQLite TEXT) column holding the exact decimal as a string.
- `FixedCurrency<C>`: `{ fixed: C }`, from `fixed()`.
- `ScaleColumnOption<S>`: `{ scale: S }`: the integer column holding the number of decimals the minor units are counted in (2 for cents), for `setMoney` and `selectMoney`.
- `MoneyHelpers`: the object `moneyHelpers` returns.
