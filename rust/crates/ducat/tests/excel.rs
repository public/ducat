//! ducat's own unit tests of `/excel` (test/finance.test.ts, "fv, pv, pmt, nper and rate (Excel)"
//! and "xnpv and xirr (Excel)"), ported value by value: the bracket paths, the power limits and
//! the error paths, which no vector reaches.

use ducat::excel::{
    PaymentTiming, XnpvOptions, fv, fv_exact, nper, pmt, pmt_exact, pv_exact, rate, xirr, xnpv,
    xnpv_bounds,
};
use ducat::finance::{Date, DayCount};
use ducat::iso::Usd;
use ducat::{AnyMoney, Error, Money, Ratio, Rounding};

type Result = core::result::Result<(), Error>;

fn usd(text: &str) -> Money<Usd> {
    text.parse().unwrap()
}

fn days(texts: &[&str]) -> Vec<Date> {
    texts.iter().map(|text| text.parse().unwrap()).collect()
}

fn flows(texts: &[&str]) -> Vec<Money<Usd>> {
    texts.iter().map(|text| usd(text)).collect()
}

fn ratio(num: i64, den: i64) -> Ratio {
    Ratio::new(num, den).unwrap()
}

/// 10^exponent as a ratio.
fn ten_to(exponent: usize) -> Ratio {
    format!("1{}", "0".repeat(exponent)).parse().unwrap()
}

const END: PaymentTiming = PaymentTiming::End;
const START: PaymentTiming = PaymentTiming::Start;
const HALF: Rounding = Rounding::HalfExpand;

#[test]
fn annuities_are_exact_and_rounded_once() -> Result {
    let value = |exact: ducat::exact::ExactMoney<Usd>| exact.value().clone();
    assert_eq!(
        value(fv_exact("0.1", 2, &usd("-100"), None, END)?),
        Ratio::from(210)
    );
    assert_eq!(
        value(fv_exact("0.1", 2, &usd("-100"), None, START)?),
        Ratio::from(231)
    );
    assert_eq!(
        value(pv_exact("0.1", 2, &usd("-100"), None, END)?),
        ratio(21000, 121)
    );
    assert_eq!(
        value(pmt_exact("0.1", 2, &usd("1000"), None, END)?),
        ratio(-12100, 21)
    );
    assert_eq!(
        value(pmt_exact("0", 3, &usd("100"), None, END)?),
        ratio(-100, 3)
    );
    assert_eq!(
        pmt("0.1", 2, &usd("1000"), None, END, HALF)?.to_decimal(),
        "-576.19"
    );
    assert_eq!(
        pmt("0.1", 2, &usd("1000"), None, END, Rounding::Ceil)?.to_decimal(),
        "-576.19"
    );
    assert_eq!(
        pmt("0.1", 2, &usd("1000"), None, END, Rounding::Floor)?.to_decimal(),
        "-576.20"
    );
    assert_eq!(
        fv("0", 10, &usd("-100"), Some(&usd("-50")), START, HALF)?.to_decimal(),
        "1050.00"
    );
    assert_eq!(
        pmt("0", 3, &usd("1000"), Some(&usd("-100")), START, HALF)?.to_decimal(),
        "-300.00"
    );
    assert_eq!(
        fv("0.05", 0, &usd("-100"), Some(&usd("1000")), END, HALF)?.to_decimal(),
        "-1000.00"
    );
    // checked inputs
    assert_eq!(
        pmt("0.1", 0, &usd("100"), None, END, HALF),
        Err(Error::InvalidPeriods)
    );
    assert_eq!(
        fv("-1", 2, &usd("-100"), None, END, HALF),
        Err(Error::RateTooLow)
    );
    let mixed = (
        "-100 USD".parse::<AnyMoney>()?,
        "1 EUR".parse::<AnyMoney>()?,
    );
    assert!(matches!(
        fv("0.1", 2, &mixed.0, Some(&mixed.1), END, HALF),
        Err(Error::CurrencyMismatch { .. })
    ));
    Ok(())
}

