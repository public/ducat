//! MySQL and MariaDB: DECIMAL and BIGINT amounts (the `mysql` feature, diesel's `mysql_backend`),
//! the column shapes of ducat's `@ducatjs/money/drizzle/mysql`.
//!
//! | Rust type | diesel SQL type | MySQL type | reads | writes |
//! |---|---|---|---|---|
//! | [`Decimal`] | `Numeric` | DECIMAL (or a string) | the exact value and its scale | the decimal as text, which MySQL converts exactly |
//! | [`DecimalColumn<C>`] | `Numeric` | DECIMAL(p, s) | `Money<C>` at the exponent, trailing zeros allowed | `Money<C>` at the exponent |
//! | [`MinorColumn<C>`] | `BigInt` | BIGINT | `Money<C>` from minor units | minor units |
//! | [`JsonColumn<M>`] | `Json` | JSON | ducat's money JSON, in any currency or `C` | the JSON text |
//!
//! MySQL sends DECIMAL as text in both its protocols, so nothing goes through a float. Each
//! value's own type is checked, whatever the schema says: a FLOAT or DOUBLE value where a
//! DECIMAL or an integer was expected, and an unsigned BIGINT, are refused
//! ([`Error::UnexpectedType`]), where diesel's own integer reading would truncate a float.
//! Outside strict mode MySQL clamps an out-of-range value instead of failing, so bind
//! [`DecimalColumnSize::fit`](crate::DecimalColumnSize::fit)'s decimal for a sized column: it
//! refuses what the column couldn't hold unchanged.
//!
//! diesel's own `MysqlConnection` (diesel's `mysql` feature) links libmysqlclient;
//! `diesel-async`'s `AsyncMysqlConnection` is pure Rust, as in this crate's tests:
//!
//! ```no_run
//! # async fn example(
//! #     connection: &mut diesel_async::AsyncMysqlConnection,
//! # ) -> Result<(), Box<dyn std::error::Error>> {
//! use diesel::prelude::*;
//! use diesel_async::RunQueryDsl;
//! use ducat::{iso::Eur, Money};
//! use ducat_diesel::{DecimalColumn, DEFAULT_DECIMAL_SIZE};
//!
//! diesel::table! {
//!     items (id) {
//!         id -> Integer,
//!         price -> Numeric,
//!     }
//! }
//!
//! let price: Money<Eur> = "12.34".parse()?;
//! diesel::insert_into(items::table)
//!     .values(items::price.eq(DEFAULT_DECIMAL_SIZE.fit(&price)?))
//!     .execute(connection)
//!     .await?;
//! let prices: Vec<DecimalColumn<Eur>> = items::table.select(items::price).load(connection).await?;
//! # Ok(()) }
//! ```

use std::io::Write as _;

use diesel::deserialize::{self, FromSql};
use diesel::mysql::{Mysql, MysqlType, MysqlValue};
use diesel::serialize::{self, IsNull, Output, ToSql};
use diesel::sql_types::{BigInt, Json, Numeric};
use ducat::Currency;

use crate::{Decimal, DecimalColumn, Error, JsonColumn, MinorColumn, MoneyValue};

/// The MySQL name of a value's type, for [`Error::UnexpectedType`].
fn type_name(ty: MysqlType) -> &'static str {
    match ty {
        MysqlType::Tiny => "TINYINT",
        MysqlType::UnsignedTiny => "TINYINT UNSIGNED",
        MysqlType::Short => "SMALLINT",
        MysqlType::UnsignedShort => "SMALLINT UNSIGNED",
        MysqlType::Long => "INT",
        MysqlType::UnsignedLong => "INT UNSIGNED",
        MysqlType::LongLong => "BIGINT",
        MysqlType::UnsignedLongLong => "BIGINT UNSIGNED",
        MysqlType::Float => "FLOAT",
        MysqlType::Double => "DOUBLE",
        MysqlType::Numeric => "DECIMAL",
        MysqlType::Time => "TIME",
        MysqlType::Date => "DATE",
        MysqlType::DateTime => "DATETIME",
        MysqlType::Timestamp => "TIMESTAMP",
        MysqlType::String => "VARCHAR",
        MysqlType::Blob => "BLOB",
        MysqlType::Bit => "BIT",
        MysqlType::Set => "SET",
        MysqlType::Enum => "ENUM",
        _ => "unknown",
    }
}

