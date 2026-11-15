//! The tables of rounding policies, pricing, math and exact finance (spec/README.md, "Rounding
//! policies, pricing and math tables", and the finance table's `interestExact` and
//! `discountedSumExact`). Every field is judged exactly, as text.

use ducat::finance::{InterestPeriod, discounted_sum_exact};
use ducat::policy::RoundingPolicy;
use ducat::pricing::{BeyondLastTier, PriceEnding, PriceTier, TieredPricing, TiersMode};
use ducat::{AnyMoney, Error, ErrorKind, Ratio, Rounding};
use serde_json::{Map, Value};

use super::{Fields, RowOp, code, kind_name, minor_of, mode, string};

fn error_text(error: &Error) -> Value {
    Value::String(format!("error {} ({error})", kind_name(error.kind())))
}

/// A result as the tables write it, or `null` for an error of `kind`.
fn field(result: Result<Value, Error>, kind: ErrorKind) -> Value {
    match result {
        Ok(value) => value,
        Err(error) if error.kind() == kind => Value::Null,
        Err(error) => error_text(&error),
    }
}

fn text(value: impl ToString) -> Value {
    Value::String(value.to_string())
}

/// A decimal in major units at the scale its fraction digits give (`"12.340"` is scale 3).
fn money_at(amount: &str, currency: &str) -> Result<AnyMoney, Error> {
    let places = amount
        .split_once('.')
        .map_or(0, |(_, fraction)| fraction.len());
    AnyMoney::parse_at(
        amount,
        code(currency)?,
        u16::try_from(places).expect("few places"),
        Rounding::Unnecessary,
    )
}

fn amount(row: &Value, key: &str) -> Result<AnyMoney, Error> {
    money_at(string(row, key), string(row, "currency"))
}

/// The row's `policy`: ducat's `roundingPolicy` options.
fn policy(row: &Value) -> Result<RoundingPolicy, Error> {
    let options = &row["policy"];
    let mut policy = RoundingPolicy::new(string(options, "rounding").parse()?)
        .with_increment(options["increment"].as_u64().expect("an increment"))?;
    if let Some(scale) = options.get("scale").and_then(Value::as_u64) {
        policy = policy.with_scale(u16::try_from(scale).expect("a small scale"))?;
    }
    if let Some(currency) = options.get("currency").and_then(Value::as_str) {
        policy = policy.for_currency(code(currency)?);
    }
    Ok(policy)
}

/// A money's decimal, or `null` for a currency mismatch (a policy for another currency).
fn by_policy(result: Result<AnyMoney, Error>) -> Value {
    field(
        result.map(|money| text(money.to_decimal())),
        ErrorKind::CurrencyMismatch,
    )
}

fn ratio(text: &str) -> Ratio {
    text.parse()
        .unwrap_or_else(|error| panic!("{text} is not a rational: {error}"))
}

/// A ratio as a decimal at the smallest scale that holds it, or `num/den` when it doesn't
/// terminate (ducat's tier line quantity).
fn shortest(value: &Ratio) -> String {
    match value.terminating_scale(0) {
        Some(scale) => {
            let units = value.round_to_units(scale, Rounding::Unnecessary).unwrap();
            let money = AnyMoney::from_units(units, scale, "EUR".parse().unwrap()).unwrap();
            money.to_decimal()
        }
        None => value.to_string(),
    }
}

// --- rounding policies ---------------------------------------------------------------------------

fn policy_multiply(row: &Value) -> Fields {
    let result = (|| amount(row, "amount")?.multiply(string(row, "factor"), policy(row)?))();
    vec![("want", by_policy(result))]
}

fn policy_divide(row: &Value) -> Fields {
    let result = (|| amount(row, "amount")?.divide(string(row, "divisor"), policy(row)?))();
    vec![("want", by_policy(result))]
}

fn policy_round(row: &Value) -> Fields {
    let result = (|| amount(row, "amount")?.round(policy(row)?))();
    vec![("want", by_policy(result))]
}

fn policy_convert(row: &Value) -> Fields {
    let result = (|| {
        amount(row, "amount")?.convert(code(string(row, "to"))?, string(row, "rate"), policy(row)?)
    })();
    vec![("want", by_policy(result))]
}

