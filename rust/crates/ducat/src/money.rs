//! `Money<C>`: an amount in a currency known at compile time.

use alloc::string::String;
use core::borrow::Borrow;
use core::cmp::Ordering;
use core::fmt;
use core::hash::{Hash, Hasher};
use core::iter::Sum;
use core::marker::PhantomData;
use core::ops::{Add, Neg, Sub};
use core::str::FromStr;

use crate::amount::Amount;
use crate::{AnyMoney, Currency, CurrencyCode, Error, Factor, Int, Ratio, Rounding, RoundingInput};

/// An exact amount of money in the currency `C`: a count of 10^−scale units of any size.
///
/// The scale defaults to the currency's exponent (EUR 2, JPY 0, KWD 3) and can be larger for
/// sub-minor precision (unit prices, conversion intermediates), or smaller, up to
/// [`MAX_SCALE`](crate::MAX_SCALE). `Money<Eur>` and `Money<Usd>` are different types, so mixing
/// them is a compile error; for a currency known only at run time, use [`AnyMoney`].
///
/// - **Any size, as in ducat.** Amounts that fit an `i128` are computed with machine arithmetic;
///   larger ones grow onto the heap, so nothing ever overflows. That is also why `Money` is
///   `Clone` but not `Copy`: methods take `&self`, and the operators work on references
///   (`&a + &b`) as well as values.
/// - **Rounding is always an argument.** Anything that may round takes a [`Rounding`]; with
///   [`Rounding::Unnecessary`](crate::Rounding::Unnecessary) an inexact result is an error.
/// - **Equality is by value,** as ducat's `equals`: `==`, `Eq`, `Hash` and `Ord` ignore the scale, so
///   1.0 EUR at scale 1 is `==` to 1.00 EUR, and they are the same `HashMap` or `BTreeMap` key
///   (the representation inserted first is the one kept). Check the amount *and* the scale, as
///   round-trip tests should, with [`Money::identical`].
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
/// assert_eq!((&price + &gross).to_decimal(), "51.88");
/// # Ok::<(), ducat::Error>(())
/// ```
pub struct Money<C: Currency> {
    pub(crate) amount: Amount,
    currency: PhantomData<C>,
}

impl<C: Currency> Clone for Money<C> {
    fn clone(&self) -> Self {
        Self::from_amount(self.amount.clone())
    }
}

impl<C: Currency> PartialEq for Money<C> {
    /// By value, whatever the scales: 1.0 EUR equals 1.00 EUR, as ducat's `equals`. For amount
    /// *and* scale, use [`Money::identical`].
    fn eq(&self, other: &Self) -> bool {
        self.amount.cmp_value(&other.amount) == Ordering::Equal
    }
}

impl<C: Currency> Eq for Money<C> {}

impl<C: Currency> Hash for Money<C> {
    /// Hashes the value at its smallest exact scale, so equal amounts hash alike whatever their
    /// scales, and as the equal [`AnyMoney`] does.
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.amount.normalized().hash(state);
        C::CODE.hash(state);
    }
}

