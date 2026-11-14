//! The runner for ducat's conformance suite (the repository's `spec/`).
//!
//! It checks every vector file's structure, maps each neutral operation to the Rust API, runs
//! every case and table row it knows, and prints implemented, skipped (with the reason) and
//! failed counts per area and operation. It fails on:
//! - a failed case or row;
//! - an operation it doesn't know, unless that operation is listed in `NOT_YET`;
//! - a file that breaks the format, or a change in the number of cases in an area;
//! - a judgement that can't fail (each implemented operation's first passing vector is changed
//!   and must then fail).

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use ducat::allocate::{InstalmentRemainder, Remainder, Tranche};
use ducat::iso::Eur;
use ducat::{AnyMoney, CurrencyCode, Error, ErrorKind, Int, Money, Rounding};
use serde_json::Value;

/// Cases (and table rows) per area, from the spec's README. A vector may be added (raise the
/// count), never silently lost.
const CASES_PER_AREA: &[(&str, usize)] = &[
    ("allocate", 5400),
    ("cash", 1500),
    ("convert", 250),
    ("core", 41),
    ("excel", 2878),
    ("finance", 2420),
    ("fixed", 28),
    ("rounding", 750),
    ("tax", 1000),
    ("words", 6904),
];

/// Operations the runner knows about but the Rust port doesn't implement yet, with the milestone
/// that brings them. Each is named in full, so a new operation in the spec is an error here.
const NOT_YET: &[(&str, &str)] = &[
    ("minor.percentage", "not yet: milestone 3 (tax)"),
    ("minor.discount", "not yet: milestone 3 (tax)"),
    ("minor.addTax", "not yet: milestone 3 (tax)"),
    ("minor.extractTax", "not yet: milestone 3 (tax)"),
    ("fixed.roundTrip", "not yet: milestone 3 (fixed)"),
    ("fixed.add", "not yet: milestone 3 (fixed)"),
    ("fixed.multiply", "not yet: milestone 3 (fixed)"),
    ("fixed.divide", "not yet: milestone 3 (fixed)"),
    ("fixed.round", "not yet: milestone 3 (fixed)"),
    ("fixed.compare", "not yet: milestone 3 (fixed)"),
    ("xnpv.scaled", "not yet: milestone 4 (excel)"),
    ("xirr.floor", "not yet: milestone 4 (excel)"),
    ("excel.annuities", "not yet: milestone 4 (excel)"),
    ("excel.nper", "not yet: milestone 4 (excel)"),
    ("excel.rate", "not yet: milestone 4 (excel)"),
    ("excel.xnpv", "not yet: milestone 4 (excel)"),
    ("excel.xirr", "not yet: milestone 4 (excel)"),
    ("excelExample.npv", "not yet: milestone 4 (excel)"),
    ("excelExample.irr", "not yet: milestone 4 (excel)"),
    ("excelExample.rri", "not yet: milestone 4 (excel)"),
    ("excelExample.effect", "not yet: milestone 4 (excel)"),
    ("excelExample.fv", "not yet: milestone 4 (excel)"),
    ("excelExample.pv", "not yet: milestone 4 (excel)"),
    ("excelExample.pmt", "not yet: milestone 4 (excel)"),
    ("excelExample.xnpv", "not yet: milestone 4 (excel)"),
    ("excelExample.nper", "not yet: milestone 4 (excel)"),
    ("excelExample.rate", "not yet: milestone 4 (excel)"),
    ("excelExample.xirr", "not yet: milestone 4 (excel)"),
    ("spreadsheet.npv", "not yet: milestone 4 (excel)"),
    ("spreadsheet.irr", "not yet: milestone 4 (excel)"),
    ("spreadsheet.periodicRate", "not yet: milestone 4 (excel)"),
    ("spreadsheet.annualRate", "not yet: milestone 4 (excel)"),
    ("spreadsheet.fv", "not yet: milestone 4 (excel)"),
    ("spreadsheet.pv", "not yet: milestone 4 (excel)"),
    ("spreadsheet.pmt", "not yet: milestone 4 (excel)"),
    ("spreadsheet.nper", "not yet: milestone 4 (excel)"),
    ("spreadsheet.rate", "not yet: milestone 4 (excel)"),
    ("spreadsheet.xnpv", "not yet: milestone 4 (excel)"),
    ("spreadsheet.xirr", "not yet: milestone 4 (excel)"),
    ("spreadsheet.edge.fv", "not yet: milestone 4 (excel)"),
    ("spreadsheet.edge.pv", "not yet: milestone 4 (excel)"),
    ("spreadsheet.edge.pmt", "not yet: milestone 4 (excel)"),
    ("spreadsheet.edge.nper", "not yet: milestone 4 (excel)"),
    ("spreadsheet.edge.rate", "not yet: milestone 4 (excel)"),
    ("spreadsheet.edge.xnpv", "not yet: milestone 4 (excel)"),
    ("spreadsheet.edge.xirr", "not yet: milestone 4 (excel)"),
    ("finance.yearFraction", "not yet: milestone 4 (finance)"),
    ("finance.interest", "not yet: milestone 4 (finance)"),
    ("finance.compound", "not yet: milestone 4 (finance)"),
    ("finance.amortise", "not yet: milestone 4 (finance)"),
    ("finance.npv", "not yet: milestone 4 (finance)"),
    ("finance.irr", "not yet: milestone 4 (finance)"),
    ("finance.irrBracketed", "not yet: milestone 4 (finance)"),
    ("finance.proration", "not yet: milestone 4 (finance)"),
    ("finance.paymentDates", "not yet: milestone 4 (finance)"),
    ("words.spellOut", "not yet: milestone 6 (ducat-icu)"),
];

