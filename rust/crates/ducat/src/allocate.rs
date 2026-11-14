//! Splitting an amount into parts that always sum to it: allocation by weights, equal splits,
//! instalments, payment schedules and chunks.
//!
//! Every function here is exact: the parts sum to the whole, and nothing is rounded with a
//! rounding mode. A negative amount is split as the mirror image of the positive one. The parts
//! are in the amount's currency and scale (or the larger scale, where two amounts meet).
//!
//! ```
//! use ducat::Money;
//! use ducat::allocate::Remainder;
//! use ducat::iso::Eur;
//!
//! let bill: Money<Eur> = "100.00".parse()?;
//! let parts = bill.allocate([1, 1, 1], Remainder::Largest)?;
//! assert_eq!(parts.iter().map(Money::to_decimal).collect::<Vec<_>>(), ["33.34", "33.33", "33.33"]);
//! # Ok::<(), ducat::Error>(())
//! ```

use alloc::vec::Vec;
use core::cmp::Ordering;
use core::fmt;
use core::str::FromStr;

use crate::amount::{Amount, check_scale};
use crate::decimal::parse_decimal;
use crate::rounding::Rounding;
use crate::wide::{POW10, U256};
use crate::{AnyMoney, Currency, Error, Money};

/// Where the units left over after every part gets the floor of its exact share go.
///
/// There are always fewer of them than parts with a non-zero weight.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Remainder {
    /// To the parts with the largest fractional remainders, ties to the earlier part (Hamilton's
    /// largest-remainder method). Every part is then less than one unit from its exact share,
    /// and the split is the closest to the exact shares there is.
    Largest,
    /// One unit each to the first parts with a non-zero weight.
    First,
    /// One unit each to the last parts with a non-zero weight.
    Last,
    /// All of them to the first part with a non-zero weight.
    ToFirst,
    /// All of them to the last part with a non-zero weight.
    ToLast,
}

impl Remainder {
    /// The name ducat's spec uses: `"largest"`, `"first"`, `"last"`, `"toFirst"`, `"toLast"`.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Largest => "largest",
            Self::First => "first",
            Self::Last => "last",
            Self::ToFirst => "toFirst",
            Self::ToLast => "toLast",
        }
    }
}

impl fmt::Display for Remainder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl FromStr for Remainder {
    type Err = Error;

    /// Parses a name from [`Remainder::name`]; anything else is [`Error::Syntax`].
    fn from_str(name: &str) -> Result<Self, Error> {
        [
            Self::Largest,
            Self::First,
            Self::Last,
            Self::ToFirst,
            Self::ToLast,
        ]
        .into_iter()
        .find(|mode| mode.name() == name)
        .ok_or(Error::Syntax)
    }
}

/// Where an instalment plan's remainder goes: [`Remainder`] without `Largest`, which has no
/// meaning for equal instalments.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum InstalmentRemainder {
    /// One unit (or one `unit`) each to the first instalments, and any rest to the first.
    First,
    /// One unit (or one `unit`) each to the last instalments, and any rest to the last.
    Last,
    /// All of it to the first instalment.
    ToFirst,
    /// All of it to the last instalment.
    ToLast,
}

impl From<InstalmentRemainder> for Remainder {
    fn from(remainder: InstalmentRemainder) -> Self {
        match remainder {
            InstalmentRemainder::First => Self::First,
            InstalmentRemainder::Last => Self::Last,
            InstalmentRemainder::ToFirst => Self::ToFirst,
            InstalmentRemainder::ToLast => Self::ToLast,
        }
    }
}

/// A non-negative allocation weight, read exactly: an integer, or a decimal string such as
/// `"33.3"`. Multiplying every weight by the same positive number changes nothing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Weight {
    digits: u128,
    scale: u16,
}

impl Weight {
    /// The weight `digits × 10^−scale`.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidScale`] for a scale beyond [`MAX_SCALE`](crate::MAX_SCALE).
    pub const fn new(digits: u128, scale: u16) -> Result<Self, Error> {
        match check_scale(scale) {
            Ok(scale) => Ok(Self { digits, scale }),
            Err(error) => Err(error),
        }
    }
}

