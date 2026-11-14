//! Regression tests for the bug classes found in other Rust money and decimal libraries
//! (`docs/research/rust-money-libs.md`, section 6.1). Each test names its class (T5, T7, …).

use std::collections::HashSet;

use ducat::iso::{Eur, Jpy, Kwd, Usd};
use ducat::{AnyMoney, CurrencyCode, Error, Money, Ratio, Rounding};
use proptest::prelude::*;

fn eur(text: &str) -> Money<Eur> {
    text.parse().unwrap()
}

fn code(text: &str) -> CurrencyCode {
    text.parse().unwrap()
}

/// T5: exponents come from ISO 4217 List One, and codes that left it are unknown.
#[test]
fn t5_exponent_table() {
    for (text, exponent) in [
        ("HUF", 2),
        ("MGA", 2),
        ("MRU", 2),
        ("IDR", 2),
        ("IQD", 3),
        ("ISK", 0),
        ("CLF", 4),
        ("UYW", 4),
        ("VND", 0),
        ("XCG", 2),
        ("SLE", 2),
        ("VED", 2),
        ("VES", 2),
    ] {
        assert_eq!(code(text).exponent(), exponent, "{text}");
    }
    for gone in ["ANG", "BGN", "SLL", "HRK", "XAU"] {
        assert_eq!(
            gone.parse::<CurrencyCode>(),
            Err(Error::UnknownCurrency),
            "{gone}"
        );
    }
}

/// T7: no negative zero, in Display, to_decimal or serde.
#[test]
fn t7_no_negative_zero() {
    let rounded = Money::<Usd>::parse_at("-0.005", 3, Rounding::Unnecessary)
        .unwrap()
        .to_scale(2, Rounding::HalfEven)
        .unwrap();
    assert_eq!(rounded.to_string(), "0.00 USD");
    let tiny = eur("-0.01").multiply("0.1", Rounding::HalfExpand).unwrap();
    assert_eq!(tiny.to_decimal(), "0.00");
    assert_eq!(
        serde_json::to_string(&tiny).unwrap(),
        r#"{"amount":"0.00","currency":"EUR"}"#
    );
    assert_eq!(eur("-0.00").to_string(), "0.00 EUR");
}

/// T8: format flags never truncate or panic: Display ignores them.
#[test]
fn t8_format_flags_are_ignored() {
    for text in ["2.99", "0.99", "9.99"] {
        let money = eur(text);
        assert_eq!(format!("{money:.1}"), format!("{text} EUR"));
        assert_eq!(format!("{money:>20}"), format!("{text} EUR"));
    }
    let big = Money::<Eur>::from_units(i128::MAX, 38).unwrap();
    assert_eq!(
        format!("{big:.28}"),
        "1.70141183460469231731687303715884105727 EUR"
    );
}

/// T9: rounding carries into a new digit.
#[test]
fn t9_carry() {
    let money = Money::<Eur>::parse_at("9.995", 3, Rounding::Unnecessary).unwrap();
    assert_eq!(
        money
            .to_scale(2, Rounding::HalfExpand)
            .unwrap()
            .to_decimal(),
        "10.00"
    );
    assert_eq!(
        eur("-0.68")
            .to_scale(0, Rounding::HalfEven)
            .unwrap()
            .to_decimal(),
        "-1"
    );
}

/// T10: exact ties in division round by the mode asked for, with divisors beyond 96 bits.
#[test]
fn t10_ties_with_wide_divisors() {
    let money = Money::<Eur>::from_units(15_845_632_502_852_867_518_708_790_069, 0).unwrap();
    let divisor = Ratio::new(200_000_000_000_000_000_000, 1).unwrap();
    // 15845632502852867518708790069 / 2e20 = 79228162.514264337593543950345: not a tie
    assert_eq!(
        money.divide(divisor, Rounding::HalfEven).unwrap().units(),
        79_228_163
    );
    // 25 / 10 = 2.5 at scale 0, with a wide equal factor on both sides
    let wide = 10i128.pow(30);
    let tie = Money::<Jpy>::from_minor(25)
        .multiply(Ratio::new(wide, 10 * wide).unwrap(), Rounding::HalfEven)
        .unwrap();
    assert_eq!(tie.units(), 2);
}

