//! The account time zone, `AdyenRateOptions::time_zone` (the `tz` feature): ducat's tests
//! (test/processor-fx.test.ts, test/adyen-fx-dst.test.ts), the offsets and names `Intl` takes and
//! refuses on Node 24, and a table of zones and wall times from the built TS
//! (`adyen_tz_cases.rs`, written by scripts/adyen-tz-cases.mjs).

use ducat::convert::adyen_fx::{AdyenRateOptions, adyen_rate_with};
use ducat::{Error, ErrorKind};

use crate::adyen_fx::as_of;
use crate::adyen_tz_cases::CASES;

/// Creation Date's `as_of` in the account zone `zone`, with the TimeZone column `column`.
fn read(created: Option<&str>, column: Option<&str>, zone: &str) -> Result<Option<String>, Error> {
    let mut row = vec![
        ("Gross Currency", "USD"),
        ("Net Currency", "EUR"),
        ("Exchange Rate", "0.9"),
    ];
    if let Some(created) = created {
        row.push(("Creation Date", created));
    }
    if let Some(column) = column {
        row.push(("TimeZone", column));
    }
    let options = AdyenRateOptions {
        time_zone: Some(zone),
    };
    Ok(adyen_rate_with(&row, options)?.and_then(|rate| as_of(&rate)))
}

fn at(created: &str, zone: &str) -> String {
    read(Some(created), None, zone)
        .unwrap_or_else(|error| panic!("{zone} {created}: {error}"))
        .unwrap()
}

#[test]
fn the_bundled_tz_database_is_2026f() {
    // Results follow the bundled tzdb. A jiff or jiff-tzdb bump that changes it fails here: check
    // the zones that release changes, then update this and the docs (the crate docs, Cargo.toml's
    // `tz` feature, design.md, NOTICE).
    assert_eq!(jiff_tzdb::VERSION, "2026f");
}

#[test]
fn creation_date_in_the_account_zone() {
    // processor-fx.test.ts: the account zone gives summer time, and the TimeZone column is unused
    let column = |created, column| read(Some(created), Some(column), "Europe/Amsterdam").unwrap();
    assert_eq!(
        column("2026-07-06 12:00:00", "CET").unwrap(),
        "2026-07-06T10:00:00.000Z"
    );
    assert_eq!(
        column("2026-11-06 12:00:00", "CET").unwrap(),
        "2026-11-06T11:00:00.000Z"
    );
    assert_eq!(
        at("2026-07-06 12:00:00", "America/Los_Angeles"),
        "2026-07-06T19:00:00.000Z"
    );
    // across the autumn change: 03:30 on 25 October 2026 is after the clocks went back
    assert_eq!(
        at("2026-10-25 03:30:00", "Europe/Amsterdam"),
        "2026-10-25T02:30:00.000Z"
    );
    // one zone, many rows
    for day in 10..30 {
        assert_eq!(
            at(&format!("2026-03-{day} 12:00:00"), "Asia/Kolkata"),
            format!("2026-03-{day}T06:30:00.000Z")
        );
    }
    // milliseconds and 24:00, as Date.parse reads them
    assert_eq!(
        at("2026-03-29 02:30:00.250", "Europe/Amsterdam"),
        "2026-03-29T01:30:00.250Z"
    );
    assert_eq!(
        at("2026-10-24 24:00:00", "Europe/Amsterdam"),
        "2026-10-24T22:00:00.000Z"
    );
    // the last hours of 9999, past jiff's last instant
    assert_eq!(
        at("9999-12-31 12:00:00", "America/New_York"),
        "9999-12-31T17:00:00.000Z"
    );
    assert_eq!(
        at("9999-12-31 12:00:00", "Australia/Sydney"),
        "9999-12-31T01:00:00.000Z"
    );
    // past 9999 in UTC: no instant (ducat gives +010000-...)
    assert_eq!(
        read(Some("9999-12-31 23:00:00"), None, "-05:00").unwrap(),
        None
    );
}

