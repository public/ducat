//! TR35 number patterns (`¤#,##0.00;(¤#,##0.00)`): a positive and an optional negative
//! subpattern, each a prefix, the number part and a suffix.
//! <https://www.unicode.org/reports/tr35/tr35-numbers.html#Number_Format_Patterns>

use alloc::string::String;
use alloc::vec::Vec;

/// The longest pattern read, in characters: CLDR's are under 40.
const MAX_PATTERN: usize = 256;

/// One piece of a prefix or suffix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Affix {
    /// Text written as it is (quoted text included).
    Literal(String),
    /// `¤`: the currency symbol, code or name.
    Currency,
    /// `-`: the locale's minus sign.
    Minus,
    /// `+`: the locale's plus sign.
    Plus,
}

/// A subpattern's text around the number.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Subpattern {
    pub(crate) prefix: Vec<Affix>,
    pub(crate) suffix: Vec<Affix>,
}

/// A parsed pattern.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Pattern {
    pub(crate) positive: Subpattern,
    pub(crate) negative: Subpattern,
    /// The explicit plus form (`signDisplay` always and except-zero): the negative subpattern
    /// with its minus sign replaced by the plus sign, or, where it has no minus sign (accounting's
    /// parentheses) or there is none, the plus sign before the positive subpattern, as ICU writes
    /// it.
    pub(crate) plus: Subpattern,
    /// The group sizes, primary (the last group) and secondary: (3, 3) for `#,##0`, (3, 2) for
    /// `#,##,##0`; `None` without grouping.
    pub(crate) grouping: Option<(usize, usize)>,
}

/// Why a pattern can't be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Malformed;

fn push_literal(affixes: &mut Vec<Affix>, ch: char) {
    if let Some(Affix::Literal(text)) = affixes.last_mut() {
        text.push(ch);
    } else {
        let mut text = String::new();
        text.push(ch);
        affixes.push(Affix::Literal(text));
    }
}

/// The affixes of `text`, which holds no number part; `'` quotes, and `''` is an apostrophe.
pub(crate) fn affixes(text: &str) -> Result<Vec<Affix>, Malformed> {
    let mut out = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\'' => {
                if chars.peek() == Some(&'\'') {
                    chars.next();
                    push_literal(&mut out, '\'');
                    continue;
                }
                loop {
                    match chars.next() {
                        None => return Err(Malformed),
                        Some('\'') if chars.peek() == Some(&'\'') => {
                            chars.next();
                            push_literal(&mut out, '\'');
                        }
                        Some('\'') => break,
                        Some(quoted) => push_literal(&mut out, quoted),
                    }
                }
            }
            '¤' => {
                // ¤¤ (code) and ¤¤¤ (name) in a pattern are the same placeholder here: the
                // display option decides what it holds
                while chars.peek() == Some(&'¤') {
                    chars.next();
                }
                out.push(Affix::Currency);
            }
            '-' => out.push(Affix::Minus),
            '+' => out.push(Affix::Plus),
            // percent, per mille and padding have no meaning in a currency pattern
            '%' | '‰' | '*' => return Err(Malformed),
            other => push_literal(&mut out, other),
        }
    }
    Ok(out)
}

fn is_number_char(ch: char) -> bool {
    matches!(ch, '#' | '0'..='9' | ',' | '.' | '@')
}

/// Splits a subpattern into prefix, number part and suffix, respecting quotes.
fn split(sub: &str) -> Result<(&str, &str, &str), Malformed> {
    let mut quoted = false;
    let mut start = None;
    let mut end = 0;
    for (at, ch) in sub.char_indices() {
        if ch == '\'' {
            quoted = !quoted;
            if start.is_some() && end == 0 {
                end = at;
            }
            continue;
        }
        if quoted {
            continue;
        }
        if is_number_char(ch) {
            match start {
                None => start = Some(at),
                // a second number part is malformed
                Some(_) if end != 0 => return Err(Malformed),
                Some(_) => {}
            }
        } else if start.is_some() && end == 0 {
            end = at;
        }
    }
    let start = start.ok_or(Malformed)?;
    let end = if end == 0 { sub.len() } else { end };
    Ok((&sub[..start], &sub[start..end], &sub[end..]))
}

fn grouping(number: &str) -> Result<Option<(usize, usize)>, Malformed> {
    let mut parts = number.split('.');
    let integer = parts.next().unwrap_or("");
    let fraction = parts.next();
    if parts.next().is_some() || fraction.is_some_and(|fraction| fraction.contains(',')) {
        return Err(Malformed);
    }
    let runs: Vec<&str> = integer.split(',').collect();
    if runs.len() == 1 {
        return Ok(None);
    }
    let primary = runs[runs.len() - 1].len();
    let secondary = if runs.len() > 2 {
        runs[runs.len() - 2].len()
    } else {
        primary
    };
    if primary == 0 || secondary == 0 {
        return Err(Malformed);
    }
    Ok(Some((primary, secondary)))
}

