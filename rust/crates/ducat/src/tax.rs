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
use crate::{AnyMoney, Currency, Error, Factor, Int, Money, Ratio, Rounding};

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
    fn percentage(&self, percent: impl Factor, rounding: Rounding) -> Result<Self, Error> {
        self.mul_ratio(&percent_ratio(percent)?, self.scale, rounding)
    }

    fn add_tax(
        &self,
        percent: impl Factor,
        rounding: Rounding,
    ) -> Result<TaxBreakdown<Self>, Error> {
        let tax = self.percentage(percent, rounding)?;
        let gross = self.add(&tax);
        Ok(TaxBreakdown {
            net: self.clone(),
            tax,
            gross,
        })
    }

    fn extract_tax(
        &self,
        percent: impl Factor,
        rounding: Rounding,
    ) -> Result<TaxBreakdown<Self>, Error> {
        let percent = percent.to_ratio()?;
        // net = gross × 1 / (1 + p/100) = gross × 100 den / (100 den + num)
        let hundred_den = Int::from(100u8) * percent.denom();
        let gross_share = &hundred_den + percent.numer();
        if !gross_share.is_positive() {
            return Err(Error::InvalidPercent);
        }
        let net = self.mul_ratio(&Ratio::new(hundred_den, gross_share)?, self.scale, rounding)?;
        let tax = self.sub(&net);
        Ok(TaxBreakdown {
            net,
            tax,
            gross: self.clone(),
        })
    }

    fn discount(&self, percent: impl Factor, rounding: Rounding) -> Result<Self, Error> {
        Ok(self.sub(&self.percentage(percent, rounding)?))
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

    /// `percent`% of the amount, rounded once to its scale: 12.5% of 80.00 EUR is 10.00 EUR.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] for an inexact result with [`Rounding::Unnecessary`], and whatever
    /// reading `percent` fails with.
    pub fn percentage(&self, percent: impl Factor, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_amount(
            self.amount.percentage(percent, rounding)?,
        ))
    }

    /// Adds `percent`% tax to a net amount (tax-exclusive). The tax is rounded once; the gross
    /// is exactly net + tax.
    ///
    /// # Errors
    ///
    /// As [`Money::percentage`].
    pub fn add_tax(
        &self,
        percent: impl Factor,
        rounding: Rounding,
    ) -> Result<TaxBreakdown<Self>, Error> {
        Ok(Self::breakdown(self.amount.add_tax(percent, rounding)?))
    }

    /// Extracts the `percent`% tax a gross amount contains (tax-inclusive, VAT extraction): the
    /// net is gross ÷ (1 + percent/100), rounded once, and the tax is exactly gross − net.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidPercent`] for a percent of −100 or below, which no net amount has; then as
    /// [`Money::percentage`].
    pub fn extract_tax(
        &self,
        percent: impl Factor,
        rounding: Rounding,
    ) -> Result<TaxBreakdown<Self>, Error> {
        Ok(Self::breakdown(self.amount.extract_tax(percent, rounding)?))
    }

    /// The price after a `percent`% discount: the discount is rounded once, and subtracted
    /// exactly.
    ///
    /// # Errors
    ///
    /// As [`Money::percentage`].
    pub fn discount(&self, percent: impl Factor, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_amount(self.amount.discount(percent, rounding)?))
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
    pub fn percentage(&self, percent: impl Factor, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_parts(
            self.amount.percentage(percent, rounding)?,
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
        rounding: Rounding,
    ) -> Result<TaxBreakdown<Self>, Error> {
        Ok(self.breakdown(self.amount.add_tax(percent, rounding)?))
    }

    /// As [`Money::extract_tax`].
    ///
    /// # Errors
    ///
    /// As [`Money::extract_tax`].
    pub fn extract_tax(
        &self,
        percent: impl Factor,
        rounding: Rounding,
    ) -> Result<TaxBreakdown<Self>, Error> {
        Ok(self.breakdown(self.amount.extract_tax(percent, rounding)?))
    }

    /// As [`Money::discount`].
    ///
    /// # Errors
    ///
    /// As [`Money::discount`].
    pub fn discount(&self, percent: impl Factor, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_parts(
            self.amount.discount(percent, rounding)?,
            self.currency(),
        ))
    }
}
