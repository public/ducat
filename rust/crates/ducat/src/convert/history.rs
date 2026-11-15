//! Rates as central banks publish them (the other way round, per 100 units, with stripped digits)
//! and dated tables over a range, with lookups that say why they fell back (ducat's
//! `@ducatjs/money/convert/history`).

use alloc::string::String;
use alloc::vec::Vec;

use super::rate_text::{is_plain_decimal, with_decimals};
use super::{AnyRate, Date, RateInfo, RateProvider, RateQuery, RateQuote, RateTable};
use crate::{CurrencyCode, Error};

/// A rate from one published quote: `per` units and the direction are applied exactly, and the
/// quote is kept on the rate (`per` 1 and `inverted` false stored as left out).
///
/// ```
/// use ducat::convert::history::rate_from_quote;
/// use ducat::convert::{RateInfo, RateQuote};
///
/// let quote = RateQuote { rate: "6.50".into(), per: Some(100), inverted: false };
/// let jpy_nok = rate_from_quote("JPY".parse()?, "NOK".parse()?, &quote, RateInfo::default())?;
/// assert_eq!(jpy_nok.to_string(), "0.065");
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::InvalidQuote`] for a quote that isn't a plain decimal (`1.1650`) or isn't positive,
/// or a `per` below 1.
pub fn rate_from_quote(
    from: CurrencyCode,
    to: CurrencyCode,
    quote: &RateQuote,
    info: RateInfo,
) -> Result<AnyRate, Error> {
    if !is_plain_decimal(&quote.rate) {
        return Err(Error::InvalidQuote);
    }
    let kept = RateQuote {
        rate: quote.rate.clone(),
        per: quote.per.filter(|&per| per != 1),
        inverted: quote.inverted,
    };
    let exact = kept.describes()?;
    AnyRate::new(from, to, exact)?.with_info(RateInfo {
        quote: Some(kept),
        ..info
    })
}

/// One published rate in a quoted table.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct QuotedRate {
    /// The rate as published, a decimal string.
    pub rate: String,
    /// How many units the published number is for: of the base, or of the currency when the rate
    /// is inverted.
    pub per: Option<i64>,
    /// Published as base per unit of the currency; `None` takes the table's.
    pub inverted: Option<bool>,
    /// The decimals the source publishes, for feeds that strip trailing zeros; `None` takes the
    /// table's.
    pub decimals: Option<u8>,
}

impl QuotedRate {
    /// A rate published as `rate`, with the table's direction and decimals.
    #[must_use]
    pub fn new(rate: &str) -> Self {
        Self {
            rate: rate.into(),
            ..Self::default()
        }
    }
}

/// A one-base table of published quotes: ducat's `QuotedTableSpec`.
#[derive(Clone, Debug)]
pub struct QuotedTableSpec {
    /// The base currency.
    pub base: CurrencyCode,
    /// The table's metadata, which every rate gets too (its quote isn't used).
    pub info: RateInfo,
    /// Every rate is published as base per unit of the currency, unless its entry says otherwise.
    pub inverted: bool,
    /// The decimals every rate is published with, unless its entry says otherwise.
    pub decimals: Option<u8>,
    /// The rates in order; `None` for a currency listed without a value.
    pub rates: Vec<(CurrencyCode, Option<QuotedRate>)>,
    /// Codes the source listed that aren't currencies the port knows (see
    /// [`RateTable::unknown`]).
    pub unknown: Vec<String>,
}

impl QuotedTableSpec {
    /// A table of `base` with `info`, its rates published in its own direction and with all their
    /// digits.
    #[must_use]
    pub const fn new(base: CurrencyCode, info: RateInfo) -> Self {
        Self {
            base,
            info,
            inverted: false,
            decimals: None,
            rates: Vec::new(),
            unknown: Vec::new(),
        }
    }
}

/// A table from rates as a source published them: each is stored exactly in the table's
/// direction, base → currency, and keeps its quote. ducat's `quotedTable`.
///
/// # Errors
///
/// As [`rate_from_quote`]; [`Error::InvalidDecimals`] for more than 30 decimals.
pub fn quoted_table(spec: &QuotedTableSpec) -> Result<RateTable, Error> {
    let base = spec.base;
    let info = RateInfo {
        quote: None,
        ..spec.info.clone()
    };
    let mut builder = RateTable::with_base(base, info.clone());
    for (currency, entry) in &spec.rates {
        builder = match entry {
            None => builder.missing(*currency),
            Some(quoted) => {
                let mut text = String::from(quoted.rate.trim());
                if let Some(decimals) = quoted.decimals.or(spec.decimals) {
                    text = with_decimals(&text, decimals)?;
                }
                let quote = RateQuote {
                    rate: text,
                    per: quoted.per,
                    inverted: quoted.inverted.unwrap_or(spec.inverted),
                };
                builder.entry(
                    *currency,
                    rate_from_quote(base, *currency, &quote, info.clone())?,
                )?
            }
        };
    }
    for code in &spec.unknown {
        builder = builder.unknown(code);
    }
    Ok(builder.build())
}

/// Why a lookup passed over a day.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FallbackReason {
    /// No table that day: a weekend or holiday.
    NoTable,
    /// The table wasn't published yet at the time asked for.
    NotYetAvailable,
    /// Its period is over.
    Expired,
    /// The source listed the currency without a value.
    Missing,
    /// The pair isn't in the table.
    NotQuoted,
}

impl FallbackReason {
    /// The reason's name, as ducat writes it (`noTable`).
    #[must_use]
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::NoTable => "noTable",
            Self::NotYetAvailable => "notYetAvailable",
            Self::Expired => "expired",
            Self::Missing => "missing",
            Self::NotQuoted => "notQuoted",
        }
    }
}

/// A day a lookup passed over, and why.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Fallback {
    /// The day.
    pub day: Date,
    /// Why.
    pub reason: FallbackReason,
}

/// A rate lookup with its reasons: the rate, if any, and the days passed over, newest first.
#[derive(Clone, Debug)]
pub struct RateLookup {
    /// The rate.
    pub rate: Option<AnyRate>,
    /// The days passed over before the answer (or before giving up), newest first.
    pub skipped: Vec<Fallback>,
}

/// Dated tables held in memory, answering any day: ducat's `rateHistory`.
///
/// A lookup takes the latest table at or before `as_of` that has the pair, was published by then
/// and is still valid, looking back up to `lookback` days. Each pair falls back on its own, so a
/// currency missing on a holiday comes from the day before. A table with a `valid_until` answers
/// its whole period whatever the lookback. Without an `as_of`, the newest table with the pair
/// answers.
#[derive(Clone, Debug)]
pub struct RateHistory {
    tables: Vec<(Date, RateTable)>,
    lookback: u32,
    has_periods: bool,
}

/// A history over `tables`, looking back `lookback` days (ducat's default is 4, which covers Good
/// Friday to Easter Monday).
///
/// # Errors
///
/// [`Error::UndatedTable`] for a table without an `as_of` (ducat's `RangeError`). `lookback` is
/// a `u32`, so ducat's other check, a non-negative integer lookback, can't fail here.
pub fn rate_history(
    tables: impl IntoIterator<Item = RateTable>,
    lookback: u32,
) -> Result<RateHistory, Error> {
    let mut dated = tables
        .into_iter()
        .map(|table| Ok((table.as_of().ok_or(Error::UndatedTable)?.day(), table)))
        .collect::<Result<Vec<_>, Error>>()?;
    // newest first; a stable sort keeps the caller's order within a day
    dated.sort_by_key(|entry| core::cmp::Reverse(entry.0));
    let has_periods = dated.iter().any(|(_, table)| table.valid_until().is_some());
    Ok(RateHistory {
        tables: dated,
        lookback,
        has_periods,
    })
}

fn before(day: Date, count: i64) -> Date {
    // stepping back past 0000-01-01 stops there
    day.add_days(-count)
        .unwrap_or_else(|_| Date::new(0, 1, 1).unwrap_or(day))
}

/// Why a table can't answer the pair at the time asked for, or `None` when it can.
fn pass_over(
    table: &RateTable,
    from: CurrencyCode,
    to: CurrencyCode,
    query: &RateQuery,
    period_ended: bool,
) -> Option<FallbackReason> {
    if period_ended {
        return Some(FallbackReason::Expired);
    }
    if let (Some(at), Some(available_at)) = (&query.as_of, table.available_at()) {
        if !available_at.has_started_by(at) {
            return Some(FallbackReason::NotYetAvailable);
        }
    }
    if table.rate(from, to, query).is_some() {
        return None;
    }
    if table.missing().contains(&from) || table.missing().contains(&to) {
        return Some(FallbackReason::Missing);
    }
    let held = table
        .rates()
        .iter()
        .find(|rate| rate.from() == from && rate.to() == to);
    if let (Some(held), Some(at)) = (held, &query.as_of) {
        if held.is_expired(at) {
            return Some(FallbackReason::Expired);
        }
        if !held.is_available(at) {
            return Some(FallbackReason::NotYetAvailable);
        }
    }
    Some(FallbackReason::NotQuoted)
}

impl RateHistory {
    /// The tables, newest first.
    pub fn tables(&self) -> impl ExactSizeIterator<Item = &RateTable> {
        self.tables.iter().map(|(_, table)| table)
    }

    /// The lookup [`RateProvider::rate`] makes, with the days it passed over and why.
    #[must_use]
    pub fn lookup(&self, from: CurrencyCode, to: CurrencyCode, query: &RateQuery) -> RateLookup {
        let mut skipped = Vec::new();
        let first = match (&query.as_of, self.tables.first()) {
            (Some(at), _) => at.day(),
            (None, Some((day, _))) => *day,
            (None, None) => {
                return RateLookup {
                    rate: None,
                    skipped,
                };
            }
        };
        let last = before(first, i64::from(self.lookback));
        // the newest day of the window not yet accounted for by a daily table
        let mut expected = first;
        let gap = |from_day: Date, until: Date, skipped: &mut Vec<Fallback>| {
            let mut day = from_day;
            while day > until {
                skipped.push(Fallback {
                    day,
                    reason: FallbackReason::NoTable,
                });
                day = before(day, 1);
            }
        };
        for (day, table) in &self.tables {
            let day = *day;
            if day > first {
                continue;
            }
            let period_ended = match (&query.as_of, table.valid_until()) {
                (Some(at), Some(valid_until)) => valid_until.has_ended_at(at),
                _ => false,
            };
            let covers_period = table.valid_until().is_some() && !period_ended;
            if day < last && !covers_period {
                if !self.has_periods {
                    break;
                }
                continue;
            }
            // a period table that answers covers the days without a table, so they count only once
            // it turns out not to answer
            let in_window = day >= last;
            let accounted_to = if in_window { day } else { before(last, 1) };
            let mut gaps = Vec::new();
            gap(expected, accounted_to, &mut gaps);
            if !covers_period {
                skipped.append(&mut gaps);
            }
            match pass_over(table, from, to, query, period_ended) {
                None => {
                    return RateLookup {
                        rate: table.rate(from, to, query),
                        skipped,
                    };
                }
                Some(reason) => {
                    skipped.append(&mut gaps);
                    skipped.push(Fallback { day, reason });
                }
            }
            if accounted_to <= expected {
                expected = if in_window {
                    before(day, 1)
                } else {
                    accounted_to
                };
            }
        }
        // days left in the window without any table
        let mut day = expected;
        while day >= last {
            skipped.push(Fallback {
                day,
                reason: FallbackReason::NoTable,
            });
            if day == last {
                break;
            }
            day = before(day, 1);
        }
        RateLookup {
            rate: None,
            skipped,
        }
    }
}

impl RateProvider for RateHistory {
    fn rate(&self, from: CurrencyCode, to: CurrencyCode, query: &RateQuery) -> Option<AnyRate> {
        self.lookup(from, to, query).rate
    }
}
