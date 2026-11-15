//! `ducat::testing`: what the strategies reach, the bounds they keep, and the assertion macros'
//! failure messages. Samples come from a deterministic runner, so the coverage checks can't flake.
#![cfg(feature = "proptest")]

use std::collections::BTreeSet;

use ducat::iso::{Clf, Eur, Jpy};
use ducat::policy::{MAX_INCREMENT, RoundingPolicy};
use ducat::testing::proptest::arbitrary::any_with;
use ducat::testing::proptest::prelude::*;
use ducat::testing::proptest::strategy::{BoxedStrategy, ValueTree};
use ducat::testing::proptest::test_runner::{TestError, TestRunner};
use ducat::testing::{
    CurrencyOptions, MoneyOptions, any_money, currency_code, int, int_in, money, nonzero_ratio,
    ratio, rounding, rounding_except_unnecessary, rounding_policy, rounding_policy_for,
};
use ducat::{
    AnyMoney, Currency, CurrencyCode, Int, MAX_CUSTOM_EXPONENT, MAX_SCALE, Money, Ratio, Rounding,
    assert_identical, assert_money_eq,
};

/// `count` values drawn from `strategy` by a deterministic runner.
fn sample<S: Strategy>(strategy: S, count: usize) -> Vec<S::Value> {
    let mut runner = TestRunner::deterministic();
    (0..count)
        .map(|_| strategy.new_tree(&mut runner).expect("a value").current())
        .collect()
}

fn big(text: &str) -> Int {
    text.parse().expect("an integer")
}

fn eur(text: &str) -> Money<Eur> {
    text.parse().expect("an amount")
}

// --- Int ----------------------------------------------------------------------------------------

#[test]
fn int_reaches_both_sides_of_the_i128_boundary() {
    let ten_thousand = Int::from(10_000);
    let values = sample(int(), 4000);
    let max = Int::from(i128::MAX);
    let min = Int::from(i128::MIN);
    let thousand = Int::from(1000);
    let near = |value: &Int, edge: &Int| (value - edge).abs() <= thousand;
    let bound =
        big("115792089237316195423570985008687907853269984665640564039457584007913129639936");

    assert!(values.iter().all(|value| value.abs() <= bound));
    assert!(values.contains(&bound));
    assert!(values.iter().any(|value| *value == -&bound));
    // inline and heap, on both sides of zero
    assert!(values.iter().any(|value| value.to_i128().is_some()));
    assert!(
        values
            .iter()
            .any(|value| value.to_i128().is_none() && value.is_positive())
    );
    assert!(
        values
            .iter()
            .any(|value| value.to_i128().is_none() && value.is_negative())
    );
    // either side of i128::MAX and i128::MIN, and the limits themselves
    for edge in [&max, &min] {
        assert!(
            values
                .iter()
                .any(|value| near(value, edge) && value.to_i128().is_some())
        );
        assert!(
            values
                .iter()
                .any(|value| near(value, edge) && value.to_i128().is_none())
        );
        assert!(values.iter().any(|value| value == edge));
    }
    // near the i64 limits and ±(2^53 − 1), and small
    for edge in [
        i64::MAX.into(),
        i64::MIN.into(),
        Int::from((1i64 << 53) - 1),
    ] {
        assert!(
            values
                .iter()
                .any(|value| near(value, &edge) && *value != edge)
        );
    }
    assert!(values.iter().any(Int::is_zero));
    assert!(
        values
            .iter()
            .any(|value| value.abs() <= ten_thousand && !value.is_zero())
    );
    // log-uniform: every size of magnitude shows up, not only ~77-digit ones
    let lengths: BTreeSet<usize> = values
        .iter()
        .map(|value| value.abs().to_string().len())
        .collect();
    assert!(lengths.len() > 60, "{lengths:?}");
}

