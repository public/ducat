//! The Excel tables: `excel.*` (ducat's exact oracle), `xnpv.scaled` and `xirr.floor` (the Lean
//! models), `excelExample.*` (Microsoft's worked examples) and `spreadsheet.*` (LibreOffice Calc).
//!
//! The Calc and Microsoft judgements follow spec/README.md ("Microsoft's examples and LibreOffice
//! Calc") and ducat's own test of them, test/excel.test.ts, in exact rational arithmetic: Calc's
//! text is read exactly as a decimal, ε = 2^−52 is an exact rational, and every bound is computed
//! from its formula exactly. The one exception is NPER's L = |ln(1 + rate)|, which the README says
//! is computed in binary64: it is taken from an `f64` here, in the runner only, as ducat's test
//! does. The library never uses floats.
//!
//! The README leaves to the tests how many rows must agree at 15 digits ("strict"); those counts
//! are ducat's, from test/excel.test.ts, and are checked by [`threshold_problems`].

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use ducat::excel::{
    Nper, PaymentTiming, XnpvOptions, fv, fv_exact, irr, nper, npv, npv_exact, pmt, pmt_exact, pv,
    pv_exact, rate, xirr, xnpv, xnpv_bounds,
};
use ducat::finance::{Date, annual_rate, periodic_rate};
use ducat::{AnyMoney, CurrencyCode, Error, ErrorKind, Int, Ratio, Rounding};
use serde_json::{Map, Value};

use super::{Fields, RowOp, code, kind_name, minor_of, spec_dir, string};

// --- counts ------------------------------------------------------------------------------------

/// Whether rows run now count towards the thresholds (not while a changed row is judged).
pub(super) static COUNTING: AtomicBool = AtomicBool::new(true);

static COUNTS: Mutex<BTreeMap<(&'static str, &'static str), usize>> = Mutex::new(BTreeMap::new());

fn count(op: &'static str, what: &'static str) {
    if COUNTING.load(Ordering::Relaxed) {
        *COUNTS.lock().unwrap().entry((op, what)).or_default() += 1;
    }
}

fn counted(op: &'static str, what: &'static str) -> usize {
    COUNTS
        .lock()
        .unwrap()
        .get(&(op, what))
        .copied()
        .unwrap_or(0)
}

/// ducat's thresholds from test/excel.test.ts: most rows agree to every digit Calc shows, so the
/// error bounds aren't doing all the work. `(op, count, more than)`, or `less than` with `max`.
const AT_LEAST: &[(&str, &str, usize)] = &[
    ("spreadsheet.npv", "strict", 250),
    ("spreadsheet.irr", "converged", 150),
    ("spreadsheet.periodicRate", "strict", 130),
    ("spreadsheet.annualRate", "strict", 80),
    ("spreadsheet.fv", "strict", 80),
    ("spreadsheet.pv", "strict", 80),
    ("spreadsheet.pmt", "strict", 80),
    ("spreadsheet.nper", "strict", 100),
    ("spreadsheet.rate", "strict", 100),
    ("spreadsheet.xnpv", "strict", 100),
    ("spreadsheet.xirr", "converged", 140),
];
const AT_MOST: &[(&str, &[&str], usize)] = &[
    ("spreadsheet.irr", &["gaveUp", "belowMinusOne"], 60),
    ("spreadsheet.rate", &["atMinusOne"], 5),
];

/// The counts, one line per op, for the report.
pub(super) fn count_lines() -> Vec<String> {
    COUNTS
        .lock()
        .unwrap()
        .iter()
        .map(|((op, what), count)| format!("{op} {what}: {count}"))
        .collect()
}

/// The thresholds the counts miss.
pub(super) fn threshold_problems() -> Vec<String> {
    let mut problems = Vec::new();
    for &(op, what, more_than) in AT_LEAST {
        let got = counted(op, what);
        if got <= more_than {
            problems.push(format!(
                "{op}: {got} {what} rows, ducat's tests need more than {more_than}"
            ));
        }
    }
    for &(op, whats, less_than) in AT_MOST {
        let got: usize = whats.iter().map(|what| counted(op, what)).sum();
        if got >= less_than {
            problems.push(format!(
                "{op}: {got} {whats:?} rows, ducat's tests need fewer than {less_than}"
            ));
        }
    }
    problems
}

// --- reading -----------------------------------------------------------------------------------

fn usd_code() -> CurrencyCode {
    "USD".parse().unwrap()
}

/// A decimal string in major units of USD, as a spreadsheet cell holds it.
fn usd(text: &str) -> Result<AnyMoney, Error> {
    AnyMoney::parse(text, usd_code())
}

fn usd_list(row: &Value, key: &str) -> Result<Vec<AnyMoney>, Error> {
    row[key]
        .as_array()
        .unwrap_or_else(|| panic!("`{key}` is not a list"))
        .iter()
        .map(|value| usd(value.as_str().expect("an amount")))
        .collect()
}

/// Minor units of the row's currency, under `key`.
fn minor_list(row: &Value, key: &str) -> Result<Vec<AnyMoney>, Error> {
    let currency = code(string(row, "currency"))?;
    Ok(row[key]
        .as_array()
        .expect("a list")
        .iter()
        .map(|value| AnyMoney::from_minor(minor_of(value.as_str().expect("minor units")), currency))
        .collect())
}

fn minor_money(row: &Value, key: &str) -> Result<AnyMoney, Error> {
    Ok(AnyMoney::from_minor(
        minor_of(string(row, key)),
        code(string(row, "currency"))?,
    ))
}

fn dates(row: &Value) -> Result<Vec<Date>, Error> {
    row["dates"]
        .as_array()
        .expect("dates")
        .iter()
        .map(|date| date.as_str().expect("a date").parse())
        .collect()
}

/// The Lean tables' day numbers count from 2001-01-01.
fn day_dates(row: &Value) -> Result<Vec<Date>, Error> {
    let zero: Date = "2001-01-01".parse()?;
    row["days"]
        .as_array()
        .expect("days")
        .iter()
        .map(|day| zero.add_days(day.as_i64().expect("a day number")))
        .collect()
}

fn small(row: &Value, key: &str) -> u32 {
    let value = &row[key];
    let number = value
        .as_u64()
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        .unwrap_or_else(|| panic!("`{key}` is not a count in {row}"));
    u32::try_from(number).expect("a small count")
}

fn digits(row: &Value) -> u16 {
    u16::try_from(small(row, "digits")).expect("few digits")
}

fn timing(row: &Value) -> PaymentTiming {
    match row.get("type").and_then(Value::as_u64) {
        Some(1) => PaymentTiming::Start,
        _ => PaymentTiming::End,
    }
}

