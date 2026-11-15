//! ducat's own processor tests (test/processors.test.ts, test/checkout.test.ts,
//! test/paypal.test.ts, test/braintree.test.ts, test/klarna.test.ts), ported value by value except
//! where the Rust API differs: reading takes a `CurrencyCode`, so ducat's lowercase-currency and
//! non-string-value cases have no counterpart; an `i64` read back is never refused, where ducat
//! refuses a JavaScript number past 2^53 − 1. XDR, which ducat defines with `defineCurrency`, is a
//! `CurrencyCode::custom`.

use ducat::iso::{
    Bhd, Clp, Cve, Eur, Gbp, Huf, Idr, Iqd, Isk, Jpy, Krw, Kwd, Lak, Lyd, Mga, Sek, Twd, Ugx, Usd,
    Vnd,
};
use ducat::processors::checkout::{CheckoutAmount, CheckoutOptions};
use ducat::processors::paypal::PayPalAmount;
use ducat::processors::stripe::{StripeAmount, StripeOptions};
use ducat::processors::{adyen, braintree, checkout, klarna, paypal, stripe};
use ducat::{AnyMoney, Currency, CurrencyCode, Error, Int, Money, Rounding};

use crate::common::{EXACT, Result};

/// ducat's `money(text, code)`: the amount at the scale its digits give, or at least the
/// currency's.
fn m<C: Currency>(text: &str) -> Money<C> {
    let places = text
        .split_once('.')
        .map_or(0, |(_, fraction)| fraction.len());
    let scale = u16::try_from(places)
        .unwrap()
        .max(u16::from(C::CODE.exponent()));
    Money::parse_at(text, scale, Rounding::Unnecessary).unwrap()
}

fn iso(code: &str) -> CurrencyCode {
    CurrencyCode::iso(code).unwrap()
}

fn stripe_default() -> StripeOptions {
    StripeOptions::default()
}

fn stripe_with(payout: bool, rounding: Rounding) -> StripeOptions {
    StripeOptions { payout, rounding }
}

fn checkout_with(standalone: bool, rounding: Rounding) -> CheckoutOptions {
    CheckoutOptions {
        standalone,
        rounding,
    }
}

// --- Stripe -------------------------------------------------------------------------------------

#[test]
fn stripe_standard_and_zero_decimal_currencies() -> Result {
    let amount = m::<Usd>("10.99").to_stripe(&stripe_default())?;
    assert_eq!(
        amount,
        StripeAmount {
            amount: 1099,
            currency: "usd".into()
        }
    );
    assert_eq!(m::<Jpy>("1000").to_stripe_amount(&stripe_default())?, 1000);
    assert_eq!(
        m::<Krw>("50000").to_stripe_amount(&stripe_default())?,
        50000
    );
    assert_eq!(
        m::<Vnd>("100000").to_stripe_amount(&stripe_default())?,
        100_000
    );
    assert_eq!(m::<Clp>("5000").to_stripe_amount(&stripe_default())?, 5000);
    Ok(())
}

#[test]
fn stripe_isk_and_ugx_are_two_decimal_values_ending_in_00() -> Result {
    assert_eq!(m::<Isk>("5").to_stripe_amount(&stripe_default())?, 500);
    assert_eq!(Money::<Isk>::from_stripe(500)?.to_decimal(), "5");
    assert_eq!(m::<Ugx>("5").to_stripe_amount(&stripe_default())?, 500);
    // a fractional ISK from Stripe keeps its precision rather than being rounded away
    assert_eq!(Money::<Isk>::from_stripe(1234)?.scale(), 2);
    Ok(())
}

#[test]
fn stripe_mga_is_zero_decimal_although_iso_says_2() -> Result {
    assert_eq!(Mga::CODE.exponent(), 2);
    assert_eq!(stripe::exponent("MGA")?, 0);
    assert_eq!(m::<Mga>("100").to_stripe_amount(&stripe_default())?, 100);
    assert_eq!(
        m::<Mga>("100.50").to_stripe_amount(&stripe_default()),
        Err(Error::Rounding)
    );
    let even = stripe_with(false, Rounding::HalfEven);
    assert_eq!(m::<Mga>("100.50").to_stripe_amount(&even)?, 100);
    Ok(())
}