fn policy_tax(row: &Value) -> Fields {
    let run = || -> Result<Fields, Error> {
        let (money, rule, percent) = (amount(row, "amount")?, policy(row)?, string(row, "percent"));
        let pair = |first: &str, a: &AnyMoney, second: &str, b: &AnyMoney| {
            let mut out = Map::new();
            out.insert(first.into(), text(a.to_decimal()));
            out.insert(second.into(), text(b.to_decimal()));
            Value::Object(out)
        };
        Ok(vec![
            ("percentage", by_policy(money.percentage(percent, rule))),
            ("discount", by_policy(money.discount(percent, rule))),
            (
                "addTax",
                field(
                    money
                        .add_tax(percent, rule)
                        .map(|parts| pair("tax", &parts.tax, "gross", &parts.gross)),
                    ErrorKind::CurrencyMismatch,
                ),
            ),
            (
                "extractTax",
                field(
                    money
                        .extract_tax(percent, rule)
                        .map(|parts| pair("net", &parts.net, "tax", &parts.tax)),
                    ErrorKind::CurrencyMismatch,
                ),
            ),
        ])
    };
    run().unwrap_or_else(|error| vec![("percentage", error_text(&error))])
}

fn policy_exact_round(row: &Value) -> Fields {
    let result = (|| {
        let whole = AnyMoney::from_units(
            minor_of(string(row, "num")),
            0,
            code(string(row, "currency"))?,
        )?;
        whole
            .exact()
            .divide(minor_of(string(row, "den")))?
            .round_with_residual(policy(row)?, None)
    })();
    vec![
        (
            "want",
            field(
                result
                    .clone()
                    .map(|rounded| text(rounded.value.to_decimal())),
                ErrorKind::CurrencyMismatch,
            ),
        ),
        (
            "residual",
            field(
                result.map(|rounded| text(rounded.residual.value())),
                ErrorKind::CurrencyMismatch,
            ),
        ),
    ]
}

fn policy_check(row: &Value) -> Fields {
    let valid = (|| match amount(row, "amount")?.check_policy(&policy(row)?) {
        Ok(()) => Ok(Value::Bool(true)),
        Err(Error::OffPolicy) => Ok(Value::Bool(false)),
        Err(error) => Err(error),
    })();
    vec![("valid", valid.unwrap_or_else(|error| error_text(&error)))]
}

// --- pricing -------------------------------------------------------------------------------------

fn price_ending(row: &Value) -> Fields {
    let result = (|| {
        let rule = PriceEnding::new(string(row, "ending"), string(row, "step"), mode(row))?;
        Ok(text(
            amount(row, "amount")?
                .with_price_ending(&rule)?
                .to_decimal(),
        ))
    })();
    vec![("want", field(result, ErrorKind::Range))]
}

fn tiered(row: &Value) -> Fields {
    let currency = string(row, "currency");
    let run = || -> Result<Fields, Error> {
        let mut tiers = Vec::new();
        for tier in row["tiers"].as_array().expect("tiers") {
            let mut priced = match tier["upTo"].as_str() {
                Some(bound) => PriceTier::up_to(bound)?,
                None => PriceTier::open(),
            };
            if let Some(unit) = tier.get("unitAmount").and_then(Value::as_str) {
                priced = priced.with_unit_amount(money_at(unit, currency)?);
            }
            if let Some(flat) = tier.get("flatAmount").and_then(Value::as_str) {
                priced = priced.with_flat_amount(money_at(flat, currency)?);
            }
            tiers.push(priced);
        }
        let tiers_mode = match string(row, "mode") {
            "graduated" => TiersMode::Graduated,
            _ => TiersMode::Volume,
        };
        let rounding: Rounding = string(row, "rounding").parse()?;
        let mut pricing = TieredPricing::new(tiers_mode, tiers, rounding);
        if row.get("beyondLastTier").and_then(Value::as_str) == Some("cap") {
            pricing = pricing.with_beyond_last_tier(BeyondLastTier::Cap);
        }
        if let Some(charge) = row.get("chargeQuantity").and_then(Value::as_str) {
            pricing = pricing.with_charge_quantity(charge)?;
        }
        let price = match pricing.price(string(row, "quantity")) {
            Ok(price) => price,
            Err(error) if error.kind() == ErrorKind::Range => {
                return Ok(vec![
                    ("total", Value::Null),
                    ("exact", Value::Null),
                    ("lines", Value::Null),
                ]);
            }
            Err(error) => return Err(error),
        };
        let lines = price
            .lines
            .iter()
            .map(|line| {
                let mut out = Map::new();
                out.insert("tier".into(), Value::from(line.tier));
                out.insert("quantity".into(), text(shortest(&line.quantity)));
                out.insert("exact".into(), text(line.exact.value()));
                out.insert("amount".into(), text(line.amount.to_minor().unwrap()));
                Value::Object(out)
            })
            .collect();
        Ok(vec![
            ("total", text(price.total.to_minor()?)),
            ("exact", text(price.exact.value())),
            ("lines", lines),
        ])
    };
    run().unwrap_or_else(|error| vec![("total", error_text(&error))])
}

