//! Money as locale text, from CLDR's patterns and symbols: ducat's `format` and `formatToParts`.

use alloc::string::String;
use alloc::vec::Vec;

use ducat::{AnyMoney, MAX_SCALE, Rounding};

use crate::Error;
use crate::locale::Locale;
use crate::pattern::{self, Affix};
use crate::plural::{self, Operands};
use crate::tables::{Numbers, category_tag};
use crate::unicode;

/// How the currency is shown.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum CurrencyDisplay {
    /// The locale's symbol: `€`, `US$`, `CHF` (`Intl`'s `currencyDisplay: 'symbol'`).
    #[default]
    Symbol,
    /// The narrow symbol: `$` for USD and CAD alike (`'narrowSymbol'`).
    NarrowSymbol,
    /// The ISO code: `EUR` (`'code'`).
    Code,
    /// The name, in the number's plural form and the locale's word order: `1.00 US dollars`
    /// (`'name'`).
    Name,
}

/// How a negative amount is shown.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum CurrencySign {
    /// With the minus sign: `-$1.00` (`Intl`'s `currencySign: 'standard'`).
    #[default]
    Standard,
    /// In the locale's accounting form, often in parentheses: `($1.00)` (`'accounting'`).
    Accounting,
}

/// Options of [`format()`]: ducat's `FormatOptions`, which are `Intl.NumberFormat`'s options plus
/// `digits` and `rounding`.
///
/// Without any, the amount is shown with as many fraction digits as its scale, unrounded. With
/// `digits`, it is first rounded once, exactly, to that many decimal places with `rounding`
/// (default half-expand), then shown with them. `Intl`'s fraction and significant digits and
/// rounding increment round too, half-expand, as `Intl` does: here on the decimal, exactly, with
/// ducat's rounding kernel.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub struct FormatOptions {
    /// How the currency is shown.
    pub currency_display: CurrencyDisplay,
    /// How a negative amount is shown.
    pub currency_sign: CurrencySign,
    /// Decimal places to round to, once and exactly, and to show.
    pub digits: Option<u16>,
    /// How `digits` rounds (default [`Rounding::HalfExpand`]); only with `digits`.
    pub rounding: Option<Rounding>,
    /// `Intl`'s `minimumFractionDigits` (default: the amount's scale).
    pub minimum_fraction_digits: Option<u16>,
    /// `Intl`'s `maximumFractionDigits` (default: the amount's scale).
    pub maximum_fraction_digits: Option<u16>,
    /// `Intl`'s `maximumSignificantDigits`, 1 to 21.
    pub maximum_significant_digits: Option<u16>,
    /// `Intl`'s `roundingIncrement`: 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000,
    /// 2500 or 5000 units of the last fraction digit.
    pub rounding_increment: Option<u16>,
}

impl FormatOptions {
    /// The default options.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// With this currency display.
    #[must_use]
    pub const fn display(mut self, display: CurrencyDisplay) -> Self {
        self.currency_display = display;
        self
    }

    /// With this sign display.
    #[must_use]
    pub const fn sign(mut self, sign: CurrencySign) -> Self {
        self.currency_sign = sign;
        self
    }

    /// Rounded once, exactly, to `digits` decimal places with `rounding` (`None` for
    /// half-expand), and shown with them.
    #[must_use]
    pub const fn digits(mut self, digits: u16, rounding: Option<Rounding>) -> Self {
        self.digits = Some(digits);
        self.rounding = rounding;
        self
    }
}

/// The kind of a [`Part`], as `Intl.NumberFormat`'s `formatToParts` names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum PartKind {
    /// Digits before the decimal separator, between group separators.
    Integer,
    /// A group separator.
    Group,
    /// The decimal separator.
    Decimal,
    /// Digits after the decimal separator.
    Fraction,
    /// The minus sign.
    MinusSign,
    /// The plus sign.
    PlusSign,
    /// The currency's symbol, code or name.
    Currency,
    /// Anything else: spaces, parentheses, bidi marks.
    Literal,
}

