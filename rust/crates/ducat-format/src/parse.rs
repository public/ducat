//! Amounts as people write them: ducat's `parse` and `parseMoney`, with the locale's separators,
//! group sizes and currency symbols from CLDR.

use alloc::string::String;
use alloc::vec::Vec;

use ducat::{AnyMoney, CurrencyCode, Rounding};

use crate::locale::Locale;
use crate::pattern;
use crate::tables::Numbers;
use crate::unicode::{self, digit_value};
use crate::{Error, MAX_INPUT, SyntaxError};

/// Options of [`parse`]: ducat's `ParseOptions`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub struct ParseOptions {
    /// The scale of the result (default: the currency's exponent).
    pub scale: Option<u16>,
    /// How to round more decimals than the scale (default: they are an error).
    pub rounding: Option<Rounding>,
    /// Accept group separators in any position (`1.5` in de-DE is then 15.00).
    pub lenient: bool,
}

impl ParseOptions {
    /// The default options.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// With group separators accepted anywhere.
    #[must_use]
    pub const fn lenient(mut self) -> Self {
        self.lenient = true;
        self
    }
}

/// Options of [`parse_money`]: ducat's `ParseMoneyOptions`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub struct ParseMoneyOptions<'a> {
    /// The expected currency. It settles a symbol several currencies share (`$`, `kr`, `£`, `¥`),
    /// and text naming another currency is an error. With `lenient`, a bare number is read in it.
    pub hint: Option<CurrencyCode>,
    /// Your own meanings for symbols, which win over the locale's: `[("$", cad)]`.
    pub symbols: &'a [(&'a str, CurrencyCode)],
    /// The currencies to detect (default: every ISO 4217 currency with a minor unit).
    pub currencies: Option<&'a [CurrencyCode]>,
    /// Accept group separators anywhere, and a bare number when a `hint` is given.
    pub lenient: bool,
    /// The scale of the result (default: the currency's exponent).
    pub scale: Option<u16>,
    /// How to round more decimals than the scale (default: they are an error).
    pub rounding: Option<Rounding>,
}

/// Whether `ch` may stand around the number: letters, currency symbols, spaces, bidi marks, `.`,
/// parentheses and signs (ducat's `[\p{L}\p{Sc}\p{Z}\s\p{Cf}.()+\-−]`).
fn is_affix(ch: char) -> bool {
    unicode::is_letter(ch)
        || unicode::is_currency_symbol(ch)
        || unicode::is_space(ch)
        || unicode::is_format(ch)
        || matches!(ch, '.' | '(' | ')' | '+' | '-' | '−')
}

/// The patterns and separators `format` writes this currency with in the locale: its own where
/// CLDR gives the currency one (en-150's EUR), else the locale's.
struct CurrencyFormat {
    patterns: [&'static str; 2],
    decimal: &'static str,
    group: &'static str,
}

impl CurrencyFormat {
    fn of(locale: &Locale, code: &str) -> Self {
        let numbers: &Numbers = locale.numbers();
        match locale.currency_format(code) {
            Some((pattern, decimal, group)) => Self {
                patterns: [pattern, pattern],
                decimal,
                group,
            },
            None => Self {
                patterns: [numbers.currency_pattern, numbers.accounting_pattern],
                decimal: numbers.decimal,
                group: numbers.group,
            },
        }
    }

    /// The decimal and group separators (`,` for a pattern without grouping, as ducat).
    fn separators(&self) -> (&'static str, &'static str) {
        let grouped = pattern::parse(self.patterns[0])
            .map(|pattern| pattern.grouping.is_some())
            .unwrap_or(false);
        (self.decimal, if grouped { self.group } else { "," })
    }