#[test]
fn offsets_with_seconds_and_early_years_are_exact() {
    // design.md, "Adyen's account time zone" (divergent): ducat rounds an offset to the minute
    // (1960-07-01T12:44:00.000Z, 0100-06-01T02:41:00.000Z) and reads years 0 to 99 as 1900 to 1999
    // (-001850-06-02T12:00:00.000Z in UTC)
    assert_eq!(
        at("1960-07-01 12:00:00", "Africa/Monrovia"),
        "1960-07-01T12:44:30.000Z"
    );
    assert_eq!(
        at("0100-06-01 12:00:00", "Asia/Tokyo"),
        "0100-06-01T02:41:01.000Z"
    );
    assert_eq!(at("0050-06-01 12:00:00", "UTC"), "0050-06-01T12:00:00.000Z");
    assert_eq!(
        at("0050-06-01 12:00:00", "+01:00"),
        "0050-06-01T11:00:00.000Z"
    );
    // the same as ducat: the tzdb's default build, where Europe/Amsterdam links to Europe/Brussels
    // before 1970, in both
    assert_eq!(
        at("1930-07-01 12:00:00", "Europe/Amsterdam"),
        "1930-07-01T11:00:00.000Z"
    );
}

#[test]
fn an_unknown_zone_is_a_range_error_when_creation_date_has_a_time() {
    let error = read(Some("2026-11-06 12:00:00"), None, "Mars/Olympus").unwrap_err();
    assert_eq!(error, Error::UnknownTimeZone);
    assert_eq!(error.kind(), ErrorKind::Range);
    // the zone is only read for a time, as in ducat: a day, an unreadable date or no date at all
    // never reaches it
    assert_eq!(
        read(Some("2026-11-06"), None, "Mars/Olympus")
            .unwrap()
            .unwrap(),
        "2026-11-06"
    );
    assert_eq!(read(Some("junk"), None, "Mars/Olympus").unwrap(), None);
    assert_eq!(read(None, None, "Mars/Olympus").unwrap(), None);
    // before the rate is read, as ducat throws before exchangeRate
    let row = [
        ("Gross Currency", "USD"),
        ("Net Currency", "EUR"),
        ("Exchange Rate", "-1"),
        ("Creation Date", "2026-01-01 00:00"),
    ];
    let options = AdyenRateOptions {
        time_zone: Some("Mars"),
    };
    assert_eq!(
        adyen_rate_with(&row, options).unwrap_err(),
        Error::UnknownTimeZone
    );
    // no account zone is adyen_rate
    assert_eq!(
        adyen_rate_with(&row, AdyenRateOptions::default()).unwrap_err(),
        Error::NonPositiveRate
    );
}

#[test]
fn clock_changes_resolve_as_temporal_compatible() {
    // test/adyen-fx-dst.test.ts, the same instants: a fold is the earlier instant, a gap the wall
    // time pushed forward
    let cases = [
        // a gap, then a fold
        (
            "America/New_York",
            "2026-03-08 02:30:00",
            "2026-03-08T07:30:00.000Z",
        ),
        (
            "America/New_York",
            "2026-11-01 01:30:00",
            "2026-11-01T05:30:00.000Z",
        ),
        (
            "Europe/Berlin",
            "2026-03-29 02:30:00",
            "2026-03-29T01:30:00.000Z",
        ),
        (
            "Europe/Berlin",
            "2026-10-25 02:30:00",
            "2026-10-25T00:30:00.000Z",
        ),
        (
            "Europe/London",
            "2026-03-29 01:30:00",
            "2026-03-29T01:30:00.000Z",
        ),
        (
            "Europe/London",
            "2026-10-25 01:30:00",
            "2026-10-25T00:30:00.000Z",
        ),
        // the wall times whose instant changed with 'compatible' in #402
        (
            "Europe/Amsterdam",
            "2026-10-25 02:30:00",
            "2026-10-25T00:30:00.000Z",
        ),
        (
            "America/New_York",
            "2026-03-08 02:30:00",
            "2026-03-08T07:30:00.000Z",
        ),
        (
            "America/Los_Angeles",
            "2026-03-08 02:30:00",
            "2026-03-08T10:30:00.000Z",
        ),
        (
            "Australia/Sydney",
            "2026-04-05 02:30:00",
            "2026-04-04T15:30:00.000Z",
        ),
        (
            "Australia/Lord_Howe",
            "2026-04-05 01:45:00",
            "2026-04-04T14:45:00.000Z",
        ),
        (
            "Pacific/Chatham",
            "2026-04-05 03:15:00",
            "2026-04-04T13:30:00.000Z",
        ),
        (
            "America/Santiago",
            "2026-09-06 00:30:00",
            "2026-09-06T04:30:00.000Z",
        ),
        (
            "Europe/London",
            "2026-10-25 01:30:00",
            "2026-10-25T00:30:00.000Z",
        ),
        (
            "America/Sao_Paulo",
            "2018-11-04 00:30:00",
            "2018-11-04T03:30:00.000Z",
        ),
        // other wall times as they were
        (
            "America/New_York",
            "2026-07-06 12:00:00",
            "2026-07-06T16:00:00.000Z",
        ),
        (
            "America/New_York",
            "2026-03-08 12:00:00",
            "2026-03-08T16:00:00.000Z",
        ),
        (
            "Europe/Amsterdam",
            "2026-10-25 03:30:00",
            "2026-10-25T02:30:00.000Z",
        ),
    ];
    for (zone, created, expected) in cases {
        assert_eq!(at(created, zone), expected, "{zone} {created}");
    }
}

