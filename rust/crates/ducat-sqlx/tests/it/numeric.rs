//! Postgres NUMERIC's binary format against hand-built wire bytes, and round trips.

use ducat::testing::proptest::prelude::*;
use ducat::testing::{MoneyOptions, any_money, int};
use ducat::{Int, MAX_SCALE};
use ducat_sqlx::pg::{decode_numeric, encode_numeric};
use ducat_sqlx::{Decimal, Error};

use crate::common::{decimal, pow10};

const POSITIVE: u16 = 0x0000;
const NEGATIVE: u16 = 0x4000;

/// NUMERIC wire bytes from their fields, as `numeric_send` writes them.
fn wire(weight: i16, sign: u16, dscale: u16, digits: &[u16]) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&u16::try_from(digits.len()).unwrap().to_be_bytes());
    bytes.extend_from_slice(&weight.to_be_bytes());
    bytes.extend_from_slice(&sign.to_be_bytes());
    bytes.extend_from_slice(&dscale.to_be_bytes());
    for digit in digits {
        bytes.extend_from_slice(&digit.to_be_bytes());
    }
    bytes
}

fn encode(value: &Decimal) -> Vec<u8> {
    let mut bytes = Vec::new();
    encode_numeric(value, &mut bytes).expect("encodes");
    bytes
}

/// Postgres's canonical bytes for `text`, both ways: they decode to it, and it encodes to them.
fn both_ways(text: &str, bytes: &[u8]) {
    let value = decimal(text);
    assert_eq!(
        decode_numeric(bytes).as_ref(),
        Ok(&value),
        "decoding {text}"
    );
    assert_eq!(encode(&value), bytes, "encoding {text}");
    assert_eq!(value.to_string(), text);
}

#[test]
fn literal_bytes() {
    // 12.34 = 12 × 10000^0 + 3400 × 10000^−1, as `SELECT 12.34::numeric` sends it
    both_ways("12.34", &[0, 2, 0, 0, 0, 0, 0, 2, 0, 12, 0x0D, 0x48]);
    // -0.0005 = −5 × 10000^−1, dscale 4
    both_ways("-0.0005", &[0, 1, 0xFF, 0xFF, 0x40, 0, 0, 4, 0, 5]);
    // -0.5 = −5000 × 10000^−1, dscale 1
    both_ways("-0.5", &[0, 1, 0xFF, 0xFF, 0x40, 0, 0, 1, 0x13, 0x88]);
    // zero has no digits
    both_ways("0", &[0, 0, 0, 0, 0, 0, 0, 0]);
}

#[test]
fn zero_and_negative_zero() {
    for dscale in [0, 1, 2, 4, 5, 999, 1000] {
        let zero = Decimal::new(0, dscale).unwrap();
        assert_eq!(encode(&zero), wire(0, POSITIVE, dscale, &[]));
        assert_eq!(
            decode_numeric(&wire(0, POSITIVE, dscale, &[])),
            Ok(zero.clone())
        );
        // a negative zero isn't Postgres's, but on the wire it's still zero, and never `-0`
        let negative_zero = decode_numeric(&wire(0, NEGATIVE, dscale, &[])).unwrap();
        assert_eq!(negative_zero, zero);
        assert!(!negative_zero.units().is_negative());
        assert!(!negative_zero.to_string().starts_with('-'));
        // zero digits, and a weight that isn't 0, are still zero
        assert_eq!(
            decode_numeric(&wire(7, POSITIVE, dscale, &[0, 0])),
            Ok(zero)
        );
    }
}