fn not_yet(op: &str) -> Option<&'static str> {
    NOT_YET
        .iter()
        .find_map(|&(name, reason)| (name == op).then_some(reason))
}

/// The spec's own version, from `spec/package.json`.
fn spec_version() -> String {
    let package: Value =
        serde_json::from_str(&std::fs::read_to_string(spec_dir().join("package.json")).unwrap())
            .unwrap();
    package["version"].as_str().unwrap_or("?").to_owned()
}

fn spec_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../spec")
}

// --- reading values ----------------------------------------------------------------------------

/// What an operation returned, before it is compared with the expectation.
#[derive(Debug, Clone)]
enum Outcome {
    Money(AnyMoney),
    Parts(Vec<AnyMoney>),
    /// The generated allocations that break the property, described.
    Failures(Vec<String>),
    Integer(i64),
    Boolean(bool),
}

/// Why a vector wasn't run.
type Skip = &'static str;

fn string<'a>(args: &'a Value, key: &str) -> &'a str {
    args[key]
        .as_str()
        .unwrap_or_else(|| panic!("`{key}` is not a string in {args}"))
}

fn code(text: &str) -> Result<CurrencyCode, Error> {
    text.parse()
}

fn mode(args: &Value) -> Rounding {
    string(args, "mode").parse().expect("a rounding mode")
}

fn money_of(value: &Value) -> Result<AnyMoney, Error> {
    let scale = value["scale"].as_u64().expect("a scale");
    let scale = u16::try_from(scale).map_err(|_| Error::InvalidScale)?;
    AnyMoney::parse_at(
        string(value, "amount"),
        code(string(value, "currency"))?,
        scale,
        Rounding::Unnecessary,
    )
}

fn minor_of(text: &str) -> i128 {
    text.parse()
        .expect("minor units within i128 (checked before running)")
}

// --- case operations ---------------------------------------------------------------------------

type CaseOp = fn(&Value) -> Result<Outcome, Error>;

fn case_op(op: &str) -> Option<CaseOp> {
    Some(match op {
        "currency.exponent" => |args| {
            Ok(Outcome::Integer(i64::from(
                code(string(args, "currency"))?.exponent(),
            )))
        },
        "money.fromMinor" => |args| {
            Ok(Outcome::Money(AnyMoney::from_minor(
                minor_of(string(args, "minor")),
                code(string(args, "currency"))?,
            )))
        },
        "money.fromDecimal" => |args| {
            Ok(Outcome::Money(AnyMoney::parse(
                string(args, "amount"),
                code(string(args, "currency"))?,
            )?))
        },
        "money.fromBinary64" => |args| {
            let value: f64 = string(&args["value"], "binary64")
                .parse()
                .expect("a binary64");
            Ok(Outcome::Money(AnyMoney::from_f64(
                value,
                code(string(args, "currency"))?,
            )?))
        },
        "money.roundTrip" => |args| Ok(Outcome::Money(money_of(&args["money"])?)),
        "money.add" => |args| {
            Ok(Outcome::Money(
                money_of(&args["first"])?.checked_add(&money_of(&args["second"])?)?,
            ))
        },
        "money.subtract" => |args| {
            Ok(Outcome::Money(
                money_of(&args["first"])?.checked_sub(&money_of(&args["second"])?)?,
            ))
        },
        "money.multiply" => |args| {
            Ok(Outcome::Money(
                money_of(&args["money"])?.multiply(string(args, "factor"), mode(args))?,
            ))
        },
        "money.divide" => |args| {
            Ok(Outcome::Money(
                money_of(&args["money"])?.divide(string(args, "divisor"), mode(args))?,
            ))
        },
        "money.convert" => |args| {
            let to = code(string(args, "to"))?;
            Ok(Outcome::Money(money_of(&args["money"])?.convert(
                to,
                string(args, "rate"),
                mode(args),
            )?))
        },
        "money.compare" => |args| {
            let order = money_of(&args["first"])?.compare(&money_of(&args["second"])?)?;
            Ok(Outcome::Integer(order as i64))
        },
        "money.equals" => |args| {
            Ok(Outcome::Boolean(
                money_of(&args["first"])?.eq_value(&money_of(&args["second"])?),
            ))
        },
        "money.split" => |args| {
            let count =
                usize::try_from(args["count"].as_u64().expect("a count")).expect("a small count");
            Ok(Outcome::Parts(
                money_of(&args["money"])?.split(count, Remainder::First)?,
            ))
        },
        "money.allocate" => |args| {
            let weights: Vec<u64> = args["weights"]
                .as_array()
                .expect("weights")
                .iter()
                .map(|w| w.as_u64().expect("a weight"))
                .collect();
            Ok(Outcome::Parts(
                money_of(&args["money"])?.allocate(&weights, Remainder::Largest)?,
            ))
        },
        "money.allocate.generated" => |args| Ok(Outcome::Failures(generated_allocations(args)?)),
        _ => return None,
    })
}

