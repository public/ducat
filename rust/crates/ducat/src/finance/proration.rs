//! Subscription proration: a price for part of a billing period, and a period split at changes.

use alloc::vec::Vec;
use core::str::FromStr;

use super::{Date, MoneyKind, amount_of, exponent_of, money_like, multiply_and_round};
use crate::allocate::Remainder;
use crate::{AnyMoney, Currency, Error, Int, Money, Rounding};

/// The largest Unix time taken, 2^53 − 1 seconds (about 285 million years), as in ducat.
const MAX_SAFE: u64 = (1 << 53) - 1;

/// What proration counts: whole days, or seconds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ProrationUnit {
    /// Whole days (the usual choice).
    #[default]
    Day,
    /// Seconds.
    Second,
}

/// A point in time for proration: a calendar date (midnight UTC), or a Unix time in whole seconds
/// (within ±(2^53 − 1)), which only [`ProrationUnit::Second`] counts.
///
/// [`FromStr`] reads `YYYY-MM-DD` as a date, and an ISO date-time in UTC, `YYYY-MM-DDTHH:MM:SSZ`,
/// as the Unix time it names.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ProrationInstant {
    /// Midnight UTC at the start of the date.
    Date(Date),
    /// Seconds since 1970-01-01T00:00:00Z.
    Unix(i64),
}

impl From<Date> for ProrationInstant {
    fn from(date: Date) -> Self {
        Self::Date(date)
    }
}

impl FromStr for ProrationInstant {
    type Err = Error;

    /// `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM:SSZ` (hours to 23, minutes and seconds to 59).
    ///
    /// # Errors
    ///
    /// [`Error::InvalidDate`] for anything else.
    fn from_str(text: &str) -> Result<Self, Error> {
        if text.len() <= 10 {
            return text.parse().map(Self::Date);
        }
        let bytes = text.as_bytes();
        let (date, time) = text.split_at_checked(10).ok_or(Error::InvalidDate)?;
        let date: Date = date.parse()?;
        let two = |at: usize| {
            let (high, low) = (bytes[at], bytes[at + 1]);
            (high.is_ascii_digit() && low.is_ascii_digit())
                .then(|| i64::from(high - b'0') * 10 + i64::from(low - b'0'))
        };
        let shape = time.len() == 10
            && time.starts_with('T')
            && time.ends_with('Z')
            && bytes[13] == b':'
            && bytes[16] == b':';
        if !shape {
            return Err(Error::InvalidDate);
        }
        match (two(11), two(14), two(17)) {
            (Some(hours), Some(minutes), Some(seconds))
                if hours <= 23 && minutes <= 59 && seconds <= 59 =>
            {
                Ok(Self::Unix(
                    date.day_number() * 86_400 + hours * 3600 + minutes * 60 + seconds,
                ))
            }
            _ => Err(Error::InvalidDate),
        }
    }
}

impl ProrationInstant {
    /// The instant as a count of `unit`s since 1970-01-01T00:00:00Z.
    fn count(self, unit: ProrationUnit) -> Result<i64, Error> {
        match (self, unit) {
            (Self::Date(date), ProrationUnit::Day) => Ok(date.day_number()),
            (Self::Date(date), ProrationUnit::Second) => Ok(date.day_number() * 86_400),
            // a safe integer, as ducat takes, so differences of counts never overflow
            (Self::Unix(seconds), ProrationUnit::Second) if seconds.unsigned_abs() <= MAX_SAFE => {
                Ok(seconds)
            }
            (Self::Unix(_), _) => Err(Error::InvalidInstant),
        }
    }
}

/// A span of time, `end` exclusive.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ProrationPeriod {
    /// The first instant of the span.
    pub start: ProrationInstant,
    /// The instant after the span.
    pub end: ProrationInstant,
}

impl ProrationPeriod {
    /// The span from `start` to `end`, `end` exclusive.
    pub fn new(start: impl Into<ProrationInstant>, end: impl Into<ProrationInstant>) -> Self {
        Self {
            start: start.into(),
            end: end.into(),
        }
    }

    /// The start and end as counts of `unit`s.
    fn counts(&self, unit: ProrationUnit) -> Result<(i64, i64), Error> {
        Ok((self.start.count(unit)?, self.end.count(unit)?))
    }
}

fn prorate_of<M: MoneyKind>(
    price: &M,
    period: &ProrationPeriod,
    used: &ProrationPeriod,
    unit: ProrationUnit,
    rounding: Rounding,
) -> Result<M, Error> {
    let (start, end) = period.counts(unit)?;
    if end <= start {
        return Err(Error::InvalidPeriod);
    }
    let (used_start, used_end) = used.counts(unit)?;
    if !(used_start >= start && used_end <= end && used_end >= used_start) {
        return Err(Error::OutsidePeriod);
    }
    let amount = multiply_and_round(
        &amount_of(price),
        &Int::from(used_end - used_start),
        &Int::from(end - start),
        exponent_of(price),
        rounding,
    )?;
    Ok(money_like(price, amount))
}

