//! Money columns for [sqlx]: exact amounts in Postgres, MySQL and SQLite, with [`ducat`]'s
//! integer-and-scale amounts and no float anywhere. A port of ducat's `@ducatjs/money/pg` and of
//! the column shapes of its `drizzle/mysql` and `drizzle/sqlite` entries.
//!
//! - [`Decimal`]: an exact NUMERIC/DECIMAL value with its scale, for amounts whose currency is
//!   in another column ([`Decimal::to_money`], [`Decimal::from_money`]).
//! - [`DecimalColumn<C>`]: a fixed-currency decimal column (NUMERIC, DECIMAL, or SQLite TEXT),
//!   at the currency's exponent.
//! - [`MinorColumn<C>`]: a fixed-currency BIGINT (SQLite INTEGER) column of minor units, and
//!   [`minor_units`] for any money.
//! - [`ScaledMinorColumn<C>`]: a fixed-currency column of units with a scale column beside it,
//!   for money at any scale, and [`scaled_minor_units`] for any money.
//! - [`DecimalColumnSize::fit`]: the decimal to bind for a NUMERIC(p, s) column, or an error if
//!   the database would round or clamp it.
#![cfg_attr(
    feature = "postgres",
    doc = "- [`pg`] (feature `postgres`, the default): NUMERIC's binary format read and written \
           directly, and ducat's composite money type ([`pg::PgMoney`], [`pg::MoneyRecord`], \
           [`pg::money_type_sql`])."
)]
#![cfg_attr(
    not(feature = "postgres"),
    doc = "- `pg` (feature `postgres`, the default): NUMERIC's binary format read and written \
           directly, and ducat's composite money type."
)]
#![cfg_attr(
    feature = "mysql",
    doc = "- [`mysql`] (feature `mysql`): the sqlx impls for MySQL and MariaDB."
)]
#![cfg_attr(
    not(feature = "mysql"),
    doc = "- `mysql` (feature `mysql`): the sqlx impls for MySQL and MariaDB."
)]
#![cfg_attr(
    feature = "sqlite",
    doc = "- [`sqlite`] (feature `sqlite`): the sqlx impls for SQLite."
)]
#![cfg_attr(
    not(feature = "sqlite"),
    doc = "- `sqlite` (feature `sqlite`): the sqlx impls for SQLite."
)]
//!
//! Every reader is strict: `NaN`, the infinities, a float where a decimal or integer was expected,
//! more decimals than a fixed-currency column's exponent, and malformed bytes or text are
//! errors ([`Error`]), never roundings, and nothing panics on any input. Every writer refuses a
//! value the column would change.
//!
//! The crate picks no sqlx runtime or TLS backend, and enables no sqlx macros: the application's
//! own sqlx dependency does.
//!
//! ```
//! use ducat::{iso::Eur, CurrencyCode, Money};
//! use ducat_sqlx::{Decimal, DecimalColumn, MinorColumn};
//!
//! // a NUMERIC(19,4) column hands back "12.3400"
//! let stored: Decimal = "12.3400".parse()?;
//! let price = DecimalColumn::<Eur>::from_decimal(&stored)?.0;
//! assert_eq!(price, "12.34".parse::<Money<Eur>>()?);
//! assert_eq!(MinorColumn(price).minor_units()?, 1234);
//!
//! let any = stored.to_money(CurrencyCode::iso("EUR")?)?; // the scale kept: 12.3400 EUR
//! assert_eq!(any.scale(), 4);
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
#![forbid(unsafe_code)]
#![warn(missing_docs)]
#![cfg_attr(docsrs, feature(doc_cfg))]

mod decimal;
mod error;
mod money;
#[cfg(feature = "mysql")]
pub mod mysql;
#[cfg(feature = "postgres")]
pub mod pg;
#[cfg(feature = "sqlite")]
pub mod sqlite;

pub use decimal::{DEFAULT_DECIMAL_SIZE, Decimal, DecimalColumnSize};
pub use error::Error;
pub use money::{
    DecimalColumn, MinorColumn, MoneyValue, ScaledMinorColumn, minor_units, scaled_minor_units,
};