impl PartKind {
    /// `Intl`'s name for the kind: `"integer"`, `"minusSign"`.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Integer => "integer",
            Self::Group => "group",
            Self::Decimal => "decimal",
            Self::Fraction => "fraction",
            Self::MinusSign => "minusSign",
            Self::PlusSign => "plusSign",
            Self::Currency => "currency",
            Self::Literal => "literal",
        }
    }
}

/// A piece of formatted text: ducat's `formatToParts` item.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Part {
    /// What the piece is.
    pub kind: PartKind,
    /// Its text.
    pub value: String,
}

/// The number to show: its sign, and its digits in ASCII (`"1234.50"`).
struct Shown {
    negative: bool,
    digits: String,
}

/// The largest fraction digits `Intl` takes.
const MAX_FRACTION_DIGITS: u16 = 100;

const INCREMENTS: [u16; 15] = [
    1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000,
];

/// `money` rounded to `scale` fraction digits, or an error ducat would report as a range error.
fn rescale(money: &AnyMoney, scale: u16, rounding: Rounding) -> Result<AnyMoney, Error> {
    if scale > MAX_SCALE {
        return Err(Error::InvalidOptions);
    }
    money.to_scale(scale, rounding).map_err(Error::Money)
}

/// The magnitude's ASCII digits at the money's scale: `"1234.50"`.
fn magnitude(money: &AnyMoney) -> String {
    let text = money.to_decimal();
    match text.strip_prefix('-') {
        Some(rest) => String::from(rest),
        None => text,
    }
}

/// The digits of `money` rounded to `significant` significant digits, half-expand.
fn significant(money: &AnyMoney, significant: u16) -> Result<String, Error> {
    let text = magnitude(money);
    let (integer, fraction) = text.split_once('.').unwrap_or((&text, ""));
    let integer = integer.trim_start_matches('0');
    // the scale that keeps `significant` digits: positive keeps fraction digits
    let leading = if integer.is_empty() {
        let zeros = fraction.len() - fraction.trim_start_matches('0').len();
        if zeros == fraction.len() {
            return Ok(String::from("0"));
        }
        -(i64::try_from(zeros).map_err(|_| Error::InvalidOptions)?)
    } else {
        i64::try_from(integer.len()).map_err(|_| Error::InvalidOptions)?
    };
    let keep = i64::from(significant) - leading;
    let rounded = if keep >= 0 {
        let scale = u16::try_from(keep).map_err(|_| Error::InvalidOptions)?;
        if scale >= money.scale() {
            return Ok(trim_fraction(text, 0));
        }
        magnitude(&rescale(money, scale, Rounding::HalfExpand)?)
    } else {
        // round to 10^-keep: divide by it (a larger scale), round to an integer, multiply back
        let shift = u16::try_from(-keep).map_err(|_| Error::InvalidOptions)?;
        let scale = money
            .scale()
            .checked_add(shift)
            .filter(|&scale| scale <= MAX_SCALE)
            .ok_or(Error::InvalidOptions)?;
        let shifted = AnyMoney::from_units(money.units().clone(), scale, money.currency())
            .map_err(Error::Money)?;
        let mut digits = magnitude(&rescale(&shifted, 0, Rounding::HalfExpand)?);
        if digits != "0" {
            for _ in 0..shift {
                digits.push('0');
            }
        }
        digits
    };
    Ok(trim_fraction(rounded, 0))
}

/// `text` without trailing fraction zeros beyond `minimum` fraction digits.
fn trim_fraction(text: String, minimum: usize) -> String {
    let Some(point) = text.find('.') else {
        return text;
    };
    let fraction = &text[point + 1..];
    let keep = fraction.trim_end_matches('0').len().max(minimum);
    if keep == 0 {
        String::from(&text[..point])
    } else {
        String::from(&text[..point + 1 + keep])
    }
}

