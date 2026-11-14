//! Savings plans: regular contributions earning interest, or the contribution that reaches a target.

use alloc::vec::Vec;
use core::cmp::Ordering;

use super::{
    Date, MoneyKind, amount_in, amount_of, check_periods, exponent_of, is_whole_minor, money_like,
    multiply_by_ratio, payment_dates, round_quotient,
};
use crate::amount::Amount;
use crate::{Error, Factor, Int, Ratio, Rounding};

/// The most bits `(1 + rate)^periods` may have when a target plan solves its contribution, as
/// ducat's PMT limits it.
const MAX_POWER_BITS: u64 = 1 << 20;

/// When each contribution is paid in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ContributionTiming {
    /// At the end of its period (Excel's `type` 0).
    #[default]
    End,
    /// At the start of its period (Excel's `type` 1), so it earns that period's interest.
    Start,
}

/// The terms of a [`savings_plan`]: a fixed `contribution`, or a `target` to save up to (exactly
/// one of the two). `M` is the money type.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SavingsPlanOptions<M> {
    /// The nominal annual rate (`0.03` for 3%): the periodic rate is `rate / per_year`. It may be
    /// negative, down to −`per_year` (everything lost in a period) excluded.
    pub rate: Ratio,
    /// Contributions per year (12 for monthly).
    pub per_year: u32,
    /// The number of contributions, 1 to [`MAX_PERIODS`](super::MAX_PERIODS).
    pub periods: u32,
    /// The amount paid in every period.
    pub contribution: Option<M>,
    /// The balance to reach after the last period. The regular contribution is Excel's PMT for
    /// it, rounded, and the last contribution takes the rounding residual.
    pub target: Option<M>,
    /// The balance before the first period (zero when `None`).
    pub initial: Option<M>,
    /// When contributions are paid in.
    pub timing: ContributionTiming,
    /// How every interest credit (and a target's contribution) is rounded, to the currency's
    /// exponent.
    pub rounding: Rounding,
    /// The date of the first contribution; the later ones follow as [`payment_dates`] gives them.
    pub first_contribution: Option<Date>,
}

impl<M> SavingsPlanOptions<M> {
    fn of(
        rate: impl Factor,
        per_year: u32,
        periods: u32,
        rounding: Rounding,
        contribution: Option<M>,
        target: Option<M>,
    ) -> Result<Self, Error> {
        Ok(Self {
            rate: rate.to_ratio()?,
            per_year,
            periods,
            contribution,
            target,
            initial: None,
            timing: ContributionTiming::End,
            rounding,
            first_contribution: None,
        })
    }

    /// A plan paying `contribution` in every period, at the end, from a zero balance.
    ///
    /// # Errors
    ///
    /// Whatever reading `rate` fails with.
    pub fn with_contribution(
        rate: impl Factor,
        per_year: u32,
        periods: u32,
        contribution: M,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        Self::of(rate, per_year, periods, rounding, Some(contribution), None)
    }

    /// A plan that saves up to `target`, paying in at the end of each period, from a zero balance.
    ///
    /// # Errors
    ///
    /// Whatever reading `rate` fails with.
    pub fn with_target(
        rate: impl Factor,
        per_year: u32,
        periods: u32,
        target: M,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        Self::of(rate, per_year, periods, rounding, None, Some(target))
    }

    /// The same plan starting from `initial`.
    #[must_use]
    pub fn initial(self, initial: M) -> Self {
        Self {
            initial: Some(initial),
            ..self
        }
    }

    /// The same plan paying in with `timing`.
    #[must_use]
    pub fn timing(self, timing: ContributionTiming) -> Self {
        Self { timing, ..self }
    }

    /// The same plan with the first contribution on `date`.
    #[must_use]
    pub fn first_contribution(self, date: Date) -> Self {
        Self {
            first_contribution: Some(date),
            ..self
        }
    }
}

/// One period of a savings plan.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SavingsPlanRow<M> {
    /// 1 for the first period.
    pub period: u32,
    /// The contribution date, when the options have a first contribution.
    pub date: Option<Date>,
    /// The amount paid in this period.
    pub contribution: M,
    /// This period's interest: the balance it earns on times the periodic rate, rounded. That is
    /// the balance before the period, plus this period's contribution when it is paid at the start.
    pub interest: M,
    /// Only on the last row of a start-timed target plan, and only when no whole-unit
    /// contribution reaches the target exactly (the rounded interest skipped it): the unit left
    /// over, paid at the end of the period, after interest. It counts in `total_contributions`.
    pub adjustment: Option<M>,
    /// The balance after the period: the previous balance plus the contribution, the interest and
    /// any adjustment.
    pub balance: M,
}

/// The result of [`savings_plan`].
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SavingsPlan<M> {
    /// The regular contribution (with a target, every one but possibly the last).
    pub contribution: M,
    /// One row per period.
    pub rows: Vec<SavingsPlanRow<M>>,
    /// The sum of the contributions and adjustments, exactly.
    pub total_contributions: M,
    /// The sum of the interest column, exactly.
    pub total_interest: M,
    /// The balance after the last period: `initial + total_contributions + total_interest`.
    pub balance: M,
}

