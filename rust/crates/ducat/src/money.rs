//! `Money<C>`: an amount in a currency known at compile time.

use alloc::string::String;
use core::cmp::Ordering;
use core::fmt;
use core::hash::{Hash, Hasher};
use core::marker::PhantomData;
use core::ops::{Add, Neg, Sub};
use core::str::FromStr;

use crate::amount::Amount;
use crate::{AnyMoney, Currency, CurrencyCode, Error, Factor, Rounding};

/// An exact amount of money in the currency `C`: an `i128` count of 10^−scale units.
///
/// The scale defaults to the currency's exponent (EUR 2, JPY 0, KWD 3) and can be larger for
/// sub-minor precision (unit prices, conversion intermediates), up to [`MAX_SCALE`](crate::MAX_SCALE).
/// `Money<Eur>` and `Money<Usd>` are different types, so mixing them is a compile error; for a
/// currency known only at run time, use [`AnyMoney`].
///
/// - **Rounding is always an argument.** Anything that may round takes a [`Rounding`]; with
///   [`Rounding::Unnecessary`] an inexact result is an error.
/// - **Equality is structural:** `PartialEq`, `Eq` and `Hash` compare the units *and the scale*,
///   as ducat's conformance suite judges money, so 1.0 EUR at scale 1 is not `==` to 1.00 EUR.
///   Compare by value with [`Money::eq_value`] and [`Money::compare`]. There is no `Ord`, since
///   it would disagree with `Eq` across scales.
/// - `+`, `-` and unary `-` panic on overflow (beyond ±1.7 × 10³⁸ units), in release builds too,
///   and never wrap; [`checked_add`](Money::checked_add) and friends return [`Error::Overflow`].
/// - [`Display`](fmt::Display) is ducat's `toString`, exact: `"12.34 EUR"`. It ignores format
///   flags such as `{:.1}` rather than rounding or truncating; round explicitly with
///   [`Money::to_scale`] first.
///
/// ```
/// use ducat::{Money, Rounding};
/// use ducat::iso::Eur;
///
/// let price: Money<Eur> = "25.00".parse()?;
/// let gross = price.multiply("1.075", Rounding::HalfEven)?;
/// assert_eq!(gross.to_string(), "26.88 EUR");
/// assert_eq!((price + gross).to_decimal(), "51.88");
/// # Ok::<(), ducat::Error>(())
/// ```
pub struct Money<C: Currency> {
    pub(crate) amount: Amount,
    currency: PhantomData<C>,
}

impl<C: Currency> Clone for Money<C> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<C: Currency> Copy for Money<C> {}

impl<C: Currency> PartialEq for Money<C> {
    /// Structural: the same units at the same scale. See [`Money::eq_value`] for equality by
    /// value.
    fn eq(&self, other: &Self) -> bool {
        self.amount == other.amount
    }
}

impl<C: Currency> Eq for Money<C> {}

impl<C: Currency> Hash for Money<C> {
    /// Hashes as the equal [`AnyMoney`] does: currency, units and scale.
    fn hash<H: Hasher>(&self, state: &mut H) {
        AnyMoney::from(*self).hash(state);
    }
}

impl<C: Currency> Default for Money<C> {
    /// Zero at the currency's exponent.
    fn default() -> Self {
        Self::zero()
    }
}

impl<C: Currency> Money<C> {
    pub(crate) const fn from_amount(amount: Amount) -> Self {
        Self {
            amount,
            currency: PhantomData,
        }
    }

    /// The currency's code and exponent.
    #[must_use]
    pub const fn currency(&self) -> CurrencyCode {
        C::CODE
    }

    /// Zero at the currency's exponent.
    #[must_use]
    pub const fn zero() -> Self {
        Self::from_amount(Amount {
            units: 0,
            scale: C::CODE.exponent() as u16,
        })
    }

    /// The amount with this many minor units (cents for EUR), at the currency's exponent.
    #[must_use]
    pub const fn from_minor(minor: i128) -> Self {
        Self::from_amount(Amount {
            units: minor,
            scale: C::CODE.exponent() as u16,
        })
    }

