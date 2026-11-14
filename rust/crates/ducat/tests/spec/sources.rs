//! The rate-source parsers (spec/README.md, "Rate sources"). Every field is judged exactly, as
//! JSON.

use ducat::convert::adyen_fx::adyen_rate;
use ducat::convert::boc::{BankOfCanadaOptions, parse_bank_of_canada_json};
use ducat::convert::boe::{BankOfEnglandOptions, parse_bank_of_england_csv};
use ducat::convert::ecb::{
    EcbOptions, EcbSdmxOptions, parse_ecb_csv, parse_ecb_sdmx_csv, parse_ecb_sdmx_decimals,
    parse_ecb_xml,
};
use ducat::convert::fed::parse_fed_h10_csv;
use ducat::convert::history::{rate_from_quote, rate_history};
use ducat::convert::hmrc::{HmrcOptions, parse_hmrc_monthly_csv};
use ducat::convert::stripe_fx::{StripeBalanceTransaction, stripe_implied_rate, stripe_rate};
use ducat::convert::{Publication, RateQuery, RateQuote, RateTable};
use ducat::{AnyMoney, CurrencyCode, Error, ErrorKind, Rounding};
use serde_json::{Value, json};

use super::rates::{info, rate_json, time};
use super::{Fields, RowOp, spec_dir, string};

fn fixture(path: &str) -> String {
    std::fs::read_to_string(spec_dir().join("fixtures").join(path)).expect("a fixture")
}

fn source_text(row: &Value) -> String {
    row.get("fixture")
        .and_then(Value::as_str)
        .map_or_else(|| string(row, "text").to_owned(), fixture)
}

fn outcome(error: &Error) -> Value {
    Value::from(match error.kind() {
        ErrorKind::Syntax => "syntax",
        ErrorKind::Range => "range",
        other => panic!("unexpected {other:?} error: {error}"),
    })
}