impl<C: Currency> PartialOrd for Money<C> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl<C: Currency> Ord for Money<C> {
    /// By value, whatever the scales, consistent with `==`.
    fn cmp(&self, other: &Self) -> Ordering {
        self.compare(other)
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
            units: Int::ZERO,
            scale: C::CODE.exponent() as u16,
        })
    }

    /// The amount with this many minor units (cents for EUR), at the currency's exponent.
    #[must_use]
    pub fn from_minor(minor: impl Into<Int>) -> Self {
        Self::from_amount(Amount {
            units: minor.into(),
            scale: u16::from(C::CODE.exponent()),
        })
    }

    /// The amount `units × 10^−scale`.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidScale`] for a scale beyond [`MAX_SCALE`](crate::MAX_SCALE).
    pub fn from_units(units: impl Into<Int>, scale: u16) -> Result<Self, Error> {
        Ok(Self::from_amount(Amount::new(units.into(), scale)?))
    }

    /// A decimal string in major units at `scale`, rounded with `rounding` if it has more
    /// decimals than that. [`FromStr`] is this at the currency's exponent with
    /// [`Rounding::Unnecessary`](crate::Rounding::Unnecessary).
    ///
    /// There is no limit on the number of digits, as in ducat, so the cost grows with the length
    /// of the text: bound untrusted input before parsing it.
    ///
    /// # Errors
    ///
    /// [`Error::Syntax`] outside ducat's grammar (see [`AnyMoney::parse_at`]);
    /// [`Error::ExponentOutOfRange`]; [`Error::InvalidScale`]; [`Error::Rounding`] for more
    /// decimals than `scale` with [`Rounding::Unnecessary`](crate::Rounding::Unnecessary).
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
    /// [`Error::NotFinite`], [`Error::InvalidScale`], and [`Error::Rounding`] (with
    /// [`Rounding::Unnecessary`](crate::Rounding::Unnecessary)).
    pub fn from_f64_at(value: f64, scale: u16, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_amount(Amount::from_f64(
            value, scale, rounding, false,
        )?))
    }

    /// The count of 10^−scale units: 1234 for 12.34 EUR, 12340 for 12.340 EUR at scale 3.
    #[must_use]
    pub const fn units(&self) -> &Int {
        &self.amount.units
    }

    /// The number of decimal places.
    #[must_use]
    pub const fn scale(&self) -> u16 {
        self.amount.scale
    }

    /// The whole major units, truncated toward zero, as ducat's `majorPart`: 12 for 12.34 EUR,
    /// −12 for −12.34 EUR, 0 for −0.05 EUR.
    #[must_use]
    pub fn major_part(&self) -> Int {
        self.amount.parts().0
    }

    /// What is left after [`major_part`](Self::major_part), in 10^−scale units (not the
    /// currency's minor units) and with the amount's sign, as ducat's `minorPart`: 34 for
    /// 12.34 EUR, −34 for −12.34 EUR, 5 for 1.005 EUR at scale 3, 0 for JPY.
    #[must_use]
    pub fn minor_part(&self) -> Int {
        self.amount.parts().1
    }

    /// Whether the amount has a non-zero fractional part, as ducat's `hasFraction`: true for
    /// 12.34 EUR, −0.05 EUR and 1.005 EUR at scale 3; false for 12.00 EUR and 12.000 EUR at
    /// scale 3.
    #[must_use]
    pub fn has_fraction(&self) -> bool {
        !self.amount.parts().1.is_zero()
    }

    /// The amount in the currency's minor units, whatever its scale.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] when the amount has non-zero digits below the minor unit (round it
    /// first).
    pub fn to_minor(&self) -> Result<Int, Error> {
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
    pub fn to_any(&self) -> AnyMoney {
        AnyMoney::from_parts(self.amount.clone(), C::CODE)
    }

    /// `|self|`.
    #[must_use]
    pub fn abs(&self) -> Self {
        Self::from_amount(self.amount.abs())
    }

    /// `self × factor`, rounded once: with a mode to `self`'s scale, with a rounding policy to
    /// the policy's scale and increment.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] for an inexact product with [`Rounding::Unnecessary`](crate::Rounding::Unnecessary);
    /// [`Error::CurrencyMismatch`] for a policy for another currency; and whatever reading
    /// `factor` fails with.
    pub fn multiply(
        &self,
        factor: impl Factor,
        rounding: impl Into<RoundingInput>,
    ) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.mul_input(
            &factor.to_ratio()?,
            self.amount.scale,
            rounding.into(),
            C::CODE,
        )?))
    }

    /// `self ÷ divisor`, rounded once as [`Money::multiply`] rounds. To split an amount so that
    /// the parts sum to it, allocate it instead.
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`]; otherwise as [`Money::multiply`].
    pub fn divide(
        &self,
        divisor: impl Factor,
        rounding: impl Into<RoundingInput>,
    ) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.mul_input(
            &divisor.to_ratio()?.recip()?,
            self.amount.scale,
            rounding.into(),
            C::CODE,
        )?))
    }

    /// The amount at `scale`: exact when raising it, rounded once with `rounding` when lowering
    /// it.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidScale`]; [`Error::Rounding`] when digits would be lost with
    /// [`Rounding::Unnecessary`](crate::Rounding::Unnecessary).
    pub fn to_scale(&self, scale: u16, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.rescale(scale, rounding)?))
    }

    /// The amount rounded once: with a mode to the currency's exponent, with a rounding policy
    /// to the policy's scale and increment (ducat's `round`).
    ///
    /// # Errors
    ///
    /// As [`Money::multiply`].
    pub fn round(&self, rounding: impl Into<RoundingInput>) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.mul_input(
            &Ratio::ONE,
            u16::from(C::CODE.exponent()),
            rounding.into(),
            C::CODE,
        )?))
    }

    /// Converts to the currency `T` at `rate` (units of `T` per unit of `C`), rounded once: with a
    /// mode to `T`'s exponent, with a rounding policy to its scale (by default `T`'s exponent)
    /// and increment, its currency checked against `T`.
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
        &self,
        rate: impl Factor,
        rounding: impl Into<RoundingInput>,
    ) -> Result<Money<T>, Error> {
        let any = self.to_any().convert(T::CODE, rate, rounding)?;
        Ok(Money::from_amount(any.amount))
    }

    /// The order of the two values, whatever their scales.
    #[must_use]
    pub fn compare(&self, other: &Self) -> Ordering {
        self.amount.cmp_value(&other.amount)
    }

    /// Whether the two values are equal, whatever their scales: the same as `==`.
    #[must_use]
    pub fn eq_value(&self, other: &Self) -> bool {
        self.compare(other) == Ordering::Equal
    }

    /// Whether the two have the same amount *and* the same scale, as ducat's `identical`: 1.0 EUR
    /// at scale 1 is `==` to 1.00 EUR, but not identical. For round-trip tests, where the scale
    /// must survive too.
    #[must_use]
    pub fn identical(&self, other: &Self) -> bool {
        self.amount.identical(&other.amount)
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

    /// The smaller of `self` and `other`; `self` on a tie of values, as ducat's `min`: 1.0 EUR
    /// at scale 1 against 1.00 EUR keeps scale 1.
    ///
    /// This inherent method takes `self` by value so that `a.min(b)` and `a.min(&b)` call it
    /// rather than [`Ord::min`] (which agrees on ties, keeping the first, but takes only an owned
    /// `other`). On a `&Money` receiver, `r.min(..)` is `Ord::min` for references: call
    /// `r.clone().min(..)` or `Money::min(r.clone(), ..)` instead.
    #[must_use]
    pub fn min(self, other: impl Borrow<Self>) -> Self {
        let other = other.borrow();
        if other.compare(&self) == Ordering::Less {
            other.clone()
        } else {
            self
        }
    }

    /// The larger of `self` and `other`; `self` on a tie of values, as ducat's `max`: 1.0 EUR
    /// at scale 1 against 1.00 EUR keeps scale 1.
    ///
    /// **Unlike [`Ord::max`]**, which returns the *second* of two equal values. This inherent
    /// method takes `self` by value so that `a.max(b)` and `a.max(&b)` call it rather than
    /// `Ord::max`; `core::cmp::max(a, b)`, `Iterator::max`, generic `T: Ord` code and
    /// `r.max(..)` on a `&Money` receiver still use `Ord`'s rule. For a list, see
    /// [`Money::max_of`].
    #[must_use]
    pub fn max(self, other: impl Borrow<Self>) -> Self {
        let other = other.borrow();
        if other.compare(&self) == Ordering::Greater {
            other.clone()
        } else {
            self
        }
    }

    /// The smallest of `items`, the first of equal values winning, as ducat's variadic `min`;
    /// `None` for none.
    #[must_use]
    pub fn min_of<'a>(items: impl IntoIterator<Item = &'a Self>) -> Option<Self>
    where
        C: 'a,
    {
        let mut items = items.into_iter();
        let first = items.next()?.clone();
        Some(items.fold(first, Self::min))
    }

    /// The largest of `items`, the first of equal values winning, as ducat's variadic `max`
    /// (where `Iterator::max` keeps the last); `None` for none.
    #[must_use]
    pub fn max_of<'a>(items: impl IntoIterator<Item = &'a Self>) -> Option<Self>
    where
        C: 'a,
    {
        let mut items = items.into_iter();
        let first = items.next()?.clone();
        Some(items.fold(first, Self::max))
    }

    /// `self` limited to `[lo, hi]`, as ducat's `clamp`: `lo` when below it, `hi` when above it,
    /// otherwise `self` as it is (a value equal to a bound keeps its own scale).
    ///
    /// **Unlike [`Ord::clamp`]**, which panics when `lo > hi`, this returns an error. It takes
    /// `self` by value so that `a.clamp(lo, hi)` and `a.clamp(&lo, &hi)` call it rather than
    /// `Ord::clamp`; on a `&Money` receiver, `r.clamp(..)` is `Ord::clamp` for references (it
    /// panics and returns a reference): call `r.clone().clamp(..)` instead.
    ///
    /// # Errors
    ///
    /// [`Error::LowAboveHigh`] when `lo > hi`, as ducat's `RangeError`.
    pub fn clamp(self, lo: impl Borrow<Self>, hi: impl Borrow<Self>) -> Result<Self, Error> {
        let (lo, hi) = (lo.borrow(), hi.borrow());
        if lo.compare(hi) == Ordering::Greater {
            return Err(Error::LowAboveHigh);
        }
        Ok(if self.compare(lo) == Ordering::Less {
            lo.clone()
        } else if self.compare(hi) == Ordering::Greater {
            hi.clone()
        } else {
            self
        })
    }
}