    /// The group sizes (primary, secondary) of the standard and accounting patterns, as ducat
    /// reads them from formatting 1,234,567.5: (7, 7) without grouping.
    fn group_sizes(&self) -> Result<Vec<(usize, usize)>, Error> {
        let mut sizes = Vec::with_capacity(2);
        for source in self.patterns {
            let pattern = pattern::parse(source).map_err(|_| Error::MalformedData)?;
            let found = match pattern.grouping {
                Some((primary, secondary)) => (primary.min(7), secondary),
                None => (7, 7),
            };
            if !sizes.contains(&found) {
                sizes.push(found);
            }
        }
        Ok(sizes)
    }
}

/// Whether digit runs between group separators fit one of the sizes: a first run of 1 to
/// `secondary` digits, middle runs of `secondary`, a last run of `primary`. `middle` is the
/// length the middle runs share, `None` for none, `Some(None)` if they differ.
fn runs_fit(
    sizes: &[(usize, usize)],
    first: usize,
    middle: Option<Option<usize>>,
    last: usize,
) -> bool {
    sizes.iter().any(|&(primary, secondary)| {
        last == primary
            && (1..=secondary).contains(&first)
            && match middle {
                None => true,
                Some(run) => run == Some(secondary),
            }
    })
}

fn require_data(locale: &Locale, input: &str) -> Result<(), Error> {
    if input.len() > MAX_INPUT {
        return Err(Error::InputTooLong);
    }
    if !locale.has_data() {
        return Err(Error::NoLocaleData);
    }
    Ok(())
}

/// The first and last digit positions, by character.
fn digit_span(chars: &[char]) -> Result<(usize, usize), Error> {
    let first = chars.iter().position(|&ch| digit_value(ch).is_some());
    let last = chars.iter().rposition(|&ch| digit_value(ch).is_some());
    match (first, last) {
        (Some(first), Some(last)) => Ok((first, last)),
        _ => Err(Error::Syntax(SyntaxError::NoDigits)),
    }
}

/// Reads a locale-formatted amount in `currency`: ducat's `parse`. Currency symbols and codes,
/// spaces and bidi marks around the number are ignored (the currency is the argument, never
/// guessed from the text); a minus sign (ASCII or U+2212) or parentheses in them make it
/// negative. Inside the number only digits (ASCII, Arabic-Indic, Persian, Devanagari, Thai and
/// the other decimal digit blocks ducat reads), the group separator before the decimal separator,
/// and one decimal separator are allowed. Group separators must be where the locale puts them,
/// unless `lenient`.
///
/// # Errors
///
/// [`Error::Syntax`] for text that isn't an amount; [`Error::NoLocaleData`] for a locale the
/// build has no data for; [`Error::InputTooLong`]; [`Error::Money`] with
/// [`ducat::Error::Rounding`] for more decimals than the scale without `rounding`.
pub fn parse(
    input: &str,
    currency: CurrencyCode,
    locale: &Locale,
    options: &ParseOptions,
) -> Result<AnyMoney, Error> {
    require_data(locale, input)?;
    let currency_format = CurrencyFormat::of(locale, currency.as_str());
    let (decimal, group) = currency_format.separators();
    let chars: Vec<char> = input.chars().collect();
    let (first, last) = digit_span(&chars)?;
    let prefix: String = chars[..first].iter().collect();
    let suffix: String = chars[last + 1..].iter().collect();
    if !prefix.chars().chain(suffix.chars()).all(is_affix) {
        return Err(Error::Syntax(SyntaxError::UnexpectedCharacters));
    }
    let negative = prefix
        .chars()
        .chain(suffix.chars())
        .any(|ch| matches!(ch, '-' | '−' | '('));
    let group_char = {
        let mut group_chars = group.chars();
        match (group_chars.next(), group_chars.next()) {
            (Some(ch), None) => Some(ch),
            _ => None,
        }
    };
    let group_is_space = group_char.is_some_and(unicode::is_space);
    let group_is_apostrophe = matches!(group_char, Some('\'' | '’'));
    let decimal_char = {
        let mut decimal_chars = decimal.chars();
        match (decimal_chars.next(), decimal_chars.next()) {
            (Some(ch), None) => Some(ch),
            _ => None,
        }
    };
    let is_group = |ch: char| {
        Some(ch) == group_char
            || (group_is_space && unicode::is_space(ch))
            || (group_is_apostrophe && matches!(ch, '\'' | '’'))
            || ch == '٬'
    };
    let mut out = String::with_capacity(chars.len() + 3);
    if negative {
        out.push('-');
    }
    let mut seen_decimal = prefix.ends_with(decimal);
    if seen_decimal {
        out.push_str("0.");
    }
    let mut separators = 0_usize;
    let mut first_run = 0;
    let mut middle: Option<Option<usize>> = None;
    let mut last_run: Option<usize> = None;
    let mut run = 0;
    for &ch in &chars[first..=last] {
        if let Some(digit) = digit_value(ch) {
            out.push(char::from_digit(digit, 10).unwrap_or('0'));
            run += 1;
        } else if Some(ch) == decimal_char || ch == '٫' {
            if seen_decimal {
                return Err(Error::Syntax(SyntaxError::MultipleDecimalSeparators));
            }
            seen_decimal = true;
            out.push('.');
            last_run = Some(run);
        } else if is_group(ch) {
            if seen_decimal {
                return Err(Error::Syntax(SyntaxError::GroupAfterDecimal));
            }
            if separators == 0 {
                first_run = run;
            } else {
                middle = match middle {
                    None => Some(Some(run)),
                    Some(Some(length)) if length == run => Some(Some(length)),
                    Some(_) => Some(None),
                };
            }
            separators += 1;
            run = 0;
        } else {
            return Err(Error::Syntax(SyntaxError::UnexpectedCharacter));
        }
    }
    if separators > 0 && !options.lenient {
        let last_run = last_run.unwrap_or(run);
        // a single separator has no middle runs; with two, the run between them is the middle
        let middle = if separators == 1 { None } else { middle };
        if !runs_fit(&currency_format.group_sizes()?, first_run, middle, last_run) {
            return Err(Error::Syntax(SyntaxError::MisplacedGroups));
        }
    }
    let scale = options
        .scale
        .unwrap_or_else(|| u16::from(currency.exponent()));
    AnyMoney::parse_at(
        &out,
        currency,
        scale,
        options.rounding.unwrap_or(Rounding::Unnecessary),
    )
    .map_err(Error::Money)
}

/// `text` without spaces, separators and bidi marks, as ducat compares symbols.
fn normalized(text: &str) -> String {
    text.chars()
        .filter(|&ch| !(unicode::is_space(ch) || unicode::is_format(ch)))
        .collect()
}

fn is_separator_piece(piece: &str) -> bool {
    matches!(piece, "" | "." | "," | "٫")
}

/// What `parse_money` detects from: the candidates, the caller's symbols, and the locales whose
/// symbols are read (the locale's own, then English's, which many texts use: US$, CA$, A$).
struct Detector<'a> {
    options: &'a ParseMoneyOptions<'a>,
    sources: Vec<Locale>,
}

