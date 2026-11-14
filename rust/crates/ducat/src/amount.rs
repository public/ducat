//! The arithmetic `Money` and `AnyMoney` share: an `i128` count of 10^−scale units.

use core::cmp::Ordering;
use core::fmt;

use crate::decimal::{Decimal, MAX_SCALE, faithful_decimal, parse_decimal, write_scaled};
use crate::rounding::{Rounding, rescale_ratio};
use crate::{Error, Ratio};

/// `units × 10^−scale`, with `scale` at most `MAX_SCALE`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) struct Amount {
    pub(crate) units: i128,
    pub(crate) scale: u16,
}

pub(crate) const fn check_scale(scale: u16) -> Result<u16, Error> {
    if scale > MAX_SCALE {
        Err(Error::InvalidScale)
    } else {
        Ok(scale)
    }
}

/// `up` and `down`, the powers of ten that take `from` to `to`.
const fn shift(from: u16, to: u16) -> (u32, u32) {
    if to >= from {
        ((to - from) as u32, 0)
    } else {
        (0, (from - to) as u32)
    }
}

impl Amount {
    pub(crate) fn new(units: i128, scale: u16) -> Result<Self, Error> {
        Ok(Self {
            units,
            scale: check_scale(scale)?,
        })
    }

    pub(crate) fn from_decimal(
        decimal: Decimal,
        scale: u16,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        let scale = check_scale(scale)?;
        let (up, down) = shift(decimal.scale, scale);
        Ok(Self {
            units: rescale_ratio(decimal.digits, 1, 1, up, down, rounding)?,
            scale,
        })
    }

    pub(crate) fn parse(text: &str, scale: u16, rounding: Rounding) -> Result<Self, Error> {
        Self::from_decimal(parse_decimal(text)?, scale, rounding)
    }

    /// A float under ducat's rule: at its shortest form, rounded with `rounding`, and (when
    /// `check_digits`) with at most 15 significant digits. The rounding is checked first, so
    /// `0.1 + 0.2` at a scale of 2 is a rounding error, as in ducat.
    pub(crate) fn from_f64(
        value: f64,
        scale: u16,
        rounding: Rounding,
        check_digits: bool,
    ) -> Result<Self, Error> {
        let amount = Self::from_decimal(faithful_decimal(value, false)?, scale, rounding)?;
        if check_digits {
            faithful_decimal(value, true)?;
        }
        Ok(amount)
    }

    pub(crate) fn rescale(self, scale: u16, rounding: Rounding) -> Result<Self, Error> {
        let scale = check_scale(scale)?;
        if scale == self.scale {
            return Ok(self);
        }
        let (up, down) = shift(self.scale, scale);
        Ok(Self {
            units: rescale_ratio(self.units, 1, 1, up, down, rounding)?,
            scale,
        })
    }

    /// `self × factor`, rounded once to `scale`.
    pub(crate) fn mul_ratio(
        self,
        factor: Ratio,
        scale: u16,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        let scale = check_scale(scale)?;
        let (up, down) = shift(self.scale, scale);
        Ok(Self {
            units: rescale_ratio(
                self.units,
                factor.numer(),
                factor.denom().unsigned_abs(),
                up,
                down,
                rounding,
            )?,
            scale,
        })
    }

    /// `self ÷ divisor`, rounded once to `scale`.
    pub(crate) fn div_ratio(
        self,
        divisor: Ratio,
        scale: u16,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        if divisor.is_zero() {
            return Err(Error::DivisionByZero);
        }
        // value × den / num, with the sign moved to the numerator (den ≤ i128::MAX negates)
        let num = if divisor.numer() < 0 {
            -divisor.denom()
        } else {
            divisor.denom()
        };
        let scale = check_scale(scale)?;
        let (up, down) = shift(self.scale, scale);
        let units = rescale_ratio(
            self.units,
            num,
            divisor.numer().unsigned_abs(),
            up,
            down,
            rounding,
        )?;
        Ok(Self { units, scale })
    }

    /// Both amounts at the larger scale, exactly.
    fn aligned(self, other: Self) -> Result<(i128, i128, u16), Error> {
        let scale = self.scale.max(other.scale);
        Ok((
            self.rescale(scale, Rounding::Unnecessary)?.units,
            other.rescale(scale, Rounding::Unnecessary)?.units,
            scale,
        ))
    }

    pub(crate) fn checked_add(self, other: Self) -> Result<Self, Error> {
        let (left, right, scale) = self.aligned(other)?;
        Ok(Self {
            units: left.checked_add(right).ok_or(Error::Overflow)?,
            scale,
        })
    }

    pub(crate) fn checked_sub(self, other: Self) -> Result<Self, Error> {
        let (left, right, scale) = self.aligned(other)?;
        Ok(Self {
            units: left.checked_sub(right).ok_or(Error::Overflow)?,
            scale,
        })
    }

    pub(crate) fn checked_neg(self) -> Result<Self, Error> {
        Ok(Self {
            units: self.units.checked_neg().ok_or(Error::Overflow)?,
            scale: self.scale,
        })
    }

    /// The order of the two values, whatever their scales. Never fails: when bringing the smaller
    /// scale up overflows, that value's magnitude is beyond any `i128`, so its sign decides.
    pub(crate) fn cmp_value(self, other: Self) -> Ordering {
        if self.scale == other.scale {
            return self.units.cmp(&other.units);
        }
        let (low, high, flipped) = if self.scale < other.scale {
            (self, other, false)
        } else {
            (other, self, true)
        };
        let order = match low.rescale(high.scale, Rounding::Unnecessary) {
            Ok(raised) => raised.units.cmp(&high.units),
            Err(_) => low.units.cmp(&0),
        };
        if flipped { order.reverse() } else { order }
    }

    pub(crate) fn write(self, f: &mut dyn fmt::Write) -> fmt::Result {
        write_scaled(f, self.units, self.scale)
    }
}

/// Anything that can be read as an exact factor: a [`Ratio`], an integer, a decimal or fraction
/// string (`"1.075"`, `"1/3"`), or a float under the binary64 rule ([`Ratio::try_from`]).
pub trait Factor {
    /// The factor as an exact ratio.
    ///
    /// # Errors
    ///
    /// Whatever building the [`Ratio`] fails with: [`Error::Syntax`] for a string outside the
    /// grammar, [`Error::TooManyDigits`] or [`Error::NotFinite`] for a float, and so on.
    fn to_ratio(self) -> Result<Ratio, Error>;
}

impl Factor for Ratio {
    fn to_ratio(self) -> Result<Ratio, Error> {
        Ok(self)
    }
}

impl Factor for &str {
    fn to_ratio(self) -> Result<Ratio, Error> {
        self.parse()
    }
}

impl Factor for f64 {
    fn to_ratio(self) -> Result<Ratio, Error> {
        Ratio::try_from(self)
    }
}

macro_rules! integer_factor {
    ($($integer:ty),*) => {$(
        impl Factor for $integer {
            fn to_ratio(self) -> Result<Ratio, Error> {
                Ok(Ratio::from(self))
            }
        }
    )*};
}
integer_factor!(i8, i16, i32, i64, i128, u8, u16, u32, u64);
