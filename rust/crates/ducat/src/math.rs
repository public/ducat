//! Averages, shares, integral division, trimming the scale, and the complement of a ratio
//! (ducat's `/math`). Everything is exact; only an average rounds, once, after an exact sum.
//!
//! ducat's other ratio helpers are [`Ratio`]'s own methods here: `ratioAdd` is [`Ratio::add`],
//! `ratioSubtract` [`Ratio::sub`], `ratioMultiply` [`Ratio::mul`], `ratioDivide` [`Ratio::div`],
//! `ratioNegate` [`Ratio::neg`] and `ratioCompare` [`Ord::cmp`].
//!
//! ```
//! use ducat::{Money, Ratio, Rounding};
//! use ducat::iso::Eur;
//!
//! let amounts: Vec<Money<Eur>> = ["10", "10", "10.01"].iter().map(|a| a.parse()).collect::<Result<_, _>>()?;
//! assert_eq!(Money::average(&amounts, Rounding::HalfExpand)?.to_decimal(), "10.00");
//!
//! let price: Money<Eur> = "9.99".parse()?;
//! let coin: Money<Eur> = "2.50".parse()?;
//! assert_eq!(price.divide_to_integral(&coin)?.to_string(), "3");
//! assert_eq!(price.remainder(&coin)?.to_decimal(), "2.49");
//! assert_eq!("0.15".parse::<Ratio>()?.complement().to_string(), "17/20");
//! # Ok::<(), ducat::Error>(())
//! ```

use crate::amount::Amount;
use crate::{AnyMoney, Currency, CurrencyCode, Error, Int, Money, Ratio, RoundingInput};

impl Ratio {
    /// `1 − self`: the complement of a share or rate (ducat's `ratioComplement`).
    #[must_use]
    pub fn complement(&self) -> Self {
        Self::ONE.sub(self)
    }
}

impl Amount {
    /// Both amounts' units at their common (larger) scale.
    fn aligned(&self, other: &Self) -> (Int, Int, u16) {
        let scale = self.scale.max(other.scale);
        (
            self.units.mul_pow10(u32::from(scale - self.scale)),
            other.units.mul_pow10(u32::from(scale - other.scale)),
            scale,
        )
    }

    fn average(
        amounts: &[&Self],
        rounding: RoundingInput,
        currency: CurrencyCode,
    ) -> Result<Self, Error> {
        let Some(first) = amounts.first() else {
            return Err(Error::NoAmounts);
        };
        // the sum is exact at the largest scale, so the division is the only rounding
        let sum = amounts[1..]
            .iter()
            .fold((*first).clone(), |total, amount| total.add(amount));
        sum.round_input(
            &Int::ONE,
            &Int::from(amounts.len()),
            sum.scale,
            rounding,
            currency,
        )
    }

    fn ratio_of(&self, other: &Self) -> Result<Ratio, Error> {
        let (left, right, _) = self.aligned(other);
        Ratio::new(left, right)
    }

    fn divide_to_integral(&self, divisor: &Self) -> Result<Int, Error> {
        let (left, right, _) = self.aligned(divisor);
        if right.is_zero() {
            return Err(Error::DivisionByZero);
        }
        // truncated toward zero
        Ok(left.div_rem(&right).0)
    }

    fn remainder(&self, divisor: &Self) -> Result<Self, Error> {
        let (left, right, scale) = self.aligned(divisor);
        if right.is_zero() {
            return Err(Error::DivisionByZero);
        }
        // the remainder of truncating division, with the dividend's sign
        Ok(Self {
            units: left.div_rem(&right).1,
            scale,
        })
    }
}

impl<C: Currency> Money<C> {
    /// The average of `amounts` (any scales): their exact sum divided by their count, rounded
    /// once, with a mode at the largest scale among them, or with a rounding policy to its scale
    /// and increment.
    ///
    /// # Errors
    ///
    /// [`Error::NoAmounts`] for an empty list; [`Error::Rounding`] with
    /// [`Rounding::Unnecessary`](crate::Rounding::Unnecessary); [`Error::CurrencyMismatch`] for a
    /// policy for another currency.
    pub fn average(amounts: &[Self], rounding: impl Into<RoundingInput>) -> Result<Self, Error> {
        let amounts: alloc::vec::Vec<&Amount> = amounts.iter().map(|money| &money.amount).collect();
        Ok(Self::from_amount(Amount::average(
            &amounts,
            rounding.into(),
            C::CODE,
        )?))
    }