impl FromStr for Weight {
    type Err = Error;

    /// A decimal string in ducat's grammar.
    ///
    /// # Errors
    ///
    /// [`Error::Syntax`] outside the grammar; [`Error::NegativeWeight`] for a negative weight;
    /// [`Error::ExponentOutOfRange`] and [`Error::Overflow`] as for amounts.
    fn from_str(text: &str) -> Result<Self, Error> {
        let decimal = parse_decimal(text)?;
        let digits = u128::try_from(decimal.digits).map_err(|_| Error::NegativeWeight)?;
        Ok(Self {
            digits,
            scale: decimal.scale,
        })
    }
}

/// Anything that can be read as a [`Weight`]: the integer types, decimal strings, and `Weight`
/// itself (and references to them).
pub trait IntoWeight {
    /// The value as a weight.
    ///
    /// # Errors
    ///
    /// [`Error::NegativeWeight`] for a negative value; for a string, as [`Weight::from_str`].
    fn into_weight(self) -> Result<Weight, Error>;
}

impl IntoWeight for Weight {
    fn into_weight(self) -> Result<Weight, Error> {
        Ok(self)
    }
}

impl IntoWeight for &str {
    fn into_weight(self) -> Result<Weight, Error> {
        self.parse()
    }
}

impl<T: IntoWeight + Copy> IntoWeight for &T {
    fn into_weight(self) -> Result<Weight, Error> {
        (*self).into_weight()
    }
}

macro_rules! integer_weight {
    ($($integer:ty),*) => {$(
        impl IntoWeight for $integer {
            fn into_weight(self) -> Result<Weight, Error> {
                let digits = u128::try_from(self).map_err(|_| Error::NegativeWeight)?;
                Ok(Weight { digits, scale: 0 })
            }
        }
    )*};
}
integer_weight!(
    u8, u16, u32, u64, u128, usize, i8, i16, i32, i64, i128, isize
);

/// The weights as integers at their largest scale.
fn scaled_weights(
    weights: impl IntoIterator<Item = impl IntoWeight>,
) -> Result<(Vec<u128>, u16), Error> {
    let weights: Vec<Weight> = weights
        .into_iter()
        .map(IntoWeight::into_weight)
        .collect::<Result<_, _>>()?;
    let scale = weights.iter().map(|weight| weight.scale).max().unwrap_or(0);
    let scaled = weights
        .iter()
        .map(|weight| scale_up_u128(weight.digits, u32::from(scale - weight.scale)))
        .collect::<Result<_, _>>()?;
    Ok((scaled, scale))
}

/// `count` copies of `value`, or [`Error::Overflow`] when that many can't be held.
fn repeated(value: u128, count: usize) -> Result<Vec<u128>, Error> {
    let mut out = Vec::new();
    out.try_reserve_exact(count).map_err(|_| Error::Overflow)?;
    out.resize(count, value);
    Ok(out)
}

fn scale_up_u128(value: u128, exponent: u32) -> Result<u128, Error> {
    if value == 0 {
        return Ok(0);
    }
    let power = POW10.get(exponent as usize).ok_or(Error::Overflow)?;
    value.checked_mul(*power).ok_or(Error::Overflow)
}

/// Gives each bucket `extra` more, by `mode`, among the buckets with a non-zero weight.
fn distribute(
    shares: &mut [u128],
    extra: u128,
    weights: &[u128],
    fractions: &[u128],
    mode: Remainder,
) {
    if extra == 0 {
        return;
    }
    let mut eligible: Vec<usize> = (0..shares.len())
        .filter(|&index| weights[index] > 0)
        .collect();
    // `extra` is below the number of eligible buckets for every strategy that spreads units
    let spread = usize::try_from(extra)
        .unwrap_or(usize::MAX)
        .min(eligible.len());
    match mode {
        Remainder::ToFirst => shares[eligible[0]] += extra,
        Remainder::ToLast => shares[eligible[eligible.len() - 1]] += extra,
        Remainder::First => eligible
            .iter()
            .take(spread)
            .for_each(|&index| shares[index] += 1),
        Remainder::Last => eligible
            .iter()
            .rev()
            .take(spread)
            .for_each(|&index| shares[index] += 1),
        Remainder::Largest => {
            // largest remainder first; the sort is stable, so equal remainders keep bucket order
            eligible.sort_by(|&left, &right| fractions[right].cmp(&fractions[left]));
            eligible
                .iter()
                .take(spread)
                .for_each(|&index| shares[index] += 1);
        }
    }
}