fn ratio(text: &str) -> Ratio {
    text.parse()
        .unwrap_or_else(|error| panic!("{text} is not a rational: {error}"))
}

fn pow10(exponent: u32) -> Int {
    (0..exponent).fold(Int::ONE, |power, _| power * Int::from(10))
}

/// `value × 10^exponent`, exactly.
fn scaled(value: &Ratio, exponent: i32) -> Ratio {
    let power = Ratio::from(pow10(exponent.unsigned_abs()));
    if exponent >= 0 {
        value.mul(&power)
    } else {
        value.div(&power).unwrap()
    }
}

/// Calc's printed double (`"-1.188443412335220E+03"`) as an exact rational, or `None` for an error
/// such as `"Err:523"` or `"#NUM!"`.
fn calc_ratio(text: &str) -> Option<Ratio> {
    let (mantissa, exponent) = text.split_once('E')?;
    if !mantissa.starts_with(|c: char| c == '-' || c.is_ascii_digit()) {
        return None;
    }
    Some(scaled(&mantissa.parse().ok()?, exponent.parse().ok()?))
}

/// Calc's text's decimal exponent: `E+03` is 3.
fn calc_exponent(text: &str) -> i32 {
    text.split_once('E')
        .and_then(|(_, exponent)| exponent.parse().ok())
        .expect("Calc's exponent")
}

/// t(c): half a unit in the 15th significant digit of Calc's text, 5 × 10^(e − 15).
fn text_rounding(text: &str) -> Ratio {
    scaled(&Ratio::from(5), calc_exponent(text) - 15)
}

/// ε = 2^−52.
fn epsilon() -> Ratio {
    Ratio::new(1, 1u64 << 52).unwrap()
}

fn units_of(count: usize) -> Ratio {
    Ratio::from(count)
}

/// `|left − right| ≤ bound`.
fn within(left: &Ratio, right: &Ratio, bound: &Ratio) -> bool {
    left.sub(right).abs() <= *bound
}

/// S15(x): the exact value at 15 significant digits, half away from zero, as `1.23…E+3`.
fn significant15(value: &Ratio) -> String {
    if value.is_zero() {
        return "0".into();
    }
    let magnitude = value.abs();
    let ten_to = |power: i32| scaled(&Ratio::ONE, power);
    let mut exponent =
        magnitude.numer().to_string().len() as i32 - magnitude.denom().to_string().len() as i32;
    while magnitude < ten_to(exponent) {
        exponent -= 1;
    }
    while magnitude >= ten_to(exponent + 1) {
        exponent += 1;
    }
    let mut mantissa = scaled(&magnitude, 14 - exponent)
        .round_to_units(0, Rounding::HalfExpand)
        .unwrap();
    if mantissa == pow10(15) {
        mantissa = pow10(14);
        exponent += 1;
    }
    let digits = mantissa.to_string();
    let sign = if value.numer().is_negative() { "-" } else { "" };
    let exponent_sign = if exponent >= 0 { "+" } else { "" };
    format!(
        "{sign}{}.{}E{exponent_sign}{exponent}",
        &digits[..1],
        &digits[1..]
    )
}

/// S15 of Calc's text, or the text itself for an error.
fn calc_significant15(text: &str) -> String {
    calc_ratio(text).map_or_else(|| text.to_owned(), |value| significant15(&value))
}

/// round(x, p): half away from zero to `places` places, as a decimal string.
fn round_decimal(value: &Ratio, places: u16) -> String {
    let units = value.round_to_units(places, Rounding::HalfExpand).unwrap();
    let digits = units.abs().to_string();
    let places = usize::from(places);
    let digits = format!("{digits:0>width$}", width = places + 1);
    let (whole, fraction) = digits.split_at(digits.len() - places);
    let sign = if units.is_negative() { "-" } else { "" };
    if places == 0 {
        format!("{sign}{whole}")
    } else {
        format!("{sign}{whole}.{fraction}")
    }
}

/// A rational as the tables write a bound: `num/den`, with `/1` for an integer.
fn fraction(value: &Ratio) -> String {
    format!("{}/{}", value.numer(), value.denom())
}

/// The row's own text where our value equals it ("rational": the same value in any form), else
/// ours.
fn rational(ours: &Ratio, theirs: Option<&Value>) -> Value {
    match theirs.and_then(Value::as_str) {
        Some(text) if text.parse::<Ratio>().is_ok_and(|value| value == *ours) => {
            Value::String(text.to_owned())
        }
        _ => Value::String(format!("ours {}", fraction(ours))),
    }
}

fn error_text(error: &Error) -> Value {
    Value::String(format!("error {} ({error})", kind_name(error.kind())))
}

/// A grid result as an integer string, or `null` (or `"throws"`) for a range error.
fn grid_field(result: Result<Int, Error>, range: Value) -> Value {
    match result {
        Ok(grid) => Value::String(grid.to_string()),
        Err(error) if error.kind() == ErrorKind::Range => range,
        Err(error) => error_text(&error),
    }
}

const MODES: [Rounding; 9] = [
    Rounding::HalfEven,
    Rounding::HalfExpand,
    Rounding::HalfTrunc,
    Rounding::HalfCeil,
    Rounding::HalfFloor,
    Rounding::Expand,
    Rounding::Trunc,
    Rounding::Ceil,
    Rounding::Floor,
];

/// `{mode: minor units}` for every mode, `null` for a range error.
fn rounded_by_mode(round: impl Fn(Rounding) -> Result<AnyMoney, Error>) -> Value {
    let mut out = Map::new();
    for mode in MODES {
        let value = match round(mode) {
            Ok(money) => Value::String(money.to_minor().unwrap().to_string()),
            Err(error) if error.kind() == ErrorKind::Range => Value::Null,
            Err(error) => error_text(&error),
        };
        out.insert(mode.name().to_owned(), value);
    }
    Value::Object(out)
}

/// A verdict field: the row's own value where the judgement passes, else why not.
fn verdict(row: &Value, key: &str, outcome: Result<Result<(), String>, Error>) -> Value {
    match outcome {
        Ok(Ok(())) => row[key].clone(),
        Ok(Err(why)) => Value::String(format!("fails: {why}")),
        Err(error) => error_text(&error),
    }
}

/// The NPV's sign at `rate` (num/den) for flows in integers, by Horner's rule.
fn npv_sign(units: &[Int], rate: &Ratio) -> i8 {
    let growth = rate.numer() + rate.denom();
    let mut accumulator = units[0].clone();
    let mut base_power = Int::ONE;
    for flow in &units[1..] {
        base_power = base_power * rate.denom();
        accumulator = accumulator * &growth + flow * &base_power;
    }
    accumulator.signum()
}

fn cents(money: &AnyMoney) -> Int {
    money.to_minor().unwrap()
}

