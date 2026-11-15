//! A smoke test against the real endpoints, through ureq. Ignored by default (CI has no
//! network): `cargo test -p ducat-fetch --test it live:: -- --ignored`.

use ducat::convert::Date;
use ducat_fetch::{
    FetchBankOfCanadaOptions, FetchEcbOptions, FetchEcbRangeOptions, UreqTransport,
    fetch_bank_of_canada, fetch_ecb, fetch_ecb_range,
};

#[test]
#[ignore = "needs the network"]
fn the_real_endpoints_answer() {
    let mut transport = UreqTransport::new();
    let daily = fetch_ecb(&mut transport, &FetchEcbOptions::default()).unwrap();
    assert_eq!(daily.len(), 1);
    assert_eq!(daily[0].base().unwrap().to_string(), "EUR");

    let start: Date = "2026-01-02".parse().unwrap();
    let range = FetchEcbRangeOptions {
        end: Some("2026-01-09".parse().unwrap()),
        currencies: &["USD", "JPY"],
        ..FetchEcbRangeOptions::from(start)
    };
    let tables = fetch_ecb_range(&mut transport, &range).unwrap();
    assert!(!tables.is_empty());

    let canada =
        fetch_bank_of_canada(&mut transport, &FetchBankOfCanadaOptions::default()).unwrap();
    assert_eq!(canada.len(), 1);
    assert_eq!(canada[0].base().unwrap().to_string(), "CAD");
}
