//! Checked clamp, min and max, as ducat's (src/money.ts `min`, `max`, `clamp`; src/exact.ts
//! `ExactMoney#clamp`), with the expectations of test/money-edges.test.ts and
//! test/exact-edges.test.ts: the first of equal values wins, a value equal to a bound is kept as
//! it is, `lo > hi` is an error (ducat's `RangeError`), and currencies are checked in ducat's
//! order.

use ducat::exact::{AnyExactMoney, ExactMoney};
use ducat::iso::Eur;
use ducat::{AnyMoney, Error, ErrorKind, Money, Rounding};

use crate::common::{code, eur};

fn eur_at(text: &str, scale: u16) -> Money<Eur> {
    Money::parse_at(text, scale, Rounding::Unnecessary).unwrap()
}

fn any(text: &str, currency: &str) -> AnyMoney {
    AnyMoney::parse(text, code(currency)).unwrap()
}

fn any_at(text: &str, currency: &str, scale: u16) -> AnyMoney {
    AnyMoney::parse_at(text, code(currency), scale, Rounding::Unnecessary).unwrap()
}

fn mismatch(expected: &str, actual: &str) -> Error {
    Error::CurrencyMismatch {
        expected: code(expected),
        actual: code(actual),
    }
}

#[test]
fn low_above_high_is_a_range_error_with_ducats_message() {
    assert_eq!(Error::LowAboveHigh.kind(), ErrorKind::Range);
    assert_eq!(Error::LowAboveHigh.to_string(), "clamp(): lo > hi");
}

#[test]
fn money_min_and_max_keep_the_first_of_equal_values() {
    let low = eur("1.00");
    let low_at_scale1 = eur_at("1.0", 1);
    let high = eur("2.00");
    assert!(high.clone().min(&low).identical(&low));
    assert!(low.clone().min(&high).identical(&low));
    assert!(low.clone().max(&high).identical(&high));
    assert!(high.clone().max(&low).identical(&high));
    // 1.0 EUR (scale 1) against 1.00 EUR: the first argument, both ways, for both
    let one_at_scale1 = eur_at("1.0", 1);
    let one = eur("1.00");
    assert!(one_at_scale1.clone().max(&one).identical(&one_at_scale1));
    assert!(one_at_scale1.clone().min(&one).identical(&one_at_scale1));
    assert!(one.clone().max(&one_at_scale1).identical(&one));
    assert!(one.clone().min(&one_at_scale1).identical(&one));
    // an owned argument calls the inherent method too, not Ord::max (which keeps the second)
    assert!(
        one_at_scale1
            .clone()
            .max(one.clone())
            .identical(&one_at_scale1)
    );
    assert!(Ord::max(one_at_scale1.clone(), one.clone()).identical(&one));
    // variadic, as ducat's max(low, high, lowAtScale1) and min(high, low, 1.5)
    assert!(
        Money::max_of([&low, &high, &low_at_scale1])
            .unwrap()
            .identical(&high)
    );
    assert!(
        Money::min_of([&high, &low, &eur("1.5")])
            .unwrap()
            .identical(&low)
    );
    assert!(
        Money::max_of([&low, &low_at_scale1])
            .unwrap()
            .identical(&low)
    );
    assert!(
        Money::max_of([&low_at_scale1, &low])
            .unwrap()
            .identical(&low_at_scale1)
    );
    assert!(
        Money::min_of([&low_at_scale1, &low])
            .unwrap()
            .identical(&low_at_scale1)
    );
    assert_eq!(Money::<Eur>::min_of([]), None);
    assert_eq!(Money::<Eur>::max_of([]), None);
}

#[test]
fn money_clamp() -> crate::common::Result {
    let low = eur("1.00");
    let high = eur("2.00");
    assert!(eur("0.50").clamp(&low, &high)?.identical(&low));
    assert!(eur("3.00").clamp(&low, &high)?.identical(&high));
    assert!(eur("1.50").clamp(&low, &high)?.identical(&eur("1.50")));
    // a value equal to a bound is returned as it is, not replaced by the bound
    let at_low = eur_at("1.0", 1);
    let at_high = eur_at("2.000", 3);
    assert!(at_low.clone().clamp(&low, &high)?.identical(&at_low));
    assert!(at_high.clone().clamp(&low, &high)?.identical(&at_high));
    // lo == hi is a valid range, and owned bounds work too
    assert!(eur("5").clamp(low.clone(), low.clone())?.identical(&low));
    assert_eq!(low.clone().clamp(&high, &low), Err(Error::LowAboveHigh));
    // equal bounds at different scales aren't lo > hi; above them is hi, below them lo
    assert!(eur("5").clamp(&at_high, &high)?.identical(&high));
    assert!(eur("0").clamp(&at_high, &high)?.identical(&at_high));
    Ok(())
}

