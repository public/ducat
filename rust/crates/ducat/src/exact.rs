//! Exact rational amounts, for chained calculations that round once at the end.
//!
//! ```
//! use ducat::{Money, Rounding};
//! use ducat::iso::Chf;
//!
//! let share = "10.03".parse::<Money<Chf>>()?.exact().divide(3)?;
//! assert_eq!(share.to_string(), "1003/300 CHF");
//! assert!(!share.is_exact(None)?);
//! let rounded = share.round_with_residual(Rounding::HalfEven, None)?;
//! assert_eq!(rounded.value.to_string(), "3.34 CHF");
//! assert_eq!(rounded.residual.to_string(), "1/300 CHF");
//! # Ok::<(), ducat::Error>(())
//! ```

use core::cmp::Ordering;
use core::fmt;
use core::hash::{Hash, Hasher};
use core::marker::PhantomData;
use core::ops::{Add, Neg, Sub};

use crate::amount::Amount;
use crate::{
    AnyMoney, Currency, CurrencyCode, Error, Factor, Int, Money, Ratio, Rounding, RoundingInput,
};

/// What rounding an exact amount gave, and what it left out: `value + residual` is exactly the
/// unrounded amount, so a ledger can book the difference.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Rounded<M, E> {
    /// The rounded amount.
    pub value: M,
    /// The exact difference: the unrounded amount minus `value`.
    pub residual: E,
}

/// An exact tax split, rounding nothing: `net + tax` is exactly `gross`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ExactTaxBreakdown<E> {
    /// The amount before tax.
    pub net: E,
    /// The tax.
    pub tax: E,
    /// Exactly `net + tax`.
    pub gross: E,
}

/// The amount's value in major units, exactly.
fn value_of(amount: &Amount) -> Ratio {
    // a power of ten is never zero
    Ratio::new(
        amount.units.clone(),
        Int::ONE.mul_pow10(u32::from(amount.scale)),
    )
    .unwrap_or(Ratio::ZERO)
}

/// `value` rounded once to `scale`.
fn round_value(value: &Ratio, scale: u16, rounding: Rounding) -> Result<Amount, Error> {
    let scale = crate::amount::check_scale(scale)?;
    Ok(Amount {
        units: value.round_to_units(scale, rounding)?,
        scale,
    })
}

/// `value` major units of `currency` rounded once: with a mode to `scale` (default: the currency's
/// exponent), with a policy to its own scale and increment (and then `scale` must be `None`).
fn round_input_value(
    value: &Ratio,
    rounding: RoundingInput,
    scale: Option<u16>,
    currency: CurrencyCode,
) -> Result<Amount, Error> {
    match rounding {
        RoundingInput::Mode(mode) => {
            round_value(value, scale.unwrap_or(u16::from(currency.exponent())), mode)
        }
        #[cfg(feature = "policy")]
        RoundingInput::Policy(policy) => {
            if scale.is_some() {
                return Err(Error::ScaleWithPolicy);
            }
            // num/den is num units at scale 0 times 1/den: the policy rounds that product once
            let whole = Amount {
                units: value.numer().clone(),
                scale: 0,
            };
            policy.round_product(&whole, &Int::ONE, value.denom(), currency)
        }
    }
}

/// `value` at the smallest scale, at least `minimum`, that holds it exactly, with ducat's
/// `toMoney` checks in its order: `InvalidScale` for the minimum, `Rounding` for a value with no
/// finite decimal form, then `InvalidScale` for one that needs more than `MAX_SCALE` places.
fn exact_amount(value: &Ratio, minimum: u16) -> Result<Amount, Error> {
    let minimum = crate::amount::check_scale(minimum)?;
    let places = value.decimal_places().ok_or(Error::Rounding)?;
    let places = u16::try_from(places).map_err(|_| Error::InvalidScale)?;
    round_value(value, places.max(minimum), Rounding::Unnecessary)
}

/// Whether `value` is a decimal at `scale`, as ducat's `isExact`.
fn is_exact_at(value: &Ratio, scale: u16) -> Result<bool, Error> {
    let scale = crate::amount::check_scale(scale)?;
    Ok(value
        .decimal_places()
        .is_some_and(|needed| needed <= u32::from(scale)))
}

