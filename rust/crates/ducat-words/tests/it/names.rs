//! CLDR's currency names as `amount_in_words`' defaults (feature `cldr-names`). The expected text is
//! ducat's `amountInWords` with `Intl`'s names on Node 24 (ICU 78.3), except where noted; without
//! the feature, the defaults are an error.

use ducat::{AnyMoney, CurrencyCode};
use ducat_words::{AmountInWordsOptions, ENGLISH, Error, SpelloutRules, amount_in_words};

/// `units` × 10^−`scale` of `code` (an ISO code, else a custom one at scale 2), in words with
/// the default options.
fn words(units: i64, scale: u16, code: &str, rules: &SpelloutRules) -> Result<String, Error> {
    let currency = CurrencyCode::iso(code)
        .or_else(|_| CurrencyCode::custom(code, 2))
        .unwrap();
    let money = AnyMoney::from_units(units, scale, currency).unwrap();
    amount_in_words(&money, rules, &AmountInWordsOptions::default())
}

#[cfg(feature = "cldr-names")]
mod cldr {
    use super::*;
    use ducat_words::{
        DUTCH, FRENCH, GERMAN, ITALIAN, Locale, PORTUGUESE, SPANISH, UnitNames, currency_names,
    };

    #[test]
    fn names_by_plural_category_as_intl_writes_them() {
        let cases: [(i64, u16, &str, &SpelloutRules, &str); 16] = [
            (100, 2, "EUR", &ENGLISH, "one euro and 00/100"),
            (200, 2, "USD", &ENGLISH, "two US dollars and 00/100"),
            (21, 0, "JPY", &ENGLISH, "twenty-one Japanese yen"),
            (100, 2, "ITL", &ENGLISH, "one Italian lira and 00/100"),
            (
                100_000_000,
                2,
                "EUR",
                &GERMAN,
                "eine Million Euro und 00/100",
            ),
            // many: CLDR 48 has no many names here, so other's, as Intl
            (100_000_000, 2, "EUR", &FRENCH, "un million euros et 00/100"),
            (
                200_000_000,
                2,
                "EUR",
                &FRENCH,
                "deux millions euros et 00/100",
            ),
            (
                100_000_100,
                2,
                "EUR",
                &FRENCH,
                "un million un euros et 00/100",
            ),
            (100_000_000, 2, "EUR", &SPANISH, "un millón euros y 00/100"),
            (100, 2, "GBP", &SPANISH, "un libra esterlina y 00/100"),
            (
                100_000_000,
                2,
                "USD",
                &ITALIAN,
                "un milione dollari statunitensi e 00/100",
            ),
            (100, 2, "USD", &ITALIAN, "un dollaro statunitense e 00/100"),
            (
                100_000_000,
                2,
                "EUR",
                &PORTUGUESE,
                "um milhão Euros e 00/100",
            ),
            (100, 2, "BRL", &PORTUGUESE, "um Real brasileiro e 00/100"),
            (1_000_000, 0, "JPY", &DUTCH, "een miljoen Japanse yen"),
            (101, 2, "USD", &DUTCH, "een Amerikaanse dollar en 01/100"),
        ];
        for (units, scale, code, rules, expected) in cases {
            assert_eq!(
                words(units, scale, code, rules).unwrap(),
                expected,
                "{code} {units}"
            );
        }
    }

    #[test]
    fn codes_cldr_doesnt_name_are_written_as_intl_writes_them() {
        // a three-letter code with no name: the code, upper-cased
        assert_eq!(
            words(200, 2, "XBT", &ENGLISH).unwrap(),
            "two XBT and 00/100"
        );
        assert_eq!(
            words(200, 2, "btc", &ENGLISH).unwrap(),
            "two BTC and 00/100"
        );
        // a lower-case code is read as Intl reads it
        assert_eq!(
            words(200, 2, "eur", &ENGLISH).unwrap(),
            "two euros and 00/100"
        );
        assert_eq!(
            words(200, 2, "XTS", &FRENCH).unwrap(),
            "deux (devises de test) et 00/100"
        );
        // Intl names only three-letter codes (ducat's RangeError)
        assert_eq!(words(200, 2, "USDC", &ENGLISH), Err(Error::NoCurrencyNames));
        assert_eq!(words(200, 2, "E1R", &ENGLISH), Err(Error::NoCurrencyNames));
    }

