//! The inline fast paths of summing and adding against the general paths they replaced (each
//! module's `#[cfg(test)] reference`): the same value, scale and representation, and the same
//! errors, weighted around ±`i128::MAX` and over mixed scales. The cases follow `PROPTEST_CASES`
//! (256 by default); run them at 10,000 with
//! `PROPTEST_CASES=10000 cargo test -p ducat --lib sum_tests::`.

use alloc::vec::Vec;

use crate::any::reference as any_reference;
use crate::convert::bag_reference;
use crate::convert::sum_by_currency;
use crate::fixed::Fixed;
use crate::fixed::reference as fixed_reference;
use crate::int::reference as int_reference;
use crate::iso::{Eur, Jpy};
use crate::math::reference as math_reference;
use crate::money::reference as money_reference;
use crate::testing::proptest::collection::vec;
use crate::testing::proptest::prelude::*;
use crate::testing::{MoneyOptions, int, int_in, money, rounding};
use crate::{AnyMoney, CurrencyCode, Error, Int, Money};

fn code(text: &str) -> CurrencyCode {
    text.parse().expect("a currency code")
}

fn max() -> Int {
    Int::from(i128::MAX)
}

/// Units weighted around the `i128` limits: within 2^20 of ±`i128::MAX` (both sides, so sums and
/// rescales cross onto the heap and back), anywhere in `i128`, small values, and `ducat::testing`'s
/// own spread to ±2^256.
fn units() -> BoxedStrategy<Int> {
    let near = Int::from(1u32 << 20);
    prop_oneof![
        3 => int_in(&max() - &near..=&max() + &near),
        3 => int_in(-&max() - &near..=-&max() + &near),
        2 => int_in(Int::from(i128::MIN)..=max()),
        2 => int_in(Int::from(-10_000)..=Int::from(10_000)),
        1 => int(),
    ]
    .boxed()
}

/// Scales around EUR's exponent (2): below it, at it, and a few above.
fn scale() -> BoxedStrategy<u16> {
    prop_oneof![3 => Just(2u16), 2 => 0u16..=6].boxed()
}

fn eur() -> BoxedStrategy<Money<Eur>> {
    prop_oneof![
        4 => (units(), scale()).prop_map(|(units, scale)| Money::from_units(units, scale).unwrap()),
        1 => money::<Eur>(&MoneyOptions::new()),
    ]
    .boxed()
}

/// Mostly EUR, sometimes JPY or USD, at mixed scales.
fn any_money() -> BoxedStrategy<AnyMoney> {
    let currency =
        prop_oneof![8 => Just(code("EUR")), 1 => Just(code("JPY")), 1 => Just(code("USD"))];
    (units(), scale(), currency)
        .prop_map(|(units, scale, currency)| AnyMoney::from_units(units, scale, currency).unwrap())
        .boxed()
}

fn fixed() -> BoxedStrategy<Fixed> {
    (units(), scale())
        .prop_map(|(units, scale)| Fixed::new(units, scale).unwrap())
        .boxed()
}

