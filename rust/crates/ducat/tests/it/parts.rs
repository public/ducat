//! `major_part`, `minor_part` and `has_fraction`, as ducat's `majorPart`, `minorPart` and
//! `hasFraction`. The expected values were checked against ducat's built `dist` under Node.

use ducat::iso::{Eur, Jpy};
use ducat::{AnyMoney, Int, Money};

use crate::common::{EXACT, code};

/// (decimal, code, scale, majorPart, minorPart, hasFraction), from ducat.
const CASES: &[(&str, &str, u16, &str, &str, bool)] = &[
    ("12.34", "EUR", 2, "12", "34", true),
    ("-12.34", "EUR", 2, "-12", "-34", true),
    ("-0.05", "EUR", 2, "0", "-5", true),
    ("-0.5", "EUR", 2, "0", "-50", true),
    ("-3", "EUR", 2, "-3", "0", false),
    ("0", "EUR", 2, "0", "0", false),
    ("12", "EUR", 2, "12", "0", false),
    ("1.005", "EUR", 3, "1", "5", true),
    ("-1.005", "EUR", 3, "-1", "-5", true),
    ("12", "EUR", 3, "12", "0", false),
    ("12.5", "EUR", 1, "12", "5", true),
    ("12", "EUR", 0, "12", "0", false),
    ("-7", "EUR", 0, "-7", "0", false),
    ("1234", "JPY", 0, "1234", "0", false),
    ("-1234", "JPY", 0, "-1234", "0", false),
    ("0", "JPY", 0, "0", "0", false),
    ("12.5", "JPY", 1, "12", "5", true),
    ("-0.0000000000000001", "EUR", 16, "0", "-1", true),
    ("1", "EUR", 16, "1", "0", false),
    // past i128 (about 1.7 × 10^38)
    (
        "-123456789012345678901234567890123456789012.34",
        "EUR",
        2,
        "-123456789012345678901234567890123456789012",
        "-34",
        true,
    ),
    (
        "10000000000000000000000000000000000000000.00",
        "EUR",
        2,
        "10000000000000000000000000000000000000000",
        "0",
        false,
    ),
    (
        "1.0000000000000000000000000000000000000000001",
        "EUR",
        43,
        "1",
        "1",
        true,
    ),
    (
        "-0.0000000000000000000000000000000000000000001",
        "EUR",
        43,
        "0",
        "-1",
        true,
    ),
];

fn int(text: &str) -> Int {
    text.parse().unwrap()
}

#[test]
fn any_money_matches_ducat() {
    for &(text, currency, scale, major, minor, fraction) in CASES {
        let money = AnyMoney::parse_at(text, code(currency), scale, EXACT).unwrap();
        assert_eq!(
            money.major_part(),
            int(major),
            "majorPart of {text} {currency}"
        );
        assert_eq!(
            money.minor_part(),
            int(minor),
            "minorPart of {text} {currency}"
        );
        assert_eq!(
            money.has_fraction(),
            fraction,
            "hasFraction of {text} {currency}"
        );
    }
}

#[test]
fn typed_money_matches_ducat() {
    for &(text, currency, scale, major, minor, fraction) in CASES {
        let (got_major, got_minor, got_fraction) = match currency {
            "EUR" => {
                let money = Money::<Eur>::parse_at(text, scale, EXACT).unwrap();
                (money.major_part(), money.minor_part(), money.has_fraction())
            }
            _ => {
                let money = Money::<Jpy>::parse_at(text, scale, EXACT).unwrap();
                (money.major_part(), money.minor_part(), money.has_fraction())
            }
        };
        assert_eq!(got_major, int(major), "majorPart of {text} {currency}");
        assert_eq!(got_minor, int(minor), "minorPart of {text} {currency}");
        assert_eq!(got_fraction, fraction, "hasFraction of {text} {currency}");
    }
}

#[test]
fn parts_from_units_match_ducat() {
    // ducat's test/parts.test.ts: fromMinor(123, 'EUR', 20), fromMinor(10n ** 25n, 'EUR', 20)
    let small = Money::<Eur>::from_units(123, 20).unwrap();
    assert_eq!(
        (small.major_part(), small.minor_part()),
        (Int::ZERO, int("123"))
    );
    let big = Money::<Eur>::from_units(int("10000000000000000000000000"), 20).unwrap();
    assert_eq!(
        (big.major_part(), big.minor_part()),
        (int("100000"), Int::ZERO)
    );
    // fromMinor(10005n * 10n ** 20n + 1n, 'EUR', 22) and 10005n * 10n ** 22n
    let odd = AnyMoney::from_units(int("1000500000000000000000001"), 22, code("EUR")).unwrap();
    assert!(odd.has_fraction());
    let even = AnyMoney::from_units(int("100050000000000000000000000"), 22, code("EUR")).unwrap();
    assert!(!even.has_fraction());
    assert_eq!(even.major_part(), int("10005"));
}

#[test]
fn parts_recompose_the_units() {
    for &(text, currency, scale, ..) in CASES {
        let money = AnyMoney::parse_at(text, code(currency), scale, EXACT).unwrap();
        let whole = money.major_part();
        let rest = money.minor_part();
        let rebuilt = AnyMoney::from_units(whole, 0, code(currency))
            .unwrap()
            .to_scale(scale, EXACT)
            .unwrap()
            .checked_add(&AnyMoney::from_units(rest, scale, code(currency)).unwrap())
            .unwrap();
        assert!(rebuilt.identical(&money), "{text} {currency}");
    }
}
