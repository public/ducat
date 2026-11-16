//! Snapshots: ducat's `snapshots` and `snapshotsFrom` tests (test/provider.test.ts,
//! test/history.test.ts, test/ecb.test.ts), case by case, with a fake loader that records the days
//! it is asked for. The load sequences marked "ducat:" were recorded by running the same calls
//! against the built TS (`dist/provider.js`) under node. ducat's "a slow miss does not evict a
//! newer load for the same day" has no counterpart: `Snapshots::at` takes `&mut self`, so loads
//! never overlap.

use std::cell::RefCell;
use std::rc::Rc;

use ducat::convert::ecb::{EcbOptions, parse_ecb_csv, parse_ecb_xml};
use ducat::convert::{
    Date, RateInfo, RateProvider, RateQuery, RateTable, SnapshotOptions, SnapshotTable, Time,
    snapshots, snapshots_from,
};
use ducat::{Error, ErrorKind};

use crate::common::{code, time};

fn day(text: &str) -> Date {
    text.parse().unwrap()
}

/// A one-base EUR table: ducat's `rateTable({ base: 'EUR', asOf, availableAt, rates })`.
fn table(as_of: Option<&str>, available_at: Option<&str>, rates: &[(&str, &str)]) -> RateTable {
    let info = RateInfo {
        source: Some("ECB".into()),
        as_of: as_of.map(time),
        available_at: available_at.map(time),
        ..RateInfo::default()
    };
    let mut builder = RateTable::with_base(code("EUR"), info);
    for (currency, rate) in rates {
        builder = builder.rate(code(currency), rate).unwrap();
    }
    builder.build()
}

/// The table of ducat's provider tests.
fn ecb() -> RateTable {
    table(
        Some("2026-11-06"),
        None,
        &[("USD", "1.1165"), ("JPY", "176.77")],
    )
}

fn usd(provider: &impl RateProvider) -> String {
    provider
        .rate(code("EUR"), code("USD"), &RateQuery::default())
        .unwrap()
        .to_string()
}

type Calls = Rc<RefCell<Vec<String>>>;

