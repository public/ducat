//! Discounted sums, Excel's NPV and IRR, and periodic and annual rates: the exact rate bisection.

use alloc::vec::Vec;
use core::fmt;

use super::{MAX_PERIODS, MoneyKind, money_like, round_quotient};
use crate::decimal::write_scaled;
use crate::{Error, Factor, Int, Ratio, Rounding};

/// The most decimal places a rate may be asked for.
const MAX_DIGITS: u16 = 100;

/// The most `digits × per_year` that [`periodic_rate`] takes: each step raises a `digits`-place
/// decimal to the `per_year`th power, so this bounds the integers.
const MAX_ROOT_SIZE: u32 = 50_000;

#[cfg(feature = "excel")]
/// The most times the bisection doubles its upper end looking for a positive root: a rate above
/// 2^1024 per period is an error rather than a longer search.
const MAX_DOUBLINGS: u32 = 1024;

/// The flows' units at one common scale (the largest), with their currency.
pub(super) fn flow_units<M: MoneyKind>(flows: &[M]) -> Result<(Vec<Int>, u16), Error> {
    let first = flows.first().ok_or(Error::NoFlows)?;
    let currency = first.parts().2;
    let mut scale = 0;
    for flow in flows {
        let (_, flow_scale, flow_currency) = flow.parts();
        if flow_currency != currency {
            return Err(Error::CurrencyMismatch {
                expected: currency,
                actual: flow_currency,
            });
        }
        scale = scale.max(flow_scale);
    }
    let units = flows
        .iter()
        .map(|flow| {
            let (units, flow_scale, _) = flow.parts();
            units.mul_pow10(u32::from(scale - flow_scale))
        })
        .collect();
    Ok((units, scale))
}

/// `Σ flowₜ · bᵗ · q^(n−t)` for a rate of `(q − b)/b`: the NPV times `q^n`, by Horner's rule. `q^n`
/// is positive for a rate above −1, so this has the NPV's sign.
pub(super) fn scaled_present_value(units: &[Int], growth: &Int, base: &Int) -> Int {
    let mut accumulator = units[0].clone();
    let mut base_power = Int::ONE;
    for flow in &units[1..] {
        base_power = base_power * base;
        accumulator = accumulator * growth + flow * &base_power;
    }
    accumulator
}

/// The flows' discounted value in major units as an unreduced fraction (denominator positive),
/// the first flow at period 0, or at period 1 when `from_period_one`.
fn discounted_value<M: MoneyKind>(
    rate: &Ratio,
    flows: &[M],
    from_period_one: bool,
) -> Result<(Int, Int), Error> {
    let (units, scale) = flow_units(flows)?;
    let growth = rate.numer() + rate.denom();
    if !growth.is_positive() {
        return Err(Error::RateTooLow);
    }
    let mut numerator = scaled_present_value(&units, &growth, rate.denom());
    // fewer than 2^32 flows: a slice that long wouldn't fit in memory as Ints anyway
    let periods = u32::try_from(units.len() - 1).map_err(|_| Error::Overflow)?;
    let mut denominator = growth.pow(periods).mul_pow10(u32::from(scale));
    if from_period_one {
        // one more period: divide by 1 + rate = growth / den
        numerator = numerator * rate.denom();
        denominator = denominator * &growth;
    }
    Ok((numerator, denominator))
}

fn discounted<M: MoneyKind>(
    rate: impl Factor,
    flows: &[M],
    rounding: Rounding,
    from_period_one: bool,
) -> Result<M, Error> {
    let (numerator, denominator) = discounted_value(&rate.to_ratio()?, flows, from_period_one)?;
    let first = &flows[0];
    let exponent = u16::from(first.parts().2.exponent());
    Ok(money_like(
        first,
        round_quotient(&numerator, &denominator, exponent, rounding)?,
    ))
}