/// The spec's linear congruential generator, in exact integer arithmetic.
struct Lcg {
    state: u128,
    multiplier: u128,
    increment: u128,
    modulus: u128,
}

impl Lcg {
    fn draw(&mut self, limit: i128, offset: i128) -> i128 {
        self.state = (self.state * self.multiplier + self.increment) % self.modulus;
        (self.state % limit as u128) as i128 + offset
    }
}

/// The allocations a `money.allocate.generated` case describes: (minor units, weights).
fn draws(args: &Value) -> Vec<(i128, Vec<i128>)> {
    let generator = &args["generator"];
    assert_eq!(
        generator["kind"], "lcg",
        "the only generator the spec defines"
    );
    let number = |value: &Value| value.as_u64().expect("a generator parameter") as u128;
    let mut lcg = Lcg {
        state: number(&generator["seed"]),
        multiplier: number(&generator["multiplier"]),
        increment: number(&generator["increment"]),
        modulus: number(&generator["modulus"]),
    };
    let spec: Vec<&Value> = args["draws"].as_array().expect("draws").iter().collect();
    let names: Vec<&str> = spec
        .iter()
        .map(|draw| draw["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        ["minor", "weightCount", "weights"],
        "the draws the spec documents"
    );
    let limit = |draw: &Value| draw["limit"].as_i64().expect("a limit") as i128;
    let offset = |draw: &Value| draw["offset"].as_i64().expect("an offset") as i128;
    let count = args["count"].as_u64().expect("a count");
    (0..count)
        .map(|_| {
            let minor = lcg.draw(limit(spec[0]), offset(spec[0]));
            let weight_count = lcg.draw(limit(spec[1]), offset(spec[1]));
            let weights = (0..weight_count)
                .map(|_| lcg.draw(limit(spec[2]), offset(spec[2])))
                .collect();
            (minor, weights)
        })
        .collect()
}

/// Every part is within one minor unit of its exact share, at the whole's scale, and the parts
/// sum to the whole (the spec's `allocation-within-one-unit`).
fn generated_allocations(args: &Value) -> Result<Vec<String>, Error> {
    let currency = code(string(args, "currency"))?;
    let mut failures = Vec::new();
    let all = draws(args);
    // the spec gives the first draw from seed 12345, so a port shows it draws the same ones
    if args["generator"]["seed"] == 12345
        && all
            .first()
            .map(|(minor, weights)| (*minor, weights.clone()))
            != Some((306_932_606, vec![925, 574, 179, 460, 193, 794, 311]))
    {
        failures.push(format!(
            "the first draw is {:?}, not the spec's",
            all.first()
        ));
    }
    for (minor, weights) in all {
        let whole = AnyMoney::from_minor(minor, currency);
        let parts = whole.allocate(&weights, Remainder::Largest)?;
        let total: i128 = weights.iter().sum();
        let units: Vec<i128> = parts
            .iter()
            .map(|part| part.units().to_i128().expect("parts of an i128 amount fit"))
            .collect();
        let sums = units.iter().sum::<i128>() == minor;
        let scaled = parts.iter().all(|part| part.scale() == whole.scale());
        let near = units
            .iter()
            .zip(&weights)
            .all(|(part, weight)| (part * total - minor * weight).abs() <= total);
        if !(sums && scaled && near) {
            failures.push(format!("{minor} by {weights:?}: {units:?}"));
        }
    }
    Ok(failures)
}

fn kind_name(kind: ErrorKind) -> &'static str {
    match kind {
        ErrorKind::Rounding => "rounding",
        ErrorKind::CurrencyMismatch => "currency-mismatch",
        ErrorKind::Range => "range",
        ErrorKind::Syntax => "syntax",
        ErrorKind::Type => "type",
        _ => "unknown",
    }
}

