# ducat-sqlx

Money columns for [sqlx](https://crates.io/crates/sqlx): exact amounts in Postgres, MySQL and
SQLite, with [ducat](https://docs.rs/ducat)'s integer-and-scale amounts and no float anywhere. A
port of ducat's `@ducatjs/money/pg` and of the column shapes of its `drizzle/mysql` and
`drizzle/sqlite` entries.

- `Decimal`: an exact NUMERIC/DECIMAL value with its scale, for amounts whose currency is in
  another column.
- `DecimalColumn<C>`: a fixed-currency decimal column (NUMERIC, DECIMAL, or SQLite TEXT), at the
  currency's exponent.
- `MinorColumn<C>`: a fixed-currency BIGINT (SQLite INTEGER) column of minor units.
- `DecimalColumnSize::fit`: the decimal to bind for a NUMERIC(p, s) column, or an error if the
  database would round or clamp it.
- Features `postgres` (the default: NUMERIC binary and text, BIGINT, and ducat's `ducat_money`
  composite type), `mysql` and `sqlite`.

Every reader is strict (`NaN`, infinities, floats, extra decimals and malformed input are errors,
never roundings), and every writer refuses a value the column would change. The crate picks no
sqlx runtime or TLS backend: your own sqlx dependency does.

```rust
use ducat::{iso::Eur, CurrencyCode, Money};
use ducat_sqlx::{Decimal, DecimalColumn, MinorColumn};

// a NUMERIC(19,4) column hands back "12.3400"
let stored: Decimal = "12.3400".parse()?;
let price = DecimalColumn::<Eur>::from_decimal(&stored)?.0;
assert_eq!(price, "12.34".parse::<Money<Eur>>()?);
assert_eq!(MinorColumn(price).minor_units()?, 1234);

let any = stored.to_money(CurrencyCode::iso("EUR")?)?; // the scale kept: 12.3400 EUR
assert_eq!(any.scale(), 4);
```

License: MIT.