// --- the oracle --------------------------------------------------------------------------------

/// excel/fractions.json, for the edge cases, which are judged against its rows by note.
fn oracle() -> &'static Value {
    static ORACLE: OnceLock<Value> = OnceLock::new();
    ORACLE.get_or_init(|| {
        let path = spec_dir().join(Path::new("vectors/excel/fractions.json"));
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    })
}

/// The oracle's table for an edge case table's name.
fn oracle_op(name: &str) -> &'static str {
    match name {
        "fv" | "pv" | "pmt" => "excel.annuities",
        "nper" => "excel.nper",
        "rate" => "excel.rate",
        "xnpv" => "excel.xnpv",
        "xirr" => "excel.xirr",
        _ => panic!("no edge case table {name}"),
    }
}

fn find_oracle_row(op: &str, note: &str) -> Option<&'static Value> {
    oracle()["tables"]
        .as_array()
        .unwrap()
        .iter()
        .find(|table| table["op"] == op)
        .and_then(|table| table["rows"].as_array())
        .and_then(|rows| rows.iter().find(|row| row["note"] == note))
}

fn oracle_row(op: &str, note: &str) -> &'static Value {
    oracle()["tables"]
        .as_array()
        .unwrap()
        .iter()
        .find(|table| table["op"] == op)
        .and_then(|table| table["rows"].as_array())
        .and_then(|rows| rows.iter().find(|row| row["note"] == note))
        .unwrap_or_else(|| panic!("no {op} row with note {note:?} in excel/fractions.json"))
}

/// Where Calc's doubles differ from the exact value by more than 1e-12 relative (ducat matches
/// the oracle on every one of these), and why: test/excel.test.ts, `differs`.
const DIFFERS: &[(&str, &str)] = &[
    (
        "fv: a tiny rate over 360 periods: (1 + r)^n - 1 cancels in doubles",
        "(1 + r)^n − 1 at r = 1e-9 keeps about 7 digits: Calc is 5e-7 relative off",
    ),
    (
        "fv: a tiny rate, payments at the start",
        "the same cancellation at r = 1e-7: 6e-10 relative",
    ),
    (
        "fv: a payment and values that cancel at this rate",
        "exactly 0; Calc leaves 1.4e-13",
    ),
    (
        "pv: a tiny rate over 360 periods: (1 + r)^n - 1 cancels in doubles",
        "the same cancellation: 8e-8 relative",
    ),
    (
        "pv: a tiny rate, payments at the start",
        "the same cancellation: 2e-8 relative",
    ),
    (
        "nper: a tiny rate",
        "ln(1 + r) at r = 1e-9 in doubles: 3e-10 relative",
    ),
    (
        "rate: a rate of exactly 0",
        "the rate is exactly 0; Calc stops at 6e-11",
    ),
    (
        "rate: payments at the start, a balloon",
        "Calc's iteration stops early: 3.5e-12 relative",
    ),
    (
        "rate: ill-conditioned: a rate near 1e-9 over 360 periods",
        "Calc is 2% off",
    ),
    (
        "rate: ill-conditioned: a rate near -1e-9 over 360 periods",
        "Calc is 0.05% off",
    ),
    (
        "rate: ill-conditioned: a rate near 1e-10 over 480 periods, at the start",
        "Calc returns 4.7e-10 for a rate of 8.7e-11, 5.4 times too large",
    ),
];

/// Where Calc returns an error: test/excel.test.ts, `refuses`.
const REFUSES: &[(&str, &str)] = &[
    (
        "nper: payments that never settle the loan (no value)",
        "both refuse: Calc #NUM!, ducat throws",
    ),
    (
        "xirr: a rate near -1",
        "Calc returns Err:502; ducat brackets the rate, -0.999897451583",
    ),
];

/// The oracle's range for an edge case: a point where the value is exact, its bounds, or the
/// grid step `[lower, lower + 10^−digits)`; `None` where the oracle throws.
fn oracle_range(name: &str, note: &str) -> Option<(Ratio, Ratio)> {
    let point = |text: &str| Some((ratio(text), ratio(text)));
    let step = |row: &Value| {
        let unit = Ratio::from(pow10(u32::from(digits(row))));
        let lower = Ratio::from(minor_of(string(row, "lower")));
        Some((
            lower.div(&unit).unwrap(),
            lower.add(&Ratio::ONE).div(&unit).unwrap(),
        ))
    };
    match name {
        "fv" | "pv" | "pmt" => point(string(
            &oracle_row("excel.annuities", note)["results"][name],
            "exact",
        )),
        "nper" => {
            let row = oracle_row("excel.nper", note);
            if row["lower"] == "throws" {
                None
            } else if let Some(exact) = row.get("exact") {
                point(exact.as_str().unwrap())
            } else {
                step(row)
            }
        }
        "rate" | "xirr" => step(oracle_row(&format!("excel.{name}"), note)),
        "xnpv" => {
            let row = oracle_row("excel.xnpv", note);
            match row.get("exact") {
                Some(exact) => point(exact.as_str().unwrap()),
                None => Some((ratio(string(row, "low")), ratio(string(row, "high")))),
            }
        }
        _ => panic!("no edge case table {name}"),
    }
}

/// `spreadsheet.edge.*`: Calc agrees with the oracle's range widened by 10^−12 × its larger end +
/// 10^−15, except where it is listed as differing; where Calc or the oracle refuses, it must be
/// listed as refusing.
fn edge_row(row: &Value, name: &str) -> Fields {
    let note = string(row, "note");
    if find_oracle_row(oracle_op(name), note).is_none() {
        return vec![(
            "note",
            Value::String(format!("fails: no oracle row {note:?}")),
        )];
    }
    let key = format!("{name}: {note}");
    let listed = |list: &[(&str, &str)]| list.iter().any(|(entry, _)| *entry == key);
    let calc = string(row, "calc");
    let range = oracle_range(name, string(row, "note"));
    let outcome = match (calc_ratio(calc), range) {
        (Some(theirs), Some((low, high))) => {
            let larger = if low.abs() > high.abs() {
                low.abs()
            } else {
                high.abs()
            };
            let slack = larger
                .mul(&Ratio::new(1, 1_000_000_000_000u64).unwrap())
                .add(&Ratio::new(1, 1_000_000_000_000_000u64).unwrap());
            let agrees = low.sub(&slack) <= theirs && theirs <= high.add(&slack);
            if agrees == listed(DIFFERS) {
                Err(format!(
                    "Calc {} the oracle",
                    if agrees {
                        "agrees with"
                    } else {
                        "differs from"
                    }
                ))
            } else {
                Ok(())
            }
        }
        _ if listed(REFUSES) => Ok(()),
        (_, range) => Err(format!(
            "Calc {calc}, the oracle {}, and not listed as refusing",
            if range.is_some() { "a value" } else { "throws" }
        )),
    };
    let calc_verdict = ("calc", verdict(row, "calc", Ok(outcome)));
    if listed(DIFFERS) || listed(REFUSES) {
        // a listed row passes whatever Calc's value, so its note, which must name an oracle row,
        // comes first, for the runner's changed-expectation check
        vec![("note", row["note"].clone()), calc_verdict]
    } else {
        vec![calc_verdict]
    }
}

