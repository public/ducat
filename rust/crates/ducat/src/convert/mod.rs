//! Exchange rates: exact rational rates pinned to a currency pair, with where they came from and
//! when they apply; their inverses and chains; rate providers; multi-currency bags; and
//! conversions that round once.
//!
//! ```
//! use ducat::convert::{Rate, RateInfo, Time};
//! use ducat::iso::{Eur, Jpy, Usd};
//! use ducat::{Money, Rounding};
//!
//! let eur_usd: Rate<Eur, Usd> = Rate::parse("1.1165")?;
//! assert_eq!(eur_usd.inverse().to_string(), "2000/2233");
//! let euros: Money<Eur> = "100".parse()?;
//! assert_eq!(eur_usd.convert(&euros, Rounding::HalfEven)?.to_string(), "111.65 USD");
//!
//! let usd_jpy = eur_usd.inverse().and_then(&Rate::<Eur, Jpy>::parse("162.457")?);
//! let dollars: Money<Usd> = "111.65".parse()?;
//! let detailed = usd_jpy.convert_detailed(&dollars, Rounding::HalfEven)?;
//! assert_eq!(detailed.value.to_string(), "16246 JPY");
//!
//! // metadata: a rate valid until the end of a UTC day
//! let dated = eur_usd.with_info(RateInfo {
//!     source: Some("ECB".into()),
//!     valid_until: Some("2026-11-06".parse()?),
//!     ..RateInfo::default()
//! })?;
//! assert!(!dated.is_expired(&"2026-11-06T23:59:59.999Z".parse()?));
//! assert!(dated.is_expired(&"2026-11-07".parse::<Time>()?));
//! # Ok::<(), ducat::Error>(())
//! ```
//!
//! The library never reads a clock: [`AnyRate::is_expired`], [`AnyRate::is_available`] and the
//! strict validity of [`ConvertOptions::valid_at`] take the time as an argument, where ducat's
//! `strictValidity` reads the system clock.
//!
//! Times are read strictly (see [`UtcInstant`]), where ducat accepts whatever JavaScript's
//! `new Date` does; that is a deliberate divergence, ducat issue
//! [#349](https://github.com/public/ducat/issues/349).

#[cfg(feature = "adyen-fx")]
pub mod adyen_fx;
mod bag;
#[cfg(feature = "boc")]
pub mod boc;
#[cfg(feature = "boe")]
pub mod boe;
#[cfg(feature = "ecb")]
pub mod ecb;
#[cfg(feature = "fed")]
pub mod fed;
#[cfg(feature = "history")]
pub mod history;
#[cfg(feature = "hmrc")]
pub mod hmrc;
#[cfg(feature = "serde")]
mod json;
#[cfg(feature = "boc")]
mod json_value;
mod provider;
#[cfg(any(
    feature = "ecb",
    feature = "history",
    feature = "hmrc",
    feature = "adyen-fx"
))]
mod rate_text;
mod snapshots;
#[cfg(feature = "stripe-fx")]
pub mod stripe_fx;
mod time;

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec::Vec;
use core::fmt;
use core::marker::PhantomData;

#[cfg(test)]
pub(crate) use bag::reference as bag_reference;
pub use bag::{Comparator, MoneyBag, TotalOptions, comparator, sort_by_value, sum_by_currency};
pub use provider::{
    Chain, FromFn, Identity, RateProvider, RateQuery, RateTable, RateTableBuilder, Reversed, Via,
    chain, from_fn, identity, rate_of, reversed, via,
};
pub use snapshots::{
    SnapshotLoader, SnapshotOptions, SnapshotTable, Snapshots, SnapshotsFrom, snapshots,
    snapshots_from,
};
pub use time::{Time, UtcInstant};

pub use crate::date::Date;
use crate::exact::{AnyExactMoney, ExactMoney, Rounded};
use crate::{
    AnyMoney, Currency, CurrencyCode, Error, Factor, Int, Money, Ratio, Rounding, RoundingInput,
};

/// The rate's exact decimal when that terminates, else `num/den`.
fn canonical(f: &mut dyn fmt::Write, ratio: &Ratio) -> fmt::Result {
    match ratio.terminating_scale(0) {
        Some(scale) => {
            let units = ratio
                .round_to_units(scale, Rounding::Unnecessary)
                .map_err(|_| fmt::Error)?;
            crate::amount::Amount { units, scale }.write(f)
        }
        None => write!(f, "{ratio}"),
    }
}