/// The first of `items` that no later one is strictly `beyond` (by `ordering`), as ducat's
/// variadic `min` and `max`: the first of equal values wins.
fn extreme<'a, T: 'a + Clone>(
    items: impl IntoIterator<Item = &'a T>,
    mut beyond: impl FnMut(&T, &T) -> Result<bool, Error>,
) -> Result<Option<T>, Error> {
    let mut items = items.into_iter();
    let Some(first) = items.next() else {
        return Ok(None);
    };
    let mut best = first.clone();
    for item in items {
        if beyond(item, &best)? {
            best = item.clone();
        }
    }
    Ok(Some(best))
}

/// `percent / 100`.
fn percent_of(percent: impl Factor) -> Result<Ratio, Error> {
    Ok(percent.to_ratio()?.mul(&Ratio::new(1, 100)?))
}

/// `1 / (1 + percent / 100)`.
fn net_share(percent: impl Factor) -> Result<Ratio, Error> {
    let percent = percent.to_ratio()?;
    let hundred_den = Int::from(100u8) * percent.denom();
    let gross_share = &hundred_den + percent.numer();
    if !gross_share.is_positive() {
        return Err(Error::InvalidPercent);
    }
    Ratio::new(hundred_den, gross_share)
}

/// An exact amount of the currency `C`: a reduced fraction of major units, of any size. Build it
/// with [`Money::exact`]; every operation is exact, and [`ExactMoney::round`] rounds once.
///
/// Equality, `Hash` and `Ord` are by value. There is no `Display` of an amount that a person
/// would mistake for rounded money: it prints `10/3 EUR`, for debugging.
///
/// It has no JSON form, on purpose, as ducat's `ExactMoney#toJSON` throws (`ExactMoney has no
/// JSON form; round() it to Money first`): neither it nor [`AnyExactMoney`] implements serde's
/// `Serialize` or `Deserialize`, so storing one is a compile error. Round it to [`Money`] first
/// ([`ExactMoney::round`], or [`ExactMoney::to_money`] where it is exact).
pub struct ExactMoney<C: Currency> {
    value: Ratio,
    currency: PhantomData<C>,
}

/// An exact amount whose currency is known only at run time: as [`ExactMoney`], with
/// [`Error::CurrencyMismatch`] for operands in another currency. No serde, as [`ExactMoney`].
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct AnyExactMoney {
    value: Ratio,
    currency: CurrencyCode,
}

impl<C: Currency> Clone for ExactMoney<C> {
    fn clone(&self) -> Self {
        Self::of(self.value.clone())
    }
}

impl<C: Currency> PartialEq for ExactMoney<C> {
    fn eq(&self, other: &Self) -> bool {
        self.value == other.value
    }
}

impl<C: Currency> Eq for ExactMoney<C> {}

impl<C: Currency> Hash for ExactMoney<C> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.value.hash(state);
        C::CODE.hash(state);
    }
}

impl<C: Currency> PartialOrd for ExactMoney<C> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl<C: Currency> Ord for ExactMoney<C> {
    fn cmp(&self, other: &Self) -> Ordering {
        self.value.cmp(&other.value)
    }
}

impl<C: Currency> ExactMoney<C> {
    pub(crate) const fn of(value: Ratio) -> Self {
        Self {
            value,
            currency: PhantomData,
        }
    }

    /// Zero.
    #[must_use]
    pub const fn zero() -> Self {
        Self::of(Ratio::ZERO)
    }

    /// The currency.
    #[must_use]
    pub const fn currency(&self) -> CurrencyCode {
        C::CODE
    }

    /// The amount in major units as the nearest double: 10/3 EUR is 3.3333333333333335. **For
    /// display or interop only; never round-trip** (and never do arithmetic on it). Rounded once,
    /// to the nearest double (ties to even), and ±infinity beyond the largest double, bit for bit
    /// as ducat's `ExactMoney#toNumber`.
    ///
    /// ```
    /// use ducat::Money;
    /// use ducat::iso::Eur;
    ///
    /// let third = Money::<Eur>::from_units(10, 0)?.exact().divide(3)?;
    /// assert_eq!(third.to_f64(), 10.0 / 3.0);
    /// # Ok::<(), ducat::Error>(())
    /// ```
    #[must_use]
    pub fn to_f64(&self) -> f64 {
        crate::float::ratio_to_f64(&self.value)
    }

