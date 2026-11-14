//! Percentages, discounts, and adding and extracting tax, where the parts always add up.
//!
//! ```
//! use ducat::{Money, Rounding};
//! use ducat::iso::Eur;
//!
//! let gross: Money<Eur> = "12.00".parse()?;
//! let vat = gross.extract_tax("20", Rounding::HalfEven)?;
//! assert_eq!((vat.net.to_decimal(), vat.tax.to_decimal()), ("10.00".into(), "2.00".into()));
//! # Ok::<(), ducat::Error>(())
//! ```

use crate::amount::Amount;
use crate::{AnyMoney, Currency, CurrencyCode, Error, Factor, Int, Money, Ratio, RoundingInput};

/// A tax split: `net + tax` is always exactly `gross`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct TaxBreakdown<M> {
    /// The amount before tax.
    pub net: M,
    /// The tax.
    pub tax: M,
    /// Always exactly `net + tax`.
    pub gross: M,
}

/// `percent / 100`.
fn percent_ratio(percent: impl Factor) -> Result<Ratio, Error> {
    Ok(percent.to_ratio()?.mul(&Ratio::new(1, 100)?))
}

impl Amount {
    fn percentage(
        &self,
        percent: impl Factor,
        rounding: RoundingInput,
        currency: CurrencyCode,
    ) -> Result<Self, Error> {
        self.mul_input(&percent_ratio(percent)?, self.scale, rounding, currency)
    }

    /// A mode rounds the tax; a policy rounds the gross, the amount charged, so it lands on the
    /// policy's increment (CHF 0.05 for cash). Either way the other part is the exact difference.
    fn add_tax(
        &self,
        percent: impl Factor,
        rounding: RoundingInput,
        currency: CurrencyCode,
    ) -> Result<TaxBreakdown<Self>, Error> {
        let (tax, gross) = match rounding {
            RoundingInput::Mode(_) => {
                let tax = self.percentage(percent, rounding, currency)?;
                let gross = self.add(&tax);
                (tax, gross)
            }
            #[cfg(feature = "policy")]
            RoundingInput::Policy(_) => {
                let percent = percent.to_ratio()?;
                let hundred_den = Int::from(100u8) * percent.denom();
                let gross = self.round_input(
                    &(&hundred_den + percent.numer()),
                    &hundred_den,
                    self.scale,
                    rounding,
                    currency,
                )?;
                (gross.sub(self), gross)
            }
        };
        Ok(TaxBreakdown {
            net: self.clone(),
            tax,
            gross,
        })
    }

    fn extract_tax(
        &self,
        percent: impl Factor,
        rounding: RoundingInput,
        currency: CurrencyCode,
    ) -> Result<TaxBreakdown<Self>, Error> {
        let percent = percent.to_ratio()?;
        // net = gross × 1 / (1 + p/100) = gross × 100 den / (100 den + num)
        let hundred_den = Int::from(100u8) * percent.denom();
        let gross_share = &hundred_den + percent.numer();
        if !gross_share.is_positive() {
            return Err(Error::InvalidPercent);
        }
        let net = self.round_input(&hundred_den, &gross_share, self.scale, rounding, currency)?;
        let tax = self.sub(&net);
        Ok(TaxBreakdown {
            net,
            tax,
            gross: self.clone(),
        })
    }

    /// A mode rounds the discount; a policy rounds the discounted price itself, so the price lands
    /// on the policy's scale and increment.
    fn discount(
        &self,
        percent: impl Factor,
        rounding: RoundingInput,
        currency: CurrencyCode,
    ) -> Result<Self, Error> {
        match rounding {
            RoundingInput::Mode(_) => Ok(self.sub(&self.percentage(percent, rounding, currency)?)),
            #[cfg(feature = "policy")]
            RoundingInput::Policy(_) => {
                let percent = percent.to_ratio()?;
                let hundred_den = Int::from(100u8) * percent.denom();
                self.round_input(
                    &(&hundred_den - percent.numer()),
                    &hundred_den,
                    self.scale,
                    rounding,
                    currency,
                )
            }
        }
    }
}

impl<C: Currency> Money<C> {
    fn breakdown(parts: TaxBreakdown<Amount>) -> TaxBreakdown<Self> {
        TaxBreakdown {
            net: Self::from_amount(parts.net),
            tax: Self::from_amount(parts.tax),
            gross: Self::from_amount(parts.gross),
        }
    }

