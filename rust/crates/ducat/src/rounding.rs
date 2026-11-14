//! Rounding modes, and the one rounding division every operation shares.

use core::cmp::Ordering;
use core::fmt;
use core::str::FromStr;

use num_bigint::{BigInt, Sign};
use num_integer::Integer;
use num_traits::{Signed, Zero};

use crate::int::pow10_big;
use crate::wide::U256;
use crate::{Error, Int};

/// How to round an exact result that doesn't fit the scale asked for.
///
/// The names are those of ECMA-402's `roundingMode` (`Intl.NumberFormat`), as ducat uses them,
/// plus [`Unnecessary`](Rounding::Unnecessary), which refuses to round. There is no default:
/// every operation that may round takes a `Rounding`.
///
/// [`FromStr`] and [`Display`](fmt::Display) use the ECMA-402 names (`"halfEven"`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[non_exhaustive]
pub enum Rounding {
    /// To the nearest; ties to the even neighbour (banker's rounding).
    HalfEven,
    /// To the nearest; ties away from zero ("half up").
    HalfExpand,
    /// To the nearest; ties toward zero ("half down").
    HalfTrunc,
    /// To the nearest; ties toward +∞.
    HalfCeil,
    /// To the nearest; ties toward −∞.
    HalfFloor,
    /// Away from zero.
    Expand,
    /// Toward zero.
    Trunc,
    /// Toward +∞.
    Ceil,
    /// Toward −∞.
    Floor,
    /// Never: an inexact result is [`Error::Rounding`].
    Unnecessary,
}

impl Rounding {
    /// Every mode, in the order of the table in ducat's spec.
    pub const ALL: [Rounding; 10] = [
        Self::HalfEven,
        Self::HalfExpand,
        Self::HalfTrunc,
        Self::HalfCeil,
        Self::HalfFloor,
        Self::Expand,
        Self::Trunc,
        Self::Ceil,
        Self::Floor,
        Self::Unnecessary,
    ];

    /// The ECMA-402 name of the mode: `"halfEven"`, `"expand"`, `"unnecessary"`.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::HalfEven => "halfEven",
            Self::HalfExpand => "halfExpand",
            Self::HalfTrunc => "halfTrunc",
            Self::HalfCeil => "halfCeil",
            Self::HalfFloor => "halfFloor",
            Self::Expand => "expand",
            Self::Trunc => "trunc",
            Self::Ceil => "ceil",
            Self::Floor => "floor",
            Self::Unnecessary => "unnecessary",
        }
    }

    /// Whether a quotient whose magnitude is `magnitude` (truncated), with sign `negative`, moves
    /// one unit away from zero. `half` compares the remainder with half the divisor; `inexact` is
    /// whether the remainder is non-zero.
    fn rounds_away(
        self,
        negative: bool,
        odd: bool,
        inexact: bool,
        half: Ordering,
    ) -> Result<bool, Error> {
        let tie_or_above = |tie: bool| match half {
            Ordering::Greater => true,
            Ordering::Equal => tie,
            Ordering::Less => false,
        };
        Ok(match self {
            Self::Trunc => false,
            Self::Expand => inexact,
            Self::Ceil => inexact && !negative,
            Self::Floor => inexact && negative,
            Self::HalfExpand => inexact && tie_or_above(true),
            Self::HalfTrunc => inexact && tie_or_above(false),
            Self::HalfEven => inexact && tie_or_above(odd),
            Self::HalfCeil => inexact && tie_or_above(!negative),
            Self::HalfFloor => inexact && tie_or_above(negative),
            Self::Unnecessary => {
                if inexact {
                    return Err(Error::Rounding);
                }
                false
            }
        })
    }
}

impl fmt::Display for Rounding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl FromStr for Rounding {
    type Err = Error;

    /// Parses an ECMA-402 name, such as `"halfEven"`. Anything else is [`Error::Syntax`].
    fn from_str(name: &str) -> Result<Self, Error> {
        Self::ALL
            .into_iter()
            .find(|mode| mode.name() == name)
            .ok_or(Error::Syntax)
    }
}

/// A divisor for [`div_round`]: a 256-bit magnitude, or one too large for 256 bits (only a power
/// of ten from a large scale difference can be), which every dividend here is less than half of.
#[derive(Clone, Copy)]
pub(crate) enum Divisor {
    Wide(U256),
    Huge,
}

