//! The error type every fallible operation returns.

use core::fmt;

use crate::CurrencyCode;

/// Why an operation failed.
///
/// Every variant maps onto one of the five neutral kinds of ducat's conformance suite (see
/// [`Error::kind`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Error {
    /// The exact result doesn't fit the scale, and the rounding mode was
    /// [`Rounding::Unnecessary`](crate::Rounding::Unnecessary).
    Rounding,
    /// Two amounts in different currencies were combined.
    CurrencyMismatch {
        /// The currency of the value the operation was called on.
        expected: CurrencyCode,
        /// The currency of the other operand.
        actual: CurrencyCode,
    },
    /// A result or an intermediate value doesn't fit an `i128`.
    Overflow,
    /// A division by zero, or a ratio with a zero denominator.
    DivisionByZero,
    /// A scale that isn't an integer from 0 to [`MAX_SCALE`](crate::MAX_SCALE).
    InvalidScale,
    /// A currency code that isn't in ISO 4217 List One with a minor unit, and wasn't made with
    /// [`CurrencyCode::custom`].
    UnknownCurrency,
    /// A custom currency code or exponent that isn't allowed (see [`CurrencyCode::custom`]).
    InvalidCurrency,
    /// Text that doesn't follow the grammar it is parsed with.
    Syntax,
    /// A decimal string's exponent, or its number of decimal places, is beyond
    /// [`MAX_SCALE`](crate::MAX_SCALE).
    ExponentOutOfRange,
    /// A floating-point value that is NaN or infinite.
    NotFinite,
    /// A floating-point value whose shortest decimal form has more than 15 significant digits,
    /// so it can't be told apart from a floating-point artefact. Pass a decimal string instead.
    TooManyDigits,
    /// An exchange rate that is zero or negative.
    NonPositiveRate,
    /// An allocation with no weights, or a split or instalment plan with a count of zero.
    NoWeights,
    /// An allocation whose weights are all zero.
    ZeroWeights,
    /// A negative allocation weight or percentage.
    NegativeWeight,
    /// A unit, maximum or increment that must be positive and isn't.
    NotPositive,
    /// A total that must not be negative (for `chunk`) and is.
    NegativeTotal,
    /// A schedule that can't add up to its total: more than one rest tranche, percentages over
    /// 100, tranches that exceed the total, or a leftover with no rest tranche.
    InvalidSchedule,
}

/// The neutral error kinds of ducat's conformance suite.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ErrorKind {
    /// The exact result doesn't fit the scale, and rounding wasn't allowed.
    Rounding,
    /// The operands have different currencies.
    CurrencyMismatch,
    /// An argument (or a result) is out of range.
    Range,
    /// Text that doesn't parse.
    Syntax,
    /// An argument of the wrong kind.
    Type,
}

impl Error {
    /// The neutral kind of this error, as ducat's conformance suite names it.
    #[must_use]
    pub const fn kind(&self) -> ErrorKind {
        match self {
            Self::Rounding => ErrorKind::Rounding,
            Self::CurrencyMismatch { .. } => ErrorKind::CurrencyMismatch,
            Self::Syntax => ErrorKind::Syntax,
            Self::InvalidCurrency => ErrorKind::Type,
            Self::Overflow
            | Self::DivisionByZero
            | Self::InvalidScale
            | Self::UnknownCurrency
            | Self::ExponentOutOfRange
            | Self::NotFinite
            | Self::TooManyDigits
            | Self::NonPositiveRate
            | Self::NoWeights
            | Self::ZeroWeights
            | Self::NegativeWeight
            | Self::NotPositive
            | Self::NegativeTotal
            | Self::InvalidSchedule => ErrorKind::Range,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Rounding => f.write_str("the exact result needs rounding, and rounding is unnecessary"),
            Self::CurrencyMismatch { expected, actual } => {
                write!(f, "currency mismatch: {expected} vs {actual}")
            }
            Self::Overflow => f.write_str("the value doesn't fit an i128"),
            Self::DivisionByZero => f.write_str("division by zero"),
            Self::InvalidScale => {
                write!(f, "invalid scale: use an integer from 0 to {}", crate::MAX_SCALE)
            }
            Self::UnknownCurrency => f.write_str("unknown currency (not an ISO 4217 code with a minor unit)"),
            Self::InvalidCurrency => f.write_str("invalid custom currency code or exponent"),
            Self::Syntax => f.write_str("invalid decimal string"),
            Self::ExponentOutOfRange => {
                write!(f, "decimal exponent or decimal places beyond {}", crate::MAX_SCALE)
            }
            Self::NotFinite => f.write_str("the floating-point value is not finite"),
            Self::TooManyDigits => f.write_str(
                "the floating-point value has more than 15 significant digits; pass a decimal string",
            ),
            Self::NonPositiveRate => f.write_str("an exchange rate must be positive"),
            Self::NoWeights => f.write_str("there must be at least one weight (or a count of at least one)"),
            Self::ZeroWeights => f.write_str("the weights must not all be zero"),
            Self::NegativeWeight => f.write_str("a weight must not be negative"),
            Self::NotPositive => f.write_str("the unit, maximum or increment must be positive"),
            Self::NegativeTotal => f.write_str("the total must not be negative"),
            Self::InvalidSchedule => f.write_str(
                "the tranches can't add up to the total: one rest at most, percentages at most 100, no more than the total, and a rest for any leftover",
            ),
        }
    }
}

impl core::error::Error for Error {}
