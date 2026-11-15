//! The fetchers against a recording fake transport and the fixtures ducat's own fetch tests read
//! (`spec/fixtures/`): the requests, byte for byte as `src/fetch.ts` sends them, and the tables
//! and errors that come back. No network.

use std::error::Error as _;
use std::path::PathBuf;

use ducat::convert::{Date, Publication, RateProvider, RateQuery, RateTable};
use ducat_fetch::{
    BANK_OF_CANADA_URL, ECB_DATA_API, ECB_URLS, EcbHistory, Feed, FetchBankOfCanadaOptions,
    FetchEcbOptions, FetchEcbRangeOptions, FetchError, Request, Response, Transport,
    TransportError, TransportErrorKind, bank_of_canada_request, bank_of_canada_tables,
    ecb_range_requests, ecb_range_tables, ecb_request, ecb_tables, fetch_bank_of_canada, fetch_ecb,
    fetch_ecb_range,
};

fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../spec/fixtures")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn day(text: &str) -> Date {
    text.parse().unwrap()
}

/// A request as the fake saw it: the URL and the headers, owned.
type Call = (String, Vec<(String, String)>);

/// Answers every GET with `respond(url)` and records it.
struct Fake<R> {
    respond: R,
    calls: Vec<Call>,
}

fn fake<R: FnMut(&str) -> Result<Response, TransportError>>(respond: R) -> Fake<R> {
    Fake {
        respond,
        calls: Vec::new(),
    }
}

impl<R: FnMut(&str) -> Result<Response, TransportError>> Transport for Fake<R> {
    fn get(&mut self, url: &str, headers: &[(&str, &str)]) -> Result<Response, TransportError> {
        let headers = headers
            .iter()
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect();
        self.calls.push((url.to_owned(), headers));
        (self.respond)(url)
    }
}

fn call(url: &str, accept: &str) -> Call {
    (
        url.to_owned(),
        vec![("accept".to_owned(), accept.to_owned())],
    )
}

fn rate(table: &RateTable, from: &str, to: &str) -> String {
    table
        .rate(
            from.parse().unwrap(),
            to.parse().unwrap(),
            &RateQuery::default(),
        )
        .unwrap()
        .to_string()
}

mod ecb {
    use super::*;

    #[test]
    fn urls_are_ducats() {
        assert_eq!(
            ECB_URLS.daily,
            "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
        );
        assert_eq!(
            ECB_URLS.ninety_days,
            "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"
        );
        assert_eq!(
            ECB_URLS.all,
            "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml"
        );
        assert_eq!(
            ECB_DATA_API,
            "https://data-api.ecb.europa.eu/service/data/EXR"
        );
    }

