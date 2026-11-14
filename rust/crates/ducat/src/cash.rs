//! Cash rounding: to a multiple of an increment, such as CHF 0.05, and to the smallest coin in use
//! by the cash-rounding rules (ducat's `/cash`).
//!
//! The rules come from `data/cash-rounding.json`, one per currency (and country, for EUR), each
//! with a source and a `verified` flag. They are a figure of their own, apart from the ISO 4217
//! exponent (an amount's scale) and CLDR's digits ([`cldr_cash`]): a rule's step is in the
//! currency's ISO minor units, and nothing here changes an amount's scale but rounding. Card and
//! other electronic payments are never cash-rounded: round cash tenders only.
//!
//! ```
//! use ducat::Money;
//! use ducat::cash::{CashOptions, cash_digits, cash_unit};
//! use ducat::iso::{Chf, Eur};
//!
//! let price: Money<Chf> = "10.03".parse()?;
//! assert_eq!(price.cash_round(&CashOptions::default())?.to_string(), "10.05 CHF");
//! let euros: Money<Eur> = "10.03".parse()?;
//! // there is no euro-wide rule: EUR needs a country
//! assert_eq!(euros.cash_round(&CashOptions::default())?.to_string(), "10.03 EUR");
//! let dutch = CashOptions { country: Some("NL"), ..CashOptions::default() };
//! assert_eq!(euros.cash_round(&dutch)?.to_string(), "10.05 EUR");
//! assert_eq!(cash_unit("DKK".parse()?, &CashOptions::default()).to_decimal(), "0.50");
//! assert_eq!(cash_digits("SEK".parse()?, &CashOptions::default()), 0);
//! # Ok::<(), ducat::Error>(())
//! ```

use crate::amount::Amount;
use crate::currency_data::{CASH_RULES, CLDR_CASH, CLDR_RELEASE};
use crate::rounding::{Rounding, rescale_ratio};
use crate::{AnyMoney, Currency, CurrencyCode, Error, Int, Money};

impl Amount {
    pub(crate) fn round_to_increment(
        &self,
        increment: &Self,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        if !increment.units.is_positive() {
            return Err(Error::NotPositive);
        }
        let scale = self.scale.max(increment.scale);
        let value = self.rescale(scale, Rounding::Unnecessary)?.units;
        let step = increment.rescale(scale, Rounding::Unnecessary)?.units;
        let steps = rescale_ratio(&value, &Int::ONE, &step, 0, 0, rounding)?;
        Ok(Self {
            units: steps * &step,
            scale,
        })
    }
}

impl<C: Currency> Money<C> {
    /// The nearest multiple of `increment` by `rounding`, at the larger of the two scales: cash
    /// rounding, such as CHF 10.03 to 10.05 with an increment of 0.05.
    ///
    /// ```
    /// use ducat::{Money, Rounding};
    /// use ducat::iso::Chf;
    ///
    /// let price: Money<Chf> = "10.03".parse()?;
    /// let rounded = price.round_to_increment(&"0.05".parse()?, Rounding::HalfExpand)?;
    /// assert_eq!(rounded.to_string(), "10.05 CHF");
    /// # Ok::<(), ducat::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::NotPositive`] for an increment that isn't positive; [`Error::Rounding`] with
    /// [`Rounding::Unnecessary`](crate::Rounding::Unnecessary) when the amount isn't a multiple.
    pub fn round_to_increment(&self, increment: &Self, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_amount(
            self.amount
                .round_to_increment(&increment.amount, rounding)?,
        ))
    }
}

impl AnyMoney {
    /// As [`Money::round_to_increment`].
    ///
    /// # Errors
    ///
    /// As [`Money::round_to_increment`], and [`Error::CurrencyMismatch`] for an increment in
    /// another currency.
    pub fn round_to_increment(&self, increment: &Self, rounding: Rounding) -> Result<Self, Error> {
        let increment = self.amount_in(increment)?;
        Ok(Self::from_parts(
            self.amount.round_to_increment(increment, rounding)?,
            self.currency(),
        ))
    }
}

/// The CLDR release [`cldr_cash`] comes from.
pub const CLDR_CASH_RELEASE: &str = CLDR_RELEASE;

