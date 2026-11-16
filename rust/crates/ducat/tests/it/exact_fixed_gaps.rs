//! The `ExactMoney` and `Fixed` gaps of parity piece 7: every method's success and each failure,
//! in ducat's check order. The expected values and error classes were read from the built
//! TypeScript under node (`dist/exact.js`, `dist/fixed.js`); each test names the ducat call.

use ducat::exact::{AnyExactMoney, ExactMoney};
use ducat::fixed::Fixed;
use ducat::iso::{Eur, Usd};
use ducat::{AnyMoney, CurrencyCode, Error, ErrorKind, Int, Money, Ratio, Rounding};

fn eur(text: &str) -> Money<Eur> {
    text.parse().unwrap()
}

fn code(text: &str) -> CurrencyCode {
    CurrencyCode::iso(text).unwrap()
}

fn any(text: &str, currency: &str) -> AnyMoney {
    AnyMoney::parse(text, code(currency)).unwrap()
}

fn any_exact(text: &str, currency: &str) -> AnyExactMoney {
    any(text, currency).exact()
}

/// exact(EUR 10).divide(3): 10/3 EUR.
fn third() -> ExactMoney<Eur> {
    eur("10").exact().divide(3).unwrap()
}

fn any_third() -> AnyExactMoney {
    any_exact("10", "EUR").divide(3).unwrap()
}

/// 2^exponent: 1/2^1001 needs 1001 decimal places.
fn two_pow(exponent: u32) -> Int {
    (0..exponent).fold(Int::ONE, |power, _| power * Int::from(2u8))
}

fn two_pow_1001() -> Int {
    two_pow(1001)
}

fn mismatch(expected: &str, actual: &str) -> Error {
    Error::CurrencyMismatch {
        expected: code(expected),
        actual: code(actual),
    }
}

#[test]
fn abs_negate_and_sign() {
    // third.negate().abs() is 10/3 EUR; third.negate() is -10/3 EUR; sign -1 and 0
    assert_eq!((-third()).abs().to_string(), "10/3 EUR");
    assert_eq!(third().abs(), third());
    assert_eq!((-third()).signum(), -1);
    assert_eq!(eur("0").exact().signum(), 0);

    let negative = -any_third();
    assert_eq!(negative.to_string(), "-10/3 EUR");
    assert_eq!((-&negative).to_string(), "10/3 EUR");
    assert_eq!(negative.abs().to_string(), "10/3 EUR");
    assert_eq!(negative.signum(), -1);
    assert_eq!(any_third().signum(), 1);
    assert_eq!(any_exact("0", "EUR").signum(), 0);
    assert_eq!((-any_exact("0", "EUR")).signum(), 0);
    assert_eq!(negative.currency(), code("EUR"));
}

#[test]
fn percentage() {
    // exact(EUR 10.01).percentage('7.7') is 77077/100000 EUR
    assert_eq!(
        eur("10.01").exact().percentage("7.7").unwrap().to_string(),
        "77077/100000 EUR"
    );
    let any = any_exact("10.01", "EUR").percentage("7.7").unwrap();
    assert_eq!(any.to_string(), "77077/100000 EUR");
    // percentage('abc') is a SyntaxError
    assert_eq!(
        any_exact("1", "EUR")
            .percentage("abc")
            .map_err(|e| e.kind()),
        Err(ErrorKind::Syntax)
    );
    assert_eq!(
        eur("1").exact().percentage("abc").map_err(|e| e.kind()),
        Err(ErrorKind::Syntax)
    );
}

#[test]
fn ratio_of() {
    // third.ratioOf(EUR 5) is 2/3; a Money or an exact total
    let two_thirds = Ratio::new(2, 3).unwrap();
    assert_eq!(third().ratio_of(eur("5")), Ok(two_thirds.clone()));
    let (five, five_exact) = (eur("5"), eur("5").exact());
    assert_eq!(third().ratio_of(&five), Ok(two_thirds.clone()));
    assert_eq!(third().ratio_of(&five_exact), Ok(two_thirds.clone()));
    // ratioOf(EUR 0): RangeError Division by zero
    assert_eq!(third().ratio_of(eur("0")), Err(Error::DivisionByZero));

    assert_eq!(
        any_third().ratio_of(any("5", "EUR")),
        Ok(two_thirds.clone())
    );
    let any_five = any_exact("5", "EUR");
    assert_eq!(any_third().ratio_of(&any_five), Ok(two_thirds));
    assert_eq!(
        any_third().ratio_of(any("0", "EUR")),
        Err(Error::DivisionByZero)
    );
    // ratioOf(USD 1) and ratioOf(USD 0): CurrencyMismatchError EUR vs USD, the currency first
    assert_eq!(
        any_third().ratio_of(any("1", "USD")),
        Err(mismatch("EUR", "USD"))
    );
    assert_eq!(
        any_third().ratio_of(any("0", "USD")),
        Err(mismatch("EUR", "USD"))
    );
}