/// A slow, independent reference: the exact quotient `n/d` rounded with `mode`, for values small
/// enough that every product fits an i128.
fn reference(n: i128, d: i128, mode: Rounding) -> Option<i128> {
    assert!(d > 0);
    let floor = n.div_euclid(d);
    let remainder = n.rem_euclid(d); // 0 ≤ remainder < d
    if remainder == 0 {
        return Some(floor);
    }
    let ceil = floor + 1;
    let toward_zero = if n < 0 { ceil } else { floor };
    let away = if n < 0 { floor } else { ceil };
    let twice = 2 * remainder; // vs d: below, at or above the midpoint from floor
    let nearest = |tie: i128| match twice.cmp(&d) {
        std::cmp::Ordering::Less => floor,
        std::cmp::Ordering::Greater => ceil,
        std::cmp::Ordering::Equal => tie,
    };
    Some(match mode {
        Rounding::Floor => floor,
        Rounding::Ceil => ceil,
        Rounding::Trunc => toward_zero,
        Rounding::Expand => away,
        Rounding::HalfFloor => nearest(floor),
        Rounding::HalfCeil => nearest(ceil),
        Rounding::HalfTrunc => nearest(toward_zero),
        Rounding::HalfExpand => nearest(away),
        Rounding::HalfEven => nearest(if floor % 2 == 0 { floor } else { ceil }),
        Rounding::Unnecessary => return None,
        _ => unreachable!(),
    })
}

proptest! {
    /// T11: rounding division agrees with the reference in every mode and sign combination.
    #[test]
    fn t11_rounding_matches_reference(units in -1_000_000_000i128..1_000_000_000, num in -100_000i128..100_000, den in 1i128..100_000, mode in 0usize..10) {
        let mode = Rounding::ALL[mode];
        let money = Money::<Eur>::from_minor(units);
        let factor = Ratio::new(num, den).unwrap();
        let got = money.multiply(factor, mode);
        match reference(units * factor.numer(), factor.denom(), mode) {
            Some(want) => prop_assert_eq!(got.map(|m| m.units()), Ok(want)),
            None => {
                let exact = (units * factor.numer()) % factor.denom() == 0;
                prop_assert_eq!(got.is_ok(), exact);
            }
        }
    }

    /// T11: the same through divide, with negative divisors.
    #[test]
    fn t11_division_matches_reference(units in -1_000_000_000i128..1_000_000_000, divisor in -100_000i128..100_000, mode in 0usize..9) {
        prop_assume!(divisor != 0);
        let mode = Rounding::ALL[mode];
        let got = Money::<Eur>::from_minor(units).divide(divisor as i64, mode).unwrap().units();
        let (n, d) = if divisor < 0 { (-units, -divisor) } else { (units, divisor) };
        prop_assert_eq!(Some(got), reference(n, d, mode));
    }

    /// T11 at the i128 limits: multiplying by k/k is exact whatever the size of k.
    #[test]
    fn t11_wide_identity(units in any::<i128>(), k in 1i128..=i128::MAX) {
        let money = Money::<Eur>::from_units(units, 2).unwrap();
        let factor = Ratio::from(k).checked_div(Ratio::from(k)).unwrap();
        prop_assert_eq!(money.multiply(factor, Rounding::Unnecessary).unwrap(), money);
        // and through a factor that isn't reduced away: (units × k) / k, built as two steps
        if let Ok(scaled) = money.to_scale(3, Rounding::Unnecessary) {
            prop_assert_eq!(scaled.to_scale(2, Rounding::Unnecessary).unwrap(), money);
        }
    }

    /// T13: parsing any text never panics, and Display always re-parses to the same value.
    #[test]
    fn t13_parse_never_panics(text in "\\PC{0,40}") {
        let _ = text.parse::<Money<Eur>>();
        let _ = text.parse::<Ratio>();
        let _ = text.parse::<AnyMoney>();
    }

    #[test]
    fn t13_display_round_trips(units in any::<i128>(), scale in 0u16..60) {
        let money = AnyMoney::from_units(units, scale, code("EUR")).unwrap();
        let back = AnyMoney::parse_at(&money.to_decimal(), money.currency(), scale, Rounding::Unnecessary).unwrap();
        prop_assert_eq!(back, money);
        prop_assert!(!money.to_decimal().contains(['e', 'E']));
    }

    /// T18 and T19: Hash agrees with Eq, and compare is a total order consistent with eq_value.
    #[test]
    fn t18_t19_hash_and_order(a in -1000i128..1000, b in -1000i128..1000, sa in 0u16..4, sb in 0u16..4) {
        let left = Money::<Eur>::from_units(a, sa).unwrap();
        let right = Money::<Eur>::from_units(b, sb).unwrap();
        let value_equal = a * 10i128.pow(u32::from(sb)) == b * 10i128.pow(u32::from(sa));
        prop_assert_eq!(left.eq_value(&right), value_equal);
        prop_assert_eq!(left == right, a == b && sa == sb);
        prop_assert_eq!(left.compare(&right), right.compare(&left).reverse());
        if left == right {
            let set: HashSet<AnyMoney> = [left.to_any(), right.to_any()].into_iter().collect();
            prop_assert_eq!(set.len(), 1);
        }
    }
}

