//! Rate providers: synchronous lookups over rates already held, and combinators over them
//! (ducat's `src/provider.ts`). Loading rates (network, files, databases) stays outside.

use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;

use super::{AnyRate, RateInfo, Time};
use crate::{CurrencyCode, Error};

/// When a rate is wanted for.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct RateQuery {
    /// A date or an instant; `None` asks for the rate whenever it applies.
    pub as_of: Option<Time>,
}

impl RateQuery {
    /// A query for the rate at `as_of`.
    #[must_use]
    pub const fn at(as_of: Time) -> Self {
        Self { as_of: Some(as_of) }
    }
}

/// Looks up a rate synchronously: `None` when it has none for the pair (or for `query.as_of`).
///
/// The method takes [`CurrencyCode`]s, not type parameters, so a provider can be a trait object
/// and [`chain`] can mix kinds; [`Rate::lookup`](super::Rate::lookup) gives the typed rate.
/// Providers don't read a clock: a query without an `as_of` gets the rate whenever it applies.
///
/// ```
/// use ducat::convert::{RateProvider, RateQuery, RateTable, RateInfo, via};
///
/// let ecb = RateTable::with_base("EUR".parse()?, RateInfo::default())
///     .rate("USD".parse()?, "1.1165")?
///     .rate("JPY".parse()?, "162.457")?
///     .build();
/// let cross = via("EUR".parse()?, &ecb);
/// let usd_jpy = cross.rate("USD".parse()?, "JPY".parse()?, &RateQuery::default()).unwrap();
/// assert_eq!(usd_jpy.to_string(), "324914/2233");
/// # Ok::<(), ducat::Error>(())
/// ```
pub trait RateProvider {
    /// The rate `from` → `to` at `query`, if this provider has one.
    fn rate(&self, from: CurrencyCode, to: CurrencyCode, query: &RateQuery) -> Option<AnyRate>;
}

impl<P: RateProvider + ?Sized> RateProvider for &P {
    fn rate(&self, from: CurrencyCode, to: CurrencyCode, query: &RateQuery) -> Option<AnyRate> {
        (**self).rate(from, to, query)
    }
}

impl<P: RateProvider + ?Sized> RateProvider for alloc::boxed::Box<P> {
    fn rate(&self, from: CurrencyCode, to: CurrencyCode, query: &RateQuery) -> Option<AnyRate> {
        (**self).rate(from, to, query)
    }
}

/// The rate for the pair, for a lookup that must succeed: ducat's `rateOf`.
///
/// # Errors
///
/// [`Error::RateUnavailable`] when the provider has none; [`Error::CurrencyMismatch`] when it
/// answers with a rate for another pair.
pub fn rate_of<P: RateProvider + ?Sized>(
    provider: &P,
    from: CurrencyCode,
    to: CurrencyCode,
    query: &RateQuery,
) -> Result<AnyRate, Error> {
    let rate = provider
        .rate(from, to, query)
        .ok_or(Error::RateUnavailable {
            from,
            to,
            as_of: query.as_of,
        })?;
    // a provider is user code: a wrong pair here would label money with the wrong currency
    rate.check_pair(from, to)?;
    Ok(rate)
}

/// A provider from a function: [`from_fn`].
#[derive(Clone, Copy, Debug)]
pub struct FromFn<F>(F);

/// A provider that calls `lookup`.
pub const fn from_fn<F>(lookup: F) -> FromFn<F>
where
    F: Fn(CurrencyCode, CurrencyCode, &RateQuery) -> Option<AnyRate>,
{
    FromFn(lookup)
}

impl<F> RateProvider for FromFn<F>
where
    F: Fn(CurrencyCode, CurrencyCode, &RateQuery) -> Option<AnyRate>,
{
    fn rate(&self, from: CurrencyCode, to: CurrencyCode, query: &RateQuery) -> Option<AnyRate> {
        (self.0)(from, to, query)
    }
}

/// 1:1 for a currency to itself, nothing otherwise: [`identity`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Identity;

/// A provider that answers 1 for a currency to itself and nothing otherwise.
#[must_use]
pub const fn identity() -> Identity {
    Identity
}

impl RateProvider for Identity {
    fn rate(&self, from: CurrencyCode, to: CurrencyCode, _query: &RateQuery) -> Option<AnyRate> {
        (from == to).then(|| AnyRate::of(from, to, crate::Ratio::ONE))
    }
}

