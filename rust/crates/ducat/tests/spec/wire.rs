//! The wire formats (spec/README.md, "Wire formats"). Every field is judged exactly, as JSON.

use ducat::wire::{DineroObject, GoogleMoney, Iso20022Amount, MinorUnitAmount, WireReadOptions};
use ducat::{AnyMoney, CurrencyCode, Error, ErrorKind, Rounding};
use serde_json::Value;

use super::{Fields, RowOp, string};

fn outcome(error: &Error) -> Value {
    Value::from(match error.kind() {
        ErrorKind::Rounding => "rounding",
        ErrorKind::Syntax => "syntax",
        ErrorKind::Range => "range",
        other => panic!("unexpected {other:?} error: {error}"),
    })
}

fn result(field: &'static str, result: Result<Value, Error>) -> Fields {
    match result {
        Ok(value) => vec![(field, value), ("error", Value::Null)],
        Err(error) => vec![(field, Value::Null), ("error", outcome(&error))],
    }
}

fn rounding(row: &Value) -> Rounding {
    row["rounding"]
        .as_str()
        .unwrap_or("unnecessary")
        .parse()
        .expect("a rounding mode")
}

/// The row's money: `amount` at the scale its fraction digits give, in `currency` (ISO 4217,
/// current or withdrawn).
fn money(row: &Value) -> AnyMoney {
    let amount = string(row, "amount");
    let code = string(row, "currency");
    let currency = CurrencyCode::iso(code)
        .or_else(|_| CurrencyCode::historic(code))
        .expect("a currency");
    let places = amount
        .split_once('.')
        .map_or(0, |(_, fraction)| fraction.len());
    AnyMoney::parse_at(
        amount,
        currency,
        u16::try_from(places).expect("few"),
        Rounding::Unnecessary,
    )
    .expect("an amount")
}

fn options(row: &Value) -> WireReadOptions {
    let options = &row["options"];
    WireReadOptions {
        scale: options["scale"]
            .as_u64()
            .map(|scale| u16::try_from(scale).expect("a small scale")),
        rounding: options["rounding"]
            .as_str()
            .map_or(Rounding::Unnecessary, |mode| mode.parse().expect("a mode")),
    }
}

fn json<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("serializes")
}

/// The wire value read with serde; a value serde refuses is malformed (a range error, as ducat
/// reports a malformed google.type.Money).
fn read<T: serde::de::DeserializeOwned>(row: &Value) -> Result<T, Error> {
    serde_json::from_value(row["wire"].clone()).map_err(|_| Error::InvalidWire)
}

fn decimal(money: AnyMoney) -> Value {
    Value::String(money.to_decimal())
}

fn to_google(row: &Value) -> Fields {
    result(
        "wire",
        money(row)
            .to_google_money(rounding(row))
            .map(|wire| json(&wire)),
    )
}

fn from_google(row: &Value) -> Fields {
    let money =
        read::<GoogleMoney>(row).and_then(|wire| AnyMoney::from_google_money(&wire, &options(row)));
    result("amount", money.map(decimal))
}

fn to_iso(row: &Value) -> Fields {
    let scale = row["writeScale"]
        .as_u64()
        .map(|scale| u16::try_from(scale).expect("a small scale"));
    result(
        "wire",
        money(row)
            .to_iso20022_amount(rounding(row), scale)
            .map(|wire| json(&wire)),
    )
}

fn from_iso(row: &Value) -> Fields {
    let money = read::<Iso20022Amount>(row)
        .and_then(|wire| AnyMoney::from_iso20022_amount(&wire, &options(row)));
    result("amount", money.map(decimal))
}

fn to_minor(row: &Value) -> Fields {
    result(
        "wire",
        money(row)
            .to_minor_units(rounding(row))
            .map(|wire| json(&wire)),
    )
}

fn from_minor(row: &Value) -> Fields {
    let money = read::<MinorUnitAmount>(row).and_then(|wire| AnyMoney::from_minor_units(&wire));
    result("amount", money.map(decimal))
}

fn to_dinero(row: &Value) -> Fields {
    result(
        "wire",
        money(row).to_dinero_object().map(|wire| json(&wire)),
    )
}

fn from_dinero(row: &Value) -> Fields {
    let money = read::<DineroObject>(row).and_then(|wire| AnyMoney::from_dinero_object(&wire));
    result("amount", money.map(decimal))
}

pub(super) fn row_op(op: &str) -> Option<RowOp> {
    Some(match op {
        "wire.toGoogle" => to_google,
        "wire.fromGoogle" => from_google,
        "wire.toIso20022" => to_iso,
        "wire.fromIso20022" => from_iso,
        "wire.toMinorUnits" => to_minor,
        "wire.fromMinorUnits" => from_minor,
        "wire.toDinero" => to_dinero,
        "wire.fromDinero" => from_dinero,
        _ => return None,
    })
}
