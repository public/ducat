//! Currency codes, their exponents, and the marker-type trait.

use core::fmt;
use core::hash::Hash;
use core::str::FromStr;

use crate::Error;
use crate::iso_table::{ISO_EXPONENTS, NON_MONETARY};

/// The longest custom currency code.
const MAX_CODE_LEN: usize = 12;

/// The largest exponent a custom currency may have, as in ducat's `defineCurrency`.
pub const MAX_CUSTOM_EXPONENT: u8 = 30;

/// A currency: its code and its minor-unit exponent (EUR 2, JPY 0, KWD 3, CLF 4).
///
/// The exponent travels with the code, so there is no registry and no global state:
/// - [`FromStr`] (`"EUR".parse()`) and [`CurrencyCode::iso`] accept the ISO 4217 codes that
///   have a minor unit, and nothing else, so a typo is an error;
/// - [`CurrencyCode::custom`] makes a code outside ISO 4217 (crypto, loyalty points, withdrawn
///   codes), with its own exponent.
///
/// Two codes are equal when their text and exponent are, and ISO codes can't be redefined, so an
/// ISO code is only ever equal to itself.
///
/// ```
/// use ducat::CurrencyCode;
///
/// let eur: CurrencyCode = "EUR".parse()?;
/// assert_eq!((eur.as_str(), eur.exponent()), ("EUR", 2));
/// assert!("EURO".parse::<CurrencyCode>().is_err());
/// let btc = CurrencyCode::custom("BTC", 8)?;
/// assert_eq!(btc.exponent(), 8);
/// # Ok::<(), ducat::Error>(())
/// ```
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CurrencyCode {
    bytes: [u8; MAX_CODE_LEN],
    len: u8,
    exponent: u8,
}

const fn same(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut index = 0;
    while index < left.len() {
        if left[index] != right[index] {
            return false;
        }
        index += 1;
    }
    true
}

/// The ISO exponent of `code`, by binary search of the sorted table.
const fn iso_exponent(code: &[u8]) -> Option<u8> {
    let (mut low, mut high) = (0, ISO_EXPONENTS.len());
    while low < high {
        let middle = (low + high) / 2;
        let candidate = ISO_EXPONENTS[middle].0.as_bytes();
        // the table's codes are three uppercase letters: compare as such
        let mut order = 0i8;
        let mut index = 0;
        while index < 3 && order == 0 {
            let left = if index < code.len() { code[index] } else { 0 };
            if left < candidate[index] {
                order = -1;
            } else if left > candidate[index] {
                order = 1;
            }
            index += 1;
        }
        if order == 0 && code.len() != 3 {
            order = if code.len() < 3 { -1 } else { 1 };
        }
        match order {
            0 => return Some(ISO_EXPONENTS[middle].1),
            -1 => high = middle,
            _ => low = middle + 1,
        }
    }
    None
}

const fn is_non_monetary(code: &[u8]) -> bool {
    let mut index = 0;
    while index < NON_MONETARY.len() {
        if same(NON_MONETARY[index].as_bytes(), code) {
            return true;
        }
        index += 1;
    }
    false
}

impl CurrencyCode {
    const fn build(code: &[u8], exponent: u8) -> Self {
        let mut bytes = [0; MAX_CODE_LEN];
        let mut index = 0;
        while index < code.len() {
            bytes[index] = code[index];
            index += 1;
        }
        Self {
            bytes,
            len: code.len() as u8,
            exponent,
        }
    }

    /// The ISO 4217 currency with this code.
    ///
    /// # Errors
    ///
    /// [`Error::UnknownCurrency`] for a code that isn't in ISO 4217 List One with a minor unit
    /// (the non-monetary codes such as XAU and XDR have none).
    pub const fn iso(code: &str) -> Result<Self, Error> {
        match iso_exponent(code.as_bytes()) {
            Some(exponent) => Ok(Self::build(code.as_bytes(), exponent)),
            None => Err(Error::UnknownCurrency),
        }
    }

    /// A currency outside ISO 4217, with its own exponent.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidCurrency`] unless `code` is 1 to 12 ASCII letters and digits, isn't an
    /// ISO 4217 code (ISO codes can't be redefined: use an explicit scale for more precision),
    /// and `exponent` is at most [`MAX_CUSTOM_EXPONENT`].
    pub const fn custom(code: &str, exponent: u8) -> Result<Self, Error> {
        let bytes = code.as_bytes();
        if bytes.is_empty() || bytes.len() > MAX_CODE_LEN || exponent > MAX_CUSTOM_EXPONENT {
            return Err(Error::InvalidCurrency);
        }
        let mut index = 0;
        while index < bytes.len() {
            if !bytes[index].is_ascii_alphanumeric() {
                return Err(Error::InvalidCurrency);
            }
            index += 1;
        }
        if iso_exponent(bytes).is_some() || is_non_monetary(bytes) {
            return Err(Error::InvalidCurrency);
        }
        Ok(Self::build(bytes, exponent))
    }

    /// The code: `"EUR"`.
    #[must_use]
    pub fn as_str(&self) -> &str {
        // only ASCII is ever stored
        core::str::from_utf8(&self.bytes[..usize::from(self.len)]).unwrap_or("")
    }

