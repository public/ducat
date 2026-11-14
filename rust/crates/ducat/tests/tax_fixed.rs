//! Tax and `Fixed`: ducat's documented examples, and the invariants the spec vectors don't spell
//! out (net + tax = gross, exact scales, value equality).

use std::collections::HashSet;

use ducat::fixed::Fixed;
use ducat::iso::{Eur, Gbp};
use ducat::{Error, Int, Money, Rounding};
use proptest::prelude::*;

fn eur(text: &str) -> Money<Eur> {
    text.parse().unwrap()
}

fn fixed(text: &str) -> Fixed {
    text.parse().unwrap()
}

#[test]
fn tax_examples() {
    assert_eq!(
        eur("80")
            .percentage("12.5", Rounding::HalfEven)
            .unwrap()
            .to_decimal(),
        "10.00"
    );
    let added = eur("10").add_tax("20", Rounding::HalfEven).unwrap();
    assert_eq!(
        (
            added.net.to_decimal(),
            added.tax.to_decimal(),
            added.gross.to_decimal()
        ),
        ("10.00".into(), "2.00".into(), "12.00".into())
    );
    let extracted = eur("12").extract_tax("20", Rounding::HalfEven).unwrap();
    assert_eq!(
        (extracted.net.to_decimal(), extracted.tax.to_decimal()),
        ("10.00".into(), "2.00".into())
    );
    let vat = "9.99"
        .parse::<Money<Gbp>>()
        .unwrap()
        .extract_tax(20, Rounding::HalfEven)
        .unwrap();
    assert_eq!(
        (vat.net.to_decimal(), vat.tax.to_decimal()),
        ("8.32".into(), "1.67".into())
    );
    assert_eq!(
        eur("100")
            .discount("15", Rounding::HalfEven)
            .unwrap()
            .to_decimal(),
        "85.00"
    );
    assert_eq!(
        eur("1").extract_tax("-100", Rounding::HalfEven),
        Err(Error::InvalidPercent)
    );
    assert_eq!(
        eur("1").extract_tax("-150", Rounding::HalfEven),
        Err(Error::InvalidPercent)
    );
    assert_eq!(
        eur("1").percentage("12.5", Rounding::Unnecessary),
        Err(Error::Rounding)
    );
    let any = eur("10")
        .to_any()
        .add_tax("7.5", Rounding::HalfExpand)
        .unwrap();
    assert_eq!(any.gross.to_string(), "10.75 EUR");
}

#[test]
fn fixed_examples() {
    assert_eq!(fixed("12.340").scale(), 3);
    assert_eq!(
        Fixed::parse_at("1.005", 2, Rounding::HalfEven)
            .unwrap()
            .to_string(),
        "1.00"
    );
    assert_eq!(Fixed::from_f64(0.1 + 0.2), Err(Error::TooManyDigits));
    assert_eq!(Fixed::new(12345, 3).unwrap().to_string(), "12.345");
    assert_eq!(eur("12.34").to_fixed().to_string(), "12.34");
    assert_eq!(
        fixed("1.005")
            .to_money::<Eur>(Rounding::HalfEven)
            .unwrap()
            .to_string(),
        "1.00 EUR"
    );
    assert_eq!(
        fixed("1.005").to_money::<Eur>(Rounding::Unnecessary),
        Err(Error::Rounding)
    );
    assert_eq!(
        fixed("0.0425")
            .multiply(1200, Rounding::Unnecessary)
            .unwrap()
            .to_string(),
        "51.0000"
    );
    assert_eq!(
        fixed("100.00")
            .divide(3, Rounding::HalfEven)
            .unwrap()
            .to_string(),
        "33.33"
    );
    assert_eq!(
        fixed("9.990")
            .divide_at("1.2", 2, Rounding::HalfEven)
            .unwrap()
            .to_string(),
        "8.32"
    );
    assert_eq!((fixed("1.5") + fixed("0.25")).to_string(), "1.75");
    assert_eq!(
        fixed("2.5")
            .to_scale(0, Rounding::HalfEven)
            .unwrap()
            .to_string(),
        "2"
    );
    assert_eq!(fixed("12.3400").trim_scale(0).to_string(), "12.34");
    assert_eq!(fixed("5.000").trim_scale(2).to_string(), "5.00");
    assert_eq!(fixed("5.1").trim_scale(3).to_string(), "5.1");
    assert_eq!(fixed("1.5e3").to_string(), "1500");
    assert_eq!(fixed("0.0725").to_ratio().to_string(), "29/400");
    assert_eq!(
        eur("199.99")
            .multiply(fixed("0.0725"), Rounding::HalfEven)
            .unwrap()
            .to_decimal(),
        "14.50"
    );
    assert_eq!(
        serde_json::to_string(&fixed("0.0425")).unwrap(),
        r#""0.0425""#
    );
    assert_eq!(
        serde_json::from_str::<Fixed>(r#""12.340""#)
            .unwrap()
            .scale(),
        3
    );
    assert!(serde_json::from_str::<Fixed>("12.34").is_err());
    assert_eq!(fixed("1.10"), fixed("1.1"));
    assert!(!fixed("1.10").identical(&fixed("1.1")));
    let set: HashSet<Fixed> = [fixed("1.10"), fixed("1.1"), fixed("1.100")]
        .into_iter()
        .collect();
    assert_eq!(set.len(), 1);
    let huge = Fixed::from(Int::from(i128::MAX)) + Fixed::from(1);
    assert_eq!(huge.to_string(), "170141183460469231731687303715884105728");
}

proptest! {
    /// net + tax is exactly gross, in both directions, for every mode.
    #[test]
    fn tax_adds_up(minor in any::<i64>(), percent in 0u32..100_000, mode in 0usize..9) {
        let mode = Rounding::ALL[mode];
        let money = Money::<Eur>::from_minor(minor);
        let percent = format!("{}.{:03}", percent / 1000, percent % 1000);
        let added = money.add_tax(percent.as_str(), mode).unwrap();
        prop_assert!((&added.net + &added.tax).identical(&added.gross));
        let extracted = money.extract_tax(percent.as_str(), mode).unwrap();
        prop_assert!((&extracted.net + &extracted.tax).identical(&extracted.gross));
        prop_assert!(extracted.gross.identical(&money));
    }

    /// Fixed's Display is exact and re-parses at the same scale.
    #[test]
    fn fixed_round_trips(units in any::<i128>(), scale in 0u16..50) {
        let value = Fixed::new(units, scale).unwrap();
        prop_assert!(value.to_string().parse::<Fixed>().unwrap().identical(&value));
    }
}
