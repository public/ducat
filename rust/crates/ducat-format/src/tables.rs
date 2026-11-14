//! The shapes of the generated CLDR tables (`data.rs`, `icu.rs`), which `tests/data.rs` and
//! `tests/icu.rs` write from the repository's `data/cldr/` and `data/icu/`.

/// A locale's number data in its default numbering system, resolved (cldr-json's `main/` files
/// carry what they inherit).
#[derive(Debug)]
pub(crate) struct Numbers {
    /// The numbering system's ten digits, zero first.
    pub(crate) digits: [char; 10],
    /// The decimal separator in currency formats (`currencyDecimal`, else `decimal`).
    pub(crate) decimal: &'static str,
    /// The group separator in currency formats (`currencyGroup`, else `group`).
    pub(crate) group: &'static str,
    /// The minus sign; it may carry bidi marks.
    pub(crate) minus: &'static str,
    /// The plus sign.
    pub(crate) plus: &'static str,
    /// `minimumGroupingDigits`.
    pub(crate) minimum_grouping: u8,
    /// The standard decimal pattern, which currency names use.
    pub(crate) decimal_pattern: &'static str,
    /// The standard currency pattern.
    pub(crate) currency_pattern: &'static str,
    /// The accounting currency pattern.
    pub(crate) accounting_pattern: &'static str,
    /// `currencySpacing`'s `insertBetween`, before and after the number.
    pub(crate) spacing: (&'static str, &'static str),
    /// `unitPattern-count-<category>`, the pattern of a number with a currency's name.
    pub(crate) unit_patterns: &'static [(&'static str, &'static str)],
}

/// One currency's display data in a locale: only what differs from the locale it inherits from.
#[derive(Debug)]
pub(crate) struct CurrencyData {
    /// The ISO 4217 code.
    pub(crate) code: [u8; 3],
    /// Its fields, each a tag character and the text, separated by U+001F (which CLDR's text
    /// never holds): `s` the symbol, `n` the narrow symbol, `d` the display name, and the display
    /// names by plural category, `0` zero, `1` one, `2` two, `3` few, `4` many, `5` other.
    pub(crate) fields: &'static str,
}

/// The separator of [`CurrencyData::fields`].
pub(crate) const FIELD_SEPARATOR: char = '\u{1f}';

impl CurrencyData {
    /// The field with this tag.
    pub(crate) fn field(&self, tag: char) -> Option<&'static str> {
        self.fields
            .split(FIELD_SEPARATOR)
            .find_map(|field| field.strip_prefix(tag))
    }
}

/// The tag of a plural category's display name in [`CurrencyData::fields`].
pub(crate) fn category_tag(category: &str) -> char {
    match category {
        "zero" => '0',
        "one" => '1',
        "two" => '2',
        "few" => '3',
        "many" => '4',
        _ => '5',
    }
}

/// A locale of the snapshot.
#[derive(Debug)]
pub(crate) struct LocaleData {
    /// The locale's identifier, as cldr-json names it (`en-IN`, `und` for root).
    pub(crate) name: &'static str,
    /// The locale its currency data inherits from (`""` for root).
    pub(crate) parent: &'static str,
    /// Its number data.
    pub(crate) numbers: &'static Numbers,
    /// Its currencies that differ from the parent's, by code.
    pub(crate) currencies: &'static [CurrencyData],
    /// Its cardinal plural rules.
    pub(crate) plurals: &'static [Rule],
}

/// What a plural relation tests (TR35's operands).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Operand {
    /// The absolute value.
    N,
    /// The integer digits.
    I,
    /// The number of visible fraction digits, with trailing zeros.
    V,
    /// The number of visible fraction digits, without trailing zeros.
    W,
    /// The visible fraction digits, with trailing zeros, as an integer.
    F,
    /// The visible fraction digits, without trailing zeros, as an integer.
    T,
    /// The compact decimal exponent, always 0 here.
    E,
}

/// One relation: `operand % modulus` (no modulus when 0) is, or with `equal` false isn't, one of
/// the inclusive integer `ranges`.
#[derive(Debug)]
pub(crate) struct Relation {
    pub(crate) operand: Operand,
    pub(crate) modulus: u32,
    pub(crate) equal: bool,
    pub(crate) ranges: &'static [(u32, u32)],
}

/// A plural category and its condition: any of the alternatives, each all of its relations.
#[derive(Debug)]
pub(crate) struct Rule {
    pub(crate) category: &'static str,
    pub(crate) any: &'static [&'static [Relation]],
}
