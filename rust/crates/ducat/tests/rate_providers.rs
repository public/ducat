//! ducat's own tests of rate metadata, providers and bags (test/rate-edges.test.ts,
//! test/provider.test.ts, test/bag.test.ts), ported value by value except where the Rust API
//! differs: times are passed in rather than read from a clock, and snapshots (async loaders) aren't
//! ported. ducat's two fast-check properties (via equals a consistent direct rate; the comparator
//! is transitive over inconsistent pairwise rates) are left out: the spec's `provider.rate` and
//! `bag.sort` rows cover both behaviours on fixed data.

use ducat::convert::{
    AnyRate, BoxedProvider, ConvertOptions, MoneyBag, ProviderConvertOptions, Rate, RateInfo,
    RateProvider, RateQuery, RateQuote, RateTable, RateType, Time, TotalOptions, UtcInstant, chain,
    comparator, from_fn, identity, rate_of, reversed, sort_by_value, sum_by_currency, via,
};
use ducat::iso::{Eur, Jpy, Usd};
use ducat::{AnyMoney, CurrencyCode, Error, Money, Rounding};

type Result = core::result::Result<(), Error>;

fn code(text: &str) -> CurrencyCode {
    text.parse().unwrap()
}

fn time(text: &str) -> Time {
    text.parse().unwrap()
}

fn at(text: &str) -> RateQuery {
    RateQuery::at(time(text))
}

fn money(amount: &str, currency: &str) -> AnyMoney {
    AnyMoney::parse(amount, code(currency)).unwrap()
}

fn rate(from: &str, to: &str, text: &str) -> AnyRate {
    AnyRate::parse(code(from), code(to), text).unwrap()
}

/// The ECB table of ducat's provider tests.
fn ecb() -> RateTable {
    let info = RateInfo {
        source: Some("ECB".into()),
        as_of: Some(time("2026-11-06")),
        rate_type: Some(RateType::Mid),
        ..RateInfo::default()
    };
    RateTable::with_base(code("EUR"), info)
        .rate(code("USD"), "1.1165")
        .and_then(|table| table.rate(code("JPY"), "176.77"))
        .and_then(|table| table.rate(code("GBP"), "0.83415"))
        .unwrap()
        .build()
}

// --- rates and their metadata -------------------------------------------------------------------

#[test]
fn a_chain_keeps_the_valid_until_that_ends_first() {
    let until = |from, to, text, valid_until| {
        rate(from, to, text)
            .with_info(RateInfo {
                valid_until: Some(time(valid_until)),
                ..RateInfo::default()
            })
            .unwrap()
    };
    let eur_usd = until("EUR", "USD", "1.10", "2026-11-06");
    let usd_jpy = until("USD", "JPY", "150", "2026-11-06T15:00:00Z");
    let eur_jpy = eur_usd.and_then(&usd_jpy).unwrap();
    assert_eq!(
        eur_jpy.info().valid_until.map(|t| t.to_string()),
        Some("2026-11-06T15:00:00.000Z".into())
    );
    assert!(eur_jpy.is_expired(&time("2026-11-06T16:00:00Z")));
    // a date has ended at the next midnight; an instant at midnight is still valid then
    let midnight = until("USD", "JPY", "150", "2026-11-07T00:00:00Z");
    assert_eq!(
        eur_usd.and_then(&midnight).unwrap().info().valid_until,
        Some(time("2026-11-06"))
    );
    let last = until("USD", "JPY", "150", "2026-11-06T23:59:59.999Z");
    assert_eq!(
        eur_usd.and_then(&last).unwrap().info().valid_until,
        Some(time("2026-11-06T23:59:59.999Z"))
    );
}