/// `magnitude` split by `weights` (already scaled to integers), in units.
fn allocate_magnitude(
    magnitude: u128,
    weights: &[u128],
    mode: Remainder,
) -> Result<Vec<u128>, Error> {
    if weights.is_empty() {
        return Err(Error::NoWeights);
    }
    let total = weights
        .iter()
        .try_fold(0u128, |sum, &weight| sum.checked_add(weight))
        .ok_or(Error::Overflow)?;
    if total == 0 {
        return Err(Error::ZeroWeights);
    }
    let divisor = U256::from_u128(total);
    let mut shares = Vec::with_capacity(weights.len());
    let mut fractions = Vec::with_capacity(weights.len());
    let mut assigned = 0u128;
    for &weight in weights {
        let (quotient, remainder) = U256::mul(magnitude, weight).div_rem(divisor);
        // quotient ≤ magnitude and remainder < total, so both fit
        let share = quotient.to_u128().ok_or(Error::Overflow)?;
        shares.push(share);
        fractions.push(remainder.to_u128().ok_or(Error::Overflow)?);
        assigned += share;
    }
    distribute(&mut shares, magnitude - assigned, weights, &fractions, mode);
    Ok(shares)
}

/// Applies the amount's sign to the magnitudes.
fn signed(negative: bool, magnitudes: Vec<u128>, scale: u16) -> Result<Vec<Amount>, Error> {
    magnitudes
        .into_iter()
        .map(|magnitude| {
            let units = if negative {
                0i128.checked_sub_unsigned(magnitude)
            } else {
                i128::try_from(magnitude).ok()
            };
            Ok(Amount {
                units: units.ok_or(Error::Overflow)?,
                scale,
            })
        })
        .collect()
}

impl Amount {
    pub(crate) fn allocate(self, weights: &[u128], mode: Remainder) -> Result<Vec<Self>, Error> {
        let shares = allocate_magnitude(self.units.unsigned_abs(), weights, mode)?;
        signed(self.units < 0, shares, self.scale)
    }

    pub(crate) fn instalments(
        self,
        count: usize,
        unit: Option<Self>,
        mode: InstalmentRemainder,
    ) -> Result<Vec<Self>, Error> {
        if count == 0 {
            return Err(Error::NoWeights);
        }
        let Some(unit) = unit else {
            return self.allocate(&repeated(1, count)?, mode.into());
        };
        if unit.units <= 0 {
            return Err(Error::NotPositive);
        }
        let scale = self.scale.max(unit.scale);
        let total = self.rescale(scale, Rounding::Unnecessary)?;
        let step = unit
            .rescale(scale, Rounding::Unnecessary)?
            .units
            .unsigned_abs();
        let magnitude = total.units.unsigned_abs();
        let count_u128 = count as u128;
        // regular instalments are the largest multiple of the unit that fits `count` times
        let per = match step.checked_mul(count_u128) {
            Some(block) => magnitude / block * step,
            None => 0,
        };
        let mut parts = repeated(per, count)?;
        let mut left = magnitude - per * count_u128;
        // spread whole units first (for First and Last), then the sub-unit leftover
        if matches!(mode, InstalmentRemainder::First | InstalmentRemainder::Last) {
            let mut index = 0;
            while left >= step {
                let at = if mode == InstalmentRemainder::First {
                    index
                } else {
                    count - 1 - index
                };
                parts[at] += step;
                left -= step;
                index += 1;
            }
        }
        let last = if matches!(
            mode,
            InstalmentRemainder::ToLast | InstalmentRemainder::Last
        ) {
            count - 1
        } else {
            0
        };
        parts[last] += left;
        signed(total.units < 0, parts, scale)
    }

