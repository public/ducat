//! ducat-format's share of ducat's conformance suite: every `format.money`, `parse.money` and
//! `parse.detect` row in `spec/vectors/format/*.json` and `spec/vectors/parse/*.json` (the core
//! runner delegates them here). It fails on a failed row, on an operation it doesn't know, on row
//! counts other than the files' own (and those the spec README lists), and on a judgement that
//! can't fail (each operation's first row, changed, must fail).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::ExitCode;

use ducat::{AnyMoney, CurrencyCode, ErrorKind, Rounding};
use ducat_format::{
    CurrencyDisplay, CurrencySign, Error, FormatOptions, Locale, ParseMoneyOptions, ParseOptions,
    format_to_parts, parse, parse_money,
};
use serde_json::{Value, json};

/// The rows per operation, from the spec's README (as the core runner's `CASES_PER_AREA`).
const ROWS: [(&str, usize); 3] = [
    ("format.money", 4846),
    ("parse.money", 1629),
    ("parse.detect", 1757),
];

fn kind(error: &Error) -> &'static str {
    match error.kind() {
        ErrorKind::Rounding => "rounding",
        ErrorKind::Syntax => "syntax",
        ErrorKind::Type => "type",
        ErrorKind::CurrencyMismatch => "currency-mismatch",
        _ => "range",
    }
}

fn currency(code: &str) -> CurrencyCode {
    CurrencyCode::iso(code).unwrap_or_else(|_| panic!("{code} is ISO"))
}

fn rounding(name: &Value) -> Option<Rounding> {
    name.as_str()
        .map(|name| name.parse().expect("a rounding mode"))
}

/// The money of a row: `amount` at the scale its fraction digits give.
fn money(row: &Value) -> AnyMoney {
    let amount = row["amount"].as_str().unwrap();
    let scale = amount
        .split_once('.')
        .map_or(0, |(_, fraction)| fraction.len());
    AnyMoney::parse_at(
        amount,
        currency(row["currency"].as_str().unwrap()),
        u16::try_from(scale).unwrap(),
        Rounding::Unnecessary,
    )
    .unwrap()
}

/// The options of a format row; `Err` for an option value no Rust value expresses (an invalid
/// display or sign name is `Intl`'s `RangeError`).
fn format_options(options: &Value) -> Result<FormatOptions, &'static str> {
    let mut out = FormatOptions::default();
    let Some(options) = options.as_object() else {
        return Ok(out);
    };
    let digits = |key: &str| {
        options
            .get(key)
            .map(|value| u16::try_from(value.as_u64().unwrap()).unwrap())
    };
    for (key, value) in options {
        match key.as_str() {
            "currencyDisplay" => {
                out.currency_display = match value.as_str().unwrap() {
                    "symbol" => CurrencyDisplay::Symbol,
                    "narrowSymbol" => CurrencyDisplay::NarrowSymbol,
                    "code" => CurrencyDisplay::Code,
                    "name" => CurrencyDisplay::Name,
                    _ => return Err("range"),
                };
            }
            "currencySign" => {
                out.currency_sign = match value.as_str().unwrap() {
                    "standard" => CurrencySign::Standard,
                    "accounting" => CurrencySign::Accounting,
                    _ => return Err("range"),
                };
            }
            "digits" => out.digits = digits(key),
            "rounding" => out.rounding = rounding(value),
            "minimumFractionDigits" => out.minimum_fraction_digits = digits(key),
            "maximumFractionDigits" => out.maximum_fraction_digits = digits(key),
            "maximumSignificantDigits" => out.maximum_significant_digits = digits(key),
            "roundingIncrement" => out.rounding_increment = digits(key),
            other => panic!("a format option the runner doesn't know: {other}"),
        }
    }
    Ok(out)
}