    /// The amount `units × 10^−scale`.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidScale`] for a scale beyond [`MAX_SCALE`](crate::MAX_SCALE).
    pub fn from_units(units: i128, scale: u16) -> Result<Self, Error> {
        Ok(Self::from_amount(Amount::new(units, scale)?))
    }

    /// A decimal string in major units at `scale`, rounded with `rounding` if it has more
    /// decimals than that. [`FromStr`] is this at the currency's exponent with
    /// [`Rounding::Unnecessary`].
    ///
    /// # Errors
    ///
    /// [`Error::Syntax`] outside ducat's grammar (see [`AnyMoney::parse_at`]);
    /// [`Error::ExponentOutOfRange`]; [`Error::InvalidScale`]; [`Error::Rounding`] for more
    /// decimals than `scale` with [`Rounding::Unnecessary`]; [`Error::Overflow`].
    pub fn parse_at(text: &str, scale: u16, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_amount(Amount::parse(text, scale, rounding)?))
    }

    /// A float in major units, at its shortest round-trip form, at the currency's exponent and
    /// without rounding (ducat's `money(0.1, 'EUR')`).
    ///
    /// Two checks apply, in this order, as in ducat: first the decimals must fit the exponent
    /// ([`Error::Rounding`] otherwise), then the shortest form must have at most 15 significant
    /// digits unless the value is a safe integer ([`Error::TooManyDigits`] otherwise). So
    /// `0.1 + 0.2`, whose shortest form is `0.30000000000000004`, is a rounding error in EUR, not
    /// a digits error.
    ///
    /// ```
    /// use ducat::{Error, Money};
    /// use ducat::iso::Eur;
    ///
    /// assert_eq!(Money::<Eur>::from_f64(0.1)?.to_decimal(), "0.10");
    /// assert_eq!(Money::<Eur>::from_f64(0.1 + 0.2), Err(Error::Rounding));
    /// # Ok::<(), Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::NotFinite`] for NaN and the infinities; then [`Error::Rounding`] and
    /// [`Error::TooManyDigits`], as above.
    pub fn from_f64(value: f64) -> Result<Self, Error> {
        Ok(Self::from_amount(Amount::from_f64(
            value,
            u16::from(C::CODE.exponent()),
            Rounding::Unnecessary,
            true,
        )?))
    }

    /// A float in major units at its shortest round-trip form, rounded to `scale` with
    /// `rounding`. The 15-digit rule doesn't apply: the caller has said how to round.
    ///
    /// # Errors
    ///
    /// [`Error::NotFinite`], [`Error::InvalidScale`], [`Error::Rounding`] (with
    /// [`Rounding::Unnecessary`]) and [`Error::Overflow`].
    pub fn from_f64_at(value: f64, scale: u16, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_amount(Amount::from_f64(
            value, scale, rounding, false,
        )?))
    }

    /// The count of 10^−scale units: 1234 for 12.34 EUR, 12340 for 12.340 EUR at scale 3.
    #[must_use]
    pub const fn units(&self) -> i128 {
        self.amount.units
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
    /// [`Error::Rounding`] when the amount has non-zero digits below the minor unit (round it
    /// first); [`Error::Overflow`] when it doesn't fit.
    pub fn to_minor(&self) -> Result<i128, Error> {
        Ok(self
            .amount
            .rescale(u16::from(C::CODE.exponent()), Rounding::Unnecessary)?
            .units)
    }

    /// The exact decimal in major units, with every place of the scale: `"12.34"`, `"-0.05"`,
    /// `"1000"` for JPY. Never an exponent, never `-0`.
    #[must_use]
    pub fn to_decimal(&self) -> String {
        let mut text = String::new();
        // writing to a String can't fail
        let _ = self.amount.write(&mut text);
        text
    }

    /// The same amount with a run-time currency.
    #[must_use]
    pub const fn to_any(self) -> AnyMoney {
        AnyMoney::from_parts(self.amount, C::CODE)
    }

    /// `self + other`, exactly, at the larger of the two scales.
    ///
    /// # Errors
    ///
    /// [`Error::Overflow`].
    pub fn checked_add(self, other: Self) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.checked_add(other.amount)?))
    }

    /// `self − other`, exactly, at the larger of the two scales.
    ///
    /// # Errors
    ///
    /// [`Error::Overflow`].
    pub fn checked_sub(self, other: Self) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.checked_sub(other.amount)?))
    }

    /// `−self`.
    ///
    /// # Errors
    ///
    /// [`Error::Overflow`] for `i128::MIN` units.
    pub fn checked_neg(self) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.checked_neg()?))
    }

    /// `|self|`.
    ///
    /// # Errors
    ///
    /// [`Error::Overflow`] for `i128::MIN` units.
    pub fn checked_abs(self) -> Result<Self, Error> {
        if self.amount.units < 0 {
            self.checked_neg()
        } else {
            Ok(self)
        }
    }

    /// The exact sum of `items`, at the largest scale among them; zero at the currency's
    /// exponent for none.
    ///
    /// # Errors
    ///
    /// [`Error::Overflow`].
    pub fn try_sum(items: impl IntoIterator<Item = Self>) -> Result<Self, Error> {
        let mut items = items.into_iter();
        let Some(first) = items.next() else {
            return Ok(Self::zero());
        };
        items.try_fold(first, Self::checked_add)
    }

    /// `self × factor`, rounded once to `self`'s scale.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] for an inexact product with [`Rounding::Unnecessary`];
    /// [`Error::Overflow`]; and whatever reading `factor` fails with.
    pub fn multiply(self, factor: impl Factor, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.mul_ratio(
            factor.to_ratio()?,
            self.amount.scale,
            rounding,
        )?))
    }

    /// `self ÷ divisor`, rounded once to `self`'s scale. To split an amount so that the parts
    /// sum to it, allocate it instead.
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`]; otherwise as [`Money::multiply`].
    pub fn divide(self, divisor: impl Factor, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.div_ratio(
            divisor.to_ratio()?,
            self.amount.scale,
            rounding,
        )?))
    }

    /// The amount at `scale`: exact when raising it, rounded once with `rounding` when lowering
    /// it.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidScale`]; [`Error::Rounding`] when digits would be lost with
    /// [`Rounding::Unnecessary`]; [`Error::Overflow`] when raising the scale overflows.
    pub fn to_scale(self, scale: u16, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.rescale(scale, rounding)?))
    }

    /// The amount rounded to the currency's exponent (ducat's `round`).
    ///
    /// # Errors
    ///
    /// As [`Money::to_scale`].
    pub fn round(self, rounding: Rounding) -> Result<Self, Error> {
        self.to_scale(u16::from(C::CODE.exponent()), rounding)
    }

    /// Converts to the currency `T` at `rate` (units of `T` per unit of `C`), rounded once to
    /// `T`'s exponent.
    ///
    /// ```
    /// use ducat::{Money, Rounding};
    /// use ducat::iso::{Eur, Jpy};
    ///
    /// let euros: Money<Eur> = "100.00".parse()?;
    /// let yen: Money<Jpy> = euros.convert("162.457", Rounding::HalfExpand)?;
    /// assert_eq!(yen.to_string(), "16246 JPY");
    /// # Ok::<(), ducat::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::NonPositiveRate`] for a rate of zero or less; otherwise as [`Money::multiply`].
    pub fn convert<T: Currency>(
        self,
        rate: impl Factor,
        rounding: Rounding,
    ) -> Result<Money<T>, Error> {
        let any = self.to_any().convert(T::CODE, rate, rounding)?;
        Ok(Money::from_amount(any.amount))
    }

    /// The order of the two values, whatever their scales.
    #[must_use]
    pub fn compare(&self, other: &Self) -> Ordering {
        self.amount.cmp_value(other.amount)
    }

    /// Whether the two values are equal, whatever their scales: 1.0 EUR at scale 1 equals
    /// 1.00 EUR here, though not under `==`.
    #[must_use]
    pub fn eq_value(&self, other: &Self) -> bool {
        self.compare(other) == Ordering::Equal
    }

    /// Whether the amount is zero.
    #[must_use]
    pub const fn is_zero(&self) -> bool {
        self.amount.units == 0
    }

    /// Whether the amount is above zero.
    #[must_use]
    pub const fn is_positive(&self) -> bool {
        self.amount.units > 0
    }

    /// Whether the amount is below zero.
    #[must_use]
    pub const fn is_negative(&self) -> bool {
        self.amount.units < 0
    }

    /// −1, 0 or 1.
    #[must_use]
    pub const fn signum(&self) -> i8 {
        self.amount.units.signum() as i8
    }
}

