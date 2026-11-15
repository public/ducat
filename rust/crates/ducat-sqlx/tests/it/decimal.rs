//! `Decimal`'s text, its money conversions, and `DecimalColumnSize::fit` (ducat's `toNumeric`).

use ducat::testing::proptest::prelude::*;
use ducat::{AnyMoney, Rounding};
use ducat_sqlx::{DEFAULT_DECIMAL_SIZE, Decimal, DecimalColumnSize, Error};

use crate::common::{decimal, int, iso};

#[test]
fn text_is_numeric_text() {
    for (text, units, scale) in [
        ("0", "0", 0),
        ("0.00", "0", 2),
        ("12.3400", "123400", 4),
        ("-0.000000000000000000000001", "-1", 24),
        ("-12", "-12", 0),
        ("007.50", "750", 2),
        ("92233720368547758.07", "9223372036854775807", 2),
    ] {
        let value = decimal(text);
        assert_eq!(
            (value.units(), value.scale()),
            (&int(units), scale),
            "{text}"
        );
    }
    // printed at the scale, without the leading zeros; negative zero is zero
    assert_eq!(decimal("007.50").to_string(), "7.50");
    assert_eq!(decimal("-0.00").to_string(), "0.00");
    assert_eq!(decimal("-0.50").to_string(), "-0.50");
    assert_eq!(Decimal::new(5, 3).unwrap().to_string(), "0.005");
    assert_eq!(Decimal::new(-5, 0).unwrap().to_string(), "-5");
}

#[test]
fn text_refuses_what_parse_numeric_refuses() {
    // ducat's parseNumeric: NaN and Infinity throw, and so does anything outside -?\d+(\.\d+)?
    assert_eq!("NaN".parse::<Decimal>(), Err(Error::NotANumber));
    assert_eq!(
        "Infinity".parse::<Decimal>(),
        Err(Error::Infinite { negative: false })
    );
    assert_eq!(
        "-Infinity".parse::<Decimal>(),
        Err(Error::Infinite { negative: true })
    );
    for text in [
        "", "1.", ".5", "+1", "1e3", "1E3", " 1", "1 ", "1,000", "1_000", "--1", "-", "-.5",
        "0x10", "١",
    ] {
        assert!(
            matches!(text.parse::<Decimal>(), Err(Error::Malformed(_))),
            "{text:?}"
        );
    }
    let too_many = format!("0.{}", "1".repeat(1001));
    assert_eq!(
        too_many.parse::<Decimal>(),
        Err(Error::Ducat(ducat::Error::InvalidScale))
    );
    assert!(format!("0.{}", "1".repeat(1000)).parse::<Decimal>().is_ok());
    assert_eq!(
        Decimal::new(1, 1001),
        Err(Error::Ducat(ducat::Error::InvalidScale))
    );
}

#[test]
fn money_keeps_the_scale_but_not_below_the_exponent() {
    // ducat's parseMoneyComposite: (12,EUR) is 12.00 EUR, (1.5000,EUR) is 1.5000 EUR
    let eur = iso("EUR");
    let twelve = decimal("12").to_money(eur).unwrap();
    assert_eq!(
        (twelve.to_string().as_str(), twelve.scale()),
        ("12.00 EUR", 2)
    );
    let precise = decimal("1.5000").to_money(eur).unwrap();
    assert_eq!(
        (precise.to_string().as_str(), precise.scale()),
        ("1.5000 EUR", 4)
    );
    let yen = decimal("5").to_money(iso("JPY")).unwrap();
    assert_eq!(yen.to_string(), "5 JPY");
}

#[test]
fn money_at_the_exponent_takes_trailing_zeros_only() {
    // ducat's decimalFromDriver: parseMoney at the currency's exponent, without rounding
    let eur = iso("EUR");
    let price = decimal("12.3400").to_money_at_exponent(eur).unwrap();
    assert!(price.identical(&AnyMoney::parse("12.34", eur).unwrap()));
    let whole = decimal("12").to_money_at_exponent(eur).unwrap();
    assert_eq!(whole.scale(), 2);
    assert_eq!(
        decimal("12.345").to_money_at_exponent(eur),
        Err(Error::Ducat(ducat::Error::Rounding))
    );
    assert_eq!(
        decimal("1.5").to_money_at_exponent(iso("JPY")),
        Err(Error::Ducat(ducat::Error::Rounding))
    );
}

