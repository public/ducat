//! Snapshots over the ECB's files and its Data Portal, against a recording fake transport and
//! ducat's fixtures (`spec/fixtures/`). ducat's own is `snapshotsFrom(await fetchEcb(..))`
//! (test/ecb.test.ts parses the same two-day file); the day-by-day loader has no ducat
//! counterpart.

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

use ducat::convert::{Publication, RateProvider, RateQuery, RateTable, SnapshotOptions, Time};
use ducat_fetch::{
    ECB_URLS, EcbDayLoader, EcbHistory, FetchEcbOptions, FetchError, Response, TransportError,
    TransportErrorKind, ecb_day_snapshots, ecb_snapshots,
};

fn fixture(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../spec/fixtures")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn time(text: &str) -> Time {
    text.parse().unwrap()
}

fn usd(table: &RateTable) -> String {
    table
        .rate(
            "EUR".parse().unwrap(),
            "USD".parse().unwrap(),
            &RateQuery::default(),
        )
        .unwrap()
        .to_string()
}

#[test]
fn ecb_snapshots_is_snapshots_from_over_fetch_ecb() {
    let mut urls = Vec::new();
    let mut transport = |url: &str, _headers: &[(&str, &str)]| {
        urls.push(url.to_owned());
        Ok::<_, TransportError>(Response::new(200, fixture("ecb/eurofxref-hist-2d.xml")))
    };
    let options = FetchEcbOptions {
        history: EcbHistory::NinetyDays,
        ..FetchEcbOptions::default()
    };
    let history = ecb_snapshots(&mut transport, &options, SnapshotOptions::default()).unwrap();
    // Sunday: Friday's table
    assert_eq!(
        history.at(&time("2026-11-08")).unwrap().as_of(),
        Some(time("2026-11-06"))
    );
    assert_eq!(usd(history.at(&time("2026-11-05")).unwrap()), "1.1224");
    let error = history.at(&time("2026-11-01")).unwrap_err();
    assert!(matches!(error, ducat::Error::NoSnapshot { .. }));
    assert_eq!(urls, [ECB_URLS.ninety_days]);
}

#[test]
fn ecb_snapshots_refuses_its_options_before_the_request_and_passes_fetch_errors_on() {
    let mut urls = Vec::new();
    let mut transport = |url: &str, _headers: &[(&str, &str)]| {
        urls.push(url.to_owned());
        Ok::<_, TransportError>(Response::new(503, ""))
    };
    let zero = SnapshotOptions {
        max: 0,
        ..SnapshotOptions::default()
    };
    let error = ecb_snapshots(&mut transport, &FetchEcbOptions::default(), zero).unwrap_err();
    assert!(matches!(
        error,
        FetchError::Snapshot(ducat::Error::NotPositive)
    ));
    let error = ecb_snapshots(
        &mut transport,
        &FetchEcbOptions::default(),
        SnapshotOptions::default(),
    )
    .unwrap_err();
    assert_eq!(error.status(), Some(503));
    assert_eq!(urls, [ECB_URLS.daily]);
}

/// A Data Portal fake: the series file, and each day's rows of the fixture (a 404 for a day
/// without), recording the URLs.
fn portal(
    urls: Rc<RefCell<Vec<String>>>,
) -> impl FnMut(&str, &[(&str, &str)]) -> Result<Response, TransportError> {
    let data = fixture("ecb-sdmx/exr-d-dataonly.csv");
    move |url: &str, headers: &[(&str, &str)]| {
        assert_eq!(headers, [("accept", "text/csv")]);
        urls.borrow_mut().push(url.to_owned());
        if url.contains("detail=nodata") {
            return Ok(Response::new(200, fixture("ecb-sdmx/exr-d-nodata.csv")));
        }
        let start = url.split("startPeriod=").nth(1).unwrap().get(..10).unwrap();
        assert!(url.contains(&format!("endPeriod={start}&")));
        let mut lines = data.lines();
        let header = lines.next().unwrap();
        let rows: Vec<&str> = lines
            .filter(|line| line.contains(&format!(",{start},")))
            .collect();
        Ok(if rows.is_empty() {
            Response::new(404, "No results found.")
        } else {
            Response::new(200, format!("{header}\n{}\n", rows.join("\n")))
        })
    }
}

fn days_asked(urls: &RefCell<Vec<String>>) -> Vec<String> {
    urls.borrow_mut()
        .drain(..)
        .map(|url| match url.split("startPeriod=").nth(1) {
            Some(rest) => rest[..10].to_owned(),
            None => "series".to_owned(),
        })
        .collect()
}

