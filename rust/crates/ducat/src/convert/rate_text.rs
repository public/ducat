//! Reading published rate files, shared by the source parsers (ducat's `src/rate-text.ts`), so
//! that every source handles missing values, stripped digits, CSV and dates the same way.

// each source uses a part, so with one source alone the rest is unused
#![allow(dead_code)]

use alloc::string::String;
use alloc::vec::Vec;

use super::{Date, Publication, RateTable, Time, UtcInstant};
use crate::{CurrencyCode, Error};

/// The markers sources write for "no value this day", compared upper-cased: blank (ECB CSV, BoE),
/// `ND` (Fed H.10), `N/A` (ECB CSV), `NA`, `N.A.`, dashes, `NaN` and `NULL`.
const MISSING: [&str; 10] = ["", "ND", "N/A", "NA", "N.A.", "-", "–", "—", "NAN", "NULL"];

pub(crate) fn malformed<T>() -> Result<T, Error> {
    Err(Error::MalformedRates)
}

/// Digits, with an optional fraction: `1.1165`.
pub(crate) fn is_plain_decimal(text: &str) -> bool {
    let (whole, fraction) = match text.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (text, None),
    };
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
    digits(whole) && fraction.is_none_or(digits)
}

/// A published rate cell: its decimal text, or `None` for a missing-value marker.
///
/// # Errors
///
/// [`Error::MalformedRates`] for anything else: a cell that can't be read must not look like "not
/// quoted".
pub(crate) fn rate_cell(cell: &str) -> Result<Option<&str>, Error> {
    let text = cell.trim();
    if MISSING
        .iter()
        .any(|marker| text.eq_ignore_ascii_case(marker))
    {
        return Ok(None);
    }
    if is_plain_decimal(text) {
        Ok(Some(text))
    } else {
        malformed()
    }
}

/// The published digits of a rate from a feed that strips trailing zeros: `1.175` with 4
/// decimals is `1.1750`. Text with more decimals is kept as it is.
pub(crate) fn with_decimals(text: &str, decimals: u8) -> String {
    let present = text
        .split_once('.')
        .map_or(0, |(_, fraction)| fraction.len());
    let wanted = usize::from(decimals);
    let mut out = String::from(text);
    if present >= wanted {
        return out;
    }
    if present == 0 {
        out.push('.');
    }
    for _ in present..wanted {
        out.push('0');
    }
    out
}

/// Text without a leading byte-order mark.
pub(crate) fn without_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

/// The records of a CSV file, RFC 4180 style: a cell may be quoted (`"a, b"`, with `""` for a
/// quote); a quote anywhere else, or one left open, is malformed, so a stray quote can't swallow
/// the lines after it. Blank lines are skipped; CRLF and LF both end a record.
pub(crate) fn csv_rows(text: &str) -> Result<Vec<Vec<String>>, Error> {
    #[derive(PartialEq)]
    enum State {
        Start,
        Plain,
        Quoted,
        Closed,
    }
    let mut rows = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut cell = String::new();
    let mut state = State::Start;
    let mut chars = text.chars().peekable();
    let end_row = |row: &mut Vec<String>, cell: &mut String, rows: &mut Vec<Vec<String>>| {
        row.push(core::mem::take(cell));
        let taken = core::mem::take(row);
        if taken.len() > 1 || !taken[0].trim().is_empty() {
            rows.push(taken);
        }
    };
    while let Some(char) = chars.next() {
        if state == State::Quoted {
            if char != '"' {
                cell.push(char);
            } else if chars.peek() == Some(&'"') {
                cell.push('"');
                chars.next();
            } else {
                state = State::Closed;
            }
            continue;
        }
        match char {
            ',' => {
                row.push(core::mem::take(&mut cell));
                state = State::Start;
            }
            '\n' => {
                end_row(&mut row, &mut cell, &mut rows);
                state = State::Start;
            }
            '\r' if chars.peek() == Some(&'\n') => {}
            '"' if state == State::Start => state = State::Quoted,
            _ if char == '"' || state == State::Closed => return malformed(),
            _ => {
                cell.push(char);
                state = State::Plain;
            }
        }
    }
    if state == State::Quoted {
        return malformed();
    }
    if !cell.is_empty() || !row.is_empty() {
        end_row(&mut row, &mut cell, &mut rows);
    }
    Ok(rows)
}

