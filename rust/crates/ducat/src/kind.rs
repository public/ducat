//! The money types the generic functions (finance, Excel, pricing) take.

#[cfg(feature = "exact")]
use crate::Ratio;
use crate::amount::Amount;
use crate::{AnyMoney, Currency, CurrencyCode, Int, Money};

mod sealed {
    use crate::{CurrencyCode, Int};

    /// The money types the generic functions take; sealed, so only [`Money`](crate::Money) and
    /// [`AnyMoney`](crate::AnyMoney) implement it.
    pub trait Sealed: Clone {
        /// The units, the scale and the currency.
        fn parts(&self) -> (&Int, u16, CurrencyCode);
        /// An amount in this one's currency.
        fn with_units(&self, units: Int, scale: u16) -> Self;
        /// An exact amount of `value` major units in this one's currency.
        #[cfg(feature = "exact")]
        fn exact_in(&self, value: crate::Ratio) -> <Self as super::MoneyKind>::Exact
        where
            Self: super::MoneyKind;
    }
}

/// A money type the finance, Excel and pricing functions take: [`Money<C>`] or [`AnyMoney`]. The
/// functions that take several amounts (flows, a balloon, tiers) return
/// [`Error::CurrencyMismatch`](crate::Error::CurrencyMismatch) for [`AnyMoney`] in more than one
/// currency; with [`Money<C>`] the type rules that out.
pub trait MoneyKind: sealed::Sealed {
    /// The exact amount of the same kind: [`ExactMoney<C>`](crate::exact::ExactMoney) for
    /// [`Money<C>`], [`AnyExactMoney`](crate::exact::AnyExactMoney) for [`AnyMoney`].
    #[cfg(feature = "exact")]
    type Exact: Clone + core::fmt::Debug + PartialEq + Eq + core::hash::Hash;
}

impl<C: Currency> sealed::Sealed for Money<C> {
    fn parts(&self) -> (&Int, u16, CurrencyCode) {
        (&self.amount.units, self.amount.scale, C::CODE)
    }

    fn with_units(&self, units: Int, scale: u16) -> Self {
        Self::from_amount(Amount { units, scale })
    }

    #[cfg(feature = "exact")]
    fn exact_in(&self, value: Ratio) -> <Self as MoneyKind>::Exact {
        crate::exact::ExactMoney::of(value)
    }
}

impl<C: Currency> MoneyKind for Money<C> {
    #[cfg(feature = "exact")]
    type Exact = crate::exact::ExactMoney<C>;
}

impl sealed::Sealed for AnyMoney {
    fn parts(&self) -> (&Int, u16, CurrencyCode) {
        (&self.amount.units, self.amount.scale, self.currency())
    }

    fn with_units(&self, units: Int, scale: u16) -> Self {
        Self::from_parts(Amount { units, scale }, self.currency())
    }

    #[cfg(feature = "exact")]
    fn exact_in(&self, value: Ratio) -> <Self as MoneyKind>::Exact {
        crate::exact::AnyExactMoney::of(value, self.currency())
    }
}

impl MoneyKind for AnyMoney {
    #[cfg(feature = "exact")]
    type Exact = crate::exact::AnyExactMoney;
}
