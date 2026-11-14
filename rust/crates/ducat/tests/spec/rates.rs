//! Rate metadata, providers and bags (spec/README.md, "Rate metadata, providers and bags"). Every
//! field is judged exactly, as JSON.

use ducat::convert::{
    AnyRate, BoxedProvider, ConvertOptions, MoneyBag, ProviderConvertOptions, RateInfo, RateQuery,
    RateQuote, RateTable, RateType, Time, TotalOptions, chain, identity, rate_of, reversed,
    sort_by_value, via,
};
use ducat::{AnyMoney, CurrencyCode, Error, ErrorKind, Rounding};
use serde_json::{Value, json};

use super::{Fields, RowOp, string};

fn code(text: &str) -> CurrencyCode {
    text.parse().expect("an ISO 4217 code")
}

pub(super) fn time(value: &Value) -> Option<Time> {
    value
        .as_str()
        .map(|text| text.parse().expect("a strict rate time"))
}

fn rounding(row: &Value) -> Rounding {
    string(row, "rounding").parse().expect("a rounding mode")
}

/// The outcome the spec names for an error.
fn outcome(error: &Error) -> Value {
    Value::from(match error {
        Error::RateUnavailable { .. } => "unavailable",
        Error::RateExpired { .. } => "expired",
        Error::Rounding => "rounding",
        Error::CurrencyMismatch { .. } => "mismatch",
        other if other.kind() == ErrorKind::Range => "range",
        other => panic!("unexpected error: {other}"),
    })
}

/// `fields` on success; on an error, each of `nulls` null and the outcome.
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

pub(super) fn info(value: &Value) -> RateInfo {
    let quote = value.get("quote").map(|quote| RateQuote {
        rate: string(quote, "rate").to_owned(),
        per: quote
            .get("per")
            .map(|per| per.as_i64().expect("an integer per")),
        inverted: quote.get("inverted").and_then(Value::as_bool) == Some(true),
    });
    RateInfo {
        source: value.get("source").and_then(Value::as_str).map(Into::into),
        as_of: time(&value["asOf"]),
        available_at: time(&value["availableAt"]),
        valid_until: time(&value["validUntil"]),
        rate_type: value
            .get("type")
            .and_then(Value::as_str)
            .map(RateType::from),
        quote,
    }
}

/// `exchangeRate(from, to, rate, info)`.
fn rate_spec(spec: &Value) -> Result<AnyRate, Error> {
    let rate = AnyRate::parse(
        code(string(spec, "from")),
        code(string(spec, "to")),
        string(spec, "rate"),
    )?;
    match spec.get("info") {
        Some(details) => rate.with_info(info(details)),
        None => Ok(rate),
    }
}

pub(super) fn rate_json(rate: &AnyRate) -> Value {
    serde_json::to_value(rate).expect("a rate serializes")
}

fn table(spec: &Value) -> Result<RateTable, Error> {
    if let Some(list) = spec.get("list") {
        let rates = list
            .as_array()
            .expect("a list of rates")
            .iter()
            .map(rate_spec)
            .collect::<Result<Vec<_>, Error>>()?;
        return Ok(RateTable::from_rates(rates));
    }
    let header = &spec["table"];
    let mut builder = RateTable::with_base(code(string(header, "base")), info(header));
    for entry in header["rates"].as_array().expect("rate pairs") {
        let currency = code(entry[0].as_str().expect("a currency"));
        builder = match &entry[1] {
            Value::Null => builder.missing(currency),
            Value::String(text) => builder.rate(currency, text)?,
            ready => builder.entry(currency, rate_spec(ready)?)?,
        };
    }
    Ok(builder.build())
}