/// The discounted sum of flows at periods 0, 1, 2…, `Σ flowₜ / (1 + rate)ᵗ`, rounded once to the
/// currency's exponent: the textbook NPV, with the first flow (an initial outlay, say) not
/// discounted. It is `flows[0] + `[`npv`](crate::excel::npv)`(rate, flows[1..])`. (Not Excel's PV, which is an annuity's
/// present value.)
///
/// ```
/// use ducat::{Money, Rounding};
/// use ducat::finance::discounted_sum;
/// use ducat::iso::Eur;
///
/// let flows: Vec<Money<Eur>> = ["-1000", "300", "400", "500"].iter().map(|f| f.parse()).collect::<Result<_, _>>()?;
/// assert_eq!(discounted_sum("0.08", &flows, Rounding::HalfEven)?.to_decimal(), "17.63");
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::NoFlows`]; [`Error::CurrencyMismatch`] for flows in more than one currency;
/// [`Error::RateTooLow`] for a rate at or below −1; [`Error::Rounding`] with
/// [`Rounding::Unnecessary`]; and whatever reading `rate` fails with.
pub fn discounted_sum<M: MoneyKind>(
    rate: impl Factor,
    flows: &[M],
    rounding: Rounding,
) -> Result<M, Error> {
    discounted(rate, flows, rounding, false)
}

/// Excel's NPV: `Σ flowᵢ / (1 + rate)ⁱ` for i = 1, 2…, so the first flow is at the end of period 1
/// and is discounted once, rounded once to the currency's exponent. As in Excel, an initial outlay
/// at period 0 goes outside: `flows[0] + npv(rate, flows[1..])`, or use
/// [`discounted_sum`](crate::finance::discounted_sum).
///
/// ```
/// use ducat::{Money, Rounding};
/// use ducat::excel::npv;
/// use ducat::iso::Usd;
///
/// let flows: Vec<Money<Usd>> = ["-10000", "3000", "4200", "6800"].iter().map(|f| f.parse()).collect::<Result<_, _>>()?;
/// // Excel's NPV(10%, -10000, 3000, 4200, 6800)
/// assert_eq!(npv("0.1", &flows, Rounding::HalfExpand)?.to_decimal(), "1188.44");
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// As [`discounted_sum`].
#[cfg(feature = "excel")]
pub fn npv<M: MoneyKind>(rate: impl Factor, flows: &[M], rounding: Rounding) -> Result<M, Error> {
    discounted(rate, flows, rounding, true)
}

/// A rate known to `digits` decimal places: the grid point `lower` (in units of 10^−digits) at or
/// below it, and `upper = lower + 10^−digits` above it.
///
/// [`Display`](fmt::Display) writes `lower` as a decimal with `digits` places (`"0.08896339"`).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct GridRate {
    grid: Int,
    digits: u16,
}

impl GridRate {
    /// The lower end in units of 10^−digits: the rate floored to `digits` places, scaled by
    /// 10^digits.
    #[must_use]
    pub const fn grid(&self) -> &Int {
        &self.grid
    }

    /// The number of decimal places.
    #[must_use]
    pub const fn digits(&self) -> u16 {
        self.digits
    }

    /// The lower end, exactly.
    #[must_use]
    pub fn lower(&self) -> Ratio {
        let unit = Int::ONE.mul_pow10(u32::from(self.digits));
        // a power of ten is non-zero
        Ratio::new(self.grid.clone(), unit).unwrap_or(Ratio::ZERO)
    }

    /// The upper end, `lower + 10^−digits`, exactly.
    #[must_use]
    pub fn upper(&self) -> Ratio {
        let unit = Int::ONE.mul_pow10(u32::from(self.digits));
        Ratio::new(&self.grid + &Int::ONE, unit).unwrap_or(Ratio::ZERO)
    }

    /// The upper end as a decimal with `digits` places.
    #[must_use]
    pub fn upper_decimal(&self) -> alloc::string::String {
        let mut text = alloc::string::String::new();
        // writing to a String can't fail
        let _ = write_scaled(&mut text, &(&self.grid + &Int::ONE), self.digits);
        text
    }
}

impl fmt::Display for GridRate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write_scaled(f, &self.grid, self.digits)
    }
}

