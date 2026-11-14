//! Day-count conventions, year fractions and simple interest.

use core::fmt;
use core::str::FromStr;

use super::{Date, MoneyKind, amount_of, exponent_of, money_like, multiply_by_ratio};
use crate::{AnyMoney, Currency, Error, Factor, Int, Money, Ratio, Rounding};

/// A day-count convention, as the 2006 ISDA Definitions §4.16 define them. None of them is Excel's
/// YEARFRAC: its basis 0 is the US (NASD) 30/360 with end-of-February rules rather than Bond
/// Basis, its basis 1 divides by an average year length rather than splitting days by calendar
/// year, and it swaps reversed dates.
///
/// [`FromStr`] and [`Display`](fmt::Display) use ducat's names (`"ACT/360"`, `"30E/360 ISDA"`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum DayCount {
    /// `"ACT/360"`: actual days over 360.
    Act360,
    /// `"ACT/365F"`: actual days over 365.
    Act365Fixed,
    /// `"ACT/ACT ISDA"`: days in leap years over 366 plus days in other years over 365.
    ActActIsda,
    /// `"30/360"`: Bond Basis, §4.16(f). A 31st start becomes the 30th; a 31st end becomes the
    /// 30th only when the start is then the 30th.
    Thirty360,
    /// `"30E/360"`: Eurobond Basis, §4.16(g). A 31st on either side becomes the 30th.
    ThirtyE360,
    /// `"30E/360 ISDA"`: §4.16(h). The last day of a month becomes the 30th, except the last day
    /// of February when it is the termination date, so an end on the last day of February needs
    /// `maturity` (see [`year_fraction`]).
    ThirtyE360Isda,
}

impl DayCount {
    /// Every convention.
    pub const ALL: [Self; 6] = [
        Self::Act360,
        Self::Act365Fixed,
        Self::ActActIsda,
        Self::Thirty360,
        Self::ThirtyE360,
        Self::ThirtyE360Isda,
    ];

    /// ducat's name for the convention: `"ACT/360"`, `"ACT/365F"`, `"ACT/ACT ISDA"`, `"30/360"`,
    /// `"30E/360"` or `"30E/360 ISDA"`.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Act360 => "ACT/360",
            Self::Act365Fixed => "ACT/365F",
            Self::ActActIsda => "ACT/ACT ISDA",
            Self::Thirty360 => "30/360",
            Self::ThirtyE360 => "30E/360",
            Self::ThirtyE360Isda => "30E/360 ISDA",
        }
    }
}

impl fmt::Display for DayCount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl FromStr for DayCount {
    type Err = Error;

    /// Parses a name from [`DayCount::name`]; anything else is [`Error::Syntax`].
    fn from_str(name: &str) -> Result<Self, Error> {
        Self::ALL
            .into_iter()
            .find(|convention| convention.name() == name)
            .ok_or(Error::Syntax)
    }
}

/// The 30/360 family's day count: 360 × years + 30 × months + days, after adjusting the days.
fn thirty_360(start: Date, end: Date, start_day: u8, end_day: u8) -> Result<Ratio, Error> {
    let days = 360 * (i64::from(end.year()) - i64::from(start.year()))
        + 30 * (i64::from(end.month()) - i64::from(start.month()))
        + (i64::from(end_day) - i64::from(start_day));
    Ratio::new(days, 360)
}

/// ACT/ACT ISDA: the days in each calendar year over that year's length, summed exactly.
fn actual_actual_isda(start: Date, end: Date) -> Result<Ratio, Error> {
    let year_length = |date: Date| if date.is_leap_year() { 366i64 } else { 365 };
    if start.year() == end.year() {
        return Ratio::new(start.days_until(end), year_length(start));
    }
    // the first day of the year after the start's, and of the end's year
    let start_year_end = Date::new(start.year() + 1, 1, 1)?;
    let end_year_start = Date::new(end.year(), 1, 1)?;
    let (first_length, last_length) = (year_length(start), year_length(end));
    let first_days = start.days_until(start_year_end);
    let last_days = end_year_start.days_until(end);
    let whole_years = i64::from(end.year()) - i64::from(start.year()) - 1;
    // first_days/first_length + whole_years + last_days/last_length over one denominator
    let denominator = first_length * last_length;
    Ratio::new(
        first_days * last_length + whole_years * denominator + last_days * first_length,
        denominator,
    )
}