fn positive(rate: Ratio) -> Result<Ratio, Error> {
    if rate.numer().is_positive() {
        Ok(rate)
    } else {
        Err(Error::NonPositiveRate)
    }
}

/// The published digits of a rate's text, when its canonical form would drop some: a decimal with
/// a trailing fraction zero and no leading zero (`1.10`, `136.80`; not `01.50` or `1.1`), as
/// ducat keeps them.
fn published_digits(text: &str) -> Option<RateQuote> {
    let (whole, fraction) = text.split_once('.')?;
    let whole_ok = whole == "0"
        || (!whole.is_empty()
            && !whole.starts_with('0')
            && whole.bytes().all(|byte| byte.is_ascii_digit()));
    let fraction_ok = fraction.ends_with('0') && fraction.bytes().all(|byte| byte.is_ascii_digit());
    (whole_ok && fraction_ok).then(|| RateQuote::new(text))
}

/// How a rate was quoted: `mid`, `bid`, `ask`, or a source's own word (`reference`).
/// [`AnyRate::inverse`] swaps `bid` and `ask`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum RateType {
    /// A mid-market rate.
    Mid,
    /// What a buyer of the base currency pays.
    Bid,
    /// What a seller of the base currency gets.
    Ask,
    /// Any other kind.
    Other(String),
}

impl RateType {
    /// The kind's name, as ducat writes it.
    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
            Self::Mid => "mid",
            Self::Bid => "bid",
            Self::Ask => "ask",
            Self::Other(name) => name,
        }
    }

    /// The type of the inverse rate: `bid` and `ask` swapped.
    #[must_use]
    pub fn opposite(&self) -> Self {
        match self {
            Self::Bid => Self::Ask,
            Self::Ask => Self::Bid,
            other => other.clone(),
        }
    }
}

impl From<&str> for RateType {
    fn from(name: &str) -> Self {
        match name {
            "mid" => Self::Mid,
            "bid" => Self::Bid,
            "ask" => Self::Ask,
            other => Self::Other(other.into()),
        }
    }
}

impl fmt::Display for RateType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// How a source published a rate, kept with it for audit and display. The published direction is
/// `from` → `to`, or `to` → `from` when `inverted`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RateQuote {
    /// The number exactly as published, trailing zeros included (`136.80`).
    pub rate: String,
    /// How many units of the published direction's first currency the number is for: 100 for
    /// "NOK per 100 JPY". `None` for 1. A quote is a positive price for a positive whole number
    /// of units, so a `per` below 1 is refused, whatever the number's sign.
    pub per: Option<i64>,
    /// The source quoted `to` → `from`; the rate is its exact inverse.
    pub inverted: bool,
}

impl RateQuote {
    /// A one-for-one quote in the rate's own direction.
    #[must_use]
    pub fn new(rate: &str) -> Self {
        Self {
            rate: rate.into(),
            per: None,
            inverted: false,
        }
    }

    /// Whether it is the rate itself, one for one and in the same direction.
    #[must_use]
    pub const fn is_direct(&self) -> bool {
        self.per.is_none() && !self.inverted
    }

    /// The rate it describes: `rate ÷ per`, or `per ÷ rate` when inverted.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidQuote`] for a number that isn't positive or a `per` below 1, whatever
    /// the signs; whatever reading `rate` fails with.
    pub fn describes(&self) -> Result<Ratio, Error> {
        let published: Ratio = self.rate.parse()?;
        let per = self.per.unwrap_or(1);
        if !published.numer().is_positive() || per < 1 {
            return Err(Error::InvalidQuote);
        }
        let per = Ratio::from(per);
        if self.inverted {
            per.div(&published)
        } else {
            published.div(&per)
        }
    }
}

/// Where a rate came from, when it applies, and how it was quoted: ducat's `RateInfo`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct RateInfo {
    /// Who published it.
    pub source: Option<String>,
    /// The date or time it applies to.
    pub as_of: Option<Time>,
    /// When it was published: a lookup for an earlier time doesn't get it. A date means from the
    /// start of that UTC day.
    pub available_at: Option<Time>,
    /// The last date or time it applies to. A date is valid all day (UTC).
    pub valid_until: Option<Time>,
    /// How it was quoted.
    pub rate_type: Option<RateType>,
    /// The rate as the source published it, which must describe the rate exactly: the rate is
    /// `quote ÷ per`, or `per ÷ quote` when inverted.
    pub quote: Option<RateQuote>,
}