// --- excel/fractions.json ----------------------------------------------------------------------

fn annuities_row(row: &Value) -> Fields {
    let money = |key: &str| minor_money(row, key);
    let run = || -> Result<Value, Error> {
        let (payment, present, future) = (money("pmt")?, money("pv")?, money("fv")?);
        let rate_text = string(row, "rate");
        let periods = small(row, "nper");
        let timing = timing(row);
        let mut results = Map::new();
        // every table row has all three; a changed row may not
        for name in ["fv", "pv", "pmt"] {
            let want = &row["results"][name];
            let exact = match name {
                "fv" => fv_exact(rate_text, periods, &payment, Some(&present), timing),
                "pv" => pv_exact(rate_text, periods, &payment, Some(&future), timing),
                "pmt" => pmt_exact(rate_text, periods, &present, Some(&future), timing),
                other => panic!("no annuity {other}"),
            }?;
            let rounded = rounded_by_mode(|mode| match name {
                "fv" => fv(rate_text, periods, &payment, Some(&present), timing, mode),
                "pv" => pv(rate_text, periods, &payment, Some(&future), timing, mode),
                _ => pmt(rate_text, periods, &present, Some(&future), timing, mode),
            });
            let mut result = Map::new();
            result.insert("exact".into(), rational(exact.value(), want.get("exact")));
            result.insert("rounded".into(), rounded);
            results.insert(name.to_owned(), Value::Object(result));
        }
        Ok(Value::Object(results))
    };
    vec![("results", run().unwrap_or_else(|error| error_text(&error)))]
}

fn nper_row(row: &Value) -> Fields {
    let result = (|| -> Result<Nper, Error> {
        nper(
            string(row, "rate"),
            &minor_money(row, "pmt")?,
            &minor_money(row, "pv")?,
            Some(&minor_money(row, "fv")?),
            timing(row),
            digits(row),
        )
    })();
    let mut fields = vec![(
        "lower",
        grid_field(
            result.clone().map(|result| result.periods.grid().clone()),
            Value::String("throws".into()),
        ),
    )];
    // `exact` is present exactly when the period count is rational
    let ours = result.ok().and_then(|result| result.exact);
    match (&ours, row.get("exact")) {
        (Some(value), theirs) => fields.push(("exact", rational(value, theirs))),
        (None, Some(_)) => fields.push(("exact", Value::String("ours: none".into()))),
        (None, None) => {}
    }
    fields
}

fn rate_row(row: &Value) -> Fields {
    let result = (|| {
        rate(
            small(row, "nper"),
            &minor_money(row, "pmt")?,
            &minor_money(row, "pv")?,
            Some(&minor_money(row, "fv")?),
            timing(row),
            digits(row),
            None,
        )
    })();
    vec![(
        "lower",
        grid_field(result.map(|rate| rate.grid().clone()), Value::Null),
    )]
}

fn xnpv_options(row: &Value) -> Result<XnpvOptions, Error> {
    let mut options = XnpvOptions::default();
    if let Some(day_count) = row.get("dayCount").and_then(Value::as_str) {
        options.day_count = day_count.parse()?;
    }
    Ok(options)
}

/// `excel.xnpv`: where the oracle's value is exact, ducat's bounds are both that value and marked
/// exact; otherwise they contain the oracle's `[low, high]` and are at most 10^−digits wide.
fn oracle_xnpv_row(row: &Value) -> Fields {
    let values = minor_list(row, "values");
    let dates = dates(row);
    let options = xnpv_options(row);
    let rounded = match (&values, &dates, &options) {
        (Ok(values), Ok(dates), Ok(options)) => {
            rounded_by_mode(|mode| xnpv(string(row, "rate"), values, dates, options, mode))
        }
        _ => Value::String("bad inputs".into()),
    };
    let bounds = (|| {
        xnpv_bounds(
            string(row, "rate"),
            &values.clone()?,
            &dates.clone()?,
            &options?,
            digits(row),
        )
    })();
    let mut fields = vec![("rounded", rounded)];
    let bounds = match bounds {
        Ok(bounds) => bounds,
        Err(error) => {
            fields.push(("bounds", error_text(&error)));
            return fields;
        }
    };
    if let Some(exact) = row.get("exact").and_then(Value::as_str) {
        let value = ratio(exact);
        let ok = bounds.exact && bounds.lower == value && bounds.upper == value;
        fields.push((
            "exact",
            verdict(
                row,
                "exact",
                Ok(if ok {
                    Ok(())
                } else {
                    Err(format!("{bounds:?}"))
                }),
            ),
        ));
    } else {
        let width = Ratio::new(1, pow10(u32::from(digits(row)))).unwrap();
        let narrow = !bounds.exact && bounds.upper.sub(&bounds.lower) <= width;
        let low_ok = narrow && bounds.lower <= ratio(string(row, "low"));
        let high_ok = narrow && ratio(string(row, "high")) <= bounds.upper;
        let shown = format!(
            "{} to {}, exact {}",
            fraction(&bounds.lower),
            fraction(&bounds.upper),
            bounds.exact
        );
        fields.push((
            "low",
            verdict(
                row,
                "low",
                Ok(if low_ok { Ok(()) } else { Err(shown.clone()) }),
            ),
        ));
        fields.push((
            "high",
            verdict(row, "high", Ok(if high_ok { Ok(()) } else { Err(shown) })),
        ));
    }
    fields
}

fn oracle_xirr_row(row: &Value) -> Fields {
    let result = (|| {
        xirr(
            &minor_list(row, "values")?,
            &dates(row)?,
            &XnpvOptions::default(),
            digits(row),
            None,
        )
    })();
    vec![(
        "lower",
        grid_field(result.map(|rate| rate.grid().clone()), Value::Null),
    )]
}

// --- the Lean tables ---------------------------------------------------------------------------