/// Providers asked in turn: [`chain`].
#[derive(Clone, Debug)]
pub struct Chain<P>(Vec<P>);

/// Asks each provider in turn; the first with an answer wins. Mix kinds as
/// [`BoxedProvider`](super::BoxedProvider)s.
pub fn chain<P: RateProvider>(providers: impl IntoIterator<Item = P>) -> Chain<P> {
    Chain(providers.into_iter().collect())
}

impl<P: RateProvider> RateProvider for Chain<P> {
    fn rate(&self, from: CurrencyCode, to: CurrencyCode, query: &RateQuery) -> Option<AnyRate> {
        self.0
            .iter()
            .find_map(|provider| provider.rate(from, to, query))
    }
}

/// The inverses of a provider's rates: [`reversed`].
#[derive(Clone, Copy, Debug)]
pub struct Reversed<P>(P);

/// Answers `to` → `from` lookups with the exact inverse of the provider's `from` → `to` rate.
pub const fn reversed<P: RateProvider>(provider: P) -> Reversed<P> {
    Reversed(provider)
}

impl<P: RateProvider> RateProvider for Reversed<P> {
    fn rate(&self, from: CurrencyCode, to: CurrencyCode, query: &RateQuery) -> Option<AnyRate> {
        self.0.rate(to, from, query).map(|rate| rate.inverse())
    }
}

/// Triangulation through a base currency: [`via`].
#[derive(Clone, Copy, Debug)]
pub struct Via<P> {
    base: CurrencyCode,
    provider: P,
}

/// Triangulates through `base`: `from` → `base`, then `base` → `to`, composed exactly
/// (converting rounds once). Each leg is looked up directly or as an exact inverse, so an ECB
/// table (EUR → X only) answers X → Y. A currency to itself gets nothing.
pub const fn via<P: RateProvider>(base: CurrencyCode, provider: P) -> Via<P> {
    Via { base, provider }
}

impl<P: RateProvider> Via<P> {
    fn leg(&self, from: CurrencyCode, to: CurrencyCode, query: &RateQuery) -> Option<AnyRate> {
        self.provider.rate(from, to, query).or_else(|| {
            self.provider
                .rate(to, from, query)
                .map(|rate| rate.inverse())
        })
    }
}

impl<P: RateProvider> RateProvider for Via<P> {
    fn rate(&self, from: CurrencyCode, to: CurrencyCode, query: &RateQuery) -> Option<AnyRate> {
        if from == to {
            return None;
        }
        if from == self.base || to == self.base {
            return self.leg(from, to, query);
        }
        let to_base = self.leg(from, self.base, query)?;
        let from_base = self.leg(self.base, to, query)?;
        // the legs meet at the base
        to_base.and_then(&from_base).ok()
    }
}

/// When a rate (or a table) applies at `at`: dated on or before that UTC day, published by then,
/// and not yet expired.
fn applies_at(
    as_of: Option<Time>,
    available_at: Option<Time>,
    valid_until: Option<Time>,
    at: &Time,
) -> bool {
    as_of.is_none_or(|as_of| at.day() >= as_of.day())
        && available_at.is_none_or(|available_at| available_at.has_started_by(at))
        && valid_until.is_none_or(|valid_until| !valid_until.has_ended_at(at))
}

/// A fixed set of rates: one base currency against many (as the ECB publishes them), or a list of
/// rates. ducat's `rateTable`.
///
/// Only the pairs given are answered; wrap it in [`reversed`] or [`via`] for the others. When a
/// pair is given twice, the last rate wins. A query with an `as_of` gets nothing from a rate, or a
/// table, that doesn't apply then: one dated after that UTC day, one published (`available_at`)
/// after it, or one whose `valid_until` has passed. A date query covers its whole day, so without
/// an `available_at` a query at any time on the rate's day gets it.
#[derive(Clone, Debug, Default)]
pub struct RateTable {
    rates: Vec<AnyRate>,
    by_pair: BTreeMap<(CurrencyCode, CurrencyCode), usize>,
    base: Option<CurrencyCode>,
    as_of: Option<Time>,
    available_at: Option<Time>,
    valid_until: Option<Time>,
    missing: Vec<CurrencyCode>,
    unknown: Vec<String>,
}

impl RateTable {
    /// A table of the rates given, each looked up under its own pair.
    pub fn from_rates(rates: impl IntoIterator<Item = AnyRate>) -> Self {
        let mut table = Self::default();
        for rate in rates {
            table.push(rate);
        }
        table
    }