/// Excel's PMT for the plan, `−pmt(periodic, periods, −initial, target, type)`, rounded once: the
/// regular contribution that reaches `target`.
fn target_contribution(
    periodic: &Ratio,
    periods: u32,
    initial: &Amount,
    target: &Amount,
    at_start: bool,
    exponent: u16,
    rounding: Rounding,
) -> Result<Amount, Error> {
    let (a, b) = (periodic.numer(), periodic.denom());
    let growth = a + b;
    let largest = if growth > *b { &growth } else { b };
    if largest.bits() * u64::from(periods) > MAX_POWER_BITS {
        return Err(Error::PowerTooLarge);
    }
    let scale = initial.scale.max(target.scale);
    let present = -initial.units.mul_pow10(u32::from(scale - initial.scale));
    let future = target.units.mul_pow10(u32::from(scale - target.scale));
    let (numerator, denominator) = if a.is_zero() {
        (present + future, Int::from(periods))
    } else {
        // (pv·Q + fv·B)·a / ((b + a·type)·(Q − B)), with Q = (a + b)^n and B = b^n
        let growth_power = growth.pow(periods);
        let base_power = b.pow(periods);
        let paid = if at_start { b + a } else { b.clone() };
        (
            (present * &growth_power + future * &base_power) * a,
            paid * (growth_power - base_power),
        )
    };
    // PMT is minus this; the contribution, paid in, is minus PMT
    let denominator = denominator.mul_pow10(u32::from(scale));
    let (numerator, denominator) = if denominator.is_negative() {
        (-numerator, -denominator)
    } else {
        (numerator, denominator)
    };
    round_quotient(&numerator, &denominator, exponent, rounding)
}

/// The last contribution `c` of a start-timed target plan, paid at the start of the period, so
/// that `balance + c + round((balance + c)·r)` is the target: interest is then credited only on
/// what was paid in. Over the unit grid that sum rises by one unit, or two when the rounded
/// interest steps up too (one or none at a negative rate), so the target can fall in a gap. Then
/// `c` is the largest contribution that stays below it, and the unit left over is an adjustment
/// paid at the end of the period, after interest.
fn settle_at_start(
    balance: &Amount,
    target: &Amount,
    periodic: &Ratio,
    exponent: u16,
    rounding: Rounding,
) -> Result<(Amount, Option<Amount>), Error> {
    let needed = target.sub(balance);
    let reached = |contribution: &Amount| -> Result<Amount, Error> {
        let interest = multiply_by_ratio(&balance.add(contribution), periodic, exponent, rounding)?;
        Ok(contribution.add(&interest))
    };
    // start near (needed − balance·r) / (1 + r), then step by units to the target
    let growth = Ratio::new(
        periodic.numer() + periodic.denom(),
        periodic.denom().clone(),
    )?;
    let estimate = multiply_by_ratio(
        &needed.sub(&multiply_by_ratio(balance, periodic, exponent, rounding)?),
        &growth.recip()?,
        exponent,
        rounding,
    )?;
    let at = |steps: &Int| {
        estimate.add(&Amount {
            units: steps.clone(),
            scale: exponent,
        })
    };
    let fits = |steps: &Int| -> Result<bool, Error> {
        Ok(reached(&at(steps))?.cmp_value(&needed) != Ordering::Greater)
    };
    // reached() never decreases in the contribution, so find the largest whole-unit c with
    // reached(c) ≤ needed by a bracket of doubling width around the estimate, then bisection
    let (mut low, mut high) = (-Int::ONE, Int::ONE);
    let mut doublings = 0;
    while !fits(&low)? {
        if doublings > 128 {
            return Err(Error::Unsettled);
        }
        high = low.clone();
        low = &low + &low;
        doublings += 1;
    }
    doublings = 0;
    while fits(&high)? {
        if doublings > 128 {
            return Err(Error::Unsettled);
        }
        low = high.clone();
        high = &high + &high;
        doublings += 1;
    }
    while &high - &low > Int::ONE {
        let middle = (&low + &high).div_rem(&Int::from(2u8)).0;
        if fits(&middle)? {
            low = middle;
        } else {
            high = middle;
        }
    }
    let contribution = at(&low);
    let short = needed.sub(&reached(&contribution)?);
    Ok((contribution, (!short.units.is_zero()).then_some(short)))
}