#[test]
fn stripe_huf_and_twd_payouts_are_whole_units() -> Result {
    assert_eq!(m::<Huf>("10.45").to_stripe_amount(&stripe_default())?, 1045);
    assert_eq!(
        m::<Huf>("10.45").to_stripe_amount(&stripe_with(true, EXACT)),
        Err(Error::Rounding)
    );
    let floor = stripe_with(true, Rounding::Floor);
    assert_eq!(m::<Huf>("10.45").to_stripe_amount(&floor)?, 1000);
    assert_eq!(m::<Twd>("800.45").to_stripe_amount(&floor)?, 80000);
    Ok(())
}

#[test]
fn stripe_three_decimal_currencies_end_in_0() -> Result {
    assert_eq!(m::<Kwd>("5.120").to_stripe_amount(&stripe_default())?, 5120);
    assert_eq!(
        m::<Kwd>("5.124").to_stripe_amount(&stripe_default()),
        Err(Error::Rounding)
    );
    let even = stripe_with(false, Rounding::HalfEven);
    assert_eq!(m::<Kwd>("5.124").to_stripe_amount(&even)?, 5120);
    let expand = stripe_with(false, Rounding::HalfExpand);
    assert_eq!(m::<Kwd>("5.125").to_stripe_amount(&expand)?, 5130);
    Ok(())
}

#[test]
fn stripe_unsupported_currencies_and_inherited_names() {
    let irr = AnyMoney::parse("1", iso("IRR")).unwrap();
    assert_eq!(
        irr.to_stripe_amount(&stripe_default()),
        Err(Error::UnsupportedCurrency)
    );
    for name in [
        "toString",
        "constructor",
        "valueOf",
        "hasOwnProperty",
        "__proto__",
    ] {
        assert!(!stripe::is_currency(name) && !adyen::is_currency(name));
        assert_eq!(stripe::exponent(name), Err(Error::UnsupportedCurrency));
        assert_eq!(adyen::exponent(name), Err(Error::UnsupportedCurrency));
    }
}

#[test]
fn every_stripe_rule_is_consistent() {
    let mut count = 0;
    let historic = ["ANG", "STD"].map(|code| CurrencyCode::historic(code).unwrap());
    for code in CurrencyCode::iso_codes().chain(historic) {
        let Some(rule) = stripe::rule(code.as_str()) else {
            continue;
        };
        count += 1;
        assert!([0, 2, 3].contains(&rule.exponent), "{code}");
        assert!([1, 10, 100].contains(&rule.charge_multiple), "{code}");
        assert_eq!(rule.payout_multiple % rule.charge_multiple, 0, "{code}");
    }
    assert_eq!(count, 139);
    assert!(stripe::is_currency("usd") && stripe::is_currency("ANG"));
}

// --- Adyen --------------------------------------------------------------------------------------

#[test]
fn adyen_exponent_differences_from_iso() -> Result {
    let clp = m::<Clp>("5000").to_adyen(EXACT)?;
    assert_eq!(
        clp,
        adyen::AdyenAmount {
            value: 500_000,
            currency: Clp::CODE
        }
    );
    assert_eq!(m::<Isk>("5").to_adyen(EXACT)?.value, 500);
    assert_eq!(m::<Idr>("15000").to_adyen(EXACT)?.value, 15000);
    assert_eq!(m::<Idr>("15000.50").to_adyen(EXACT), Err(Error::Rounding));
    assert_eq!(
        m::<Idr>("15000.50").to_adyen(Rounding::HalfEven)?.value,
        15000
    );
    assert_eq!(m::<Cve>("100").to_adyen(EXACT)?.value, 100);
    assert_eq!(Money::<Clp>::from_adyen(500_000)?.to_decimal(), "5000");
    let idr = AnyMoney::from_adyen(adyen::AdyenAmount {
        value: 15000,
        currency: Idr::CODE,
    })?;
    assert_eq!(idr.to_decimal(), "15000.00");
    Ok(())
}

#[test]
fn adyen_agrees_with_iso_except_the_documented_exceptions() -> Result {
    let differ: Vec<String> = CurrencyCode::iso_codes()
        .filter(|code| adyen::rule(code.as_str()).is_some_and(|e| e != code.exponent()))
        .map(|code| code.as_str().to_owned())
        .collect();
    assert_eq!(differ, ["CLP", "CVE", "IDR", "ISK"]);
    assert_eq!(adyen::exponent("KWD")?, 3);
    // Adyen's codes are case-sensitive
    assert!(adyen::is_currency("USD") && !adyen::is_currency("usd"));
    Ok(())
}

