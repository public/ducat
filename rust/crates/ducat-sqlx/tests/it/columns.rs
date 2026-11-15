//! The fixed-currency column shapes and `minor_units`, without a database.

use ducat::define_currency;
use ducat::iso::{Eur, Jpy, Kwd};
use ducat::{AnyMoney, Money, Rounding};
use ducat_sqlx::{Decimal, DecimalColumn, Error, MinorColumn, minor_units};

use crate::common::{decimal, iso};

define_currency! {
    /// A custom currency with four decimals.
    pub Credit = "CREDIT", 4
}

#[test]
fn minor_units_at_the_exponent_only() {
    // ducat's minorToDriver
    let price: Money<Eur> = "12.34".parse().unwrap();
    assert_eq!(minor_units(&price), Ok(1234));
    assert_eq!(MinorColumn(price.clone()).minor_units(), Ok(1234));
    let fine = price.to_scale(3, Rounding::Unnecessary).unwrap();
    assert_eq!(
        minor_units(&fine),
        Err(Error::ScaleMismatch {
            scale: 3,
            expected: 2
        })
    );
    // BIGINT's limits, and one beyond each
    let max: Money<Eur> = "92233720368547758.07".parse().unwrap();
    assert_eq!(minor_units(&max), Ok(i64::MAX));
    let min: Money<Eur> = "-92233720368547758.08".parse().unwrap();
    assert_eq!(minor_units(&min), Ok(i64::MIN));
    let beyond: Money<Eur> = "92233720368547758.08".parse().unwrap();
    assert_eq!(minor_units(&beyond), Err(Error::OutOfRange));
    let below: Money<Eur> = "-92233720368547758.09".parse().unwrap();
    assert_eq!(minor_units(&below), Err(Error::OutOfRange));
    // any money, and a custom currency's exponent
    let dinars = AnyMoney::parse("1.234", iso("KWD")).unwrap();
    assert_eq!(minor_units(&dinars), Ok(1234));
    let credits: Money<Credit> = "1.5".parse().unwrap();
    assert_eq!(minor_units(&credits), Ok(15_000));
}

#[test]
fn minor_columns_read_at_the_exponent() {
    let yen = MinorColumn::<Jpy>::from_minor_units(1000);
    assert_eq!(yen.0.to_string(), "1000 JPY");
    let dinars = MinorColumn::<Kwd>::from_minor_units(-1);
    assert_eq!(dinars.0.to_string(), "-0.001 KWD");
    assert_eq!(
        Money::from(MinorColumn::<Eur>::from_minor_units(5)),
        Money::from_minor(5)
    );
}

#[test]
fn decimal_columns_store_the_exponent_and_read_trailing_zeros() {
    // ducat's decimalToDriver and decimalFromDriver
    let price: Money<Eur> = "12.34".parse().unwrap();
    assert_eq!(
        DecimalColumn(price.clone()).to_decimal(),
        Ok(decimal("12.34"))
    );
    let fine = price.to_scale(4, Rounding::Unnecessary).unwrap();
    assert!(matches!(
        DecimalColumn(fine).to_decimal(),
        Err(Error::ScaleMismatch { scale: 4, .. })
    ));
    let read = DecimalColumn::<Eur>::from_decimal(&decimal("12.3400")).unwrap();
    assert!(read.0.identical(&price));
    assert_eq!(
        DecimalColumn::<Eur>::from_decimal(&decimal("12.345")),
        Err(Error::Ducat(ducat::Error::Rounding))
    );
    let credits = DecimalColumn::<Credit>::from_decimal(&decimal("2")).unwrap();
    assert_eq!(credits.0.scale(), 4);
    assert_eq!(Decimal::from_money(&credits.0).to_string(), "2.0000");
}
