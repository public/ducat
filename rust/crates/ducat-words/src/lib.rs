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
//! ducat takes the currency's name from the runtime's `Intl`; there is no `Intl` here, and CLDR's
//! currency names aren't in ducat's data, so the caller gives the name, in the plural forms the
//! language uses, as ducat already has the caller give the minor unit's name.

#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]
#![warn(missing_docs)]

extern crate alloc;

mod digits;
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
        match self {
            Self::En => " and ",
            Self::De => " und ",
            Self::Fr => " et ",
            Self::Es => " y ",
            Self::It | Self::Pt => " e ",
            Self::Nl => " en ",
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

    fn select(&self, locale: Locale, count: i128) -> &str {
        let chosen = match plural::unit_category(locale, count) {
            "one" => self.one.as_deref(),
            "two" => self.two.as_deref(),
            "few" => self.few.as_deref(),
            "many" => self.many.as_deref(),
            _ => None,
        };
        chosen.unwrap_or(&self.other)
    }
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
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct AmountInWordsOptions<'a> {
    /// The currency's name in the plural forms the language uses (`euro`, `euros`).
    pub currency: UnitNames,
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
    /// The cheque form, with the currency's names.
    #[must_use]
    pub const fn new(currency: UnitNames) -> Self {
        Self {
            currency,
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
/// # Errors
///
/// [`Error::NegativeAmount`]; [`Error::OutOfRange`] for whole units, or spelled minor units,
/// beyond 2^63 − 1; as [`CompiledRules::spell_out`] for the rule set.
pub fn amount_in_words(
    money: &AnyMoney,
    rules: &SpelloutRules,
    options: &AmountInWordsOptions<'_>,
) -> Result<String, Error> {
    if money.is_negative() {
        return Err(Error::NegativeAmount);
    }
    let compiled = CompiledRules::new(rules)?;
    let locale = rules.locale;
    let rule_set = match options.rule_set {
        Some(name) => name.into(),
        None => compiled.cardinal_for(options.gender.map(Gender::name)),
    };
    let text = money.to_decimal();
    let (whole_digits, fraction_digits) = text.split_once('.').unwrap_or((&text, ""));
    let units = whole(whole_digits)?;
    let named = |count: i128, names: &UnitNames| -> Result<String, Error> {
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
        let minor_words = named(fraction, minor)?;
        if fraction > 0 && units == 0 {
            return Ok(minor_words);
        }
        let mut words = named(units, &options.currency)?;
        if fraction != 0 {
            words.push_str(locale.conjunction());
            words.push_str(&minor_words);
        }
        return Ok(words);
    }

    let mut words = named(units, &options.currency)?;
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