fn check_digits(digits: u16) -> Result<Int, Error> {
    if digits > MAX_DIGITS {
        return Err(Error::InvalidDigits);
    }
    Ok(Int::ONE.mul_pow10(u32::from(digits)))
}

#[cfg(feature = "excel")]
/// Sign changes in the flows, zeros skipped, and the sign of the first non-zero flow.
fn sign_changes(units: &[Int]) -> (usize, i8) {
    let (mut changes, mut first, mut previous) = (0, 0, 0);
    for flow in units {
        let sign = flow.signum();
        if sign == 0 {
            continue;
        }
        if first == 0 {
            first = sign;
        }
        if previous != 0 && sign != previous {
            changes += 1;
        }
        previous = sign;
    }
    (changes, first)
}

fn half(value: &Int) -> Int {
    // truncated toward zero, as bigint division is in ducat
    value.div_rem(&Int::from(2u8)).0
}

#[cfg(feature = "excel")]
/// The bisection the rate solvers share, on the grid of `unit`ths: from the caller's bracket, or
/// with one sign change from 0 (the root is negative when the value at 0 has the first flow's
/// sign, else positive, found by doubling, at most 1,024 times). `sign_at` takes a grid point,
/// `sign_at_rate` an exact rate; `result` turns the grid point found into the answer.
pub(super) fn bisect_rate<R>(
    sign_at: impl Fn(&Int) -> i8,
    result: impl Fn(Int) -> Result<R, Error>,
    unit: &Int,
    first_sign: i8,
    bracket: Option<(&Ratio, &Ratio)>,
    sign_at_rate: impl Fn(&Ratio) -> i8,
) -> Result<R, Error> {
    let (mut low, mut high, low_sign);
    if let Some(bracket) = bracket {
        match bracket_to_grid(bracket, &sign_at_rate, unit, &sign_at)? {
            Grid::Point(point) => return result(point),
            Grid::Bracket(grid_low, grid_high, sign) => {
                (low, high, low_sign) = (grid_low, grid_high, sign);
            }
        }
    } else {
        // One sign change: by Descartes' rule of signs in 1/(1 + rate) there is one IRR above −1.
        // The NPV has the first flow's sign for large rates and the last flow's sign near −1, and
        // that the search below finds that root is argued from these signs, not proved here.
        let zero_sign = sign_at(&Int::ZERO);
        if zero_sign == 0 {
            return result(Int::ZERO);
        }
        if zero_sign == first_sign {
            // the IRR is negative: between −1 (excluded, where the NPV has the last flow's sign)
            // and 0
            (low, high, low_sign) = (-unit, Int::ZERO, -first_sign);
        } else {
            // the IRR is positive: double the upper end until the NPV takes the first flow's sign
            (low, high, low_sign) = (Int::ZERO, unit.clone(), zero_sign);
            let mut doublings = 0;
            loop {
                let high_sign = sign_at(&high);
                if high_sign == 0 {
                    return result(high);
                }
                if high_sign != low_sign {
                    break;
                }
                doublings += 1;
                if doublings > MAX_DOUBLINGS {
                    return Err(Error::RateTooHigh);
                }
                low = high.clone();
                high = &high + &high;
            }
        }
    }

    // Bisection on the grid: the ends stay grid points, so the integers stay bounded by the
    // digits asked for, and each step halves the bracket.
    while &high - &low > Int::ONE {
        let middle = half(&(&low + &high));
        let middle_sign = sign_at(&middle);
        if middle_sign == 0 {
            return result(middle);
        }
        if middle_sign == low_sign {
            low = middle;
        } else {
            high = middle;
        }
    }
    result(low)
}

#[cfg(feature = "excel")]
/// What `bracket_to_grid` found: the root pinned to one grid step, or a grid bracket to bisect
/// with the sign at its lower end.
enum Grid {
    Point(Int),
    Bracket(Int, Int, i8),
}

