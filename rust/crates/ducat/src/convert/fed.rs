//! An offline parser for the Federal Reserve Board's H.10 foreign exchange rates (ducat's
//! `@ducatjs/money/convert/fed`). Parser only: the Board's Data Download Program serves the CSV.

use alloc::string::String;
use alloc::vec::Vec;

use super::history::{QuotedRate, QuotedTableSpec, quoted_table};
use super::rate_text::{
    DayRates, add_day_rate, calendar_day, csv_rows, currency, is_code, malformed, newest_first,
    rate_cell, without_bom,
};
use super::{Date, RateInfo, RateTable, RateType, Time};
use crate::{CurrencyCode, Error};

/// The country codes in H.10 series IDs, and the currency each one's column must carry.
const FED_COUNTRIES: [(&str, &str); 23] = [
    ("AL", "AUD"),
    ("EU", "EUR"),
    ("NZ", "NZD"),
    ("UK", "GBP"),
    ("BZ", "BRL"),
    ("CA", "CAD"),
    ("CH", "CNY"),
    ("DN", "DKK"),
    ("HK", "HKD"),
    ("IN", "INR"),
    ("JA", "JPY"),
    ("MA", "MYR"),
    ("MX", "MXN"),
    ("NO", "NOK"),
    ("SF", "ZAR"),
    ("SI", "SGD"),
    ("KO", "KRW"),
    ("SL", "LKR"),
    ("SD", "SEK"),
    ("SZ", "CHF"),
    ("TA", "TWD"),
    ("TH", "THB"),
    ("VES", "VEB"),
];

/// A series ID, `RXI_N.B.JA` or `H10/H10/RXI$US_N.B.EU`: its country code, and whether it is
/// quoted as USD per unit (`RXI$US`).
fn series(id: &str) -> Option<(&str, bool)> {
    let id = id.strip_prefix("H10/H10/").unwrap_or(id);
    let (inverted, rest) = match id.strip_prefix("RXI$US_N.B.") {
        Some(rest) => (true, rest),
        None => (false, id.strip_prefix("RXI_N.B.")?),
    };
    ((2..=3).contains(&rest.len()) && rest.bytes().all(|byte| byte.is_ascii_uppercase()))
        .then_some((rest, inverted))
}

/// Parses the Federal Reserve Board's H.10 daily foreign exchange rates, as CSV from its Data
/// Download Program, into one USD-based table per day, newest first, with source `FRB` and type
/// `noon buying`. AUD, EUR, NZD and GBP (`RXI$US_N.B.*`) are published as USD per unit and stored
/// as exact inverses, keeping the published quote, so every table is USD → currency. A day of
/// `ND` only is left out; a single `ND` is a missing value. No publication time is set.
///
/// # Errors
///
/// [`Error::MalformedRates`] for a file without its label rows, a column whose series, unit,
/// multiplier or currency doesn't fit, a currency with two columns, no observations, a bad row or
/// date, two different values for one day, or an unreadable cell.
pub fn parse_fed_h10_csv(csv: &str) -> Result<Vec<RateTable>, Error> {
    let rows = csv_rows(without_bom(csv))?;
    let labelled = |label: &str| rows.iter().position(|cells| cells[0].trim() == label);
    let series_at = labelled("Time Period").ok_or(Error::MalformedRates)?;
    let width = rows[series_at].len();
    let row_of = |label: &str| -> Result<&Vec<String>, Error> {
        let row = &rows[labelled(label).ok_or(Error::MalformedRates)?];
        if row.len() == width {
            Ok(row)
        } else {
            malformed()
        }
    };
    let (currencies, multipliers, units) = (
        row_of("Currency:")?,
        row_of("Multiplier:")?,
        row_of("Unit:")?,
    );
    let mut columns: Vec<(&str, bool)> = Vec::new();
    for i in 1..width {
        let Some((country, inverted)) = series(rows[series_at][i].trim()) else {
            return malformed();
        };
        let code = currencies[i].trim();
        let expected = FED_COUNTRIES.iter().find(|(known, _)| *known == country);
        if !is_code(code)
            || code == "USD"
            || expected.is_some_and(|&(_, expected)| expected != code)
            || columns.iter().any(|(known, _)| *known == code)
            || units[i].trim() != "Currency"
            || multipliers[i].trim() != "1"
        {
            return malformed();
        }
        columns.push((code, inverted));
    }
    let observations = &rows[series_at + 1..];
    if observations.is_empty() {
        return malformed();
    }
    let mut days: Vec<(Date, DayRates)> = Vec::new();
    for cells in observations {
        if cells.len() != width {
            return malformed();
        }
        let day = calendar_day(cells[0].trim())?;
        for (i, (code, _)) in columns.iter().enumerate() {
            add_day_rate(&mut days, day, code, rate_cell(&cells[i + 1])?)?;
        }
    }
    let usd = CurrencyCode::iso("USD")?;
    let mut tables = Vec::new();
    for (day, published) in &days {
        let mut spec = QuotedTableSpec::new(
            usd,
            RateInfo {
                source: Some("FRB".into()),
                as_of: Some(Time::Date(*day)),
                rate_type: Some(RateType::from("noon buying")),
                ..RateInfo::default()
            },
        );
        let mut quoted = 0;
        for &(code, inverted) in &columns {
            let rate = published
                .iter()
                .find(|(known, _)| known == code)
                .and_then(|(_, rate)| rate.as_deref());
            quoted += usize::from(rate.is_some());
            match currency(code) {
                Some(known) => spec.rates.push((
                    known,
                    rate.map(|text| QuotedRate {
                        inverted: Some(inverted),
                        ..QuotedRate::new(text)
                    }),
                )),
                None => spec.unknown.push(code.into()),
            }
        }
        if quoted > 0 {
            tables.push(quoted_table(&spec)?);
        }
    }
    Ok(newest_first(tables))
}
