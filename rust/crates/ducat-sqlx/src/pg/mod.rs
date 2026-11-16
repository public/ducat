//! Postgres: exact NUMERIC and BIGINT amounts, and ducat's composite money type (the `postgres`
//! feature). The counterpart of ducat's `@ducatjs/money/pg`.
//!
//! | Rust type | Postgres type | reads | writes |
//! |---|---|---|---|
//! | [`Decimal`] | NUMERIC | the exact value and its scale, binary or text | the same, binary |
//! | [`DecimalColumn<C>`] | NUMERIC | `Money<C>` at the exponent, trailing zeros allowed | `Money<C>` at the exponent |
//! | [`MinorColumn<C>`] | BIGINT | `Money<C>` from minor units | minor units |
//! | [`JsonColumn<M>`] | jsonb or json | ducat's money JSON, in any currency or `C` | the same, as jsonb |
//! | [`PgMoney<M>`] | [`ducat_money`](MONEY_TYPE_NAME) | `AnyMoney` or `Money<C>`, scale kept | the same |
//! | [`MoneyRecord`] | [`ducat_money`](MONEY_TYPE_NAME) | the fields, currency unresolved | the fields |
//!
//! Each also has its array type (NUMERIC[], BIGINT[], `ducat_money[]`), so `Vec<Decimal>` and
//! the like decode and bind. NUMERIC's binary format is read and written here, digit by digit,
//! into ducat's integer and scale ([`decode_numeric`], [`encode_numeric`]): no float, and no
//! `rust_decimal` or `bigdecimal`. `NaN` and `±Infinity` are refused ([`Error::NotANumber`](crate::Error::NotANumber),
//! [`Error::Infinite`](crate::Error::Infinite)).
//!
//! ```no_run
//! # async fn example(pool: sqlx::PgPool) -> Result<(), Box<dyn std::error::Error>> {
//! use ducat::{iso::Eur, AnyMoney, Money};
//! use ducat_sqlx::{pg::PgMoney, Decimal, MinorColumn};
//!
//! let price: Money<Eur> = "12.34".parse()?;
//! sqlx::query("INSERT INTO items (price, total_minor) VALUES ($1, $2)")
//!     .bind(PgMoney(price.clone()))
//!     .bind(MinorColumn(price))
//!     .execute(&pool)
//!     .await?;
//!
//! let (PgMoney(price), amount): (PgMoney<AnyMoney>, Decimal) =
//!     sqlx::query_as("SELECT price, (price).amount FROM items").fetch_one(&pool).await?;
//! # Ok(()) }
//! ```

mod composite;
mod numeric;

use ducat::Currency;
use sqlx::encode::IsNull;
use sqlx::error::BoxDynError;
use sqlx::postgres::types::Oid;
use sqlx::postgres::{
    PgArgumentBuffer, PgHasArrayType, PgTypeInfo, PgTypeKind, PgValueFormat, PgValueRef, Postgres,
};
use sqlx::{Decode, Encode, Type, TypeInfo, ValueRef};

pub use composite::{MONEY_TYPE_NAME, MoneyRecord, PgMoney, money_type_sql};
use ducat_sql_core::record::{NUMERIC_OID, TEXT_OID, VARCHAR_OID};
pub use numeric::{decode_numeric, encode_numeric};

use crate::{Decimal, DecimalColumn, JsonColumn, MinorColumn, MoneyValue};

/// NUMERIC[]'s OID.
const NUMERIC_ARRAY_OID: u32 = 1231;

fn numeric_type() -> PgTypeInfo {
    PgTypeInfo::with_oid(Oid(NUMERIC_OID))
}

fn decode_decimal(value: PgValueRef<'_>) -> Result<Decimal, BoxDynError> {
    Ok(match value.format() {
        PgValueFormat::Binary => decode_numeric(value.as_bytes()?)?,
        PgValueFormat::Text => value.as_str()?.parse()?,
    })
}

/// The binary NUMERIC's size: the header and two bytes per four decimal digits.
fn numeric_size(decimal: &Decimal) -> usize {
    let digits = decimal.units().to_string().len() + usize::from(decimal.scale());
    8 + 2 * (digits / 4 + 2)
}

impl Type<Postgres> for Decimal {
    fn type_info() -> PgTypeInfo {
        numeric_type()
    }

