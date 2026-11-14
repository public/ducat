//! Offline parsers for the ECB's euro foreign exchange reference rates (ducat's
//! `@ducatjs/money/convert/ecb`): eurofxref XML and CSV, and the Data Portal's SDMX-CSV. They take
//! the text and never fetch; rates are kept exactly as published.
//!
//! ```
//! use ducat::convert::ecb::{EcbOptions, parse_ecb_xml};
//! use ducat::convert::{RateProvider, RateQuery};
//!
//! let xml = "<Cube><Cube time='2026-11-06'><Cube currency='USD' rate='1.1165'/></Cube></Cube>";
//! let tables = parse_ecb_xml(xml, &EcbOptions::default())?;
//! let eur_usd = tables[0].rate("EUR".parse()?, "USD".parse()?, &RateQuery::default()).unwrap();
//! assert_eq!(eur_usd.to_string(), "1.1165");
//! # Ok::<(), ducat::Error>(())
//! ```

use alloc::string::String;
use alloc::vec::Vec;

use super::rate_text::{
    DayRates, add_day_rate, any_rate, calendar_day, csv_rows, day_of, digits, is_code,
    is_plain_decimal, local_time, malformed, newest_first, publication, rate_cell, resolve, sunday,
    with_decimals, without_bom,
};
use super::{Date, Publication, RateInfo, RateTable, RateType, Time};
use crate::{CurrencyCode, Error};

/// Options for [`parse_ecb_xml`] and [`parse_ecb_csv`].
#[derive(Clone, Copy, Default)]
pub struct EcbOptions<'a> {
    /// When each day's rates became available, so a historical lookup can't use a rate before it
    /// was published. [`Publication::Stated`] is the ECB's documented 16:00 CET on the day
    /// (Frankfurt time: 15:00 UTC in winter, 14:00 in summer). Default: unknown, so a query at
    /// any time on the day gets that day's rates.
    pub available_at: Publication<'a>,
}

/// Options for [`parse_ecb_sdmx_csv`].
#[derive(Clone, Copy, Default)]
pub struct EcbSdmxOptions<'a> {
    /// As [`EcbOptions::available_at`].
    pub available_at: Publication<'a>,
    /// The decimals each currency is published with, for a file without the DECIMALS column
    /// (`detail=dataonly`); see [`parse_ecb_sdmx_decimals`]. A DECIMALS column in the file takes
    /// precedence.
    pub decimals: &'a [(String, u8)],
}

/// 16:00 in Frankfurt on `day`: CET, or CEST from the last Sunday of March to the last Sunday of
/// October (the EU rule since 1996; the clocks change at 01:00 UTC, so a change day is already on
/// its new offset at 16:00).
fn ecb_published(day: Date) -> Result<Time, Error> {
    let summer = sunday(day.year(), 3, None)? <= day && day < sunday(day.year(), 10, None)?;
    local_time(day, 16, 0, if summer { 2 } else { 1 })
}

/// The ECB's rates are typed `reference`, not `mid`: set once a day by a concertation between
/// central banks, for information only.
fn ecb_table(
    day: Date,
    rates: &DayRates,
    available_at: &Publication<'_>,
) -> Result<RateTable, Error> {
    let info = RateInfo {
        source: Some("ECB".into()),
        as_of: Some(Time::Date(day)),
        available_at: publication(available_at, day, ecb_published)?,
        rate_type: Some(RateType::from("reference")),
        ..RateInfo::default()
    };
    let mut builder = RateTable::with_base(CurrencyCode::iso("EUR")?, info);
    let (known, unknown) = resolve(rates);
    for (code, rate) in known {
        builder = match rate {
            Some(text) => builder.rate(code, text)?,
            None => builder.missing(code),
        };
    }
    for code in &unknown {
        builder = builder.unknown(code);
    }
    Ok(builder.build())
}

const MONTHS: [&str; 12] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

/// `2026-11-06`, or `06 November 2026` as in the daily CSV.
fn ecb_day(text: &str) -> Result<Date, Error> {
    let bytes = text.as_bytes();
    if bytes.len() == 10 && bytes[4] == b'-' && bytes[7] == b'-' {
        if let (Some(year), Some(month), Some(day)) = (
            digits(&text[..4], 4),
            digits(&text[5..7], 2),
            digits(&text[8..], 2),
        ) {
            // two digits fit a u8
            return day_of(year, month as u8, day as u8);
        }
    }
    let mut parts = text.split(' ');
    let (Some(day), Some(month), Some(year), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return malformed();
    };
    let day = digits(day, 1).or_else(|| digits(day, 2));
    let month = (!month.is_empty() && month.bytes().all(|byte| byte.is_ascii_alphabetic()))
        .then(|| {
            MONTHS
                .iter()
                .position(|name| name.eq_ignore_ascii_case(month))
        })
        .flatten();
    match (day, month, digits(year, 4)) {
        // a month index fits a u8, and so do two digits
        (Some(day), Some(month), Some(year)) => day_of(year, month as u8 + 1, day as u8),
        _ => malformed(),
    }
}

