//! ducat's Postgres composite money type, `(amount numeric, currency text)`.

use core::fmt;
use core::str::FromStr;

use ducat::{AnyMoney, CurrencyCode};

use super::numeric::{decode_numeric, encode_numeric};
use crate::{Decimal, Error, MoneyValue};

/// The default name of the composite money type, as in ducat's `MONEY_TYPE_NAME`. The sqlx types
/// bind parameters as this type, so create it under this name (on the connection's
/// `search_path`) with [`money_type_sql`].
pub const MONEY_TYPE_NAME: &str = "ducat_money";

/// Postgres's OIDs for NUMERIC, TEXT and VARCHAR, fixed in its catalogue.
pub(crate) const NUMERIC_OID: u32 = 1700;
pub(crate) const TEXT_OID: u32 = 25;
pub(crate) const VARCHAR_OID: u32 = 1043;

/// Postgres truncates longer names, which would make `name` and `name_add` collide with others.
const MAX_IDENTIFIER_LENGTH: usize = 63;

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
        let mut amount = Vec::new();
        encode_numeric(&self.amount, &mut amount)?;
        let amount_len = i32::try_from(amount.len()).map_err(|_| Error::OutOfRange)?;
        let currency_len = i32::try_from(self.currency.len()).map_err(|_| Error::OutOfRange)?;
        buffer.extend_from_slice(&2_i32.to_be_bytes());
        buffer.extend_from_slice(&NUMERIC_OID.to_be_bytes());
        buffer.extend_from_slice(&amount_len.to_be_bytes());
        buffer.extend_from_slice(&amount);
        buffer.extend_from_slice(&TEXT_OID.to_be_bytes());
        buffer.extend_from_slice(&currency_len.to_be_bytes());
        buffer.extend_from_slice(self.currency.as_bytes());
        Ok(())
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
        let mut reader = Reader(bytes);
        if reader.u32()? != 2 {
            return Err(Error::Malformed("a money composite has two fields"));
        }
        let amount = match reader.field()? {
            (NUMERIC_OID, Some(value)) => decode_numeric(value)?,
            (NUMERIC_OID, None) => return Err(Error::NullField("amount")),
            _ => return Err(Error::Malformed("a money composite's amount is a NUMERIC")),
        };
        let currency = match reader.field()? {
            (TEXT_OID | VARCHAR_OID, Some(value)) => core::str::from_utf8(value)
                .map_err(|_| Error::Malformed("a currency code that isn't UTF-8"))?
                .into(),
            (TEXT_OID | VARCHAR_OID, None) => return Err(Error::NullField("currency")),
            _ => return Err(Error::Malformed("a money composite's currency is TEXT")),
        };
        if !reader.0.is_empty() {
            return Err(Error::Malformed("bytes after a money composite"));
        }
        Ok(Self { amount, currency })
    }
}

/// A cursor over a binary record.
struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], Error> {
        if self.0.len() < len {
            return Err(Error::Malformed("a truncated record"));
        }
        let (head, tail) = self.0.split_at(len);
        self.0 = tail;
        Ok(head)
    }

    fn u32(&mut self) -> Result<u32, Error> {
        match *self.take(4)? {
            [a, b, c, d] => Ok(u32::from_be_bytes([a, b, c, d])),
            _ => Err(Error::Malformed("a truncated record")),
        }
    }

    /// A field's type OID and value, `None` for NULL (length −1).
    fn field(&mut self) -> Result<(u32, Option<&'a [u8]>), Error> {
        let oid = self.u32()?;
        let len = i32::from_be_bytes(self.u32()?.to_be_bytes());
        if len == -1 {
            return Ok((oid, None));
        }
        let len = usize::try_from(len).map_err(|_| Error::Malformed("a negative field length"))?;
        Ok((oid, Some(self.take(len)?)))
    }
}

