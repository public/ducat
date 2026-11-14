//! `Fixed`: an exact decimal without a currency, for quantities, unit prices with more decimals
//! than a currency has, rates, and values that aren't money yet.
//!
//! ```
//! use ducat::Rounding;
//! use ducat::fixed::Fixed;
//!
//! let unit_price: Fixed = "0.0425".parse()?;
//! assert_eq!(unit_price.multiply(1200, Rounding::Unnecessary)?.to_string(), "51.0000");
//! let third = "100.00".parse::<Fixed>()?.divide(3, Rounding::HalfEven)?;
//! assert_eq!(third.to_string(), "33.33");
//! assert_eq!("12.3400".parse::<Fixed>()?.trim_scale(0).to_string(), "12.34");
//! # Ok::<(), ducat::Error>(())
//! ```

use alloc::string::String;
use core::cmp::Ordering;
use core::fmt;
use core::hash::{Hash, Hasher};
use core::iter::Sum;
use core::ops::{Add, Neg, Sub};
use core::str::FromStr;

use crate::amount::Amount;
use crate::decimal::{faithful_decimal, parse_decimal};
use crate::{AnyMoney, Currency, CurrencyCode, Error, Factor, Int, Money, Ratio, Rounding};

/// An exact decimal: `units × 10^−scale`, of any size, at a scale from 0 to
/// [`MAX_SCALE`](crate::MAX_SCALE).
///
/// - A decimal string keeps its own scale: `"12.340"` is scale 3. [`Fixed::parse_at`] reads at a
///   given scale.
/// - Equality, `Hash` and `Ord` are by value, as ducat's `equals`: 1.0 equals 1.00, and they are
///   one map key. [`Fixed::identical`] also checks the scale.
/// - `Display` is the exact decimal with every place of the scale (`"12.340"`), never an
///   exponent, and it ignores format flags.
#[derive(Clone)]
pub struct Fixed {
    amount: Amount,
}

impl Fixed {
    const fn from_amount(amount: Amount) -> Self {
        Self { amount }
    }

    /// Zero at scale 0.
    pub const ZERO: Self = Self {
        amount: Amount {
            units: Int::ZERO,
            scale: 0,
        },
    };

    /// The decimal `units × 10^−scale`: `Fixed::new(12345, 3)` is 12.345.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidScale`] for a scale beyond [`MAX_SCALE`](crate::MAX_SCALE).
    pub fn new(units: impl Into<Int>, scale: u16) -> Result<Self, Error> {
        Ok(Self::from_amount(Amount::new(units.into(), scale)?))
    }

