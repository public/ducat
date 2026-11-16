//! Amounts and numbers in words for [`ducat`], as cheques, invoices and legal documents need: a
//! port of ducat's `@ducatjs/money/words`.
//!
//! The words come from CLDR's rule-based number formats (RBNF), the rules ICU uses, through a
//! small interpreter of their text (`data/rbnf/*.txt`, CLDR release 49), with no ICU. Each
//! language is a feature: `en`, `de`, `fr`, `es`, `it`, `nl`, `pt`.
//!
//! ```
//! # #[cfg(feature = "en")] {
//! use ducat::iso::Eur;
//! use ducat::Money;
//! use ducat_words::{AmountInWordsOptions, ENGLISH, UnitNames, amount_in_words, spell_out};
//!
//! assert_eq!(spell_out(123, &ENGLISH, None)?, "one hundred twenty-three");
//! assert_eq!(spell_out(21, &ENGLISH, Some("%spellout-ordinal"))?, "twenty-first");
//!
//! let euros = UnitNames::new("euros").one("euro");
//! let price: Money<Eur> = "123.45".parse().unwrap();
//! let options = AmountInWordsOptions::new(euros);
//! assert_eq!(
//!     amount_in_words(&price.to_any(), &ENGLISH, &options)?,
//!     "one hundred twenty-three euros and 45/100"
//! );
//! # }
//! # Ok::<(), ducat_words::Error>(())
//! ```
//!
//! ducat takes the currency's name from the runtime's `Intl`; there is no `Intl` here. With the
//! feature `cldr-names` (not a default), the crate carries CLDR 48's currency names for the
//! languages built in, the data ICU 78.3 gives `Intl`, and [`amount_in_words`] uses them when the
//! options name no currency ([`AmountInWordsOptions::default`]); without it, or for names of your
//! own, the caller gives the name, in the plural forms the language uses
//! ([`AmountInWordsOptions::new`]), as ducat already has the caller give the minor unit's name.
//!
//! ```
//! # #[cfg(all(feature = "en", feature = "fr", feature = "cldr-names"))] {
//! use ducat::iso::Eur;
//! use ducat::Money;
//! use ducat_words::{AmountInWordsOptions, ENGLISH, FRENCH, amount_in_words};
//!
//! let price: Money<Eur> = "1000000".parse().unwrap();
//! let cldr = AmountInWordsOptions::default();
//! assert_eq!(amount_in_words(&price.to_any(), &FRENCH, &cldr)?, "un million euros et 00/100");
//! let one: Money<Eur> = "1.00".parse().unwrap();
//! assert_eq!(amount_in_words(&one.to_any(), &ENGLISH, &cldr)?, "one euro and 00/100");
//! # }
//! # Ok::<(), ducat_words::Error>(())
//! ```

#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]
#![warn(missing_docs)]

extern crate alloc;

#[rustfmt::skip]
mod cldr;
mod digits;
#[cfg(feature = "cldr-names")]
#[rustfmt::skip]
mod names;
mod plural;
mod rbnf;
#[rustfmt::skip]
mod rules;

use alloc::string::String;
use core::fmt;

use ducat::AnyMoney;
pub use rbnf::CompiledRules;

