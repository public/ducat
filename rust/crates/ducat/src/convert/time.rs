//! The times a rate carries and is looked up at: a UTC day or a UTC instant, to the millisecond.

use core::fmt;
use core::str::FromStr;

use crate::Error;
use crate::date::Date;

const MILLIS_PER_DAY: u32 = 86_400_000;

/// An instant in UTC, to the millisecond, from 0000-01-01T00:00:00.000Z to
/// 9999-12-31T23:59:59.999Z.
///
/// [`FromStr`] reads ISO 8601 strictly: `YYYY-MM-DDTHH:MM`, optionally with `:SS` and then `.s`
/// to `.sss`, followed by `Z` or an offset `±HH:MM`, which it converts to UTC. Anything else is
/// [`Error::InvalidTime`], including a date-time without an offset (ducat would read it in the
/// machine's local time), `T24:00`, lowercase `t` or `z`, an impossible date, and more than three
/// fraction digits. ducat reads times with JavaScript's `new Date`, which accepts all of those;
/// this is a deliberate divergence (ducat issue
/// [#349](https://github.com/public/ducat/issues/349)). [`Display`](fmt::Display) writes
/// `YYYY-MM-DDTHH:MM:SS.sssZ`, as JavaScript's `toISOString` does. Instants order
/// chronologically.
///
/// ```
/// use ducat::convert::UtcInstant;
///
/// let close: UtcInstant = "2026-11-06T16:00:00+01:00".parse()?;
/// assert_eq!(close.to_string(), "2026-11-06T15:00:00.000Z");
/// assert!("2026-11-06T15:00:00".parse::<UtcInstant>().is_err());
/// # Ok::<(), ducat::Error>(())
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct UtcInstant {
    date: Date,
    millis: u32,
}

impl UtcInstant {
    /// The instant `hour`:`minute`:`second`.`millis` UTC on `date`.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidTime`] for an hour past 23, a minute or second past 59, or milliseconds
    /// past 999.
    pub const fn new(
        date: Date,
        hour: u8,
        minute: u8,
        second: u8,
        millis: u16,
    ) -> Result<Self, Error> {
        if hour > 23 || minute > 59 || second > 59 || millis > 999 {
            return Err(Error::InvalidTime);
        }
        let of_day = ((hour as u32 * 60 + minute as u32) * 60 + second as u32) * 1000;
        Ok(Self {
            date,
            millis: of_day + millis as u32,
        })
    }

    /// The first instant of `date`: 00:00:00.000Z.
    #[must_use]
    pub const fn start_of(date: Date) -> Self {
        Self { date, millis: 0 }
    }

    /// The last instant of `date`: 23:59:59.999Z.
    #[must_use]
    pub const fn end_of(date: Date) -> Self {
        Self {
            date,
            millis: MILLIS_PER_DAY - 1,
        }
    }

    /// The UTC day.
    #[must_use]
    pub const fn date(&self) -> Date {
        self.date
    }

    /// The instant `millis` milliseconds after the start of `date` (before it, for a negative
    /// count), across days as needed.
    pub(crate) fn shifted(date: Date, millis: i64) -> Result<Self, Error> {
        let days = millis.div_euclid(i64::from(MILLIS_PER_DAY));
        let within = millis.rem_euclid(i64::from(MILLIS_PER_DAY));
        Ok(Self {
            date: date.add_days(days)?,
            // within a day
            millis: within as u32,
        })
    }

    /// The instant `seconds` after the Unix epoch, 1970-01-01T00:00:00Z.
    ///
    /// # Errors
    ///
    /// [`Error::DateOutOfRange`] before 0000-01-01 or after 9999-12-31.
    pub fn from_unix_seconds(seconds: i64) -> Result<Self, Error> {
        let epoch = Date::from_day_number(0)?;
        let millis = seconds.checked_mul(1000).ok_or(Error::DateOutOfRange)?;
        Self::shifted(epoch, millis)
    }

