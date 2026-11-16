//! ducat's Adyen settlement-row tests (test/processor-fx.test.ts), ported: the rate, and Creation
//! Date read with the TimeZone column. The account time zone (`tz`) is in `adyen_tz`.

use ducat::convert::adyen_fx::adyen_rate;
use ducat::convert::{AnyRate, Time};

fn data_row() -> Vec<(String, String)> {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../data");
    let file: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(root.join("adyen-fx.json")).unwrap())
            .unwrap();
    file["vectors"][0]["row"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(column, value)| (column.clone(), value.as_str().unwrap().to_owned()))
        .collect()
}

fn rate(row: &[(&str, &str)]) -> Option<AnyRate> {
    adyen_rate(row).unwrap()
}

pub(crate) fn as_of(rate: &AnyRate) -> Option<String> {
    rate.info().as_of.as_ref().map(Time::to_string)
}

#[test]
fn settlement_details_exchange_rate_gross_to_net() {
    let row = data_row();
    let cells: Vec<(&str, &str)> = row.iter().map(|(c, v)| (c.as_str(), v.as_str())).collect();
    assert_eq!(rate(&cells).unwrap().to_string(), "1");
    let eur_gbp = rate(&[
        ("Creation Date", "2026-11-06 14:03:11"),
        ("Gross Currency", "EUR"),
        ("Net Currency", "GBP"),
        ("Exchange Rate", "0.83415"),
    ])
    .unwrap();
    assert_eq!(
        (
            eur_gbp.from().as_str(),
            eur_gbp.to().as_str(),
            eur_gbp.to_string(),
            eur_gbp.info().source.as_deref(),
            as_of(&eur_gbp).as_deref(),
        ),
        (
            "EUR",
            "GBP",
            "0.83415".into(),
            Some("adyen"),
            Some("2026-11-06")
        )
    );
    assert!(rate(&[("Gross Currency", "EUR")]).is_none());
    assert!(
        rate(&[
            ("Gross Currency", "EUR"),
            ("Net Currency", ""),
            ("Exchange Rate", "1")
        ])
        .is_none()
    );
    assert!(
        rate(&[
            ("Gross Currency", "EUR"),
            ("Net Currency", "GBP"),
            ("Exchange Rate", " ")
        ])
        .is_none()
    );
}

/// Creation Date's `as_of`, read with the TimeZone column `zone`.
pub(crate) fn column_as_of(created: &str, zone: Option<&str>) -> Option<String> {
    let mut row = vec![
        ("Gross Currency", "USD"),
        ("Net Currency", "EUR"),
        ("Exchange Rate", "0.9"),
        ("Creation Date", created),
    ];
    if let Some(zone) = zone {
        row.push(("TimeZone", zone));
    }
    as_of(&rate(&row).unwrap())
}

#[test]
fn creation_date_in_utc_from_the_time_zone_column() {
    let at = |created, zone| column_as_of(created, Some(zone)).unwrap();
    // 23:30 in Los Angeles on the 6th is already the 7th in UTC
    assert_eq!(at("2026-11-06 23:30:00", "PST"), "2026-11-07T07:30:00.000Z");
    assert_eq!(at("2026-11-06 00:30:00", "CET"), "2026-11-05T23:30:00.000Z");
    assert_eq!(at("2026-11-06 12:00", "+05:30"), "2026-11-06T06:30:00.000Z");
    assert_eq!(
        at("2026-11-06 12:00:00", "GMT-3"),
        "2026-11-06T15:00:00.000Z"
    );
    // an ambiguous zone, or an offset no zone has, keeps the local day
    assert_eq!(at("2026-11-06 23:30:00", "IST"), "2026-11-06");
    assert_eq!(at("2026-11-06 23:30:00", "+99"), "2026-11-06");
    assert_eq!(at("2026-11-06 23:30:00", "+05:75"), "2026-11-06");
    // a literal CET in July is taken as +01:00
    assert_eq!(at("2026-07-06 12:00:00", "CET"), "2026-07-06T11:00:00.000Z");
    assert_eq!(
        column_as_of("2026-11-06 12:00:00", None).unwrap(),
        "2026-11-06"
    );
    // test/adyen-fx-dst.test.ts: a numeric offset is taken literally
    assert_eq!(
        at("2026-10-25 02:30:00", "+01:00"),
        "2026-10-25T01:30:00.000Z"
    );
}