#[test]
fn int_in_keeps_to_its_range_and_reaches_its_ends() {
    let max = Int::from(i128::MAX);
    for (low, high) in [
        (Int::from(-3), Int::from(3)),
        (max.clone(), &max + &Int::ONE),
        (
            Int::from(5),
            big("1000000000000000000000000000000000000000000000"),
        ),
        (
            big("-1000000000000000000000000000000000000000000000"),
            Int::from(-5),
        ),
        (Int::from(7), Int::from(7)),
    ] {
        let values = sample(int_in(low.clone()..=high.clone()), 500);
        assert!(
            values.iter().all(|value| low <= *value && *value <= high),
            "{low}..={high}"
        );
        assert!(
            values.contains(&low) && values.contains(&high),
            "{low}..={high}"
        );
    }
}

#[test]
#[should_panic(expected = "int_in: the range 1..=0 is empty")]
fn int_in_refuses_an_empty_range() {
    let _ = int_in(Int::ONE..=Int::ZERO);
}

#[test]
fn int_shrinks_to_the_smallest_failing_value() {
    let limit = big("100000000000000000000000000000000000000000");
    let mut runner = TestRunner::deterministic();
    let result = runner.run(&int(), |value| {
        prop_assert!(value < limit);
        Ok(())
    });
    match result {
        Err(TestError::Fail(_, value)) => assert_eq!(value, limit),
        other => panic!("expected a failure, got {other:?}"),
    }
}

#[test]
fn int_shrinks_toward_zero_or_the_end_nearest_it() {
    let limit = big("100000000000000000000000000000000000000000");
    let minimal = |strategy: BoxedStrategy<Int>, passes: &dyn Fn(&Int) -> bool| {
        let mut runner = TestRunner::deterministic();
        match runner.run(&strategy, |value| {
            prop_assert!(passes(&value));
            Ok(())
        }) {
            Err(TestError::Fail(_, value)) => value,
            other => panic!("expected a failure, got {other:?}"),
        }
    };
    assert_eq!(minimal(int(), &|value| *value > -&limit), -&limit);
    assert_eq!(minimal(int(), &|value| value.is_zero()), Int::from(-1));
    // a range without zero shrinks toward its end nearest zero
    let thousand = Int::from(1000);
    let range = Int::from(5)..=big("1000000000000000000000000000000000000000000000");
    assert_eq!(
        minimal(int_in(range), &|value| *value < thousand),
        Int::from(1000)
    );
    let range = -&limit..=Int::from(-5);
    assert_eq!(
        minimal(int_in(range), &|value| *value > -&thousand),
        Int::from(-1000)
    );
    // through the money strategies
    let mut runner = TestRunner::deterministic();
    let result = runner.run(&money::<Eur>(&MoneyOptions::new().scale(2)), |price| {
        prop_assert!(price < eur("1000000.00"));
        Ok(())
    });
    match result {
        Err(TestError::Fail(_, price)) => assert_identical!(price, eur("1000000.00")),
        other => panic!("expected a failure, got {other:?}"),
    }
}

#[test]
fn any_int_is_int() {
    let values = sample(any::<Int>(), 200);
    assert!(values.iter().any(|value| value.to_i128().is_none()));
}

// --- Rounding -----------------------------------------------------------------------------------

#[test]
fn rounding_reaches_every_mode() {
    let modes: BTreeSet<Rounding> = sample(rounding(), 300).into_iter().collect();
    assert_eq!(modes, Rounding::ALL.into_iter().collect());
    let modes: BTreeSet<Rounding> = sample(any::<Rounding>(), 300).into_iter().collect();
    assert_eq!(modes.len(), Rounding::ALL.len());

    let modes: BTreeSet<Rounding> = sample(rounding_except_unnecessary(), 300)
        .into_iter()
        .collect();
    assert_eq!(modes.len(), Rounding::ALL.len() - 1);
    assert!(!modes.contains(&Rounding::Unnecessary));
}