/// The next `<Cube …>`, `<Cube …/>` or `</Cube>` tag at or after `from`: whether it closes,
/// its attribute text, whether it is self-closing, and where it ends. `Cube` must end the name
/// (`<Cubes>` isn't one).
fn next_cube_tag(text: &str, mut from: usize) -> Option<(bool, &str, bool, usize)> {
    while let Some(found) = text.get(from..)?.find('<') {
        let start = from + found;
        from = start + 1;
        let rest = &text[start + 1..];
        let (close, rest) = match rest.strip_prefix('/') {
            Some(rest) => (true, rest),
            None => (false, rest),
        };
        let Some(after) = rest.strip_prefix("Cube") else {
            continue;
        };
        if after
            .chars()
            .next()
            .is_some_and(|char| char.is_ascii_alphanumeric() || char == '_')
        {
            continue;
        }
        let end = after.find('>')?;
        let inner = &after[..end];
        let (attributes, self_closing) = match inner.strip_suffix('/') {
            Some(attributes) => (attributes, true),
            None => (inner, false),
        };
        let tag_end = text.len() - after.len() + end + 1;
        return Some((close, attributes, self_closing, tag_end));
    }
    None
}

/// A day cube's attribute text, ` time='2026-11-06' `: its date text.
fn day_attributes(text: &str) -> Option<&str> {
    let rest = text.trim_start();
    if rest.len() == text.len() {
        return None;
    }
    let value = rest.strip_prefix("time=")?;
    let bytes = value.as_bytes();
    let quotes = |byte: u8| byte == b'"' || byte == b'\'';
    if bytes.len() < 12 || !quotes(bytes[0]) || !quotes(bytes[11]) || !value[12..].trim().is_empty()
    {
        return None;
    }
    let shaped = bytes[1..11].iter().enumerate().all(|(i, &byte)| {
        if i == 4 || i == 7 {
            byte == b'-'
        } else {
            byte.is_ascii_digit()
        }
    });
    // checked byte by byte, so the slice is ASCII
    shaped.then(|| &value[1..11])
}

/// The attributes of an inner cube's text, the last of a repeated name winning.
fn attributes(text: &str) -> Vec<(&str, &str)> {
    let bytes = text.as_bytes();
    let mut found: Vec<(&str, &str)> = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let name_end = at
            + bytes[at..]
                .iter()
                .take_while(|b| b.is_ascii_alphabetic())
                .count();
        if name_end > at {
            let mut i = name_end;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b'=' {
                i += 1;
                while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                    i += 1;
                }
                if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'') {
                    let quote = bytes[i];
                    if let Some(length) = bytes[i + 1..].iter().position(|&b| b == quote) {
                        let name = &text[at..name_end];
                        let value = &text[i + 1..i + 1 + length];
                        match found.iter_mut().find(|(known, _)| *known == name) {
                            Some(entry) => entry.1 = value,
                            None => found.push((name, value)),
                        }
                        at = i + 2 + length;
                        continue;
                    }
                }
            }
        }
        at += text[at..].chars().next().map_or(1, char::len_utf8);
    }
    found
}

/// Adds the currency → rate attributes of one inner cube to a day's rates.
fn add_rate(rates: &mut DayRates, text: &str) -> Result<(), Error> {
    let attributes = attributes(text);
    let get = |name: &str| {
        attributes
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, v)| *v)
    };
    match (get("currency"), get("rate")) {
        (None, None) => Ok(()),
        // fail rather than silently drop a currency: a missing rate would look like "not quoted"
        (Some(code), Some(rate)) if is_code(code) && is_plain_decimal(rate) => {
            match rates.iter_mut().find(|(known, _)| known == code) {
                Some(entry) => entry.1 = Some(rate.into()),
                None => rates.push((code.into(), Some(rate.into()))),
            }
            Ok(())
        }
        _ => malformed(),
    }
}