fn provider(spec: &Value) -> Result<BoxedProvider<'static>, Error> {
    if spec.get("table").is_some() || spec.get("list").is_some() {
        return Ok(Box::new(table(spec)?));
    }
    if spec.get("identity").is_some() {
        return Ok(Box::new(identity()));
    }
    if let Some(parts) = spec.get("chain") {
        let parts = parts
            .as_array()
            .expect("providers")
            .iter()
            .map(provider)
            .collect::<Result<Vec<_>, Error>>()?;
        return Ok(Box::new(chain(parts)));
    }
    if let Some(inner) = spec.get("reversed") {
        return Ok(Box::new(reversed(provider(inner)?)));
    }
    Ok(Box::new(via(
        code(string(spec, "via")),
        provider(&spec["of"])?,
    )))
}

fn query(row: &Value) -> RateQuery {
    RateQuery {
        as_of: time(&row["asOf"]),
    }
}

fn scale(row: &Value) -> Option<u16> {
    row["resultScale"]
        .as_u64()
        .map(|scale| u16::try_from(scale).expect("a small scale"))
}

/// A decimal at the scale its fraction digits give.
fn money(amount: &str, currency: CurrencyCode) -> AnyMoney {
    let places = amount
        .split_once('.')
        .map_or(0, |(_, fraction)| fraction.len());
    AnyMoney::parse_at(
        amount,
        currency,
        u16::try_from(places).expect("few places"),
        Rounding::Unnecessary,
    )
    .expect("an amount")
}

fn items(row: &Value) -> Vec<AnyMoney> {
    row["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|item| {
            money(
                item[0].as_str().expect("an amount"),
                code(item[1].as_str().expect("a currency")),
            )
        })
        .collect()
}

fn derive(row: &Value) -> Fields {
    let result = (|| {
        let mut rate = rate_spec(&row["rate"])?;
        for step in row["steps"].as_array().expect("steps") {
            rate = match string(step, "op") {
                "inverse" => rate.inverse(),
                "andThen" => rate.and_then(&rate_spec(&step["rate"])?)?,
                "withMargin" => rate.with_margin(string(step, "margin"))?,
                "round" => {
                    let places = u16::try_from(step["places"].as_u64().expect("places"))
                        .expect("few places");
                    rate.round(places, rounding(step))?
                }
                other => panic!("unknown step {other}"),
            };
        }
        Ok(vec![("json", rate_json(&rate))])
    })();
    fields(&["json"], result)
}

fn validity(row: &Value) -> Fields {
    let details = RateInfo {
        available_at: time(&row["availableAt"]),
        valid_until: time(&row["validUntil"]),
        ..RateInfo::default()
    };
    let rate = AnyRate::parse(code("EUR"), code("USD"), "1.1")
        .and_then(|rate| rate.with_info(details))
        .expect("a rate");
    let at = time(&row["at"]).expect("a time");
    vec![
        ("expired", Value::Bool(rate.is_expired(&at))),
        ("available", Value::Bool(rate.is_available(&at))),
    ]
}

fn from_json(row: &Value) -> Fields {
    let result = serde_json::from_value::<AnyRate>(row["json"].clone())
        .map(|rate| vec![("want", rate_json(&rate))])
        .map_err(|error| {
            // the only failures in the table are a rate that isn't positive or a quote that isn't
            // the rate, both range errors; anything else is a runner bug
            let text = error.to_string();
            // or a per that isn't an integer, which serde refuses as the wrong type
            assert!(
                text.contains("positive")
                    || text.contains("quote")
                    || text.contains("invalid type"),
                "unexpected: {text}"
            );
            Error::NonPositiveRate
        });
    fields(&["want"], result)
}

fn strict_convert(row: &Value) -> Fields {
    let result = (|| {
        let rate = rate_spec(&row["rate"])?;
        let options = ConvertOptions {
            valid_at: time(&row["now"]),
            ..ConvertOptions::default()
        };
        let converted = rate.convert_with(
            &money(string(row, "amount"), rate.from()),
            rounding(row),
            &options,
        )?;
        Ok(vec![("want", Value::String(converted.to_decimal()))])
    })();
    fields(&["want"], result)
}

