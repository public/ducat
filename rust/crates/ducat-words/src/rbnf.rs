//! An interpreter for CLDR's rule-based number formats (RBNF, the rules behind ICU's
//! RuleBasedNumberFormat), for whole numbers: ducat's `src/rbnf.ts`, following ICU's semantics
//! (<https://unicode-org.github.io/icu/userguide/format_parse/numbers/rbnf.html>).
//!
//! Where it can't match ICU it refuses: values outside ICU's int64 range, and plurals whose
//! quotient ICU truncates to 32 bits into another plural category. Numbers the rules write as
//! digits (`=#,##0=`, from 10^18 in most rule sets) are grouped as CLDR does for the locale.

use alloc::string::String;
use alloc::vec::Vec;

use crate::plural::{PluralType, category};
use crate::{Error, Locale, SpelloutRules};

/// Deeper than any CLDR rule set nests (a value passes through a few rules per group of digits),
/// and shallow enough that adversarial rule text can't overflow the stack.
const MAX_DEPTH: usize = 64;

/// ICU's RBNF formats int64 values; past them it writes plain digits, so this refuses instead.
const INT64_MAX: i128 = i64::MAX as i128;

#[derive(Debug)]
enum Part {
    Text(String),
    /// `<` quotient, `>` remainder, `=` the number itself, `>>>` remainder by the previous rule;
    /// the target is a rule set (`%spellout-numbering`), a decimal pattern (`#,##0`) or empty for
    /// this set.
    Substitution(Kind, String),
    Plural(PluralType, Vec<(String, String)>),
    Optional(Vec<Part>, Vec<Part>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Quotient,
    Remainder,
    Whole,
    PreviousRemainder,
}

#[derive(Debug)]
struct Rule {
    base: i128,
    divisor: i128,
    parts: Vec<Part>,
    /// Whether a part is a remainder substitution (for ICU's rollback rule).
    has_remainder: bool,
}

#[derive(Debug)]
struct RuleSet {
    name: String,
    rules: Vec<Rule>,
    negative: Option<Rule>,
}

/// A language's rules, parsed once: [`CompiledRules::new`], then [`CompiledRules::spell_out`] as
/// often as needed.
#[derive(Debug)]
pub struct CompiledRules {
    locale: Locale,
    sets: Vec<RuleSet>,
}

/// The largest power of `radix` at most `base`.
fn divisor_for(base: i128, radix: i128) -> Result<i128, Error> {
    if radix < 2 {
        return Err(Error::MalformedRules);
    }
    let mut divisor = 1_i128;
    while let Some(next) = divisor.checked_mul(radix) {
        if next > base {
            break;
        }
        divisor = next;
    }
    Ok(divisor)
}

/// The byte index of `needle` in `text` at or after `from`.
fn find(text: &str, needle: &str, from: usize) -> Result<usize, Error> {
    text.get(from..)
        .and_then(|rest| rest.find(needle))
        .map(|at| from + at)
        .ok_or(Error::MalformedRules)
}

/// The cases of a plural part's body, `one{Million}other{Millionen}`.
fn plural_cases(body: &str) -> Vec<(String, String)> {
    let mut cases = Vec::new();
    let mut rest = body;
    while let Some(open) = rest.find('{') {
        let name_start = rest[..open]
            .char_indices()
            .rev()
            .take_while(|(_, char)| char.is_ascii_alphanumeric() || *char == '_' || *char == '=')
            .last()
            .map_or(open, |(at, _)| at);
        let Some(close) = rest[open + 1..].find('}') else {
            break;
        };
        let name = &rest[name_start..open];
        if !name.is_empty() {
            cases.push((name.into(), rest[open + 1..open + 1 + close].into()));
        }
        rest = &rest[open + 1 + close + 1..];
    }
    cases
}

/// Splits a rule's text into text, substitutions, plurals and optional parts.
fn parse_parts(text: &str) -> Result<(Vec<Part>, bool), Error> {
    let mut parts = Vec::new();
    let mut has_remainder = false;
    let mut literal = String::new();
    let flush = |literal: &mut String, parts: &mut Vec<Part>| {
        if !literal.is_empty() {
            parts.push(Part::Text(core::mem::take(literal)));
        }
    };
    let mut at = 0;
    while let Some(char) = text[at..].chars().next() {
        match char {
            '[' => {
                let close = find(text, "]", at)?;
                let inner = &text[at + 1..close];
                let (present, omitted) = inner.split_once('|').unwrap_or((inner, ""));
                let (present, present_remainder) = parse_parts(present)?;
                let (omitted, _) = parse_parts(omitted)?;
                has_remainder |= present_remainder;
                flush(&mut literal, &mut parts);
                parts.push(Part::Optional(present, omitted));
                at = close + 1;
            }
            '$' if text[at + 1..].starts_with('(') => {
                // $(cardinal,one{Million}other{Millionen})$
                let close = find(text, ")$", at)?;
                let body = &text[at + 2..close];
                let (kind, cases) = body.split_once(',').unwrap_or((body, ""));
                let kind = if kind == "ordinal" {
                    PluralType::Ordinal
                } else {
                    PluralType::Cardinal
                };
                flush(&mut literal, &mut parts);
                parts.push(Part::Plural(kind, plural_cases(cases)));
                at = close + 2;
            }
            '<' | '>' | '=' => {
                flush(&mut literal, &mut parts);
                if text[at..].starts_with(">>>") {
                    parts.push(Part::Substitution(Kind::PreviousRemainder, String::new()));
                    has_remainder = true;
                    at += 3;
                    continue;
                }
                let close = find(text, &text[at..at + 1], at + 1)?;
                let kind = match char {
                    '<' => Kind::Quotient,
                    '>' => Kind::Remainder,
                    _ => Kind::Whole,
                };
                has_remainder |= kind == Kind::Remainder;
                parts.push(Part::Substitution(kind, text[at + 1..close].into()));
                at = close + 1;
            }
            _ => {
                literal.push(char);
                at += char.len_utf8();
            }
        }
    }
    flush(&mut literal, &mut parts);
    Ok((parts, has_remainder))
}

/// A rule's descriptor as a base and radix, `1000`, `1,000,000/1000`; `None` for the fraction,
/// infinity and NaN rules, which don't apply to whole numbers.
fn base_of(descriptor: &str) -> Option<(i128, i128)> {
    let digits: String = descriptor.chars().filter(|char| *char != ',').collect();
    let (base, radix) = digits.split_once('/').unwrap_or((&digits, "10"));
    let all_digits =
        |text: &str| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit());
    if !all_digits(base) || !all_digits(radix) {
        return None;
    }
    Some((base.parse().ok()?, radix.parse().ok()?))
}

