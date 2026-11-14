//! Properties beyond the vectors: what `format` writes, `parse` reads back, in every built locale,
//! with every display, sign and rounding; and arbitrary tags, options, amounts and text end in a
//! value or an error, never a panic, in bounded time and output.

use std::time::{Duration, Instant};

use ducat::{AnyMoney, CurrencyCode, Int, MAX_SCALE, Rounding};
use ducat_format::{
    CurrencyDisplay, CurrencySign, Error, FormatOptions, Locale, ParseMoneyOptions, ParseOptions,
    SyntaxError, format, format_to_parts, locales, parse, parse_money,
};
use proptest::prelude::*;

/// Characters in CLDR's currency symbols that ducat's parse refuses around a number.
const REFUSED: [char; 2] = ['/', '\u{dca}'];

/// The most one call may take, a generous bound for the work the limits allow.
const SLOW: Duration = Duration::from_secs(2);

const CURRENCIES: [&str; 10] = [
    "USD", "EUR", "JPY", "KWD", "CHF", "INR", "GBP", "CLF", "BHD", "XOF",
];

fn built() -> Vec<&'static str> {
    locales().collect()
}

fn display() -> impl Strategy<Value = CurrencyDisplay> {
    prop_oneof![
        Just(CurrencyDisplay::Symbol),
        Just(CurrencyDisplay::NarrowSymbol),
        Just(CurrencyDisplay::Code),
        Just(CurrencyDisplay::Name),
    ]
}

fn sign() -> impl Strategy<Value = CurrencySign> {
    prop_oneof![Just(CurrencySign::Standard), Just(CurrencySign::Accounting)]
}

fn rounding() -> impl Strategy<Value = Rounding> {
    prop::sample::select(Rounding::ALL.to_vec())
}

/// An amount in minor units, from zero to beyond 2^64, either sign.
fn units() -> impl Strategy<Value = Int> {
    prop_oneof![
        any::<i32>().prop_map(Int::from),
        any::<i64>().prop_map(Int::from),
        any::<i128>().prop_map(Int::from),
        (any::<i128>(), any::<u64>())
            .prop_map(|(high, low)| { Int::from(high) * Int::from(u128::MAX) + Int::from(low) }),
    ]
}

fn money(code: &str, units: Int, extra_scale: u16) -> AnyMoney {
    let currency = CurrencyCode::iso(code).unwrap();
    AnyMoney::from_units(
        units,
        u16::from(currency.exponent()) + extra_scale,
        currency,
    )
    .unwrap()
}

/// Text from pieces formatting and parsing care about, and anything else.
fn text() -> impl Strategy<Value = String> {
    let piece = prop_oneof![
        Just("1".to_owned()),
        Just("234".to_owned()),
        Just(",".to_owned()),
        Just(".".to_owned()),
        Just("'".to_owned()),
        Just("’".to_owned()),
        Just("\u{a0}".to_owned()),
        Just("\u{202f}".to_owned()),
        Just("\u{200f}".to_owned()),
        Just("٫".to_owned()),
        Just("٬".to_owned()),
        Just("٣".to_owned()),
        Just("۷".to_owned()),
        Just("९".to_owned()),
        Just("-".to_owned()),
        Just("−".to_owned()),
        Just("(".to_owned()),
        Just(")".to_owned()),
        Just("€".to_owned()),
        Just("US$".to_owned()),
        Just("$".to_owned()),
        Just("EUR".to_owned()),
        Just("kr".to_owned()),
        Just("F CFA".to_owned()),
        any::<char>().prop_map(String::from),
        "\\PC{0,6}",
    ];
    prop::collection::vec(piece, 0..24).prop_map(|pieces| pieces.concat())
}

/// A locale tag: built ones, their shapes with other cases and extensions, and anything else.
fn tag() -> impl Strategy<Value = String> {
    let names = built();
    prop_oneof![
        prop::sample::select(names.clone()).prop_map(str::to_owned),
        prop::sample::select(names).prop_map(|name| format!("{}-u-nu-latn", name.to_uppercase())),
        "[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2}|-[0-9]{3})?",
        "[a-zA-Z0-9_-]{0,20}",
        "\\PC{0,12}",
        Just(String::new()),
        (1_usize..400).prop_map(|count| "en-".repeat(count)),
        (1_usize..400).prop_map(|count| "a".repeat(count)),
    ]
}

