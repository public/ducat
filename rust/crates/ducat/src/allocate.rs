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

use alloc::string::String;
use alloc::vec::Vec;
use core::cmp::Ordering;
use core::fmt;
use core::str::FromStr;

use crate::amount::{Amount, check_scale};
use crate::decimal::parse_decimal;
use crate::rounding::Rounding;
use crate::{AnyMoney, Currency, Error, Int, Money};

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

/// A non-negative allocation weight, read exactly: an integer of any size, or a decimal string
/// such as `"33.3"`. Multiplying every weight by the same positive number changes nothing.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Weight {
    digits: Int,
    scale: u16,
}

impl Weight {
    /// The weight `digits × 10^−scale`.
    ///
    /// # Errors
    ///
    /// [`Error::NegativeWeight`] for negative digits; [`Error::InvalidScale`] for a scale beyond
    /// [`MAX_SCALE`](crate::MAX_SCALE).
    pub fn new(digits: impl Into<Int>, scale: u16) -> Result<Self, Error> {
        let digits = digits.into();
        if digits.is_negative() {
            return Err(Error::NegativeWeight);
        }
        Ok(Self {
            digits,
            scale: check_scale(scale)?,
        })
    }
}

impl FromStr for Weight {
    type Err = Error;

    /// A decimal string in ducat's grammar.
    ///
    /// # Errors
    ///
    /// [`Error::Syntax`] outside the grammar; [`Error::NegativeWeight`] for a negative weight;
    /// [`Error::ExponentOutOfRange`] as for amounts.
    fn from_str(text: &str) -> Result<Self, Error> {
        let decimal = parse_decimal(text)?;
        Self::new(decimal.digits, decimal.scale)
    }
}

/// Anything that can be read as a [`Weight`]: the integer types, [`Int`], decimal strings, and
/// `Weight` itself (and references to them).
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

impl IntoWeight for &Weight {
    fn into_weight(self) -> Result<Weight, Error> {
        Ok(self.clone())
    }
}

impl IntoWeight for &str {
    fn into_weight(self) -> Result<Weight, Error> {
        self.parse()
    }
}

impl IntoWeight for &String {
    fn into_weight(self) -> Result<Weight, Error> {
        self.parse()
    }
}

macro_rules! integer_weight {
    ($($integer:ty),*) => {$(
        impl IntoWeight for $integer {
            fn into_weight(self) -> Result<Weight, Error> {
                Weight::new(Int::from(self), 0)
            }
        }

        impl IntoWeight for &$integer {
            fn into_weight(self) -> Result<Weight, Error> {
                Weight::new(Int::from(*self), 0)
            }
        }
    )*};
}
integer_weight!(u8, u16, u32, u64, u128, usize, i8, i16, i32, i64, i128);

impl IntoWeight for Int {
    fn into_weight(self) -> Result<Weight, Error> {
        Weight::new(self, 0)
    }
}

impl IntoWeight for &Int {
    fn into_weight(self) -> Result<Weight, Error> {
        Weight::new(self.clone(), 0)
    }
}

/// The weights as integers at their largest scale.
fn scaled_weights(
    weights: impl IntoIterator<Item = impl IntoWeight>,
) -> Result<(Vec<Int>, u16), Error> {
    let weights: Vec<Weight> = weights
        .into_iter()
        .map(IntoWeight::into_weight)
        .collect::<Result<_, _>>()?;
    let scale = weights.iter().map(|weight| weight.scale).max().unwrap_or(0);
    let scaled = weights
        .into_iter()
        .map(|weight| weight.digits.mul_pow10(u32::from(scale - weight.scale)))
        .collect();
    Ok((scaled, scale))
}

/// `count` copies of `value`, or [`Error::Overflow`] when that many can't be held.
fn repeated<T: Clone>(value: T, count: usize) -> Result<Vec<T>, Error> {
    let mut out = Vec::new();
    out.try_reserve_exact(count).map_err(|_| Error::Overflow)?;
    out.resize(count, value);
    Ok(out)
}

