//! Excel's XNPV and XIRR: flows on calendar dates, with irrational discount factors bracketed in
//! exact integer arithmetic.

use alloc::collections::BTreeMap;
use alloc::vec::Vec;

use num_bigint::BigInt;
use num_integer::Integer;
use num_traits::{One, Signed, Zero};

use super::big::{
    ceil_div, exact_root, fixed_power, fixed_product, floor_div, floor_root, power, sign,
};
use crate::finance::rates::{GridValue, bisect_rate, check_digits, flow_units, sign_changes};
use crate::finance::{Date, DayCount, MoneyKind, money_like, round_quotient, year_fraction};
use crate::{Error, Factor, Int, Ratio, Rounding};

/// The most bits each discount factor and the sum are bracketed to: every step of a factor raises
/// a number of about this many bits to the root's order (365 for days / 365).
const MAX_X_BITS: u64 = 2048;
/// The largest prime power a year fraction's denominator may have, so its roots stay small.
const MAX_ROOT_ORDER: u64 = 1_000_000;
/// The most bits a root may work on (its order times the precision): 2^22.
const MAX_ROOT_BITS: u64 = 1 << 22;

/// How [`xnpv`], [`xnpv_bounds`] and [`xirr`] count a flow's time from the first date, in years.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct XnpvOptions {
    /// The day count (ACT/365F, days / 365, as Excel's XNPV and XIRR count it, by default). Any
    /// other convention isn't Excel's.
    pub day_count: DayCount,
    /// For [`DayCount::ThirtyE360Isda`] only, as in
    /// [`year_fraction`](crate::finance::year_fraction).
    pub maturity: Option<bool>,
}

impl Default for XnpvOptions {
    /// Excel's: ACT/365F.
    fn default() -> Self {
        Self {
            day_count: DayCount::Act365Fixed,
            maturity: None,
        }
    }
}

/// The result of [`xnpv_bounds`]: the net present value lies in `[lower, upper]`, in major units.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct XnpvBounds {
    /// A lower bound on the value.
    pub lower: Ratio,
    /// An upper bound on the value.
    pub upper: Ratio,
    /// Whether the value is rational and `lower` and `upper` are it.
    pub exact: bool,
}

/// An exponent `n/m` split by its denominator's prime powers: `n/m = whole + Σ r/q` with
/// `0 < r < q`, by the CRT. `g^whole` is an exact power, and each `g^(r/q)` needs a root of order
/// `q` only (73 at most for days / 365 = 5·73).
struct SplitExponent {
    whole: i64,
    /// `(q, r)` pairs, by increasing prime
    parts: Vec<(u64, u64)>,
}

/// Flows grouped by time: each group's summed units and its exponent, in years from the first
/// date, in increasing order.
struct DatedFlows {
    scale: u16,
    units: Vec<BigInt>,
    splits: Vec<SplitExponent>,
}

/// The prime powers whose product is `order` (coprime, so the CRT applies), by trial division.
fn prime_powers(order: u64) -> Vec<u64> {
    let mut powers = Vec::new();
    let mut rest = order;
    let mut prime = 2;
    while prime * prime <= rest {
        if rest % prime == 0 {
            let mut power = 1;
            while rest % prime == 0 {
                rest /= prime;
                power *= prime;
            }
            powers.push(power);
        }
        prime += 1;
    }
    if rest > 1 {
        powers.push(rest);
    }
    powers
}

/// `value⁻¹ mod modulus`, for `value` coprime to `modulus`.
fn inverse_mod(value: i128, modulus: i128) -> i128 {
    let (mut old_remainder, mut remainder) = (value.rem_euclid(modulus), modulus);
    let (mut old_coefficient, mut coefficient) = (1i128, 0i128);
    while remainder != 0 {
        let quotient = old_remainder / remainder;
        (old_remainder, remainder) = (remainder, old_remainder - quotient * remainder);
        (old_coefficient, coefficient) = (coefficient, old_coefficient - quotient * coefficient);
    }
    old_coefficient.rem_euclid(modulus)
}