/// Splits record text, `(12.34,EUR)` or `(12.34,"A\\B")`, into its fields, with `None` for an
/// empty unquoted field. Quoted fields are unescaped: Postgres doubles `"` and `\` inside them on
/// output, and accepts a backslash before any character on input. A port of ducat's
/// `parseRecord`.
fn parse_record(text: &str) -> Result<Vec<Option<String>>, Error> {
    let inner = text
        .strip_prefix('(')
        .and_then(|rest| rest.strip_suffix(')'))
        .ok_or(Error::Malformed("expected record text in parentheses"))?;
    let mut fields = Vec::new();
    let mut characters = inner.chars().peekable();
    loop {
        let mut field = String::new();
        let mut is_quoted_or_non_empty = false;
        while let Some(&character) = characters.peek() {
            if character == ',' {
                break;
            }
            characters.next();
            is_quoted_or_non_empty = true;
            match character {
                '"' => loop {
                    match characters.next() {
                        None => return Err(Error::Malformed("an unbalanced quote in record text")),
                        Some('\\') => match characters.next() {
                            Some(escaped) => field.push(escaped),
                            None => {
                                return Err(Error::Malformed("an unbalanced quote in record text"));
                            }
                        },
                        Some('"') if characters.peek() == Some(&'"') => {
                            characters.next();
                            field.push('"');
                        }
                        Some('"') => break,
                        Some(quoted) => field.push(quoted),
                    }
                },
                // a backslash escapes the next character; one before the closing parenthesis
                // escapes it, so the record is unterminated (ducat's parser reads the `)` into
                // the field; Postgres refuses it, as this does)
                '\\' => match characters.next() {
                    Some(escaped) => field.push(escaped),
                    None => return Err(Error::Malformed("an unterminated record")),
                },
                _ => field.push(character),
            }
        }
        fields.push(is_quoted_or_non_empty.then_some(field));
        if characters.next().is_none() {
            return Ok(fields);
        }
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
        let fields = parse_record(text)?;
        let [amount, currency] = <[Option<String>; 2]>::try_from(fields)
            .map_err(|_| Error::Malformed("expected (amount,currency) composite text"))?;
        let amount = amount.ok_or(Error::NullField("amount"))?;
        let currency = currency.ok_or(Error::NullField("currency"))?;
        Ok(Self {
            amount: amount.parse()?,
            currency,
        })
    }
}

impl fmt::Display for MoneyRecord {
    /// The composite type's text for a query parameter, as ducat's `toMoneyComposite` writes it:
    /// `(12.34,"EUR")`, the amount at its own scale and the currency always quoted, with `\` and
    /// `"` escaped by a backslash, so any code survives.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "({},\"", self.amount)?;
        for character in self.currency.chars() {
            if matches!(character, '"' | '\\') {
                f.write_str("\\")?;
            }
            write!(f, "{character}")?;
        }
        f.write_str("\")")
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

/// Is `name` a plain lower-case SQL name, optionally schema-qualified?
fn is_identifier(name: &str) -> bool {
    let part = |part: &str| {
        let mut bytes = part.bytes();
        matches!(bytes.next(), Some(b'a'..=b'z' | b'_'))
            && bytes.all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'_'))
    };
    match name.split_once('.') {
        Some((schema, rest)) => part(schema) && part(rest),
        None => part(name),
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
    if !is_identifier(name) {
        return Err(Error::Malformed(
            "not a plain lower-case SQL name (optionally schema.name)",
        ));
    }
    let (schema_prefix, type_name) = match name.split_once('.') {
        Some((schema, type_name)) => (&name[..=schema.len()], type_name),
        None => ("", name),
    };
    if type_name.len() + "_add".len() > MAX_IDENTIFIER_LENGTH {
        return Err(Error::Malformed(
            "too long for a Postgres name with an \"_add\" suffix",
        ));
    }
    let add = format!("{name}_add");
    Ok([
        format!("CREATE TYPE {name} AS (amount numeric, currency text)"),
        // search_path FROM CURRENT: the cast below resolves the same way whatever the caller's path
        format!(
            "CREATE FUNCTION {add}(total {name}, item {name}) RETURNS {name}
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path FROM CURRENT AS $$
BEGIN
  IF item IS NULL THEN
    RETURN total;
  END IF;
  IF item.amount IS NULL OR item.currency IS NULL THEN
    RAISE EXCEPTION 'a money value needs both an amount and a currency'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;
  IF total IS NULL THEN
    RETURN item;
  END IF;
  IF total.currency IS DISTINCT FROM item.currency THEN
    RAISE EXCEPTION 'cannot add % and % amounts', total.currency, item.currency
      USING ERRCODE = 'data_exception';
  END IF;
  RETURN ROW(total.amount + item.amount, total.currency)::{name};
END
$$"
        ),
        format!(
            "CREATE AGGREGATE {schema_prefix}sum({name}) (SFUNC = {add}, STYPE = {name}, COMBINEFUNC = {add}, PARALLEL = SAFE)"
        ),
    ])
}
