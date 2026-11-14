//! ducat's own tests of rounding policies (test/policy.test.ts, test/convert-policy.test.ts, and
//! the policy cases in test/finance.test.ts and test/tiers.test.ts), ported value by value: the
//! places a policy goes that the vectors don't reach (finance, Excel, tiers, Rate conversions).
//! ducat's `cashPolicy('CHF')` is written here as its rule, 0.05 half up, since CLDR cash data
//! comes later.

use ducat::convert::Rate;
use ducat::excel::{PaymentTiming, XnpvOptions, pmt, pmt_exact, xnpv};
use ducat::finance::{AmortiseOptions, DayCount, InterestPeriod, SavingsPlanOptions, savings_plan};
use ducat::iso::{Chf, Eur, Jpy, Kwd, Usd};
use ducat::policy::RoundingPolicy;
use ducat::pricing::{PriceTier, TieredPricing, TiersMode};
use ducat::{Error, Money, Rounding};

type Result = core::result::Result<(), Error>;

fn chf(text: &str) -> Money<Chf> {
    text.parse().unwrap()
}

fn shown<C: ducat::Currency>(money: &Money<C>) -> String {
    format!("{} @{}", money, money.scale())
}

/// ducat's cashPolicy('CHF'): 0.05, half up.
fn chf_cash() -> RoundingPolicy {
    RoundingPolicy::new(Rounding::HalfExpand)
        .with_increment(5)
        .unwrap()
}

#[test]
fn rounds_to_its_scale_increment_and_mode() -> Result {
    let four_half_even = RoundingPolicy::new(Rounding::HalfEven).with_scale(4)?;
    let precise = Money::<Eur>::from_units(1_000_050, 6)?;
    assert_eq!(shown(&precise.round(four_half_even)?), "1.0000 EUR @4");
    let five_cents = RoundingPolicy::ISO.with_increment(5)?;
    assert_eq!(shown(&chf("10.03").round(five_cents)?), "10.05 CHF @2");
    assert_eq!(shown(&chf("10.02").round(five_cents)?), "10.00 CHF @2");
    assert_eq!(
        shown(&Money::<Chf>::from_units(-10_025, 3)?.round(five_cents)?),
        "-10.05 CHF @2"
    );
    assert_eq!(
        shown(&Money::<Chf>::from_units(10_074, 3)?.round(five_cents)?),
        "10.05 CHF @2"
    );
    Ok(())
}

#[test]
fn goes_wherever_a_mode_goes() -> Result {
    let cash = chf_cash();
    assert_eq!(
        shown(&chf("10.00").multiply("1.077", cash)?),
        "10.75 CHF @2"
    );
    assert_eq!(shown(&chf("10.00").divide(3, cash)?), "3.35 CHF @2");
    assert_eq!(shown(&chf("1.01").multiply(3, cash)?), "3.05 CHF @2");
    let four = RoundingPolicy::ISO.with_scale(4)?;
    assert_eq!(
        shown(&"1.01".parse::<Money<Eur>>()?.multiply(3, four)?),
        "3.0300 EUR @4"
    );
    let tax = chf("10.00").add_tax("8.1", cash)?;
    assert_eq!(
        [tax.net, tax.tax, tax.gross].map(|part| part.to_string()),
        ["10.00 CHF", "0.80 CHF", "10.80 CHF"]
    );
    // a policy rounds the discounted price and the gross; the other part is the exact difference
    assert_eq!(shown(&chf("10.02").discount(10, cash)?), "9.00 CHF @2");
    let added = chf("10.03").add_tax("8.1", cash)?;
    assert_eq!(
        [shown(&added.tax), shown(&added.gross)],
        ["0.82 CHF @2", "10.85 CHF @2"]
    );
    let extracted = chf("10.83").extract_tax("8.1", cash)?;
    assert_eq!(
        [shown(&extracted.net), shown(&extracted.tax)],
        ["10.00 CHF @2", "0.83 CHF @2"]
    );
    // a gross of 10.850 at scale 3 is on the 0.05 step, but the tax keeps scale 3
    let on_increment = chf("10.85").extract_tax("8.1", cash)?;
    on_increment.tax.check_policy(&cash)?;
    let at_scale_3 = Money::<Chf>::from_units(10_850, 3)?.extract_tax("8.1", cash)?;
    assert_eq!(shown(&at_scale_3.tax), "0.800 CHF @3");
    assert_eq!(at_scale_3.tax.check_policy(&cash), Err(Error::OffPolicy));
    Ok(())
}