fn split_exponent(years: &Ratio) -> Result<SplitExponent, Error> {
    // year fractions of dates up to 9999 have small numerators and denominators
    let (Some(num), Some(order)) = (years.numer().to_i64(), years.denom().to_i64()) else {
        return Err(Error::RootTooLarge);
    };
    if order == 1 {
        return Ok(SplitExponent {
            whole: num,
            parts: Vec::new(),
        });
    }
    let mut parts = Vec::new();
    let mut covered: i128 = 0;
    for power in prime_powers(order.unsigned_abs()) {
        if power > MAX_ROOT_ORDER {
            return Err(Error::RootTooLarge);
        }
        let (power, order) = (i128::from(power), i128::from(order));
        let cofactor = order / power;
        let residue = (i128::from(num).rem_euclid(power) * inverse_mod(cofactor, power)) % power;
        if residue != 0 {
            // both below the order, which fits a u64
            parts.push((power as u64, residue as u64));
        }
        covered += residue * cofactor;
    }
    // n = whole·m + Σ r·(m/q) exactly: by the CRT, m divides n − Σ r·(m/q)
    let rest = i128::from(num) - covered;
    if rest % i128::from(order) != 0 {
        return Err(Error::RootTooLarge);
    }
    Ok(SplitExponent {
        // |whole| ≤ |num|, which fits an i64
        whole: (rest / i128::from(order)) as i64,
        parts,
    })
}

fn dated_flows<M: MoneyKind>(
    values: &[M],
    dates: &[Date],
    options: &XnpvOptions,
) -> Result<DatedFlows, Error> {
    if values.len() != dates.len() {
        return Err(Error::LengthMismatch);
    }
    let (units, scale) = flow_units(values)?;
    // Excel checks the values as given, before flows on one date are combined
    if !(units.iter().any(Int::is_positive) && units.iter().any(Int::is_negative)) {
        return Err(Error::OneSignOnly);
    }
    let first = dates[0];
    let mut by_time: BTreeMap<Ratio, BigInt> = BTreeMap::new();
    for (date, flow) in dates.iter().zip(&units) {
        // ACT/365F first: whatever the convention, it fails for a date before the first
        year_fraction(first, *date, DayCount::Act365Fixed, None).map_err(|error| match error {
            Error::EndBeforeStart => Error::DateBeforeFirst,
            other => other,
        })?;
        let years = year_fraction(first, *date, options.day_count, options.maturity)?;
        *by_time.entry(years).or_default() += flow.to_big();
    }
    let mut grouped = Vec::with_capacity(by_time.len());
    let mut splits = Vec::with_capacity(by_time.len());
    for (years, flow) in by_time {
        splits.push(split_exponent(&years)?);
        grouped.push(flow);
    }
    Ok(DatedFlows {
        scale,
        units: grouped,
        splits,
    })
}

/// `g^(1/q)` for `g = num/den`: rational when `g` in lowest terms has perfect `q`th powers above
/// and below, else bracketed by the floor of `2^bits · g^(1/q)`.
#[derive(Clone)]
enum Root {
    Rational(BigInt, BigInt),
    Low(BigInt),
}

fn root_bracket(num: &BigInt, den: &BigInt, order: u64, bits: u64) -> Root {
    let divisor = num.gcd(den);
    let order_big = BigInt::from(order);
    if let (Some(root_num), Some(root_den)) = (
        exact_root(&(num / &divisor), &order_big),
        exact_root(&(den / &divisor), &order_big),
    ) {
        return Root::Rational(root_num, root_den);
    }
    // the floor of 2^bits · g^(1/q): the qth root of num · 2^(q·bits) / den, floored (flooring
    // inside the root doesn't change the floor of the root)
    Root::Low(floor_root(&((num << (bits * order)) / den), order))
}

/// `[low, high] / scale` bounds `Σ unitsᵢ / factorᵢ`; exact when `low = high` is the value.
struct ScaledSum {
    low: BigInt,
    high: BigInt,
    scale: BigInt,
    exact: bool,
}

/// One group of terms with the same irrational part `Π g^(r/q)`: its exact coefficient.
struct Group {
    parts: Vec<(u64, u64)>,
    num: BigInt,
    den: BigInt,
}