#[test]
fn offsets_as_intl_takes_them() {
    // Node 24's Intl.DateTimeFormat: a sign (+, - or U+2212) and HH, HHMM or HH:MM, to 23:59
    let taken = [
        ("+01", "2026-11-06T11:00:00.000Z"),
        ("-05", "2026-11-06T17:00:00.000Z"),
        ("+0100", "2026-11-06T11:00:00.000Z"),
        ("+01:00", "2026-11-06T11:00:00.000Z"),
        ("-05:30", "2026-11-06T17:30:00.000Z"),
        ("+0530", "2026-11-06T06:30:00.000Z"),
        ("\u{2212}01:00", "2026-11-06T13:00:00.000Z"),
        ("\u{2212}0530", "2026-11-06T17:30:00.000Z"),
        ("\u{2212}05", "2026-11-06T17:00:00.000Z"),
        ("+23:59", "2026-11-05T12:01:00.000Z"),
        ("-23:59", "2026-11-07T11:59:00.000Z"),
        ("+2359", "2026-11-05T12:01:00.000Z"),
        ("-2359", "2026-11-07T11:59:00.000Z"),
        ("+23", "2026-11-05T13:00:00.000Z"),
        ("-23", "2026-11-07T11:00:00.000Z"),
        ("+00", "2026-11-06T12:00:00.000Z"),
        ("-00:00", "2026-11-06T12:00:00.000Z"),
        ("+14:00", "2026-11-05T22:00:00.000Z"),
        ("+0559", "2026-11-06T06:01:00.000Z"),
        ("+05:59", "2026-11-06T06:01:00.000Z"),
    ];
    for (zone, expected) in taken {
        assert_eq!(at("2026-11-06 12:00:00", zone), expected, "{zone}");
    }
    // refused: one-digit or three-digit hours, 24 hours or 60 minutes, seconds, a prefix, Z,
    // spaces, a lone sign, non-ASCII digits or signs
    let refused = [
        "+1",
        "+1:00",
        "+001:00",
        "+05:3",
        "+01:0",
        "+01:000",
        "+0100:00",
        "+01:",
        "+:00",
        "+24",
        "+24:00",
        "+2400",
        "-2400",
        "+99",
        "+01:60",
        "+0560",
        "+05:60",
        "+01:00:00",
        "+010000",
        "+01:00:30",
        "+01:00:00.0",
        "01:00",
        "Z",
        "z",
        "UTC+1",
        "UTC+01:00",
        "GMT+1",
        "GMT-3",
        " +01:00",
        "+01:00 ",
        "+01:00\n",
        "+",
        "-",
        "\u{2212}",
        "\u{ff0b}01",
        "+\u{661}\u{662}",
        "+01\u{200b}",
        "",
    ];
    for zone in refused {
        assert_eq!(
            read(Some("2026-11-06 12:00:00"), None, zone),
            Err(Error::UnknownTimeZone),
            "{zone:?}"
        );
    }
}