    /// The value in major units, exactly.
    #[must_use]
    pub const fn value(&self) -> &Ratio {
        &self.value
    }

    /// The same amount with a run-time currency.
    #[must_use]
    pub fn to_any(&self) -> AnyExactMoney {
        AnyExactMoney {
            value: self.value.clone(),
            currency: C::CODE,
        }
    }

    /// `self × factor`, exactly.
    ///
    /// # Errors
    ///
    /// Whatever reading `factor` fails with.
    pub fn multiply(&self, factor: impl Factor) -> Result<Self, Error> {
        Ok(Self::of(self.value.mul(&factor.to_ratio()?)))
    }

    /// `self ÷ divisor`, exactly.
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`], and whatever reading `divisor` fails with.
    pub fn divide(&self, divisor: impl Factor) -> Result<Self, Error> {
        Ok(Self::of(self.value.div(&divisor.to_ratio()?)?))
    }

    /// `percent`% of the amount, exactly.
    ///
    /// # Errors
    ///
    /// Whatever reading `percent` fails with.
    pub fn percentage(&self, percent: impl Factor) -> Result<Self, Error> {
        Ok(Self::of(self.value.mul(&percent_of(percent)?)))
    }

    /// `|self|`.
    #[must_use]
    pub fn abs(&self) -> Self {
        Self::of(self.value.abs())
    }

    /// The exact share `self ÷ total`, as ducat's `ratioOf`; `total` may be an exact amount or
    /// a [`Money`] (owned or borrowed).
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`] for a zero total, ducat's `RangeError`.
    pub fn ratio_of(&self, total: impl Into<Self>) -> Result<Ratio, Error> {
        self.value.div(&total.into().value)
    }

    /// Whether the amount is zero.
    #[must_use]
    pub fn is_zero(&self) -> bool {
        self.value.is_zero()
    }

    /// Whether the amount is above zero.
    #[must_use]
    pub fn is_positive(&self) -> bool {
        self.value.numer().is_positive()
    }

    /// Whether the amount is below zero.
    #[must_use]
    pub fn is_negative(&self) -> bool {
        self.value.numer().is_negative()
    }

    /// −1, 0 or 1.
    #[must_use]
    pub fn signum(&self) -> i8 {
        self.value.numer().signum()
    }

    /// The smaller of `self` and `other`, as ducat's `min`; `self` on a tie. `other` may be an
    /// exact amount or a [`Money`] (owned or borrowed).
    ///
    /// This inherent method takes `self` by value so that `a.min(b)` calls it rather than
    /// [`Ord::min`]. Equal exact amounts are the same reduced fraction, so which of two equal
    /// values is kept can't be seen; the rule is ducat's all the same.
    #[must_use]
    pub fn min(self, other: impl Into<Self>) -> Self {
        let other = other.into();
        if other.value < self.value {
            other
        } else {
            self
        }
    }

    /// The larger of `self` and `other`, as ducat's `max`; `self` on a tie (where [`Ord::max`]
    /// keeps the second). `other` may be an exact amount or a [`Money`].
    #[must_use]
    pub fn max(self, other: impl Into<Self>) -> Self {
        let other = other.into();
        if other.value > self.value {
            other
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
        extreme(items, |item, best| Ok(item.value < best.value)).unwrap_or(None)
    }

    /// The largest of `items`, the first of equal values winning, as ducat's variadic `max`
    /// (where `Iterator::max` keeps the last); `None` for none.
    #[must_use]
    pub fn max_of<'a>(items: impl IntoIterator<Item = &'a Self>) -> Option<Self>
    where
        C: 'a,
    {
        extreme(items, |item, best| Ok(item.value > best.value)).unwrap_or(None)
    }

    /// `self` limited to `[lo, hi]`, as ducat's `ExactMoney#clamp`. The bounds may be exact
    /// amounts or [`Money`] (owned or borrowed), as ducat's take either.
    ///
    /// **Unlike [`Ord::clamp`]**, which panics when `lo > hi`, this returns an error. It takes
    /// `self` by value so that `x.clamp(lo, hi)` calls it rather than `Ord::clamp`.
    ///
    /// On a `&ExactMoney` (a reference receiver), `max`/`min`/`clamp` are std's [`Ord`] methods:
    /// the second of equal values wins, and `clamp` panics when lo > hi. Call
    /// `(*r).clone().clamp(..)` instead.
    ///
    /// # Errors
    ///
    /// [`Error::LowAboveHigh`] when `lo > hi`, as ducat's `RangeError` (`clamp: lo > hi`).
    pub fn clamp(self, lo: impl Into<Self>, hi: impl Into<Self>) -> Result<Self, Error> {
        let (lo, hi) = (lo.into(), hi.into());
        if lo.value > hi.value {
            return Err(Error::LowAboveHigh);
        }
        // ducat's this.max(lo).min(hi): a bound replaces the value only when strictly beyond it
        Ok(if lo.value > self.value {
            lo
        } else if hi.value < self.value {
            hi
        } else {
            self
        })
    }

    /// Whether the amount fits `scale` (default: the currency's exponent) without rounding, as
    /// ducat's `isExact`.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidScale`] for a scale beyond [`MAX_SCALE`](crate::MAX_SCALE), ducat's
    /// `RangeError`.
    pub fn is_exact(&self, scale: Option<u16>) -> Result<bool, Error> {
        is_exact_at(&self.value, scale.unwrap_or(u16::from(C::CODE.exponent())))
    }

    /// Rounds once: with a mode to `scale` (default: the currency's exponent), with a rounding
    /// policy to the policy's scale and increment.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] with [`Rounding::Unnecessary`] when inexact; [`Error::InvalidScale`];
    /// [`Error::ScaleWithPolicy`] for a scale beside a policy, which has its own;
    /// [`Error::CurrencyMismatch`] for a policy for another currency.
    pub fn round(
        &self,
        rounding: impl Into<RoundingInput>,
        scale: Option<u16>,
    ) -> Result<Money<C>, Error> {
        Ok(Money::from_amount(round_input_value(
            &self.value,
            rounding.into(),
            scale,
            C::CODE,
        )?))
    }

    /// Rounds as [`ExactMoney::round`] does, and returns what rounding left out too.
    ///
    /// # Errors
    ///
    /// As [`ExactMoney::round`].
    pub fn round_with_residual(
        &self,
        rounding: impl Into<RoundingInput>,
        scale: Option<u16>,
    ) -> Result<Rounded<Money<C>, Self>, Error> {
        let value = self.round(rounding, scale)?;
        let residual = Self::of(self.value.sub(&value_of(&value.amount)));
        Ok(Rounded { value, residual })
    }

    /// The exact value as money, at the smallest scale that holds it but at least
    /// `minimum_scale` (default: the currency's exponent): 1/8 EUR is 0.125 EUR. Never rounds.
    ///
    /// # Errors
    ///
    /// In ducat's order: [`Error::InvalidScale`] for a minimum beyond
    /// [`MAX_SCALE`](crate::MAX_SCALE); [`Error::Rounding`] when the value has no finite decimal
    /// form (10/3), ducat's `RoundingError`; [`Error::InvalidScale`] when it needs more than
    /// `MAX_SCALE` places, ducat's `RangeError`.
    pub fn to_money(&self, minimum_scale: Option<u16>) -> Result<Money<C>, Error> {
        let minimum = minimum_scale.unwrap_or(u16::from(C::CODE.exponent()));
        Ok(Money::from_amount(exact_amount(&self.value, minimum)?))
    }

    /// Adds `percent`% tax, rounding nothing.
    ///
    /// # Errors
    ///
    /// Whatever reading `percent` fails with.
    pub fn add_tax(&self, percent: impl Factor) -> Result<ExactTaxBreakdown<Self>, Error> {
        let tax = self.percentage(percent)?;
        Ok(ExactTaxBreakdown {
            gross: self + &tax,
            net: self.clone(),
            tax,
        })
    }

    /// Extracts the `percent`% tax a gross amount contains, rounding nothing.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidPercent`] for a percent of −100 or below.
    pub fn extract_tax(&self, percent: impl Factor) -> Result<ExactTaxBreakdown<Self>, Error> {
        let net = Self::of(self.value.mul(&net_share(percent)?));
        Ok(ExactTaxBreakdown {
            tax: self - &net,
            net,
            gross: self.clone(),
        })
    }
}

