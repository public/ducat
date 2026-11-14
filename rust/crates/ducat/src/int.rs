//! `Int`: an integer of any size, held inline while it fits an `i128`.

use alloc::boxed::Box;
use alloc::string::String;
use core::cmp::Ordering;
use core::fmt;
use core::hash::{Hash, Hasher};
use core::ops::{Add, Mul, Neg, Sub};
use core::str::FromStr;

use num_bigint::{BigInt, Sign};
use num_integer::Integer;
use num_traits::{Signed, ToPrimitive};

use crate::Error;
use crate::wide::POW10;

/// An exact integer of any size: the count of units in an amount, a ratio's numerator or
/// denominator, an allocation weight.
///
/// Values that fit an `i128` are held inline and computed with machine arithmetic; larger ones
/// move to the heap and back, so the representation is always canonical (two equal `Int`s are
/// always held the same way). As in ducat, there is no size limit, so the cost of parsing,
/// formatting and arithmetic grows with the number of digits: bound the length of untrusted
/// input before parsing it.
///
/// ```
/// use ducat::Int;
///
/// let big: Int = "340282366920938463463374607431768211456".parse()?; // 2^128
/// assert_eq!(big.to_i128(), None);
/// assert_eq!((big.clone() - big).to_i128(), Some(0));
/// # Ok::<(), ducat::Error>(())
/// ```
#[derive(Clone)]
pub struct Int(Repr);

#[derive(Clone)]
enum Repr {
    Small(i128),
    /// Only ever a value outside the `i128` range.
    Big(Box<BigInt>),
}

impl Int {
    /// Zero.
    pub const ZERO: Self = Self(Repr::Small(0));
    /// One.
    pub const ONE: Self = Self(Repr::Small(1));

    /// The value as an `i128`, when it fits.
    #[must_use]
    pub fn to_i128(&self) -> Option<i128> {
        match &self.0 {
            Repr::Small(value) => Some(*value),
            Repr::Big(_) => None,
        }
    }

    /// The value as an `i64`, when it fits.
    #[must_use]
    pub fn to_i64(&self) -> Option<i64> {
        self.to_i128().and_then(|value| i64::try_from(value).ok())
    }

    /// Whether the value is zero.
    #[must_use]
    pub fn is_zero(&self) -> bool {
        matches!(self.0, Repr::Small(0))
    }

    /// Whether the value is below zero.
    #[must_use]
    pub fn is_negative(&self) -> bool {
        match &self.0 {
            Repr::Small(value) => *value < 0,
            Repr::Big(value) => value.sign() == Sign::Minus,
        }
    }

    /// Whether the value is above zero.
    #[must_use]
    pub fn is_positive(&self) -> bool {
        !self.is_zero() && !self.is_negative()
    }

    /// −1, 0 or 1.
    #[must_use]
    pub fn signum(&self) -> i8 {
        if self.is_negative() {
            -1
        } else if self.is_zero() {
            0
        } else {
            1
        }
    }

    /// `|self|`.
    #[must_use]
    pub fn abs(&self) -> Self {
        if self.is_negative() {
            -self
        } else {
            self.clone()
        }
    }

    pub(crate) fn from_big(value: BigInt) -> Self {
        match value.to_i128() {
            Some(small) => Self(Repr::Small(small)),
            None => Self(Repr::Big(Box::new(value))),
        }
    }

    pub(crate) fn to_big(&self) -> BigInt {
        match &self.0 {
            Repr::Small(value) => BigInt::from(*value),
            Repr::Big(value) => (**value).clone(),
        }
    }

    /// `self × 10^exponent`.
    pub(crate) fn mul_pow10(&self, exponent: u32) -> Self {
        if exponent == 0 || self.is_zero() {
            return self.clone();
        }
        if let (Repr::Small(value), Some(power)) = (&self.0, POW10.get(exponent as usize)) {
            if let Some(product) = i128::try_from(*power)
                .ok()
                .and_then(|power| value.checked_mul(power))
            {
                return Self(Repr::Small(product));
            }
        }
        Self::from_big(self.to_big() * pow10_big(exponent))
    }

    /// The greatest common divisor of the magnitudes (zero only for two zeros).
    pub(crate) fn gcd(&self, other: &Self) -> Self {
        if let (Repr::Small(left), Repr::Small(right)) = (&self.0, &other.0) {
            let (mut left, mut right) = (left.unsigned_abs(), right.unsigned_abs());
            while right != 0 {
                (left, right) = (right, left % right);
            }
            if let Ok(divisor) = i128::try_from(left) {
                return Self(Repr::Small(divisor));
            }
        }
        Self::from_big(self.to_big().gcd(&other.to_big()))
    }