    fn compatible(ty: &PgTypeInfo) -> bool {
        *ty == numeric_type()
    }
}

impl PgHasArrayType for Decimal {
    fn array_type_info() -> PgTypeInfo {
        PgTypeInfo::with_oid(Oid(NUMERIC_ARRAY_OID))
    }
}

impl Decode<'_, Postgres> for Decimal {
    fn decode(value: PgValueRef<'_>) -> Result<Self, BoxDynError> {
        decode_decimal(value)
    }
}

impl Encode<'_, Postgres> for Decimal {
    fn encode_by_ref(&self, buf: &mut PgArgumentBuffer) -> Result<IsNull, BoxDynError> {
        encode_numeric(self, buf)?;
        Ok(IsNull::No)
    }

    fn size_hint(&self) -> usize {
        numeric_size(self)
    }
}

impl<C: Currency> Type<Postgres> for DecimalColumn<C> {
    fn type_info() -> PgTypeInfo {
        numeric_type()
    }

    fn compatible(ty: &PgTypeInfo) -> bool {
        *ty == numeric_type()
    }
}

impl<C: Currency> PgHasArrayType for DecimalColumn<C> {
    fn array_type_info() -> PgTypeInfo {
        PgTypeInfo::with_oid(Oid(NUMERIC_ARRAY_OID))
    }
}

impl<C: Currency> Decode<'_, Postgres> for DecimalColumn<C> {
    fn decode(value: PgValueRef<'_>) -> Result<Self, BoxDynError> {
        Ok(Self::from_decimal(&decode_decimal(value)?)?)
    }
}

impl<C: Currency> Encode<'_, Postgres> for DecimalColumn<C> {
    fn encode_by_ref(&self, buf: &mut PgArgumentBuffer) -> Result<IsNull, BoxDynError> {
        encode_numeric(&self.to_decimal()?, buf)?;
        Ok(IsNull::No)
    }
}

impl<C: Currency> Type<Postgres> for MinorColumn<C> {
    fn type_info() -> PgTypeInfo {
        <i64 as Type<Postgres>>::type_info()
    }

    fn compatible(ty: &PgTypeInfo) -> bool {
        <i64 as Type<Postgres>>::compatible(ty)
    }
}

impl<C: Currency> PgHasArrayType for MinorColumn<C> {
    fn array_type_info() -> PgTypeInfo {
        <i64 as PgHasArrayType>::array_type_info()
    }
}

impl<C: Currency> Decode<'_, Postgres> for MinorColumn<C> {
    fn decode(value: PgValueRef<'_>) -> Result<Self, BoxDynError> {
        Ok(Self::from_minor_units(<i64 as Decode<Postgres>>::decode(
            value,
        )?))
    }
}

impl<C: Currency> Encode<'_, Postgres> for MinorColumn<C> {
    fn encode_by_ref(&self, buf: &mut PgArgumentBuffer) -> Result<IsNull, BoxDynError> {
        <i64 as Encode<Postgres>>::encode_by_ref(&self.minor_units()?, buf)
    }

    fn size_hint(&self) -> usize {
        8
    }
}

fn money_type() -> PgTypeInfo {
    PgTypeInfo::with_name(MONEY_TYPE_NAME)
}

/// The composite money type, or any composite of `(numeric, text)` (or `varchar`) fields.
fn is_money_type(ty: &PgTypeInfo) -> bool {
    // A type declared by name (ours) has no OID until a connection resolves it.
    if ty.oid().is_none() {
        return *ty == money_type();
    }
    // In the simple (text) protocol sqlx doesn't look custom types up: a column of one is
    // declared by its OID alone, shown as "?", and `kind()` would panic on it. Accept it, as
    // sqlx's own comparison does for such types; the text decoder still checks the value.
    if ty.name() == "?" {
        return true;
    }
    if let PgTypeKind::Composite(fields) = ty.kind() {
        if let [(_, amount), (_, currency)] = &fields[..] {
            return amount.oid() == Some(Oid(NUMERIC_OID))
                && matches!(currency.oid(), Some(Oid(TEXT_OID | VARCHAR_OID)));
        }
        return false;
    }
    false
}

