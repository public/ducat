//! Floats out: the nearest `f64` of an exact amount, for display or interop only.
//!
//! "No floats in arithmetic" holds: nothing in ducat calls these conversions (the workspace's
//! `clippy.toml` disallows the public methods), and no float ever comes back in through them.
//! Each conversion is rounded once, to the nearest double, ties to even, bit for bit as ducat's
//! TypeScript gives it.

use alloc::format;

use crate::{Error, Int};

/// Options for [`Money::to_minor_f64`](crate::Money::to_minor_f64) and
/// [`AnyMoney::to_minor_f64`](crate::AnyMoney::to_minor_f64), ducat's `ToMinorNumberOptions`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct ToMinorF64Options {
    /// Return the nearest double instead of [`Error::Overflow`] beyond 2^53 − 1 minor units
    /// (`Number.MAX_SAFE_INTEGER`): lossy on purpose, for charts and APIs that take numbers, and
    /// ±infinity beyond the largest double. It waives only that check: digits below the minor
    /// unit are still [`Error::Rounding`] (round first, or use `to_f64` for a float in major
    /// units). ducat's `lossy`; `false` by default, as there.
    pub lossy: bool,
}

/// 2^53 − 1, `Number.MAX_SAFE_INTEGER`.
const MAX_SAFE_INTEGER: i128 = (1 << 53) - 1;

/// The nearest double to `units × 10^−scale`, as JavaScript's `Number(decimalString)`: Rust's
/// `f64` parsing is correctly rounded (ties to even) for any number of digits, so the exact
/// decimal is rounded once, with no float arithmetic on the way. Beyond the largest double it is
/// ±infinity, and a negative amount below the smallest subnormal is −0.0, as `Number` gives.
pub(crate) fn decimal_to_f64(units: &Int, scale: u16) -> f64 {
    // `{units}e-{scale}` is in the grammar `str::parse::<f64>` reads, and it is the exact value
    // of the amount; zero is "0e-…", +0.0
    format!("{units}e-{scale}").parse().unwrap_or(f64::NAN)
}

/// Minor units as a double: exact up to 2^53 − 1, the nearest double beyond it with `lossy`,
/// and [`Error::Overflow`] beyond it without (ducat's `RangeError`).
pub(crate) fn minor_to_f64(minor: &Int, options: ToMinorF64Options) -> Result<f64, Error> {
    match minor.to_i128() {
        // a safe integer converts exactly, and gives the same double as the decimal parse
        Some(value) if value.unsigned_abs() <= MAX_SAFE_INTEGER.unsigned_abs() => {
            Ok(decimal_to_f64(minor, 0))
        }
        _ if options.lossy => Ok(decimal_to_f64(minor, 0)),
        _ => Err(Error::Overflow),
    }
}

/// The nearest double to an exact fraction, by ducat's `ExactMoney#toNumber` algorithm, step for
/// step, so the bits are the same: the quotient is taken to 65 or 66 bits with a sticky low bit
/// for a non-zero remainder, rounded once to 53 bits (ties to even, as `Number(bigint)`), then
/// scaled by two exact powers of two. In the normal range of doubles that is the correctly
/// rounded quotient; below 2^−1022 (far below any amount) the last scaling rounds a second time,
/// as ducat's does.
#[cfg(feature = "exact")]
pub(crate) fn ratio_to_f64(value: &crate::Ratio) -> f64 {
    use num_integer::Integer;
    use num_traits::{ToPrimitive, Zero};

    let num = value.numer().to_big();
    if num.is_zero() {
        return 0.0;
    }
    let negative = num.sign() == num_bigint::Sign::Minus;
    let magnitude = num.magnitude();
    let den = value.denom().to_big();
    let den = den.magnitude();
    // bit lengths are far below i64::MAX
    let bits = |value: &num_bigint::BigUint| i64::try_from(value.bits()).unwrap_or(i64::MAX);
    let shift = 65 - bits(magnitude) + bits(den);
    let (scaled, divisor) = if shift > 0 {
        (magnitude << shift.unsigned_abs(), den.clone())
    } else {
        (magnitude.clone(), den << shift.unsigned_abs())
    };
    let (quotient, remainder) = scaled.div_rem(&divisor);
    // the quotient has 65 or 66 bits
    let quotient = quotient.to_u128().unwrap_or(u128::MAX) | u128::from(!remainder.is_zero());
    let half = -shift >> 1;
    // `as` rounds to the nearest double, ties to even, as `Number(bigint)`
    #[allow(clippy::cast_precision_loss)]
    let magnitude = quotient as f64 * pow2(half) * pow2(-shift - half);
    if negative { -magnitude } else { magnitude }
}

/// 2^exponent as JavaScript's `2 ** exponent` gives it: exact from 2^−1074 to 2^1023, 0 below
/// and infinity above.
#[cfg(feature = "exact")]
fn pow2(exponent: i64) -> f64 {
    match exponent {
        ..-1074 => 0.0,
        // a subnormal: one bit of the fraction
        -1074..-1022 => f64::from_bits(1u64 << (exponent + 1074)),
        // a normal: the biased exponent alone
        -1022..=1023 => f64::from_bits(((exponent + 1023) as u64) << 52),
        _ => f64::INFINITY,
    }
}