    /// The minor-unit exponent: the scale amounts in this currency have by default.
    #[must_use]
    pub const fn exponent(&self) -> u8 {
        self.exponent
    }

    /// Whether this is an ISO 4217 code (rather than one from [`CurrencyCode::custom`]).
    #[must_use]
    pub const fn is_iso(&self) -> bool {
        iso_exponent(self.bytes.split_at(self.len as usize).0).is_some()
    }

    /// Every ISO 4217 currency with a minor unit, in code order (165 in the 2026-09-17 list).
    pub fn iso_codes() -> impl ExactSizeIterator<Item = CurrencyCode> {
        ISO_EXPONENTS
            .iter()
            .map(|&(code, exponent, _)| Self::build(code.as_bytes(), exponent))
    }
}

impl FromStr for CurrencyCode {
    type Err = Error;

    /// The ISO 4217 currency with this code; see [`CurrencyCode::iso`].
    fn from_str(code: &str) -> Result<Self, Error> {
        Self::iso(code)
    }
}

impl fmt::Display for CurrencyCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Debug for CurrencyCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_iso() {
            write!(f, "{}", self.as_str())
        } else {
            write!(f, "{}(custom, exponent {})", self.as_str(), self.exponent)
        }
    }
}

/// A currency known at compile time: a zero-sized marker type such as
/// [`ducat::iso::Eur`](crate::iso::Eur), so that `Money<Eur>` and `Money<Usd>` can't be mixed.
///
/// The ISO markers are generated in [`crate::iso`]. Define your own with
/// [`define_currency!`](crate::define_currency).
pub trait Currency: Copy + Eq + Ord + Hash + Default + fmt::Debug + Send + Sync + 'static {
    /// The currency's code and exponent.
    const CODE: CurrencyCode;
}

#[doc(hidden)]
pub const fn __custom_or_panic(code: &str, exponent: u8) -> CurrencyCode {
    match CurrencyCode::custom(code, exponent) {
        Ok(code) => code,
        Err(_) => panic!(
            "invalid custom currency: 1 to 12 ASCII letters and digits, not an ISO code, exponent at most 30"
        ),
    }
}

#[doc(hidden)]
pub const fn __iso_or_panic(code: &str) -> CurrencyCode {
    match CurrencyCode::iso(code) {
        Ok(code) => code,
        Err(_) => panic!("not an ISO 4217 code with a minor unit"),
    }
}

/// Defines a marker type for a currency outside ISO 4217, checked at compile time.
///
/// ```
/// ducat::define_currency! {
///     /// Bitcoin, in satoshis.
///     pub Btc = "BTC", 8
/// }
/// use ducat::{Currency, Money};
///
/// let fee: Money<Btc> = "0.00001".parse()?;
/// assert_eq!(fee.scale(), 8);
/// assert_eq!(Btc::CODE.as_str(), "BTC");
/// # Ok::<(), ducat::Error>(())
/// ```
#[macro_export]
macro_rules! define_currency {
    ($(#[$meta:meta])* $vis:vis $name:ident = $code:literal, $exponent:literal) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
        $vis struct $name;

        impl $crate::Currency for $name {
            const CODE: $crate::CurrencyCode = $crate::__custom_or_panic($code, $exponent);
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exponents() {
        // T5
        let exponent = |code: &str| code.parse::<CurrencyCode>().map(|c| c.exponent());
        for (code, want) in [
            ("JPY", 0),
            ("KWD", 3),
            ("CLF", 4),
            ("ISK", 0),
            ("HUF", 2),
            ("MGA", 2),
            ("MRU", 2),
            ("IDR", 2),
            ("IQD", 3),
            ("UYW", 4),
            ("VND", 0),
            ("XCG", 2),
            ("SLE", 2),
            ("VES", 2),
            ("VED", 2),
            ("EUR", 2),
            ("AED", 2),
            ("ZWG", 2),
        ] {
            assert_eq!(exponent(code), Ok(want), "{code}");
        }
        for code in [
            "ANG", "BGN", "SLL", "XAU", "XDR", "XTS", "XXX", "eur", "EU", "EURO", "",
        ] {
            assert_eq!(exponent(code), Err(Error::UnknownCurrency), "{code}");
        }
        assert_eq!(CurrencyCode::iso_codes().len(), 165);
    }

    #[test]
    fn custom_codes() {
        let btc = CurrencyCode::custom("BTC", 8).unwrap();
        assert!(!btc.is_iso());
        assert_ne!(btc, CurrencyCode::custom("BTC", 6).unwrap());
        assert_eq!(
            CurrencyCode::custom("USDC", 6).map(|c| c.as_str().len()),
            Ok(4)
        );
        for (code, exponent) in [
            ("EUR", 2),
            ("XAU", 0),
            ("", 2),
            ("B-TC", 2),
            ("ABCDEFGHIJKLM", 2),
            ("BTC", 31),
        ] {
            assert_eq!(
                CurrencyCode::custom(code, exponent),
                Err(Error::InvalidCurrency),
                "{code}"
            );
        }
        assert_eq!(alloc::format!("{btc:?}"), "BTC(custom, exponent 8)");
    }
}
