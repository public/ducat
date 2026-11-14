//! Exact rational factors.

use core::fmt;
use core::str::FromStr;

use crate::Error;
use crate::decimal::{Decimal, faithful_decimal, parse_decimal};

/// An exact rational number: a reduced `i128` numerator over a positive `i128` denominator.
///
/// Every multiplier, divisor, rate and percentage is a `Ratio`, so no factor is ever a float.
/// Build one from an integer (`Ratio::from(3)`), a decimal string (`"1.075".parse()`), a fraction
/// string (`"1/3".parse()`), two integers ([`Ratio::new`]), or a float ([`Ratio::try_from`],
/// which takes its shortest round-trip form and refuses more than 15 significant digits).
///
/// ```
/// use ducat::Ratio;
///
/// let rate: Ratio = "1.075".parse()?;
/// assert_eq!((rate.numer(), rate.denom()), (43, 40));
/// assert_eq!(Ratio::try_from(0.1)?, Ratio::new(1, 10)?);
/// # Ok::<(), ducat::Error>(())
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Ratio {
    num: i128,
    den: i128,
}

const fn gcd(mut left: u128, mut right: u128) -> u128 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left
}

impl Ratio {
    /// Zero.
    pub const ZERO: Self = Self { num: 0, den: 1 };
    /// One.
    pub const ONE: Self = Self { num: 1, den: 1 };

