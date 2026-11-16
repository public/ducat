//! `ScaledMinorColumn` and `scaled_minor_units` without a database: ducat's `moneyMinor` with a
//! scale column (ducat#380), with the values of ducat's test/db/drizzle.test.ts (`SCALED_EUROS`)
//! and test/sql.test.ts (`readScale`).

use ducat::iso::{Eur, Jpy, Kwd};
use ducat::{AnyMoney, Money, Rounding};
use ducat_sqlx::{Error, ScaledMinorColumn, scaled_minor_units};

use crate::common::iso;

/// ducat's `SCALED_EUROS`: above, at and below EUR's exponent, and BIGINT's limits.
pub const SCALED_EUROS: [(&str, u16, i64); 7] = [
    ("1.005", 3, 1005),
    ("0.000000000000000001", 18, 1),
    ("12.34", 2, 1234),
    ("-92233720368547758.08", 2, i64::MIN),
    ("12", 0, 12),
    ("-0.1", 1, -1),
    ("9223372036.854775807", 9, i64::MAX),
];

pub fn euros(amount: &str, scale: u16) -> Money<Eur> {
    Money::parse_at(amount, scale, Rounding::Unnecessary).unwrap()
}

#[test]
fn units_and_scale_at_the_money_s_own_scale() {
    for (amount, scale, units) in SCALED_EUROS {
        let money = euros(amount, scale);
        let column = ScaledMinorColumn(money.clone());
        let stored = (units, i16::try_from(scale).unwrap());
        assert_eq!(column.to_columns(), Ok(stored), "{amount}");
        assert_eq!(scaled_minor_units(&money), Ok(stored));
        let read = ScaledMinorColumn::<Eur>::from_columns(units, Some(i64::from(scale))).unwrap();
        // the scale is kept: 12 EUR at scale 0 reads back at scale 0, not as 12.00
        assert!(read.0.identical(&money), "{amount}");
        assert_eq!(Money::from(read), money);
    }
}

#[test]
fn a_stored_scale_pairs_with_units_at_that_scale() {
    // ducat's test/sql.test.ts: minorFromDriver('1005', 'EUR', 3) and ('12', 'EUR', 0)
    let read = ScaledMinorColumn::<Eur>::from_columns(1005, Some(3)).unwrap();
    assert_eq!(read.0.to_string(), "1.005 EUR");
    let read = ScaledMinorColumn::<Eur>::from_columns(12, Some(0)).unwrap();
    assert_eq!(read.0.to_string(), "12 EUR");
    // any money, the other ends of the exponent range
    let dinars = AnyMoney::parse_at("1.2", iso("KWD"), 1, Rounding::Unnecessary).unwrap();
    assert_eq!(scaled_minor_units(&dinars), Ok((12, 1)));
    let yen = Money::<Jpy>::parse_at("1.5", 1, Rounding::Unnecessary).unwrap();
    assert_eq!(ScaledMinorColumn(yen).to_columns(), Ok((15, 1)));
    let read = ScaledMinorColumn::<Kwd>::from_columns(12_345, Some(4)).unwrap();
    assert_eq!(read.0.to_string(), "1.2345 KWD");
    let read = ScaledMinorColumn::<Eur>::from_columns(1, Some(1000)).unwrap();
    assert_eq!(read.0.scale(), 1000);
}

#[test]
fn refuses_units_beyond_bigint() {
    let beyond = euros("9223372036.854775808", 9);
    assert_eq!(
        ScaledMinorColumn(beyond).to_columns(),
        Err(Error::OutOfRange)
    );
    let below = euros("-92233720368547758.09", 2);
    assert_eq!(scaled_minor_units(&below), Err(Error::OutOfRange));
}

#[test]
fn refuses_a_null_negative_or_too_large_scale() {
    // ducat's readScale: NULL, -1, 1001; i64's ends too
    for scale in [None, Some(-1), Some(1001), Some(i64::MIN), Some(i64::MAX)] {
        assert_eq!(
            ScaledMinorColumn::<Eur>::from_columns(5, scale),
            Err(Error::InvalidScaleColumn(scale)),
            "{scale:?}"
        );
    }
    assert_eq!(
        Error::InvalidScaleColumn(None).to_string(),
        "expected an integer scale from 0 to 1000 in the scale column, got NULL"
    );
    assert_eq!(
        Error::InvalidScaleColumn(Some(1001)).to_string(),
        "expected an integer scale from 0 to 1000 in the scale column, got 1001"
    );
}

#[test]
fn a_null_amount_is_none_whatever_the_scale() {
    // ducat's scaledMoney: `case when amount is null then null else …`
    for scale in [None, Some(2), Some(-1)] {
        assert_eq!(
            ScaledMinorColumn::<Eur>::from_nullable_columns(None, scale),
            Ok(None)
        );
    }
    assert_eq!(
        ScaledMinorColumn::<Eur>::from_nullable_columns(Some(5), None),
        Err(Error::InvalidScaleColumn(None))
    );
    let read = ScaledMinorColumn::<Eur>::from_nullable_columns(Some(1005), Some(3)).unwrap();
    assert_eq!(read, Some(ScaledMinorColumn(euros("1.005", 3))));
}
