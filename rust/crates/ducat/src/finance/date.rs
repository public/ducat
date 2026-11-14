//! Calendar dates.

use core::fmt;
use core::str::FromStr;

use crate::Error;

/// A calendar date in the proleptic Gregorian calendar, from 0000-01-01 to 9999-12-31, with no
/// time and no time zone.
///
/// [`FromStr`] reads exactly `YYYY-MM-DD` and [`Display`](fmt::Display) writes it. Dates order
/// chronologically.
///
/// ```
/// use ducat::finance::Date;
///
/// let start: Date = "2024-01-31".parse()?;
/// assert_eq!(start.add_months(1)?.to_string(), "2024-02-29");
/// assert_eq!(start.days_until("2024-03-01".parse()?), 30);
/// assert!("2023-02-29".parse::<Date>().is_err());
/// # Ok::<(), ducat::Error>(())
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Date {
    year: u16,
    month: u8,
    day: u8,
}

const fn is_leap_year(year: u16) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

const fn days_in_month(year: u16, month: u8) -> u8 {
    match month {
        2 if is_leap_year(year) => 29,
        2 => 28,
        // April, June, September and November have 30 days
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

impl Date {
    /// The date `year`-`month`-`day`.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidDate`] for a year past 9999, a month outside 1 to 12, or a day the month
    /// doesn't have.
    pub const fn new(year: u16, month: u8, day: u8) -> Result<Self, Error> {
        if year > 9999 || month < 1 || month > 12 || day < 1 || day > days_in_month(year, month) {
            return Err(Error::InvalidDate);
        }
        Ok(Self { year, month, day })
    }

    /// The year, 0 to 9999.
    #[must_use]
    pub const fn year(&self) -> u16 {
        self.year
    }

    /// The month, 1 to 12.
    #[must_use]
    pub const fn month(&self) -> u8 {
        self.month
    }

    /// The day of the month, from 1.
    #[must_use]
    pub const fn day(&self) -> u8 {
        self.day
    }

    /// Whether the year is a leap year.
    #[must_use]
    pub const fn is_leap_year(&self) -> bool {
        is_leap_year(self.year)
    }

    /// The number of days in the date's month.
    #[must_use]
    pub const fn days_in_month(&self) -> u8 {
        days_in_month(self.year, self.month)
    }

    /// Whether the date is the last day of February (the 28th, or the 29th in a leap year).
    #[must_use]
    pub const fn is_last_day_of_february(&self) -> bool {
        self.month == 2 && self.day == days_in_month(self.year, 2)
    }

    /// Days from `self` to `end`, `end` exclusive: negative when `end` is earlier.
    #[must_use]
    pub const fn days_until(&self, end: Self) -> i64 {
        end.day_number() - self.day_number()
    }

    /// The date `days` days later (earlier for a negative count).
    ///
    /// # Errors
    ///
    /// [`Error::DateOutOfRange`] for a date before 0000-01-01 or after 9999-12-31.
    pub fn add_days(&self, days: i64) -> Result<Self, Error> {
        let number = self
            .day_number()
            .checked_add(days)
            .ok_or(Error::DateOutOfRange)?;
        Self::from_day_number(number)
    }

    /// The date `months` months later, on the same day of the month, clamped to the end of a
    /// shorter month: one month after 31 January is 28 or 29 February. This is the clamping
    /// ducat's payment dates use, not an end-of-month rule: one month after 28 February is
    /// 28 March.
    ///
    /// # Errors
    ///
    /// [`Error::DateOutOfRange`] for a date after 9999-12-31.
    pub fn add_months(&self, months: u32) -> Result<Self, Error> {
        let index = u64::from(self.month - 1) + u64::from(months);
        let year = u64::from(self.year) + index / 12;
        if year > 9999 {
            return Err(Error::DateOutOfRange);
        }
        // both fit: year is at most 9999 and the month at most 12
        let (year, month) = (year as u16, (index % 12) as u8 + 1);
        let day = if self.day > days_in_month(year, month) {
            days_in_month(year, month)
        } else {
            self.day
        };
        Ok(Self { year, month, day })
    }

    /// Days from 1970-01-01 (Howard Hinnant's `days_from_civil`): the year is counted from March,
    /// so the leap day falls at the end of the counting year.
    pub(crate) const fn day_number(&self) -> i64 {
        let year = self.year as i64 - if self.month <= 2 { 1 } else { 0 };
        let era = year.div_euclid(400);
        let year_of_era = year - era * 400;
        let month = self.month as i64;
        let month_from_march = if month > 2 { month - 3 } else { month + 9 };
        let day_of_year = (153 * month_from_march + 2) / 5 + self.day as i64 - 1;
        let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
        era * 146_097 + day_of_era - 719_468
    }

    /// The inverse of `day_number` (Howard Hinnant's `civil_from_days`).
    pub(crate) fn from_day_number(days: i64) -> Result<Self, Error> {
        let shifted = days.checked_add(719_468).ok_or(Error::DateOutOfRange)?;
        let era = shifted.div_euclid(146_097);
        let day_of_era = shifted - era * 146_097;
        let year_of_era =
            (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
        let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
        let month_from_march = (5 * day_of_year + 2) / 153;
        let day = day_of_year - (153 * month_from_march + 2) / 5 + 1;
        let month = if month_from_march < 10 {
            month_from_march + 3
        } else {
            month_from_march - 9
        };
        let year = year_of_era + era * 400 + i64::from(month <= 2);
        if !(0..=9999).contains(&year) {
            return Err(Error::DateOutOfRange);
        }
        // in range: the year is checked, the month is 1 to 12 and the day 1 to 31
        Ok(Self {
            year: year as u16,
            month: month as u8,
            day: day as u8,
        })
    }
}

impl FromStr for Date {
    type Err = Error;

    /// Exactly `YYYY-MM-DD`: four, two and two ASCII digits, a real day of the month.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidDate`] for anything else, as ducat's `RangeError`.
    fn from_str(text: &str) -> Result<Self, Error> {
        let bytes = text.as_bytes();
        let digits_at = |range: core::ops::Range<usize>| {
            bytes[range].iter().try_fold(0u16, |value, &byte| {
                byte.is_ascii_digit()
                    .then(|| value * 10 + u16::from(byte - b'0'))
            })
        };
        if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
            return Err(Error::InvalidDate);
        }
        match (digits_at(0..4), digits_at(5..7), digits_at(8..10)) {
            // two digits fit a u8
            (Some(year), Some(month), Some(day)) => Self::new(year, month as u8, day as u8),
            _ => Err(Error::InvalidDate),
        }
    }
}

impl fmt::Display for Date {
    /// `YYYY-MM-DD`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }
}

#[cfg(test)]
mod tests {
    use alloc::string::ToString;

    use super::*;

    #[test]
    fn parses_strictly() {
        assert_eq!(
            "2024-02-29".parse::<Date>().map(|d| d.to_string()),
            Ok("2024-02-29".into())
        );
        for bad in [
            "2023-02-29",
            "2024-13-01",
            "2024-00-10",
            "2024-1-01",
            "+024-01-01",
            "2024/01/01",
            "2024-01-01T00:00:00Z",
            "",
            "1900-02-29",
        ] {
            assert_eq!(bad.parse::<Date>(), Err(Error::InvalidDate), "{bad}");
        }
        assert!("2000-02-29".parse::<Date>().is_ok());
        assert!("0000-01-01".parse::<Date>().is_ok());
    }

    #[test]
    fn day_numbers_round_trip() {
        let epoch = Date::new(1970, 1, 1).unwrap();
        assert_eq!(epoch.day_number(), 0);
        for date in [
            Date::new(0, 1, 1).unwrap(),
            Date::new(0, 2, 29).unwrap(),
            Date::new(1600, 3, 1).unwrap(),
            Date::new(9999, 12, 31).unwrap(),
        ] {
            assert_eq!(Date::from_day_number(date.day_number()), Ok(date));
        }
        let first = Date::new(0, 1, 1).unwrap().day_number();
        let last = Date::new(9999, 12, 31).unwrap().day_number();
        let mut previous: Option<Date> = None;
        for number in (first..=last).step_by(97) {
            let date = Date::from_day_number(number).unwrap();
            assert_eq!(date.day_number(), number);
            if let Some(before) = previous {
                assert!(before < date);
            }
            previous = Some(date);
        }
        assert_eq!(Date::from_day_number(first - 1), Err(Error::DateOutOfRange));
        assert_eq!(Date::from_day_number(last + 1), Err(Error::DateOutOfRange));
    }

    #[test]
    fn months_clamp() {
        let date = Date::new(2023, 11, 30).unwrap();
        assert_eq!(date.add_months(3).unwrap().to_string(), "2024-02-29");
        assert_eq!(date.add_months(6).unwrap().to_string(), "2024-05-30");
        assert_eq!(
            Date::new(9999, 12, 1).unwrap().add_months(1),
            Err(Error::DateOutOfRange)
        );
    }
}
