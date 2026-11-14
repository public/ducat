//! ducat's documented `/finance` examples (docs/reference/finance.md and
//! docs/how-to/calculate-interest-and-loans.md), through the Rust API.

use ducat::allocate::Remainder;
use ducat::finance::{
    AmortisationMethod, AmortiseOptions, ContributionTiming, Date, DayCount, InterestPeriod,
    ProrationInstant, ProrationPeriod, ProrationUnit, SavingsPlanOptions, annual_rate,
    discounted_sum, irr, npv, payment_dates, periodic_rate, savings_plan, year_fraction,
};
use ducat::iso::{Eur, Usd};
use ducat::{AnyMoney, Error, Money, Ratio, Rounding};

type Result = core::result::Result<(), Error>;

fn day(text: &str) -> Date {
    text.parse().unwrap()
}

fn eur(text: &str) -> Money<Eur> {
    text.parse().unwrap()
}

fn usd(text: &str) -> Money<Usd> {
    text.parse().unwrap()
}

fn decimals<C: ducat::Currency>(parts: &[Money<C>]) -> Vec<String> {
    parts.iter().map(Money::to_decimal).collect()
}

#[test]
fn year_fractions() -> Result {
    let fraction = year_fraction(day("2026-01-15"), day("2026-07-15"), DayCount::Act360, None)?;
    assert_eq!(fraction, Ratio::new(181, 360)?);
    assert_eq!(
        year_fraction(day("2026-07-15"), day("2026-01-15"), DayCount::Act360, None),
        Err(Error::EndBeforeStart)
    );
    // the last day of February at the end needs maturity under 30E/360 ISDA, and the two readings
    // differ
    let (start, end) = (day("2025-11-30"), day("2026-02-28"));
    assert_eq!(
        year_fraction(start, end, DayCount::ThirtyE360Isda, None),
        Err(Error::MaturityRequired)
    );
    assert_eq!(
        year_fraction(start, end, DayCount::ThirtyE360Isda, Some(true))?,
        Ratio::new(88, 360)?
    );
    assert_eq!(
        year_fraction(start, end, DayCount::ThirtyE360Isda, Some(false))?,
        Ratio::new(90, 360)?
    );
    // ACT/ACT ISDA splits the days by calendar year
    assert_eq!(
        year_fraction(
            day("2023-07-01"),
            day("2024-07-01"),
            DayCount::ActActIsda,
            None
        )?,
        Ratio::new(184, 365)?.add(&Ratio::new(182, 366)?)
    );
    assert_eq!(
        "30E/360 ISDA".parse::<DayCount>()?,
        DayCount::ThirtyE360Isda
    );
    Ok(())
}

#[test]
fn interest_and_compounding() -> Result {
    let period = InterestPeriod::new(day("2026-01-15"), day("2026-07-15"), DayCount::Act365Fixed);
    assert_eq!(
        eur("10000")
            .interest("0.05", &period, Rounding::HalfEven)?
            .to_decimal(),
        "247.95"
    );
    assert_eq!(
        eur("1000")
            .compound("0.05", 12, 12, Rounding::HalfEven)?
            .to_decimal(),
        "1051.16"
    );
    assert_eq!(
        eur("1000").compound("-12", 1, 12, Rounding::HalfEven),
        Err(Error::RateTooLow)
    );
    assert_eq!(
        eur("1000").compound("0.05", 100_001, 12, Rounding::HalfEven),
        Err(Error::InvalidPeriods)
    );
    Ok(())
}