fn spec_money(money: &AnyMoney) -> Value {
    serde_json::json!({ "amount": money.to_decimal(), "currency": money.currency().as_str(), "scale": money.scale() })
}

/// Whether the result meets one expectation (not `anyOf`).
fn meets(result: &Result<Outcome, Error>, expectation: &Value) -> bool {
    let (key, expected) = expectation
        .as_object()
        .and_then(|fields| fields.iter().next())
        .expect("an expectation");
    match (result, key.as_str()) {
        (Err(error), "error") => expected.as_str() == Some(kind_name(error.kind())),
        (Ok(Outcome::Money(money)), "money") => spec_money(money) == *expected,
        (Ok(Outcome::Integer(value)), "integer") => expected.as_i64() == Some(*value),
        (Ok(Outcome::Boolean(value)), "boolean") => expected.as_bool() == Some(*value),
        (Ok(Outcome::Parts(parts)), "moneyList") => {
            Value::Array(parts.iter().map(spec_money).collect()) == *expected
        }
        (Ok(Outcome::Parts(parts)), "moneyMultiset") => {
            let mut got: Vec<String> = parts
                .iter()
                .map(|part| spec_money(part).to_string())
                .collect();
            let mut want: Vec<String> = expected
                .as_array()
                .into_iter()
                .flatten()
                .map(Value::to_string)
                .collect();
            got.sort();
            want.sort();
            got == want
        }
        (Ok(Outcome::Parts(parts)), "sumOfParts") => {
            let currency = parts.first().map(AnyMoney::currency);
            currency.is_some_and(|currency| {
                AnyMoney::try_sum(parts.iter(), currency)
                    .is_ok_and(|sum| spec_money(&sum) == *expected)
            })
        }
        (Ok(Outcome::Failures(failures)), "property") => {
            expected == "allocation-within-one-unit" && failures.is_empty()
        }
        _ => false,
    }
}

fn alternatives(expect: &Value) -> Vec<&Value> {
    match expect.get("anyOf") {
        Some(Value::Array(items)) => items.iter().collect(),
        _ => vec![expect],
    }
}

/// Runs one case: `Ok(true)` for a pass, `Ok(false)` for a failure, `Err` for a skip.
fn judge_case(run: CaseOp, case: &Value) -> Result<(bool, String), Skip> {
    let args = &case["args"];
    let expected = alternatives(&case["expect"]);
    let result = run(args);
    let passed = expected
        .iter()
        .any(|expectation| meets(&result, expectation));
    let shown = match &result {
        Ok(Outcome::Money(money)) => spec_money(money).to_string(),
        Ok(Outcome::Parts(parts)) => {
            Value::Array(parts.iter().map(spec_money).collect()).to_string()
        }
        Ok(Outcome::Failures(failures)) => format!(
            "{} failures: {:?}",
            failures.len(),
            failures.iter().take(3).collect::<Vec<_>>()
        ),
        Ok(other) => format!("{other:?}"),
        Err(error) => format!("error {} ({error})", kind_name(error.kind())),
    };
    Ok((passed, shown))
}

// --- table operations --------------------------------------------------------------------------

