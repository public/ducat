//! The ECB's eurofxref files and the ECB Data Portal's SDMX API.

use ducat::convert::ecb::{
    EcbOptions, EcbSdmxOptions, parse_ecb_sdmx_csv, parse_ecb_sdmx_decimals, parse_ecb_xml,
};
use ducat::convert::{Date, Publication, RateTable};

use crate::transport::Accept;
use crate::{Feed, FetchError, Request, Response, Transport, body_of, checked, parsed};

/// The URLs of the ECB's eurofxref files (ducat's `ECB_URLS`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub struct EcbUrls {
    /// The latest day.
    pub daily: &'static str,
    /// The last 90 days (ducat's `'90d'`).
    pub ninety_days: &'static str,
    /// Every day since 1999 (ducat's `all`; several MB).
    pub all: &'static str,
}

/// The ECB's eurofxref files: the latest day, the last 90 days, and the full history since 1999.
pub const ECB_URLS: EcbUrls = EcbUrls {
    daily: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
    ninety_days: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml",
    all: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml",
};

/// The ECB Data Portal's SDMX REST API (no key).
pub const ECB_DATA_API: &str = "https://data-api.ecb.europa.eu/service/data/EXR";

/// The ECB's first day of reference rates.
const ECB_FIRST_DAY: Date = match Date::new(1999, 1, 4) {
    Ok(day) => day,
    Err(_) => panic!("1999-01-04 is a date"),
};

/// Which eurofxref file [`fetch_ecb`] reads (ducat's `history` option).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum EcbHistory {
    /// The latest day (ducat's default, `'daily'`).
    #[default]
    Daily,
    /// The last 90 days (`'90d'`).
    NinetyDays,
    /// Every day since 1999 (`'all'`; several MB).
    All,
}

impl EcbHistory {
    /// The file's URL, from [`ECB_URLS`].
    #[must_use]
    pub const fn url(self) -> &'static str {
        match self {
            Self::Daily => ECB_URLS.daily,
            Self::NinetyDays => ECB_URLS.ninety_days,
            Self::All => ECB_URLS.all,
        }
    }
}

/// Options for [`fetch_ecb`] (ducat's `FetchEcbOptions`, less `signal`, `timeout` and `fetch`,
/// which are the transport's).
#[derive(Clone, Copy, Debug, Default)]
pub struct FetchEcbOptions<'a> {
    /// Which file: the latest day (default), the last 90 days, or since 1999.
    pub history: EcbHistory,
    /// When each day's rates became available, passed to the parser
    /// ([`EcbOptions::available_at`]; [`Publication::Stated`] is the ECB's 16:00 CET).
    pub available_at: Publication<'a>,
}

/// The request [`fetch_ecb`] makes: a GET of the [`EcbHistory`] file, `accept: application/xml`.
#[must_use]
pub fn ecb_request(options: &FetchEcbOptions<'_>) -> Request {
    Request::get(options.history.url().into(), Accept::Xml)
}

/// The tables in the response to [`ecb_request`]: EUR-based, newest first, parsed by
/// [`parse_ecb_xml`].
///
/// # Errors
///
/// [`FetchError::Status`] for a non-2xx status (404 included), [`FetchError::Parse`] for a body
/// that isn't an ECB reference rate file.
pub fn ecb_tables(
    request: &Request,
    response: &Response,
    options: &FetchEcbOptions<'_>,
) -> Result<Vec<RateTable>, FetchError> {
    let body = body_of(request, response)?;
    let parse_options = EcbOptions {
        available_at: options.available_at,
    };
    parsed(request, parse_ecb_xml(&body, &parse_options))
}

/// Fetches the ECB euro reference rates and parses them with [`parse_ecb_xml`]: EUR-based
/// tables, newest first (ducat's `fetchEcb`). The ECB publishes once per TARGET working day at
/// about 16:00 CET and states that its rates are for information purposes only.
///
/// # Errors
///
/// As [`ecb_tables`], and [`FetchError::Transport`] when the request gets no response.
pub fn fetch_ecb<T: Transport + ?Sized>(
    transport: &mut T,
    options: &FetchEcbOptions<'_>,
) -> Result<Vec<RateTable>, FetchError> {
    let request = ecb_request(options);
    let response = request.send(transport)?;
    ecb_tables(&request, &response, options)
}

/// Options for [`fetch_ecb_range`] (ducat's `FetchEcbRangeOptions`, less `signal`, `timeout` and
/// `fetch`).
#[derive(Clone, Copy, Debug)]
pub struct FetchEcbRangeOptions<'a> {
    /// The first day (1999-01-04 at the earliest).
    pub start: Date,
    /// The last day (default: the latest published).
    pub end: Option<Date>,
    /// ISO codes to fetch, three ASCII capitals each (empty, the default: every currency,
    /// discontinued series included).
    pub currencies: &'a [&'a str],
    /// As [`FetchEcbOptions::available_at`].
    pub available_at: Publication<'a>,
}