/// A cash-rounding rule: a currency's smallest cash step, where it differs from the minor unit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct CashRule {
    currency: CurrencyCode,
    increment: u64,
    countries: &'static [&'static str],
    scope: &'static str,
    verified: bool,
    source: &'static str,
    rounding: Rounding,
}

impl CashRule {
    fn of(index: usize, currency: CurrencyCode) -> Self {
        let (_, increment, countries, scope, verified, source, rounding) = CASH_RULES[index];
        Self {
            currency,
            increment,
            countries,
            scope,
            verified,
            source,
            rounding,
        }
    }

    /// The currency.
    #[must_use]
    pub const fn currency(&self) -> CurrencyCode {
        self.currency
    }

    /// The smallest cash step, in the currency's ISO minor units: 5 for CHF 0.05, 100 for SEK 1.
    #[must_use]
    pub const fn increment(&self) -> u64 {
        self.increment
    }

    /// The step as an amount, at the currency's exponent: 0.05 CHF.
    #[must_use]
    pub fn step(&self) -> AnyMoney {
        AnyMoney::from_minor(self.increment, self.currency)
    }

    /// The countries (ISO 3166 alpha-2) the rule is for.
    #[must_use]
    pub const fn countries(&self) -> &'static [&'static str] {
        self.countries
    }

    /// Where it applies: `"cash only"`.
    #[must_use]
    pub const fn scope(&self) -> &'static str {
        self.scope
    }

    /// `false` when only secondary sources (press, encyclopaedias) were found.
    #[must_use]
    pub const fn verified(&self) -> bool {
        self.verified
    }

    /// The source's address.
    #[must_use]
    pub const fn source(&self) -> &'static str {
        self.source
    }

    /// The tie rule the source prescribes: [`Rounding::HalfExpand`] unless it says otherwise
    /// (Serbia rounds a 50 para tie down, [`Rounding::HalfTrunc`]).
    #[must_use]
    pub const fn rounding(&self) -> Rounding {
        self.rounding
    }
}

/// Every rule, in table order.
pub fn cash_rules() -> impl Iterator<Item = CashRule> {
    (0..CASH_RULES.len()).filter_map(|index| {
        CurrencyCode::iso(CASH_RULES[index].0)
            .ok()
            .map(|currency| CashRule::of(index, currency))
    })
}

/// The cash-rounding rule for a currency, optionally narrowed by country (ISO 3166 alpha-2): with
/// a country, the first of the currency's rules that lists it; without, its first rule. EUR has no
/// euro-wide rule, so it needs a country (BE, NL, FI, IE, IT, SK, EE, LT).
#[must_use]
pub fn cash_rule(currency: CurrencyCode, country: Option<&str>) -> Option<CashRule> {
    let mut rules = (0..CASH_RULES.len()).filter(|&index| CASH_RULES[index].0 == currency.as_str());
    let found = match country {
        Some(country) => rules.find(|&index| CASH_RULES[index].2.contains(&country)),
        None if currency.as_str() == "EUR" => None,
        None => rules.next(),
    };
    found.map(|index| CashRule::of(index, currency))
}

/// Which rule applies, and how.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct CashOptions<'a> {
    /// The country (ISO 3166 alpha-2), which EUR needs.
    pub country: Option<&'a str>,
    /// The tie rule, instead of the rule's own.
    pub rounding: Option<Rounding>,
    /// Use only rules backed by primary sources (ducat's `includeUnverified: false`).
    pub verified_only: bool,
}

impl CashOptions<'_> {
    fn rule(&self, currency: CurrencyCode) -> Option<CashRule> {
        cash_rule(currency, self.country).filter(|rule| rule.verified || !self.verified_only)
    }
}

/// The number of decimals a cash amount is shown with (CLDR's `cashDigits`, from the rules): none
/// when cash is rounded to whole units (SEK 1, HUF 5), the exponent otherwise (DKK 0.50 is shown
/// as 10.50). A currency without a rule that applies takes its exponent.
#[must_use]
pub fn cash_digits(currency: CurrencyCode, options: &CashOptions<'_>) -> u8 {
    let exponent = currency.exponent();
    match options.rule(currency) {
        Some(rule) if rule.increment % 10u64.pow(u32::from(exponent)) == 0 => 0,
        _ => exponent,
    }
}