#[cfg(feature = "excel")]
/// The caller's bracket narrowed to the grid of `unit`ths. The signs are taken at the exact
/// bracket ends first, so the root found is argued to be one inside the bracket (ducat#307).
fn bracket_to_grid(
    (low_rate, high_rate): (&Ratio, &Ratio),
    sign_at_rate: &impl Fn(&Ratio) -> i8,
    unit: &Int,
    sign_at: &impl Fn(&Int) -> i8,
) -> Result<Grid, Error> {
    if low_rate >= high_rate || !(low_rate.numer() + low_rate.denom()).is_positive() {
        return Err(Error::InvalidBracket);
    }
    let low_sign = sign_at_rate(low_rate);
    let high_sign = sign_at_rate(high_rate);
    let floor_grid = |rate: &Ratio| (rate.numer() * unit).div_floor(rate.denom());
    // an end that is itself a root: the grid point at or below it
    if low_sign == 0 {
        return Ok(Grid::Point(floor_grid(low_rate)));
    }
    if high_sign == 0 {
        return Ok(Grid::Point(floor_grid(high_rate)));
    }
    if low_sign == high_sign {
        return Err(Error::InvalidBracket);
    }

    // the grid points inside the bracket
    let grid_low = -(-(low_rate.numer() * unit)).div_floor(low_rate.denom());
    let grid_high = floor_grid(high_rate);
    if grid_low > grid_high {
        // no grid point inside: the root is between the two around the bracket
        return Ok(Grid::Point(grid_high));
    }
    let grid_low_sign = sign_at(&grid_low);
    if grid_low_sign == 0 {
        return Ok(Grid::Point(grid_low));
    }
    if grid_low_sign != low_sign {
        // the sign changes between the bracket's low end and the first grid point
        return Ok(Grid::Point(grid_low - Int::ONE));
    }
    let grid_high_sign = if grid_high == grid_low {
        grid_low_sign
    } else {
        sign_at(&grid_high)
    };
    if grid_high_sign == 0 || grid_high_sign == low_sign {
        // a root on the last grid point, or between it and the bracket's high end
        return Ok(Grid::Point(grid_high));
    }
    Ok(Grid::Bracket(grid_low, grid_high, low_sign))
}

/// Excel's IRR: the rate at which the NPV of flows at periods 0, 1, 2… (the first undiscounted)
/// is zero, floored to `digits` decimal places (at most 100).
///
/// The IRR is a polynomial root, irrational in general, so it is found by bisection in exact
/// integer arithmetic on the grid of `digits`-place decimals: each step takes the NPV's sign alone,
/// by Horner's rule on integers, with no floats and no Newton steps. The result's `lower` is the
/// IRR rounded down; without a bracket, the NPV at `lower` and at `upper` have opposite signs, or
/// the one at `lower` is zero.
///
/// Where Excel guesses, this is an error. Flows that never change sign have no IRR (Excel's
/// #NUM!). Flows that change sign more than once can have several, and Excel returns whichever its
/// Newton iteration from `guess` finds; here `bracket`, two rates with NPVs of opposite signs
/// (taken at the exact rates), must select one. The IRR returned is then one inside the bracket,
/// as argued (not proved) in ducat's design (ducat#307); another root can share its grid step, so
/// the NPV's signs at `lower` and `upper` may agree. With one sign change and no bracket,
/// Descartes' rule of signs gives one IRR above −1, and the bisection starts from 0; that it finds
/// that root is argued, not proved here.
///
/// ```
/// use ducat::Money;
/// use ducat::excel::irr;
/// use ducat::iso::Eur;
///
/// let flows: Vec<Money<Eur>> = ["-1000", "300", "400", "500"].iter().map(|f| f.parse()).collect::<Result<_, _>>()?;
/// let rate = irr(&flows, 8, None)?;
/// assert_eq!((rate.to_string(), rate.upper_decimal()), ("0.08896339".into(), "0.08896340".into()));
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::InvalidDigits`] for more than 100 digits; [`Error::NoFlows`];
/// [`Error::CurrencyMismatch`]; [`Error::NoSignChange`] for flows that never change sign;
/// [`Error::SeveralSignChanges`] for more than one sign change without a bracket;
/// [`Error::InvalidBracket`] for a bracket that isn't two increasing rates above −1 with NPVs of
/// opposite signs; [`Error::RateNearMinusOne`] for an IRR within 10^−digits of −1 (ask for more
/// digits); [`Error::RateTooHigh`] for an IRR above 2^1024.
#[cfg(feature = "excel")]
pub fn irr<M: MoneyKind>(
    flows: &[M],
    digits: u16,
    bracket: Option<(&Ratio, &Ratio)>,
) -> Result<GridRate, Error> {
    let unit = check_digits(digits)?;
    let (units, _) = flow_units(flows)?;
    let (changes, first_sign) = sign_changes(&units);
    if changes == 0 {
        return Err(Error::NoSignChange);
    }
    if changes > 1 && bracket.is_none() {
        return Err(Error::SeveralSignChanges);
    }
    // a rate of m / 10^digits: its growth factor is (10^digits + m) / 10^digits
    let sign_at = |grid: &Int| scaled_present_value(&units, &(&unit + grid), &unit).signum();
    let sign_at_rate = |rate: &Ratio| {
        scaled_present_value(&units, &(rate.numer() + rate.denom()), rate.denom()).signum()
    };
    let result = |grid: Int| {
        // the NPV is undefined at −1, so a lower end there is no answer
        if grid <= -&unit {
            return Err(Error::RateNearMinusOne);
        }
        Ok(GridRate { grid, digits })
    };
    bisect_rate(sign_at, result, &unit, first_sign, bracket, sign_at_rate)
}

/// The result of [`periodic_rate`]: the rate to `digits` places, and the exact rate when it is
/// rational.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PeriodicRate {
    /// The periodic rate floored to `digits` places: `(1 + lower)^per_year ≤ 1 + annual <
    /// (1 + upper)^per_year`.
    pub rate: GridRate,
    /// The exact periodic rate, when it is rational: when the reduced numerator and denominator of
    /// `1 + annual` are both perfect `per_year`th powers (`"0.21"` with `per_year` 2 gives 1/10).
    pub exact: Option<Ratio>,
}