fn decode_record(value: PgValueRef<'_>) -> Result<MoneyRecord, BoxDynError> {
    Ok(match value.format() {
        PgValueFormat::Binary => MoneyRecord::decode_binary(value.as_bytes()?)?,
        PgValueFormat::Text => value.as_str()?.parse()?,
    })
}

impl Type<Postgres> for MoneyRecord {
    fn type_info() -> PgTypeInfo {
        money_type()
    }

    fn compatible(ty: &PgTypeInfo) -> bool {
        is_money_type(ty)
    }
}

impl PgHasArrayType for MoneyRecord {
    fn array_type_info() -> PgTypeInfo {
        PgTypeInfo::array_of(MONEY_TYPE_NAME)
    }
}

impl Decode<'_, Postgres> for MoneyRecord {
    fn decode(value: PgValueRef<'_>) -> Result<Self, BoxDynError> {
        decode_record(value)
    }
}

impl Encode<'_, Postgres> for MoneyRecord {
    fn encode_by_ref(&self, buf: &mut PgArgumentBuffer) -> Result<IsNull, BoxDynError> {
        self.encode_binary(buf)?;
        Ok(IsNull::No)
    }

    fn size_hint(&self) -> usize {
        4 + 8 + numeric_size(&self.amount) + 8 + self.currency.len()
    }
}

impl<M: MoneyValue> Type<Postgres> for PgMoney<M> {
    fn type_info() -> PgTypeInfo {
        money_type()
    }

    fn compatible(ty: &PgTypeInfo) -> bool {
        is_money_type(ty)
    }
}

impl<M: MoneyValue> PgHasArrayType for PgMoney<M> {
    fn array_type_info() -> PgTypeInfo {
        PgTypeInfo::array_of(MONEY_TYPE_NAME)
    }
}

impl<M: MoneyValue> Decode<'_, Postgres> for PgMoney<M> {
    fn decode(value: PgValueRef<'_>) -> Result<Self, BoxDynError> {
        Ok(Self::from_record(&decode_record(value)?)?)
    }
}

impl<M: MoneyValue> Encode<'_, Postgres> for PgMoney<M> {
    fn encode_by_ref(&self, buf: &mut PgArgumentBuffer) -> Result<IsNull, BoxDynError> {
        self.to_record().encode_binary(buf)?;
        Ok(IsNull::No)
    }
}

/// jsonb's and json's OIDs.
const JSONB_OID: u32 = 3802;
const JSON_OID: u32 = 114;

fn is_json_type(ty: &PgTypeInfo) -> bool {
    matches!(ty.oid(), Some(Oid(JSONB_OID | JSON_OID)))
}

/// A json or jsonb value's text: jsonb's binary format is a version byte (1) and the text, json's
/// the text alone.
fn json_text<'r>(value: &PgValueRef<'r>) -> Result<&'r str, BoxDynError> {
    let bytes = value.as_bytes()?;
    let bytes = match (value.format(), value.type_info().oid()) {
        (PgValueFormat::Binary, Some(Oid(JSONB_OID))) => match bytes.split_first() {
            Some((1, text)) => text,
            _ => {
                return Err(
                    crate::Error::Malformed("a jsonb value of an unknown format version").into(),
                );
            }
        },
        _ => bytes,
    };
    Ok(
        core::str::from_utf8(bytes)
            .map_err(|_| crate::Error::Malformed("JSON that isn't UTF-8"))?,
    )
}

impl<M: MoneyValue> Type<Postgres> for JsonColumn<M> {
    fn type_info() -> PgTypeInfo {
        PgTypeInfo::with_oid(Oid(JSONB_OID))
    }

    fn compatible(ty: &PgTypeInfo) -> bool {
        is_json_type(ty)
    }
}

impl<M: MoneyValue> Decode<'_, Postgres> for JsonColumn<M> {
    fn decode(value: PgValueRef<'_>) -> Result<Self, BoxDynError> {
        Ok(Self::from_parsed_json(json_text(&value)?)?)
    }
}

impl<M: MoneyValue> Encode<'_, Postgres> for JsonColumn<M> {
    fn encode_by_ref(&self, buf: &mut PgArgumentBuffer) -> Result<IsNull, BoxDynError> {
        let text = self.to_json()?;
        // jsonb's binary format, version 1
        buf.push(1);
        buf.extend_from_slice(text.as_bytes());
        Ok(IsNull::No)
    }
}