impl RateInfo {
    /// The timing alone, which a derived rate keeps, with `rate_type`.
    fn timing(&self, rate_type: Option<RateType>) -> Self {
        Self {
            as_of: self.as_of,
            available_at: self.available_at,
            valid_until: self.valid_until,
            rate_type,
            ..Self::default()
        }
    }
}

/// When a source's tables were published, for the parsers that can give a publication time.
#[derive(Clone, Copy, Default)]
pub enum Publication<'a> {
    /// Not known: a lookup at any time on a table's day gets it.
    #[default]
    Unknown,
    /// The time the source says it publishes at (each parser documents it).
    Stated,
    /// The caller's, for each day (or period start), from a fetch log, say.
    Given(&'a dyn Fn(Date) -> Time),
}

impl fmt::Debug for Publication<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Unknown => "Unknown",
            Self::Stated => "Stated",
            Self::Given(_) => "Given(..)",
        })
    }
}

/// Options for a conversion at a rate.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct ConvertOptions {
    /// The result scale (default: the target currency's exponent). Not with a rounding policy,
    /// which has its own.
    pub scale: Option<u16>,
    /// Strict validity at this time: a rate whose `valid_until` has passed then is refused with
    /// [`Error::RateExpired`]. ducat's `strictValidity`, with the clock reading passed in: the
    /// library reads no clock.
    pub valid_at: Option<Time>,
}

/// Options for a conversion through a [`RateProvider`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct ProviderConvertOptions {
    /// The time the rate is wanted for (the lookup's `as_of`).
    pub as_of: Option<Time>,
    /// As [`ConvertOptions::scale`].
    pub scale: Option<u16>,
    /// As [`ConvertOptions::valid_at`].
    pub valid_at: Option<Time>,
}

impl ProviderConvertOptions {
    const fn convert(&self) -> ConvertOptions {
        ConvertOptions {
            scale: self.scale,
            valid_at: self.valid_at,
        }
    }
}

/// An exact exchange rate: one unit of `F` is worth `ratio` units of `T`, with its metadata.
///
/// Inverses and chains are exact; nothing is rounded until an amount is converted, once. It is an
/// [`AnyRate`] with its pair in the type, so converting the wrong currency doesn't compile.
pub struct Rate<F: Currency, T: Currency> {
    inner: AnyRate,
    pair: PhantomData<(F, T)>,
}

impl<F: Currency, T: Currency> Clone for Rate<F, T> {
    fn clone(&self) -> Self {
        Self::of(self.inner.clone())
    }
}

impl<F: Currency, T: Currency> PartialEq for Rate<F, T> {
    /// By value: `"1.10"` equals `"1.1"`, and metadata isn't compared.
    fn eq(&self, other: &Self) -> bool {
        self.inner.ratio == other.inner.ratio
    }
}

impl<F: Currency, T: Currency> Eq for Rate<F, T> {}

impl<F: Currency, T: Currency> Rate<F, T> {
    const fn of(inner: AnyRate) -> Self {
        Self {
            inner,
            pair: PhantomData,
        }
    }

    /// The rate `rate`, exactly.
    ///
    /// # Errors
    ///
    /// [`Error::NonPositiveRate`] unless it is positive, and whatever reading it fails with.
    pub fn new(rate: impl Factor) -> Result<Self, Error> {
        AnyRate::new(F::CODE, T::CODE, rate).map(Self::of)
    }

    /// A rate from text (`"1.1165"`, `"2000/2233"`), keeping the digits it was published with
    /// when its exact decimal would drop trailing zeros: `"136.80"` prints as `136.80`, and
    /// `"01.50"` as `1.5`, as ducat's `exchangeRate` does.
    ///
    /// # Errors
    ///
    /// As [`Rate::new`].
    pub fn parse(text: &str) -> Result<Self, Error> {
        AnyRate::parse(F::CODE, T::CODE, text).map(Self::of)
    }

    /// The same rate with `info` as its metadata; see [`AnyRate::with_info`].
    ///
    /// # Errors
    ///
    /// As [`AnyRate::with_info`].
    pub fn with_info(self, info: RateInfo) -> Result<Self, Error> {
        self.inner.with_info(info).map(Self::of)
    }

    /// The rate the provider has for `F` → `T`: ducat's `rateOf`.
    ///
    /// # Errors
    ///
    /// As [`rate_of`].
    pub fn lookup<P: RateProvider + ?Sized>(
        provider: &P,
        query: &RateQuery,
    ) -> Result<Self, Error> {
        rate_of(provider, F::CODE, T::CODE, query).map(Self::of)
    }