    /// A decimal string at `scale`, rounded with `rounding` if it has more decimals than that.
    /// There is no limit on the number of digits, so bound untrusted input first.
    ///
    /// # Errors
    ///
    /// [`Error::Syntax`] outside ducat's grammar; [`Error::ExponentOutOfRange`];
    /// [`Error::InvalidScale`]; [`Error::Rounding`] for more decimals than `scale` with
    /// [`Rounding::Unnecessary`].
    pub fn parse_at(text: &str, scale: u16, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_amount(Amount::parse(text, scale, rounding)?))
    }

    /// A float at its shortest round-trip form and that form's scale (`0.1` is 0.1, scale 1).
    ///
    /// # Errors
    ///
    /// [`Error::NotFinite`]; [`Error::TooManyDigits`] for a value that isn't a safe integer and
    /// has more than 15 significant digits (so `0.1 + 0.2` is an error).
    pub fn from_f64(value: f64) -> Result<Self, Error> {
        let decimal = faithful_decimal(value, true)?;
        Ok(Self::from_amount(Amount::from_decimal(
            &decimal,
            decimal.scale,
            Rounding::Unnecessary,
        )?))
    }

    /// The count of 10^−scale units: 12340 for 12.340.
    #[must_use]
    pub const fn units(&self) -> &Int {
        &self.amount.units
    }

    /// The number of decimal places.
    #[must_use]
    pub const fn scale(&self) -> u16 {
        self.amount.scale
    }

    /// `|self|`.
    #[must_use]
    pub fn abs(&self) -> Self {
        Self::from_amount(self.amount.abs())
    }

    /// `self × factor`, rounded once to `self`'s scale.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] for an inexact product with [`Rounding::Unnecessary`], and whatever
    /// reading `factor` fails with.
    pub fn multiply(&self, factor: impl Factor, rounding: Rounding) -> Result<Self, Error> {
        self.multiply_at(factor, self.amount.scale, rounding)
    }

    /// `self × factor`, rounded once to `scale`. Pass the scale here rather than calling
    /// [`Fixed::to_scale`] afterwards, which would round twice.
    ///
    /// # Errors
    ///
    /// As [`Fixed::multiply`], and [`Error::InvalidScale`].
    pub fn multiply_at(
        &self,
        factor: impl Factor,
        scale: u16,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.mul_ratio(
            &factor.to_ratio()?,
            scale,
            rounding,
        )?))
    }

    /// `self ÷ divisor`, rounded once to `self`'s scale.
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`]; otherwise as [`Fixed::multiply`].
    pub fn divide(&self, divisor: impl Factor, rounding: Rounding) -> Result<Self, Error> {
        self.divide_at(divisor, self.amount.scale, rounding)
    }

    /// `self ÷ divisor`, rounded once to `scale`.
    ///
    /// # Errors
    ///
    /// As [`Fixed::divide`], and [`Error::InvalidScale`].
    pub fn divide_at(
        &self,
        divisor: impl Factor,
        scale: u16,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.div_ratio(
            &divisor.to_ratio()?,
            scale,
            rounding,
        )?))
    }

    /// The value at `scale`: exact when raising it, rounded once when lowering it. (ducat's
    /// `round(mode, scale)` is this; a `Fixed` has no currency exponent to default to.)
    ///
    /// # Errors
    ///
    /// [`Error::InvalidScale`]; [`Error::Rounding`] when digits would be lost with
    /// [`Rounding::Unnecessary`].
    pub fn to_scale(&self, scale: u16, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.rescale(scale, rounding)?))
    }

    /// The smallest scale, at least `minimum`, that keeps the value exact: `12.3400` is `12.34`.
    /// It never adds digits.
    #[must_use]
    pub fn trim_scale(&self, minimum: u16) -> Self {
        let (units, scale) = self.amount.normalized();
        if scale >= minimum {
            return Self::from_amount(Amount { units, scale });
        }
        let target = minimum.min(self.amount.scale);
        Self::from_amount(Amount {
            units: units.mul_pow10(u32::from(target - scale)),
            scale: target,
        })
    }

    /// The order of the two values, whatever their scales.
    #[must_use]
    pub fn compare(&self, other: &Self) -> Ordering {
        self.amount.cmp_value(&other.amount)
    }

    /// Whether the two have the same value *and* the same scale.
    #[must_use]
    pub fn identical(&self, other: &Self) -> bool {
        self.amount.identical(&other.amount)
    }

    /// The value as a reduced [`Ratio`].
    #[must_use]
    pub fn to_ratio(&self) -> Ratio {
        // a power of ten is never zero
        Ratio::new(
            self.amount.units.clone(),
            Int::ONE.mul_pow10(u32::from(self.amount.scale)),
        )
        .unwrap_or(Ratio::ZERO)
    }

    /// Whether the value is zero.
    #[must_use]
    pub fn is_zero(&self) -> bool {
        self.amount.units.is_zero()
    }

    /// Whether the value is above zero.
    #[must_use]
    pub fn is_positive(&self) -> bool {
        self.amount.units.is_positive()
    }

    /// Whether the value is below zero.
    #[must_use]
    pub fn is_negative(&self) -> bool {
        self.amount.units.is_negative()
    }

    /// −1, 0 or 1.
    #[must_use]
    pub fn signum(&self) -> i8 {
        self.amount.units.signum()
    }

    /// The value as money in `C`, at its exponent, rounded with `rounding` if it has more
    /// decimals.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] when digits would be lost with [`Rounding::Unnecessary`].
    pub fn to_money<C: Currency>(&self, rounding: Rounding) -> Result<Money<C>, Error> {
        Ok(Money::from_amount(
            self.amount
                .rescale(u16::from(C::CODE.exponent()), rounding)?,
        ))
    }

    /// The value as money in `currency`, at its exponent, rounded with `rounding` if needed.
    ///
    /// # Errors
    ///
    /// As [`Fixed::to_money`].
    pub fn to_any_money(
        &self,
        currency: CurrencyCode,
        rounding: Rounding,
    ) -> Result<AnyMoney, Error> {
        Ok(AnyMoney::from_parts(
            self.amount
                .rescale(u16::from(currency.exponent()), rounding)?,
            currency,
        ))
    }

    /// The exact decimal string, with every place of the scale.
    #[must_use]
    pub fn to_decimal(&self) -> String {
        let mut text = String::new();
        let _ = self.amount.write(&mut text);
        text
    }
}

impl<C: Currency> Money<C> {
    /// The exact amount as a [`Fixed`], at the money's scale.
    #[must_use]
    pub fn to_fixed(&self) -> Fixed {
        Fixed::from_amount(self.amount.clone())
    }
}

impl AnyMoney {
    /// The exact amount as a [`Fixed`], at the money's scale.
    #[must_use]
    pub fn to_fixed(&self) -> Fixed {
        Fixed::from_amount(self.amount.clone())
    }
}

impl Factor for Fixed {
    fn to_ratio(self) -> Result<Ratio, Error> {
        Ok(Fixed::to_ratio(&self))
    }
}

impl Factor for &Fixed {
    fn to_ratio(self) -> Result<Ratio, Error> {
        Ok(Fixed::to_ratio(self))
    }
}

impl Default for Fixed {
    /// Zero at scale 0.
    fn default() -> Self {
        Self::ZERO
    }
}

impl PartialEq for Fixed {
    /// By value, whatever the scales: 1.0 equals 1.00.
    fn eq(&self, other: &Self) -> bool {
        self.compare(other) == Ordering::Equal
    }
}

impl Eq for Fixed {}

impl Hash for Fixed {
    /// Hashes the value at its smallest exact scale, so it agrees with `==`.
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.amount.normalized().hash(state);
    }
}

impl PartialOrd for Fixed {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Fixed {
    /// By value, consistent with `==`.
    fn cmp(&self, other: &Self) -> Ordering {
        self.compare(other)
    }
}

macro_rules! fixed_operator {
    ($trait:ident, $method:ident, $doc:literal) => {
        impl $trait<&Fixed> for &Fixed {
            type Output = Fixed;

            #[doc = $doc]
            fn $method(self, other: &Fixed) -> Fixed {
                Fixed::from_amount(self.amount.$method(&other.amount))
            }
        }

        impl $trait for Fixed {
            type Output = Fixed;

            #[doc = $doc]
            fn $method(self, other: Fixed) -> Fixed {
                (&self).$method(&other)
            }
        }

        impl $trait<&Fixed> for Fixed {
            type Output = Fixed;

            #[doc = $doc]
            fn $method(self, other: &Fixed) -> Fixed {
                (&self).$method(other)
            }
        }
    };
}
fixed_operator!(
    Add,
    add,
    "`self + other`, exactly, at the larger of the two scales."
);
fixed_operator!(
    Sub,
    sub,
    "`self − other`, exactly, at the larger of the two scales."
);

impl Neg for &Fixed {
    type Output = Fixed;

    /// `−self`.
    fn neg(self) -> Fixed {
        Fixed::from_amount(self.amount.neg())
    }
}

impl Neg for Fixed {
    type Output = Fixed;

    /// `−self`.
    fn neg(self) -> Fixed {
        -&self
    }
}

impl Sum for Fixed {
    /// The exact sum, at the largest scale among the items.
    fn sum<I: Iterator<Item = Self>>(items: I) -> Self {
        items.fold(Self::ZERO, |sum, item| sum + item)
    }
}

impl<'a> Sum<&'a Fixed> for Fixed {
    /// As the sum of owned values.
    fn sum<I: Iterator<Item = &'a Fixed>>(items: I) -> Self {
        items.fold(Self::ZERO, |sum, item| sum + item)
    }
}

impl From<Int> for Fixed {
    /// The integer, at scale 0.
    fn from(value: Int) -> Self {
        Self::from_amount(Amount {
            units: value,
            scale: 0,
        })
    }
}

macro_rules! from_integer {
    ($($integer:ty),*) => {$(
        impl From<$integer> for Fixed {
            /// The integer, at scale 0.
            fn from(value: $integer) -> Self {
                Self::from(Int::from(value))
            }
        }
    )*};
}
from_integer!(i8, i16, i32, i64, i128, u8, u16, u32, u64, u128, usize);

impl FromStr for Fixed {
    type Err = Error;

    /// A decimal string in ducat's grammar, at the scale it is written with (`"12.340"` is
    /// scale 3; `"1.5e3"` is 1500, scale 0). There is no limit on the number of digits, so bound
    /// untrusted input first.
    ///
    /// # Errors
    ///
    /// [`Error::Syntax`] outside the grammar; [`Error::ExponentOutOfRange`] for an exponent or
    /// decimal places beyond 1000.
    fn from_str(text: &str) -> Result<Self, Error> {
        let decimal = parse_decimal(text)?;
        Ok(Self::from_amount(Amount::from_decimal(
            &decimal,
            decimal.written,
            Rounding::Unnecessary,
        )?))
    }
}

impl fmt::Display for Fixed {
    /// The exact decimal, with every place of the scale. Format flags are ignored.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.amount.write(f)
    }
}

impl fmt::Debug for Fixed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Fixed({self})")
    }
}

#[cfg(feature = "serde")]
mod serde_impl {
    use alloc::string::String;

    use serde::{Deserialize, Deserializer, Serialize, Serializer, de};

    use super::Fixed;

    impl Serialize for Fixed {
        /// The exact decimal string, as ducat's `toJSON`.
        fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            serializer.serialize_str(&self.to_decimal())
        }
    }

    impl<'de> Deserialize<'de> for Fixed {
        /// A decimal string, read as [`FromStr`](core::str::FromStr) reads it; never a number.
        fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            let text = String::deserialize(deserializer)?;
            text.parse().map_err(de::Error::custom)
        }
    }
}
