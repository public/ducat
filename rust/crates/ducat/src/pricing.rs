//! Retail price endings ("charm pricing"), and tiered and volume pricing in the style of
//! Stripe's price tiers (ducat's `/pricing`). A rule such as "end in .99, rounding up" is a plain
//! value passed explicitly, like a rounding policy, and every result is exact until it is rounded
//! once.
//!
//! ```
//! use ducat::{Money, Rounding};
//! use ducat::iso::{Eur, Usd};
//! use ducat::pricing::{PriceEnding, PriceTier, TieredPricing, TiersMode};
//!
//! let charm = PriceEnding::new("0.99", "1", Rounding::Ceil)?;
//! let price: Money<Eur> = "23.41".parse()?;
//! assert_eq!(price.with_price_ending(&charm)?.to_decimal(), "23.99");
//!
//! let usd = |text: &str| text.parse::<Money<Usd>>();
//! let tiers = vec![
//!     PriceTier::up_to(5)?.with_unit_amount(usd("5")?).with_flat_amount(usd("10")?),
//!     PriceTier::up_to(10)?.with_unit_amount(usd("4")?).with_flat_amount(usd("20")?),
//!     PriceTier::open().with_unit_amount(usd("3")?).with_flat_amount(usd("30")?),
//! ];
//! let graduated = TieredPricing::new(TiersMode::Graduated, tiers.clone(), Rounding::HalfExpand);
//! assert_eq!(graduated.price(12)?.total.to_decimal(), "111.00");
//! let volume = TieredPricing::new(TiersMode::Volume, tiers, Rounding::HalfExpand);
//! assert_eq!(volume.price(12)?.total.to_decimal(), "66.00");
//! # Ok::<(), ducat::Error>(())
//! ```

use alloc::vec::Vec;
use core::fmt;

use crate::amount::Amount;
use crate::decimal::parse_decimal;
use crate::rounding::rescale_ratio;
use crate::{
    AnyMoney, Currency, Error, Factor, Int, Money, MoneyKind, Ratio, Rounding, RoundingInput,
};

/// A decimal in major units: `digits × 10^−scale`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct Places {
    digits: Int,
    scale: u16,
}

impl Places {
    fn parse(text: &str) -> Result<Self, Error> {
        let decimal = parse_decimal(text)?;
        Ok(Self {
            digits: decimal.digits,
            scale: decimal.scale,
        })
    }

    /// The decimal in 10^−scale units, or `None` if it has more decimals than `scale`.
    fn units_at(&self, scale: u16) -> Option<Int> {
        if self.scale <= scale {
            return Some(self.digits.mul_pow10(u32::from(scale - self.scale)));
        }
        let (quotient, rest) = self
            .digits
            .div_rem(&Int::ONE.mul_pow10(u32::from(self.scale - scale)));
        rest.is_zero().then_some(quotient)
    }

    fn ratio(&self) -> Ratio {
        // a power of ten is never zero
        Ratio::new(
            self.digits.clone(),
            Int::ONE.mul_pow10(u32::from(self.scale)),
        )
        .unwrap_or(Ratio::ZERO)
    }
}

/// A retail price-ending rule (ducat's `priceEnding`): the allowed prices are `ending + k × step`
/// for every integer `k`, and the rule moves an amount to one of them, chosen by applying its mode
/// to the count of steps (`Ceil`, ducat's default, is the next allowed price at or above). The
/// result keeps the amount's scale.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct PriceEnding {
    ending: Places,
    step: Places,
    mode: Rounding,
}

impl PriceEnding {
    /// A rule for prices ending in `ending` (major units, `"0.99"`) every `step` (`"1"`; `"10"`
    /// with an ending of `"9.90"` gives 19.90, 29.90, …), picked by `mode`: `Ceil` the next
    /// allowed price at or above, `Floor` the next at or below, `HalfCeil` the nearest with ties
    /// up, or any other mode applied to the count of steps.
    ///
    /// # Errors
    ///
    /// [`Error::Syntax`] for text outside ducat's decimal grammar; [`Error::InvalidEnding`] for a
    /// step that isn't positive or an ending outside `[0, step)`.
    pub fn new(ending: &str, step: &str, mode: Rounding) -> Result<Self, Error> {
        let (ending, step) = (Places::parse(ending)?, Places::parse(step)?);
        if !step.digits.is_positive() {
            return Err(Error::InvalidEnding);
        }
        // compare at a common scale: 0 <= ending < step
        let scale = ending.scale.max(step.scale);
        let (ending_units, step_units) = (ending.units_at(scale), step.units_at(scale));
        match (ending_units, step_units) {
            (Some(ending_units), Some(step_units))
                if !ending_units.is_negative() && ending_units < step_units => {}
            _ => return Err(Error::InvalidEnding),
        }
        Ok(Self { ending, step, mode })
    }

