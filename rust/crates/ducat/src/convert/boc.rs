//! An offline parser for the Bank of Canada's daily exchange rates from its Valet API (ducat's
//! `@ducatjs/money/convert/boc`). It takes the JSON text and never fetches.

use alloc::vec::Vec;

use super::history::{QuotedRate, QuotedTableSpec, quoted_table};
use super::json_value::{Value, parse};
use super::rate_text::{
    DayRates, add_day_rate, any_rate, calendar_day, currency, local_time, malformed, newest_first,
    publication, rate_cell, sunday,
};
use super::{Date, Publication, RateInfo, RateTable, RateType, Time};
use crate::{CurrencyCode, Error};

/// Options for [`parse_bank_of_canada_json`].
#[derive(Clone, Copy)]
pub struct BankOfCanadaOptions<'a> {
    /// When each day's rates were published. Default: [`Publication::Stated`], 16:30 Toronto
    /// time that day, when the Bank says it publishes them.
    pub available_at: Publication<'a>,
}

impl Default for BankOfCanadaOptions<'_> {
    fn default() -> Self {
        Self {
            available_at: Publication::Stated,
        }
    }
}

/// 16:30 in Toronto on `day`: EST, or EDT from the second Sunday of March to the first Sunday of
/// November (the rule since 2007, which covers Valet's rates from 2017).
fn published_by(day: Date) -> Result<Time, Error> {
    let summer = sunday(day.year(), 3, Some(2))? <= day && day < sunday(day.year(), 11, Some(1))?;
    local_time(day, 16, 30, if summer { -4 } else { -5 })
}

/// The currency of a daily `FX…CAD` series.
fn series_currency(series: &str) -> Result<CurrencyCode, Error> {
    match series
        .strip_prefix("FX")
        .and_then(|rest| rest.strip_suffix("CAD"))
    {
        Some(code) if code.len() == 3 && code.bytes().all(|byte| byte.is_ascii_uppercase()) => {
            currency(code)
        }
        _ => malformed(),
    }
}

/// Parses the Bank of Canada's daily exchange rates from the Valet API's JSON (the
/// `FX_RATES_DAILY` group, or single `FX…CAD` series) into one CAD-based table per business day,
/// newest first. The Bank quotes CAD per unit of each currency (FXUSDCAD 1.3748), so each table
/// holds the exact inverse, CAD → currency, and keeps the published quote: the rate's inverse
/// prints `1.3748` again. Rates have source `BoC` and type `average`. A series listed in
/// `seriesDetail` but absent on a day, an empty value or a null one is in that day's `missing`.
///
/// # Errors
///
/// [`Error::MalformedRates`] for anything but daily `FX…CAD` series, a bad date, a zero rate, an
/// unreadable value, two different values for one series on one day, or text that isn't JSON.
pub fn parse_bank_of_canada_json(
    json: &str,
    options: &BankOfCanadaOptions<'_>,
) -> Result<Vec<RateTable>, Error> {
    let parsed = parse(json)?;
    let Some(Value::Array(observations)) = parsed.get("observations") else {
        return malformed();
    };
    // the series the file says it has; each must be a daily FX…CAD series
    let mut expected = Vec::new();
    if let Some(Value::Object(detail)) = parsed.get("seriesDetail") {
        for (series, _) in detail {
            expected.push(series_currency(series)?);
        }
    }
    let mut days: Vec<(Date, DayRates)> = Vec::new();
    for observation in observations {
        let Some(Value::String(day_text)) = observation.get("d") else {
            return malformed();
        };
        let day = calendar_day(day_text)?;
        let Value::Object(cells) = observation else {
            return malformed();
        };
        for (series, cell) in cells {
            if series == "d" {
                continue;
            }
            let code = series_currency(series)?;
            let rate = match cell.get("v") {
                Some(Value::Null) => None,
                Some(Value::String(text)) => rate_cell(text)?,
                _ => return malformed(),
            };
            if rate.is_some_and(|text| text.bytes().all(|byte| byte == b'0' || byte == b'.')) {
                return malformed();
            }
            add_day_rate(&mut days, day, code, rate)?;
        }
        // Valet leaves out a series without a value that day
        for &code in &expected {
            let known = days
                .iter()
                .find(|(known, _)| *known == day)
                .is_some_and(|(_, rates)| rates.iter().any(|(c, _)| *c == code));
            if !known {
                add_day_rate(&mut days, day, code, None)?;
            }
        }
    }
    let cad = CurrencyCode::iso("CAD")?;
    let mut tables = Vec::new();
    for (day, rates) in &days {
        if !any_rate(rates) {
            continue;
        }
        let spec = QuotedTableSpec {
            base: Some(cad),
            info: RateInfo {
                source: Some("BoC".into()),
                as_of: Some(Time::Date(*day)),
                available_at: publication(&options.available_at, *day, published_by)?,
                rate_type: Some(RateType::from("average")),
                ..RateInfo::default()
            },
            inverted: true,
            decimals: None,
            rates: rates
                .iter()
                .map(|(code, rate)| (*code, rate.as_deref().map(QuotedRate::new)))
                .collect(),
        };
        tables.push(quoted_table(&spec)?);
    }
    Ok(newest_first(tables))
}