#[test]
fn rates_and_brackets() -> Result {
    let monthly = rate(48, &usd("-200"), &usd("8000"), None, END, 8, None)?;
    assert_eq!(
        (monthly.to_string(), monthly.upper_decimal()),
        ("0.00770147".into(), "0.00770148".into())
    );
    // 1000 in, 600 and 400 out: exactly 0%
    assert_eq!(
        rate(
            2,
            &usd("-600"),
            &usd("1000"),
            Some(&usd("200")),
            END,
            4,
            None
        )?
        .to_string(),
        "0.0000"
    );
    assert_eq!(
        rate(
            1,
            &usd("-50"),
            &usd("1000"),
            Some(&usd("-1000")),
            END,
            6,
            None
        )?
        .to_string(),
        "0.050000"
    );
    assert_eq!(
        rate(
            1,
            &usd("-50"),
            &usd("1000"),
            Some(&usd("-950")),
            START,
            6,
            None
        )?
        .to_string(),
        "0.000000"
    );
    assert_eq!(
        rate(10, &usd("100"), &usd("1000"), None, END, 10, None),
        Err(Error::NoSignChange)
    );
    // 100 out, 230 back, then 132 out: 10% and 20%
    let (payment, present, future) = (usd("230"), usd("-100"), usd("-362"));
    assert_eq!(
        rate(2, &payment, &present, Some(&future), END, 10, None),
        Err(Error::SeveralSignChanges)
    );
    let bracket = (ratio(15, 100), ratio(1, 2));
    assert_eq!(
        rate(
            2,
            &payment,
            &present,
            Some(&future),
            END,
            4,
            Some((&bracket.0, &bracket.1))
        )?
        .to_string(),
        "0.2000"
    );
    Ok(())
}

#[test]
fn periods_are_bracketed_and_exact_where_rational() -> Result {
    let zero = nper("0", &usd("-100"), &usd("1000"), Some(&usd("-50")), END, 2)?;
    assert_eq!(
        (zero.periods.to_string(), zero.exact),
        ("9.50".into(), Some(ratio(19, 2)))
    );
    let two = nper("0.1", &usd("0"), &usd("-1000"), Some(&usd("1210")), END, 4)?;
    assert_eq!(
        (two.periods.to_string(), two.exact),
        ("2.0000".into(), Some(Ratio::from(2)))
    );
    let one = nper("0.1", &usd("0"), &usd("-1000"), Some(&usd("1100")), END, 10)?;
    assert_eq!(one.exact, Some(Ratio::ONE));
    let none = nper("0.1", &usd("0"), &usd("-1000"), Some(&usd("1000")), END, 10)?;
    assert_eq!(none.exact, Some(Ratio::ZERO));
    // 1.21 = 1.1^2, so growing by 10% takes half a period at 21%
    let half = nper("0.21", &usd("0"), &usd("-1000"), Some(&usd("1100")), END, 3)?;
    assert_eq!(half.exact, Some(ratio(1, 2)));
    assert_eq!(
        nper("0.01", &usd("-100"), &usd("-1000"), None, END, 8)?
            .periods
            .to_string(),
        "-9.57859404"
    );
    assert_eq!(
        nper("0.1", &usd("-50"), &usd("1000"), None, END, 10),
        Err(Error::NeverSettles)
    );
    assert_eq!(
        nper("0", &usd("0"), &usd("1000"), None, END, 10),
        Err(Error::NoPayment)
    );
    assert_eq!(
        nper("0.1", &usd("-100"), &usd("1000"), None, END, 101),
        Err(Error::InvalidDigits)
    );
    Ok(())
}

#[test]
fn powers_too_large_to_finish_are_refused() -> Result {
    // (1 + r)^nper stays under 2^20 bits (2^16 for the exact forms, 2^19 at any rate tried)
    let tiny = ten_to(100).recip()?;
    assert_eq!(
        fv(&tiny, 100_000, &usd("-1"), None, END, HALF),
        Err(Error::PowerTooLarge)
    );
    assert_eq!(
        fv_exact("0.0123456789", 10_000, &usd("-1"), None, END),
        Err(Error::PowerTooLarge)
    );
    assert!(fv("0.0123456789", 10_000, &usd("-1"), None, END, HALF)?.is_positive());
    assert_eq!(
        rate(3000, &usd("-200"), &usd("450000"), None, END, 100, None),
        Err(Error::PowerTooLarge)
    );
    // at every rate tried: the doubling search for a huge rate, and a bracket's huge or finely
    // divided ends
    let huge: Money<Usd> = format!("1{}", "0".repeat(300)).parse()?;
    assert_eq!(
        rate(14_000, &huge, &usd("-0.01"), None, END, 10, None),
        Err(Error::PowerTooLarge)
    );
    let (low, high) = (Ratio::ZERO, ten_to(3000));
    assert_eq!(
        rate(
            10_000,
            &usd("-1"),
            &usd("5000"),
            None,
            END,
            10,
            Some((&low, &high))
        ),
        Err(Error::PowerTooLarge)
    );
    let (low, high) = (ten_to(2000).recip()?, Ratio::ONE);
    assert_eq!(
        rate(
            10_000,
            &usd("-1"),
            &usd("5000"),
            None,
            END,
            10,
            Some((&low, &high))
        ),
        Err(Error::PowerTooLarge)
    );
    // a rate above 2^1024 per period: the search for a positive root stops
    let vast: Money<Usd> = format!("1{}", "0".repeat(400)).parse()?;
    assert_eq!(
        rate(1, &usd("0"), &usd("-0.01"), Some(&vast), END, 10, None),
        Err(Error::RateTooHigh)
    );
    // ln(1 + r) for r = 10^-5000 can't be told from 0 within the bits nper allows
    let minute = ten_to(5000).recip()?;
    assert_eq!(
        nper(&minute, &usd("-100"), &usd("1000"), None, END, 10),
        Err(Error::PrecisionExhausted)
    );
    Ok(())
}