#[test]
fn amortisation() -> Result {
    let options = AmortiseOptions::new("0.045", 12, 300, Rounding::HalfExpand)?;
    let plan = eur("200000").amortise(&options)?;
    assert_eq!(plan.payment.to_decimal(), "1111.66");
    assert_eq!(plan.rows[0].interest.to_decimal(), "750.00");
    assert_eq!(plan.rows.len(), 300);
    assert!(plan.rows.last().is_some_and(|row| row.balance.is_zero()));
    assert_eq!(plan.total_interest.to_decimal(), "133500.69");
    let principal: Money<Eur> = plan.rows.iter().map(|row| row.principal.clone()).sum();
    assert_eq!(principal, eur("200000"));

    // a linear loan's principal parts are equal, with the remainder on the last
    let linear = eur("1000.00").amortise(
        &AmortiseOptions::new("0.12", 12, 3, Rounding::HalfEven)?
            .with_method(AmortisationMethod::Linear),
    )?;
    let parts: Vec<Money<Eur>> = linear
        .rows
        .iter()
        .map(|row| row.principal.clone())
        .collect();
    assert_eq!(decimals(&parts), ["333.33", "333.33", "333.34"]);
    assert_eq!(linear.payment.to_decimal(), "343.33");

    // dates, clamped to shorter months
    let dated = eur("1200").amortise(
        &AmortiseOptions::new("0", 4, 3, Rounding::HalfEven)?.with_first_payment(day("2023-11-30")),
    )?;
    let dates: Vec<String> = dated
        .rows
        .iter()
        .map(|row| row.date.map(|date| date.to_string()).unwrap_or_default())
        .collect();
    assert_eq!(dates, ["2023-11-30", "2024-02-29", "2024-05-30"]);

    // a balloon in another currency
    let loan: AnyMoney = "1000 EUR".parse()?;
    let options = AmortiseOptions::new("0.05", 12, 12, Rounding::HalfEven)?
        .with_balloon("100 USD".parse::<AnyMoney>()?);
    assert!(matches!(
        loan.amortise(&options),
        Err(Error::CurrencyMismatch { .. })
    ));
    Ok(())
}

#[test]
fn payment_date_steps() -> Result {
    let weekly = payment_dates(day("2026-12-24"), 52, 3)?;
    assert_eq!(
        weekly,
        [day("2026-12-24"), day("2026-12-31"), day("2027-01-07")]
    );
    assert_eq!(
        payment_dates(day("2026-01-01"), 5, 3),
        Err(Error::InvalidPerYear)
    );
    assert_eq!(
        payment_dates(day("9999-06-30"), 2, 3),
        Err(Error::DateOutOfRange)
    );
    Ok(())
}

#[test]
fn discounted_sums_npv_and_irr() -> Result {
    let flows: Vec<Money<Eur>> = ["-1000", "300", "400", "500"].map(eur).to_vec();
    assert_eq!(
        discounted_sum("0.08", &flows, Rounding::HalfEven)?.to_decimal(),
        "17.63"
    );
    assert_eq!(
        npv("0.08", &flows[1..], Rounding::HalfEven)?.to_decimal(),
        "1017.63"
    );
    let rate = irr(&flows, 8, None)?;
    assert_eq!(rate.to_string(), "0.08896339");
    assert_eq!(rate.upper_decimal(), "0.08896340");
    assert_eq!(rate.grid().to_string(), "8896339");

    // two IRRs, 10% and 20%: a bracket picks one
    let two: Vec<Money<Eur>> = ["-100", "230", "-132"].map(eur).to_vec();
    assert_eq!(irr(&two, 10, None), Err(Error::SeveralSignChanges));
    let low = (Ratio::new(0, 1)?, Ratio::new(15, 100)?);
    let high = (Ratio::new(15, 100)?, Ratio::new(1, 1)?);
    assert_eq!(irr(&two, 4, Some((&low.0, &low.1)))?.to_string(), "0.1000");
    assert_eq!(
        irr(&two, 4, Some((&high.0, &high.1)))?.to_string(),
        "0.2000"
    );

    let mixed = ["-100 EUR", "120 USD"].map(|text| text.parse::<AnyMoney>().unwrap());
    assert!(matches!(
        irr(&mixed, 4, None),
        Err(Error::CurrencyMismatch { .. })
    ));
    assert_eq!(
        irr(&["100", "1"].map(eur), 4, None),
        Err(Error::NoSignChange)
    );
    Ok(())
}

#[test]
fn periodic_and_annual_rates() -> Result {
    let monthly = periodic_rate("0.05", 12, 8)?;
    assert_eq!(monthly.rate.to_string(), "0.00407412");
    assert_eq!(monthly.rate.upper_decimal(), "0.00407413");
    assert_eq!(monthly.exact, None);
    assert_eq!(
        periodic_rate("0.05", 12, 12)?.rate.to_string(),
        "0.004074123783"
    );
    assert_eq!(
        periodic_rate("0.21", 2, 10)?.exact,
        Some(Ratio::new(1, 10)?)
    );
    assert_eq!(annual_rate("0.1", 2)?, Ratio::new(21, 100)?);
    assert_eq!(
        annual_rate("0.01", 12)?.to_string(),
        "126825030131969720661201/1000000000000000000000000"
    );
    Ok(())
}