    #[test]
    fn fetches_and_parses_the_daily_file() {
        let mut transport = fake(|_| Ok(Response::new(200, fixture("ecb/eurofxref-daily.xml"))));
        let tables = fetch_ecb(&mut transport, &FetchEcbOptions::default()).unwrap();
        assert_eq!(
            transport.calls,
            [call(
                "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
                "application/xml"
            )]
        );
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].as_of().unwrap().to_string(), "2026-11-06");
        assert_eq!(rate(&tables[0], "EUR", "USD"), "1.1165");
        // availableAt left out: unknown
        assert_eq!(tables[0].available_at(), None);
    }

    #[test]
    fn history_picks_the_file() {
        let mut transport = fake(|_| Ok(Response::new(200, fixture("ecb/eurofxref-hist-2d.xml"))));
        for (history, url) in [
            (EcbHistory::Daily, ECB_URLS.daily),
            (EcbHistory::NinetyDays, ECB_URLS.ninety_days),
            (EcbHistory::All, ECB_URLS.all),
        ] {
            let options = FetchEcbOptions {
                history,
                ..FetchEcbOptions::default()
            };
            assert_eq!(history.url(), url);
            let tables = fetch_ecb(&mut transport, &options).unwrap();
            assert_eq!(
                transport.calls.last().unwrap(),
                &call(url, "application/xml")
            );
            assert_eq!(tables.len(), 2);
            assert!(
                tables[0].as_of().unwrap().day() > tables[1].as_of().unwrap().day(),
                "newest first"
            );
        }
    }

    #[test]
    fn available_at_reaches_the_parser() {
        let mut transport = fake(|_| Ok(Response::new(200, fixture("ecb/eurofxref-daily.xml"))));
        let options = FetchEcbOptions {
            available_at: Publication::Stated,
            ..FetchEcbOptions::default()
        };
        let tables = fetch_ecb(&mut transport, &options).unwrap();
        // 16:00 in Frankfurt in November: CET, 15:00 UTC
        assert_eq!(
            tables[0].available_at().unwrap().to_string(),
            "2026-11-06T15:00:00.000Z"
        );
    }

    #[test]
    fn an_http_error_404_included_is_a_status_error() {
        for status in [404, 503, 301, 199] {
            let mut transport = fake(move |_| Ok(Response::new(status, "")));
            let error = fetch_ecb(&mut transport, &FetchEcbOptions::default()).unwrap_err();
            assert!(matches!(error, FetchError::Status { status: s, .. } if s == status));
            assert_eq!(error.status(), Some(status));
            assert_eq!(error.url(), Some(ECB_URLS.daily));
            assert_eq!(
                error.to_string(),
                format!("GET {} failed with HTTP {status}", ECB_URLS.daily)
            );
            assert!(error.source().is_none());
        }
    }

    #[test]
    fn a_parse_error_names_the_url_and_keeps_the_cause() {
        let mut transport = fake(|_| Ok(Response::new(200, "<html>busy</html>")));
        let error = fetch_ecb(&mut transport, &FetchEcbOptions::default()).unwrap_err();
        let FetchError::Parse { url, source } = &error else {
            panic!("{error:?}")
        };
        assert_eq!(url, ECB_URLS.daily);
        assert_eq!(*source, ducat::Error::MalformedRates);
        assert_eq!(
            error.to_string(),
            format!("{} (from {})", ducat::Error::MalformedRates, ECB_URLS.daily)
        );
        assert!(error.source().unwrap().is::<ducat::Error>());
    }

    #[test]
    fn a_body_that_isnt_utf8_is_read_with_replacements() {
        let mut body = fixture("ecb/eurofxref-daily.xml");
        // a stray byte in the sender's name, outside the cubes
        let at = body.windows(8).position(|w| w == b"European").unwrap();
        body[at] = 0xff;
        let mut transport = fake(move |_| Ok(Response::new(200, body.clone())));
        let tables = fetch_ecb(&mut transport, &FetchEcbOptions::default()).unwrap();
        assert_eq!(rate(&tables[0], "EUR", "USD"), "1.1165");
    }

    #[test]
    fn a_transport_error_passes_through_with_the_url() {
        let mut transport = fake(|_| {
            Err(TransportError::new(
                TransportErrorKind::Timeout,
                "30 s elapsed",
            ))
        });
        let error = fetch_ecb(&mut transport, &FetchEcbOptions::default()).unwrap_err();
        let FetchError::Transport { url, source } = &error else {
            panic!("{error:?}")
        };
        assert_eq!(url, ECB_URLS.daily);
        assert!(source.is_timeout());
        assert_eq!(
            error.to_string(),
            format!("GET {}: timed out: 30 s elapsed", ECB_URLS.daily)
        );
        assert!(error.source().unwrap().is::<TransportError>());
    }

    #[test]
    fn the_sans_io_functions_are_what_fetch_ecb_runs() {
        let options = FetchEcbOptions::default();
        let request = ecb_request(&options);
        assert_eq!(Request::METHOD, "GET");
        assert_eq!(request.url, ECB_URLS.daily);
        assert_eq!(request.headers, [("accept", "application/xml")]);
        let response = Response::new(200, fixture("ecb/eurofxref-daily.xml"));
        let tables = ecb_tables(&request, &response, &options).unwrap();
        assert_eq!(rate(&tables[0], "EUR", "JPY"), "176.77");
    }
}

mod ecb_range {
    use super::*;

    fn respond(url: &str) -> Result<Response, TransportError> {
        Ok(Response::new(
            200,
            if url.contains("detail=nodata") {
                fixture("ecb-sdmx/exr-d-nodata.csv")
            } else {
                fixture("ecb-sdmx/exr-d-dataonly.csv")
            },
        ))
    }

