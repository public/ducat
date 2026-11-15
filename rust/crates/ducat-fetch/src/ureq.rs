//! [`UreqTransport`], a blocking transport on ureq with rustls (on ring).

use std::time::Duration;

use crate::{Response, Transport, TransportError, TransportErrorKind};

/// The default timeout for a whole request, connection to last byte, as ducat's default.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// The default limit on a body: the ECB's full SDMX history is about 15 MB, its full eurofxref
/// XML a few MB.
pub const DEFAULT_BODY_LIMIT: u64 = 64 * 1024 * 1024;

/// A blocking HTTPS [`Transport`] on a [`ureq::Agent`], with rustls on ring and the Mozilla
/// roots (webpki-roots). It follows redirects, and returns every status as a response.
///
/// ```no_run
/// use ducat_fetch::{FetchEcbOptions, UreqTransport, fetch_ecb};
///
/// let mut transport = UreqTransport::new();
/// let tables = fetch_ecb(&mut transport, &FetchEcbOptions::default())?;
/// # Ok::<(), ducat_fetch::FetchError>(())
/// ```
#[derive(Clone, Debug)]
pub struct UreqTransport {
    agent: ureq::Agent,
    body_limit: u64,
}

impl UreqTransport {
    /// A transport with a 30-second timeout per request ([`DEFAULT_TIMEOUT`]).
    #[must_use]
    pub fn new() -> Self {
        Self::with_timeout(Some(DEFAULT_TIMEOUT))
    }

    /// A transport with `timeout` per request, connection to last byte (`None`: no timeout,
    /// ducat's `timeout: 0`).
    #[must_use]
    pub fn with_timeout(timeout: Option<Duration>) -> Self {
        let agent = ureq::Agent::config_builder()
            .timeout_global(timeout)
            .http_status_as_error(false)
            .build()
            .new_agent();
        Self::from_agent(agent)
    }

    /// A transport on the caller's agent, for a proxy, other timeouts or other TLS roots. Its
    /// `http_status_as_error` may be either: a status error becomes a response with an empty
    /// body.
    #[must_use]
    pub const fn from_agent(agent: ureq::Agent) -> Self {
        Self {
            agent,
            body_limit: DEFAULT_BODY_LIMIT,
        }
    }

    /// The largest body read, in bytes ([`DEFAULT_BODY_LIMIT`] unless set); a longer one is a
    /// [`TransportError`].
    #[must_use]
    pub const fn body_limit(mut self, bytes: u64) -> Self {
        self.body_limit = bytes;
        self
    }

    /// The agent.
    #[must_use]
    pub const fn agent(&self) -> &ureq::Agent {
        &self.agent
    }
}

impl Default for UreqTransport {
    fn default() -> Self {
        Self::new()
    }
}

fn transport_error(error: ureq::Error) -> TransportError {
    let kind = match error {
        ureq::Error::Timeout(_) => TransportErrorKind::Timeout,
        _ => TransportErrorKind::Other,
    };
    TransportError::new(kind, error)
}

impl Transport for UreqTransport {
    fn get(&mut self, url: &str, headers: &[(&str, &str)]) -> Result<Response, TransportError> {
        let mut request = self.agent.get(url);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        match request.call() {
            Ok(mut response) => {
                let status = response.status().as_u16();
                let body = response
                    .body_mut()
                    .with_config()
                    .limit(self.body_limit)
                    .read_to_vec()
                    .map_err(transport_error)?;
                Ok(Response { status, body })
            }
            Err(ureq::Error::StatusCode(status)) => Ok(Response::new(status, Vec::new())),
            Err(error) => Err(transport_error(error)),
        }
    }
}
