//! The crate's error type.

use core::fmt;

use crate::DecimalColumnSize;

/// Why a value couldn't be read from, or written to, a column.
///
/// Every `FromSql` and `ToSql` impl in this crate returns this, boxed as diesel's
/// `Box<dyn Error + Send + Sync>`; nothing panics on any input. A reading error reaches the
/// caller as `diesel::result::Error::DeserializationError` (its box holds diesel's
/// `DeserializeFieldError`, naming the field, whose `error` downcasts to this) and a writing error
/// as `diesel::result::Error::SerializationError`, whose box downcasts to this. The conversions
/// ([`minor_units`](crate::minor_units), [`DecimalColumnSize::fit`](crate::DecimalColumnSize::fit),
/// [`DecimalColumn::to_decimal`](crate::DecimalColumn::to_decimal)) return it directly, before a
/// query is built.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum Error {
    /// A Postgres NUMERIC `NaN`, which is not an amount.
    NotANumber,
    /// A Postgres NUMERIC `Infinity` or `-Infinity`, which is not an amount.
    Infinite {
        /// `-Infinity`.
        negative: bool,
    },
    /// Bytes or text that aren't a valid value of the column's type: a truncated NUMERIC, a
    /// digit beyond 9999, NUMERIC digits the display scale would hide, decimal text outside
    /// `-?[0-9]+(\.[0-9]+)?`, composite text that isn't `(amount,currency)`, or a JSON column's
    /// text that isn't JSON (ducat's `SyntaxError`).
    Malformed(&'static str),
    /// A value of a column type this column shape doesn't read: a SQLite REAL where TEXT or
    /// INTEGER was expected, a MySQL DOUBLE where DECIMAL was. The name is the database's.
    UnexpectedType(String),
    /// An amount beyond what the column type holds: more than ±(2^63 − 1) minor units for a
    /// BIGINT or INTEGER, or more digits than Postgres NUMERIC's binary format can carry.
    OutOfRange,
    /// Money at another scale than the column stores. Columns of minor units and fixed-currency
    /// decimals hold amounts at the currency's exponent; round the money first (with the
    /// rounding you choose), as ducat's `checkIsoScale` asks.
    ScaleMismatch {
        /// The money's scale.
        scale: u16,
        /// The scale the column stores.
        expected: u16,
    },
    /// A composite value in another currency than the `Money<C>` it is read into.
    CurrencyMismatch {
        /// The column's (the type's) currency.
        expected: String,
        /// The value's.
        actual: String,
    },
    /// A composite currency code that isn't an ISO 4217 code with a minor unit. Custom currencies
    /// aren't registered anywhere: read them as a `MoneyRecord` and give the `CurrencyCode`, or
    /// into a `Money<C>` of a `define_currency!` type.
    UnknownCurrency(String),
    /// A composite value with a NULL amount (`"amount"`) or currency (`"currency"`).
    NullField(&'static str),
    /// A NUMERIC(precision, scale) that isn't valid: precision at least 1, scale from 0 to the
    /// precision.
    InvalidColumnSize(DecimalColumnSize),
    /// A column scale below the currency's exponent, which would round every amount.
    ColumnScaleBelowExponent {
        /// The column's size.
        size: DecimalColumnSize,
        /// The currency's exponent.
        exponent: u8,
    },
    /// Money with more significant decimals than the column's scale: Postgres would round it on
    /// insert, silently.
    WouldRound {
        /// The column's size.
        size: DecimalColumnSize,
        /// The significant decimals of the money (trailing zeros don't count).
        decimals: u16,
    },
    /// Money with more integer digits than the column holds: Postgres rejects it, and MySQL
    /// outside strict mode stores the column's limit instead.
    TooManyIntegerDigits {
        /// The column's size.
        size: DecimalColumnSize,
    },
    /// A scale column's value that isn't a scale: NULL (`None`), negative, or beyond
    /// [`ducat::MAX_SCALE`] (ducat's `readScale`, which caps it as parsed decimals are, so that
    /// a corrupt row can't build a huge power of ten).
    InvalidScaleColumn(Option<i64>),
    /// JSON that isn't ducat's money JSON: not an object, or an object whose `amount` or
    /// `currency` isn't a string (`{"amount": 12.34, …}`, a missing field), ducat's `fromJSON`
    /// `TypeError`. Text that isn't JSON at all is [`Error::Malformed`].
    NotMoneyJson,
    /// An error from ducat itself, such as a scale beyond [`ducat::MAX_SCALE`]
    /// ([`ducat::Error::InvalidScale`]) or a decimal with more digits than the currency's exponent
    /// ([`ducat::Error::Rounding`]).
    Ducat(ducat::Error),
}

impl From<ducat::Error> for Error {
    fn from(error: ducat::Error) -> Self {
        Self::Ducat(error)
    }
}

impl From<ducat_sql_core::Error> for Error {
    fn from(error: ducat_sql_core::Error) -> Self {
        use ducat_sql_core::Error as Core;
        match error {
            Core::NotANumber => Self::NotANumber,
            Core::Infinite { negative } => Self::Infinite { negative },
            Core::Malformed(reason) => Self::Malformed(reason),
            Core::ScaleMismatch { scale, expected } => Self::ScaleMismatch { scale, expected },
            Core::NullField(field) => Self::NullField(field),
            Core::InvalidColumnSize(size) => Self::InvalidColumnSize(DecimalColumnSize(size)),
            Core::ColumnScaleBelowExponent { size, exponent } => Self::ColumnScaleBelowExponent {
                size: DecimalColumnSize(size),
                exponent,
            },
            Core::WouldRound { size, decimals } => Self::WouldRound {
                size: DecimalColumnSize(size),
                decimals,
            },
            Core::TooManyIntegerDigits { size } => Self::TooManyIntegerDigits {
                size: DecimalColumnSize(size),
            },
            Core::OutOfRange => Self::OutOfRange,
            Core::InvalidScaleColumn(value) => Self::InvalidScaleColumn(value),
            Core::NotMoneyJson => Self::NotMoneyJson,
            Core::Ducat(error) => Self::Ducat(error),
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotANumber => f.write_str("NUMERIC 'NaN' is not an amount"),
            Self::Infinite { negative: false } => {
                f.write_str("NUMERIC 'Infinity' is not an amount")
            }
            Self::Infinite { negative: true } => {
                f.write_str("NUMERIC '-Infinity' is not an amount")
            }
            Self::Malformed(reason) => write!(f, "malformed column value: {reason}"),
            Self::UnexpectedType(name) => {
                write!(f, "a {name} value can't be read as an exact amount")
            }
            Self::OutOfRange => f.write_str("the amount is beyond the range of the column type"),
            Self::ScaleMismatch { scale, expected } => write!(
                f,
                "the money has scale {scale}; round it to {expected} decimals before storing it"
            ),
            Self::CurrencyMismatch { expected, actual } => {
                write!(f, "expected an amount in {expected}, got one in {actual}")
            }
            Self::UnknownCurrency(code) => write!(f, "unknown currency code {code:?}"),
            Self::NullField(field) => {
                write!(
                    f,
                    "a money composite needs both an amount and a currency; the {field} is NULL"
                )
            }
            Self::InvalidColumnSize(size) => write!(f, "{size} is not a valid column size"),
            Self::ColumnScaleBelowExponent { size, exponent } => {
                write!(f, "{size} would round a currency with {exponent} decimals")
            }
            Self::WouldRound { size, decimals } => write!(
                f,
                "the money has {decimals} decimals; {size} would round it to {}",
                size.scale()
            ),
            Self::TooManyIntegerDigits { size } => write!(
                f,
                "the money does not fit {size}, which holds {} integer digits",
                size.precision() - size.scale()
            ),
            Self::InvalidScaleColumn(None) => write!(
                f,
                "expected an integer scale from 0 to {} in the scale column, got NULL",
                ducat::MAX_SCALE
            ),
            Self::InvalidScaleColumn(Some(value)) => write!(
                f,
                "expected an integer scale from 0 to {} in the scale column, got {value}",
                ducat::MAX_SCALE
            ),
            Self::NotMoneyJson => f.write_str("expected { amount: string, currency: string }"),
            Self::Ducat(error) => fmt::Display::fmt(error, f),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Ducat(error) => Some(error),
            _ => None,
        }
    }
}
