//! Numbers the rules write as digits (`=#,##0=`, from 10^18 in most rule sets), grouped as CLDR's
//! number formats do for the locale, as ducat gets them from the runtime's `Intl`.

use alloc::string::String;

use crate::Locale;

/// The locale's grouping separator, and the fewest digits before the first group for grouping to
/// apply (CLDR's `minimumGroupingDigits`: 2 in Spanish, so 1000 is `1000` but 10000 `10.000`).
const fn grouping(locale: Locale) -> (&'static str, usize) {
    match locale {
        Locale::En => (",", 1),
        // a narrow no-break space
        Locale::Fr => ("\u{202f}", 1),
        Locale::Es => (".", 2),
        Locale::De | Locale::It | Locale::Nl | Locale::Pt => (".", 1),
    }
}

/// `value` in digits, grouped in threes when `grouped`.
pub(crate) fn write(locale: Locale, grouped: bool, value: i128, output: &mut String) {
    if value < 0 {
        output.push('-');
    }
    let digits = alloc::format!("{}", value.unsigned_abs());
    let (separator, minimum) = grouping(locale);
    if !grouped || digits.len() < 4 + minimum - 1 {
        output.push_str(&digits);
        return;
    }
    for (at, digit) in digits.chars().enumerate() {
        if at > 0 && (digits.len() - at) % 3 == 0 {
            output.push_str(separator);
        }
        output.push(digit);
    }
}