fn table_header(row: &Value) -> Fields {
    let result = table(row).map(|table| {
        let mut header = serde_json::Map::new();
        if let Some(base) = table.base() {
            header.insert("base".into(), json!(base.as_str()));
        }
        for (key, value) in [
            ("asOf", table.as_of()),
            ("availableAt", table.available_at()),
            ("validUntil", table.valid_until()),
        ] {
            if let Some(value) = value {
                header.insert(key.into(), json!(value.to_string()));
            }
        }
        if !table.missing().is_empty() {
            let missing: Vec<&str> = table.missing().iter().map(CurrencyCode::as_str).collect();
            header.insert("missing".into(), json!(missing));
        }
        let pairs: Vec<String> = table
            .rates()
            .iter()
            .map(|rate| format!("{}/{}", rate.from(), rate.to()))
            .collect();
        vec![("header", Value::Object(header)), ("pairs", json!(pairs))]
    });
    fields(&["header", "pairs"], result)
}

fn lookup(row: &Value) -> Fields {
    let result = (|| {
        let provider = provider(&row["provider"])?;
        let rate = rate_of(
            &provider,
            code(string(row, "from")),
            code(string(row, "to")),
            &query(row),
        )?;
        Ok(vec![("rate", rate_json(&rate))])
    })();
    fields(&["rate"], result)
}

fn convert(row: &Value) -> Fields {
    let result = (|| {
        let provider = provider(&row["provider"])?;
        let options = ProviderConvertOptions {
            as_of: time(&row["asOf"]),
            scale: scale(row),
            valid_at: None,
        };
        let amount = money(string(row, "amount"), code(string(row, "currency")));
        let converted =
            amount.convert_through(code(string(row, "to")), &provider, rounding(row), &options)?;
        Ok(vec![("want", Value::String(converted.to_decimal()))])
    })();
    fields(&["want"], result)
}

fn bag_total(row: &Value) -> Fields {
    let bag = MoneyBag::of(items(row)).expect("one currency's amounts add");
    let totals: Vec<Value> = bag
        .values()
        .iter()
        .map(|total| json!([total.currency().as_str(), total.to_decimal()]))
        .collect();
    let result = (|| {
        let provider = provider(&row["provider"])?;
        let to = code(string(row, "to"));
        let options = TotalOptions {
            query: query(row),
            scale: scale(row),
        };
        let exact = bag.exact_total(to, &provider, &options.query)?;
        let total = bag.total(to, &provider, rounding(row), &options)?;
        Ok(vec![
            ("exact", Value::String(exact.value().to_string())),
            ("total", Value::String(total.to_decimal())),
        ])
    })();
    let mut out = vec![("totals", Value::Array(totals))];
    out.extend(fields(&["exact", "total"], result));
    out
}

fn bag_sort(row: &Value) -> Fields {
    let result = (|| {
        let provider = provider(&row["provider"])?;
        let held = items(row);
        let sorted = sort_by_value(
            held.clone(),
            &provider,
            code(string(row, "base")),
            query(row),
        )?;
        // the sort is stable, so equal amounts map back to their indices in order
        let mut used = vec![false; held.len()];
        let order: Vec<usize> = sorted
            .iter()
            .map(|money| {
                let index = held
                    .iter()
                    .enumerate()
                    .position(|(index, item)| !used[index] && item.identical(money))
                    .expect("a sorted item");
                used[index] = true;
                index
            })
            .collect();
        Ok(vec![("order", json!(order))])
    })();
    fields(&["order"], result)
}

pub(super) fn row_op(op: &str) -> Option<RowOp> {
    Some(match op {
        "rate.derive" => derive,
        "rate.validity" => validity,
        "rate.fromJSON" => from_json,
        "rate.strictConvert" => strict_convert,
        "provider.table" => table_header,
        "provider.rate" => lookup,
        "provider.convert" => convert,
        "bag.total" => bag_total,
        "bag.sort" => bag_sort,
        _ => return None,
    })
}