impl FetchEcbRangeOptions<'_> {
    /// From `start` to the latest day, every currency.
    #[must_use]
    pub const fn from(start: Date) -> Self {
        Self {
            start,
            end: None,
            currencies: &[],
            available_at: Publication::Unknown,
        }
    }
}

/// The two requests [`fetch_ecb_range`] makes, in the order ducat starts them.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub struct EcbRangeRequests {
    /// The series without observations (`detail=nodata`), for each series' DECIMALS.
    pub series: Request,
    /// The observations without attributes (`detail=dataonly`).
    pub data: Request,
}

/// The requests [`fetch_ecb_range`] makes, both `accept: text/csv`:
///
/// - `{ECB_DATA_API}/D.{currencies joined by +}.EUR.SP00.A?format=csvdata&detail=nodata`
/// - `{ECB_DATA_API}/D.{currencies}.EUR.SP00.A?format=csvdata&startPeriod={start}[&endPeriod={end}]&detail=dataonly`
///
/// # Errors
///
/// Before any request: [`FetchError::InvalidCurrency`] for a code that isn't three ASCII
/// capitals, [`FetchError::StartTooEarly`] for a start before 1999-01-04, and
/// [`FetchError::EndBeforeStart`].
pub fn ecb_range_requests(
    options: &FetchEcbRangeOptions<'_>,
) -> Result<EcbRangeRequests, FetchError> {
    for currency in options.currencies {
        if !(currency.len() == 3 && currency.bytes().all(|byte| byte.is_ascii_uppercase())) {
            return Err(FetchError::InvalidCurrency((*currency).into()));
        }
    }
    let start = options.start;
    if start < ECB_FIRST_DAY {
        return Err(FetchError::StartTooEarly {
            feed: Feed::Ecb,
            start,
            first: ECB_FIRST_DAY,
        });
    }
    let mut query = format!("?format=csvdata&startPeriod={start}");
    if let Some(end) = options.end {
        if end < start {
            return Err(FetchError::EndBeforeStart { start, end });
        }
        query = format!("{query}&endPeriod={end}");
    }
    let url = format!("{ECB_DATA_API}/D.{}.EUR.SP00.A", options.currencies.join("+"));
    Ok(EcbRangeRequests {
        series: Request::get(format!("{url}?format=csvdata&detail=nodata"), Accept::Csv),
        data: Request::get(format!("{url}{query}&detail=dataonly"), Accept::Csv),
    })
}

/// The tables in the responses to [`ecb_range_requests`]: the observations parsed by
/// [`parse_ecb_sdmx_csv`] with the series' DECIMALS, EUR-based, newest first. A 404 for the data
/// is the API's "no results" (a weekend, or a range after the latest day): no tables.
///
/// # Errors
///
/// [`FetchError::Status`] for a non-2xx series response, or a non-2xx data response other than
/// 404 (the series' first); [`FetchError::Parse`] for a body that can't be read.
pub fn ecb_range_tables(
    requests: &EcbRangeRequests,
    series: &Response,
    data: &Response,
    options: &FetchEcbRangeOptions<'_>,
) -> Result<Vec<RateTable>, FetchError> {
    let series_body = body_of(&requests.series, series)?;
    if data.status == 404 {
        return Ok(Vec::new());
    }
    let data_body = body_of(&requests.data, data)?;
    let decimals = parsed(&requests.series, parse_ecb_sdmx_decimals(&series_body))?;
    let parse_options = EcbSdmxOptions {
        available_at: options.available_at,
        decimals: &decimals,
    };
    parsed(&requests.data, parse_ecb_sdmx_csv(&data_body, &parse_options))
}

/// Fetches a date range of ECB euro reference rates from the ECB Data Portal and parses them with
/// [`parse_ecb_sdmx_csv`]: EUR-based tables, one per TARGET working day, newest first, with the
/// published digits (ducat's `fetchEcbRange`). It makes two requests, one after the other: the
/// series' DECIMALS (small), then the observations without attributes, which keeps the full
/// history since 1999 to about 15 MB. If the first fails, the second isn't made. Give a few days
/// before the first day you need, so that a lookback from it has a table to fall back on. A range
/// with no rates gives no tables. The ECB states that its rates are for information purposes
/// only.
///
/// # Errors
///
/// As [`ecb_range_requests`] and [`ecb_range_tables`], and [`FetchError::Transport`].
pub fn fetch_ecb_range<T: Transport + ?Sized>(
    transport: &mut T,
    options: &FetchEcbRangeOptions<'_>,
) -> Result<Vec<RateTable>, FetchError> {
    let requests = ecb_range_requests(options)?;
    let series = requests.series.send(transport)?;
    // ducat's Promise.all fails on the series' status whatever the data does
    checked(&requests.series, &series)?;
    let data = requests.data.send(transport)?;
    ecb_range_tables(&requests, &series, &data, options)
}
