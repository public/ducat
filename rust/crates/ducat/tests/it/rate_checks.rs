//! `Rate::check_validity` and `AnyRate::implied`, as ducat's `Rate#checkValidity` and
//! `impliedRate` (src/rate.ts), with the expectations of test/rate.test.ts and
//! test/processor-fx.test.ts.

use ducat::convert::{AnyRate, ConvertOptions, Rate, RateInfo, RateQuote};
use ducat::iso::{Eur, Jpy, Usd};
use ducat::{AnyMoney, Error, ErrorKind, Money, Rounding};

use crate::common::{code, eur, time};

fn any(text: &str, currency: &str) -> AnyMoney {
    AnyMoney::parse(text, code(currency)).unwrap()
}

fn until(valid_until: &str) -> Rate<Eur, Usd> {
    Rate::parse("1.1")
        .unwrap()
        .with_info(RateInfo {
            valid_until: Some(time(valid_until)),
            ..RateInfo::default()
        })
        .unwrap()
}

#[test]
fn check_validity() {
    let locked = until("2000-01-01T00:05:00Z");
    let error = Error::RateExpired {
        from: code("EUR"),
        to: code("USD"),
        valid_until: time("2000-01-01T00:05:00Z"),
    };
    let expired = Err(error);
    assert_eq!(
        locked.check_validity(&time("2026-11-15T00:00:00Z")),
        expired
    );
    assert_eq!(locked.to_any().check_validity(&time("2026-11-15")), expired);
    assert_eq!(locked.check_validity(&time("2000-01-01T00:04:59Z")), Ok(()));
    // an instant is valid at itself
    assert_eq!(locked.check_validity(&time("2000-01-01T00:05:00Z")), Ok(()));
    assert_eq!(error.kind(), ErrorKind::Range);
    // a date is valid all day (UTC)
    let day = until("2026-11-06");
    assert_eq!(day.check_validity(&time("2026-11-06T23:59:59Z")), Ok(()));
    assert!(matches!(
        day.check_validity(&time("2026-11-07")),
        Err(Error::RateExpired { .. })
    ));
    // no valid_until: never expired
    let open: Rate<Eur, Usd> = Rate::parse("1.1").unwrap();
    assert_eq!(open.check_validity(&time("9999-12-31")), Ok(()));
    // the conversions run the same check
    let options = ConvertOptions {
        valid_at: Some(time("2026-11-07")),
        ..ConvertOptions::default()
    };
    assert_eq!(
        day.convert_with(&eur("1"), Rounding::HalfEven, &options)
            .unwrap_err(),
        day.check_validity(&time("2026-11-07")).unwrap_err()
    );
}

#[test]
fn implied_rates_in_runtime_currencies() -> crate::common::Result {
    let rate = AnyRate::implied(
        &any("10.00", "EUR"),
        &any("12.34", "USD"),
        RateInfo::default(),
    )?;
    assert_eq!(
        (rate.from(), rate.to(), rate.to_string()),
        (code("EUR"), code("USD"), "1.234".to_string())
    );
    // a refund: both negative
    let refund = AnyRate::implied(
        &any("-3.00", "EUR"),
        &any("-1000", "JPY"),
        RateInfo::default(),
    )?;
    assert_eq!(refund.to_string(), "1000/3");
    // the typed form agrees
    let typed = Rate::<Eur, Jpy>::implied(&"-3.00".parse()?, &"-1000".parse::<Money<Jpy>>()?)?;
    assert_eq!(typed.to_any(), refund);
    // with info, as ducat's third argument
    let info = RateInfo {
        source: Some("processor".into()),
        as_of: Some(time("2026-11-06")),
        quote: Some(RateQuote::new("1.234")),
        ..RateInfo::default()
    };
    let audited = AnyRate::implied(&any("10.00", "EUR"), &any("12.34", "USD"), info.clone())?;
    assert_eq!(audited.info(), &info);
    Ok(())
}

#[test]
fn implied_rate_failures_in_ducats_order() {
    let implied = |presented: &str, settled: &str, info: RateInfo| {
        AnyRate::implied(&any(presented, "EUR"), &any(settled, "USD"), info)
    };
    // ratio(n, 0): ducat's RangeError 'Division by zero', before the sign check
    assert_eq!(
        implied("0", "1", RateInfo::default()),
        Err(Error::DivisionByZero)
    );
    assert_eq!(
        implied("0", "0", RateInfo::default()),
        Err(Error::DivisionByZero)
    );
    assert_eq!(
        Rate::<Eur, Usd>::implied(&eur("0"), &"1".parse().unwrap()),
        Err(Error::DivisionByZero)
    );
    // 'Exchange rate must be positive'
    assert_eq!(
        implied("1", "-1", RateInfo::default()),
        Err(Error::NonPositiveRate)
    );
    assert_eq!(
        implied("1", "0", RateInfo::default()),
        Err(Error::NonPositiveRate)
    );
    // then the quote checks, after the rate's own
    let quoted = |rate: &str| RateInfo {
        quote: Some(RateQuote::new(rate)),
        ..RateInfo::default()
    };
    assert_eq!(
        implied("10", "12.34", quoted("1.2")),
        Err(Error::QuoteMismatch)
    );
    assert_eq!(
        implied("10", "12.34", quoted("-1.234")),
        Err(Error::InvalidQuote)
    );
    assert_eq!(implied("10", "12.34", quoted("x")), Err(Error::Syntax));
    assert_eq!(implied("1", "-1", quoted("x")), Err(Error::NonPositiveRate));
    for error in [
        Error::DivisionByZero,
        Error::NonPositiveRate,
        Error::QuoteMismatch,
    ] {
        assert_eq!(error.kind(), ErrorKind::Range);
    }
}