/// A real calendar day in ISO form, `YYYY-MM-DD`, from the year 100 on: ducat reads days with
/// JavaScript's `Date.UTC`, which takes years 0 to 99 as 1900 to 1999, so it refuses those.
pub(crate) fn calendar_day(text: &str) -> Result<Date, Error> {
    let day: Date = text.parse().map_err(|_| Error::MalformedRates)?;
    if day.year() < 100 {
        return malformed();
    }
    Ok(day)
}

/// The day `year`-`month`-`day`, or malformed when it doesn't exist (32 November), or is before
/// the year 100 (see [`calendar_day`]).
pub(crate) fn day_of(year: u16, month: u8, day: u8) -> Result<Date, Error> {
    match Date::new(year, month, day) {
        Ok(date) if year >= 100 => Ok(date),
        _ => malformed(),
    }
}

/// Exactly `count` ASCII digits.
pub(crate) fn digits(text: &str, count: usize) -> Option<u16> {
    (text.len() == count && text.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| text.parse().ok())
        .flatten()
}

/// A currency code from a file: three uppercase letters, an ISO 4217 code or a withdrawn one (the
/// ECB's history lists CYP, the Fed VEB).
pub(crate) fn currency(code: &str) -> Result<CurrencyCode, Error> {
    if code.len() != 3 || !code.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return malformed();
    }
    CurrencyCode::iso(code).or_else(|_| CurrencyCode::historic(code))
}

/// A day's rates by currency, in the order first seen: a rate text or `None` (missing).
pub(crate) type DayRates = Vec<(CurrencyCode, Option<String>)>;

/// Records a currency's rate (or `None`, missing) for a day. The same currency twice on one day is
/// a repeat, which is fine, or a contradiction, which is malformed: a parser never picks one.
pub(crate) fn add_day_rate(
    days: &mut Vec<(Date, DayRates)>,
    day: Date,
    code: CurrencyCode,
    rate: Option<&str>,
) -> Result<(), Error> {
    let index = match days.iter().position(|(known, _)| *known == day) {
        Some(index) => index,
        None => {
            days.push((day, Vec::new()));
            days.len() - 1
        }
    };
    let rates = &mut days[index].1;
    match rates.iter().find(|(known, _)| *known == code) {
        Some((_, earlier)) if earlier.as_deref() != rate => malformed(),
        Some(_) => Ok(()),
        None => {
            rates.push((code, rate.map(String::from)));
            Ok(())
        }
    }
}

/// Whether a day has at least one rate.
pub(crate) fn any_rate(rates: &DayRates) -> bool {
    rates.iter().any(|(_, rate)| rate.is_some())
}

/// Dated tables, newest first, stably.
pub(crate) fn newest_first(mut tables: Vec<RateTable>) -> Vec<RateTable> {
    tables.sort_by(|first, second| {
        let day = |table: &RateTable| table.as_of().map(|time| time.day());
        day(second).cmp(&day(first))
    });
    tables
}

/// The day of the week, 0 for Sunday.
pub(crate) fn weekday(day: Date) -> i64 {
    (day.day_number() + 4).rem_euclid(7)
}

/// The `n`th Sunday (1-based) of a month; `None` for the last.
pub(crate) fn sunday(year: u16, month: u8, n: Option<u8>) -> Result<Date, Error> {
    match n {
        Some(n) => {
            let first = Date::new(year, month, 1)?;
            first.add_days((7 - weekday(first)) % 7 + 7 * (i64::from(n) - 1))
        }
        None => {
            let next = if month == 12 {
                Date::new(year + 1, 1, 1)?
            } else {
                Date::new(year, month + 1, 1)?
            };
            let last = next.add_days(-1)?;
            last.add_days(-weekday(last))
        }
    }
}

/// The instant `hour`:`minute` local time on `day`, at `offset_hours` from UTC.
pub(crate) fn local_time(day: Date, hour: u8, minute: u8, offset_hours: i8) -> Result<Time, Error> {
    let millis = (i64::from(hour) * 60 + i64::from(minute) - i64::from(offset_hours) * 60) * 60_000;
    UtcInstant::shifted(day, millis).map(Time::Instant)
}

/// When a table was published: the source's stated time, none, or the caller's.
pub(crate) fn publication(
    publication: &Publication<'_>,
    day: Date,
    stated: impl FnOnce(Date) -> Result<Time, Error>,
) -> Result<Option<Time>, Error> {
    match publication {
        Publication::Unknown => Ok(None),
        Publication::Stated => stated(day).map(Some),
        Publication::Given(given) => Ok(Some(given(day))),
    }
}
