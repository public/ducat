//! ducat's Postgres composite money type, `(amount numeric, currency text)`.

use core::fmt;
use core::str::FromStr;

use ducat::{AnyMoney, CurrencyCode};

use ducat_sql_core::record;

use crate::{Decimal, Error, MoneyValue};

/// The default name of the composite money type, as in ducat's `MONEY_TYPE_NAME`. The sqlx types
/// bind parameters as this type, so create it under this name (on the connection's
/// `search_path`) with [`money_type_sql`].
pub const MONEY_TYPE_NAME: &str = record::MONEY_TYPE_NAME;

/// A value of the composite money type with its fields as stored: the amount as an exact
/// [`Decimal`] and the currency as its code, unresolved.
///
/// Read this, rather than [`PgMoney`], for currencies that aren't ISO 4217 (custom codes aren't
/// registered anywhere, so `PgMoney<AnyMoney>` can't know their exponents), then make the money
/// with [`MoneyRecord::to_any_money`]. Its text form is the composite's, as ducat's
/// `toMoneyComposite` writes it and `parseMoneyComposite` reads it.
///
/// ```
/// use ducat_sqlx::pg::MoneyRecord;
///
/// let record: MoneyRecord = r#"(12.30,"EUR")"#.parse()?;
/// assert_eq!((record.amount.to_string().as_str(), record.currency.as_str()), ("12.30", "EUR"));
/// assert_eq!(record.to_string(), r#"(12.30,"EUR")"#);
/// # Ok::<(), ducat_sqlx::Error>(())
/// ```
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct MoneyRecord {
    /// The amount, with the scale it was stored at.
    pub amount: Decimal,
    /// The currency code.
    pub currency: String,
}

impl MoneyRecord {
    /// The money's fields: its amount at its own scale and its currency's code.
    #[must_use]
    pub fn from_money<M: MoneyValue>(money: &M) -> Self {
        Self {
            amount: Decimal::from_money(money),
            currency: money.currency().as_str().into(),
        }
    }

    /// The money: the amount keeps its stored scale, and never less than the currency's
    /// exponent (`(12,EUR)` is 12.00 EUR, `(1.5000,EUR)` 1.5000 EUR), as ducat's
    /// `parseMoneyComposite` reads it. For `AnyMoney` the code must be ISO 4217's; for
    /// `Money<C>` it must be `C`'s.
    ///
    /// # Errors
    ///
    /// [`Error::UnknownCurrency`] or [`Error::CurrencyMismatch`], as
    /// [`MoneyValue::resolve_currency`].
    pub fn to_money<M: MoneyValue>(&self) -> Result<M, Error> {
        let currency = M::resolve_currency(&self.currency)?;
        M::from_any(self.amount.to_money(currency)?)
    }

    /// The money in `currency`, which must have the record's code: for custom currencies, whose
    /// exponent the record doesn't carry.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] when the codes differ.
    pub fn to_any_money(&self, currency: CurrencyCode) -> Result<AnyMoney, Error> {
        if currency.as_str() != self.currency {
            return Err(Error::CurrencyMismatch {
                expected: currency.as_str().into(),
                actual: self.currency.clone(),
            });
        }
        self.amount.to_money(currency)
    }

    /// Appends the record in Postgres's binary record format (`record_send`), as the sqlx
    /// `Encode` impls send it: the field count (2), then each field's type OID, length and value,
    /// NUMERIC's binary format ([`encode_numeric`](super::encode_numeric)) for the amount and the
    /// code's UTF-8 as TEXT.
    ///
    /// # Errors
    ///
    /// [`Error::OutOfRange`] for an amount NUMERIC can't carry; nothing is appended then.
    pub fn encode_binary(&self, buffer: &mut Vec<u8>) -> Result<(), Error> {
        Ok(record::encode_binary(
            &self.amount.0,
            &self.currency,
            buffer,
        )?)
    }

