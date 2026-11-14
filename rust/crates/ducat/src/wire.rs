//! Money to and from the formats other systems send, exactly both ways (ducat's
//! `@ducatjs/money/wire`):
//!
//! - [`GoogleMoney`], `google.type.Money` (`currencyCode`, `units`, `nanos`), as Google APIs and
//!   many gRPC services use it;
//! - [`Iso20022Amount`], an ISO 20022 amount (`<InstdAmt Ccy="EUR">12.34</InstdAmt>` as its
//!   attribute and text): a non-negative decimal with at most 5 decimals and 18 digits;
//! - [`MinorUnitAmount`], `{ value, currency }` in ISO 4217 minor units;
//! - [`DineroObject`], dinero.js 1's `toObject()` shape `{ amount, currency, precision }`.
//!
//! Every reader checks the format strictly, and every writer refuses a value the format can't hold:
//! malformed input is an error, never a rounding. With the `serde` feature each type reads and
//! writes its format's JSON shape.
//!
//! ```
//! use ducat::iso::Eur;
//! use ducat::wire::{GoogleMoney, WireReadOptions};
//! use ducat::{Money, Rounding};
//!
//! let price: Money<Eur> = "-1.75".parse()?;
//! let google = price.to_google_money(Rounding::Unnecessary)?;
//! assert_eq!((google.units, google.nanos), (-1, -750_000_000));
//! let back = Money::<Eur>::from_google_money(&google, &WireReadOptions::default())?;
//! assert_eq!(back, price);
//! # Ok::<(), ducat::Error>(())
//! ```

use alloc::string::String;

use crate::amount::Amount;
use crate::{AnyMoney, Currency, CurrencyCode, Error, Int, Money, Rounding};

const NANOS_PER_UNIT: i64 = 1_000_000_000;
const MAX_NANOS: i32 = 999_999_999;
/// 2^53 − 1: JSON numbers hold integers exactly up to here.
const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;
const ISO_20022_MAX_DECIMALS: u16 = 5;
const ISO_20022_MAX_DIGITS: usize = 18;

/// Options for the readers: the scale of the money they return, and how to round to it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct WireReadOptions {
    /// The result's scale (default: the currency's ISO exponent).
    pub scale: Option<u16>,
    /// How to round when the value has more decimals than that (default
    /// [`Rounding::Unnecessary`]: an error).
    pub rounding: Rounding,
}

impl Default for WireReadOptions {
    fn default() -> Self {
        Self {
            scale: None,
            rounding: Rounding::Unnecessary,
        }
    }
}

fn is_code(text: &str) -> bool {
    text.len() == 3 && text.bytes().all(|byte| byte.is_ascii_uppercase())
}

/// A currency a reader returns money in: ISO 4217, current or withdrawn.
fn read_currency(code: &str) -> Result<CurrencyCode, Error> {
    CurrencyCode::iso(code).or_else(|_| withdrawn(code).ok_or(Error::UnknownCurrency))
}

/// A withdrawn ISO 4217 code (List Three), not one ISO never published (CNH).
fn withdrawn(code: &str) -> Option<CurrencyCode> {
    crate::historic::currency(code)
        .filter(|entry| entry.withdrawn().is_some())
        .map(|entry| entry.code())
}

/// `value` (a count of 10^−`from` units) at the options' scale.
fn at_scale(
    value: Int,
    from: u16,
    currency: CurrencyCode,
    options: &WireReadOptions,
) -> Result<AnyMoney, Error> {
    let scale = options.scale.unwrap_or(u16::from(currency.exponent()));
    let exact = Amount {
        units: value,
        scale: from,
    };
    Ok(AnyMoney::from_parts(
        exact.rescale(scale, options.rounding)?,
        currency,
    ))
}

fn of_type<C: Currency>(money: AnyMoney) -> Result<Money<C>, Error> {
    if money.currency() == C::CODE {
        Ok(Money::from_amount(money.amount))
    } else {
        Err(Error::CurrencyMismatch {
            expected: C::CODE,
            actual: money.currency(),
        })
    }
}

// --- google.type.Money --------------------------------------------------------------------------

