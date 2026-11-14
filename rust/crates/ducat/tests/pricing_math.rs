//! ducat's own tests of `/pricing` and `/math` (test/pricing.test.ts, test/tiers.test.ts,
//! test/math.test.ts), ported value by value: negative prices, the error paths, and policies in
//! averages, which the vectors don't reach.

use ducat::iso::{Eur, Jpy, Usd};
use ducat::policy::RoundingPolicy;
use ducat::pricing::{BeyondLastTier, PriceEnding, PriceTier, TieredPricing, TiersMode};
use ducat::{AnyMoney, Error, Money, Rounding};

type Result = core::result::Result<(), Error>;

fn eur(text: &str) -> Money<Eur> {
    text.parse().unwrap()
}

fn usd(text: &str) -> Money<Usd> {
    text.parse().unwrap()
}

fn ended(rule: &PriceEnding, price: &str) -> String {
    eur(price).with_price_ending(rule).unwrap().to_string()
}

#[test]
fn price_endings() -> Result {
    let charm = PriceEnding::new("0.99", "1", Rounding::Ceil)?;
    assert_eq!(ended(&charm, "23.41"), "23.99 EUR");
    assert_eq!(ended(&charm, "23.99"), "23.99 EUR");
    assert_eq!(ended(&charm, "24.00"), "24.99 EUR");
    assert_eq!(ended(&charm, "0"), "0.99 EUR");
    assert_eq!(ended(&charm, "-1.50"), "-1.01 EUR");
    let down = PriceEnding::new("0.95", "1", Rounding::Floor)?;
    assert_eq!(ended(&down, "23.41"), "22.95 EUR");
    let nearest = PriceEnding::new("0.99", "1", Rounding::HalfCeil)?;
    assert_eq!(ended(&nearest, "23.49"), "23.99 EUR");
    assert_eq!(ended(&nearest, "23.48"), "22.99 EUR");
    let ninety_cents = PriceEnding::new("9.90", "10", Rounding::Ceil)?;
    assert_eq!(ended(&ninety_cents, "23.41"), "29.90 EUR");
    let halves = PriceEnding::new("0.49", "0.5", Rounding::Ceil)?;
    assert_eq!(ended(&halves, "23.50"), "23.99 EUR");
    let yen = PriceEnding::new("80", "100", Rounding::Ceil)?;
    assert_eq!(
        "1234"
            .parse::<Money<Jpy>>()?
            .with_price_ending(&yen)?
            .to_string(),
        "1280 JPY"
    );
    assert_eq!(
        Money::<Eur>::from_units(12345, 4)?
            .with_price_ending(&charm)?
            .to_string(),
        "1.9900 EUR"
    );
    let strict = PriceEnding::new("0.99", "1", Rounding::Unnecessary)?;
    assert_eq!(ended(&strict, "3.99"), "3.99 EUR");
    assert_eq!(eur("3.98").with_price_ending(&strict), Err(Error::Rounding));
    // JPY has no cents
    assert_eq!(
        "100".parse::<Money<Jpy>>()?.with_price_ending(&charm),
        Err(Error::EndingTooPrecise)
    );
    // checked when built
    assert_eq!(
        PriceEnding::new("1", "1", Rounding::Ceil),
        Err(Error::InvalidEnding)
    );
    assert_eq!(
        PriceEnding::new("-0.01", "1", Rounding::Ceil),
        Err(Error::InvalidEnding)
    );
    assert_eq!(
        PriceEnding::new("0", "0", Rounding::Ceil),
        Err(Error::InvalidEnding)
    );
    assert_eq!(
        PriceEnding::new(".99", "1", Rounding::Ceil),
        Err(Error::Syntax)
    );
    Ok(())
}

#[test]
fn tiers_reject_bad_tables_and_quantities() -> Result {
    let one = || PriceTier::open().with_unit_amount(usd("1"));
    let volume = |tiers| TieredPricing::new(TiersMode::Volume, tiers, Rounding::HalfExpand);
    assert_eq!(volume(vec![one()]).price(-1), Err(Error::NegativeQuantity));
    assert_eq!(volume(vec![]).price(1), Err(Error::NoTiers));
    assert_eq!(
        volume(vec![PriceTier::open()]).price(1),
        Err(Error::UnpricedTier)
    );
    let open_first = vec![one(), PriceTier::up_to(5)?.with_unit_amount(usd("1"))];
    assert_eq!(volume(open_first).price(1), Err(Error::InvalidTierBounds));
    let repeated = vec![
        PriceTier::up_to(5)?.with_unit_amount(usd("1")),
        PriceTier::up_to(5)?.with_unit_amount(usd("1")),
    ];
    assert_eq!(volume(repeated).price(1), Err(Error::InvalidTierBounds));
    assert_eq!(
        volume(vec![PriceTier::up_to(0)?.with_unit_amount(usd("1"))]).price(1),
        Err(Error::InvalidTierBounds)
    );
    assert_eq!(
        volume(vec![PriceTier::up_to(5)?.with_unit_amount(usd("1"))]).price(6),
        Err(Error::BeyondLastTier)
    );
    let graduated = TieredPricing::new(TiersMode::Graduated, vec![one()], Rounding::HalfExpand)
        .with_charge_quantity(3)?;
    assert_eq!(graduated.price(1), Err(Error::ChargeQuantityNeedsVolume));
    let mixed: Vec<PriceTier<AnyMoney>> = vec![
        PriceTier::up_to(5)?.with_unit_amount("1 USD".parse()?),
        PriceTier::open().with_unit_amount("1 EUR".parse()?),
    ];
    let mixed = TieredPricing::new(TiersMode::Volume, mixed, Rounding::HalfExpand);
    assert!(matches!(
        mixed.price(1),
        Err(Error::CurrencyMismatch { .. })
    ));
    Ok(())
}