    /// What prices end in, in major units.
    #[must_use]
    pub fn ending(&self) -> Ratio {
        self.ending.ratio()
    }

    /// The step between allowed prices, in major units.
    #[must_use]
    pub fn step(&self) -> Ratio {
        self.step.ratio()
    }

    /// How the allowed price is picked.
    #[must_use]
    pub const fn mode(&self) -> Rounding {
        self.mode
    }

    /// `ending + round((amount − ending) / step) × step`, at the amount's scale.
    fn apply(&self, amount: &Amount) -> Result<Amount, Error> {
        let scale = amount.scale;
        let (Some(offset), Some(stride)) = (self.ending.units_at(scale), self.step.units_at(scale))
        else {
            return Err(Error::EndingTooPrecise);
        };
        let steps = rescale_ratio(
            &(&amount.units - &offset),
            &Int::ONE,
            &stride,
            0,
            0,
            self.mode,
        )?;
        Ok(Amount {
            units: offset + steps * stride,
            scale,
        })
    }
}

impl fmt::Debug for PriceEnding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PriceEnding")
            .field("ending", &self.ending())
            .field("step", &self.step())
            .field("mode", &self.mode)
            .finish()
    }
}

impl<C: Currency> Money<C> {
    /// The amount moved to `rule`'s ending, at its own scale (ducat's `price.with(rule)`).
    ///
    /// # Errors
    ///
    /// [`Error::EndingTooPrecise`] when the ending or step has more decimals than the amount
    /// (0.99 for a whole-yen price); [`Error::Rounding`] with
    /// [`Rounding::Unnecessary`] unless the amount already has the ending.
    pub fn with_price_ending(&self, rule: &PriceEnding) -> Result<Self, Error> {
        Ok(Self::from_amount(rule.apply(&self.amount)?))
    }
}

impl AnyMoney {
    /// As [`Money::with_price_ending`].
    ///
    /// # Errors
    ///
    /// As [`Money::with_price_ending`].
    pub fn with_price_ending(&self, rule: &PriceEnding) -> Result<Self, Error> {
        Ok(Self::from_parts(rule.apply(&self.amount)?, self.currency()))
    }
}

/// How tiers price a quantity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum TiersMode {
    /// Each tier prices the units that fall in it, and the charges add up (Stripe's
    /// `tiers_mode: "graduated"`).
    Graduated,
    /// The tier the whole quantity falls in prices every unit (`tiers_mode: "volume"`).
    Volume,
}

/// What a quantity past a bounded last tier does.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum BeyondLastTier {
    /// [`Error::BeyondLastTier`] (ducat's `'throw'`, the default).
    #[default]
    Refuse,
    /// Charge as if the quantity were the last tier's bound, so nothing more is charged past it.
    Cap,
}

/// One price tier: it covers quantities above the previous tier's bound, up to and including its
/// own (`None` for the open last tier).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PriceTier<M> {
    /// The tier's upper bound, inclusive; `None` for no limit (the last tier only).
    pub up_to: Option<Ratio>,
    /// The price per unit in this tier; it may have more decimals than the currency.
    pub unit_amount: Option<M>,
    /// A fixed amount charged once when the quantity falls in (or, graduated, reaches) this tier.
    pub flat_amount: Option<M>,
}

impl<M> PriceTier<M> {
    /// A tier up to `bound`, inclusive, with no price yet.
    ///
    /// # Errors
    ///
    /// Whatever reading `bound` fails with.
    pub fn up_to(bound: impl Factor) -> Result<Self, Error> {
        Ok(Self {
            up_to: Some(bound.to_ratio()?),
            unit_amount: None,
            flat_amount: None,
        })
    }

    /// An open tier, with no upper bound and no price yet.
    #[must_use]
    pub const fn open() -> Self {
        Self {
            up_to: None,
            unit_amount: None,
            flat_amount: None,
        }
    }

    /// The same tier with a price per unit.
    #[must_use]
    pub fn with_unit_amount(self, amount: M) -> Self {
        Self {
            unit_amount: Some(amount),
            ..self
        }
    }

    /// The same tier with a flat amount.
    #[must_use]
    pub fn with_flat_amount(self, amount: M) -> Self {
        Self {
            flat_amount: Some(amount),
            ..self
        }
    }
}