#[test]
fn bigint_boundaries() {
    // 2^63 − 1 = 922|3372|0368|5477|5807
    both_ways(
        "9223372036854775807",
        &wire(4, POSITIVE, 0, &[922, 3372, 368, 5477, 5807]),
    );
    both_ways(
        "9223372036854775808",
        &wire(4, POSITIVE, 0, &[922, 3372, 368, 5477, 5808]),
    );
    both_ways(
        "9223372036854775809",
        &wire(4, POSITIVE, 0, &[922, 3372, 368, 5477, 5809]),
    );
    both_ways(
        "-9223372036854775808",
        &wire(4, NEGATIVE, 0, &[922, 3372, 368, 5477, 5808]),
    );
    both_ways(
        "-9223372036854775809",
        &wire(4, NEGATIVE, 0, &[922, 3372, 368, 5477, 5809]),
    );
    // 2^63 + 1 cents, at scale 2: 92233720368547758.09
    both_ways(
        "92233720368547758.09",
        &wire(4, POSITIVE, 2, &[9, 2233, 7203, 6854, 7758, 900]),
    );
    // i128's limits, and one beyond
    both_ways(
        "170141183460469231731687303715884105727",
        &wire(
            9,
            POSITIVE,
            0,
            &[170, 1411, 8346, 469, 2317, 3168, 7303, 7158, 8410, 5727],
        ),
    );
    both_ways(
        "-170141183460469231731687303715884105728",
        &wire(
            9,
            NEGATIVE,
            0,
            &[170, 1411, 8346, 469, 2317, 3168, 7303, 7158, 8410, 5728],
        ),
    );
}

#[test]
fn powers_of_ten() {
    // 10^1000 = 1 × 10000^250
    let big = Decimal::new(pow10(1000), 0).unwrap();
    assert_eq!(encode(&big), wire(250, POSITIVE, 0, &[1]));
    assert_eq!(
        decode_numeric(&wire(250, POSITIVE, 0, &[1])),
        Ok(big.clone())
    );
    // with every decimal: 10^1000 at scale 1000
    let scaled = Decimal::new(pow10(2000), 1000).unwrap();
    assert_eq!(encode(&scaled), wire(250, POSITIVE, 1000, &[1]));
    assert_eq!(decode_numeric(&wire(250, POSITIVE, 1000, &[1])), Ok(scaled));
    // 10^−1000 = 1 × 10000^−250
    let tiny = Decimal::new(1, 1000).unwrap();
    assert_eq!(encode(&tiny), wire(-250, POSITIVE, 1000, &[1]));
    assert_eq!(decode_numeric(&wire(-250, POSITIVE, 1000, &[1])), Ok(tiny));
    // 10^8 and 10^4: trailing zero digits are stripped, the weight says where the digit is
    both_ways("100000000", &wire(2, POSITIVE, 0, &[1]));
    both_ways("10000", &wire(1, POSITIVE, 0, &[1]));
    both_ways("1000", &wire(0, POSITIVE, 0, &[1000]));
    // 10^131071, the largest power the 16-bit weight reaches, encodes; one more digit group doesn't
    let largest = Decimal::new(pow10(4 * 32767 + 3), 0).unwrap();
    assert_eq!(encode(&largest), wire(32767, POSITIVE, 0, &[1000]));
    let beyond = Decimal::new(pow10(4 * 32768), 0).unwrap();
    let mut bytes = vec![7];
    assert_eq!(encode_numeric(&beyond, &mut bytes), Err(Error::OutOfRange));
    assert_eq!(bytes, [7], "nothing is appended on an error");
}

#[test]
fn every_scale() {
    // 1, −1 and 12.5 at every scale from 0 to 1000, with trailing zeros up to the scale
    for scale in 0..=MAX_SCALE {
        for units in [Int::ONE, -Int::ONE, Int::from(125)] {
            let units = &units * &pow10(u32::from(scale));
            let value = Decimal::new(units, scale).unwrap();
            let bytes = encode(&value);
            assert_eq!(decode_numeric(&bytes).as_ref(), Ok(&value), "scale {scale}");
            assert_eq!(&bytes[6..8], &scale.to_be_bytes(), "dscale is the scale");
        }
        let smallest = Decimal::new(1, scale).unwrap();
        assert_eq!(decode_numeric(&encode(&smallest)), Ok(smallest));
    }
}

