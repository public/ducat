//! Excel's FV, PV, PMT, NPER and RATE.

use alloc::vec::Vec;

use num_bigint::BigInt;
use num_traits::{One, Signed, ToPrimitive, Zero};

use super::big::{bit_length, exact_root, floor_div, ln_interval, power, sign};
use crate::finance::rates::{GridRate, bisect_rate, check_digits, sign_changes};
use crate::finance::{MAX_PERIODS, MoneyKind, money_like, round_quotient};
use crate::{Error, Factor, Int, Ratio, Rounding};

/// The most bits `(1 + rate)^nper` may have in [`fv`], [`pv`] and [`pmt`].
const MAX_POWER_BITS: u64 = 1 << 20;
/// The most bits `(1 + rate)^nper` may have in [`fv_exact`], [`pv_exact`] and [`pmt_exact`], whose
/// exact amounts are reduced fractions.
const MAX_EXACT_POWER_BITS: u64 = 1 << 16;
/// The most bits `(1 + rate)^nper` may have at any rate [`rate`] tries.
const MAX_RATE_POWER_BITS: u64 = 1 << 19;
/// The most bits [`nper`] bounds its logarithms to before it gives up.
const MAX_LOG_BITS: u64 = 1 << 14;

/// When payments fall in each period, Excel's `type`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum PaymentTiming {
    /// At the end of each period: Excel's `type` 0, the default.
    #[default]
    End,
    /// At the start of each period: Excel's `type` 1.
    Start,
}

impl PaymentTiming {
    /// Excel's `type` for this timing: 0 or 1.
    #[must_use]
    pub const fn excel_type(self) -> u8 {
        match self {
            Self::End => 0,
            Self::Start => 1,
        }
    }
}

/// The checked parts every annuity function shares: the rate as `a/b` (reduced), the timing, and
/// the amounts as integers at one scale (0 for an amount not given).
struct Annuity {
    a: BigInt,
    b: BigInt,
    start: bool,
    scale: u16,
    units: Vec<BigInt>,
}

impl Annuity {
    fn new<M: MoneyKind>(
        rate: &Ratio,
        timing: PaymentTiming,
        amounts: &[Option<&M>],
    ) -> Result<Self, Error> {
        let a = rate.numer().to_big();
        let b = rate.denom().to_big();
        if !(&a + &b).is_positive() {
            return Err(Error::RateTooLow);
        }
        let given: Vec<M> = amounts
            .iter()
            .flatten()
            .map(|&money| money.clone())
            .collect();
        let (given_units, scale) = crate::finance::rates::flow_units(&given)?;
        let mut given_units = given_units.into_iter();
        let units = amounts
            .iter()
            .map(|amount| match amount {
                Some(_) => given_units
                    .next()
                    .map_or_else(BigInt::zero, |units| units.to_big()),
                None => BigInt::zero(),
            })
            .collect();
        Ok(Self {
            a,
            b,
            start: timing == PaymentTiming::Start,
            scale,
            units,
        })
    }

    /// `b + a·type`: the payment's timing factor, times `b`.
    fn paid(&self) -> BigInt {
        if self.start {
            &self.b + &self.a
        } else {
            self.b.clone()
        }
    }

    /// The amount `numerator / denominator` in units at `scale`, negated (Excel's sign
    /// convention), as major units over a positive denominator.
    fn result(&self, numerator: BigInt, denominator: BigInt) -> (Int, Int) {
        let scaled = Int::from_big(denominator).mul_pow10(u32::from(self.scale));
        let numerator = Int::from_big(numerator);
        if scaled.is_negative() {
            (numerator, -scaled)
        } else {
            (-numerator, scaled)
        }
    }
}

/// A whole number of periods from `minimum` to [`MAX_PERIODS`]: Excel takes fractions, whose
/// powers are irrational.
fn whole_periods(periods: u32, minimum: u32) -> Result<u64, Error> {
    if (minimum..=MAX_PERIODS).contains(&periods) {
        Ok(u64::from(periods))
    } else {
        Err(Error::InvalidPeriods)
    }
}

/// An error when `base^count` would have more than `limit` bits.
fn check_power_size(base: &BigInt, count: u64, limit: u64) -> Result<(), Error> {
    if bit_length(base).saturating_mul(count) > limit {
        Err(Error::PowerTooLarge)
    } else {
        Ok(())
    }
}

