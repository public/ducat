//! MySQL and MariaDB: DECIMAL and BIGINT amounts (the `mysql` feature), the column shapes of
//! ducat's `@ducatjs/money/drizzle/mysql`.
//!
//! | Rust type | MySQL type | reads | writes |
//! |---|---|---|---|
//! | [`Decimal`] | DECIMAL (or a string) | the exact value and its scale | the decimal as a string, which MySQL converts exactly |
//! | [`DecimalColumn<C>`] | DECIMAL(p, s) | `Money<C>` at the exponent, trailing zeros allowed | `Money<C>` at the exponent |
//! | [`MinorColumn<C>`] | BIGINT | `Money<C>` from minor units | minor units |
//!
//! MySQL sends DECIMAL as text in both its protocols, so nothing goes through a float. A FLOAT
//! or DOUBLE value, or an unsigned BIGINT, is refused ([`Error::UnexpectedType`]). Outside strict
//! mode MySQL clamps an out-of-range value instead of failing, so bind
//! [`DecimalColumnSize::fit`](crate::DecimalColumnSize::fit)'s decimal for a sized column: it
//! refuses what the column couldn't hold unchanged.
//!
//! ```no_run
//! # async fn example(pool: sqlx::MySqlPool) -> Result<(), Box<dyn std::error::Error>> {
//! use ducat::{iso::Eur, Money};
//! use ducat_sqlx::{DecimalColumn, DEFAULT_DECIMAL_SIZE};
//!
//! let price: Money<Eur> = "12.34".parse()?;
//! sqlx::query("INSERT INTO items (price) VALUES (?)")
//!     .bind(DEFAULT_DECIMAL_SIZE.fit(&price)?)
//!     .execute(&pool)
//!     .await?;
//! let (DecimalColumn(price),): (DecimalColumn<Eur>,) =
//!     sqlx::query_as("SELECT price FROM items").fetch_one(&pool).await?;
//! # Ok(()) }
//! ```

use ducat::Currency;
use sqlx::encode::IsNull;
use sqlx::error::BoxDynError;
use sqlx::mysql::{MySql, MySqlTypeInfo, MySqlValueRef};
use sqlx::{Database, Decode, Encode, Type, TypeInfo, ValueRef};

use crate::{Decimal, DecimalColumn, Error, MinorColumn};

/// A DECIMAL, or a string column, which holds decimal text exactly.
fn is_decimal_type(ty: &MySqlTypeInfo) -> bool {
    ty.name() == "DECIMAL" || <str as Type<MySql>>::compatible(ty)
}

fn decode_decimal(value: MySqlValueRef<'_>) -> Result<Decimal, BoxDynError> {
    let ty = value.type_info();
    if !is_decimal_type(&ty) {
        return Err(Error::UnexpectedType(ty.name().into()).into());
    }
    Ok(<&str as Decode<MySql>>::decode(value)?.parse()?)
}

fn encode_decimal(
    decimal: &Decimal,
    buf: &mut <MySql as Database>::ArgumentBuffer<'_>,
) -> Result<IsNull, BoxDynError> {
    <&str as Encode<MySql>>::encode_by_ref(&decimal.to_string().as_str(), buf)
}

impl Type<MySql> for Decimal {
    fn type_info() -> MySqlTypeInfo {
        <str as Type<MySql>>::type_info()
    }

    fn compatible(ty: &MySqlTypeInfo) -> bool {
        is_decimal_type(ty)
    }
}

impl Decode<'_, MySql> for Decimal {
    fn decode(value: MySqlValueRef<'_>) -> Result<Self, BoxDynError> {
        decode_decimal(value)
    }
}

impl Encode<'_, MySql> for Decimal {
    fn encode_by_ref(
        &self,
        buf: &mut <MySql as Database>::ArgumentBuffer<'_>,
    ) -> Result<IsNull, BoxDynError> {
        encode_decimal(self, buf)
    }
}

impl<C: Currency> Type<MySql> for DecimalColumn<C> {
    fn type_info() -> MySqlTypeInfo {
        <str as Type<MySql>>::type_info()
    }

    fn compatible(ty: &MySqlTypeInfo) -> bool {
        is_decimal_type(ty)
    }
}

impl<C: Currency> Decode<'_, MySql> for DecimalColumn<C> {
    fn decode(value: MySqlValueRef<'_>) -> Result<Self, BoxDynError> {
        Ok(Self::from_decimal(&decode_decimal(value)?)?)
    }
}

impl<C: Currency> Encode<'_, MySql> for DecimalColumn<C> {
    fn encode_by_ref(
        &self,
        buf: &mut <MySql as Database>::ArgumentBuffer<'_>,
    ) -> Result<IsNull, BoxDynError> {
        encode_decimal(&self.to_decimal()?, buf)
    }
}

impl<C: Currency> Type<MySql> for MinorColumn<C> {
    fn type_info() -> MySqlTypeInfo {
        <i64 as Type<MySql>>::type_info()
    }

    fn compatible(ty: &MySqlTypeInfo) -> bool {
        <i64 as Type<MySql>>::compatible(ty)
    }
}

impl<C: Currency> Decode<'_, MySql> for MinorColumn<C> {
    fn decode(value: MySqlValueRef<'_>) -> Result<Self, BoxDynError> {
        let ty = value.type_info();
        // the binary protocol's integer decoding reads any 8 bytes, a DOUBLE's included
        if !<i64 as Type<MySql>>::compatible(&ty) {
            return Err(Error::UnexpectedType(ty.name().into()).into());
        }
        Ok(Self::from_minor_units(<i64 as Decode<MySql>>::decode(
            value,
        )?))
    }
}

impl<C: Currency> Encode<'_, MySql> for MinorColumn<C> {
    fn encode_by_ref(
        &self,
        buf: &mut <MySql as Database>::ArgumentBuffer<'_>,
    ) -> Result<IsNull, BoxDynError> {
        <i64 as Encode<MySql>>::encode_by_ref(&self.minor_units()?, buf)
    }
}
