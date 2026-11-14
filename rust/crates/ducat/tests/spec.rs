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
//!
//! Vectors whose inputs or expected values are beyond `i128` are skipped, with that reason: ducat
//! has unbounded integers and ducat-rs doesn't (see docs/design.md).

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use ducat::{AnyMoney, CurrencyCode, Error, ErrorKind, Rounding};
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

/// Operations the runner knows about but ducat-rs doesn't implement yet, with the milestone that
/// brings them. A name ending in `*` covers every operation with that prefix.
const NOT_YET: &[(&str, &str)] = &[
    ("money.split", "not yet: milestone 2 (allocate)"),
    ("money.allocate", "not yet: milestone 2 (allocate)"),
    (
        "money.allocate.generated",
        "not yet: milestone 2 (allocate)",
    ),
    ("allocate.byRemainder", "not yet: milestone 2 (allocate)"),
    ("instalments.byRemainder", "not yet: milestone 2 (allocate)"),
    ("chunk", "not yet: milestone 2 (allocate)"),
    ("schedule", "not yet: milestone 2 (allocate)"),
    ("roundToIncrement.byMode", "not yet: milestone 2 (cash)"),
    ("minor.percentage", "not yet: milestone 3 (tax)"),
    ("minor.discount", "not yet: milestone 3 (tax)"),
    ("minor.addTax", "not yet: milestone 3 (tax)"),
    ("minor.extractTax", "not yet: milestone 3 (tax)"),
    ("fixed.*", "not yet: milestone 3 (fixed)"),
    ("xnpv.scaled", "not yet: milestone 4 (excel)"),
    ("xirr.floor", "not yet: milestone 4 (excel)"),
    ("finance.*", "not yet: milestone 4 (finance)"),
    ("excel.*", "not yet: milestone 4 (excel)"),
    ("excelExample.*", "not yet: milestone 4 (excel)"),
    ("spreadsheet.*", "not yet: milestone 4 (excel)"),
    ("words.spellOut", "not yet: milestone 6 (ducat-icu)"),
];

const BEYOND_I128: &str = "beyond i128";

fn not_yet(op: &str) -> Option<&'static str> {
    NOT_YET.iter().find_map(|&(name, reason)| {
        let matches = match name.strip_suffix('*') {
            Some(prefix) => op.starts_with(prefix),
            None => op == name,
        };
        matches.then_some(reason)
    })
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

/// Whether the text is an integer, decimal or `a/b` rational whose digits don't fit an `i128`.
fn beyond_i128(text: &str) -> bool {
    text.split('/').any(|part| {
        let digits = part.strip_prefix('-').unwrap_or(part);
        let mut pieces = digits.splitn(2, '.');
        let whole = pieces.next().unwrap_or("");
        let fraction = pieces.next().unwrap_or("");
        let numeric = !whole.is_empty()
            && whole.bytes().all(|b| b.is_ascii_digit())
            && fraction.bytes().all(|b| b.is_ascii_digit());
        let all = format!("{whole}{fraction}");
        let significant = all.trim_start_matches('0');
        numeric && !significant.is_empty() && significant.parse::<i128>().is_err()
    })
}

/// Whether any string in the value (outside a binary64's informational `exact`) is beyond i128.
fn any_beyond_i128(value: &Value) -> bool {
    match value {
        Value::String(text) => beyond_i128(text),
        Value::Array(items) => items.iter().any(any_beyond_i128),
        Value::Object(fields) => fields.iter().any(|(key, field)| {
            let informational = key == "exact" && fields.contains_key("binary64");
            !informational && any_beyond_i128(field)
        }),
        _ => false,
    }
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
                money_of(&args["first"])?.checked_add(money_of(&args["second"])?)?,
            ))
        },
        "money.subtract" => |args| {
            Ok(Outcome::Money(
                money_of(&args["first"])?.checked_sub(money_of(&args["second"])?)?,
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
        _ => return None,
    })
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
    if any_beyond_i128(args) {
        return Err(BEYOND_I128);
    }
    let expected: Vec<&Value> = alternatives(&case["expect"])
        .into_iter()
        .filter(|e| !any_beyond_i128(e))
        .collect();
    if expected.is_empty() {
        return Err(BEYOND_I128);
    }
    let result = run(args);
    let passed = expected
        .iter()
        .any(|expectation| meets(&result, expectation));
    let shown = match &result {
        Ok(Outcome::Money(money)) => spec_money(money).to_string(),
        Ok(other) => format!("{other:?}"),
        Err(error) => format!("error {} ({error})", kind_name(error.kind())),
    };
    Ok((passed, shown))
}

// --- table operations --------------------------------------------------------------------------

type RowOp = fn(&Value) -> Result<i128, Error>;

fn row_op(op: &str) -> Option<RowOp> {
    fn start(row: &Value) -> Result<AnyMoney, Error> {
        Ok(AnyMoney::from_minor(
            minor_of(string(row, "minor")),
            code(string(row, "currency"))?,
        ))
    }
    Some(match op {
        "minor.multiply" => |row| {
            Ok(start(row)?
                .multiply(string(row, "factor"), mode(row))?
                .units())
        },
        "minor.divide" => |row| {
            Ok(start(row)?
                .divide(string(row, "divisor"), mode(row))?
                .units())
        },
        "minor.toScale" => |row| {
            let scale = u16::try_from(row["scale"].as_u64().expect("a scale"))
                .map_err(|_| Error::InvalidScale)?;
            Ok(start(row)?.to_scale(scale, mode(row))?.units())
        },
        "minor.convert" => |row| {
            Ok(start(row)?
                .convert(code(string(row, "to"))?, string(row, "rate"), mode(row))?
                .units())
        },
        _ => return None,
    })
}

/// Runs one row of a `minor.*` table: `want` is the result in minor units, or `null` for a
/// rounding error.
fn judge_row(run: RowOp, row: &Value) -> Result<(bool, String), Skip> {
    if any_beyond_i128(row) {
        return Err(BEYOND_I128);
    }
    let result = run(row);
    let passed = match (&result, &row["want"]) {
        (Ok(value), Value::String(want)) => value.to_string() == *want,
        (Err(error), Value::Null) => error.kind() == ErrorKind::Rounding,
        _ => false,
    };
    let shown = match result {
        Ok(value) => value.to_string(),
        Err(error) => format!("error {} ({error})", kind_name(error.kind())),
    };
    Ok((passed, shown))
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
                            let mut changed = row.clone();
                            changed["want"] = match &row["want"] {
                                Value::String(want) => serde_json::json!(format!(
                                    "{}",
                                    want.parse::<i128>().unwrap().wrapping_add(1)
                                )),
                                _ => serde_json::json!("0"),
                            };
                            if !matches!(judge_row(run, &changed), Ok((false, _))) {
                                errors.push(format!(
                                    "{relative} row {index}: a changed `want` still passes"
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