/// `1 + rate` in lowest terms, checked to be positive.
fn one_plus(rate: &Ratio) -> Result<Ratio, Error> {
    let numerator = rate.numer() + rate.denom();
    if !numerator.is_positive() {
        return Err(Error::RateTooLow);
    }
    // num + den over den is reduced when num over den is: they share the same gcd
    Ok(Ratio::from_reduced(numerator, rate.denom().clone()))
}

/// The integer `power`th root of a positive integer, if it is a perfect `power`th power.
fn exact_root(value: &Int, power: u32) -> Option<Int> {
    // value has `bits` bits, so its root lies in [2^⌊(bits−1)/power⌋, 2^(⌊(bits−1)/power⌋ + 1))
    let bits = value.bits();
    if u64::from(power) >= bits {
        // 2^power alone has more bits than value: only 1 can be its root
        return (*value == 1).then_some(Int::ONE);
    }
    // the shift is below the bit count, which a power-of-ten-sized Int can't push past u32
    let shift = u32::try_from((bits - 1) / u64::from(power)).ok()?;
    let mut low = Int::from(2u8).pow(shift);
    let mut high = &low + &low;
    while &high - &low > Int::ONE {
        let middle = half(&(&low + &high));
        if middle.pow(power) <= *value {
            low = middle;
        } else {
            high = middle;
        }
    }
    (low.pow(power) == *value).then_some(low)
}