fn split_period_of<M: MoneyKind>(
    price: &M,
    period: &ProrationPeriod,
    at: &[ProrationInstant],
    unit: ProrationUnit,
    remainder: Remainder,
) -> Result<Vec<M>, Error> {
    let (start, end) = period.counts(unit)?;
    if end <= start {
        return Err(Error::InvalidPeriod);
    }
    let mut weights = Vec::with_capacity(at.len() + 1);
    let mut previous = start;
    for point in at {
        let count = point.count(unit)?;
        if !(count > previous && count < end) {
            return Err(Error::OutsidePeriod);
        }
        weights.push(Int::from(count - previous));
        previous = count;
    }
    weights.push(Int::from(end - previous));
    Ok(amount_of(price)
        .allocate(&weights, remainder)?
        .into_iter()
        .map(|part| money_like(price, part))
        .collect())
}

impl<C: Currency> Money<C> {
    /// The part of the price for the `used` part of a billing `period`:
    /// `price × used / period`, counted in days (or seconds), rounded once to the currency's
    /// exponent. Periods are end-exclusive.
    ///
    /// ```
    /// use ducat::{Money, Rounding};
    /// use ducat::finance::{Date, ProrationPeriod, ProrationUnit};
    /// use ducat::iso::Eur;
    ///
    /// let price: Money<Eur> = "30".parse()?;
    /// let day = |text: &str| text.parse::<Date>();
    /// let march = ProrationPeriod::new(day("2026-03-01")?, day("2026-04-01")?);
    /// let used = ProrationPeriod::new(day("2026-03-11")?, day("2026-04-01")?);
    /// // 21 of 31 days
    /// assert_eq!(price.prorate(&march, &used, ProrationUnit::Day, Rounding::HalfEven)?.to_decimal(), "20.32");
    /// # Ok::<(), ducat::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::InvalidPeriod`] when the period doesn't end after it starts;
    /// [`Error::OutsidePeriod`] when `used` isn't inside it (or ends before it starts);
    /// [`Error::InvalidInstant`] for a Unix time beyond ±(2^53 − 1), or one counted in days; [`Error::Rounding`] with
    /// [`Rounding::Unnecessary`].
    pub fn prorate(
        &self,
        period: &ProrationPeriod,
        used: &ProrationPeriod,
        unit: ProrationUnit,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        prorate_of(self, period, used, unit, rounding)
    }

    /// Splits the price of one `period` at change points (plan changes), in proportion to the
    /// days (or seconds) in each piece, through [`Money::allocate`], so the pieces always sum
    /// exactly to the price. ducat's default `remainder` is [`Remainder::Largest`].
    ///
    /// ```
    /// use ducat::Money;
    /// use ducat::allocate::Remainder;
    /// use ducat::finance::{Date, ProrationPeriod, ProrationUnit};
    /// use ducat::iso::Eur;
    ///
    /// let price: Money<Eur> = "30".parse()?;
    /// let day = |text: &str| text.parse::<Date>();
    /// let march = ProrationPeriod::new(day("2026-03-01")?, day("2026-04-01")?);
    /// let at = [day("2026-03-11")?.into(), day("2026-03-20")?.into()];
    /// let parts = price.split_period(&march, &at, ProrationUnit::Day, Remainder::Largest)?;
    /// assert_eq!(parts.iter().map(Money::to_decimal).collect::<Vec<_>>(), ["9.68", "8.71", "11.61"]);
    /// # Ok::<(), ducat::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::InvalidPeriod`] when the period doesn't end after it starts;
    /// [`Error::OutsidePeriod`] when the change points don't increase or don't lie strictly inside
    /// the period; [`Error::InvalidInstant`] for a Unix time beyond ±(2^53 − 1), or one counted in days.
    pub fn split_period(
        &self,
        period: &ProrationPeriod,
        at: &[ProrationInstant],
        unit: ProrationUnit,
        remainder: Remainder,
    ) -> Result<Vec<Self>, Error> {
        split_period_of(self, period, at, unit, remainder)
    }
}

impl AnyMoney {
    /// As [`Money::prorate`].
    ///
    /// # Errors
    ///
    /// As [`Money::prorate`].
    pub fn prorate(
        &self,
        period: &ProrationPeriod,
        used: &ProrationPeriod,
        unit: ProrationUnit,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        prorate_of(self, period, used, unit, rounding)
    }

    /// As [`Money::split_period`].
    ///
    /// # Errors
    ///
    /// As [`Money::split_period`].
    pub fn split_period(
        &self,
        period: &ProrationPeriod,
        at: &[ProrationInstant],
        unit: ProrationUnit,
        remainder: Remainder,
    ) -> Result<Vec<Self>, Error> {
        split_period_of(self, period, at, unit, remainder)
    }
}