#[test]
fn rounding_policy_reaches_its_bounds() {
    let policies = sample(rounding_policy(), 2000);
    let modes: BTreeSet<Rounding> = policies.iter().map(RoundingPolicy::mode).collect();
    assert_eq!(modes.len(), Rounding::ALL.len());
    for scale in [None, Some(0), Some(8), Some(MAX_SCALE)] {
        assert!(
            policies.iter().any(|policy| policy.scale() == scale),
            "{scale:?}"
        );
    }
    for increment in [1, 5, MAX_INCREMENT] {
        assert!(
            policies
                .iter()
                .any(|policy| policy.increment() == increment)
        );
    }
    assert!(
        policies
            .iter()
            .any(|policy| ![1, MAX_INCREMENT].contains(&policy.increment()))
    );
    assert!(policies.iter().all(|policy| policy.currency().is_none()));
    assert!(
        sample(any::<RoundingPolicy>(), 100)
            .iter()
            .all(|policy| policy.currency().is_none())
    );

    let restricted = sample(rounding_policy_for(Jpy::CODE), 200);
    assert!(
        restricted
            .iter()
            .any(|policy| policy.currency() == Some(Jpy::CODE))
    );
    assert!(restricted.iter().any(|policy| policy.currency().is_none()));
}

// --- Currencies ---------------------------------------------------------------------------------

#[test]
fn currency_code_defaults_to_the_representative_mix() {
    let codes: BTreeSet<String> = sample(currency_code(&CurrencyOptions::new()), 500)
        .iter()
        .map(|code| code.as_str().to_owned())
        .collect();
    let mix = [
        "EUR", "USD", "GBP", "JPY", "KRW", "KWD", "BHD", "TND", "CLF",
    ];
    assert_eq!(codes, mix.iter().map(|code| (*code).to_owned()).collect());
    let codes = sample(any::<CurrencyCode>(), 100);
    assert!(codes.iter().all(|code| mix.contains(&code.as_str())));
}

#[test]
fn currency_code_reaches_iso_historic_crypto_and_custom_codes() {
    let codes = sample(currency_code(&CurrencyOptions::everything()), 4000);
    let historic = |code: &CurrencyCode| {
        ducat::historic::currency(code.as_str()).map(|entry| entry.code()) == Some(*code)
    };
    let crypto = |code: &CurrencyCode| {
        ducat::crypto::unit(code.as_str()).map(|unit| unit.code()) == Some(*code)
    };
    let iso: BTreeSet<CurrencyCode> = codes.iter().copied().filter(CurrencyCode::is_iso).collect();
    assert!(iso.len() > 120, "{}", iso.len());
    assert!(codes.iter().any(historic));
    assert!(codes.iter().any(crypto));
    let custom: Vec<&CurrencyCode> = codes
        .iter()
        .filter(|code| !code.is_iso() && !historic(code) && !crypto(code))
        .collect();
    assert!(custom.len() > 500, "{}", custom.len());
    let exponents: BTreeSet<u8> = custom.iter().map(|code| code.exponent()).collect();
    assert_eq!(exponents, (0..=MAX_CUSTOM_EXPONENT).collect());
    let lengths: BTreeSet<usize> = custom.iter().map(|code| code.as_str().len()).collect();
    assert_eq!(lengths, (1..=12).collect());
    assert!(
        custom
            .iter()
            .any(|code| code.as_str().bytes().any(|byte| byte.is_ascii_lowercase()))
    );
    assert!(
        custom
            .iter()
            .any(|code| code.as_str().bytes().any(|byte| byte.is_ascii_digit()))
    );
    assert!(
        custom
            .iter()
            .any(|code| CurrencyCode::iso_non_monetary().any(|text| text == code.as_str()))
    );
    // every custom code is a valid one
    for code in custom {
        assert_eq!(
            CurrencyCode::custom(code.as_str(), code.exponent()),
            Ok(*code)
        );
    }
    let same = sample(
        any_with::<CurrencyCode>(CurrencyOptions::everything()),
        4000,
    );
    assert_eq!(same, codes);
}