/// Tiered pricing (ducat's `tieredPrice` options): the tiers, how they price a quantity, and how
/// the total is rounded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TieredPricing<M> {
    /// How the tiers price a quantity.
    pub mode: TiersMode,
    /// The tiers, in increasing bound order.
    pub tiers: Vec<PriceTier<M>>,
    /// How the total is rounded: a mode, to the currency's exponent, or a rounding policy.
    pub rounding: RoundingInput,
    /// What a quantity past a bounded last tier does.
    pub beyond_last_tier: BeyondLastTier,
    /// In volume mode, the quantity the chosen tier's unit amount multiplies, when it isn't the
    /// quantity that chose the tier (tiers by meter count, priced per unit used). It isn't
    /// capped.
    pub charge_quantity: Option<Ratio>,
}

/// One line of a tiered price: a tier the quantity reached.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct TierLine<M: MoneyKind> {
    /// The tier's index in the tiers.
    pub tier: usize,
    /// The units priced in this tier.
    pub quantity: Ratio,
    /// The exact charge: quantity × unit amount + flat amount.
    pub exact: M::Exact,
    /// The charge rounded so that the lines sum exactly to the total: the rounded running total
    /// minus the rounded running total before it.
    pub amount: M,
}

/// A tiered price: the total, exactly and rounded once, and a line per tier reached.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct TieredPrice<M: MoneyKind> {
    /// The exact total, rounded once.
    pub total: M,
    /// The exact total.
    pub exact: M::Exact,
    /// The tiers the quantity reached, in order (one in volume mode), even one that charges
    /// nothing; their amounts sum to `total`.
    pub lines: Vec<TierLine<M>>,
}

/// The exact value of an amount, in major units.
fn value_of(units: &Int, scale: u16) -> Ratio {
    // a power of ten is never zero
    Ratio::new(units.clone(), Int::ONE.mul_pow10(u32::from(scale))).unwrap_or(Ratio::ZERO)
}

fn non_negative(value: Ratio) -> Result<Ratio, Error> {
    if value.numer().is_negative() {
        Err(Error::NegativeQuantity)
    } else {
        Ok(value)
    }
}

impl<M: MoneyKind> TieredPricing<M> {
    /// Pricing by `tiers` in `mode`, rounded with `rounding`, refusing quantities past a bounded
    /// last tier, with no separate charge quantity.
    pub fn new(
        mode: TiersMode,
        tiers: Vec<PriceTier<M>>,
        rounding: impl Into<RoundingInput>,
    ) -> Self {
        Self {
            mode,
            tiers,
            rounding: rounding.into(),
            beyond_last_tier: BeyondLastTier::Refuse,
            charge_quantity: None,
        }
    }

    /// The same pricing with quantities past a bounded last tier handled by `beyond`.
    #[must_use]
    pub fn with_beyond_last_tier(self, beyond: BeyondLastTier) -> Self {
        Self {
            beyond_last_tier: beyond,
            ..self
        }
    }

    /// The same pricing with a separate charge quantity (volume mode only).
    ///
    /// # Errors
    ///
    /// Whatever reading `quantity` fails with.
    pub fn with_charge_quantity(self, quantity: impl Factor) -> Result<Self, Error> {
        Ok(Self {
            charge_quantity: Some(quantity.to_ratio()?),
            ..self
        })
    }

