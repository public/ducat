//! Mixed-currency amounts (ducat's `src/bag.ts`): a bag of per-currency totals, converted and
//! rounded once when a single total is needed, and a cross-currency order through one base
//! currency.

use alloc::collections::BTreeMap;
use alloc::vec::Vec;
use core::cell::RefCell;
use core::cmp::Ordering;

use super::{AnyRate, RateProvider, RateQuery, rate_of};
use crate::amount::AmountSum;
use crate::exact::AnyExactMoney;
use crate::{AnyMoney, CurrencyCode, Error, Rounding};

/// Options for [`MoneyBag::total`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct TotalOptions {
    /// When the rates are wanted for.
    pub query: RateQuery,
    /// The result scale (default: the target currency's exponent).
    pub scale: Option<u16>,
}

/// Per-currency totals of `items`, in first-seen order, each at the largest scale of its items.
///
/// # Errors
///
/// None: each amount is only added to its own currency's total, so nothing can mismatch. The
/// `Result` is kept from when the totals were folded with [`AnyMoney::checked_add`].
pub fn sum_by_currency(items: impl IntoIterator<Item = AnyMoney>) -> Result<Vec<AnyMoney>, Error> {
    // a running sum per currency, each starting at that currency's first item, as folding them
    // with `checked_add` does
    let mut totals: Vec<(CurrencyCode, AmountSum)> = Vec::new();
    for money in items {
        match totals
            .iter_mut()
            .find(|(currency, _)| *currency == money.currency())
        {
            Some((_, total)) => total.add(&money.amount),
            None => totals.push((money.currency(), AmountSum::starting_at(&money.amount))),
        }
    }
    Ok(totals
        .into_iter()
        .map(|(currency, total)| AnyMoney::from_parts(total.finish(), currency))
        .collect())
}

/// An immutable set of per-currency totals: a bag of 10 EUR, 5 USD and 2 EUR holds 12 EUR and
/// 5 USD. ducat's `MoneyBag`.
///
/// ```
/// use ducat::convert::{MoneyBag, RateInfo, RateTable, TotalOptions, via};
/// use ducat::{AnyMoney, Rounding};
///
/// let eur = "EUR".parse()?;
/// let bag = MoneyBag::of([
///     AnyMoney::parse("10", eur)?,
///     AnyMoney::parse("5", "USD".parse()?)?,
///     AnyMoney::parse("2", eur)?,
/// ])?;
/// assert_eq!(bag.get(eur).map(ToString::to_string), Some("12.00 EUR".into()));
/// let ecb = RateTable::with_base(eur, RateInfo::default()).rate("USD".parse()?, "1.25")?.build();
/// let total = bag.total(eur, &via(eur, &ecb), Rounding::HalfEven, &TotalOptions::default())?;
/// assert_eq!(total.to_string(), "16.00 EUR");
/// # Ok::<(), ducat::Error>(())
/// ```
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MoneyBag {
    totals: Vec<AnyMoney>,
}

impl MoneyBag {
    /// An empty bag.
    #[must_use]
    pub const fn new() -> Self {
        Self { totals: Vec::new() }
    }

    /// A bag of the per-currency totals of `items`: ducat's `bag(...items)`.
    ///
    /// # Errors
    ///
    /// As [`sum_by_currency`].
    pub fn of(items: impl IntoIterator<Item = AnyMoney>) -> Result<Self, Error> {
        Ok(Self {
            totals: sum_by_currency(items)?,
        })
    }

    /// A new bag with `items` added.
    ///
    /// # Errors
    ///
    /// As [`sum_by_currency`].
    pub fn with(&self, items: impl IntoIterator<Item = AnyMoney>) -> Result<Self, Error> {
        Self::of(self.totals.iter().cloned().chain(items))
    }

    /// The total in `currency`, if the bag has one.
    #[must_use]
    pub fn get(&self, currency: CurrencyCode) -> Option<&AnyMoney> {
        self.totals
            .iter()
            .find(|total| total.currency() == currency)
    }