#[test]
fn capped_tiers() -> Result {
    let meters = vec![
        PriceTier::up_to(10)?.with_unit_amount(eur("2")),
        PriceTier::up_to(100)?
            .with_unit_amount(eur("1.50"))
            .with_flat_amount(eur("5")),
    ];
    let graduated = TieredPricing::new(TiersMode::Graduated, meters.clone(), Rounding::HalfExpand)
        .with_beyond_last_tier(BeyondLastTier::Cap);
    let price = graduated.price(250)?;
    // 10 × 2 + 90 × 1.50 + 5, and lines that sum to the total
    assert_eq!(price.total.to_string(), "160.00 EUR");
    assert_eq!(
        price
            .lines
            .iter()
            .map(|line| line.quantity.to_string())
            .collect::<Vec<_>>(),
        ["10", "90"]
    );
    let lines: Money<Eur> = price.lines.iter().map(|line| line.amount.clone()).sum();
    assert_eq!(lines, price.total);
    let volume = TieredPricing::new(TiersMode::Volume, meters, Rounding::HalfExpand)
        .with_beyond_last_tier(BeyondLastTier::Cap);
    assert_eq!(volume.price(250)?.total.to_string(), "155.00 EUR");
    Ok(())
}

#[test]
fn math() -> Result {
    let list = |texts: &[&str]| texts.iter().map(|text| eur(text)).collect::<Vec<_>>();
    assert_eq!(
        Money::average(&list(&["0.01", "0.02"]), Rounding::HalfExpand)?.to_string(),
        "0.02 EUR"
    );
    assert_eq!(
        Money::average(&list(&["0.01", "0.02"]), Rounding::Trunc)?.to_string(),
        "0.01 EUR"
    );
    assert_eq!(
        Money::average(&list(&["-0.01", "-0.02"]), Rounding::HalfExpand)?.to_string(),
        "-0.02 EUR"
    );
    let mixed_scales = vec![eur("1"), Money::<Eur>::from_units(1005, 3)?];
    assert_eq!(
        Money::average(&mixed_scales, Rounding::HalfExpand)?.to_string(),
        "1.003 EUR"
    );
    let cents = RoundingPolicy::new(Rounding::HalfEven).with_scale(2)?;
    assert_eq!(
        Money::average(&mixed_scales, cents)?.to_string(),
        "1.00 EUR"
    );
    assert_eq!(
        Money::<Eur>::average(&[], Rounding::HalfExpand),
        Err(Error::NoAmounts)
    );
    let mixed: Vec<AnyMoney> = vec!["1 EUR".parse()?, "1 USD".parse()?];
    assert!(matches!(
        AnyMoney::average(&mixed, Rounding::HalfExpand),
        Err(Error::CurrencyMismatch { .. })
    ));

    assert_eq!(eur("1").ratio_of(&eur("3"))?.to_string(), "1/3");
    assert_eq!(eur("1").ratio_of(&eur("0")), Err(Error::DivisionByZero));
    let (a, b): (AnyMoney, AnyMoney) = ("1 EUR".parse()?, "1 USD".parse()?);
    assert!(matches!(
        a.ratio_of(&b),
        Err(Error::CurrencyMismatch { .. })
    ));
    let three = eur("3");
    assert_eq!(eur("-10").divide_to_integral(&three)?.to_string(), "-3");
    assert_eq!(eur("-10").remainder(&three)?.to_string(), "-1.00 EUR");
    assert_eq!(eur("10").divide_to_integral(&eur("-3"))?.to_string(), "-3");
    assert_eq!(eur("10").remainder(&eur("-3"))?.to_string(), "1.00 EUR");
    assert_eq!(
        Money::<Eur>::from_units(12300, 4)?
            .trim_scale(None)?
            .to_string(),
        "1.23 EUR"
    );
    assert_eq!(eur("12.00").trim_scale(Some(0))?.to_string(), "12 EUR");
    Ok(())
}