/// Gives the buckets `extra` more units, by `mode`, among the buckets with a non-zero weight.
fn distribute(
    shares: &mut [Int],
    extra: &Int,
    weights: &[Int],
    fractions: &[Int],
    mode: Remainder,
) {
    if extra.is_zero() {
        return;
    }
    let mut eligible: Vec<usize> = (0..shares.len())
        .filter(|&index| !weights[index].is_zero())
        .collect();
    // `extra` is below the number of eligible buckets for every strategy that spreads units
    let spread = extra
        .to_i128()
        .and_then(|extra| usize::try_from(extra).ok())
        .unwrap_or(usize::MAX)
        .min(eligible.len());
    let mut add = |index: usize, amount: &Int| shares[index] = &shares[index] + amount;
    match mode {
        Remainder::ToFirst => add(eligible[0], extra),
        Remainder::ToLast => add(eligible[eligible.len() - 1], extra),
        Remainder::First => eligible
            .iter()
            .take(spread)
            .for_each(|&index| add(index, &Int::ONE)),
        Remainder::Last => eligible
            .iter()
            .rev()
            .take(spread)
            .for_each(|&index| add(index, &Int::ONE)),
        Remainder::Largest => {
            // largest remainder first; the sort is stable, so equal remainders keep bucket order
            eligible.sort_by(|&left, &right| fractions[right].cmp(&fractions[left]));
            eligible
                .iter()
                .take(spread)
                .for_each(|&index| add(index, &Int::ONE));
        }
    }
}

/// `magnitude` (not negative) split by `weights` (already scaled to integers), in units.
fn allocate_magnitude(
    magnitude: &Int,
    weights: &[Int],
    mode: Remainder,
) -> Result<Vec<Int>, Error> {
    if weights.is_empty() {
        return Err(Error::NoWeights);
    }
    let total: Int = weights.iter().sum();
    if total.is_zero() {
        return Err(Error::ZeroWeights);
    }
    let mut shares = Vec::with_capacity(weights.len());
    let mut fractions = Vec::with_capacity(weights.len());
    let mut assigned = Int::ZERO;
    for weight in weights {
        let (share, fraction) = (magnitude * weight).div_rem(&total);
        assigned = assigned + &share;
        shares.push(share);
        fractions.push(fraction);
    }
    distribute(
        &mut shares,
        &(magnitude - &assigned),
        weights,
        &fractions,
        mode,
    );
    Ok(shares)
}

/// Applies the amount's sign to the magnitudes.
fn signed(negative: bool, magnitudes: Vec<Int>, scale: u16) -> Vec<Amount> {
    magnitudes
        .into_iter()
        .map(|magnitude| Amount {
            units: if negative { -magnitude } else { magnitude },
            scale,
        })
        .collect()
}

impl Amount {
    pub(crate) fn allocate(&self, weights: &[Int], mode: Remainder) -> Result<Vec<Self>, Error> {
        let shares = allocate_magnitude(&self.units.abs(), weights, mode)?;
        Ok(signed(self.units.is_negative(), shares, self.scale))
    }