#[test]
fn currency_options_narrow_and_add() {
    let options = CurrencyOptions::new().exponents([0, 4]);
    let codes: BTreeSet<CurrencyCode> = sample(currency_code(&options), 300).into_iter().collect();
    let names: BTreeSet<&str> = codes.iter().map(CurrencyCode::as_str).collect();
    assert_eq!(names, ["CLF", "JPY", "KRW"].into_iter().collect());

    let all: BTreeSet<CurrencyCode> =
        sample(currency_code(&CurrencyOptions::new().all_iso()), 3000)
            .into_iter()
            .collect();
    assert_eq!(all, CurrencyCode::iso_codes().collect());

    let btc = CurrencyCode::custom("BTC", 8).unwrap();
    let only: BTreeSet<CurrencyCode> = sample(currency_code(&CurrencyOptions::only([btc])), 50)
        .into_iter()
        .collect();
    assert_eq!(only, [btc].into_iter().collect());
    let extra: BTreeSet<CurrencyCode> =
        sample(currency_code(&CurrencyOptions::new().extra([btc])), 500)
            .into_iter()
            .collect();
    assert_eq!(extra.len(), 10);
    assert!(extra.contains(&btc));
    let only_iso = CurrencyOptions::only([btc]).all_iso();
    let codes: BTreeSet<CurrencyCode> =
        sample(currency_code(&only_iso), 3000).into_iter().collect();
    assert_eq!(codes.len(), CurrencyCode::iso_codes().len() + 1);

    // custom codes take their exponent from the list
    let options = CurrencyOptions::only([]).custom().exponents([30, 31]);
    let codes = sample(currency_code(&options), 200);
    assert!(
        codes
            .iter()
            .all(|code| code.exponent() == 30 && !code.is_iso())
    );

    let options = CurrencyOptions::only([]).historic().exponents([0]);
    let codes = sample(currency_code(&options), 200);
    assert!(
        codes
            .iter()
            .all(|code| code.exponent() == 0 && !code.is_iso())
    );
    let options = CurrencyOptions::only([]).crypto();
    let exponents: BTreeSet<u8> = sample(currency_code(&options), 200)
        .iter()
        .map(CurrencyCode::exponent)
        .collect();
    assert!(
        exponents.contains(&8) && exponents.contains(&18),
        "{exponents:?}"
    );
}

#[test]
#[should_panic(expected = "currency_code: no currency has the requested exponents")]
fn currency_code_refuses_an_empty_pool() {
    let _ = currency_code(&CurrencyOptions::new().exponents([1]));
}

// --- Money --------------------------------------------------------------------------------------

#[test]
fn money_reaches_both_sides_of_the_i128_boundary() {
    let prices = sample(money::<Eur>(&MoneyOptions::new()), 3000);
    let limit = big("1000000000000000000000000000000000000000000000");
    assert!(prices.iter().all(|price| price.units().abs() <= limit));
    assert!(prices.iter().any(|price| *price.units() == limit));
    assert!(prices.iter().any(|price| *price.units() == -&limit));
    assert!(prices.iter().any(|price| price.units().to_i128().is_some()));
    assert!(prices.iter().any(|price| price.units().to_i128().is_none()));
    let (max, thousand) = (Int::from(i128::MAX), Int::from(1000));
    assert!(
        prices
            .iter()
            .any(|price| (price.units() - &max).abs() <= thousand
                && price.units().to_i128().is_none())
    );
    // mostly the exponent, sometimes up to three more decimals
    let scales: BTreeSet<u16> = prices.iter().map(Money::scale).collect();
    assert_eq!(scales, (2..=5).collect());
    let at_exponent = prices.iter().filter(|price| price.scale() == 2).count();
    assert!(at_exponent > prices.len() / 2, "{at_exponent}");

    let yen = sample(any::<Money<Jpy>>(), 300);
    let scales: BTreeSet<u16> = yen.iter().map(Money::scale).collect();
    assert_eq!(scales, (0..=3).collect());
}

#[test]
fn money_scales_reach_their_bounds() {
    let options = MoneyOptions::new().scales(0..=MAX_SCALE).magnitude(1000);
    let scales: BTreeSet<u16> = sample(money::<Clf>(&options), 300)
        .iter()
        .map(Money::scale)
        .collect();
    assert!(
        scales.contains(&0) && scales.contains(&MAX_SCALE),
        "{scales:?}"
    );
    assert!(scales.len() > 50);

    let options = MoneyOptions::new().scale(MAX_SCALE).magnitude(1000);
    let scales: BTreeSet<u16> = sample(money::<Eur>(&options), 50)
        .iter()
        .map(Money::scale)
        .collect();
    assert_eq!(scales, [MAX_SCALE].into_iter().collect());
}

