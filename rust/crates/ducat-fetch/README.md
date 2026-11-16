# ducat-fetch

Fetchers for published reference rates, for [ducat](https://docs.rs/ducat): the port of ducat's
`@ducatjs/money/convert/fetch` (`fetchEcb`, `fetchEcbRange`, `fetchBankOfCanada`). It is the only crate of
the port that touches the network, and only when you call it; `ducat::convert`'s parsers, which it
uses, take text and never fetch.

- [`fetch_ecb`]: the ECB's eurofxref XML, the latest day, the last 90 days or since 1999.
- [`fetch_ecb_range`]: a date range from the ECB Data Portal's SDMX API, with the published digits.
- [`fetch_bank_of_canada`]: the Bank of Canada's Valet daily rates, the latest day or a range.
- [`ecb_snapshots`]: `ducat::convert::snapshots_from` over [`fetch_ecb`]'s file, in one call (ducat's
  `snapshotsFrom(await fetchEcb(..))`); [`ecb_day_snapshots`]: snapshots that fetch each day from
  the Data Portal as lookups ask for it, through an [`EcbDayLoader`].

Each gives `ducat::convert::RateTable`s, newest first, and fails with a [`FetchError`]: an HTTP
status, a body that can't be parsed (with the URL it came from), a transport error, or an option
refused before any request.

The ECB states that its rates are for information purposes only; the Bank of Canada's are
"released for statistical and analytical purposes only", and it asks users to keep within its
(unpublished) request limits. You decide when to fetch and how to cache.

## Blocking, with ureq

The default `ureq` feature gives [`UreqTransport`], on ureq 3 with rustls (on ring) and the Mozilla
roots. It needs no async runtime.

```rust,no_run
use std::time::Duration;

use ducat::convert::{RateProvider, RateQuery};
use ducat_fetch::{FetchEcbRangeOptions, FetchEcbOptions, UreqTransport, fetch_ecb, fetch_ecb_range};

let mut transport = UreqTransport::with_timeout(Some(Duration::from_secs(10)));
let tables = fetch_ecb(&mut transport, &FetchEcbOptions::default())?;
let latest = &tables[0];
let eur_usd = latest.rate("EUR".parse()?, "USD".parse()?, &RateQuery::default());

let range = FetchEcbRangeOptions {
    currencies: &["USD", "JPY"],
    ..FetchEcbRangeOptions::from("2026-01-01".parse()?)
};
let history = fetch_ecb_range(&mut transport, &range)?;
# Ok::<(), Box<dyn std::error::Error>>(())
```

## Your own transport

Anything that implements [`Transport`], one GET returning the status and body, can carry the
requests: a client with a proxy or retries, or a fake in a test. A closure is one:

```rust
use ducat_fetch::{FetchBankOfCanadaOptions, Response, TransportError, fetch_bank_of_canada};

let mut transport = |url: &str, headers: &[(&str, &str)]| -> Result<Response, TransportError> {
    assert_eq!(headers, [("accept", "application/json")]);
    // send it with your HTTP client; here, the Bank's answer for a holiday
    let _ = url;
    Ok(Response::new(200, r#"{"seriesDetail": {}, "observations": []}"#))
};
let tables = fetch_bank_of_canada(&mut transport, &FetchBankOfCanadaOptions::default())?;
assert!(tables.is_empty());
# Ok::<(), ducat_fetch::FetchError>(())
```

## Async, sans-IO

The fetchers are a sans-IO core driven by a transport. With an async client, build the requests
and parse the responses yourself, with no runtime or client in this crate: `ecb_request` and
`ecb_tables`, `ecb_range_requests` and `ecb_range_tables`, `bank_of_canada_request` and
`bank_of_canada_tables`. Each [`Request`] is a GET of `url` with `headers`; put your client's
timeout or cancellation around the call (ducat's `timeout` and `signal`).

```rust
use std::future::Future;

use ducat::convert::RateTable;
use ducat_fetch::{
    FetchEcbRangeOptions, FetchError, Request, Response, TransportError, ecb_range_requests,
    ecb_range_tables,
};

/// `get` is your client: with reqwest, say, `client.get(&request.url)` with each of
/// `request.headers`, then the status and `bytes()` of the response.
async fn fetch_ecb_range_async<G, F>(
    get: G,
    options: &FetchEcbRangeOptions<'_>,
) -> Result<Vec<RateTable>, FetchError>
where
    G: Fn(Request) -> F,
    F: Future<Output = Result<Response, TransportError>>,
{
    let requests = ecb_range_requests(options)?;
    let failed = |request: &Request| {
        let url = request.url.clone();
        move |source| FetchError::Transport { url, source }
    };
    // both at once, as ducat does (join them with your runtime's join!), or one after the other
    let series = get(requests.series.clone()).await.map_err(failed(&requests.series))?;
    let data = get(requests.data.clone()).await.map_err(failed(&requests.data))?;
    ecb_range_tables(&requests, &series, &data, options)
}
```

The snapshots are synchronous too: `ducat::convert::snapshots` takes a plain loader. Its
documentation shows an async loader driving it, with no runtime in either crate.

## Features

- `ureq` (default): [`UreqTransport`]. Without it the crate is the core and the [`Transport`]
  trait, with `ducat` as its only dependency.
