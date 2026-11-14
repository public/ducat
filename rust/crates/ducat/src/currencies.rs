//! Currency facts beyond the exponent: ISO 4217 numeric codes both ways, and the size of a minor
//! unit (ducat's `/currencies`). Names and symbols per locale belong to formatting, with
//! `ducat-icu`.
//!
//! ```
//! use ducat::CurrencyCode;
//! use ducat::currencies::{currency_from_numeric, minor_unit, numeric_code};
//!
//! assert_eq!(numeric_code("EUR"), Some("978"));
//! assert_eq!(currency_from_numeric("8")?, Some("ALL"));
//! assert_eq!(minor_unit("KWD".parse()?).to_decimal(), "0.001");
//! # Ok::<(), ducat::Error>(())
//! ```

use crate::currency_data::{CODES_BY_NUMERIC, NUMERIC_CODES};
use crate::{AnyMoney, CurrencyCode, Error};

/// The ISO 4217 numeric code of a code in List One, three digits as published: `"978"` for EUR,
/// `"008"` for ALL. Card networks, ISO 8583 and some ISO 20022 messages carry currencies this way.
/// The codes without a minor unit (XAU, XDR) have one too; a custom or withdrawn code has none.
#[must_use]
pub fn numeric_code(code: &str) -> Option<&'static str> {
    NUMERIC_CODES
        .binary_search_by(|(candidate, _)| (*candidate).cmp(code))
        .ok()
        .map(|index| NUMERIC_CODES[index].1)
}

/// The List One code with a numeric code, given as text: `"978"` is EUR, and `"008"` and `"8"`
/// are both ALL (surrounding whitespace is ignored). `None` for a number ISO doesn't assign. The
/// code may be one without a minor unit (`"959"` is XAU), which [`CurrencyCode`] doesn't take.
///
/// # Errors
///
/// [`Error::InvalidNumericCode`] for text that isn't one to three ASCII digits.
pub fn currency_from_numeric(numeric: &str) -> Result<Option<&'static str>, Error> {
    let digits = numeric.trim();
    if digits.is_empty() || digits.len() > 3 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(Error::InvalidNumericCode);
    }
    let number = digits
        .bytes()
        .fold(0u16, |value, byte| value * 10 + u16::from(byte - b'0'));
    currency_from_number(number)
}

/// As [`currency_from_numeric`], from the number: `8` is ALL.
///
/// # Errors
///
/// [`Error::InvalidNumericCode`] for a number above 999.
pub fn currency_from_number(number: u16) -> Result<Option<&'static str>, Error> {
    if number > 999 {
        return Err(Error::InvalidNumericCode);
    }
    let mut padded = [b'0'; 3];
    let mut rest = number;
    for digit in padded.iter_mut().rev() {
        // a digit fits a u8
        *digit = b'0' + (rest % 10) as u8;
        rest /= 10;
    }
    let padded = core::str::from_utf8(&padded).unwrap_or("");
    Ok(CODES_BY_NUMERIC
        .binary_search_by(|(candidate, _)| (*candidate).cmp(padded))
        .ok()
        .map(|index| CODES_BY_NUMERIC[index].1))
}

/// The size of the currency's minor unit, as an amount: 0.01 EUR, 1 JPY (no minor unit), 0.001
/// KWD. It follows the exponent, so a custom code works too. For the smallest coin, see
/// [`cash_unit`](crate::cash::cash_unit).
#[must_use]
pub fn minor_unit(currency: CurrencyCode) -> AnyMoney {
    AnyMoney::from_minor(1, currency)
}

impl CurrencyCode {
    /// The ISO 4217 numeric code, for an ISO code: `"978"` for EUR. As [`numeric_code`].
    #[must_use]
    pub fn numeric_code(&self) -> Option<&'static str> {
        if self.is_iso() {
            numeric_code(self.as_str())
        } else {
            None
        }
    }
}
