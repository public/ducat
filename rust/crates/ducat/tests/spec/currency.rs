//! The currency data and cash tables (spec/README.md, "Currency data and cash tables"). Every
//! field is judged exactly, as JSON.

use ducat::cash::{CashOptions, cash_digits, cash_policy, cash_rule, cash_unit, cldr_cash};
use ducat::currencies::{currency_from_numeric, minor_unit, numeric_code};
use ducat::territories::{TerritoryOptions, currency_territories, territory_currencies};
use ducat::{AnyMoney, CurrencyCode, Error, ErrorKind, Rounding, crypto, historic};
use serde_json::{Value, json};

use super::{Fields, RowOp, kind_name, string};

fn error_text(error: &Error) -> Value {
    Value::String(format!("error {} ({error})", kind_name(error.kind())))
}

/// A result, or `null` for an error of `kind`.
fn field(result: Result<Value, Error>, kind: ErrorKind) -> Value {
    match result {
        Ok(value) => value,
        Err(error) if error.kind() == kind => Value::Null,
        Err(error) => error_text(&error),
    }
}

fn optional(value: Option<&str>) -> Value {
    value.map_or(Value::Null, |text| Value::String(text.to_owned()))
}

/// A decimal in major units at the scale its fraction digits give.
fn money_at(amount: &str, currency: CurrencyCode) -> Result<AnyMoney, Error> {
    let places = amount
        .split_once('.')
        .map_or(0, |(_, fraction)| fraction.len());
    AnyMoney::parse_at(
        amount,
        currency,
        u16::try_from(places).expect("few places"),
        Rounding::Unnecessary,
    )
}

fn figures(row: &Value) -> Fields {
    let code = string(row, "code");
    let active = CurrencyCode::iso(code).ok();
    let iso = numeric_code(code).map_or(Value::Null, |numeric| {
        json!({ "exponent": active.map(|currency| currency.exponent()), "numeric": numeric })
    });
    let old = historic::currency(code).map_or(Value::Null, |entry| {
        json!({
            "exponent": entry.exponent(),
            "name": entry.name(),
            "numeric": entry.numeric(),
            "withdrawn": entry.withdrawn(),
        })
    });
    let cldr = cldr_cash(code).map_or(Value::Null, |entry| {
        json!({ "digits": entry.digits, "cashDigits": entry.cash_digits, "cashRounding": entry.cash_rounding })
    });
    let minor = active.map_or(Value::Null, |currency| {
        Value::String(minor_unit(currency).to_decimal())
    });
    vec![
        ("iso", iso),
        ("historic", old),
        ("cldr", cldr),
        ("minorUnit", minor),
    ]
}

fn from_numeric(row: &Value) -> Fields {
    let currency = match currency_from_numeric(string(row, "numeric")) {
        Ok(code) => optional(code),
        Err(error) if error.kind() == ErrorKind::Range => Value::String("throws".into()),
        Err(error) => error_text(&error),
    };
    vec![("currency", currency)]
}

fn territory_options(row: &Value) -> TerritoryOptions<'_> {
    TerritoryOptions {
        on: row.get("on").and_then(Value::as_str),
        include_non_tender: row.get("includeNonTender").and_then(Value::as_bool) == Some(true),
    }
}

fn territory(row: &Value) -> Fields {
    let uses = territory_currencies(string(row, "territory"), &territory_options(row)).map(|uses| {
        uses.iter()
            .map(|use_| json!({ "currency": use_.currency, "from": use_.from, "to": use_.to, "tender": use_.tender }))
            .collect()
    });
    vec![("currencies", field(uses, ErrorKind::Range))]
}

fn territories(row: &Value) -> Fields {
    let result = currency_territories(string(row, "currency"), &territory_options(row))
        .map(|territories| json!(territories));
    vec![("territories", field(result, ErrorKind::Range))]
}

fn crypto_unit(row: &Value) -> Fields {
    let unit = crypto::unit(string(row, "code")).map_or(Value::Null, |unit| {
        json!({
            "name": unit.name(),
            "decimals": unit.decimals(),
            "baseUnit": unit.base_unit(),
            "network": unit.network(),
            "contract": unit.contract(),
        })
    });
    vec![("unit", unit)]
}

fn to_base_units(row: &Value) -> Fields {
    let result = (|| {
        let money = money_at(
            string(row, "amount"),
            CurrencyCode::crypto(string(row, "code"))?,
        )?;
        Ok(Value::String(money.to_base_units()?.to_string()))
    })();
    vec![("baseUnits", field(result, ErrorKind::Rounding))]
}

fn from_base_units(row: &Value) -> Fields {
    let result = (|| {
        let currency = CurrencyCode::crypto(string(row, "code"))?;
        Ok(Value::String(
            AnyMoney::from_base_units(string(row, "units"), currency)?.to_decimal(),
        ))
    })();
    vec![("amount", field(result, ErrorKind::Syntax))]
}

fn cash_options(row: &Value) -> CashOptions<'_> {
    CashOptions {
        country: row.get("country").and_then(Value::as_str),
        rounding: row
            .get("rounding")
            .and_then(Value::as_str)
            .map(|mode| mode.parse().expect("a rounding mode")),
        verified_only: row.get("includeUnverified").and_then(Value::as_bool) == Some(false),
    }
}

fn rule(row: &Value) -> Fields {
    let run = || -> Result<Fields, Error> {
        let currency = CurrencyCode::iso(string(row, "currency"))?;
        let options = cash_options(row);
        // the rule that applies: cash_rule's, unless it is unverified and only verified rules count
        let found = cash_rule(currency, options.country)
            .filter(|rule| rule.verified() || !options.verified_only);
        let rule_field = found.map_or(Value::Null, |rule| {
            json!({
                "increment": rule.increment(),
                "countries": rule.countries(),
                "verified": rule.verified(),
                "rounding": rule.rounding().name(),
            })
        });
        let policy = field(
            cash_policy(currency, &options).map(|policy| {
                json!({
                    "scale": policy.scale(),
                    "increment": policy.increment(),
                    "rounding": policy.mode().name(),
                })
            }),
            ErrorKind::Range,
        );
        Ok(vec![
            ("rule", rule_field),
            (
                "cashUnit",
                Value::String(cash_unit(currency, &options).to_decimal()),
            ),
            ("cashDigits", json!(cash_digits(currency, &options))),
            ("policy", policy),
        ])
    };
    run().unwrap_or_else(|error| vec![("rule", error_text(&error))])
}

fn round(row: &Value) -> Fields {
    let run = || -> Result<Fields, Error> {
        let currency = CurrencyCode::iso(string(row, "currency"))?;
        let amount = money_at(string(row, "amount"), currency)?;
        let options = cash_options(row);
        let policy = cash_policy(currency, &options)
            .and_then(|policy| amount.round(policy))
            .map(|money| Value::String(money.to_decimal()));
        Ok(vec![
            (
                "cashRound",
                Value::String(amount.cash_round(&options)?.to_decimal()),
            ),
            ("policy", field(policy, ErrorKind::Range)),
        ])
    };
    run().unwrap_or_else(|error| vec![("cashRound", error_text(&error))])
}

pub(super) fn row_op(op: &str) -> Option<RowOp> {
    Some(match op {
        "currency.figures" => figures,
        "currency.fromNumeric" => from_numeric,
        "territory.currencies" => territory,
        "currency.territories" => territories,
        "crypto.unit" => crypto_unit,
        "crypto.toBaseUnits" => to_base_units,
        "crypto.fromBaseUnits" => from_base_units,
        "cash.rule" => rule,
        "cash.round" => round,
        _ => return None,
    })
}
