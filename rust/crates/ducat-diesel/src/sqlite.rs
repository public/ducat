//! SQLite: TEXT decimal and INTEGER minor-unit amounts (the `sqlite` feature, diesel's `sqlite`
//! with SQLite bundled), the column shapes of ducat's `@ducatjs/money/drizzle/sqlite`.
//!
//! | Rust type | diesel SQL type | SQLite value | reads | writes |
//! |---|---|---|---|---|
//! | [`Decimal`] | `Text` | TEXT | the exact value and its scale | the decimal text |
//! | [`DecimalColumn<C>`] | `Text` | TEXT | `Money<C>` at the exponent, trailing zeros allowed | `Money<C>` at the exponent |
//! | [`MinorColumn<C>`] | `BigInt` | INTEGER | `Money<C>` from minor units | minor units |
//! | [`JsonColumn<M>`] | `Text` | TEXT | ducat's money JSON, in any currency or `C` | the JSON text |
//!
//! Decimals are kept as TEXT because SQLite's NUMERIC affinity stores some of them as REAL and
//! loses digits. SQLite types values, not columns, so each value's own type is checked: a REAL
//! (or an INTEGER where TEXT is expected, and the reverse) is refused ([`Error::UnexpectedType`]),
//! never converted, where diesel's own `FromSql` impls let SQLite convert it.
//!
//! ```
//! use diesel::prelude::*;
//! use diesel::sqlite::SqliteConnection;
//! use ducat::{iso::Eur, Money};
//! use ducat_diesel::{DecimalColumn, MinorColumn};
//!
//! diesel::table! {
//!     items (id) {
//!         id -> Integer,
//!         price -> Text,
//!         total_minor -> BigInt,
//!     }
//! }
//!
//! let connection = &mut SqliteConnection::establish(":memory:")?;
//! diesel::sql_query("CREATE TABLE items (id INTEGER PRIMARY KEY, price TEXT NOT NULL, total_minor INTEGER NOT NULL)")
//!     .execute(connection)?;
//! let price: Money<Eur> = "12.34".parse()?;
//! diesel::insert_into(items::table)
//!     .values((
//!         items::price.eq(DecimalColumn(price.clone())),
//!         items::total_minor.eq(MinorColumn(price.clone())),
//!     ))
//!     .execute(connection)?;
//! let (DecimalColumn(stored), MinorColumn(minor)) = items::table
//!     .select((items::price, items::total_minor))
//!     .first::<(DecimalColumn<Eur>, MinorColumn<Eur>)>(connection)?;
//! assert_eq!((stored, minor), (price.clone(), price));
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

use diesel::deserialize::{self, FromSql};
use diesel::serialize::{self, IsNull, Output, ToSql};
use diesel::sql_types::{BigInt, Text};
use diesel::sqlite::{Sqlite, SqliteType, SqliteValue};
use ducat::Currency;

use crate::{Decimal, DecimalColumn, Error, JsonColumn, MinorColumn, MoneyValue};

/// Checks the value's own storage class: diesel would let SQLite convert a REAL to text or
/// truncate it to an integer.
fn check_value(value: &SqliteValue<'_, '_, '_>, expected: SqliteType) -> Result<(), Error> {
    match value.value_type() {
        Some(ty) if ty == expected => Ok(()),
        ty => Err(Error::UnexpectedType(
            match ty {
                Some(SqliteType::Text) => "TEXT",
                Some(SqliteType::Long) => "INTEGER",
                Some(SqliteType::Double) => "REAL",
                Some(SqliteType::Binary) => "BLOB",
                // NULL never reaches `from_sql`, and SQLite has no other storage classes
                _ => "unknown",
            }
            .into(),
        )),
    }
}

fn read_decimal(mut value: SqliteValue<'_, '_, '_>) -> Result<Decimal, Error> {
    check_value(&value, SqliteType::Text)?;
    value.read_text().parse()
}

impl FromSql<Text, Sqlite> for Decimal {
    fn from_sql(value: SqliteValue<'_, '_, '_>) -> deserialize::Result<Self> {
        Ok(read_decimal(value)?)
    }
}

impl ToSql<Text, Sqlite> for Decimal {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Sqlite>) -> serialize::Result {
        out.set_value(self.to_string());
        Ok(IsNull::No)
    }
}

impl<C: Currency> FromSql<Text, Sqlite> for DecimalColumn<C> {
    fn from_sql(value: SqliteValue<'_, '_, '_>) -> deserialize::Result<Self> {
        Ok(Self::from_decimal(&read_decimal(value)?)?)
    }
}

impl<C: Currency> ToSql<Text, Sqlite> for DecimalColumn<C> {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Sqlite>) -> serialize::Result {
        out.set_value(self.to_decimal()?.to_string());
        Ok(IsNull::No)
    }
}

impl<C: Currency> FromSql<BigInt, Sqlite> for MinorColumn<C> {
    fn from_sql(mut value: SqliteValue<'_, '_, '_>) -> deserialize::Result<Self> {
        check_value(&value, SqliteType::Long)?;
        Ok(Self::from_minor_units(value.read_long()))
    }
}

impl<C: Currency> ToSql<BigInt, Sqlite> for MinorColumn<C> {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Sqlite>) -> serialize::Result {
        out.set_value(self.minor_units()?);
        Ok(IsNull::No)
    }
}

impl<M: MoneyValue> FromSql<Text, Sqlite> for JsonColumn<M> {
    fn from_sql(mut value: SqliteValue<'_, '_, '_>) -> deserialize::Result<Self> {
        check_value(&value, SqliteType::Text)?;
        Ok(Self::from_json(value.read_text())?)
    }
}

impl<M: MoneyValue + core::fmt::Debug> ToSql<Text, Sqlite> for JsonColumn<M> {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Sqlite>) -> serialize::Result {
        out.set_value(self.to_json()?);
        Ok(IsNull::No)
    }
}
