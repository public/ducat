//! ducat's money JSON for JSON, JSONB and TEXT columns (`jsonToDriver`, `jsonFromDriver`):
//! `{"amount":"12.34","currency":"EUR"}`.

use core::fmt::Write as _;

use serde_json::Value;

use crate::Error;

/// The JSON text ducat's `JSON.stringify(money)` writes: `{"amount":"<amount>","currency":"<code>"}`,
/// in that order, without spaces, the amount a string.
#[must_use]
pub fn write(amount: &str, currency: &str) -> String {
    let mut out = String::with_capacity(amount.len() + currency.len() + 28);
    out.push_str(r#"{"amount":"#);
    push_string(&mut out, amount);
    out.push_str(r#","currency":"#);
    push_string(&mut out, currency);
    out.push('}');
    out
}

/// A JSON string literal, escaped as `JSON.stringify` escapes it.
fn push_string(out: &mut String, text: &str) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if u32::from(c) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", u32::from(c));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// The amount and currency strings of ducat's money JSON, read as `fromJSON` reads the text:
/// any JSON value (`JSON.parse`, where the last of duplicate keys wins), which must be an object
/// whose `amount` and `currency` are strings; other fields are ignored.
///
/// # Errors
///
/// [`Error::Malformed`] for text that isn't JSON (ducat's `SyntaxError`);
/// [`Error::NotMoneyJson`] for JSON that isn't such an object (ducat's `TypeError`).
pub fn read(text: &str) -> Result<(String, String), Error> {
    let value: Value =
        serde_json::from_str(text).map_err(|_| Error::Malformed("text that isn't JSON"))?;
    fields(value)
}

/// As [`read`], for the value of a JSON or JSONB column, which ducat's reference drivers
/// (node-postgres, mysql2) parse before ducat sees it: a JSON string there reaches `fromJSON` as
/// text and is parsed again, so a string holding money JSON reads as that money.
///
/// # Errors
///
/// As [`read`].
pub fn read_parsed(text: &str) -> Result<(String, String), Error> {
    let value: Value =
        serde_json::from_str(text).map_err(|_| Error::Malformed("text that isn't JSON"))?;
    match value {
        Value::String(inner) => read(&inner),
        value => fields(value),
    }
}

fn fields(value: Value) -> Result<(String, String), Error> {
    let Value::Object(mut fields) = value else {
        return Err(Error::NotMoneyJson);
    };
    match (fields.remove("amount"), fields.remove("currency")) {
        (Some(Value::String(amount)), Some(Value::String(currency))) => Ok((amount, currency)),
        _ => Err(Error::NotMoneyJson),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_ducat_s_shape() {
        assert_eq!(
            write("12.34", "EUR"),
            r#"{"amount":"12.34","currency":"EUR"}"#
        );
        assert_eq!(
            write("-0.001", "KWD"),
            r#"{"amount":"-0.001","currency":"KWD"}"#
        );
        assert_eq!(
            write("1", "A\"\\\n\u{1}"),
            r#"{"amount":"1","currency":"A\"\\\n\u0001"}"#
        );
    }

    #[test]
    fn reads_any_object_with_string_fields() {
        let read_ok = |text: &str| read(text).map(|(a, c)| format!("{a} {c}"));
        assert_eq!(
            read_ok(r#"{"amount":"12.34","currency":"EUR"}"#),
            Ok("12.34 EUR".into())
        );
        // Postgres's jsonb order and spacing, extra fields, and the last duplicate
        assert_eq!(
            read_ok(r#" { "currency" : "EUR", "amount" : "1", "note": [1, {"x": null}] } "#),
            Ok("1 EUR".into())
        );
        assert_eq!(
            read_ok(r#"{"amount":"1","amount":"2","currency":"EUR"}"#),
            Ok("2 EUR".into())
        );
        assert_eq!(
            read_ok(r#"{"amount":"1","currency":"EUR"}"#),
            Ok("1 EUR".into())
        );
        for text in [
            "42",
            "null",
            r#""{}""#,
            "[]",
            r#"{"amount":1,"currency":"EUR"}"#,
            r#"{"amount":"1"}"#,
            r#"{"amount":"1","currency":null}"#,
        ] {
            assert_eq!(read(text), Err(Error::NotMoneyJson), "{text}");
        }
        // a JSON string is parsed again from a JSON or JSONB column, as ducat's drivers do
        let inner = r#""{\"amount\":\"1\",\"currency\":\"EUR\"}""#;
        assert_eq!(read(inner), Err(Error::NotMoneyJson));
        assert_eq!(
            read_parsed(inner).map(|(a, c)| format!("{a} {c}")),
            Ok("1 EUR".into())
        );
        assert_eq!(read_parsed(r#""42""#), Err(Error::NotMoneyJson));
        assert!(matches!(read_parsed(r#""{""#), Err(Error::Malformed(_))));
        assert_eq!(read_parsed("42"), Err(Error::NotMoneyJson));
        for text in [
            "",
            "{",
            r#"{"amount":"1","currency":"EUR"} x"#,
            "{'amount':'1'}",
            "NaN",
        ] {
            assert!(matches!(read(text), Err(Error::Malformed(_))), "{text}");
        }
    }
}