// --- the cross-processor table in docs/reference/processors.md -----------------------------------

fn dash<T: ToString>(result: core::result::Result<T, Error>) -> String {
    match result {
        Ok(value) => value.to_string(),
        Err(Error::UnsupportedCurrency) => "-".into(),
        Err(error) => panic!("{error}"),
    }
}

#[test]
fn the_same_1000_units_on_every_processor() -> Result {
    let rows: Vec<[String; 7]> = ["USD", "JPY", "ISK", "IDR", "CLP", "KWD", "HUF"]
        .map(|text| {
            let code = iso(text);
            let thousand =
                AnyMoney::from_minor(Int::from(10_i64.pow(u32::from(code.exponent()) + 3)), code);
            [
                text.to_owned(),
                dash(thousand.to_stripe_amount(&stripe_default())),
                dash(thousand.to_adyen(EXACT).map(|amount| amount.value)),
                dash(thousand.to_checkout_amount(&CheckoutOptions::default())),
                dash(thousand.to_paypal_value(EXACT)),
                dash(thousand.to_braintree(EXACT)),
                dash(thousand.to_klarna(EXACT)),
            ]
        })
        .into();
    let want = [
        [
            "USD", "100000", "100000", "100000", "1000.00", "1000.00", "100000",
        ],
        ["JPY", "1000", "1000", "1000", "1000", "1000", "-"],
        ["ISK", "100000", "100000", "1000", "-", "1000", "-"],
        ["IDR", "100000", "1000", "100000", "-", "1000.00", "-"],
        ["CLP", "1000", "100000", "100000", "-", "1000", "-"],
        ["KWD", "1000000", "1000000", "1000000", "-", "-", "-"],
        [
            "HUF", "100000", "100000", "100000", "1000", "1000.00", "100000",
        ],
    ];
    assert_eq!(rows, want.map(|row| row.map(String::from)));
    Ok(())
}

// --- Checkout.com -------------------------------------------------------------------------------

#[test]
fn checkout_documented_examples() -> Result {
    let default = CheckoutOptions::default();
    let jpy = m::<Jpy>("100").to_checkout(&default)?;
    assert_eq!(
        jpy,
        CheckoutAmount {
            amount: 100,
            currency: "JPY".into()
        }
    );
    assert_eq!(m::<Bhd>("100").to_checkout(&default)?.amount, 100_000);
    assert_eq!(m::<Usd>("100").to_checkout(&default)?.amount, 10000);
    assert_eq!(Money::<Jpy>::from_checkout(100)?.to_decimal(), "100");
    assert_eq!(
        Money::<Bhd>::from_checkout(100_000)?.to_decimal(),
        "100.000"
    );
    assert_eq!(Money::<Usd>::from_checkout(10000)?.to_decimal(), "100.00");
    Ok(())
}

#[test]
fn checkout_three_decimal_currencies_end_in_0() -> Result {
    let default = CheckoutOptions::default();
    assert_eq!(
        m::<Bhd>("1.001").to_checkout_amount(&default),
        Err(Error::Rounding)
    );
    let even = checkout_with(false, Rounding::HalfEven);
    assert_eq!(m::<Bhd>("1.001").to_checkout_amount(&even)?, 1000);
    let expand = checkout_with(false, Rounding::HalfExpand);
    assert_eq!(m::<Kwd>("1.005").to_checkout_amount(&expand)?, 1010);
    assert_eq!(m::<Iqd>("2.5").to_checkout_amount(&default)?, 2500);
    assert_eq!(m::<Lyd>("2.5").to_checkout_amount(&default)?, 2500);
    Ok(())
}

#[test]
fn checkout_clp_has_two_decimals_ending_in_00_for_payments() -> Result {
    let default = CheckoutOptions::default();
    assert_eq!(Clp::CODE.exponent(), 0);
    assert_eq!(checkout::exponent("CLP")?, 2);
    assert_eq!(m::<Clp>("5000").to_checkout_amount(&default)?, 500_000);
    assert_eq!(Money::<Clp>::from_checkout(500_000)?.to_decimal(), "5000");
    let odd = m::<Clp>("1000.10");
    assert_eq!(odd.to_checkout_amount(&default), Err(Error::Rounding));
    let floor = checkout_with(false, Rounding::Floor);
    assert_eq!(odd.to_checkout_amount(&floor)?, 100_000);
    // the Standalone API (authentication) is exempt
    assert_eq!(
        odd.to_checkout_amount(&checkout_with(true, EXACT))?,
        100_010
    );
    assert_eq!(
        Money::<Clp>::from_checkout(100_010)?.to_decimal(),
        "1000.10"
    );
    Ok(())
}

