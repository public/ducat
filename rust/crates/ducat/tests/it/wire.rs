//! ducat's own wire tests (test/wire.test.ts), ported where the Rust API has the same shape, and
//! the formats' JSON shapes through serde.

use ducat::iso::{Eur, Jpy, Kwd, Usd};
use ducat::wire::{DineroObject, GoogleMoney, Iso20022Amount, MinorUnitAmount, WireReadOptions};
use ducat::{AnyMoney, Currency, CurrencyCode, Error, Money, Rounding};

use crate::common::EXACT;

fn eur(text: &str) -> Money<Eur> {
    let places = text
        .split_once('.')
        .map_or(0, |(_, fraction)| fraction.len());
    Money::parse_at(text, u16::try_from(places).unwrap(), Rounding::Unnecessary).unwrap()
}

#[test]
fn google_money_splits_into_units_and_nanos_with_one_sign() {
    let negative = eur("-1.75").to_google_money(EXACT).unwrap();
    assert_eq!(negative, GoogleMoney::new("EUR", -1, -750_000_000).unwrap());
    let small = eur("-0.5").to_google_money(EXACT).unwrap();
    assert_eq!((small.units, small.nanos), (0, -500_000_000));
    assert_eq!(
        eur("1.0000000005").to_google_money(EXACT),
        Err(Error::Rounding)
    );
    let rounded = eur("1.0000000005")
        .to_google_money(Rounding::HalfEven)
        .unwrap();
    assert_eq!((rounded.units, rounded.nanos), (1, 0));
    let huge = Money::<Usd>::from_units(9_223_372_036_854_775_808_i128, 0).unwrap();
    assert_eq!(huge.to_google_money(EXACT), Err(Error::Overflow));
}

#[test]
fn google_money_reads_strictly() {
    let options = WireReadOptions::default();
    let read = |units, nanos| {
        GoogleMoney::new("EUR", units, nanos)
            .and_then(|value| Money::<Eur>::from_google_money(&value, &options))
    };
    assert_eq!(read(12, 340_000_000).unwrap().to_string(), "12.34 EUR");
    assert_eq!(read(0, -10_000_000).unwrap().to_string(), "-0.01 EUR");
    assert_eq!(read(1, -1), Err(Error::InvalidWire));
    assert_eq!(read(-1, 1), Err(Error::InvalidWire));
    assert_eq!(read(1, 1_000_000_000), Err(Error::InvalidWire));
    assert_eq!(read(1, 5_000_000), Err(Error::Rounding));
    let three = WireReadOptions {
        scale: Some(3),
        ..WireReadOptions::default()
    };
    let value = GoogleMoney::new("EUR", 1, 5_000_000).unwrap();
    assert_eq!(
        Money::<Eur>::from_google_money(&value, &three)
            .unwrap()
            .to_string(),
        "1.005 EUR"
    );
    assert!(matches!(
        Money::<Usd>::from_google_money(&GoogleMoney::new("EUR", 1, 0).unwrap(), &options),
        Err(Error::CurrencyMismatch { .. })
    ));
    assert_eq!(GoogleMoney::new("eur", 1, 0), Err(Error::InvalidWire));
}