/// A savings plan: a regular contribution every period, earning interest at `rate / per_year`,
/// with each period's interest rounded once from the exact balance it earns on, as a bank credits
/// it. Nothing else is rounded, so the final balance is exactly `initial + total_contributions +
/// total_interest`.
///
/// With a `contribution`, the plan pays it in every period. With a `target`, the regular
/// contribution is Excel's PMT for the target, rounded once, and the last contribution takes the
/// residual the rounding leaves, so the final balance is exactly the target. With
/// [`ContributionTiming::Start`], the last contribution `c` is solved so that the balance plus `c`
/// plus the rounded interest on both is the target; where the rounding skips the target, the unit
/// left over is an `adjustment`, paid at the end of the period. At a rate of 0 the regular
/// contribution is `(target − initial) / periods`, rounded, the residual on the last.
///
/// The amounts share one currency and are whole numbers of minor units. Contributions may be
/// negative (withdrawals), and a target below what the initial balance grows to gives them.
///
/// ```
/// use ducat::{Money, Rounding};
/// use ducat::finance::{SavingsPlanOptions, savings_plan};
/// use ducat::iso::Usd;
///
/// let target: Money<Usd> = "50000".parse()?;
/// let plan = savings_plan(&SavingsPlanOptions::with_target("0.05", 12, 216, target, Rounding::HalfExpand)?)?;
/// assert_eq!(plan.contribution.to_decimal(), "143.18");
/// assert_eq!(plan.rows.last().map(|row| row.contribution.to_decimal()), Some("144.38".into()));
/// assert_eq!(plan.balance.to_decimal(), "50000.00");
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::InvalidPeriods`] for periods outside 1 to [`MAX_PERIODS`](super::MAX_PERIODS);
/// [`Error::InvalidPerYear`] for a `per_year` of zero (or, with a first contribution, one that
/// [`payment_dates`] doesn't take); [`Error::InvalidSavingsPlan`] when both or neither of
/// `contribution` and `target` are given; [`Error::CurrencyMismatch`]; [`Error::NotAMultiple`]
/// for amounts that aren't whole numbers of minor units; [`Error::RateTooLow`] for a rate that
/// loses everything in one period; [`Error::PowerTooLarge`] when a target's `(1 + rate)^periods`
/// would pass 2^20 bits; [`Error::Unsettled`] when the last start-timed contribution can't be
/// found; [`Error::DateOutOfRange`]; [`Error::Rounding`] with [`Rounding::Unnecessary`].
pub fn savings_plan<M: MoneyKind>(
    options: &SavingsPlanOptions<M>,
) -> Result<SavingsPlan<M>, Error> {
    let SavingsPlanOptions {
        ref rate,
        per_year,
        periods,
        ref contribution,
        ref target,
        ref initial,
        timing,
        rounding,
        first_contribution,
    } = *options;
    check_periods(periods, 1)?;
    if per_year == 0 {
        return Err(Error::InvalidPerYear);
    }
    let reference = match (contribution, target) {
        (Some(reference), None) | (None, Some(reference)) => reference,
        _ => return Err(Error::InvalidSavingsPlan),
    };
    let exponent = exponent_of(reference);
    let zero = Amount {
        units: Int::ZERO,
        scale: exponent,
    };
    let initial = match initial {
        Some(initial) => amount_in(reference, initial)?,
        None => zero.clone(),
    };
    let reference_amount = amount_of(reference);
    if !is_whole_minor(&reference_amount, exponent) || !is_whole_minor(&initial, exponent) {
        return Err(Error::NotAMultiple);
    }
    let periodic = Ratio::new(rate.numer().clone(), rate.denom() * &Int::from(per_year))?;
    if !(periodic.numer() + periodic.denom()).is_positive() {
        return Err(Error::RateTooLow);
    }
    let dates = first_contribution
        .map(|first| payment_dates(first, per_year, periods))
        .transpose()?;
    let at_start = timing == ContributionTiming::Start;
    let target = target.as_ref().map(|_| reference_amount.clone());
    let regular = match &target {
        Some(target) => target_contribution(
            &periodic, periods, &initial, target, at_start, exponent, rounding,
        )?,
        None => reference_amount.clone(),
    };

    let mut rows = Vec::with_capacity(periods as usize);
    let mut balance = initial;
    let (mut total_contributions, mut total_interest) = (zero.clone(), zero);
    for period in 1..=periods {
        let (contribution, adjustment) = match &target {
            // the last contribution of a target plan settles it exactly
            Some(target) if period == periods => {
                if at_start {
                    settle_at_start(&balance, target, &periodic, exponent, rounding)?
                } else {
                    let interest = multiply_by_ratio(&balance, &periodic, exponent, rounding)?;
                    (target.sub(&balance).sub(&interest), None)
                }
            }
            _ => (regular.clone(), None),
        };
        // interest on what is actually in the account during the period
        let earning = if at_start {
            balance.add(&contribution)
        } else {
            balance.clone()
        };
        let interest = multiply_by_ratio(&earning, &periodic, exponent, rounding)?;
        balance = balance.add(&contribution).add(&interest);
        total_contributions = total_contributions.add(&contribution);
        if let Some(adjustment) = &adjustment {
            balance = balance.add(adjustment);
            total_contributions = total_contributions.add(adjustment);
        }
        total_interest = total_interest.add(&interest);
        rows.push(SavingsPlanRow {
            period,
            date: dates.as_ref().map(|dates| dates[period as usize - 1]),
            contribution: money_like(reference, contribution),
            interest: money_like(reference, interest),
            adjustment: adjustment.map(|adjustment| money_like(reference, adjustment)),
            balance: money_like(reference, balance.clone()),
        });
    }
    Ok(SavingsPlan {
        contribution: money_like(reference, regular),
        rows,
        total_contributions: money_like(reference, total_contributions),
        total_interest: money_like(reference, total_interest),
        balance: money_like(reference, balance),
    })
}