#[test]
fn checkout_full_amount_currencies_and_mga() -> Result {
    let default = CheckoutOptions::default();
    assert_eq!(m::<Isk>("5").to_checkout_amount(&default)?, 5);
    assert_eq!(m::<Ugx>("5").to_checkout_amount(&default)?, 5);
    assert_eq!(m::<Mga>("100.50").to_checkout_amount(&default)?, 10050);
    let too_precise = m::<Usd>("10.005");
    assert_eq!(
        too_precise.to_checkout_amount(&default),
        Err(Error::Rounding)
    );
    let even = checkout_with(false, Rounding::HalfEven);
    assert_eq!(too_precise.to_checkout_amount(&even)?, 1000);
    Ok(())
}

#[test]
fn checkout_zero_passes_negatives_and_large_amounts_fail() -> Result {
    let default = CheckoutOptions::default();
    assert_eq!(m::<Usd>("0").to_checkout_amount(&default)?, 0);
    assert_eq!(
        m::<Usd>("-5").to_checkout_amount(&default),
        Err(Error::NegativeAmount)
    );
    // the sign is checked after rounding: -0.004 rounds to zero
    let even = checkout_with(false, Rounding::HalfEven);
    assert_eq!(m::<Usd>("-0.004").to_checkout_amount(&even)?, 0);
    let huge = Money::<Usd>::from_minor(Int::from(1_i64 << 60));
    assert_eq!(
        huge.to_checkout_amount(&default),
        Err(Error::AmountTooLarge)
    );
    Ok(())
}

#[test]
fn checkout_historic_and_unlisted_currencies() -> Result {
    assert!(checkout::is_currency("SLL") && checkout::is_currency("usd"));
    let sll = AnyMoney::parse("1", CurrencyCode::historic("SLL")?)?;
    assert_eq!(sll.to_checkout_amount(&CheckoutOptions::default())?, 100);
    // XDR: ISO lists it without a minor unit, so it is defined, as ducat's defineCurrency('XDR', 2)
    let xdr = CurrencyCode::custom("XDR", 2)?;
    assert_eq!(AnyMoney::from_checkout(250, xdr)?.to_decimal(), "2.50");
    assert!(!checkout::is_currency("CLF"));
    let clf = AnyMoney::parse("1", iso("CLF"))?;
    assert_eq!(
        clf.to_checkout_amount(&CheckoutOptions::default()),
        Err(Error::UnsupportedCurrency)
    );
    assert_eq!(
        AnyMoney::from_checkout(1, iso("UYI")),
        Err(Error::UnsupportedCurrency)
    );
    Ok(())
}

#[test]
fn every_checkout_rule_matches_the_documented_lists() {
    let zero = "BIF DJF GNF ISK JPY KMF KRW PYG RWF UGX VUV VND XAF XOF XPF";
    let three = "BHD IQD JOD KWD LYD OMR TND";
    for code in CurrencyCode::iso_codes() {
        let code = code.as_str();
        let Some(rule) = checkout::rule(code) else {
            continue;
        };
        let exponent = if zero.contains(code) {
            0
        } else if three.contains(code) {
            3
        } else {
            2
        };
        let multiple = if three.contains(code) {
            10
        } else if code == "CLP" {
            100
        } else {
            1
        };
        assert_eq!(rule.exponent, exponent, "{code}");
        assert_eq!(rule.multiple, multiple, "{code}");
        let standalone = if code == "CLP" { 1 } else { multiple };
        assert_eq!(rule.standalone_multiple, standalone, "{code}");
    }
}

// --- PayPal -------------------------------------------------------------------------------------