/// `google.type.Money`: `units` the whole units, `nanos` the billionths, with the same sign as a
/// non-zero `units` (<https://github.com/googleapis/googleapis/blob/master/google/type/money.proto>).
/// `-1.75` is `units` −1 and `nanos` −750,000,000.
///
/// With `serde`, it is written in its ProtoJSON form (`units` an int64 string) and read as
/// ProtoJSON allows (<https://protobuf.dev/programming-guides/json/>): `units` and `nanos` as
/// numbers or strings, exponent notation included, when the value is an exact integer; a missing
/// one is 0.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct GoogleMoney {
    /// The ISO 4217 code: three capital letters.
    pub currency_code: String,
    /// The whole units.
    pub units: i64,
    /// The billionths, −999,999,999 to 999,999,999, with the sign of a non-zero `units`.
    pub nanos: i32,
}

impl GoogleMoney {
    /// A checked value.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidWire`] for a code that isn't three capital letters, `nanos` out of range,
    /// or `nanos` with a sign other than a non-zero `units`'s.
    pub fn new(currency_code: &str, units: i64, nanos: i32) -> Result<Self, Error> {
        let value = Self {
            currency_code: currency_code.into(),
            units,
            nanos,
        };
        value.check()?;
        Ok(value)
    }

    fn check(&self) -> Result<(), Error> {
        let mixed = (self.units > 0 && self.nanos < 0) || (self.units < 0 && self.nanos > 0);
        if !is_code(&self.currency_code) || !(-MAX_NANOS..=MAX_NANOS).contains(&self.nanos) || mixed
        {
            return Err(Error::InvalidWire);
        }
        Ok(())
    }
}

fn to_google(money: &AnyMoney, rounding: Rounding) -> Result<GoogleMoney, Error> {
    let code = money.currency();
    if !is_code(code.as_str()) {
        return Err(Error::InvalidWire);
    }
    let total = money.amount.rescale(9, rounding)?.units;
    // the quotient truncates toward zero and the remainder takes its sign, so units and nanos
    // share it
    let (units, nanos) = total.div_rem(&Int::from(NANOS_PER_UNIT));
    let units = units.to_i64().ok_or(Error::Overflow)?;
    let nanos = i32::try_from(nanos.to_i64().unwrap_or(0)).unwrap_or(0);
    GoogleMoney::new(code.as_str(), units, nanos)
}

fn from_google(value: &GoogleMoney, options: &WireReadOptions) -> Result<AnyMoney, Error> {
    value.check()?;
    let currency = read_currency(&value.currency_code)?;
    let total = Int::from(value.units) * Int::from(NANOS_PER_UNIT) + Int::from(value.nanos);
    at_scale(total, 9, currency, options)
}

// --- ISO 20022 ----------------------------------------------------------------------------------

/// An ISO 20022 amount, as in `<InstdAmt Ccy="EUR">12.34</InstdAmt>`: `ccy` is the attribute and
/// `value` the element's text. With `serde`, it is `{ "Ccy": "EUR", "value": "12.34" }`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Iso20022Amount {
    /// The ISO 4217 code.
    pub ccy: String,
    /// The decimal text.
    pub value: String,
}

/// Whether ISO 20022's ActiveOrHistoricCurrencyCode takes the code: ISO 4217, current (including
/// the codes with no minor unit, XAU and XDR) or withdrawn.
fn is_iso_4217(code: CurrencyCode) -> bool {
    let text = code.as_str();
    CurrencyCode::iso(text).is_ok_and(|iso| iso == code)
        || CurrencyCode::iso_non_monetary().any(|known| known == text)
        || withdrawn(text).is_some()
}

/// Whether a decimal's value fits the schema's facets, counting digits as XSD does: leading zeros
/// and trailing fraction zeros don't count.
fn fits_iso_20022(whole: &str, fraction: &str) -> bool {
    let fraction = fraction.trim_end_matches('0');
    let whole = whole.trim_start_matches('0');
    fraction.len() <= usize::from(ISO_20022_MAX_DECIMALS)
        && whole.len() + fraction.len() <= ISO_20022_MAX_DIGITS
}

