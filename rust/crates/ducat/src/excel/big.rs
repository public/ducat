//! Integer kernels for the Excel functions, on `BigInt` directly: roots, logarithm bounds and
//! fixed-point products.

use num_bigint::BigInt;
use num_integer::Integer;
use num_traits::{One, Pow, Signed, ToPrimitive, Zero};

/// The number of bits of `|value|` (0 for zero).
pub(super) fn bit_length(value: &BigInt) -> u64 {
    value.bits()
}

/// `⌊dividend / divisor⌋`, `divisor` non-zero.
pub(super) fn floor_div(dividend: &BigInt, divisor: &BigInt) -> BigInt {
    dividend.div_floor(divisor)
}

/// `⌈dividend / divisor⌉`, `divisor` non-zero.
pub(super) fn ceil_div(dividend: &BigInt, divisor: &BigInt) -> BigInt {
    -(-dividend).div_floor(divisor)
}

/// The sign of `value`, as −1, 0 or 1.
pub(super) fn sign(value: &BigInt) -> i8 {
    if value.is_positive() {
        1
    } else if value.is_negative() {
        -1
    } else {
        0
    }
}

/// `base^exponent`, for an exponent that fits a `u64`.
pub(super) fn power(base: &BigInt, exponent: u64) -> BigInt {
    Pow::pow(base, exponent)
}

/// The integer `order`th root of a positive integer, if it is a perfect `order`th power. The order
/// may be of any size: an order at or above the value's bit count has only 1 as a root.
pub(super) fn exact_root(value: &BigInt, order: &BigInt) -> Option<BigInt> {
    let bits = bit_length(value);
    if *order >= BigInt::from(bits) {
        // 2^order alone has more bits than value: only 1 can be its root
        return value.is_one().then(BigInt::one);
    }
    // the order is below the bit count, so it fits a u64
    let order = order.to_u64()?;
    let root = floor_root(value, order);
    (power(&root, order) == *value).then_some(root)
}

/// `⌊value^(1/order)⌋` for a non-negative integer, by integer Newton from above. The start is at
/// or above the root: for a large value, the root of its top half (shifted back), plus one, which
/// is already accurate to about half the root's bits, so the steps then converge quickly.
pub(super) fn floor_root(value: &BigInt, order: u64) -> BigInt {
    if order == 1 || value.is_zero() {
        return value.clone();
    }
    let root_bits = bit_length(value).div_ceil(order);
    let mut guess = if root_bits <= 64 {
        // the root has fewer than root_bits bits
        BigInt::one() << root_bits
    } else {
        // value >> (order·shift) has a root r with (r + 1)^order above it, so
        // ((r + 1) << shift)^order is above value
        let shift = root_bits / 2;
        let top = floor_root(&(value >> (order * shift)), order);
        (top + 1u8) << shift
    };
    while power(&guess, order) <= *value {
        guess <<= 1u8;
    }
    let lower = BigInt::from(order - 1);
    let order_big = BigInt::from(order);
    loop {
        let next = (&lower * &guess + value / power(&guess, order - 1)) / &order_big;
        if next >= guess {
            return guess;
        }
        guess = next;
    }
}

/// Integers `[low, high]` with `low / 2^bits ≤ ln(num/den) ≤ high / 2^bits`, for a positive
/// `num/den`: `ln(value) = k·ln 2 + 2·atanh(z)` with `value / 2^k` in (1/2, 2) and
/// `z = (y − 1)/(y + 1)`, so `|z| < 1/3`, and `ln 2 = 2·atanh(1/3)`.
pub(super) fn ln_interval(num: &BigInt, den: &BigInt, bits: u64) -> (BigInt, BigInt) {
    // the shift fits: the bit counts of two values in memory
    let shift = bit_length(num) as i64 - bit_length(den) as i64;
    let (y_num, y_den) = if shift >= 0 {
        (num.clone(), den << shift.unsigned_abs())
    } else {
        (num << shift.unsigned_abs(), den.clone())
    };
    let (z_low, z_high) = atanh_interval(&(&y_num - &y_den), &(&y_num + &y_den), bits);
    let mut low: BigInt = z_low * 2u8;
    let mut high: BigInt = z_high * 2u8;
    if shift != 0 {
        let (two_low, two_high) = atanh_interval(&BigInt::one(), &BigInt::from(3u8), bits);
        let twice_k = BigInt::from(2 * shift);
        if shift > 0 {
            low += &twice_k * two_low;
            high += &twice_k * two_high;
        } else {
            low += &twice_k * two_high;
            high += &twice_k * two_low;
        }
    }
    (low, high)
}