#[test]
fn paypal_documented_examples() -> Result {
    let amount = m::<Usd>("100").to_paypal(EXACT)?;
    let want = PayPalAmount {
        currency_code: "USD".into(),
        value: "100.00".into(),
    };
    assert_eq!(amount, want);
    assert_eq!(Money::<Usd>::from_paypal("100.00")?.to_decimal(), "100.00");
    // item_total + shipping = amount: 20.00 + 100.00 x 2 + 10.00
    let items = Money::<Usd>::from_paypal("20.00")?
        + Money::<Usd>::from_paypal("100.00")?.multiply(2, EXACT)?;
    assert_eq!(items.to_paypal_value(EXACT)?, "220.00");
    let total = items + Money::<Usd>::from_paypal("10.00")?;
    assert_eq!(total.to_paypal(EXACT)?.value, "230.00");
    Ok(())
}

#[test]
fn paypal_huf_jpy_and_twd_take_no_decimals() -> Result {
    assert_eq!(m::<Jpy>("1000").to_paypal_value(EXACT)?, "1000");
    assert_eq!(m::<Huf>("1000").to_paypal_value(EXACT)?, "1000");
    assert_eq!(m::<Twd>("250").to_paypal_value(EXACT)?, "250");
    assert_eq!(
        m::<Huf>("1000.50").to_paypal_value(EXACT),
        Err(Error::Rounding)
    );
    assert_eq!(
        m::<Huf>("1000.50").to_paypal_value(Rounding::HalfEven)?,
        "1000"
    );
    assert_eq!(m::<Twd>("1000.50").to_paypal_value(Rounding::Ceil)?, "1001");
    for code in ["HUF", "JPY", "TWD"] {
        assert_eq!(paypal::exponent(code)?, 0);
    }
    Ok(())
}

#[test]
fn paypal_values_are_exact_and_limited_to_15_integer_digits() -> Result {
    let too_precise = m::<Eur>("10.005");
    assert_eq!(too_precise.to_paypal(EXACT), Err(Error::Rounding));
    assert_eq!(too_precise.to_paypal(Rounding::HalfEven)?.value, "10.00");
    assert_eq!(too_precise.to_paypal(Rounding::HalfExpand)?.value, "10.01");
    assert_eq!(m::<Usd>("0.10").to_paypal_value(EXACT)?, "0.10");
    let largest = "999999999999999.99";
    assert_eq!(m::<Usd>(largest).to_paypal_value(EXACT)?, largest);
    assert_eq!(
        m::<Usd>("1000000000000000").to_paypal_value(EXACT),
        Err(Error::AmountTooLarge)
    );
    assert_eq!(Money::<Usd>::from_paypal(largest)?.to_decimal(), largest);
    Ok(())
}

#[test]
fn paypal_zero_passes_negatives_fail_after_rounding() -> Result {
    assert_eq!(m::<Usd>("0").to_paypal_value(EXACT)?, "0.00");
    assert_eq!(m::<Jpy>("0").to_paypal_value(EXACT)?, "0");
    assert_eq!(Money::<Usd>::from_paypal("0.00")?.to_decimal(), "0.00");
    assert_eq!(Money::<Jpy>::from_paypal("0")?.to_decimal(), "0");
    assert_eq!(
        m::<Usd>("-5.05").to_paypal_value(EXACT),
        Err(Error::NegativeAmount)
    );
    assert_eq!(
        m::<Usd>("-0.004").to_paypal_value(Rounding::HalfEven)?,
        "0.00"
    );
    Ok(())
}

#[test]
fn paypal_reading_keeps_the_iso_scale_when_exact() -> Result {
    let longest = format!("1.{}", "0".repeat(30));
    assert_eq!(Money::<Usd>::from_paypal(&longest)?.to_decimal(), "1.00");
    assert_eq!(
        Money::<Usd>::from_paypal(&format!("{longest}0")),
        Err(Error::Syntax)
    );
    assert_eq!(Money::<Huf>::from_paypal("1000")?.to_decimal(), "1000.00");
    assert_eq!(Money::<Usd>::from_paypal("10")?.to_decimal(), "10.00");
    assert_eq!(Money::<Usd>::from_paypal("10.000")?.to_decimal(), "10.00");
    assert_eq!(Money::<Usd>::from_paypal(".5")?.to_decimal(), "0.50");
    assert_eq!(Money::<Jpy>::from_paypal("10.5")?.to_decimal(), "10.5");
    assert_eq!(Money::<Usd>::from_paypal("-1.50")?.to_decimal(), "-1.50");
    for value in [
        "", "1,00", "1e3", "+1", "1.", " 1", "0x10", "1.0.0", "-", "-.", ".",
    ] {
        assert_eq!(
            Money::<Usd>::from_paypal(value),
            Err(Error::Syntax),
            "{value:?}"
        );
    }
    Ok(())
}