/// `Σ unitsᵢ / g^yearsᵢ` times 2^bits, as integers `[low, high]` around it, and whether it is
/// exact. Each term is `v·g^(−whole) / Π g^(r/q)`: flows with the same irrational part are summed
/// exactly first, so terms that cancel (a zero first flow, flows on one date, a root on the grid)
/// cancel exactly, and the value is exact when every irrational part's coefficient is 0. Each other
/// group's factor `F` is bracketed by its roots' fixed-point powers and products, floored for the
/// lower end and ceiled for the upper; `C / F` lies between `C / F_high` and `C / F_low` (swapped
/// for `C < 0`), floored and ceiled to the grid. `None` while a lower end floors to 0 (a factor
/// below 2^−bits): more bits settle it.
fn xnpv_scaled(
    flows: &DatedFlows,
    num: &BigInt,
    den: &BigInt,
    bits: u64,
) -> Result<Option<ScaledSum>, Error> {
    let mut roots: BTreeMap<u64, Root> = BTreeMap::new();
    let mut root_of = |order: u64| -> Result<Root, Error> {
        if let Some(root) = roots.get(&order) {
            return Ok(root.clone());
        }
        if order.saturating_mul(bits) > MAX_ROOT_BITS {
            return Err(Error::RootTooLarge);
        }
        let root = root_bracket(num, den, order, bits);
        roots.insert(order, root.clone());
        Ok(root)
    };
    // every term over one common denominator, num^A·den^B for the whole powers W in [Wmin, Wmax]:
    // v·g^(−W) = v·den^(W + B)·num^(A − W) / (num^A·den^B), both exponents ≥ 0, so the terms of a
    // group add as integers
    let (mut whole_min, mut whole_max) = (0i64, 0i64);
    for (split, units) in flows.splits.iter().zip(&flows.units) {
        if !units.is_zero() {
            whole_min = whole_min.min(split.whole);
            whole_max = whole_max.max(split.whole);
        }
    }
    let mut num_powers: BTreeMap<u64, BigInt> = BTreeMap::new();
    let mut den_powers: BTreeMap<u64, BigInt> = BTreeMap::new();
    let cached = |cache: &mut BTreeMap<u64, BigInt>, base: &BigInt, exponent: u64| {
        cache
            .entry(exponent)
            .or_insert_with(|| power(base, exponent))
            .clone()
    };
    // the differences are non-negative: whole_min ≤ 0 ≤ whole_max
    let common = cached(&mut num_powers, num, whole_max.unsigned_abs())
        * cached(&mut den_powers, den, whole_min.unsigned_abs());
    let mut groups: Vec<Group> = Vec::new();
    for (split, units) in flows.splits.iter().zip(&flows.units) {
        if units.is_zero() {
            continue;
        }
        // v · g^(−whole), over the common denominator
        let mut term_num = units
            * cached(
                &mut den_powers,
                den,
                (split.whole - whole_min).unsigned_abs(),
            )
            * cached(
                &mut num_powers,
                num,
                (whole_max - split.whole).unsigned_abs(),
            );
        let mut term_den = common.clone();
        let mut irrational = Vec::new();
        for &(order, residue) in &split.parts {
            match root_of(order)? {
                Root::Rational(root_num, root_den) => {
                    // a rational root: divide by root^r exactly
                    term_num *= power(&root_den, residue);
                    term_den *= power(&root_num, residue);
                }
                Root::Low(_) => irrational.push((order, residue)),
            }
        }
        match groups.iter_mut().find(|group| group.parts == irrational) {
            None => groups.push(Group {
                parts: irrational,
                num: term_num,
                den: term_den,
            }),
            Some(group) if group.den == term_den => group.num += term_num,
            Some(group) => {
                // only with rational roots: add over the product, in lowest terms
                let sum_num = &group.num * &term_den + &term_num * &group.den;
                let sum_den = &group.den * &term_den;
                let divisor = sum_num.gcd(&sum_den);
                let divisor = if divisor.is_zero() {
                    BigInt::one()
                } else {
                    divisor
                };
                group.num = sum_num / &divisor;
                group.den = sum_den / &divisor;
            }
        }
    }
    let unit = BigInt::one() << bits;
    let (mut low, mut high) = (BigInt::zero(), BigInt::zero());
    let (mut rational_num, mut rational_den) = (BigInt::zero(), BigInt::one());
    let mut exact = true;
    for group in &groups {
        if group.num.is_zero() {
            continue; // cancelled exactly
        }
        if group.parts.is_empty() {
            rational_num = &rational_num * &group.den + &group.num * &rational_den;
            rational_den *= &group.den;
            continue;
        }
        exact = false;
        // F = Π g^(r/q) in [factor_low, factor_high] / 2^bits
        let (mut factor_low, mut factor_high) = (unit.clone(), unit.clone());
        for &(order, residue) in &group.parts {
            let Root::Low(root) = root_of(order)? else {
                continue;
            };
            factor_low = fixed_product(
                &factor_low,
                &fixed_power(&root, residue, bits, false),
                bits,
                false,
            );
            factor_high = fixed_product(
                &factor_high,
                &fixed_power(&(root + 1u8), residue, bits, true),
                bits,
                true,
            );
        }
        if factor_low.is_zero() {
            return Ok(None);
        }
        // C / F = num·2^bits / (den·F), times 2^bits on the grid
        let scaled = &group.num * &unit * &unit;
        let (small, large) = if group.num.is_negative() {
            (&factor_low, &factor_high)
        } else {
            (&factor_high, &factor_low)
        };
        low += floor_div(&scaled, &(&group.den * small));
        high += ceil_div(&scaled, &(&group.den * large));
    }
    if exact {
        // every irrational part cancelled: the value is rational_num / rational_den
        return Ok(Some(ScaledSum {
            low: rational_num.clone(),
            high: rational_num,
            scale: rational_den,
            exact: true,
        }));
    }
    low += floor_div(&(&rational_num * &unit), &rational_den);
    high += ceil_div(&(&rational_num * &unit), &rational_den);
    Ok(Some(ScaledSum {
        low,
        high,
        scale: unit,
        exact: false,
    }))
}