#[test]
fn column_sizes() {
    assert_eq!(DEFAULT_DECIMAL_SIZE, DecimalColumnSize::new(19, 4).unwrap());
    assert_eq!(DEFAULT_DECIMAL_SIZE.to_string(), "NUMERIC(19,4)");
    for (precision, scale) in [(0, 0), (2, 3), (0, 1)] {
        assert!(matches!(
            DecimalColumnSize::new(precision, scale),
            Err(Error::InvalidColumnSize(_))
        ));
    }
    assert!(DecimalColumnSize::new(4, 4).is_ok());
    let two = DecimalColumnSize::new(19, 2).unwrap();
    assert!(two.check_currency(iso("EUR")).is_ok());
    assert!(matches!(
        two.check_currency(iso("KWD")),
        Err(Error::ColumnScaleBelowExponent { exponent: 3, .. })
    ));
}

fn eur(text: &str, scale: u16) -> AnyMoney {
    AnyMoney::parse_at(text, iso("EUR"), scale, Rounding::Unnecessary).unwrap()
}

#[test]
fn fit_drops_only_trailing_zeros_beyond_the_column_scale() {
    // the cases of ducat's toNumeric tests
    let size = DEFAULT_DECIMAL_SIZE;
    assert_eq!(size.fit(&eur("1.230000", 6)).unwrap().to_string(), "1.2300");
    let small = DecimalColumnSize::new(3, 2).unwrap();
    assert_eq!(small.fit(&eur("5.00", 2)).unwrap().to_string(), "5.00");
    let fraction = DecimalColumnSize::new(4, 4).unwrap();
    assert_eq!(fraction.fit(&eur("0.12", 2)).unwrap().to_string(), "0.12");
    assert!(matches!(
        size.fit(&eur("1.23456", 5)),
        Err(Error::WouldRound { decimals: 5, .. })
    ));
    let kwd = AnyMoney::parse("1", iso("KWD")).unwrap();
    assert!(matches!(
        DecimalColumnSize::new(19, 2).unwrap().fit(&kwd),
        Err(Error::ColumnScaleBelowExponent { .. })
    ));
    // 15 integer digits fit NUMERIC(19,4), 16 don't (pg-types.test.ts)
    assert_eq!(
        size.fit(&eur("123456789012345.6789", 4))
            .unwrap()
            .to_string(),
        "123456789012345.6789"
    );
    assert!(matches!(
        size.fit(&eur("1000000000000000", 2)),
        Err(Error::TooManyIntegerDigits { .. })
    ));
    assert!(matches!(
        size.fit(&eur("-1000000000000000", 2)),
        Err(Error::TooManyIntegerDigits { .. })
    ));
    assert_eq!(size.fit(&eur("-0.01", 2)).unwrap().to_string(), "-0.01");
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2000))]

    /// ducat's toNumeric property: every value the column holds unchanged passes, and nothing
    /// it would round or reject.
    #[test]
    fn fit_passes_exactly_what_the_column_holds(
        minor in -(10_i128.pow(21))..=10_i128.pow(21),
        scale in 2_u16..=8,
    ) {
        let amount = AnyMoney::from_units(minor, scale, iso("EUR")).unwrap();
        // an independent model in integers: the value times 10^4 must be whole, and below 10^15
        let scaled_up = minor * 10_000;
        let divisor = 10_i128.pow(u32::from(scale));
        let fits = scaled_up % divisor == 0 && minor.abs() < 10_i128.pow(15 + u32::from(scale));
        match DEFAULT_DECIMAL_SIZE.fit(&amount) {
            Ok(stored) => {
                prop_assert!(fits);
                prop_assert!(stored.scale() <= 4);
                // the stored text means the same amount
                let back = stored.to_money(iso("EUR")).unwrap();
                prop_assert!(back.eq_value(&amount));
            }
            Err(error) => {
                prop_assert!(!fits);
                prop_assert!(
                    matches!(error, Error::WouldRound { .. } | Error::TooManyIntegerDigits { .. }),
                    "{error:?}"
                );
            }
        }
    }

    #[test]
    fn arbitrary_text_never_panics(text in "[-+.0-9eEaINnfity ]{0,24}") {
        if let Ok(value) = text.parse::<Decimal>() {
            // what parses prints back as itself, less leading zeros and a negative zero's sign
            prop_assert_eq!(value.to_string().parse::<Decimal>(), Ok(value));
        }
    }
}
