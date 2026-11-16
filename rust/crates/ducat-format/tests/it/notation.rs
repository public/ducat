//! Compact, scientific and engineering notation, numbering systems and the locale matcher. The
//! expected texts are ducat's on Node 24 (ICU 78.3).

use ducat::{AnyMoney, CurrencyCode, Rounding};
use ducat_format::{
    CompactDisplay, CurrencyDisplay, Error, FormatOptions, Locale, LocaleMatcher, Notation,
    PartKind, format, format_to_parts,
};

fn amount(text: &str, code: &str) -> AnyMoney {
    let scale = text
        .split_once('.')
        .map_or(0, |(_, fraction)| fraction.len());
    AnyMoney::parse_at(
        text,
        CurrencyCode::iso(code).unwrap(),
        u16::try_from(scale).unwrap(),
        Rounding::Unnecessary,
    )
    .unwrap()
}

fn text(value: &str, code: &str, tag: &str, options: &FormatOptions) -> String {
    format(&amount(value, code), &Locale::new(tag).unwrap(), options).unwrap()
}

fn compact() -> FormatOptions {
    FormatOptions::new().notation(Notation::Compact)
}

fn long_name() -> FormatOptions {
    compact()
        .display(CurrencyDisplay::Name)
        .compact_display(CompactDisplay::Long)
}

#[test]
fn abbreviates_by_the_locales_compact_patterns() {
    assert_eq!(text("1234.50", "USD", "en", &compact()), "$1.23K");
    // rounded up to the next magnitude: scaled again
    assert_eq!(text("999999.99", "USD", "en", &compact()), "$1.00M");
    assert_eq!(
        text("1234.50", "USD", "en", &long_name()),
        "1.23 thousand US dollars"
    );
    // de has no abbreviation for thousands: the standard pattern, grouped as min2
    assert_eq!(
        text("1234.50", "EUR", "de-DE", &compact()),
        "1234,50\u{a0}€"
    );
    assert_eq!(
        text("1500000.00", "EUR", "de-DE", &compact()),
        "1,50\u{a0}Mio.\u{a0}€"
    );
    assert_eq!(
        text("1234567.89", "INR", "hi-IN", &compact()),
        "₹12.35\u{a0}लाख"
    );
    // CLDR's explicit 1 form, for a positive mantissa only
    assert_eq!(
        text("1000", "JPY", "fr", &long_name()),
        "mille yens japonais"
    );
    assert_eq!(
        text("-1000", "JPY", "fr", &long_name()),
        "-1 millier yens japonais"
    );
    // a compact pattern's negative subpattern
    assert_eq!(
        text("-1234.56", "KES", "sw-KE", &long_name()),
        "shilingi za Kenya elfu -1.23"
    );
    let parts = format_to_parts(
        &amount("1234.50", "USD"),
        &Locale::new("fr").unwrap(),
        &compact(),
    )
    .unwrap();
    let kinds: Vec<(PartKind, &str)> = parts
        .iter()
        .map(|part| (part.kind, part.value.as_str()))
        .collect();
    assert_eq!(
        kinds,
        [
            (PartKind::Integer, "1"),
            (PartKind::Decimal, ","),
            (PartKind::Fraction, "23"),
            (PartKind::Literal, "\u{a0}"),
            (PartKind::Compact, "k"),
            (PartKind::Literal, "\u{a0}"),
            (PartKind::Currency, "$US"),
        ]
    );
}

#[test]
fn writes_scientific_and_engineering_notation() {
    let scientific = FormatOptions::new().notation(Notation::Scientific);
    assert_eq!(text("-0.001234", "USD", "en", &scientific), "-$1.234000E-3");
    let parts = format_to_parts(
        &amount("-0.001234", "USD"),
        &Locale::new("en").unwrap(),
        &scientific,
    )
    .unwrap();
    let kinds: Vec<PartKind> = parts.iter().map(|part| part.kind).collect();
    assert_eq!(
        kinds,
        [
            PartKind::MinusSign,
            PartKind::Currency,
            PartKind::Integer,
            PartKind::Decimal,
            PartKind::Fraction,
            PartKind::ExponentSeparator,
            PartKind::ExponentMinusSign,
            PartKind::ExponentInteger,
        ]
    );
    let engineering = FormatOptions::new().notation(Notation::Engineering);
    assert_eq!(
        text("123456.00", "EUR", "ar-EG", &engineering),
        "\u{200f}١٢٣٫٤٦أس٣\u{a0}€"
    );
}