/// `±numerator / divisor`, rounded once with `mode`, as an `i128`.
///
/// `numerator` is a magnitude below 2^255 and `negative` its sign; the divisor is positive.
pub(crate) fn div_round(
    negative: bool,
    numerator: U256,
    divisor: Divisor,
    mode: Rounding,
) -> Result<i128, Error> {
    let (quotient, half, inexact) = match divisor {
        Divisor::Wide(divisor) => {
            if divisor.is_zero() {
                return Err(Error::DivisionByZero);
            }
            let (quotient, remainder) = numerator.div_rem(divisor);
            // remainder against divisor − remainder: no doubling, so no overflow
            let half = remainder.cmp(&divisor.wrapping_sub(remainder));
            (quotient, half, !remainder.is_zero())
        }
        Divisor::Huge => (U256::ZERO, Ordering::Less, !numerator.is_zero()),
    };
    let away = mode.rounds_away(negative, quotient.is_odd(), inexact, half)?;
    let magnitude = if away {
        quotient.checked_add_one().ok_or(Error::Overflow)?
    } else {
        quotient
    };
    magnitude.to_i128(negative).ok_or(Error::Overflow)
}

/// `value × 10^up / (den × 10^down)` is what scale changes and ratio products need: this builds
/// the 256-bit numerator and divisor for it. Returns `None` when the numerator doesn't fit 256
/// bits, which means the result can't fit an `i128` either (see the comment inside).
pub(crate) fn scaled_ratio(
    value: i128,
    num: i128,
    den: u128,
    up: u32,
    down: u32,
) -> Option<(bool, U256, Divisor)> {
    debug_assert!(den > 0);
    debug_assert!(up == 0 || down == 0);
    let negative = (value < 0) != (num < 0) && value != 0 && num != 0;
    let mut numerator = U256::mul(value.unsigned_abs(), num.unsigned_abs());
    // The divisor is at most den < 2^127 when scaling up, so a numerator of 2^256 or more gives a
    // quotient of at least 2^129: an overflow, reported by the caller.
    if !numerator.is_zero() {
        numerator = numerator.checked_mul_pow10(up)?;
    }
    let divisor = match U256::from_u128(den).checked_mul_pow10(down) {
        Some(divisor) => Divisor::Wide(divisor),
        // numerator < 2^254 and divisor ≥ 2^256: the quotient is 0 and the remainder below half
        None => Divisor::Huge,
    };
    Some((negative, numerator, divisor))
}

/// `value × num × 10^up / (den × 10^down)`, rounded once with `mode`, in `i128` with 256-bit
/// intermediates: the fast path. [`Error::Overflow`] means the result needs the general path.
pub(crate) fn rescale_small(
    value: i128,
    num: i128,
    den: u128,
    up: u32,
    down: u32,
    mode: Rounding,
) -> Result<i128, Error> {
    let (negative, numerator, divisor) =
        scaled_ratio(value, num, den, up, down).ok_or(Error::Overflow)?;
    div_round(negative, numerator, divisor, mode)
}

/// `value × num × 10^up / (den × 10^down)`, rounded once with `mode`. `den` is positive.
///
/// Values that fit take the `i128` path; the rest, and any result beyond `i128`, take the
/// arbitrary-precision path, which rounds by the same rule.
pub(crate) fn rescale_ratio(
    value: &Int,
    num: &Int,
    den: &Int,
    up: u32,
    down: u32,
    mode: Rounding,
) -> Result<Int, Error> {
    if let (Some(value), Some(num), Some(den)) = (value.to_i128(), num.to_i128(), den.to_i128()) {
        match rescale_small(value, num, den.unsigned_abs(), up, down, mode) {
            Ok(result) => return Ok(Int::from(result)),
            Err(Error::Overflow) => {}
            Err(error) => return Err(error),
        }
    }
    if den.is_zero() {
        return Err(Error::DivisionByZero);
    }
    let numerator = value.to_big() * num.to_big() * pow10_big(up);
    let divisor = den.to_big() * pow10_big(down);
    Ok(Int::from_big(round_big(&numerator, &divisor, mode)?))
}

