//! Exact rational factors.

use core::fmt;
use core::str::FromStr;

use crate::decimal::{Decimal, faithful_decimal, parse_decimal};
use crate::{Error, Int};

/// An exact rational number: a reduced numerator over a positive denominator, both of any size.
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
/// assert_eq!((rate.numer().to_i128(), rate.denom().to_i128()), (Some(43), Some(40)));
/// assert_eq!(Ratio::try_from(0.1)?, Ratio::new(1, 10)?);
/// # Ok::<(), ducat::Error>(())
/// ```
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Ratio {
    num: Int,
    den: Int,
}

impl Ratio {
    /// Zero.
    pub const ZERO: Self = Self {
        num: Int::ZERO,
        den: Int::ONE,
    };
    /// One.
    pub const ONE: Self = Self {
        num: Int::ONE,
        den: Int::ONE,
    };

    /// `num / den`, reduced, with a positive denominator.
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`] when `den` is zero.
    pub fn new(num: impl Into<Int>, den: impl Into<Int>) -> Result<Self, Error> {
        Self::reduced(num.into(), den.into())
    }

    fn reduced(num: Int, den: Int) -> Result<Self, Error> {
        if den.is_zero() {
            return Err(Error::DivisionByZero);
        }
        if num.is_zero() {
            return Ok(Self::ZERO);
        }
        let divisor = num.gcd(&den);
        let (num, den) = if divisor == 1 {
            (num, den)
        } else {
            (num.exact_div(&divisor), den.exact_div(&divisor))
        };
        Ok(if den.is_negative() {
            Self {
                num: -num,
                den: -den,
            }
        } else {
            Self { num, den }
        })
    }

    /// The numerator, in lowest terms; it carries the sign.
    #[must_use]
    pub const fn numer(&self) -> &Int {
        &self.num
    }

    /// The denominator, in lowest terms; always positive.
    #[must_use]
    pub const fn denom(&self) -> &Int {
        &self.den
    }

    /// Whether the value is zero.
    #[must_use]
    pub fn is_zero(&self) -> bool {
        self.num.is_zero()
    }

    /// `1 / self`.
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`] for zero.
    pub fn recip(&self) -> Result<Self, Error> {
        Self::reduced(self.den.clone(), self.num.clone())
    }

    /// `self × other`, cross-reduced before multiplying.
    #[must_use]
    pub fn mul(&self, other: &Self) -> Self {
        let first = self.num.gcd(&other.den);
        let second = other.num.gcd(&self.den);
        // a gcd is zero only when both are zero, and denominators never are
        let num = self.num.exact_div(&first) * other.num.exact_div(&second);
        let den = self.den.exact_div(&second) * other.den.exact_div(&first);
        if num.is_zero() {
            Self::ZERO
        } else {
            Self { num, den }
        }
    }

    /// `self / other`.
    ///
    /// # Errors
    ///
    /// [`Error::DivisionByZero`] when `other` is zero.
    pub fn div(&self, other: &Self) -> Result<Self, Error> {
        Ok(self.mul(&other.recip()?))
    }

    /// An exact decimal `digits × 10^−scale` as a reduced ratio.
    pub(crate) fn from_decimal(decimal: Decimal) -> Self {
        let Decimal { digits, scale, .. } = decimal;
        // the denominator is a power of ten, so the reduction can't fail
        Self::reduced(digits, Int::ONE.mul_pow10(u32::from(scale))).unwrap_or(Self::ZERO)
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
                Self { num: Int::from(value), den: Int::ONE }
            }
        }
    )*};
}
from_integer!(i8, i16, i32, i64, i128, u8, u16, u32, u64, u128, usize, Int);

impl TryFrom<f64> for Ratio {
    type Error = Error;

    /// A float at its shortest round-trip decimal form: `0.1` is exactly 1/10.
    ///
    /// # Errors
    ///
    /// [`Error::NotFinite`] for NaN and the infinities; [`Error::TooManyDigits`] for a value
    /// whose shortest form has more than 15 significant digits (such as `0.1 + 0.2`) and that
    /// isn't a safe integer, since a float artefact can't be told from a decimal someone wrote.
    fn try_from(value: f64) -> Result<Self, Error> {
        Ok(Self::from_decimal(faithful_decimal(value, true)?))
    }
}

impl FromStr for Ratio {
    type Err = Error;

    /// A decimal string in ducat's grammar (`"1.075"`, `"-2"`, `"1.5e3"`), or two of them around
    /// a slash (`"1/3"`, `"1.5/2"`). There is no limit on the number of digits, so the cost grows
    /// with the length of the text: bound untrusted input first.
    ///
    /// # Errors
    ///
    /// [`Error::Syntax`] outside the grammar; [`Error::ExponentOutOfRange`] for an exponent or
    /// decimal places beyond 1000; [`Error::DivisionByZero`] for a zero denominator.
    fn from_str(text: &str) -> Result<Self, Error> {
        match text.split_once('/') {
            Some((num, den)) => {
                let num = Self::from_decimal(parse_decimal(num)?);
                let den = Self::from_decimal(parse_decimal(den)?);
                num.div(&den)
            }
            None => Ok(Self::from_decimal(parse_decimal(text)?)),
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
    use alloc::string::ToString;

    use super::*;

    fn ratio(text: &str) -> Result<(i128, i128), Error> {
        text.parse::<Ratio>().map(|ratio| {
            (
                ratio.numer().to_i128().unwrap(),
                ratio.denom().to_i128().unwrap(),
            )
        })
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
        assert_eq!(ratio("1/"), Err(Error::Syntax));
        assert_eq!(ratio("/1"), Err(Error::Syntax));
        let tiny: Ratio = "1e-39".parse().unwrap();
        assert_eq!(
            tiny.denom().to_string(),
            alloc::format!("1{}", "0".repeat(39))
        );
    }

    #[test]
    fn wide_values_are_exact() {
        // T20: what overflowed with i128 now just grows
        let small = Ratio::new(1, 3_000_000_000u64).unwrap();
        let big = Ratio::from(3_080_000_000u64);
        assert_eq!(
            small.div(&big).unwrap().denom().to_i128(),
            Some(9_240_000_000_000_000_000)
        );
        let min = Ratio::new(i128::MIN, -1).unwrap();
        assert_eq!(
            min.numer().to_string(),
            "170141183460469231731687303715884105728"
        );
        assert_eq!(
            Ratio::new(i128::MIN, 2).unwrap().numer().to_i128(),
            Some(i128::MIN / 2)
        );
        assert_eq!(Ratio::new(0, 0), Err(Error::DivisionByZero));
        assert_eq!(Ratio::new(0, -5), Ok(Ratio::ZERO));
        let square = Ratio::from(i128::MAX).mul(&Ratio::from(i128::MAX));
        assert_eq!(square.numer().to_i128(), None);
        assert_eq!(
            square.div(&Ratio::from(i128::MAX)).unwrap(),
            Ratio::from(i128::MAX)
        );
        assert_eq!(
            Ratio::from(i128::MIN).recip().unwrap().numer().to_i128(),
            Some(-1)
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
            Ratio::new(20_000_000_001u64, 1_000_000)
        );
    }
}
