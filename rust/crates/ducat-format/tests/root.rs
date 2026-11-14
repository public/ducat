//! Every build has root (`und`), whatever its language features: a tag without data formats in
//! root's patterns and symbols, and root's own text parses back.

use ducat::{AnyMoney, CurrencyCode};
use ducat_format::{FormatOptions, Locale, ParseOptions, format, locales, parse};

#[test]
fn root_formats_and_parses_its_own_text() {
    assert!(locales().any(|name| name == "und"));
    let root = Locale::new("und").unwrap();
    assert_eq!(root.data_name(), "und");
    assert!(root.has_data());
    let usd = CurrencyCode::iso("USD").unwrap();
    let amount = AnyMoney::parse("-1234567.89", usd).unwrap();
    let text = format(&amount, &root, &FormatOptions::default()).unwrap();
    assert_eq!(text, "-US$\u{a0}1,234,567.89");
    assert_eq!(
        parse(&text, usd, &root, &ParseOptions::default()).unwrap(),
        amount
    );
    // a language the build doesn't have falls back to root for formatting, but has no data to parse
    let unknown = Locale::new("xx-YY").unwrap();
    assert_eq!(unknown.data_name(), "und");
    assert!(!unknown.has_data());
    assert_eq!(
        format(&amount, &unknown, &FormatOptions::default()).unwrap(),
        text
    );
}
