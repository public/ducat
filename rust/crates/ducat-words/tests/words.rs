//! ducat's own words tests (test/words.test.ts), ported for what the spec's vectors don't cover:
//! amounts in words with their options, and the error paths. ducat takes the currency's name from
//! `Intl`; here the caller gives it, so each test passes the names `Intl` writes.

use ducat::{AnyMoney, CurrencyCode, Rounding};
use ducat_words::{
    AmountInWordsOptions, CompiledRules, DUTCH, ENGLISH, Error, FRENCH, GERMAN, Gender, ITALIAN,
    PORTUGUESE, SPANISH, SpelloutRules, UnitNames, amount_in_words, spell_out, spell_out_int,
};

/// ducat's tests write CLDR's soft hyphens (U+00AD) as `·`.
fn soft(text: &str) -> String {
    text.replace('·', "\u{ad}")
}

fn money(text: &str, code: &str) -> AnyMoney {
    let places = text
        .split_once('.')
        .map_or(0, |(_, fraction)| fraction.len());
    let currency = CurrencyCode::iso(code).unwrap();
    AnyMoney::parse_at(
        text,
        currency,
        u16::try_from(places).unwrap(),
        Rounding::Unnecessary,
    )
    .unwrap()
}

fn words(
    amount: &str,
    code: &str,
    rules: &SpelloutRules,
    names: UnitNames,
) -> Result<String, Error> {
    amount_in_words(
        &money(amount, code),
        rules,
        &AmountInWordsOptions::new(names),
    )
}

fn euros() -> UnitNames {
    UnitNames::new("euros").one("euro")
}

#[test]
fn lists_public_rule_sets() {
    let english = CompiledRules::new(&ENGLISH).unwrap();
    let sets: Vec<&str> = english.rule_sets().collect();
    assert!(sets.contains(&"%spellout-cardinal"));
    assert!(!sets.iter().any(|name| name.starts_with("%%")));
}

#[test]
fn whole_units_with_the_currency_name_and_the_minor_part_cheque_style() {
    assert_eq!(
        words("123.45", "EUR", &ENGLISH, euros()).unwrap(),
        "one hundred twenty-three euros and 45/100"
    );
    assert_eq!(
        words("1.00", "EUR", &ENGLISH, euros()).unwrap(),
        "one euro and 00/100"
    );
    let yen = UnitNames::new("Japanese yen");
    assert_eq!(
        words("1000000", "JPY", &ENGLISH, yen).unwrap(),
        "one million Japanese yen"
    );
    let euro = UnitNames::new("Euro");
    assert_eq!(
        words("123.45", "EUR", &GERMAN, euro.clone()).unwrap(),
        soft("ein·hundert·drei·und·zwanzig Euro und 45/100")
    );
    assert_eq!(
        words("123.45", "EUR", &FRENCH, euros()).unwrap(),
        "cent vingt-trois euros et 45/100"
    );
    assert_eq!(
        words("123.45", "EUR", &SPANISH, euros()).unwrap(),
        "ciento veintitrés euros y 45/100"
    );
    let italian = UnitNames::new("euro");
    assert_eq!(
        words("123.45", "EUR", &ITALIAN, italian.clone()).unwrap(),
        soft("cento·venti·tré euro e 45/100")
    );
    let portuguese = UnitNames::new("Euros").one("Euro");
    assert_eq!(
        words("123.45", "EUR", &PORTUGUESE, portuguese).unwrap(),
        "cento e vinte e três Euros e 45/100"
    );
    assert_eq!(
        words("123.45", "EUR", &DUTCH, italian).unwrap(),
        soft("honderddrie·ën·twintig euro en 45/100")
    );
}