fn to_iso_20022(
    money: &AnyMoney,
    rounding: Rounding,
    scale: Option<u16>,
) -> Result<Iso20022Amount, Error> {
    let code = money.currency();
    if !is_iso_4217(code) {
        return Err(Error::UnknownCurrency);
    }
    let scale = scale.unwrap_or(u16::from(code.exponent()));
    if scale > ISO_20022_MAX_DECIMALS {
        return Err(Error::InvalidWire);
    }
    let amount = money.amount.rescale(scale, rounding)?;
    // the direction goes in the message's credit/debit indicator
    if amount.units.is_negative() {
        return Err(Error::InvalidWire);
    }
    let mut value = String::new();
    let _ = amount.write(&mut value);
    let (whole, fraction) = value.split_once('.').unwrap_or((&value, ""));
    if !fits_iso_20022(whole, fraction) {
        return Err(Error::Overflow);
    }
    Ok(Iso20022Amount {
        ccy: code.as_str().into(),
        value,
    })
}

fn from_iso_20022(amount: &Iso20022Amount, options: &WireReadOptions) -> Result<AnyMoney, Error> {
    if !is_code(&amount.ccy) {
        return Err(Error::Syntax);
    }
    let currency = read_currency(&amount.ccy)?;
    // an xs:decimal (XML Schema 1.0, 3.2.3.1): an optional sign, digits, an optional point and
    // digits; "12." and ".5" are only in XSD 1.1's lexical rule
    let text = amount.value.as_str();
    let (negative, unsigned) = match text.as_bytes().first() {
        Some(b'+') => (false, &text[1..]),
        Some(b'-') => (true, &text[1..]),
        _ => (false, text),
    };
    let (whole, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
    let shaped = digits(whole) && (!unsigned.contains('.') || digits(fraction));
    if !shaped || !fits_iso_20022(whole, fraction) {
        return Err(Error::Syntax);
    }
    let mut joined = String::from(whole);
    joined.push_str(fraction);
    let units: Int = joined.parse()?;
    // minInclusive 0: "-0" is zero, any other negative is out of range
    if negative && !units.is_zero() {
        return Err(Error::InvalidWire);
    }
    // at most 5 decimals
    let from = u16::try_from(fraction.len()).map_err(|_| Error::Syntax)?;
    at_scale(units, from, currency, options)
}

// --- ISO 4217 minor units -----------------------------------------------------------------------

/// An integer count of the currency's ISO 4217 minor units: `{ value: 1234, currency: "EUR" }` for
/// 12.34 EUR. The same shape as Adyen's `amount`, at the ISO exponent.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct MinorUnitAmount {
    /// The minor units.
    pub value: i64,
    /// The ISO 4217 code.
    pub currency: String,
}

fn to_minor_units(money: &AnyMoney, rounding: Rounding) -> Result<MinorUnitAmount, Error> {
    let code = money.currency();
    let units = money
        .amount
        .rescale(u16::from(code.exponent()), rounding)?
        .units;
    let value = units
        .to_i64()
        .filter(|value| value.unsigned_abs() <= MAX_SAFE_INTEGER.unsigned_abs())
        .ok_or(Error::Overflow)?;
    Ok(MinorUnitAmount {
        value,
        currency: code.as_str().into(),
    })
}

fn from_minor_units(amount: &MinorUnitAmount) -> Result<AnyMoney, Error> {
    Ok(AnyMoney::from_minor(
        amount.value,
        read_currency(&amount.currency)?,
    ))
}

// --- dinero.js ----------------------------------------------------------------------------------

/// dinero.js 1's `toObject()` shape: `amount` an integer count of 10^−`precision` units of
/// `currency`. `{ amount: 1234, currency: "EUR", precision: 2 }` is 12.34 EUR, and the documented
/// `Dinero({ amount: 500 }).toObject()` is `{ amount: 500, currency: "USD", precision: 2 }`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct DineroObject {
    /// The count of 10^−`precision` units.
    pub amount: i64,
    /// The ISO 4217 code.
    pub currency: String,
    /// The scale, 0 to 1000.
    pub precision: u16,
}

