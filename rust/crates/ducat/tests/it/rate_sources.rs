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
use ducat::convert::{Date, Publication, RateInfo, RateProvider, RateQuery, RateTable, Time};
use ducat::{CurrencyCode, Error, ErrorKind};
use proptest::prelude::*;

use crate::common::time;

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

// --- codes the port doesn't know: skipped and listed, never failing the file --------------------

fn known_and_unknown(tables: &[ducat::convert::RateTable]) -> (Vec<String>, Vec<String>) {
    let table = &tables[0];
    let known = table
        .rates()
        .iter()
        .map(|rate| rate.to().to_string())
        .collect();
    (known, table.unknown().to_vec())
}

#[test]
fn an_unknown_code_is_listed_in_every_format() {
    let unknown = vec![String::from("ZZQ")];
    let usd = vec![String::from("USD")];
    let ecb = EcbOptions::default();
    let xml = "<Cube><Cube time='2026-11-06'><Cube currency='USD' rate='1.1'/><Cube currency='ZZQ' rate='2'/></Cube></Cube>";
    assert_eq!(
        known_and_unknown(&parse_ecb_xml(xml, &ecb).unwrap()),
        (usd.clone(), unknown.clone())
    );
    let csv = "Date,USD,ZZQ\n2026-11-06,1.1,2\n";
    assert_eq!(
        known_and_unknown(&parse_ecb_csv(csv, &ecb).unwrap()),
        (usd.clone(), unknown.clone())
    );
    let sdmx = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-11-06,1.1\nEXR.D.ZZQ.EUR.SP00.A,D,ZZQ,EUR,SP00,A,2026-11-06,2\n";
    let tables = parse_ecb_sdmx_csv(sdmx, &EcbSdmxOptions::default()).unwrap();
    assert_eq!(known_and_unknown(&tables), (usd.clone(), unknown.clone()));
    let decimals = parse_ecb_sdmx_decimals("CURRENCY,DECIMALS\nZZQ,4\n").unwrap();
    assert_eq!(decimals, [(String::from("ZZQ"), 4)]);
    let valet =
        r#"{"observations":[{"d":"2026-11-06","FXUSDCAD":{"v":"1.36"},"FXZZQCAD":{"v":"0.5"}}]}"#;
    let tables = parse_bank_of_canada_json(valet, &BankOfCanadaOptions::default()).unwrap();
    assert_eq!(known_and_unknown(&tables), (usd, unknown.clone()));
    let h10 = "\"Unit:\",\"Currency\",\"Currency\"\n\"Multiplier:\",\"1\",\"1\"\n\"Currency:\",\"EUR\",\"ZZQ\"\n\"Time Period\",\"RXI$US_N.B.EU\",\"RXI_N.B.ZQ\"\n2026-11-06,1.1650,7.5\n";
    let tables = parse_fed_h10_csv(h10).unwrap();
    assert_eq!(
        known_and_unknown(&tables),
        (vec![String::from("EUR")], unknown.clone())
    );
    let hmrc = "Country/Territories,Currency,Currency Code,Currency Units per £1,Start date,End date\nEurozone,Euro,EUR,1.1930,01/11/2026,30/11/2026\nNowhere,Zloq,ZZQ,9.5,01/11/2026,30/11/2026\n";
    let tables = parse_hmrc_monthly_csv(hmrc, &HmrcOptions::default()).unwrap();
    assert_eq!(
        known_and_unknown(&tables),
        (vec![String::from("EUR")], unknown.clone())
    );
    // a day of unknown codes only is still a day, as in ducat
    let only = parse_ecb_csv("Date,ZZQ\n2026-11-06,2\n", &ecb).unwrap();
    assert_eq!(
        (only.len(), only[0].rates().len(), only[0].unknown()),
        (1, 0, &unknown[..])
    );
    // the Bank of England's series all map to codes the port knows; an unknown series is an error
    assert!(
        parse_bank_of_england_csv(
            "DATE,XUDLZZQ\n05 Jan 2026,1",
            &BankOfEnglandOptions::default()
        )
        .is_err()
    );
}

#[test]
fn decimals_beyond_30_are_refused() {
    let boe = "DATE,XUDLUSS\n05 Jan 2026,1.25\n";
    assert!(parse_bank_of_england_csv(boe, &BankOfEnglandOptions { decimals: 30 }).is_ok());
    assert_eq!(
        parse_bank_of_england_csv(boe, &BankOfEnglandOptions { decimals: 31 }).err(),
        Some(Error::InvalidDecimals)
    );
    let sdmx = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-11-06,1.1\n";
    let decimals = [(String::from("USD"), 31)];
    let options = EcbSdmxOptions {
        decimals: &decimals,
        ..EcbSdmxOptions::default()
    };
    assert_eq!(
        parse_ecb_sdmx_csv(sdmx, &options).err(),
        Some(Error::InvalidDecimals)
    );
}

#[test]
fn a_stripe_rate_in_exponent_form() {
    let transaction = StripeBalanceTransaction {
        amount: 1,
        currency: "usd",
        exchange_rate: Some("1e-7"),
        created: None,
    };
    let rate = stripe_rate("jpy", &transaction).unwrap().unwrap();
    assert_eq!(rate.to_string(), "0.0000001");
    let long = StripeBalanceTransaction {
        exchange_rate: Some("1.2345678901234567"),
        ..transaction
    };
    assert_eq!(stripe_rate("jpy", &long).err(), Some(Error::TooManyDigits));
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn quotes_never_panic(rate in "\\PC{0,12}|[0-9]{1,6}(\\.[0-9]{0,6})?", per in any::<Option<i64>>(), inverted: bool, decimals in any::<Option<u8>>()) {
        use ducat::convert::history::{QuotedRate, QuotedTableSpec, quoted_table, rate_from_quote};
        use ducat::convert::{RateInfo, RateQuote};
        let eur = CurrencyCode::iso("EUR").unwrap();
        let usd = CurrencyCode::iso("USD").unwrap();
        let quote = RateQuote { rate: rate.clone(), per, inverted };
        if let Ok(built) = rate_from_quote(eur, usd, &quote, RateInfo::default()) {
            // a quote that builds describes its rate, so the inverse is the exact reciprocal
            let back = built.inverse().inverse();
            prop_assert_eq!(back.ratio(), built.ratio());
        }
        let mut spec = QuotedTableSpec::new(eur, RateInfo::default());
        spec.decimals = decimals;
        spec.inverted = inverted;
        spec.rates.push((usd, Some(QuotedRate { rate, per, inverted: None, decimals })));
        let _ = quoted_table(&spec);
    }
}

#[test]
fn a_history_of_an_undated_table_is_a_range_error() {
    // ducat: `rateHistory([table])` with no `asOf` throws
    // `RangeError: rateHistory needs tables with an asOf`, after any dated tables before it
    let eur = CurrencyCode::iso("EUR").unwrap();
    let undated = || RateTable::with_base(eur, RateInfo::default()).build();
    let dated = RateTable::with_base(
        eur,
        RateInfo {
            as_of: Some(time("2026-11-06")),
            ..RateInfo::default()
        },
    )
    .build();
    for tables in [vec![undated()], vec![dated, undated()]] {
        let error = rate_history(tables, 4).err().unwrap();
        assert_eq!(error, Error::UndatedTable);
        assert_eq!(error.kind(), ErrorKind::Range);
        assert_eq!(error.to_string(), "rateHistory needs tables with an asOf");
    }
    // no tables at all is a history that answers nothing, as in ducat
    assert!(rate_history(Vec::new(), 4).is_ok());
}