#[test]
fn agrees_with_the_gender_it_is_given() {
    assert_eq!(
        words("21.00", "EUR", &SPANISH, euros()).unwrap(),
        "veintiún euros y 00/100"
    );
    let pounds = UnitNames::new("libras esterlinas").one("libra esterlina");
    let feminine = AmountInWordsOptions {
        gender: Some(Gender::Feminine),
        ..AmountInWordsOptions::new(pounds)
    };
    assert!(
        amount_in_words(&money("21", "GBP"), &SPANISH, &feminine)
            .unwrap()
            .starts_with("veintiuna ")
    );
    assert_eq!(
        words("21.00", "EUR", &FRENCH, euros()).unwrap(),
        "vingt-et-un euros et 00/100"
    );
    let feminine = AmountInWordsOptions {
        gender: Some(Gender::Feminine),
        ..AmountInWordsOptions::new(euros())
    };
    assert!(
        amount_in_words(&money("21", "EUR"), &FRENCH, &feminine)
            .unwrap()
            .starts_with("vingt-et-une ")
    );
    // English has one cardinal, whatever the gender
    assert_eq!(
        amount_in_words(&money("21.00", "EUR"), &ENGLISH, &feminine).unwrap(),
        "twenty-one euros and 00/100"
    );
}

#[test]
fn spells_the_minor_part_with_names_the_caller_gives() {
    let dollars = UnitNames::new("US dollars").one("US dollar");
    let cents = AmountInWordsOptions {
        minor: Some(UnitNames::new("cents").one("cent")),
        ..AmountInWordsOptions::new(dollars)
    };
    assert_eq!(
        amount_in_words(&money("0.45", "USD"), &ENGLISH, &cents).unwrap(),
        "forty-five cents"
    );
    assert_eq!(
        amount_in_words(&money("1.01", "USD"), &ENGLISH, &cents).unwrap(),
        "one US dollar and one cent"
    );
    let pounds = UnitNames::new("British pounds").one("British pound");
    let pence = AmountInWordsOptions {
        minor: Some(UnitNames::new("pence").one("penny")),
        ..AmountInWordsOptions::new(pounds)
    };
    assert_eq!(
        amount_in_words(&money("2.00", "GBP"), &ENGLISH, &pence).unwrap(),
        "two British pounds"
    );
}

#[test]
fn the_minor_part_at_the_amount_scale_and_the_range_of_icu() {
    assert_eq!(
        words("1.005", "EUR", &ENGLISH, euros()).unwrap(),
        "one euro and 005/1000"
    );
    let dollars = UnitNames::new("US dollars").one("US dollar");
    assert_eq!(
        words("9223372036854775807.00", "USD", &ENGLISH, dollars.clone()).unwrap(),
        "9,223,372,036,854,775,807 US dollars and 00/100"
    );
    assert_eq!(
        words("1000000000000000000000.00", "USD", &ENGLISH, dollars),
        Err(Error::OutOfRange)
    );
}

#[test]
fn picks_the_plural_form_of_the_minor_unit_exactly_past_2_53() {
    // 10^18 + 1 hundred-sextillionths: French 'many' is for exact multiples of a million only
    let names = UnitNames::new("centimes")
        .one("centime")
        .many("de centimes");
    let options = AmountInWordsOptions {
        minor: Some(names),
        ..AmountInWordsOptions::new(euros())
    };
    let small = money("0.00001000000000000000001", "EUR");
    assert_eq!(
        amount_in_words(&small, &FRENCH, &options).unwrap(),
        "1\u{202f}000\u{202f}000\u{202f}000\u{202f}000\u{202f}000\u{202f}001 centimes"
    );
    let round = money("0.00001000000000000000000", "EUR");
    assert_eq!(
        amount_in_words(&round, &FRENCH, &options).unwrap(),
        "1\u{202f}000\u{202f}000\u{202f}000\u{202f}000\u{202f}000\u{202f}000 de centimes"
    );
}

