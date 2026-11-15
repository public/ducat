//! The composite money type: its text against ducat's `parseMoneyComposite` and
//! `toMoneyComposite` (the cases of ducat's test/pg.test.ts), its binary record, and its DDL.

use ducat::iso::{Eur, Kwd};
use ducat::testing::proptest::prelude::*;
use ducat::testing::{CurrencyOptions, MoneyOptions, any_money};
use ducat::{AnyMoney, Money};
use ducat_diesel::pg::{MONEY_TYPE_NAME, MoneyRecord, PgMoney, money_type_sql};
use ducat_diesel::{Decimal, Error};

use diesel::deserialize::FromSql;
use diesel::pg::{Pg, PgValue};
use diesel::sql_types::{Array, Numeric, Record, Text};
use ducat_diesel::pg::sql_types::DucatMoney;

use crate::common::{decimal, iso};
use crate::values::pg::{self, MONEY_OID};

fn record(text: &str) -> Result<MoneyRecord, Error> {
    text.parse()
}

fn money(text: &str) -> Result<AnyMoney, Error> {
    record(text)?.to_money()
}

#[test]
fn reads_at_least_the_currency_exponent() {
    let read = |text: &str| money(text).unwrap().to_string();
    assert_eq!(read("(12,EUR)"), "12.00 EUR");
    assert_eq!(read("(1.5000,EUR)"), "1.5000 EUR");
    assert_eq!(read(r#"(5,"JPY")"#), "5 JPY");
    assert_eq!(read("(1.234,KWD)"), "1.234 KWD");
    assert_eq!(read("(-0.01,EUR)"), "-0.01 EUR");
    assert_eq!(money("(1.5000,EUR)").unwrap().scale(), 4);
}

#[test]
fn refuses_malformed_text_null_fields_and_special_values() {
    for text in [
        "(1,\"EUR)",
        "(1,EUR",
        "1,EUR)",
        "(1,EUR,X)",
        "(1)",
        "()",
        "(1e3,EUR)",
        "",
    ] {
        assert!(matches!(record(text), Err(Error::Malformed(_))), "{text}");
    }
    assert_eq!(record("(,EUR)"), Err(Error::NullField("amount")));
    assert_eq!(record("(1.00,)"), Err(Error::NullField("currency")));
    assert_eq!(record("(NaN,EUR)"), Err(Error::NotANumber));
    assert_eq!(
        record("(Infinity,EUR)"),
        Err(Error::Infinite { negative: false })
    );
    assert_eq!(
        record("(-Infinity,EUR)"),
        Err(Error::Infinite { negative: true })
    );
    assert_eq!(
        money("(1.00,XXX1)"),
        Err(Error::UnknownCurrency("XXX1".into()))
    );
    // an empty quoted currency is a value, not NULL, and no currency
    assert_eq!(
        money(r#"(1.00,"")"#),
        Err(Error::UnknownCurrency(String::new()))
    );
    // a backslash before the closing parenthesis escapes it: the record is unterminated
    assert!(matches!(record(r"(1,EUR\)"), Err(Error::Malformed(_))));
    assert!(matches!(record(r#"(1,"EUR\)"#), Err(Error::Malformed(_))));
}

#[test]
fn quotes_and_escapes_any_code() {
    // toMoneyComposite(money('1', 'A\\B')) is (1.00,"A\\B")
    let backslash = MoneyRecord {
        amount: decimal("1.00"),
        currency: r"A\B".into(),
    };
    assert_eq!(backslash.to_string(), r#"(1.00,"A\\B")"#);
    assert_eq!(
        MoneyRecord::from_money(&"12.34".parse::<Money<Eur>>().unwrap()).to_string(),
        r#"(12.34,"EUR")"#
    );
    for code in [
        r"A\B", r#"Q"X"#, "C,D", "P)Q", "(E)", "", " ", "€", "a\"\\,()",
    ] {
        let original = MoneyRecord {
            amount: decimal("12.34"),
            currency: code.into(),
        };
        assert_eq!(
            record(&original.to_string()).as_ref(),
            Ok(&original),
            "{code}"
        );
    }
    // Postgres's own output doubles quotes and backslashes inside quoted fields
    assert_eq!(record(r#"(1.00,"Q""X")"#).unwrap().currency, r#"Q"X"#);
    assert_eq!(record(r#"(1.00,"A\\B")"#).unwrap().currency, r"A\B");
    // and quotes a field only where it needs to; unquoted backslashes escape too
    assert_eq!(record(r"(1.00,A\,B)").unwrap().currency, "A,B");
    assert_eq!(record(r#"(1.00,E"U"R)"#).unwrap().currency, "EUR");
}

#[test]
fn typed_money_checks_the_currency() {
    let text = "(1.234,KWD)";
    let dinars: Money<Kwd> = record(text).unwrap().to_money().unwrap();
    assert_eq!(dinars.to_string(), "1.234 KWD");
    assert_eq!(
        record(text).unwrap().to_money::<Money<Eur>>(),
        Err(Error::CurrencyMismatch {
            expected: "EUR".into(),
            actual: "KWD".into()
        })
    );
    // custom currencies through a CurrencyCode
    let credits = ducat::CurrencyCode::custom("CREDIT", 4).unwrap();
    let read = record("(2.5,CREDIT)").unwrap();
    assert_eq!(
        read.to_any_money(credits).unwrap().to_string(),
        "2.5000 CREDIT"
    );
    assert!(matches!(
        read.to_any_money(iso("EUR")),
        Err(Error::CurrencyMismatch { .. })
    ));
    assert!(matches!(
        read.to_money::<AnyMoney>(),
        Err(Error::UnknownCurrency(_))
    ));
}

/// The binary record ducat-diesel sends for `(12.34, 'EUR')`, written out: two fields, NUMERIC
/// (OID 1700) with its 12 bytes, TEXT (OID 25) with 3.
const EUR_12_34: [u8; 35] = [
    0, 0, 0, 2, // fields
    0, 0, 0x06, 0xA4, 0, 0, 0, 12, // NUMERIC, 12 bytes
    0, 2, 0, 0, 0, 0, 0, 2, 0, 12, 0x0D, 0x48, // 12.34
    0, 0, 0, 25, 0, 0, 0, 3, // TEXT, 3 bytes
    b'E', b'U', b'R',
];

#[test]
fn binary_records() {
    let price = MoneyRecord {
        amount: decimal("12.34"),
        currency: "EUR".into(),
    };
    let mut bytes = Vec::new();
    price.encode_binary(&mut bytes).unwrap();
    assert_eq!(bytes, EUR_12_34);
    assert_eq!(MoneyRecord::decode_binary(&EUR_12_34).as_ref(), Ok(&price));

    // VARCHAR currencies read too
    let mut varchar = EUR_12_34;
    varchar[26..28].copy_from_slice(&[0x04, 0x13]);
    assert_eq!(MoneyRecord::decode_binary(&varchar).as_ref(), Ok(&price));

    let with = |index: usize, replacement: &[u8]| {
        let mut bytes = EUR_12_34.to_vec();
        bytes.splice(
            index..index + replacement.len(),
            replacement.iter().copied(),
        );
        MoneyRecord::decode_binary(&bytes)
    };
    let malformed = |result: Result<MoneyRecord, Error>| {
        assert!(matches!(result, Err(Error::Malformed(_))), "{result:?}");
    };
    malformed(with(3, &[3]));
    malformed(with(6, &[0, 23])); // an int4 amount
    malformed(with(26, &[0, 20])); // an int8 currency
    malformed(with(32, &[0xFF, 0xFE, 0xFD])); // not UTF-8
    malformed(with(10, &[0, 13])); // the amount runs over
    malformed(with(30, &[0, 4])); // the currency runs over
    malformed(MoneyRecord::decode_binary(&EUR_12_34[..34]));
    malformed(MoneyRecord::decode_binary(
        &[EUR_12_34.as_slice(), &[0]].concat(),
    ));
    malformed(MoneyRecord::decode_binary(&[]));
    malformed(with(8, &[0x80, 0, 0, 0])); // a negative length that isn't NULL
    // NULL fields (length −1)
    let null_amount = [&EUR_12_34[..8], &[0xFF; 4], &EUR_12_34[24..]].concat();
    assert_eq!(
        MoneyRecord::decode_binary(&null_amount),
        Err(Error::NullField("amount"))
    );
    let null_currency = [&EUR_12_34[..28], &[0xFF; 4]].concat();
    assert_eq!(
        MoneyRecord::decode_binary(&null_currency),
        Err(Error::NullField("currency"))
    );
    // a NaN amount
    let nan = [
        &EUR_12_34[..8],
        &[0, 0, 0, 8, 0, 0, 0, 0, 0xC0, 0, 0, 0],
        &EUR_12_34[24..],
    ]
    .concat();
    assert_eq!(MoneyRecord::decode_binary(&nan), Err(Error::NotANumber));
}

#[test]
fn ddl_matches_money_type_sql() {
    let [create_type, add, aggregate] = money_type_sql("billing.amount").unwrap();
    assert_eq!(
        create_type,
        "CREATE TYPE billing.amount AS (amount numeric, currency text)"
    );
    assert!(add.contains("SET search_path FROM CURRENT"));
    assert!(add.contains("::billing.amount"));
    assert!(add.starts_with(
        "CREATE FUNCTION billing.amount_add(total billing.amount, item billing.amount)"
    ));
    assert!(aggregate.starts_with("CREATE AGGREGATE billing.sum(billing.amount)"));
    assert_eq!(
        money_type_sql(MONEY_TYPE_NAME).unwrap()[2],
        "CREATE AGGREGATE sum(ducat_money) (SFUNC = ducat_money_add, STYPE = ducat_money, COMBINEFUNC = ducat_money_add, PARALLEL = SAFE)"
    );
    assert!(money_type_sql(&"x".repeat(59)).is_ok());
    assert!(money_type_sql(&"x".repeat(60)).is_err());
    for name in [
        "Money",
        "a; DROP TABLE x",
        "a.b.c",
        "",
        "1a",
        "a.",
        ".a",
        "ä",
    ] {
        assert!(
            matches!(money_type_sql(name), Err(Error::Malformed(_))),
            "{name}"
        );
    }
}

fn currencies() -> MoneyOptions {
    let codes = ["EUR", "JPY", "KWD", "CLF", "USD"].map(iso);
    MoneyOptions::new()
        .currencies(CurrencyOptions::only(codes))
        .scales(0..=12)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1000))]

    /// ducat's round-trip property: value, currency and scale survive the text and the binary
    /// record, whenever the scale is at least the exponent.
    #[test]
    fn round_trips_value_currency_and_scale(original in any_money(&currencies())) {
        let composite = PgMoney(original.clone());
        let text = composite.to_record().to_string();
        let back: AnyMoney = record(&text).unwrap().to_money().unwrap();
        let mut bytes = Vec::new();
        composite.to_record().encode_binary(&mut bytes).unwrap();
        let binary = PgMoney::<AnyMoney>::from_record(&MoneyRecord::decode_binary(&bytes).unwrap()).unwrap();
        prop_assert!(back.eq_value(&original) && binary.0.eq_value(&original));
        if original.scale() >= u16::from(original.currency().exponent()) {
            prop_assert!(back.identical(&original), "{} from {}", back, text);
            prop_assert!(binary.0.identical(&original));
        } else {
            prop_assert_eq!(back.scale(), u16::from(original.currency().exponent()));
        }
    }

    #[test]
    fn arbitrary_text_never_panics(text in r#"[(),"\\0-9.A-Z\-]{0,24}"#) {
        if let Ok(read) = record(&text) {
            let _ = read.to_money::<AnyMoney>();
            prop_assert_eq!(record(&read.to_string()), Ok(read));
        }
    }

    #[test]
    fn arbitrary_records_never_panic(bytes in prop::collection::vec(any::<u8>(), 0..64)) {
        let _ = MoneyRecord::decode_binary(&bytes);
        let mut prefixed = EUR_12_34[..8].to_vec();
        prefixed.extend_from_slice(&bytes);
        let _ = MoneyRecord::decode_binary(&prefixed);
    }
}

#[test]
fn decimal_and_record_conversions() {
    let price: Money<Eur> = "12.34".parse().unwrap();
    let typed = PgMoney(price.clone());
    assert_eq!(typed.to_record().amount, Decimal::from_money(&price));
    assert_eq!(
        PgMoney::<Money<Eur>>::from_record(&typed.to_record()),
        Ok(typed)
    );
}

#[test]
fn diesel_writes_and_reads_the_record() {
    let price: Money<Eur> = "12.34".parse().unwrap();
    // written through diesel's WriteTuple, with the OID the connection looks the type up by
    let (bytes, oid) = pg::write_typed::<DucatMoney, _>(&PgMoney(price.clone())).unwrap();
    assert_eq!((bytes.as_slice(), oid), (EUR_12_34.as_slice(), MONEY_OID));
    let record = MoneyRecord::from_money(&price);
    assert_eq!(pg::write::<DucatMoney, _>(&record).unwrap(), EUR_12_34);
    // read as the composite type, and as an anonymous record of another name
    assert_eq!(
        pg::read::<DucatMoney, MoneyRecord>(&EUR_12_34, MONEY_OID),
        Ok(record.clone())
    );
    assert_eq!(
        pg::read::<Record<(Numeric, Text)>, MoneyRecord>(&EUR_12_34, 2249),
        Ok(record)
    );
    let typed = pg::read::<DucatMoney, PgMoney<Money<Eur>>>(&EUR_12_34, MONEY_OID).unwrap();
    assert!(typed.0.identical(&price));
    let any = pg::read::<Record<(Numeric, Text)>, PgMoney>(&EUR_12_34, 2249).unwrap();
    assert!(any.0.identical(&AnyMoney::from(price)));
    assert_eq!(
        pg::read::<DucatMoney, PgMoney<Money<Kwd>>>(&EUR_12_34, MONEY_OID),
        Err(Error::CurrencyMismatch {
            expected: "KWD".into(),
            actual: "EUR".into()
        })
    );
    // the reader's errors come through diesel's box intact
    let null_currency = [&EUR_12_34[..28], &[0xFF; 4]].concat();
    assert_eq!(
        pg::read::<DucatMoney, MoneyRecord>(&null_currency, MONEY_OID),
        Err(Error::NullField("currency"))
    );
    assert!(matches!(
        pg::read::<DucatMoney, MoneyRecord>(&EUR_12_34[..30], MONEY_OID),
        Err(Error::Malformed(_))
    ));
    // an amount NUMERIC can't carry is refused on write
    let huge = MoneyRecord {
        amount: Decimal::new(crate::common::pow10(4 * 32768), 0).unwrap(),
        currency: "EUR".into(),
    };
    assert_eq!(pg::write::<DucatMoney, _>(&huge), Err(Error::OutOfRange));
}

#[test]
fn arrays_of_records() {
    // diesel's arrays come with the type: the element OID is the looked-up one
    let prices = vec![
        MoneyRecord::from_money(&"12.34".parse::<Money<Eur>>().unwrap()),
        MoneyRecord::from_money(&"1.234".parse::<Money<Kwd>>().unwrap()),
    ];
    let bytes = pg::write::<Array<DucatMoney>, _>(&prices).unwrap();
    assert_eq!(&bytes[8..12], &MONEY_OID.to_be_bytes());
    let back =
        pg::read::<Array<DucatMoney>, Vec<MoneyRecord>>(&bytes, crate::values::pg::MONEY_ARRAY_OID);
    assert_eq!(back, Ok(prices));
}

/// Why the records are read with this crate's reader: diesel 2.2's `FromSql` for records slices
/// by the length a field claims, and panics when the bytes are shorter. If this starts failing,
/// diesel's reader has become safe on truncated input.
#[test]
fn diesels_own_record_reader_panics_on_a_truncated_record() {
    // the currency claims three bytes and two follow
    let truncated = &EUR_12_34[..34];
    let oid = std::num::NonZeroU32::new(2249).unwrap();
    let result = std::panic::catch_unwind(|| {
        <(Decimal, String) as FromSql<Record<(Numeric, Text)>, Pg>>::from_sql(PgValue::new(
            truncated, &oid,
        ))
    });
    assert!(result.is_err());
    // ours refuses it
    assert!(matches!(
        MoneyRecord::decode_binary(truncated),
        Err(Error::Malformed(_))
    ));
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// The same round trip through diesel's `ToSql` and `FromSql`.
    #[test]
    fn diesel_round_trips(original in any_money(&currencies())) {
        let bytes = pg::write::<DucatMoney, _>(&PgMoney(original.clone())).unwrap();
        let back = pg::read::<DucatMoney, PgMoney>(&bytes, MONEY_OID).unwrap();
        prop_assert!(back.0.eq_value(&original));
        if original.scale() >= u16::from(original.currency().exponent()) {
            prop_assert!(back.0.identical(&original));
        }
    }

    #[test]
    fn arbitrary_records_never_panic_through_diesel(bytes in prop::collection::vec(any::<u8>(), 0..64)) {
        let _ = pg::read::<DucatMoney, MoneyRecord>(&bytes, MONEY_OID);
    }
}