    #[test]
    fn follows_tr35_where_icu_puts_the_currencys_own_pattern_first() {
        // CLDR gives ITL in it its own pattern, `¤ #,##0.00`; ICU writes its symbol before the
        // name (`ITL un lire italiane e 00/100` on Node 24), as ducat-format declines to
        assert_eq!(
            words(100, 2, "ITL", &ITALIAN).unwrap(),
            "un lire italiane e 00/100"
        );
    }

    #[test]
    fn the_callers_names_win() {
        let options = AmountInWordsOptions::new(UnitNames::new("Euronen"));
        let money = AnyMoney::from_units(200, 2, CurrencyCode::iso("EUR").unwrap()).unwrap();
        assert_eq!(
            amount_in_words(&money, &GERMAN, &options).unwrap(),
            "zwei Euronen und 00/100"
        );
    }

    /// The cases `scripts/words-names-cases.mjs` writes from ducat on Node, at the path in
    /// `DUCAT_WORDS_NAMES_CASES`; not run by default (it needs the TypeScript build).
    #[test]
    #[ignore = "needs DUCAT_WORDS_NAMES_CASES from scripts/words-names-cases.mjs"]
    fn matches_ducat_on_node() {
        let path = std::env::var("DUCAT_WORDS_NAMES_CASES").expect("DUCAT_WORDS_NAMES_CASES");
        let file: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let mut differences = Vec::new();
        let cases = file["cases"].as_array().unwrap();
        for case in cases {
            let field = |name: &str| case[name].as_str().unwrap();
            let rules = match field("language") {
                "en" => ENGLISH,
                "de" => GERMAN,
                "fr" => FRENCH,
                "es" => SPANISH,
                "it" => ITALIAN,
                "nl" => DUTCH,
                _ => PORTUGUESE,
            };
            let (code, expected) = (field("code"), field("expected"));
            let units: i64 = field("units").parse().unwrap();
            let scale = u16::try_from(case["scale"].as_u64().unwrap()).unwrap();
            let got = words(units, scale, code, &rules);
            let same = match &got {
                Ok(text) => text == expected,
                // ducat's RangeError for a code Intl can't name
                Err(Error::NoCurrencyNames) => expected.starts_with("RangeError"),
                Err(_) => false,
            };
            // ICU writes ITL's own symbol before its name in it (design.md); the crate doesn't
            let documented = field("language") == "it"
                && code == "ITL"
                && got.as_deref().ok() == expected.strip_prefix("ITL\u{a0}");
            if !same && !documented {
                differences.push(format!(
                    "{} {code} {units}: {expected:?}, got {got:?}",
                    field("language")
                ));
            }
        }
        println!("{} cases from {}", cases.len(), file["runtime"]);
        assert!(differences.is_empty(), "{}", differences.join("\n"));
    }

    #[test]
    fn currency_names_gives_cldrs_forms() {
        assert_eq!(
            currency_names(Locale::En, "EUR"),
            Some(UnitNames::new("euros").one("euro"))
        );
        assert_eq!(
            currency_names(Locale::Fr, "usd"),
            Some(UnitNames::new("dollars des États-Unis").one("dollar des États-Unis"))
        );
        // CLDR's one is other's: left out
        assert_eq!(
            currency_names(Locale::De, "EUR"),
            Some(UnitNames::new("Euro"))
        );
        assert_eq!(currency_names(Locale::En, "XBT"), None);
        assert_eq!(currency_names(Locale::En, "USDC"), None);
    }
}

#[cfg(not(feature = "cldr-names"))]
#[test]
fn without_cldr_names_the_caller_names_the_currency() {
    assert_eq!(words(100, 2, "EUR", &ENGLISH), Err(Error::NoCurrencyNames));
}