#[test]
fn min_and_max() {
    // third.min(EUR 3, EUR 4) is 3 EUR; third.max(EUR 3, EUR 4) is 4 EUR
    assert_eq!(third().min(eur("3")).min(eur("4")).to_string(), "3 EUR");
    let (three_eur, four_eur) = (eur("3"), eur("4"));
    assert_eq!(third().max(&three_eur).max(&four_eur).to_string(), "4 EUR");
    assert_eq!(third().min(third()), third());
    assert_eq!(third().max(eur("1").exact()), third());
    let items = [
        third(),
        eur("3").exact(),
        eur("4").exact(),
        eur("3").exact(),
    ];
    assert_eq!(ExactMoney::min_of(&items).unwrap().to_string(), "3 EUR");
    assert_eq!(ExactMoney::max_of(&items).unwrap().to_string(), "4 EUR");
    assert_eq!(ExactMoney::<Eur>::min_of([]), None);
    assert_eq!(ExactMoney::<Eur>::max_of([]), None);
    // a typed amount in another currency doesn't compile; negative values order too
    let negative: ExactMoney<Usd> = -"2".parse::<Money<Usd>>().unwrap().exact();
    assert_eq!(negative.clone().min(Money::<Usd>::zero()), negative);

    let three = any_exact("3", "EUR");
    assert_eq!(any_third().min(&three).unwrap(), three);
    assert_eq!(any_third().min(any("4", "EUR")).unwrap(), any_third());
    assert_eq!(
        any_third().max(any("4", "EUR")).unwrap().to_string(),
        "4 EUR"
    );
    assert_eq!(any_third().max(&three).unwrap(), any_third());
    // a tie keeps the receiver (equal exact amounts are the same fraction)
    assert_eq!(three.min(any("3.00", "EUR")).unwrap(), three);
    // third.min(USD 1): CurrencyMismatchError USD vs EUR (the candidate's currency first)
    assert_eq!(
        any_third().min(any("1", "USD")),
        Err(mismatch("USD", "EUR"))
    );
    assert_eq!(
        any_third().max(any("1", "USD")),
        Err(mismatch("USD", "EUR"))
    );

    let items = [
        any_third(),
        any_exact("3", "EUR"),
        any_exact("4", "EUR"),
        any_exact("3", "EUR"),
    ];
    assert_eq!(
        AnyExactMoney::min_of(&items).unwrap().unwrap().to_string(),
        "3 EUR"
    );
    assert_eq!(
        AnyExactMoney::max_of(&items).unwrap().unwrap().to_string(),
        "4 EUR"
    );
    assert_eq!(AnyExactMoney::min_of([]), Ok(None));
    assert_eq!(AnyExactMoney::max_of([]), Ok(None));
    // third.min(EUR 1, USD 1): the first mismatch, after the smaller EUR 1
    let mixed = [any_third(), any_exact("1", "EUR"), any_exact("1", "USD")];
    assert_eq!(AnyExactMoney::min_of(&mixed), Err(mismatch("USD", "EUR")));
    assert_eq!(AnyExactMoney::max_of(&mixed), Err(mismatch("USD", "EUR")));
}