#[test]
fn xnpv_and_xirr() -> Result {
    let values = flows(&["-10000", "2750", "4250", "3250", "2750"]);
    let dates = days(&[
        "2008-01-01",
        "2008-03-01",
        "2008-10-30",
        "2009-02-15",
        "2009-04-01",
    ]);
    let excel = XnpvOptions::default();
    assert_eq!(
        xnpv("0.09", &values, &dates, &excel, HALF)?.to_decimal(),
        "2086.65"
    );
    assert_eq!(
        xnpv("0.09", &values, &dates, &excel, Rounding::Floor)?.to_decimal(),
        "2086.64"
    );
    let mut shuffled: Vec<(Money<Usd>, Date)> =
        values.iter().cloned().zip(dates.iter().copied()).collect();
    shuffled.swap(1, 3);
    let (shuffled_values, shuffled_dates): (Vec<_>, Vec<_>) = shuffled.into_iter().unzip();
    // the first date starts the schedule, so it stays first
    assert_eq!(
        xnpv("0.09", &shuffled_values, &shuffled_dates, &excel, HALF)?,
        xnpv("0.09", &values, &dates, &excel, HALF)?
    );
    assert_eq!(
        xirr(&values, &dates, &excel, 9, None)?.to_string(),
        "0.373362533"
    );
    let two_years = days(&["2021-01-01", "2023-01-01"]);
    assert_eq!(
        xirr(&flows(&["-100", "121"]), &two_years, &excel, 6, None)?.to_string(),
        "0.100000"
    );
    assert_eq!(
        xirr(&flows(&["-100", "81"]), &two_years, &excel, 4, None)?.to_string(),
        "-0.1000"
    );

    // several rates can fit: a bracket picks one
    let several = flows(&["-100", "230", "-132"]);
    let yearly = days(&["2021-01-01", "2022-01-01", "2023-01-01"]);
    assert_eq!(
        xirr(&several, &yearly, &excel, 4, None),
        Err(Error::SeveralSignChanges)
    );
    let (low, middle, high) = (Ratio::ZERO, ratio(15, 100), ratio(1, 2));
    assert_eq!(
        xirr(&several, &yearly, &excel, 4, Some((&middle, &high)))?.to_string(),
        "0.2000"
    );
    assert_eq!(
        xirr(&several, &yearly, &excel, 4, Some((&low, &middle)))?.to_string(),
        "0.1000"
    );

    // where Excel returns #NUM!
    assert_eq!(
        xnpv("0.1", &values, &dates[1..], &excel, HALF),
        Err(Error::LengthMismatch)
    );
    let backwards = days(&["2020-02-01", "2020-01-01"]);
    assert_eq!(
        xnpv("0.1", &flows(&["1", "-1"]), &backwards, &excel, HALF),
        Err(Error::DateBeforeFirst)
    );
    let forwards = days(&["2020-01-01", "2020-02-01"]);
    assert_eq!(
        xnpv("0.1", &flows(&["1", "1"]), &forwards, &excel, HALF),
        Err(Error::OneSignOnly)
    );
    assert_eq!(
        xirr(&flows(&["-1", "-1"]), &forwards, &excel, 10, None),
        Err(Error::OneSignOnly)
    );
    assert_eq!(
        xnpv::<Money<Usd>>("0.1", &[], &[], &excel, HALF),
        Err(Error::NoFlows)
    );
    assert_eq!(
        xnpv("-1", &values, &dates, &excel, HALF),
        Err(Error::RateTooLow)
    );
    assert_eq!(
        xnpv_bounds("0.1", &values, &dates, &excel, 101),
        Err(Error::InvalidDigits)
    );
    let same_day = days(&["2020-01-01", "2020-01-01"]);
    assert_eq!(
        xirr(&flows(&["-5", "5"]), &same_day, &excel, 10, None),
        Err(Error::FlowsCancel)
    );
    let later = days(&["2020-01-01", "2020-01-01", "2021-01-01"]);
    assert_eq!(
        xirr(&flows(&["-5", "5", "1"]), &later, &excel, 10, None),
        Err(Error::NoSignChange)
    );
    Ok(())
}

