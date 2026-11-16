//! CLDR's compact patterns (`decimalFormats` and `currencyFormats` `short` and `long`), as the
//! generated tables store them, and how ICU picks one: by the number's magnitude and the plural
//! form of the mantissa shown.

use crate::tables::FIELD_SEPARATOR;

/// One table of compact patterns: entries separated by [`FIELD_SEPARATOR`], each the magnitude
/// (two ASCII digits: `03` for `1000`), a plural tag (as [`crate::tables::category_tag`], or `z`
/// and `y` for CLDR's explicit `0` and `1` forms) and the pattern. A category whose pattern is the
/// `other` one's is left out (ICU falls back to `other`).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Table(pub(crate) &'static str);

impl Table {
    /// Whether the table has no patterns.
    pub(crate) const fn is_empty(self) -> bool {
        self.0.is_empty()
    }

    fn entries(self) -> impl Iterator<Item = (i64, char, &'static str)> {
        self.0
            .split(FIELD_SEPARATOR)
            .filter(|entry| entry.len() > 3)
            .filter_map(|entry| {
                let magnitude = entry.get(..2)?.parse::<i64>().ok()?;
                let mut rest = entry[2..].chars();
                let tag = rest.next()?;
                Some((magnitude, tag, rest.as_str()))
            })
    }

    /// The largest magnitude with patterns.
    fn largest(self) -> Option<i64> {
        self.entries().map(|(magnitude, ..)| magnitude).max()
    }

    /// The magnitude whose patterns a number of `magnitude` takes: above the largest, the
    /// largest's (`12,345,679T`); `None` below zero.
    fn clamp(self, magnitude: i64) -> Option<i64> {
        if magnitude < 0 {
            return None;
        }
        Some(magnitude.min(self.largest()?))
    }

    /// The power of ten a number of `magnitude` is divided by (ICU's multiplier): the
    /// magnitude less the pattern's zeros but one, or 0 where the pattern is `0` (no
    /// abbreviation) or there is none.
    pub(crate) fn exponent(self, magnitude: i64) -> i64 {
        let Some(magnitude) = self.clamp(magnitude) else {
            return 0;
        };
        self.entries()
            .filter(|&(found, ..)| found == magnitude)
            .find_map(|(_, _, pattern)| {
                // the positive subpattern's (sw's `elfu 0;elfu -0` has one)
                let positive = pattern.split(';').next().unwrap_or("");
                let zeros = positive.matches('0').count();
                (zeros > 0).then_some(zeros)
            })
            .and_then(|zeros| i64::try_from(zeros).ok())
            .filter(|_| {
                !self
                    .entries()
                    .any(|(found, tag, pattern)| found == magnitude && tag == '5' && pattern == "0")
            })
            .map_or(0, |zeros| magnitude - zeros + 1)
    }

    /// The pattern for a rounded number of `magnitude` whose mantissa is in the plural category
    /// with tag `tag` (and, for a whole mantissa of 0 or 1, the explicit form `explicit`), as
    /// ICU's `CompactData::getPattern` picks it; `None` for no abbreviation (`0`).
    pub(crate) fn pattern(
        self,
        magnitude: i64,
        explicit: Option<char>,
        tag: char,
    ) -> Option<&'static str> {
        let magnitude = self.clamp(magnitude)?;
        let find = |wanted: char| {
            self.entries()
                .find(|&(found, found_tag, _)| found == magnitude && found_tag == wanted)
                .map(|(_, _, pattern)| pattern)
        };
        let pattern = explicit
            .and_then(find)
            .or_else(|| find(tag))
            .or_else(|| find('5'))?;
        (pattern != "0").then_some(pattern)
    }
}

#[cfg(test)]
mod tests {
    use super::Table;

    #[test]
    fn picks_patterns() {
        let table = Table("035¤0K\u{1f}045¤00K\u{1f}055¤000K\u{1f}065¤0M\u{1f}061¤0 one");
        assert_eq!(table.exponent(2), 0);
        assert_eq!(table.exponent(3), 3);
        assert_eq!(table.exponent(5), 3);
        assert_eq!(table.exponent(6), 6);
        assert_eq!(table.exponent(19), 6);
        assert_eq!(table.exponent(-2), 0);
        assert_eq!(table.pattern(4, None, '5'), Some("¤00K"));
        assert_eq!(table.pattern(6, None, '1'), Some("¤0 one"));
        assert_eq!(table.pattern(6, None, '3'), Some("¤0M"));
        assert_eq!(table.pattern(2, None, '5'), None);
        let german = Table("0350\u{1f}065000 Mio'.'");
        assert_eq!(german.exponent(3), 0);
        assert_eq!(german.pattern(3, None, '5'), None);
        let italian = Table("0350 mila\u{1f}031mille");
        assert_eq!(italian.exponent(3), 3);
        assert_eq!(italian.pattern(3, None, '1'), Some("mille"));
        let swahili = Table("035elfu 0;elfu -0");
        assert_eq!(swahili.exponent(3), 3);
        assert!(Table("").is_empty());
        assert_eq!(Table("").exponent(5), 0);
    }
}