/// The negative and plus subpatterns: the explicit negative one, else the minus sign before
/// the positive; the plus one is the negative with its minus sign replaced by the plus sign, or,
/// where it has none, the plus sign before the positive subpattern (ICU's).
fn signed_forms(positive: &Subpattern, explicit: Option<Subpattern>) -> (Subpattern, Subpattern) {
    let with_minus = explicit.as_ref().filter(|negative| {
        negative
            .prefix
            .iter()
            .chain(&negative.suffix)
            .any(|affix| *affix == Affix::Minus)
    });
    let plus = if let Some(negative) = with_minus {
        let to_plus = |affixes: &[Affix]| -> Vec<Affix> {
            affixes
                .iter()
                .map(|affix| match affix {
                    Affix::Minus => Affix::Plus,
                    other => other.clone(),
                })
                .collect()
        };
        Subpattern {
            prefix: to_plus(&negative.prefix),
            suffix: to_plus(&negative.suffix),
        }
    } else {
        let mut prefix = Vec::with_capacity(positive.prefix.len() + 1);
        prefix.push(Affix::Plus);
        prefix.extend(positive.prefix.iter().cloned());
        Subpattern {
            prefix,
            suffix: positive.suffix.clone(),
        }
    };
    let negative = match explicit {
        Some(negative) => negative,
        None => {
            let mut prefix = Vec::with_capacity(positive.prefix.len() + 1);
            prefix.push(Affix::Minus);
            prefix.extend(positive.prefix.iter().cloned());
            Subpattern {
                prefix,
                suffix: positive.suffix.clone(),
            }
        }
    };
    (negative, plus)
}

/// Reads a pattern. Without a negative subpattern, the negative is the minus sign before the
/// positive prefix (TR35).
pub(crate) fn parse(pattern: &str) -> Result<Pattern, Malformed> {
    if pattern.chars().count() > MAX_PATTERN {
        return Err(Malformed);
    }
    let (positive, negative) = match pattern.split_once(';') {
        Some((positive, negative)) => (positive, Some(negative)),
        None => (pattern, None),
    };
    let (prefix, number, suffix) = split(positive)?;
    let grouping = grouping(number)?;
    let positive = Subpattern {
        prefix: affixes(prefix)?,
        suffix: affixes(suffix)?,
    };
    let explicit = match negative {
        Some(negative) => {
            let (prefix, _, suffix) = split(negative)?;
            Some(Subpattern {
                prefix: affixes(prefix)?,
                suffix: affixes(suffix)?,
            })
        }
        None => None,
    };
    let (negative, plus) = signed_forms(&positive, explicit);
    Ok(Pattern {
        positive,
        negative,
        plus,
        grouping,
    })
}

/// The prefix, suffix and whether there is a number of a compact subpattern: its zeros stand
/// for the number.
fn compact_subpattern(sub: &str) -> Result<(Subpattern, bool), Malformed> {
    let mut quoted = false;
    let mut start = None;
    let mut end = sub.len();
    for (at, ch) in sub.char_indices() {
        if start.is_some() {
            if ch != '0' {
                end = at;
                break;
            }
        } else if ch == '\'' {
            quoted = !quoted;
        } else if !quoted && ch == '0' {
            start = Some(at);
        }
    }
    let (prefix, suffix, has_number) = match start {
        Some(start) => (&sub[..start], &sub[end..], true),
        None => (sub, "", false),
    };
    Ok((
        Subpattern {
            prefix: affixes(prefix)?,
            suffix: affixes(suffix)?,
        },
        has_number,
    ))
}

