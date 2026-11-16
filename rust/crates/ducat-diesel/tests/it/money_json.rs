//! `JsonColumn` without a database: ducat's `moneyJson` (`jsonToDriver`, `jsonFromDriver`), on
//! the spec's vectors (spec/vectors/wire/money-json.json, from scripts/gen-money-json-vectors.py)
//! and ducat's test/sql.test.ts cases.

use ducat::iso::{Bhd, Clf, Eur, Gbp, Jpy, Kwd, Usd};
use ducat::{AnyMoney, Money, Rounding};
use ducat_diesel::{Decimal, Error, JsonColumn};
use serde_json::Value;

use crate::common::iso;

/// The kind the spec names for an error.
fn kind(error: &Error) -> &'static str {
    match error {
        Error::Malformed(_) | Error::Ducat(ducat::Error::Syntax) => "syntax",
        Error::NotMoneyJson => "type",
        Error::UnknownCurrency(_) | Error::ScaleMismatch { .. } => "range",
        Error::Ducat(ducat::Error::Rounding) => "rounding",
        Error::CurrencyMismatch { .. } => "currency-mismatch",
        other => panic!("no spec kind for {other:?}"),
    }
}

/// Runs `$run` with `$m` the `Money<C>` type of the code `$code`.
macro_rules! typed {
    ($code:expr, |$m:ident| $run:expr) => {
        match $code {
            "EUR" => {
                type $m = Money<Eur>;
                $run
            }
            "USD" => {
                type $m = Money<Usd>;
                $run
            }
            "JPY" => {
                type $m = Money<Jpy>;
                $run
            }
            "KWD" => {
                type $m = Money<Kwd>;
                $run
            }
            "BHD" => {
                type $m = Money<Bhd>;
                $run
            }
            "CLF" => {
                type $m = Money<Clf>;
                $run
            }
            "GBP" => {
                type $m = Money<Gbp>;
                $run
            }
            other => panic!("no typed currency for {other}"),
        }
    };
}

fn tables() -> Vec<(String, Vec<Value>)> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../spec/vectors/wire/money-json.json"
    );
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    doc["tables"]
        .as_array()
        .unwrap()
        .iter()
        .map(|table| {
            let op = table["op"].as_str().unwrap().to_owned();
            (op, table["rows"].as_array().unwrap().clone())
        })
        .collect()
}

fn text(row: &Value, field: &str) -> Option<String> {
    row[field].as_str().map(str::to_owned)
}

fn to_row(row: &Value) -> Value {
    let amount = text(row, "amount").unwrap();
    let currency = text(row, "currency").unwrap();
    let scale = amount
        .split_once('.')
        .map_or(0, |(_, fraction)| fraction.len());
    let money = AnyMoney::parse_at(
        &amount,
        iso(&currency),
        u16::try_from(scale).unwrap(),
        Rounding::Unnecessary,
    )
    .unwrap();
    let written = match text(row, "column") {
        None => JsonColumn(money).to_json(),
        // a typed column holds its own currency only: another is refused converting into it
        Some(column) => typed!(column.as_str(), |M| match M::try_from(money) {
            Ok(typed) => JsonColumn(typed).to_json(),
            Err(_) => Err(Error::CurrencyMismatch {
                expected: column.clone(),
                actual: currency.clone(),
            }),
        }),
    };
    match written {
        Ok(wire) => serde_json::json!({ "wire": wire, "error": null }),
        Err(error) => serde_json::json!({ "wire": null, "error": kind(&error) }),
    }
}

fn from_row(row: &Value) -> Value {
    let wire = text(row, "wire").unwrap();
    let read = match text(row, "column") {
        None => JsonColumn::<AnyMoney>::from_json(&wire).map(|column| column.0),
        Some(column) => typed!(column.as_str(), |M| JsonColumn::<M>::from_json(&wire)
            .map(|column| AnyMoney::from(column.0))),
    };
    match read {
        Ok(money) => serde_json::json!({
            "amount": Decimal::from_money(&money).to_string(),
            "currency": money.currency().as_str(),
            "error": null,
        }),
        Err(error) => {
            serde_json::json!({ "amount": null, "currency": null, "error": kind(&error) })
        }
    }
}

