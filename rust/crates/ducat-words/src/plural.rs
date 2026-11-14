//! CLDR's plural rules for whole numbers in the shipped languages, cardinal and ordinal: what
//! JavaScript's `Intl.PluralRules` selects, for the categories the rules and the unit names use.

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

/// The category of a non-negative operand.
fn select(locale: Locale, kind: PluralType, n: i128) -> &'static str {
    let many = n != 0 && n % MILLION == 0;
    match (kind, locale) {
        (PluralType::Cardinal, Locale::En | Locale::De | Locale::Nl) => {
            if n == 1 {
                "one"
            } else {
                "other"
            }
        }
        (PluralType::Cardinal, Locale::It | Locale::Es) => match n {
            1 => "one",
            _ if many => "many",
            _ => "other",
        },
        (PluralType::Cardinal, Locale::Fr | Locale::Pt) => match n {
            0 | 1 => "one",
            _ if many => "many",
            _ => "other",
        },
        (PluralType::Ordinal, Locale::En) => match (n % 10, n % 100) {
            (1, tens) if tens != 11 => "one",
            (2, tens) if tens != 12 => "two",
            (3, tens) if tens != 13 => "few",
            _ => "other",
        },
        (PluralType::Ordinal, Locale::Fr) => {
            if n == 1 {
                "one"
            } else {
                "other"
            }
        }
        (PluralType::Ordinal, Locale::It) => match n {
            11 | 8 | 80 | 800 => "many",
            _ => "other",
        },
        (PluralType::Ordinal, _) => "other",
    }
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