/// The periodic rate equivalent to an effective annual rate, `(1 + annual)^(1/per_year) − 1`: the
/// monthly rate that compounds to the annual one with `per_year` 12. This converts effective
/// rates; it isn't the nominal `rate / per_year` that [`Money::compound`](crate::Money::compound)
/// and amortisation use, nor Excel's NOMINAL.
///
/// The root is irrational in general, so, as [`irr`] does, it is found to `digits` places (at most
/// 100), floored, by exact bisection on the grid of `digits`-place decimals:
/// `(1 + lower)^per_year ≤ 1 + annual < (1 + upper)^per_year`. When the root is rational, `exact`
/// holds it. `digits × per_year` may be at most 50,000.
///
/// ```
/// use ducat::finance::periodic_rate;
///
/// let monthly = periodic_rate("0.05", 12, 8)?;
/// assert_eq!((monthly.rate.to_string(), monthly.rate.upper_decimal()), ("0.00407412".into(), "0.00407413".into()));
/// assert_eq!(periodic_rate("0.21", 2, 10)?.exact.map(|rate| rate.to_string()), Some("1/10".into()));
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::InvalidPerYear`] for a `per_year` outside 1 to 50,000; [`Error::InvalidDigits`] for
/// more than 100 digits or `digits × per_year` over 50,000; [`Error::RateTooLow`] for an annual
/// rate at or below −1; [`Error::RateNearMinusOne`] when the periodic rate is within 10^−digits
/// of −1 (ask for more digits); and whatever reading `annual` fails with.
pub fn periodic_rate(
    annual: impl Factor,
    per_year: u32,
    digits: u16,
) -> Result<PeriodicRate, Error> {
    if !(1..=MAX_ROOT_SIZE).contains(&per_year) {
        return Err(Error::InvalidPerYear);
    }
    let unit = check_digits(digits)?;
    if u32::from(digits) * per_year > MAX_ROOT_SIZE {
        return Err(Error::InvalidDigits);
    }
    let growth = one_plus(&annual.to_ratio()?)?;

    // The largest G with (G / unit)^n ≤ growth, so the rate's grid point is G − unit. G = 0 always
    // qualifies; above, unit·(1 + annual/n) + 1 never does, since (1 + a/n)^n ≥ 1 + a (Bernoulli).
    let target = growth.numer() * &unit.pow(per_year);
    let fits = |grid: &Int| grid.pow(per_year) * growth.denom() <= target;
    let (mut low, mut high) = if growth.numer() >= growth.denom() {
        let excess = (growth.numer() - growth.denom()) * &unit;
        let step = excess.div_rem(&(growth.denom() * &Int::from(per_year))).0;
        (unit.clone(), &unit + &step + Int::ONE)
    } else {
        (Int::ZERO, unit.clone())
    };
    while &high - &low > Int::ONE {
        let middle = half(&(&low + &high));
        if fits(&middle) {
            low = middle;
        } else {
            high = middle;
        }
    }
    if low.is_zero() {
        return Err(Error::RateNearMinusOne);
    }
    let rate = GridRate {
        grid: low - &unit,
        digits,
    };
    let roots = if per_year == 1 {
        Some((growth.numer().clone(), growth.denom().clone()))
    } else {
        exact_root(growth.numer(), per_year).zip(exact_root(growth.denom(), per_year))
    };
    // the roots of coprime integers are coprime, so this is reduced
    let exact = roots.map(|(num, den)| Ratio::from_reduced(num - &den, den));
    Ok(PeriodicRate { rate, exact })
}

/// The effective annual rate a periodic rate compounds to, `(1 + periodic)^per_year − 1`, exactly,
/// as a reduced [`Ratio`]. It inverts [`periodic_rate`]. It isn't Excel's EFFECT, which takes a
/// nominal rate.
///
/// ```
/// use ducat::finance::annual_rate;
///
/// assert_eq!(annual_rate("0.1", 2)?.to_string(), "21/100");
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::InvalidPerYear`] for a `per_year` outside 1 to
/// [`MAX_PERIODS`](super::MAX_PERIODS); [`Error::RateTooLow`] for a periodic rate at or below −1;
/// and whatever reading `periodic` fails with.
pub fn annual_rate(periodic: impl Factor, per_year: u32) -> Result<Ratio, Error> {
    if !(1..=MAX_PERIODS).contains(&per_year) {
        return Err(Error::InvalidPerYear);
    }
    let growth = one_plus(&periodic.to_ratio()?)?;
    // a power of a reduced ratio is reduced, and so is one minus it, so no gcd is needed
    let denominator = growth.denom().pow(per_year);
    Ok(Ratio::from_reduced(
        growth.numer().pow(per_year) - &denominator,
        denominator,
    ))
}