#[test]
fn xnpv_settles_what_bracketing_alone_could_not() -> Result {
    let excel = XnpvOptions::default();
    // a factor below 2^-64: (1 − 50%)^70, refined rather than divided by a floor of 0
    let long_ago = days(&["2000-01-01", "2070-01-01"]);
    assert_eq!(
        xirr(&flows(&["-1000", "1"]), &long_ago, &excel, 12, None)?.to_string(),
        "-0.093906471109"
    );
    assert_eq!(
        xnpv("-0.5", &flows(&["-1000", "1"]), &long_ago, &excel, HALF)?.to_decimal(),
        "1221644970469628875138.49"
    );
    // a zero first value, then flows 365 days apart, whose irrational parts cancel at 10%
    let on_grid = days(&["2021-01-01", "2021-03-01", "2022-03-01"]);
    assert_eq!(
        xirr(&flows(&["0", "-1000", "1100"]), &on_grid, &excel, 10, None)?.to_string(),
        "0.1000000000"
    );
    // irrational terms that cancel leave an exact value, 1.005, a tie
    let cancel = flows(&["1", "0.01", "-10", "20"]);
    let cancel_dates = days(&["2020-01-01", "2020-12-31", "2020-04-10", "2021-04-10"]);
    let bounds = xnpv_bounds("1", &cancel, &cancel_dates, &excel, 10)?;
    assert!(bounds.exact && bounds.lower == ratio(201, 200) && bounds.upper == ratio(201, 200));
    assert_eq!(
        xnpv("1", &cancel, &cancel_dates, &excel, Rounding::HalfEven)?.to_decimal(),
        "1.00"
    );
    assert_eq!(
        xnpv("1", &cancel, &cancel_dates, &excel, HALF)?.to_decimal(),
        "1.01"
    );
    // exact roots off whole years: 1.1^5 and 0.9^5, 73 days apart, and 0 over 200 days
    let fifth = days(&["2021-01-01", "2021-03-15"]);
    assert_eq!(
        xirr(&flows(&["-100", "110"]), &fifth, &excel, 10, None)?.to_string(),
        "0.6105100000"
    );
    assert_eq!(
        xirr(&flows(&["-100", "90"]), &fifth, &excel, 10, None)?.to_string(),
        "-0.4095100000"
    );
    assert_eq!(
        xirr(&flows(&["-100", "90"]), &fifth, &excel, 3, None)?.to_string(),
        "-0.410"
    );
    let zero = xirr(
        &flows(&["-100", "100"]),
        &days(&["2020-01-01", "2020-07-19"]),
        &excel,
        10,
        None,
    )?;
    assert_eq!(
        (zero.to_string(), zero.upper_decimal()),
        ("0.0000000000".into(), "0.0000000001".into())
    );
    for (rate_text, last, dates) in [
        ("0", "100", days(&["2020-01-01", "2020-07-19"])),
        ("0.61051", "110", fifth.clone()),
        ("-0.40951", "90", fifth.clone()),
    ] {
        let values = flows(&["-100", last]);
        let bounds = xnpv_bounds(rate_text, &values, &dates, &excel, 10)?;
        assert!(
            bounds.exact && bounds.lower.is_zero() && bounds.upper.is_zero(),
            "{rate_text}"
        );
        assert_eq!(
            xnpv(rate_text, &values, &dates, &excel, Rounding::Unnecessary)?.to_decimal(),
            "0.00"
        );
    }
    // ACT/ACT ISDA and many digits: roots of the prime powers of 365·366
    let isda = XnpvOptions {
        day_count: DayCount::ActActIsda,
        maturity: None,
    };
    let spread = days(&["2019-03-01", "2020-07-15", "2021-11-20"]);
    assert_eq!(
        xirr(&flows(&["-1000", "300", "900"]), &spread, &isda, 30, None)?.to_string(),
        "0.079874584175787183494040182095"
    );
    // a 10^-100-wide interval around amounts of 10^700 needs more than 2,048 bits
    let big = format!("1{}", "0".repeat(700));
    let wide: Vec<Money<Usd>> = vec![format!("-{big}").parse()?, format!("{big}.01").parse()?];
    assert_eq!(
        xnpv_bounds(
            "0.1",
            &wide,
            &days(&["2020-01-01", "2021-02-05"]),
            &excel,
            100
        ),
        Err(Error::PrecisionExhausted)
    );
    Ok(())
}
