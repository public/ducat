//! The arithmetic `Money` and `AnyMoney` share: an exact count of 10^−scale units.

use core::cmp::Ordering;
use core::fmt;

use crate::decimal::{Decimal, MAX_SCALE, faithful_decimal, parse_decimal, write_scaled};
use crate::rounding::{Rounding, rescale_ratio};
use crate::{Error, Int, Ratio};

/// `units × 10^−scale`, with `scale` at most `MAX_SCALE`.
#[derive(Clone, Debug)]
pub(crate) struct Amount {
    pub(crate) units: Int,
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
    pub(crate) fn new(units: Int, scale: u16) -> Result<Self, Error> {
        Ok(Self {
            units,
            scale: check_scale(scale)?,
        })
    }

    pub(crate) fn from_decimal(
        decimal: &Decimal,
        scale: u16,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        let scale = check_scale(scale)?;
        let (up, down) = shift(decimal.scale, scale);
        Ok(Self {
            units: rescale_ratio(&decimal.digits, &Int::ONE, &Int::ONE, up, down, rounding)?,
            scale,
        })
    }

    pub(crate) fn parse(text: &str, scale: u16, rounding: Rounding) -> Result<Self, Error> {
        Self::from_decimal(&parse_decimal(text)?, scale, rounding)
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
        let amount = Self::from_decimal(&faithful_decimal(value, false)?, scale, rounding)?;
        if check_digits {
            faithful_decimal(value, true)?;
        }
        Ok(amount)
    }

    pub(crate) fn rescale(&self, scale: u16, rounding: Rounding) -> Result<Self, Error> {
        let scale = check_scale(scale)?;
        if scale == self.scale {
            return Ok(self.clone());
        }
        let (up, down) = shift(self.scale, scale);
        Ok(Self {
            units: rescale_ratio(&self.units, &Int::ONE, &Int::ONE, up, down, rounding)?,
            scale,
        })
    }

    /// The units at a larger (or equal) scale, exactly.
    fn units_at(&self, scale: u16) -> Int {
        self.units
            .mul_pow10(u32::from(scale.saturating_sub(self.scale)))
    }

    /// `self × factor`, rounded once to `scale`.
    pub(crate) fn mul_ratio(
        &self,
        factor: &Ratio,
        scale: u16,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        let scale = check_scale(scale)?;
        let (up, down) = shift(self.scale, scale);
        Ok(Self {
            units: rescale_ratio(
                &self.units,
                factor.numer(),
                factor.denom(),
                up,
                down,
                rounding,
            )?,
            scale,
        })
    }

    /// `self ÷ divisor`, rounded once to `scale`.
    pub(crate) fn div_ratio(
        &self,
        divisor: &Ratio,
        scale: u16,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        self.mul_ratio(&divisor.recip()?, scale, rounding)
    }

    pub(crate) fn add(&self, other: &Self) -> Self {
        let scale = self.scale.max(other.scale);
        Self {
            units: self.units_at(scale) + other.units_at(scale),
            scale,
        }
    }

    pub(crate) fn sub(&self, other: &Self) -> Self {
        let scale = self.scale.max(other.scale);
        Self {
            units: self.units_at(scale) - other.units_at(scale),
            scale,
        }
    }

    pub(crate) fn neg(&self) -> Self {
        Self {
            units: -&self.units,
            scale: self.scale,
        }
    }

    pub(crate) fn abs(&self) -> Self {
        Self {
            units: self.units.abs(),
            scale: self.scale,
        }
    }

    /// The order of the two values, whatever their scales.
    pub(crate) fn cmp_value(&self, other: &Self) -> Ordering {
        if self.scale == other.scale {
            return self.units.cmp(&other.units);
        }
        let scale = self.scale.max(other.scale);
        self.units_at(scale).cmp(&other.units_at(scale))
    }

    /// The value at its smallest exact scale (trailing zeros dropped): equal values give the same
    /// key, whatever their scales and however their units are held, so it is what `Hash` uses.
    pub(crate) fn normalized(&self) -> (Int, u16) {
        if self.units.is_zero() {
            return (Int::ZERO, 0);
        }
        let ten = Int::from(10u8);
        let (mut units, mut scale) = (self.units.clone(), self.scale);
        while scale > 0 {
            let (quotient, remainder) = units.div_rem(&ten);
            if !remainder.is_zero() {
                break;
            }
            units = quotient;
            scale -= 1;
        }
        (units, scale)
    }

    /// Whether the two hold the same units at the same scale.
    pub(crate) fn identical(&self, other: &Self) -> bool {
        self.scale == other.scale && self.units == other.units
    }

    pub(crate) fn write(&self, f: &mut dyn fmt::Write) -> fmt::Result {
        write_scaled(f, &self.units, self.scale)
    }
}

/// Anything that can be read as an exact factor: a [`Ratio`], an integer, or a decimal or fraction
/// string (`"1.075"`, `"1/3"`). A float is not a factor: convert it explicitly with
/// [`Ratio::try_from`], which applies the binary64 rule.
pub trait Factor {
    /// The factor as an exact ratio.
    ///
    /// # Errors
    ///
    /// Whatever building the [`Ratio`] fails with: [`Error::Syntax`] for a string outside the
    /// grammar, [`Error::DivisionByZero`] for `"1/0"`, and so on.
    fn to_ratio(self) -> Result<Ratio, Error>;
}

impl Factor for Ratio {
    fn to_ratio(self) -> Result<Ratio, Error> {
        Ok(self)
    }
}

impl Factor for &Ratio {
    fn to_ratio(self) -> Result<Ratio, Error> {
        Ok(self.clone())
    }
}

impl Factor for &str {
    fn to_ratio(self) -> Result<Ratio, Error> {
        self.parse()
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
integer_factor!(i8, i16, i32, i64, i128, u8, u16, u32, u64, u128, usize, Int);