/// What one row produced: each expected field with the value the Rust API gave for it.
type Fields = Vec<(&'static str, Value)>;

type RowOp = fn(&Value) -> Fields;

/// A result in minor units as the tables write it, or `null` for an error of `kind`.
fn minor_field(result: Result<Int, Error>, kind: ErrorKind) -> Value {
    match result {
        Ok(units) => Value::String(units.to_string()),
        Err(error) if error.kind() == kind => Value::Null,
        Err(error) => Value::String(format!("error {} ({error})", kind_name(error.kind()))),
    }
}

/// Parts as the tables write them: their units, as integer strings, or `null` for a range error.
fn parts_field<M>(result: Result<Vec<M>, Error>, units: fn(&M) -> &Int) -> Value {
    match result {
        Ok(parts) => parts
            .iter()
            .map(|part| Value::String(units(part).to_string()))
            .collect(),
        Err(error) if error.kind() == ErrorKind::Range => Value::Null,
        Err(error) => Value::String(format!("error {} ({error})", kind_name(error.kind()))),
    }
}

/// Minor units of EUR, the tables' currency when a row names none.
fn eur(text: &str) -> Money<Eur> {
    Money::from_minor(minor_of(text))
}

const REMAINDERS: [(&str, Remainder); 5] = [
    ("largest", Remainder::Largest),
    ("first", Remainder::First),
    ("last", Remainder::Last),
    ("toFirst", Remainder::ToFirst),
    ("toLast", Remainder::ToLast),
];

const INSTALMENT_REMAINDERS: [(&str, InstalmentRemainder); 4] = [
    ("first", InstalmentRemainder::First),
    ("last", InstalmentRemainder::Last),
    ("toFirst", InstalmentRemainder::ToFirst),
    ("toLast", InstalmentRemainder::ToLast),
];

fn row_op(op: &str) -> Option<RowOp> {
    fn start(row: &Value) -> Result<AnyMoney, Error> {
        Ok(AnyMoney::from_minor(
            minor_of(string(row, "minor")),
            code(string(row, "currency"))?,
        ))
    }
    fn want(result: Result<AnyMoney, Error>) -> Fields {
        vec![(
            "want",
            minor_field(
                result.map(|money| money.units().clone()),
                ErrorKind::Rounding,
            ),
        )]
    }
    Some(match op {
        "minor.multiply" => {
            |row| want(start(row).and_then(|m| m.multiply(string(row, "factor"), mode(row))))
        }
        "minor.divide" => {
            |row| want(start(row).and_then(|m| m.divide(string(row, "divisor"), mode(row))))
        }
        "minor.toScale" => |row| {
            let scale =
                u16::try_from(row["scale"].as_u64().expect("a scale")).expect("a small scale");
            want(start(row).and_then(|m| m.to_scale(scale, mode(row))))
        },
        "minor.convert" => {
            |row| {
                want(start(row).and_then(|m| {
                    m.convert(code(string(row, "to"))?, string(row, "rate"), mode(row))
                }))
            }
        }
        "allocate.byRemainder" => |row| {
            let amount = eur(string(row, "amount"));
            let weights: Vec<&str> = row["weights"]
                .as_array()
                .unwrap()
                .iter()
                .map(|w| w.as_str().unwrap())
                .collect();
            // integer weights, and the same weights as decimal strings ("2.0"), which must agree
            let decimals: Vec<String> =
                weights.iter().map(|weight| format!("{weight}.0")).collect();
            let integers: Vec<u128> = weights
                .iter()
                .map(|weight| weight.parse().unwrap())
                .collect();
            REMAINDERS
                .iter()
                .map(|&(name, remainder)| {
                    let by_integers =
                        parts_field(amount.allocate(&integers, remainder), Money::units);
                    let by_decimals = parts_field(
                        amount.allocate(decimals.iter().map(String::as_str), remainder),
                        Money::units,
                    );
                    let field = if by_integers == by_decimals {
                        by_integers
                    } else {
                        Value::String(format!(
                            "{by_integers} but {by_decimals} by decimal weights"
                        ))
                    };
                    (name, field)
                })
                .collect()
        },
        "instalments.byRemainder" => |row| {
            let total = eur(string(row, "total"));
            let unit = eur(string(row, "unit"));
            let count = usize::try_from(row["count"].as_u64().unwrap()).unwrap();
            INSTALMENT_REMAINDERS
                .iter()
                .map(|&(name, remainder)| {
                    (
                        name,
                        parts_field(
                            total.instalments(count, Some(&unit), remainder),
                            Money::units,
                        ),
                    )
                })
                .collect()
        },
        "chunk" => |row| {
            vec![(
                "chunks",
                parts_field(
                    eur(string(row, "total")).chunk(&eur(string(row, "max"))),
                    Money::units,
                ),
            )]
        },
        "schedule" => |row| {
            let tranches: Result<Vec<Tranche<Money<Eur>>>, Error> = row["tranches"]
                .as_array()
                .unwrap()
                .iter()
                .map(|tranche| {
                    if let Some(amount) = tranche["amount"].as_str() {
                        Ok(Tranche::amount(eur(amount)))
                    } else if let Some(percent) = tranche["percent"].as_str() {
                        match tranche["cap"].as_str() {
                            Some(cap) => Tranche::percent_capped(percent, eur(cap)),
                            None => Tranche::percent(percent),
                        }
                    } else {
                        assert_eq!(
                            tranche["rest"], true,
                            "a tranche is an amount, a percent or the rest"
                        );
                        Ok(Tranche::rest())
                    }
                })
                .collect();
            let total = eur(string(row, "total"));
            vec![(
                "result",
                parts_field(
                    tranches.and_then(|tranches| total.schedule(&tranches)),
                    Money::units,
                ),
            )]
        },
        "roundToIncrement.byMode" => |row| {
            let amount = eur(string(row, "amount"));
            let step = eur(string(row, "step"));
            Rounding::ALL
                .iter()
                .map(|&mode| {
                    (
                        mode.name(),
                        minor_field(
                            amount
                                .round_to_increment(&step, mode)
                                .map(|m| m.units().clone()),
                            ErrorKind::Rounding,
                        ),
                    )
                })
                .collect()
        },
        _ => return None,
    })
}

/// Runs one row: every field the operation produces must equal the row's, as JSON text.
fn judge_row(run: RowOp, row: &Value) -> Result<(bool, String), Skip> {
    let fields = run(row);
    let wrong: Vec<String> = fields
        .iter()
        .filter(|(name, value)| row.get(*name) != Some(value))
        .map(|(name, value)| format!("{name} {value}"))
        .collect();
    Ok((wrong.is_empty(), wrong.join("; ")))
}

/// The row with its first expected field changed, which a correct implementation must fail.
fn mutated_row(run: RowOp, row: &Value) -> Value {
    let (name, _) = run(row).into_iter().next().expect("a field");
    let mut changed = row.clone();
    changed[name] = match &row[name] {
        Value::String(text) => Value::String(format!("{text}1")),
        Value::Array(items) if !items.is_empty() => {
            let mut items = items.clone();
            items.reverse();
            items.push(Value::String("1".into()));
            Value::Array(items)
        }
        Value::Null => Value::String("0".into()),
        _ => Value::Null,
    };
    changed
}

// --- the file format ---------------------------------------------------------------------------

const AREAS: &[&str] = &[
    "core", "rounding", "allocate", "tax", "convert", "cash", "format", "words", "parse", "fixed",
    "exact", "excel", "finance",
];
const EXPECTATIONS: &[&str] = &[
    "money",
    "moneyList",
    "moneyMultiset",
    "sumOfParts",
    "decimal",
    "integer",
    "boolean",
    "error",
    "property",
    "anyOf",
];
const ERROR_KINDS: &[&str] = &["rounding", "currency-mismatch", "range", "syntax", "type"];
const SOURCES: &[&str] = &[
    "hand",
    "lean",
    "python-fractions",
    "python-decimal",
    "libreoffice-calc",
    "microsoft-documentation",
    "dectest",
    "icu",
];
const TOP_LEVEL: &[&str] = &[
    "$schema",
    "format",
    "area",
    "name",
    "description",
    "provenance",
    "checkedAgainst",
    "contentSha256",
    "cases",
    "tables",
];

fn check_expectation(expect: &Value, problems: &mut Vec<String>, at: &str) {
    let Some(fields) = expect.as_object() else {
        problems.push(format!("{at}: expect is not an object"));
        return;
    };
    if fields.len() != 1 {
        problems.push(format!("{at}: expect has {} keys", fields.len()));
    }
    for (key, value) in fields {
        if !EXPECTATIONS.contains(&key.as_str()) {
            problems.push(format!("{at}: unknown expectation `{key}`"));
        }
        if key == "error"
            && !value
                .as_str()
                .is_some_and(|kind| ERROR_KINDS.contains(&kind))
        {
            problems.push(format!("{at}: unknown error kind {value}"));
        }
        if key == "anyOf" {
            match value.as_array() {
                Some(items) if !items.is_empty() => items
                    .iter()
                    .for_each(|item| check_expectation(item, problems, at)),
                _ => problems.push(format!("{at}: anyOf is not a non-empty array")),
            }
        }
    }
}

/// The structural rules of `schema/vectors.schema.json` that matter to a runner.
fn check_format(path: &Path, doc: &Value) -> Vec<String> {
    let mut problems = Vec::new();
    let Some(fields) = doc.as_object() else {
        return vec!["not an object".into()];
    };
    for key in fields.keys() {
        if !TOP_LEVEL.contains(&key.as_str()) {
            problems.push(format!("unknown key `{key}`"));
        }
    }
    for key in [
        "format",
        "area",
        "name",
        "description",
        "provenance",
        "checkedAgainst",
    ] {
        if !fields.contains_key(key) {
            problems.push(format!("missing `{key}`"));
        }
    }
    if doc["format"] != 1 {
        problems.push("format is not 1".into());
    }
    let area = doc["area"].as_str().unwrap_or("");
    if !AREAS.contains(&area) {
        problems.push(format!("unknown area `{area}`"));
    }
    if path
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        != Some(area)
    {
        problems.push(format!("area `{area}` is not the file's directory"));
    }
    let name = doc["name"].as_str().unwrap_or("");
    if name.is_empty()
        || !name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        || name.starts_with('-')
    {
        problems.push(format!("bad name `{name}`"));
    }
    if !doc["provenance"]["source"]
        .as_str()
        .is_some_and(|source| SOURCES.contains(&source))
    {
        problems.push("unknown provenance source".into());
    }
    if !doc["provenance"]["method"]
        .as_str()
        .is_some_and(|method| !method.is_empty())
    {
        problems.push("provenance has no method".into());
    }
    match (doc.get("cases"), doc.get("tables")) {
        (Some(_), Some(_)) => problems.push("both cases and tables".into()),
        (None, None) => problems.push("neither cases nor tables".into()),
        (Some(cases), None) => {
            let mut ids = BTreeSet::new();
            for case in cases.as_array().into_iter().flatten() {
                let id = case["id"].as_str().unwrap_or("");
                if id.is_empty() || !ids.insert(id.to_owned()) {
                    problems.push(format!("missing or duplicate id `{id}`"));
                }
                if !case["op"].is_string() || !case["args"].is_object() {
                    problems.push(format!("{id}: no op or args"));
                }
                check_expectation(&case["expect"], &mut problems, id);
            }
            if cases.as_array().is_none_or(Vec::is_empty) {
                problems.push("cases is not a non-empty array".into());
            }
        }
        (None, Some(tables)) => {
            for table in tables.as_array().into_iter().flatten() {
                if !table["op"].is_string() || table["rows"].as_array().is_none_or(Vec::is_empty) {
                    problems.push("a table without op or rows".into());
                }
            }
            if tables.as_array().is_none_or(Vec::is_empty) {
                problems.push("tables is not a non-empty array".into());
            }
        }
    }
    problems
}

// --- running -----------------------------------------------------------------------------------

#[derive(Default)]
struct Tally {
    passed: usize,
    failed: usize,
    skipped: BTreeMap<&'static str, usize>,
}

fn vector_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir).expect("the spec directory") {
        let path = entry.unwrap().path();
        if path.is_dir() {
            files.extend(vector_files(&path));
        } else if path.extension().is_some_and(|ext| ext == "json") {
            files.push(path);
        }
    }
    files.sort();
    files
}