fn same(
    actual: &Result<AnyMoney, Error>,
    expected: &Result<AnyMoney, Error>,
) -> Result<(), TestCaseError> {
    match (actual, expected) {
        (Ok(actual), Ok(expected)) => {
            prop_assert!(actual.identical(expected), "{actual:?} != {expected:?}");
            // canonical: an inline value is never left on the heap, so `units` compare alike
            prop_assert_eq!(actual.units().to_i128(), expected.units().to_i128());
        }
        _ => prop_assert_eq!(actual, expected),
    }
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig::default())]

    #[test]
    fn money_sum_matches_the_fold(items in vec(eur(), 0..40)) {
        let expected = money_reference::sum(&items);
        let by_ref: Money<Eur> = items.iter().sum();
        let owned: Money<Eur> = items.iter().cloned().sum();
        prop_assert!(by_ref.identical(&expected), "{by_ref:?} != {expected:?}");
        prop_assert!(owned.identical(&expected), "{owned:?} != {expected:?}");
        prop_assert_eq!(by_ref.units().to_i128(), expected.units().to_i128());
    }

    #[test]
    fn jpy_sum_matches_the_fold(items in vec((units(), scale()), 0..20)) {
        let items: Vec<Money<Jpy>> = items
            .into_iter()
            .map(|(units, scale)| Money::from_units(units, scale).unwrap())
            .collect();
        let sum: Money<Jpy> = items.iter().sum();
        let expected = money_reference::sum(&items);
        prop_assert!(sum.identical(&expected), "{sum:?} != {expected:?}");
    }

    #[test]
    fn try_sum_matches_the_fold(items in vec(any_money(), 0..30), eur_or_jpy in any::<bool>()) {
        let currency = code(if eur_or_jpy { "EUR" } else { "JPY" });
        same(&AnyMoney::try_sum(&items, currency), &any_reference::try_sum(&items, currency))?;
        // the same items all in the currency: the sums themselves, not only the first mismatch
        let only: Vec<AnyMoney> = items
            .iter()
            .map(|item| AnyMoney::from_units(item.units().clone(), item.scale(), currency).unwrap())
            .collect();
        same(&AnyMoney::try_sum(&only, currency), &any_reference::try_sum(&only, currency))?;
    }

    #[test]
    fn add_and_sub_match_the_general_path(a in eur(), b in eur()) {
        let (sum, expected) = (&a + &b, money_reference::add(&a, &b));
        prop_assert!(sum.identical(&expected), "{sum:?} != {expected:?}");
        prop_assert_eq!(sum.units().to_i128(), expected.units().to_i128());
        let owned = a.clone() + b.clone();
        prop_assert!(owned.identical(&expected));
        let (difference, expected) = (&a - &b, money_reference::sub(&a, &b));
        prop_assert!(difference.identical(&expected), "{difference:?} != {expected:?}");
        prop_assert_eq!(difference.units().to_i128(), expected.units().to_i128());
    }

    #[test]
    fn checked_add_and_sub_match_the_general_path(a in any_money(), b in any_money()) {
        same(&a.checked_add(&b), &any_reference::checked_add(&a, &b))?;
        same(&a.checked_sub(&b), &any_reference::checked_sub(&a, &b))?;
    }

    #[test]
    fn int_sum_matches_the_fold(items in vec(units(), 0..40)) {
        let expected = int_reference::sum(&items);
        prop_assert_eq!(items.iter().sum::<Int>(), expected.clone());
        prop_assert_eq!(items.iter().cloned().sum::<Int>(), expected.clone());
        prop_assert_eq!(items.iter().sum::<Int>().to_i128(), expected.to_i128());
    }

    #[test]
    fn fixed_sum_matches_the_fold(items in vec(fixed(), 0..40)) {
        let expected = fixed_reference::sum(&items);
        let sum: Fixed = items.iter().sum();
        let owned: Fixed = items.iter().cloned().sum();
        prop_assert!(sum.identical(&expected), "{sum:?} != {expected:?}");
        prop_assert!(owned.identical(&expected), "{owned:?} != {expected:?}");
    }

    #[test]
    fn sum_by_currency_matches_the_fold(items in vec(any_money(), 0..30)) {
        let actual = sum_by_currency(items.clone()).unwrap();
        let expected = bag_reference::sum_by_currency(items).unwrap();
        prop_assert_eq!(actual.len(), expected.len());
        for (actual, expected) in actual.iter().zip(&expected) {
            prop_assert_eq!(actual.currency(), expected.currency());
            prop_assert!(actual.identical(expected), "{actual:?} != {expected:?}");
        }
    }

    #[test]
    fn average_matches_the_fold(items in vec(eur(), 0..20), mode in rounding()) {
        let actual = Money::average(&items, mode);
        let expected = math_reference::average(&items, mode);
        match (&actual, &expected) {
            (Ok(actual), Ok(expected)) => {
                prop_assert!(actual.identical(expected), "{actual:?} != {expected:?}");
            }
            _ => prop_assert_eq!(actual, expected),
        }
    }
}

fn eur_units(units: impl Into<Int>, scale: u16) -> Money<Eur> {
    Money::from_units(units, scale).unwrap()
}

#[test]
fn an_empty_sum_is_zero_at_the_exponent() {
    let none: [Money<Eur>; 0] = [];
    let sum: Money<Eur> = none.iter().sum();
    assert!(sum.identical(&Money::zero()));
    assert_eq!(sum.scale(), 2);
    let jpy: Money<Jpy> = core::iter::empty::<Money<Jpy>>().sum();
    assert_eq!(jpy.scale(), 0);
    let any = AnyMoney::try_sum([], code("KWD")).unwrap();
    assert!(any.identical(&AnyMoney::zero(code("KWD"))));
    assert_eq!(any.scale(), 3);
    assert!(
        core::iter::empty::<Fixed>()
            .sum::<Fixed>()
            .identical(&Fixed::ZERO)
    );
    assert_eq!(core::iter::empty::<Int>().sum::<Int>(), Int::ZERO);
    assert!(sum_by_currency([]).unwrap().is_empty());
}