#[test]
fn takes_a_rule_set_and_refuses_negative_amounts() {
    let verbose = AmountInWordsOptions {
        rule_set: Some("%spellout-cardinal-verbose"),
        ..AmountInWordsOptions::new(euros())
    };
    assert_eq!(
        amount_in_words(&money("3.00", "EUR"), &ENGLISH, &verbose).unwrap(),
        "three euros and 00/100"
    );
    assert_eq!(
        words("-1.00", "EUR", &ENGLISH, euros()),
        Err(Error::NegativeAmount)
    );
    let nope = AmountInWordsOptions {
        rule_set: Some("%nope"),
        ..AmountInWordsOptions::new(euros())
    };
    assert_eq!(
        amount_in_words(&money("1.00", "EUR"), &ENGLISH, &nope),
        Err(Error::NoRuleSet)
    );
    let private = AmountInWordsOptions {
        rule_set: Some("%%and"),
        ..AmountInWordsOptions::new(euros())
    };
    assert_eq!(
        amount_in_words(&money("1.00", "EUR"), &ENGLISH, &private),
        Err(Error::PrivateRuleSet)
    );
}

#[test]
fn spells_whole_numbers_by_any_public_rule_set() {
    assert_eq!(
        spell_out(123, &ENGLISH, None).unwrap(),
        "one hundred twenty-three"
    );
    assert_eq!(
        spell_out(21, &ENGLISH, Some("%spellout-ordinal")).unwrap(),
        "twenty-first"
    );
    assert_eq!(
        spell_out(-1999, &ENGLISH, None).unwrap(),
        "minus one thousand nine hundred ninety-nine"
    );
    assert_eq!(spell_out(21, &SPANISH, None).unwrap(), "veintiún");
    assert_eq!(
        spell_out(5, &ENGLISH, Some("%%2d-year")),
        Err(Error::PrivateRuleSet)
    );
    assert_eq!(
        spell_out_int(&ducat::Int::from(7), &ENGLISH, None).unwrap(),
        "seven"
    );
}

#[test]
fn refuses_values_outside_the_int64_range() {
    let max = i128::from(i64::MAX);
    assert_eq!(
        spell_out(max, &ENGLISH, None).unwrap(),
        "9,223,372,036,854,775,807"
    );
    assert_eq!(
        spell_out(-max, &SPANISH, None).unwrap(),
        "menos 9.223.372.036.854.775.807"
    );
    for (value, rules) in [
        (max + 1, ENGLISH),
        (-(max + 1), ENGLISH),
        (max + 1, SPANISH),
        (-(max + 1), SPANISH),
    ] {
        assert_eq!(spell_out(value, &rules, None), Err(Error::OutOfRange));
    }
}

#[test]
fn refuses_ordinals_whose_plural_form_icu_picks_from_a_32_bit_truncation() {
    let ordinal = Some("%spellout-ordinal");
    assert_eq!(
        spell_out(8_721_694_496_465_577_220, &ENGLISH, ordinal),
        Err(Error::PluralTruncation)
    );
    assert_eq!(
        spell_out(3_827_107_958_841_198_709, &ENGLISH, ordinal).unwrap(),
        "3,827,107,958,841,198,709th"
    );
    assert_eq!(
        spell_out(1_000_000_000_000_000_000, &ENGLISH, ordinal).unwrap(),
        "1,000,000,000,000,000,000th"
    );
}

#[test]
fn adversarial_rules_are_errors_not_panics() {
    for text in [
        "0: one;",
        "%a:\n0: <<;",
        "%a:\n0: [never closed;",
        "%a:\n0: $(cardinal,one{x}other{y};",
        "%a:\n1/1: x;",
        "%a:\n-x: >>>;\n0: zero;",
        "%a:\n0: =%a=;",
        "%a:\nno colon",
    ] {
        let rules = SpelloutRules {
            locale: ducat_words::Locale::En,
            rules: text,
        };
        let result = spell_out(-5, &rules, Some("%a")).and(spell_out(5, &rules, Some("%a")));
        assert!(result.is_err(), "{text:?}: {result:?}");
    }
}