/// Options in every combination, digits out of range included.
fn options() -> impl Strategy<Value = FormatOptions> {
    let digits = prop_oneof![
        Just(None),
        (0_u16..30).prop_map(Some),
        (0_u16..2000).prop_map(Some)
    ];
    (
        display(),
        sign(),
        digits.clone(),
        prop::option::of(rounding()),
        digits.clone(),
        digits.clone(),
        prop::option::of(0_u16..40),
        prop::option::of(prop_oneof![
            Just(1_u16),
            Just(5),
            Just(25),
            Just(5000),
            0_u16..6000
        ]),
    )
        .prop_map(
            |(display, sign, digits, rounding, minimum, maximum, significant, increment)| {
                let mut options = FormatOptions::new().display(display).sign(sign);
                options.digits = digits;
                options.rounding = rounding;
                options.minimum_fraction_digits = minimum;
                options.maximum_fraction_digits = maximum;
                options.maximum_significant_digits = significant;
                options.rounding_increment = increment;
                options
            },
        )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2048))]

    /// What format writes with a symbol, a narrow symbol or a code, standard or accounting,
    /// parse reads back as the same amount, in every built locale that has data for parsing.
    #[test]
    fn parse_reads_back_what_format_writes(
        name in prop::sample::select(built()),
        code in prop::sample::select(CURRENCIES.to_vec()),
        units in units(),
        extra in 0_u16..4,
        display in prop_oneof![
            Just(CurrencyDisplay::Symbol),
            Just(CurrencyDisplay::NarrowSymbol),
            Just(CurrencyDisplay::Code),
        ],
        sign in sign(),
    ) {
        let locale = Locale::new(name).unwrap();
        let amount = money(code, units, extra);
        let options = FormatOptions::new().display(display).sign(sign);
        let text = format(&amount, &locale, &options).unwrap();
        prop_assume!(locale.has_data());
        let mut read = ParseOptions::default();
        read.scale = Some(amount.scale());
        let back = parse(&text, amount.currency(), &locale, &read);
        // ducat's parse takes letters, currency symbols, spaces, bidi marks, `.`, parentheses and
        // signs around the number, so it refuses symbols with other characters as ducat's
        // TypeScript does (PEN's `S/` in es-PE, PAB's `B/.`, XOF's Sinhala symbol with a virama):
        // see `refuses_symbols_outside_its_affix_characters`
        if REFUSED.iter().any(|ch| text.contains(*ch)) {
            prop_assert_eq!(back, Err(Error::Syntax(SyntaxError::UnexpectedCharacters)));
            return Ok(());
        }
        prop_assert_eq!(back.as_ref(), Ok(&amount), "{} in {}: {:?}", amount.to_decimal(), name, text);
        // the code is unambiguous, so parse_money detects it
        if display == CurrencyDisplay::Code {
            let mut detect = ParseMoneyOptions::default();
            detect.scale = Some(amount.scale());
            let detected = parse_money(&text, &locale, &detect);
            prop_assert_eq!(detected.as_ref(), Ok(&amount), "{} in {}: {:?}", amount.to_decimal(), name, text);
        }
    }

    /// Rounded once with digits, in any mode, the text is that of the amount rounded by ducat.
    #[test]
    fn digits_round_once_as_ducat_does(
        name in prop::sample::select(built()),
        units in units(),
        extra in 0_u16..6,
        digits in 0_u16..8,
        mode in prop::sample::select(Rounding::ALL[..9].to_vec()),
    ) {
        let locale = Locale::new(name).unwrap();
        let amount = money("EUR", units, extra);
        let options = FormatOptions::new().digits(digits, Some(mode));
        let rounded = amount.to_scale(digits, mode).unwrap();
        prop_assert_eq!(
            format(&amount, &locale, &options).unwrap(),
            format(&rounded, &locale, &FormatOptions::default()).unwrap()
        );
    }

    /// Any tag, options and amount give text or an error, quickly; parts join to the text.
    #[test]
    fn format_takes_anything(
        tag in tag(),
        code in prop::sample::select(CURRENCIES.to_vec()),
        units in units(),
        extra in prop_oneof![0_u16..4, Just(MAX_SCALE - 4)],
        options in options(),
    ) {
        let start = Instant::now();
        let Ok(locale) = Locale::new(&tag) else {
            return Ok(());
        };
        let amount = money(code, units, extra);
        match format_to_parts(&amount, &locale, &options) {
            Ok(parts) => {
                let joined: String = parts.iter().map(|part| part.value.as_str()).collect();
                prop_assert_eq!(joined, format(&amount, &locale, &options).unwrap());
                prop_assert!(parts.iter().all(|part| !part.value.is_empty()));
            }
            Err(error) => prop_assert!(matches!(
                error,
                Error::ConflictingOptions | Error::InvalidOptions | Error::Money(_)
            ), "{error:?}"),
        }
        prop_assert!(start.elapsed() < SLOW);
    }

    /// Any text, in any tag, with any options, parses or fails, quickly.
    #[test]
    fn parse_takes_anything(
        tag in tag(),
        input in prop_oneof![text(), "\\PC{0,40}", (0_usize..3000).prop_map(|count| "9".repeat(count))],
        code in prop::sample::select(CURRENCIES.to_vec()),
        lenient in any::<bool>(),
        scale in prop::option::of(prop_oneof![0_u16..8, Just(MAX_SCALE), Just(u16::MAX)]),
        mode in prop::option::of(rounding()),
        hint in prop::option::of(prop::sample::select(CURRENCIES.to_vec())),
    ) {
        let start = Instant::now();
        let Ok(locale) = Locale::new(&tag) else {
            return Ok(());
        };
        let currency = CurrencyCode::iso(code).unwrap();
        let mut options = ParseOptions::default();
        options.scale = scale;
        options.rounding = mode;
        options.lenient = lenient;
        let _ = parse(&input, currency, &locale, &options);
        let symbols = [("F CFA", CurrencyCode::iso("XOF").unwrap())];
        let mut detect = ParseMoneyOptions::default();
        detect.hint = hint.map(|code| CurrencyCode::iso(code).unwrap());
        detect.symbols = &symbols;
        detect.lenient = lenient;
        detect.scale = scale;
        detect.rounding = mode;
        let _ = parse_money(&input, &locale, &detect);
        prop_assert!(start.elapsed() < SLOW);
    }
}

