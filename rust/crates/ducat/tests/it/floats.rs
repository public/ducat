//! Floats out: `to_f64` and `to_minor_f64` against the bits ducat's TypeScript gives under Node
//! (`floats_table.rs`, from scripts/gen-rust-float-table.mjs).
//!
//! The conversions are disallowed inside the workspace by `rust/clippy.toml`; these tests are the
//! one place that calls them.
#![allow(clippy::disallowed_methods)]

use ducat::fixed::Fixed;
use ducat::iso::{Eur, Jpy};
use ducat::{AnyMoney, CurrencyCode, Error, Int, Money, Ratio, ToMinorF64Options};
use proptest::prelude::*;

#[rustfmt::skip]
#[path = "floats_table.rs"]
mod table;

fn int(text: &str) -> Int {
    text.parse().unwrap()
}

#[test]
fn to_f64_matches_ducat_bit_for_bit() {
    for &(units, scale, bits) in table::DECIMALS {
        let money = Money::<Eur>::from_units(int(units), scale).unwrap();
        let any =
            AnyMoney::from_units(int(units), scale, CurrencyCode::iso("EUR").unwrap()).unwrap();
        let fixed = Fixed::new(int(units), scale).unwrap();
        for value in [money.to_f64(), any.to_f64(), fixed.to_f64()] {
            assert_eq!(value.to_bits(), bits, "{units}e-{scale}: {value:e}");
        }
    }
}

#[test]
fn to_minor_f64_matches_ducat_bit_for_bit() {
    for &(code, units, scale, lossy, expected) in table::MINOR {
        let money =
            AnyMoney::from_units(int(units), scale, CurrencyCode::iso(code).unwrap()).unwrap();
        let expected = expected.map_err(|name| match name {
            "RoundingError" => Error::Rounding,
            "RangeError" => Error::Overflow,
            other => panic!("no Error for {other}"),
        });
        let options = ToMinorF64Options { lossy };
        let value = money.to_minor_f64(options).map(f64::to_bits);
        assert_eq!(value, expected, "{units}e-{scale} {code}, lossy {lossy}");
        if code == "EUR" {
            let typed = Money::<Eur>::from_units(int(units), scale).unwrap();
            assert_eq!(typed.to_minor_f64(options).map(f64::to_bits), expected);
        }
    }
}

#[test]
fn exact_to_f64_matches_ducat_bit_for_bit() {
    let one = Money::<Eur>::from_units(1, 0).unwrap().exact();
    for &(num, den, bits) in table::EXACT {
        let value = one
            .multiply(Ratio::new(int(num), int(den)).unwrap())
            .unwrap();
        assert_eq!(value.to_f64().to_bits(), bits, "{num}/{den}");
        assert_eq!(value.to_any().to_f64().to_bits(), bits, "{num}/{den}");
    }
}

#[test]
fn defaults_and_errors() {
    // ducat's default is lossy: false
    assert!(!ToMinorF64Options::default().lossy);
    let yen: Money<Jpy> = "1000".parse().unwrap();
    assert_eq!(yen.to_minor_f64(ToMinorF64Options::default()), Ok(1000.0));
    // digits below the minor unit come first, even with lossy
    let fine = Money::<Eur>::from_units(Int::from(1u8), 1000).unwrap();
    let lossy = ToMinorF64Options { lossy: true };
    assert_eq!(fine.to_minor_f64(lossy), Err(Error::Rounding));
    // a zero amount has no sign: +0.0 at any scale, and -0.0 only from a negative amount below
    // the smallest subnormal
    let zero = Money::<Eur>::from_units(0, 5).unwrap();
    assert_eq!(zero.to_f64().to_bits(), 0);
    assert_eq!((-&zero).to_f64().to_bits(), 0);
    assert_eq!(zero.exact().to_f64().to_bits(), 0);
}

proptest! {
    /// The binary algorithm of `ExactMoney::to_f64` and the decimal parse of `Money::to_f64`
    /// agree wherever both are correctly rounded (the normal range of doubles).
    #[test]
    fn exact_and_decimal_agree(units in any::<i128>(), scale in 0u16..=40) {
        let money = Money::<Eur>::from_units(units, scale).unwrap();
        prop_assert_eq!(money.exact().to_f64().to_bits(), money.to_f64().to_bits());
    }

    /// For safe integers, as ducat's own fast path: one IEEE division of exact operands, which is
    /// correctly rounded.
    #[test]
    fn exact_matches_division_of_safe_integers(
        num in -(1i64 << 53) + 1..1i64 << 53,
        den in 1i64..1i64 << 53,
    ) {
        let one = Money::<Eur>::from_units(1, 0).unwrap().exact();
        let value = one.multiply(Ratio::new(num, den).unwrap()).unwrap();
        #[allow(clippy::cast_precision_loss)] // both are below 2^53, so exact
        let expected = num as f64 / den as f64;
        prop_assert_eq!(value.to_f64().to_bits(), expected.to_bits());
    }
}
