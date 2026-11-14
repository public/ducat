//! Numbers the rules write as digits (`=#,##0=`, from 10^18 in most rule sets), grouped as CLDR's
//! number formats do for the locale (its separator and `minimumGroupingDigits`, generated into
//! src/cldr.rs from data/cldr/), as ducat gets them from the runtime's `Intl`.

use alloc::string::String;

use crate::Locale;

/// `value` in digits, grouped in threes when `grouped`.
pub(crate) fn write(locale: Locale, grouped: bool, value: i128, output: &mut String) {
    if value < 0 {
        output.push('-');
    }
    let digits = alloc::format!("{}", value.unsigned_abs());
    let data = locale.data();
    let (separator, minimum) = (data.group, data.minimum_grouping);
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