/// Why the words can't be written.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Error {
    /// A value outside ±(2^63 − 1), the range of ICU's rules (ICU writes plain digits there).
    OutOfRange,
    /// A rule set the language doesn't have.
    NoRuleSet,
    /// A private (`%%`) rule set, which ICU doesn't let a caller use.
    PrivateRuleSet,
    /// A rule set with no rule for the value.
    NoRule,
    /// A plural form ICU picks from the value cut to 32 bits, where that gives another form than
    /// the value's own: no spell-out matches ICU.
    PluralTruncation,
    /// Rule text that can't be read or applied.
    MalformedRules,
    /// Rules that nest deeper than any CLDR rule set does (64 levels).
    TooDeep,
    /// Rules that need more than 10,000 rule applications for one number: far more than any CLDR
    /// rule set does.
    TooManySteps,
    /// A negative amount: words are for amounts to pay.
    NegativeAmount,
    /// No currency names: the options give none, and CLDR's (the feature `cldr-names`, with the
    /// language's feature) don't apply, or the code isn't three letters, which is all `Intl` names
    /// (ducat's `RangeError`).
    NoCurrencyNames,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::OutOfRange => {
                "spell-out takes whole numbers within ±(2^63 - 1), as ICU's rules do"
            }
            Self::NoRuleSet => "the language has no such rule set",
            Self::PrivateRuleSet => "a private rule set; use a public one",
            Self::NoRule => "the rule set has no rule for the value",
            Self::PluralTruncation => {
                "ICU picks this plural form from the value cut to 32 bits, which gives another form"
            }
            Self::MalformedRules => "the RBNF rules can't be read",
            Self::TooDeep => "the RBNF rules nest more than 64 deep",
            Self::TooManySteps => "the RBNF rules take more than 10000 steps",
            Self::NegativeAmount => "amounts in words are zero or more",
            Self::NoCurrencyNames => {
                "no currency names: give them, or use CLDR's (feature cldr-names) for a three-letter code"
            }
        })
    }
}

impl core::error::Error for Error {}

/// A shipped language: it picks the plural rules, the digit grouping and the word for "and".
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Locale {
    /// English.
    En,
    /// German.
    De,
    /// French.
    Fr,
    /// Spanish.
    Es,
    /// Italian.
    It,
    /// Dutch.
    Nl,
    /// Portuguese (Brazil's rules, as `Intl`'s `pt`).
    Pt,
}

impl Locale {
    /// The BCP 47 code: `en`.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::De => "de",
            Self::Fr => "fr",
            Self::Es => "es",
            Self::It => "it",
            Self::Nl => "nl",
            Self::Pt => "pt",
        }
    }

    /// The word for "and" between two items, with its spaces, as CLDR's list patterns give it.
    #[must_use]
    pub const fn conjunction(self) -> &'static str {
        self.data().conjunction
    }

    /// What the language takes from CLDR 48 (src/cldr.rs, generated from data/cldr/).
    pub(crate) const fn data(self) -> &'static cldr::LocaleData {
        match self {
            Self::En => &cldr::EN,
            Self::De => &cldr::DE,
            Self::Fr => &cldr::FR,
            Self::Es => &cldr::ES,
            Self::It => &cldr::IT,
            Self::Nl => &cldr::NL,
            Self::Pt => &cldr::PT,
        }
    }
}

/// A language's spell-out rules: its locale and CLDR's RBNF rule text. ducat's `SpelloutRules`.
///
/// Rule text of your own is bounded by a depth cap (64 levels, [`Error::TooDeep`]) and a work
/// budget (10,000 rule applications per number, [`Error::TooManySteps`]), and is
/// [`Error::MalformedRules`] where it can't be read; still treat untrusted rule text with care.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct SpelloutRules {
    /// The language.
    pub locale: Locale,
    /// CLDR's RBNF rule text for the language's spell-out rule sets.
    pub rules: &'static str,
}

/// English (`en`).
#[cfg(feature = "en")]
pub const ENGLISH: SpelloutRules = SpelloutRules {
    locale: Locale::En,
    rules: rules::EN,
};
/// German (`de`).
#[cfg(feature = "de")]
pub const GERMAN: SpelloutRules = SpelloutRules {
    locale: Locale::De,
    rules: rules::DE,
};
/// French (`fr`).
#[cfg(feature = "fr")]
pub const FRENCH: SpelloutRules = SpelloutRules {
    locale: Locale::Fr,
    rules: rules::FR,
};
/// Spanish (`es`).
#[cfg(feature = "es")]
pub const SPANISH: SpelloutRules = SpelloutRules {
    locale: Locale::Es,
    rules: rules::ES,
};
/// Italian (`it`).
#[cfg(feature = "it")]
pub const ITALIAN: SpelloutRules = SpelloutRules {
    locale: Locale::It,
    rules: rules::IT,
};
/// Dutch (`nl`).
#[cfg(feature = "nl")]
pub const DUTCH: SpelloutRules = SpelloutRules {
    locale: Locale::Nl,
    rules: rules::NL,
};
/// Portuguese (`pt`).
#[cfg(feature = "pt")]
pub const PORTUGUESE: SpelloutRules = SpelloutRules {
    locale: Locale::Pt,
    rules: rules::PT,
};