impl CompiledRules {
    /// The language's rules, parsed.
    ///
    /// # Errors
    ///
    /// [`Error::MalformedRules`] for rule text that can't be read: a rule before any rule set, an
    /// unclosed substitution, optional part or plural, or a radix below 2.
    pub fn new(rules: &SpelloutRules) -> Result<Self, Error> {
        let mut sets: Vec<RuleSet> = Vec::new();
        for raw in rules.rules.split('\n') {
            let line = raw.trim();
            if line.is_empty() {
                continue;
            }
            if line.starts_with('%') && line.ends_with(':') {
                sets.push(RuleSet {
                    name: line[..line.len() - 1].into(),
                    rules: Vec::new(),
                    negative: None,
                });
                continue;
            }
            let current = sets.last_mut().ok_or(Error::MalformedRules)?;
            let (descriptor, body) = line.split_once(':').ok_or(Error::MalformedRules)?;
            let descriptor = descriptor.trim();
            let mut body = body.strip_suffix(';').unwrap_or(body).trim_start();
            // a leading apostrophe keeps the whitespace after it (' and =%x=)
            if let Some(rest) = body.strip_prefix('\'') {
                body = rest;
            }
            let (parts, has_remainder) = parse_parts(body)?;
            if descriptor == "-x" {
                current.negative = Some(Rule {
                    base: 0,
                    divisor: 1,
                    parts,
                    has_remainder,
                });
                continue;
            }
            let Some((base, radix)) = base_of(descriptor) else {
                continue;
            };
            current.rules.push(Rule {
                base,
                divisor: divisor_for(base, radix)?,
                parts,
                has_remainder,
            });
        }
        Ok(Self {
            locale: rules.locale,
            sets,
        })
    }

    fn set(&self, name: &str) -> Result<&RuleSet, Error> {
        self.sets
            .iter()
            .find(|set| set.name == name)
            .ok_or(Error::NoRuleSet)
    }

    /// The public rule sets, in the order the rules list them: the names
    /// [`CompiledRules::spell_out`] accepts.
    pub fn rule_sets(&self) -> impl Iterator<Item = &str> {
        self.sets
            .iter()
            .map(|set| set.name.as_str())
            .filter(|name| !name.starts_with("%%"))
    }