#[test]
fn derived_rates_keep_only_the_metadata_that_still_describes_them() -> Result {
    let bid = rate("USD", "CAD", "200/273").with_info(RateInfo {
        source: Some("desk".into()),
        as_of: Some(time("2026-11-06")),
        rate_type: Some(RateType::Bid),
        quote: Some(RateQuote {
            rate: "1.3650".into(),
            per: None,
            inverted: true,
        }),
        ..RateInfo::default()
    })?;
    let ask = bid.inverse();
    assert_eq!(ask.to_string(), "1.3650");
    assert_eq!(ask.info().rate_type, Some(RateType::Ask));
    assert_eq!(ask.info().source, None);
    assert_eq!(ask.info().as_of, Some(time("2026-11-06")));
    assert_eq!(ask.derived_from(), core::slice::from_ref(&bid));
    let margin = bid.with_margin("-0.02")?;
    assert_eq!(
        (margin.info().rate_type.clone(), margin.info().quote.clone()),
        (None, None)
    );
    let rounded = bid.round(4, Rounding::HalfEven)?;
    assert_eq!(rounded.to_string(), "0.7326");
    assert_eq!(rounded.info().rate_type, Some(RateType::Bid));
    Ok(())
}

#[test]
fn quotes_must_describe_their_rate() {
    let quoted = |text, quote: RateQuote| {
        rate("JPY", "NOK", text).with_info(RateInfo {
            quote: Some(quote),
            ..RateInfo::default()
        })
    };
    let per = |per| RateQuote {
        rate: "136.80".into(),
        per: Some(per),
        inverted: false,
    };
    assert_eq!(
        quoted("1.368", per(100)).map(|r| r.to_string()),
        Ok("1.368".into())
    );
    assert_eq!(quoted("136.80", per(100)), Err(Error::QuoteMismatch));
    for bad in [0, -100] {
        assert_eq!(quoted("1.368", per(bad)), Err(Error::QuoteMismatch));
    }
    // a negative per is checked through the sign, as in ducat: with a negative number it describes
    // the positive rate
    let both_negative = RateQuote {
        rate: "-136.80".into(),
        per: Some(-100),
        inverted: false,
    };
    assert_eq!(
        quoted("1.368", both_negative).map(|r| r.to_string()),
        Ok("1.368".into())
    );
    let inverted = RateQuote {
        rate: "0.9100".into(),
        per: None,
        inverted: true,
    };
    assert_eq!(quoted("290", inverted), Err(Error::QuoteMismatch));
}

#[test]
fn rate_text_follows_ducat() -> Result {
    assert_eq!(Rate::<Eur, Usd>::parse("1.10")?.to_string(), "1.10");
    assert_eq!(Rate::<Eur, Usd>::parse("01.50")?.to_string(), "1.5");
    assert_eq!(
        Rate::<Eur, Usd>::parse("1.10")?
            .round(2, Rounding::HalfEven)?
            .to_string(),
        "1.1"
    );
    assert_eq!(
        Rate::<Eur, Usd>::parse("2000/2233")?.to_string(),
        "2000/2233"
    );
    Ok(())
}

#[test]
fn availability_and_strict_validity_take_the_time() -> Result {
    let eur_usd = Rate::<Eur, Usd>::parse("1.1")?.with_info(RateInfo {
        available_at: Some(time("2026-11-06T15:00:00Z")),
        valid_until: Some(time("2026-11-06")),
        ..RateInfo::default()
    })?;
    assert!(!eur_usd.is_available(&time("2026-11-06T14:59:59.999Z")));
    assert!(eur_usd.is_available(&time("2026-11-06")));
    let euros: Money<Eur> = "100".parse()?;
    let strict = |now| ConvertOptions {
        valid_at: Some(time(now)),
        ..ConvertOptions::default()
    };
    let converted = eur_usd.convert_with(
        &euros,
        Rounding::HalfEven,
        &strict("2026-11-06T23:59:59.999Z"),
    )?;
    assert_eq!(converted.to_string(), "110.00 USD");
    assert!(matches!(
        eur_usd.convert_with(&euros, Rounding::HalfEven, &strict("2026-11-07")),
        Err(Error::RateExpired { .. })
    ));
    // without a time, nothing is checked: the library reads no clock
    assert!(
        eur_usd
            .convert_with(&euros, Rounding::HalfEven, &ConvertOptions::default())
            .is_ok()
    );
    let detailed = eur_usd.convert_detailed_with(&euros, Rounding::HalfEven, &strict("2026-11-07"));
    assert!(matches!(detailed, Err(Error::RateExpired { .. })));
    let scaled = ConvertOptions {
        scale: Some(4),
        ..ConvertOptions::default()
    };
    assert_eq!(
        eur_usd
            .convert_with(&euros, Rounding::HalfEven, &scaled)?
            .to_decimal(),
        "110.0000"
    );
    Ok(())
}