#[test]
fn names_as_intl_takes_them() {
    // case-insensitive, aliases (tzdb's backward links) included
    let taken = [
        ("europe/amsterdam", "2026-11-06T11:00:00.000Z"),
        ("EUROPE/AMSTERDAM", "2026-11-06T11:00:00.000Z"),
        ("UTC", "2026-11-06T12:00:00.000Z"),
        ("utc", "2026-11-06T12:00:00.000Z"),
        ("Etc/UTC", "2026-11-06T12:00:00.000Z"),
        ("GMT", "2026-11-06T12:00:00.000Z"),
        ("Zulu", "2026-11-06T12:00:00.000Z"),
        ("us/pacific", "2026-11-06T20:00:00.000Z"),
        ("Asia/Calcutta", "2026-11-06T06:30:00.000Z"),
        ("America/Montreal", "2026-11-06T17:00:00.000Z"),
        ("Europe/Kiev", "2026-11-06T10:00:00.000Z"),
        ("PRC", "2026-11-06T04:00:00.000Z"),
        ("etc/gmt-14", "2026-11-05T22:00:00.000Z"),
        ("Etc/GMT+12", "2026-11-07T00:00:00.000Z"),
        ("EST", "2026-11-06T17:00:00.000Z"),
        ("MST", "2026-11-06T19:00:00.000Z"),
        ("HST", "2026-11-06T22:00:00.000Z"),
        ("CET", "2026-11-06T11:00:00.000Z"),
        ("WET", "2026-11-06T12:00:00.000Z"),
        ("EST5EDT", "2026-11-06T17:00:00.000Z"),
        ("PST8PDT", "2026-11-06T20:00:00.000Z"),
    ];
    for (zone, expected) in taken {
        assert_eq!(at("2026-11-06 12:00:00", zone), expected, "{zone}");
    }
    // Intl refuses these too: names that aren't zones, the tzdb's Factory, jiff's Etc/Unknown,
    // Etc/GMT past ±14 hours (-12 for +), names with spaces
    let refused = [
        "Mars/Olympus",
        "Factory",
        "factory",
        "Etc/Unknown",
        "ETC/UNKNOWN",
        "Etc/GMT-15",
        "Etc/GMT+13",
        "Asia/Riyadh87",
        " Europe/Amsterdam",
        "Europe/Amsterdam ",
        "Europe/Amster",
    ];
    for zone in refused {
        assert_eq!(
            read(Some("2026-11-06 12:00:00"), None, zone),
            Err(Error::UnknownTimeZone),
            "{zone:?}"
        );
    }
}

#[test]
fn icu_legacy_ids_are_refused() {
    // Intl (ICU) takes these; they aren't in the tz database, so the port refuses them
    // (parity.md: divergent). ICU's IST is Asia/Kolkata and PST America/Los_Angeles with summer
    // time, where the TimeZone column reads IST as ambiguous and PST as -08:00. The IANA name is
    // the way to write them.
    let legacy = [
        "ACT",
        "AET",
        "AGT",
        "ART",
        "AST",
        "BET",
        "BST",
        "CAT",
        "CNT",
        "CST",
        "CTT",
        "EAT",
        "ECT",
        "IET",
        "IST",
        "JST",
        "MIT",
        "NET",
        "NST",
        "PLT",
        "PNT",
        "PRT",
        "PST",
        "SST",
        "VST",
        "ist",
        "US/Pacific-New",
        "Canada/East-Saskatchewan",
        "SystemV/AST4",
        "SystemV/AST4ADT",
        "SystemV/CST6",
        "SystemV/CST6CDT",
        "SystemV/EST5",
        "SystemV/EST5EDT",
        "SystemV/HST10",
        "SystemV/MST7",
        "SystemV/MST7MDT",
        "SystemV/PST8",
        "SystemV/PST8PDT",
        "SystemV/YST9",
        "SystemV/YST9YDT",
    ];
    for zone in legacy {
        let error = read(Some("2026-11-06 12:00:00"), None, zone).unwrap_err();
        assert_eq!(
            (zone, error, error.kind()),
            (zone, Error::UnknownTimeZone, ErrorKind::Range)
        );
    }
    assert_eq!(
        at("2026-11-06 12:00:00", "Asia/Kolkata"),
        "2026-11-06T06:30:00.000Z"
    );
}

