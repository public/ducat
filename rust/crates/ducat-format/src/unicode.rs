//! The few Unicode properties formatting and parsing test, without a Unicode database: currency
//! symbols (`Sc`), separators (`Z`), format characters (`Cf`) and letters. `core` has white space
//! and `Alphabetic`; the rest are short, stable lists from the Unicode Character Database.

/// `Sc`, the currency symbols (Unicode 17).
const CURRENCY_SYMBOLS: &[(u32, u32)] = &[
    (0x24, 0x24),
    (0xA2, 0xA5),
    (0x58F, 0x58F),
    (0x60B, 0x60B),
    (0x7FE, 0x7FF),
    (0x9F2, 0x9F3),
    (0x9FB, 0x9FB),
    (0xAF1, 0xAF1),
    (0xBF9, 0xBF9),
    (0xE3F, 0xE3F),
    (0x17DB, 0x17DB),
    (0x20A0, 0x20C1),
    (0xA838, 0xA838),
    (0xFDFC, 0xFDFC),
    (0xFE69, 0xFE69),
    (0xFF04, 0xFF04),
    (0xFFE0, 0xFFE1),
    (0xFFE5, 0xFFE6),
    (0x11FDD, 0x11FE0),
    (0x1E2FF, 0x1E2FF),
    (0x1ECB0, 0x1ECB0),
];

/// `Cf`, the format characters (Unicode 17).
const FORMAT_CHARACTERS: &[(u32, u32)] = &[
    (0xAD, 0xAD),
    (0x600, 0x605),
    (0x61C, 0x61C),
    (0x6DD, 0x6DD),
    (0x70F, 0x70F),
    (0x890, 0x891),
    (0x8E2, 0x8E2),
    (0x180E, 0x180E),
    (0x200B, 0x200F),
    (0x202A, 0x202E),
    (0x2060, 0x2064),
    (0x2066, 0x206F),
    (0xFEFF, 0xFEFF),
    (0xFFF9, 0xFFFB),
    (0x110BD, 0x110BD),
    (0x110CD, 0x110CD),
    (0x13430, 0x1343F),
    (0x1BCA0, 0x1BCA3),
    (0x1D173, 0x1D17A),
    (0xE0001, 0xE0001),
    (0xE0020, 0xE007F),
];

/// `Z`, the separators (`Zs`, `Zl`, `Zp`).
const SEPARATORS: &[(u32, u32)] = &[
    (0x20, 0x20),
    (0xA0, 0xA0),
    (0x1680, 0x1680),
    (0x2000, 0x200A),
    (0x2028, 0x2029),
    (0x202F, 0x202F),
    (0x205F, 0x205F),
    (0x3000, 0x3000),
];

fn within(table: &[(u32, u32)], ch: char) -> bool {
    let code = u32::from(ch);
    table
        .binary_search_by(|&(low, high)| {
            if high < code {
                core::cmp::Ordering::Less
            } else if low > code {
                core::cmp::Ordering::Greater
            } else {
                core::cmp::Ordering::Equal
            }
        })
        .is_ok()
}

/// `\p{Sc}`.
pub(crate) fn is_currency_symbol(ch: char) -> bool {
    within(CURRENCY_SYMBOLS, ch)
}

/// `\p{Cf}`.
pub(crate) fn is_format(ch: char) -> bool {
    within(FORMAT_CHARACTERS, ch)
}

/// `\p{Z}`.
pub(crate) fn is_separator(ch: char) -> bool {
    within(SEPARATORS, ch)
}

/// `[\s\p{Z}]`: JavaScript's white space (`\s`, which adds U+FEFF) or a separator.
pub(crate) fn is_space(ch: char) -> bool {
    ch.is_whitespace() || ch == '\u{feff}' || is_separator(ch)
}

/// A symbol (`\p{S}`) as currency spacing tests it: the currency symbols, and ASCII's math,
/// modifier and other symbols. CLDR's currency symbols start and end with no other kind of
/// symbol (`tests/format.rs` checks every one).
pub(crate) fn is_symbol(ch: char) -> bool {
    is_currency_symbol(ch) || matches!(ch, '+' | '<' | '=' | '>' | '^' | '`' | '|' | '~')
}

/// A letter (`\p{L}`). `core`'s `Alphabetic` also takes some combining vowel signs and letter
/// numbers; ducat's regular expression doesn't (spec/README.md does not depend on the difference).
pub(crate) fn is_letter(ch: char) -> bool {
    ch.is_alphabetic()
}

/// The value of a decimal digit in the blocks parse reads (ducat's list): ASCII, Arabic-Indic,
/// Persian, N'Ko, Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada,
/// Malayalam, Thai, Lao, Tibetan, Myanmar, Khmer, Mongolian, fullwidth.
pub(crate) fn digit_value(ch: char) -> Option<u32> {
    const ZEROS: [u32; 20] = [
        0x30, 0x660, 0x6F0, 0x7C0, 0x966, 0x9E6, 0xA66, 0xAE6, 0xB66, 0xBE6, 0xC66, 0xCE6, 0xD66,
        0xE50, 0xED0, 0xF20, 0x1040, 0x17E0, 0x1810, 0xFF10,
    ];
    let code = u32::from(ch);
    ZEROS
        .iter()
        .find(|&&zero| (zero..=zero + 9).contains(&code))
        .map(|&zero| code - zero)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tables_are_sorted_and_disjoint() {
        for table in [CURRENCY_SYMBOLS, FORMAT_CHARACTERS, SEPARATORS] {
            for pair in table.windows(2) {
                assert!(pair[0].0 <= pair[0].1 && pair[0].1 < pair[1].0, "{pair:?}");
            }
        }
    }

    #[test]
    fn classifies() {
        assert!(is_currency_symbol('€') && is_currency_symbol('$') && is_currency_symbol('₹'));
        assert!(!is_currency_symbol('E'));
        assert!(is_format('\u{200f}') && is_format('\u{61c}') && !is_format(' '));
        assert!(is_separator('\u{202f}') && is_space('\t') && is_space('\u{a0}'));
        assert_eq!(digit_value('٣'), Some(3));
        assert_eq!(digit_value('۷'), Some(7));
        assert_eq!(digit_value('९'), Some(9));
        assert_eq!(digit_value('๕'), Some(5));
        assert_eq!(digit_value('a'), None);
    }
}