    /// Milliseconds since the start of the UTC day, 0 to 86 399 999.
    #[must_use]
    pub const fn millis_of_day(&self) -> u32 {
        self.millis
    }
}

/// Two ASCII digits.
fn two(bytes: &[u8]) -> Option<u8> {
    match bytes {
        [tens, ones] if tens.is_ascii_digit() && ones.is_ascii_digit() => {
            Some((tens - b'0') * 10 + (ones - b'0'))
        }
        _ => None,
    }
}

fn parse_instant(text: &str) -> Option<Result<UtcInstant, Error>> {
    let bytes = text.as_bytes();
    if bytes.len() < 17 || bytes[10] != b'T' || bytes[13] != b':' {
        return None;
    }
    let date: Date = text.get(..10)?.parse().ok()?;
    let (hour, minute) = (two(&bytes[11..13])?, two(&bytes[14..16])?);
    let mut rest = &bytes[16..];
    let mut second = 0;
    let mut millis = 0u16;
    if let [b':', tens, ones, after @ ..] = rest {
        second = two(&[*tens, *ones])?;
        rest = after;
        if let [b'.', after @ ..] = rest {
            let digits = after
                .iter()
                .take_while(|byte| byte.is_ascii_digit())
                .count();
            if digits == 0 || digits > 3 {
                return None;
            }
            for (place, byte) in after[..digits].iter().enumerate() {
                let weight = [100, 10, 1][place];
                millis += u16::from(byte - b'0') * weight;
            }
            rest = &after[digits..];
        }
    }
    let offset_minutes: i64 = match rest {
        [b'Z'] => 0,
        [sign @ (b'+' | b'-'), h1, h2, b':', m1, m2] => {
            let (hours, minutes) = (two(&[*h1, *h2])?, two(&[*m1, *m2])?);
            if hours > 23 || minutes > 59 {
                return None;
            }
            let total = i64::from(hours) * 60 + i64::from(minutes);
            if *sign == b'+' { total } else { -total }
        }
        _ => return None,
    };
    let local = match UtcInstant::new(date, hour, minute, second, millis) {
        Ok(local) => local,
        Err(_) => return None,
    };
    let utc = i64::from(local.millis) - offset_minutes * 60_000;
    let days = utc.div_euclid(i64::from(MILLIS_PER_DAY));
    let millis = utc.rem_euclid(i64::from(MILLIS_PER_DAY));
    Some(local.date.add_days(days).map(|date| UtcInstant {
        date,
        // within a day
        millis: millis as u32,
    }))
}

impl FromStr for UtcInstant {
    type Err = Error;

    /// See [`UtcInstant`].
    ///
    /// # Errors
    ///
    /// [`Error::InvalidTime`] for anything but the forms above; [`Error::DateOutOfRange`] when the
    /// offset takes it before 0000-01-01 or past 9999-12-31.
    fn from_str(text: &str) -> Result<Self, Error> {
        parse_instant(text).unwrap_or(Err(Error::InvalidTime))
    }
}

impl fmt::Display for UtcInstant {
    /// `YYYY-MM-DDTHH:MM:SS.sssZ`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let seconds = self.millis / 1000;
        write!(
            f,
            "{}T{:02}:{:02}:{:02}.{:03}Z",
            self.date,
            seconds / 3600,
            seconds / 60 % 60,
            seconds % 60,
            self.millis % 1000
        )
    }
}