    /// The quotient truncated toward zero, and the remainder with `self`'s sign; `divisor` is
    /// non-zero.
    pub(crate) fn div_rem(&self, divisor: &Self) -> (Self, Self) {
        if let (Repr::Small(left), Repr::Small(right)) = (&self.0, &divisor.0) {
            if let (Some(quotient), Some(remainder)) =
                (left.checked_div(*right), left.checked_rem(*right))
            {
                return (Self(Repr::Small(quotient)), Self(Repr::Small(remainder)));
            }
        }
        let (quotient, remainder) = self.to_big().div_rem(&divisor.to_big());
        (Self::from_big(quotient), Self::from_big(remainder))
    }

    /// The exact quotient, when `divisor` divides `self`.
    pub(crate) fn exact_div(&self, divisor: &Self) -> Self {
        self.div_rem(divisor).0
    }

    /// `self^exponent`.
    #[cfg(feature = "finance")]
    pub(crate) fn pow(&self, exponent: u32) -> Self {
        if let Repr::Small(value) = &self.0 {
            if let Some(power) = value.checked_pow(exponent) {
                return Self(Repr::Small(power));
            }
        }
        Self::from_big(num_traits::pow(self.to_big(), exponent as usize))
    }

    /// The quotient rounded toward −∞; `divisor` is non-zero.
    #[cfg(feature = "finance")]
    pub(crate) fn div_floor(&self, divisor: &Self) -> Self {
        let (quotient, remainder) = self.div_rem(divisor);
        if !remainder.is_zero() && remainder.is_negative() != divisor.is_negative() {
            quotient - Self::ONE
        } else {
            quotient
        }
    }

    /// The number of bits of the magnitude (0 for zero).
    #[cfg(feature = "finance")]
    pub(crate) fn bits(&self) -> u64 {
        match &self.0 {
            Repr::Small(value) => u64::from(128 - value.unsigned_abs().leading_zeros()),
            Repr::Big(value) => value.bits(),
        }
    }

    /// The decimal digits of the magnitude, most significant first.
    pub(crate) fn magnitude_digits(&self) -> String {
        match &self.0 {
            Repr::Small(value) => alloc::format!("{}", value.unsigned_abs()),
            Repr::Big(value) => value.magnitude().to_str_radix(10),
        }
    }

    /// The integer of an ASCII digit string (the grammar is checked by the caller).
    pub(crate) fn from_digits(negative: bool, digits: &[u8]) -> Self {
        let digits = match digits.iter().position(|&digit| digit != b'0') {
            Some(start) => &digits[start..],
            None => return Self::ZERO,
        };
        if digits.len() <= 38 {
            let magnitude = digits
                .iter()
                .fold(0i128, |value, &digit| value * 10 + i128::from(digit - b'0'));
            return Self(Repr::Small(if negative { -magnitude } else { magnitude }));
        }
        // parse_bytes only fails on a non-digit, which the caller has ruled out
        let magnitude = BigInt::parse_bytes(digits, 10).unwrap_or_default();
        Self::from_big(if negative { -magnitude } else { magnitude })
    }
}

/// 10^exponent as a `BigInt`.
pub(crate) fn pow10_big(exponent: u32) -> BigInt {
    num_traits::pow(BigInt::from(10u8), exponent as usize)
}

impl Default for Int {
    fn default() -> Self {
        Self::ZERO
    }
}

impl PartialEq for Int {
    fn eq(&self, other: &Self) -> bool {
        match (&self.0, &other.0) {
            (Repr::Small(left), Repr::Small(right)) => left == right,
            (Repr::Big(left), Repr::Big(right)) => left == right,
            // canonical: a big value is never equal to a small one
            _ => false,
        }
    }
}

impl Eq for Int {}

impl Hash for Int {
    fn hash<H: Hasher>(&self, state: &mut H) {
        match &self.0 {
            Repr::Small(value) => {
                state.write_u8(0);
                value.hash(state);
            }
            Repr::Big(value) => {
                state.write_u8(1);
                value.hash(state);
            }
        }
    }
}

impl Ord for Int {
    fn cmp(&self, other: &Self) -> Ordering {
        match (&self.0, &other.0) {
            (Repr::Small(left), Repr::Small(right)) => left.cmp(right),
            (Repr::Big(left), Repr::Big(right)) => left.cmp(right),
            // a big value is beyond every small one, on its own side of zero
            (Repr::Big(left), Repr::Small(_)) => {
                if left.is_negative() {
                    Ordering::Less
                } else {
                    Ordering::Greater
                }
            }
            (Repr::Small(_), Repr::Big(right)) => {
                if right.is_negative() {
                    Ordering::Greater
                } else {
                    Ordering::Less
                }
            }
        }
    }
}