fn to_dinero(money: &AnyMoney) -> Result<DineroObject, Error> {
    let amount = money
        .amount
        .units
        .to_i64()
        .filter(|value| value.unsigned_abs() <= MAX_SAFE_INTEGER.unsigned_abs())
        .ok_or(Error::Overflow)?;
    Ok(DineroObject {
        amount,
        currency: money.currency().as_str().into(),
        precision: money.scale(),
    })
}

fn from_dinero(object: &DineroObject) -> Result<AnyMoney, Error> {
    let currency = read_currency(&object.currency)?;
    AnyMoney::from_units(object.amount, object.precision, currency)
}

// --- the methods --------------------------------------------------------------------------------

impl AnyMoney {
    /// As `google.type.Money`, rounded to 9 decimals only with `rounding`.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] for more than 9 decimals with [`Rounding::Unnecessary`];
    /// [`Error::Overflow`] when the whole units don't fit in an int64; [`Error::InvalidWire`] for a
    /// code that isn't three capital letters.
    pub fn to_google_money(&self, rounding: Rounding) -> Result<GoogleMoney, Error> {
        to_google(self, rounding)
    }

    /// Reads `google.type.Money` exactly, at `options.scale` (default the currency's exponent).
    ///
    /// # Errors
    ///
    /// [`Error::InvalidWire`] for a malformed value; [`Error::UnknownCurrency`]; [`Error::Rounding`]
    /// for more decimals than the result's scale with [`Rounding::Unnecessary`].
    pub fn from_google_money(
        value: &GoogleMoney,
        options: &WireReadOptions,
    ) -> Result<Self, Error> {
        from_google(value, options)
    }

    /// As an ISO 20022 amount, at the currency's decimals (or `scale`, at most 5), as the payment
    /// networks' rules (CBPR+, HVPS+) require: 12.3400 EUR at scale 4 is written `12.34`.
    ///
    /// # Errors
    ///
    /// [`Error::UnknownCurrency`] for a code that isn't ISO 4217, current or withdrawn;
    /// [`Error::InvalidWire`] for a negative amount (the direction goes in the credit/debit
    /// indicator) or a scale above 5; [`Error::Overflow`] for more than 18 digits;
    /// [`Error::Rounding`] for more decimals with [`Rounding::Unnecessary`].
    pub fn to_iso20022_amount(
        &self,
        rounding: Rounding,
        scale: Option<u16>,
    ) -> Result<Iso20022Amount, Error> {
        to_iso_20022(self, rounding, scale)
    }

    /// Reads an ISO 20022 amount exactly: an `xs:decimal` with an optional sign, at most 5
    /// decimals and 18 digits (not counting leading or trailing zeros), and no exponent or spaces.
    /// `+12.34` is 12.34 and `-0` is zero; `12.` and `.5`, which only XSD 1.1 allows, are refused.
    ///
    /// # Errors
    ///
    /// [`Error::Syntax`] for any other text or a malformed code; [`Error::InvalidWire`] for a
    /// negative amount; [`Error::UnknownCurrency`]; [`Error::Rounding`] as
    /// [`AnyMoney::from_google_money`].
    pub fn from_iso20022_amount(
        amount: &Iso20022Amount,
        options: &WireReadOptions,
    ) -> Result<Self, Error> {
        from_iso_20022(amount, options)
    }

    /// As `{ value, currency }` in ISO 4217 minor units, rounded only with `rounding`.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] for more decimals than the currency has with
    /// [`Rounding::Unnecessary`]; [`Error::Overflow`] beyond 2^53 − 1 minor units, which JSON
    /// numbers can't hold exactly.
    pub fn to_minor_units(&self, rounding: Rounding) -> Result<MinorUnitAmount, Error> {
        to_minor_units(self, rounding)
    }

    /// Reads `{ value, currency }` in ISO 4217 minor units.
    ///
    /// # Errors
    ///
    /// [`Error::UnknownCurrency`].
    pub fn from_minor_units(amount: &MinorUnitAmount) -> Result<Self, Error> {
        from_minor_units(amount)
    }

