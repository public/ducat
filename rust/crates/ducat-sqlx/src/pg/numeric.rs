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

use crate::{Decimal, Error};

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
    Ok(Decimal(ducat_sql_core::numeric::decode(bytes)?))
}

/// Appends a decimal in Postgres's binary NUMERIC format: the shortest digits (no leading or
/// trailing zero digits), the scale as `dscale`, and zero as no digits with a positive sign.
///
/// ```
/// use ducat_sqlx::{Decimal, pg::encode_numeric};
///
/// let mut bytes = Vec::new();
/// encode_numeric(&"-0.0005".parse::<Decimal>()?, &mut bytes)?;
/// assert_eq!(bytes, [0, 1, 0xFF, 0xFF, 0x40, 0, 0, 4, 0, 5]); // −5 × 10000^−1
/// # Ok::<(), ducat_sqlx::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::OutOfRange`] for a value whose weight or digit count doesn't fit the format's 16-bit
/// fields (beyond about 10^131072); nothing is appended then.
pub fn encode_numeric(decimal: &Decimal, buffer: &mut Vec<u8>) -> Result<(), Error> {
    Ok(ducat_sql_core::numeric::encode(&decimal.0, buffer)?)
}