/// What ducat-format gives for a row, in the row's expected fields.
fn run(op: &str, row: &Value) -> Value {
    let locale = Locale::new(row["locale"].as_str().unwrap());
    match op {
        "format.money" => {
            let result = format_options(&row["options"])
                .map_err(|kind| kind.to_owned())
                .and_then(|options| {
                    let locale = locale.map_err(|error| kind(&error).to_owned())?;
                    format_to_parts(&money(row), &locale, &options)
                        .map_err(|error| kind(&error).to_owned())
                });
            match result {
                Ok(parts) => {
                    let text: String = parts.iter().map(|part| part.value.as_str()).collect();
                    let parts: Vec<Value> = parts
                        .iter()
                        .map(|part| json!({"type": part.kind.name(), "value": part.value}))
                        .collect();
                    json!({"text": text, "parts": parts, "error": null})
                }
                Err(error) => json!({"text": null, "parts": null, "error": error}),
            }
        }
        "parse.money" => {
            let options = &row["options"];
            let mut parse_options = ParseOptions::default();
            parse_options.scale = options["scale"]
                .as_u64()
                .map(|scale| u16::try_from(scale).unwrap());
            parse_options.rounding = rounding(&options["rounding"]);
            parse_options.lenient = options["lenient"].as_bool().unwrap_or(false);
            let result = locale.and_then(|locale| {
                parse(
                    row["input"].as_str().unwrap(),
                    currency(row["currency"].as_str().unwrap()),
                    &locale,
                    &parse_options,
                )
            });
            match result {
                Ok(found) => json!({"amount": found.to_decimal(), "error": null}),
                Err(error) => json!({"amount": null, "error": kind(&error)}),
            }
        }
        "parse.detect" => {
            let options = &row["options"];
            let symbols: Vec<(String, CurrencyCode)> = options["symbols"]
                .as_object()
                .map(|symbols| {
                    symbols
                        .iter()
                        .map(|(symbol, code)| (symbol.clone(), currency(code.as_str().unwrap())))
                        .collect()
                })
                .unwrap_or_default();
            let symbols: Vec<(&str, CurrencyCode)> = symbols
                .iter()
                .map(|(symbol, code)| (symbol.as_str(), *code))
                .collect();
            let currencies: Option<Vec<CurrencyCode>> =
                options["currencies"].as_array().map(|list| {
                    list.iter()
                        .map(|code| currency(code.as_str().unwrap()))
                        .collect()
                });
            let mut parse_options = ParseMoneyOptions::default();
            parse_options.hint = options["hint"].as_str().map(currency);
            parse_options.symbols = &symbols;
            parse_options.currencies = currencies.as_deref();
            parse_options.lenient = options["lenient"].as_bool().unwrap_or(false);
            parse_options.scale = options["scale"]
                .as_u64()
                .map(|scale| u16::try_from(scale).unwrap());
            parse_options.rounding = rounding(&options["rounding"]);
            let result = locale.and_then(|locale| {
                parse_money(row["input"].as_str().unwrap(), &locale, &parse_options)
            });
            match result {
                Ok(found) => json!({
                    "money": {"amount": found.to_decimal(), "currency": found.currency().as_str()},
                    "error": null
                }),
                Err(error) => json!({"money": null, "error": kind(&error)}),
            }
        }
        other => panic!("unknown operation {other}"),
    }
}

/// Whether ducat-format gives the row's expected fields.
fn check(op: &str, row: &Value) -> Result<(), String> {
    let got = run(op, row);
    let differs = got.as_object().unwrap().iter().any(|(field, value)| {
        row.get(field) != Some(value) && !(value.is_null() && row.get(field).is_none())
    });
    if differs {
        Err(format!("{row} -> got {got}"))
    } else {
        Ok(())
    }
}

/// The whole suite as one test: its counts print with `--nocapture`.
#[test]
fn conformance() -> ExitCode {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../spec/vectors");
    let mut paths = Vec::new();
    for area in ["format", "parse"] {
        for entry in std::fs::read_dir(root.join(area)).expect("spec/vectors") {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|ext| ext == "json") {
                paths.push(path);
            }
        }
    }
    paths.sort();
    let mut counts: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    let mut errors: Vec<String> = Vec::new();
    let mut mutation_checked: BTreeMap<String, bool> = BTreeMap::new();
    for path in &paths {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        for table in doc["tables"].as_array().into_iter().flatten() {
            let op = table["op"].as_str().unwrap_or("?").to_owned();
            if !ROWS.iter().any(|(known, _)| *known == op) {
                errors.push(format!("{name}: unknown table operation {op}"));
                continue;
            }
            let rows = table["rows"].as_array().map_or(&[][..], Vec::as_slice);
            for row in rows {
                let entry = counts.entry(op.clone()).or_default();
                match check(&op, row) {
                    Ok(()) => entry.0 += 1,
                    Err(error) => {
                        entry.1 += 1;
                        errors.push(format!("{name} {op}: {error}"));
                    }
                }
            }
            // the judgement must be able to fail: a changed expectation is caught
            if !mutation_checked.get(&op).copied().unwrap_or(false) {
                if let Some(first) = rows.iter().find(|row| row["error"].is_null()) {
                    let mut changed = first.clone();
                    let field = match op.as_str() {
                        "format.money" => "text",
                        "parse.money" => "amount",
                        _ => "money",
                    };
                    changed[field] = json!("changed");
                    if check(&op, &changed).is_ok() {
                        errors.push(format!("{name} {op}: a changed expectation still passes"));
                    }
                    mutation_checked.insert(op.clone(), true);
                }
            }
        }
    }
    println!("ducat-format conformance ({} files)", paths.len());
    println!("{:<14} {:>7} {:>7}", "operation", "passed", "failed");
    for (op, want) in ROWS {
        let (passed, failed) = counts.get(op).copied().unwrap_or_default();
        println!("{op:<14} {passed:>7} {failed:>7}");
        if passed + failed != want {
            errors.push(format!(
                "{op}: {} rows, the README lists {want}",
                passed + failed
            ));
        }
        if !mutation_checked.get(op).copied().unwrap_or(false) {
            errors.push(format!("{op}: no row to check the judgement with"));
        }
    }
    for error in errors.iter().take(60) {
        println!("ERROR {error}");
    }
    if errors.is_empty() {
        println!("format and parse: ok");
        ExitCode::SUCCESS
    } else {
        println!("format and parse: {} errors", errors.len());
        ExitCode::FAILURE
    }
}