    /// As dinero.js 1's `{ amount, currency, precision }`, at this money's scale: nothing is
    /// rounded.
    ///
    /// # Errors
    ///
    /// [`Error::Overflow`] beyond 2^53 − 1 units (dinero.js amounts are numbers).
    pub fn to_dinero_object(&self) -> Result<DineroObject, Error> {
        to_dinero(self)
    }

    /// Reads dinero.js 1's `{ amount, currency, precision }` exactly, at its precision: dinero.js
    /// gives every currency precision 2 unless told otherwise, so `{ amount: 500, currency: "JPY",
    /// precision: 2 }` is 5.00 JPY.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidScale`] for a precision past 1000; [`Error::UnknownCurrency`].
    pub fn from_dinero_object(object: &DineroObject) -> Result<Self, Error> {
        from_dinero(object)
    }
}

impl<C: Currency> Money<C> {
    /// As [`AnyMoney::to_google_money`].
    ///
    /// # Errors
    ///
    /// As [`AnyMoney::to_google_money`].
    pub fn to_google_money(&self, rounding: Rounding) -> Result<GoogleMoney, Error> {
        to_google(&self.to_any(), rounding)
    }

    /// As [`AnyMoney::from_google_money`], in `C`.
    ///
    /// # Errors
    ///
    /// As [`AnyMoney::from_google_money`]; [`Error::CurrencyMismatch`] for another currency.
    pub fn from_google_money(
        value: &GoogleMoney,
        options: &WireReadOptions,
    ) -> Result<Self, Error> {
        of_type(from_google(value, options)?)
    }

    /// As [`AnyMoney::to_iso20022_amount`].
    ///
    /// # Errors
    ///
    /// As [`AnyMoney::to_iso20022_amount`].
    pub fn to_iso20022_amount(
        &self,
        rounding: Rounding,
        scale: Option<u16>,
    ) -> Result<Iso20022Amount, Error> {
        to_iso_20022(&self.to_any(), rounding, scale)
    }

    /// As [`AnyMoney::from_iso20022_amount`], in `C`.
    ///
    /// # Errors
    ///
    /// As [`AnyMoney::from_iso20022_amount`]; [`Error::CurrencyMismatch`] for another currency.
    pub fn from_iso20022_amount(
        amount: &Iso20022Amount,
        options: &WireReadOptions,
    ) -> Result<Self, Error> {
        of_type(from_iso_20022(amount, options)?)
    }

    /// As [`AnyMoney::to_minor_units`].
    ///
    /// # Errors
    ///
    /// As [`AnyMoney::to_minor_units`].
    pub fn to_minor_units(&self, rounding: Rounding) -> Result<MinorUnitAmount, Error> {
        to_minor_units(&self.to_any(), rounding)
    }

    /// As [`AnyMoney::from_minor_units`], in `C`.
    ///
    /// # Errors
    ///
    /// As [`AnyMoney::from_minor_units`]; [`Error::CurrencyMismatch`] for another currency.
    pub fn from_minor_units(amount: &MinorUnitAmount) -> Result<Self, Error> {
        of_type(from_minor_units(amount)?)
    }

    /// As [`AnyMoney::to_dinero_object`].
    ///
    /// # Errors
    ///
    /// As [`AnyMoney::to_dinero_object`].
    pub fn to_dinero_object(&self) -> Result<DineroObject, Error> {
        to_dinero(&self.to_any())
    }

    /// As [`AnyMoney::from_dinero_object`], in `C`.
    ///
    /// # Errors
    ///
    /// As [`AnyMoney::from_dinero_object`]; [`Error::CurrencyMismatch`] for another currency.
    pub fn from_dinero_object(object: &DineroObject) -> Result<Self, Error> {
        of_type(from_dinero(object)?)
    }
}

#[cfg(feature = "serde")]
mod json {
    //! The formats' JSON shapes.

    use alloc::string::{String, ToString};
    use core::fmt;

    use serde::de::{self, IgnoredAny, MapAccess, Visitor};
    use serde::ser::SerializeStruct;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    use super::{DineroObject, GoogleMoney, Iso20022Amount, MinorUnitAmount};
    use crate::{Error, Ratio};