/// The smallest cash step as an amount at the currency's exponent: 0.05 CHF, 0.50 DKK, 1.00 SEK,
/// 0.05 EUR in NL. A currency without a rule that applies gives its minor unit, 0.01 GBP.
#[must_use]
pub fn cash_unit(currency: CurrencyCode, options: &CashOptions<'_>) -> AnyMoney {
    let increment = options.rule(currency).map_or(1, |rule| rule.increment);
    AnyMoney::from_minor(increment, currency)
}

/// The cash rule as a rounding policy, to pass wherever a rounding mode goes:
/// `price.multiply("1.075", cash_policy(chf, &options)?)` rounds once, straight to CHF 0.05. The
/// policy is at the currency's exponent and only takes amounts in `currency`.
///
/// # Errors
///
/// [`Error::NoCashRule`] when no rule applies (EUR without a country that has one, or an
/// unverified rule with `verified_only`); use [`RoundingPolicy::ISO`](crate::policy::RoundingPolicy::ISO)
/// for currencies without cash rounding.
#[cfg(feature = "policy")]
pub fn cash_policy(
    currency: CurrencyCode,
    options: &CashOptions<'_>,
) -> Result<crate::policy::RoundingPolicy, Error> {
    let rule = options.rule(currency).ok_or(Error::NoCashRule)?;
    crate::policy::RoundingPolicy::new(options.rounding.unwrap_or(rule.rounding))
        .with_scale(u16::from(currency.exponent()))?
        .with_increment(rule.increment)
        .map(|policy| policy.for_currency(currency))
}

impl Amount {
    fn cash_round(&self, currency: CurrencyCode, options: &CashOptions<'_>) -> Result<Self, Error> {
        let Some(rule) = options.rule(currency) else {
            return Ok(self.clone());
        };
        let step = Self {
            units: Int::from(rule.increment),
            scale: u16::from(currency.exponent()),
        };
        self.round_to_increment(&step, options.rounding.unwrap_or(rule.rounding))
    }
}

/// CLDR's fractions for a currency it cash-rounds: its display digits, and the decimals and step of
/// cash amounts. A figure apart from the ISO exponent and the cash rules: HUF has ISO exponent 2
/// and CLDR digits 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct CldrCash {
    /// The decimals CLDR shows amounts with.
    pub digits: u8,
    /// The decimals CLDR shows cash amounts with.
    pub cash_digits: u8,
    /// The cash step in units of the last cash decimal (0 means 1): CHF's 5 is 0.05.
    pub cash_rounding: u16,
}

/// CLDR's fractions for `currency`, from `data/cldr-cash.json`, which holds only the currencies CLDR
/// cash-rounds: `None` means "not in the data", not "the same as the exponent".
#[must_use]
pub fn cldr_cash(currency: &str) -> Option<CldrCash> {
    CLDR_CASH
        .binary_search_by(|entry| entry.0.cmp(currency))
        .ok()
        .map(|index| {
            let (_, digits, cash_digits, cash_rounding) = CLDR_CASH[index];
            CldrCash {
                digits,
                cash_digits,
                cash_rounding,
            }
        })
}

impl<C: Currency> Money<C> {
    /// Rounds a cash total to the currency's cash step by its rule (CHF 0.05, SEK 1, HUF 5, EUR
    /// 0.05 in NL), ties by the rule's own tie rule unless `options` gives one. The result keeps the
    /// amount's scale when it is larger than the currency's (10.034 CHF gives 10.050). Returns the
    /// amount unchanged when no rule applies.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] with [`Rounding::Unnecessary`] when the amount isn't on the step.
    pub fn cash_round(&self, options: &CashOptions<'_>) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.cash_round(C::CODE, options)?))
    }
}

impl AnyMoney {
    /// As [`Money::cash_round`].
    ///
    /// # Errors
    ///
    /// As [`Money::cash_round`].
    pub fn cash_round(&self, options: &CashOptions<'_>) -> Result<Self, Error> {
        Ok(Self::from_parts(
            self.amount.cash_round(self.currency(), options)?,
            self.currency(),
        ))
    }
}
