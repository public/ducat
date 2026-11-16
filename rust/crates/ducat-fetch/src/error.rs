//! [`FetchError`], the cases of ducat's `FetchRatesError` and of the errors its fetchers throw.

use std::error::Error as StdError;
use std::fmt;

use ducat::convert::Date;

use crate::TransportError;

/// Whose rates a request was for, in [`FetchError::StartTooEarly`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Feed {
    /// The ECB's euro reference rates (the Data Portal's EXR dataflow).
    Ecb,
    /// The Bank of Canada's Valet daily exchange rates.
    BankOfCanada,
}

/// Why a fetch failed. Its `Display` is ducat's message for the same case.
#[derive(Debug)]
#[non_exhaustive]
pub enum FetchError {
    /// The request completed without a 2xx status (ducat's `FetchRatesError`): `GET {url} failed
    /// with HTTP {status}`.
    Status {
        /// The URL requested.
        url: String,
        /// The HTTP status.
        status: u16,
    },
    /// The body isn't the format the parser reads, usually an error page (ducat's `SyntaxError`,
    /// with ` (from {url})` appended to the parser's message).
    Parse {
        /// The URL the body came from.
        url: String,
        /// The parser's error, [`ducat::Error::MalformedRates`] or one of the rate errors.
        source: ducat::Error,
    },
    /// The request got no response: the network, TLS, a timeout or a cancellation (the
    /// platform fetch's rejection, which ducat passes through).
    Transport {
        /// The URL requested.
        url: String,
        /// The transport's error.
        source: TransportError,
    },
    /// A currency to fetch isn't three ASCII capitals (ducat's `RangeError`), before any request.
    InvalidCurrency(String),
    /// `start` is before the feed's first day (ducat's `RangeError`), before any request.
    StartTooEarly {
        /// The feed.
        feed: Feed,
        /// The day asked for.
        start: Date,
        /// The feed's first day: 1999-01-04 for the ECB, 2017-01-03 for Valet.
        first: Date,
    },
    /// `end` is before `start` (ducat's `RangeError`), before any request.
    EndBeforeStart {
        /// The first day asked for.
        start: Date,
        /// The last day asked for.
        end: Date,
    },
    /// An `end` without a `start` (ducat's `RangeError`), before any request.
    EndWithoutStart,
    /// A snapshot lookup's own failure: [`ducat::Error::NoSnapshot`] when no day in the lookback
    /// has a table (ducat's `RateUnavailableError`), or [`ducat::Error::NotPositive`] for
    /// [`SnapshotOptions`](ducat::convert::SnapshotOptions) with a `max` of 0 (ducat's
    /// `RangeError`), before any request.
    Snapshot(ducat::Error),
}

/// A snapshot lookup's own failure, [`FetchError::Snapshot`].
impl From<ducat::Error> for FetchError {
    fn from(error: ducat::Error) -> Self {
        Self::Snapshot(error)
    }
}

impl FetchError {
    /// The HTTP status, for [`FetchError::Status`].
    #[must_use]
    pub const fn status(&self) -> Option<u16> {
        match self {
            Self::Status { status, .. } => Some(*status),
            _ => None,
        }
    }

    /// The URL of the request that failed, for the errors that come after a request.
    #[must_use]
    pub fn url(&self) -> Option<&str> {
        match self {
            Self::Status { url, .. } | Self::Parse { url, .. } | Self::Transport { url, .. } => {
                Some(url)
            }
            _ => None,
        }
    }
}

impl fmt::Display for FetchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Status { url, status } => write!(f, "GET {url} failed with HTTP {status}"),
            Self::Parse { url, source } => write!(f, "{source} (from {url})"),
            Self::Transport { url, source } => write!(f, "GET {url}: {source}"),
            Self::InvalidCurrency(code) => write!(f, "Not an ISO currency code: {code}"),
            Self::StartTooEarly { feed, start, first } => match feed {
                Feed::Ecb => write!(f, "The ECB's rates start on {first}, not {start}"),
                Feed::BankOfCanada => {
                    write!(f, "Valet's daily rates start on {first}, not {start}")
                }
            },
            Self::EndBeforeStart { start, end } => write!(f, "end {end} is before start {start}"),
            Self::EndWithoutStart => f.write_str("end needs a start"),
            Self::Snapshot(error) => write!(f, "{error}"),
        }
    }
}

impl StdError for FetchError {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        match self {
            Self::Parse { source, .. } => Some(source),
            Self::Transport { source, .. } => Some(source),
            Self::Snapshot(error) => Some(error),
            _ => None,
        }
    }
}
