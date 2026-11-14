//! Regression tests for the bug classes found in other Rust money and decimal libraries
//! (`docs/research/rust-money-libs.md`, section 6.1). Each test names its class (T5, T7, …).
//! The differential tests check the `i128` fast path against arbitrary precision (num-bigint)
//! around the promotion boundaries.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use ducat::iso::{Eur, Jpy, Usd};
use ducat::{AnyMoney, CurrencyCode, Error, Int, Money, Ratio, Rounding};
use num_bigint::BigInt;
use num_integer::Integer;
use proptest::prelude::*;

fn eur(text: &str) -> Money<Eur> {
    text.parse().unwrap()
}

fn code(text: &str) -> CurrencyCode {
    text.parse().unwrap()
}

fn big(value: &Int) -> BigInt {
    value.to_string().parse().unwrap()
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

/// T7: no negative zero, in Display, to_decimal or serde, small or big.
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
    let huge = Money::<Eur>::from_minor(Int::from(i128::MIN) * Int::from(i128::MIN));
    assert_eq!((&huge - &huge).to_string(), "0.00 EUR");
    let shrunk = (-&huge)
        .divide(
            Ratio::from(Int::from(i128::MIN) * Int::from(i128::MIN)).mul(&Ratio::from(1000)),
            Rounding::HalfEven,
        )
        .unwrap();
    assert_eq!(shrunk.to_decimal(), "0.00");
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

/// T9: rounding carries into a new digit, at any size.
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
    let nines = format!("{}.995", "9".repeat(60));
    let money = Money::<Eur>::parse_at(&nines, 3, Rounding::Unnecessary).unwrap();
    assert_eq!(
        money
            .to_scale(2, Rounding::HalfExpand)
            .unwrap()
            .to_decimal(),
        format!("1{}.00", "0".repeat(60))
    );
}

/// T10: exact ties in division round by the mode asked for, with divisors beyond 96 bits.
#[test]
fn t10_ties_with_wide_divisors() {
    let wide = 10i128.pow(30);
    // 5·10^30 ÷ 2·10^30 = 2.5 exactly: the divisor stays wide after reduction (5/2)
    let money = Money::<Jpy>::from_minor(5 * wide);
    let divisor = Ratio::from(2 * wide);
    assert_eq!(
        *money.divide(&divisor, Rounding::HalfEven).unwrap().units(),
        2
    );
    assert_eq!(
        *money
            .divide(&divisor, Rounding::HalfExpand)
            .unwrap()
            .units(),
        3
    );
    assert_eq!(
        *money.divide(&divisor, Rounding::HalfTrunc).unwrap().units(),
        2
    );
    // wide on both sides, and exact: no mode may move it
    let odd = Money::<Jpy>::from_minor(-15_845_632_502_852_867_518_708_790_070i128);
    let divisor = Ratio::from(-3_169_126_500_570_573_503_741_758_014i128);
    assert_eq!(
        *odd.divide(divisor, Rounding::Unnecessary).unwrap().units(),
        5
    );
    // 15845632502852867518708790069 / 2·10^20 = 79228162.514…, rounding up in every half mode
    let big = Money::<Eur>::from_units(15_845_632_502_852_867_518_708_790_069i128, 0).unwrap();
    let divisor = Ratio::from(200_000_000_000_000_000_000i128);
    assert_eq!(
        *big.divide(divisor, Rounding::HalfEven).unwrap().units(),
        79_228_163
    );
    // a tie beyond i128: (2·10^40 + 1) / 2 at scale 0
    let past = Money::<Jpy>::from_minor(format!("2{}1", "0".repeat(39)).parse::<Int>().unwrap());
    assert_eq!(
        past.divide(2, Rounding::HalfEven)
            .unwrap()
            .units()
            .to_string(),
        format!("1{}", "0".repeat(40))
    );
    assert_eq!(
        past.divide(2, Rounding::HalfExpand)
            .unwrap()
            .units()
            .to_string(),
        format!("1{}1", "0".repeat(39))
    );
}