#[test]
fn every_bundled_zone_reads_twice_alike() {
    // processor-fx.test.ts reads 100 zones twice, past its formatter cache; zones here come from
    // jiff's cache of parsed zones
    let zones: Vec<&str> = jiff_tzdb::available()
        .filter(|zone| *zone != "Factory")
        .take(100)
        .collect();
    let first: Vec<String> = zones
        .iter()
        .map(|zone| at("2026-07-06 12:00:00", zone))
        .collect();
    for (zone, first) in zones.iter().zip(&first) {
        assert_eq!(&at("2026-07-06 12:00:00", zone), first, "{zone}");
    }
}

/// Where the bundled tzdb (2026f) and Node 24.22.2's (2026e) disagree, so the port can't give the
/// answer the cases record from ducat: (zone, Creation Date, the port's answer with 2026f). Cuba
/// stays on -04 past 1 November 2026 in 2026f.
const TZDB_DIFFERENCES: [(&str, &str, &str); 1] = [(
    "America/Havana",
    "2026-11-01 01:00:00",
    "2026-11-01T05:00:00.000Z",
)];

/// The answer expected for a case from ducat on Node: ducat's, unless the tzdb versions differ.
fn expected<'a>(zone: &str, created: &str, ducat: &'a str) -> &'a str {
    TZDB_DIFFERENCES
        .iter()
        .find(|(z, c, _)| (*z, *c) == (zone, created))
        .map_or(ducat, |&(_, _, port)| port)
}

#[test]
fn zones_and_wall_times_as_ducat_on_node() {
    for &(zone, created, ducat) in CASES {
        assert_eq!(
            at(created, zone),
            expected(zone, created, ducat),
            "{zone} {created}"
        );
    }
    // each difference is in the cases, and is one
    for (zone, created, port) in TZDB_DIFFERENCES {
        let &(_, _, ducat) = CASES
            .iter()
            .find(|(z, c, _)| (*z, *c) == (zone, created))
            .unwrap();
        assert_ne!(ducat, port);
    }
}

/// Every zone Intl lists, from `node scripts/adyen-tz-cases.mjs --all --tsv`, at the path in
/// `DUCAT_ADYEN_TZ_CASES`.
#[test]
#[ignore = "needs DUCAT_ADYEN_TZ_CASES from scripts/adyen-tz-cases.mjs --all --tsv"]
fn every_zone_as_ducat_on_node() {
    use std::io::BufRead;
    let path = std::env::var("DUCAT_ADYEN_TZ_CASES").expect("DUCAT_ADYEN_TZ_CASES");
    let file = std::io::BufReader::new(std::fs::File::open(path).unwrap());
    let (mut cases, mut differ) = (0, 0);
    for line in file.lines() {
        let line = line.unwrap();
        let mut fields = line.split('\t');
        let (Some(zone), Some(created), Some(ducat)) =
            (fields.next(), fields.next(), fields.next())
        else {
            panic!("a malformed line: {line:?}");
        };
        cases += 1;
        let expected = expected(zone, created, ducat);
        let actual = read(Some(created), None, zone)
            .map(|at| at.unwrap_or_else(|| "undefined".into()))
            .unwrap_or_else(|error| format!("{error:?}"));
        if actual != expected {
            differ += 1;
            println!("differs: {zone} {created}: ducat {expected}, port {actual}");
        }
    }
    println!("{cases} cases, {differ} differ");
    assert_eq!(differ, 0);
}
