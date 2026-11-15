//! What ducat writes through Node 24's `Intl` (ICU 78.3) where no spec vector looks: ICU's own
//! overrides of CLDR's data (data/icu/README.md), currencies with their own pattern in a locale,
//! and tags resolved through likely subtags. Each expected text was printed by ducat's
//! TypeScript `format` on Node 24.22.2, except a name in a locale with its own currency pattern,
//! which follows TR35 (ducat's decision; ICU's code garbles some); each is parsed back where
//! ducat's `parseMoney` reads it.
#![cfg(all(
    feature = "en",
    feature = "fr",
    feature = "my",
    feature = "zh",
    feature = "sr"
))]

use ducat::{AnyMoney, CurrencyCode};
use ducat_format::{
    CurrencyDisplay, CurrencySign, FormatOptions, Locale, ParseMoneyOptions, format, parse_money,
};

fn money(amount: &str, code: &str) -> AnyMoney {
    AnyMoney::parse(amount, CurrencyCode::iso(code).unwrap()).unwrap()
}

fn written(amount: &str, code: &str, tag: &str, options: &FormatOptions) -> String {
    format(&money(amount, code), &Locale::new(tag).unwrap(), options).unwrap()
}

fn read_back(text: &str, code: &str, tag: &str) -> String {
    let mut options = ParseMoneyOptions::default();
    options.hint = Some(CurrencyCode::iso(code).unwrap());
    let found = parse_money(text, &Locale::new(tag).unwrap(), &options).unwrap();
    format!("{} {}", found.to_decimal(), found.currency())
}

fn name() -> FormatOptions {
    FormatOptions::new().display(CurrencyDisplay::Name)
}

fn options(display: CurrencyDisplay, sign: CurrencySign) -> FormatOptions {
    FormatOptions::new().display(display).sign(sign)
}

#[test]
fn applies_icus_overrides() {
    // fr_CH.txt: group ' over CLDR's U+202F
    let text = written("1234.50", "CHF", "fr-CH", &FormatOptions::default());
    assert_eq!(text, "1'234.50\u{a0}CHF");
    assert_eq!(read_back(&text, "CHF", "fr-CH"), "1234.50 CHF");
    // curr/my.txt has no unit patterns, so ICU writes root's {0} {1}, not CLDR's {1} {0}
    let text = written("2.00", "USD", "my", &name());
    assert_eq!(text, "၂.၀၀ အမေရိကန် ဒေါ်လာ");
    let text = written("1234.50", "USD", "my", &FormatOptions::default());
    assert_eq!(read_back(&text, "USD", "my"), "1234.50 USD");
}

#[test]
fn writes_a_currencys_own_pattern() {
    // CLDR's EUR pattern in the European English locales, whatever the display and sign
    let standard = options(CurrencyDisplay::Symbol, CurrencySign::Standard);
    let text = written("-1234.50", "EUR", "en-150", &standard);
    assert_eq!(text, "-€1,234.50");
    assert_eq!(read_back(&text, "EUR", "en-150"), "-1234.50 EUR");
    let accounting = options(CurrencyDisplay::Symbol, CurrencySign::Accounting);
    assert_eq!(
        written("-1234.50", "EUR", "en-150", &accounting),
        "-€1,234.50"
    );
    assert_eq!(
        written("-1234.50", "EUR", "en-150", &name()),
        "-1,234.50 euros"
    );
    let code = options(CurrencyDisplay::Code, CurrencySign::Standard);
    let text = written("-1234.50", "EUR", "en-150", &code);
    assert_eq!(text, "-EUR\u{a0}1,234.50");
    assert_eq!(read_back(&text, "EUR", "en-150"), "-1234.50 EUR");
    let text = written("1234.50", "EUR", "en-AT", &standard);
    assert_eq!(text, "€\u{a0}1.234,50");
    assert_eq!(read_back(&text, "EUR", "en-AT"), "1234.50 EUR");
    assert_eq!(
        written("1234.50", "EUR", "en-AT", &name()),
        "1.234,50 euros"
    );
    assert_eq!(written("1234.50", "EUR", "en-NL", &standard), "€1,234.50");
    // a name follows TR35 there: the locale's decimal and unit patterns, at the amount's scale
    assert_eq!(
        written("1234.567", "KWD", "en-NL", &name()),
        "1,234.567 Kuwaiti dinars"
    );
    assert_eq!(
        written("1234.567", "KWD", "en-150", &name()),
        "1,234.567 Kuwaiti dinars"
    );
    // ICU loads the region's currency's format (EUR's, inherited from en-150) for the locale and
    // writes other currencies in it too; without one (en-150's region has no currency) they keep
    // the locale's pattern
    assert_eq!(written("1234.50", "USD", "en-NL", &standard), "US$1,234.50");
    assert_eq!(
        written("1234.50", "USD", "en-AT", &standard),
        "US$\u{a0}1.234,50"
    );
    assert_eq!(
        written("1234.50", "USD", "en-150", &standard),
        "1,234.50\u{a0}US$"
    );
}

#[test]
fn resolves_tags_by_likely_script() {
    assert_eq!(written("2.00", "EUR", "zh-TW", &name()), "2.00 歐元");
    assert_eq!(written("2.00", "EUR", "zh-HK", &name()), "2.00 歐元");
    assert_eq!(written("2.00", "EUR", "sr-ME", &name()), "2,00 evra");
}