#[test]
fn paypal_unlisted_currencies_and_its_table() -> Result {
    assert!(paypal::is_currency("usd") && !paypal::is_currency("TND"));
    assert_eq!(
        m::<Isk>("1").to_paypal(EXACT),
        Err(Error::UnsupportedCurrency)
    );
    assert_eq!(
        Money::<Kwd>::from_paypal("1.000"),
        Err(Error::UnsupportedCurrency)
    );
    // the currency is checked before the value
    assert_eq!(
        Money::<Kwd>::from_paypal("1e3"),
        Err(Error::UnsupportedCurrency)
    );
    let listed: Vec<CurrencyCode> = CurrencyCode::iso_codes()
        .filter(|code| paypal::is_currency(code.as_str()))
        .collect();
    assert_eq!(listed.len(), 25);
    for code in listed {
        let want = if ["HUF", "JPY", "TWD"].contains(&code.as_str()) {
            0
        } else {
            code.exponent()
        };
        assert_eq!(paypal::exponent(code.as_str())?, want);
        assert!([0, 2].contains(&want));
    }
    Ok(())
}

// --- Braintree ----------------------------------------------------------------------------------

#[test]
fn braintree_documented_examples() -> Result {
    assert_eq!(m::<Usd>("10").to_braintree(EXACT)?, "10.00");
    assert_eq!(Money::<Usd>::from_braintree("10.00")?.to_decimal(), "10.00");
    assert_eq!(Money::<Usd>::from_braintree("10")?.to_decimal(), "10.00");
    assert_eq!(m::<Jpy>("10").to_braintree(EXACT)?, "10");
    Ok(())
}

#[test]
fn braintree_zero_decimal_currencies_follow_braintree() -> Result {
    assert_eq!(braintree::exponent("LAK")?, 0);
    assert_eq!(Lak::CODE.exponent(), 2);
    assert_eq!(m::<Lak>("5000").to_braintree(EXACT)?, "5000");
    assert_eq!(
        m::<Lak>("5000.50").to_braintree(EXACT),
        Err(Error::Rounding)
    );
    assert_eq!(
        m::<Lak>("5000.50").to_braintree(Rounding::HalfEven)?,
        "5000"
    );
    assert_eq!(
        Money::<Lak>::from_braintree("5000")?.to_decimal(),
        "5000.00"
    );
    assert_eq!(Money::<Lak>::from_braintree("12.5")?.to_decimal(), "12.50");
    assert_eq!(m::<Clp>("5000").to_braintree(EXACT)?, "5000");
    assert_eq!(m::<Isk>("5").to_braintree(EXACT)?, "5");
    assert_eq!(m::<Ugx>("5").to_braintree(EXACT)?, "5");
    assert_eq!(Money::<Jpy>::from_braintree("5.25")?.to_decimal(), "5.25");
    Ok(())
}

#[test]
fn braintree_amounts_are_greater_than_zero() -> Result {
    assert_eq!(
        m::<Usd>("-5").to_braintree(EXACT),
        Err(Error::NegativeAmount)
    );
    assert_eq!(m::<Usd>("0").to_braintree(EXACT), Err(Error::ZeroAmount));
    // checked after rounding: -0.004 rounds to zero, which is refused as zero
    assert_eq!(
        m::<Usd>("-0.004").to_braintree(Rounding::HalfEven),
        Err(Error::ZeroAmount)
    );
    assert_eq!(m::<Usd>("0.01").to_braintree(EXACT)?, "0.01");
    assert_eq!(Money::<Usd>::from_braintree("-5.00"), Err(Error::Syntax));
    let too_precise = m::<Eur>("10.005");
    assert_eq!(too_precise.to_braintree(EXACT), Err(Error::Rounding));
    assert_eq!(too_precise.to_braintree(Rounding::HalfExpand)?, "10.01");
    Ok(())
}