impl AnyExactMoney {
    pub(crate) const fn of(value: Ratio, currency: CurrencyCode) -> Self {
        Self { value, currency }
    }

    fn with(&self, value: Ratio) -> Self {
        Self {
            value,
            currency: self.currency,
        }
    }

    fn same(&self, other: &Self) -> Result<(), Error> {
        if self.currency == other.currency {
            Ok(())
        } else {
            Err(Error::CurrencyMismatch {
                expected: self.currency,
                actual: other.currency,
            })
        }
    }

    /// Zero in `currency`.
    #[must_use]
    pub const fn zero(currency: CurrencyCode) -> Self {
        Self {
            value: Ratio::ZERO,
            currency,
        }
    }

    /// The currency.
    #[must_use]
    pub const fn currency(&self) -> CurrencyCode {
        self.currency
    }

    /// As [`ExactMoney::to_f64`]: the nearest double in major units. **For display or interop
    /// only; never round-trip.**
    #[must_use]
    pub fn to_f64(&self) -> f64 {
        crate::float::ratio_to_f64(&self.value)
    }

    /// The value in major units, exactly.
    #[must_use]
    pub const fn value(&self) -> &Ratio {
        &self.value
    }

    /// Whether the amount is zero.
    #[must_use]
    pub fn is_zero(&self) -> bool {
        self.value.is_zero()
    }

