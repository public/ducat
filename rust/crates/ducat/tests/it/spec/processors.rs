//! The payment-processor tables (spec/README.md, "Payment-processor tables"). Every field is
//! judged exactly, as JSON.

use ducat::processors::{adyen, braintree, checkout, klarna, paypal, stripe};
use ducat::{AnyMoney, CurrencyCode, Error, ErrorKind, Rounding};
use serde_json::{Value, json};

use super::{Fields, RowOp, string};

/// An active ISO code, or a historic one (Braintree's HRK, Stripe's ANG).
fn currency(code: &str) -> Result<CurrencyCode, Error> {
    CurrencyCode::iso(code).or_else(|_| CurrencyCode::historic(code))
}

/// The error kind the spec names.
fn kind(error: &Error) -> Value {
    Value::from(match error.kind() {
        ErrorKind::Rounding => "rounding",
        ErrorKind::Syntax => "syntax",
        ErrorKind::Range => "range",
        other => panic!("unexpected {other:?} error: {error}"),
    })
}

fn rule(row: &Value) -> Fields {
    let code = string(row, "currency");
    let found: Option<(u8, u64, u64)> = match string(row, "processor") {
        "stripe" => stripe::rule(code)
            .map(|rule| (rule.exponent, rule.charge_multiple, rule.payout_multiple)),
        "adyen" => adyen::rule(code).map(|exponent| (exponent, 1, 1)),
        "checkout" => checkout::rule(code)
            .map(|rule| (rule.exponent, rule.multiple, rule.standalone_multiple)),
        "paypal" => paypal::rule(code).map(|exponent| (exponent, 1, 1)),
        "braintree" => braintree::rule(code).map(|exponent| (exponent, 1, 1)),
        "klarna" => klarna::rule(code).map(|exponent| (exponent, 1, 1)),
        other => panic!("unknown processor {other}"),
    };
    let (exponent, multiple, context) = found
        .map_or((Value::Null, Value::Null, Value::Null), |(e, m, c)| {
            (json!(e), json!(m), json!(c))
        });
    vec![
        ("exponent", exponent),
        ("multiple", multiple),
        ("contextMultiple", context),
    ]
}

fn flag(row: &Value, key: &str) -> bool {
    row[key].as_bool().unwrap_or(false)
}

fn to_wire(row: &Value) -> Result<String, Error> {
    let amount = string(row, "amount");
    let places = amount
        .split_once('.')
        .map_or(0, |(_, fraction)| fraction.len());
    let money = AnyMoney::parse_at(
        amount,
        currency(string(row, "currency"))?,
        u16::try_from(places).expect("few places"),
        Rounding::Unnecessary,
    )?;
    let rounding: Rounding = row["rounding"]
        .as_str()
        .unwrap_or("unnecessary")
        .parse()
        .expect("a rounding mode");
    Ok(match string(row, "processor") {
        "stripe" => {
            let options = stripe::StripeOptions {
                payout: flag(row, "payout"),
                rounding,
            };
            money.to_stripe_amount(&options)?.to_string()
        }
        "adyen" => money.to_adyen(rounding)?.value.to_string(),
        "checkout" => {
            let options = checkout::CheckoutOptions {
                standalone: flag(row, "standalone"),
                rounding,
            };
            money.to_checkout_amount(&options)?.to_string()
        }
        "paypal" => money.to_paypal_value(rounding)?,
        "braintree" => money.to_braintree(rounding)?,
        "klarna" => money.to_klarna(rounding)?.to_string(),
        other => panic!("unknown processor {other}"),
    })
}

fn integer(wire: &str) -> Result<i64, Error> {
    wire.parse().map_err(|_| Error::Syntax)
}

fn from_wire(row: &Value) -> Result<AnyMoney, Error> {
    let (processor, code, wire) = (
        string(row, "processor"),
        string(row, "currency"),
        string(row, "wire"),
    );
    // ducat looks currencies up case-insensitively except for Adyen; the Rust functions take a
    // CurrencyCode, so the runner uppercases first, and Adyen's lowercase code fails as unknown
    let code = if processor == "adyen" {
        currency(code)?
    } else {
        currency(&code.to_ascii_uppercase())?
    };
    match processor {
        "stripe" => AnyMoney::from_stripe(integer(wire)?, code),
        "adyen" => AnyMoney::from_adyen(adyen::AdyenAmount {
            value: integer(wire)?,
            currency: code,
        }),
        "checkout" => AnyMoney::from_checkout(integer(wire)?, code),
        "paypal" => AnyMoney::from_paypal(wire, code),
        "braintree" => AnyMoney::from_braintree(wire, code),
        "klarna" => AnyMoney::from_klarna(integer(wire)?, code),
        other => panic!("unknown processor {other}"),
    }
}

fn to_wire_fields(row: &Value) -> Fields {
    match to_wire(row) {
        Ok(wire) => vec![("wire", Value::String(wire)), ("error", Value::Null)],
        Err(error) => vec![("wire", Value::Null), ("error", kind(&error))],
    }
}

fn from_wire_fields(row: &Value) -> Fields {
    match from_wire(row) {
        Ok(money) => vec![
            ("amount", Value::String(money.to_decimal())),
            ("error", Value::Null),
        ],
        Err(error) => vec![("amount", Value::Null), ("error", kind(&error))],
    }
}

pub(super) fn row_op(op: &str) -> Option<RowOp> {
    Some(match op {
        "processor.rule" => rule,
        "processor.toWire" => to_wire_fields,
        "processor.fromWire" => from_wire_fields,
        _ => return None,
    })
}