#[test]
fn braintree_format_currencies_and_table() -> Result {
    for value in ["", "1,00", "1e3", "+1", "1.", ".5", " 1", "1.0.0"] {
        assert_eq!(
            Money::<Usd>::from_braintree(value),
            Err(Error::Syntax),
            "{value:?}"
        );
    }
    let big = "123456789012345678.90";
    assert_eq!(Money::<Usd>::from_braintree(big)?.to_decimal(), big);
    assert!(braintree::is_currency("usd"));
    assert!(!braintree::is_currency("KWD") && !braintree::is_currency("BGN"));
    assert_eq!(
        m::<Kwd>("1").to_braintree(EXACT),
        Err(Error::UnsupportedCurrency)
    );
    assert_eq!(
        Money::<Bhd>::from_braintree("1.000"),
        Err(Error::UnsupportedCurrency)
    );
    let asterisked = "BIF CLP DJF GNF ISK JPY KMF KRW LAK PYG RWF UGX VND VUV XAF XOF XPF";
    let zero: Vec<String> = CurrencyCode::iso_codes()
        .map(|code| code.as_str().to_owned())
        .filter(|code| braintree::rule(code) == Some(0))
        .collect();
    assert_eq!(zero.join(" "), asterisked);
    assert_eq!(braintree::exponent("ZWD")?, 2);
    assert_eq!(braintree::exponent("HRK")?, 2);
    Ok(())
}

// --- Klarna -------------------------------------------------------------------------------------

#[test]
fn klarna_documented_examples() -> Result {
    assert_eq!(Money::<Usd>::from_klarna(1000)?.to_decimal(), "10.00");
    assert_eq!(Money::<Gbp>::from_klarna(500)?.to_decimal(), "5.00");
    assert_eq!(Money::<Eur>::from_klarna(50)?.to_decimal(), "0.50");
    assert_eq!(Money::<Sek>::from_klarna(100)?.to_decimal(), "1.00");
    assert_eq!(m::<Eur>("25").to_klarna(EXACT)?, 2500);
    assert_eq!(m::<Eur>("20").to_klarna(EXACT)?, 2000);
    assert_eq!(m::<Huf>("1000").to_klarna(EXACT)?, 100_000);
    assert_eq!(Money::<Huf>::from_klarna(100_000)?.to_decimal(), "1000.00");
    Ok(())
}

#[test]
fn klarna_rounding_signs_and_limits() -> Result {
    let too_precise = m::<Eur>("10.005");
    assert_eq!(too_precise.to_klarna(EXACT), Err(Error::Rounding));
    assert_eq!(too_precise.to_klarna(Rounding::HalfEven)?, 1000);
    // discount order lines are negative; zero passes
    assert_eq!(m::<Eur>("-5").to_klarna(EXACT)?, -500);
    assert_eq!(Money::<Eur>::from_klarna(-500)?.to_decimal(), "-5.00");
    assert_eq!(m::<Sek>("0").to_klarna(EXACT)?, 0);
    assert_eq!(m::<Eur>("-0.004").to_klarna(Rounding::HalfEven)?, 0);
    let huge = Money::<Eur>::from_minor(Int::from(1_i64 << 60));
    assert_eq!(huge.to_klarna(EXACT), Err(Error::AmountTooLarge));
    let largest = Money::<Eur>::from_minor(Int::from((1_i64 << 53) - 1));
    assert_eq!(largest.to_klarna(EXACT)?, (1_i64 << 53) - 1);
    let past = Money::<Eur>::from_minor(Int::from(1_i64 << 53));
    assert_eq!(past.to_klarna(EXACT), Err(Error::AmountTooLarge));
    // reading back takes any i64
    assert_eq!(
        Money::<Eur>::from_klarna(1 << 53)?.to_minor()?,
        Int::from(1_i64 << 53)
    );
    assert_eq!(
        Money::<Usd>::from_checkout(i64::MAX)?.to_minor()?,
        Int::from(i64::MAX)
    );
    Ok(())
}

#[test]
fn klarna_only_the_purchase_currencies() -> Result {
    assert!(klarna::is_currency("sek") && !klarna::is_currency("JPY"));
    assert_eq!(
        m::<Jpy>("1").to_klarna(EXACT),
        Err(Error::UnsupportedCurrency)
    );
    assert_eq!(
        AnyMoney::from_klarna(1, iso("BRL")),
        Err(Error::UnsupportedCurrency)
    );
    let listed: Vec<String> = CurrencyCode::iso_codes()
        .map(|code| code.as_str().to_owned())
        .filter(|code| klarna::is_currency(code))
        .collect();
    assert_eq!(
        listed.join(" "),
        "AUD CAD CHF CZK DKK EUR GBP HUF MXN NOK NZD PLN RON SEK USD"
    );
    assert_eq!(klarna::exponent("huf")?, 2);
    Ok(())
}