#[test]
fn the_iso_policy_and_its_checks() -> Result {
    let iso = RoundingPolicy::ISO;
    assert_eq!(
        shown(&Money::<Jpy>::from_units(15, 1)?.round(iso)?),
        "2 JPY @0"
    );
    assert_eq!(
        shown(&Money::<Kwd>::from_units(10_005, 4)?.round(iso)?),
        "1.001 KWD @3"
    );
    assert_eq!(
        shown(&Money::<Eur>::from_units(-1005, 3)?.round(iso)?),
        "-1.01 EUR @2"
    );
    assert_eq!(
        Money::<Eur>::from_units(123, 3)?.check_policy(&iso),
        Err(Error::OffPolicy)
    );
    assert_eq!(
        Money::<Jpy>::from_units(100, 2)?.check_policy(&iso),
        Err(Error::OffPolicy)
    );
    assert_eq!(
        chf("10.03").check_policy(&chf_cash()),
        Err(Error::OffPolicy)
    );
    // only exact amounts at its scale pass a strict policy
    let strict = RoundingPolicy::new(Rounding::Unnecessary);
    assert_eq!(
        shown(&Money::<Eur>::from_units(1230, 3)?.round(strict)?),
        "1.23 EUR @2"
    );
    assert_eq!(
        Money::<Eur>::from_units(1235, 3)?.round(strict),
        Err(Error::Rounding)
    );
    // checked once, when built
    assert_eq!(
        RoundingPolicy::ISO.with_increment(0),
        Err(Error::InvalidIncrement)
    );
    assert_eq!(
        RoundingPolicy::ISO.with_increment(1 << 53),
        Err(Error::InvalidIncrement)
    );
    assert_eq!(
        RoundingPolicy::ISO.with_scale(1001),
        Err(Error::InvalidScale)
    );
    Ok(())
}

#[test]
fn converting_with_a_policy() -> Result {
    let eur_usd = Rate::<Eur, Usd>::new("1.1165")?;
    let eur_chf = Rate::<Eur, Chf>::new("0.9143")?;
    let cents: Money<Eur> = "0.07".parse()?;
    let four = RoundingPolicy::new(Rounding::HalfEven).with_scale(4)?;
    let usd = eur_usd.convert(&cents, four)?;
    assert_eq!((usd.to_decimal(), usd.scale()), ("0.0782".into(), 4));
    let down = RoundingPolicy::new(Rounding::Floor).with_scale(2)?;
    assert_eq!(eur_usd.convert(&cents, down)?.to_decimal(), "0.07");
    let one: Money<Eur> = "1.00".parse()?;
    let yen: Money<Jpy> = one.convert("176.77", RoundingPolicy::ISO.with_increment(10)?)?;
    assert_eq!(yen.to_decimal(), "180");
    // the policy's currency is checked against the target
    let chf_only = RoundingPolicy::ISO.for_currency("CHF".parse()?);
    let ten: Money<Eur> = "10.00".parse()?;
    assert!(eur_chf.convert(&ten, chf_only).is_ok());
    assert!(matches!(
        eur_usd.convert(&ten, chf_only),
        Err(Error::CurrencyMismatch { .. })
    ));
    // the value is the policy's rounding, and the residual what it left out, exactly
    let detailed = eur_chf.convert_detailed(&"10.07".parse()?, chf_cash())?;
    assert_eq!(detailed.value.to_decimal(), "9.20");
    let total = detailed
        .value
        .exact()
        .value()
        .add(detailed.residual.value());
    assert_eq!(
        total,
        eur_chf
            .convert_exact(&"10.07".parse::<Money<Eur>>()?.exact())
            .value()
            .clone()
    );
    // an exact amount rounds to the policy; a second scale beside it is refused
    let third = ten.exact().divide(3)?;
    assert_eq!(
        third
            .round(chf_only.for_currency("EUR".parse()?), None)?
            .to_decimal(),
        "3.33"
    );
    assert_eq!(
        third.round(RoundingPolicy::ISO, Some(4)),
        Err(Error::ScaleWithPolicy)
    );
    Ok(())
}

