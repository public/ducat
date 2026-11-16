//! SQLite: TEXT decimal and INTEGER minor-unit amounts (the `sqlite` feature), the column shapes
//! of ducat's `@ducatjs/money/drizzle/sqlite`.
//!
//! | Rust type | SQLite value | reads | writes |
//! |---|---|---|---|
//! | [`Decimal`] | TEXT | the exact value and its scale | the decimal text |
//! | [`DecimalColumn<C>`] | TEXT | `Money<C>` at the exponent, trailing zeros allowed | `Money<C>` at the exponent |
//! | [`MinorColumn<C>`] | INTEGER | `Money<C>` from minor units | minor units |
//! | [`JsonColumn<M>`] | TEXT | ducat's money JSON, in any currency or `C` | the JSON text |
//!
//! Decimals are kept as TEXT because SQLite's NUMERIC affinity stores some of them as REAL and
//! loses digits. SQLite types values, not columns, so each value's own type is checked: a REAL
//! (or an INTEGER where TEXT is expected, and the reverse) is refused ([`Error::UnexpectedType`]),
//! never converted.
//!
//! ```no_run
//! # async fn example(pool: sqlx::SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
//! use ducat::{iso::Eur, Money};
//! use ducat_sqlx::{DecimalColumn, MinorColumn};
//!
//! let price: Money<Eur> = "12.34".parse()?;
//! sqlx::query("INSERT INTO items (price, total_minor) VALUES (?, ?)")
//!     .bind(DecimalColumn(price.clone()))
//!     .bind(MinorColumn(price))
//!     .execute(&pool)
//!     .await?;
//! # Ok(()) }
//! ```

use ducat::Currency;
use sqlx::encode::IsNull;
use sqlx::error::BoxDynError;
use sqlx::sqlite::{Sqlite, SqliteTypeInfo, SqliteValueRef};
use sqlx::{Database, Decode, Encode, Type, TypeInfo, ValueRef};

use crate::{Decimal, DecimalColumn, Error, JsonColumn, MinorColumn, MoneyValue};

fn is_text(ty: &SqliteTypeInfo) -> bool {
    ty.name() == "TEXT"
}

fn is_integer(ty: &SqliteTypeInfo) -> bool {
    ty.name() == "INTEGER"
}

/// Checks the value's own storage class: sqlx would convert a REAL to text or truncate it to an
/// integer.
fn check_value(
    value: &SqliteValueRef<'_>,
    expected: fn(&SqliteTypeInfo) -> bool,
) -> Result<(), Error> {
    let ty = value.type_info();
    if expected(&ty) {
        Ok(())
    } else {
        Err(Error::UnexpectedType(ty.name().into()))
    }
}

fn decode_decimal(value: SqliteValueRef<'_>) -> Result<Decimal, BoxDynError> {
    check_value(&value, is_text)?;
    Ok(<&str as Decode<Sqlite>>::decode(value)?.parse()?)
}

fn encode_decimal<'q>(
    decimal: &Decimal,
    buf: &mut <Sqlite as Database>::ArgumentBuffer<'q>,
) -> Result<IsNull, BoxDynError> {
    <String as Encode<'q, Sqlite>>::encode(decimal.to_string(), buf)
}

impl Type<Sqlite> for Decimal {
    fn type_info() -> SqliteTypeInfo {
        <str as Type<Sqlite>>::type_info()
    }

    fn compatible(ty: &SqliteTypeInfo) -> bool {
        is_text(ty)
    }
}

impl Decode<'_, Sqlite> for Decimal {
    fn decode(value: SqliteValueRef<'_>) -> Result<Self, BoxDynError> {
        decode_decimal(value)
    }
}

impl<'q> Encode<'q, Sqlite> for Decimal {
    fn encode_by_ref(
        &self,
        buf: &mut <Sqlite as Database>::ArgumentBuffer<'q>,
    ) -> Result<IsNull, BoxDynError> {
        encode_decimal(self, buf)
    }
}

impl<C: Currency> Type<Sqlite> for DecimalColumn<C> {
    fn type_info() -> SqliteTypeInfo {
        <str as Type<Sqlite>>::type_info()
    }

    fn compatible(ty: &SqliteTypeInfo) -> bool {
        is_text(ty)
    }
}

impl<C: Currency> Decode<'_, Sqlite> for DecimalColumn<C> {
    fn decode(value: SqliteValueRef<'_>) -> Result<Self, BoxDynError> {
        Ok(Self::from_decimal(&decode_decimal(value)?)?)
    }
}

impl<'q, C: Currency> Encode<'q, Sqlite> for DecimalColumn<C> {
    fn encode_by_ref(
        &self,
        buf: &mut <Sqlite as Database>::ArgumentBuffer<'q>,
    ) -> Result<IsNull, BoxDynError> {
        encode_decimal(&self.to_decimal()?, buf)
    }
}

impl<C: Currency> Type<Sqlite> for MinorColumn<C> {
    fn type_info() -> SqliteTypeInfo {
        <i64 as Type<Sqlite>>::type_info()
    }

    fn compatible(ty: &SqliteTypeInfo) -> bool {
        is_integer(ty)
    }
}

impl<C: Currency> Decode<'_, Sqlite> for MinorColumn<C> {
    fn decode(value: SqliteValueRef<'_>) -> Result<Self, BoxDynError> {
        check_value(&value, is_integer)?;
        Ok(Self::from_minor_units(<i64 as Decode<Sqlite>>::decode(
            value,
        )?))
    }
}

impl<'q, C: Currency> Encode<'q, Sqlite> for MinorColumn<C> {
    fn encode_by_ref(
        &self,
        buf: &mut <Sqlite as Database>::ArgumentBuffer<'q>,
    ) -> Result<IsNull, BoxDynError> {
        <i64 as Encode<'q, Sqlite>>::encode(self.minor_units()?, buf)
    }
}

impl<M: MoneyValue> Type<Sqlite> for JsonColumn<M> {
    fn type_info() -> SqliteTypeInfo {
        <str as Type<Sqlite>>::type_info()
    }

    fn compatible(ty: &SqliteTypeInfo) -> bool {
        is_text(ty)
    }
}

impl<M: MoneyValue> Decode<'_, Sqlite> for JsonColumn<M> {
    fn decode(value: SqliteValueRef<'_>) -> Result<Self, BoxDynError> {
        check_value(&value, is_text)?;
        Ok(Self::from_json(<&str as Decode<Sqlite>>::decode(value)?)?)
    }
}

impl<'q, M: MoneyValue> Encode<'q, Sqlite> for JsonColumn<M> {
    fn encode_by_ref(
        &self,
        buf: &mut <Sqlite as Database>::ArgumentBuffer<'q>,
    ) -> Result<IsNull, BoxDynError> {
        <String as Encode<'q, Sqlite>>::encode(self.to_json()?, buf)
    }
}