impl PartialOrd for Int {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

macro_rules! from_primitive {
    ($($integer:ty),*) => {$(
        impl From<$integer> for Int {
            fn from(value: $integer) -> Self {
                Self(Repr::Small(i128::from(value)))
            }
        }

        impl TryFrom<Int> for $integer {
            type Error = Error;

            /// # Errors
            ///
            /// [`Error::Overflow`] when the value doesn't fit.
            fn try_from(value: Int) -> Result<Self, Error> {
                value.to_i128().and_then(|small| <$integer>::try_from(small).ok()).ok_or(Error::Overflow)
            }
        }

        impl PartialEq<$integer> for Int {
            fn eq(&self, other: &$integer) -> bool {
                self.to_i128() == Some(i128::from(*other))
            }
        }
    )*};
}
from_primitive!(i8, i16, i32, i64, i128, u8, u16, u32, u64);

impl From<u128> for Int {
    fn from(value: u128) -> Self {
        match i128::try_from(value) {
            Ok(small) => Self(Repr::Small(small)),
            Err(_) => Self(Repr::Big(Box::new(BigInt::from(value)))),
        }
    }
}

impl From<usize> for Int {
    fn from(value: usize) -> Self {
        Self::from(value as u128)
    }
}

impl TryFrom<Int> for u128 {
    type Error = Error;

    /// # Errors
    ///
    /// [`Error::Overflow`] when the value is negative or beyond `u128`.
    fn try_from(value: Int) -> Result<Self, Error> {
        match &value.0 {
            Repr::Small(small) => u128::try_from(*small).map_err(|_| Error::Overflow),
            Repr::Big(big) => big.to_u128().ok_or(Error::Overflow),
        }
    }
}

impl TryFrom<Int> for usize {
    type Error = Error;

    /// # Errors
    ///
    /// [`Error::Overflow`] when the value is negative or beyond `usize`.
    fn try_from(value: Int) -> Result<Self, Error> {
        value
            .to_i128()
            .and_then(|small| usize::try_from(small).ok())
            .ok_or(Error::Overflow)
    }
}

impl FromStr for Int {
    type Err = Error;

    /// An optional `-` or `+` and one or more ASCII digits. Nothing else: no exponent, no
    /// grouping, no whitespace.
    ///
    /// # Errors
    ///
    /// [`Error::Syntax`] for anything else.
    fn from_str(text: &str) -> Result<Self, Error> {
        let (negative, digits) = match text.as_bytes() {
            [b'-', rest @ ..] => (true, rest),
            [b'+', rest @ ..] => (false, rest),
            rest => (false, rest),
        };
        if digits.is_empty() || !digits.iter().all(u8::is_ascii_digit) {
            return Err(Error::Syntax);
        }
        Ok(Self::from_digits(negative, digits))
    }
}

impl fmt::Display for Int {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.0 {
            Repr::Small(value) => fmt::Display::fmt(value, f),
            Repr::Big(value) => fmt::Display::fmt(value, f),
        }
    }
}

impl fmt::Debug for Int {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

impl Neg for &Int {
    type Output = Int;

    fn neg(self) -> Int {
        match &self.0 {
            Repr::Small(value) => match value.checked_neg() {
                Some(negated) => Int(Repr::Small(negated)),
                None => Int::from_big(-BigInt::from(*value)),
            },
            Repr::Big(value) => Int::from_big(-(**value).clone()),
        }
    }
}

impl Neg for Int {
    type Output = Int;

    fn neg(self) -> Int {
        -&self
    }
}

macro_rules! binary {
    ($trait:ident, $method:ident, $checked:ident) => {
        impl $trait<&Int> for &Int {
            type Output = Int;

            fn $method(self, other: &Int) -> Int {
                if let (Repr::Small(left), Repr::Small(right)) = (&self.0, &other.0) {
                    if let Some(result) = left.$checked(*right) {
                        return Int(Repr::Small(result));
                    }
                }
                Int::from_big(self.to_big().$method(other.to_big()))
            }
        }

        impl $trait for Int {
            type Output = Int;

            fn $method(self, other: Int) -> Int {
                (&self).$method(&other)
            }
        }

        impl $trait<&Int> for Int {
            type Output = Int;

            fn $method(self, other: &Int) -> Int {
                (&self).$method(other)
            }
        }
    };
}
binary!(Add, add, checked_add);
binary!(Sub, sub, checked_sub);
binary!(Mul, mul, checked_mul);

impl core::iter::Sum for Int {
    fn sum<I: Iterator<Item = Int>>(iter: I) -> Int {
        iter.fold(Int::ZERO, |sum, value| sum + value)
    }
}

impl<'a> core::iter::Sum<&'a Int> for Int {
    fn sum<I: Iterator<Item = &'a Int>>(iter: I) -> Int {
        iter.fold(Int::ZERO, |sum, value| sum + value)
    }
}
