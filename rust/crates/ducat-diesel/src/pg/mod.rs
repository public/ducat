//! Postgres: exact NUMERIC and BIGINT amounts, and ducat's composite money type (the `postgres`
//! feature, diesel's `postgres_backend`). The counterpart of ducat's `@ducatjs/money/pg`.
//!
//! | Rust type | diesel SQL type | Postgres type | reads | writes |
//! |---|---|---|---|---|
//! | [`Decimal`] | `Numeric` | NUMERIC | the exact value and its scale | the same |
//! | [`DecimalColumn<C>`] | `Numeric` | NUMERIC | `Money<C>` at the exponent, trailing zeros allowed | `Money<C>` at the exponent |
//! | [`MinorColumn<C>`] | `BigInt` | BIGINT | `Money<C>` from minor units | minor units |
//! | [`PgMoney<M>`] | [`sql_types::DucatMoney`] | [`ducat_money`](MONEY_TYPE_NAME) | `AnyMoney` or `Money<C>`, scale kept | the same |
//! | [`MoneyRecord`] | [`sql_types::DucatMoney`] | [`ducat_money`](MONEY_TYPE_NAME) | the fields, currency unresolved | the fields |
//!
//! diesel's arrays come with each (`Array<Numeric>` as `Vec<Decimal>`, and so on). NUMERIC goes
//! through diesel's own [`PgNumeric`], whose base-10000 digits
//! are converted exactly into ducat's integer and scale (`TryFrom` both ways): no float, and
//! neither diesel's `numeric` feature (`bigdecimal`) nor `rust_decimal`. `NaN` and `±Infinity`
//! are refused ([`Error::NotANumber`], [`Error::Infinite`]), and so is a NUMERIC whose length
//! doesn't match its digit count.
//!
//! The composite type is the SQL type [`sql_types::DucatMoney`]: diesel looks its OID up by name,
//! so create it first ([`money_type_sql`]). Point `diesel print-schema` at it instead of the type
//! it would generate, in `diesel.toml`:
//!
//! ```toml
//! [print_schema]
//! generate_missing_sql_type_definitions = false
//! import_types = ["diesel::sql_types::*", "ducat_diesel::pg::sql_types::*"]
//! ```
//!
//! Values are written through diesel's record support (`WriteTuple`), and read with this crate's
//! own reader of the binary record: diesel's `FromSql` for records slices by the field lengths
//! the bytes claim and panics on a truncated record, and reports a NULL field as its generic
//! unexpected-null error. Composites of another name read as `Record<(Numeric, Text)>`.
//!
//! The same queries run on diesel's own `PgConnection` (diesel's `postgres` feature, which links
//! libpq) or on `diesel-async`'s `AsyncPgConnection` (pure Rust, as here and in this crate's
//! tests):
//!
//! ```no_run
//! # async fn example(
//! #     connection: &mut diesel_async::AsyncPgConnection,
//! # ) -> Result<(), Box<dyn std::error::Error>> {
//! use diesel::prelude::*;
//! use diesel::sql_types::Numeric;
//! use diesel_async::RunQueryDsl;
//! use ducat::{iso::Eur, AnyMoney, Money};
//! use ducat_diesel::pg::PgMoney;
//! use ducat_diesel::{Decimal, MinorColumn};
//!
//! diesel::table! {
//!     use diesel::sql_types::*;
//!     use ducat_diesel::pg::sql_types::DucatMoney;
//!
//!     items (id) {
//!         id -> Int4,
//!         price -> DucatMoney,
//!         total_minor -> Int8,
//!     }
//! }
//!
//! let price: Money<Eur> = "12.34".parse()?;
//! diesel::insert_into(items::table)
//!     .values((
//!         items::price.eq(PgMoney(price.clone())),
//!         items::total_minor.eq(MinorColumn(price)),
//!     ))
//!     .execute(connection)
//!     .await?;
//!
//! let rows: Vec<(PgMoney<AnyMoney>, MinorColumn<Eur>)> = items::table
//!     .select((items::price, items::total_minor))
//!     .load(connection)
//!     .await?;
//! let amounts: Vec<Decimal> = diesel::dsl::sql::<Numeric>("SELECT (price).amount FROM items")
//!     .load(connection)
//!     .await?;
//! # Ok(()) }
//! ```

mod composite;
mod numeric;

use diesel::deserialize::{self, FromSql};
use diesel::pg::data_types::PgNumeric;
use diesel::pg::{Pg, PgValue};
use diesel::serialize::{self, Output, ToSql, WriteTuple};
use diesel::sql_types::{BigInt, Numeric, Record, Text};
use ducat::Currency;