    /// `num / den`, reduced, with a positive denominator.
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`] when `den` is zero; [`Error::Overflow`] when the reduced value
    /// doesn't fit (only `i128::MIN` over a negative denominator can do that).
    pub const fn new(num: i128, den: i128) -> Result<Self, Error> {
        if den == 0 {
            return Err(Error::DivisionByZero);
        }
        let divisor = gcd(num.unsigned_abs(), den.unsigned_abs());
        let negative = (num < 0) != (den < 0) && num != 0;
        let magnitude = num.unsigned_abs() / divisor;
        let den = den.unsigned_abs() / divisor;
        if den > i128::MAX as u128 {
            return Err(Error::Overflow);
        }
        let num = if negative {
            if magnitude > i128::MIN.unsigned_abs() {
                return Err(Error::Overflow);
            }
            (magnitude as i128).wrapping_neg()
        } else {
            if magnitude > i128::MAX as u128 {
                return Err(Error::Overflow);
            }
            magnitude as i128
        };
        Ok(Self {
            num,
            den: den as i128,
        })
    }

    /// The numerator, in lowest terms; it carries the sign.
    #[must_use]
    pub const fn numer(self) -> i128 {
        self.num
    }

    /// The denominator, in lowest terms; always positive.
    #[must_use]
    pub const fn denom(self) -> i128 {
        self.den
    }

    /// Whether the value is zero.
    #[must_use]
    pub const fn is_zero(self) -> bool {
        self.num == 0
    }

    /// `1 / self`.
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`] for zero; [`Error::Overflow`] for `i128::MIN` over anything.
    pub const fn recip(self) -> Result<Self, Error> {
        Self::new(self.den, self.num)
    }

    /// `self / other`, cross-reduced before multiplying so a quotient that fits is found even when
    /// the plain products don't.
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`] when `other` is zero; [`Error::Overflow`] when the reduced
    /// quotient doesn't fit.
    pub fn checked_div(self, other: Self) -> Result<Self, Error> {
        self.checked_mul(other.recip()?)
    }

    /// `self × other`, cross-reduced before multiplying.
    ///
    /// # Errors
    ///
    /// [`Error::Overflow`] when the reduced product doesn't fit.
    pub fn checked_mul(self, other: Self) -> Result<Self, Error> {
        let first = gcd(self.num.unsigned_abs(), other.den.unsigned_abs()).max(1);
        let second = gcd(other.num.unsigned_abs(), self.den.unsigned_abs()).max(1);
        let negative = (self.num < 0) != (other.num < 0);
        let num = (self.num.unsigned_abs() / first)
            .checked_mul(other.num.unsigned_abs() / second)
            .ok_or(Error::Overflow)?;
        let den = (self.den.unsigned_abs() / second)
            .checked_mul(other.den.unsigned_abs() / first)
            .ok_or(Error::Overflow)?;
        let den = i128::try_from(den).map_err(|_| Error::Overflow)?;
        let num = if negative {
            0i128.checked_sub_unsigned(num).ok_or(Error::Overflow)?
        } else {
            i128::try_from(num).map_err(|_| Error::Overflow)?
        };
        Ok(Self { num, den })
    }

    /// An exact decimal `digits × 10^−scale` as a reduced ratio, cancelling twos and fives first
    /// so that `"0.5"` with many trailing zeros still fits.
    pub(crate) fn from_decimal(decimal: Decimal) -> Result<Self, Error> {
        let Decimal { mut digits, scale } = decimal;
        if digits == 0 {
            return Ok(Self::ZERO);
        }
        let (mut twos, mut fives) = (u32::from(scale), u32::from(scale));
        while twos > 0 && digits % 2 == 0 {
            digits /= 2;
            twos -= 1;
        }
        while fives > 0 && digits % 5 == 0 {
            digits /= 5;
            fives -= 1;
        }
        let den = 2i128
            .checked_pow(twos)
            .and_then(|power| {
                5i128
                    .checked_pow(fives)
                    .and_then(|other| power.checked_mul(other))
            })
            .ok_or(Error::Overflow)?;
        Ok(Self { num: digits, den })
    }
}

impl Default for Ratio {
    /// Zero.
    fn default() -> Self {
        Self::ZERO
    }
}

macro_rules! from_integer {
    ($($integer:ty),*) => {$(
        impl From<$integer> for Ratio {
            /// The integer, exactly.
            fn from(value: $integer) -> Self {
                Self { num: i128::from(value), den: 1 }
            }
        }
    )*};
}
from_integer!(i8, i16, i32, i64, i128, u8, u16, u32, u64);

impl TryFrom<f64> for Ratio {
    type Error = Error;

    /// A float at its shortest round-trip decimal form: `0.1` is exactly 1/10.
    ///
    /// # Errors
    ///
    /// [`Error::NotFinite`] for NaN and the infinities; [`Error::TooManyDigits`] for a value
    /// whose shortest form has more than 15 significant digits (such as `0.1 + 0.2`) and that
    /// isn't a safe integer, since a float artefact can't be told from a decimal someone wrote;
    /// [`Error::Overflow`] when the ratio doesn't fit.
    fn try_from(value: f64) -> Result<Self, Error> {
        Self::from_decimal(faithful_decimal(value, true)?)
    }
}

impl FromStr for Ratio {
    type Err = Error;

    /// A decimal string in ducat's grammar (`"1.075"`, `"-2"`, `"1.5e3"`), or two of them around
    /// a slash (`"1/3"`, `"1.5/2"`).
    ///
    /// # Errors
    ///
    /// [`Error::Syntax`] outside the grammar; [`Error::ExponentOutOfRange`] for an exponent or
    /// decimal places beyond 1000; [`Error::DivisionByZero`] for a zero denominator;
    /// [`Error::Overflow`] when the value doesn't fit.
    fn from_str(text: &str) -> Result<Self, Error> {
        match text.split_once('/') {
            Some((num, den)) => {
                let num = Self::from_decimal(parse_decimal(num)?)?;
                let den = Self::from_decimal(parse_decimal(den)?)?;
                num.checked_div(den)
            }
            None => Self::from_decimal(parse_decimal(text)?),
        }
    }
}

impl fmt::Display for Ratio {
    /// `num/den`, or just `num` for an integer.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.den == 1 {
            write!(f, "{}", self.num)
        } else {
            write!(f, "{}/{}", self.num, self.den)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ratio(text: &str) -> Result<(i128, i128), Error> {
        text.parse::<Ratio>()
            .map(|ratio| (ratio.numer(), ratio.denom()))
    }

    #[test]
    fn parses() {
        assert_eq!(ratio("1.075"), Ok((43, 40)));
        assert_eq!(ratio("1/3"), Ok((1, 3)));
        assert_eq!(ratio("-2/-4"), Ok((1, 2)));
        assert_eq!(ratio("1.5/0.5"), Ok((3, 1)));
        assert_eq!(ratio("1/0"), Err(Error::DivisionByZero));
        assert_eq!(
            ratio("0.50000000000000000000000000000000000000000000000000"),
            Ok((1, 2))
        );
        assert_eq!(ratio("1e-39"), Err(Error::Overflow));
        assert_eq!(ratio("1/"), Err(Error::Syntax));
        assert_eq!(ratio("/1"), Err(Error::Syntax));
    }

    #[test]
    fn overflow_is_an_error() {
        // T20: the reduced result fits even though the plain product doesn't
        let small = Ratio::new(1, 3_000_000_000).unwrap();
        let big = Ratio::from(3_080_000_000u64);
        assert_eq!(
            small.checked_div(big).map(|r| (r.numer(), r.denom())),
            Ok((1, 9_240_000_000_000_000_000))
        );
        assert_eq!(Ratio::new(i128::MIN, -1), Err(Error::Overflow));
        assert_eq!(
            Ratio::new(i128::MIN, 2).map(|r| r.numer()),
            Ok(i128::MIN / 2)
        );
        assert_eq!(Ratio::new(0, 0), Err(Error::DivisionByZero));
        assert_eq!(Ratio::new(0, -5), Ok(Ratio::ZERO));
        assert_eq!(
            Ratio::from(i128::MAX).checked_mul(Ratio::from(2)),
            Err(Error::Overflow)
        );
        assert_eq!(Ratio::from(i128::MIN).recip(), Err(Error::Overflow));
        assert_eq!(
            Ratio::new(i128::MIN, 1).unwrap().checked_mul(Ratio::ONE),
            Ok(Ratio::new(i128::MIN, 1).unwrap())
        );
    }

    #[test]
    fn floats() {
        assert_eq!(Ratio::try_from(0.1), Ratio::new(1, 10));
        assert_eq!(Ratio::try_from(7.9), Ratio::new(79, 10));
        assert_eq!(Ratio::try_from(0.1 + 0.2), Err(Error::TooManyDigits));
        assert_eq!(Ratio::try_from(f64::NAN), Err(Error::NotFinite));
        assert_eq!(
            Ratio::try_from(1652185258.8058286),
            Err(Error::TooManyDigits)
        );
        assert_eq!(
            Ratio::try_from(20000.000001),
            Ratio::new(20_000_000_001, 1_000_000)
        );
    }
}
