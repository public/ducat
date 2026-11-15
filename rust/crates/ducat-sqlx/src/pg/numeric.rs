//! Postgres NUMERIC's binary format, read and written directly as ducat's integer and scale.
//!
//! The format (`numeric_send` and `numeric_recv` in Postgres's `numeric.c`) is four big-endian
//! 16-bit fields and then the digits:
//!
//! | field | type | meaning |
//! |---|---|---|
//! | `ndigits` | int16 | the number of base-10000 digits that follow |
//! | `weight` | int16 | the power of 10000 of the first digit |
//! | `sign` | uint16 | `0x0000` positive, `0x4000` negative, `0xC000` NaN, `0xD000` `Infinity`, `0xF000` `-Infinity` |
//! | `dscale` | int16 | the display scale: the decimal digits after the point |
//! | digits | int16 × `ndigits` | each 0 to 9999, most significant first |
//!
//! The value is `Σ digit[i] × 10000^(weight − i)`, shown with `dscale` decimals. Postgres strips
//! leading and trailing zero digits, so zero has no digits and the scale lives only in `dscale`.

use core::fmt::Write as _;

use crate::{Decimal, Error};

const SIGN_POSITIVE: u16 = 0x0000;
const SIGN_NEGATIVE: u16 = 0x4000;
const SIGN_NAN: u16 = 0xC000;
const SIGN_INFINITY: u16 = 0xD000;
const SIGN_NEGATIVE_INFINITY: u16 = 0xF000;
/// Postgres's `NUMERIC_DSCALE_MASK`: a display scale is at most 16383.
const DSCALE_MAX: u16 = 0x3FFF;
const HEADER_LEN: usize = 8;

/// Reads the big-endian 16-bit field at `index` of a buffer whose length was checked.
fn field(bytes: &[u8], index: usize) -> u16 {
    match bytes.get(index * 2..index * 2 + 2) {
        Some(&[high, low]) => u16::from_be_bytes([high, low]),
        _ => 0,
    }
}

/// A NUMERIC in Postgres's binary format, exactly: the digits as ducat's integer, `dscale` as the
/// scale.
///
/// ```
/// use ducat_sqlx::pg::decode_numeric;
///
/// // 12.34: two digits (12, 3400), weight 0, positive, dscale 2
/// let bytes = [0, 2, 0, 0, 0, 0, 0, 2, 0, 12, 0x0D, 0x48];
/// assert_eq!(decode_numeric(&bytes)?.to_string(), "12.34");
/// # Ok::<(), ducat_sqlx::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::NotANumber`] and [`Error::Infinite`] for the special values; [`Error::Malformed`] for
/// a buffer of the wrong length, a negative digit count, an unknown sign, a digit beyond 9999, a
/// display scale beyond 16383, or non-zero digits beyond the display scale (Postgres itself
/// truncates those away on input; here they are refused, never dropped); [`Error::Ducat`] with
/// [`ducat::Error::InvalidScale`] for a display scale beyond [`ducat::MAX_SCALE`].
pub fn decode_numeric(bytes: &[u8]) -> Result<Decimal, Error> {
    if bytes.len() < HEADER_LEN {
        return Err(Error::Malformed("a NUMERIC needs an 8-byte header"));
    }
    let ndigits = field(bytes, 0);
    let weight = i64::from(i16::from_be_bytes(field(bytes, 1).to_be_bytes()));
    let sign = field(bytes, 2);
    let dscale = field(bytes, 3);

    let negative = match sign {
        SIGN_POSITIVE => false,
        SIGN_NEGATIVE => true,
        SIGN_NAN => return Err(Error::NotANumber),
        SIGN_INFINITY => return Err(Error::Infinite { negative: false }),
        SIGN_NEGATIVE_INFINITY => return Err(Error::Infinite { negative: true }),
        _ => return Err(Error::Malformed("unknown NUMERIC sign")),
    };
    if ndigits > 0x7FFF {
        return Err(Error::Malformed("negative NUMERIC digit count"));
    }
    if dscale > DSCALE_MAX {
        return Err(Error::Malformed("NUMERIC display scale beyond 16383"));
    }
    let count = usize::from(ndigits);
    if bytes.len() != HEADER_LEN + 2 * count {
        return Err(Error::Malformed(
            "NUMERIC length doesn't match its digit count",
        ));
    }
    if dscale > ducat::MAX_SCALE {
        return Err(ducat::Error::InvalidScale.into());
    }

    let mut digits = String::with_capacity(4 * count);
    for index in 0..count {
        let digit = field(bytes, 4 + index);
        if digit > 9999 {
            return Err(Error::Malformed("NUMERIC digit beyond 9999"));
        }
        // four decimal digits per base-10000 digit; writing to a String can't fail
        let _ = write!(digits, "{digit:04}");
    }

    // The digit string D is the value times 10^−(4 × (weight − ndigits + 1)), so the units at
    // dscale are D × 10^shift.
    let count = i64::from(ndigits);
    let shift = 4 * (weight - count + 1) + i64::from(dscale);
    if count == 0 {
        return Decimal::from_digits(negative, "", dscale);
    }
    if shift >= 0 {
        // at most 4 × 32767 + 16383 zeros, the most a NUMERIC can carry
        let zeros = usize::try_from(shift).map_err(|_| Error::OutOfRange)?;
        digits.extend(core::iter::repeat_n('0', zeros));
    } else {
        let hidden = usize::try_from(-shift).map_err(|_| Error::OutOfRange)?;
        let kept = digits.len().saturating_sub(hidden);
        if digits.as_bytes()[kept..].iter().any(|&digit| digit != b'0') {
            return Err(Error::Malformed("NUMERIC digits beyond its display scale"));
        }
        digits.truncate(kept);
    }
    Decimal::from_digits(negative, &digits, dscale)
}

