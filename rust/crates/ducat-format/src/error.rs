//! What can go wrong formatting or parsing.

use core::fmt;

use ducat::ErrorKind;

/// Why text isn't an amount: ducat's `SyntaxError` messages, as a value.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum SyntaxError {
    /// The text has no digits.
    NoDigits,
    /// Around the number there is something other than letters, currency symbols, spaces, bidi
    /// marks, `.`, parentheses and signs.
    UnexpectedCharacters,
    /// A character inside the number that is neither a digit nor a separator.
    UnexpectedCharacter,
    /// More than one decimal separator.
    MultipleDecimalSeparators,
    /// A group separator after the decimal separator.
    GroupAfterDecimal,
    /// Group separators where the locale doesn't put them (`1.5` in de-DE, `1,234,567` in
    /// en-IN's standard form is fine but `12,34,567` in en isn't).
    MisplacedGroups,
    /// Text around the number that is no currency.
    NotACurrency,
    /// A symbol several currencies share, with no hint or `symbols` entry to settle it.
    AmbiguousSymbol,
    /// The text names two different currencies.
    TwoCurrencies,
    /// The text names no currency (and no `hint` with `lenient` stands in for one).
    NoCurrency,
    /// The text names another currency than the `hint`.
    NotTheHint,
}

impl SyntaxError {
    const fn message(self) -> &'static str {
        match self {
            Self::NoDigits => "no digits",
            Self::UnexpectedCharacters => "unexpected characters",
            Self::UnexpectedCharacter => "an unexpected character in the number",
            Self::MultipleDecimalSeparators => "more than one decimal separator",
            Self::GroupAfterDecimal => "group separator after the decimal separator",
            Self::MisplacedGroups => "group separators in the wrong places",
            Self::NotACurrency => "text around the number is not a currency",
            Self::AmbiguousSymbol => "a symbol several currencies share; pass a hint or symbols",
            Self::TwoCurrencies => "two different currencies",
            Self::NoCurrency => "no currency in the text",
            Self::NotTheHint => "another currency than the hint",
        }
    }
}

/// An error from formatting or parsing.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum Error {
    /// A locale tag that isn't a structurally valid BCP 47 tag (`Intl`'s `RangeError`).
    InvalidLocale,
    /// A locale this build has no data for (its language and region), which parsing refuses
    /// rather than read with another locale's separators (ducat's `RangeError`).
    NoLocaleData,
    /// Options that contradict each other: `rounding` without `digits`, or `Intl`'s digit options
    /// beside `digits`, which would round twice (ducat's `TypeError`).
    ConflictingOptions,
    /// An option out of range (`Intl`'s `RangeError`): fraction digits beyond 100 or a minimum
    /// above the maximum, significant digits outside 1 to 21, an increment `Intl` doesn't take.
    InvalidOptions,
    /// A currency code that isn't three letters, which `Intl` can't format (`RangeError`).
    InvalidCurrency,
    /// Text longer than [`MAX_INPUT`](crate::MAX_INPUT) bytes.
    InputTooLong,
    /// Text that isn't an amount (ducat's `SyntaxError`).
    Syntax(SyntaxError),
    /// An error from ducat's money: [`ducat::Error::Rounding`] for more decimals than the scale
    /// without a rounding mode, or an invalid scale.
    Money(ducat::Error),
    /// The built CLDR data has a pattern this crate can't read (a bug; it is checked by tests).
    MalformedData,
}

impl Error {
    /// The neutral kind of this error, as ducat's conformance suite names it.
    #[must_use]
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::ConflictingOptions => ErrorKind::Type,
            Self::Syntax(_) => ErrorKind::Syntax,
            Self::Money(error) => error.kind(),
            Self::InvalidLocale
            | Self::NoLocaleData
            | Self::InvalidOptions
            | Self::InvalidCurrency
            | Self::InputTooLong
            | Self::MalformedData => ErrorKind::Range,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidLocale => f.write_str("not a valid BCP 47 locale tag"),
            Self::NoLocaleData => {
                f.write_str("no locale data for the locale's language and region")
            }
            Self::ConflictingOptions => {
                f.write_str("digits replaces Intl's digit and rounding options; rounding needs it")
            }
            Self::InvalidOptions => f.write_str("an option out of range"),
            Self::InvalidCurrency => f.write_str("a currency code that isn't three letters"),
            Self::InputTooLong => f.write_str("text longer than ducat-format reads"),
            Self::Syntax(error) => write!(f, "cannot parse: {}", error.message()),
            Self::Money(error) => fmt::Display::fmt(error, f),
            Self::MalformedData => f.write_str("a pattern in the built CLDR data can't be read"),
        }
    }
}

impl core::error::Error for Error {}