/// Changes an expectation so that a correct result no longer meets it.
fn mutated(expect: &Value) -> Value {
    let (key, value) = expect
        .as_object()
        .and_then(|fields| fields.iter().next())
        .expect("an expectation");
    let changed = match key.as_str() {
        "money" => {
            let mut money = value.clone();
            money["scale"] = serde_json::json!(money["scale"].as_u64().unwrap() + 1);
            money
        }
        "integer" => serde_json::json!(value.as_i64().unwrap() + 1),
        "boolean" => serde_json::json!(!value.as_bool().unwrap()),
        "error" => serde_json::json!(if value == "range" { "syntax" } else { "range" }),
        _ => return serde_json::json!({ "error": "type" }),
    };
    serde_json::json!({ key: changed })
}

fn main() -> ExitCode {
    let mut tallies: BTreeMap<(String, String), Tally> = BTreeMap::new();
    let mut per_area: BTreeMap<String, usize> = BTreeMap::new();
    let mut errors: Vec<String> = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    let mut mutation_checked: BTreeSet<String> = BTreeSet::new();

    let files = vector_files(&spec_dir().join("vectors"));
    assert!(
        !files.is_empty(),
        "no vector files under {}",
        spec_dir().display()
    );
    for path in &files {
        let relative = path.strip_prefix(spec_dir()).unwrap().display().to_string();
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap())
            .unwrap_or_else(|e| panic!("{relative}: {e}"));
        for problem in check_format(path, &doc) {
            errors.push(format!("{relative}: {problem}"));
        }
        let area = doc["area"].as_str().unwrap_or("?").to_owned();

        for case in doc["cases"].as_array().into_iter().flatten() {
            *per_area.entry(area.clone()).or_default() += 1;
            let op = case["op"].as_str().unwrap_or("?");
            let id = case["id"].as_str().unwrap_or("?");
            let tally = tallies.entry((area.clone(), op.to_owned())).or_default();
            let Some(run) = case_op(op) else {
                match not_yet(op) {
                    Some(reason) => *tally.skipped.entry(reason).or_default() += 1,
                    None => {
                        tally.failed += 1;
                        errors.push(format!("{relative} {id}: unknown operation `{op}`"));
                    }
                }
                continue;
            };
            match judge_case(run, case) {
                Err(reason) => *tally.skipped.entry(reason).or_default() += 1,
                Ok((true, _)) => {
                    tally.passed += 1;
                    let first_expect = &alternatives(&case["expect"])[0];
                    if case["expect"].get("anyOf").is_none()
                        && mutation_checked.insert(op.to_owned())
                    {
                        let mut changed = case.clone();
                        changed["expect"] = mutated(first_expect);
                        if !matches!(judge_case(run, &changed), Ok((false, _))) {
                            errors.push(format!(
                                "{relative} {id}: a changed expectation still passes"
                            ));
                        }
                    }
                }
                Ok((false, shown)) => {
                    tally.failed += 1;
                    failures.push(format!(
                        "{relative} {id} ({op}): got {shown}, want {}",
                        case["expect"]
                    ));
                }
            }
        }

        for table in doc["tables"].as_array().into_iter().flatten() {
            let op = table["op"].as_str().unwrap_or("?");
            let rows = table["rows"].as_array().map_or(&[][..], Vec::as_slice);
            *per_area.entry(area.clone()).or_default() += rows.len();
            let tally = tallies.entry((area.clone(), op.to_owned())).or_default();
            let Some(run) = row_op(op) else {
                match not_yet(op) {
                    Some(reason) => *tally.skipped.entry(reason).or_default() += rows.len(),
                    None => {
                        tally.failed += rows.len();
                        errors.push(format!("{relative}: unknown table operation `{op}`"));
                    }
                }
                continue;
            };
            for (index, row) in rows.iter().enumerate() {
                match judge_row(run, row) {
                    Err(reason) => *tally.skipped.entry(reason).or_default() += 1,
                    Ok((true, _)) => {
                        tally.passed += 1;
                        if mutation_checked.insert(op.to_owned()) {
                            let changed = mutated_row(run, row);
                            if !matches!(judge_row(run, &changed), Ok((false, _))) {
                                errors.push(format!(
                                    "{relative} row {index}: a changed expectation still passes"
                                ));
                            }
                        }
                    }
                    Ok((false, shown)) => {
                        tally.failed += 1;
                        failures.push(format!(
                            "{relative} {op} row {index}: got {shown}, row {row}"
                        ));
                    }
                }
            }
        }
    }

    for &(area, want) in CASES_PER_AREA {
        let got = per_area.get(area).copied().unwrap_or(0);
        if got != want {
            errors.push(format!("area {area}: {got} cases, expected {want}"));
        }
    }
    for area in per_area.keys() {
        if !CASES_PER_AREA.iter().any(|&(known, _)| known == area) {
            errors.push(format!("area {area}: not in CASES_PER_AREA"));
        }
    }

    let mut report = String::new();
    writeln!(
        report,
        "\nducat conformance suite ({} files, spec {})",
        files.len(),
        spec_version()
    )
    .unwrap();
    writeln!(
        report,
        "{:<10} {:<26} {:>7} {:>7} {:>7}  skipped because",
        "area", "operation", "passed", "failed", "skipped"
    )
    .unwrap();
    let (mut passed, mut failed, mut skipped) = (0, 0, 0);
    for ((area, op), tally) in &tallies {
        let skip_total: usize = tally.skipped.values().sum();
        let reasons: Vec<String> = tally
            .skipped
            .iter()
            .map(|(reason, count)| format!("{reason} ({count})"))
            .collect();
        writeln!(
            report,
            "{area:<10} {op:<26} {:>7} {:>7} {:>7}  {}",
            tally.passed,
            tally.failed,
            skip_total,
            reasons.join(", ")
        )
        .unwrap();
        passed += tally.passed;
        failed += tally.failed;
        skipped += skip_total;
    }
    writeln!(
        report,
        "{:<37} {passed:>7} {failed:>7} {skipped:>7}",
        "total"
    )
    .unwrap();
    println!("{report}");

    for failure in failures.iter().take(40) {
        println!("FAIL {failure}");
    }
    if failures.len() > 40 {
        println!("… and {} more failures", failures.len() - 40);
    }
    for error in &errors {
        println!("ERROR {error}");
    }
    if failures.is_empty() && errors.is_empty() {
        println!("spec: ok");
        ExitCode::SUCCESS
    } else {
        println!("spec: {} failures, {} errors", failures.len(), errors.len());
        ExitCode::FAILURE
    }
}