/// `max(a + b, b)`, whose power bounds the integers.
fn larger_end(a: &BigInt, b: &BigInt) -> BigInt {
    let growth = a + b;
    if growth > *b { growth } else { b.clone() }
}

/// Which annuity value to compute.
#[derive(Clone, Copy)]
enum Value {
    Future,
    Present,
    Payment,
}

/// The exact value of FV, PV or PMT, as a numerator and a positive denominator of major units.
fn annuity_value<M: MoneyKind>(
    value: Value,
    rate: &Ratio,
    periods: u32,
    first: &M,
    second: Option<&M>,
    timing: PaymentTiming,
    limit: u64,
) -> Result<(Int, Int), Error> {
    let minimum = if matches!(value, Value::Payment) {
        1
    } else {
        0
    };
    let count = whole_periods(periods, minimum)?;
    let parts = Annuity::new(rate, timing, &[Some(first), second])?;
    let (one, other) = (&parts.units[0], &parts.units[1]);
    let (a, b) = (&parts.a, &parts.b);
    check_power_size(&larger_end(a, b), count, limit)?;
    let count_big = BigInt::from(count);
    if a.is_zero() {
        let (numerator, denominator) = match value {
            // −(pv + pmt·n) and −(fv + pmt·n)
            Value::Future | Value::Present => (other + one * &count_big, BigInt::one()),
            // −(pv + fv)/n
            Value::Payment => (one + other, count_big),
        };
        return Ok(parts.result(numerator, denominator));
    }
    // with Q = (a + b)^n and B = b^n
    let growth = power(&(a + b), count);
    let base = power(b, count);
    let (numerator, denominator) = match value {
        // pv·Q/B + pmt·(b + a·type)/b · (Q − B)/B · b/a = (pv·Q·a + pmt·(b + a·type)·(Q − B)) / (B·a)
        Value::Future => (
            other * &growth * a + one * parts.paid() * (&growth - &base),
            &base * a,
        ),
        // (fv·B·a + pmt·(b + a·type)·(Q − B)) / (B·a), divided by Q/B
        Value::Present => (
            other * &base * a + one * parts.paid() * (&growth - &base),
            &growth * a,
        ),
        // (pv·Q + fv·B)·a / ((b + a·type)·(Q − B))
        Value::Payment => (
            (one * &growth + other * &base) * a,
            parts.paid() * (&growth - &base),
        ),
    };
    Ok(parts.result(numerator, denominator))
}

fn rounded<M: MoneyKind>(
    template: &M,
    (numerator, denominator): (Int, Int),
    rounding: Rounding,
) -> Result<M, Error> {
    let exponent = u16::from(template.parts().2.exponent());
    Ok(money_like(
        template,
        round_quotient(&numerator, &denominator, exponent, rounding)?,
    ))
}

fn exact<M: MoneyKind>(
    template: &M,
    (numerator, denominator): (Int, Int),
) -> Result<M::Exact, Error> {
    Ok(template.exact_in(Ratio::new(numerator, denominator)?))
}