    /// Whether the amount is above zero.
    #[must_use]
    pub fn is_positive(&self) -> bool {
        self.value.numer().is_positive()
    }

    /// Whether the amount is below zero.
    #[must_use]
    pub fn is_negative(&self) -> bool {
        self.value.numer().is_negative()
    }

    /// `self + other`, exactly.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`].
    pub fn checked_add(&self, other: &Self) -> Result<Self, Error> {
        self.same(other)?;
        Ok(self.with(self.value.add(&other.value)))
    }

    /// `self − other`, exactly.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`].
    pub fn checked_sub(&self, other: &Self) -> Result<Self, Error> {
        self.same(other)?;
        Ok(self.with(self.value.sub(&other.value)))
    }

    /// `self × factor`, exactly.
    ///
    /// # Errors
    ///
    /// Whatever reading `factor` fails with.
    pub fn multiply(&self, factor: impl Factor) -> Result<Self, Error> {
        Ok(self.with(self.value.mul(&factor.to_ratio()?)))
    }

    /// `self ÷ divisor`, exactly.
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`], and whatever reading `divisor` fails with.
    pub fn divide(&self, divisor: impl Factor) -> Result<Self, Error> {
        Ok(self.with(self.value.div(&divisor.to_ratio()?)?))
    }

    /// As [`ExactMoney::percentage`].
    ///
    /// # Errors
    ///
    /// Whatever reading `percent` fails with.
    pub fn percentage(&self, percent: impl Factor) -> Result<Self, Error> {
        Ok(self.with(self.value.mul(&percent_of(percent)?)))
    }

    /// `|self|`.
    #[must_use]
    pub fn abs(&self) -> Self {
        self.with(self.value.abs())
    }

    /// −1, 0 or 1.
    #[must_use]
    pub fn signum(&self) -> i8 {
        self.value.numer().signum()
    }

    /// The exact share `self ÷ total`, as ducat's `ratioOf`; `total` may be an exact amount or
    /// an [`AnyMoney`] (owned or borrowed).
    ///
    /// # Errors
    ///
    /// In ducat's order: [`Error::CurrencyMismatch`] for a total in another currency
    /// (`expected` `self`'s currency, `actual` the total's); [`Error::DivisionByZero`] for a zero
    /// total.
    pub fn ratio_of(&self, total: impl Into<Self>) -> Result<Ratio, Error> {
        let total = total.into();
        self.same(&total)?;
        self.value.div(&total.value)
    }

    /// The smaller of `self` and `other`, as ducat's `min`; `self` on a tie. `other` may be an
    /// exact amount or an [`AnyMoney`] (owned or borrowed).
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] for different currencies. As in ducat, which compares the
    /// candidate with the smallest so far, `expected` is `other`'s currency and `actual`
    /// `self`'s.
    pub fn min(&self, other: impl Into<Self>) -> Result<Self, Error> {
        let other = other.into();
        Ok(if other.compare(self)?.is_lt() {
            other
        } else {
            self.clone()
        })
    }

    /// The larger of `self` and `other`, as ducat's `max`; `self` on a tie (where [`Ord::max`],
    /// on types that have it, keeps the second).
    ///
    /// # Errors
    ///
    /// As [`AnyExactMoney::min`].
    pub fn max(&self, other: impl Into<Self>) -> Result<Self, Error> {
        let other = other.into();
        Ok(if other.compare(self)?.is_gt() {
            other
        } else {
            self.clone()
        })
    }

    /// The smallest of `items`, the first of equal values winning, as ducat's variadic `min`;
    /// `None` for none.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] at the first item in another currency than the first item's,
    /// with `expected` that item's currency and `actual` the first's, as ducat.
    pub fn min_of<'a>(items: impl IntoIterator<Item = &'a Self>) -> Result<Option<Self>, Error> {
        extreme(items, |item, best| Ok(item.compare(best)?.is_lt()))
    }

    /// The largest of `items`, the first of equal values winning, as ducat's variadic `max`;
    /// `None` for none.
    ///
    /// # Errors
    ///
    /// As [`AnyExactMoney::min_of`].
    pub fn max_of<'a>(items: impl IntoIterator<Item = &'a Self>) -> Result<Option<Self>, Error> {
        extreme(items, |item, best| Ok(item.compare(best)?.is_gt()))
    }

    /// As [`ExactMoney::is_exact`].
    ///
    /// # Errors
    ///
    /// As [`ExactMoney::is_exact`].
    pub fn is_exact(&self, scale: Option<u16>) -> Result<bool, Error> {
        is_exact_at(
            &self.value,
            scale.unwrap_or(u16::from(self.currency.exponent())),
        )
    }

    /// The order of the two values.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`].
    pub fn compare(&self, other: &Self) -> Result<Ordering, Error> {
        self.same(other)?;
        Ok(self.value.cmp(&other.value))
    }

    /// `self` limited to `[lo, hi]`, as ducat's `ExactMoney#clamp`. The bounds may be exact
    /// amounts or [`AnyMoney`] (owned or borrowed), as ducat's take either. An error where
    /// `Ord::clamp` would panic.
    ///
    /// # Errors
    ///
    /// In ducat's order: [`Error::CurrencyMismatch`] when `lo` and `hi` differ (`expected`
    /// `lo`'s currency, `actual` `hi`'s); [`Error::LowAboveHigh`] when `lo > hi`;
    /// [`Error::CurrencyMismatch`] when `self` is in another currency than the bounds
    /// (`expected` `lo`'s currency, `actual` `self`'s: ducat's `this.max(lo)` compares `lo` with
    /// `this`).
    pub fn clamp(&self, lo: impl Into<Self>, hi: impl Into<Self>) -> Result<Self, Error> {
        let (lo, hi) = (lo.into(), hi.into());
        if lo.compare(&hi)? == Ordering::Greater {
            return Err(Error::LowAboveHigh);
        }
        Ok(if lo.compare(self)? == Ordering::Greater {
            lo
        } else if hi.value < self.value {
            hi
        } else {
            self.clone()
        })
    }

    /// Rounds once to `scale` (default: the currency's exponent).
    ///
    /// # Errors
    ///
    /// As [`ExactMoney::round`].
    pub fn round(
        &self,
        rounding: impl Into<RoundingInput>,
        scale: Option<u16>,
    ) -> Result<AnyMoney, Error> {
        Ok(AnyMoney::from_parts(
            round_input_value(&self.value, rounding.into(), scale, self.currency)?,
            self.currency,
        ))
    }

    /// As [`ExactMoney::round_with_residual`].
    ///
    /// # Errors
    ///
    /// As [`ExactMoney::round`].
    pub fn round_with_residual(
        &self,
        rounding: impl Into<RoundingInput>,
        scale: Option<u16>,
    ) -> Result<Rounded<AnyMoney, Self>, Error> {
        let value = self.round(rounding, scale)?;
        let residual = self.with(self.value.sub(&value_of(&value.amount)));
        Ok(Rounded { value, residual })
    }

    /// As [`ExactMoney::to_money`].
    ///
    /// # Errors
    ///
    /// As [`ExactMoney::to_money`].
    pub fn to_money(&self, minimum_scale: Option<u16>) -> Result<AnyMoney, Error> {
        let minimum = minimum_scale.unwrap_or(u16::from(self.currency.exponent()));
        Ok(AnyMoney::from_parts(
            exact_amount(&self.value, minimum)?,
            self.currency,
        ))
    }

    /// As [`ExactMoney::add_tax`].
    ///
    /// # Errors
    ///
    /// As [`ExactMoney::add_tax`].
    pub fn add_tax(&self, percent: impl Factor) -> Result<ExactTaxBreakdown<Self>, Error> {
        let tax = self.with(self.value.mul(&percent_of(percent)?));
        Ok(ExactTaxBreakdown {
            gross: self.with(self.value.add(&tax.value)),
            net: self.clone(),
            tax,
        })
    }

    /// As [`ExactMoney::extract_tax`].
    ///
    /// # Errors
    ///
    /// As [`ExactMoney::extract_tax`].
    pub fn extract_tax(&self, percent: impl Factor) -> Result<ExactTaxBreakdown<Self>, Error> {
        let net = self.with(self.value.mul(&net_share(percent)?));
        Ok(ExactTaxBreakdown {
            tax: self.with(self.value.sub(&net.value)),
            net,
            gross: self.clone(),
        })
    }
}