pub use composite::{MONEY_TYPE_NAME, MoneyRecord, PgMoney, money_type_sql};

use crate::{Decimal, DecimalColumn, Error, MinorColumn, MoneyValue};

/// The SQL type for ducat's composite money type.
pub mod sql_types {
    /// ducat's composite money type, `ducat_money (amount numeric, currency text)`, as created by
    /// [`money_type_sql`](super::money_type_sql)`("ducat_money")`. diesel looks its OIDs up by
    /// name, on the connection's `search_path`.
    #[derive(
        Clone, Copy, Debug, Default, diesel::sql_types::SqlType, diesel::query_builder::QueryId,
    )]
    #[diesel(postgres_type(name = "ducat_money"))]
    pub struct DucatMoney;
}

use sql_types::DucatMoney;

fn read_decimal(value: PgValue<'_>) -> deserialize::Result<Decimal> {
    // `PgNumeric` has no infinities (diesel refuses their signs with an error of its own) and
    // ignores bytes after the digits: check the header first.
    ducat_sql_core::numeric::check_header(value.as_bytes()).map_err(Error::from)?;
    let numeric = <PgNumeric as FromSql<Numeric, Pg>>::from_sql(value)?;
    Ok(Decimal::try_from(&numeric)?)
}

fn write_decimal(decimal: &Decimal, out: &mut Output<'_, '_, Pg>) -> serialize::Result {
    let numeric = PgNumeric::try_from(decimal)?;
    <PgNumeric as ToSql<Numeric, Pg>>::to_sql(&numeric, &mut out.reborrow())
}

impl FromSql<Numeric, Pg> for Decimal {
    fn from_sql(value: PgValue<'_>) -> deserialize::Result<Self> {
        read_decimal(value)
    }
}

impl ToSql<Numeric, Pg> for Decimal {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        write_decimal(self, out)
    }
}

impl<C: Currency> FromSql<Numeric, Pg> for DecimalColumn<C> {
    fn from_sql(value: PgValue<'_>) -> deserialize::Result<Self> {
        Ok(Self::from_decimal(&read_decimal(value)?)?)
    }
}

impl<C: Currency> ToSql<Numeric, Pg> for DecimalColumn<C> {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        write_decimal(&self.to_decimal()?, out)
    }
}

impl<C: Currency> FromSql<BigInt, Pg> for MinorColumn<C> {
    fn from_sql(value: PgValue<'_>) -> deserialize::Result<Self> {
        Ok(Self::from_minor_units(
            <i64 as FromSql<BigInt, Pg>>::from_sql(value)?,
        ))
    }
}

impl<C: Currency> ToSql<BigInt, Pg> for MinorColumn<C> {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let minor = self.minor_units()?;
        <i64 as ToSql<BigInt, Pg>>::to_sql(&minor, &mut out.reborrow())
    }
}

fn read_record(value: PgValue<'_>) -> deserialize::Result<MoneyRecord> {
    Ok(MoneyRecord::decode_binary(value.as_bytes())?)
}

fn write_record(record: &MoneyRecord, out: &mut Output<'_, '_, Pg>) -> serialize::Result {
    WriteTuple::<(Numeric, Text)>::write_tuple(&(&record.amount, record.currency.as_str()), out)
}

impl FromSql<DucatMoney, Pg> for MoneyRecord {
    fn from_sql(value: PgValue<'_>) -> deserialize::Result<Self> {
        read_record(value)
    }
}

impl FromSql<Record<(Numeric, Text)>, Pg> for MoneyRecord {
    fn from_sql(value: PgValue<'_>) -> deserialize::Result<Self> {
        read_record(value)
    }
}

impl ToSql<DucatMoney, Pg> for MoneyRecord {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        write_record(self, out)
    }
}

impl<M: MoneyValue> FromSql<DucatMoney, Pg> for PgMoney<M> {
    fn from_sql(value: PgValue<'_>) -> deserialize::Result<Self> {
        Ok(Self::from_record(&read_record(value)?)?)
    }
}

impl<M: MoneyValue> FromSql<Record<(Numeric, Text)>, Pg> for PgMoney<M> {
    fn from_sql(value: PgValue<'_>) -> deserialize::Result<Self> {
        Ok(Self::from_record(&read_record(value)?)?)
    }
}

// `ToSql` needs `Debug`, which both money types have
impl<M: MoneyValue + core::fmt::Debug> ToSql<DucatMoney, Pg> for PgMoney<M> {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        write_record(&self.to_record(), out)
    }
}