/// When a rate applies, was published or stops being valid, or when it is looked up: a whole UTC
/// day, or an instant.
///
/// As ducat reads them, a date stands for the start of its day where a time is compared as a start
/// (`as_of`, `available_at`, the moment a rate is looked up or checked at), and for the whole day
/// where it is compared as an end (`valid_until`, and a date given to
/// [`AnyRate::is_available`](crate::convert::AnyRate::is_available)): a rate valid until
/// `2026-11-06` is valid through 23:59:59.999Z. [`FromStr`] reads `YYYY-MM-DD` as a date and
/// anything else as a [`UtcInstant`]; [`Display`](fmt::Display) writes a date as given and an
/// instant in UTC, as ducat stores them.
///
/// ```
/// use ducat::convert::Time;
///
/// let day: Time = "2026-11-06".parse()?;
/// assert_eq!(day.end().to_string(), "2026-11-06T23:59:59.999Z");
/// let close: Time = "2026-11-07T00:30:00+01:00".parse()?;
/// assert_eq!(close.to_string(), "2026-11-06T23:30:00.000Z");
/// assert_eq!(close.day(), day.day());
/// # Ok::<(), ducat::Error>(())
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Time {
    /// A whole UTC day.
    Date(Date),
    /// An instant.
    Instant(UtcInstant),
}

impl Time {
    /// The UTC day it falls on.
    #[must_use]
    pub const fn day(&self) -> Date {
        match self {
            Self::Date(date) => *date,
            Self::Instant(instant) => instant.date,
        }
    }

    /// The first instant it covers: the start of a date's day, or the instant.
    #[must_use]
    pub const fn start(&self) -> UtcInstant {
        match self {
            Self::Date(date) => UtcInstant::start_of(*date),
            Self::Instant(instant) => *instant,
        }
    }

    /// The last instant it covers: 23:59:59.999Z on a date, or the instant.
    #[must_use]
    pub const fn end(&self) -> UtcInstant {
        match self {
            Self::Date(date) => UtcInstant::end_of(*date),
            Self::Instant(instant) => *instant,
        }
    }

    /// Whether it is a whole day.
    #[must_use]
    pub const fn is_date(&self) -> bool {
        matches!(self, Self::Date(_))
    }

    /// Whether `self`, as a start (a date: the start of its day), has come by `at` (a date: by the
    /// end of that day). ducat's `hasStarted`.
    #[must_use]
    pub fn has_started_by(&self, at: &Self) -> bool {
        self.start() <= at.end()
    }

    /// Whether `self`, as a `valid_until` (a date: valid all day), has passed at `at` (a date: the
    /// start of that day). ducat's `hasEnded`.
    #[must_use]
    pub fn has_ended_at(&self, at: &Self) -> bool {
        at.start() > self.end()
    }
}

impl From<Date> for Time {
    fn from(date: Date) -> Self {
        Self::Date(date)
    }
}

impl From<UtcInstant> for Time {
    fn from(instant: UtcInstant) -> Self {
        Self::Instant(instant)
    }
}

impl FromStr for Time {
    type Err = Error;

    /// `YYYY-MM-DD` as a date, else a [`UtcInstant`].
    ///
    /// # Errors
    ///
    /// [`Error::InvalidTime`] for anything else, including an impossible date.
    fn from_str(text: &str) -> Result<Self, Error> {
        if text.len() == 10 {
            return text.parse().map(Self::Date).map_err(|_| Error::InvalidTime);
        }
        text.parse().map(Self::Instant)
    }
}

impl fmt::Display for Time {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Date(date) => date.fmt(f),
            Self::Instant(instant) => instant.fmt(f),
        }
    }
}

/// The earlier start of two optional times (no limit for `None`); a date wins a tie, as ducat's
/// string comparison has it.
pub(super) fn oldest(first: Option<Time>, second: Option<Time>) -> Option<Time> {
    match (first, second) {
        (Some(a), Some(b)) => Some(match a.start().cmp(&b.start()) {
            core::cmp::Ordering::Less => a,
            core::cmp::Ordering::Greater => b,
            core::cmp::Ordering::Equal if b.is_date() => b,
            core::cmp::Ordering::Equal => a,
        }),
        (a, b) => a.or(b),
    }
}