    #[test]
    fn builds_both_requests_in_ducats_order() {
        let mut transport = fake(respond);
        let options = FetchEcbRangeOptions {
            end: Some(day("2026-01-06")),
            currencies: &["USD", "JPY", "ISK"],
            ..FetchEcbRangeOptions::from(day("2025-12-22"))
        };
        fetch_ecb_range(&mut transport, &options).unwrap();
        assert_eq!(
            transport.calls,
            [
                call(
                    "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+JPY+ISK.EUR.SP00.A?format=csvdata&detail=nodata",
                    "text/csv"
                ),
                call(
                    "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+JPY+ISK.EUR.SP00.A?format=csvdata&startPeriod=2025-12-22&endPeriod=2026-01-06&detail=dataonly",
                    "text/csv"
                ),
            ]
        );
    }

    #[test]
    fn every_currency_and_no_end() {
        let requests = ecb_range_requests(&FetchEcbRangeOptions::from(day("1999-01-04"))).unwrap();
        assert_eq!(
            requests.series.url,
            "https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?format=csvdata&detail=nodata"
        );
        assert_eq!(
            requests.data.url,
            "https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?format=csvdata&startPeriod=1999-01-04&detail=dataonly"
        );
        assert_eq!(requests.series.headers, [("accept", "text/csv")]);
        assert_eq!(requests.data.headers, [("accept", "text/csv")]);
        // one day is a range
        let one = FetchEcbRangeOptions {
            end: Some(day("1999-01-04")),
            ..FetchEcbRangeOptions::from(day("1999-01-04"))
        };
        assert!(ecb_range_requests(&one).unwrap().data.url.ends_with(
            "?format=csvdata&startPeriod=1999-01-04&endPeriod=1999-01-04&detail=dataonly"
        ));
    }

    #[test]
    fn parses_with_the_series_decimals() {
        let mut transport = fake(respond);
        let options = FetchEcbRangeOptions::from(day("2025-12-22"));
        let tables = fetch_ecb_range(&mut transport, &options).unwrap();
        assert_eq!(tables.len(), 9);
        assert_eq!(tables[0].as_of().unwrap().to_string(), "2026-01-06");
        assert_eq!(tables[8].as_of().unwrap().to_string(), "2025-12-22");
        assert_eq!(rate(&tables[0], "EUR", "USD"), "1.1707");
        // the API's 148 is published as 148.00: ISK's DECIMALS is 2
        let dec23 = tables
            .iter()
            .find(|t| t.as_of().unwrap().to_string() == "2025-12-23")
            .unwrap();
        assert_eq!(rate(dec23, "EUR", "ISK"), "148.00");
        assert_eq!(tables[0].available_at(), None);
    }

    #[test]
    fn available_at_reaches_the_parser() {
        let mut transport = fake(respond);
        let options = FetchEcbRangeOptions {
            available_at: Publication::Stated,
            ..FetchEcbRangeOptions::from(day("2025-12-22"))
        };
        let tables = fetch_ecb_range(&mut transport, &options).unwrap();
        assert_eq!(
            tables[0].available_at().unwrap().to_string(),
            "2026-01-06T15:00:00.000Z"
        );
    }

    #[test]
    fn checks_codes_and_days_before_any_request() {
        let mut transport = fake(respond);
        for currency in ["usd", "USDX", "XUSD", "US", "ÜSD", ""] {
            let options = FetchEcbRangeOptions {
                currencies: &[currency],
                ..FetchEcbRangeOptions::from(day("2026-01-01"))
            };
            let error = fetch_ecb_range(&mut transport, &options).unwrap_err();
            assert!(matches!(&error, FetchError::InvalidCurrency(code) if code == currency));
            assert_eq!(
                error.to_string(),
                format!("Not an ISO currency code: {currency}")
            );
            assert_eq!(error.url(), None);
        }
        let error = fetch_ecb_range(
            &mut transport,
            &FetchEcbRangeOptions::from(day("1999-01-03")),
        )
        .unwrap_err();
        assert!(matches!(
            error,
            FetchError::StartTooEarly {
                feed: Feed::Ecb,
                ..
            }
        ));
        assert_eq!(
            error.to_string(),
            "The ECB's rates start on 1999-01-04, not 1999-01-03"
        );
        let backwards = FetchEcbRangeOptions {
            end: Some(day("2026-01-01")),
            ..FetchEcbRangeOptions::from(day("2026-01-02"))
        };
        assert_eq!(
            fetch_ecb_range(&mut transport, &backwards)
                .unwrap_err()
                .to_string(),
            "end 2026-01-01 is before start 2026-01-02"
        );
        assert_eq!(transport.calls, []);
    }