impl<C: Currency> Money<C> {
    /// The exact value, to chain without rounding: `price.exact().divide(3)?.round(…)`.
    #[must_use]
    pub fn exact(&self) -> ExactMoney<C> {
        ExactMoney::of(value_of(&self.amount))
    }

    /// `self × factor` exactly, as money: the scale grows to hold every digit, and never falls
    /// below the amount's own, so 10.00 EUR × 1.0775 is 10.775 EUR, and × 2 stays 20.00 EUR.
    ///
    /// # Errors
    ///
    /// In ducat's order: whatever reading `factor` fails with; [`Error::Rounding`] when the
    /// product has no finite decimal form (a factor such as 1/3), ducat's `RoundingError`;
    /// [`Error::InvalidScale`] when it needs more than [`MAX_SCALE`](crate::MAX_SCALE) places,
    /// ducat's `RangeError`.
    pub fn multiply_exact(&self, factor: impl Factor) -> Result<Self, Error> {
        let product = value_of(&self.amount).mul(&factor.to_ratio()?);
        Ok(Self::from_amount(exact_amount(
            &product,
            self.amount.scale,
        )?))
    }
}

impl AnyMoney {
    /// As [`Money::exact`].
    #[must_use]
    pub fn exact(&self) -> AnyExactMoney {
        AnyExactMoney {
            value: value_of(&self.amount),
            currency: self.currency(),
        }
    }

