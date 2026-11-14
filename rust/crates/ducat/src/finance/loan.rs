//! Loan repayment schedules and payment dates.

use alloc::vec::Vec;
use core::cmp::Ordering;
use core::fmt;
use core::str::FromStr;

use super::{
    Date, MoneyKind, amount_in, amount_of, check_periods, exponent_of, is_whole_minor, money_like,
    multiply_by_ratio, round_quotient, sum_amounts,
};
use crate::allocate::InstalmentRemainder;
use crate::amount::Amount;
use crate::{AnyMoney, Currency, Error, Factor, Int, Money, Ratio, Rounding};

/// How a loan is repaid.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum AmortisationMethod {
    /// `"annuity"` (French): equal payments of interest and principal.
    #[default]
    Annuity,
    /// `"linear"` (German): equal principal parts, with interest on top, so payments fall.
    Linear,
    /// `"interestOnly"` (bullet): interest every period, and the principal with the last payment.
    InterestOnly,
}

impl AmortisationMethod {
    /// ducat's name for the method: `"annuity"`, `"linear"` or `"interestOnly"`.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Annuity => "annuity",
            Self::Linear => "linear",
            Self::InterestOnly => "interestOnly",
        }
    }
}

impl fmt::Display for AmortisationMethod {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl FromStr for AmortisationMethod {
    type Err = Error;

    /// Parses a name from [`AmortisationMethod::name`]; anything else is [`Error::Syntax`].
    fn from_str(name: &str) -> Result<Self, Error> {
        [Self::Annuity, Self::Linear, Self::InterestOnly]
            .into_iter()
            .find(|method| method.name() == name)
            .ok_or(Error::Syntax)
    }
}

/// Where an annuity's rounding residual goes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum AmortisationResidual {
    /// `"lastPayment"`: to the last payment, as most lenders do.
    #[default]
    LastPayment,
    /// `"lastInterest"`: to the last period's interest, which keeps the last payment equal to the
    /// others. Annuities with a non-zero rate only.
    LastInterest,
}

impl AmortisationResidual {
    /// ducat's name: `"lastPayment"` or `"lastInterest"`.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::LastPayment => "lastPayment",
            Self::LastInterest => "lastInterest",
        }
    }
}

impl fmt::Display for AmortisationResidual {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl FromStr for AmortisationResidual {
    type Err = Error;

    /// Parses a name from [`AmortisationResidual::name`]; anything else is [`Error::Syntax`].
    fn from_str(name: &str) -> Result<Self, Error> {
        [Self::LastPayment, Self::LastInterest]
            .into_iter()
            .find(|residual| residual.name() == name)
            .ok_or(Error::Syntax)
    }
}

/// The terms of an amortisation schedule, for [`Money::amortise`] and [`AnyMoney::amortise`]. `M`
/// is the money type of the balloon.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AmortiseOptions<M> {
    /// The nominal annual rate (`0.045` for 4.5%), not negative.
    pub rate: Ratio,
    /// Payments per year (12 for monthly): the periodic rate is `rate / per_year`.
    pub per_year: u32,
    /// The number of payments, 1 to [`MAX_PERIODS`](super::MAX_PERIODS).
    pub periods: u32,
    /// How the loan is repaid.
    pub method: AmortisationMethod,
    /// How every payment and interest charge is rounded, to the currency's exponent.
    pub rounding: Rounding,
    /// An amount still owed after the regular payments, paid with the last one (annuity and
    /// linear only).
    pub balloon: Option<M>,
    /// The date of the first payment; the rows then carry dates, as [`payment_dates`] gives them.
    pub first_payment: Option<Date>,
    /// Where an annuity's rounding residual goes.
    pub residual: AmortisationResidual,
}

impl<M> AmortiseOptions<M> {
    /// An annuity at `rate` a year over `periods` payments, `per_year` a year, rounded with
    /// `rounding`, with no balloon, no dates and the residual on the last payment.
    ///
    /// # Errors
    ///
    /// Whatever reading `rate` fails with.
    pub fn new(
        rate: impl Factor,
        per_year: u32,
        periods: u32,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        Ok(Self {
            rate: rate.to_ratio()?,
            per_year,
            periods,
            method: AmortisationMethod::Annuity,
            rounding,
            balloon: None,
            first_payment: None,
            residual: AmortisationResidual::LastPayment,
        })
    }