#[test]
fn many_trailing_zeros() {
    // 1.5 shown with 1000 decimals: two digits, everything else is dscale
    let bytes = wire(0, POSITIVE, 1000, &[1, 5000]);
    let value = decode_numeric(&bytes).unwrap();
    assert_eq!(value.scale(), 1000);
    assert_eq!(value.to_string(), format!("1.5{}", "0".repeat(999)));
    assert_eq!(encode(&value), bytes);
    // 12.3400 from a NUMERIC(19,4) column
    both_ways("12.3400", &wire(0, POSITIVE, 4, &[12, 3400]));
    // 1.10 has its scale, 1.1 doesn't
    both_ways("1.10", &wire(0, POSITIVE, 2, &[1, 1000]));
    both_ways("1.1", &wire(0, POSITIVE, 1, &[1, 1000]));
}

#[test]
fn negative_weights() {
    both_ways("0.0001", &wire(-1, POSITIVE, 4, &[1]));
    both_ways("0.00000001", &wire(-2, POSITIVE, 8, &[1]));
    both_ways("0.012345", &wire(-1, POSITIVE, 6, &[123, 4500]));
    both_ways("-0.000000012345", &wire(-2, NEGATIVE, 12, &[1, 2345]));
    both_ways("0.5", &wire(-1, POSITIVE, 1, &[5000]));
}

#[test]
fn negative_values() {
    both_ways("-12.34", &wire(0, NEGATIVE, 2, &[12, 3400]));
    both_ways("-1", &wire(0, NEGATIVE, 0, &[1]));
    both_ways("-10000.0001", &wire(1, NEGATIVE, 4, &[1, 0, 1]));
}

#[test]
fn non_canonical_digits_still_read() {
    // a leading zero digit, and a zero digit at the end inside the scale
    assert_eq!(
        decode_numeric(&wire(1, POSITIVE, 0, &[0, 12])),
        Ok(decimal("12"))
    );
    assert_eq!(
        decode_numeric(&wire(0, POSITIVE, 4, &[12, 3400, 0])),
        Ok(decimal("12.3400"))
    );
}

#[test]
fn special_values_are_refused() {
    assert_eq!(
        decode_numeric(&wire(0, 0xC000, 0, &[])),
        Err(Error::NotANumber)
    );
    assert_eq!(
        decode_numeric(&wire(0, 0xD000, 0, &[])),
        Err(Error::Infinite { negative: false })
    );
    assert_eq!(
        decode_numeric(&wire(0, 0xF000, 0, &[])),
        Err(Error::Infinite { negative: true })
    );
}

#[test]
fn malformed_bytes_are_refused() {
    let malformed = |bytes: &[u8]| {
        assert!(
            matches!(decode_numeric(bytes), Err(Error::Malformed(_))),
            "{bytes:?} gave {:?}",
            decode_numeric(bytes)
        );
    };
    malformed(&[]);
    malformed(&[0, 1, 0, 0, 0, 0, 0]);
    // the digit count says two, one follows; or one, two follow
    malformed(&wire(0, POSITIVE, 0, &[1])[..9]);
    malformed(&[0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1]);
    malformed(&wire(0, POSITIVE, 0, &[10_000]));
    malformed(&wire(0, POSITIVE, 0, &[0xFFFF]));
    malformed(&wire(0, 0x8000, 0, &[1]));
    malformed(&wire(0, 0x0001, 0, &[1]));
    // a display scale beyond 16383, and a negative digit count
    malformed(&wire(0, POSITIVE, 0x4000, &[]));
    malformed(&[0x80, 0, 0, 0, 0, 0, 0, 0]);
    // digits the display scale hides: 1.5 shown with no decimals, 0.0001 with three
    malformed(&wire(0, POSITIVE, 0, &[1, 5000]));
    malformed(&wire(-1, POSITIVE, 3, &[1]));
    malformed(&wire(-1, POSITIVE, 0, &[1]));
}