#[test]
fn savings_plans() -> Result {
    let plan = savings_plan(&SavingsPlanOptions::with_target(
        "0.05",
        12,
        216,
        usd("50000"),
        Rounding::HalfExpand,
    )?)?;
    assert_eq!(plan.contribution.to_decimal(), "143.18");
    assert_eq!(
        plan.rows.last().map(|row| row.contribution.to_decimal()),
        Some("144.38".into())
    );
    assert_eq!(plan.balance.to_decimal(), "50000.00");
    assert_eq!(plan.total_interest.to_decimal(), "19071.92");

    let monthly = savings_plan(
        &SavingsPlanOptions::with_contribution("0.06", 12, 10, usd("200"), Rounding::HalfExpand)?
            .initial(usd("500"))
            .timing(ContributionTiming::Start),
    )?;
    assert_eq!(monthly.balance.to_decimal(), "2581.40");
    assert_eq!(
        monthly.balance,
        &(&usd("500") + &monthly.total_contributions) + &monthly.total_interest
    );

    // a start-timed target plan ends exactly on the target
    let start = savings_plan(
        &SavingsPlanOptions::with_target("0.05", 12, 216, usd("50000"), Rounding::HalfExpand)?
            .timing(ContributionTiming::Start),
    )?;
    assert_eq!(start.balance.to_decimal(), "50000.00");
    Ok(())
}

/// ducat's own savingsPlan tests (test/finance.test.ts), ported value by value.
#[test]
fn savings_plan_settling() -> Result {
    let plan = |target: &str, rate: &str, periods: u32, timing: ContributionTiming| {
        savings_plan(
            &SavingsPlanOptions::with_target(rate, 12, periods, usd(target), Rounding::HalfExpand)
                .unwrap()
                .timing(timing),
        )
    };
    let monthly = savings_plan(
        &SavingsPlanOptions::with_contribution("0.06", 12, 10, usd("200"), Rounding::HalfExpand)?
            .initial(usd("500"))
            .timing(ContributionTiming::Start),
    )?;
    assert_eq!(monthly.rows[0].interest.to_decimal(), "3.50");
    assert_eq!(monthly.rows[0].balance.to_decimal(), "703.50");
    assert_eq!(monthly.total_contributions.to_decimal(), "2000.00");
    assert_eq!(monthly.total_interest.to_decimal(), "81.40");
    let at_end = savings_plan(&SavingsPlanOptions::with_contribution(
        "0.06",
        12,
        2,
        usd("100"),
        Rounding::HalfExpand,
    )?)?;
    let interest: Vec<Money<Usd>> = at_end.rows.iter().map(|row| row.interest.clone()).collect();
    assert_eq!(decimals(&interest), ["0.00", "0.50"]);

    // the last start-timed contribution earns its own interest, and nothing else
    let exact = plan("105.20", "0.6", 3, ContributionTiming::Start)?;
    let last = exact.rows.last().unwrap();
    let before = &exact.rows[1].balance;
    assert_eq!(
        last.interest,
        (before + &last.contribution).multiply("0.05", Rounding::HalfExpand)?
    );
    assert_eq!(last.adjustment, None);
    assert_eq!(exact.balance.to_decimal(), "105.20");

    // where the rounded interest steps over the target, the unit left over is paid after interest
    let skipped = plan("100.90", "0.6", 3, ContributionTiming::Start)?;
    let last = skipped.rows.last().unwrap();
    assert_eq!(
        [
            last.contribution.to_decimal(),
            last.interest.to_decimal(),
            last.adjustment
                .as_ref()
                .map(Money::to_decimal)
                .unwrap_or_default(),
            skipped.balance.to_decimal(),
        ],
        ["30.49", "4.80", "0.01", "100.90"]
    );

    // a periodic rate near -1: the doubling bracket finds the contribution
    let near = plan("100", "-11.999988", 2, ContributionTiming::Start)?;
    assert_eq!(near.balance.to_decimal(), "100.00");
    let last = near.rows.last().unwrap();
    assert_eq!(
        last.interest,
        (&near.rows[0].balance + &last.contribution).multiply("-0.999999", Rounding::HalfExpand)?
    );

    // a zero rate: the target over the periods, the residual on the last
    let flat = plan("100", "0", 7, ContributionTiming::End)?;
    let contributions: Vec<Money<Usd>> = flat
        .rows
        .iter()
        .map(|row| row.contribution.clone())
        .collect();
    assert_eq!(
        decimals(&contributions),
        [
            "14.29", "14.29", "14.29", "14.29", "14.29", "14.29", "14.26"
        ]
    );
    assert_eq!(flat.total_interest.to_decimal(), "0.00");

    // negative rates and withdrawals
    let shrinking = savings_plan(
        &SavingsPlanOptions::with_contribution("-0.12", 12, 1, usd("0"), Rounding::HalfExpand)?
            .initial(usd("100")),
    )?;
    assert_eq!(shrinking.balance.to_decimal(), "99.00");
    let drawdown = savings_plan(
        &SavingsPlanOptions::with_target("0.12", 12, 12, usd("0"), Rounding::HalfExpand)?
            .initial(usd("1000")),
    )?;
    assert!(drawdown.contribution.is_negative());
    assert_eq!(drawdown.balance.to_decimal(), "0.00");

    // dates follow payment_dates
    let dated = savings_plan(
        &SavingsPlanOptions::with_target("0.05", 12, 216, usd("50000"), Rounding::HalfExpand)?
            .timing(ContributionTiming::Start)
            .first_contribution(day("2026-01-31")),
    )?;
    let dates = [&dated.rows[0], &dated.rows[1], dated.rows.last().unwrap()]
        .map(|row| row.date.map(|date| date.to_string()).unwrap_or_default());
    assert_eq!(dates, ["2026-01-31", "2026-02-28", "2043-12-31"]);

    // both or neither of contribution and target
    let mut both =
        SavingsPlanOptions::with_target("0.05", 12, 2, usd("100"), Rounding::HalfExpand)?;
    both.contribution = Some(usd("1"));
    assert_eq!(savings_plan(&both), Err(Error::InvalidSavingsPlan));
    Ok(())
}