    /// The currencies held, in first-seen order.
    pub fn currencies(&self) -> impl ExactSizeIterator<Item = CurrencyCode> + '_ {
        self.totals.iter().map(AnyMoney::currency)
    }

    /// The per-currency totals, in first-seen order.
    #[must_use]
    pub fn values(&self) -> &[AnyMoney] {
        &self.totals
    }

    /// Every total converted exactly into `to` and summed. Nothing is rounded.
    ///
    /// # Errors
    ///
    /// As [`rate_of`], for each currency other than `to`.
    pub fn exact_total<P: RateProvider + ?Sized>(
        &self,
        to: CurrencyCode,
        provider: &P,
        query: &RateQuery,
    ) -> Result<AnyExactMoney, Error> {
        let mut sum = AnyExactMoney::zero(to);
        for money in &self.totals {
            let part = if money.currency() == to {
                money.exact()
            } else {
                rate_of(provider, money.currency(), to, query)?.convert_exact(&money.exact())?
            };
            sum = sum.checked_add(&part)?;
        }
        Ok(sum)
    }

    /// The total in `to`, rounded once with `rounding` (at `options.scale`, by default `to`'s
    /// exponent).
    ///
    /// # Errors
    ///
    /// As [`MoneyBag::exact_total`]; [`Error::Rounding`] with [`Rounding::Unnecessary`] when
    /// inexact.
    pub fn total<P: RateProvider + ?Sized>(
        &self,
        to: CurrencyCode,
        provider: &P,
        rounding: Rounding,
        options: &TotalOptions,
    ) -> Result<AnyMoney, Error> {
        self.exact_total(to, provider, &options.query)?
            .round(rounding, options.scale)
    }
}

/// Converts amounts exactly into one base currency, looking each currency's rate up once.
struct BaseConverter<P> {
    provider: P,
    base: CurrencyCode,
    query: RateQuery,
    rates: RefCell<BTreeMap<CurrencyCode, AnyRate>>,
}

impl<P: RateProvider> BaseConverter<P> {
    fn in_base(&self, money: &AnyMoney) -> Result<AnyExactMoney, Error> {
        if money.currency() == self.base {
            return Ok(money.exact());
        }
        let known = self.rates.borrow().get(&money.currency()).cloned();
        let rate = match known {
            Some(rate) => rate,
            None => {
                let rate = rate_of(&self.provider, money.currency(), self.base, &self.query)?;
                self.rates
                    .borrow_mut()
                    .insert(money.currency(), rate.clone());
                rate
            }
        };
        rate.convert_exact(&money.exact())
    }
}

/// Compares amounts in any currencies as their exact values in one base currency: [`comparator`].
pub struct Comparator<P>(BaseConverter<P>);

/// A comparison of amounts in any currencies through `base`, exactly (no rounding, so rounding
/// makes no ties). One rate per currency, looked up once and lazily, makes it a total preorder,
/// which pairwise rates with bid/ask or slightly inconsistent mids aren't. ducat's `comparator`;
/// to sort, [`sort_by_value`] looks every rate up first.
pub fn comparator<P: RateProvider>(
    provider: P,
    base: CurrencyCode,
    query: RateQuery,
) -> Comparator<P> {
    Comparator(BaseConverter {
        provider,
        base,
        query,
        rates: RefCell::new(BTreeMap::new()),
    })
}

impl<P: RateProvider> Comparator<P> {
    /// The order of the two amounts' values in the base currency.
    ///
    /// # Errors
    ///
    /// As [`rate_of`], for a currency without a rate to the base.
    pub fn compare(&self, money: &AnyMoney, other: &AnyMoney) -> Result<Ordering, Error> {
        self.0.in_base(money)?.compare(&self.0.in_base(other)?)
    }
}

/// `items` in ascending order of their value in `base`, as [`comparator`] orders them, stably:
/// every amount is converted once, before anything is sorted. ducat's `sortByValue`.
///
/// # Errors
///
/// As [`rate_of`], before anything is reordered.
pub fn sort_by_value<P: RateProvider>(
    items: impl IntoIterator<Item = AnyMoney>,
    provider: P,
    base: CurrencyCode,
    query: RateQuery,
) -> Result<Vec<AnyMoney>, Error> {
    let converter = comparator(provider, base, query).0;
    let mut keyed = items
        .into_iter()
        .map(|item| Ok((converter.in_base(&item)?, item)))
        .collect::<Result<Vec<_>, Error>>()?;
    // every value is in the base currency, so the comparison can't mismatch
    keyed.sort_by(|first, second| first.0.value().cmp(second.0.value()));
    Ok(keyed.into_iter().map(|(_, item)| item).collect())
}