    /// The exact rate that took `presented` to `settled`: `settled ÷ presented`, to audit what a
    /// processor applied. ducat's `impliedRate` without `info`: chain [`Rate::with_info`], or
    /// see [`AnyRate::implied`].
    ///
    /// # Errors
    ///
    /// As [`AnyRate::implied`].
    pub fn implied(presented: &Money<F>, settled: &Money<T>) -> Result<Self, Error> {
        AnyRate::implied(&presented.to_any(), &settled.to_any(), RateInfo::default()).map(Self::of)
    }

    /// The exact rate.
    #[must_use]
    pub const fn ratio(&self) -> &Ratio {
        &self.inner.ratio
    }

    /// The source currency.
    #[must_use]
    pub const fn from(&self) -> CurrencyCode {
        F::CODE
    }

    /// The target currency.
    #[must_use]
    pub const fn to(&self) -> CurrencyCode {
        T::CODE
    }

    /// The metadata.
    #[must_use]
    pub const fn info(&self) -> &RateInfo {
        &self.inner.info
    }

    /// The rates a derived rate was built from; empty for one that wasn't derived.
    #[must_use]
    pub fn derived_from(&self) -> &[AnyRate] {
        &self.inner.derived_from
    }

    /// The exact reciprocal; see [`AnyRate::inverse`].
    #[must_use]
    pub fn inverse(&self) -> Rate<T, F> {
        Rate::of(self.inner.inverse())
    }

    /// The exact composite `F` → `T` → `N`; see [`AnyRate::and_then`].
    #[must_use]
    pub fn and_then<N: Currency>(&self, next: &Rate<T, N>) -> Rate<F, N> {
        Rate::of(self.inner.compose(&next.inner))
    }

    /// This rate × (1 + `margin`), exactly; see [`AnyRate::with_margin`].
    ///
    /// # Errors
    ///
    /// As [`AnyRate::with_margin`].
    pub fn with_margin(&self, margin: impl Factor) -> Result<Self, Error> {
        self.inner.with_margin(margin).map(Self::of)
    }

    /// A new rate rounded once to `places` decimals; see [`AnyRate::round`].
    ///
    /// # Errors
    ///
    /// As [`AnyRate::round`].
    pub fn round(&self, places: u16, rounding: Rounding) -> Result<Self, Error> {
        self.inner.round(places, rounding).map(Self::of)
    }

    /// The rate with exactly `places` decimals, for display; the rate itself keeps every digit.
    ///
    /// # Errors
    ///
    /// As [`AnyRate::to_decimal`].
    pub fn to_decimal(&self, places: u16, rounding: Rounding) -> Result<String, Error> {
        self.inner.to_decimal(places, rounding)
    }

    /// Whether its `valid_until` has passed at `now`; see [`AnyRate::is_expired`].
    #[must_use]
    pub fn is_expired(&self, now: &Time) -> bool {
        self.inner.is_expired(now)
    }

    /// Whether it had been published by `at`; see [`AnyRate::is_available`].
    #[must_use]
    pub fn is_available(&self, at: &Time) -> bool {
        self.inner.is_available(at)
    }

    /// Strict validity at `at`: ducat's `Rate#checkValidity`; see [`AnyRate::check_validity`].
    ///
    /// # Errors
    ///
    /// As [`AnyRate::check_validity`].
    pub fn check_validity(&self, at: &Time) -> Result<(), Error> {
        self.inner.check_validity(at)
    }

    /// Converts `money`, rounding once: with a mode to `T`'s exponent, with a rounding policy to
    /// its scale (by default `T`'s exponent) and increment, its currency checked against `T`.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] with [`Rounding::Unnecessary`] when inexact;
    /// [`Error::CurrencyMismatch`] for a policy for another currency than `T`.
    pub fn convert(
        &self,
        money: &Money<F>,
        rounding: impl Into<RoundingInput>,
    ) -> Result<Money<T>, Error> {
        money.convert(&self.inner.ratio, rounding)
    }

    /// As [`Rate::convert`], with a result scale or strict validity.
    ///
    /// # Errors
    ///
    /// As [`AnyRate::convert_with`].
    pub fn convert_with(
        &self,
        money: &Money<F>,
        rounding: impl Into<RoundingInput>,
        options: &ConvertOptions,
    ) -> Result<Money<T>, Error> {
        let any = self
            .inner
            .convert_with(&money.to_any(), rounding, options)?;
        Ok(Money::from_amount(any.amount))
    }

