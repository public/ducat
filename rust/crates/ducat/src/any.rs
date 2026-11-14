//! `AnyMoney`: an amount in a currency known only at run time.

use alloc::string::String;
use core::cmp::Ordering;
use core::fmt;
use core::ops::Neg;
use core::str::FromStr;

use crate::amount::Amount;
use crate::{CurrencyCode, Error, Factor, Int, Rounding};

/// An exact amount of money whose currency is a run-time [`CurrencyCode`]: for values from
/// databases, JSON and user input.
///
/// It has the same operations as [`Money`](crate::Money), but those that combine two amounts
/// return [`Error::CurrencyMismatch`] for different currencies. Narrow it to a typed `Money<C>`
/// with `Money::<C>::try_from(any)`. Size, equality, `Hash`, `Display` and rounding follow the
/// same rules as `Money`'s: `==` is the same currency and the same value, whatever the scales
/// (amounts in different currencies are simply not equal), and [`AnyMoney::identical`] also checks
/// the scale. There is no `Ord`, since amounts in different currencies have no order;
/// [`AnyMoney::compare`] returns an error for them.
///
/// ```
/// use ducat::{AnyMoney, CurrencyCode, Error, Money};
/// use ducat::iso::Eur;
///
/// let eur: CurrencyCode = "EUR".parse()?;
/// let a = AnyMoney::parse("10.00", eur)?;
/// let b = AnyMoney::parse("2.50", "USD".parse()?)?;
/// assert!(matches!(a.checked_add(&b), Err(Error::CurrencyMismatch { .. })));
/// let typed = Money::<Eur>::try_from(a)?;
/// assert_eq!(typed.to_string(), "10.00 EUR");
/// # Ok::<(), ducat::Error>(())
/// ```
#[derive(Clone)]
pub struct AnyMoney {
    pub(crate) amount: Amount,
    currency: CurrencyCode,
}

impl AnyMoney {
    pub(crate) const fn from_parts(amount: Amount, currency: CurrencyCode) -> Self {
        Self { amount, currency }
    }

    fn with_amount(&self, amount: Amount) -> Self {
        Self {
            amount,
            currency: self.currency,
        }
    }

    fn same_currency(&self, other: &Self) -> Result<(), Error> {
        if self.currency == other.currency {
            Ok(())
        } else {
            Err(Error::CurrencyMismatch {
                expected: self.currency,
                actual: other.currency,
            })
        }
    }