/// Excel's FV: the future value of `pmt` paid every period for `nper` periods at `rate` per
/// period, on top of a present value `pv`, with Excel's sign convention (money paid out is
/// negative, so deposits give a positive future value):
/// `−(pv·(1 + rate)^nper + pmt·(1 + rate·type)·((1 + rate)^nper − 1)/rate)`, and at a rate of 0,
/// `−(pv + pmt·nper)`, rounded once to the currency's exponent.
///
/// Unlike Excel, `nper` is a whole number (a fractional power is irrational), and a rate at or
/// below −1 is an error.
///
/// ```
/// use ducat::{Money, Rounding};
/// use ducat::excel::{PaymentTiming, fv};
/// use ducat::iso::Usd;
///
/// let (payment, present): (Money<Usd>, Money<Usd>) = ("-200".parse()?, "-500".parse()?);
/// let value = fv("0.005", 10, &payment, Some(&present), PaymentTiming::Start, Rounding::HalfExpand)?;
/// assert_eq!(value.to_decimal(), "2581.40");
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::InvalidPeriods`] for more than [`MAX_PERIODS`] periods; [`Error::RateTooLow`];
/// [`Error::CurrencyMismatch`]; [`Error::PowerTooLarge`] when `(1 + rate)^nper` would pass 2^20
/// bits; [`Error::Rounding`] with [`Rounding::Unnecessary`]; and whatever reading `rate` fails
/// with.
pub fn fv<M: MoneyKind>(
    rate: impl Factor,
    nper: u32,
    pmt: &M,
    pv: Option<&M>,
    timing: PaymentTiming,
    rounding: Rounding,
) -> Result<M, Error> {
    let value = annuity_value(
        Value::Future,
        &rate.to_ratio()?,
        nper,
        pmt,
        pv,
        timing,
        MAX_POWER_BITS,
    )?;
    rounded(pmt, value, rounding)
}

/// Excel's FV, exactly (see [`fv`]).
///
/// # Errors
///
/// As [`fv`], with [`Error::PowerTooLarge`] past 2^16 bits, since the exact amount is a reduced
/// fraction.
pub fn fv_exact<M: MoneyKind>(
    rate: impl Factor,
    nper: u32,
    pmt: &M,
    pv: Option<&M>,
    timing: PaymentTiming,
) -> Result<M::Exact, Error> {
    let value = annuity_value(
        Value::Future,
        &rate.to_ratio()?,
        nper,
        pmt,
        pv,
        timing,
        MAX_EXACT_POWER_BITS,
    )?;
    exact(pmt, value)
}

/// Excel's PV: the present value of `pmt` paid every period for `nper` periods at `rate` per
/// period, plus a future value `fv`, with Excel's sign convention:
/// `−(fv + pmt·(1 + rate·type)·((1 + rate)^nper − 1)/rate) / (1 + rate)^nper`, and at a rate of 0,
/// `−(fv + pmt·nper)`, rounded once to the currency's exponent.
///
/// ```
/// use ducat::{Money, Rounding};
/// use ducat::excel::{PaymentTiming, pv};
/// use ducat::iso::Usd;
///
/// let payment: Money<Usd> = "500".parse()?;
/// let value = pv("0.08/12", 240, &payment, None, PaymentTiming::End, Rounding::HalfExpand)?;
/// assert_eq!(value.to_decimal(), "-59777.15");
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// As [`fv`].
pub fn pv<M: MoneyKind>(
    rate: impl Factor,
    nper: u32,
    pmt: &M,
    fv: Option<&M>,
    timing: PaymentTiming,
    rounding: Rounding,
) -> Result<M, Error> {
    let value = annuity_value(
        Value::Present,
        &rate.to_ratio()?,
        nper,
        pmt,
        fv,
        timing,
        MAX_POWER_BITS,
    )?;
    rounded(pmt, value, rounding)
}

/// Excel's PV, exactly (see [`pv`]).
///
/// # Errors
///
/// As [`fv_exact`].
pub fn pv_exact<M: MoneyKind>(
    rate: impl Factor,
    nper: u32,
    pmt: &M,
    fv: Option<&M>,
    timing: PaymentTiming,
) -> Result<M::Exact, Error> {
    let value = annuity_value(
        Value::Present,
        &rate.to_ratio()?,
        nper,
        pmt,
        fv,
        timing,
        MAX_EXACT_POWER_BITS,
    )?;
    exact(pmt, value)
}

/// Excel's PMT: the payment per period that pays off (or saves up to) the amounts over `nper`
/// periods at `rate` per period, with Excel's sign convention:
/// `−(pv·(1 + rate)^nper + fv)·rate / ((1 + rate·type)·((1 + rate)^nper − 1))`, and at a rate of 0,
/// `−(pv + fv)/nper`, rounded once to the currency's exponent. Paying the rounded payment every
/// period leaves a residual; [`Money::amortise`](crate::Money::amortise) builds a schedule that
/// settles it.
///
/// ```
/// use ducat::{Money, Rounding};
/// use ducat::excel::{PaymentTiming, pmt};
/// use ducat::iso::Usd;
///
/// let loan: Money<Usd> = "10000".parse()?;
/// let payment = pmt("0.08/12", 10, &loan, None, PaymentTiming::End, Rounding::HalfExpand)?;
/// assert_eq!(payment.to_decimal(), "-1037.03");
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// As [`fv`], and [`Error::InvalidPeriods`] for no periods.
pub fn pmt<M: MoneyKind>(
    rate: impl Factor,
    nper: u32,
    pv: &M,
    fv: Option<&M>,
    timing: PaymentTiming,
    rounding: Rounding,
) -> Result<M, Error> {
    let value = annuity_value(
        Value::Payment,
        &rate.to_ratio()?,
        nper,
        pv,
        fv,
        timing,
        MAX_POWER_BITS,
    )?;
    rounded(pv, value, rounding)
}

