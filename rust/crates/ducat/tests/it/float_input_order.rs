//! The order of the checks in `Money::from_f64_at` and `AnyMoney::from_f64_at`, as ducat's
//! `money(value, 'EUR', { scale, rounding })` for a number under Node: the scale
//! (`RangeError: Invalid scale`), then the value (`RangeError: Invalid amount`), then the
//! rounding (`RoundingError`); with a rounding given there is no 15-digit check.

use ducat::iso::Eur;
use ducat::{AnyMoney, CurrencyCode, Error, Money, Rounding};

/// Both entry points, which must agree: the decimal string, or the error.
fn at(value: f64, scale: u16, rounding: Rounding) -> Result<String, Error> {
    let typed = Money::<Eur>::from_f64_at(value, scale, rounding).map(|m| m.to_decimal());
    let code: CurrencyCode = "EUR".parse().unwrap();
    let any = AnyMoney::from_f64_at(value, code, scale, rounding).map(|m| m.to_decimal());
    assert_eq!(typed, any, "{value} at {scale}");
    typed
}

#[test]
fn bad_scale_and_non_finite_is_invalid_scale() {
    // money(NaN, 'EUR', { scale: 1001, rounding: 'halfEven' }): RangeError Invalid scale 1001
    assert_eq!(
        at(f64::NAN, 1001, Rounding::HalfEven),
        Err(Error::InvalidScale)
    );
    assert_eq!(
        at(f64::INFINITY, 1001, Rounding::Unnecessary),
        Err(Error::InvalidScale)
    );
    assert_eq!(
        at(f64::NEG_INFINITY, 1001, Rounding::HalfEven),
        Err(Error::InvalidScale)
    );
}

#[test]
fn good_scale_and_non_finite_is_not_finite() {
    // money(NaN, 'EUR', { scale: 2, rounding: 'halfEven' }): RangeError Invalid amount NaN
    assert_eq!(at(f64::NAN, 2, Rounding::HalfEven), Err(Error::NotFinite));
    assert_eq!(
        at(f64::INFINITY, 2, Rounding::Unnecessary),
        Err(Error::NotFinite)
    );
    assert_eq!(
        at(f64::NEG_INFINITY, 0, Rounding::HalfEven),
        Err(Error::NotFinite)
    );
}

#[test]
fn bad_scale_and_finite_is_invalid_scale() {
    // money(0.125, ...) and money(12, ...) at scale 1001, 'unnecessary': RangeError Invalid
    // scale, before the decimals (0.125) and on the safe-integer path (12)
    assert_eq!(
        at(0.125, 1001, Rounding::Unnecessary),
        Err(Error::InvalidScale)
    );
    assert_eq!(
        at(12.0, 1001, Rounding::Unnecessary),
        Err(Error::InvalidScale)
    );
}

#[test]
fn good_scale_and_too_many_decimals_is_rounding() {
    // money(0.125, 'EUR', { scale: 2, rounding: 'unnecessary' }): RoundingError, and the same
    // for 0.1 + 0.2; with 'halfEven' 0.125 is 0.12
    assert_eq!(at(0.125, 2, Rounding::Unnecessary), Err(Error::Rounding));
    assert_eq!(
        at(0.1 + 0.2, 2, Rounding::Unnecessary),
        Err(Error::Rounding)
    );
    assert_eq!(at(0.125, 2, Rounding::HalfEven), Ok("0.12".into()));
}

#[test]
fn a_rounding_given_skips_the_digits_check() {
    // money(0.1 + 0.2, 'EUR', { scale: 17, rounding: 'unnecessary' }) is 0.30000000000000004
    // EUR: 17 significant digits, but no RangeError once a rounding is given
    assert_eq!(
        at(0.1 + 0.2, 17, Rounding::Unnecessary),
        Ok("0.30000000000000004".into())
    );
    assert_eq!(
        at(1652185258.8058286, 20, Rounding::Unnecessary),
        Ok("1652185258.80582860000000000000".into())
    );
}

#[test]
fn max_scale_is_a_good_scale() {
    // money(1000, 'EUR', { scale: 1000, rounding: 'unnecessary' }) is 1000.000...0 EUR
    let decimal = at(1000.0, 1000, Rounding::Unnecessary).unwrap();
    assert_eq!(decimal.len(), "1000.".len() + 1000);
    assert_eq!(
        at(f64::NAN, 1000, Rounding::Unnecessary),
        Err(Error::NotFinite)
    );
}