#[test]
fn the_day_loader_fetches_each_day_once_and_the_series_once() {
    let urls = Rc::new(RefCell::new(Vec::new()));
    let mut history = ecb_day_snapshots(
        portal(Rc::clone(&urls)),
        &["USD", "JPY", "ISK"],
        Publication::Stated,
        SnapshotOptions::default(),
    )
    .unwrap();

    // Sunday 2026-01-04 and Saturday the 3rd have no rates: Friday the 2nd's
    let friday = history.at(&time("2026-01-04")).unwrap();
    assert_eq!(friday.as_of(), Some(time("2026-01-02")));
    assert_eq!(usd(friday), "1.1721");
    assert_eq!(
        days_asked(&urls),
        ["series", "2026-01-04", "2026-01-03", "2026-01-02"]
    );

    // the 2nd is kept; the misses are asked again
    history.at(&time("2026-01-03")).unwrap();
    assert_eq!(days_asked(&urls), ["2026-01-03"]);

    // published 16:00 CET: at 09:00 on the 6th, the 5th's
    let early = history.at(&time("2026-01-06T09:00:00Z")).unwrap();
    assert_eq!(early.as_of(), Some(time("2026-01-05")));
    assert_eq!(days_asked(&urls), ["2026-01-06", "2026-01-05"]);
    let late = history.at(&time("2026-01-06T16:00:00Z")).unwrap();
    assert_eq!(late.as_of(), Some(time("2026-01-06")));
    assert_eq!(days_asked(&urls), Vec::<String>::new());

    // 1999-01-04 is the first day: before it, no table and no request
    let error = history.at(&time("1999-01-03")).unwrap_err();
    assert!(matches!(
        error,
        FetchError::Snapshot(ducat::Error::NoSnapshot { .. })
    ));
    assert_eq!(days_asked(&urls), Vec::<String>::new());
}

#[test]
fn the_day_loader_checks_codes_and_options_first_and_fails_lookups_on_fetch_errors() {
    let refuse = |_: &str, _: &[(&str, &str)]| -> Result<Response, TransportError> {
        panic!("no request expected")
    };
    let error = EcbDayLoader::new(refuse, &["usd"], Publication::Unknown).unwrap_err();
    assert!(matches!(error, FetchError::InvalidCurrency(code) if code == "usd"));
    let zero = SnapshotOptions {
        max: 0,
        ..SnapshotOptions::default()
    };
    let error = ecb_day_snapshots(refuse, &[], Publication::Unknown, zero).unwrap_err();
    assert!(matches!(
        error,
        FetchError::Snapshot(ducat::Error::NotPositive)
    ));

    // an outage fails the lookup rather than falling back; the series is kept, the day is not
    let urls = Rc::new(RefCell::new(Vec::new()));
    let mut down = true;
    let mut answer = portal(Rc::clone(&urls));
    let transport = move |url: &str, headers: &[(&str, &str)]| {
        if url.contains("startPeriod=2026-01-05") && std::mem::take(&mut down) {
            return Err(TransportError::new(
                TransportErrorKind::Timeout,
                std::io::Error::other("timed out"),
            ));
        }
        answer(url, headers)
    };
    let mut history = ecb_day_snapshots(
        transport,
        &["USD"],
        Publication::Unknown,
        SnapshotOptions::default(),
    )
    .unwrap();
    let error = history.at(&time("2026-01-05")).unwrap_err();
    assert!(matches!(error, FetchError::Transport { .. }));
    assert_eq!(days_asked(&urls), ["series"]);
    assert_eq!(usd(history.at(&time("2026-01-05")).unwrap()), "1.1664");
    assert_eq!(days_asked(&urls), ["2026-01-05"]);

    // a series request that fails isn't kept: the next load asks again
    let mut first = true;
    let transport = move |url: &str, _: &[(&str, &str)]| {
        assert!(url.contains("detail=nodata"));
        Ok::<_, TransportError>(Response::new(
            if std::mem::take(&mut first) { 500 } else { 400 },
            "",
        ))
    };
    let mut history = ecb_day_snapshots(
        transport,
        &[],
        Publication::Unknown,
        SnapshotOptions::default(),
    )
    .unwrap();
    assert_eq!(
        history.at(&time("2026-01-05")).unwrap_err().status(),
        Some(500)
    );
    assert_eq!(
        history.at(&time("2026-01-05")).unwrap_err().status(),
        Some(400)
    );
}