/// A whole number in words: `spell_out(123, &ENGLISH, None)` is `one hundred twenty-three`.
/// `rule_set` picks a public rule set (default `%spellout-cardinal`, or the masculine one where
/// the language has no neutral cardinal). The rules are parsed on each call; hold a
/// [`CompiledRules`] to spell many numbers. ducat's `spellOut`.
///
/// # Errors
///
/// As [`CompiledRules::spell_out`].
pub fn spell_out(
    value: i128,
    rules: &SpelloutRules,
    rule_set: Option<&str>,
) -> Result<String, Error> {
    CompiledRules::new(rules)?.spell_out(value, rule_set)
}

/// A whole number in words, from a [`ducat::Int`].
///
/// # Errors
///
/// As [`spell_out`].
pub fn spell_out_int(
    value: &ducat::Int,
    rules: &SpelloutRules,
    rule_set: Option<&str>,
) -> Result<String, Error> {
    spell_out(value.to_i128().ok_or(Error::OutOfRange)?, rules, rule_set)
}

/// Plural forms of a unit's name, by CLDR plural category: `UnitNames::new("cents").one("cent")`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct UnitNames {
    /// The form for `one`.
    pub one: Option<String>,
    /// The form for `two`.
    pub two: Option<String>,
    /// The form for `few`.
    pub few: Option<String>,
    /// The form for `many` (French, Spanish, Italian and Portuguese exact millions).
    pub many: Option<String>,
    /// The form for every other count.
    pub other: String,
}

impl UnitNames {
    /// The names, `other` given.
    #[must_use]
    pub fn new(other: &str) -> Self {
        Self {
            other: other.into(),
            ..Self::default()
        }
    }

    /// With the form for `one`.
    #[must_use]
    pub fn one(mut self, one: &str) -> Self {
        self.one = Some(one.into());
        self
    }

    /// With the form for `many`.
    #[must_use]
    pub fn many(mut self, many: &str) -> Self {
        self.many = Some(many.into());
        self
    }

    fn forms(&self) -> Forms<'_> {
        Forms {
            one: self.one.as_deref(),
            two: self.two.as_deref(),
            few: self.few.as_deref(),
            many: self.many.as_deref(),
            other: &self.other,
        }
    }
}

/// A unit's plural forms, borrowed: the caller's [`UnitNames`] or CLDR's table.
#[derive(Clone, Copy)]
struct Forms<'a> {
    one: Option<&'a str>,
    two: Option<&'a str>,
    few: Option<&'a str>,
    many: Option<&'a str>,
    other: &'a str,
}

impl<'a> Forms<'a> {
    /// The form for `count`, else `other` (as ICU falls back to it).
    fn select(self, locale: Locale, count: i128) -> &'a str {
        let chosen = match plural::unit_category(locale, count) {
            "one" => self.one,
            "two" => self.two,
            "few" => self.few,
            "many" => self.many,
            _ => None,
        };
        chosen.unwrap_or(self.other)
    }

    /// Only a code: what `Intl` writes for a three-letter code its data doesn't name.
    #[cfg(feature = "cldr-names")]
    const fn code(code: &'a str) -> Self {
        Self {
            one: None,
            two: None,
            few: None,
            many: None,
            other: code,
        }
    }
}

/// CLDR's table of the language's currency names, if the crate is built with it.
#[cfg(feature = "cldr-names")]
const fn cldr_names(locale: Locale) -> Option<&'static [names::CurrencyNames]> {
    match locale {
        #[cfg(feature = "en")]
        Locale::En => Some(names::EN),
        #[cfg(feature = "de")]
        Locale::De => Some(names::DE),
        #[cfg(feature = "fr")]
        Locale::Fr => Some(names::FR),
        #[cfg(feature = "es")]
        Locale::Es => Some(names::ES),
        #[cfg(feature = "it")]
        Locale::It => Some(names::IT),
        #[cfg(feature = "nl")]
        Locale::Nl => Some(names::NL),
        #[cfg(feature = "pt")]
        Locale::Pt => Some(names::PT),
        #[allow(unreachable_patterns)]
        _ => None,
    }
}