    #[test]
    fn a_404_for_the_data_is_no_tables() {
        let mut transport = fake(|url| {
            if url.contains("detail=nodata") {
                respond(url)
            } else {
                Ok(Response::new(404, "No results found."))
            }
        });
        let tables = fetch_ecb_range(
            &mut transport,
            &FetchEcbRangeOptions::from(day("2026-11-14")),
        )
        .unwrap();
        assert!(tables.is_empty());
        assert_eq!(transport.calls.len(), 2);
    }

    #[test]
    fn a_failed_series_request_stops_before_the_data() {
        let mut transport = fake(|_| Ok(Response::new(404, "")));
        let error = fetch_ecb_range(
            &mut transport,
            &FetchEcbRangeOptions::from(day("2026-01-01")),
        )
        .unwrap_err();
        assert_eq!(error.status(), Some(404));
        assert!(error.url().unwrap().ends_with("&detail=nodata"));
        assert_eq!(transport.calls.len(), 1);

        let mut transport = fake(|_| Err(TransportError::other("connection refused")));
        let error = fetch_ecb_range(
            &mut transport,
            &FetchEcbRangeOptions::from(day("2026-01-01")),
        )
        .unwrap_err();
        assert!(matches!(error, FetchError::Transport { .. }));
        assert_eq!(transport.calls.len(), 1);
    }

    #[test]
    fn a_failed_data_request_names_its_url() {
        let mut transport = fake(|url| {
            if url.contains("detail=nodata") {
                respond(url)
            } else {
                Ok(Response::new(503, ""))
            }
        });
        let error = fetch_ecb_range(
            &mut transport,
            &FetchEcbRangeOptions::from(day("2026-01-01")),
        )
        .unwrap_err();
        assert_eq!(error.status(), Some(503));
        assert!(error.url().unwrap().ends_with("&detail=dataonly"));
    }

    #[test]
    fn parse_errors_name_the_file_they_came_from() {
        let options = FetchEcbRangeOptions::from(day("2025-12-22"));
        let requests = ecb_range_requests(&options).unwrap();
        let series = Response::new(200, fixture("ecb-sdmx/exr-d-nodata.csv"));
        let data = Response::new(200, fixture("ecb-sdmx/exr-d-dataonly.csv"));
        let html = Response::new(200, "<html>maintenance</html>");

        let error = ecb_range_tables(&requests, &html, &data, &options).unwrap_err();
        assert!(matches!(error, FetchError::Parse { .. }));
        assert_eq!(error.url(), Some(requests.series.url.as_str()));
        let error = ecb_range_tables(&requests, &series, &html, &options).unwrap_err();
        assert!(matches!(error, FetchError::Parse { .. }));
        assert_eq!(error.url(), Some(requests.data.url.as_str()));
        // a 404 for the data comes before reading the series, as in ducat
        let none = Response::new(404, "");
        assert!(
            ecb_range_tables(&requests, &html, &none, &options)
                .unwrap()
                .is_empty()
        );
        // and the series' status before that
        let failed = Response::new(500, "");
        let error = ecb_range_tables(&requests, &failed, &none, &options).unwrap_err();
        assert_eq!(error.url(), Some(requests.series.url.as_str()));
        assert_eq!(
            ecb_range_tables(&requests, &series, &data, &options)
                .unwrap()
                .len(),
            9
        );
    }
}

mod bank_of_canada {
    use super::*;

    fn body() -> Vec<u8> {
        fixture("boc/fx-rates-daily.json")
    }