    /// `other`'s amount, when it is in this currency.
    #[cfg(any(feature = "allocate", feature = "cash"))]
    pub(crate) fn amount_in<'a>(&self, other: &'a Self) -> Result<&'a Amount, Error> {
        self.same_currency(other)?;
        Ok(&other.amount)
    }

    /// The currency.
    #[must_use]
    pub const fn currency(&self) -> CurrencyCode {
        self.currency
    }

    /// Zero in `currency`, at its exponent.
    #[must_use]
    pub const fn zero(currency: CurrencyCode) -> Self {
        Self {
            amount: Amount {
                units: Int::ZERO,
                scale: currency.exponent() as u16,
            },
            currency,
        }
    }

    /// The amount with this many minor units of `currency`, at its exponent.
    #[must_use]
    pub fn from_minor(minor: impl Into<Int>, currency: CurrencyCode) -> Self {
        Self {
            amount: Amount {
                units: minor.into(),
                scale: u16::from(currency.exponent()),
            },
            currency,
        }
    }

    /// The amount `units × 10^−scale` of `currency`.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidScale`] for a scale beyond [`MAX_SCALE`](crate::MAX_SCALE).
    pub fn from_units(
        units: impl Into<Int>,
        scale: u16,
        currency: CurrencyCode,
    ) -> Result<Self, Error> {
        Ok(Self {
            amount: Amount::new(units.into(), scale)?,
            currency,
        })
    }

    /// A decimal string in major units at `currency`'s exponent, without rounding.
    ///
    /// # Errors
    ///
    /// As [`AnyMoney::parse_at`] with [`Rounding::Unnecessary`].
    pub fn parse(text: &str, currency: CurrencyCode) -> Result<Self, Error> {
        Self::parse_at(
            text,
            currency,
            u16::from(currency.exponent()),
            Rounding::Unnecessary,
        )
    }

    /// A decimal string in major units at `scale`, rounded with `rounding` if it has more
    /// decimals than that.
    ///
    /// The grammar is ducat's: an optional `+` or `-`, one or more ASCII digits, optionally a
    /// point and one or more digits, and optionally `e` or `E` with an optional sign and digits.
    /// `".5"`, `"5."`, grouping (`"1,000"`, `"1_000"`) and surrounding whitespace are errors.
    /// There is no limit on the number of digits, as in ducat, so the cost grows with the length
    /// of the text: bound untrusted input before parsing it.
    ///
    /// # Errors
    ///
    /// [`Error::Syntax`] outside the grammar; [`Error::ExponentOutOfRange`] for an exponent or
    /// decimal places beyond 1000; [`Error::InvalidScale`]; [`Error::Rounding`] for more
    /// decimals than `scale` with [`Rounding::Unnecessary`].
    pub fn parse_at(
        text: &str,
        currency: CurrencyCode,
        scale: u16,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        Ok(Self {
            amount: Amount::parse(text, scale, rounding)?,
            currency,
        })
    }

    /// A float in major units, as [`Money::from_f64`](crate::Money::from_f64).
    ///
    /// # Errors
    ///
    /// As [`Money::from_f64`](crate::Money::from_f64).
    pub fn from_f64(value: f64, currency: CurrencyCode) -> Result<Self, Error> {
        let scale = u16::from(currency.exponent());
        Ok(Self {
            amount: Amount::from_f64(value, scale, Rounding::Unnecessary, true)?,
            currency,
        })
    }

    /// A float in major units, as [`Money::from_f64_at`](crate::Money::from_f64_at).
    ///
    /// # Errors
    ///
    /// As [`Money::from_f64_at`](crate::Money::from_f64_at).
    pub fn from_f64_at(
        value: f64,
        currency: CurrencyCode,
        scale: u16,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        Ok(Self {
            amount: Amount::from_f64(value, scale, rounding, false)?,
            currency,
        })
    }

    /// The count of 10^−scale units.
    #[must_use]
    pub const fn units(&self) -> &Int {
        &self.amount.units
    }

    /// The number of decimal places.
    #[must_use]
    pub const fn scale(&self) -> u16 {
        self.amount.scale
    }

    /// The amount in the currency's minor units, whatever its scale.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] for non-zero digits below the minor unit.
    pub fn to_minor(&self) -> Result<Int, Error> {
        Ok(self
            .amount
            .rescale(u16::from(self.currency.exponent()), Rounding::Unnecessary)?
            .units)
    }

    /// The exact decimal in major units, with every place of the scale.
    #[must_use]
    pub fn to_decimal(&self) -> String {
        let mut text = String::new();
        let _ = self.amount.write(&mut text);
        text
    }

    /// `self + other`, exactly, at the larger of the two scales.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`].
    pub fn checked_add(&self, other: &Self) -> Result<Self, Error> {
        self.same_currency(other)?;
        Ok(self.with_amount(self.amount.add(&other.amount)))
    }

    /// `self − other`, exactly, at the larger of the two scales.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`].
    pub fn checked_sub(&self, other: &Self) -> Result<Self, Error> {
        self.same_currency(other)?;
        Ok(self.with_amount(self.amount.sub(&other.amount)))
    }

    /// `|self|`.
    #[must_use]
    pub fn abs(&self) -> Self {
        self.with_amount(self.amount.abs())
    }

    /// The exact sum of `items` in `currency`, at the largest scale among them; zero at the
    /// currency's exponent for none.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] for an item in another currency.
    pub fn try_sum<'a>(
        items: impl IntoIterator<Item = &'a Self>,
        currency: CurrencyCode,
    ) -> Result<Self, Error> {
        items
            .into_iter()
            .try_fold(Self::zero(currency), |sum, item| sum.checked_add(item))
    }

    /// `self × factor`, rounded once to `self`'s scale.
    ///
    /// # Errors
    ///
    /// As [`Money::multiply`](crate::Money::multiply).
    pub fn multiply(&self, factor: impl Factor, rounding: Rounding) -> Result<Self, Error> {
        Ok(self.with_amount(self.amount.mul_ratio(
            &factor.to_ratio()?,
            self.amount.scale,
            rounding,
        )?))
    }

    /// `self ÷ divisor`, rounded once to `self`'s scale.
    ///
    /// # Errors
    ///
    /// As [`Money::divide`](crate::Money::divide).
    pub fn divide(&self, divisor: impl Factor, rounding: Rounding) -> Result<Self, Error> {
        Ok(self.with_amount(self.amount.div_ratio(
            &divisor.to_ratio()?,
            self.amount.scale,
            rounding,
        )?))
    }

    /// The amount at `scale`, as [`Money::to_scale`](crate::Money::to_scale).
    ///
    /// # Errors
    ///
    /// As [`Money::to_scale`](crate::Money::to_scale).
    pub fn to_scale(&self, scale: u16, rounding: Rounding) -> Result<Self, Error> {
        Ok(self.with_amount(self.amount.rescale(scale, rounding)?))
    }

    /// The amount rounded to the currency's exponent.
    ///
    /// # Errors
    ///
    /// As [`Money::to_scale`](crate::Money::to_scale).
    pub fn round(&self, rounding: Rounding) -> Result<Self, Error> {
        self.to_scale(u16::from(self.currency.exponent()), rounding)
    }

    /// Converts to `to` at `rate` (units of `to` per unit of this currency), rounded once to
    /// `to`'s exponent.
    ///
    /// # Errors
    ///
    /// [`Error::NonPositiveRate`] for a rate of zero or less; otherwise as
    /// [`Money::multiply`](crate::Money::multiply).
    pub fn convert(
        &self,
        to: CurrencyCode,
        rate: impl Factor,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        let rate = rate.to_ratio()?;
        if !rate.numer().is_positive() {
            return Err(Error::NonPositiveRate);
        }
        Ok(Self {
            amount: self
                .amount
                .mul_ratio(&rate, u16::from(to.exponent()), rounding)?,
            currency: to,
        })
    }

    /// The order of the two values, whatever their scales.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] for different currencies.
    pub fn compare(&self, other: &Self) -> Result<Ordering, Error> {
        self.same_currency(other)?;
        Ok(self.amount.cmp_value(&other.amount))
    }

    /// Whether the two are the same currency and the same value, whatever their scales. Another
    /// currency gives `false`, never an error, as in ducat's `equals`.
    #[must_use]
    pub fn eq_value(&self, other: &Self) -> bool {
        self.compare(other) == Ok(Ordering::Equal)
    }

    /// Whether the two have the same currency, amount *and* scale, as ducat's `identical`.
    #[must_use]
    pub fn identical(&self, other: &Self) -> bool {
        self.currency == other.currency && self.amount.identical(&other.amount)
    }

    /// Whether the amount is zero.
    #[must_use]
    pub fn is_zero(&self) -> bool {
        self.amount.units.is_zero()
    }

    /// Whether the amount is above zero.
    #[must_use]
    pub fn is_positive(&self) -> bool {
        self.amount.units.is_positive()
    }

    /// Whether the amount is below zero.
    #[must_use]
    pub fn is_negative(&self) -> bool {
        self.amount.units.is_negative()
    }

    /// −1, 0 or 1.
    #[must_use]
    pub fn signum(&self) -> i8 {
        self.amount.units.signum()
    }
}