    /// The price of `quantity`, exactly, with the total rounded once and a line per tier. Tier
    /// bounds are inclusive (a bound of 10 covers the 10th unit), as Stripe's are. Quantity 0 falls
    /// in the first tier, so its flat amount (a base fee) is charged; in graduated mode a later
    /// tier's flat amount is charged once the quantity goes past the tier before it.
    ///
    /// # Errors
    ///
    /// [`Error::ChargeQuantityNeedsVolume`] for a charge quantity in graduated mode;
    /// [`Error::NoTiers`]; [`Error::NegativeQuantity`] for a negative quantity, bound or charge
    /// quantity; [`Error::UnpricedTier`] for a tier with neither price;
    /// [`Error::CurrencyMismatch`] for tiers in more than one currency (or a policy for another);
    /// [`Error::InvalidTierBounds`] for bounds that don't increase from above 0, or an open tier
    /// that isn't last; [`Error::BeyondLastTier`] for a quantity past a bounded last tier, unless
    /// it is capped; [`Error::Rounding`] with [`Rounding::Unnecessary`].
    pub fn price(&self, quantity: impl Factor) -> Result<TieredPrice<M>, Error> {
        if self.charge_quantity.is_some() && self.mode != TiersMode::Volume {
            return Err(Error::ChargeQuantityNeedsVolume);
        }
        if self.tiers.is_empty() {
            return Err(Error::NoTiers);
        }
        let mut amount = non_negative(quantity.to_ratio()?)?;

        // the currency comes from the tiers' amounts, which must all share it
        let mut template: Option<&M> = None;
        for tier in &self.tiers {
            if tier.unit_amount.is_none() && tier.flat_amount.is_none() {
                return Err(Error::UnpricedTier);
            }
            for price in [&tier.unit_amount, &tier.flat_amount].into_iter().flatten() {
                match template {
                    None => template = Some(price),
                    Some(first) if first.parts().2 != price.parts().2 => {
                        return Err(Error::CurrencyMismatch {
                            expected: first.parts().2,
                            actual: price.parts().2,
                        });
                    }
                    Some(_) => {}
                }
            }
        }
        let Some(template) = template else {
            return Err(Error::NoTiers);
        };
        let currency = template.parts().2;

        // bounds: increasing, positive, and open only last
        let last_index = self.tiers.len() - 1;
        let mut previous = Ratio::ZERO;
        for (index, tier) in self.tiers.iter().enumerate() {
            match &tier.up_to {
                None if index != last_index => return Err(Error::InvalidTierBounds),
                None => {}
                Some(bound) => {
                    let bound = non_negative(bound.clone())?;
                    if bound <= previous {
                        return Err(Error::InvalidTierBounds);
                    }
                    previous = bound;
                }
            }
        }
        if let Some(last) = &self.tiers[last_index].up_to {
            if amount > *last {
                match self.beyond_last_tier {
                    BeyondLastTier::Refuse => return Err(Error::BeyondLastTier),
                    BeyondLastTier::Cap => amount = last.clone(),
                }
            }
        }
        let charge_amount = self.charge_quantity.clone().map(non_negative).transpose()?;

        // the tiers that charge, with the units each prices
        let mut charged: Vec<(usize, Ratio)> = Vec::new();
        let mut lower = Ratio::ZERO;
        for (index, tier) in self.tiers.iter().enumerate() {
            let in_tier = tier.up_to.as_ref().is_none_or(|upper| amount <= *upper);
            if self.mode == TiersMode::Volume {
                if in_tier {
                    charged.push((
                        index,
                        charge_amount.clone().unwrap_or_else(|| amount.clone()),
                    ));
                    break;
                }
            } else {
                // the first tier always charges (quantity 0 is in it); a later one once the
                // quantity is past the tier before it
                if index > 0 && lower >= amount {
                    break;
                }
                let top = if in_tier {
                    amount.clone()
                } else {
                    tier.up_to.clone().unwrap_or_else(|| amount.clone())
                };
                charged.push((index, top.sub(&lower)));
                if in_tier {
                    break;
                }
                lower = top;
            }
        }

        // lines round their running totals, so they sum exactly to the rounded total
        let charge = |tier: &PriceTier<M>, units: &Ratio| {
            let mut result = Ratio::ZERO;
            if let Some(unit) = &tier.unit_amount {
                let (minor, scale, _) = unit.parts();
                result = result.add(&value_of(minor, scale).mul(units));
            }
            if let Some(flat) = &tier.flat_amount {
                let (minor, scale, _) = flat.parts();
                result = result.add(&value_of(minor, scale));
            }
            result
        };
        let exponent = u16::from(currency.exponent());
        let one = Amount {
            units: Int::ONE,
            scale: 0,
        };
        let mut lines = Vec::with_capacity(charged.len());
        let mut running = Ratio::ZERO;
        let mut rounded_before = Amount {
            units: Int::ZERO,
            scale: 0,
        };
        for (index, units) in charged {
            let line_exact = charge(&self.tiers[index], &units);
            running = running.add(&line_exact);
            let rounded = one.round_input(
                running.numer(),
                running.denom(),
                exponent,
                self.rounding,
                currency,
            )?;
            let line_amount = rounded.sub(&rounded_before);
            lines.push(TierLine {
                tier: index,
                quantity: units,
                exact: template.exact_in(line_exact),
                amount: template.with_units(line_amount.units, line_amount.scale),
            });
            rounded_before = rounded;
        }
        Ok(TieredPrice {
            total: template.with_units(rounded_before.units, rounded_before.scale),
            exact: template.exact_in(running),
            lines,
        })
    }
}