/// The number `options` show for `money`, rounded as they say.
fn shown(money: &AnyMoney, options: &FormatOptions) -> Result<Shown, Error> {
    let intl_digits = options.minimum_fraction_digits.is_some()
        || options.maximum_fraction_digits.is_some()
        || options.maximum_significant_digits.is_some()
        || options.rounding_increment.is_some();
    if options.digits.is_some() || options.rounding.is_some() {
        // ducat rounds once, exactly; Intl's digit options beside it would round again
        let Some(digits) = options.digits else {
            return Err(Error::ConflictingOptions);
        };
        if intl_digits {
            return Err(Error::ConflictingOptions);
        }
        // Intl shows at most 100 fraction digits
        if digits > MAX_FRACTION_DIGITS {
            return Err(Error::InvalidOptions);
        }
        let rounded = rescale(
            money,
            digits,
            options.rounding.unwrap_or(Rounding::HalfExpand),
        )?;
        return Ok(Shown {
            negative: rounded.is_negative(),
            digits: magnitude(&rounded),
        });
    }
    // Intl keeps the sign of a negative amount that rounds to zero (-€0.00)
    let negative = money.is_negative();
    let scale = money.scale();
    let minimum = options.minimum_fraction_digits.unwrap_or(scale);
    let maximum = options.maximum_fraction_digits.unwrap_or(scale);
    if minimum > MAX_FRACTION_DIGITS || maximum > MAX_FRACTION_DIGITS || minimum > maximum {
        return Err(Error::InvalidOptions);
    }
    if let Some(increment) = options.rounding_increment {
        if options.maximum_significant_digits.is_some() {
            return Err(Error::ConflictingOptions);
        }
        if !INCREMENTS.contains(&increment) || minimum != maximum {
            return Err(Error::InvalidOptions);
        }
        // to a multiple of increment × 10^-maximum, half-expand
        let rounded = round_to_step(money, increment, maximum)?;
        return Ok(Shown {
            negative,
            digits: magnitude(&rounded),
        });
    }
    if let Some(significant_digits) = options.maximum_significant_digits {
        if !(1..=21).contains(&significant_digits) {
            return Err(Error::InvalidOptions);
        }
        return Ok(Shown {
            negative,
            digits: significant(money, significant_digits)?,
        });
    }
    let digits = if maximum >= scale {
        // padded with zeros to the minimum, never cut below the scale's digits
        let padded = rescale(money, maximum, Rounding::Unnecessary)?;
        trim_fraction(magnitude(&padded), usize::from(minimum))
    } else {
        let rounded = rescale(money, maximum, Rounding::HalfExpand)?;
        trim_fraction(magnitude(&rounded), usize::from(minimum))
    };
    Ok(Shown { negative, digits })
}

/// `money` rounded half-expand to a multiple of `increment` × 10^-`scale`, at `scale`.
fn round_to_step(money: &AnyMoney, increment: u16, scale: u16) -> Result<AnyMoney, Error> {
    // both at the finer scale, where they are integers: count the steps, round, multiply back
    let common = money.scale().max(scale);
    let units = rescale(money, common, Rounding::Unnecessary)?;
    let mut step = ducat::Int::from(increment);
    for _ in scale..common {
        step = step * ducat::Int::from(10_u8);
    }
    let count = AnyMoney::from_units(units.units().clone(), 0, money.currency())
        .map_err(Error::Money)?
        .divide(alloc::format!("{step}").as_str(), Rounding::HalfExpand)
        .map_err(Error::Money)?;
    let product = count.units() * &step;
    let result = AnyMoney::from_units(product, common, money.currency()).map_err(Error::Money)?;
    rescale(&result, scale, Rounding::Unnecessary)
}

/// Collects characters into parts, merging adjacent characters of one kind.
#[derive(Default)]
struct Parts {
    parts: Vec<Part>,
}