    /// `percent`% of the amount, rounded once (with a mode to its scale, with a rounding policy to
    /// the policy's): 12.5% of 80.00 EUR is 10.00 EUR.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] for an inexact result with
    /// [`Rounding::Unnecessary`](crate::Rounding::Unnecessary); [`Error::CurrencyMismatch`] for a
    /// policy for another currency; and whatever reading `percent` fails with.
    pub fn percentage(
        &self,
        percent: impl Factor,
        rounding: impl Into<RoundingInput>,
    ) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.percentage(
            percent,
            rounding.into(),
            C::CODE,
        )?))
    }

    /// Adds `percent`% tax to a net amount (tax-exclusive). A mode rounds the tax once, and the
    /// gross is exactly net + tax; a rounding policy rounds the gross (the amount charged) to its
    /// scale and increment, and the tax is exactly gross − net.
    ///
    /// # Errors
    ///
    /// As [`Money::percentage`].
    pub fn add_tax(
        &self,
        percent: impl Factor,
        rounding: impl Into<RoundingInput>,
    ) -> Result<TaxBreakdown<Self>, Error> {
        Ok(Self::breakdown(self.amount.add_tax(
            percent,
            rounding.into(),
            C::CODE,
        )?))
    }

    /// Extracts the `percent`% tax a gross amount contains (tax-inclusive, VAT extraction): the
    /// net is gross ÷ (1 + percent/100), rounded once (to a policy's scale and increment, with a
    /// policy), and the tax is exactly gross − net.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidPercent`] for a percent of −100 or below, which no net amount has; then as
    /// [`Money::percentage`].
    pub fn extract_tax(
        &self,
        percent: impl Factor,
        rounding: impl Into<RoundingInput>,
    ) -> Result<TaxBreakdown<Self>, Error> {
        Ok(Self::breakdown(self.amount.extract_tax(
            percent,
            rounding.into(),
            C::CODE,
        )?))
    }

    /// The price after a `percent`% discount. A mode rounds the discount once, and it is
    /// subtracted exactly; a rounding policy rounds the discounted price itself, so the price lands
    /// on the policy's scale and increment.
    ///
    /// # Errors
    ///
    /// As [`Money::percentage`].
    pub fn discount(
        &self,
        percent: impl Factor,
        rounding: impl Into<RoundingInput>,
    ) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.discount(
            percent,
            rounding.into(),
            C::CODE,
        )?))
    }
}

impl AnyMoney {
    fn breakdown(&self, parts: TaxBreakdown<Amount>) -> TaxBreakdown<Self> {
        let currency = self.currency();
        TaxBreakdown {
            net: Self::from_parts(parts.net, currency),
            tax: Self::from_parts(parts.tax, currency),
            gross: Self::from_parts(parts.gross, currency),
        }
    }

    /// As [`Money::percentage`].
    ///
    /// # Errors
    ///
    /// As [`Money::percentage`].
    pub fn percentage(
        &self,
        percent: impl Factor,
        rounding: impl Into<RoundingInput>,
    ) -> Result<Self, Error> {
        Ok(Self::from_parts(
            self.amount
                .percentage(percent, rounding.into(), self.currency())?,
            self.currency(),
        ))
    }

    /// As [`Money::add_tax`].
    ///
    /// # Errors
    ///
    /// As [`Money::add_tax`].
    pub fn add_tax(
        &self,
        percent: impl Factor,
        rounding: impl Into<RoundingInput>,
    ) -> Result<TaxBreakdown<Self>, Error> {
        Ok(self.breakdown(
            self.amount
                .add_tax(percent, rounding.into(), self.currency())?,
        ))
    }

    /// As [`Money::extract_tax`].
    ///
    /// # Errors
    ///
    /// As [`Money::extract_tax`].
    pub fn extract_tax(
        &self,
        percent: impl Factor,
        rounding: impl Into<RoundingInput>,
    ) -> Result<TaxBreakdown<Self>, Error> {
        Ok(self.breakdown(
            self.amount
                .extract_tax(percent, rounding.into(), self.currency())?,
        ))
    }

    /// As [`Money::discount`].
    ///
    /// # Errors
    ///
    /// As [`Money::discount`].
    pub fn discount(
        &self,
        percent: impl Factor,
        rounding: impl Into<RoundingInput>,
    ) -> Result<Self, Error> {
        Ok(Self::from_parts(
            self.amount
                .discount(percent, rounding.into(), self.currency())?,
            self.currency(),
        ))
    }
}
