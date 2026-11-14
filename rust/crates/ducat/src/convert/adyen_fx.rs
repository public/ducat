//! Adyen exchange rates as exact rates, from settlement details report rows (ducat's
//! `@ducatjs/money/adyen-fx`).

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

/// Creation Date as a UTC instant when its zone is known; otherwise its local day.
fn creation_as_of(created: &str, zone: Option<&str>) -> Option<Time> {
    let Some((day, millis)) = local_time(created.trim()) else {
        // a leading date is the local day
        return created.get(..10)?.parse::<Date>().ok().map(Time::Date);
    };
    let Some(offset) = zone.and_then(|label| offset_minutes(label.trim())) else {
        return Some(Time::Date(day));
    };
    UtcInstant::shifted(day, millis - offset * 60_000)
        .ok()
        .map(Time::Instant)
}

/// The rate in a settlement details report row, given as its `(column, value)` cells: "the
/// exchange rate used for converting the gross amount into the net amount", Gross Currency → Net
/// Currency (1 when they are the same), its decimal text kept exactly. `as_of` comes from Creation
/// Date, read in the TimeZone column's zone when that names one offset (CET, PST, `+01:00`), else
/// as the local day. `None` when the row has no rate. ducat also takes an IANA time zone to read
/// Creation Date in, summer time included; that needs time-zone data, so it isn't ported.
///
/// # Errors
///
/// [`Error::NonPositiveRate`] for a rate that isn't positive; [`Error::UnknownCurrency`] for a
/// code that isn't a currency; whatever reading the rate fails with.
pub fn adyen_rate(row: &[(&str, &str)]) -> Result<Option<AnyRate>, Error> {
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
    let as_of = get("Creation Date").and_then(|created| creation_as_of(created, get("TimeZone")));
    AnyRate::parse(code(gross)?, code(net)?, rate)?
        .with_info(RateInfo {
            source: Some("adyen".into()),
            as_of,
            ..RateInfo::default()
        })
        .map(Some)
}