impl Parts {
    fn push(&mut self, kind: PartKind, ch: char) {
        if let Some(last) = self.parts.last_mut() {
            if last.kind == kind {
                last.value.push(ch);
                return;
            }
        }
        let mut value = String::new();
        value.push(ch);
        self.parts.push(Part { kind, value });
    }

    fn push_text(&mut self, kind: PartKind, text: &str) {
        for ch in text.chars() {
            self.push(kind, ch);
        }
    }

    /// A symbol's characters: its bidi marks (format characters) are literals.
    fn push_symbol(&mut self, kind: PartKind, text: &str) {
        for ch in text.chars() {
            self.push(
                if unicode::is_format(ch) {
                    PartKind::Literal
                } else {
                    kind
                },
                ch,
            );
        }
    }
}

/// Whether currency spacing applies to this character of the currency (CLDR's
/// `[[:^S:]&[:^Z:]]`).
fn spaces(ch: char) -> bool {
    !unicode::is_symbol(ch) && !unicode::is_separator(ch)
}

/// The number's characters: digits in the numbering system, group and decimal separators.
fn number(
    numbers: &Numbers,
    (decimal, group): (&str, &str),
    digits: &str,
    grouping: Option<(usize, usize)>,
) -> Parts {
    let (integer, fraction) = digits.split_once('.').unwrap_or((digits, ""));
    let mut out = Parts::default();
    let length = integer.len();
    let grouped = grouping
        .filter(|&(primary, _)| length >= primary + usize::from(numbers.minimum_grouping.max(1)));
    for (at, byte) in integer.bytes().enumerate() {
        if let Some((primary, secondary)) = grouped {
            let left = length - at;
            if at > 0 && left >= primary && (left == primary || (left - primary) % secondary == 0) {
                out.push_text(PartKind::Group, group);
            }
        }
        out.push(PartKind::Integer, numbers.digits[usize::from(byte - b'0')]);
    }
    if !fraction.is_empty() {
        out.push_text(PartKind::Decimal, decimal);
        for byte in fraction.bytes() {
            out.push(PartKind::Fraction, numbers.digits[usize::from(byte - b'0')]);
        }
    }
    out
}

fn affixes(out: &mut Parts, numbers: &Numbers, affixes: &[Affix], currency: &str) {
    for affix in affixes {
        match affix {
            Affix::Literal(text) => out.push_text(PartKind::Literal, text),
            Affix::Currency => out.push_symbol(PartKind::Currency, currency),
            Affix::Minus => out.push_symbol(PartKind::MinusSign, numbers.minus),
            Affix::Plus => out.push_symbol(PartKind::PlusSign, numbers.plus),
        }
    }
}

/// The currency's symbol, narrow symbol or code in this locale.
fn symbol(locale: &Locale, code: &str, display: CurrencyDisplay) -> &'static str {
    let symbol = || locale.currency_field(code, |entry| entry.field('s'));
    match display {
        CurrencyDisplay::NarrowSymbol => locale
            .currency_field(code, |entry| entry.field('n'))
            .or_else(symbol),
        _ => symbol(),
    }
    .unwrap_or("")
}

/// The currency's name for a number in `category`.
fn name(locale: &Locale, code: &str, category: &str) -> Option<&'static str> {
    locale
        .currency_field(code, |entry| entry.field(category_tag(category)))
        .or_else(|| locale.currency_field(code, |entry| entry.field('5')))
        .or_else(|| locale.currency_field(code, |entry| entry.field('d')))
}

/// Checks the currency is one `Intl` formats: three ASCII letters.
fn currency_code(money: &AnyMoney) -> Result<alloc::string::String, Error> {
    let code = money.currency();
    let code = code.as_str();
    if code.len() != 3 || !code.bytes().all(|byte| byte.is_ascii_alphabetic()) {
        return Err(Error::InvalidCurrency);
    }
    Ok(code.to_ascii_uppercase())
}