#[test]
fn finance_rounds_with_a_policy() -> Result {
    // 0.015 EUR exactly: one rounding decides it
    let day = InterestPeriod::new(
        "2026-01-01".parse()?,
        "2026-01-02".parse()?,
        DayCount::Act360,
    );
    let four = RoundingPolicy::new(Rounding::HalfEven).with_scale(4)?;
    assert_eq!(
        shown(&"108".parse::<Money<Eur>>()?.interest("0.05", &day, four)?),
        "0.0150 EUR @4"
    );
    let month = InterestPeriod::new(
        "2026-01-01".parse()?,
        "2026-02-01".parse()?,
        DayCount::Act360,
    );
    let cash = RoundingPolicy::ISO.with_increment(5)?;
    assert_eq!(
        "1000"
            .parse::<Money<Eur>>()?
            .interest("0.05", &month, cash)?
            .to_string(),
        "4.30 EUR"
    );

    // every payment and interest charge lands on the increment, and the balance ends at zero
    let plan = chf("1000").amortise(&AmortiseOptions::new("0.05", 12, 12, chf_cash())?)?;
    for row in &plan.rows[..plan.rows.len() - 1] {
        row.payment.check_policy(&chf_cash())?;
        row.interest.check_policy(&chf_cash())?;
    }
    assert!(plan.rows.last().is_some_and(|row| row.balance.is_zero()));
    let zero_rate = chf("1000").amortise(&AmortiseOptions::new("0", 12, 7, chf_cash())?)?;
    let principal: Vec<String> = zero_rate
        .rows
        .iter()
        .map(|row| row.principal.to_string())
        .collect();
    assert_eq!(principal[..6], ["142.85 CHF"; 6]);
    assert_eq!(principal[6], "142.90 CHF");
    assert_eq!(
        chf("1000.02").amortise(&AmortiseOptions::new("0.05", 12, 12, chf_cash())?),
        Err(Error::NotAMultiple)
    );

    // a savings plan credits interest on the increment and still ends on the target
    let nickels = RoundingPolicy::new(Rounding::HalfEven).with_increment(5)?;
    let target: Money<Usd> = "1000".parse()?;
    let saved = savings_plan(&SavingsPlanOptions::with_target(
        "0.05", 12, 24, target, nickels,
    )?)?;
    for row in &saved.rows {
        row.interest.check_policy(&nickels)?;
    }
    assert_eq!(saved.balance.to_decimal(), "1000.00");
    let odd: Money<Usd> = "1.01".parse()?;
    assert_eq!(
        savings_plan(&SavingsPlanOptions::with_contribution(
            "0.05", 12, 24, odd, nickels
        )?),
        Err(Error::NotAMultiple)
    );

    // Excel's functions round to the policy too
    let loan: Money<Usd> = "100".parse()?;
    assert_eq!(
        pmt("-0.01", 3, &loan, None, PaymentTiming::End, nickels)?,
        pmt_exact("-0.01", 3, &loan, None, PaymentTiming::End)?.round(nickels, None)?
    );
    let tie: Vec<Money<Usd>> = vec!["-1".parse()?, "1.50".parse()?];
    let dates = vec!["2020-01-01".parse()?, "2020-06-01".parse()?];
    let dollars = |mode| RoundingPolicy::new(mode).with_scale(0);
    assert_eq!(
        xnpv(
            "0",
            &tie,
            &dates,
            &XnpvOptions::default(),
            dollars(Rounding::HalfEven)?
        )?
        .to_decimal(),
        "0"
    );
    assert_eq!(
        xnpv(
            "0",
            &tie,
            &dates,
            &XnpvOptions::default(),
            dollars(Rounding::HalfExpand)?
        )?
        .to_decimal(),
        "1"
    );
    Ok(())
}

#[test]
fn tiers_round_with_a_policy() -> Result {
    let tiers = vec![PriceTier::open().with_unit_amount(Money::<Chf>::from_units(333, 3)?)];
    let cash = RoundingPolicy::ISO.with_increment(5)?;
    let price = TieredPricing::new(TiersMode::Volume, tiers, cash).price(10)?;
    assert_eq!(price.total.to_string(), "3.35 CHF");
    Ok(())
}