/// `1 + rate` as `num/den`, checked to be above zero.
fn growth_of(rate: impl Factor) -> Result<(BigInt, BigInt), Error> {
    let rate = rate.to_ratio()?;
    let num = rate.numer().to_big() + rate.denom().to_big();
    if !num.is_positive() {
        return Err(Error::RateTooLow);
    }
    Ok((num, rate.denom().to_big()))
}

/// Runs `attempt` at 64, 128, … up to 2,048 bits until it settles.
fn refine<T>(mut attempt: impl FnMut(u64) -> Result<Option<T>, Error>) -> Result<T, Error> {
    let mut bits = 64;
    while bits <= MAX_X_BITS {
        if let Some(result) = attempt(bits)? {
            return Ok(result);
        }
        bits *= 2;
    }
    Err(Error::PrecisionExhausted)
}

fn ratio_of(numerator: BigInt, denominator: &BigInt) -> Result<Ratio, Error> {
    Ratio::new(Int::from_big(numerator), Int::from_big(denominator.clone()))
}

/// Bounds on Excel's XNPV, the net present value of flows on arbitrary dates:
/// `Σ valueᵢ / (1 + rate)^((dateᵢ − date₀)/365)`. The fractional powers are irrational in general,
/// so this gives an interval `[lower, upper]` in major units, at most 10^−digits wide (`digits` at
/// most 100), that contains the value: each discount factor is bracketed in exact integer
/// arithmetic and each term's bounds are rounded outwards, an argument written out in ducat's
/// design. Where the value is rational (a rate of 0, every date on the first, or whole years
/// apart), `exact` is true and both ends are the value.
///
/// ```
/// use ducat::Money;
/// use ducat::excel::{XnpvOptions, xnpv_bounds};
/// use ducat::finance::Date;
/// use ducat::iso::Usd;
///
/// let values: Vec<Money<Usd>> = ["-1000", "1100"].iter().map(|v| v.parse()).collect::<Result<_, _>>()?;
/// let dates: Vec<Date> = ["2021-01-01", "2022-01-01"].iter().map(|d| d.parse()).collect::<Result<_, _>>()?;
/// let bounds = xnpv_bounds("0.1", &values, &dates, &XnpvOptions::default(), 10)?;
/// assert!(bounds.exact && bounds.lower.is_zero());
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::InvalidDigits`]; [`Error::LengthMismatch`], [`Error::OneSignOnly`] and
/// [`Error::DateBeforeFirst`] where Excel returns #NUM!; [`Error::NoFlows`];
/// [`Error::CurrencyMismatch`]; [`Error::RateTooLow`]; [`Error::RootTooLarge`] for a year
/// fraction whose roots would be too large; [`Error::PrecisionExhausted`] when the interval can't
/// be narrowed enough within 2,048 bits; and the day count's errors.
pub fn xnpv_bounds<M: MoneyKind>(
    rate: impl Factor,
    values: &[M],
    dates: &[Date],
    options: &XnpvOptions,
    digits: u16,
) -> Result<XnpvBounds, Error> {
    let width = check_digits(digits)?.to_big();
    let flows = dated_flows(values, dates, options)?;
    let (num, den) = growth_of(rate)?;
    let minor_unit = Int::ONE.mul_pow10(u32::from(flows.scale)).to_big();
    refine(|bits| {
        let Some(sum) = xnpv_scaled(&flows, &num, &den, bits)? else {
            return Ok(None);
        };
        let scale = &sum.scale * &minor_unit;
        // (high − low) / scale major units, at most 10^−digits
        if sum.exact || (&sum.high - &sum.low) * &width <= scale {
            return Ok(Some(XnpvBounds {
                lower: ratio_of(sum.low, &scale)?,
                upper: ratio_of(sum.high, &scale)?,
                exact: sum.exact,
            }));
        }
        Ok(None)
    })
}

/// Excel's XNPV, `Σ valueᵢ / (1 + rate)^((dateᵢ − date₀)/365)`, rounded once to the currency's
/// exponent. The value is irrational in general, so its bounds (as [`xnpv_bounds`]) are narrowed
/// until both round to the same amount, which is then the rounded value; where it is rational it
/// is rounded exactly.
///
/// ```
/// use ducat::{Money, Rounding};
/// use ducat::excel::{XnpvOptions, xnpv};
/// use ducat::finance::Date;
/// use ducat::iso::Usd;
///
/// let values: Vec<Money<Usd>> = ["-10000", "2750", "4250", "3250", "2750"].iter().map(|v| v.parse()).collect::<Result<_, _>>()?;
/// let dates: Vec<Date> = ["2008-01-01", "2008-03-01", "2008-10-30", "2009-02-15", "2009-04-01"]
///     .iter().map(|d| d.parse()).collect::<Result<_, _>>()?;
/// let value = xnpv("0.09", &values, &dates, &XnpvOptions::default(), Rounding::HalfExpand)?;
/// assert_eq!(value.to_decimal(), "2086.65");
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// As [`xnpv_bounds`], and [`Error::Rounding`] with [`Rounding::Unnecessary`] for an inexact value.
pub fn xnpv<M: MoneyKind>(
    rate: impl Factor,
    values: &[M],
    dates: &[Date],
    options: &XnpvOptions,
    rounding: Rounding,
) -> Result<M, Error> {
    let flows = dated_flows(values, dates, options)?;
    let (num, den) = growth_of(rate)?;
    let minor_unit = Int::ONE.mul_pow10(u32::from(flows.scale)).to_big();
    let template = &values[0];
    let exponent = u16::from(template.parts().2.exponent());
    let amount = refine(|bits| {
        let Some(sum) = xnpv_scaled(&flows, &num, &den, bits)? else {
            return Ok(None);
        };
        let scale = Int::from_big(&sum.scale * &minor_unit);
        let low = round_quotient(&Int::from_big(sum.low), &scale, exponent, rounding)?;
        if sum.exact {
            return Ok(Some(low));
        }
        // rounding is monotone, so when both ends round alike, so does everything between
        let high = round_quotient(&Int::from_big(sum.high), &scale, exponent, rounding)?;
        Ok((low.units == high.units).then_some(low))
    })?;
    Ok(money_like(template, amount))
}