impl Detector<'_> {
    fn is_candidate(&self, code: &str) -> bool {
        match self.options.currencies {
            None => CurrencyCode::iso(code).is_ok(),
            Some(list) => list.iter().any(|candidate| candidate.as_str() == code),
        }
    }

    fn code(&self, code: &str) -> Option<CurrencyCode> {
        if let Some(list) = self.options.currencies {
            if let Some(found) = list.iter().find(|candidate| candidate.as_str() == code) {
                return Some(*found);
            }
        }
        CurrencyCode::iso(code).ok()
    }

    /// The currencies one piece of affix text can mean, sorted; empty if it isn't a currency.
    fn meanings(&self, piece: &str) -> Vec<CurrencyCode> {
        let is_code = piece.len() == 3 && piece.bytes().all(|byte| byte.is_ascii_uppercase());
        if is_code && self.is_candidate(piece) {
            return self.code(piece).into_iter().collect();
        }
        for &(symbol, code) in self.options.symbols {
            if normalized(symbol) == piece {
                return alloc::vec![code];
            }
        }
        for source in &self.sources {
            let mut found: Vec<CurrencyCode> = CurrencyCode::iso_codes()
                .filter(|code| {
                    let code = code.as_str();
                    [false, true].into_iter().any(|narrow| {
                        let symbol = normalized(crate::currency_symbol(code, source, narrow));
                        !symbol.is_empty() && symbol != code && symbol == piece
                    })
                })
                .filter(|code| self.is_candidate(code.as_str()))
                .filter_map(|code| self.code(code.as_str()))
                .collect();
            if !found.is_empty() {
                found.sort_by(|left, right| left.as_str().cmp(right.as_str()));
                found.dedup();
                return found;
            }
        }
        Vec::new()
    }
}

