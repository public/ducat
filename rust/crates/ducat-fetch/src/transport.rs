//! The requests the fetchers make, the responses they read, and the [`Transport`] that carries
//! them.

use std::error::Error as StdError;
use std::fmt;

/// One HTTP request a fetcher needs: always a GET, with the URL (and its query) and the headers
/// ducat's `fetch.ts` sends, in its order.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub struct Request {
    /// The URL with its query, exactly as ducat builds it.
    pub url: String,
    /// The headers to send: an `accept` header naming the format the parser reads.
    pub headers: &'static [(&'static str, &'static str)],
}

impl Request {
    /// The HTTP method, `GET` for every request here.
    pub const METHOD: &'static str = "GET";

    pub(crate) fn get(url: String, accept: Accept) -> Self {
        Self {
            url,
            headers: accept.headers(),
        }
    }

    /// Sends the request through `transport`.
    ///
    /// # Errors
    ///
    /// [`FetchError::Transport`](crate::FetchError::Transport) when the transport fails (a
    /// network error, a timeout).
    pub fn send<T: Transport + ?Sized>(
        &self,
        transport: &mut T,
    ) -> Result<Response, crate::FetchError> {
        transport
            .get(&self.url, self.headers)
            .map_err(|source| crate::FetchError::Transport {
                url: self.url.clone(),
                source,
            })
    }
}

/// The `accept` header of each format, as `fetch.ts` sends it.
#[derive(Clone, Copy)]
pub(crate) enum Accept {
    Xml,
    Csv,
    Json,
}

impl Accept {
    const fn headers(self) -> &'static [(&'static str, &'static str)] {
        match self {
            Self::Xml => &[("accept", "application/xml")],
            Self::Csv => &[("accept", "text/csv")],
            Self::Json => &[("accept", "application/json")],
        }
    }
}

/// What came back: the HTTP status and the body's bytes. A non-2xx status is a response, not a
/// transport error; the fetchers turn it into [`FetchError::Status`](crate::FetchError::Status).
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct Response {
    /// The HTTP status code.
    pub status: u16,
    /// The body, undecoded. It is read as UTF-8 with replacement characters, as the platform
    /// fetch's `text()` reads it.
    pub body: Vec<u8>,
}

impl Response {
    /// A response with `status` and `body`.
    pub fn new(status: u16, body: impl Into<Vec<u8>>) -> Self {
        Self {
            status,
            body: body.into(),
        }
    }

    /// Whether the status is 2xx (the platform fetch's `ok`).
    #[must_use]
    pub const fn ok(&self) -> bool {
        self.status >= 200 && self.status < 300
    }
}

/// Carries one GET: blocking, or the caller's own way of making requests. Timeouts, retries,
/// proxies and cancellation are the transport's: `fetch.ts`'s `timeout` and `signal` options
/// have no counterpart in the fetchers.
///
/// Any `FnMut(&str, &[(&str, &str)]) -> Result<Response, TransportError>` is a transport, which
/// is how a test fakes one:
///
/// ```
/// use ducat_fetch::{FetchEcbOptions, Response, TransportError, fetch_ecb};
///
/// let mut seen = Vec::new();
/// let mut transport = |url: &str, headers: &[(&str, &str)]| {
///     let headers: Vec<String> = headers.iter().map(|(name, value)| format!("{name}: {value}")).collect();
///     seen.push((url.to_owned(), headers));
///     Ok::<_, TransportError>(Response::new(503, ""))
/// };
/// let error = fetch_ecb(&mut transport, &FetchEcbOptions::default()).unwrap_err();
/// assert_eq!(error.status(), Some(503));
/// assert_eq!(seen[0].1, ["accept: application/xml"]);
/// ```
pub trait Transport {
    /// GETs `url` with `headers`, following redirects as a browser would, and returns the final
    /// status and body whatever the status.
    ///
    /// # Errors
    ///
    /// A [`TransportError`] when there is no response: the connection, TLS or a timeout failed.
    fn get(&mut self, url: &str, headers: &[(&str, &str)]) -> Result<Response, TransportError>;
}

impl<F> Transport for F
where
    F: FnMut(&str, &[(&str, &str)]) -> Result<Response, TransportError>,
{
    fn get(&mut self, url: &str, headers: &[(&str, &str)]) -> Result<Response, TransportError> {
        self(url, headers)
    }
}

/// What kind of failure a [`TransportError`] is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum TransportErrorKind {
    /// The transport's timeout elapsed (`fetch.ts`'s `TimeoutError`).
    Timeout,
    /// The request was cancelled (`fetch.ts`'s `AbortError`).
    Cancelled,
    /// Anything else: DNS, the connection, TLS, a body over the transport's limit.
    Other,
}

/// A request that got no response (the platform fetch's rejection).
#[derive(Debug)]
pub struct TransportError {
    kind: TransportErrorKind,
    source: Box<dyn StdError + Send + Sync>,
}

impl TransportError {
    /// A transport error of `kind`, caused by `source` (an error, or a message).
    pub fn new(
        kind: TransportErrorKind,
        source: impl Into<Box<dyn StdError + Send + Sync>>,
    ) -> Self {
        Self {
            kind,
            source: source.into(),
        }
    }

    /// An [`TransportErrorKind::Other`] error.
    pub fn other(source: impl Into<Box<dyn StdError + Send + Sync>>) -> Self {
        Self::new(TransportErrorKind::Other, source)
    }

    /// What kind of failure it is.
    #[must_use]
    pub const fn kind(&self) -> TransportErrorKind {
        self.kind
    }

    /// Whether the transport's timeout elapsed.
    #[must_use]
    pub fn is_timeout(&self) -> bool {
        self.kind == TransportErrorKind::Timeout
    }

    /// The underlying error.
    pub fn into_inner(self) -> Box<dyn StdError + Send + Sync> {
        self.source
    }
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.kind {
            TransportErrorKind::Timeout => write!(f, "timed out: {}", self.source),
            TransportErrorKind::Cancelled => write!(f, "cancelled: {}", self.source),
            TransportErrorKind::Other => fmt::Display::fmt(&self.source, f),
        }
    }
}

impl StdError for TransportError {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        Some(&*self.source)
    }
}