/// `xnpv.scaled`: the bounds as `num/den` (or `null` for a range error), and the value rounded in
/// each mode, exactly as ducat gives them.
fn xnpv_scaled_row(row: &Value) -> Fields {
    let parts = row["rate"].as_array().expect("a rate");
    let rate_of = || {
        Ratio::new(
            minor_of(parts[0].as_str().unwrap()),
            minor_of(parts[1].as_str().unwrap()),
        )
    };
    let values = minor_list(row, "values");
    let dates = day_dates(row);
    let options = XnpvOptions::default();
    let bounds = (|| {
        xnpv_bounds(
            rate_of()?,
            &values.clone()?,
            &dates.clone()?,
            &options,
            digits(row),
        )
    })();
    let bounds = match bounds {
        Ok(bounds) => {
            let mut out = Map::new();
            out.insert("lower".into(), Value::String(fraction(&bounds.lower)));
            out.insert("upper".into(), Value::String(fraction(&bounds.upper)));
            out.insert("exact".into(), Value::Bool(bounds.exact));
            Value::Object(out)
        }
        Err(error) if error.kind() == ErrorKind::Range => Value::Null,
        Err(error) => error_text(&error),
    };
    let rounded = rounded_by_mode(|mode| {
        xnpv(
            rate_of()?,
            &values.clone()?,
            &dates.clone()?,
            &options,
            mode,
        )
    });
    vec![("bounds", bounds), ("rounded", rounded)]
}

fn xirr_floor_row(row: &Value) -> Fields {
    let result = (|| {
        xirr(
            &minor_list(row, "values")?,
            &day_dates(row)?,
            &XnpvOptions::default(),
            digits(row),
            None,
        )
    })();
    vec![(
        "lower",
        grid_field(result.map(|rate| rate.grid().clone()), Value::Null),
    )]
}

// --- Microsoft's examples ----------------------------------------------------------------------

/// A table parameter (`accuracy`), which the runner copies into each row.
fn parameter(row: &Value, name: &str) -> Ratio {
    ratio(
        row["$parameters"][name]
            .as_str()
            .unwrap_or_else(|| panic!("no parameter {name}")),
    )
}

/// The accuracy Microsoft's IRR page states, which `spreadsheet.irr` also uses.
const IRR_ACCURACY: &str = "0.0000001";

fn optional_usd(row: &Value, key: &str) -> Result<Option<AnyMoney>, Error> {
    row.get(key).and_then(Value::as_str).map(usd).transpose()
}

/// `excelExample.*`: the result as the page shows it, or why not.
fn example_row(row: &Value, name: &str) -> Fields {
    let shown = (|| -> Result<String, Error> {
        let cell_rate = || row.get("rate").and_then(Value::as_str).unwrap_or("0");
        Ok(match name {
            "npv" => usd(string(row, "outside"))?
                .checked_add(&npv(
                    string(row, "rate"),
                    &usd_list(row, "values")?,
                    Rounding::HalfExpand,
                )?)?
                .to_decimal(),
            "irr" => {
                assert_eq!(parameter(row, "accuracy"), ratio(IRR_ACCURACY));
                round_decimal(&irr(&usd_list(row, "values")?, 12, None)?.lower(), 3)
            }
            "rri" => {
                // RRI(n, pv, fv) = (fv / pv)^(1/n) − 1: the periodic rate of a growth of fv/pv − 1
                let (present, future) = (ratio(string(row, "pv")), ratio(string(row, "fv")));
                let growth = future.sub(&present).div(&present)?;
                round_decimal(
                    &periodic_rate(growth, small(row, "nper"), 15)?.rate.lower(),
                    7,
                )
            }
            "effect" => {
                // EFFECT(nominal, n) = (1 + nominal / n)^n − 1
                let per_year = small(row, "npery");
                let periodic = ratio(string(row, "nominal")).div(&Ratio::from(per_year))?;
                round_decimal(&annual_rate(periodic, per_year)?, 7)
            }
            "fv" => fv(
                cell_rate(),
                small(row, "nper"),
                &usd(string(row, "pmt"))?,
                optional_usd(row, "pv")?.as_ref(),
                timing(row),
                Rounding::HalfExpand,
            )?
            .to_decimal(),
            "pv" => pv(
                cell_rate(),
                small(row, "nper"),
                &usd(string(row, "pmt"))?,
                optional_usd(row, "fv")?.as_ref(),
                timing(row),
                Rounding::HalfExpand,
            )?
            .to_decimal(),
            "pmt" => pmt(
                cell_rate(),
                small(row, "nper"),
                &usd(string(row, "pv"))?,
                optional_usd(row, "fv")?.as_ref(),
                timing(row),
                Rounding::HalfExpand,
            )?
            .to_decimal(),
            "nper" => {
                // both ends of the bracket at p + 6 places round to what the page shows
                let places = string(row, "result")
                    .split_once('.')
                    .map_or(0, |(_, f)| f.len());
                let places = u16::try_from(places).unwrap();
                let result = nper(
                    cell_rate(),
                    &usd(string(row, "pmt"))?,
                    &usd(string(row, "pv"))?,
                    optional_usd(row, "fv")?.as_ref(),
                    timing(row),
                    places + 6,
                )?;
                let (lower, upper) = (
                    round_decimal(&result.periods.lower(), places),
                    round_decimal(&result.periods.upper(), places),
                );
                if lower == upper {
                    lower
                } else {
                    format!("{lower} to {upper}")
                }
            }
            "rate" => {
                let result = rate(
                    small(row, "nper"),
                    &usd(string(row, "pmt"))?,
                    &usd(string(row, "pv"))?,
                    None,
                    PaymentTiming::End,
                    12,
                    None,
                )?;
                let times = row.get("times").map_or(1, |_| small(row, "times"));
                let places = u16::try_from(small(row, "places")).unwrap();
                round_decimal(&result.lower().mul(&Ratio::from(times)), places)
            }
            "xnpv" => xnpv(
                string(row, "rate"),
                &usd_list(row, "values")?,
                &dates(row)?,
                &XnpvOptions::default(),
                Rounding::HalfExpand,
            )?
            .to_decimal(),
            "xirr" => {
                // Excel stops within the page's accuracy of the root, which lies in [lower, upper]
                let accuracy = parameter(row, "accuracy");
                let result = xirr(
                    &usd_list(row, "values")?,
                    &dates(row)?,
                    &XnpvOptions::default(),
                    12,
                    None,
                )?;
                let shown = ratio(string(row, "result"));
                if result.lower().sub(&shown) <= accuracy && shown.sub(&result.upper()) <= accuracy
                {
                    string(row, "result").to_owned()
                } else {
                    format!("{} to {}", result, result.upper_decimal())
                }
            }
            other => panic!("no example table {other}"),
        })
    })();
    vec![(
        "result",
        shown.map_or_else(|error| error_text(&error), Value::String),
    )]
}

// --- LibreOffice Calc --------------------------------------------------------------------------

/// The Calc verdict: `strict` counts a pass at 15 digits.
fn calc_field(
    row: &Value,
    op: &'static str,
    judge: impl FnOnce(&str) -> Result<Result<bool, String>, Error>,
) -> Fields {
    let outcome = judge(string(row, "calc")).map(|result| {
        result.map(|strict| {
            if strict {
                count(op, "strict");
            }
        })
    });
    vec![("calc", verdict(row, "calc", outcome))]
}

