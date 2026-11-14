//! An offline parser for the Bank of England's daily spot exchange rates against sterling (ducat's
//! `@ducatjs/money/convert/boe`). Parser only: check the licence of every series you load, as
//! ducat's documentation explains (some are third parties' data).

use alloc::vec::Vec;

use super::history::{QuotedRate, QuotedTableSpec, quoted_table};
use super::rate_text::{
    DayRates, add_day_rate, any_rate, csv_rows, day_of, digits, malformed, newest_first, rate_cell,
    resolve, without_bom,
};
use super::{Date, RateInfo, RateTable, RateType, Time};
use crate::{CurrencyCode, Error};

/// The Bank's daily spot series against sterling, by code (currency units per £1).
const BOE_SERIES: [(&str, &str); 27] = [
    ("XUDLADS", "AUD"),
    ("XUDLZOS3", "BGN"),
    ("XUDLCDS", "CAD"),
    ("XUDLBK89", "CNY"),
    ("XUDLBK25", "CZK"),
    ("XUDLDKS", "DKK"),
    ("XUDLERS", "EUR"),
    ("XUDLHDS", "HKD"),
    ("XUDLBK33", "HUF"),
    ("XUDLBK97", "INR"),
    ("XUDLBK78", "ILS"),
    ("XUDLJYS", "JPY"),
    ("XUDLBK83", "MYR"),
    ("XUDLNDS", "NZD"),
    ("XUDLNKS", "NOK"),
    ("XUDLBK47", "PLN"),
    ("XUDLZOS4", "RON"),
    ("XUDLSRS", "SAR"),
    ("XUDLSGS", "SGD"),
    ("XUDLZRS", "ZAR"),
    ("XUDLBK93", "KRW"),
    ("XUDLSKS", "SEK"),
    ("XUDLSFS", "CHF"),
    ("XUDLTWS", "TWD"),
    ("XUDLBK87", "THB"),
    ("XUDLBK95", "TRY"),
    ("XUDLUSS", "USD"),
];

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// Options for [`parse_bank_of_england_csv`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BankOfEnglandOptions {
    /// The decimals the Bank publishes, rebuilt because its CSV strips trailing zeros (`1.35` for
    /// 1.3500). Default 4.
    pub decimals: u8,
}

impl Default for BankOfEnglandOptions {
    fn default() -> Self {
        Self { decimals: 4 }
    }
}

/// `22 Dec 2025`.
fn boe_day(text: &str) -> Result<Date, Error> {
    let mut parts = text.trim().split(' ');
    let (Some(day), Some(month), Some(year), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return malformed();
    };
    let month = MONTHS.iter().position(|name| *name == month);
    match (digits(day, 2), month, digits(year, 4)) {
        // two digits and a month index fit a u8
        (Some(day), Some(month), Some(year)) => day_of(year, month as u8 + 1, day as u8),
        _ => malformed(),
    }
}

/// Parses the Bank of England database's CSV of daily spot rates against sterling (series
/// `XUDL…` as column titles, dates like `22 Dec 2025`) into one GBP-based table per day, newest
/// first, with source `BoE` and type `spot`. The stripped trailing zeros are rebuilt to
/// `options.decimals`. An empty cell is a missing value. No publication time is set.
///
/// # Errors
///
/// [`Error::MalformedRates`] for a file without a `DATE` column, an unknown or repeated series, no
/// observations or no rate at all, a short row, a bad date, two different values for one day, or
/// an unreadable cell.
pub fn parse_bank_of_england_csv(
    csv: &str,
    options: &BankOfEnglandOptions,
) -> Result<Vec<RateTable>, Error> {
    let rows = csv_rows(without_bom(csv))?;
    let Some((header, body)) = rows.split_first() else {
        return malformed();
    };
    if header[0].trim() != "DATE" || header.len() < 2 {
        return malformed();
    }
    // the series table maps to codes the port knows, so a BoE file has no unknown codes
    let mut codes: Vec<&str> = Vec::new();
    for code in &header[1..] {
        let Some(&(_, iso)) = BOE_SERIES.iter().find(|(series, _)| *series == code.trim()) else {
            return malformed();
        };
        if codes.contains(&iso) {
            return malformed();
        }
        codes.push(iso);
    }
    if body.is_empty() {
        return malformed();
    }
    let mut days: Vec<(Date, DayRates)> = Vec::new();
    for cells in body {
        if cells.len() != header.len() {
            return malformed();
        }
        let day = boe_day(&cells[0])?;
        for (i, code) in codes.iter().enumerate() {
            add_day_rate(&mut days, day, code, rate_cell(&cells[i + 1])?)?;
        }
    }
    let gbp = CurrencyCode::iso("GBP")?;
    let mut tables = Vec::new();
    for (day, rates) in &days {
        if !any_rate(rates) {
            continue;
        }
        let (known, unknown) = resolve(rates);
        let mut spec = QuotedTableSpec::new(
            gbp,
            RateInfo {
                source: Some("BoE".into()),
                as_of: Some(Time::Date(*day)),
                rate_type: Some(RateType::from("spot")),
                ..RateInfo::default()
            },
        );
        spec.decimals = Some(options.decimals);
        spec.rates = known
            .into_iter()
            .map(|(code, rate)| (code, rate.map(QuotedRate::new)))
            .collect();
        spec.unknown = unknown;
        tables.push(quoted_table(&spec)?);
    }
    if tables.is_empty() {
        return malformed();
    }
    Ok(newest_first(tables))
}