#[test]
fn the_spec_s_money_json_vectors() {
    let mut checked = 0;
    let mut failures = Vec::new();
    for (op, rows) in tables() {
        for row in &rows {
            let (actual, fields): (Value, &[&str]) = match op.as_str() {
                "wire.toMoneyJson" => (to_row(row), &["wire", "error"]),
                "wire.fromMoneyJson" => (from_row(row), &["amount", "currency", "error"]),
                other => panic!("unknown operation {other}"),
            };
            if fields.iter().any(|field| actual[field] != row[field]) {
                failures.push(format!("{op} {row} -> got {actual}"));
            }
            checked += 1;
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert_eq!(checked, 180);
}

#[test]
fn ducat_s_sql_test_cases() {
    // test/sql.test.ts: checks a fixed currency on write and on read
    let dollars = AnyMoney::parse("1", iso("USD")).unwrap();
    let text = JsonColumn(dollars).to_json().unwrap();
    assert!(matches!(
        JsonColumn::<Money<Eur>>::from_json(&text),
        Err(Error::CurrencyMismatch { expected, actual }) if expected == "EUR" && actual == "USD"
    ));
    for value in ["42", "null", r#"{"amount":1,"currency":"EUR"}"#] {
        assert_eq!(
            JsonColumn::<Money<Eur>>::from_json(value),
            Err(Error::NotMoneyJson)
        );
    }
    // round-trips at the exponent, BIGINT's limits and beyond
    for (amount, code) in crate::common::AMOUNTS {
        let money = AnyMoney::parse(amount, iso(code)).unwrap();
        let text = JsonColumn(money.clone()).to_json().unwrap();
        assert_eq!(
            text,
            format!(r#"{{"amount":"{amount}","currency":"{code}"}}"#)
        );
        let back = JsonColumn::<AnyMoney>::from_json(&text).unwrap().0;
        assert!(back.identical(&money));
        assert!(
            JsonColumn::<AnyMoney>::from_parsed_json(&text)
                .unwrap()
                .0
                .identical(&money)
        );
    }
    let fine = Money::<Eur>::from_units(1005, 3).unwrap();
    assert_eq!(
        JsonColumn(fine).to_json(),
        Err(Error::ScaleMismatch {
            scale: 3,
            expected: 2
        })
    );
}

#[test]
fn json_and_jsonb_values_parse_a_json_string_again() {
    // node-postgres and mysql2 hand ducat a JSON column's string, which fromJSON parses again
    let inner = r#""{\"amount\":\"1.5\",\"currency\":\"EUR\"}""#;
    assert_eq!(
        JsonColumn::<AnyMoney>::from_json(inner),
        Err(Error::NotMoneyJson)
    );
    let read = JsonColumn::<Money<Eur>>::from_parsed_json(inner).unwrap();
    assert_eq!(read.0.to_string(), "1.50 EUR");
    assert_eq!(
        JsonColumn::<AnyMoney>::from_parsed_json(r#""42""#),
        Err(Error::NotMoneyJson)
    );
    assert!(matches!(
        JsonColumn::<AnyMoney>::from_parsed_json(r#""{""#),
        Err(Error::Malformed(_))
    ));
}

#[test]
fn a_custom_currency_reads_in_its_own_column() {
    ducat::define_currency! {
        /// A custom currency with four decimals.
        pub Points = "POINTS", 4
    }
    let points =
        JsonColumn::<Money<Points>>::from_json(r#"{"amount":"1.5","currency":"POINTS"}"#).unwrap();
    assert_eq!(points.0.scale(), 4);
    assert_eq!(
        points.to_json(),
        Ok(r#"{"amount":"1.5000","currency":"POINTS"}"#.into())
    );
    // without a registry, an untyped column knows ISO codes only
    assert_eq!(
        JsonColumn::<AnyMoney>::from_json(r#"{"amount":"1.5","currency":"POINTS"}"#),
        Err(Error::UnknownCurrency("POINTS".into()))
    );
    assert_eq!(
        JsonColumn::<Money<Points>>::from_json(r#"{"amount":"1","currency":"OTHER"}"#),
        Err(Error::UnknownCurrency("OTHER".into()))
    );
}