/// The later start of two optional times; an instant wins a tie.
pub(super) fn latest(first: Option<Time>, second: Option<Time>) -> Option<Time> {
    match (first, second) {
        (Some(a), Some(b)) => Some(match a.start().cmp(&b.start()) {
            core::cmp::Ordering::Greater => a,
            core::cmp::Ordering::Less => b,
            core::cmp::Ordering::Equal if a.is_date() => b,
            core::cmp::Ordering::Equal => a,
        }),
        (a, b) => a.or(b),
    }
}

/// The `valid_until` that ends first; an instant wins a tie.
pub(super) fn earliest_end(first: Option<Time>, second: Option<Time>) -> Option<Time> {
    match (first, second) {
        (Some(a), Some(b)) => Some(match a.end().cmp(&b.end()) {
            core::cmp::Ordering::Less => a,
            core::cmp::Ordering::Greater => b,
            core::cmp::Ordering::Equal if a.is_date() => b,
            core::cmp::Ordering::Equal => a,
        }),
        (a, b) => a.or(b),
    }
}

#[cfg(test)]
mod tests {
    use alloc::string::ToString;

    use super::*;

    #[test]
    fn parses_strictly() {
        for (text, utc) in [
            ("2026-11-06T15:00Z", "2026-11-06T15:00:00.000Z"),
            ("2026-11-06T15:00:07Z", "2026-11-06T15:00:07.000Z"),
            ("2026-11-06T15:00:07.5Z", "2026-11-06T15:00:07.500Z"),
            ("2026-11-06T15:00:07.123+01:00", "2026-11-06T14:00:07.123Z"),
            ("2026-11-07T00:30:00+01:00", "2026-11-06T23:30:00.000Z"),
            ("2026-11-06T23:30:00-01:00", "2026-11-07T00:30:00.000Z"),
            ("2026-12-31T23:30:00-01:00", "2027-01-01T00:30:00.000Z"),
        ] {
            assert_eq!(
                text.parse::<UtcInstant>().map(|i| i.to_string()),
                Ok(utc.into()),
                "{text}"
            );
        }
        for bad in [
            "2026-11-06T15:00:00",
            "2026-11-06T24:00:00Z",
            "2026-11-06t15:00:00z",
            "2026-11-06 15:00:00Z",
            "+002026-11-06T15:00:00Z",
            "2026-11-06T15:00:00.1234Z",
            "2026-11-06T15:00:00.Z",
            "2026-02-30T15:00:00Z",
            "2026-11-06T15:60:00Z",
            "2026-11-06T15:00:60Z",
            "2026-11-06T15:00:00+24:00",
            "2026-11-06T15:00:00+0100",
            "2026-11",
            "",
        ] {
            assert_eq!(bad.parse::<UtcInstant>(), Err(Error::InvalidTime), "{bad}");
        }
        assert_eq!("2026-02-30".parse::<Time>(), Err(Error::InvalidTime));
        assert_eq!(
            "0000-01-01T00:30:00+01:00".parse::<UtcInstant>(),
            Err(Error::DateOutOfRange)
        );
    }

    #[test]
    fn a_date_covers_its_whole_day() {
        let day: Time = "2026-11-06".parse().unwrap();
        let midnight: Time = "2026-11-07T00:00:00Z".parse().unwrap();
        assert!(day.has_ended_at(&midnight));
        assert!(!midnight.has_ended_at(&midnight));
        assert!(!day.has_ended_at(&"2026-11-06T23:59:59.999Z".parse().unwrap()));
        assert!(
            "2026-11-06T23:00:00Z"
                .parse::<Time>()
                .unwrap()
                .has_started_by(&day)
        );
        let last: Time = "2026-11-06T23:59:59.999Z".parse().unwrap();
        assert_eq!(earliest_end(Some(day), Some(midnight)), Some(day));
        assert_eq!(earliest_end(Some(day), Some(last)), Some(last));
        assert_eq!(earliest_end(Some(last), Some(day)), Some(last));
    }
}
