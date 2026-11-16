//! Adyen exchange rates as exact rates, from settlement details report rows (ducat's
//! `@ducatjs/money/adyen-fx`).
//!
//! With the `tz` feature, `adyen_rate_with` also reads Creation Date in the account's IANA time
//! zone, summer time included. Zones come from the copy of the IANA time zone database that jiff
//! bundles (jiff-tzdb: tzdb 2026f with jiff 1.0.0), never from the host, so results follow that
//! copy's version: a jiff-tzdb release with new rules changes them.

use super::rate_text::digits;
use super::{AnyRate, Date, RateInfo, Time, UtcInstant};
use crate::{CurrencyCode, Error};

/// The UTC offsets, in minutes, of the zone abbreviations that name one offset. Ambiguous ones are
/// left out on purpose: IST is India, Ireland or Israel; CST US Central or China; BST British or
/// Bangladesh.
const ZONES: [(&str, i64); 23] = [
    ("UTC", 0),
    ("GMT", 0),
    ("WET", 0),
    ("WEST", 60),
    ("CET", 60),
    ("CEST", 120),
    ("EET", 120),
    ("EEST", 180),
    ("MSK", 180),
    ("SGT", 480),
    ("HKT", 480),
    ("JST", 540),
    ("KST", 540),
    ("AEST", 600),
    ("AEDT", 660),
    ("NZST", 720),
    ("NZDT", 780),
    ("EST", -300),
    ("EDT", -240),
    ("MST", -420),
    ("MDT", -360),
    ("PST", -480),
    ("PDT", -420),
];

/// Real UTC offsets run from −12:00 to +14:00.
const MAX_OFFSET_MINUTES: i64 = 14 * 60;

/// A zone label's offset in minutes: a named zone, or `+01:00`, `UTC+1`, `GMT-0530`.
fn offset_minutes(zone: &str) -> Option<i64> {
    if let Some(&(_, minutes)) = ZONES
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(zone))
    {
        return Some(minutes);
    }
    let rest = zone
        .strip_prefix("UTC")
        .or_else(|| zone.strip_prefix("GMT"))
        .unwrap_or(zone)
        .trim_start();
    let (sign, rest) = match rest.as_bytes().first()? {
        b'+' => (1, &rest[1..]),
        b'-' => (-1, &rest[1..]),
        _ => return None,
    };
    // one or two hour digits, then nothing, `:MM` or `MM`: the two-digit reading first, as the
    // pattern `(\d{1,2})(?::?(\d\d))?` tries it
    let split = [2, 1].into_iter().find_map(|length: usize| {
        let hours = digits(rest.get(..length)?, length)?;
        let tail = rest.get(length..)?;
        let minutes = match tail.strip_prefix(':').unwrap_or(tail) {
            "" if !tail.starts_with(':') => 0,
            two if two.len() == 2 => digits(two, 2)?,
            _ => return None,
        };
        Some((i64::from(hours), i64::from(minutes)))
    });
    let (hours, minutes) = split?;
    let total = hours * 60 + minutes;
    if minutes >= 60 || total > MAX_OFFSET_MINUTES {
        return None;
    }
    Some(sign * total)
}

/// `YYYY-MM-DD HH:MM[:SS[.fraction]]` (or with a `T`): the day and milliseconds into it.
fn local_time(text: &str) -> Option<(Date, i64)> {
    let bytes = text.as_bytes();
    if bytes.len() < 16 || !(bytes[10] == b' ' || bytes[10] == b'T') {
        return None;
    }
    let day: Date = text.get(..10)?.parse().ok()?;
    let clock = text.get(11..)?;
    let mut parts = clock.splitn(3, ':');
    let hour = digits(parts.next()?, 2)?;
    let minute = digits(parts.next()?, 2)?;
    let (second, millis) = match parts.next() {
        None => (0, 0),
        Some(rest) => {
            let (seconds, fraction) = match rest.split_once('.') {
                Some((seconds, fraction)) => (seconds, Some(fraction)),
                None => (rest, None),
            };
            let second = digits(seconds, 2)?;
            let millis = match fraction {
                None => 0,
                Some(fraction)
                    if !fraction.is_empty() && fraction.bytes().all(|b| b.is_ascii_digit()) =>
                {
                    let mut value = 0;
                    for (place, byte) in fraction.bytes().take(3).enumerate() {
                        value += i64::from(byte - b'0') * [100, 10, 1][place];
                    }
                    value
                }
                Some(_) => return None,
            };
            (second, millis)
        }
    };
    // JavaScript's Date.parse refuses an hour past 24, a minute or second past 59, and takes 24:00
    if hour > 24
        || minute > 59
        || second > 59
        || (hour == 24 && (minute, second, millis) != (0, 0, 0))
    {
        return None;
    }
    Some((
        day,
        ((i64::from(hour) * 60 + i64::from(minute)) * 60 + i64::from(second)) * 1000 + millis,
    ))
}