    /// As [`Money::multiply_exact`].
    ///
    /// # Errors
    ///
    /// As [`Money::multiply_exact`].
    pub fn multiply_exact(&self, factor: impl Factor) -> Result<Self, Error> {
        let product = value_of(&self.amount).mul(&factor.to_ratio()?);
        Ok(Self::from_parts(
            exact_amount(&product, self.amount.scale)?,
            self.currency(),
        ))
    }
}

macro_rules! exact_operator {
    ($trait:ident, $method:ident, $ratio:ident) => {
        impl<C: Currency> $trait<&ExactMoney<C>> for &ExactMoney<C> {
            type Output = ExactMoney<C>;

            fn $method(self, other: &ExactMoney<C>) -> ExactMoney<C> {
                ExactMoney::of(self.value.$ratio(&other.value))
            }
        }

        impl<C: Currency> $trait for ExactMoney<C> {
            type Output = ExactMoney<C>;

            fn $method(self, other: ExactMoney<C>) -> ExactMoney<C> {
                (&self).$method(&other)
            }
        }

        impl<C: Currency> $trait<&Money<C>> for &ExactMoney<C> {
            type Output = ExactMoney<C>;

            fn $method(self, other: &Money<C>) -> ExactMoney<C> {
                ExactMoney::of(self.value.$ratio(&value_of(&other.amount)))
            }
        }
    };
}
exact_operator!(Add, add, add);
exact_operator!(Sub, sub, sub);