impl<C: Currency> Add for Money<C> {
    type Output = Self;

    /// `self + other`, at the larger scale.
    ///
    /// # Panics
    ///
    /// On overflow, in every build profile. Use [`Money::checked_add`] to get an error instead.
    fn add(self, other: Self) -> Self {
        self.checked_add(other)
            .expect("Money addition overflowed i128")
    }
}

impl<C: Currency> Sub for Money<C> {
    type Output = Self;

    /// `self − other`, at the larger scale.
    ///
    /// # Panics
    ///
    /// On overflow, in every build profile. Use [`Money::checked_sub`] to get an error instead.
    fn sub(self, other: Self) -> Self {
        self.checked_sub(other)
            .expect("Money subtraction overflowed i128")
    }
}

impl<C: Currency> Neg for Money<C> {
    type Output = Self;

    /// `−self`.
    ///
    /// # Panics
    ///
    /// For `i128::MIN` units. Use [`Money::checked_neg`] to get an error instead.
    fn neg(self) -> Self {
        self.checked_neg().expect("Money negation overflowed i128")
    }
}

impl<C: Currency> FromStr for Money<C> {
    type Err = Error;

    /// A decimal string in major units at the currency's exponent, without rounding: `"12.34"`
    /// is 12.34 EUR, and `"1.005"` is [`Error::Rounding`]. See [`Money::parse_at`].
    fn from_str(text: &str) -> Result<Self, Error> {
        Self::parse_at(text, u16::from(C::CODE.exponent()), Rounding::Unnecessary)
    }
}