    /// Converts as [`Rate::convert`] does, and returns what rounding left out: `value +
    /// residual` is exactly `money × rate`.
    ///
    /// # Errors
    ///
    /// As [`Rate::convert`].
    pub fn convert_detailed(
        &self,
        money: &Money<F>,
        rounding: impl Into<RoundingInput>,
    ) -> Result<Rounded<Money<T>, ExactMoney<T>>, Error> {
        self.convert_detailed_with(money, rounding, &ConvertOptions::default())
    }

    /// As [`Rate::convert_detailed`], with a result scale or strict validity, which is checked
    /// first.
    ///
    /// # Errors
    ///
    /// As [`AnyRate::convert_with`].
    pub fn convert_detailed_with(
        &self,
        money: &Money<F>,
        rounding: impl Into<RoundingInput>,
        options: &ConvertOptions,
    ) -> Result<Rounded<Money<T>, ExactMoney<T>>, Error> {
        self.inner.check_options(options)?;
        self.convert_exact(&money.exact())
            .round_with_residual(rounding, options.scale)
    }

    /// Converts an exact amount, rounding nothing.
    #[must_use]
    pub fn convert_exact(&self, exact: &ExactMoney<F>) -> ExactMoney<T> {
        ExactMoney::of(exact.value().mul(&self.inner.ratio))
    }

    /// The same rate with run-time currencies.
    #[must_use]
    pub fn to_any(&self) -> AnyRate {
        self.inner.clone()
    }
}

impl<F: Currency, T: Currency> fmt::Display for Rate<F, T> {
    /// As [`AnyRate`]'s.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.inner.fmt(f)
    }
}

impl<F: Currency, T: Currency> fmt::Debug for Rate<F, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Rate({} → {}: {self})", F::CODE, T::CODE)
    }
}

impl<F: Currency, T: Currency> TryFrom<AnyRate> for Rate<F, T> {
    type Error = Error;

    /// The rate with its pair in the type.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] when its pair isn't `F` → `T`.
    fn try_from(rate: AnyRate) -> Result<Self, Error> {
        rate.check_pair(F::CODE, T::CODE)?;
        Ok(Self::of(rate))
    }
}

/// An exchange rate between currencies known only at run time, with its metadata and the rates it
/// was derived from: as [`Rate`], with [`Error::CurrencyMismatch`] for an amount or a next rate in
/// the wrong currency.
#[derive(Clone)]
pub struct AnyRate {
    from: CurrencyCode,
    to: CurrencyCode,
    ratio: Ratio,
    info: RateInfo,
    derived_from: Vec<Self>,
}

impl PartialEq for AnyRate {
    /// The same pair and the same value; metadata isn't compared.
    fn eq(&self, other: &Self) -> bool {
        self.from == other.from && self.to == other.to && self.ratio == other.ratio
    }
}

impl Eq for AnyRate {}

impl AnyRate {
    const fn of(from: CurrencyCode, to: CurrencyCode, ratio: Ratio) -> Self {
        Self {
            from,
            to,
            ratio,
            info: RateInfo {
                source: None,
                as_of: None,
                available_at: None,
                valid_until: None,
                rate_type: None,
                quote: None,
            },
            derived_from: Vec::new(),
        }
    }

    fn derived(
        from: CurrencyCode,
        to: CurrencyCode,
        ratio: Ratio,
        info: RateInfo,
        inputs: Vec<Self>,
    ) -> Result<Self, Error> {
        Ok(Self {
            info,
            derived_from: inputs,
            ..Self::of(from, to, positive(ratio)?)
        })
    }

    /// The rate `rate` from `from` to `to`, exactly.
    ///
    /// # Errors
    ///
    /// As [`Rate::new`].
    pub fn new(from: CurrencyCode, to: CurrencyCode, rate: impl Factor) -> Result<Self, Error> {
        Ok(Self::of(from, to, positive(rate.to_ratio()?)?))
    }

    /// As [`Rate::parse`].
    ///
    /// # Errors
    ///
    /// As [`Rate::new`].
    pub fn parse(from: CurrencyCode, to: CurrencyCode, text: &str) -> Result<Self, Error> {
        let mut rate = Self::of(from, to, positive(text.parse()?)?);
        rate.info.quote = published_digits(text);
        Ok(rate)
    }

