//! CLDR's plural rules on a number as displayed (TR35's operands, from its digits): `1.00` is
//! "other" in English, because it shows fraction digits.

use crate::tables::{Operand, Relation, Rule};

/// The digits of a non-negative decimal as displayed: `integer` without leading zeros (`""` for
/// zero), `fraction` with its trailing zeros.
pub(crate) struct Operands<'a> {
    integer: &'a str,
    fraction: &'a str,
}

impl<'a> Operands<'a> {
    /// The operands of `text`, `"1234.50"` (ASCII digits, an optional `.`; no sign).
    pub(crate) fn new(text: &'a str) -> Self {
        let (integer, fraction) = text.split_once('.').unwrap_or((text, ""));
        Self {
            integer: integer.trim_start_matches('0'),
            fraction,
        }
    }

    /// The fraction digits without trailing zeros.
    fn trimmed(&self) -> &'a str {
        self.fraction.trim_end_matches('0')
    }
}

/// A non-negative integer written in digits, without leading zeros.
fn modulo(digits: &str, modulus: u32) -> u64 {
    let modulus = u64::from(modulus);
    digits.bytes().fold(0, |rest, digit| {
        (rest * 10 + u64::from(digit - b'0')) % modulus
    })
}

/// `digits` (no leading zeros) as a u64, or `None` if it has more digits than any range bound.
fn small(digits: &str) -> Option<u64> {
    if digits.len() > 18 {
        return None;
    }
    Some(
        digits
            .bytes()
            .fold(0, |value, digit| value * 10 + u64::from(digit - b'0')),
    )
}

fn holds(relation: &Relation, operands: &Operands<'_>) -> bool {
    let count_text;
    // the operand's integer digits, and whether it is an integer at all (n with fraction digits
    // other than zeros isn't, and matches no integer range)
    let (digits, is_integer) = match relation.operand {
        Operand::N => (operands.integer, operands.trimmed().is_empty()),
        Operand::I => (operands.integer, true),
        Operand::V | Operand::W => {
            let count = if relation.operand == Operand::V {
                operands.fraction.len()
            } else {
                operands.trimmed().len()
            };
            count_text = alloc::format!("{count}");
            (count_text.trim_start_matches('0'), true)
        }
        Operand::F => (operands.fraction.trim_start_matches('0'), true),
        Operand::T => (operands.trimmed().trim_start_matches('0'), true),
        Operand::E => ("", true),
    };
    let value = if relation.modulus == 0 {
        small(digits)
    } else {
        Some(modulo(digits, relation.modulus))
    };
    let within = is_integer
        && value.is_some_and(|value| {
            relation
                .ranges
                .iter()
                .any(|&(low, high)| u64::from(low) <= value && value <= u64::from(high))
        });
    within == relation.equal
}

/// The plural category of a number as displayed.
pub(crate) fn category(rules: &'static [Rule], operands: &Operands<'_>) -> &'static str {
    rules
        .iter()
        .find(|rule| {
            rule.any
                .iter()
                .any(|all| all.iter().all(|relation| holds(relation, operands)))
        })
        .map_or("other", |rule| rule.category)
}