/// Reads a formatted amount and detects its currency from the text: ducat's `parseMoney`. It
/// never guesses: it reads ISO codes (uppercase, among `currencies`) and symbols that mean one
/// currency in the locale (or in English: US$, CA$, A$); a symbol several currencies share needs
/// a `hint` or a `symbols` entry. The number is then read as [`parse`] reads it.
///
/// English's symbols are read only in a build with the `en` feature.
///
/// # Errors
///
/// [`Error::Syntax`] for no currency in the text (unless a `hint` and `lenient` are given),
/// another currency than the `hint`, two currencies, text around the number that isn't a
/// currency, a shared symbol without a `hint`, or what [`parse`] refuses; [`Error::NoLocaleData`];
/// [`Error::InputTooLong`]; [`Error::Money`] as [`parse`].
pub fn parse_money(
    input: &str,
    locale: &Locale,
    options: &ParseMoneyOptions<'_>,
) -> Result<AnyMoney, Error> {
    require_data(locale, input)?;
    let chars: Vec<char> = input.chars().collect();
    let (first, last) = digit_span(&chars)?;
    let mut sources = alloc::vec![*locale];
    for tag in ["en", "en-CA"] {
        if let Ok(english) = Locale::new(tag) {
            if english.has_data() {
                sources.push(english);
            }
        }
    }
    let detector = Detector { options, sources };
    let is_sign = |ch: char| matches!(ch, '(' | ')' | '+' | '-' | '−');
    let mut pieces: Vec<String> = Vec::new();
    for side in [&chars[..first], &chars[last + 1..]] {
        let side: String = side.iter().collect();
        for run in side.split(is_sign) {
            let whole = normalized(run);
            if is_separator_piece(&whole) {
                continue;
            }
            if detector.meanings(&whole).is_empty() {
                pieces.extend(
                    run.split(|ch: char| unicode::is_space(ch) || unicode::is_format(ch))
                        .filter(|piece| !is_separator_piece(piece))
                        .map(String::from),
                );
            } else {
                pieces.push(whole);
            }
        }
    }
    let mut detected: Option<CurrencyCode> = None;
    for piece in &pieces {
        let meanings = detector.meanings(piece);
        let currency = match meanings.as_slice() {
            [] => return Err(Error::Syntax(SyntaxError::NotACurrency)),
            [only] => *only,
            several => match options.hint {
                Some(hint) if several.iter().any(|code| code.as_str() == hint.as_str()) => hint,
                _ => return Err(Error::Syntax(SyntaxError::AmbiguousSymbol)),
            },
        };
        if detected.is_some_and(|found| found.as_str() != currency.as_str()) {
            return Err(Error::Syntax(SyntaxError::TwoCurrencies));
        }
        detected = Some(currency);
    }
    let currency = match (detected, options.hint) {
        (None, Some(hint)) if options.lenient => hint,
        (None, _) => return Err(Error::Syntax(SyntaxError::NoCurrency)),
        (Some(found), Some(hint)) if found.as_str() != hint.as_str() => {
            return Err(Error::Syntax(SyntaxError::NotTheHint));
        }
        (Some(found), _) => found,
    };
    let number_options = ParseOptions {
        scale: options.scale,
        rounding: options.rounding,
        lenient: options.lenient,
    };
    parse(input, currency, locale, &number_options)
}