impl PartialEq for AnyMoney {
    /// The same currency and the same value, whatever the scales, as ducat's `equals`.
    fn eq(&self, other: &Self) -> bool {
        self.eq_value(other)
    }
}

impl Eq for AnyMoney {}

impl core::hash::Hash for AnyMoney {
    /// Hashes the value at its smallest exact scale, and the currency, as `Money` does.
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        self.amount.normalized().hash(state);
        self.currency.hash(state);
    }
}

impl Neg for &AnyMoney {
    type Output = AnyMoney;

    /// `−self`.
    fn neg(self) -> AnyMoney {
        self.with_amount(self.amount.neg())
    }
}

impl Neg for AnyMoney {
    type Output = AnyMoney;

    /// `−self`.
    fn neg(self) -> AnyMoney {
        -&self
    }
}

impl FromStr for AnyMoney {
    type Err = Error;

    /// Display's form, `"12.34 EUR"`: a decimal string, one space and an ISO 4217 code, read at
    /// the currency's exponent without rounding (so `"1.005 EUR"` is [`Error::Rounding`]).
    fn from_str(text: &str) -> Result<Self, Error> {
        let (amount, code) = text.split_once(' ').ok_or(Error::Syntax)?;
        Self::parse(amount, code.parse()?)
    }
}

impl fmt::Display for AnyMoney {
    /// `"12.34 EUR"`, as `Money`'s. Format flags are ignored.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.amount.write(f)?;
        write!(f, " {}", self.currency)
    }
}

impl fmt::Debug for AnyMoney {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("AnyMoney(")?;
        fmt::Display::fmt(self, f)?;
        f.write_str(")")
    }
}