    pub(crate) fn chunk(self, max: Self) -> Result<Vec<Self>, Error> {
        if max.units <= 0 {
            return Err(Error::NotPositive);
        }
        if self.units < 0 {
            return Err(Error::NegativeTotal);
        }
        let scale = self.scale.max(max.scale);
        let total = self.rescale(scale, Rounding::Unnecessary)?.units;
        let step = max.rescale(scale, Rounding::Unnecessary)?.units;
        // every chunk but the last is `max`; the last is what's left, and positive
        let full = (total - 1).max(0) / step;
        let last = total - full * step;
        let count = usize::try_from(full)
            .map_err(|_| Error::Overflow)?
            .checked_add(1)
            .ok_or(Error::Overflow)?;
        if full == 0 {
            // nothing was taken off, so the one chunk is the total itself, at its own scale
            return Ok(alloc::vec![self]);
        }
        let mut out = Vec::new();
        out.try_reserve_exact(count).map_err(|_| Error::Overflow)?;
        // the full chunks keep `max`'s own scale, as ducat returns `max` itself
        out.extend(core::iter::repeat_n(max, count - 1));
        out.push(Self { units: last, scale });
        Ok(out)
    }
}

/// One tranche of a [schedule](Money::schedule): a fixed amount, a percentage of the total
/// (optionally capped), or the rest. `M` is [`Money<C>`] or [`AnyMoney`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tranche<M> {
    kind: TrancheKind<M>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TrancheKind<M> {
    Amount(M),
    Percent { percent: Weight, cap: Option<M> },
    Rest,
}

impl<M> Tranche<M> {
    /// A fixed amount.
    pub const fn amount(amount: M) -> Self {
        Self {
            kind: TrancheKind::Amount(amount),
        }
    }

    /// A percentage of the total, such as `30` or `"31.9"`.
    ///
    /// # Errors
    ///
    /// As [`IntoWeight::into_weight`].
    pub fn percent(percent: impl IntoWeight) -> Result<Self, Error> {
        Ok(Self {
            kind: TrancheKind::Percent {
                percent: percent.into_weight()?,
                cap: None,
            },
        })
    }

    /// A percentage of the total, but at most `cap`.
    ///
    /// # Errors
    ///
    /// As [`IntoWeight::into_weight`].
    pub fn percent_capped(percent: impl IntoWeight, cap: M) -> Result<Self, Error> {
        Ok(Self {
            kind: TrancheKind::Percent {
                percent: percent.into_weight()?,
                cap: Some(cap),
            },
        })
    }

    /// Whatever the other tranches leave.
    pub const fn rest() -> Self {
        Self {
            kind: TrancheKind::Rest,
        }
    }
}

/// The schedule on amounts; `same` checks each tranche's currency against the total's.
fn schedule_amounts<M: Copy>(
    total: Amount,
    tranches: &[Tranche<M>],
    amount_of: impl Fn(M) -> Result<Amount, Error>,
) -> Result<Vec<Amount>, Error> {
    let mut rest = None;
    let mut percent_at = Vec::new();
    let mut percents = Vec::new();
    for (index, tranche) in tranches.iter().enumerate() {
        match tranche.kind {
            TrancheKind::Percent { percent, .. } => {
                percent_at.push(index);
                percents.push(percent);
            }
            TrancheKind::Rest if rest.is_some() => return Err(Error::InvalidSchedule),
            TrancheKind::Rest => rest = Some(index),
            TrancheKind::Amount(_) => {}
        }
    }
    let mut out: Vec<Option<Amount>> = alloc::vec![None; tranches.len()];
    let mut left = total;
    if !percents.is_empty() {
        let (mut weights, scale) = scaled_weights(percents)?;
        let sum = weights
            .iter()
            .try_fold(0u128, |sum, &weight| sum.checked_add(weight))
            .ok_or(Error::Overflow)?;
        let hundred = scale_up_u128(100, u32::from(scale))?;
        if sum > hundred {
            return Err(Error::InvalidSchedule);
        }
        weights.push(hundred - sum);
        let parts = total.allocate(&weights, Remainder::Largest)?;
        for (&index, &part) in percent_at.iter().zip(&parts) {
            let TrancheKind::Percent { cap, .. } = tranches[index].kind else {
                unreachable!()
            };
            let mut part = part;
            if let Some(cap) = cap {
                let cap = amount_of(cap)?;
                if part.cmp_value(cap) == Ordering::Greater {
                    part = cap;
                }
            }
            out[index] = Some(part);
            left = left.checked_sub(part)?;
        }
    }
    for (index, tranche) in tranches.iter().enumerate() {
        if let TrancheKind::Amount(amount) = tranche.kind {
            let amount = amount_of(amount)?;
            out[index] = Some(amount);
            left = left.checked_sub(amount)?;
        }
    }
    if left.units < 0 {
        return Err(Error::InvalidSchedule);
    }
    match rest {
        Some(index) => out[index] = Some(left),
        None if left.units != 0 => return Err(Error::InvalidSchedule),
        None => {}
    }
    Ok(out.into_iter().map(|part| part.unwrap_or(left)).collect())
}

