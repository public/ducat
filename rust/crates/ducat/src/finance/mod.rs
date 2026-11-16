//! Day counts, simple and compound interest, periodic and annual rates, loan and savings
//! schedules, discounted sums and proration, in exact arithmetic: ducat's `/finance`. Excel's NPV
//! and IRR are in [`crate::excel`], with the other functions named after Excel's, as in ducat.
//!
//! Every amount that is paid or booked is rounded once from its exact value, with an explicit
//! [`Rounding`](crate::Rounding) to the currency's exponent; nothing in between is rounded, and no floats are used.
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

mod day_count;
mod loan;
mod proration;
pub(crate) mod rates;
mod savings;

pub use crate::date::Date;
pub use day_count::{DayCount, InterestPeriod, year_fraction};
pub use loan::{
    Amortisation, AmortisationMethod, AmortisationResidual, AmortisationRow, AmortiseOptions,
    payment_dates,
};
pub use proration::{ProrationInstant, ProrationPeriod, ProrationUnit};
#[cfg(feature = "exact")]
pub use rates::discounted_sum_exact;
pub use rates::{GridValue, PeriodicRate, annual_rate, discounted_sum, periodic_rate};
pub use savings::{
    ContributionTiming, SavingsPlan, SavingsPlanOptions, SavingsPlanRow, savings_plan,
};

pub use crate::MoneyKind;
use crate::amount::{Amount, AmountSum};
use crate::{CurrencyCode, Error, Int, Ratio, RoundingInput};

/// The most periods a schedule or a compounding may have: `(1 + r)^n` has about `n` times the
/// bits of `1 + r`, so this bounds the integers.
pub const MAX_PERIODS: u32 = 100_000;

/// The amount of `money`.
pub(crate) fn amount_of<M: MoneyKind>(money: &M) -> Amount {
    let (units, scale, _) = money.parts();
    Amount {
        units: units.clone(),
        scale,
    }
}

/// `amount` in `template`'s currency.
pub(crate) fn money_like<M: MoneyKind>(template: &M, amount: Amount) -> M {
    template.with_units(amount.units, amount.scale)
}

/// The currency's exponent, the scale every rounded result has.
pub(crate) fn exponent_of<M: MoneyKind>(money: &M) -> u16 {
    u16::from(money.parts().2.exponent())
}

/// `other`'s amount, when it is in `money`'s currency.
pub(crate) fn amount_in<M: MoneyKind>(money: &M, other: &M) -> Result<Amount, Error> {
    let (expected, actual) = (money.parts().2, other.parts().2);
    if expected == actual {
        Ok(amount_of(other))
    } else {
        Err(Error::CurrencyMismatch { expected, actual })
    }
}

/// The currency of `money`.
pub(crate) fn currency_of<M: MoneyKind>(money: &M) -> CurrencyCode {
    money.parts().2
}

/// `numerator / denominator` major units of `currency` (`denominator` positive), rounded once:
/// with a mode to the currency's exponent, with a policy to its scale and increment. The fraction
/// isn't reduced first: rounding divides once either way.
pub(crate) fn round_quotient(
    numerator: &Int,
    denominator: &Int,
    currency: CurrencyCode,
    rounding: RoundingInput,
) -> Result<Amount, Error> {
    let one = Amount {
        units: Int::ONE,
        scale: 0,
    };
    one.round_input(
        numerator,
        denominator,
        u16::from(currency.exponent()),
        rounding,
        currency,
    )
}

/// `amount × numerator / denominator` (`denominator` positive) in `currency`, rounded once as
/// [`round_quotient`] rounds.
fn multiply_and_round(
    amount: &Amount,
    numerator: &Int,
    denominator: &Int,
    currency: CurrencyCode,
    rounding: RoundingInput,
) -> Result<Amount, Error> {
    amount.round_input(
        numerator,
        denominator,
        u16::from(currency.exponent()),
        rounding,
        currency,
    )
}

/// `amount × factor` in `currency`, rounded once as [`round_quotient`] rounds.
fn multiply_by_ratio(
    amount: &Amount,
    factor: &Ratio,
    currency: CurrencyCode,
    rounding: RoundingInput,
) -> Result<Amount, Error> {
    multiply_and_round(amount, factor.numer(), factor.denom(), currency, rounding)
}

/// The smallest amount a rounding produces in `currency`: one minor unit with a mode, one
/// increment at its scale with a policy.
fn rounding_unit(currency: CurrencyCode, rounding: RoundingInput) -> Amount {
    match rounding {
        RoundingInput::Mode(_) => Amount {
            units: Int::ONE,
            scale: u16::from(currency.exponent()),
        },
        #[cfg(feature = "policy")]
        RoundingInput::Policy(policy) => Amount {
            units: Int::from(policy.increment()),
            scale: policy
                .scale()
                .unwrap_or_else(|| u16::from(currency.exponent())),
        },
    }
}

/// Whether `amount` is a whole number of `unit`s (`unit` positive).
fn is_multiple(amount: &Amount, unit: &Amount) -> bool {
    let scale = amount.scale.max(unit.scale);
    let units = amount.units.mul_pow10(u32::from(scale - amount.scale));
    let step = unit.units.mul_pow10(u32::from(scale - unit.scale));
    units.div_rem(&step).1.is_zero()
}

/// A periods count from `minimum` to [`MAX_PERIODS`].
pub(crate) fn check_periods(periods: u32, minimum: u32) -> Result<(), Error> {
    if (minimum..=MAX_PERIODS).contains(&periods) {
        Ok(())
    } else {
        Err(Error::InvalidPeriods)
    }
}

/// The sum of amounts, from zero at `exponent`.
fn sum_amounts<'a>(amounts: impl Iterator<Item = &'a Amount>, exponent: u16) -> Amount {
    let mut total = AmountSum::zero(exponent);
    for amount in amounts {
        total.add(amount);
    }
    total.finish()
}