/// Creation Date as a UTC instant when its zone is known; otherwise its local day. An account zone
/// (`tz`) is read only when Creation Date has a time, as ducat reads it.
fn creation_as_of(
    created: &str,
    zone: Option<&str>,
    #[cfg(feature = "tz")] account: Option<&str>,
) -> Result<Option<Time>, Error> {
    let Some((day, millis)) = local_time(created.trim()) else {
        // a leading date is the local day
        return Ok(created
            .get(..10)
            .and_then(|day| day.parse::<Date>().ok())
            .map(Time::Date));
    };
    #[cfg(feature = "tz")]
    if let Some(name) = account {
        return Ok(tz::to_utc(day, millis, &tz::time_zone(name)?).map(Time::Instant));
    }
    let Some(offset) = zone.and_then(|label| offset_minutes(label.trim())) else {
        return Ok(Some(Time::Date(day)));
    };
    Ok(UtcInstant::shifted(day, millis - offset * 60_000)
        .ok()
        .map(Time::Instant))
}

/// The account's time zone, by name or offset, as `Intl.DateTimeFormat` reads ducat's `timeZone`.
#[cfg(feature = "tz")]
mod tz {
    use jiff::civil;
    use jiff::tz::{Offset, TimeZone, TimeZoneDatabase};

    use super::super::{Date, UtcInstant};
    use crate::Error;

    /// An offset time zone as ECMA-402 takes one: a sign (`+`, `-` or U+2212 MINUS SIGN) and
    /// `HH`, `HHMM` or `HH:MM`, hours 00 to 23 and minutes 00 to 59. No seconds, no `UTC` or `GMT`
    /// prefix, no `Z`, no one-digit hour.
    fn offset(name: &str) -> Option<Offset> {
        let (sign, rest) = match name.strip_prefix('+') {
            Some(rest) => (1, rest),
            None => (
                -1,
                name.strip_prefix('-')
                    .or_else(|| name.strip_prefix('\u{2212}'))?,
            ),
        };
        let two = |text: &str| {
            (text.len() == 2 && text.bytes().all(|byte| byte.is_ascii_digit()))
                .then(|| text.parse::<i32>().ok())
                .flatten()
        };
        // `get`, not indexing: the text may have multibyte characters
        let (hours, minutes) = match rest.len() {
            2 => (two(rest)?, 0),
            4 => (two(rest.get(..2)?)?, two(rest.get(2..)?)?),
            5 if rest.as_bytes()[2] == b':' => (two(rest.get(..2)?)?, two(rest.get(3..)?)?),
            _ => return None,
        };
        if hours > 23 || minutes > 59 {
            return None;
        }
        Offset::from_seconds(sign * (hours * 3600 + minutes * 60)).ok()
    }

    /// The zone `name` names: an offset, or a name in jiff's bundled tzdb, case-insensitive (as
    /// `Intl`). ICU's legacy IDs (`IST`, `PST`, `ACT`) and the removed `SystemV/` zones, which
    /// `Intl` takes, aren't in the tzdb, so they are refused; so are the tzdb's `Factory` and
    /// jiff's `Etc/Unknown`, which `Intl` refuses.
    pub(super) fn time_zone(name: &str) -> Result<TimeZone, Error> {
        if let Some(offset) = offset(name) {
            return Ok(TimeZone::fixed(offset));
        }
        if name.eq_ignore_ascii_case("Factory") || name.eq_ignore_ascii_case("Etc/Unknown") {
            return Err(Error::UnknownTimeZone);
        }
        // only the bundled copy: not the host's zoneinfo, nor whatever jiff::tz::db() is
        // configured with in the program
        TimeZoneDatabase::bundled()
            .get(name)
            .map_err(|_| Error::UnknownTimeZone)
    }

    /// Milliseconds in 400 Gregorian years, after which the calendar repeats (and so does a zone's
    /// rule for future years).
    const MILLIS_PER_400_YEARS: i64 = 146_097 * 86_400_000;

    /// The UTC instant of the wall time `millis` into `day` in `zone`, as Temporal's `'compatible'`
    /// reads it: the earlier instant in a fold, and in a gap the wall time pushed forward by the
    /// gap. `None` past 9999-12-31T23:59:59.999Z, which a `UtcInstant` can't hold.
    pub(super) fn to_utc(day: Date, millis: i64, zone: &TimeZone) -> Option<UtcInstant> {
        // 24:00 is the next day's midnight
        let wall = UtcInstant::shifted(day, millis).ok()?;
        let of_day = wall.millis_of_day();
        let at = |year: u16| {
            let date = civil::Date::new(
                // a Date's year is 0 to 9999
                year as i16,
                wall.date().month() as i8,
                wall.date().day() as i8,
            )
            .ok()?;
            let time = civil::Time::new(
                // within a day: the casts can't truncate
                (of_day / 3_600_000) as i8,
                (of_day / 60_000 % 60) as i8,
                (of_day / 1000 % 60) as i8,
                (of_day % 1000 * 1_000_000) as i32,
            )
            .ok()?;
            let at = zone
                .to_ambiguous_timestamp(civil::DateTime::from_parts(date, time))
                .compatible()
                .ok()?;
            Some(at.as_millisecond())
        };
        let year = wall.date().year();
        // jiff's instants end late on 9999-12-30, so the last hours of 9999 are read 400 years
        // earlier, where the calendar and the zone's rule are the same
        let millis =
            at(year).or_else(|| Some(at(year.checked_sub(400)?)? + MILLIS_PER_400_YEARS))?;
        UtcInstant::shifted(Date::from_day_number(0).ok()?, millis).ok()
    }
}