impl<C: Currency> Money<C> {
    fn wrap(parts: Vec<Amount>) -> Vec<Self> {
        parts.into_iter().map(Self::from_amount).collect()
    }

    /// Splits into one part per weight, in order, proportional to the weights. A zero weight
    /// gets zero.
    ///
    /// ```
    /// use ducat::Money;
    /// use ducat::allocate::Remainder;
    /// use ducat::iso::Eur;
    ///
    /// let tip: Money<Eur> = "0.05".parse()?;
    /// let parts = tip.allocate(["70", "30"], Remainder::Largest)?;
    /// assert_eq!(parts[0].to_decimal(), "0.04");
    /// // the Alabama paradox: 3 cents by 1, 3, 3 is 1 each, but 4 cents is 0, 2, 2
    /// let four = Money::<Eur>::from_minor(4).allocate([1, 3, 3], Remainder::Largest)?;
    /// assert_eq!(four.iter().map(Money::units).collect::<Vec<_>>(), [0, 2, 2]);
    /// # Ok::<(), ducat::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::NoWeights`]; [`Error::ZeroWeights`] when every weight is zero;
    /// [`Error::NegativeWeight`]; and whatever reading a weight fails with.
    pub fn allocate(
        self,
        weights: impl IntoIterator<Item = impl IntoWeight>,
        remainder: Remainder,
    ) -> Result<Vec<Self>, Error> {
        let (weights, _) = scaled_weights(weights)?;
        Ok(Self::wrap(self.amount.allocate(&weights, remainder)?))
    }

    /// Splits into `count` parts that differ by at most one unit.
    ///
    /// # Errors
    ///
    /// [`Error::NoWeights`] for a count of zero.
    pub fn split(self, count: usize, remainder: Remainder) -> Result<Vec<Self>, Error> {
        Ok(Self::wrap(
            self.amount.allocate(&repeated(1, count)?, remainder)?,
        ))
    }

    /// `count` instalments, all the same regular amount except where the remainder goes. With a
    /// `unit`, every regular instalment is a whole multiple of it, and the parts have the larger
    /// of the two scales.
    ///
    /// ```
    /// use ducat::Money;
    /// use ducat::allocate::InstalmentRemainder;
    /// use ducat::iso::Eur;
    ///
    /// let total: Money<Eur> = "100.00".parse()?;
    /// let euro: Money<Eur> = "1".parse()?;
    /// let plan = total.instalments(3, Some(euro), InstalmentRemainder::ToFirst)?;
    /// assert_eq!(plan.iter().map(Money::to_decimal).collect::<Vec<_>>(), ["34.00", "33.00", "33.00"]);
    /// # Ok::<(), ducat::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::NoWeights`] for a count of zero; [`Error::NotPositive`] for a unit that isn't
    /// positive; [`Error::Overflow`].
    pub fn instalments(
        self,
        count: usize,
        unit: Option<Self>,
        remainder: InstalmentRemainder,
    ) -> Result<Vec<Self>, Error> {
        Ok(Self::wrap(self.amount.instalments(
            count,
            unit.map(|unit| unit.amount),
            remainder,
        )?))
    }