    /// The same terms repaid by `method`.
    #[must_use]
    pub fn with_method(self, method: AmortisationMethod) -> Self {
        Self { method, ..self }
    }

    /// The same terms with a balloon.
    #[must_use]
    pub fn with_balloon(self, balloon: M) -> Self {
        Self {
            balloon: Some(balloon),
            ..self
        }
    }

    /// The same terms with the first payment on `date`.
    #[must_use]
    pub fn with_first_payment(self, date: Date) -> Self {
        Self {
            first_payment: Some(date),
            ..self
        }
    }

    /// The same terms with the residual going to `residual`.
    #[must_use]
    pub fn with_residual(self, residual: AmortisationResidual) -> Self {
        Self { residual, ..self }
    }
}

/// One payment of an amortisation schedule.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct AmortisationRow<M> {
    /// 1 for the first payment.
    pub period: u32,
    /// The payment date, when the options have a first payment.
    pub date: Option<Date>,
    /// Interest plus principal.
    pub payment: M,
    /// This period's interest: the balance before the payment times the periodic rate, rounded.
    pub interest: M,
    /// The part of the payment that repays the loan.
    pub principal: M,
    /// What is still owed after the payment.
    pub balance: M,
}

/// A loan's repayment schedule.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Amortisation<M> {
    /// The regular payment: for an annuity every payment but possibly the last; for a linear loan
    /// the first (the largest); for an interest-only loan the interest payment.
    pub payment: M,
    /// One row per payment.
    pub rows: Vec<AmortisationRow<M>>,
    /// The sum of the interest column, exactly.
    pub total_interest: M,
}