    /// The exact rate that took `presented` to `settled`, in their currencies: `settled ÷
    /// presented`, with `info` as its metadata (`RateInfo::default()` for none), as ducat's
    /// `impliedRate(presented, settled, info)`. A refund, both amounts negative, gives a positive
    /// rate.
    ///
    /// # Errors
    ///
    /// In ducat's order: [`Error::DivisionByZero`] for a zero `presented`;
    /// [`Error::NonPositiveRate`] when the quotient isn't positive (a zero `settled`, or amounts
    /// of opposite signs); then as [`AnyRate::with_info`] for a quote in `info` (ducat's
    /// `RangeError`s).
    pub fn implied(
        presented: &AnyMoney,
        settled: &AnyMoney,
        info: RateInfo,
    ) -> Result<Self, Error> {
        let quotient = settled.exact().value().div(presented.exact().value())?;
        Self::of(
            presented.currency(),
            settled.currency(),
            positive(quotient)?,
        )
        .with_info(info)
    }

    /// The same rate with `info` as its metadata, as ducat's `exchangeRate(from, to, rate, info)`
    /// takes it. Every field is replaced, except that without a quote in `info` the digits the
    /// rate was parsed with are kept.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidQuote`] when `info` has a quote whose number isn't positive or whose `per`
    /// is below 1; [`Error::QuoteMismatch`] when its quote doesn't describe the rate exactly (the
    /// rate is `quote ÷ per`, or `per ÷ quote` when inverted); whatever reading the quote's number
    /// fails with. So the inverse, which flips `inverted`, always describes its rate too.
    pub fn with_info(mut self, info: RateInfo) -> Result<Self, Error> {
        if let Some(quote) = &info.quote {
            if quote.describes()? != self.ratio {
                return Err(Error::QuoteMismatch);
            }
        }
        let kept = self.info.quote.take();
        self.info = info;
        if self.info.quote.is_none() {
            self.info.quote = kept;
        }
        Ok(self)
    }

    /// The exact rate.
    #[must_use]
    pub const fn ratio(&self) -> &Ratio {
        &self.ratio
    }

    /// The source currency.
    #[must_use]
    pub const fn from(&self) -> CurrencyCode {
        self.from
    }

    /// The target currency.
    #[must_use]
    pub const fn to(&self) -> CurrencyCode {
        self.to
    }

    /// The metadata.
    #[must_use]
    pub const fn info(&self) -> &RateInfo {
        &self.info
    }

    /// The rates a derived rate was built from (its audit chain); empty for one that wasn't
    /// derived.
    #[must_use]
    pub fn derived_from(&self) -> &[Self] {
        &self.derived_from
    }

    fn check_pair(&self, from: CurrencyCode, to: CurrencyCode) -> Result<(), Error> {
        if self.from != from {
            return Err(Error::CurrencyMismatch {
                expected: from,
                actual: self.from,
            });
        }
        if self.to != to {
            return Err(Error::CurrencyMismatch {
                expected: to,
                actual: self.to,
            });
        }
        Ok(())
    }

    /// The exact reciprocal, `to` → `from`. A `bid` becomes an `ask` and vice versa; the timing
    /// and the quote are kept (the quote marked, or unmarked, as inverted), the source isn't.
    #[must_use]
    pub fn inverse(&self) -> Self {
        let rate_type = self.info.rate_type.as_ref().map(RateType::opposite);
        let mut info = self.info.timing(rate_type);
        info.quote = self.info.quote.clone().map(|quote| RateQuote {
            inverted: !quote.inverted,
            ..quote
        });
        // a positive ratio always has a positive reciprocal
        let reciprocal = self.ratio.recip().unwrap_or(Ratio::ONE);
        Self {
            info,
            derived_from: alloc::vec![self.clone()],
            ..Self::of(self.to, self.from, reciprocal)
        }
    }

    fn compose(&self, next: &Self) -> Self {
        let rate_type = if self.info.rate_type == next.info.rate_type {
            self.info.rate_type.clone()
        } else {
            None
        };
        let info = RateInfo {
            as_of: time::oldest(self.info.as_of, next.info.as_of),
            available_at: time::latest(self.info.available_at, next.info.available_at),
            valid_until: time::earliest_end(self.info.valid_until, next.info.valid_until),
            rate_type,
            ..RateInfo::default()
        };
        Self {
            info,
            derived_from: alloc::vec![self.clone(), next.clone()],
            ..Self::of(self.from, next.to, self.ratio.mul(&next.ratio))
        }
    }

    /// The exact composite of this rate and `next`. Nothing is rounded. It is known once both
    /// are and valid while both are: the oldest `as_of`, the latest `available_at` and the
    /// `valid_until` that ends first, compared as times (a date `valid_until` covers its whole
    /// UTC day; an instant wins a tie). It keeps a type only when both have the same one.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] when `next` isn't from this rate's target.
    pub fn and_then(&self, next: &Self) -> Result<Self, Error> {
        if next.from != self.to {
            return Err(Error::CurrencyMismatch {
                expected: self.to,
                actual: next.from,
            });
        }
        Ok(self.compose(next))
    }