/// The amount in a currency pattern, with currency spacing: a currency that ends (or starts)
/// with a non-symbol touching a digit gets the locale's `insertBetween`.
fn in_pattern(
    numbers: &Numbers,
    separators: (&str, &str),
    source: &str,
    shown: &Shown,
    currency: &str,
) -> Result<Parts, Error> {
    let pattern = pattern::parse(source).map_err(|_| Error::MalformedData)?;
    let sub = if shown.negative {
        &pattern.negative
    } else {
        &pattern.positive
    };
    let mut out = Parts::default();
    affixes(&mut out, numbers, &sub.prefix, currency);
    let digits = number(numbers, separators, &shown.digits, pattern.grouping);
    let first_digit = digits
        .parts
        .first()
        .and_then(|part| part.value.chars().next());
    let last_digit = digits
        .parts
        .last()
        .and_then(|part| part.value.chars().last());
    let is_digit = |ch: Option<char>| ch.is_some_and(char::is_numeric);
    if matches!(sub.prefix.last(), Some(Affix::Currency))
        && currency.chars().last().is_some_and(spaces)
        && is_digit(first_digit)
    {
        out.push_text(PartKind::Literal, numbers.spacing.0);
    }
    for part in digits.parts {
        out.push_text(part.kind, &part.value);
    }
    if matches!(sub.suffix.first(), Some(Affix::Currency))
        && currency.chars().next().is_some_and(spaces)
        && is_digit(last_digit)
    {
        out.push_text(PartKind::Literal, numbers.spacing.1);
    }
    affixes(&mut out, numbers, &sub.suffix, currency);
    Ok(out)
}

/// The parts of `money` formatted in `locale`: ducat's `formatToParts`.
///
/// A currency CLDR gives its own pattern in the locale (EUR in en-150, en-AT and the other
/// European English locales) is written in that pattern with a symbol, narrow symbol or code,
/// whatever the sign, as ICU's data has it; the accounting form is that pattern too. A name
/// follows TR35 everywhere: the number, with the separators and grouping the symbol form uses for
/// the currency (so [`parse()`](crate::parse) reads it back) and no symbol, in the unit pattern
/// with the plural name (`-1,234.50 euros` in en-150, `1,234.567 Kuwaiti dinars` in en-NL),
/// never the currency's own pattern or symbol.
///
/// # Errors
///
/// [`Error::ConflictingOptions`] for `rounding` without `digits`, or `Intl`'s digit options
/// beside `digits` (ducat's `TypeError`); [`Error::InvalidOptions`] for options out of range
/// (ducat's `RangeError` from `Intl`); [`Error::InvalidCurrency`] for a code that isn't three
/// letters; [`Error::Money`] where rounding fails.
pub fn format_to_parts(
    money: &AnyMoney,
    locale: &Locale,
    options: &FormatOptions,
) -> Result<Vec<Part>, Error> {
    let code = currency_code(money)?;
    let shown = shown(money, options)?;
    let numbers = locale.numbers();
    let special = locale.currency_format(&code);
    let special_pattern = special.map(|(pattern, _, _)| pattern);
    let separators = special.map_or((numbers.decimal, numbers.group), |(_, decimal, group)| {
        (decimal, group)
    });
    if options.currency_display != CurrencyDisplay::Name {
        let source = special_pattern.unwrap_or(match options.currency_sign {
            CurrencySign::Standard => numbers.currency_pattern,
            CurrencySign::Accounting => numbers.accounting_pattern,
        });
        let currency: &str = match options.currency_display {
            CurrencyDisplay::Code => &code,
            display => {
                let found = symbol(locale, &code, display);
                if found.is_empty() { &code } else { found }
            }
        };
        return Ok(in_pattern(numbers, separators, source, &shown, currency)?.parts);
    }
    // a name, as TR35 has it: the number, then the unit pattern for its plural category. The
    // number's sign comes from the locale's decimal pattern (no accounting form); its separators
    // and grouping are those the symbol form uses for this currency (a currency's own format's,
    // where it has one), so parse reads it back. A currency's own pattern and symbol never enter
    // it (where ICU's code writes them, it garbles the text: data/icu/README.md).
    let pattern = pattern::parse(numbers.decimal_pattern).map_err(|_| Error::MalformedData)?;
    let sub = if shown.negative {
        &pattern.negative
    } else {
        &pattern.positive
    };
    let currency_source = special_pattern.unwrap_or(numbers.currency_pattern);
    let grouping = pattern::parse(currency_source)
        .map_err(|_| Error::MalformedData)?
        .grouping;
    let mut amount = Parts::default();
    affixes(&mut amount, numbers, &sub.prefix, "");
    for part in number(numbers, separators, &shown.digits, grouping).parts {
        amount.push_text(part.kind, &part.value);
    }
    affixes(&mut amount, numbers, &sub.suffix, "");
    let category = plural::category(locale.plurals(), &Operands::new(&shown.digits));
    let unit = numbers
        .unit_patterns
        .iter()
        .find(|(found, _)| *found == category)
        .or_else(|| {
            numbers
                .unit_patterns
                .iter()
                .find(|(found, _)| *found == "other")
        })
        .map_or("{0} {1}", |(_, pattern)| *pattern);
    let currency_name = name(locale, &code, category).unwrap_or(&code);
    let mut out = Parts::default();
    let mut rest = unit;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix("{0}") {
            for part in &amount.parts {
                out.push_text(part.kind, &part.value);
            }
            rest = after;
        } else if let Some(after) = rest.strip_prefix("{1}") {
            out.push_symbol(PartKind::Currency, currency_name);
            rest = after;
        } else {
            let ch = rest.chars().next().unwrap_or(' ');
            out.push(PartKind::Literal, ch);
            rest = &rest[ch.len_utf8()..];
        }
    }
    Ok(out.parts)
}