fn fields(nulls: &[&'static str], result: Result<Fields, Error>) -> Fields {
    match result {
        Ok(mut fields) => {
            fields.push(("error", Value::Null));
            fields
        }
        Err(error) => {
            let mut fields: Fields = nulls.iter().map(|name| (*name, Value::Null)).collect();
            fields.push(("error", outcome(&error)));
            fields
        }
    }
}

/// `true` is the source's stated time, `false` none, absent the parser's default.
fn publication(options: &Value, default: Publication<'static>) -> Publication<'static> {
    match options["availableAt"].as_bool() {
        Some(true) => Publication::Stated,
        Some(false) => Publication::Unknown,
        None => default,
    }
}

/// A code a row asks about: ISO 4217, withdrawn, or (for a pair no table quotes, XAU or XYZ)
/// custom.
fn code(text: &str) -> CurrencyCode {
    CurrencyCode::iso(text)
        .or_else(|_| CurrencyCode::historic(text))
        .or_else(|_| CurrencyCode::custom(text, 0))
        .expect("a currency")
}

fn parse(row: &Value) -> Result<Vec<RateTable>, Error> {
    let text = source_text(row);
    let options = &row["options"];
    match string(row, "parser") {
        "ecbXml" | "ecbCsv" => {
            let options = EcbOptions {
                available_at: publication(options, Publication::Unknown),
            };
            if string(row, "parser") == "ecbXml" {
                parse_ecb_xml(&text, &options)
            } else {
                parse_ecb_csv(&text, &options)
            }
        }
        "ecbSdmx" => {
            let decimals = match (options.get("decimalsFrom"), options.get("decimals")) {
                (Some(from), _) => {
                    parse_ecb_sdmx_decimals(&fixture(from.as_str().expect("a path")))?
                }
                (None, Some(pairs)) => pairs
                    .as_array()
                    .expect("pairs")
                    .iter()
                    .map(|pair| {
                        let places =
                            u8::try_from(pair[1].as_u64().expect("decimals")).expect("few");
                        (code(pair[0].as_str().expect("a code")), places)
                    })
                    .collect(),
                (None, None) => Vec::new(),
            };
            let options = EcbSdmxOptions {
                available_at: publication(options, Publication::Unknown),
                decimals: &decimals,
            };
            parse_ecb_sdmx_csv(&text, &options)
        }
        "boc" => parse_bank_of_canada_json(
            &text,
            &BankOfCanadaOptions {
                available_at: publication(options, Publication::Stated),
            },
        ),
        "fed" => parse_fed_h10_csv(&text),
        "boe" => {
            let decimals = options["decimals"]
                .as_u64()
                .map_or(4, |places| u8::try_from(places).expect("few"));
            parse_bank_of_england_csv(&text, &BankOfEnglandOptions { decimals })
        }
        "hmrc" => parse_hmrc_monthly_csv(
            &text,
            &HmrcOptions {
                available_at: publication(options, Publication::Stated),
            },
        ),
        other => panic!("unknown parser {other}"),
    }
}

fn table_json(table: &RateTable) -> Value {
    let mut out = serde_json::Map::new();
    out.insert(
        "base".into(),
        json!(table.base().map(|base| base.as_str().to_owned())),
    );
    for (key, value) in [
        ("asOf", table.as_of()),
        ("availableAt", table.available_at()),
        ("validUntil", table.valid_until()),
    ] {
        if let Some(value) = value {
            out.insert(key.into(), json!(value.to_string()));
        }
    }
    let missing: Vec<&str> = table.missing().iter().map(CurrencyCode::as_str).collect();
    out.insert("missing".into(), json!(missing));
    let rates: Vec<Value> = table.rates().iter().map(rate_json).collect();
    out.insert("rates".into(), Value::Array(rates));
    Value::Object(out)
}

fn days(row: &Value) -> Fields {
    let result = parse(row).map(|tables| {
        let days: Vec<String> = tables
            .iter()
            .map(|table| table.as_of().expect("dated").to_string())
            .collect();
        vec![("days", json!(days))]
    });
    fields(&["days"], result)
}

fn one_table(row: &Value) -> Fields {
    let tables = parse(row).expect("the file parses");
    let index = usize::try_from(row["index"].as_u64().expect("an index")).expect("small");
    vec![("table", tables.get(index).map_or(Value::Null, table_json))]
}

fn sdmx_decimals(row: &Value) -> Fields {
    let result = parse_ecb_sdmx_decimals(&source_text(row)).map(|decimals| {
        let pairs: Vec<Value> = decimals
            .iter()
            .map(|(code, places)| json!([code.as_str(), places]))
            .collect();
        vec![("decimals", Value::Array(pairs))]
    });
    fields(&["decimals"], result)
}

fn quote(value: &Value) -> RateQuote {
    RateQuote {
        rate: string(value, "rate").to_owned(),
        per: value
            .get("per")
            .map(|per| per.as_i64().expect("an integer per")),
        inverted: value.get("inverted").and_then(Value::as_bool) == Some(true),
    }
}

fn from_quote(row: &Value) -> Fields {
    let result = rate_from_quote(
        code(string(row, "from")),
        code(string(row, "to")),
        &quote(&row["quote"]),
        row.get("info").map(info).unwrap_or_default(),
    )
    .map(|rate| vec![("rate", rate_json(&rate))]);
    fields(&["rate"], result)
}

fn lookup(row: &Value) -> Fields {
    let tables = parse(&row["tables"]).expect("the tables parse");
    let lookback = row["lookback"]
        .as_u64()
        .map_or(4, |days| u32::try_from(days).expect("few days"));
    let history = rate_history(tables, lookback).expect("dated tables");
    let query = RateQuery {
        as_of: time(&row["asOf"]),
    };
    let found = history.lookup(code(string(row, "from")), code(string(row, "to")), &query);
    let skipped: Vec<Value> = found
        .skipped
        .iter()
        .map(|fallback| json!([fallback.day.to_string(), fallback.reason.as_str()]))
        .collect();
    vec![
        ("rate", found.rate.as_ref().map_or(Value::Null, rate_json)),
        ("skipped", Value::Array(skipped)),
    ]
}

fn transaction(value: &Value) -> StripeBalanceTransaction<'_> {
    StripeBalanceTransaction {
        amount: value["amount"].as_i64().expect("an amount"),
        currency: string(value, "currency"),
        exchange_rate: value["exchange_rate"].as_str(),
        created: value["created"].as_i64(),
    }
}

fn stripe(row: &Value) -> Fields {
    let result = stripe_rate(string(row, "from"), &transaction(&row["transaction"]))
        .map(|rate| vec![("rate", rate.as_ref().map_or(Value::Null, rate_json))]);
    fields(&["rate"], result)
}

fn stripe_implied(row: &Value) -> Fields {
    let result = (|| {
        let amount = string(row, "amount");
        let places = amount
            .split_once('.')
            .map_or(0, |(_, fraction)| fraction.len());
        let charged = AnyMoney::parse_at(
            amount,
            code(string(row, "currency")),
            u16::try_from(places).expect("few places"),
            Rounding::Unnecessary,
        )?;
        let rate = stripe_implied_rate(&charged, &transaction(&row["transaction"]))?;
        Ok(vec![("rate", rate_json(&rate))])
    })();
    fields(&["rate"], result)
}

fn adyen(row: &Value) -> Fields {
    let cells: Vec<(&str, &str)> = row["row"]
        .as_object()
        .expect("a row")
        .iter()
        .map(|(column, value)| (column.as_str(), value.as_str().expect("text")))
        .collect();
    let rate = adyen_rate(&cells).expect("a readable row");
    vec![("rate", rate.as_ref().map_or(Value::Null, rate_json))]
}

pub(super) fn row_op(op: &str) -> Option<RowOp> {
    Some(match op {
        "source.parse" => days,
        "source.table" => one_table,
        "source.sdmxDecimals" => sdmx_decimals,
        "history.fromQuote" => from_quote,
        "history.lookup" => lookup,
        "fx.stripeRate" => stripe,
        "fx.stripeImplied" => stripe_implied,
        "fx.adyenRate" => adyen,
        _ => return None,
    })
}