/// The exact quotient `n/d` rounded with `mode`, in arbitrary precision: an independent
/// reference written from the definitions of the modes.
fn reference(n: &BigInt, d: &BigInt, mode: Rounding) -> Option<BigInt> {
    assert!(*d > BigInt::from(0));
    let (floor, remainder) = n.div_mod_floor(d); // 0 ≤ remainder < d
    if remainder == BigInt::from(0) {
        return Some(floor);
    }
    let ceil = &floor + 1;
    let negative = *n < BigInt::from(0);
    let toward_zero = if negative {
        ceil.clone()
    } else {
        floor.clone()
    };
    let away = if negative {
        floor.clone()
    } else {
        ceil.clone()
    };
    let twice = &remainder * 2;
    let nearest = |tie: BigInt| match twice.cmp(d) {
        std::cmp::Ordering::Less => floor.clone(),
        std::cmp::Ordering::Greater => ceil.clone(),
        std::cmp::Ordering::Equal => tie,
    };
    Some(match mode {
        Rounding::Floor => floor.clone(),
        Rounding::Ceil => ceil.clone(),
        Rounding::Trunc => toward_zero,
        Rounding::Expand => away,
        Rounding::HalfFloor => nearest(floor.clone()),
        Rounding::HalfCeil => nearest(ceil.clone()),
        Rounding::HalfTrunc => nearest(toward_zero),
        Rounding::HalfExpand => nearest(away),
        Rounding::HalfEven => nearest(if floor.is_even() {
            floor.clone()
        } else {
            ceil.clone()
        }),
        Rounding::Unnecessary => return None,
        _ => unreachable!(),
    })
}

/// Values around the promotion boundaries: near 0, near ±i128::MAX and i128::MIN, and beyond.
fn boundary_int() -> impl Strategy<Value = Int> {
    prop_oneof![
        (-1000i128..1000).prop_map(Int::from),
        (-1000i128..1000).prop_map(|offset| Int::from(i128::MAX) + Int::from(offset)),
        (-1000i128..1000).prop_map(|offset| Int::from(i128::MIN) + Int::from(offset)),
        any::<i128>().prop_map(Int::from),
        (any::<i128>(), any::<i128>())
            .prop_map(|(high, low)| Int::from(high) * Int::from(i128::MAX) + Int::from(low)),
    ]
}