#[test]
fn is_exact() {
    let eighth = eur("1").exact().divide(8).unwrap();
    // exact(EUR 1).divide(8).isExact() is false, isExact(3) true; third.isExact(1000) false
    assert_eq!(eighth.is_exact(None), Ok(false));
    assert_eq!(eighth.is_exact(Some(3)), Ok(true));
    assert_eq!(third().is_exact(Some(1000)), Ok(false));
    assert_eq!(eur("1.5").exact().is_exact(None), Ok(true));
    // isExact(1001): RangeError Invalid scale
    assert_eq!(
        eur("1").exact().is_exact(Some(1001)),
        Err(Error::InvalidScale)
    );
    assert_eq!(third().is_exact(Some(1001)), Err(Error::InvalidScale));

    let eighth = any_exact("1", "EUR").divide(8).unwrap();
    assert_eq!(eighth.is_exact(None), Ok(false));
    assert_eq!(eighth.is_exact(Some(3)), Ok(true));
    assert_eq!(any_exact("1", "JPY").is_exact(None), Ok(true));
    assert_eq!(
        any_exact("1", "EUR").divide(10).unwrap().is_exact(None),
        Ok(true)
    );
    assert_eq!(
        any_exact("1", "JPY").divide(10).unwrap().is_exact(None),
        Ok(false)
    );
    assert_eq!(
        any_exact("1", "EUR").is_exact(Some(1001)),
        Err(Error::InvalidScale)
    );
    // 1/2^1000 is exact at 1000 places
    let tiny = eur("1").exact().divide(two_pow(1000)).unwrap();
    assert_eq!(tiny.is_exact(Some(1000)), Ok(true));
    assert_eq!(tiny.is_exact(Some(999)), Ok(false));
}

#[test]
fn to_money() {
    let eighth = eur("1").exact().divide(8).unwrap();
    let quarter = eur("1").exact().divide(4).unwrap();
    // toMoney() is 0.125 EUR; divide(4).toMoney(0) 0.25 EUR; toMoney(5) 0.25000 EUR
    assert_eq!(eighth.to_money(None).unwrap().to_decimal(), "0.125");
    assert_eq!(quarter.to_money(Some(0)).unwrap().to_decimal(), "0.25");
    assert_eq!(quarter.to_money(Some(5)).unwrap().to_decimal(), "0.25000");
    // third.toMoney(): RoundingError; third.toMoney(1001): RangeError (the scale first)
    assert_eq!(third().to_money(None), Err(Error::Rounding));
    assert_eq!(third().to_money(Some(1001)), Err(Error::InvalidScale));
    // 1/2^1001 needs 1001 places: RangeError, and with a minimum of 1001 the scale's RangeError
    let tiny = eur("1").exact().divide(two_pow_1001()).unwrap();
    assert_eq!(tiny.to_money(None), Err(Error::InvalidScale));
    assert_eq!(tiny.to_money(Some(1001)), Err(Error::InvalidScale));
    // 1/(3 × 2^1001): RoundingError, the decimal form before the places
    let tiny_third = eur("1")
        .exact()
        .divide(two_pow_1001() * Int::from(3u8))
        .unwrap();
    assert_eq!(tiny_third.to_money(None), Err(Error::Rounding));
    // 1/2^1000 is the deepest that fits
    let deepest = eur("1")
        .exact()
        .divide(two_pow(1000))
        .unwrap()
        .to_money(None)
        .unwrap();
    assert_eq!(deepest.scale(), 1000);

    let any_tiny = any_exact("1", "EUR").divide(two_pow_1001()).unwrap();
    assert_eq!(
        any_exact("1", "EUR")
            .divide(8)
            .unwrap()
            .to_money(None)
            .unwrap()
            .to_decimal(),
        "0.125"
    );
    assert_eq!(any_third().to_money(None), Err(Error::Rounding));
    assert_eq!(any_third().to_money(Some(1001)), Err(Error::InvalidScale));
    assert_eq!(any_tiny.to_money(None), Err(Error::InvalidScale));
    assert_eq!(Error::InvalidScale.kind(), ErrorKind::Range);
}