    /// This rate × (1 + `margin`), exactly: `with_margin("-0.02")` gives 2% less `to` per `from`.
    /// It keeps the timing, not the type or the quote.
    ///
    /// # Errors
    ///
    /// [`Error::NonPositiveRate`] when the result isn't positive; whatever reading `margin`
    /// fails with.
    pub fn with_margin(&self, margin: impl Factor) -> Result<Self, Error> {
        let factor = Ratio::ONE.add(&margin.to_ratio()?);
        Self::derived(
            self.from,
            self.to,
            self.ratio.mul(&factor),
            self.info.timing(None),
            alloc::vec![self.clone()],
        )
    }

    /// A new rate rounded once to `places` decimals, for quoting rounded rates. It prints as its
    /// exact decimal (`1.10` rounded to 2 places is `1.1`), and keeps the timing and the type.
    ///
    /// # Errors
    ///
    /// [`Error::NonPositiveRate`] when it rounds to zero; [`Error::Rounding`] with
    /// [`Rounding::Unnecessary`] when inexact; [`Error::InvalidScale`].
    pub fn round(&self, places: u16, rounding: Rounding) -> Result<Self, Error> {
        let units = self.ratio.round_to_units(places, rounding)?;
        crate::amount::check_scale(places)?;
        Self::derived(
            self.from,
            self.to,
            Ratio::new(units, Int::ONE.mul_pow10(u32::from(places)))?,
            self.info.timing(self.info.rate_type.clone()),
            alloc::vec![self.clone()],
        )
    }

    /// The rate with exactly `places` decimals, for display; the rate itself keeps every digit.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] with [`Rounding::Unnecessary`] when inexact; [`Error::InvalidScale`].
    pub fn to_decimal(&self, places: u16, rounding: Rounding) -> Result<String, Error> {
        let units = self.ratio.round_to_units(places, rounding)?;
        let amount = crate::amount::Amount {
            units,
            scale: crate::amount::check_scale(places)?,
        };
        let mut text = String::new();
        let _ = amount.write(&mut text);
        Ok(text)
    }

    /// Whether `valid_until` has passed at `now`: never without one. A date `valid_until` is valid
    /// all day (UTC), through 23:59:59.999Z; an instant is valid at itself. A date `now` means the
    /// start of that day.
    #[must_use]
    pub fn is_expired(&self, now: &Time) -> bool {
        self.info
            .valid_until
            .is_some_and(|valid_until| valid_until.has_ended_at(now))
    }

    /// Whether the rate had been published by `at`: always, without an `available_at`. A date
    /// `available_at` means from the start of that UTC day; a date `at` means by its end.
    #[must_use]
    pub fn is_available(&self, at: &Time) -> bool {
        self.info
            .available_at
            .is_none_or(|available_at| available_at.has_started_by(at))
    }

    /// Strict validity at `at`, as ducat's `Rate#checkValidity` with `strictValidity: true` and
    /// the clock reading `at` (ducat reads the system clock; the library reads none). Without
    /// strict validity ducat checks nothing, which here is not calling it. Every conversion with
    /// [`ConvertOptions::valid_at`] calls it, so the check can't differ between them.
    ///
    /// # Errors
    ///
    /// [`Error::RateExpired`] when the rate has a `valid_until` that has passed at `at` (see
    /// [`AnyRate::is_expired`]); never without a `valid_until`.
    pub fn check_validity(&self, at: &Time) -> Result<(), Error> {
        match self.info.valid_until {
            Some(valid_until) if valid_until.has_ended_at(at) => Err(Error::RateExpired {
                from: self.from,
                to: self.to,
                valid_until,
            }),
            _ => Ok(()),
        }
    }

    fn check_options(&self, options: &ConvertOptions) -> Result<(), Error> {
        options
            .valid_at
            .map_or(Ok(()), |at| self.check_validity(&at))
    }

    fn check(&self, currency: CurrencyCode) -> Result<(), Error> {
        if currency == self.from {
            Ok(())
        } else {
            Err(Error::CurrencyMismatch {
                expected: self.from,
                actual: currency,
            })
        }
    }

    /// Converts `money`, rounding once to the target's exponent.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] for money in another currency; otherwise as [`Rate::convert`].
    pub fn convert(
        &self,
        money: &AnyMoney,
        rounding: impl Into<RoundingInput>,
    ) -> Result<AnyMoney, Error> {
        self.check(money.currency())?;
        money.convert(self.to, &self.ratio, rounding)
    }