#[test]
fn scales_beyond_ducats_are_refused() {
    assert_eq!(
        decode_numeric(&wire(0, POSITIVE, 1001, &[1])),
        Err(Error::Ducat(ducat::Error::InvalidScale))
    );
    // Postgres's own maximum display scale
    assert_eq!(
        decode_numeric(&wire(0, POSITIVE, 16383, &[])),
        Err(Error::Ducat(ducat::Error::InvalidScale))
    );
}

/// The value of NUMERIC fields times 10^dscale, computed independently with ducat's integers.
fn model(weight: i16, negative: bool, dscale: u16, digits: &[u16]) -> Int {
    let mut total = Int::ZERO;
    for (index, &digit) in digits.iter().enumerate() {
        let exponent = 4 * (i64::from(weight) - index as i64) + i64::from(dscale);
        total = total + Int::from(digit) * pow10(u32::try_from(exponent).unwrap());
    }
    if negative { -total } else { total }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    #[test]
    fn round_trips_any_integer_at_any_scale(units in int(), scale in 0..=MAX_SCALE) {
        let value = Decimal::new(units, scale).unwrap();
        let bytes = encode(&value);
        prop_assert_eq!(decode_numeric(&bytes), Ok(value.clone()));
        // and the text form
        prop_assert_eq!(value.to_string().parse::<Decimal>(), Ok(value));
    }

    #[test]
    fn round_trips_money(money in any_money(&MoneyOptions::new())) {
        let value = Decimal::from_money(&money);
        prop_assert_eq!(decode_numeric(&encode(&value)), Ok(value.clone()));
        let back = value.to_money(money.currency()).unwrap();
        prop_assert!(back.identical(&money));
    }

    #[test]
    fn encodes_canonically(units in int(), scale in 0_u16..=40) {
        let bytes = encode(&Decimal::new(units.clone(), scale).unwrap());
        let ndigits = usize::from(u16::from_be_bytes([bytes[0], bytes[1]]));
        let digits: Vec<u16> = bytes[8..]
            .chunks(2)
            .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
            .collect();
        prop_assert_eq!(digits.len(), ndigits);
        prop_assert!(digits.iter().all(|&digit| digit < 10_000));
        // no leading or trailing zero digit, and zero is positive with weight 0
        prop_assert!(digits.first() != Some(&0) && digits.last() != Some(&0));
        if units.is_zero() {
            prop_assert_eq!(&bytes[2..6], &[0, 0, 0, 0]);
        }
        let negative = bytes[4] == 0x40;
        prop_assert_eq!(negative, units.is_negative());
    }

    #[test]
    fn decodes_as_the_model(
        weight in -10_i16..=40,
        negative in any::<bool>(),
        extra_scale in 0_u16..=12,
        digits in prop::collection::vec(0_u16..10_000, 0..12),
    ) {
        // the smallest dscale that shows every digit, plus some
        let last = i64::from(weight) - digits.len() as i64 + 1;
        let shown = u16::try_from((-4 * last).max(0)).unwrap();
        let dscale = shown + extra_scale;
        let bytes = wire(weight, if negative { NEGATIVE } else { POSITIVE }, dscale, &digits);
        let decoded = decode_numeric(&bytes).unwrap();
        prop_assert_eq!(decoded.scale(), dscale);
        prop_assert_eq!(decoded.units(), &model(weight, negative, dscale, &digits));
    }

    #[test]
    fn arbitrary_bytes_never_panic(bytes in prop::collection::vec(any::<u8>(), 0..48)) {
        let _ = decode_numeric(&bytes);
    }

    #[test]
    fn arbitrary_headers_never_panic(
        ndigits in any::<u16>(),
        weight in any::<i16>(),
        sign in prop::sample::select(vec![0x0000_u16, 0x4000, 0xC000, 0xD000, 0xF000, 0x1234]),
        dscale in any::<u16>(),
        digits in prop::collection::vec(any::<u16>(), 0..8),
    ) {
        let mut bytes = wire(weight, sign, dscale, &digits);
        bytes[..2].copy_from_slice(&ndigits.to_be_bytes());
        let _ = decode_numeric(&bytes);
    }
}