impl<C: Currency> fmt::Display for Money<C> {
    /// `"12.34 EUR"`: the exact amount at its scale, a space and the code. Format flags are
    /// ignored.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.amount.write(f)?;
        write!(f, " {}", C::CODE)
    }
}

impl<C: Currency> fmt::Debug for Money<C> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Money(")?;
        fmt::Display::fmt(self, f)?;
        f.write_str(")")
    }
}

impl<C: Currency> From<Money<C>> for AnyMoney {
    fn from(money: Money<C>) -> Self {
        money.to_any()
    }
}

impl<C: Currency> TryFrom<AnyMoney> for Money<C> {
    type Error = Error;

    /// Narrows to the typed currency, as ducat's `assertCurrency`.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] when the value is in another currency.
    fn try_from(money: AnyMoney) -> Result<Self, Error> {
        if money.currency() == C::CODE {
            Ok(Self::from_amount(money.amount))
        } else {
            Err(Error::CurrencyMismatch {
                expected: C::CODE,
                actual: money.currency(),
            })
        }
    }
}

impl<C: Currency> PartialEq<AnyMoney> for Money<C> {
    /// Structural, as `==` between two `Money<C>`.
    fn eq(&self, other: &AnyMoney) -> bool {
        self.to_any() == *other
    }
}

impl<C: Currency> PartialEq<Money<C>> for AnyMoney {
    /// Structural, as `==` between two `AnyMoney`.
    fn eq(&self, other: &Money<C>) -> bool {
        *self == other.to_any()
    }
}