proptest! {
    /// T11: multiply agrees with the reference in every mode and sign combination, on both
    /// sides of the i128 boundary.
    #[test]
    fn t11_multiply_matches_reference(units in boundary_int(), num in boundary_int(), den in boundary_int(), mode in 0usize..10) {
        prop_assume!(!den.is_zero());
        let mode = Rounding::ALL[mode];
        let factor = Ratio::new(num, den).unwrap();
        let got = Money::<Eur>::from_minor(units.clone()).multiply(&factor, mode);
        let exact = big(&units) * big(factor.numer());
        match reference(&exact, &big(factor.denom()), mode) {
            Some(want) => prop_assert_eq!(got.map(|m| big(m.units())), Ok(want)),
            None => {
                let divides = (&exact % big(factor.denom())) == BigInt::from(0);
                prop_assert_eq!(got.is_ok(), divides);
            }
        }
    }

    /// T11: divide, with negative divisors.
    #[test]
    fn t11_divide_matches_reference(units in boundary_int(), divisor in boundary_int(), mode in 0usize..9) {
        prop_assume!(!divisor.is_zero());
        let mode = Rounding::ALL[mode];
        let got = Money::<Eur>::from_minor(units.clone()).divide(divisor.clone(), mode).unwrap();
        let (n, d) = (big(&units), big(&divisor));
        let (n, d) = if d < BigInt::from(0) { (-n, -d) } else { (n, d) };
        prop_assert_eq!(Some(big(got.units())), reference(&n, &d, mode));
    }

    /// Scale changes, add, subtract and compare agree with arbitrary precision.
    #[test]
    fn rescale_add_compare_match_reference(a in boundary_int(), b in boundary_int(), scale in 0u16..45, mode in 0usize..9) {
        let mode = Rounding::ALL[mode];
        let left = Money::<Eur>::from_units(a.clone(), scale).unwrap();
        let right = Money::<Eur>::from_minor(b.clone());
        let sum = &left + &right;
        let common = scale.max(2);
        let lift = |value: &Int, from: u16| big(value) * num_traits::pow(BigInt::from(10), usize::from(common - from));
        prop_assert_eq!(big(sum.units()), lift(&a, scale) + lift(&b, 2));
        prop_assert_eq!(big((&left - &right).units()), lift(&a, scale) - lift(&b, 2));
        prop_assert_eq!(left.compare(&right), lift(&a, scale).cmp(&lift(&b, 2)));
        let lowered = left.to_scale(0, mode).unwrap();
        prop_assert_eq!(Some(big(lowered.units())), reference(&big(&a), &num_traits::pow(BigInt::from(10), usize::from(scale)), mode));
    }

    /// Int's own arithmetic, and its canonical form: a value that grows and comes back is held
    /// the same way as one that never grew.
    #[test]
    fn int_is_canonical(a in boundary_int(), b in boundary_int()) {
        prop_assert_eq!(big(&(&a + &b)), big(&a) + big(&b));
        prop_assert_eq!(big(&(&a - &b)), big(&a) - big(&b));
        prop_assert_eq!(big(&(&a * &b)), big(&a) * big(&b));
        prop_assert_eq!(a.cmp(&b), big(&a).cmp(&big(&b)));
        let back = &(&a + &b) - &b;
        prop_assert_eq!(&back, &a);
        let set: HashSet<Int> = [back, a.clone()].into_iter().collect();
        prop_assert_eq!(set.len(), 1);
        prop_assert_eq!(a.to_string().parse::<Int>().unwrap(), a);
    }

    /// T13: parsing any text never panics, and Display always re-parses to the same value.
    #[test]
    fn t13_parse_never_panics(text in "\\PC{0,40}") {
        let _ = text.parse::<Money<Eur>>();
        let _ = text.parse::<Ratio>();
        let _ = text.parse::<AnyMoney>();
        let _ = text.parse::<Int>();
    }

    #[test]
    fn t13_display_round_trips(units in boundary_int(), scale in 0u16..60) {
        let money = AnyMoney::from_units(units, scale, code("EUR")).unwrap();
        let back = AnyMoney::parse_at(&money.to_decimal(), money.currency(), scale, Rounding::Unnecessary).unwrap();
        prop_assert_eq!(&back, &money);
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

/// T11 at i128::MIN, which now negates past i128 instead of failing.
#[test]
fn t11_i128_min() {
    let min = Money::<Eur>::from_minor(i128::MIN);
    assert_eq!(min.multiply(1, Rounding::Unnecessary).unwrap(), min);
    assert_eq!(
        min.multiply(-1, Rounding::Unnecessary)
            .unwrap()
            .units()
            .to_string(),
        "170141183460469231731687303715884105728"
    );
    assert_eq!(
        *min.divide(2, Rounding::Unnecessary).unwrap().units(),
        i128::MIN / 2
    );
    assert_eq!(
        *min.divide(3, Rounding::Floor).unwrap().units(),
        i128::MIN.div_euclid(3)
    );
    assert_eq!((-&min).units().to_i128(), None);
    assert_eq!(-(-&min), min);
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
        *Money::<Eur>::parse_at("1E-29", 29, Rounding::Unnecessary)
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
    assert_eq!(
        "1e40".parse::<Money<Eur>>().unwrap().to_decimal(),
        format!("1{}.00", "0".repeat(40))
    );
    assert_eq!("+7".parse::<Money<Eur>>().unwrap().to_decimal(), "7.00");
    assert_eq!("125E-2".parse::<Money<Eur>>().unwrap().to_decimal(), "1.25");
    assert_eq!(
        "1e1000".parse::<Money<Eur>>().unwrap().to_decimal().len(),
        1004
    );
}

/// No digit cap, as in ducat: 100,000 digits parse, print and round-trip, in a time far beyond
/// what that takes (the bound only catches a runaway, it isn't a benchmark).
#[test]
fn hundred_thousand_digits() {
    let digits = "7".repeat(100_000);
    let start = Instant::now();
    let money: Money<Eur> = digits.parse().unwrap();
    let text = money.to_decimal();
    assert_eq!(text.len(), 100_003);
    assert_eq!(text.parse::<Money<Eur>>().unwrap(), money);
    let json = serde_json::to_string(&money).unwrap();
    assert_eq!(serde_json::from_str::<Money<Eur>>(&json).unwrap(), money);
    assert!(
        start.elapsed() < Duration::from_secs(60),
        "took {:?}",
        start.elapsed()
    );
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
    assert!(
        Money::<Eur>::from_f64_at(1652185258.8058286, 20, Rounding::Unnecessary)
            .unwrap()
            .is_positive()
    );
    assert_eq!(Money::<Eur>::from_f64(f64::NAN), Err(Error::NotFinite));
    assert_eq!(
        Money::<Eur>::from_f64(9_007_199_254_740_991.0)
            .unwrap()
            .to_decimal(),
        "9007199254740991.00"
    );
    assert_eq!(
        Money::<Eur>::from_f64_at(f64::MAX, 0, Rounding::Unnecessary)
            .unwrap()
            .units()
            .to_string()
            .len(),
        309
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
    // beyond i128 is just a longer string
    let huge = r#"{"amount":"170141183460469231731687303715884105728.00","currency":"EUR"}"#;
    assert_eq!(
        serde_json::to_string(&serde_json::from_str::<Money<Eur>>(huge).unwrap()).unwrap(),
        huge
    );
    for bad in [
        r#"{"amount":12.34,"currency":"EUR"}"#,
        r#"{"amount":"12.34","currency":"USD"}"#,
        r#"{"amount":"12.34","currency":"XXX"}"#,
        r#"{"amount":"1e9999","currency":"EUR"}"#,
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
    assert_eq!(state.hash_one(&typed), state.hash_one(typed.to_any()));
    assert_eq!(typed, typed.to_any());
    let three_places = Money::<Eur>::parse_at("1.000", 3, Rounding::Unnecessary).unwrap();
    assert_ne!(typed, three_places);
    assert!(typed.eq_value(&three_places));
}

/// T20: Ratio arithmetic is exact at any size; only zero denominators fail.
#[test]
fn t20_ratio() {
    let small = Ratio::new(1, 3_000_000_000u64).unwrap();
    assert!(small.div(&Ratio::from(3_080_000_000u32)).is_ok());
    assert_eq!(
        Ratio::new(i128::MIN, -1).unwrap().numer().to_string(),
        "170141183460469231731687303715884105728"
    );
    assert_eq!(Ratio::new(0, 0), Err(Error::DivisionByZero));
    assert_eq!("1/0".parse::<Ratio>(), Err(Error::DivisionByZero));
    let square = Ratio::from(i128::MAX).mul(&Ratio::from(i128::MAX));
    assert_eq!(
        square.div(&Ratio::from(i128::MAX)).unwrap(),
        Ratio::from(i128::MAX)
    );
    let big = Ratio::new(i128::MAX, 7).unwrap();
    assert_eq!(big.mul(&Ratio::new(7, i128::MAX).unwrap()), Ratio::ONE);
}

/// T21, revised: `+` and `-` never overflow; past i128 the value grows.
#[test]
fn t21_no_overflow() {
    let max = Money::<Eur>::from_minor(i128::MAX);
    let next = &max + &Money::from_minor(1);
    assert_eq!(
        next.units().to_string(),
        "170141183460469231731687303715884105728"
    );
    assert_eq!(&next - &Money::from_minor(1), max);
    let wide = Money::<Eur>::from_units(1, 45).unwrap();
    assert_eq!((&Money::<Eur>::from_minor(1) + &wide).scale(), 45);
    let total: Money<Eur> = [max.clone(), max.clone(), max].iter().sum();
    assert_eq!(big(total.units()), BigInt::from(i128::MAX) * 3);
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
    assert_eq!(*amount.units(), 40_891_626_854_930_000_000_000i128);
    assert_eq!(
        Money::<Eth>::from_minor(40_891_626_854_930_000_000_000i128).to_string(),
        "40891.626854930000000000 ETH"
    );
}