#[test]
fn proration() -> Result {
    let march = ProrationPeriod::new(day("2026-03-01"), day("2026-04-01"));
    let used = ProrationPeriod::new(day("2026-03-11"), day("2026-04-01"));
    assert_eq!(
        eur("30")
            .prorate(&march, &used, ProrationUnit::Day, Rounding::HalfEven)?
            .to_decimal(),
        "20.32"
    );
    let at = [day("2026-03-11").into(), day("2026-03-20").into()];
    let parts = eur("30").split_period(&march, &at, ProrationUnit::Day, Remainder::Largest)?;
    assert_eq!(decimals(&parts), ["9.68", "8.71", "11.61"]);

    // seconds, from a date-time
    let noon: ProrationInstant = "2026-03-01T12:00:00Z".parse()?;
    let day_one = ProrationPeriod::new(day("2026-03-01"), day("2026-03-02"));
    let afternoon = ProrationPeriod::new(noon, day("2026-03-02"));
    assert_eq!(
        eur("1")
            .prorate(
                &day_one,
                &afternoon,
                ProrationUnit::Second,
                Rounding::HalfEven
            )?
            .to_decimal(),
        "0.50"
    );
    assert_eq!(
        eur("1").prorate(&day_one, &afternoon, ProrationUnit::Day, Rounding::HalfEven),
        Err(Error::InvalidInstant)
    );
    assert_eq!(
        eur("1").prorate(&day_one, &march, ProrationUnit::Day, Rounding::HalfEven),
        Err(Error::OutsidePeriod)
    );
    // Unix times beyond ducat's safe integers are refused rather than overflowing
    let huge = ProrationPeriod::new(
        ProrationInstant::Unix(i64::MIN),
        ProrationInstant::Unix(i64::MAX),
    );
    assert_eq!(
        eur("1").prorate(&huge, &huge, ProrationUnit::Second, Rounding::HalfEven),
        Err(Error::InvalidInstant)
    );
    let safe = (1i64 << 53) - 1;
    let widest = ProrationPeriod::new(ProrationInstant::Unix(-safe), ProrationInstant::Unix(safe));
    let half = ProrationPeriod::new(ProrationInstant::Unix(0), ProrationInstant::Unix(safe));
    assert_eq!(
        eur("1")
            .prorate(&widest, &half, ProrationUnit::Second, Rounding::HalfEven)?
            .to_decimal(),
        "0.50"
    );
    Ok(())
}
