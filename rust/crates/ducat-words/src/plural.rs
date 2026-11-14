//! CLDR's plural rules for whole numbers in the shipped languages, cardinal and ordinal (generated
//! into src/cldr.rs from data/cldr/): what JavaScript's `Intl.PluralRules` selects, for the
//! categories the rules and the unit names use.

use crate::{Error, Locale};

/// Which plural rules a plural part uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PluralType {
    Cardinal,
    Ordinal,
}

const MILLION: i128 = 1_000_000;

/// A whole number reduced, exactly, to one with the same plural category in every CLDR rule the
/// shipped languages use (n % 10, n % 100, i % 1000000 = 0 with i != 0, and equality with values
/// below a million; plural operands ignore the sign). ducat's `pluralOperand`.
pub(crate) const fn operand(value: i128) -> i128 {
    let magnitude = value.unsigned_abs() as i128;
    if magnitude < MILLION {
        magnitude
    } else {
        magnitude % MILLION + MILLION
    }
}

/// What a relation tests: the whole number (CLDR's `n` and `i`), or an operand that is zero for
/// whole numbers (`v`, `w`, `f`, `t`, `c`, `e`).
#[derive(Debug, Clone, Copy)]
pub(crate) enum Operand {
    Whole,
    Zero,
}

/// One relation of a CLDR plural rule: `operand % modulus` (no modulus when 0) is, or with
/// `equal` false isn't, in one of the inclusive `ranges`.
#[derive(Debug)]
pub(crate) struct Relation {
    pub(crate) operand: Operand,
    pub(crate) modulus: u32,
    pub(crate) equal: bool,
    pub(crate) ranges: &'static [(u32, u32)],
}

/// A category and its condition: any of the alternatives, each all of its relations.
#[derive(Debug)]
pub(crate) struct Rule {
    pub(crate) category: &'static str,
    pub(crate) any: &'static [&'static [Relation]],
}

impl Relation {
    fn holds(&self, n: i128) -> bool {
        let mut value = match self.operand {
            Operand::Whole => n,
            Operand::Zero => 0,
        };
        if self.modulus != 0 {
            value %= i128::from(self.modulus);
        }
        let within = self
            .ranges
            .iter()
            .any(|&(low, high)| i128::from(low) <= value && value <= i128::from(high));
        within == self.equal
    }
}

/// The category of a non-negative operand, by the language's CLDR rules (src/cldr.rs).
fn select(locale: Locale, kind: PluralType, n: i128) -> &'static str {
    let data = locale.data();
    let rules = match kind {
        PluralType::Cardinal => data.cardinal,
        PluralType::Ordinal => data.ordinal,
    };
    rules
        .iter()
        .find(|rule| {
            rule.any
                .iter()
                .any(|all| all.iter().all(|relation| relation.holds(n)))
        })
        .map_or("other", |rule| rule.category)
}

/// The plural category of `value`, as `Intl.PluralRules` gives it.
pub(crate) fn unit_category(locale: Locale, value: i128) -> &'static str {
    select(locale, PluralType::Cardinal, operand(value))
}

/// The plural category of a plural part's quotient.
///
/// # Errors
///
/// [`Error::PluralTruncation`] where ICU, which selects by the quotient cast to int32, would pick
/// another category: no spell-out then matches ICU.
pub(crate) fn category(
    locale: Locale,
    kind: PluralType,
    value: i128,
) -> Result<&'static str, Error> {
    let chosen = select(locale, kind, operand(value));
    // two's complement truncation, as JavaScript's BigInt.asIntN(32, value)
    #[allow(clippy::cast_possible_truncation)]
    let int32 = i128::from(value as i32);
    if int32 != value && select(locale, kind, operand(int32)) != chosen {
        return Err(Error::PluralTruncation);
    }
    Ok(chosen)
}