fn calc_value(text: &str) -> Result<Ratio, String> {
    calc_ratio(text).ok_or_else(|| format!("Calc gives {text}"))
}

/// Passes at 15 digits, or within `bound` of Calc.
fn fifteen_or_within(
    ours: &Ratio,
    calc: &str,
    bound: impl FnOnce() -> Ratio,
) -> Result<bool, String> {
    if significant15(ours) == calc_significant15(calc) {
        return Ok(true);
    }
    let theirs = calc_value(calc)?;
    if within(ours, &theirs, &bound()) {
        Ok(false)
    } else {
        Err(format!(
            "ours {} ({}), Calc {calc}",
            significant15(ours),
            fraction(ours)
        ))
    }
}

fn spreadsheet_npv(row: &Value) -> Fields {
    calc_field(row, "spreadsheet.npv", |calc| {
        let flows = usd_list(row, "flows")?;
        let rate_text = string(row, "rate");
        let ours = npv_exact(rate_text, &flows)?.value().clone();
        // Calc sums in doubles: (n + 2) · ε · Σ |flowᵢ| / (1 + rate)ⁱ
        let sizes: Vec<AnyMoney> = flows.iter().map(AnyMoney::abs).collect();
        let size = npv_exact(rate_text, &sizes)?.value().clone();
        Ok(fifteen_or_within(&ours, calc, || {
            units_of(flows.len() + 2).mul(&epsilon()).mul(&size)
        }))
    })
}

fn spreadsheet_irr(row: &Value) -> Fields {
    const OP: &str = "spreadsheet.irr";
    let outcome = (|| -> Result<Result<(), String>, Error> {
        let flows = usd_list(row, "flows")?;
        let result = irr(&flows, 12, None)?;
        // whatever Calc did, the bracket is genuine: the NPV changes sign over it, or is 0 at lower
        let units: Vec<Int> = flows.iter().map(cents).collect();
        let (low_sign, high_sign) = (
            npv_sign(&units, &result.lower()),
            npv_sign(&units, &result.upper()),
        );
        if !(low_sign == 0 || low_sign == -high_sign) {
            return Ok(Err(format!("no sign change over {result}")));
        }
        let calc = string(row, "calc");
        let Some(theirs) = calc_ratio(calc) else {
            // Calc's Newton iteration gave up (Err:523), as Excel's returns #NUM!
            count(OP, "gaveUp");
            return Ok(Ok(()));
        };
        if theirs <= Ratio::from(-1) {
            // a root of the polynomial at 1 + rate < 0, where no IRR can be: Newton went past −1
            count(OP, "belowMinusOne");
            return Ok(Ok(()));
        }
        count(OP, "converged");
        let accuracy = ratio(IRR_ACCURACY);
        if result.lower().sub(&theirs) <= accuracy && theirs.sub(&result.upper()) <= accuracy {
            Ok(Ok(()))
        } else {
            Ok(Err(format!("ours {result}, Calc {calc}")))
        }
    })();
    vec![("calc", verdict(row, "calc", outcome))]
}

fn spreadsheet_periodic_rate(row: &Value) -> Fields {
    calc_field(row, "spreadsheet.periodicRate", |calc| {
        let result = periodic_rate(string(row, "annual"), small(row, "perYear"), 25)?;
        let one_plus_lower = result.rate.lower().add(&Ratio::ONE);
        let one_plus_upper = result.rate.upper().add(&Ratio::ONE);
        let calc_one_plus = string(row, "calcOnePlus");
        // the root is in [lower, upper): when both ends agree at 15 digits, so does the root
        let ours = significant15(&one_plus_lower);
        let strict =
            ours == significant15(&one_plus_upper) && ours == calc_significant15(calc_one_plus);
        if !strict {
            let bound = units_of(8)
                .mul(&epsilon())
                .add(&text_rounding(calc_one_plus));
            let theirs = match calc_value(calc_one_plus) {
                Ok(theirs) => theirs,
                Err(why) => return Ok(Err(why)),
            };
            if !within(&one_plus_lower, &theirs, &bound) {
                return Ok(Err(format!("1 + rate: ours {ours}, Calc {calc_one_plus}")));
            }
        }
        // the rate itself: Calc's subtraction is exact, so the same absolute error bounds it
        let bound = units_of(8).mul(&epsilon()).add(&text_rounding(calc));
        let theirs = match calc_value(calc) {
            Ok(theirs) => theirs,
            Err(why) => return Ok(Err(why)),
        };
        if within(&result.rate.lower(), &theirs, &bound) {
            Ok(Ok(strict))
        } else {
            Ok(Err(format!("rate: ours {}, Calc {calc}", result.rate)))
        }
    })
}

fn spreadsheet_annual_rate(row: &Value) -> Fields {
    calc_field(row, "spreadsheet.annualRate", |calc| {
        let per_year = small(row, "perYear");
        let ours = annual_rate(string(row, "periodic"), per_year)?;
        // ((perYear + 2)(1 + v) + 1) ε + t(calc)
        Ok(fifteen_or_within(&ours, calc, || {
            Ratio::from(per_year + 2)
                .mul(&ours.add(&Ratio::ONE))
                .add(&Ratio::ONE)
                .mul(&epsilon())
                .add(&text_rounding(calc))
        }))
    })
}

/// The annuity arguments of a Calc row, in USD.
struct Arguments {
    rate: Ratio,
    nper: u32,
    pmt: AnyMoney,
    pv: AnyMoney,
    fv: AnyMoney,
    timing: PaymentTiming,
}

fn arguments(row: &Value) -> Result<Arguments, Error> {
    Ok(Arguments {
        rate: ratio(row.get("rate").and_then(Value::as_str).unwrap_or("0")),
        nper: row.get("nper").map_or(0, |_| small(row, "nper")),
        pmt: usd(string(row, "pmt"))?,
        pv: usd(string(row, "pv"))?,
        fv: usd(string(row, "fv"))?,
        timing: timing(row),
    })
}

fn magnitude_of(money: &AnyMoney) -> Ratio {
    ratio(&money.to_decimal()).abs()
}