    /// The language's default cardinal: `%spellout-cardinal`, or the masculine one where it has
    /// no neutral cardinal.
    #[must_use]
    pub fn default_cardinal(&self) -> &'static str {
        if self.set("%spellout-cardinal").is_ok() {
            "%spellout-cardinal"
        } else {
            "%spellout-cardinal-masculine"
        }
    }

    /// The cardinal rule set for a gender, falling back to the default.
    pub(crate) fn cardinal_for(&self, gender: Option<&str>) -> String {
        if let Some(gender) = gender {
            let name = alloc::format!("%spellout-cardinal-{gender}");
            if self.set(&name).is_ok() {
                return name;
            }
        }
        self.default_cardinal().into()
    }

    /// A whole number in words by one of the public rule sets (the default cardinal for `None`).
    ///
    /// # Errors
    ///
    /// [`Error::OutOfRange`] outside ±(2^63 − 1), ICU's range for the rules;
    /// [`Error::PrivateRuleSet`] for a `%%` rule set; [`Error::NoRuleSet`];
    /// [`Error::PluralTruncation`] where ICU picks a plural form from the value cut to 32 bits and
    /// that form differs; [`Error::MalformedRules`] and [`Error::TooDeep`] for rules that can't be
    /// applied.
    pub fn spell_out(&self, value: i128, rule_set: Option<&str>) -> Result<String, Error> {
        if !(-INT64_MAX..=INT64_MAX).contains(&value) {
            return Err(Error::OutOfRange);
        }
        let name = rule_set.unwrap_or_else(|| self.default_cardinal());
        if name.starts_with("%%") {
            return Err(Error::PrivateRuleSet);
        }
        let mut output = String::new();
        self.spell(self.set(name)?, value, 0, &mut output)?;
        Ok(output)
    }

    fn spell(
        &self,
        set: &RuleSet,
        value: i128,
        depth: usize,
        output: &mut String,
    ) -> Result<(), Error> {
        if depth > MAX_DEPTH {
            return Err(Error::TooDeep);
        }
        if value < 0 {
            return match &set.negative {
                Some(negative) => {
                    self.apply(set, None, negative, -value, &negative.parts, depth, output)
                }
                None => {
                    // as ICU does: a set without a -x rule hands the value, sign and all, to its
                    // first rule (in CLDR, always one that passes it on whole)
                    let first = set.rules.first().ok_or(Error::MalformedRules)?;
                    self.apply(set, Some(0), first, value, &first.parts, depth, output)
                }
            };
        }
        let index = rule_index(set, value)?;
        let rule = &set.rules[index];
        self.apply(set, Some(index), rule, value, &rule.parts, depth, output)
    }

    #[allow(clippy::too_many_arguments)]
    fn apply(
        &self,
        set: &RuleSet,
        index: Option<usize>,
        rule: &Rule,
        value: i128,
        parts: &[Part],
        depth: usize,
        output: &mut String,
    ) -> Result<(), Error> {
        if depth > MAX_DEPTH {
            return Err(Error::TooDeep);
        }
        let quotient = value / rule.divisor;
        let remainder = value % rule.divisor;
        for part in parts {
            match part {
                Part::Text(text) => output.push_str(text),
                Part::Optional(present, omitted) => {
                    // the bracketed text is left out when the value is a multiple of the divisor
                    let chosen = if remainder == 0 { omitted } else { present };
                    self.apply(set, index, rule, value, chosen, depth + 1, output)?;
                }
                Part::Plural(kind, cases) => {
                    let category = category(self.locale, *kind, quotient)?;
                    let text = cases
                        .iter()
                        .find(|(name, _)| name == category)
                        .or_else(|| cases.iter().find(|(name, _)| name == "other"))
                        .map_or("", |(_, text)| text.as_str());
                    output.push_str(text);
                }
                Part::Substitution(Kind::PreviousRemainder, _) => {
                    // the remainder, through the rule before this one rather than by the usual
                    // selection
                    let previous_index = index
                        .and_then(|index| index.checked_sub(1))
                        .ok_or(Error::MalformedRules)?;
                    let previous = &set.rules[previous_index];
                    self.apply(
                        set,
                        Some(previous_index),
                        previous,
                        remainder,
                        &previous.parts,
                        depth + 1,
                        output,
                    )?;
                }
                Part::Substitution(kind, target) => {
                    let operand = match kind {
                        Kind::Quotient => quotient,
                        Kind::Remainder if index.is_some() => remainder,
                        _ => value,
                    };
                    if !target.is_empty() && !target.starts_with('%') {
                        crate::digits::write(self.locale, target.contains(','), operand, output);
                    } else {
                        let target_set = if target.is_empty() {
                            set
                        } else {
                            self.set(target)?
                        };
                        self.spell(target_set, operand, depth + 1, output)?;
                    }
                }
            }
        }
        Ok(())
    }
}

/// The rule for a non-negative value: the last one whose base is at most the value.
fn rule_index(set: &RuleSet, value: i128) -> Result<usize, Error> {
    let count = set
        .rules
        .iter()
        .take_while(|rule| rule.base <= value)
        .count();
    let index = count.checked_sub(1).ok_or(Error::NoRule)?;
    // ICU's rollback: a rule whose base isn't a multiple of its divisor doesn't take values that
    // are (1100/100 doesn't spell 1200's remainder), so the rule before it does
    let rule = &set.rules[index];
    if index > 0 && rule.has_remainder && value % rule.divisor == 0 && rule.base % rule.divisor != 0
    {
        return Ok(index - 1);
    }
    Ok(index)
}
