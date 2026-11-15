//! Helpers shared by the test modules.

#![allow(dead_code)] // each database module uses its own share

use ducat::{CurrencyCode, Int};
use ducat_sqlx::Decimal;

/// An ISO currency.
pub fn iso(code: &str) -> CurrencyCode {
    CurrencyCode::iso(code).expect("an ISO code")
}

/// An integer from its decimal text.
pub fn int(text: &str) -> Int {
    text.parse().expect("an integer")
}

/// A decimal from its text.
pub fn decimal(text: &str) -> Decimal {
    text.parse().expect("a decimal")
}

/// 10^exponent.
pub fn pow10(exponent: u32) -> Int {
    let mut text = String::from("1");
    text.extend(std::iter::repeat_n('0', exponent as usize));
    int(&text)
}

/// The server URL in `variable`, or `None` to skip; with `DUCAT_REQUIRE_DB=1` a missing URL
/// fails, so CI can't lose its database tests silently.
pub fn database_url(variable: &str) -> Option<String> {
    let url = std::env::var(variable).ok().filter(|url| !url.is_empty());
    if url.is_none() {
        assert!(
            std::env::var("DUCAT_REQUIRE_DB").as_deref() != Ok("1"),
            "DUCAT_REQUIRE_DB=1 but {variable} is not set"
        );
        eprintln!("skipped: set {variable} to run these tests against a server");
    }
    url
}

/// The amounts ducat's TypeScript database suite stores (test/db/suite.ts), with their
/// currencies: zero, negatives, the 2^53 boundary, and BIGINT's limits in cents.
pub const AMOUNTS: [(&str, &str); 11] = [
    ("0.00", "EUR"),
    ("12.34", "EUR"),
    ("-0.01", "EUR"),
    ("1000", "JPY"),
    ("1.234", "KWD"),
    ("90071992547409.91", "EUR"),
    ("90071992547409.93", "EUR"),
    ("-90071992547409.93", "EUR"),
    ("125000000000000.01", "USD"),
    ("92233720368547758.07", "EUR"),
    ("-92233720368547758.08", "EUR"),
];