    /// A record in Postgres's binary record format (`record_recv`), as
    /// [`MoneyRecord::encode_binary`] writes it and the sqlx `Decode` impls read it. The currency
    /// may also be VARCHAR.
    ///
    /// # Errors
    ///
    /// [`Error::Malformed`] for a record that isn't two fields of NUMERIC and TEXT, is truncated
    /// or has bytes after it, or whose currency isn't UTF-8; [`Error::NullField`] for a NULL
    /// field; the amount's errors as [`decode_numeric`](super::decode_numeric)'s.
    pub fn decode_binary(bytes: &[u8]) -> Result<Self, Error> {
        let (amount, currency) = record::decode_binary(bytes)?;
        Ok(Self {
            amount: Decimal(amount),
            currency,
        })
    }
}

impl FromStr for MoneyRecord {
    type Err = Error;

    /// The composite type's text, `(12.34,EUR)`, as Postgres writes it (it quotes a field with
    /// special characters and doubles `"` and `\` inside) or ducat's `toMoneyComposite` does (it
    /// always quotes the currency and escapes with `\`). The amount is NUMERIC text.
    ///
    /// # Errors
    ///
    /// [`Error::Malformed`] for text that isn't a two-field record; [`Error::NullField`] for an
    /// empty unquoted field (NULL); the amount's errors as [`Decimal`]'s `FromStr`
    /// ([`Error::NotANumber`] for `NaN`…).
    fn from_str(text: &str) -> Result<Self, Error> {
        let (amount, currency) = record::parse_text(text)?;
        Ok(Self {
            amount: Decimal(amount),
            currency,
        })
    }
}

impl fmt::Display for MoneyRecord {
    /// The composite type's text for a query parameter, as ducat's `toMoneyComposite` writes it:
    /// `(12.34,"EUR")`, the amount at its own scale and the currency always quoted, with `\` and
    /// `"` escaped by a backslash, so any code survives.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        record::write_text(f, &self.amount.0, &self.currency)
    }
}

/// Money as the composite money type ([`MONEY_TYPE_NAME`], `(amount numeric, currency text)`),
/// for [`AnyMoney`] (ISO 4217 currencies) or [`Money<C>`](ducat::Money) (the currency checked).
///
/// Writing sends the amount at the money's own scale; reading keeps the stored scale and never
/// less than the currency's exponent, so value, currency and scale round-trip, as with ducat's
/// `toMoneyComposite` and `parseMoneyComposite`. NULL fields, `NaN` and the infinities are
/// refused. A column of a composite type with other names (another schema, say) decodes as long
/// as its fields are `(numeric, text)`, but parameters are sent as [`MONEY_TYPE_NAME`].
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PgMoney<M: MoneyValue = AnyMoney>(pub M);

impl<M: MoneyValue> PgMoney<M> {
    /// The composite's fields.
    #[must_use]
    pub fn to_record(&self) -> MoneyRecord {
        MoneyRecord::from_money(&self.0)
    }

    /// The money, from the composite's fields.
    ///
    /// # Errors
    ///
    /// As [`MoneyRecord::to_money`].
    pub fn from_record(record: &MoneyRecord) -> Result<Self, Error> {
        record.to_money().map(Self)
    }
}

impl<M: MoneyValue> From<M> for PgMoney<M> {
    fn from(money: M) -> Self {
        Self(money)
    }
}

/// The DDL for the composite money type, `(amount numeric, currency text)`, and a `sum`
/// aggregate over it that raises on mixed currencies and on a value with a NULL amount or
/// currency: ducat's `moneyTypeSql`, statement for statement. The amount is an unconstrained
/// NUMERIC, so it keeps every digit and its scale. A schema-qualified name puts the type, its add
/// function and the aggregate in that schema.
///
/// Run the statements once, in order, in a migration: they are not idempotent.
///
/// ```
/// let [create_type, _add, _sum] = ducat_sqlx::pg::money_type_sql("ducat_money")?;
/// assert_eq!(create_type, "CREATE TYPE ducat_money AS (amount numeric, currency text)");
/// # Ok::<(), ducat_sqlx::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::Malformed`] unless `name` is a plain lower-case SQL name (`[a-z_][a-z0-9_]*`,
/// optionally `schema.name`) short enough for Postgres with an `_add` suffix.
pub fn money_type_sql(name: &str) -> Result<[String; 3], Error> {
    Ok(record::money_type_sql(name)?)
}
