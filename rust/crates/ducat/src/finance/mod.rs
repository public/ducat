//! Day counts, simple and compound interest, periodic and annual rates, loan and savings
//! schedules, discounted sums and proration, in exact arithmetic: ducat's `/finance`. Excel's NPV
//! and IRR are in [`crate::excel`], with the other functions named after Excel's, as in ducat.
//!
//! Every amount that is paid or booked is rounded once from its exact value, with an explicit
//! [`Rounding`] to the currency's exponent; nothing in between is rounded, and no floats are used.
//! Irrational results (an IRR, a periodic rate) are found to a number of decimal places by exact
//! bisection on rationals. Dates are calendar [`Date`]s: proleptic Gregorian, no time, no time zone.
//!
//! ```
//! use ducat::{Money, Rounding};
//! use ducat::finance::{Date, DayCount, InterestPeriod, year_fraction};
//! use ducat::iso::Eur;
//!
//! let from: Date = "2026-01-15".parse()?;
//! let to: Date = "2026-07-15".parse()?;
//! assert_eq!(year_fraction(from, to, DayCount::Act360, None)?.to_string(), "181/360");
//!
//! let principal: Money<Eur> = "10000".parse()?;
//! let period = InterestPeriod::new(from, to, DayCount::Act365Fixed);
//! assert_eq!(principal.interest("0.05", &period, Rounding::HalfEven)?.to_decimal(), "247.95");
//! # Ok::<(), ducat::Error>(())
//! ```

mod date;
mod day_count;
mod loan;
mod proration;
pub(crate) mod rates;
mod savings;

pub use date::Date;
pub use day_count::{DayCount, InterestPeriod, year_fraction};
pub use loan::{
    Amortisation, AmortisationMethod, AmortisationResidual, AmortisationRow, AmortiseOptions,
    payment_dates,
};
pub use proration::{ProrationInstant, ProrationPeriod, ProrationUnit};
pub use rates::{GridRate, PeriodicRate, annual_rate, discounted_sum, periodic_rate};
pub use savings::{
    ContributionTiming, SavingsPlan, SavingsPlanOptions, SavingsPlanRow, savings_plan,
};

use crate::amount::Amount;
use crate::rounding::rescale_ratio;
use crate::{AnyMoney, Currency, CurrencyCode, Error, Int, Money, Ratio, Rounding};

/// The most periods a schedule or a compounding may have: `(1 + r)^n` has about `n` times the
/// bits of `1 + r`, so this bounds the integers.
pub const MAX_PERIODS: u32 = 100_000;

mod sealed {
    use crate::{CurrencyCode, Int};

    /// The money types the finance functions take; sealed, so only [`Money`](crate::Money) and
    /// [`AnyMoney`](crate::AnyMoney) implement it.
    pub trait Sealed: Clone {
        /// The units, the scale and the currency.
        fn parts(&self) -> (&Int, u16, CurrencyCode);
        /// An amount in this one's currency.
        fn with_units(&self, units: Int, scale: u16) -> Self;
    }
}

/// A money type the finance functions take: [`Money<C>`] or [`AnyMoney`]. The functions that take
/// several amounts (flows, a balloon) return [`Error::CurrencyMismatch`] for [`AnyMoney`] in more
/// than one currency; with [`Money<C>`] the type rules that out.
pub trait MoneyKind: sealed::Sealed {}

impl<C: Currency> sealed::Sealed for Money<C> {
    fn parts(&self) -> (&Int, u16, CurrencyCode) {
        (&self.amount.units, self.amount.scale, C::CODE)
    }

    fn with_units(&self, units: Int, scale: u16) -> Self {
        Self::from_amount(Amount { units, scale })
    }
}

impl<C: Currency> MoneyKind for Money<C> {}

impl sealed::Sealed for AnyMoney {
    fn parts(&self) -> (&Int, u16, CurrencyCode) {
        (&self.amount.units, self.amount.scale, self.currency())
    }

    fn with_units(&self, units: Int, scale: u16) -> Self {
        Self::from_parts(Amount { units, scale }, self.currency())
    }
}

impl MoneyKind for AnyMoney {}

/// The amount of `money`.
fn amount_of<M: MoneyKind>(money: &M) -> Amount {
    let (units, scale, _) = money.parts();
    Amount {
        units: units.clone(),
        scale,
    }
}

/// `amount` in `template`'s currency.
fn money_like<M: MoneyKind>(template: &M, amount: Amount) -> M {
    template.with_units(amount.units, amount.scale)
}

/// The currency's exponent, the scale every rounded result has.
fn exponent_of<M: MoneyKind>(money: &M) -> u16 {
    u16::from(money.parts().2.exponent())
}

/// `other`'s amount, when it is in `money`'s currency.
fn amount_in<M: MoneyKind>(money: &M, other: &M) -> Result<Amount, Error> {
    let (expected, actual) = (money.parts().2, other.parts().2);
    if expected == actual {
        Ok(amount_of(other))
    } else {
        Err(Error::CurrencyMismatch { expected, actual })
    }
}

/// `numerator / denominator` major units (`denominator` positive), rounded once to `exponent`
/// places. The fraction isn't reduced first: rounding divides once either way.
fn round_quotient(
    numerator: &Int,
    denominator: &Int,
    exponent: u16,
    rounding: Rounding,
) -> Result<Amount, Error> {
    Ok(Amount {
        units: rescale_ratio(
            numerator,
            &Int::ONE,
            denominator,
            u32::from(exponent),
            0,
            rounding,
        )?,
        scale: exponent,
    })
}

/// `amount × numerator / denominator` (`denominator` positive), rounded once to `exponent` places.
fn multiply_and_round(
    amount: &Amount,
    numerator: &Int,
    denominator: &Int,
    exponent: u16,
    rounding: Rounding,
) -> Result<Amount, Error> {
    let (up, down) = if exponent >= amount.scale {
        (u32::from(exponent - amount.scale), 0)
    } else {
        (0, u32::from(amount.scale - exponent))
    };
    Ok(Amount {
        units: rescale_ratio(&amount.units, numerator, denominator, up, down, rounding)?,
        scale: exponent,
    })
}

/// `amount × factor`, rounded once to `exponent` places.
fn multiply_by_ratio(
    amount: &Amount,
    factor: &Ratio,
    exponent: u16,
    rounding: Rounding,
) -> Result<Amount, Error> {
    multiply_and_round(amount, factor.numer(), factor.denom(), exponent, rounding)
}

/// Whether `amount` is a whole number of minor units at `exponent`.
fn is_whole_minor(amount: &Amount, exponent: u16) -> bool {
    amount.scale <= exponent
        || amount
            .units
            .div_rem(&Int::ONE.mul_pow10(u32::from(amount.scale - exponent)))
            .1
            .is_zero()
}

/// A periods count from `minimum` to [`MAX_PERIODS`].
fn check_periods(periods: u32, minimum: u32) -> Result<(), Error> {
    if (minimum..=MAX_PERIODS).contains(&periods) {
        Ok(())
    } else {
        Err(Error::InvalidPeriods)
    }
}

/// The sum of amounts, from zero at `exponent`.
fn sum_amounts<'a>(amounts: impl Iterator<Item = &'a Amount>, exponent: u16) -> Amount {
    amounts.fold(
        Amount {
            units: Int::ZERO,
            scale: exponent,
        },
        |total, amount| total.add(amount),
    )
}