    pub(crate) fn instalments(
        &self,
        count: usize,
        unit: Option<&Self>,
        mode: InstalmentRemainder,
    ) -> Result<Vec<Self>, Error> {
        if count == 0 {
            return Err(Error::NoWeights);
        }
        let Some(unit) = unit else {
            return self.allocate(&repeated(Int::ONE, count)?, mode.into());
        };
        if !unit.units.is_positive() {
            return Err(Error::NotPositive);
        }
        let scale = self.scale.max(unit.scale);
        let total = self.rescale(scale, Rounding::Unnecessary)?;
        let step = unit.rescale(scale, Rounding::Unnecessary)?.units;
        let magnitude = total.units.abs();
        let count_int = Int::from(count);
        // regular instalments are the largest multiple of the unit that fits `count` times
        let per = magnitude.div_rem(&(&step * &count_int)).0 * &step;
        let mut parts = repeated(per.clone(), count)?;
        let mut left = &magnitude - &(per * &count_int);
        // spread whole units first (for First and Last), then the sub-unit leftover
        if matches!(mode, InstalmentRemainder::First | InstalmentRemainder::Last) {
            let mut index = 0;
            while left >= step {
                let at = if mode == InstalmentRemainder::First {
                    index
                } else {
                    count - 1 - index
                };
                parts[at] = &parts[at] + &step;
                left = left - &step;
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
        parts[last] = &parts[last] + &left;
        Ok(signed(total.units.is_negative(), parts, scale))
    }

    pub(crate) fn chunk(&self, max: &Self) -> Result<Vec<Self>, Error> {
        if !max.units.is_positive() {
            return Err(Error::NotPositive);
        }
        if self.units.is_negative() {
            return Err(Error::NegativeTotal);
        }
        let scale = self.scale.max(max.scale);
        let total = self.rescale(scale, Rounding::Unnecessary)?.units;
        let step = max.rescale(scale, Rounding::Unnecessary)?.units;
        if total <= step {
            // nothing is taken off, so the one chunk is the total itself, at its own scale
            return Ok(alloc::vec![self.clone()]);
        }
        // every chunk but the last is `max`; the last is what's left, and positive
        let full = (&total - &Int::ONE).div_rem(&step).0;
        let last = &total - &(&full * &step);
        let full = usize::try_from(full).map_err(|_| Error::Overflow)?;
        let mut out = Vec::new();
        out.try_reserve_exact(full.checked_add(1).ok_or(Error::Overflow)?)
            .map_err(|_| Error::Overflow)?;
        // the full chunks keep `max`'s own scale, as ducat returns `max` itself
        out.extend(core::iter::repeat_n(max.clone(), full));
        out.push(Self { units: last, scale });
        Ok(out)
    }
}

/// One tranche of a [schedule](Money::schedule): a fixed amount, a percentage of the total
/// (optionally capped), or the rest. `M` is [`Money<C>`] or [`AnyMoney`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tranche<M> {
    kind: TrancheKind<M>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
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

/// The schedule on amounts; `amount_of` checks each tranche's currency against the total's.
fn schedule_amounts<M>(
    total: &Amount,
    tranches: &[Tranche<M>],
    amount_of: impl Fn(&M) -> Result<Amount, Error>,
) -> Result<Vec<Amount>, Error> {
    let mut rest = None;
    let mut percent_at = Vec::new();
    let mut percents = Vec::new();
    for (index, tranche) in tranches.iter().enumerate() {
        match &tranche.kind {
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
    let mut left = total.clone();
    if !percents.is_empty() {
        let (mut weights, scale) = scaled_weights(percents)?;
        let sum: Int = weights.iter().sum();
        let hundred = Int::from(100u8).mul_pow10(u32::from(scale));
        if sum > hundred {
            return Err(Error::InvalidSchedule);
        }
        weights.push(hundred - sum);
        let parts = total.allocate(&weights, Remainder::Largest)?;
        for (&index, part) in percent_at.iter().zip(parts) {
            let TrancheKind::Percent { cap, .. } = &tranches[index].kind else {
                unreachable!()
            };
            let mut part = part;
            if let Some(cap) = cap {
                let cap = amount_of(cap)?;
                if part.cmp_value(&cap) == Ordering::Greater {
                    part = cap;
                }
            }
            left = left.sub(&part);
            out[index] = Some(part);
        }
    }
    for (index, tranche) in tranches.iter().enumerate() {
        if let TrancheKind::Amount(amount) = &tranche.kind {
            let amount = amount_of(amount)?;
            left = left.sub(&amount);
            out[index] = Some(amount);
        }
    }
    if left.units.is_negative() {
        return Err(Error::InvalidSchedule);
    }
    match rest {
        Some(index) => out[index] = Some(left.clone()),
        None if !left.units.is_zero() => return Err(Error::InvalidSchedule),
        None => {}
    }
    Ok(out
        .into_iter()
        .map(|part| part.unwrap_or_else(|| left.clone()))
        .collect())
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
    /// assert_eq!(four.iter().map(Money::to_decimal).collect::<Vec<_>>(), ["0.00", "0.02", "0.02"]);
    /// # Ok::<(), ducat::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::NoWeights`]; [`Error::ZeroWeights`] when every weight is zero;
    /// [`Error::NegativeWeight`]; and whatever reading a weight fails with.
    pub fn allocate(
        &self,
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
    /// [`Error::NoWeights`] for a count of zero; [`Error::Overflow`] for more parts than can be
    /// held.
    pub fn split(&self, count: usize, remainder: Remainder) -> Result<Vec<Self>, Error> {
        Ok(Self::wrap(
            self.amount
                .allocate(&repeated(Int::ONE, count)?, remainder)?,
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
    /// let plan = total.instalments(3, Some(&euro), InstalmentRemainder::ToFirst)?;
    /// assert_eq!(plan.iter().map(Money::to_decimal).collect::<Vec<_>>(), ["34.00", "33.00", "33.00"]);
    /// # Ok::<(), ducat::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::NoWeights`] for a count of zero; [`Error::NotPositive`] for a unit that isn't
    /// positive; [`Error::Overflow`] for more instalments than can be held.
    pub fn instalments(
        &self,
        count: usize,
        unit: Option<&Self>,
        remainder: InstalmentRemainder,
    ) -> Result<Vec<Self>, Error> {
        Ok(Self::wrap(self.amount.instalments(
            count,
            unit.map(|unit| &unit.amount),
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
    pub fn schedule(&self, tranches: &[Tranche<Self>]) -> Result<Vec<Self>, Error> {
        Ok(Self::wrap(schedule_amounts(
            &self.amount,
            tranches,
            |money: &Self| Ok(money.amount.clone()),
        )?))
    }

    /// Tranches of at most `max`: every one but the last is exactly `max`, and the last is
    /// positive. A zero total gives one zero tranche.
    ///
    /// # Errors
    ///
    /// [`Error::NotPositive`] when `max` isn't positive; [`Error::NegativeTotal`] when `self` is
    /// negative; [`Error::Overflow`] when there are too many tranches to hold.
    pub fn chunk(&self, max: &Self) -> Result<Vec<Self>, Error> {
        Ok(Self::wrap(self.amount.chunk(&max.amount)?))
    }
}

impl AnyMoney {
    fn wrap(&self, parts: Vec<Amount>) -> Vec<Self> {
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
        &self,
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
    pub fn split(&self, count: usize, remainder: Remainder) -> Result<Vec<Self>, Error> {
        Ok(self.wrap(
            self.amount
                .allocate(&repeated(Int::ONE, count)?, remainder)?,
        ))
    }

    /// As [`Money::instalments`].
    ///
    /// # Errors
    ///
    /// As [`Money::instalments`], and [`Error::CurrencyMismatch`] for a unit in another currency.
    pub fn instalments(
        &self,
        count: usize,
        unit: Option<&Self>,
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
    pub fn schedule(&self, tranches: &[Tranche<Self>]) -> Result<Vec<Self>, Error> {
        Ok(self.wrap(schedule_amounts(&self.amount, tranches, |money| {
            self.amount_in(money).cloned()
        })?))
    }

    /// As [`Money::chunk`].
    ///
    /// # Errors
    ///
    /// As [`Money::chunk`], and [`Error::CurrencyMismatch`] for a `max` in another currency.
    pub fn chunk(&self, max: &Self) -> Result<Vec<Self>, Error> {
        let max = self.amount_in(max)?;
        Ok(self.wrap(self.amount.chunk(max)?))
    }
}