fn unexpected(ty: MysqlType) -> Error {
    Error::UnexpectedType(type_name(ty).into())
}

fn read_decimal(value: &MysqlValue<'_>) -> Result<Decimal, Error> {
    match value.value_type() {
        // DECIMAL as text, or a string column holding decimal text
        MysqlType::Numeric | MysqlType::String => core::str::from_utf8(value.as_bytes())
            .map_err(|_| Error::Malformed("decimal text that isn't UTF-8"))?
            .parse(),
        ty => Err(unexpected(ty)),
    }
}

fn write_decimal(decimal: &Decimal, out: &mut Output<'_, '_, Mysql>) -> serialize::Result {
    write!(out, "{decimal}")?;
    Ok(IsNull::No)
}

impl FromSql<Numeric, Mysql> for Decimal {
    fn from_sql(value: MysqlValue<'_>) -> deserialize::Result<Self> {
        Ok(read_decimal(&value)?)
    }
}

impl ToSql<Numeric, Mysql> for Decimal {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Mysql>) -> serialize::Result {
        write_decimal(self, out)
    }
}

impl<C: Currency> FromSql<Numeric, Mysql> for DecimalColumn<C> {
    fn from_sql(value: MysqlValue<'_>) -> deserialize::Result<Self> {
        Ok(Self::from_decimal(&read_decimal(&value)?)?)
    }
}

impl<C: Currency> ToSql<Numeric, Mysql> for DecimalColumn<C> {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Mysql>) -> serialize::Result {
        write_decimal(&self.to_decimal()?, out)
    }
}

/// The first `N` bytes of an integer value, as diesel reads them (in native byte order, as
/// libmysqlclient and diesel-async hand them over).
fn prefix<const N: usize>(bytes: &[u8]) -> Result<[u8; N], Error> {
    bytes
        .get(..N)
        .and_then(|bytes| <[u8; N]>::try_from(bytes).ok())
        .ok_or(Error::Malformed("a truncated integer"))
}

/// A signed integer value of any width; the unsigned BIGINT (whose top half doesn't fit), floats,
/// decimals and everything else are refused.
fn read_integer(value: &MysqlValue<'_>) -> Result<i64, Error> {
    let bytes = value.as_bytes();
    match value.value_type() {
        MysqlType::Tiny => Ok(i64::from(i8::from_ne_bytes(prefix(bytes)?))),
        MysqlType::Short => Ok(i64::from(i16::from_ne_bytes(prefix(bytes)?))),
        MysqlType::Long => Ok(i64::from(i32::from_ne_bytes(prefix(bytes)?))),
        MysqlType::LongLong => {
            let bytes = <[u8; 8]>::try_from(bytes)
                .map_err(|_| Error::Malformed("a BIGINT is eight bytes"))?;
            Ok(i64::from_ne_bytes(bytes))
        }
        ty => Err(unexpected(ty)),
    }
}

impl<C: Currency> FromSql<BigInt, Mysql> for MinorColumn<C> {
    fn from_sql(value: MysqlValue<'_>) -> deserialize::Result<Self> {
        Ok(Self::from_minor_units(read_integer(&value)?))
    }
}

impl<C: Currency> ToSql<BigInt, Mysql> for MinorColumn<C> {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Mysql>) -> serialize::Result {
        let minor = self.minor_units()?;
        <i64 as ToSql<BigInt, Mysql>>::to_sql(&minor, &mut out.reborrow())
    }
}

impl<M: MoneyValue> FromSql<Json, Mysql> for JsonColumn<M> {
    fn from_sql(value: MysqlValue<'_>) -> deserialize::Result<Self> {
        let text = core::str::from_utf8(value.as_bytes())
            .map_err(|_| Error::Malformed("JSON that isn't UTF-8"))?;
        // mysql2 parses a JSON column's value before ducat reads it
        Ok(Self::from_parsed_json(text)?)
    }
}

impl<M: MoneyValue + core::fmt::Debug> ToSql<Json, Mysql> for JsonColumn<M> {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Mysql>) -> serialize::Result {
        out.write_all(self.to_json()?.as_bytes())?;
        Ok(IsNull::No)
    }
}