#[test]
fn a_single_item_keeps_its_value_at_the_exponent_or_above() {
    // below the exponent: the sum starts at 2, so 5 at scale 0 is 5.00
    let sum: Money<Eur> = [eur_units(5, 0)].iter().sum();
    assert!(sum.identical(&eur_units(500, 2)));
    let sum: Money<Eur> = [eur_units(12_345, 4)].iter().sum();
    assert!(sum.identical(&eur_units(12_345, 4)));
    let big = &max() * &max();
    let sum: Money<Eur> = [eur_units(big.clone(), 2)].iter().sum();
    assert!(sum.identical(&eur_units(big.clone(), 2)));
    // sum_by_currency and Fixed start from the item (or 0), not the exponent
    let item = AnyMoney::from_units(5, 0, code("EUR")).unwrap();
    assert!(sum_by_currency([item.clone()]).unwrap()[0].identical(&item));
    let five = Fixed::new(5, 0).unwrap();
    assert!([five.clone()].iter().sum::<Fixed>().identical(&five));
}

#[test]
fn all_zeros_sum_to_zero_at_the_largest_scale() {
    let zeros = [eur_units(0, 0), eur_units(0, 5), eur_units(0, 3)];
    let sum: Money<Eur> = zeros.iter().sum();
    assert!(sum.identical(&eur_units(0, 5)));
    assert!(sum.identical(&money_reference::sum(&zeros)));
    let low = [eur_units(0, 0), eur_units(0, 1)];
    assert!(low.iter().sum::<Money<Eur>>().identical(&Money::zero()));
}

#[test]
fn an_overflow_in_the_middle_comes_back_inline() {
    let (top, bottom) = (eur_units(i128::MAX, 2), eur_units(-i128::MAX, 2));
    let items = [
        top.clone(),
        top.clone(),
        eur_units(1, 2),
        bottom.clone(),
        bottom.clone(),
    ];
    let sum: Money<Eur> = items.iter().sum();
    assert!(sum.identical(&eur_units(1, 2)));
    assert_eq!(sum.units().to_i128(), Some(1));
    assert!(sum.identical(&money_reference::sum(&items)));
    // the same with a rescale past i128 in the middle: i128::MAX at scale 2, then scale 4
    let items = [
        top.clone(),
        eur_units(0, 4),
        bottom.clone(),
        eur_units(7, 4),
    ];
    let sum: Money<Eur> = items.iter().sum();
    assert!(sum.identical(&eur_units(7, 4)));
    assert_eq!(sum.units().to_i128(), Some(7));
    // and down past i128::MIN
    let items = [eur_units(i128::MIN, 2), eur_units(-1, 2), eur_units(1, 2)];
    let sum: Money<Eur> = items.iter().sum();
    assert_eq!(sum.units().to_i128(), Some(i128::MIN));
    let ints = [Int::from(i128::MAX), Int::from(1), Int::from(-2)];
    assert_eq!(ints.iter().sum::<Int>(), Int::from(i128::MAX - 1));
    assert_eq!(ints.iter().sum::<Int>().to_i128(), Some(i128::MAX - 1));
    // add itself: overflow to the heap, and back with sub
    let past = &top + &eur_units(1, 2);
    assert_eq!(past.units().to_i128(), None);
    assert_eq!(
        (&past - &eur_units(1, 2)).units().to_i128(),
        Some(i128::MAX)
    );
}

#[test]
fn try_sum_stops_at_the_first_mismatch() {
    let eur = code("EUR");
    let items = [
        AnyMoney::from_units(i128::MAX, 2, eur).unwrap(),
        AnyMoney::from_units(i128::MAX, 2, eur).unwrap(),
        AnyMoney::from_units(1, 0, code("USD")).unwrap(),
        AnyMoney::from_units(1, 0, code("JPY")).unwrap(),
    ];
    let expected = Err(Error::CurrencyMismatch {
        expected: eur,
        actual: code("USD"),
    });
    assert_eq!(AnyMoney::try_sum(&items, eur), expected);
    assert_eq!(any_reference::try_sum(&items, eur), expected);
    // the first item already mismatches: the error names it, whatever follows
    assert_eq!(
        AnyMoney::try_sum(&items[2..], eur),
        Err(Error::CurrencyMismatch {
            expected: eur,
            actual: code("USD"),
        })
    );
}