    /// A one-base table: add its rates with [`RateTableBuilder::rate`]. `info`'s source, timing
    /// and type go on every rate the builder makes from text (not its quote), and its timing is
    /// the table's own, which filters lookups as each rate's does.
    pub fn with_base(base: CurrencyCode, info: RateInfo) -> RateTableBuilder {
        RateTableBuilder {
            table: Self {
                base: Some(base),
                as_of: info.as_of,
                available_at: info.available_at,
                valid_until: info.valid_until,
                ..Self::default()
            },
            info: RateInfo {
                quote: None,
                ..info
            },
        }
    }

    fn push(&mut self, rate: AnyRate) {
        self.by_pair.insert((rate.from, rate.to), self.rates.len());
        self.rates.push(rate);
    }

    /// The rates, in the order given.
    #[must_use]
    pub fn rates(&self) -> &[AnyRate] {
        &self.rates
    }

    /// The base currency, for a one-base table.
    #[must_use]
    pub const fn base(&self) -> Option<CurrencyCode> {
        self.base
    }

    /// The table's date, when it has one.
    #[must_use]
    pub const fn as_of(&self) -> Option<Time> {
        self.as_of
    }

    /// When the table was published, when that is known.
    #[must_use]
    pub const fn available_at(&self) -> Option<Time> {
        self.available_at
    }

    /// The last day (or instant) the table applies to.
    #[must_use]
    pub const fn valid_until(&self) -> Option<Time> {
        self.valid_until
    }

    /// The currencies the source listed without a value.
    #[must_use]
    pub fn missing(&self) -> &[CurrencyCode] {
        &self.missing
    }

    /// The codes a source listed that aren't ISO 4217 currencies, current or withdrawn: their
    /// rates are left out. ducat keeps such a code as a currency of its own; the port lists it
    /// here, so a code new to ISO 4217 doesn't fail a whole file.
    #[must_use]
    pub fn unknown(&self) -> &[String] {
        &self.unknown
    }
}

impl RateProvider for RateTable {
    fn rate(&self, from: CurrencyCode, to: CurrencyCode, query: &RateQuery) -> Option<AnyRate> {
        let rate = &self.rates[*self.by_pair.get(&(from, to))?];
        if let Some(at) = &query.as_of {
            let info = &rate.info;
            let rate_applies = applies_at(info.as_of, info.available_at, info.valid_until, at);
            let table_applies = applies_at(self.as_of, self.available_at, self.valid_until, at);
            if !(rate_applies && table_applies) {
                return None;
            }
        }
        Some(rate.clone())
    }
}

/// Builds a one-base [`RateTable`]; see [`RateTable::with_base`].
#[derive(Clone, Debug)]
#[must_use]
pub struct RateTableBuilder {
    table: RateTable,
    info: RateInfo,
}

impl RateTableBuilder {
    /// Adds base → `currency` at `rate` (`"1.1165"`, `"2000/2233"`), with the table's metadata,
    /// keeping its published digits as [`AnyRate::parse`] does.
    ///
    /// # Errors
    ///
    /// As [`AnyRate::parse`].
    pub fn rate(mut self, currency: CurrencyCode, rate: &str) -> Result<Self, Error> {
        let base = self.table.base.unwrap_or(currency);
        let built = AnyRate::parse(base, currency, rate)?.with_info(self.info.clone())?;
        self.table.push(built);
        Ok(self)
    }

    /// Adds a ready-made rate, which keeps its own metadata.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] unless it is base → `currency`.
    pub fn entry(mut self, currency: CurrencyCode, rate: AnyRate) -> Result<Self, Error> {
        let base = self.table.base.unwrap_or(currency);
        rate.check_pair(base, currency)?;
        self.table.push(rate);
        Ok(self)
    }

    /// Records a currency the source listed without a value (a holiday, `N/A`).
    pub fn missing(mut self, currency: CurrencyCode) -> Self {
        self.table.missing.push(currency);
        self
    }

    /// Records a code the source listed that isn't a currency the port knows (see
    /// [`RateTable::unknown`]).
    pub fn unknown(mut self, code: &str) -> Self {
        self.table.unknown.push(code.into());
        self
    }

    /// The table.
    #[must_use]
    pub fn build(self) -> RateTable {
        self.table
    }
}