#[test]
fn multiply_exact() {
    // multiplyExact(EUR 10.00, '1.0775') is 10.775 EUR; × 2 stays 20.00 EUR; × 1/3 RoundingError
    assert_eq!(
        eur("10.00").multiply_exact("1.0775").unwrap().to_decimal(),
        "10.775"
    );
    assert_eq!(
        eur("10.00").multiply_exact(2).unwrap().to_decimal(),
        "20.00"
    );
    assert_eq!(eur("10.00").multiply_exact("1/3"), Err(Error::Rounding));
    // × 'x': SyntaxError, the factor first
    assert_eq!(
        eur("1").multiply_exact("x").map_err(|e| e.kind()),
        Err(ErrorKind::Syntax)
    );
    // × 1/2^1001: RangeError (1001 places)
    let tiny = Ratio::new(Int::ONE, two_pow_1001()).unwrap();
    assert_eq!(
        eur("1").multiply_exact(tiny.clone()),
        Err(Error::InvalidScale)
    );

    let ten = any("10.00", "EUR");
    assert_eq!(ten.multiply_exact("1.0775").unwrap().to_decimal(), "10.775");
    assert_eq!(
        ten.multiply_exact("1.0775").unwrap().currency(),
        code("EUR")
    );
    assert_eq!(ten.multiply_exact("1/3"), Err(Error::Rounding));
    assert_eq!(
        ten.multiply_exact("x").map_err(|e| e.kind()),
        Err(ErrorKind::Syntax)
    );
    // 10.00 × 1/2^1001 is 5/2^1000, which fits; 1 × 1/2^1001 does not
    assert_eq!(ten.multiply_exact(tiny.clone()).unwrap().scale(), 1000);
    assert_eq!(
        any("1", "EUR").multiply_exact(tiny),
        Err(Error::InvalidScale)
    );
}

fn fixed(text: &str) -> Fixed {
    text.parse().unwrap()
}

#[test]
fn fixed_trim_scale() {
    // fixed('12.3400').trimScale() is 12.34; ('5.000').trimScale(2) 5.00; ('5.1').trimScale(3)
    // 5.1; ('0.000').trimScale() 0; ('-120.500').trimScale(0) -120.5
    assert_eq!(fixed("12.3400").trim_scale(0).unwrap().to_string(), "12.34");
    assert_eq!(fixed("5.000").trim_scale(2).unwrap().to_string(), "5.00");
    assert_eq!(fixed("5.1").trim_scale(3).unwrap().to_string(), "5.1");
    assert_eq!(fixed("0.000").trim_scale(0).unwrap().to_string(), "0");
    assert_eq!(
        fixed("-120.500").trim_scale(0).unwrap().to_string(),
        "-120.5"
    );
    assert_eq!(fixed("1200").trim_scale(0).unwrap().to_string(), "1200");
    // trimScale(1001): RangeError Invalid scale, whatever the value
    assert_eq!(fixed("5.1").trim_scale(1001), Err(Error::InvalidScale));
    assert_eq!(fixed("5").trim_scale(1001), Err(Error::InvalidScale));
    assert_eq!(fixed("5").trim_scale(1000).unwrap().scale(), 0);
}

#[test]
fn fixed_from_f64_at() {
    // fixed(2.675, { scale: 2, rounding: 'halfEven' }) is 2.68 (the shortest form is 2.675)
    let at = |value: f64, scale: u16, rounding: Rounding| {
        Fixed::from_f64_at(value, scale, rounding).map(|f| f.to_string())
    };
    assert_eq!(at(2.675, 2, Rounding::HalfEven), Ok("2.68".into()));
    // 0.1 + 0.2 at scale 2 is 0.30: no 15-digit rule once a rounding is given
    assert_eq!(at(0.1 + 0.2, 2, Rounding::HalfExpand), Ok("0.30".into()));
    assert_eq!(at(1.5, 3, Rounding::Unnecessary), Ok("1.500".into()));
    assert_eq!(at(-2.5, 0, Rounding::HalfEven), Ok("-2".into()));
    assert_eq!(at(12.0, 2, Rounding::HalfEven), Ok("12.00".into()));
    assert_eq!(
        at(1e21, 0, Rounding::HalfEven),
        Ok("1000000000000000000000".into())
    );
    assert_eq!(at(1.25e-7, 8, Rounding::HalfEven), Ok("0.00000012".into()));
    // 1.005 at scale 2, 'unnecessary': RoundingError
    assert_eq!(at(1.005, 2, Rounding::Unnecessary), Err(Error::Rounding));
    // NaN and Infinity: RangeError Invalid number; NaN at scale 1001: the scale first
    assert_eq!(at(f64::NAN, 2, Rounding::HalfEven), Err(Error::NotFinite));
    assert_eq!(at(f64::INFINITY, 2, Rounding::Floor), Err(Error::NotFinite));
    assert_eq!(
        at(f64::NAN, 1001, Rounding::HalfEven),
        Err(Error::InvalidScale)
    );
    assert_eq!(at(1.5, 1001, Rounding::HalfEven), Err(Error::InvalidScale));
    assert_eq!(Error::NotFinite.kind(), ErrorKind::Range);
}