/// Integers `[low, high]` with `low / 2^bits ≤ atanh(num/den) ≤ high / 2^bits`, for
/// `|num/den| ≤ 1/3`: the series `Σ z^(2j+1)/(2j+1)` in fixed point. Each power is floored from the
/// last, so it is at most `j + 1` units below the exact one, and each term at most 2 units; the
/// series stops when the power reaches 0, where the tail is below `(j + 1)·9/8` units.
fn atanh_interval(num: &BigInt, den: &BigInt, bits: u64) -> (BigInt, BigInt) {
    if num.is_negative() {
        let (low, high) = atanh_interval(&-num, den, bits);
        return (-high, -low);
    }
    let square = num * num;
    let square_den = den * den;
    // non-negative throughout, so truncating division is the floor
    let mut power = (num << bits) / den;
    let mut sum = BigInt::zero();
    let mut terms = 0u64;
    while !power.is_zero() {
        sum += &power / BigInt::from(2 * terms + 1);
        terms += 1;
        power = power * &square / &square_den;
    }
    // each term is at most 2 units low, and the tail is at most 2·(terms + 1) units
    let high = &sum + BigInt::from(4 * terms + 4);
    (sum, high)
}

/// A product in fixed point at 2^−bits, floored (`up` false) or ceiled; the operands are
/// non-negative.
pub(super) fn fixed_product(left: &BigInt, right: &BigInt, bits: u64, up: bool) -> BigInt {
    let product = left * right;
    let quotient = &product >> bits;
    if up && (&quotient << bits) != product {
        quotient + 1u8
    } else {
        quotient
    }
}

/// `base^exponent` in fixed point at 2^−bits, each product floored (`up` false) or ceiled, by
/// squaring.
pub(super) fn fixed_power(base: &BigInt, exponent: u64, bits: u64, up: bool) -> BigInt {
    let mut result = BigInt::one() << bits;
    let mut square = base.clone();
    let mut rest = exponent;
    while rest > 0 {
        if rest & 1 == 1 {
            result = fixed_product(&result, &square, bits, up);
        }
        if rest > 1 {
            square = fixed_product(&square, &square, bits, up);
        }
        rest >>= 1;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floor_roots_are_floors() {
        let values = [
            BigInt::from(1u8),
            BigInt::from(2u8),
            BigInt::from(1_000_000u32),
            BigInt::from(u128::MAX),
            BigInt::from(3u8).pow(1000u32) + 1u8,
            (BigInt::from(7u8) << 5000u32) / 3u8,
        ];
        for value in &values {
            for order in [1u64, 2, 3, 5, 73, 365, 2000] {
                let root = floor_root(value, order);
                assert!(power(&root, order) <= *value, "{order}");
                assert!(power(&(&root + 1u8), order) > *value, "{order}");
            }
        }
        assert_eq!(
            exact_root(&BigInt::from(1u8), &BigInt::from(10u8).pow(100u32)),
            Some(BigInt::one())
        );
        assert_eq!(
            exact_root(&BigInt::from(161_051u32), &BigInt::from(5u8)),
            Some(BigInt::from(11u8))
        );
        assert_eq!(
            exact_root(&BigInt::from(161_052u32), &BigInt::from(5u8)),
            None
        );
    }

    #[test]
    fn logarithm_bounds_hold() {
        // ln 2 ≈ 0.693147180559945309, ln(1/3) ≈ −1.098612288668109691
        for (num, den, low_bound, high_bound) in [
            (
                2u32,
                1u32,
                693_147_180_559_945_308i64,
                693_147_180_559_945_310i64,
            ),
            (1, 3, -1_098_612_288_668_109_692, -1_098_612_288_668_109_690),
        ] {
            let (low, high) = ln_interval(&BigInt::from(num), &BigInt::from(den), 128);
            let scale = BigInt::from(10u8).pow(18u32);
            let unit = BigInt::one() << 128u32;
            assert!(floor_div(&(&low * &scale), &unit) <= BigInt::from(high_bound));
            assert!(ceil_div(&(&high * &scale), &unit) >= BigInt::from(low_bound));
            assert!(low <= high);
        }
    }
}