// --- math ----------------------------------------------------------------------------------------

fn average(row: &Value) -> Fields {
    let result = (|| {
        let amounts = row["amounts"]
            .as_array()
            .expect("amounts")
            .iter()
            .map(|value| money_at(value.as_str().expect("an amount"), string(row, "currency")))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(text(AnyMoney::average(&amounts, mode(row))?.to_decimal()))
    })();
    vec![("want", result.unwrap_or_else(|error| error_text(&error)))]
}

fn ratio_of(row: &Value) -> Fields {
    let result = (|| {
        Ok(text(
            amount(row, "amount")?.ratio_of(&amount(row, "other")?)?,
        ))
    })();
    vec![("ratio", field(result, ErrorKind::Range))]
}

fn divide_to_integral(row: &Value) -> Fields {
    let pair = || Ok::<_, Error>((amount(row, "amount")?, amount(row, "divisor")?));
    let quotient = (|| {
        let (money, divisor) = pair()?;
        Ok(text(money.divide_to_integral(&divisor)?))
    })();
    let remainder = (|| {
        let (money, divisor) = pair()?;
        Ok(text(money.remainder(&divisor)?.to_decimal()))
    })();
    vec![
        ("quotient", field(quotient, ErrorKind::Range)),
        ("remainder", field(remainder, ErrorKind::Range)),
    ]
}

fn trim_scale(row: &Value) -> Fields {
    let minimum = row
        .get("minimumScale")
        .and_then(Value::as_u64)
        .map(|scale| u16::try_from(scale).expect("a small scale"));
    let result = (|| {
        Ok(text(
            amount(row, "amount")?.trim_scale(minimum)?.to_decimal(),
        ))
    })();
    vec![(
        "want",
        result.unwrap_or_else(|error: Error| error_text(&error)),
    )]
}

fn ratio_arithmetic(row: &Value) -> Fields {
    let (left, right) = (ratio(string(row, "left")), ratio(string(row, "right")));
    vec![
        ("sum", text(left.add(&right))),
        ("difference", text(left.sub(&right))),
        ("product", text(left.mul(&right))),
        (
            "quotient",
            field(left.div(&right).map(text), ErrorKind::Range),
        ),
        ("compare", Value::from(left.cmp(&right) as i64)),
        ("negation", text(left.neg())),
        ("complement", text(left.complement())),
    ]
}

// --- exact finance -------------------------------------------------------------------------------

fn interest_exact(row: &Value) -> Fields {
    let result = (|| {
        let principal = AnyMoney::from_minor(
            minor_of(string(row, "principal")),
            code(string(row, "currency"))?,
        );
        let mut period = InterestPeriod::new(
            string(row, "from").parse()?,
            string(row, "to").parse()?,
            string(row, "dayCount").parse()?,
        );
        if let Some(maturity) = row.get("maturity").and_then(Value::as_bool) {
            period = period.with_maturity(maturity);
        }
        Ok(text(
            principal
                .interest_exact(string(row, "rate"), &period)?
                .value(),
        ))
    })();
    vec![(
        "want",
        result.unwrap_or_else(|error: Error| error_text(&error)),
    )]
}

fn discounted_sum_exact_row(row: &Value) -> Fields {
    let result = (|| {
        let currency = code(string(row, "currency"))?;
        let flows: Vec<AnyMoney> = row["flows"]
            .as_array()
            .expect("flows")
            .iter()
            .map(|flow| AnyMoney::from_minor(minor_of(flow.as_str().expect("a flow")), currency))
            .collect();
        Ok(text(
            discounted_sum_exact(string(row, "rate"), &flows)?.value(),
        ))
    })();
    vec![("want", field(result, ErrorKind::Range))]
}

pub(super) fn row_op(op: &str) -> Option<RowOp> {
    Some(match op {
        "policy.multiply" => policy_multiply,
        "policy.divide" => policy_divide,
        "policy.round" => policy_round,
        "policy.convert" => policy_convert,
        "policy.tax" => policy_tax,
        "policy.exactRound" => policy_exact_round,
        "policy.check" => policy_check,
        "pricing.priceEnding" => price_ending,
        "pricing.tiered" => tiered,
        "math.average" => average,
        "math.ratioOf" => ratio_of,
        "math.divideToIntegral" => divide_to_integral,
        "math.trimScale" => trim_scale,
        "math.ratio" => ratio_arithmetic,
        "finance.interestExact" => interest_exact,
        "finance.discountedSumExact" => discounted_sum_exact_row,
        _ => return None,
    })
}