/// A loader over `days` that records each day asked for.
fn recording(
    days: Vec<(&'static str, RateTable)>,
) -> (
    Calls,
    impl FnMut(Date) -> Result<Option<Rc<RateTable>>, Error>,
) {
    let calls = Calls::default();
    let seen = Rc::clone(&calls);
    let days: Vec<(Date, Rc<RateTable>)> = days
        .into_iter()
        .map(|(text, table)| (day(text), Rc::new(table)))
        .collect();
    let load = move |asked: Date| {
        seen.borrow_mut().push(asked.to_string());
        Ok(days
            .iter()
            .find(|(when, _)| *when == asked)
            .map(|(_, table)| Rc::clone(table)))
    };
    (calls, load)
}

fn taken(calls: &Calls) -> Vec<String> {
    calls.borrow_mut().drain(..).collect()
}

#[test]
fn takes_the_latest_table_within_the_lookback_and_keeps_hits_only() {
    let (calls, load) = recording(vec![("2026-11-06", ecb()), ("2026-11-02", ecb())]);
    let mut history = snapshots(load, SnapshotOptions::default()).unwrap();

    // Sunday -> Friday
    let found = history.at(&time("2026-11-08")).unwrap();
    assert_eq!(found.as_of(), Some(time("2026-11-06")));
    assert_eq!(taken(&calls), ["2026-11-08", "2026-11-07", "2026-11-06"]);

    // misses are tried again, the hit is kept
    let found = history.at(&time("2026-11-08T12:00:00Z")).unwrap();
    assert_eq!(found.as_of(), Some(time("2026-11-06")));
    assert_eq!(taken(&calls), ["2026-11-08", "2026-11-07"]);

    // 11-01 back to 10-28: nothing
    let error = history.at(&time("2026-11-01")).unwrap_err();
    assert_eq!(
        error,
        Error::NoSnapshot {
            as_of: day("2026-11-01")
        }
    );
    assert_eq!(error.kind(), ErrorKind::Range);
    assert_eq!(
        taken(&calls),
        [
            "2026-11-01",
            "2026-10-31",
            "2026-10-30",
            "2026-10-29",
            "2026-10-28"
        ]
    );

    let none = |_: Date| Ok::<Option<RateTable>, Error>(None);
    let mut empty = snapshots(
        none,
        SnapshotOptions {
            lookback: 0,
            ..SnapshotOptions::default()
        },
    )
    .unwrap();
    let error = empty.at(&time("2026-11-06")).unwrap_err();
    // ducat: "No exchange rate *→* as of 2026-11-06"
    assert_eq!(error.to_string(), "no exchange rate *→* as of 2026-11-06");

    // ducat's RangeError for "not a date" is the caller's parse here
    assert_eq!("not a date".parse::<Time>(), Err(Error::InvalidTime));

    // an offset instant resolves to its UTC day: 03:00Z on the 7th
    history.at(&time("2026-11-06T22:00:00-05:00")).unwrap();
    assert_eq!(taken(&calls)[0], "2026-11-07");

    // ducat's lookback -1 and 1.5 can't be written: it's a u32
    let error = snapshots(
        none,
        SnapshotOptions {
            max: 0,
            ..SnapshotOptions::default()
        },
    )
    .unwrap_err();
    assert_eq!(error, Error::NotPositive);
    assert_eq!(error.kind(), ErrorKind::Range);
}

#[test]
fn tries_a_failed_load_again_and_bounds_what_it_keeps() {
    let mut loads = 0;
    let load = |asked: Date| {
        loads += 1;
        if loads == 1 {
            return Err(Error::MalformedRates); // ducat: "network"
        }
        let text = asked.to_string();
        Ok((text.ends_with('6') || text.ends_with('5')).then(ecb))
    };
    let mut history = snapshots(
        load,
        SnapshotOptions {
            lookback: 0,
            max: 1,
        },
    )
    .unwrap();
    assert_eq!(
        history.at(&time("2026-11-06")).unwrap_err(),
        Error::MalformedRates
    );
    history.at(&time("2026-11-06")).unwrap();
    history.at(&time("2026-11-05")).unwrap();
    history.at(&time("2026-11-06")).unwrap();
    drop(history);
    assert_eq!(loads, 4); // 06 was dropped for 05
}

#[test]
fn a_miss_keeps_the_kept_day() {
    // ducat: 06, then 08 and 07 (misses, which make no room) before the kept 06, then nothing
    let (calls, load) = recording(vec![("2026-11-06", ecb())]);
    let mut history = snapshots(
        load,
        SnapshotOptions {
            lookback: 2,
            max: 1,
        },
    )
    .unwrap();
    for at in ["2026-11-06", "2026-11-08", "2026-11-06"] {
        let found = history.at(&time(at)).unwrap();
        assert_eq!(found.as_of(), Some(time("2026-11-06")));
    }
    assert_eq!(taken(&calls), ["2026-11-06", "2026-11-08", "2026-11-07"]);
}

#[test]
fn keeps_the_most_recently_used_days() {
    // ducat: 01, 02, 03, 02 (03 dropped 02, the least recently used after 01 was used again)
    let calls = Rc::new(RefCell::new(Vec::new()));
    let seen = Rc::clone(&calls);
    let load = move |asked: Date| {
        seen.borrow_mut().push(asked.to_string());
        Ok::<_, Error>(Some(ecb()))
    };
    let mut history = snapshots(
        load,
        SnapshotOptions {
            lookback: 0,
            max: 2,
        },
    )
    .unwrap();
    for at in [
        "2026-11-01",
        "2026-11-02",
        "2026-11-01",
        "2026-11-03",
        "2026-11-01",
        "2026-11-02",
    ] {
        history.at(&time(at)).unwrap();
    }
    assert_eq!(
        taken(&calls),
        ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-02"]
    );
}

#[test]
fn a_failed_load_fails_the_lookup_without_falling_back() {
    // ducat: rejects with the loader's error after loading 08 and 07; 06 isn't tried
    let calls = Rc::new(RefCell::new(Vec::new()));
    let seen = Rc::clone(&calls);
    let load = move |asked: Date| {
        seen.borrow_mut().push(asked.to_string());
        match asked.to_string().as_str() {
            "2026-11-07" => Err(Error::MalformedRates),
            "2026-11-06" => Ok(Some(ecb())),
            _ => Ok(None),
        }
    };
    let mut history = snapshots(load, SnapshotOptions::default()).unwrap();
    assert_eq!(
        history.at(&time("2026-11-08")).unwrap_err(),
        Error::MalformedRates
    );
    assert_eq!(taken(&calls), ["2026-11-08", "2026-11-07"]);
}

/// A loader's own error type, converting ducat's.
#[derive(Debug, PartialEq)]
enum LoadError {
    Offline,
    Rates(Error),
}

impl From<Error> for LoadError {
    fn from(error: Error) -> Self {
        Self::Rates(error)
    }
}

#[test]
fn a_loader_error_type_of_its_own() {
    let mut offline = true;
    let load = |asked: Date| {
        if std::mem::take(&mut offline) {
            return Err(LoadError::Offline);
        }
        Ok((asked == day("2026-11-06")).then(ecb))
    };
    let mut history = snapshots(
        load,
        SnapshotOptions {
            lookback: 1,
            ..SnapshotOptions::default()
        },
    )
    .unwrap();
    assert_eq!(
        history.at(&time("2026-11-06")).unwrap_err(),
        LoadError::Offline
    );
    assert_eq!(usd(history.at(&time("2026-11-07")).unwrap()), "1.1165");
    assert_eq!(
        history.at(&time("2026-11-05")).unwrap_err(),
        LoadError::Rates(Error::NoSnapshot {
            as_of: day("2026-11-05")
        })
    );
}

#[test]
fn passes_over_a_table_not_yet_published_at_the_instant_asked_for() {
    let published = table(
        Some("2026-11-06"),
        Some("2026-11-06T15:00:00Z"),
        &[("USD", "1.1165")],
    );
    let thursday = table(
        Some("2026-11-05"),
        Some("2026-11-05T15:00:00Z"),
        &[("USD", "1.1100")],
    );

    // test/history.test.ts, through snapshotsFrom
    let history = snapshots_from(
        [published.clone(), thursday.clone()],
        SnapshotOptions::default(),
    )
    .unwrap();
    assert_eq!(
        usd(history.at(&time("2026-11-06T09:00:00Z")).unwrap()),
        "1.1100"
    );
    assert_eq!(
        usd(history.at(&time("2026-11-06T16:00:00Z")).unwrap()),
        "1.1165"
    );
    assert_eq!(usd(history.at(&time("2026-11-06")).unwrap()), "1.1165");

    // ducat, through a loader with a lookback of 1: 09:00 gets Thursday's, 16:00 Friday's (kept),
    // Thursday 09:00 nothing (04 has no table), a date the whole day; loads 06, 05, 04
    let (calls, load) = recording(vec![("2026-11-06", published), ("2026-11-05", thursday)]);
    let mut history = snapshots(
        load,
        SnapshotOptions {
            lookback: 1,
            ..SnapshotOptions::default()
        },
    )
    .unwrap();
    assert_eq!(
        usd(history.at(&time("2026-11-06T09:00:00Z")).unwrap()),
        "1.1100"
    );
    assert_eq!(
        usd(history.at(&time("2026-11-06T16:00:00Z")).unwrap()),
        "1.1165"
    );
    assert_eq!(
        history.at(&time("2026-11-05T09:00:00Z")).unwrap_err(),
        Error::NoSnapshot {
            as_of: day("2026-11-05")
        }
    );
    assert_eq!(usd(history.at(&time("2026-11-06")).unwrap()), "1.1165");
    assert_eq!(taken(&calls), ["2026-11-06", "2026-11-05", "2026-11-04"]);
}

#[test]
fn snapshots_from_indexes_tables_by_day() {
    let thursday = table(Some("2026-11-05"), None, &[("USD", "1.1224")]);
    let history = snapshots_from([ecb(), thursday], SnapshotOptions::default()).unwrap();
    assert_eq!(usd(history.at(&time("2026-11-05")).unwrap()), "1.1224");
    let monday = history.at(&time("2026-11-09")).unwrap();
    assert_eq!(monday.as_of(), Some(time("2026-11-06")));
}

#[test]
fn snapshots_from_keeps_the_last_table_of_a_day_and_leaves_out_undated_ones() {
    // ducat: 2; then "No exchange rate *→* as of 2026-11-07" for the undated table alone and for
    // a lookback of 0; RangeError "max must be a positive integer, got 0"
    let first = table(Some("2026-11-06"), None, &[("USD", "1")]);
    let second = table(Some("2026-11-06T10:00:00Z"), None, &[("USD", "2")]);
    let undated = table(None, None, &[("USD", "3")]);
    let history = snapshots_from(
        [first.clone(), second, undated.clone()],
        SnapshotOptions::default(),
    )
    .unwrap();
    assert_eq!(usd(history.at(&time("2026-11-07")).unwrap()), "2");

    let unavailable = Error::NoSnapshot {
        as_of: day("2026-11-07"),
    };
    let only_undated = snapshots_from([undated], SnapshotOptions::default()).unwrap();
    assert_eq!(
        only_undated.at(&time("2026-11-07")).unwrap_err(),
        unavailable
    );
    let no_lookback = snapshots_from(
        [first.clone()],
        SnapshotOptions {
            lookback: 0,
            ..SnapshotOptions::default()
        },
    )
    .unwrap();
    assert_eq!(
        no_lookback.at(&time("2026-11-07")).unwrap_err(),
        unavailable
    );
    let error = snapshots_from(
        [first],
        SnapshotOptions {
            max: 0,
            ..SnapshotOptions::default()
        },
    )
    .unwrap_err();
    assert_eq!(error, Error::NotPositive);
}

#[test]
fn the_lookback_stops_at_the_first_day() {
    let start = table(Some("0000-01-01"), None, &[("USD", "1")]);
    let history = snapshots_from([start.clone()], SnapshotOptions::default()).unwrap();
    assert_eq!(usd(history.at(&time("0000-01-03")).unwrap()), "1");

    let (calls, load) = recording(vec![]);
    let mut history = snapshots(load, SnapshotOptions::default()).unwrap();
    assert_eq!(
        history.at(&time("0000-01-02")).unwrap_err(),
        Error::NoSnapshot {
            as_of: day("0000-01-02")
        }
    );
    assert_eq!(taken(&calls), ["0000-01-02", "0000-01-01"]);
}

#[test]
fn snapshots_over_ecb_files() {
    let fixture = |path: &str| {
        let root =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../spec/fixtures/ecb");
        std::fs::read_to_string(root.join(path)).unwrap()
    };
    // test/ecb.test.ts: multi-day XML, newest first; Sunday gets Friday's table
    let days = parse_ecb_xml(&fixture("eurofxref-hist-2d.xml"), &EcbOptions::default()).unwrap();
    let history = snapshots_from(days.clone(), SnapshotOptions::default()).unwrap();
    let sunday = history.at(&time("2026-11-08")).unwrap();
    assert_eq!(sunday.as_of(), days[0].as_of());
    assert_eq!(sunday.as_of(), Some(time("2026-11-06")));

    // a day with no rates is left out, so the lookback goes on to the day before
    let csv = "Date,USD,JPY\n2026-11-06,N/A,N/A\n2026-11-05,1.1224,175.9\n";
    let tables = parse_ecb_csv(csv, &EcbOptions::default()).unwrap();
    let history = snapshots_from(tables, SnapshotOptions::default()).unwrap();
    assert_eq!(usd(history.at(&time("2026-11-06")).unwrap()), "1.1224");
}

#[test]
fn providers_of_other_kinds() {
    // a boxed table keeps its publication; a provider of your own is always available
    struct Flat;
    impl RateProvider for Flat {
        fn rate(
            &self,
            from: ducat::CurrencyCode,
            to: ducat::CurrencyCode,
            _query: &RateQuery,
        ) -> Option<ducat::convert::AnyRate> {
            ducat::convert::AnyRate::parse(from, to, "2").ok()
        }
    }
    impl SnapshotTable for Flat {}

    let load = |asked: Date| -> Result<Option<Box<dyn SnapshotTable>>, Error> {
        Ok(Some(if asked == day("2026-11-06") {
            Box::new(table(
                Some("2026-11-06"),
                Some("2026-11-06T15:00:00Z"),
                &[("USD", "1.1165")],
            ))
        } else {
            Box::new(Flat)
        }))
    };
    let mut history = snapshots(load, SnapshotOptions::default()).unwrap();
    assert_eq!(
        usd(history.at(&time("2026-11-06T16:00:00Z")).unwrap()),
        "1.1165"
    );
    assert_eq!(usd(history.at(&time("2026-11-06T09:00:00Z")).unwrap()), "2");
    assert_eq!(usd(history.at(&time("2026-11-07")).unwrap()), "2");
}