/// CLDR's names of `code` in the language: three ASCII letters, in either case.
#[cfg(feature = "cldr-names")]
fn cldr_lookup(locale: Locale, code: &[u8; 3]) -> Option<&'static names::CurrencyNames> {
    let table = cldr_names(locale)?;
    table
        .binary_search_by(|entry| entry.code.as_bytes().cmp(code.as_slice()))
        .ok()
        .map(|index| &table[index])
}

/// A code as `Intl` reads it: three ASCII letters, upper-cased.
fn intl_code(code: &str) -> Option<[u8; 3]> {
    let bytes: [u8; 3] = code.as_bytes().try_into().ok()?;
    bytes
        .iter()
        .all(u8::is_ascii_alphabetic)
        .then(|| bytes.map(|byte| byte.to_ascii_uppercase()))
}

/// CLDR's forms of the currency `letters` (upper-cased) in the language, or the code where CLDR
/// doesn't name it.
#[cfg(feature = "cldr-names")]
fn cldr_forms(locale: Locale, letters: &[u8; 3]) -> Result<Forms<'_>, Error> {
    if cldr_names(locale).is_none() {
        return Err(Error::NoCurrencyNames);
    }
    Ok(match cldr_lookup(locale, letters) {
        Some(entry) => Forms {
            one: entry.one,
            two: None,
            few: None,
            many: entry.many,
            other: entry.other,
        },
        None => Forms::code(core::str::from_utf8(letters).map_err(|_| Error::NoCurrencyNames)?),
    })
}

/// Without `cldr-names`, there are no default names.
#[cfg(not(feature = "cldr-names"))]
const fn cldr_forms(_: Locale, _: &[u8; 3]) -> Result<Forms<'static>, Error> {
    Err(Error::NoCurrencyNames)
}

/// CLDR 48's names of a currency in a language (feature `cldr-names`, and the language's feature),
/// as ducat's `amountInWords` takes them from `Intl` (ICU 78.3): `currency_names(Locale::En, "EUR")`
/// is `UnitNames::new("euros").one("euro")`. The code is read as `Intl` reads it, three ASCII
/// letters in either case. `None` for a code CLDR doesn't name in the language (for which
/// [`amount_in_words`] writes the code, as `Intl` does), another code, or a language not built in.
///
/// Forms the same as `other` are left out: `one` is `None` where CLDR's `one` is `other`'s, and
/// no currency of the seven languages has a `many` of its own in CLDR 48.
#[cfg(feature = "cldr-names")]
#[must_use]
pub fn currency_names(locale: Locale, code: &str) -> Option<UnitNames> {
    let entry = cldr_lookup(locale, &intl_code(code)?)?;
    Some(UnitNames {
        one: entry.one.map(Into::into),
        two: None,
        few: None,
        many: entry.many.map(Into::into),
        other: entry.other.into(),
    })
}

/// The grammatical gender of a currency's name, which some languages' numbers agree with.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Gender {
    /// Masculine.
    Masculine,
    /// Feminine.
    Feminine,
    /// Neuter.
    Neuter,
}

impl Gender {
    const fn name(self) -> &'static str {
        match self {
            Self::Masculine => "masculine",
            Self::Feminine => "feminine",
            Self::Neuter => "neuter",
        }
    }
}

/// Options for [`amount_in_words`]: ducat's `AmountInWordsOptions`, plus the currency's names.
/// The default is ducat's: CLDR's names (feature `cldr-names`), the masculine cardinal where the
/// language has genders, and the cheque form.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct AmountInWordsOptions<'a> {
    /// The currency's name in the plural forms the language uses (`euro`, `euros`). `None` takes
    /// CLDR's (feature `cldr-names`; see [`currency_names`]), as ducat takes `Intl`'s.
    pub currency: Option<UnitNames>,
    /// The gender of the currency's name (Spanish `un euro` but `una libra`); default masculine,
    /// where the language has genders.
    pub gender: Option<Gender>,
    /// A public rule set to spell numbers with, instead of the gender's cardinal.
    pub rule_set: Option<&'a str>,
    /// The minor unit's names, to spell the minor part out (`and forty-five cents`) instead of
    /// writing it cheque-style (`and 45/100`).
    pub minor: Option<UnitNames>,
}