    /// As [`AnyRate::convert`], at `options.scale` and with strict validity at
    /// `options.valid_at`.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] for money in another currency; [`Error::RateExpired`] when the
    /// rate has expired at `options.valid_at`; [`Error::ScaleWithPolicy`] for a scale with a
    /// rounding policy; otherwise as [`Rate::convert`].
    pub fn convert_with(
        &self,
        money: &AnyMoney,
        rounding: impl Into<RoundingInput>,
        options: &ConvertOptions,
    ) -> Result<AnyMoney, Error> {
        self.check(money.currency())?;
        self.check_options(options)?;
        match options.scale {
            None => money.convert(self.to, &self.ratio, rounding),
            Some(scale) => self
                .convert_exact(&money.exact())?
                .round(rounding, Some(scale)),
        }
    }

    /// As [`Rate::convert_detailed`].
    ///
    /// # Errors
    ///
    /// As [`AnyRate::convert`].
    pub fn convert_detailed(
        &self,
        money: &AnyMoney,
        rounding: impl Into<RoundingInput>,
    ) -> Result<Rounded<AnyMoney, AnyExactMoney>, Error> {
        self.convert_detailed_with(money, rounding, &ConvertOptions::default())
    }

    /// As [`Rate::convert_detailed_with`].
    ///
    /// # Errors
    ///
    /// As [`AnyRate::convert_with`].
    pub fn convert_detailed_with(
        &self,
        money: &AnyMoney,
        rounding: impl Into<RoundingInput>,
        options: &ConvertOptions,
    ) -> Result<Rounded<AnyMoney, AnyExactMoney>, Error> {
        self.check(money.currency())?;
        self.check_options(options)?;
        self.convert_exact(&money.exact())?
            .round_with_residual(rounding, options.scale)
    }

    /// Converts an exact amount, rounding nothing.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] for an amount in another currency.
    pub fn convert_exact(&self, exact: &AnyExactMoney) -> Result<AnyExactMoney, Error> {
        self.check(exact.currency())?;
        Ok(AnyExactMoney::of(exact.value().mul(&self.ratio), self.to))
    }
}

impl fmt::Display for AnyRate {
    /// The exact rate: the digits it was published with when it has a one-for-one quote
    /// (`136.80`), else its exact decimal when that terminates, or `num/den` (`2000/2233`).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.info.quote {
            Some(quote) if quote.is_direct() => f.write_str(&quote.rate),
            _ => canonical(f, &self.ratio),
        }
    }
}

impl fmt::Debug for AnyRate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "AnyRate({} → {}: {self})", self.from, self.to)
    }
}

impl<F: Currency, T: Currency> From<Rate<F, T>> for AnyRate {
    fn from(rate: Rate<F, T>) -> Self {
        rate.inner
    }
}

impl<F: Currency> Money<F> {
    /// Converts to `T` through `provider`, which is asked for `F` → `T` as of `options.as_of`,
    /// rounding once (ducat's `money.convert(to, provider, rounding, options)`).
    ///
    /// # Errors
    ///
    /// [`Error::RateUnavailable`] when the provider has no rate; [`Error::CurrencyMismatch`]
    /// when it answers for another pair; otherwise as [`AnyRate::convert_with`].
    pub fn convert_through<T: Currency, P: RateProvider + ?Sized>(
        &self,
        provider: &P,
        rounding: impl Into<RoundingInput>,
        options: &ProviderConvertOptions,
    ) -> Result<Money<T>, Error> {
        let any = self
            .to_any()
            .convert_through(T::CODE, provider, rounding, options)?;
        Ok(Money::from_amount(any.amount))
    }
}

impl AnyMoney {
    /// As [`Money::convert_through`], to `to`.
    ///
    /// # Errors
    ///
    /// As [`Money::convert_through`].
    pub fn convert_through<P: RateProvider + ?Sized>(
        &self,
        to: CurrencyCode,
        provider: &P,
        rounding: impl Into<RoundingInput>,
        options: &ProviderConvertOptions,
    ) -> Result<Self, Error> {
        let query = RateQuery {
            as_of: options.as_of,
        };
        rate_of(provider, self.currency(), to, &query)?.convert_with(
            self,
            rounding,
            &options.convert(),
        )
    }
}

/// Boxed providers chain as one; see [`chain`].
pub type BoxedProvider<'a> = Box<dyn RateProvider + 'a>;