/// G = (1 + r)^n, and the payment term's size |pmt|·(1 + |r|·type)·(G + 1)/|r| (or |pmt|·n at a
/// rate of 0).
fn sizes(arguments: &Arguments) -> (Ratio, Ratio) {
    let one = Ratio::ONE;
    let growth =
        (0..arguments.nper).fold(Ratio::ONE, |power, _| power.mul(&arguments.rate.add(&one)));
    let absolute_rate = arguments.rate.abs();
    let payment = magnitude_of(&arguments.pmt);
    let start = Ratio::from(arguments.timing.excel_type());
    let term = if arguments.rate.is_zero() {
        payment.mul(&Ratio::from(arguments.nper))
    } else {
        payment
            .mul(&one.add(&absolute_rate.mul(&start)))
            .mul(&growth.add(&one))
            .div(&absolute_rate)
            .unwrap()
    };
    (growth, term)
}

/// FV, PV and PMT: at 15 digits, or within (nper + 8) ε × size + t(calc).
fn spreadsheet_annuity(row: &Value, name: &str) -> Fields {
    let op = match name {
        "fv" => "spreadsheet.fv",
        "pv" => "spreadsheet.pv",
        _ => "spreadsheet.pmt",
    };
    calc_field(row, op, |calc| {
        let arguments = arguments(row)?;
        let Arguments {
            rate: rate_value,
            nper: periods,
            pmt: payment,
            pv: present,
            fv: future,
            timing,
        } = &arguments;
        let ours = match name {
            "fv" => fv_exact(rate_value, *periods, payment, Some(present), *timing),
            "pv" => pv_exact(rate_value, *periods, payment, Some(future), *timing),
            _ => pmt_exact(rate_value, *periods, present, Some(future), *timing),
        }?
        .value()
        .clone();
        let (growth, term) = sizes(&arguments);
        let one = Ratio::ONE;
        let size = match name {
            "fv" => magnitude_of(present).mul(&growth).add(&term),
            "pv" => magnitude_of(future).add(&term).div(&growth)?,
            _ => {
                // −(pv·G + fv)·r / ((1 + r·type)·(G − 1)): the numerator's size over the
                // denominator, times the relative error of G − 1, (G + 1)/|G − 1|, plus one
                let top = magnitude_of(present)
                    .mul(&growth)
                    .add(&magnitude_of(future));
                if rate_value.is_zero() {
                    top.div(&Ratio::from(*periods))?
                } else {
                    let start = Ratio::from(timing.excel_type());
                    let bottom = one
                        .add(&rate_value.mul(&start))
                        .mul(&growth.sub(&one))
                        .abs();
                    let conditioning = one.add(&growth.add(&one).div(&growth.sub(&one).abs())?);
                    top.mul(&rate_value.abs()).div(&bottom)?.mul(&conditioning)
                }
            }
        };
        Ok(fifteen_or_within(&ours, calc, || {
            units_of(*periods as usize + 8)
                .mul(&epsilon())
                .mul(&size)
                .add(&text_rounding(calc))
        }))
    })
}

/// |ours − calc| ≤ count · ε · size + t(calc).
fn close(ours: &Ratio, calc: &str, size: &Ratio, units: usize) -> Result<bool, String> {
    let theirs = calc_value(calc)?;
    let bound = units_of(units)
        .mul(&epsilon())
        .mul(size)
        .add(&text_rounding(calc));
    if within(ours, &theirs, &bound) {
        Ok(false)
    } else {
        Err(format!(
            "ours {} ({}), Calc {calc}",
            significant15(ours),
            fraction(ours)
        ))
    }
}

fn spreadsheet_nper(row: &Value) -> Fields {
    calc_field(row, "spreadsheet.nper", |calc| {
        let arguments = arguments(row)?;
        let result = nper(
            &arguments.rate,
            &arguments.pmt,
            &arguments.pv,
            Some(&arguments.fv),
            arguments.timing,
            25,
        )?;
        let (lower, upper) = (result.periods.lower(), result.periods.upper());
        let ours = significant15(&lower);
        let strict = match &result.exact {
            Some(exact) => significant15(exact) == calc_significant15(calc),
            None => ours == significant15(&upper) && ours == calc_significant15(calc),
        };
        if strict {
            return Ok(Ok(true));
        }
        let one = Ratio::ONE;
        let periodic = &arguments.rate;
        if periodic.is_zero() {
            // −(pv + fv)/pmt: a few roundings, relative to the result
            return Ok(close(&lower, calc, &lower.abs(), 8));
        }
        // ln(A) / ln(1 + r), with A's numerator and denominator each a difference, so their
        // relative errors are 4ε times their terms' sizes over their values, and ln(1 + r) off by
        // 2ε absolute
        let start = Ratio::from(arguments.timing.excel_type());
        let paid = ratio(&arguments.pmt.to_decimal()).mul(&one.add(&periodic.mul(&start)));
        let future_term = ratio(&arguments.fv.to_decimal()).mul(periodic);
        let present_term = ratio(&arguments.pv.to_decimal()).mul(periodic);
        let relative = |left: &Ratio, right: &Ratio, value: &Ratio| {
            left.abs().add(&right.abs()).div(&value.abs())
        };
        let error_of_a = relative(&paid, &future_term, &paid.sub(&future_term))?.add(&relative(
            &paid,
            &present_term,
            &paid.add(&present_term),
        )?);
        // L = |ln(1 + rate)| "computed in binary64", as the README and ducat's test take it: the
        // only float in the runner, read back exactly from its shortest decimal form
        let rate_float: f64 = string(row, "rate").parse().expect("a rate");
        let log_of_growth = ratio(&format!("{}", rate_float.ln_1p().abs()));
        let size = error_of_a
            .add(&Ratio::from(2).mul(&lower.abs()))
            .div(&log_of_growth)?;
        Ok(close(&lower, calc, &size, 8))
    })
}