/// Appends a decimal in Postgres's binary NUMERIC format: the shortest digits (no leading or
/// trailing zero digits), the scale as `dscale`, and zero as no digits with a positive sign.
///
/// ```
/// use ducat_sqlx::{Decimal, pg::encode_numeric};
///
/// let mut bytes = Vec::new();
/// encode_numeric(&"-0.0005".parse::<Decimal>()?, &mut bytes)?;
/// assert_eq!(bytes, [0, 1, 0xFF, 0xFF, 0x40, 0, 0, 4, 0x13, 0x88]); // 5000 × 10000^−1
/// # Ok::<(), ducat_sqlx::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::OutOfRange`] for a value whose weight or digit count doesn't fit the format's 16-bit
/// fields (beyond about 10^131072); nothing is appended then.
pub fn encode_numeric(decimal: &Decimal, buffer: &mut Vec<u8>) -> Result<(), Error> {
    let (integer, fraction) = decimal.split_digits();

    // the integer part padded on the left to whole base-10000 digits, the fraction on the right
    let integer_pad = (4 - integer.len() % 4) % 4;
    let fraction_pad = (4 - fraction.len() % 4) % 4;
    let mut padded = String::with_capacity(integer_pad + integer.len() + fraction.len() + 4);
    padded.extend(core::iter::repeat_n('0', integer_pad));
    padded.push_str(&integer);
    padded.push_str(&fraction);
    padded.extend(core::iter::repeat_n('0', fraction_pad));

    let mut digits: Vec<u16> = padded
        .as_bytes()
        .chunks(4)
        .map(|chunk| {
            chunk
                .iter()
                .fold(0_u16, |value, &byte| value * 10 + u16::from(byte - b'0'))
        })
        .collect();
    let integer_digits = (integer_pad + integer.len()) / 4;
    let mut weight = i64::try_from(integer_digits).map_err(|_| Error::OutOfRange)? - 1;

    let leading = digits.iter().take_while(|&&digit| digit == 0).count();
    digits.drain(..leading);
    weight -= i64::try_from(leading).map_err(|_| Error::OutOfRange)?;
    let trailing = digits.iter().rev().take_while(|&&digit| digit == 0).count();
    digits.truncate(digits.len() - trailing);

    let negative = decimal.units().is_negative();
    if digits.is_empty() {
        weight = 0;
    }
    let ndigits = i16::try_from(digits.len()).map_err(|_| Error::OutOfRange)?;
    let weight = i16::try_from(weight).map_err(|_| Error::OutOfRange)?;
    // at most ducat::MAX_SCALE, well within the 14-bit field
    let dscale = decimal.scale();

    buffer.reserve(HEADER_LEN + 2 * digits.len());
    buffer.extend_from_slice(&ndigits.to_be_bytes());
    buffer.extend_from_slice(&weight.to_be_bytes());
    buffer.extend_from_slice(
        &(if negative {
            SIGN_NEGATIVE
        } else {
            SIGN_POSITIVE
        })
        .to_be_bytes(),
    );
    buffer.extend_from_slice(&dscale.to_be_bytes());
    for digit in digits {
        buffer.extend_from_slice(&digit.to_be_bytes());
    }
    Ok(())
}
