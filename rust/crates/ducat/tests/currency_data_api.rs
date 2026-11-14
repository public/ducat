//! ducat's own tests of its currency data (test/cash.test.ts, test/historic.test.ts,
//! test/crypto.test.ts), ported value by value: cash rounding through `Money`, the policy built
//! from a rule, and the historic and crypto codes as currencies of their own.

use ducat::cash::{CashOptions, cash_policy, cash_rule, cash_rules};
use ducat::iso::{Chf, Eur};
use ducat::policy::RoundingPolicy;
use ducat::{AnyMoney, CurrencyCode, Error, Money, Rounding, crypto, historic};

type Result = core::result::Result<(), Error>;

/// ducat's `cr`: an amount cash-rounded, as a decimal.
fn cr(amount: &str, currency: &str, country: Option<&str>) -> String {
    let money: AnyMoney = AnyMoney::parse(amount, currency.parse().unwrap()).unwrap();
    let options = CashOptions {
        country,
        ..CashOptions::default()
    };
    money.cash_round(&options).unwrap().to_decimal()
}

#[test]
fn cash_rounding() -> Result {
    let chf = ["10.01", "10.02", "10.03", "10.04", "10.07", "10.08"]
        .map(|amount| cr(amount, "CHF", None));
    assert_eq!(chf, ["10.00", "10.00", "10.05", "10.05", "10.05", "10.10"]);
    assert_eq!(
        [cr("10.49", "SEK", None), cr("10.50", "SEK", None)],
        ["10.00", "11.00"]
    );
    assert_eq!(
        ["0.24", "0.25", "0.74", "0.75"].map(|amount| cr(amount, "DKK", None)),
        ["0.00", "0.50", "0.50", "1.00"]
    );
    assert_eq!(cr("1.02", "EUR", None), "1.02");
    assert_eq!(cr("1.02", "EUR", Some("BE")), "1.00");
    assert_eq!(cr("1.03", "EUR", Some("NL")), "1.05");
    assert_eq!(cr("1.03", "EUR", Some("DE")), "1.03");
    assert_eq!(cr("1.01", "GBP", None), "1.01");
    // Serbia rounds a 50 para tie down; everything else ties away from zero
    assert_eq!(
        [
            cr("10.50", "RSD", None),
            cr("10.51", "RSD", None),
            cr("-10.50", "RSD", None)
        ],
        ["10.00", "11.00", "-10.00"]
    );
    assert_eq!(
        [
            cr("1234.56", "AMD", None),
            cr("12345.67", "UZS", None),
            cr("10.10", "MRU", None)
        ],
        ["1230.00", "12350.00", "10.20"]
    );
    // only the verified rules, on request
    let verified = CashOptions {
        verified_only: true,
        ..CashOptions::default()
    };
    let price: Money<Chf> = "10.03".parse()?;
    assert_eq!(price.cash_round(&verified)?.to_decimal(), "10.03");
    let krona: AnyMoney = "10.49 SEK".parse()?;
    assert_eq!(krona.cash_round(&verified)?.to_decimal(), "10.00");
    // a larger scale is kept by cash_round; the policy lands on the exponent
    let precise = Money::<Chf>::from_units(10_034, 3)?;
    assert_eq!(
        precise.cash_round(&CashOptions::default())?.to_string(),
        "10.050 CHF"
    );
    let chf_code: CurrencyCode = "CHF".parse()?;
    let policy = cash_policy(chf_code, &CashOptions::default())?;
    assert_eq!(precise.round(policy)?.to_string(), "10.05 CHF");
    assert_eq!(
        policy,
        RoundingPolicy::new(Rounding::HalfExpand)
            .with_scale(2)?
            .with_increment(5)?
            .for_currency(chf_code)
    );
    assert_eq!(
        cash_policy("EUR".parse()?, &CashOptions::default()),
        Err(Error::NoCashRule)
    );
    let euros: Money<Eur> = "1.00".parse()?;
    assert!(matches!(
        euros.round(policy),
        Err(Error::CurrencyMismatch { .. })
    ));
    Ok(())
}

#[test]
fn cash_rules_lookup() -> Result {
    // every rule's currency is an active code, so none is dropped
    assert_eq!(cash_rules().count(), 44);
    assert!(cash_rules().all(|rule| rule.increment() > 0 && !rule.countries().is_empty()));
    assert_eq!(cash_rule("GBP".parse()?, None), None);
    assert_eq!(cash_rule("EUR".parse()?, None), None);
    assert_eq!(cash_rule("EUR".parse()?, Some("DE")), None);
    assert_eq!(cash_rule("CHF".parse()?, Some("DE")), None);
    assert_eq!(
        cash_rule("EUR".parse()?, Some("NL")).map(|rule| rule.countries()),
        Some(&["NL"][..])
    );
    assert_eq!(
        cash_rule("EUR".parse()?, Some("FI")).map(|rule| rule.increment()),
        Some(5)
    );
    assert_eq!(
        cash_rule("RSD".parse()?, None).map(|rule| rule.rounding()),
        Some(Rounding::HalfTrunc)
    );
    Ok(())
}