    impl Serialize for GoogleMoney {
        /// ProtoJSON: `units` as a string, as int64 is written.
        fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            let mut state = serializer.serialize_struct("GoogleMoney", 3)?;
            state.serialize_field("currencyCode", &self.currency_code)?;
            state.serialize_field("units", &self.units.to_string())?;
            state.serialize_field("nanos", &self.nanos)?;
            state.end()
        }
    }

    /// A ProtoJSON integer: a number, or a string of one (exponent form included), whose value is
    /// an integer. A JSON number with a point or an exponent is read at its shortest decimal form.
    enum ProtoInteger {
        Value(Ratio),
        Invalid,
    }

    impl ProtoInteger {
        fn integer(self) -> Option<crate::Int> {
            match self {
                Self::Value(ratio) if ratio.denom() == &crate::Int::ONE => {
                    Some(ratio.numer().clone())
                }
                _ => None,
            }
        }
    }

    impl<'de> Deserialize<'de> for ProtoInteger {
        fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            struct IntegerVisitor;
            impl Visitor<'_> for IntegerVisitor {
                type Value = ProtoInteger;
                fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                    f.write_str("an integer, as a number or a string")
                }
                fn visit_i64<E: de::Error>(self, value: i64) -> Result<ProtoInteger, E> {
                    Ok(ProtoInteger::Value(Ratio::from(value)))
                }
                fn visit_u64<E: de::Error>(self, value: u64) -> Result<ProtoInteger, E> {
                    Ok(ProtoInteger::Value(Ratio::from(value)))
                }
                fn visit_f64<E: de::Error>(self, value: f64) -> Result<ProtoInteger, E> {
                    Ok(crate::decimal::faithful_decimal(value, false)
                        .map_or(ProtoInteger::Invalid, |decimal| {
                            ProtoInteger::Value(Ratio::from_decimal(decimal))
                        }))
                }
                fn visit_str<E: de::Error>(self, text: &str) -> Result<ProtoInteger, E> {
                    if !proto_shaped(text) {
                        return Ok(ProtoInteger::Invalid);
                    }
                    // an exponent beyond 1000 is far beyond int64: an error, as any bad text
                    Ok(text
                        .parse()
                        .map_or(ProtoInteger::Invalid, ProtoInteger::Value))
                }
            }
            deserializer.deserialize_any(IntegerVisitor)
        }
    }

    /// `-?digits(.digits)?([eE][+-]?digits)?`, the JSON number grammar with leading zeros allowed.
    fn proto_shaped(text: &str) -> bool {
        let rest = text.strip_prefix('-').unwrap_or(text);
        let (mantissa, exponent) = match rest.find(['e', 'E']) {
            Some(at) => (&rest[..at], Some(&rest[at + 1..])),
            None => (rest, None),
        };
        let digits =
            |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
        let (whole, fraction) = match mantissa.split_once('.') {
            Some((whole, fraction)) => (whole, Some(fraction)),
            None => (mantissa, None),
        };
        digits(whole)
            && fraction.is_none_or(digits)
            && exponent.is_none_or(|exponent| {
                digits(exponent.strip_prefix(['+', '-']).unwrap_or(exponent))
            })
    }

    fn invalid<E: de::Error>() -> E {
        E::custom(Error::InvalidWire)
    }

    impl<'de> Deserialize<'de> for GoogleMoney {
        fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            struct GoogleVisitor;
            impl<'de> Visitor<'de> for GoogleVisitor {
                type Value = GoogleMoney;
                fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                    f.write_str("google.type.Money: `{\"currencyCode\":\"EUR\",\"units\":\"12\",\"nanos\":340000000}`")
                }
                fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<GoogleMoney, A::Error> {
                    let (mut code, mut units, mut nanos) = (None, None, None);
                    while let Some(key) = map.next_key::<String>()? {
                        match key.as_str() {
                            "currencyCode" => code = Some(map.next_value::<String>()?),
                            "units" => units = Some(map.next_value::<ProtoInteger>()?),
                            "nanos" => nanos = Some(map.next_value::<ProtoInteger>()?),
                            _ => {
                                map.next_value::<IgnoredAny>()?;
                            }
                        }
                    }
                    let code = code.ok_or_else(|| de::Error::missing_field("currencyCode"))?;
                    let integer = |value: Option<ProtoInteger>| match value {
                        None => Some(crate::Int::ZERO),
                        Some(value) => value.integer(),
                    };
                    let units = integer(units)
                        .and_then(|units| units.to_i64())
                        .ok_or_else(invalid)?;
                    let nanos = integer(nanos)
                        .and_then(|nanos| nanos.to_i64())
                        .and_then(|nanos| i32::try_from(nanos).ok())
                        .ok_or_else(invalid)?;
                    GoogleMoney::new(&code, units, nanos).map_err(de::Error::custom)
                }
            }
            deserializer.deserialize_map(GoogleVisitor)
        }
    }

    impl Serialize for Iso20022Amount {
        fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            let mut state = serializer.serialize_struct("Iso20022Amount", 2)?;
            state.serialize_field("Ccy", &self.ccy)?;
            state.serialize_field("value", &self.value)?;
            state.end()
        }
    }

    impl Serialize for MinorUnitAmount {
        fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            let mut state = serializer.serialize_struct("MinorUnitAmount", 2)?;
            state.serialize_field("value", &self.value)?;
            state.serialize_field("currency", &self.currency)?;
            state.end()
        }
    }

    impl Serialize for DineroObject {
        fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            let mut state = serializer.serialize_struct("DineroObject", 3)?;
            state.serialize_field("amount", &self.amount)?;
            state.serialize_field("currency", &self.currency)?;
            state.serialize_field("precision", &self.precision)?;
            state.end()
        }
    }

    /// The fields of a flat JSON object, by name; the rest ignored.
    fn fields<'de, A: MapAccess<'de>, const N: usize>(
        mut map: A,
        names: [&'static str; N],
        mut read: impl FnMut(usize, &mut A) -> Result<(), A::Error>,
    ) -> Result<(), A::Error> {
        while let Some(key) = map.next_key::<String>()? {
            match names.iter().position(|name| *name == key) {
                Some(index) => read(index, &mut map)?,
                None => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(())
    }

    macro_rules! flat_deserialize {
        ($type:ident, $expecting:literal, [$($field:ident: $kind:ty = $name:literal),+], $build:expr) => {
            impl<'de> Deserialize<'de> for $type {
                fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                    struct FlatVisitor;
                    impl<'de> Visitor<'de> for FlatVisitor {
                        type Value = $type;
                        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                            f.write_str($expecting)
                        }
                        fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<$type, A::Error> {
                            $(let mut $field: Option<$kind> = None;)+
                            let names = [$($name),+];
                            fields(map, names, |index, map| {
                                let mut at = 0;
                                $(
                                    if index == at {
                                        $field = Some(map.next_value()?);
                                    }
                                    at += 1;
                                )+
                                let _ = at;
                                Ok(())
                            })?;
                            $(let $field = $field.ok_or_else(|| de::Error::missing_field($name))?;)+
                            Ok($build)
                        }
                    }
                    deserializer.deserialize_map(FlatVisitor)
                }
            }
        };
    }

    flat_deserialize!(
        Iso20022Amount,
        "an ISO 20022 amount: `{\"Ccy\":\"EUR\",\"value\":\"12.34\"}`",
        [ccy: String = "Ccy", value: String = "value"],
        Iso20022Amount { ccy, value }
    );
    flat_deserialize!(
        MinorUnitAmount,
        "minor units: `{\"value\":1234,\"currency\":\"EUR\"}`",
        [value: i64 = "value", currency: String = "currency"],
        MinorUnitAmount { value, currency }
    );
    flat_deserialize!(
        DineroObject,
        "a dinero.js object: `{\"amount\":1234,\"currency\":\"EUR\",\"precision\":2}`",
        [amount: i64 = "amount", currency: String = "currency", precision: u16 = "precision"],
        DineroObject { amount, currency, precision }
    );
}