/// Excel's PMT, exactly (see [`pmt`]).
///
/// # Errors
///
/// As [`fv_exact`], and [`Error::InvalidPeriods`] for no periods.
pub fn pmt_exact<M: MoneyKind>(
    rate: impl Factor,
    nper: u32,
    pv: &M,
    fv: Option<&M>,
    timing: PaymentTiming,
) -> Result<M::Exact, Error> {
    let value = annuity_value(
        Value::Payment,
        &rate.to_ratio()?,
        nper,
        pv,
        fv,
        timing,
        MAX_EXACT_POWER_BITS,
    )?;
    exact(pv, value)
}

/// The result of [`nper`]: the number of periods to `digits` places, and the exact number when it
/// is rational.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Nper {
    /// The number of periods floored to `digits` places: it lies in `[lower, upper)`.
    pub periods: GridRate,
    /// The exact number of periods, when it is rational (always, at a rate of 0).
    pub exact: Option<Ratio>,
}

/// Whether `growth = base^exponent` exactly, for an exponent `p/q` in lowest terms: `base` must be
/// a perfect `q`th power.
fn is_power_of(growth: &Ratio, base: &Ratio, exponent: &Ratio) -> bool {
    let (growth_num, growth_den) = (growth.numer().to_big(), growth.denom().to_big());
    if exponent.is_zero() {
        return growth_num == growth_den;
    }
    let order = exponent.denom().to_big();
    let (Some(root_num), Some(root_den)) = (
        exact_root(&base.numer().to_big(), &order),
        exact_root(&base.denom().to_big(), &order),
    ) else {
        return false;
    };
    let count = exponent.numer().to_big().abs();
    let (target_num, target_den) = if exponent.numer().is_negative() {
        (growth_den.clone(), growth_num.clone())
    } else {
        (growth_num.clone(), growth_den.clone())
    };
    // root^count has at least (bits(root) − 1)·count bits: when that is more than the target has,
    // they can't be equal, and the power is never computed
    let too_big = |root: &BigInt, target: &BigInt| {
        BigInt::from(bit_length(root).saturating_sub(1)) * &count > BigInt::from(bit_length(target))
    };
    if too_big(&root_num, &target_num) || too_big(&root_den, &target_den) {
        return false;
    }
    let raise = |root: &BigInt| {
        if root.is_one() {
            return Some(BigInt::one());
        }
        // not too big, so the count is at most the target's bit count
        count.to_u64().map(|count| power(root, count))
    };
    match (raise(&root_num), raise(&root_den)) {
        (Some(num), Some(den)) => num == target_num && den == target_den,
        _ => false,
    }
}