    /// One part per tranche, in order. Percentages are split together by largest remainder, so
    /// no rounding mode is needed; a capped percentage is at most its cap.
    ///
    /// ```
    /// use ducat::Money;
    /// use ducat::allocate::Tranche;
    /// use ducat::iso::Eur;
    ///
    /// let total: Money<Eur> = "1000".parse()?;
    /// let parts = total.schedule(&[Tranche::percent(30)?, Tranche::amount("200".parse()?), Tranche::rest()])?;
    /// assert_eq!(parts.iter().map(Money::to_decimal).collect::<Vec<_>>(), ["300.00", "200.00", "500.00"]);
    /// # Ok::<(), ducat::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::InvalidSchedule`] for more than one rest tranche, percentages over 100, tranches
    /// that exceed the total, or a leftover without a rest tranche.
    pub fn schedule(self, tranches: &[Tranche<Self>]) -> Result<Vec<Self>, Error> {
        Ok(Self::wrap(schedule_amounts(
            self.amount,
            tranches,
            |money: Self| Ok(money.amount),
        )?))
    }

    /// Tranches of at most `max`: every one but the last is exactly `max`, and the last is
    /// positive. A zero total gives one zero tranche.
    ///
    /// # Errors
    ///
    /// [`Error::NotPositive`] when `max` isn't positive; [`Error::NegativeTotal`] when `self` is
    /// negative; [`Error::Overflow`] when there are too many tranches to hold.
    pub fn chunk(self, max: Self) -> Result<Vec<Self>, Error> {
        Ok(Self::wrap(self.amount.chunk(max.amount)?))
    }
}

impl AnyMoney {
    fn wrap(self, parts: Vec<Amount>) -> Vec<Self> {
        parts
            .into_iter()
            .map(|amount| Self::from_parts(amount, self.currency()))
            .collect()
    }

    /// As [`Money::allocate`].
    ///
    /// # Errors
    ///
    /// As [`Money::allocate`].
    pub fn allocate(
        self,
        weights: impl IntoIterator<Item = impl IntoWeight>,
        remainder: Remainder,
    ) -> Result<Vec<Self>, Error> {
        let (weights, _) = scaled_weights(weights)?;
        Ok(self.wrap(self.amount.allocate(&weights, remainder)?))
    }

    /// As [`Money::split`].
    ///
    /// # Errors
    ///
    /// As [`Money::split`].
    pub fn split(self, count: usize, remainder: Remainder) -> Result<Vec<Self>, Error> {
        Ok(self.wrap(self.amount.allocate(&repeated(1, count)?, remainder)?))
    }

    /// As [`Money::instalments`].
    ///
    /// # Errors
    ///
    /// As [`Money::instalments`], and [`Error::CurrencyMismatch`] for a unit in another currency.
    pub fn instalments(
        self,
        count: usize,
        unit: Option<Self>,
        remainder: InstalmentRemainder,
    ) -> Result<Vec<Self>, Error> {
        let unit = unit.map(|unit| self.amount_in(unit)).transpose()?;
        Ok(self.wrap(self.amount.instalments(count, unit, remainder)?))
    }

    /// As [`Money::schedule`].
    ///
    /// # Errors
    ///
    /// As [`Money::schedule`], and [`Error::CurrencyMismatch`] for a tranche amount or cap in
    /// another currency.
    pub fn schedule(self, tranches: &[Tranche<Self>]) -> Result<Vec<Self>, Error> {
        Ok(self.wrap(schedule_amounts(self.amount, tranches, |money| {
            self.amount_in(money)
        })?))
    }

    /// As [`Money::chunk`].
    ///
    /// # Errors
    ///
    /// As [`Money::chunk`], and [`Error::CurrencyMismatch`] for a `max` in another currency.
    pub fn chunk(self, max: Self) -> Result<Vec<Self>, Error> {
        let max = self.amount_in(max)?;
        Ok(self.wrap(self.amount.chunk(max)?))
    }
}