    #[test]
    fn builds_the_query() {
        let mut transport = fake(|_| Ok(Response::new(200, body())));
        let latest = FetchBankOfCanadaOptions::default();
        let from = FetchBankOfCanadaOptions {
            start: Some(day("2026-01-02")),
            end: None,
        };
        let between = FetchBankOfCanadaOptions {
            start: Some(day("2017-01-03")),
            end: Some(day("2017-01-03")),
        };
        for options in [latest, from, between] {
            fetch_bank_of_canada(&mut transport, &options).unwrap();
        }
        assert_eq!(
            BANK_OF_CANADA_URL,
            "https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json"
        );
        assert_eq!(
            transport.calls,
            [
                call(
                    "https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json?recent=1",
                    "application/json"
                ),
                call(
                    "https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json?start_date=2026-01-02",
                    "application/json"
                ),
                call(
                    "https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json?start_date=2017-01-03&end_date=2017-01-03",
                    "application/json"
                ),
            ]
        );
    }

    #[test]
    fn checks_its_days_before_any_request() {
        let mut transport = fake(|_| Ok(Response::new(200, body())));
        for (options, message) in [
            (
                FetchBankOfCanadaOptions {
                    start: Some(day("2017-01-02")),
                    end: None,
                },
                "Valet's daily rates start on 2017-01-03, not 2017-01-02",
            ),
            (
                FetchBankOfCanadaOptions {
                    start: Some(day("2026-01-02")),
                    end: Some(day("2026-01-01")),
                },
                "end 2026-01-01 is before start 2026-01-02",
            ),
            (
                FetchBankOfCanadaOptions {
                    start: None,
                    end: Some(day("2026-01-01")),
                },
                "end needs a start",
            ),
        ] {
            let error = fetch_bank_of_canada(&mut transport, &options).unwrap_err();
            assert_eq!(error.to_string(), message);
        }
        // a start before Valet's first day and an end before it: the start is checked first
        let error = bank_of_canada_request(&FetchBankOfCanadaOptions {
            start: Some(day("2016-01-02")),
            end: Some(day("2016-01-01")),
        })
        .unwrap_err();
        assert!(matches!(
            error,
            FetchError::StartTooEarly {
                feed: Feed::BankOfCanada,
                ..
            }
        ));
        assert_eq!(transport.calls, []);
    }

    #[test]
    fn parses_cad_tables_newest_first() {
        let mut transport = fake(|_| Ok(Response::new(200, body())));
        let tables =
            fetch_bank_of_canada(&mut transport, &FetchBankOfCanadaOptions::default()).unwrap();
        assert_eq!(tables.len(), 9);
        assert_eq!(tables[0].as_of().unwrap().to_string(), "2026-01-06");
        assert_eq!(tables[0].base().unwrap().to_string(), "CAD");
        // the parser's default: the Bank's stated 16:30 in Toronto (EST, 21:30 UTC)
        assert_eq!(
            tables[0].available_at().unwrap().to_string(),
            "2026-01-06T21:30:00.000Z"
        );
    }

    #[test]
    fn http_and_parse_errors() {
        let request = bank_of_canada_request(&FetchBankOfCanadaOptions::default()).unwrap();
        let error = bank_of_canada_tables(&request, &Response::new(429, "")).unwrap_err();
        assert_eq!(
            error.to_string(),
            format!("GET {BANK_OF_CANADA_URL}?recent=1 failed with HTTP 429")
        );
        let error = bank_of_canada_tables(&request, &Response::new(200, "<html/>")).unwrap_err();
        assert!(matches!(error, FetchError::Parse { .. }));
        assert_eq!(error.url(), Some(request.url.as_str()));
    }
}

/// A closure is a transport.
#[test]
fn a_closure_is_a_transport() {
    let mut seen = Vec::new();
    let mut transport = |url: &str, headers: &[(&str, &str)]| {
        seen.push((url.to_owned(), headers.len()));
        Ok::<_, TransportError>(Response::new(200, fixture("ecb/eurofxref-daily.xml")))
    };
    let tables = fetch_ecb(&mut transport, &FetchEcbOptions::default()).unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(seen, [(ECB_URLS.daily.to_owned(), 1)]);
}

/// ducat's spec has no fetch vectors; if it gains some, this crate's spec test must run them.
#[test]
fn spec_has_no_fetch_vectors() {
    let vectors = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../spec/vectors");
    let areas: Vec<String> = std::fs::read_dir(&vectors)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(areas.contains(&"convert".to_owned()), "{areas:?}");
    assert!(
        !areas.iter().any(|area| area.contains("fetch")),
        "spec/vectors has fetch vectors now: add a spec test to ducat-fetch ({areas:?})"
    );
}
