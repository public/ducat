#![doc = include_str!("../README.md")]
#![forbid(unsafe_code)]
#![warn(missing_docs)]

use std::borrow::Cow;

mod boc;
mod ecb;
mod error;
mod transport;
#[cfg(feature = "ureq")]
mod ureq;

pub use boc::{
    BANK_OF_CANADA_URL, FetchBankOfCanadaOptions, bank_of_canada_request, bank_of_canada_tables,
    fetch_bank_of_canada,
};
pub use ecb::{
    ECB_DATA_API, ECB_URLS, EcbHistory, EcbRangeRequests, EcbUrls, FetchEcbOptions,
    FetchEcbRangeOptions, ecb_range_requests, ecb_range_tables, ecb_request, ecb_tables, fetch_ecb,
    fetch_ecb_range,
};
pub use error::{Feed, FetchError};
pub use transport::{Request, Response, Transport, TransportError, TransportErrorKind};
#[cfg(feature = "ureq")]
pub use ureq::{DEFAULT_BODY_LIMIT, DEFAULT_TIMEOUT, UreqTransport};

/// The ureq this crate's [`UreqTransport`] is built on, for [`UreqTransport::from_agent`].
#[cfg(feature = "ureq")]
pub use ::ureq as ureq_crate;

/// A 2xx response, or the [`FetchError::Status`] for `request`.
fn checked(request: &Request, response: &Response) -> Result<(), FetchError> {
    if response.ok() {
        Ok(())
    } else {
        Err(FetchError::Status {
            url: request.url.clone(),
            status: response.status,
        })
    }
}

/// A 2xx response's body as text, UTF-8 with replacement characters (the platform fetch's
/// `text()`; the parsers drop a byte order mark).
fn body_of<'a>(request: &Request, response: &'a Response) -> Result<Cow<'a, str>, FetchError> {
    checked(request, response)?;
    Ok(String::from_utf8_lossy(&response.body))
}

/// A parser's result, its error with the URL the body came from.
fn parsed<T>(request: &Request, result: Result<T, ducat::Error>) -> Result<T, FetchError> {
    result.map_err(|source| FetchError::Parse {
        url: request.url.clone(),
        source,
    })
}