#[test]
fn instants_print_as_utc() -> Result {
    let instant: UtcInstant = "2026-11-05T23:30:00-05:00".parse()?;
    assert_eq!(instant.to_string(), "2026-11-06T04:30:00.000Z");
    assert_eq!(time("2026-11-06").to_string(), "2026-11-06");
    Ok(())
}

#[cfg(feature = "serde")]
#[test]
fn json_round_trips_with_the_audit_chain() {
    let usd_eur = rate("EUR", "USD", "1.1165")
        .with_info(RateInfo {
            source: Some("ECB".into()),
            as_of: Some(time("2026-11-06")),
            ..RateInfo::default()
        })
        .unwrap()
        .inverse();
    let text = serde_json::to_string(&usd_eur).unwrap();
    assert_eq!(
        text,
        r#"{"from":"USD","to":"EUR","rate":"2000/2233","asOf":"2026-11-06","derivedFrom":[{"from":"EUR","to":"USD","rate":"1.1165","source":"ECB","asOf":"2026-11-06"}]}"#
    );
    let back: AnyRate = serde_json::from_str(&text).unwrap();
    assert_eq!(serde_json::to_string(&back).unwrap(), text);
    let typed: core::result::Result<Rate<Eur, Usd>, _> = serde_json::from_str(&text);
    assert!(typed.is_err());
    let lenient = r#"{"from":"EUR","to":"USD","rate":"1.1","asOf":"2026-11-06T15:00:00"}"#;
    assert!(serde_json::from_str::<AnyRate>(lenient).is_err());
}

// --- providers ----------------------------------------------------------------------------------

#[test]
fn a_table_answers_only_its_pairs_from_its_as_of_on() {
    let ecb = ecb();
    let eur_usd = ecb
        .rate(code("EUR"), code("USD"), &RateQuery::default())
        .unwrap();
    assert_eq!(eur_usd.to_string(), "1.1165");
    assert_eq!(eur_usd.info().source.as_deref(), Some("ECB"));
    assert_eq!(eur_usd.info().rate_type, Some(RateType::Mid));
    assert_eq!(
        (ecb.base(), ecb.as_of()),
        (Some(code("EUR")), Some(time("2026-11-06")))
    );
    assert!(
        ecb.rate(code("USD"), code("EUR"), &RateQuery::default())
            .is_none()
    );
    for asked in [
        "2026-11-08",
        "2026-11-06T09:00:00Z",
        "2026-11-05T23:30:00-05:00",
    ] {
        assert!(
            ecb.rate(code("EUR"), code("USD"), &at(asked)).is_some(),
            "{asked}"
        );
    }
    for asked in ["2026-11-05T23:00:00Z", "2026-11-05"] {
        assert!(
            ecb.rate(code("EUR"), code("USD"), &at(asked)).is_none(),
            "{asked}"
        );
    }
    let list = RateTable::from_rates([rate("USD", "CAD", "1.40")]);
    let usd_cad = list.rate(code("USD"), code("CAD"), &RateQuery::default());
    assert_eq!(usd_cad.map(|r| r.to_string()), Some("1.40".into()));
    assert_eq!(list.base(), None);
}