macro_rules! money_operator {
    ($trait:ident, $method:ident, $doc:literal) => {
        impl<C: Currency> $trait<&Money<C>> for &Money<C> {
            type Output = Money<C>;

            #[doc = $doc]
            fn $method(self, other: &Money<C>) -> Money<C> {
                Money::from_amount(self.amount.$method(&other.amount))
            }
        }

        impl<C: Currency> $trait for Money<C> {
            type Output = Money<C>;

            #[doc = $doc]
            fn $method(self, other: Money<C>) -> Money<C> {
                (&self).$method(&other)
            }
        }

        impl<C: Currency> $trait<&Money<C>> for Money<C> {
            type Output = Money<C>;

            #[doc = $doc]
            fn $method(self, other: &Money<C>) -> Money<C> {
                (&self).$method(other)
            }
        }
    };
}
money_operator!(
    Add,
    add,
    "`self + other`, exactly, at the larger of the two scales."
);
money_operator!(
    Sub,
    sub,
    "`self − other`, exactly, at the larger of the two scales."
);

impl<C: Currency> Neg for &Money<C> {
    type Output = Money<C>;

    /// `−self`.
    fn neg(self) -> Money<C> {
        Money::from_amount(self.amount.neg())
    }
}

impl<C: Currency> Neg for Money<C> {
    type Output = Money<C>;

    /// `−self`.
    fn neg(self) -> Money<C> {
        -&self
    }
}

impl<C: Currency> Sum for Money<C> {
    /// The exact sum, at the largest scale among the items; zero at the currency's exponent for
    /// none.
    fn sum<I: Iterator<Item = Self>>(items: I) -> Self {
        items.fold(Self::zero(), |sum, item| sum + item)
    }
}

impl<'a, C: Currency> Sum<&'a Money<C>> for Money<C> {
    /// As the sum of owned values.
    fn sum<I: Iterator<Item = &'a Money<C>>>(items: I) -> Self {
        items.fold(Self::zero(), |sum, item| sum + item)
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
        AnyMoney::from_parts(money.amount, C::CODE)
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
    /// The same currency and the same value, whatever the scales.
    fn eq(&self, other: &AnyMoney) -> bool {
        other.currency() == C::CODE && self.amount.cmp_value(&other.amount) == Ordering::Equal
    }
}

impl<C: Currency> PartialEq<Money<C>> for AnyMoney {
    /// The same currency and the same value, whatever the scales.
    fn eq(&self, other: &Money<C>) -> bool {
        other == self
    }
}