/// `money` formatted in `locale`: ducat's `format`. The text is the parts of
/// [`format_to_parts`], joined.
///
/// # Errors
///
/// As [`format_to_parts`].
pub fn format(money: &AnyMoney, locale: &Locale, options: &FormatOptions) -> Result<String, Error> {
    Ok(format_to_parts(money, locale, options)?
        .into_iter()
        .map(|part| part.value)
        .collect())
}

/// The currency's symbol in `locale` (`€`, `US$`), its narrow symbol, or its code where CLDR has
/// none: ducat's `currencySymbol`, which reads `Intl`.
#[must_use]
pub fn currency_symbol(code: &str, locale: &Locale, narrow: bool) -> &'static str {
    let display = if narrow {
        CurrencyDisplay::NarrowSymbol
    } else {
        CurrencyDisplay::Symbol
    };
    symbol(locale, code, display)
}

/// The currency's display name in `locale` (`US dollar`, `euro`), if CLDR has one: ducat's
/// `currencyName`, which reads `Intl`.
#[must_use]
pub fn currency_name(code: &str, locale: &Locale) -> Option<&'static str> {
    locale.currency_field(code, |entry| entry.field('d'))
}

#[cfg(test)]
mod properties {
    use super::*;
    use crate::locale::Locale;
    use proptest::prelude::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(4096))]

        /// Any pattern text, any digits, any currency text: parts or an error, no panic, and
        /// the parts are the whole text.
        #[test]
        fn writes_any_pattern(
            source in "\\PC{0,48}|[#0,.;'¤+\\- \u{a0}€()]{0,24}",
            integer in "[0-9]{1,40}",
            fraction in "[0-9]{0,12}",
            negative in any::<bool>(),
            currency in "\\PC{0,8}",
        ) {
            let locale = Locale::new("und").unwrap();
            let digits = if fraction.is_empty() { integer } else { alloc::format!("{integer}.{fraction}") };
            let shown = Shown { negative, digits };
            if let Ok(parts) = in_pattern(locale.numbers(), (",", "."), &source, &shown, &currency) {
                prop_assert!(parts.parts.iter().all(|part| !part.value.is_empty()));
            }
        }
    }
}