/// `numerator / divisor` rounded once with `mode`; `divisor` is positive.
pub(crate) fn round_big(
    numerator: &BigInt,
    divisor: &BigInt,
    mode: Rounding,
) -> Result<BigInt, Error> {
    let negative = numerator.sign() == Sign::Minus;
    // truncated toward zero, with the remainder taking the numerator's sign
    let (quotient, remainder) = numerator.div_rem(divisor);
    let remainder = remainder.abs();
    let half = remainder.cmp(&(divisor - &remainder));
    let away = mode.rounds_away(negative, quotient.is_odd(), !remainder.is_zero(), half)?;
    Ok(match (away, negative) {
        (false, _) => quotient,
        (true, false) => quotient + 1,
        (true, true) => quotient - 1,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round(value: i128, num: i128, den: u128, mode: Rounding) -> Result<i128, Error> {
        rescale_small(value, num, den, 0, 0, mode)
    }

    #[test]
    fn ties_and_signs() {
        use Rounding::*;
        let cases: [(i128, [i128; 9]); 6] = [
            // value/2 for value = 5, -5, 3, -3, 1, -1: [HalfEven, HalfExpand, HalfTrunc, HalfCeil, HalfFloor, Expand, Trunc, Ceil, Floor]
            (5, [2, 3, 2, 3, 2, 3, 2, 3, 2]),
            (-5, [-2, -3, -2, -2, -3, -3, -2, -2, -3]),
            (3, [2, 2, 1, 2, 1, 2, 1, 2, 1]),
            (-3, [-2, -2, -1, -1, -2, -2, -1, -1, -2]),
            (1, [0, 1, 0, 1, 0, 1, 0, 1, 0]),
            (-1, [0, -1, 0, 0, -1, -1, 0, 0, -1]),
        ];
        let modes = [
            HalfEven, HalfExpand, HalfTrunc, HalfCeil, HalfFloor, Expand, Trunc, Ceil, Floor,
        ];
        for (value, expected) in cases {
            for (mode, want) in modes.iter().zip(expected) {
                assert_eq!(round(value, 1, 2, *mode), Ok(want), "{value}/2 {mode}");
            }
            assert_eq!(round(value, 1, 2, Unnecessary), Err(Error::Rounding));
        }
    }

    #[test]
    fn extremes() {
        assert_eq!(round(i128::MIN, 1, 1, Rounding::Unnecessary), Ok(i128::MIN));
        assert_eq!(
            round(i128::MIN, -1, 1, Rounding::Unnecessary),
            Err(Error::Overflow)
        );
        assert_eq!(
            round(
                i128::MAX,
                i128::MAX,
                i128::MAX as u128,
                Rounding::Unnecessary
            ),
            Ok(i128::MAX)
        );
        assert_eq!(
            round(i128::MIN, i128::MIN, i128::MAX as u128, Rounding::Trunc),
            Err(Error::Overflow)
        );
        assert_eq!(
            round(i128::MAX, 2, 3, Rounding::Floor),
            Ok(i128::MAX / 3 * 2) // i128::MAX % 3 is 1, and 2/3 floors to 0
        );
        // a huge divisor: 10^1000
        assert_eq!(rescale_small(5, 1, 1, 0, 1000, Rounding::HalfExpand), Ok(0));
        assert_eq!(rescale_small(5, 1, 1, 0, 1000, Rounding::Expand), Ok(1));
        assert_eq!(rescale_small(-5, 1, 1, 0, 1000, Rounding::Floor), Ok(-1));
        assert_eq!(
            rescale_small(0, 1, 1, 1000, 0, Rounding::Unnecessary),
            Ok(0)
        );
        assert_eq!(
            rescale_small(1, 1, 1, 39, 0, Rounding::Unnecessary),
            Err(Error::Overflow)
        );
    }

    #[test]
    fn big_path_agrees() {
        let int = |value: i128| Int::from(value);
        for value in [-7i128, -5, -1, 0, 1, 5, 7, i128::MAX, i128::MIN] {
            for mode in Rounding::ALL {
                for den in [1i128, 2, 3, 10] {
                    let small =
                        rescale_small(value, 1, den.unsigned_abs(), 0, 0, mode).map(Int::from);
                    let big = round_big(&BigInt::from(value), &BigInt::from(den), mode)
                        .map(Int::from_big);
                    assert_eq!(small, big, "{value}/{den} {mode}");
                }
            }
        }
        // past the i128 range, on both sides
        let max = int(i128::MAX);
        assert_eq!(
            rescale_ratio(&max, &int(2), &Int::ONE, 0, 0, Rounding::Unnecessary).unwrap(),
            &max + &max
        );
        assert_eq!(
            rescale_ratio(
                &int(i128::MIN),
                &int(-1),
                &Int::ONE,
                0,
                0,
                Rounding::Unnecessary
            )
            .unwrap(),
            -int(i128::MIN)
        );
        assert_eq!(
            rescale_ratio(&int(1), &Int::ONE, &Int::ONE, 39, 0, Rounding::Unnecessary)
                .unwrap()
                .to_string(),
            "1000000000000000000000000000000000000000"
        );
    }

    #[test]
    fn mode_names_round_trip() {
        for mode in Rounding::ALL {
            assert_eq!(mode.name().parse::<Rounding>(), Ok(mode));
        }
        assert_eq!("HalfEven".parse::<Rounding>(), Err(Error::Syntax));
    }
}