    /// The exact share `self / other` (any scales), reduced: "what share of the total is this".
    /// A [`Ratio`] goes straight to `multiply` or `allocate`.
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`] when `other` is zero.
    pub fn ratio_of(&self, other: &Self) -> Result<Ratio, Error> {
        self.amount.ratio_of(&other.amount)
    }

    /// How many whole times `divisor` fits into the amount (any scales), truncated toward zero, so
    /// that `self = divisor × divide_to_integral + remainder` exactly.
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`] for a zero divisor.
    pub fn divide_to_integral(&self, divisor: &Self) -> Result<Int, Error> {
        self.amount.divide_to_integral(&divisor.amount)
    }

    /// What is left of the amount after taking `divisor` out a whole number of times, at the
    /// larger scale, with the amount's sign: −10 EUR remainder 3 EUR is −1.00 EUR.
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`] for a zero divisor.
    pub fn remainder(&self, divisor: &Self) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.remainder(&divisor.amount)?))
    }

    /// The same amount at the smallest scale that keeps it exact, but not below `minimum_scale`
    /// (default: the currency's exponent): 1.2300 EUR at scale 4 is 1.23 EUR. An amount at or
    /// below the minimum is unchanged; trimming never adds digits.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidScale`] for a minimum beyond [`MAX_SCALE`](crate::MAX_SCALE).
    pub fn trim_scale(&self, minimum_scale: Option<u16>) -> Result<Self, Error> {
        let minimum = minimum_scale.unwrap_or_else(|| u16::from(C::CODE.exponent()));
        Ok(Self::from_amount(self.amount.trim_scale(minimum)?))
    }
}

impl AnyMoney {
    /// As [`Money::average`].
    ///
    /// # Errors
    ///
    /// As [`Money::average`], and [`Error::CurrencyMismatch`] for amounts in more than one
    /// currency.
    pub fn average(amounts: &[Self], rounding: impl Into<RoundingInput>) -> Result<Self, Error> {
        let Some(first) = amounts.first() else {
            return Err(Error::NoAmounts);
        };
        let currency = first.currency();
        let mut parts = alloc::vec::Vec::with_capacity(amounts.len());
        for money in amounts {
            parts.push(first.amount_in(money)?);
        }
        Ok(Self::from_parts(
            Amount::average(&parts, rounding.into(), currency)?,
            currency,
        ))
    }

    /// As [`Money::ratio_of`].
    ///
    /// # Errors
    ///
    /// As [`Money::ratio_of`], and [`Error::CurrencyMismatch`] for another currency.
    pub fn ratio_of(&self, other: &Self) -> Result<Ratio, Error> {
        self.amount.ratio_of(self.amount_in(other)?)
    }

    /// As [`Money::divide_to_integral`].
    ///
    /// # Errors
    ///
    /// As [`Money::divide_to_integral`], and [`Error::CurrencyMismatch`] for another currency.
    pub fn divide_to_integral(&self, divisor: &Self) -> Result<Int, Error> {
        self.amount.divide_to_integral(self.amount_in(divisor)?)
    }

    /// As [`Money::remainder`].
    ///
    /// # Errors
    ///
    /// As [`Money::remainder`], and [`Error::CurrencyMismatch`] for another currency.
    pub fn remainder(&self, divisor: &Self) -> Result<Self, Error> {
        Ok(Self::from_parts(
            self.amount.remainder(self.amount_in(divisor)?)?,
            self.currency(),
        ))
    }

    /// As [`Money::trim_scale`].
    ///
    /// # Errors
    ///
    /// As [`Money::trim_scale`].
    pub fn trim_scale(&self, minimum_scale: Option<u16>) -> Result<Self, Error> {
        let minimum = minimum_scale.unwrap_or_else(|| u16::from(self.currency().exponent()));
        Ok(Self::from_parts(
            self.amount.trim_scale(minimum)?,
            self.currency(),
        ))
    }
}