#[test]
fn refuses_text_past_the_limit() {
    let locale = Locale::new("und").unwrap();
    let long = "1".repeat(ducat_format::MAX_INPUT + 1);
    let usd = CurrencyCode::iso("USD").unwrap();
    assert_eq!(
        parse(&long, usd, &locale, &ParseOptions::default()),
        Err(Error::InputTooLong)
    );
    assert_eq!(
        parse_money(&long, &locale, &ParseMoneyOptions::default()),
        Err(Error::InputTooLong)
    );
}

/// ducat's TypeScript refuses these too (Node 24): `parse(format(money('1234.50', 'PEN'), 'es-PE'),
/// 'PEN', 'es-PE')` throws "unexpected characters"; ducat-format keeps to ducat's rule.
#[cfg(all(feature = "es", feature = "si"))]
#[test]
fn refuses_symbols_outside_its_affix_characters() {
    for (amount, code, tag, written) in [
        ("1234.50", "PEN", "es-PE", "S/\u{a0}1,234.50"),
        ("1234.50", "PAB", "es-PA", "B/.\u{a0}1,234.50"),
        ("1234", "XOF", "si", "සිෆ්එ\u{a0}1,234"),
    ] {
        let locale = Locale::new(tag).unwrap();
        let amount = AnyMoney::parse(amount, CurrencyCode::iso(code).unwrap()).unwrap();
        let text = format(&amount, &locale, &FormatOptions::default()).unwrap();
        assert_eq!(text, written);
        assert_eq!(
            parse(&text, amount.currency(), &locale, &ParseOptions::default()),
            Err(Error::Syntax(SyntaxError::UnexpectedCharacters))
        );
    }
}