/// The dates of `count` payments, `per_year` a year, from `first`. With `per_year` 1, 2, 3, 4, 6
/// or 12 they step by whole months from `first`, on its day of the month, clamped to shorter
/// months (31 January, then 28 or 29 February, then 31 March). That is not an end-of-month rule:
/// from 30 November, quarterly dates are 28 or 29 February and then 30 May, not 31 May; start
/// from a 31st for month ends. With 26 or 52 the payments are every 14 or 7 days.
///
/// ```
/// use ducat::finance::payment_dates;
///
/// let dates = payment_dates("2026-01-31".parse()?, 12, 3)?;
/// assert_eq!(dates.iter().map(ToString::to_string).collect::<Vec<_>>(), ["2026-01-31", "2026-02-28", "2026-03-31"]);
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::InvalidPerYear`] for a `per_year` other than 1, 2, 3, 4, 6, 12, 26 or 52;
/// [`Error::DateOutOfRange`] when the dates run past the year 9999.
pub fn payment_dates(first: Date, per_year: u32, count: u32) -> Result<Vec<Date>, Error> {
    if per_year == 26 || per_year == 52 {
        let step = if per_year == 52 { 7 } else { 14 };
        return (0..i64::from(count))
            .map(|index| first.add_days(index * step))
            .collect();
    }
    if per_year == 0 || 12 % per_year != 0 {
        // payment dates step by whole months, or by 7 or 14 days
        return Err(Error::InvalidPerYear);
    }
    let step = 12 / per_year;
    (0..count)
        .map(|index| {
            index
                .checked_mul(step)
                .ok_or(Error::DateOutOfRange)
                .and_then(|months| first.add_months(months))
        })
        .collect()
}

/// One row, as amounts.
struct Row {
    payment: Amount,
    interest: Amount,
    principal: Amount,
    balance: Amount,
}

fn amortise_of<M: MoneyKind>(
    loan: &M,
    options: &AmortiseOptions<M>,
) -> Result<Amortisation<M>, Error> {
    let AmortiseOptions {
        ref rate,
        per_year,
        periods,
        method,
        rounding,
        ref balloon,
        first_payment,
        residual,
    } = *options;
    let exponent = exponent_of(loan);
    let zero = Amount {
        units: Int::ZERO,
        scale: exponent,
    };
    check_periods(periods, 1)?;
    if per_year == 0 {
        return Err(Error::InvalidPerYear);
    }
    let loan_amount = amount_of(loan);
    if !loan_amount.units.is_positive() {
        return Err(Error::InvalidLoan);
    }
    let balloon_amount = match balloon {
        Some(balloon) => amount_in(loan, balloon)?,
        None => zero.clone(),
    };
    if balloon_amount.units.is_negative()
        || balloon_amount.cmp_value(&loan_amount) == Ordering::Greater
        || (balloon.is_some() && method == AmortisationMethod::InterestOnly)
    {
        return Err(Error::InvalidBalloon);
    }
    if !is_whole_minor(&loan_amount, exponent) || !is_whole_minor(&balloon_amount, exponent) {
        return Err(Error::NotAMultiple);
    }
    if rate.numer().is_negative() {
        return Err(Error::NegativeRate);
    }
    let zero_rate = rate.is_zero();
    // with no interest to round, there is no residual to put in it
    if residual == AmortisationResidual::LastInterest
        && (method != AmortisationMethod::Annuity || zero_rate)
    {
        return Err(Error::InvalidResidual);
    }
    let dates = first_payment
        .map(|first| payment_dates(first, per_year, periods))
        .transpose()?;
    let rate_per_period = Ratio::new(rate.numer().clone(), rate.denom() * &Int::from(per_year))?;
    let interest_on =
        |balance: &Amount| multiply_by_ratio(balance, &rate_per_period, exponent, rounding);
    // periods is at most MAX_PERIODS, so it fits a usize
    let count = periods as usize;

    let mut rows: Vec<Row> = Vec::with_capacity(count);
    let payment = if method == AmortisationMethod::Linear
        || (method == AmortisationMethod::Annuity && zero_rate)
    {
        // The principal parts of a linear loan, or of any loan at a zero rate: equal parts that
        // sum to the loan exactly, each a whole number of minor units, the remainder in the last.
        let unit = Amount {
            units: Int::ONE,
            scale: exponent,
        };
        let parts = loan_amount.sub(&balloon_amount).instalments(
            count,
            Some(&unit),
            InstalmentRemainder::ToLast,
        )?;
        let mut balance = loan_amount.clone();
        for (index, part) in parts.into_iter().enumerate() {
            let principal = if index == count - 1 {
                balance.clone()
            } else {
                part
            };
            let interest = interest_on(&balance)?;
            balance = balance.sub(&principal);
            rows.push(Row {
                payment: principal.add(&interest),
                interest,
                principal,
                balance: balance.clone(),
            });
        }
        rows[0].payment.clone()
    } else if method == AmortisationMethod::InterestOnly {
        let interest = interest_on(&loan_amount)?;
        for index in 0..count {
            let last = index == count - 1;
            let principal = if last {
                loan_amount.clone()
            } else {
                zero.clone()
            };
            rows.push(Row {
                payment: principal.add(&interest),
                interest: interest.clone(),
                principal,
                balance: if last {
                    zero.clone()
                } else {
                    loan_amount.clone()
                },
            });
        }
        interest
    } else {
        annuity_rows(
            &loan_amount,
            &balloon_amount,
            &rate_per_period,
            periods,
            exponent,
            rounding,
            residual,
            &mut rows,
        )?
    };

    let total_interest = sum_amounts(rows.iter().map(|row| &row.interest), exponent);
    let rows = rows
        .into_iter()
        .enumerate()
        .map(|(index, row)| AmortisationRow {
            // at most MAX_PERIODS rows
            period: index as u32 + 1,
            date: dates.as_ref().map(|dates| dates[index]),
            payment: money_like(loan, row.payment),
            interest: money_like(loan, row.interest),
            principal: money_like(loan, row.principal),
            balance: money_like(loan, row.balance),
        })
        .collect();
    Ok(Amortisation {
        payment: money_like(loan, payment),
        rows,
        total_interest: money_like(loan, total_interest),
    })
}

/// An annuity's rows, returning the regular payment.
#[allow(clippy::too_many_arguments)]
fn annuity_rows(
    loan: &Amount,
    balloon: &Amount,
    rate: &Ratio,
    periods: u32,
    exponent: u16,
    rounding: Rounding,
    residual: AmortisationResidual,
    rows: &mut Vec<Row>,
) -> Result<Amount, Error> {
    // payment = (P·g^n − B)·r / (g^n − 1), with r = a/b and g = 1 + r = (a + b)/b. With
    // G = (a + b)^n and H = b^n that is (P·G − B·H)·a / (b·(G − H)), and P and B are units over
    // 10^scale, so the exact payment is one fraction of integers, rounded once.
    let scale = loan.scale.max(balloon.scale);
    let loan_units = loan.units.mul_pow10(u32::from(scale - loan.scale));
    let balloon_units = balloon.units.mul_pow10(u32::from(scale - balloon.scale));
    let growth_power = (rate.numer() + rate.denom()).pow(periods);
    let base_power = rate.denom().pow(periods);
    let payment = round_quotient(
        &((loan_units * &growth_power - balloon_units * &base_power) * rate.numer()),
        &(Int::ONE.mul_pow10(u32::from(scale)) * rate.denom() * (growth_power - &base_power)),
        exponent,
        rounding,
    )?;

    let mut balance = loan.clone();
    for index in 0..periods {
        let interest = multiply_by_ratio(&balance, rate, exponent, rounding)?;
        let last = index == periods - 1;
        let owed = balance.add(&interest);
        // the last payment, or a regular payment that would clear more than is owed, settles it
        if last || payment.cmp_value(&owed) != Ordering::Less {
            let cleared = balance.sub(&balance);
            if last && residual == AmortisationResidual::LastInterest {
                let last_payment = payment.add(balloon);
                let last_interest = last_payment.sub(&balance);
                if last_interest.units.is_negative() {
                    return Err(Error::InvalidResidual);
                }
                rows.push(Row {
                    payment: last_payment,
                    interest: last_interest,
                    principal: balance,
                    balance: cleared,
                });
            } else {
                rows.push(Row {
                    payment: owed,
                    interest,
                    principal: balance,
                    balance: cleared,
                });
            }
            break;
        }
        let principal = payment.sub(&interest);
        balance = balance.sub(&principal);
        rows.push(Row {
            payment: payment.clone(),
            interest,
            principal,
            balance: balance.clone(),
        });
    }
    Ok(payment)
}

impl<C: Currency> Money<C> {
    /// The loan's repayment schedule. Each period's interest is the balance times
    /// `rate / per_year`, rounded once; the principal part is the payment minus the interest. The
    /// principal parts sum exactly to the loan, the balance never goes negative, and it ends at
    /// exactly zero: the rounding residual goes to the last payment (or, with
    /// [`AmortisationResidual::LastInterest`], to the last interest). If rounded payments clear the
    /// loan early, the schedule ends with the payment that clears it, so it can have fewer rows
    /// than `periods`. At a zero rate the payments are equal instalments with the remainder on the
    /// last. The loan and the balloon must be whole numbers of minor units.
    ///
    /// ```
    /// use ducat::{Money, Rounding};
    /// use ducat::finance::AmortiseOptions;
    /// use ducat::iso::Eur;
    ///
    /// let loan: Money<Eur> = "200000".parse()?;
    /// let schedule = loan.amortise(&AmortiseOptions::new("0.045", 12, 300, Rounding::HalfExpand)?)?;
    /// assert_eq!(schedule.payment.to_decimal(), "1111.66");
    /// assert!(schedule.rows.last().is_some_and(|row| row.balance.is_zero()));
    /// # Ok::<(), ducat::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::InvalidPeriods`] for periods outside 1 to [`MAX_PERIODS`](super::MAX_PERIODS);
    /// [`Error::InvalidPerYear`] for a `per_year` of zero (or, with a first payment, one that
    /// [`payment_dates`] doesn't take); [`Error::InvalidLoan`] for a loan that isn't positive;
    /// [`Error::InvalidBalloon`] for a balloon that isn't between zero and the loan, or with an
    /// interest-only loan; [`Error::NotAMultiple`] for a loan or balloon that isn't a whole number
    /// of minor units; [`Error::NegativeRate`]; [`Error::InvalidResidual`] for
    /// [`AmortisationResidual::LastInterest`] on anything but an annuity with a non-zero rate, or
    /// a residual larger than the last interest; [`Error::DateOutOfRange`] for payment dates past
    /// 9999; [`Error::Rounding`] with [`Rounding::Unnecessary`].
    pub fn amortise(&self, options: &AmortiseOptions<Self>) -> Result<Amortisation<Self>, Error> {
        amortise_of(self, options)
    }
}

impl AnyMoney {
    /// As [`Money::amortise`].
    ///
    /// # Errors
    ///
    /// As [`Money::amortise`], and [`Error::CurrencyMismatch`] for a balloon in another currency.
    pub fn amortise(&self, options: &AmortiseOptions<Self>) -> Result<Amortisation<Self>, Error> {
        amortise_of(self, options)
    }
}