#[test]
fn iso_20022_writes_the_currencys_decimals_and_reads_the_schema_decimal() {
    let written = eur("12.3400").to_iso20022_amount(EXACT, None).unwrap();
    assert_eq!(
        written,
        Iso20022Amount {
            ccy: "EUR".into(),
            value: "12.34".into()
        }
    );
    let yen: Money<Jpy> = "1000".parse().unwrap();
    assert_eq!(yen.to_iso20022_amount(EXACT, None).unwrap().value, "1000");
    assert_eq!(
        eur("-12.34").to_iso20022_amount(EXACT, None),
        Err(Error::InvalidWire)
    );
    assert_eq!(
        eur("12.34").to_iso20022_amount(EXACT, Some(6)),
        Err(Error::InvalidWire)
    );
    assert_eq!(
        eur("12.345").to_iso20022_amount(EXACT, None),
        Err(Error::Rounding)
    );
    let options = WireReadOptions::default();
    let read = |value: &str| {
        Money::<Eur>::from_iso20022_amount(
            &Iso20022Amount {
                ccy: "EUR".into(),
                value: value.into(),
            },
            &options,
        )
    };
    for (text, want) in [
        ("12.34", "12.34"),
        ("0012.3400", "12.34"),
        ("+12.34", "12.34"),
        ("-0", "0.00"),
        ("-0.00", "0.00"),
    ] {
        assert_eq!(read(text).unwrap().to_decimal(), want, "{text}");
    }
    assert_eq!(read("-0.01"), Err(Error::InvalidWire));
    for text in [
        "12.",
        ".5",
        "+.5",
        "-5.",
        "+-1",
        "+",
        "",
        "1e3",
        " 1",
        "1.123456",
        "1111111111111111111",
    ] {
        assert_eq!(read(text), Err(Error::Syntax), "{text:?}");
    }
    let kwd = Iso20022Amount {
        ccy: "KWD".into(),
        value: "1.234".into(),
    };
    assert_eq!(
        Money::<Kwd>::from_iso20022_amount(&kwd, &options)
            .unwrap()
            .to_decimal(),
        "1.234"
    );
    let btc = Iso20022Amount {
        ccy: "BTC".into(),
        value: "1".into(),
    };
    assert_eq!(
        AnyMoney::from_iso20022_amount(&btc, &options),
        Err(Error::UnknownCurrency)
    );
    let hrk = Iso20022Amount {
        ccy: "HRK".into(),
        value: "7.53".into(),
    };
    let kuna = AnyMoney::from_iso20022_amount(&hrk, &options).unwrap();
    assert_eq!(kuna.currency(), CurrencyCode::historic("HRK").unwrap());
}

#[test]
fn minor_units_and_dinero_objects() {
    let minor = eur("12.34").to_minor_units(EXACT).unwrap();
    assert_eq!(
        minor,
        MinorUnitAmount {
            value: 1234,
            currency: "EUR".into()
        }
    );
    assert_eq!(
        Money::<Eur>::from_minor_units(&minor).unwrap(),
        eur("12.34")
    );
    let max = Money::<Usd>::from_minor(9_007_199_254_740_992_i64);
    assert_eq!(max.to_minor_units(EXACT), Err(Error::Overflow));
    let dinero = eur("1.2340").to_dinero_object().unwrap();
    assert_eq!(
        dinero,
        DineroObject {
            amount: 12340,
            currency: "EUR".into(),
            precision: 4
        }
    );
    // dinero.js gives every currency precision 2: ¥5, not ¥500
    let yen = DineroObject {
        amount: 500,
        currency: "JPY".into(),
        precision: 2,
    };
    assert_eq!(
        Money::<Jpy>::from_dinero_object(&yen).unwrap().to_decimal(),
        "5.00"
    );
    let deep = DineroObject {
        precision: 1001,
        ..yen
    };
    assert_eq!(
        AnyMoney::from_dinero_object(&deep),
        Err(Error::InvalidScale)
    );
}