fn spreadsheet_rate(row: &Value) -> Fields {
    const OP: &str = "spreadsheet.rate";
    let outcome = (|| -> Result<Result<(), String>, Error> {
        let arguments = arguments(row)?;
        let calc = string(row, "calc");
        let Some(theirs) = calc_ratio(calc) else {
            return Ok(Err(format!("Calc gives {calc}")));
        };
        let spurious = arguments.timing == PaymentTiming::Start && theirs <= ratio("-0.999999");
        // s = max(0, ⌈−log₁₀ |calc|⌉), which is max(0, −e) for Calc's exponent e; a calc of 0 takes
        // 40 places, as −log₁₀ 0 = ∞ does in ducat's test
        let scale = if spurious {
            0
        } else if theirs.is_zero() {
            40
        } else {
            (-calc_exponent(calc)).max(0)
        };
        let places = u16::try_from((14 + scale).min(40)).unwrap();
        let result = rate(
            arguments.nper,
            &arguments.pmt,
            &arguments.pv,
            Some(&arguments.fv),
            arguments.timing,
            places,
            None,
        )?;
        // a genuine root: the NPV of the implied flows in cents has opposite signs (or a zero) at
        // the bracket's ends, by Horner's rule, independently of rate's closed form
        let periods = arguments.nper as usize;
        let (payment, present, future) = (
            cents(&arguments.pmt),
            cents(&arguments.pv),
            cents(&arguments.fv),
        );
        let mut flows = vec![payment.clone(); periods + 1];
        if arguments.timing == PaymentTiming::Start {
            flows[0] = &present + &payment;
            flows[periods] = future;
        } else {
            flows[0] = present;
            flows[periods] = &payment + &future;
        }
        let (low_sign, high_sign) = (
            npv_sign(&flows, &result.lower()),
            npv_sign(&flows, &result.upper()),
        );
        if low_sign != 0 && low_sign == high_sign {
            return Ok(Err(format!("no sign change over {result}")));
        }
        if spurious {
            count(OP, "atMinusOne");
            return Ok(if result.lower() > Ratio::from(-1) {
                Ok(())
            } else {
                Err("not above -1".into())
            });
        }
        let distance = result.lower().sub(&theirs).abs();
        let relative = result
            .lower()
            .abs()
            .mul(&Ratio::new(1, 1_000_000_000_000u64).unwrap());
        if distance <= relative {
            count(OP, "strict");
            return Ok(Ok(()));
        }
        Ok(
            if distance <= Ratio::new(5, 1_000_000_000_000u64).unwrap() {
                Ok(())
            } else {
                Err(format!("ours {result}, Calc {calc}"))
            },
        )
    })();
    vec![("calc", verdict(row, "calc", outcome))]
}

fn spreadsheet_xnpv(row: &Value) -> Fields {
    calc_field(row, "spreadsheet.xnpv", |calc| {
        let values = usd_list(row, "values")?;
        let dates = dates(row)?;
        let rate_text = string(row, "rate");
        let bounds = xnpv_bounds(rate_text, &values, &dates, &XnpvOptions::default(), 20)?;
        let middle = bounds.lower.add(&bounds.upper).div(&Ratio::from(2))?;
        if significant15(&middle) == calc_significant15(calc) {
            return Ok(Ok(true));
        }
        // (n + 4) ε Σ |vᵢ| / (1 + r)^(tᵢ/365) + t(calc). The README computes the size in binary64;
        // here it is an exact upper bound instead: XNPV's own upper bound for the magnitudes,
        // with one cent less on the first date so that the flows have both signs, plus that cent
        let mut magnitudes: Vec<AnyMoney> = values.iter().map(AnyMoney::abs).collect();
        magnitudes.push(usd("-0.01")?);
        let mut size_dates = dates.clone();
        size_dates.push(dates[0]);
        let size = xnpv_bounds(
            rate_text,
            &magnitudes,
            &size_dates,
            &XnpvOptions::default(),
            20,
        )?
        .upper
        .add(&ratio("0.01"));
        let theirs = match calc_value(calc) {
            Ok(theirs) => theirs,
            Err(why) => return Ok(Err(why)),
        };
        let bound = units_of(values.len() + 4)
            .mul(&epsilon())
            .mul(&size)
            .add(&text_rounding(calc));
        Ok(if within(&middle, &theirs, &bound) {
            Ok(false)
        } else {
            Err(format!("ours {}, Calc {calc}", significant15(&middle)))
        })
    })
}

fn spreadsheet_xirr(row: &Value) -> Fields {
    const OP: &str = "spreadsheet.xirr";
    let outcome = (|| -> Result<Result<(), String>, Error> {
        let result = xirr(
            &usd_list(row, "values")?,
            &dates(row)?,
            &XnpvOptions::default(),
            12,
            None,
        )?;
        let calc = string(row, "calc");
        let Some(theirs) = calc_ratio(calc) else {
            return Ok(Ok(()));
        };
        count(OP, "converged");
        // Calc's values are within 1e-13 of the bracket, far inside Microsoft's 0.000001%
        let accuracy = Ratio::new(1, 10_000_000_000_000u64).unwrap();
        Ok(
            if result.lower().sub(&theirs) <= accuracy && theirs.sub(&result.upper()) <= accuracy {
                Ok(())
            } else {
                Err(format!("ours {result}, Calc {calc}"))
            },
        )
    })();
    vec![("calc", verdict(row, "calc", outcome))]
}

// --- the table ----------------------------------------------------------------------------------

pub(super) fn row_op(op: &str) -> Option<RowOp> {
    Some(match op {
        "excel.annuities" => annuities_row,
        "excel.nper" => nper_row,
        "excel.rate" => rate_row,
        "excel.xnpv" => oracle_xnpv_row,
        "excel.xirr" => oracle_xirr_row,
        "xnpv.scaled" => xnpv_scaled_row,
        "xirr.floor" => xirr_floor_row,
        "excelExample.npv" => |row| example_row(row, "npv"),
        "excelExample.irr" => |row| example_row(row, "irr"),
        "excelExample.rri" => |row| example_row(row, "rri"),
        "excelExample.effect" => |row| example_row(row, "effect"),
        "excelExample.fv" => |row| example_row(row, "fv"),
        "excelExample.pv" => |row| example_row(row, "pv"),
        "excelExample.pmt" => |row| example_row(row, "pmt"),
        "excelExample.nper" => |row| example_row(row, "nper"),
        "excelExample.rate" => |row| example_row(row, "rate"),
        "excelExample.xnpv" => |row| example_row(row, "xnpv"),
        "excelExample.xirr" => |row| example_row(row, "xirr"),
        "spreadsheet.npv" => spreadsheet_npv,
        "spreadsheet.irr" => spreadsheet_irr,
        "spreadsheet.periodicRate" => spreadsheet_periodic_rate,
        "spreadsheet.annualRate" => spreadsheet_annual_rate,
        "spreadsheet.fv" => |row| spreadsheet_annuity(row, "fv"),
        "spreadsheet.pv" => |row| spreadsheet_annuity(row, "pv"),
        "spreadsheet.pmt" => |row| spreadsheet_annuity(row, "pmt"),
        "spreadsheet.nper" => spreadsheet_nper,
        "spreadsheet.rate" => spreadsheet_rate,
        "spreadsheet.xnpv" => spreadsheet_xnpv,
        "spreadsheet.xirr" => spreadsheet_xirr,
        "spreadsheet.edge.fv" => |row| edge_row(row, "fv"),
        "spreadsheet.edge.pv" => |row| edge_row(row, "pv"),
        "spreadsheet.edge.pmt" => |row| edge_row(row, "pmt"),
        "spreadsheet.edge.nper" => |row| edge_row(row, "nper"),
        "spreadsheet.edge.rate" => |row| edge_row(row, "rate"),
        "spreadsheet.edge.xnpv" => |row| edge_row(row, "xnpv"),
        "spreadsheet.edge.xirr" => |row| edge_row(row, "xirr"),
        _ => return None,
    })
}