#[test]
#[should_panic(expected = "MoneyOptions::scales: 0..=1001 is empty or beyond MAX_SCALE (1000)")]
fn money_refuses_a_scale_beyond_max_scale() {
    let _ = MoneyOptions::new().scales(0..=MAX_SCALE + 1);
}

#[test]
fn money_keeps_to_its_bounds_and_reaches_them() {
    let options = MoneyOptions::new()
        .min("-0.005".parse().unwrap())
        .max(Ratio::new(1, 3).unwrap());
    let prices = sample(money::<Eur>(&options), 1000);
    // the bounds round inward at each scale
    let (low, above) = (
        Money::<Eur>::from_units(-5, 3).unwrap(),
        Money::<Eur>::from_units(33_334, 5).unwrap(),
    );
    assert!(prices.iter().all(|price| *price >= low && *price < above));
    assert!(
        prices
            .iter()
            .any(|price| *price == eur("0.33") && price.scale() == 2)
    );
    assert!(
        prices
            .iter()
            .any(|price| price.identical(&Money::from_units(33_333, 5).unwrap()))
    );
    assert!(
        prices
            .iter()
            .any(|price| price.identical(&Money::from_units(-5, 3).unwrap()))
    );
    assert!(
        prices
            .iter()
            .all(|price| price.scale() != 2 || *price >= Money::zero())
    );

    // one bound: the other side reaches the magnitude
    let options = MoneyOptions::new().min(Ratio::ZERO).scale(2);
    let prices = sample(money::<Eur>(&options), 1000);
    assert!(prices.iter().all(|price| !price.is_negative()));
    assert!(
        prices
            .iter()
            .any(|price| *price.units() == big("1000000000000000000000000000000000000000000000"))
    );
    assert!(prices.iter().any(Money::is_zero));
}

#[test]
#[should_panic(expected = "no EUR amount at scale 2 between min and max")]
fn money_refuses_bounds_with_nothing_between() {
    let options = MoneyOptions::new()
        .min("0.001".parse().unwrap())
        .max("0.009".parse().unwrap())
        .scale(2);
    let _ = sample(money::<Eur>(&options), 1);
}

#[test]
fn any_money_draws_its_currencies() {
    let amounts = sample(any_money(&MoneyOptions::new()), 500);
    let codes: BTreeSet<CurrencyCode> = amounts.iter().map(AnyMoney::currency).collect();
    assert_eq!(codes.len(), 9);
    assert!(amounts.iter().all(|amount| {
        let exponent = u16::from(amount.currency().exponent());
        (exponent..=exponent + 3).contains(&amount.scale())
    }));

    let options = MoneyOptions::new().currencies(CurrencyOptions::everything());
    let amounts = sample(
        any::<AnyMoney>().prop_union(any_with::<AnyMoney>(options)),
        1000,
    );
    assert!(amounts.iter().any(|amount| !amount.currency().is_iso()));
    assert!(
        amounts
            .iter()
            .any(|amount| amount.currency().exponent() > 4)
    );

    let btc = CurrencyCode::custom("BTC", 8).unwrap();
    let amounts = sample(any_money(&MoneyOptions::new().currency(btc)), 100);
    assert!(amounts.iter().all(|amount| amount.currency() == btc));
}

// --- Ratio --------------------------------------------------------------------------------------