/// Parses `eurofxref-daily.xml`, `eurofxref-hist-90d.xml` or `eurofxref-hist.xml` into one
/// EUR-based table per day, newest first: EUR → currency, with source `ECB`, type `reference` and
/// `as_of` the day. A day without any rates is left out, so a lookback goes on to the day before.
///
/// # Errors
///
/// [`Error::MalformedRates`] for a file without a day, or a rate entry that can't be read.
pub fn parse_ecb_xml(xml: &str, options: &EcbOptions<'_>) -> Result<Vec<RateTable>, Error> {
    let text = without_bom(xml);
    let mut tables = Vec::new();
    // the Cube elements must nest: a day's rates end at its own closing tag, and an inner cube
    // may be written <Cube …/> or <Cube …></Cube>
    let (mut days, mut depth, mut from) = (0_u32, 0_i64, 0);
    let mut day: Option<(Date, DayRates)> = None;
    let mut open: Option<&str> = None;
    while let Some((close, attributes, self_closing, end)) = next_cube_tag(text, from) {
        from = end;
        if close {
            if let Some(inner) = open.take() {
                if let Some((_, rates)) = &mut day {
                    add_rate(rates, inner)?;
                }
            } else if let Some((date, rates)) = day.take() {
                if !rates.is_empty() {
                    tables.push(ecb_table(date, &rates, &options.available_at)?);
                }
            }
            depth -= 1;
        } else if open.is_some() {
            return malformed();
        } else if let Some((_, rates)) = &mut day {
            if self_closing {
                add_rate(rates, attributes)?;
            } else {
                open = Some(attributes);
                depth += 1;
            }
        } else if !self_closing {
            if let Some(date) = day_attributes(attributes) {
                days += 1;
                day = Some((ecb_day(date)?, Vec::new()));
            }
            depth += 1;
        }
        if depth < 0 {
            return malformed();
        }
    }
    if days == 0 || depth != 0 {
        return malformed();
    }
    Ok(newest_first(tables))
}

/// Parses `eurofxref.csv` or `eurofxref-hist.csv` (from the ECB's zips) as [`parse_ecb_xml`]
/// does. `N/A` and blank cells are listed in the table's `missing`; a day with no rates at all is
/// left out.
///
/// # Errors
///
/// [`Error::MalformedRates`] for a file without a `Date` column, a bad date or an unreadable cell.
pub fn parse_ecb_csv(csv: &str, options: &EcbOptions<'_>) -> Result<Vec<RateTable>, Error> {
    let mut lines = without_bom(csv)
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .filter(|line| !line.trim().is_empty());
    let header = lines.next().unwrap_or("");
    let columns: Vec<&str> = header.split(',').map(str::trim).collect();
    if columns[0] != "Date" {
        return malformed();
    }
    let codes = &columns[1..];
    let mut tables = Vec::new();
    for line in lines {
        let cells: Vec<&str> = line.split(',').map(str::trim).collect();
        let day = ecb_day(cells[0])?;
        let mut rates: DayRates = Vec::new();
        for (i, code) in codes.iter().enumerate() {
            if code.is_empty() {
                continue;
            }
            let rate = rate_cell(cells.get(i + 1).copied().unwrap_or(""))?;
            match rates.iter_mut().find(|(known, _)| known == code) {
                Some(entry) => entry.1 = rate.map(String::from),
                None => rates.push(((*code).into(), rate.map(String::from))),
            }
        }
        if any_rate(&rates) {
            tables.push(ecb_table(day, &rates, &options.available_at)?);
        }
    }
    Ok(newest_first(tables))
}

/// Series whose DECIMALS overstates what the ECB has ever published for them: THB (3, not 4)
/// and LTL (4, not 5). Padding to the attribute would invent a digit.
const PUBLISHED_DECIMALS: [(&str, u8); 2] = [("THB", 3), ("LTL", 4)];

fn read_decimals(text: &str) -> Result<u8, Error> {
    match digits(text, 1).or_else(|| digits(text, 2)) {
        // at most two digits
        Some(value) if value <= 30 => Ok(value as u8),
        _ => malformed(),
    }
}

fn stated_decimals(code: &str, text: &str) -> Result<u8, Error> {
    let stated = read_decimals(text)?;
    Ok(PUBLISHED_DECIMALS
        .iter()
        .find(|(known, _)| *known == code)
        .map_or(stated, |&(_, published)| published.min(stated)))
}

/// The records of an SDMX-CSV file after its header, each with as many cells as the header.
fn sdmx_records(csv: &str) -> Result<(Vec<String>, Vec<Vec<String>>), Error> {
    let mut rows = csv_rows(without_bom(csv))?.into_iter();
    let header = rows.next().ok_or(Error::MalformedRates)?;
    let rows: Vec<Vec<String>> = rows.collect();
    if rows.iter().any(|cells| cells.len() != header.len()) {
        return malformed();
    }
    Ok((header, rows))
}