/// The rate in a settlement details report row, given as its `(column, value)` cells: "the
/// exchange rate used for converting the gross amount into the net amount", Gross Currency → Net
/// Currency (1 when they are the same), its decimal text kept exactly. `as_of` comes from Creation
/// Date, read in the TimeZone column's zone when that names one offset (CET, PST, `+01:00`), else
/// as the local day: Adyen's documentation doesn't say whether the column switches to CEST in
/// summer, and if it doesn't, a literal CET is an hour off then. `None` when the row has no rate.
/// With the `tz` feature, `adyen_rate_with` reads Creation Date in the account's IANA time zone
/// instead, summer time included.
///
/// # Errors
///
/// [`Error::NonPositiveRate`] for a rate that isn't positive; [`Error::UnknownCurrency`] for a
/// code that isn't a currency; whatever reading the rate fails with.
pub fn adyen_rate(row: &[(&str, &str)]) -> Result<Option<AnyRate>, Error> {
    rate(
        row,
        #[cfg(feature = "tz")]
        None,
    )
}

/// Options for [`adyen_rate_with`] (ducat's `AdyenRateOptions`).
#[cfg(feature = "tz")]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AdyenRateOptions<'a> {
    /// The account's time zone (ducat's `timeZone`): an IANA name (`Europe/Amsterdam`,
    /// case-insensitive) or an offset (`+01:00`, `+0100`, `+01`, a `-` or U+2212 sign, hours
    /// to 23). When given, Creation Date is read in it, summer time included, and the TimeZone
    /// column isn't used. A wall time the clocks pass twice (a fold) is the earlier instant, and
    /// one they skip (a gap) is pushed forward by the gap, as Temporal's `'compatible'`. The zone
    /// rules are those of the IANA time zone database jiff bundles (tzdb 2026f with jiff 1.0.0),
    /// never the host's.
    ///
    /// ICU's legacy IDs (`IST`, `PST`, `ACT`, `AET`, ...) and the removed `SystemV/` zones, which
    /// ducat's `Intl` accepts, are refused: they aren't in the tz database, and some name a zone
    /// the TimeZone column reads otherwise (ICU's `IST` is `Asia/Kolkata`; as a column label it
    /// is ambiguous). Write the IANA name.
    pub time_zone: Option<&'a str>,
}

/// [`adyen_rate`], with ducat's options: with [`AdyenRateOptions::time_zone`], Creation Date is
/// read in the account's IANA time zone, summer time included.
///
/// ```
/// use ducat::convert::adyen_fx::{AdyenRateOptions, adyen_rate_with};
///
/// let row = [
///     ("Creation Date", "2026-07-06 12:00:00"),
///     ("TimeZone", "CET"),
///     ("Gross Currency", "USD"),
///     ("Net Currency", "EUR"),
///     ("Exchange Rate", "0.9"),
/// ];
/// let options = AdyenRateOptions { time_zone: Some("Europe/Amsterdam") };
/// let rate = adyen_rate_with(&row, options)?.unwrap();
/// assert_eq!(rate.info().as_of.unwrap().to_string(), "2026-07-06T10:00:00.000Z");
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// As [`adyen_rate`], and [`Error::UnknownTimeZone`] for a time zone that isn't an IANA name or an
/// offset, when Creation Date has a time to read in it (ducat's `RangeError`).
#[cfg(feature = "tz")]
pub fn adyen_rate_with(
    row: &[(&str, &str)],
    options: AdyenRateOptions<'_>,
) -> Result<Option<AnyRate>, Error> {
    rate(row, options.time_zone)
}

fn rate(
    row: &[(&str, &str)],
    #[cfg(feature = "tz")] account: Option<&str>,
) -> Result<Option<AnyRate>, Error> {
    let get = |name: &str| {
        row.iter()
            .find(|(column, _)| *column == name)
            .map(|(_, value)| *value)
    };
    let (Some(gross), Some(net)) = (get("Gross Currency"), get("Net Currency")) else {
        return Ok(None);
    };
    let rate = get("Exchange Rate").map_or("", str::trim);
    if gross.is_empty() || net.is_empty() || rate.is_empty() {
        return Ok(None);
    }
    let code = |text: &str| CurrencyCode::iso(text).or_else(|_| CurrencyCode::historic(text));
    let as_of = match get("Creation Date") {
        Some(created) => creation_as_of(
            created,
            get("TimeZone"),
            #[cfg(feature = "tz")]
            account,
        )?,
        None => None,
    };
    AnyRate::parse(code(gross)?, code(net)?, rate)?
        .with_info(RateInfo {
            source: Some("adyen".into()),
            as_of,
            ..RateInfo::default()
        })
        .map(Some)
}