#[test]
fn ratio_reaches_large_and_decimal_factors() {
    let factors = sample(ratio(), 2000);
    assert!(factors.iter().all(|factor| factor.denom().is_positive()));
    assert!(
        factors
            .iter()
            .any(|factor| factor.denom().to_i128().is_none())
    );
    assert!(
        factors
            .iter()
            .any(|factor| factor.numer().to_i128().is_none())
    );
    assert!(factors.iter().any(|factor| *factor.denom() == 1));
    assert!(
        factors
            .iter()
            .any(|factor| factor.terminating_scale(0).is_some_and(|scale| scale > 0))
    );
    assert!(factors.iter().any(Ratio::is_zero));
    assert!(factors.iter().any(|factor| factor.numer().is_negative()));
    assert!(
        sample(nonzero_ratio(), 2000)
            .iter()
            .all(|factor| !factor.is_zero())
    );
    assert!(
        sample(any::<Ratio>(), 100)
            .iter()
            .any(|factor| *factor.denom() != 1)
    );
}

// --- The macros ---------------------------------------------------------------------------------

#[test]
fn assert_money_eq_passes_by_value() {
    let one = eur("1.00");
    assert_money_eq!(one, Money::<Eur>::from_units(10, 1).unwrap());
    assert_money_eq!(&one, &one.to_any());
    assert_money_eq!(one.to_any(), one, "with a {}", "message");
    let parts = [eur("0.33"), eur("0.33"), eur("0.34")];
    assert_money_eq!(parts.iter().sum::<Money<Eur>>(), one);
}

#[test]
#[should_panic(
    expected = "assertion `left == right` failed (money, by value)\n  left: 1.00 EUR (scale 2)\n right: 1.001 EUR (scale 3)"
)]
fn assert_money_eq_shows_both_sides_and_their_scales() {
    assert_money_eq!(eur("1.00"), Money::<Eur>::from_units(1001, 3).unwrap());
}

#[test]
#[should_panic(
    expected = "assertion `left == right` failed (money, by value): the total of 3 parts\n  left: 1.00 EUR (scale 2)\n right: 1.01 EUR (scale 2)"
)]
fn assert_money_eq_shows_its_message() {
    assert_money_eq!(eur("1.00"), eur("1.01"), "the total of {} parts", 3);
}

#[test]
#[should_panic(
    expected = "assertion `left == right` failed (money, by value)\n  left: 1.00 EUR (scale 2)\n right: 1.00 USD (scale 2)"
)]
fn assert_money_eq_fails_across_currencies() {
    assert_money_eq!(
        eur("1.00").to_any(),
        "1.00 USD".parse::<AnyMoney>().unwrap()
    );
}

#[test]
fn assert_identical_passes_on_the_same_scale() {
    let price = Money::<Eur>::from_units(1234, 3).unwrap();
    assert_identical!(price, Money::<Eur>::from_units(1234, 3).unwrap());
    assert_identical!(&price.to_any(), &price.to_any(), "round trip");
}

#[test]
#[should_panic(
    expected = "assertion `left.identical(right)` failed (same value and scale)\n  left: 1.0 EUR (scale 1)\n right: 1.00 EUR (scale 2)"
)]
fn assert_identical_shows_both_sides_and_their_scales() {
    // equal by value, so assert_money_eq! would pass
    let tenths = Money::<Eur>::from_units(10, 1).unwrap();
    assert_money_eq!(tenths, eur("1.00"));
    assert_identical!(tenths, eur("1.00"));
}

#[test]
#[should_panic(
    expected = "assertion `left.identical(right)` failed (same value and scale): after a round trip through JSON\n  left: 1.0 EUR (scale 1)\n right: 1.00 EUR (scale 2)"
)]
fn assert_identical_shows_its_message() {
    let tenths = Money::<Eur>::from_units(10, 1).unwrap().to_any();
    assert_identical!(
        tenths,
        eur("1.00").to_any(),
        "after a round trip through {}",
        "JSON"
    );
}

// --- Used as intended ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn strategies_compose_in_proptest(
        price in any::<Money<Eur>>(),
        policy in rounding_policy_for(Eur::CODE),
        mode in rounding_except_unnecessary(),
    ) {
        let rounded = price.round(policy);
        prop_assert!(rounded.is_ok() || policy.mode() == Rounding::Unnecessary);
        let halves = price.divide(2, mode).unwrap();
        prop_assert!((&halves + &halves - &price).abs() <= Money::from_units(1, price.scale()).unwrap());
    }
}