fn column(header: &[String], name: &str) -> Option<usize> {
    // a repeated name: the last one, as a JavaScript Map keeps it
    header.iter().rposition(|cell| cell.trim() == name)
}

fn required(header: &[String], names: &[&str]) -> Result<Vec<usize>, Error> {
    names
        .iter()
        .map(|name| column(header, name).ok_or(Error::MalformedRates))
        .collect()
}

/// The DECIMALS of each series in an ECB SDMX-CSV file: the data file with full detail, or the
/// series file the API returns with `detail=nodata`, in the file's order. Pass it as
/// [`EcbSdmxOptions::decimals`].
///
/// # Errors
///
/// [`Error::MalformedRates`] for a file without CURRENCY and DECIMALS columns, or with a DECIMALS
/// that isn't 0 to 30.
pub fn parse_ecb_sdmx_decimals(csv: &str) -> Result<Vec<(String, u8)>, Error> {
    let (header, rows) = sdmx_records(csv)?;
    let at = required(&header, &["CURRENCY", "DECIMALS"])?;
    let mut decimals: Vec<(String, u8)> = Vec::new();
    for cells in rows {
        let code = cells[at[0]].trim();
        let value = stated_decimals(code, cells[at[1]].trim())?;
        match decimals.iter_mut().find(|(known, _)| known == code) {
            Some(entry) => entry.1 = value,
            None => decimals.push((code.into(), value)),
        }
    }
    Ok(decimals)
}

/// Parses the ECB Data Portal's SDMX-CSV (`format=csvdata`) for the daily euro reference rates
/// (dataflow EXR, key `D.<currencies>.EUR.SP00.A`) into one EUR-based table per day, newest
/// first, as [`parse_ecb_xml`] does. The API strips trailing zeros, so the published digits are
/// rebuilt from each series' DECIMALS (capped for THB and LTL), in the file or in
/// `options.decimals`. An empty or `NaN` value is a missing value.
///
/// # Errors
///
/// [`Error::MalformedRates`] for a row for another frequency, rate type or base currency, with a
/// UNIT_MULT other than 0, a bad date, two different values for one day, or an unreadable cell.
pub fn parse_ecb_sdmx_csv(
    csv: &str,
    options: &EcbSdmxOptions<'_>,
) -> Result<Vec<RateTable>, Error> {
    let (header, rows) = sdmx_records(csv)?;
    let at = required(
        &header,
        &["CURRENCY", "CURRENCY_DENOM", "TIME_PERIOD", "OBS_VALUE"],
    )?;
    let optional =
        |cells: &[String], name: &str| column(&header, name).map(|i| String::from(cells[i].trim()));
    let mut days: Vec<(Date, DayRates)> = Vec::new();
    for cells in &rows {
        let code_text = cells[at[0]].trim();
        let day_text = cells[at[2]].trim();
        let unexpected = cells[at[1]].trim() != "EUR"
            || optional(cells, "FREQ").is_some_and(|value| value != "D")
            || optional(cells, "EXR_TYPE").is_some_and(|value| value != "SP00")
            || optional(cells, "EXR_SUFFIX").is_some_and(|value| value != "A");
        if unexpected {
            return malformed();
        }
        let shaped = day_text.len() == 10
            && day_text.bytes().enumerate().all(|(i, byte)| {
                if i == 4 || i == 7 {
                    byte == b'-'
                } else {
                    byte.is_ascii_digit()
                }
            });
        if !is_code(code_text) || !shaped {
            return malformed();
        }
        if optional(cells, "UNIT_MULT").is_some_and(|value| !value.is_empty() && value != "0") {
            return malformed();
        }
        let mut rate = rate_cell(cells[at[3]].trim())?.map(String::from);
        if let Some(text) = &rate {
            let mut decimals = options
                .decimals
                .iter()
                .find(|(known, _)| known == code_text)
                .map(|&(_, value)| value);
            if let Some(own) = optional(cells, "DECIMALS").filter(|own| !own.is_empty()) {
                decimals = Some(stated_decimals(code_text, &own)?);
            }
            if let Some(decimals) = decimals {
                rate = Some(with_decimals(text, decimals)?);
            }
        }
        add_day_rate(
            &mut days,
            calendar_day(day_text)?,
            code_text,
            rate.as_deref(),
        )?;
    }
    let mut tables = Vec::new();
    for (day, rates) in &days {
        if any_rate(rates) {
            tables.push(ecb_table(*day, rates, &options.available_at)?);
        }
    }
    Ok(newest_first(tables))
}