impl AmountInWordsOptions<'_> {
    /// The cheque form, with the currency's names. [`AmountInWordsOptions::default`] takes
    /// CLDR's names instead (feature `cldr-names`).
    #[must_use]
    pub const fn new(currency: UnitNames) -> Self {
        Self {
            currency: Some(currency),
            gender: None,
            rule_set: None,
            minor: None,
        }
    }
}

/// A whole number of 10^0 from decimal digits, within the rules' range.
fn whole(digits: &str) -> Result<i128, Error> {
    if digits.len() > 19 {
        return Err(Error::OutOfRange);
    }
    digits.parse().map_err(|_| Error::OutOfRange)
}

/// An amount in words: the whole units spelled out with the currency's name, then the minor part,
/// as cheques write it after the language's "and" (`one hundred twenty-three euros and 45/100`),
/// or spelled out with `options.minor` (`forty-five cents`). The minor part is written at the
/// amount's scale (an amount at scale 3 gives `/1000`); zero minor units are `00/100`, and left
/// out with `minor` names. ducat's `amountInWords`.
///
/// Without `options.currency`, the currency's name is CLDR 48's in the language (feature
/// `cldr-names`; see [`currency_names`]), as `Intl` gives ducat's: a three-letter code CLDR doesn't
/// name in the language is written as the code, upper-cased (`five XBT`), as `Intl` writes it.
///
/// # Errors
///
/// [`Error::NegativeAmount`]; [`Error::OutOfRange`] for whole units, or spelled minor units,
/// beyond 2^63 − 1; as [`CompiledRules::spell_out`] for the rule set;
/// [`Error::NoCurrencyNames`] without `options.currency` where CLDR's names don't apply: a code
/// that isn't three ASCII letters (ducat's `RangeError`), or a build without `cldr-names` or the
/// language's feature.
pub fn amount_in_words(
    money: &AnyMoney,
    rules: &SpelloutRules,
    options: &AmountInWordsOptions<'_>,
) -> Result<String, Error> {
    if money.is_negative() {
        return Err(Error::NegativeAmount);
    }
    let letters;
    let currency = match &options.currency {
        Some(names) => names.forms(),
        None => {
            letters = intl_code(money.currency().as_str()).ok_or(Error::NoCurrencyNames)?;
            cldr_forms(rules.locale, &letters)?
        }
    };
    let compiled = CompiledRules::new(rules)?;
    let locale = rules.locale;
    let rule_set = match options.rule_set {
        Some(name) => name.into(),
        None => compiled.cardinal_for(options.gender.map(Gender::name)),
    };
    let text = money.to_decimal();
    let (whole_digits, fraction_digits) = text.split_once('.').unwrap_or((&text, ""));
    let units = whole(whole_digits)?;
    let named = |count: i128, names: Forms<'_>| -> Result<String, Error> {
        let mut words = compiled.spell_out(count, Some(&rule_set))?;
        words.push(' ');
        words.push_str(names.select(locale, count));
        Ok(words)
    };

    if let Some(minor) = &options.minor {
        let significant = fraction_digits.trim_start_matches('0');
        let fraction = if significant.is_empty() {
            0
        } else {
            whole(significant)?
        };
        let minor_words = named(fraction, minor.forms())?;
        if fraction > 0 && units == 0 {
            return Ok(minor_words);
        }
        let mut words = named(units, currency)?;
        if fraction != 0 {
            words.push_str(locale.conjunction());
            words.push_str(&minor_words);
        }
        return Ok(words);
    }

    let mut words = named(units, currency)?;
    if !fraction_digits.is_empty() {
        words.push_str(locale.conjunction());
        words.push_str(fraction_digits);
        words.push_str("/1");
        for _ in 0..fraction_digits.len() {
            words.push('0');
        }
    }
    Ok(words)
}
