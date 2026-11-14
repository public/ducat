//! An offline parser for HMRC's monthly exchange rates, the UK's rates for customs and VAT
//! (ducat's `@ducatjs/money/convert/hmrc`). It takes the CSV text and never fetches.

use alloc::vec::Vec;

use super::rate_text::{
    DayRates, add_day_rate, csv_rows, day_of, digits, is_code, malformed, newest_first,
    publication, rate_cell, resolve, weekday, without_bom,
};
use super::{Date, Publication, RateInfo, RateTable, RateType, Time, UtcInstant};
use crate::{CurrencyCode, Error};

/// A period: its start and end dates.
type Period = (Date, Date);

const COLUMNS: [&str; 4] = [
    "Currency Code",
    "Currency Units per £1",
    "Start date",
    "End date",
];

/// Options for [`parse_hmrc_monthly_csv`].
#[derive(Clone, Copy)]
pub struct HmrcOptions<'a> {
    /// When each period's rates were published, given its start. Default:
    /// [`Publication::Stated`], the end (UTC) of the Wednesday before the penultimate Thursday of
    /// the month before, when HMRC publishes them.
    pub available_at: Publication<'a>,
}

impl Default for HmrcOptions<'_> {
    fn default() -> Self {
        Self {
            available_at: Publication::Stated,
        }
    }
}

/// `DD/MM/YYYY`.
fn uk_day(text: &str) -> Result<Date, Error> {
    let mut parts = text.trim().split('/');
    match (
        parts.next().and_then(|day| digits(day, 2)),
        parts.next().and_then(|month| digits(month, 2)),
        parts.next().and_then(|year| digits(year, 4)),
        parts.next(),
    ) {
        // two digits fit a u8
        (Some(day), Some(month), Some(year), None) => day_of(year, month as u8, day as u8),
        _ => malformed(),
    }
}

/// The end of the Wednesday before the penultimate Thursday of the month before `start`'s: the
/// start of that Thursday, UTC.
fn published_by(start: Date) -> Result<Time, Error> {
    let month_start = Date::new(start.year(), start.month(), 1)?;
    let last = month_start.add_days(-1)?;
    let back_to_thursday = (weekday(last) - 4).rem_euclid(7);
    let thursday = last.add_days(-back_to_thursday - 7)?;
    Ok(Time::Instant(UtcInstant::start_of(thursday)))
}

/// Parses HMRC's monthly exchange rates CSV into one GBP-based table per period, newest first:
/// `as_of` its start date and `valid_until` its end date, so a [`rate_history`] of them answers
/// any day of the period. Rates are currency units per £1, with source `HMRC` and type
/// `customs`, four decimals as published. Several countries share a code (the CFA francs, AED,
/// XCD): their rows must agree.
///
/// [`rate_history`]: super::history::rate_history
///
/// # Errors
///
/// [`Error::MalformedRates`] for a file without the four columns, no rates, a short row, a bad or
/// GBP code, a bad date, an end before its start, a blank or missing-value rate, or two
/// different values for one code in one period.
pub fn parse_hmrc_monthly_csv(
    csv: &str,
    options: &HmrcOptions<'_>,
) -> Result<Vec<RateTable>, Error> {
    let rows = csv_rows(without_bom(csv))?;
    let names: Vec<&str> = rows.first().map_or_else(Vec::new, |header| {
        header.iter().map(|name| name.trim()).collect()
    });
    let index = COLUMNS
        .iter()
        .map(|name| {
            names
                .iter()
                .position(|known| known == name)
                .ok_or(Error::MalformedRates)
        })
        .collect::<Result<Vec<_>, Error>>()?;
    let body = &rows[1..];
    if body.is_empty() {
        return malformed();
    }
    let gbp = CurrencyCode::iso("GBP")?;
    // periods by their start and end, in the order first seen; within one, rates by code
    let mut periods: Vec<(Period, Vec<(Date, DayRates)>)> = Vec::new();
    for cells in body {
        if cells.len() != names.len() {
            return malformed();
        }
        let code = cells[index[0]].trim();
        if !is_code(code) || code == "GBP" {
            return malformed();
        }
        let (start, end) = (uk_day(&cells[index[2]])?, uk_day(&cells[index[3]])?);
        if end < start {
            return malformed();
        }
        let Some(rate) = rate_cell(&cells[index[1]])? else {
            return malformed();
        };
        let period = match periods.iter().position(|(key, _)| *key == (start, end)) {
            Some(i) => i,
            None => {
                periods.push(((start, end), Vec::new()));
                periods.len() - 1
            }
        };
        add_day_rate(&mut periods[period].1, start, code, Some(rate))?;
    }
    let mut tables = Vec::new();
    for ((start, end), days) in &periods {
        let info = RateInfo {
            source: Some("HMRC".into()),
            as_of: Some(Time::Date(*start)),
            available_at: publication(&options.available_at, *start, published_by)?,
            valid_until: Some(Time::Date(*end)),
            rate_type: Some(RateType::from("customs")),
            ..RateInfo::default()
        };
        let mut builder = RateTable::with_base(gbp, info);
        let (known, unknown) = resolve(&days[0].1);
        for (code, rate) in known {
            if let Some(text) = rate {
                builder = builder.rate(code, text)?;
            }
        }
        for code in &unknown {
            builder = builder.unknown(code);
        }
        tables.push(builder.build());
    }
    Ok(newest_first(tables))
}