/// T11 at i128::MIN.
#[test]
fn t11_i128_min() {
    let min = Money::<Eur>::from_minor(i128::MIN);
    assert_eq!(min.multiply(1, Rounding::Unnecessary).unwrap(), min);
    assert_eq!(
        min.multiply(-1, Rounding::Unnecessary),
        Err(Error::Overflow)
    );
    assert_eq!(
        min.divide(2, Rounding::Unnecessary).unwrap().units(),
        i128::MIN / 2
    );
    assert_eq!(
        min.divide(3, Rounding::Floor).unwrap().units(),
        i128::MIN.div_euclid(3)
    );
    assert_eq!(min.checked_neg(), Err(Error::Overflow));
    assert_eq!(
        min.compare(&Money::from_units(-1, 30).unwrap()),
        std::cmp::Ordering::Less
    );
}

/// T12: parsing and deserialization never round silently.
#[test]
fn t12_no_silent_rounding() {
    assert_eq!("1.005".parse::<Money<Eur>>(), Err(Error::Rounding));
    assert_eq!("1000.5".parse::<Money<Jpy>>(), Err(Error::Rounding));
    assert_eq!("1.005 EUR".parse::<AnyMoney>(), Err(Error::Rounding));
    assert!(serde_json::from_str::<Money<Eur>>(r#"{"amount":"1.005","currency":"EUR"}"#).is_err());
    assert_eq!(
        Money::<Eur>::parse_at("1.005", 2, Rounding::HalfEven)
            .unwrap()
            .to_decimal(),
        "1.00"
    );
    assert_eq!(
        Money::<Eur>::parse_at("1.005", 3, Rounding::Unnecessary)
            .unwrap()
            .to_decimal(),
        "1.005"
    );
    assert_eq!("1.230".parse::<Money<Eur>>().unwrap().to_decimal(), "1.23");
}

/// T13: scientific and odd inputs parse exactly or fail.
#[test]
fn t13_odd_inputs() {
    assert_eq!(
        Money::<Eur>::parse_at("1E-29", 29, Rounding::Unnecessary)
            .unwrap()
            .units(),
        1
    );
    assert_eq!("1E-29".parse::<Money<Eur>>(), Err(Error::Rounding));
    assert_eq!(
        "50000E15".parse::<Money<Eur>>().unwrap().to_decimal(),
        "50000000000000000000.00"
    );
    assert_eq!(
        "1e99999999999999".parse::<Money<Eur>>(),
        Err(Error::ExponentOutOfRange)
    );
    assert_eq!("1_1.2_2".parse::<Money<Eur>>(), Err(Error::Syntax));
    assert_eq!("1.23abc".parse::<Money<Eur>>(), Err(Error::Syntax));
    assert_eq!("1e40".parse::<Money<Eur>>(), Err(Error::Overflow));
    assert_eq!("+7".parse::<Money<Eur>>().unwrap().to_decimal(), "7.00");
    assert_eq!("125E-2".parse::<Money<Eur>>().unwrap().to_decimal(), "1.25");
}

/// T14: float input follows the binary64 rule.
#[test]
fn t14_float_input() {
    assert_eq!(Money::<Eur>::from_f64(7.9).unwrap().to_decimal(), "7.90");
    assert_eq!(Money::<Eur>::from_f64(0.1).unwrap().to_decimal(), "0.10");
    assert_eq!(Money::<Eur>::from_f64(0.1 + 0.2), Err(Error::Rounding));
    assert_eq!(Money::<Eur>::from_f64(1.005), Err(Error::Rounding));
    assert_eq!(
        Money::<Eur>::from_f64_at(0.1 + 0.2, 2, Rounding::HalfEven)
            .unwrap()
            .to_decimal(),
        "0.30"
    );
    assert_eq!(
        Money::<Eur>::from_f64_at(1652185258.8058286, 7, Rounding::Unnecessary)
            .unwrap()
            .to_decimal(),
        "1652185258.8058286"
    );
    assert_eq!(
        Money::<Eur>::from_f64_at(1652185258.8058286, 20, Rounding::Unnecessary)
            .map(|m| m.units() > 0),
        Ok(true)
    );
    assert_eq!(Money::<Eur>::from_f64(f64::NAN), Err(Error::NotFinite));
    assert_eq!(
        Money::<Eur>::from_f64(9_007_199_254_740_991.0)
            .unwrap()
            .to_decimal(),
        "9007199254740991.00"
    );
    assert_eq!(
        Ratio::try_from(20000.000001).unwrap(),
        "20000.000001".parse().unwrap()
    );
    assert_eq!(
        Ratio::try_from(1652185258.8058286),
        Err(Error::TooManyDigits)
    );
}

/// T16: serde writes strings, reads them back, and rejects bad input with an error.
#[test]
fn t16_serde() {
    let money = eur("12.34");
    let json = serde_json::to_string(&money).unwrap();
    assert_eq!(json, r#"{"amount":"12.34","currency":"EUR"}"#);
    assert_eq!(serde_json::from_str::<Money<Eur>>(&json).unwrap(), money);
    assert_eq!(serde_json::from_str::<AnyMoney>(&json).unwrap(), money);
    // the value's own scale is written; at the currency's exponent it reads back by value
    let scale3 = Money::<Eur>::parse_at("12.340", 3, Rounding::Unnecessary).unwrap();
    let json = serde_json::to_string(&scale3).unwrap();
    assert_eq!(json, r#"{"amount":"12.340","currency":"EUR"}"#);
    assert_eq!(serde_json::from_str::<Money<Eur>>(&json).unwrap(), money);
    for bad in [
        r#"{"amount":12.34,"currency":"EUR"}"#,
        r#"{"amount":"12.34","currency":"USD"}"#,
        r#"{"amount":"12.34","currency":"XXX"}"#,
        r#"{"amount":"1e9999","currency":"EUR"}"#,
        r#"{"amount":"170141183460469231731687303715884105728","currency":"EUR"}"#,
        r#"{"amount":"NaN","currency":"EUR"}"#,
        r#"{"amount":"12.34"}"#,
        r#"{"amount":"12.34","currency":"EUR","extra":1}"#,
        r#"{"amount":"1","amount":"2","currency":"EUR"}"#,
    ] {
        assert!(serde_json::from_str::<Money<Eur>>(bad).is_err(), "{bad}");
    }
    let usd = serde_json::from_str::<AnyMoney>(r#"{"amount":"-5","currency":"USD"}"#).unwrap();
    assert_eq!(usd.to_string(), "-5.00 USD");
}

/// T18: Hash agrees with Eq across Money and AnyMoney, scale included.
#[test]
fn t18_hash_across_types() {
    use std::hash::{BuildHasher, RandomState};
    let state = RandomState::new();
    let typed = eur("1.00");
    assert_eq!(state.hash_one(typed), state.hash_one(typed.to_any()));
    assert_eq!(typed, typed.to_any());
    let one_place = Money::<Eur>::parse_at("1.0", 1, Rounding::Unnecessary).unwrap();
    assert_ne!(typed, one_place);
    assert!(typed.eq_value(&one_place));
}

/// T20: Ratio overflow is an error everywhere, including where only intermediates overflow.
#[test]
fn t20_ratio_overflow() {
    let small = Ratio::new(1, 3_000_000_000).unwrap();
    assert!(small.checked_div(Ratio::from(3_080_000_000u32)).is_ok());
    assert_eq!(Ratio::new(i128::MIN, -1), Err(Error::Overflow));
    assert_eq!(Ratio::new(0, 0), Err(Error::DivisionByZero));
    assert_eq!(
        Ratio::from(i128::MAX).checked_mul(Ratio::from(i128::MAX)),
        Err(Error::Overflow)
    );
    assert_eq!("1/0".parse::<Ratio>(), Err(Error::DivisionByZero));
    // the plain product of the parts overflows, the reduced one doesn't
    let big = Ratio::new(i128::MAX, 7).unwrap();
    assert_eq!(
        big.checked_mul(Ratio::new(7, i128::MAX).unwrap()),
        Ok(Ratio::ONE)
    );
}

/// T21: typed `+` panics on overflow in every profile, and checked_add errors.
#[test]
#[should_panic(expected = "overflowed")]
fn t21_add_panics() {
    let _ = Money::<Eur>::from_minor(i128::MAX) + Money::from_minor(1);
}

#[test]
fn t21_checked() {
    let max = Money::<Eur>::from_minor(i128::MAX);
    assert_eq!(max.checked_add(Money::from_minor(1)), Err(Error::Overflow));
    assert_eq!(
        Money::<Eur>::from_minor(i128::MIN).checked_sub(Money::from_minor(1)),
        Err(Error::Overflow)
    );
    assert_eq!(max.to_scale(3, Rounding::Unnecessary), Err(Error::Overflow));
    assert_eq!(
        Money::<Kwd>::from_minor(1).checked_add(Money::from_units(1, 45).unwrap()),
        Err(Error::Overflow)
    );
}

/// T22: conversion always rounds to the target's exponent.
#[test]
fn t22_conversion_scale() {
    let yen: Money<Jpy> = eur("100.00")
        .convert("162.457", Rounding::HalfExpand)
        .unwrap();
    assert_eq!(yen.to_string(), "16246 JPY");
    let back: Money<Eur> = yen.convert("1/162.457", Rounding::HalfEven).unwrap();
    assert_eq!(back.to_string(), "100.00 EUR");
    assert_eq!(
        eur("1").convert::<Usd>("0", Rounding::HalfEven),
        Err(Error::NonPositiveRate)
    );
    assert_eq!(
        eur("1").convert::<Usd>("-1.1", Rounding::HalfEven),
        Err(Error::NonPositiveRate)
    );
}

/// T23: wei-scale amounts fit and round-trip.
#[test]
fn t23_wei() {
    ducat::define_currency! {
        /// Ether, in wei.
        Eth = "ETH", 18
    }
    let amount: Money<Eth> = "40891.62685493".parse().unwrap();
    assert_eq!(amount.units(), 40_891_626_854_930_000_000_000);
    assert_eq!(
        Money::<Eth>::from_minor(40_891_626_854_930_000_000_000).to_string(),
        "40891.626854930000000000 ETH"
    );
}
