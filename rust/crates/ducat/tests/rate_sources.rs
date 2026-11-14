//! The rate-source parsers on arbitrary input: never a panic, always `Ok` or `Err`. Random text
//! rarely gets past a header, so the real fixtures are also cut, spliced and sprinkled with
//! multibyte characters, digits and separators. Then a few of ducat's own parser tests, ported.

use ducat::convert::adyen_fx::adyen_rate;
use ducat::convert::boc::{BankOfCanadaOptions, parse_bank_of_canada_json};
use ducat::convert::boe::{BankOfEnglandOptions, parse_bank_of_england_csv};
use ducat::convert::ecb::{
    EcbOptions, EcbSdmxOptions, parse_ecb_csv, parse_ecb_sdmx_csv, parse_ecb_sdmx_decimals,
    parse_ecb_xml,
};
use ducat::convert::fed::parse_fed_h10_csv;
use ducat::convert::history::rate_history;
use ducat::convert::hmrc::{HmrcOptions, parse_hmrc_monthly_csv};
use ducat::convert::stripe_fx::{StripeBalanceTransaction, stripe_rate};
use ducat::convert::{Date, Publication, RateProvider, RateQuery, Time};
use ducat::{CurrencyCode, Error};
use proptest::prelude::*;

fn fixture(path: &str) -> String {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../spec/fixtures");
    std::fs::read_to_string(root.join(path)).unwrap()
}

/// Every parser on `text`; the results are thrown away, a panic fails the test.
fn every_parser(text: &str) {
    let ecb = EcbOptions {
        available_at: Publication::Stated,
    };
    let _ = parse_ecb_xml(text, &ecb);
    let _ = parse_ecb_csv(text, &ecb);
    let _ = parse_ecb_sdmx_decimals(text);
    let _ = parse_ecb_sdmx_csv(text, &EcbSdmxOptions::default());
    let _ = parse_bank_of_canada_json(text, &BankOfCanadaOptions::default());
    let _ = parse_fed_h10_csv(text);
    let _ = parse_bank_of_england_csv(text, &BankOfEnglandOptions { decimals: 30 });
    let _ = parse_hmrc_monthly_csv(text, &HmrcOptions::default());
    let _ = adyen_rate(&[
        ("Gross Currency", "EUR"),
        ("Net Currency", "GBP"),
        ("Exchange Rate", text),
        ("Creation Date", text),
        ("TimeZone", text),
    ]);
    let _ = stripe_rate(
        text,
        &StripeBalanceTransaction {
            amount: 1,
            currency: text,
            exchange_rate: Some(text),
            created: Some(i64::MAX),
        },
    );
}

const FIXTURES: [&str; 11] = [
    "ecb/eurofxref-daily.xml",
    "ecb/eurofxref-hist-2d.xml",
    "ecb/eurofxref.csv",
    "ecb/eurofxref-hist.csv",
    "ecb-sdmx/exr-d-full.csv",
    "ecb-sdmx/exr-d-dataonly.csv",
    "ecb-sdmx/exr-d-nodata.csv",
    "boc/fx-rates-daily.json",
    "fed/h10-daily.csv",
    "boe/spot-sample.csv",
    "hmrc/monthly_csv_2026-11.csv",
];

/// A change to a fixture's text, at char positions.
#[derive(Clone, Debug)]
enum Edit {
    Cut(usize),
    Remove(usize, usize),
    Insert(usize, String),
}

fn apply(text: &str, edits: &[Edit]) -> String {
    let mut chars: Vec<char> = text.chars().collect();
    for edit in edits {
        let length = chars.len().max(1);
        match edit {
            Edit::Cut(at) => chars.truncate(at % length),
            Edit::Remove(at, count) => {
                let start = at % length;
                let end = (start + count % 64).min(chars.len());
                if start < end {
                    chars.drain(start..end);
                }
            }
            Edit::Insert(at, inserted) => {
                let at = (at % length).min(chars.len());
                chars.splice(at..at, inserted.chars());
            }
        }
    }
    chars.into_iter().collect()
}