/// Reads a compact pattern (`¤0K`, `0 Mio'.' ¤`, `mille`, sw's `elfu 0;elfu -0`): its zeros
/// stand for the number, which a pattern without them doesn't show. The negative and plus forms
/// are as [`parse`] makes them: the negative subpattern where there is one, else the minus sign
/// before the positive one. Returns the pattern and whether it shows the number.
pub(crate) fn parse_compact(pattern: &str) -> Result<(Pattern, bool), Malformed> {
    if pattern.chars().count() > MAX_PATTERN {
        return Err(Malformed);
    }
    let (positive, negative) = match pattern.split_once(';') {
        Some((positive, negative)) => (positive, Some(negative)),
        None => (pattern, None),
    };
    let (positive, has_number) = compact_subpattern(positive)?;
    let explicit = negative
        .map(|negative| compact_subpattern(negative).map(|(sub, _)| sub))
        .transpose()?;
    let (negative, plus) = signed_forms(&positive, explicit);
    Ok((
        Pattern {
            positive,
            negative,
            plus,
            grouping: None,
        },
        has_number,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::string::ToString;
    use alloc::vec;

    fn literal(text: &str) -> Affix {
        Affix::Literal(text.to_string())
    }

    #[test]
    fn reads_cldr_patterns() {
        let pattern = parse("¤#,##0.00;(¤#,##0.00)").unwrap();
        assert_eq!(pattern.positive.prefix, vec![Affix::Currency]);
        assert_eq!(pattern.negative.prefix, vec![literal("("), Affix::Currency]);
        assert_eq!(pattern.negative.suffix, vec![literal(")")]);
        // parentheses have no minus sign: the plus goes before the positive subpattern
        assert_eq!(pattern.plus.prefix, vec![Affix::Plus, Affix::Currency]);
        assert_eq!(pattern.plus.suffix, vec![]);
        assert_eq!(pattern.grouping, Some((3, 3)));
        let pattern = parse("¤#,##,##0.00").unwrap();
        assert_eq!(pattern.grouping, Some((3, 2)));
        assert_eq!(pattern.negative.prefix, vec![Affix::Minus, Affix::Currency]);
        let pattern = parse("#,##0.00\u{a0}¤").unwrap();
        assert_eq!(
            pattern.positive.suffix,
            vec![literal("\u{a0}"), Affix::Currency]
        );
        let pattern = parse("¤\u{a0}#,##0.00;¤\u{a0}-#,##0.00").unwrap();
        assert_eq!(
            pattern.negative.prefix,
            vec![Affix::Currency, literal("\u{a0}"), Affix::Minus]
        );
        // a minus sign in the negative subpattern: the plus takes its place
        assert_eq!(
            pattern.plus.prefix,
            vec![Affix::Currency, literal("\u{a0}"), Affix::Plus]
        );
        assert_eq!(parse("'#'#0").unwrap().positive.prefix, vec![literal("#")]);
        assert_eq!(
            parse("0'' x").unwrap().positive.suffix,
            vec![literal("' x")]
        );
        assert_eq!(parse("#0").unwrap().grouping, None);
    }

    #[test]
    fn reads_compact_patterns() {
        let (pattern, number) = parse_compact("¤0K").unwrap();
        assert!(number);
        assert_eq!(pattern.positive.prefix, vec![Affix::Currency]);
        assert_eq!(pattern.positive.suffix, vec![literal("K")]);
        assert_eq!(pattern.negative.prefix, vec![Affix::Minus, Affix::Currency]);
        let (pattern, _) = parse_compact("000 Mio'.' ¤").unwrap();
        assert_eq!(
            pattern.positive.suffix,
            vec![literal(" Mio. "), Affix::Currency]
        );
        let (pattern, number) = parse_compact("mille").unwrap();
        assert!(!number);
        assert_eq!(pattern.positive.prefix, vec![literal("mille")]);
        let (pattern, _) = parse_compact("elfu 0;elfu -0").unwrap();
        assert_eq!(
            pattern.negative.prefix,
            vec![literal("elfu "), Affix::Minus]
        );
        assert_eq!(pattern.plus.prefix, vec![literal("elfu "), Affix::Plus]);
        assert_eq!(parse_compact("'0"), Err(Malformed));
    }

    #[test]
    fn refuses_malformed_patterns() {
        for pattern in ["", "¤", "'0", "0 0", "0%", "#,##0.0,0", "0.0.0", "*x0"] {
            assert_eq!(parse(pattern), Err(Malformed), "{pattern:?}");
        }
    }
}

#[cfg(test)]
mod properties {
    use super::*;
    use alloc::borrow::ToOwned;
    use alloc::vec;
    use proptest::prelude::*;

    fn pattern_text() -> impl Strategy<Value = String> {
        let piece = prop_oneof![
            Just("#".to_owned()),
            Just("0".to_owned()),
            Just(",".to_owned()),
            Just(".".to_owned()),
            Just(";".to_owned()),
            Just("'".to_owned()),
            Just("''".to_owned()),
            Just("¤".to_owned()),
            Just("-".to_owned()),
            Just("+".to_owned()),
            Just("\u{a0}".to_owned()),
            Just("\u{200f}".to_owned()),
            Just("€".to_owned()),
            any::<char>().prop_map(String::from),
        ];
        prop_oneof![
            prop::collection::vec(piece, 0..40).prop_map(|pieces| pieces.concat()),
            "\\PC{0,64}",
            (0_usize..600).prop_map(|count| "¤#".repeat(count)),
        ]
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(4096))]

        /// Any text, multi-byte included, is a pattern or `Malformed`, without a panic; a read
        /// pattern's group sizes are positive.
        #[test]
        fn reads_any_text(text in pattern_text()) {
            if let Ok(pattern) = parse(&text) {
                if let Some((primary, secondary)) = pattern.grouping {
                    prop_assert!(primary > 0 && secondary > 0);
                }
            }
        }
    }
}
