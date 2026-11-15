//! The Bank of Canada's Valet API.

use ducat::convert::boc::{BankOfCanadaOptions, parse_bank_of_canada_json};
use ducat::convert::{Date, RateTable};

use crate::transport::Accept;
use crate::{Feed, FetchError, Request, Response, Transport, body_of, parsed};

/// The Bank of Canada's Valet API for its daily exchange rates (no key).
pub const BANK_OF_CANADA_URL: &str =
    "https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json";

/// Valet's first day of daily rates.
const VALET_FIRST_DAY: Date = match Date::new(2017, 1, 3) {
    Ok(day) => day,
    Err(_) => panic!("2017-01-03 is a date"),
};

/// Options for [`fetch_bank_of_canada`] (ducat's `FetchBankOfCanadaOptions`, less `signal`,
/// `timeout` and `fetch`). The default is the latest published day.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct FetchBankOfCanadaOptions {
    /// The first day (2017-01-03 at the earliest). Default: only the latest published day.
    pub start: Option<Date>,
    /// The last day (default: the latest published). Needs a `start`.
    pub end: Option<Date>,
}

/// The request [`fetch_bank_of_canada`] makes, `accept: application/json`:
/// `{BANK_OF_CANADA_URL}?recent=1` without a start, else
/// `{BANK_OF_CANADA_URL}?start_date={start}[&end_date={end}]`.
///
/// # Errors
///
/// Before any request: [`FetchError::StartTooEarly`] for a start before 2017-01-03,
/// [`FetchError::EndBeforeStart`] and [`FetchError::EndWithoutStart`].
pub fn bank_of_canada_request(options: &FetchBankOfCanadaOptions) -> Result<Request, FetchError> {
    let query = match (options.start, options.end) {
        (None, None) => "?recent=1".into(),
        (None, Some(_)) => return Err(FetchError::EndWithoutStart),
        (Some(start), _) if start < VALET_FIRST_DAY => {
            return Err(FetchError::StartTooEarly {
                feed: Feed::BankOfCanada,
                start,
                first: VALET_FIRST_DAY,
            });
        }
        (Some(start), None) => format!("?start_date={start}"),
        (Some(start), Some(end)) if end < start => {
            return Err(FetchError::EndBeforeStart { start, end });
        }
        (Some(start), Some(end)) => format!("?start_date={start}&end_date={end}"),
    };
    Ok(Request::get(
        format!("{BANK_OF_CANADA_URL}{query}"),
        Accept::Json,
    ))
}

/// The tables in the response to [`bank_of_canada_request`], parsed by
/// [`parse_bank_of_canada_json`] with its defaults: CAD-based, newest first.
///
/// # Errors
///
/// [`FetchError::Status`] for a non-2xx status, [`FetchError::Parse`] for a body that isn't
/// Valet's JSON.
pub fn bank_of_canada_tables(
    request: &Request,
    response: &Response,
) -> Result<Vec<RateTable>, FetchError> {
    let body = body_of(request, response)?;
    parsed(
        request,
        parse_bank_of_canada_json(&body, &BankOfCanadaOptions::default()),
    )
}

/// Fetches the Bank of Canada's daily exchange rates from its Valet API and parses them with
/// [`parse_bank_of_canada_json`]: CAD-based tables, newest first (ducat's `fetchBankOfCanada`).
/// Without `start`, only the latest day; without `end`, up to the latest. A range with no
/// business days in it gives no tables. The Bank asks users to keep within its request limits,
/// which it doesn't publish, and its rates are "released for statistical and analytical purposes
/// only", not for transactions.
///
/// # Errors
///
/// As [`bank_of_canada_request`] and [`bank_of_canada_tables`], and [`FetchError::Transport`].
pub fn fetch_bank_of_canada<T: Transport + ?Sized>(
    transport: &mut T,
    options: &FetchBankOfCanadaOptions,
) -> Result<Vec<RateTable>, FetchError> {
    let request = bank_of_canada_request(options)?;
    let response = request.send(transport)?;
    bank_of_canada_tables(&request, &response)
}