fn edits() -> impl Strategy<Value = Vec<Edit>> {
    let pieces = prop_oneof![
        Just(String::from(",")),
        Just(String::from("\"")),
        Just(String::from("\n")),
        Just(String::from("é€😀")),
        Just(String::from("{[")),
        Just(String::from("<Cube time='2026-11-06'>")),
        Just(String::from("99999999999999999999999")),
        Just(String::from("N/A")),
        "[0-9.\\-:/ ]{0,6}",
        "\\PC{0,4}",
    ];
    let edit = prop_oneof![
        any::<usize>().prop_map(Edit::Cut),
        (any::<usize>(), any::<usize>()).prop_map(|(at, count)| Edit::Remove(at, count)),
        (any::<usize>(), pieces).prop_map(|(at, text)| Edit::Insert(at, text)),
    ];
    prop::collection::vec(edit, 1..6)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn arbitrary_text_never_panics(text in "\\PC{0,200}") {
        every_parser(&text);
    }

    #[test]
    fn edited_fixtures_never_panic(index in 0..FIXTURES.len(), changes in edits()) {
        every_parser(&apply(&fixture(FIXTURES[index]), &changes));
    }
}

#[test]
fn deep_json_is_an_error() {
    let deep = format!("{}{}", "[".repeat(100_000), "]".repeat(100_000));
    assert_eq!(
        parse_bank_of_canada_json(&deep, &BankOfCanadaOptions::default()).err(),
        Some(Error::MalformedRates)
    );
}

fn time(text: &str) -> Time {
    text.parse().unwrap()
}

#[test]
fn the_ecb_publishes_at_16_00_in_frankfurt() {
    let xml = |day: &str| {
        format!("<Cube><Cube time='{day}'><Cube currency='USD' rate='1.1'/></Cube></Cube>")
    };
    let stated = EcbOptions {
        available_at: Publication::Stated,
    };
    for (day, published) in [
        ("2026-07-01", "2026-07-01T14:00:00.000Z"),
        ("2026-01-05", "2026-01-05T15:00:00.000Z"),
        // the clock-change Sundays are on their new offset by 16:00
        ("2026-03-29", "2026-03-29T14:00:00.000Z"),
        ("2026-10-25", "2026-10-25T15:00:00.000Z"),
    ] {
        let tables = parse_ecb_xml(&xml(day), &stated).unwrap();
        assert_eq!(tables[0].available_at(), Some(time(published)), "{day}");
    }
    let own = |day: Date| Time::Date(day.add_days(1).unwrap());
    let given = EcbOptions {
        available_at: Publication::Given(&own),
    };
    let tables = parse_ecb_xml(&xml("2026-11-06"), &given).unwrap();
    assert_eq!(tables[0].available_at(), Some(time("2026-11-07")));
}

#[test]
fn boc_rates_invert_exactly_and_print_the_published_quote() {
    let json = r#"{"observations":[{"d":"2026-11-06","FXUSDCAD":{"v":"1.3654"}}]}"#;
    let tables = parse_bank_of_canada_json(json, &BankOfCanadaOptions::default()).unwrap();
    let cad = CurrencyCode::iso("CAD").unwrap();
    let usd = CurrencyCode::iso("USD").unwrap();
    let cad_usd = tables[0].rate(cad, usd, &RateQuery::default()).unwrap();
    assert_eq!(cad_usd.to_string(), "5000/6827");
    assert_eq!(cad_usd.inverse().to_string(), "1.3654");
    // 16:30 in Toronto, EST in November
    assert_eq!(tables[0].available_at(), Some(time("2026-11-06T21:30:00Z")));
}

#[test]
fn hmrc_periods_answer_their_whole_month() {
    let tables = parse_hmrc_monthly_csv(
        &fixture("hmrc/monthly_csv_2026-11.csv"),
        &HmrcOptions::default(),
    )
    .unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].available_at(), Some(time("2026-10-22T00:00:00Z")));
    let history = rate_history(tables, 4).unwrap();
    let gbp = CurrencyCode::iso("GBP").unwrap();
    let eur = CurrencyCode::iso("EUR").unwrap();
    let mid_month = history.rate(gbp, eur, &RateQuery::at(time("2026-11-15")));
    assert_eq!(
        mid_month.map(|rate| rate.to_string()),
        Some("1.1930".into())
    );
    assert!(
        history
            .rate(gbp, eur, &RateQuery::at(time("2026-12-01")))
            .is_none()
    );
}
