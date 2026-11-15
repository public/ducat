//! `ExactMoney` and `AnyExactMoney`: the sign predicates and the refusal of JSON, each case
//! checked against ducat's built TypeScript under Node (`ExactMoney#isZero`, `#isPositive`,
//! `#isNegative`, and `JSON.stringify`, which throws `TypeError: ExactMoney has no JSON form;
//! round() it to Money first`).

use ducat::exact::{AnyExactMoney, ExactMoney};
use ducat::iso::{Eur, Jpy};
use ducat::{Currency, Money};

fn exact<C: Currency>(text: &str) -> ExactMoney<C> {
    text.parse::<Money<C>>().unwrap().exact()
}

/// (amount, `toString`, isZero, isPositive, isNegative), as ducat gives them.
fn cases() -> Vec<(ExactMoney<Eur>, &'static str, bool, bool, bool)> {
    let third = exact::<Eur>("1").divide(3).unwrap();
    let big = exact::<Eur>("18446744073709551616").divide(-3).unwrap();
    vec![
        (third.clone(), "1/3 EUR", false, true, false),
        (exact("-1").divide(3).unwrap(), "-1/3 EUR", false, false, true),
        (exact("0"), "0 EUR", true, false, false),
        // ducat's numerator is the number -0 here, and still zero
        (exact("0").multiply(-1).unwrap(), "0 EUR", true, false, false),
        (third.clone() - third, "0 EUR", true, false, false),
        (big.clone(), "-18446744073709551616/3 EUR", false, false, true),
        (-big, "18446744073709551616/3 EUR", false, true, false),
    ]
}

#[test]
fn sign_predicates_match_ducat() {
    for (value, text, zero, positive, negative) in cases() {
        assert_eq!(value.to_string(), text);
        let any: AnyExactMoney = value.to_any();
        for (is_zero, is_positive, is_negative) in [
            (value.is_zero(), value.is_positive(), value.is_negative()),
            (any.is_zero(), any.is_positive(), any.is_negative()),
        ] {
            assert_eq!((is_zero, is_positive, is_negative), (zero, positive, negative), "{text}");
        }
        assert_eq!(value.signum() == 0, zero, "{text}");
        assert_eq!(value.signum() > 0, positive, "{text}");
        assert_eq!(value.signum() < 0, negative, "{text}");
    }
    // below the currency's minor unit, still positive
    let tiny = exact::<Jpy>("1").divide(7000).unwrap();
    assert_eq!(tiny.to_string(), "1/7000 JPY");
    assert!(!tiny.is_zero() && tiny.is_positive() && !tiny.is_negative());
    let any = tiny.to_any();
    assert!(!any.is_zero() && any.is_positive() && !any.is_negative());
}

/// ducat's `ExactMoney#toJSON` always throws; here the impls are absent, so storing an exact
/// amount doesn't compile. An inherent const with a `Serialize` bound shadows the trait's
/// `false` only where the bound holds.
#[cfg(feature = "serde")]
mod no_json {
    use core::marker::PhantomData;

    use ducat::exact::{AnyExactMoney, ExactMoney};
    use ducat::iso::Eur;
    use ducat::{AnyMoney, Money};

    trait Fallback {
        const SERIALIZE: bool = false;
        const DESERIALIZE: bool = false;
    }

    struct Ser<T>(PhantomData<T>);
    impl<T> Fallback for Ser<T> {}
    impl<T: serde::Serialize> Ser<T> {
        const SERIALIZE: bool = true;
    }

    struct De<T>(PhantomData<T>);
    impl<T> Fallback for De<T> {}
    impl<T: serde::de::DeserializeOwned> De<T> {
        const DESERIALIZE: bool = true;
    }

    #[test]
    fn exact_money_has_no_serde_form() {
        assert!(!Ser::<ExactMoney<Eur>>::SERIALIZE);
        assert!(!Ser::<AnyExactMoney>::SERIALIZE);
        assert!(!De::<ExactMoney<Eur>>::DESERIALIZE);
        assert!(!De::<AnyExactMoney>::DESERIALIZE);
        // the probe sees the impls that are there: rounded money has its JSON form
        assert!(Ser::<Money<Eur>>::SERIALIZE && Ser::<AnyMoney>::SERIALIZE);
        assert!(De::<Money<Eur>>::DESERIALIZE && De::<AnyMoney>::DESERIALIZE);
    }
}