#[test]
fn json_shapes() {
    let google = eur("-1.75").to_google_money(EXACT).unwrap();
    assert_eq!(
        serde_json::to_string(&google).unwrap(),
        r#"{"currencyCode":"EUR","units":"-1","nanos":-750000000}"#
    );
    for text in [
        r#"{"currencyCode":"EUR","units":"-1","nanos":-750000000}"#,
        r#"{"currencyCode":"EUR","units":-1,"nanos":"-75e7"}"#,
        r#"{"currencyCode":"EUR","units":"-1.0","nanos":-7.5e8}"#,
    ] {
        assert_eq!(
            serde_json::from_str::<GoogleMoney>(text).unwrap(),
            google,
            "{text}"
        );
    }
    // a float token past 2^53 − 1 may have lost digits before we see it: refused, as in ducat;
    // the same value as a string, or as an integer token, reads exactly
    assert!(
        serde_json::from_str::<GoogleMoney>(
            r#"{"currencyCode":"EUR","units":12345678901234567890e-1}"#
        )
        .is_err()
    );
    assert!(
        serde_json::from_str::<GoogleMoney>(
            r#"{"currencyCode":"EUR","units":"1234567890123456789e0"}"#
        )
        .is_ok()
    );
    assert!(
        serde_json::from_str::<GoogleMoney>(
            r#"{"currencyCode":"EUR","units":1234567890123456789}"#
        )
        .is_ok()
    );
    for text in [
        r#"{"currencyCode":"EUR","units":"1.5"}"#,
        r#"{"currencyCode":"EUR","units":"+1"}"#,
        r#"{"currencyCode":"EUR","units":"1e999999999"}"#,
        r#"{"currencyCode":"EUR","units":"1","nanos":-1}"#,
        r#"{"units":"1"}"#,
    ] {
        assert!(serde_json::from_str::<GoogleMoney>(text).is_err(), "{text}");
    }
    let zero: GoogleMoney = serde_json::from_str(r#"{"currencyCode":"USD"}"#).unwrap();
    assert_eq!((zero.units, zero.nanos), (0, 0));
    let iso = eur("12.34").to_iso20022_amount(EXACT, None).unwrap();
    assert_eq!(
        serde_json::to_string(&iso).unwrap(),
        r#"{"Ccy":"EUR","value":"12.34"}"#
    );
    let minor: MinorUnitAmount =
        serde_json::from_str(r#"{"value":1234,"currency":"EUR"}"#).unwrap();
    assert_eq!(
        serde_json::to_string(&minor).unwrap(),
        r#"{"value":1234,"currency":"EUR"}"#
    );
    let dinero: DineroObject =
        serde_json::from_str(r#"{"amount":500,"currency":"USD","precision":2}"#).unwrap();
    assert_eq!(
        serde_json::to_string(&dinero).unwrap(),
        r#"{"amount":500,"currency":"USD","precision":2}"#
    );
    assert!(
        serde_json::from_str::<DineroObject>(r#"{"amount":"500","currency":"USD","precision":2}"#)
            .is_err()
    );
}

// --- currencies outside ISO 4217 (ducat's defineCurrency) ----------------------------------------

ducat::define_currency! {
    /// Bitcoin, in satoshis.
    Btc = "BTC", 8
}
ducat::define_currency! {
    /// Loyalty points: a code longer than three letters.
    Points = "POINTS", 0
}
ducat::define_currency! {
    /// Gold, an ISO 4217 code with no minor unit, held to the gram's thousandth.
    Xau = "XAU", 3
}
ducat::define_currency! {
    /// The kuna, withdrawn, held at another exponent than the one it had.
    Kuna = "HRK", 3
}

fn minor(value: i64, currency: &str) -> MinorUnitAmount {
    MinorUnitAmount {
        value,
        currency: currency.into(),
    }
}

fn dinero(amount: i64, currency: &str, precision: u16) -> DineroObject {
    DineroObject {
        amount,
        currency: currency.into(),
        precision,
    }
}

/// Unchecked, so that a code `GoogleMoney::new` refuses reaches the reader.
fn google(currency: &str, units: i64, nanos: i32) -> GoogleMoney {
    GoogleMoney {
        currency_code: currency.into(),
        units,
        nanos,
    }
}

fn iso(currency: &str, value: &str) -> Iso20022Amount {
    Iso20022Amount {
        ccy: currency.into(),
        value: value.into(),
    }
}

#[test]
fn typed_readers_take_their_own_custom_currency() {
    let options = WireReadOptions::default();
    let sat = Money::<Btc>::from_minor_units(&minor(1, "BTC")).unwrap();
    assert_eq!(sat.to_decimal(), "0.00000001");
    let fee = Money::<Btc>::from_dinero_object(&dinero(15, "BTC", 1)).unwrap();
    assert_eq!((fee.to_decimal(), fee.scale()), ("1.5".into(), 1));
    let google_btc = Money::<Btc>::from_google_money(&google("BTC", 1, 500_000_000), &options);
    assert_eq!(google_btc.unwrap().to_decimal(), "1.50000000");
    // ISO 20022 takes ISO 4217 codes only: ducat refuses BTC, defined or not
    assert_eq!(
        Money::<Btc>::from_iso20022_amount(&iso("BTC", "1"), &options),
        Err(Error::UnknownCurrency)
    );

    let points = Money::<Points>::from_dinero_object(&dinero(1, "POINTS", 0)).unwrap();
    assert_eq!(points.to_decimal(), "1");
    let points = Money::<Points>::from_minor_units(&minor(250, "POINTS")).unwrap();
    assert_eq!(points.to_decimal(), "250");
    // google.type.Money's code is three capital letters
    assert_eq!(
        Money::<Points>::from_google_money(&google("POINTS", 1, 0), &options),
        Err(Error::InvalidWire)
    );

    // another currency is still a mismatch, and an undefined one still unknown
    assert_eq!(
        Money::<Btc>::from_minor_units(&minor(1, "EUR")),
        Err(Error::CurrencyMismatch {
            expected: Btc::CODE,
            actual: CurrencyCode::iso("EUR").unwrap(),
        })
    );
    assert_eq!(
        Money::<Btc>::from_minor_units(&minor(1, "ETH")),
        Err(Error::UnknownCurrency)
    );
    assert_eq!(
        Money::<Btc>::from_dinero_object(&dinero(1, "btc", 0)),
        Err(Error::UnknownCurrency)
    );
    assert_eq!(
        Money::<Eur>::from_minor_units(&minor(1, "BTC")),
        Err(Error::UnknownCurrency)
    );
}

#[test]
fn typed_readers_take_a_non_monetary_iso_code() {
    let options = WireReadOptions::default();
    let ounces = Money::<Xau>::from_iso20022_amount(&iso("XAU", "1.5"), &options).unwrap();
    assert_eq!(ounces.to_decimal(), "1.500");
    let ounces = Money::<Xau>::from_minor_units(&minor(1500, "XAU")).unwrap();
    assert_eq!(ounces.to_decimal(), "1.500");
    let ounces = Money::<Xau>::from_dinero_object(&dinero(15, "XAU", 1)).unwrap();
    assert_eq!(ounces.to_decimal(), "1.5");
    let ounces = Money::<Xau>::from_google_money(&google("XAU", 2, 0), &options).unwrap();
    assert_eq!(ounces.to_decimal(), "2.000");
    assert_eq!(
        Money::<Xau>::from_iso20022_amount(&iso("XAU", "1.2345"), &options),
        Err(Error::Rounding)
    );
    // round trip
    assert_eq!(
        ounces.to_iso20022_amount(EXACT, None).unwrap(),
        iso("XAU", "2.000")
    );
    // a withdrawn code held at its own exponent, not the table's
    let kuna = Money::<Kuna>::from_iso20022_amount(&iso("HRK", "7.531"), &options).unwrap();
    assert_eq!(kuna.to_decimal(), "7.531");
    let kuna = Money::<Kuna>::from_minor_units(&minor(7531, "HRK")).unwrap();
    assert_eq!(kuna.to_decimal(), "7.531");
}

#[test]
fn any_readers_take_the_known_currencies() {
    let options = WireReadOptions::default();
    let btc = Btc::CODE;
    let known = [btc, Points::CODE, Xau::CODE];

    for read in [
        AnyMoney::from_minor_units(&minor(1, "BTC")),
        AnyMoney::from_dinero_object(&dinero(1, "POINTS", 0)),
        AnyMoney::from_google_money(&google("BTC", 1, 0), &options),
        AnyMoney::from_iso20022_amount(&iso("XAU", "1"), &options),
        AnyMoney::from_minor_units_with(&minor(1, "ETH"), &known),
        AnyMoney::from_iso20022_amount_with(&iso("BTC", "1"), &options, &known),
        AnyMoney::from_minor_units_with(&minor(1, "BTC"), &[]),
    ] {
        assert_eq!(read, Err(Error::UnknownCurrency));
    }

    let sat = AnyMoney::from_minor_units_with(&minor(1, "BTC"), &known).unwrap();
    assert_eq!(
        (sat.to_decimal(), sat.currency()),
        ("0.00000001".into(), btc)
    );
    let one = AnyMoney::from_minor_units_with(&minor(1, "BTC"), &btc).unwrap();
    assert_eq!(one, sat);
    let points = AnyMoney::from_dinero_object_with(&dinero(1, "POINTS", 0), &known[..]).unwrap();
    assert_eq!(points.currency(), Points::CODE);
    let google_btc =
        AnyMoney::from_google_money_with(&google("BTC", 1, 0), &options, &known).unwrap();
    assert_eq!(google_btc.to_decimal(), "1.00000000");
    let gold = AnyMoney::from_iso20022_amount_with(&iso("XAU", "1"), &options, &known).unwrap();
    assert_eq!(
        (gold.to_decimal(), gold.currency()),
        ("1.000".into(), Xau::CODE)
    );

    // a resolver: the whole crypto table, as ducat's defineCryptoCurrencies
    let crypto = |code: &str| CurrencyCode::crypto(code).ok();
    let eth = AnyMoney::from_minor_units_with(&minor(1, "ETH"), &crypto).unwrap();
    assert_eq!(eth.currency(), CurrencyCode::crypto("ETH").unwrap());
    // an answer for another code is ignored
    let wrong = |_: &str| Some(btc);
    assert_eq!(
        AnyMoney::from_minor_units_with(&minor(1, "ETH"), &wrong),
        Err(Error::UnknownCurrency)
    );

    // ISO codes come first and can't be redefined; a known withdrawn code beats the table's
    let euro = AnyMoney::from_minor_units_with(&minor(1, "EUR"), &known).unwrap();
    assert_eq!(euro.currency(), CurrencyCode::iso("EUR").unwrap());
    let kuna = AnyMoney::from_minor_units_with(&minor(7531, "HRK"), &Kuna::CODE).unwrap();
    assert_eq!(kuna.to_decimal(), "7.531");
    let table = AnyMoney::from_minor_units_with(&minor(753, "HRK"), &known).unwrap();
    assert_eq!(table.currency(), CurrencyCode::historic("HRK").unwrap());
}

#[test]
fn custom_currency_refusals_keep_ducats_order() {
    let options = WireReadOptions::default();
    // ISO 20022: the code's shape, then ISO 4217, then the text, then the sign, then the exponent
    assert_eq!(
        AnyMoney::from_iso20022_amount(&iso("btc", "x"), &options),
        Err(Error::Syntax)
    );
    assert_eq!(
        AnyMoney::from_iso20022_amount(&iso("BTC", "x"), &options),
        Err(Error::UnknownCurrency)
    );
    assert_eq!(
        AnyMoney::from_iso20022_amount(&iso("XAU", "x"), &options),
        Err(Error::Syntax)
    );
    assert_eq!(
        AnyMoney::from_iso20022_amount(&iso("XAU", "-1"), &options),
        Err(Error::InvalidWire)
    );
    // google.type.Money: the whole value is checked before the currency
    assert_eq!(
        AnyMoney::from_google_money(&google("BTC", 1, -1), &options),
        Err(Error::InvalidWire)
    );
    // dinero.js: the precision before the currency
    assert_eq!(
        AnyMoney::from_dinero_object(&dinero(1, "BTC", 1001)),
        Err(Error::InvalidScale)
    );
    assert_eq!(
        Money::<Btc>::from_dinero_object(&dinero(1, "BTC", 1001)),
        Err(Error::InvalidScale)
    );
}