/// Excel's NPER: the number of periods in which `pmt` every period at `rate` per period settles
/// `pv` and `fv`: `ln((pmt·(1 + rate·type) − fv·rate) / (pmt·(1 + rate·type) + pv·rate)) /
/// ln(1 + rate)`, and at a rate of 0, `−(pv + fv)/pmt`. As in Excel, it can be fractional or
/// negative.
///
/// The logarithms are irrational in general, so the result is to `digits` decimal places (at most
/// 100), floored: the number of periods lies in `[lower, upper)`. Each logarithm is bounded by
/// rational intervals from its series, with the tail and every rounding bounded, and the bounds
/// are tightened until they fix the floored value; `exact` is set when the number of periods is
/// rational (at a rate of 0, or when the growth is a power of 1 + rate).
///
/// ```
/// use ducat::Money;
/// use ducat::excel::{PaymentTiming, nper};
/// use ducat::iso::Usd;
///
/// let (payment, present, future): (Money<Usd>, Money<Usd>, Money<Usd>) =
///     ("-100".parse()?, "-1000".parse()?, "10000".parse()?);
/// let periods = nper("0.01", &payment, &present, Some(&future), PaymentTiming::Start, 7)?;
/// assert_eq!(periods.periods.to_string(), "59.6738656");
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::InvalidDigits`] for more than 100 digits; [`Error::RateTooLow`];
/// [`Error::CurrencyMismatch`]; [`Error::NoPayment`] for no payment at a rate of 0, and
/// [`Error::NeverSettles`] where the logarithm's argument is at or below zero (Excel's #NUM!);
/// [`Error::PrecisionExhausted`] when the value is within about 2^−16000 of a grid point, or the
/// rate too close to 0 to bound `ln(1 + rate)`; and whatever reading `rate` fails with.
pub fn nper<M: MoneyKind>(
    rate: impl Factor,
    pmt: &M,
    pv: &M,
    fv: Option<&M>,
    timing: PaymentTiming,
    digits: u16,
) -> Result<Nper, Error> {
    let unit = check_digits(digits)?;
    let parts = Annuity::new(&rate.to_ratio()?, timing, &[Some(pmt), Some(pv), fv])?;
    let (payment, present, future) = (&parts.units[0], &parts.units[1], &parts.units[2]);
    let (a, b) = (&parts.a, &parts.b);
    let unit_big = unit.to_big();
    let result = |grid: BigInt, exact: Option<Ratio>| Nper {
        periods: GridRate::new(Int::from_big(grid), digits),
        exact,
    };
    if a.is_zero() {
        if payment.is_zero() {
            return Err(Error::NoPayment);
        }
        let exact = Ratio::new(
            Int::from_big(-(present + future)),
            Int::from_big(payment.clone()),
        )?;
        let grid = floor_div(
            &(exact.numer().to_big() * &unit_big),
            &exact.denom().to_big(),
        );
        return Ok(result(grid, Some(exact)));
    }
    // with r = a/b: (pmt·(b + a·type) − fv·a) / (pmt·(b + a·type) + pv·a), all over b
    let paid = payment * parts.paid();
    let growth_num = &paid - future * a;
    let growth_den = &paid + present * a;
    if growth_den.is_zero()
        || growth_num.is_zero()
        || growth_num.is_negative() != growth_den.is_negative()
    {
        return Err(Error::NeverSettles);
    }
    let growth = Ratio::new(Int::from_big(growth_num), Int::from_big(growth_den))?;
    let base = Ratio::new(Int::from_big(a + b), Int::from_big(b.clone()))?;
    let (growth_parts, base_parts) = (
        (growth.numer().to_big(), growth.denom().to_big()),
        (base.numer().to_big(), base.denom().to_big()),
    );

    // Bound ln(growth) / ln(base) by intervals, with more bits until the floor on the grid is fixed.
    let mut bits = 64 + 4 * u64::from(digits);
    while bits <= MAX_LOG_BITS {
        let (growth_low, growth_high) = ln_interval(&growth_parts.0, &growth_parts.1, bits);
        let (base_low, base_high) = ln_interval(&base_parts.0, &base_parts.1, bits);
        if !(base_low <= BigInt::zero() && base_high >= BigInt::zero()) {
            // the quotient's extremes are among the four ratios of the ends
            let grids = [
                (&growth_low, &base_low),
                (&growth_low, &base_high),
                (&growth_high, &base_low),
                (&growth_high, &base_high),
            ]
            .map(|(numerator, denominator)| floor_div(&(numerator * &unit_big), denominator));
            let low = grids.iter().min().cloned().unwrap_or_default();
            let high = grids.iter().max().cloned().unwrap_or_default();
            let candidate_of =
                |grid: &BigInt| Ratio::new(Int::from_big(grid.clone()), unit.clone());
            if low == high {
                // the floor is fixed; the value is exact if it is the grid point itself
                let candidate = candidate_of(&low)?;
                let exact = is_power_of(&growth, &base, &candidate).then_some(candidate);
                return Ok(result(low, exact));
            }
            if &high - &low == BigInt::one() {
                // the bounds straddle the grid point `high`: it is the answer if it is exact
                let candidate = candidate_of(&high)?;
                if is_power_of(&growth, &base, &candidate) {
                    return Ok(result(high, Some(candidate)));
                }
            }
        }
        bits *= 2;
    }
    Err(Error::PrecisionExhausted)
}

/// Excel's RATE: the rate per period at which `pmt` every period for `nper` periods settles `pv`
/// and `fv`. Dividing RATE's equation by `(1 + rate)^nper` makes it the NPV of the flows it implies
/// (`pv` at period 0, `pmt` at periods 1 to nper, or 0 to nper − 1 when paid at the start, and `fv`
/// at period nper), so this is [`irr`](super::irr) of those flows, with its guarantees: floored to
/// `digits` places (at most 100).
///
/// Unlike Excel, which iterates from `guess` until it is within 0.0000001: `nper` is a whole
/// number; flows with several sign changes (so several possible rates) are an error unless a
/// `bracket`, which replaces `guess`, selects one, where Excel returns whichever its iteration
/// finds; and no sign change is an error, where Excel returns #NUM!.
///
/// ```
/// use ducat::Money;
/// use ducat::excel::{PaymentTiming, rate};
/// use ducat::iso::Usd;
///
/// let (payment, loan): (Money<Usd>, Money<Usd>) = ("-200".parse()?, "8000".parse()?);
/// let monthly = rate(48, &payment, &loan, None, PaymentTiming::End, 8, None)?;
/// assert_eq!(monthly.to_string(), "0.00770147");
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// [`Error::InvalidPeriods`] for no periods or more than [`MAX_PERIODS`]; [`Error::InvalidDigits`];
/// [`Error::CurrencyMismatch`]; [`Error::NoSignChange`]; [`Error::SeveralSignChanges`] without a
/// bracket; [`Error::InvalidBracket`]; [`Error::PowerTooLarge`] when `(1 + rate)^nper` at a rate
/// tried would pass 2^19 bits; [`Error::RateNearMinusOne`]; [`Error::RateTooHigh`].
pub fn rate<M: MoneyKind>(
    nper: u32,
    pmt: &M,
    pv: &M,
    fv: Option<&M>,
    timing: PaymentTiming,
    digits: u16,
    bracket: Option<(&Ratio, &Ratio)>,
) -> Result<GridRate, Error> {
    let count = whole_periods(nper, 1)?;
    let unit = check_digits(digits)?;
    let parts = Annuity::new(&Ratio::ZERO, timing, &[Some(pmt), Some(pv), fv])?;
    let (payment, present, future) = (&parts.units[0], &parts.units[1], &parts.units[2]);
    // The flows RATE implies, for the sign rules: pv (+ pmt) at 0, pmt between, pmt (or 0) + fv at
    // nper. Their sign changes don't depend on nper beyond 2, so three stand for them all.
    let mut implied = if parts.start {
        [present + payment, payment.clone(), future.clone()].to_vec()
    } else {
        [present.clone(), payment.clone(), payment + future].to_vec()
    };
    if count == 1 {
        implied.remove(1);
    }
    let implied: Vec<Int> = implied.into_iter().map(Int::from_big).collect();
    let (changes, first_sign) = sign_changes(&implied);
    if changes == 0 {
        return Err(Error::NoSignChange);
    }
    if changes > 1 && bracket.is_none() {
        return Err(Error::SeveralSignChanges);
    }
    let count_big = BigInt::from(count);
    let start = BigInt::from(u8::from(parts.start));
    // The NPV of those flows is f / (1 + r)^n with f = pv·G + pmt·(1 + r·type)·(G − 1)/r + fv and
    // G = (1 + r)^n, so it has f's sign. For r = a/b, f·a·b^n is
    // H = pv·a·(a + b)^n + pmt·(b + a·type)·((a + b)^n − b^n) + fv·a·b^n, an integer by squaring,
    // so sign(f) = sign(H)·sign(a), and pv + pmt·n + fv at 0. The rate is taken as given, not
    // reduced, so the size check sees the grid's own integers.
    let sign_at_rate = |num: &BigInt, den: &BigInt| -> Result<i8, Error> {
        if num.is_zero() {
            return Ok(sign(&(present + payment * &count_big + future)));
        }
        // checked at every rate tried, since a candidate can be far larger than the answer
        check_power_size(&larger_end(num, den), count, MAX_RATE_POWER_BITS)?;
        let growth = power(&(num + den), count);
        let base = power(den, count);
        let scaled = present * num * &growth
            + payment * (den + num * &start) * (&growth - &base)
            + future * num * &base;
        Ok(sign(&scaled) * sign(num))
    };
    let unit_big = unit.to_big();
    let sign_at = |grid: &Int| sign_at_rate(&grid.to_big(), &unit_big);
    let sign_at_ratio = |rate: &Ratio| sign_at_rate(&rate.numer().to_big(), &rate.denom().to_big());
    let result = |grid: Int| {
        if grid <= -&unit {
            return Err(Error::RateNearMinusOne);
        }
        Ok(GridRate::new(grid, digits))
    };
    bisect_rate(sign_at, result, &unit, first_sign, bracket, sign_at_ratio)
}
