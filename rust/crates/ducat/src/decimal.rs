//! Decimal strings: ducat's grammar in, plain exact decimals out, and the binary64 rule.

use core::fmt::{self, Write as _};

use crate::Error;
use crate::rounding::{Rounding, rescale_ratio};

/// The largest scale, and the largest exponent or number of decimal places a decimal string may
/// have, as in ducat. Far beyond any real amount, it keeps input such as `"1e999999999"` from
/// building enormous powers of ten.
pub const MAX_SCALE: u16 = 1000;

/// A double holds 15 significant decimal digits faithfully (`DBL_DIG`).
const MAX_FAITHFUL_DIGITS: usize = 15;

/// An exact decimal: `digits × 10^−scale`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Decimal {
    pub(crate) digits: i128,
    pub(crate) scale: u16,
}

/// Parses ducat's decimal-string grammar: an optional `+` or `-`, one or more ASCII digits,
/// optionally a point and one or more digits, and optionally `e` or `E`, an optional sign and
/// digits. The exponent is at most 1000 either way, and so is the number of decimal places once it
/// is applied.
pub(crate) fn parse_decimal(input: &str) -> Result<Decimal, Error> {
    let bytes = input.as_bytes();
    let mut index = 0;
    let negative = match bytes.first() {
        Some(b'-') => {
            index = 1;
            true
        }
        Some(b'+') => {
            index = 1;
            false
        }
        _ => false,
    };
    let digit_run = |from: usize| {
        bytes[from..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count()
    };

    let int_start = index;
    let int_len = digit_run(index);
    if int_len == 0 {
        return Err(Error::Syntax);
    }
    index += int_len;
    let (frac_start, frac_len) = if bytes.get(index) == Some(&b'.') {
        let len = digit_run(index + 1);
        if len == 0 {
            return Err(Error::Syntax);
        }
        let start = index + 1;
        index = start + len;
        (start, len)
    } else {
        (index, 0)
    };
    let mut exponent: i64 = 0;
    if matches!(bytes.get(index), Some(b'e' | b'E')) {
        index += 1;
        let exponent_negative = match bytes.get(index) {
            Some(b'-') => {
                index += 1;
                true
            }
            Some(b'+') => {
                index += 1;
                false
            }
            _ => false,
        };
        let len = digit_run(index);
        if len == 0 {
            return Err(Error::Syntax);
        }
        for &byte in &bytes[index..index + len] {
            // saturate: anything past 1000 is out of range anyway
            exponent = (exponent * 10 + i64::from(byte - b'0')).min(1_000_000);
        }
        if exponent_negative {
            exponent = -exponent;
        }
        index += len;
    }
    if index != bytes.len() {
        return Err(Error::Syntax);
    }
    let scale = i64::try_from(frac_len)
        .unwrap_or(i64::MAX)
        .saturating_sub(exponent);
    if exponent.abs() > i64::from(MAX_SCALE) || scale > i64::from(MAX_SCALE) {
        return Err(Error::ExponentOutOfRange);
    }

    // Trailing zeros in the fraction don't change the value: drop them, so "1.2300…0" with any
    // number of zeros still fits. (The range checks above are on the text as written.)
    let kept = bytes[frac_start..frac_start + frac_len]
        .iter()
        .rposition(|&byte| byte != b'0')
        .map_or(0, |last| last + 1);
    let scale = scale - i64::try_from(frac_len - kept).unwrap_or(0);
    let mut digits: i128 = 0;
    for &byte in bytes[int_start..int_start + int_len]
        .iter()
        .chain(&bytes[frac_start..frac_start + kept])
    {
        let digit = i128::from(byte - b'0');
        // accumulate negatively, so i128::MIN parses too
        digits = digits
            .checked_mul(10)
            .and_then(|value| value.checked_sub(digit))
            .ok_or(Error::Overflow)?;
    }
    if !negative {
        digits = digits.checked_neg().ok_or(Error::Overflow)?;
    }
    if scale < 0 {
        // a positive exponent beyond the fraction: scale the digits up to scale 0
        let up = u32::try_from(-scale).unwrap_or(u32::MAX);
        digits = rescale_ratio(digits, 1, 1, up, 0, Rounding::Unnecessary)?;
        return Ok(Decimal { digits, scale: 0 });
    }
    Ok(Decimal {
        digits,
        scale: u16::try_from(scale).unwrap_or(MAX_SCALE),
    })
}

/// A fixed-size buffer that `core::fmt` can write into, for floating-point text without `alloc`.
struct Buffer {
    bytes: [u8; 40],
    len: usize,
}

impl fmt::Write for Buffer {
    fn write_str(&mut self, text: &str) -> fmt::Result {
        let end = self.len + text.len();
        self.bytes
            .get_mut(self.len..end)
            .ok_or(fmt::Error)?
            .copy_from_slice(text.as_bytes());
        self.len = end;
        Ok(())
    }
}

/// A finite double at its shortest round-trip decimal form, with the number of significant digits
/// that form has.
pub(crate) fn shortest_decimal(value: f64) -> Result<(Decimal, usize), Error> {
    if !value.is_finite() {
        return Err(Error::NotFinite);
    }
    let mut buffer = Buffer {
        bytes: [0; 40],
        len: 0,
    };
    // `{:e}` writes the shortest digits that round-trip, as `3.0000000000000004e-1`
    write!(buffer, "{value:e}").map_err(|_| Error::Syntax)?;
    let text = core::str::from_utf8(&buffer.bytes[..buffer.len]).map_err(|_| Error::Syntax)?;
    let mantissa = text.split('e').next().unwrap_or(text);
    let significant = mantissa.bytes().filter(u8::is_ascii_digit).count();
    // `{:e}` writes `0e0` for zero: one significant digit
    Ok((parse_decimal(text)?, significant))
}

/// A finite double as an exact decimal under ducat's binary64 rule: safe integers (at most
/// 2^53 − 1 in magnitude) are exact; anything else is read at its shortest round-trip form, which
/// must have at most 15 significant digits unless `check_digits` is false.
pub(crate) fn faithful_decimal(value: f64, check_digits: bool) -> Result<Decimal, Error> {
    let (decimal, significant) = shortest_decimal(value)?;
    // 2^53 − 1 is exactly representable, so the comparison is exact
    // (no `fract` or `abs`: they need std, and the core is no_std)
    let safe_integer = (-9_007_199_254_740_991.0..=9_007_199_254_740_991.0).contains(&value)
        && value == (value as i64) as f64;
    if check_digits && !safe_integer && significant > MAX_FAITHFUL_DIGITS {
        return Err(Error::TooManyDigits);
    }
    Ok(decimal)
}

/// Writes `units × 10^−scale` as a plain decimal with exactly `scale` decimal places: `-0.05`,
/// `1000`, never an exponent.
pub(crate) fn write_scaled(f: &mut dyn fmt::Write, units: i128, scale: u16) -> fmt::Result {
    let mut digits = [0u8; 39];
    let mut magnitude = units.unsigned_abs();
    let mut len = 0;
    loop {
        digits[len] = b'0' + (magnitude % 10) as u8;
        len += 1;
        magnitude /= 10;
        if magnitude == 0 {
            break;
        }
    }
    // digits[..len] is the magnitude, least significant first
    if units < 0 {
        f.write_char('-')?;
    }
    let scale = usize::from(scale);
    let digit = |position: usize| {
        if position < len {
            char::from(digits[position])
        } else {
            '0'
        }
    };
    if len > scale {
        for position in (scale..len).rev() {
            f.write_char(digit(position))?;
        }
    } else {
        f.write_char('0')?;
    }
    if scale > 0 {
        f.write_char('.')?;
        for position in (0..scale).rev() {
            f.write_char(digit(position))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use alloc::string::String;

    use super::*;

    fn parse(text: &str) -> Result<(i128, u16), Error> {
        parse_decimal(text).map(|decimal| (decimal.digits, decimal.scale))
    }

    #[test]
    fn grammar() {
        assert_eq!(parse("-12.340"), Ok((-1234, 2)));
        assert_eq!(
            parse("1.50000000000000000000000000000000000000000000000000"),
            Ok((15, 1))
        );
        assert_eq!(parse("0.000"), Ok((0, 0)));
        assert_eq!(parse("+7"), Ok((7, 0)));
        assert_eq!(parse("1.5e3"), Ok((1500, 0)));
        assert_eq!(parse("125E-2"), Ok((125, 2)));
        assert_eq!(parse("1E-29"), Ok((1, 29)));
        assert_eq!(parse("50000E15"), Ok((50_000_000_000_000_000_000, 0)));
        assert_eq!(parse("0e1000"), Ok((0, 0)));
        assert_eq!(parse("1e-1000"), Ok((1, 1000)));
        assert_eq!(
            parse("-170141183460469231731687303715884105728"),
            Ok((i128::MIN, 0))
        );
        assert_eq!(
            parse("170141183460469231731687303715884105728"),
            Err(Error::Overflow)
        );
        assert_eq!(parse("1e99999999999999"), Err(Error::ExponentOutOfRange));
        assert_eq!(parse("1e1001"), Err(Error::ExponentOutOfRange));
        assert_eq!(parse("0.1e-1000"), Err(Error::ExponentOutOfRange));
        assert_eq!(parse("1e100"), Err(Error::Overflow));
        for bad in [
            "", "-", "+", ".5", "5.", "-.5", "1,000", "1_000", " 1", "1 ", "1.23abc", "1_1.2_2",
            "1e", "1e+", "١", "--1", "1.2.3", "0x10", "NaN", "inf",
        ] {
            assert_eq!(parse(bad), Err(Error::Syntax), "{bad:?}");
        }
    }

    #[test]
    fn floats() {
        let digits = |value: f64| {
            faithful_decimal(value, true).map(|decimal| (decimal.digits, decimal.scale))
        };
        assert_eq!(digits(0.1), Ok((1, 1)));
        assert_eq!(digits(7.9), Ok((79, 1)));
        assert_eq!(digits(20000.000001), Ok((20_000_000_001, 6)));
        assert_eq!(digits(0.1 + 0.2), Err(Error::TooManyDigits));
        assert_eq!(digits(1652185258.8058286), Err(Error::TooManyDigits));
        assert_eq!(
            digits(9_007_199_254_740_991.0),
            Ok((9_007_199_254_740_991, 0))
        );
        assert_eq!(digits(0.0), Ok((0, 0)));
        assert_eq!(digits(-0.0), Ok((0, 0)));
        assert_eq!(digits(1e21), Ok((1_000_000_000_000_000_000_000, 0)));
        assert_eq!(digits(5e-324), Ok((5, 324)));
        assert_eq!(digits(f64::NAN), Err(Error::NotFinite));
        assert_eq!(digits(f64::INFINITY), Err(Error::NotFinite));
        assert_eq!(
            faithful_decimal(0.1 + 0.2, false).map(|d| (d.digits, d.scale)),
            Ok((30_000_000_000_000_004, 17))
        );
    }

    #[test]
    fn writing() {
        let text = |units: i128, scale: u16| {
            let mut out = String::new();
            write_scaled(&mut out, units, scale).unwrap();
            out
        };
        assert_eq!(text(-5, 2), "-0.05");
        assert_eq!(text(1000, 0), "1000");
        assert_eq!(text(1234, 2), "12.34");
        assert_eq!(text(0, 3), "0.000");
        assert_eq!(
            text(i128::MIN, 0),
            "-170141183460469231731687303715884105728"
        );
        assert_eq!(
            text(i128::MAX, 40),
            "0.0170141183460469231731687303715884105727"
        );
    }
}