#[test]
fn identity_reversed_and_chain() {
    let none = RateQuery::default();
    let one = identity().rate(code("EUR"), code("EUR"), &none);
    assert_eq!(one.map(|r| r.to_string()), Some("1".into()));
    assert!(identity().rate(code("EUR"), code("USD"), &none).is_none());
    let back = reversed(ecb()).rate(code("USD"), code("EUR"), &none);
    assert_eq!(back.map(|r| r.to_string()), Some("2000/2233".into()));
    let providers: Vec<BoxedProvider> = vec![
        Box::new(identity()),
        Box::new(ecb()),
        Box::new(reversed(ecb())),
    ];
    let mixed = chain(providers);
    let gbp_eur = mixed.rate(code("GBP"), code("EUR"), &none).unwrap();
    assert_eq!(gbp_eur.to_string(), "20000/16683");
    assert!(mixed.rate(code("USD"), code("JPY"), &none).is_none());
}

#[test]
fn via_triangulates_exactly_and_keeps_the_audit_chain() -> Result {
    let table = ecb();
    let cross = via(code("EUR"), &table);
    let usd_jpy = Rate::<Usd, Jpy>::lookup(&cross, &RateQuery::default())?;
    assert_eq!(usd_jpy.ratio().to_string(), "32140/203");
    assert_eq!(usd_jpy.derived_from().len(), 2);
    assert_eq!(usd_jpy.info().as_of, Some(time("2026-11-06")));
    let none = RateQuery::default();
    assert!(cross.rate(code("USD"), code("CHF"), &none).is_none());
    assert!(cross.rate(code("USD"), code("USD"), &none).is_none());
    let dollars: Money<Usd> = "100".parse()?;
    assert_eq!(
        usd_jpy.convert(&dollars, Rounding::HalfEven)?.to_decimal(),
        "15833"
    );
    let options = ProviderConvertOptions::default();
    let yen: Money<Jpy> = dollars.convert_through(&cross, Rounding::HalfEven, &options)?;
    assert_eq!(yen.to_decimal(), "15833");
    Ok(())
}

#[test]
fn rate_of_rejects_a_wrong_pair_and_names_a_missing_one() {
    let liar = from_fn(|_, _, _: &RateQuery| Some(rate("EUR", "GBP", "0.83")));
    assert!(matches!(
        rate_of(&liar, code("EUR"), code("USD"), &RateQuery::default()),
        Err(Error::CurrencyMismatch { .. })
    ));
    let missing = rate_of(&ecb(), code("USD"), code("CHF"), &at("2026-11-06"));
    assert_eq!(
        missing.err().map(|error| error.to_string()),
        Some("no exchange rate USD→CHF as of 2026-11-06".into())
    );
}

#[test]
fn a_table_checks_its_ready_made_rates_and_lists_missing_values() {
    let wrong = RateTable::with_base(code("EUR"), RateInfo::default())
        .entry(code("USD"), rate("EUR", "GBP", "0.85"));
    assert!(matches!(wrong, Err(Error::CurrencyMismatch { .. })));
    let table = RateTable::with_base(code("EUR"), RateInfo::default())
        .missing(code("ISK"))
        .build();
    assert_eq!(table.missing(), [code("ISK")]);
}

// --- bags ---------------------------------------------------------------------------------------

#[test]
fn a_bag_keeps_per_currency_totals() -> Result {
    let bag = MoneyBag::of([money("10", "EUR"), money("5", "USD"), money("2", "EUR")])?;
    assert_eq!(
        bag.get(code("EUR")).map(AnyMoney::to_decimal),
        Some("12.00".into())
    );
    assert!(bag.get(code("JPY")).is_none());
    assert_eq!(
        bag.currencies().collect::<Vec<_>>(),
        [code("EUR"), code("USD")]
    );
    let more = bag.with([money("1", "GBP")])?;
    assert_eq!(bag.currencies().len(), 2);
    assert_eq!(more.currencies().len(), 3);
    let summed = sum_by_currency([money("1", "EUR"), money("2", "EUR")])?;
    assert_eq!(
        summed.iter().map(ToString::to_string).collect::<Vec<_>>(),
        ["3.00 EUR"]
    );
    #[cfg(feature = "serde")]
    assert_eq!(
        serde_json::to_string(&more).unwrap(),
        r#"[{"amount":"12.00","currency":"EUR"},{"amount":"5.00","currency":"USD"},{"amount":"1.00","currency":"GBP"}]"#
    );
    Ok(())
}