#[test]
fn historic_codes() -> Result {
    let kuna = historic::currency("HRK").expect("HRK");
    assert_eq!(
        (
            kuna.name(),
            kuna.numeric(),
            kuna.exponent(),
            kuna.withdrawn()
        ),
        ("Kuna", Some("191"), 2, Some("2023-01"))
    );
    assert_eq!(
        historic::currency("ANG").and_then(|entry| entry.withdrawn()),
        Some("2025-03")
    );
    assert_eq!(
        historic::currency("BGN").and_then(|entry| entry.withdrawn()),
        Some("2026-01")
    );
    let offshore = historic::currency("CNH").expect("CNH");
    assert_eq!(
        (
            offshore.numeric(),
            offshore.withdrawn(),
            offshore.exponent()
        ),
        (None, None, 2)
    );
    assert!(historic::currencies().all(|entry| !entry.code().is_iso()));
    assert_eq!(historic::currency("EUR"), None);
    // every table code is one `custom` would make: none collides with an active or N.A. code
    for entry in historic::currencies() {
        assert_eq!(
            Ok(entry.code()),
            CurrencyCode::custom(entry.code().as_str(), entry.exponent())
        );
    }
    for unit in crypto::units() {
        assert_eq!(
            Ok(unit.code()),
            CurrencyCode::custom(unit.code().as_str(), unit.decimals())
        );
    }
    // never an active code: they don't parse, and are built on request with ISO's old exponent
    assert!("PTE".parse::<CurrencyCode>().is_err());
    let escudo = CurrencyCode::historic("PTE")?;
    assert_eq!(AnyMoney::parse("200", escudo)?.to_string(), "200 PTE");
    assert_eq!(
        AnyMoney::parse("7.53", CurrencyCode::historic("LVL")?)?
            .to_minor()?
            .to_string(),
        "753"
    );
    assert_eq!(
        CurrencyCode::historic("ANG")?,
        CurrencyCode::custom("ANG", 2)?
    );
    assert_eq!(CurrencyCode::historic("EUR"), Err(Error::UnknownCurrency));
    // an active code can't be made custom, so it can't be shadowed
    assert_eq!(CurrencyCode::custom("XCG", 2), Err(Error::InvalidCurrency));
    Ok(())
}

#[test]
fn crypto_units_and_base_units() -> Result {
    let btc = crypto::unit("BTC").expect("BTC");
    assert_eq!(
        (
            btc.name(),
            btc.decimals(),
            btc.base_unit(),
            btc.network(),
            btc.contract()
        ),
        ("Bitcoin", 8, Some("satoshi"), "Bitcoin", None)
    );
    assert_eq!(crypto::unit("ETH").map(|unit| unit.decimals()), Some(18));
    assert!(
        crypto::unit("USDC")
            .and_then(|unit| unit.contract())
            .is_some_and(|contract| contract.len() == 42)
    );
    assert_eq!(crypto::unit("XRP"), None);
    assert!(crypto::units().all(|unit| !unit.code().is_iso()));
    let (btc, eth) = (CurrencyCode::crypto("BTC")?, CurrencyCode::crypto("ETH")?);
    assert_eq!(
        AnyMoney::parse("1", btc)?.to_base_units()?.to_string(),
        "100000000"
    );
    assert_eq!(
        AnyMoney::parse("-0.000000000000000001", eth)?
            .to_base_units()?
            .to_string(),
        "-1"
    );
    assert_eq!(
        AnyMoney::from_base_units("100000000", btc)?.to_string(),
        "1.00000000 BTC"
    );
    assert_eq!(
        AnyMoney::from_base_units("-5", CurrencyCode::crypto("SOL")?)?.to_string(),
        "-0.000000005 SOL"
    );
    assert_eq!(
        AnyMoney::from_units(15, 9, btc)?.to_base_units(),
        Err(Error::Rounding)
    );
    assert_eq!(
        AnyMoney::from_units(10, 9, btc)?
            .to_base_units()?
            .to_string(),
        "1"
    );
    assert_eq!(
        "12.34".parse::<Money<Eur>>()?.to_base_units()?.to_string(),
        "1234"
    );
    for bad in ["", "-", "+1", "01", "1.0", "1e3", " 1", "1_000", "0x10"] {
        assert_eq!(
            AnyMoney::from_base_units(bad, eth),
            Err(Error::Syntax),
            "{bad:?}"
        );
    }
    assert_eq!(
        AnyMoney::from_base_units(&"1".repeat(1002), eth),
        Err(Error::Syntax)
    );
    assert_eq!(CurrencyCode::crypto("XRP"), Err(Error::UnknownCurrency));
    Ok(())
}

#[test]
fn numeric_codes_and_typed_base_units() -> Result {
    use ducat::currencies::{
        currency_from_number, currency_from_numeric, minor_unit, numeric_code,
    };
    assert_eq!(currency_from_number(8)?, Some("ALL"));
    assert_eq!(currency_from_number(959)?, Some("XAU"));
    assert_eq!(currency_from_number(1000), Err(Error::InvalidNumericCode));
    assert_eq!(currency_from_numeric(" 978 ")?, Some("EUR"));
    assert_eq!(currency_from_numeric("9.5"), Err(Error::InvalidNumericCode));
    assert_eq!(numeric_code("XAU"), Some("959"));
    let eur: CurrencyCode = "EUR".parse()?;
    assert_eq!(eur.numeric_code(), Some("978"));
    assert_eq!(CurrencyCode::historic("BGN")?.numeric_code(), None);
    assert_eq!(minor_unit("JPY".parse()?).to_decimal(), "1");
    assert_eq!(
        Money::<Eur>::from_base_units("1234")?.to_string(),
        "12.34 EUR"
    );
    assert_eq!(Money::<Eur>::from_base_units("12.34"), Err(Error::Syntax));
    Ok(())
}