/// The sign of XNPV at `1 + rate = num/den`, refined until the bounds exclude zero.
fn xnpv_sign(flows: &DatedFlows, num: &BigInt, den: &BigInt) -> Result<i8, Error> {
    refine(|bits| {
        let Some(sum) = xnpv_scaled(flows, num, den, bits)? else {
            return Ok(None);
        };
        if sum.exact {
            return Ok(Some(sign(&sum.low)));
        }
        if sum.low.is_positive() {
            return Ok(Some(1));
        }
        if sum.high.is_negative() {
            return Ok(Some(-1));
        }
        Ok(None)
    })
}

/// Excel's XIRR: the rate at which [`xnpv`] is zero, floored to `digits` decimal places (at most
/// 100), as [`irr`](super::irr) is. It bisects on the grid of `digits`-place decimals, taking
/// XNPV's sign from its bounds at each step (refined until they exclude zero), so the root is
/// bracketed, never guessed.
///
/// Where Excel guesses, it is an error instead: the flows, combined by date in date order, change
/// sign more than once (several rates can fit) without a `bracket`, which replaces Excel's
/// `guess`. Microsoft documents that XIRR iterates until it is within 0.000001 percent, so Excel's
/// value is that close to `[lower, upper]`.
///
/// ```
/// use ducat::Money;
/// use ducat::excel::{XnpvOptions, xirr};
/// use ducat::finance::Date;
/// use ducat::iso::Usd;
///
/// let values: Vec<Money<Usd>> = ["-10000", "2750", "4250", "3250", "2750"].iter().map(|v| v.parse()).collect::<Result<_, _>>()?;
/// let dates: Vec<Date> = ["2008-01-01", "2008-03-01", "2008-10-30", "2009-02-15", "2009-04-01"]
///     .iter().map(|d| d.parse()).collect::<Result<_, _>>()?;
/// // Excel: 0.373362535, within its 0.000001%
/// assert_eq!(xirr(&values, &dates, &XnpvOptions::default(), 9, None)?.to_string(), "0.373362533");
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// As [`xnpv_bounds`]; [`Error::FlowsCancel`] when the flows cancel on every date (every rate is
/// a root); [`Error::NoSignChange`]; [`Error::SeveralSignChanges`] without a bracket;
/// [`Error::InvalidBracket`]; [`Error::RateNearMinusOne`]; [`Error::RateTooHigh`].
pub fn xirr<M: MoneyKind>(
    values: &[M],
    dates: &[Date],
    options: &XnpvOptions,
    digits: u16,
    bracket: Option<(&Ratio, &Ratio)>,
) -> Result<GridValue, Error> {
    let unit = check_digits(digits)?;
    let flows = dated_flows(values, dates, options)?;
    let units: Vec<Int> = flows.units.iter().cloned().map(Int::from_big).collect();
    let (changes, first_sign) = sign_changes(&units);
    // combined by date, the flows can cancel: then every rate fits, or none does
    if units.iter().all(Int::is_zero) {
        return Err(Error::FlowsCancel);
    }
    if changes == 0 {
        return Err(Error::NoSignChange);
    }
    if changes > 1 && bracket.is_none() {
        return Err(Error::SeveralSignChanges);
    }
    let unit_big = unit.to_big();
    let sign_at = |grid: &Int| xnpv_sign(&flows, &(&unit_big + grid.to_big()), &unit_big);
    let sign_at_rate = |rate: &Ratio| {
        let den = rate.denom().to_big();
        xnpv_sign(&flows, &(rate.numer().to_big() + &den), &den)
    };
    let result = |grid: Int| {
        if grid <= -&unit {
            return Err(Error::RateNearMinusOne);
        }
        Ok(GridValue::new(grid, digits))
    };
    bisect_rate(sign_at, result, &unit, first_sign, bracket, sign_at_rate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exponents_split_by_the_crt() {
        for (num, den) in [
            (1i64, 365i64),
            (730, 365),
            (12_345, 365 * 366),
            (7, 360),
            (0, 1),
        ] {
            let years = Ratio::new(num, den).unwrap();
            let split = split_exponent(&years).unwrap();
            let mut total = Ratio::from(split.whole);
            for (order, residue) in &split.parts {
                total = total.add(&Ratio::new(*residue, *order).unwrap());
            }
            assert_eq!(total, years);
        }
        assert!(
            split_exponent(&Ratio::new(1, 365).unwrap())
                .unwrap()
                .parts
                .iter()
                .all(|(order, _)| *order == 5 || *order == 73)
        );
    }
}