#[test]
fn a_bag_totals_in_one_currency_rounding_once() -> Result {
    let table = ecb();
    let fx = via(code("EUR"), &table);
    let bag = MoneyBag::of([
        money("0.01", "USD"),
        money("0.01", "GBP"),
        money("1", "EUR"),
    ])?;
    let eur = code("EUR");
    let defaults = TotalOptions::default();
    assert_eq!(
        bag.total(eur, &fx, Rounding::HalfEven, &defaults)?
            .to_decimal(),
        "1.02"
    );
    let four = TotalOptions {
        scale: Some(4),
        ..TotalOptions::default()
    };
    assert_eq!(
        bag.total(eur, &fx, Rounding::HalfEven, &four)?.to_decimal(),
        "1.0209"
    );
    let swiss = MoneyBag::of([money("1", "CHF")])?;
    assert!(matches!(
        swiss.total(eur, &fx, Rounding::HalfEven, &defaults),
        Err(Error::RateUnavailable { .. })
    ));
    assert_eq!(
        MoneyBag::new()
            .total(eur, &fx, Rounding::HalfEven, &defaults)?
            .to_decimal(),
        "0.00"
    );
    Ok(())
}

#[test]
fn values_order_through_one_base_even_over_inconsistent_pairwise_rates() -> Result {
    let table = ecb();
    let fx = via(code("EUR"), &table);
    let list = [
        money("100", "JPY"),
        money("1", "GBP"),
        money("1", "USD"),
        money("1", "EUR"),
    ];
    let sorted = sort_by_value(list.clone(), fx, code("EUR"), RateQuery::default())?;
    let names: Vec<String> = sorted.iter().map(ToString::to_string).collect();
    assert_eq!(names, ["100 JPY", "1.00 USD", "1.00 EUR", "1.00 GBP"]);
    let with_chf = [money("1", "GBP"), money("1", "CHF")];
    assert!(sort_by_value(with_chf, fx, code("EUR"), RateQuery::default()).is_err());
    // equal values keep their input order
    let tie = [
        AnyMoney::parse_at("1.1165", code("USD"), 4, Rounding::Unnecessary)?,
        money("1", "EUR"),
    ];
    let kept = sort_by_value(tie.clone(), fx, code("EUR"), RateQuery::default())?;
    assert!(kept.iter().zip(&tie).all(|(a, b)| a.identical(b)));
    // USD→GBP 0.7 disagrees with the legs to EUR (0.9 / 1.2 = 0.75); only those legs are used
    let inconsistent: Vec<BoxedProvider> = vec![
        Box::new(RateTable::from_rates([
            rate("USD", "EUR", "0.9"),
            rate("GBP", "EUR", "1.2"),
        ])),
        Box::new(RateTable::from_rates([rate("USD", "GBP", "0.7")])),
    ];
    let order = comparator(chain(inconsistent), code("EUR"), RateQuery::default());
    let (a, b, c) = (money("1", "USD"), money("0.8", "GBP"), money("0.92", "EUR"));
    assert_eq!(order.compare(&a, &c)?, core::cmp::Ordering::Less);
    assert_eq!(order.compare(&c, &b)?, core::cmp::Ordering::Less);
    assert_eq!(order.compare(&a, &b)?, core::cmp::Ordering::Less);
    Ok(())
}