#[test]
fn any_min_and_max() -> crate::common::Result {
    let low = any("1.00", "EUR");
    let low_at_scale1 = any_at("1.0", "EUR", 1);
    let high = any("2.00", "EUR");
    assert!(high.min(&low)?.identical(&low));
    assert!(low.min(&high)?.identical(&low));
    assert!(low.max(&high)?.identical(&high));
    assert!(high.max(&low)?.identical(&high));
    assert!(low.min(&low_at_scale1)?.identical(&low));
    assert!(low_at_scale1.min(&low)?.identical(&low_at_scale1));
    assert!(low.max(&low_at_scale1)?.identical(&low));
    assert!(low_at_scale1.max(&low)?.identical(&low_at_scale1));
    assert!(
        AnyMoney::max_of([&low, &high, &low_at_scale1])?
            .unwrap()
            .identical(&high)
    );
    assert!(
        AnyMoney::min_of([&high, &low, &any("1.5", "EUR")])?
            .unwrap()
            .identical(&low)
    );
    assert_eq!(AnyMoney::min_of([])?, None);
    assert_eq!(AnyMoney::max_of([])?, None);

    // ducat's compare(candidate, best): expected is the candidate's currency
    let usd = any("1.00", "USD");
    assert_eq!(low.min(&usd), Err(mismatch("USD", "EUR")));
    assert_eq!(low.max(&usd), Err(mismatch("USD", "EUR")));
    assert_eq!(
        AnyMoney::min_of([&low, &high, &usd]),
        Err(mismatch("USD", "EUR"))
    );
    assert_eq!(AnyMoney::max_of([&usd, &low]), Err(mismatch("EUR", "USD")));
    // the first item in another currency is the one reported
    let gbp = any("1.00", "GBP");
    assert_eq!(
        AnyMoney::max_of([&low, &gbp, &usd]),
        Err(mismatch("GBP", "EUR"))
    );
    Ok(())
}

#[test]
fn any_clamp() -> crate::common::Result {
    let low = any("1.00", "EUR");
    let high = any("2.00", "EUR");
    assert!(any("0.50", "EUR").clamp(&low, &high)?.identical(&low));
    assert!(any("3.00", "EUR").clamp(&low, &high)?.identical(&high));
    let at_low = any_at("1.0", "EUR", 1);
    let at_high = any_at("2.000", "EUR", 3);
    assert!(at_low.clamp(&low, &high)?.identical(&at_low));
    assert!(at_high.clamp(&low, &high)?.identical(&at_high));
    assert!(any("5", "EUR").clamp(&low, &low)?.identical(&low));
    assert_eq!(low.clamp(&high, &low), Err(Error::LowAboveHigh));

    // ducat's order: compare(lo, hi), then lo > hi, then compare(money, lo)
    let usd_low = any("1.00", "USD");
    let usd_high = any("2.00", "USD");
    let usd = any("1.50", "USD");
    assert_eq!(usd.clamp(&low, &usd_high), Err(mismatch("EUR", "USD")));
    // a bounds mismatch comes before lo > hi
    assert_eq!(usd.clamp(&high, &usd_low), Err(mismatch("EUR", "USD")));
    // lo > hi comes before the value's currency
    assert_eq!(usd.clamp(&high, &low), Err(Error::LowAboveHigh));
    assert_eq!(usd.clamp(&low, &high), Err(mismatch("USD", "EUR")));
    Ok(())
}

#[test]
fn exact_clamp() -> crate::common::Result {
    let half = eur("1").exact().divide(2)?;
    let half_again = eur("0.50").exact();
    let third = eur("1").exact().divide(3)?;
    // test/exact-edges.test.ts
    assert_eq!(third.clone().clamp(&half, &half_again)?, half);
    assert_eq!(
        third.clone().clamp(&half_again, &third),
        Err(Error::LowAboveHigh)
    );
    // Money bounds, owned or borrowed, as ducat's take Money too
    let low = eur("0.25");
    let high = eur("0.40");
    assert_eq!(third.clone().clamp(&low, &high)?, third);
    assert_eq!(half.clone().clamp(&low, high.clone())?, high.exact());
    assert_eq!(
        ExactMoney::<Eur>::zero().clamp(low.clone(), &high)?,
        low.exact()
    );
    assert_eq!(third.clone().clamp(&high, &low), Err(Error::LowAboveHigh));
    // mixed bounds
    assert_eq!(half.clone().clamp(&third, &high)?, high.exact());
    Ok(())
}

#[test]
fn any_exact_clamp() -> crate::common::Result {
    let third = any("1", "EUR").exact().divide(3)?;
    let low = any("0.25", "EUR");
    let high = any("0.40", "EUR");
    assert_eq!(third.clamp(&low, &high)?, third);
    assert_eq!(any("1", "EUR").exact().clamp(&low, &high)?, high.exact());
    assert_eq!(
        AnyExactMoney::zero(code("EUR")).clamp(low.clone(), high.exact())?,
        low.exact()
    );
    assert_eq!(third.clamp(&high, &low), Err(Error::LowAboveHigh));

    // ducat's order: lo.compare(hi), then lo > hi, then this.max(lo) (lo.compare(this))
    let usd = any("0.30", "USD").exact();
    let usd_low = any("0.25", "USD");
    assert_eq!(third.clamp(&low, &usd), Err(mismatch("EUR", "USD")));
    assert_eq!(third.clamp(&high, &usd_low), Err(mismatch("EUR", "USD")));
    assert_eq!(usd.clamp(&high, &low), Err(Error::LowAboveHigh));
    assert_eq!(usd.clamp(&low, &high), Err(mismatch("EUR", "USD")));
    Ok(())
}
