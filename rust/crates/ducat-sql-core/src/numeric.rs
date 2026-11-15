//! Postgres NUMERIC's base-10000 digits and binary format, converted exactly to and from a
//! [`Decimal`].
//!
//! The binary format (`numeric_send` and `numeric_recv` in Postgres's `numeric.c`) is four
//! big-endian 16-bit fields and then the digits:
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
/// The most digits a NUMERIC's 16-bit count carries.
const NDIGITS_MAX: usize = 0x7FFF;
const HEADER_LEN: usize = 8;

/// A finite NUMERIC's fields: its sign, weight, display scale and base-10000 digits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Numeric {
    /// The sign bit.
    pub negative: bool,
    /// The power of 10000 of the first digit.
    pub weight: i16,
    /// The display scale.
    pub dscale: u16,
    /// The digits, most significant first; each must be 0 to 9999.
    pub digits: Vec<u16>,
}

/// Reads the big-endian 16-bit field at `index`, or 0 past the end (lengths are checked first).
fn field(bytes: &[u8], index: usize) -> u16 {
    match bytes.get(index * 2..index * 2 + 2) {
        Some(&[high, low]) => u16::from_be_bytes([high, low]),
        _ => 0,
    }
}

/// Checks a binary NUMERIC's header against its length, and refuses the special values: what
/// remains is a finite NUMERIC whose digits can be read.
///
/// # Errors
///
/// [`Error::NotANumber`] and [`Error::Infinite`] for the special values; [`Error::Malformed`] for
/// a buffer shorter than the header or of another length than its digit count says, a negative
/// digit count or an unknown sign.
pub fn check_header(bytes: &[u8]) -> Result<(), Error> {
    if bytes.len() < HEADER_LEN {
        return Err(Error::Malformed("a NUMERIC needs an 8-byte header"));
    }
    match field(bytes, 2) {
        SIGN_POSITIVE | SIGN_NEGATIVE => {}
        SIGN_NAN => return Err(Error::NotANumber),
        SIGN_INFINITY => return Err(Error::Infinite { negative: false }),
        SIGN_NEGATIVE_INFINITY => return Err(Error::Infinite { negative: true }),
        _ => return Err(Error::Malformed("unknown NUMERIC sign")),
    }
    let count = usize::from(field(bytes, 0));
    if count > NDIGITS_MAX {
        return Err(Error::Malformed("negative NUMERIC digit count"));
    }
    if bytes.len() != HEADER_LEN + 2 * count {
        return Err(Error::Malformed(
            "NUMERIC length doesn't match its digit count",
        ));
    }
    Ok(())
}

impl Numeric {
    /// A NUMERIC in Postgres's binary format.
    ///
    /// # Errors
    ///
    /// As [`check_header`].
    pub fn read(bytes: &[u8]) -> Result<Self, Error> {
        check_header(bytes)?;
        let count = usize::from(field(bytes, 0));
        Ok(Self {
            negative: field(bytes, 2) == SIGN_NEGATIVE,
            weight: i16::from_be_bytes(field(bytes, 1).to_be_bytes()),
            dscale: field(bytes, 3),
            digits: (0..count).map(|index| field(bytes, 4 + index)).collect(),
        })
    }

    /// Appends the NUMERIC in Postgres's binary format.
    pub fn write(&self, buffer: &mut Vec<u8>) {
        // at most NDIGITS_MAX digits, as `from_decimal` makes them
        let ndigits = u16::try_from(self.digits.len()).unwrap_or(u16::MAX);
        buffer.reserve(HEADER_LEN + 2 * self.digits.len());
        buffer.extend_from_slice(&ndigits.to_be_bytes());
        buffer.extend_from_slice(&self.weight.to_be_bytes());
        let sign = if self.negative {
            SIGN_NEGATIVE
        } else {
            SIGN_POSITIVE
        };
        buffer.extend_from_slice(&sign.to_be_bytes());
        buffer.extend_from_slice(&self.dscale.to_be_bytes());
        for digit in &self.digits {
            buffer.extend_from_slice(&digit.to_be_bytes());
        }
    }

    /// The decimal, exactly: the digits as the units, `dscale` as the scale.
    ///
    /// # Errors
    ///
    /// [`Error::Malformed`] for more than 32767 digits, a digit beyond 9999, a display scale
    /// beyond 16383, or non-zero digits beyond the display scale (Postgres itself truncates those
    /// away on input; here they are refused, never dropped); [`Error::Ducat`] with
    /// [`ducat::Error::InvalidScale`] for a display scale beyond [`ducat::MAX_SCALE`].
    pub fn to_decimal(&self) -> Result<Decimal, Error> {
        let count = self.digits.len();
        if count > NDIGITS_MAX {
            return Err(Error::Malformed("negative NUMERIC digit count"));
        }
        if self.dscale > DSCALE_MAX {
            return Err(Error::Malformed("NUMERIC display scale beyond 16383"));
        }
        if self.dscale > ducat::MAX_SCALE {
            return Err(ducat::Error::InvalidScale.into());
        }
        let mut digits = String::with_capacity(4 * count);
        for &digit in &self.digits {
            if digit > 9999 {
                return Err(Error::Malformed("NUMERIC digit beyond 9999"));
            }
            // four decimal digits per base-10000 digit; writing to a String can't fail
            let _ = write!(digits, "{digit:04}");
        }
        if count == 0 {
            return Decimal::from_digits(self.negative, "", self.dscale);
        }
        // The digit string D is the value times 10^−(4 × (weight − ndigits + 1)), so the units at
        // dscale are D × 10^shift. `count` is at most 32767, so the casts are exact.
        let count = i64::try_from(count).map_err(|_| Error::OutOfRange)?;
        let shift = 4 * (i64::from(self.weight) - count + 1) + i64::from(self.dscale);
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
        Decimal::from_digits(self.negative, &digits, self.dscale)
    }

    /// The shortest NUMERIC for a decimal: no leading or trailing zero digits, the scale as
    /// `dscale`, and zero as no digits with a positive sign.
    ///
    /// # Errors
    ///
    /// [`Error::OutOfRange`] for a value whose weight or digit count doesn't fit the format's
    /// 16-bit fields (beyond about 10^131072).
    pub fn from_decimal(decimal: &Decimal) -> Result<Self, Error> {
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

        if digits.is_empty() {
            weight = 0;
        }
        if digits.len() > NDIGITS_MAX {
            return Err(Error::OutOfRange);
        }
        Ok(Self {
            negative: decimal.units().is_negative(),
            weight: i16::try_from(weight).map_err(|_| Error::OutOfRange)?,
            // at most ducat::MAX_SCALE, well within the 14-bit field
            dscale: decimal.scale(),
            digits,
        })
    }
}

/// A NUMERIC in Postgres's binary format, exactly.
///
/// # Errors
///
/// As [`check_header`] and [`Numeric::to_decimal`].
pub fn decode(bytes: &[u8]) -> Result<Decimal, Error> {
    Numeric::read(bytes)?.to_decimal()
}

/// Appends a decimal in Postgres's binary NUMERIC format, its shortest form; nothing is appended
/// on error.
///
/// # Errors
///
/// As [`Numeric::from_decimal`].
pub fn encode(decimal: &Decimal, buffer: &mut Vec<u8>) -> Result<(), Error> {
    Numeric::from_decimal(decimal)?.write(buffer);
    Ok(())
}