/// The fraction of a year from `start` to `end` (exclusive) under `convention`, as an exact
/// reduced [`Ratio`].
///
/// `maturity` is for [`DayCount::ThirtyE360Isda`] only: whether `end` is the termination
/// (maturity) date, whose last day of February is kept as it is. It is required when `end` is the
/// last day of February, since the two readings differ by up to two days and neither is a safe
/// default; elsewhere it is ignored.
///
/// ```
/// use ducat::finance::{Date, DayCount, year_fraction};
///
/// let (start, end): (Date, Date) = ("2026-01-15".parse()?, "2026-07-15".parse()?);
/// assert_eq!(year_fraction(start, end, DayCount::Act360, None)?.to_string(), "181/360");
/// assert!(year_fraction(end, start, DayCount::Act360, None).is_err());
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::EndBeforeStart`] when `end` is before `start`; [`Error::MaturityRequired`] for
/// [`DayCount::ThirtyE360Isda`] ending on the last day of February without `maturity`.
pub fn year_fraction(
    start: Date,
    end: Date,
    convention: DayCount,
    maturity: Option<bool>,
) -> Result<Ratio, Error> {
    if end < start {
        return Err(Error::EndBeforeStart);
    }
    match convention {
        DayCount::Act360 => Ratio::new(start.days_until(end), 360),
        DayCount::Act365Fixed => Ratio::new(start.days_until(end), 365),
        DayCount::ActActIsda => actual_actual_isda(start, end),
        DayCount::Thirty360 => {
            // §4.16(f): D1 = 31 becomes 30; D2 = 31 becomes 30 only when D1 is then 30
            let start_day = if start.day() == 31 { 30 } else { start.day() };
            let end_day = if end.day() == 31 && start_day == 30 {
                30
            } else {
                end.day()
            };
            thirty_360(start, end, start_day, end_day)
        }
        DayCount::ThirtyE360 => {
            // §4.16(g): a 31st on either side becomes the 30th
            let start_day = start.day().min(30);
            let end_day = end.day().min(30);
            thirty_360(start, end, start_day, end_day)
        }
        DayCount::ThirtyE360Isda => {
            // §4.16(h): the last day of a month becomes the 30th, except the last day of February
            // when it is the termination date
            let start_day = if start.day() == 31 || start.is_last_day_of_february() {
                30
            } else {
                start.day()
            };
            let end_day = if end.is_last_day_of_february() {
                match maturity {
                    Some(true) => end.day(),
                    Some(false) => 30,
                    None => return Err(Error::MaturityRequired),
                }
            } else {
                end.day().min(30)
            };
            thirty_360(start, end, start_day, end_day)
        }
    }
}

/// The accrual period of simple interest: from `from` to `to` (exclusive), under `day_count`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct InterestPeriod {
    /// The first day of interest.
    pub from: Date,
    /// The day interest runs to, exclusive.
    pub to: Date,
    /// The day-count convention.
    pub day_count: DayCount,
    /// Whether `to` is the termination date, for [`DayCount::ThirtyE360Isda`] (see
    /// [`year_fraction`]).
    pub maturity: Option<bool>,
}

impl InterestPeriod {
    /// The period from `from` to `to` under `day_count`, with no `maturity`.
    #[must_use]
    pub const fn new(from: Date, to: Date, day_count: DayCount) -> Self {
        Self {
            from,
            to,
            day_count,
            maturity: None,
        }
    }

    /// The same period with `maturity` set.
    #[must_use]
    pub const fn with_maturity(self, maturity: bool) -> Self {
        Self {
            maturity: Some(maturity),
            ..self
        }
    }

    /// The period's year fraction, as [`year_fraction`].
    ///
    /// # Errors
    ///
    /// As [`year_fraction`].
    pub fn year_fraction(&self) -> Result<Ratio, Error> {
        year_fraction(self.from, self.to, self.day_count, self.maturity)
    }
}

fn interest_of<M: MoneyKind>(
    principal: &M,
    yearly_rate: impl Factor,
    period: &InterestPeriod,
    rounding: Rounding,
) -> Result<M, Error> {
    let fraction = period.year_fraction()?;
    let rate = yearly_rate.to_ratio()?;
    let amount = multiply_by_ratio(
        &amount_of(principal),
        &rate.mul(&fraction),
        exponent_of(principal),
        rounding,
    )?;
    Ok(money_like(principal, amount))
}

/// `(1 + rate/per_year)^periods` as a numerator and denominator in lowest terms.
fn growth_power(yearly_rate: &Ratio, periods: u32, per_year: u32) -> Result<(Int, Int), Error> {
    if per_year == 0 {
        return Err(Error::InvalidPerYear);
    }
    let per_year = Int::from(per_year);
    let growth = Ratio::new(
        yearly_rate.numer() + &(yearly_rate.denom() * &per_year),
        yearly_rate.denom() * &per_year,
    )?;
    if !growth.numer().is_positive() {
        return Err(Error::RateTooLow);
    }
    // a power of a reduced ratio is reduced, so no gcd is needed on the large integers
    Ok((growth.numer().pow(periods), growth.denom().pow(periods)))
}

fn compound_of<M: MoneyKind>(
    principal: &M,
    yearly_rate: impl Factor,
    periods: u32,
    per_year: u32,
    rounding: Rounding,
) -> Result<M, Error> {
    super::check_periods(periods, 0)?;
    let (numerator, denominator) = growth_power(&yearly_rate.to_ratio()?, periods, per_year)?;
    let amount = super::multiply_and_round(
        &amount_of(principal),
        &numerator,
        &denominator,
        exponent_of(principal),
        rounding,
    )?;
    Ok(money_like(principal, amount))
}

impl<C: Currency> Money<C> {
    /// Simple interest, `principal × yearly_rate × year fraction`, rounded once to the currency's
    /// exponent. `yearly_rate` is an annual rate (`"0.05"` for 5%).
    ///
    /// ```
    /// use ducat::{Money, Rounding};
    /// use ducat::finance::{DayCount, InterestPeriod};
    /// use ducat::iso::Eur;
    ///
    /// let principal: Money<Eur> = "10000".parse()?;
    /// let period = InterestPeriod::new("2026-01-15".parse()?, "2026-07-15".parse()?, DayCount::Act365Fixed);
    /// assert_eq!(principal.interest("0.05", &period, Rounding::HalfEven)?.to_decimal(), "247.95");
    /// # Ok::<(), ducat::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// As [`year_fraction`]; [`Error::Rounding`] for an inexact result with
    /// [`Rounding::Unnecessary`]; and whatever reading `yearly_rate` fails with.
    pub fn interest(
        &self,
        yearly_rate: impl Factor,
        period: &InterestPeriod,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        interest_of(self, yearly_rate, period, rounding)
    }

    /// Periodic compounding, `principal × (1 + yearly_rate / per_year)^periods`, an exact integer
    /// power rounded once to the currency's exponent. Fractional periods and continuous
    /// compounding are irrational, so they aren't offered.
    ///
    /// ```
    /// use ducat::{Money, Rounding};
    /// use ducat::iso::Eur;
    ///
    /// let principal: Money<Eur> = "1000".parse()?;
    /// assert_eq!(principal.compound("0.05", 12, 12, Rounding::HalfEven)?.to_decimal(), "1051.16");
    /// # Ok::<(), ducat::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::InvalidPeriods`] for more than [`MAX_PERIODS`](super::MAX_PERIODS) periods;
    /// [`Error::InvalidPerYear`] for a `per_year` of zero; [`Error::RateTooLow`] for a rate that
    /// loses everything in one period; [`Error::Rounding`] with [`Rounding::Unnecessary`].
    pub fn compound(
        &self,
        yearly_rate: impl Factor,
        periods: u32,
        per_year: u32,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        compound_of(self, yearly_rate, periods, per_year, rounding)
    }
}

impl AnyMoney {
    /// As [`Money::interest`].
    ///
    /// # Errors
    ///
    /// As [`Money::interest`].
    pub fn interest(
        &self,
        yearly_rate: impl Factor,
        period: &InterestPeriod,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        interest_of(self, yearly_rate, period, rounding)
    }

    /// As [`Money::compound`].
    ///
    /// # Errors
    ///
    /// As [`Money::compound`].
    pub fn compound(
        &self,
        yearly_rate: impl Factor,
        periods: u32,
        per_year: u32,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        compound_of(self, yearly_rate, periods, per_year, rounding)
    }
}