#[test]
fn takes_the_numbering_system_of_the_option_or_the_tag() {
    let none = FormatOptions::new();
    assert_eq!(
        text("-1234567.50", "EUR", "ar-EG-u-nu-latn", &none),
        "\u{200f}\u{200e}-1,234,567.50\u{a0}€"
    );
    assert_eq!(
        Locale::new("ar-EG-u-nu-latn").unwrap().numbering_system(),
        "latn"
    );
    assert_eq!(Locale::new("ar-EG").unwrap().numbering_system(), "arab");
    // an unsupported -u-nu- is ignored
    assert_eq!(
        Locale::new("ar-EG-u-nu-roman").unwrap().numbering_system(),
        "arab"
    );
    // the option over the tag's
    assert_eq!(
        text(
            "-1234567.50",
            "EUR",
            "ar-EG-u-nu-latn",
            &FormatOptions::new().numbering_system("arab")
        ),
        "\u{61c}-\u{200f}١٬٢٣٤٬٥٦٧٫٥٠\u{a0}€"
    );
    assert_eq!(
        text(
            "1234567.50",
            "THB",
            "th-TH",
            &compact().numbering_system("thai")
        ),
        "฿๑.๒๓M"
    );
    // any numeric system, in latn's patterns where the locale has no data for it
    assert_eq!(
        text(
            "1234567.50",
            "EUR",
            "en",
            &FormatOptions::new().numbering_system("deva")
        ),
        "€१,२३४,५६७.५०"
    );
    // an algorithmic one is ignored, a malformed one refused
    assert_eq!(
        text(
            "1234567.50",
            "EUR",
            "en",
            &FormatOptions::new().numbering_system("roman")
        ),
        "€1,234,567.50"
    );
    for malformed in ["ab", "latn-x", "", "abcdefghi", "latn_x"] {
        assert_eq!(
            format(
                &amount("1.00", "EUR"),
                &Locale::new("en").unwrap(),
                &FormatOptions::new().numbering_system(malformed)
            ),
            Err(Error::InvalidOptions),
            "{malformed:?}"
        );
    }
}

#[test]
fn matches_locales_alike_with_either_matcher() {
    assert_eq!("lookup".parse(), Ok(LocaleMatcher::Lookup));
    assert_eq!("best fit".parse(), Ok(LocaleMatcher::BestFit));
    assert_eq!(
        "Lookup".parse::<LocaleMatcher>(),
        Err(Error::InvalidOptions)
    );
    for tag in [
        "zh-TW",
        "de-XX",
        "en-001",
        "ar-EG-u-nu-latn",
        "pt-AO",
        "es-419",
    ] {
        let lookup = Locale::with_matcher(tag, LocaleMatcher::Lookup).unwrap();
        let best = Locale::with_matcher(tag, LocaleMatcher::BestFit).unwrap();
        assert_eq!(lookup.data_name(), best.data_name(), "{tag}");
        assert_eq!(lookup.numbering_system(), best.numbering_system(), "{tag}");
    }
    // Node's lookup takes zh-TW to its alias, zh-Hant-TW's data
    assert_eq!(
        text("1234567.50", "TWD", "zh-TW", &FormatOptions::new()),
        "$1,234,567.50"
    );
    assert_eq!(
        Locale::with_matcher("zh-TW", LocaleMatcher::Lookup)
            .unwrap()
            .data_name(),
        "zh-Hant"
    );
}

#[test]
fn reads_intl_names() {
    assert_eq!("compact".parse(), Ok(Notation::Compact));
    assert_eq!("engineering".parse(), Ok(Notation::Engineering));
    assert_eq!("Compact".parse::<Notation>(), Err(Error::InvalidOptions));
    assert_eq!("long".parse(), Ok(CompactDisplay::Long));
    assert_eq!("x".parse::<CompactDisplay>(), Err(Error::InvalidOptions));
}