impl<C: Currency> Neg for &ExactMoney<C> {
    type Output = ExactMoney<C>;

    fn neg(self) -> ExactMoney<C> {
        ExactMoney::of(self.value.neg())
    }
}

impl<C: Currency> Neg for ExactMoney<C> {
    type Output = ExactMoney<C>;

    fn neg(self) -> ExactMoney<C> {
        -&self
    }
}

impl Neg for &AnyExactMoney {
    type Output = AnyExactMoney;

    fn neg(self) -> AnyExactMoney {
        self.with(self.value.neg())
    }
}

impl Neg for AnyExactMoney {
    type Output = Self;

    fn neg(self) -> Self {
        -&self
    }
}

impl<C: Currency> core::iter::Sum for ExactMoney<C> {
    /// The exact sum; zero for none.
    fn sum<I: Iterator<Item = Self>>(items: I) -> Self {
        items.fold(Self::zero(), |sum, item| sum + item)
    }
}

impl<C: Currency> fmt::Display for ExactMoney<C> {
    /// `10/3 EUR`, or `10 EUR` for a whole amount: for debugging, never rounded.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.value, C::CODE)
    }
}

impl<C: Currency> fmt::Debug for ExactMoney<C> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ExactMoney({self})")
    }
}

impl fmt::Display for AnyExactMoney {
    /// `10/3 EUR`, as [`ExactMoney`]'s.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.value, self.currency)
    }
}

impl fmt::Debug for AnyExactMoney {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "AnyExactMoney({self})")
    }
}

impl<C: Currency> From<ExactMoney<C>> for AnyExactMoney {
    fn from(exact: ExactMoney<C>) -> Self {
        Self {
            value: exact.value,
            currency: C::CODE,
        }
    }
}

impl<C: Currency> From<&ExactMoney<C>> for ExactMoney<C> {
    /// A copy, so that operations taking `impl Into<ExactMoney<C>>` take references too.
    fn from(exact: &ExactMoney<C>) -> Self {
        exact.clone()
    }
}

impl<C: Currency> From<&Money<C>> for ExactMoney<C> {
    /// As [`Money::exact`].
    fn from(money: &Money<C>) -> Self {
        money.exact()
    }
}

impl<C: Currency> From<Money<C>> for ExactMoney<C> {
    /// As [`Money::exact`].
    fn from(money: Money<C>) -> Self {
        money.exact()
    }
}

impl From<&AnyExactMoney> for AnyExactMoney {
    /// A copy, so that operations taking `impl Into<AnyExactMoney>` take references too.
    fn from(exact: &AnyExactMoney) -> Self {
        exact.clone()
    }
}

impl From<&AnyMoney> for AnyExactMoney {
    /// As [`AnyMoney::exact`].
    fn from(money: &AnyMoney) -> Self {
        money.exact()
    }
}

impl From<AnyMoney> for AnyExactMoney {
    /// As [`AnyMoney::exact`].
    fn from(money: AnyMoney) -> Self {
        money.exact()
    }
}

impl<C: Currency> TryFrom<AnyExactMoney> for ExactMoney<C> {
    type Error = Error;

    /// Narrows to the typed currency.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] for another currency.
    fn try_from(exact: AnyExactMoney) -> Result<Self, Error> {
        if exact.currency == C::CODE {
            Ok(Self::of(exact.value))
        } else {
            Err(Error::CurrencyMismatch {
                expected: C::CODE,
                actual: exact.currency,
            })
        }
    }
}
