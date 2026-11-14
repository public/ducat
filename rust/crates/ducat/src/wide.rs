//! A 256-bit unsigned integer, just big enough for the intermediates of rounding: the product of
//! two `i128` magnitudes, times a power of ten, divided by a 256-bit divisor.

use core::cmp::Ordering;

/// An unsigned 256-bit integer as two `u128` halves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct U256 {
    hi: u128,
    lo: u128,
}

impl Ord for U256 {
    fn cmp(&self, other: &Self) -> Ordering {
        self.hi.cmp(&other.hi).then(self.lo.cmp(&other.lo))
    }
}

impl PartialOrd for U256 {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// 10^0 to 10^38, every power of ten a `u128` holds.
pub(crate) const POW10: [u128; 39] = {
    let mut table = [1u128; 39];
    let mut index = 1;
    while index < 39 {
        table[index] = table[index - 1] * 10;
        index += 1;
    }
    table
};

impl U256 {
    pub(crate) const ZERO: Self = Self { hi: 0, lo: 0 };

    pub(crate) const fn from_u128(value: u128) -> Self {
        Self { hi: 0, lo: value }
    }

    pub(crate) const fn is_zero(self) -> bool {
        self.hi == 0 && self.lo == 0
    }

    pub(crate) const fn is_odd(self) -> bool {
        self.lo & 1 == 1
    }

    /// The full product of two `u128`s.
    pub(crate) const fn mul(left: u128, right: u128) -> Self {
        const MASK: u128 = u64::MAX as u128;
        let (a1, a0) = (left >> 64, left & MASK);
        let (b1, b0) = (right >> 64, right & MASK);
        let p00 = a0 * b0;
        let p01 = a0 * b1;
        let p10 = a1 * b0;
        let p11 = a1 * b1;
        // the middle column: at most 3 × (2^64 − 1), no overflow in u128
        let middle = (p00 >> 64) + (p01 & MASK) + (p10 & MASK);
        let lo = (p00 & MASK) | (middle << 64);
        let hi = p11 + (p01 >> 64) + (p10 >> 64) + (middle >> 64);
        Self { hi, lo }
    }

    /// `self × factor`, or `None` beyond 2^256.
    pub(crate) fn checked_mul_u128(self, factor: u128) -> Option<Self> {
        let low = Self::mul(self.lo, factor);
        let high = Self::mul(self.hi, factor);
        if high.hi != 0 {
            return None;
        }
        let hi = low.hi.checked_add(high.lo)?;
        Some(Self { hi, lo: low.lo })
    }

    /// `self × 10^exponent`, or `None` beyond 2^256.
    pub(crate) fn checked_mul_pow10(self, mut exponent: u32) -> Option<Self> {
        let mut value = self;
        if value.is_zero() {
            return Some(value);
        }
        while exponent > 0 {
            let step = exponent.min(38);
            value = value.checked_mul_u128(POW10[step as usize])?;
            exponent -= step;
        }
        Some(value)
    }

    pub(crate) fn checked_add_one(self) -> Option<Self> {
        match self.lo.checked_add(1) {
            Some(lo) => Some(Self { hi: self.hi, lo }),
            None => Some(Self {
                hi: self.hi.checked_add(1)?,
                lo: 0,
            }),
        }
    }

    pub(crate) const fn wrapping_sub(self, other: Self) -> Self {
        let (lo, borrow) = self.lo.overflowing_sub(other.lo);
        let hi = self.hi.wrapping_sub(other.hi).wrapping_sub(borrow as u128);
        Self { hi, lo }
    }

    const fn bits(self) -> u32 {
        if self.hi != 0 {
            256 - self.hi.leading_zeros()
        } else {
            128 - self.lo.leading_zeros()
        }
    }

    const fn shl(self, shift: u32) -> Self {
        match shift {
            0 => self,
            1..=127 => Self {
                hi: (self.hi << shift) | (self.lo >> (128 - shift)),
                lo: self.lo << shift,
            },
            128..=255 => Self {
                hi: self.lo << (shift - 128),
                lo: 0,
            },
            _ => Self::ZERO,
        }
    }

    const fn set_bit(self, bit: u32) -> Self {
        if bit >= 128 {
            Self {
                hi: self.hi | (1 << (bit - 128)),
                lo: self.lo,
            }
        } else {
            Self {
                hi: self.hi,
                lo: self.lo | (1 << bit),
            }
        }
    }

    /// The quotient and remainder of `self / divisor`; `divisor` is non-zero.
    pub(crate) fn div_rem(self, divisor: Self) -> (Self, Self) {
        debug_assert!(!divisor.is_zero());
        if self.hi == 0 && divisor.hi == 0 {
            return (
                Self::from_u128(self.lo / divisor.lo),
                Self::from_u128(self.lo % divisor.lo),
            );
        }
        if self < divisor {
            return (Self::ZERO, self);
        }
        // shift-and-subtract long division, one quotient bit per step
        let mut remainder = self;
        let mut quotient = Self::ZERO;
        let mut shift = self.bits() - divisor.bits();
        loop {
            let shifted = divisor.shl(shift);
            if remainder >= shifted {
                remainder = remainder.wrapping_sub(shifted);
                quotient = quotient.set_bit(shift);
            }
            if shift == 0 {
                break;
            }
            shift -= 1;
        }
        (quotient, remainder)
    }

    /// The value with sign `negative` as an `i128`, or `None` when it doesn't fit.
    pub(crate) const fn to_i128(self, negative: bool) -> Option<i128> {
        if self.hi != 0 {
            return None;
        }
        if negative {
            if self.lo <= i128::MAX as u128 {
                Some(-(self.lo as i128))
            } else if self.lo == i128::MIN.unsigned_abs() {
                Some(i128::MIN)
            } else {
                None
            }
        } else if self.lo <= i128::MAX as u128 {
            Some(self.lo as i128)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn product_and_division_agree() {
        let samples = [
            0u128,
            1,
            2,
            3,
            7,
            10,
            u64::MAX as u128,
            u64::MAX as u128 + 1,
            u128::MAX / 3,
            u128::MAX - 1,
            u128::MAX,
        ];
        for &a in &samples {
            for &b in &samples {
                let product = U256::mul(a, b);
                if b != 0 {
                    let (quotient, remainder) = product.div_rem(U256::from_u128(b));
                    assert_eq!(quotient, U256::from_u128(a), "{a} × {b} / {b}");
                    assert!(remainder.is_zero());
                    let plus = product.checked_add_one().unwrap();
                    let (quotient, remainder) = plus.div_rem(U256::from_u128(b));
                    if b == 1 {
                        assert_eq!(remainder, U256::ZERO);
                    } else {
                        assert_eq!(quotient, U256::from_u128(a));
                        assert_eq!(remainder, U256::from_u128(1));
                    }
                }
            }
        }
    }

    #[test]
    fn powers_of_ten() {
        assert_eq!(
            U256::from_u128(1).checked_mul_pow10(38),
            Some(U256::from_u128(POW10[38]))
        );
        let big = U256::from_u128(1).checked_mul_pow10(77).unwrap();
        assert_eq!(big.checked_mul_pow10(1), None);
        let (quotient, remainder) = big.div_rem(U256::from_u128(1).checked_mul_pow10(40).unwrap());
        assert_eq!(quotient, U256::from_u128(1).checked_mul_pow10(37).unwrap());
        assert!(remainder.is_zero());
    }
}
