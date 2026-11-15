//! Property-test strategies and assertion helpers, ducat's `/testing` and `/testing/arbitraries`
//! (the `proptest` feature).
//!
//! The strategies cover what hand-written cases tend to miss, as ducat's fast-check arbitraries
//! do. They weight amounts near zero, near ±2^53 (where ducat switches from number to bigint),
//! near the `i64` and `i128` limits (where [`Int`] moves to the heap) and far beyond. They draw
//! currencies with unusual exponents (JPY 0, KWD 3, CLF 4, custom ones up to 30), and scales above
//! the currency's exponent.
//!
//! | ducat | `ducat::testing` |
//! |---|---|
//! | `arbCurrency(options)` | [`currency_code`] with [`CurrencyOptions`], `any::<CurrencyCode>()` |
//! | `arbMoney(options)` | [`money`] and [`any_money`] with [`MoneyOptions`], `any::<Money<Eur>>()` and `any::<AnyMoney>()` |
//! | (none) | [`int`], [`int_in`], [`ratio`], [`rounding`], [`rounding_policy`], and `any::<T>()` for each type |
//! | `moneyEquality` | nothing to install: `==` on [`Money`] and [`AnyMoney`] is already by value |
//! | `toBeMoney` | [`assert_money_eq!`](crate::assert_money_eq) |
//! | `identical` in tests | [`assert_identical!`](crate::assert_identical) (same value and scale) |
//! | `toHaveCurrency`, `toBeGreaterThanMoney`… | `assert_eq!(price.currency(), …)`, `assert!(a > b)` |
//! | `toSumTo` | `assert_money_eq!(parts.iter().sum::<Money<Eur>>(), total)` |
//! | `moneySerializer` | `Display` (`12.34 EUR`) and `Debug` (`Money(12.34 EUR)`), already on the types |
//!
//! `@ducatjs/money/testing/vitest` and `/testing/jest` have no counterpart. They install the
//! matchers, the equality tester and the snapshot serializer on a JavaScript runner's `expect`.
//! Rust's test harness has no `expect` to extend. The macros above stand in for the matchers, and
//! `==`, `Debug` and `Display` already do what the tester and the serializer add.
//!
//! The strategies return [`BoxedStrategy`]. [`proptest`] is re-exported, so a crate that has only
//! ducat with this feature can use the same proptest version:
//!
//! ```
//! use ducat::iso::Eur;
//! use ducat::testing::proptest::prelude::*;
//! use ducat::testing::{MoneyOptions, money};
//! use ducat::{Money, Rounding};
//!
//! let prices = money::<Eur>(&MoneyOptions::new().scale(2));
//! proptest!(ProptestConfig::with_cases(32), |(price in prices)| {
//!     let thirds = price.divide(3, Rounding::HalfEven).unwrap();
//!     let back = thirds.multiply(3, Rounding::HalfEven).unwrap();
//!     prop_assert!((&back - &price).abs() <= Money::<Eur>::from_minor(1));
//! });
//! ```

use alloc::string::String;
use alloc::vec::Vec;
use core::ops::RangeInclusive;

use num_bigint::{BigInt, BigUint};
#[doc(no_inline)]
pub use proptest;
use proptest::arbitrary::{Arbitrary, any};
use proptest::collection::vec;
use proptest::sample::select;
use proptest::strategy::{BoxedStrategy, Just, Strategy, Union};

#[cfg(feature = "policy")]
use crate::policy::{MAX_INCREMENT, RoundingPolicy};
use crate::{
    AnyMoney, Currency, CurrencyCode, Int, MAX_CUSTOM_EXPONENT, MAX_SCALE, Money, Ratio, Rounding,
};

/// The representative mix of exponents ducat's `arbCurrency` draws from by default.
const REPRESENTATIVE: [&str; 9] = [
    "EUR", "USD", "GBP", "JPY", "KRW", "KWD", "BHD", "TND", "CLF",
];

/// How far from zero [`int`] reaches, as a power of two.
const INT_BITS: u32 = 256;

/// The default of [`MoneyOptions::magnitude`], as a power of ten: beyond `i128::MAX` (about
/// 1.7 × 10^38), so money strategies cross onto the heap.
const MAGNITUDE_DIGITS: u32 = 45;

/// 2^bits.
fn power_of_two(bits: u32) -> Int {
    Int::from_big(BigInt::from(1u8) << bits)
}

// ---------------------------------------------------------------------------------------------
// Int

/// The places [`int_in`] weights: ±(2^53 − 1), where ducat's minor units switch from number to
/// bigint, and the `i64` and `i128` limits, where machine integers end and [`Int`] moves to the
/// heap.
fn edges() -> [Int; 6] {
    let safe = (1i128 << 53) - 1;
    [
        Int::from(safe),
        Int::from(-safe),
        Int::from(i64::MAX),
        Int::from(i64::MIN),
        Int::from(i128::MAX),
        Int::from(i128::MIN),
    ]
}

/// Integers within `radius` of `centre` and within `min..=max`, if any are; they shrink toward
/// `centre`.
fn window(
    parts: &mut Vec<(u32, BoxedStrategy<Int>)>,
    weight: u32,
    centre: &Int,
    radius: i128,
    (min, max): (&Int, &Int),
) {
    let low = core::cmp::max(centre - &Int::from(radius), min.clone());
    let high = core::cmp::min(centre + &Int::from(radius), max.clone());
    if low > high {
        return;
    }
    // both offsets are within ±radius, so they fit an i128
    let from = (&low - centre).to_i128().unwrap_or(0);
    let to = (&high - centre).to_i128().unwrap_or(0);
    let centre = centre.clone();
    parts.push((
        weight,
        (from..=to)
            .prop_map(move |offset| &centre + &Int::from(offset))
            .boxed(),
    ));
}

/// Magnitudes up to `bound`, log-uniform: a bit length first, then the bits, so small and large
/// values are about as likely. They shrink toward zero.
fn magnitude_up_to(bound: BigUint) -> BoxedStrategy<BigUint> {
    let bits = bound.bits();
    (0..=bits)
        .prop_flat_map(move |length| {
            let bound = bound.clone();
            let words = usize::try_from(length.div_ceil(32)).unwrap_or(usize::MAX);
            vec(any::<u32>(), words).prop_map(move |words| {
                if length == 0 {
                    return BigUint::ZERO;
                }
                let one = BigUint::from(1u8);
                let top = &one << (length - 1);
                let value = (BigUint::new(words) % (&top << 1u8)) | top;
                if value > bound {
                    value % (&bound + one)
                } else {
                    value
                }
            })
        })
        .boxed()
}

/// Integers anywhere in `min..=max`, log-uniform, shrinking toward the value nearest zero.
fn spread(min: &Int, max: &Int) -> BoxedStrategy<Int> {
    if !min.is_positive() && !max.is_negative() {
        let up = magnitude_up_to(max.to_big().magnitude().clone())
            .prop_map(|magnitude| Int::from_big(BigInt::from(magnitude)));
        let down = magnitude_up_to(min.to_big().magnitude().clone())
            .prop_map(|magnitude| Int::from_big(-BigInt::from(magnitude)));
        Union::new([up.boxed(), down.boxed()]).boxed()
    } else {
        let span = (max - min).to_big().magnitude().clone();
        let (nearest, positive) = if min.is_positive() {
            (min.clone(), true)
        } else {
            (max.clone(), false)
        };
        magnitude_up_to(span)
            .prop_map(move |offset| {
                let offset = Int::from_big(BigInt::from(offset));
                if positive {
                    &nearest + &offset
                } else {
                    &nearest - &offset
                }
            })
            .boxed()
    }
}

/// Integers in `range`, weighted toward the interesting places: within 10,000 of zero, within
/// 1,000 of ±(2^53 − 1), of the `i64` limits and of the `i128` limits (on both sides, so values
/// move onto the heap and back), the range's own ends, and anywhere in between, log-uniformly.
/// Values shrink toward zero, or toward the end nearest zero.
///
/// # Panics
///
/// When the range is empty.
///
/// ```
/// use ducat::Int;
/// use ducat::testing::int_in;
/// use ducat::testing::proptest::prelude::*;
///
/// let (low, high) = (Int::from(-5), Int::from(i128::MAX) + Int::ONE);
/// proptest!(ProptestConfig::with_cases(32), |(value in int_in(low.clone()..=high.clone()))| {
///     prop_assert!(low <= value && value <= high);
/// });
/// ```
pub fn int_in(range: RangeInclusive<Int>) -> BoxedStrategy<Int> {
    let (min, max) = range.into_inner();
    assert!(min <= max, "int_in: the range {min}..={max} is empty");
    let mut parts = Vec::new();
    window(&mut parts, 3, &Int::ZERO, 10_000, (&min, &max));
    for edge in edges() {
        window(&mut parts, 1, &edge, 1_000, (&min, &max));
    }
    parts.push((1, Just(min.clone()).boxed()));
    parts.push((1, Just(max.clone()).boxed()));
    parts.push((4, spread(&min, &max)));
    Union::new_weighted(parts).boxed()
}

/// Integers within ±2^256: the whole `i128` range and the heap beyond it, weighted as
/// [`int_in`] weights them. This is `any::<Int>()`.
///
/// ```
/// use ducat::testing::int;
/// use ducat::testing::proptest::prelude::*;
///
/// proptest!(ProptestConfig::with_cases(32), |(a in int(), b in int())| {
///     prop_assert_eq!(&(&a + &b) - &b, a);
/// });
/// ```
pub fn int() -> BoxedStrategy<Int> {
    let bound = power_of_two(INT_BITS);
    int_in(-&bound..=bound)
}

impl Arbitrary for Int {
    type Parameters = ();
    type Strategy = BoxedStrategy<Int>;

    /// [`int`].
    ///
    /// ```
    /// use ducat::Int;
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// proptest!(ProptestConfig::with_cases(32), |(value in any::<Int>())| {
    ///     prop_assert_eq!(value.to_string().parse::<Int>().unwrap(), value);
    /// });
    /// ```
    fn arbitrary_with((): ()) -> Self::Strategy {
        int()
    }
}

// ---------------------------------------------------------------------------------------------
// Currencies

/// The pool [`CurrencyOptions`] starts from.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Base {
    Representative,
    AllIso,
    Nothing,
}

/// Which currencies [`currency_code`] draws, as ducat's `ArbCurrencyOptions`.
///
/// The default ([`CurrencyOptions::new`]) is ducat's representative mix of exponents: EUR, USD,
/// GBP, JPY, KRW, KWD, BHD, TND and CLF. The builder methods widen the pool (every ISO code,
/// the historic and crypto tables, generated custom codes, codes of your own), and
/// [`CurrencyOptions::exponents`] narrows whatever pool that is.
///
/// ```
/// use ducat::testing::{CurrencyOptions, currency_code};
/// use ducat::testing::proptest::prelude::*;
///
/// let options = CurrencyOptions::new().all_iso().custom().exponents([0, 3]);
/// proptest!(ProptestConfig::with_cases(32), |(code in currency_code(&options))| {
///     prop_assert!(code.exponent() == 0 || code.exponent() == 3);
/// });
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CurrencyOptions {
    base: Base,
    historic: bool,
    crypto: bool,
    custom: bool,
    extra: Vec<CurrencyCode>,
    exponents: Option<Vec<u8>>,
}

impl Default for CurrencyOptions {
    /// [`CurrencyOptions::new`].
    fn default() -> Self {
        Self::new()
    }
}

impl CurrencyOptions {
    /// ducat's representative mix: EUR, USD, GBP, JPY, KRW, KWD, BHD, TND and CLF (exponents 0,
    /// 2, 3 and 4).
    ///
    /// ```
    /// use ducat::testing::CurrencyOptions;
    ///
    /// assert_eq!(CurrencyOptions::new(), CurrencyOptions::default());
    /// ```
    #[must_use]
    pub const fn new() -> Self {
        Self {
            base: Base::Representative,
            historic: false,
            crypto: false,
            custom: false,
            extra: Vec::new(),
            exponents: None,
        }
    }

    /// Exactly these codes, as ducat's `arbMoney({ currency: 'EUR' })` (the other builder methods
    /// can still add to them).
    ///
    /// ```
    /// use ducat::CurrencyCode;
    /// use ducat::testing::{CurrencyOptions, currency_code};
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// let btc = CurrencyCode::custom("BTC", 8)?;
    /// let options = CurrencyOptions::only([btc]);
    /// proptest!(ProptestConfig::with_cases(8), |(code in currency_code(&options))| {
    ///     prop_assert_eq!(code, btc);
    /// });
    /// # Ok::<(), ducat::Error>(())
    /// ```
    #[must_use]
    pub fn only(codes: impl IntoIterator<Item = CurrencyCode>) -> Self {
        Self {
            base: Base::Nothing,
            ..Self::new()
        }
        .extra(codes)
    }

    /// Every kind of code this build has: every ISO code, the historic and crypto tables (with
    /// the `historic` and `crypto` features) and generated custom codes.
    ///
    /// ```
    /// use ducat::testing::{CurrencyOptions, currency_code};
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// let options = CurrencyOptions::everything();
    /// proptest!(ProptestConfig::with_cases(32), |(code in currency_code(&options))| {
    ///     prop_assert!(code.exponent() <= ducat::MAX_CUSTOM_EXPONENT);
    /// });
    /// ```
    #[must_use]
    pub fn everything() -> Self {
        let options = Self::new().all_iso().custom();
        #[cfg(feature = "historic")]
        let options = options.historic();
        #[cfg(feature = "crypto")]
        let options = options.crypto();
        options
    }

    /// Every ISO 4217 code with a minor unit instead of the representative mix (ducat's
    /// `{ all: true }`).
    ///
    /// ```
    /// use ducat::testing::{CurrencyOptions, currency_code};
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// let options = CurrencyOptions::new().all_iso();
    /// proptest!(ProptestConfig::with_cases(32), |(code in currency_code(&options))| {
    ///     prop_assert!(code.is_iso());
    /// });
    /// ```
    #[must_use]
    pub fn all_iso(mut self) -> Self {
        if self.base == Base::Representative {
            self.base = Base::AllIso;
        } else {
            // after `only`, the ISO codes come in as extras
            self.extra.extend(CurrencyCode::iso_codes());
        }
        self
    }

    /// Adds the withdrawn and non-ISO codes of [`crate::historic`] (HRK, DEM, VEF…), at the
    /// exponents they had.
    ///
    /// ```
    /// use ducat::testing::{CurrencyOptions, currency_code};
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// let options = CurrencyOptions::only([]).historic();
    /// proptest!(ProptestConfig::with_cases(32), |(code in currency_code(&options))| {
    ///     prop_assert!(ducat::historic::currency(code.as_str()).is_some());
    /// });
    /// ```
    #[cfg(feature = "historic")]
    #[must_use]
    pub fn historic(mut self) -> Self {
        self.historic = true;
        self
    }

    /// Adds the crypto codes of [`crate::crypto`] (BTC 8, ETH 18…), at their decimals.
    ///
    /// ```
    /// use ducat::testing::{CurrencyOptions, currency_code};
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// let options = CurrencyOptions::only([]).crypto();
    /// proptest!(ProptestConfig::with_cases(32), |(code in currency_code(&options))| {
    ///     prop_assert!(ducat::crypto::unit(code.as_str()).is_some());
    /// });
    /// ```
    #[cfg(feature = "crypto")]
    #[must_use]
    pub fn crypto(mut self) -> Self {
        self.crypto = true;
        self
    }

    /// Adds generated custom codes ([`CurrencyCode::custom`]): 1 to 12 ASCII letters and digits
    /// (lowercase included, so `eur` next to `EUR`), three-letter ones, and ISO's codes without a
    /// minor unit (XAU, XDR…), each at an exponent from 0 to
    /// [`MAX_CUSTOM_EXPONENT`].
    ///
    /// ```
    /// use ducat::testing::{CurrencyOptions, currency_code};
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// let options = CurrencyOptions::only([]).custom();
    /// proptest!(ProptestConfig::with_cases(32), |(code in currency_code(&options))| {
    ///     prop_assert!(!code.is_iso());
    /// });
    /// ```
    #[must_use]
    pub fn custom(mut self) -> Self {
        self.custom = true;
        self
    }

    /// Adds these codes, such as your own [`CurrencyCode::custom`] ones (ducat's `extra`).
    ///
    /// ```
    /// use ducat::CurrencyCode;
    /// use ducat::testing::{CurrencyOptions, currency_code};
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// let points = CurrencyCode::custom("POINTS", 0)?;
    /// let options = CurrencyOptions::new().extra([points]);
    /// proptest!(ProptestConfig::with_cases(32), |(code in currency_code(&options))| {
    ///     prop_assert!(code == points || code.is_iso());
    /// });
    /// # Ok::<(), ducat::Error>(())
    /// ```
    #[must_use]
    pub fn extra(mut self, codes: impl IntoIterator<Item = CurrencyCode>) -> Self {
        self.extra.extend(codes);
        self
    }

    /// Only currencies with one of these exponents, from whichever pool the others chose (ducat's
    /// `exponents`). Generated custom codes take their exponent from this list.
    ///
    /// ```
    /// use ducat::testing::{CurrencyOptions, currency_code};
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// let options = CurrencyOptions::new().exponents([3]);
    /// proptest!(ProptestConfig::with_cases(32), |(code in currency_code(&options))| {
    ///     prop_assert!(["KWD", "BHD", "TND"].contains(&code.as_str()));
    /// });
    /// ```
    #[must_use]
    pub fn exponents(mut self, exponents: impl IntoIterator<Item = u8>) -> Self {
        self.exponents = Some(exponents.into_iter().collect());
        self
    }

    fn allows(&self, exponent: u8) -> bool {
        self.exponents
            .as_ref()
            .is_none_or(|exponents| exponents.contains(&exponent))
    }

    /// The fixed codes, sorted and without repeats.
    fn pool(&self) -> Vec<CurrencyCode> {
        let mut pool: Vec<CurrencyCode> = match self.base {
            Base::Representative => REPRESENTATIVE
                .iter()
                .map(|code| crate::currency::__iso_or_panic(code))
                .collect(),
            Base::AllIso => CurrencyCode::iso_codes().collect(),
            Base::Nothing => Vec::new(),
        };
        #[cfg(feature = "historic")]
        if self.historic {
            pool.extend(crate::historic::currencies().map(|entry| entry.code()));
        }
        #[cfg(feature = "crypto")]
        if self.crypto {
            pool.extend(crate::crypto::units().map(|unit| unit.code()));
        }
        pool.extend(self.extra.iter().copied());
        pool.retain(|code| self.allows(code.exponent()));
        pool.sort_unstable();
        pool.dedup();
        pool
    }
}

/// The characters of a custom code.
const CODE_CHARACTERS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/// Custom codes at one of `exponents`.
fn custom_code(exponents: Vec<u8>) -> BoxedStrategy<CurrencyCode> {
    let non_monetary: Vec<String> = CurrencyCode::iso_non_monetary().map(String::from).collect();
    let text = Union::new_weighted(alloc::vec![
        (
            2,
            vec(select(CODE_CHARACTERS), 1..=12)
                .prop_map(|bytes| bytes.into_iter().map(char::from).collect::<String>())
                .boxed(),
        ),
        (
            2,
            vec(select(&CODE_CHARACTERS[..26]), 3)
                .prop_map(|bytes| bytes.into_iter().map(char::from).collect::<String>())
                .boxed(),
        ),
        (1, select(non_monetary).boxed()),
    ]);
    (text, select(exponents))
        .prop_filter_map(
            "an active ISO 4217 code can't be custom",
            |(text, exponent)| CurrencyCode::custom(&text, exponent).ok(),
        )
        .boxed()
}

/// Currency codes from `options` (ducat's `arbCurrency`): by default the representative mix of
/// exponents. Drawing is uniform over the fixed codes, with generated custom codes (when
/// [`CurrencyOptions::custom`] asks for them) a quarter of the time.
///
/// # Panics
///
/// When no currency has the requested exponents, as ducat's `RangeError`.
///
/// ```
/// use ducat::testing::{CurrencyOptions, currency_code};
/// use ducat::testing::proptest::prelude::*;
///
/// proptest!(ProptestConfig::with_cases(32), |(code in currency_code(&CurrencyOptions::new()))| {
///     prop_assert!(code.exponent() <= 4);
/// });
/// ```
pub fn currency_code(options: &CurrencyOptions) -> BoxedStrategy<CurrencyCode> {
    let pool = options.pool();
    let mut parts = Vec::new();
    if !pool.is_empty() {
        parts.push((3, select(pool).boxed()));
    }
    if options.custom {
        let exponents: Vec<u8> = (0..=MAX_CUSTOM_EXPONENT)
            .filter(|&exponent| options.allows(exponent))
            .collect();
        if !exponents.is_empty() {
            parts.push((1, custom_code(exponents)));
        }
    }
    assert!(
        !parts.is_empty(),
        "currency_code: no currency has the requested exponents"
    );
    Union::new_weighted(parts).boxed()
}

impl Arbitrary for CurrencyCode {
    type Parameters = CurrencyOptions;
    type Strategy = BoxedStrategy<CurrencyCode>;

    /// [`currency_code`]; `any::<CurrencyCode>()` is the representative mix, and
    /// `any_with::<CurrencyCode>(CurrencyOptions::everything())` every kind of code.
    ///
    /// ```
    /// use ducat::CurrencyCode;
    /// use ducat::testing::CurrencyOptions;
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// let everything = any_with::<CurrencyCode>(CurrencyOptions::everything());
    /// proptest!(ProptestConfig::with_cases(32), |(code in everything)| {
    ///     prop_assert_eq!(code.is_iso(), code.as_str().parse::<CurrencyCode>() == Ok(code));
    /// });
    /// ```
    fn arbitrary_with(options: CurrencyOptions) -> Self::Strategy {
        currency_code(&options)
    }
}

// ---------------------------------------------------------------------------------------------
// Rounding

/// Every rounding mode, [`Rounding::ALL`], uniformly. This is `any::<Rounding>()`.
///
/// ```
/// use ducat::Rounding;
/// use ducat::testing::rounding;
/// use ducat::testing::proptest::prelude::*;
///
/// proptest!(ProptestConfig::with_cases(32), |(mode in rounding())| {
///     prop_assert_eq!(mode.name().parse::<Rounding>(), Ok(mode));
/// });
/// ```
pub fn rounding() -> BoxedStrategy<Rounding> {
    select(Rounding::ALL.to_vec()).boxed()
}

/// Every mode that rounds: all but [`Rounding::Unnecessary`], for operations that must succeed.
///
/// ```
/// use ducat::iso::Eur;
/// use ducat::testing::{MoneyOptions, money, rounding_except_unnecessary};
/// use ducat::testing::proptest::prelude::*;
///
/// let prices = money::<Eur>(&MoneyOptions::new());
/// proptest!(ProptestConfig::with_cases(32), |(price in prices, mode in rounding_except_unnecessary())| {
///     prop_assert!(price.divide(7, mode).is_ok());
/// });
/// ```
pub fn rounding_except_unnecessary() -> BoxedStrategy<Rounding> {
    let modes: Vec<Rounding> = Rounding::ALL
        .into_iter()
        .filter(|&mode| mode != Rounding::Unnecessary)
        .collect();
    select(modes).boxed()
}

impl Arbitrary for Rounding {
    type Parameters = ();
    type Strategy = BoxedStrategy<Rounding>;

    /// [`rounding`].
    ///
    /// ```
    /// use ducat::Rounding;
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// proptest!(ProptestConfig::with_cases(32), |(mode in any::<Rounding>())| {
    ///     prop_assert!(Rounding::ALL.contains(&mode));
    /// });
    /// ```
    fn arbitrary_with((): ()) -> Self::Strategy {
        rounding()
    }
}

/// Rounding policies, unrestricted to a currency: every mode; the currency's exponent, scales 0
/// to 8 or [`MAX_SCALE`]; increments of 1, common ones (5, 10, 25…), any up to
/// [`MAX_INCREMENT`], and that bound itself. This is `any::<RoundingPolicy>()`.
///
/// ```
/// use ducat::iso::Chf;
/// use ducat::testing::{MoneyOptions, money, rounding_policy};
/// use ducat::testing::proptest::prelude::*;
///
/// let prices = money::<Chf>(&MoneyOptions::new());
/// proptest!(ProptestConfig::with_cases(32), |(price in prices, policy in rounding_policy())| {
///     let rounded = price.round(policy);
///     prop_assert!(rounded.is_ok() || policy.mode() == ducat::Rounding::Unnecessary);
/// });
/// ```
#[cfg(feature = "policy")]
pub fn rounding_policy() -> BoxedStrategy<RoundingPolicy> {
    let scales = Union::new_weighted(alloc::vec![
        (3, Just(None).boxed()),
        (4, (0u16..=8).prop_map(Some).boxed()),
        (1, Just(Some(MAX_SCALE)).boxed()),
    ]);
    let increments = Union::new_weighted(alloc::vec![
        (4, Just(1u64).boxed()),
        (
            2,
            select(alloc::vec![2u64, 5, 10, 25, 50, 100, 1000]).boxed()
        ),
        (1, (1..=MAX_INCREMENT).boxed()),
        (1, Just(MAX_INCREMENT).boxed()),
    ]);
    (rounding(), scales, increments)
        .prop_map(|(mode, scale, increment)| {
            let policy = match scale {
                Some(scale) => RoundingPolicy::new(mode).with_scale(scale),
                None => Ok(RoundingPolicy::new(mode)),
            };
            policy
                .and_then(|policy| policy.with_increment(increment))
                .expect("the scales and increments drawn are valid")
        })
        .boxed()
}

/// Rounding policies for `currency`: [`rounding_policy`]'s, half of them restricted to it with
/// [`RoundingPolicy::for_currency`].
///
/// ```
/// use ducat::Currency;
/// use ducat::iso::Jpy;
/// use ducat::testing::rounding_policy_for;
/// use ducat::testing::proptest::prelude::*;
///
/// proptest!(ProptestConfig::with_cases(32), |(policy in rounding_policy_for(Jpy::CODE))| {
///     prop_assert!(policy.currency().is_none_or(|code| code == Jpy::CODE));
/// });
/// ```
#[cfg(feature = "policy")]
pub fn rounding_policy_for(currency: CurrencyCode) -> BoxedStrategy<RoundingPolicy> {
    (rounding_policy(), any::<bool>())
        .prop_map(move |(policy, restricted)| {
            if restricted {
                policy.for_currency(currency)
            } else {
                policy
            }
        })
        .boxed()
}

#[cfg(feature = "policy")]
impl Arbitrary for RoundingPolicy {
    type Parameters = ();
    type Strategy = BoxedStrategy<RoundingPolicy>;

    /// [`rounding_policy`].
    ///
    /// ```
    /// use ducat::policy::RoundingPolicy;
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// proptest!(ProptestConfig::with_cases(32), |(policy in any::<RoundingPolicy>())| {
    ///     prop_assert!(policy.increment() >= 1 && policy.currency().is_none());
    /// });
    /// ```
    fn arbitrary_with((): ()) -> Self::Strategy {
        rounding_policy()
    }
}

// ---------------------------------------------------------------------------------------------
// Ratio

/// Exact ratios: half with a numerator from [`int`] over a positive denominator up to 2^256, half
/// decimals (a denominator of 10^0 to 10^12), as rates and percentages are. This is
/// `any::<Ratio>()`.
///
/// ```
/// use ducat::testing::ratio;
/// use ducat::testing::proptest::prelude::*;
///
/// proptest!(ProptestConfig::with_cases(32), |(factor in ratio())| {
///     prop_assert!(factor.denom().is_positive());
///     prop_assert_eq!(factor.add(&factor.neg()), ducat::Ratio::ZERO);
/// });
/// ```
pub fn ratio() -> BoxedStrategy<Ratio> {
    let general = (int(), int_in(Int::ONE..=power_of_two(INT_BITS)))
        .prop_map(|(numer, denom)| Ratio::new(numer, denom).expect("a positive denominator"));
    let decimal = (int(), 0u32..=12).prop_map(|(numer, places)| {
        Ratio::new(numer, Int::ONE.mul_pow10(places)).expect("a positive denominator")
    });
    Union::new([general.boxed(), decimal.boxed()]).boxed()
}

/// [`ratio`]'s ratios other than zero, for divisors and rates.
///
/// ```
/// use ducat::testing::nonzero_ratio;
/// use ducat::testing::proptest::prelude::*;
///
/// proptest!(ProptestConfig::with_cases(32), |(divisor in nonzero_ratio())| {
///     prop_assert!(divisor.recip().is_ok());
/// });
/// ```
pub fn nonzero_ratio() -> BoxedStrategy<Ratio> {
    ratio()
        .prop_filter("a divisor can't be zero", |factor| !factor.is_zero())
        .boxed()
}

impl Arbitrary for Ratio {
    type Parameters = ();
    type Strategy = BoxedStrategy<Ratio>;

    /// [`ratio`].
    ///
    /// ```
    /// use ducat::Ratio;
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// proptest!(ProptestConfig::with_cases(32), |(factor in any::<Ratio>())| {
    ///     prop_assert_eq!(factor.to_string().parse::<Ratio>().unwrap(), factor);
    /// });
    /// ```
    fn arbitrary_with((): ()) -> Self::Strategy {
        ratio()
    }
}

// ---------------------------------------------------------------------------------------------
// Money

/// What [`money`] and [`any_money`] draw, as ducat's `ArbMoneyOptions`: the currencies, the scale,
/// and bounds on the amount.
///
/// By default: [`CurrencyOptions::new`]'s currencies; mostly the currency's exponent, sometimes
/// one to three more decimals; and amounts up to ±10^45 units of 10^−scale, beyond the `i128`
/// range, weighted as [`int_in`] weights them.
///
/// ```
/// use ducat::iso::Eur;
/// use ducat::testing::{MoneyOptions, money};
/// use ducat::testing::proptest::prelude::*;
/// use ducat::{Money, Ratio};
///
/// let options = MoneyOptions::new().min(Ratio::ZERO).max("100".parse()?).scale(2);
/// proptest!(ProptestConfig::with_cases(32), |(price in money::<Eur>(&options))| {
///     prop_assert!(price >= Money::zero() && price <= "100.00".parse().unwrap());
/// });
/// # Ok::<(), ducat::Error>(())
/// ```
#[derive(Clone, Debug)]
pub struct MoneyOptions {
    currencies: CurrencyOptions,
    scales: Option<RangeInclusive<u16>>,
    min: Option<Ratio>,
    max: Option<Ratio>,
    magnitude: Int,
}

impl Default for MoneyOptions {
    /// [`MoneyOptions::new`].
    fn default() -> Self {
        Self::new()
    }
}

impl MoneyOptions {
    /// The defaults: the representative currencies, mostly the currency's exponent, and amounts
    /// up to ±10^45 units.
    ///
    /// ```
    /// use ducat::testing::{MoneyOptions, any_money};
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// proptest!(ProptestConfig::with_cases(32), |(amount in any_money(&MoneyOptions::new()))| {
    ///     let exponent = u16::from(amount.currency().exponent());
    ///     prop_assert!((exponent..=exponent + 3).contains(&amount.scale()));
    /// });
    /// ```
    #[must_use]
    pub fn new() -> Self {
        Self {
            currencies: CurrencyOptions::new(),
            scales: None,
            min: None,
            max: None,
            magnitude: Int::ONE.mul_pow10(MAGNITUDE_DIGITS),
        }
    }

    /// The currencies [`any_money`] draws ([`money`] has its currency in its type).
    ///
    /// ```
    /// use ducat::testing::{CurrencyOptions, MoneyOptions, any_money};
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// let options = MoneyOptions::new().currencies(CurrencyOptions::everything());
    /// proptest!(ProptestConfig::with_cases(32), |(amount in any_money(&options))| {
    ///     prop_assert!(amount.scale() >= u16::from(amount.currency().exponent()));
    /// });
    /// ```
    #[must_use]
    pub fn currencies(mut self, currencies: CurrencyOptions) -> Self {
        self.currencies = currencies;
        self
    }

    /// Only `currency`, as ducat's `{ currency: 'EUR' }`.
    ///
    /// ```
    /// use ducat::CurrencyCode;
    /// use ducat::testing::{MoneyOptions, any_money};
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// let btc = CurrencyCode::custom("BTC", 8)?;
    /// let options = MoneyOptions::new().currency(btc);
    /// proptest!(ProptestConfig::with_cases(32), |(amount in any_money(&options))| {
    ///     prop_assert_eq!(amount.currency(), btc);
    /// });
    /// # Ok::<(), ducat::Error>(())
    /// ```
    #[must_use]
    pub fn currency(self, currency: CurrencyCode) -> Self {
        self.currencies(CurrencyOptions::only([currency]))
    }

    /// Always this scale.
    ///
    /// # Panics
    ///
    /// For a scale beyond [`MAX_SCALE`].
    ///
    /// ```
    /// use ducat::iso::Jpy;
    /// use ducat::testing::{MoneyOptions, money};
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// proptest!(ProptestConfig::with_cases(32), |(price in money::<Jpy>(&MoneyOptions::new().scale(4)))| {
    ///     prop_assert_eq!(price.scale(), 4);
    /// });
    /// ```
    #[must_use]
    pub fn scale(self, scale: u16) -> Self {
        self.scales(scale..=scale)
    }

    /// Scales in this range, with its two ends weighted, whatever the currency's exponent.
    ///
    /// # Panics
    ///
    /// For an empty range or one reaching beyond [`MAX_SCALE`].
    ///
    /// ```
    /// use ducat::iso::Eur;
    /// use ducat::testing::{MoneyOptions, money};
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// let options = MoneyOptions::new().scales(0..=ducat::MAX_SCALE);
    /// proptest!(ProptestConfig::with_cases(32), |(price in money::<Eur>(&options))| {
    ///     prop_assert!(price.scale() <= ducat::MAX_SCALE);
    /// });
    /// ```
    #[must_use]
    pub fn scales(mut self, scales: RangeInclusive<u16>) -> Self {
        assert!(
            scales.start() <= scales.end() && *scales.end() <= MAX_SCALE,
            "MoneyOptions::scales: {}..={} is empty or beyond MAX_SCALE ({MAX_SCALE})",
            scales.start(),
            scales.end()
        );
        self.scales = Some(scales);
        self
    }

    /// The smallest amount, in major units (ducat's `min`). At each scale it becomes the
    /// smallest amount at that scale that isn't below it.
    ///
    /// ```
    /// use ducat::iso::Kwd;
    /// use ducat::testing::{MoneyOptions, money};
    /// use ducat::testing::proptest::prelude::*;
    /// use ducat::{Money, Ratio};
    ///
    /// let options = MoneyOptions::new().min(Ratio::new(1, 3)?).scale(3);
    /// proptest!(ProptestConfig::with_cases(32), |(price in money::<Kwd>(&options))| {
    ///     prop_assert!(price >= "0.334".parse::<Money<Kwd>>().unwrap());
    /// });
    /// # Ok::<(), ducat::Error>(())
    /// ```
    #[must_use]
    pub fn min(mut self, min: Ratio) -> Self {
        self.min = Some(min);
        self
    }

    /// The largest amount, in major units (ducat's `max`). At each scale it becomes the
    /// largest amount at that scale that isn't above it.
    ///
    /// ```
    /// use ducat::iso::Eur;
    /// use ducat::testing::{MoneyOptions, money};
    /// use ducat::testing::proptest::prelude::*;
    /// use ducat::{Money, Ratio};
    ///
    /// let options = MoneyOptions::new().max(Ratio::from(-1));
    /// proptest!(ProptestConfig::with_cases(32), |(refund in money::<Eur>(&options))| {
    ///     prop_assert!(refund <= "-1.00".parse::<Money<Eur>>().unwrap());
    /// });
    /// ```
    #[must_use]
    pub fn max(mut self, max: Ratio) -> Self {
        self.max = Some(max);
        self
    }

    /// How far the amount reaches on a side without a bound, in units of 10^−scale (10^45 by
    /// default; ducat's arbitraries stop at 10^30).
    ///
    /// ```
    /// use ducat::Int;
    /// use ducat::iso::Usd;
    /// use ducat::testing::{MoneyOptions, money};
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// let options = MoneyOptions::new().magnitude(1_000_000);
    /// proptest!(ProptestConfig::with_cases(32), |(price in money::<Usd>(&options))| {
    ///     prop_assert!(price.units().abs() <= Int::from(1_000_000));
    /// });
    /// ```
    #[must_use]
    pub fn magnitude(mut self, magnitude: impl Into<Int>) -> Self {
        self.magnitude = magnitude.into().abs();
        self
    }

    /// Scales for `currency`.
    fn scale_strategy(&self, currency: CurrencyCode) -> BoxedStrategy<u16> {
        match &self.scales {
            Some(scales) => {
                let (low, high) = (*scales.start(), *scales.end());
                Union::new_weighted(alloc::vec![
                    (1, Just(low).boxed()),
                    (1, Just(high).boxed()),
                    (4, (low..=high).boxed()),
                ])
                .boxed()
            }
            None => {
                let exponent = u16::from(currency.exponent());
                Union::new_weighted(alloc::vec![
                    (3, Just(exponent).boxed()),
                    (1, (exponent + 1..=exponent + 3).boxed()),
                ])
                .boxed()
            }
        }
    }

    /// Units and a scale for an amount of `currency`.
    fn amount_strategy(&self, currency: CurrencyCode) -> BoxedStrategy<(Int, u16)> {
        let (min, max, magnitude) = (self.min.clone(), self.max.clone(), self.magnitude.clone());
        self.scale_strategy(currency)
            .prop_flat_map(move |scale| {
                let low = match &min {
                    Some(min) => min
                        .round_to_units(scale, Rounding::Ceil)
                        .expect("ceil always rounds"),
                    None => -&magnitude,
                };
                let high = match &max {
                    Some(max) => max
                        .round_to_units(scale, Rounding::Floor)
                        .expect("floor always rounds"),
                    None => magnitude.clone(),
                };
                assert!(
                    low <= high,
                    "no {currency} amount at scale {scale} between min and max"
                );
                int_in(low..=high).prop_map(move |units| (units, scale))
            })
            .boxed()
    }
}

/// Amounts in `C` (ducat's `arbMoney` with a currency), drawn as `options` says; its currencies
/// are ignored. This is `any_with::<Money<C>>(options)`.
///
/// # Panics
///
/// When no amount at a drawn scale lies between the bounds (ducat's `RangeError`).
///
/// ```
/// use ducat::iso::Eur;
/// use ducat::testing::{MoneyOptions, money};
/// use ducat::testing::proptest::prelude::*;
/// use ducat::{Money, Rounding};
///
/// proptest!(ProptestConfig::with_cases(32), |(a in money::<Eur>(&MoneyOptions::new()), b in money::<Eur>(&MoneyOptions::new()))| {
///     prop_assert_eq!(&(&a + &b) - &b, a);
/// });
/// ```
pub fn money<C: Currency>(options: &MoneyOptions) -> BoxedStrategy<Money<C>> {
    options
        .amount_strategy(C::CODE)
        .prop_map(|(units, scale)| Money::from_units(units, scale).expect("a valid scale"))
        .boxed()
}

/// Amounts in currencies drawn from `options`'s (ducat's `arbMoney`). This is
/// `any_with::<AnyMoney>(options)`.
///
/// # Panics
///
/// As [`currency_code`] and [`money`] do.
///
/// ```
/// use ducat::testing::{MoneyOptions, any_money};
/// use ducat::testing::proptest::prelude::*;
/// use ducat::AnyMoney;
///
/// proptest!(ProptestConfig::with_cases(32), |(amount in any_money(&MoneyOptions::new()))| {
///     let text = amount.to_string();
///     prop_assert_eq!(text.parse::<AnyMoney>().ok(), amount.round(ducat::Rounding::Unnecessary).ok());
/// });
/// ```
pub fn any_money(options: &MoneyOptions) -> BoxedStrategy<AnyMoney> {
    let options = options.clone();
    currency_code(&options.currencies)
        .prop_flat_map(move |currency| {
            options
                .amount_strategy(currency)
                .prop_map(move |(units, scale)| {
                    AnyMoney::from_units(units, scale, currency).expect("a valid scale")
                })
        })
        .boxed()
}

impl<C: Currency> Arbitrary for Money<C> {
    type Parameters = MoneyOptions;
    type Strategy = BoxedStrategy<Money<C>>;

    /// [`money`].
    ///
    /// ```
    /// use ducat::Money;
    /// use ducat::iso::Jpy;
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// proptest!(ProptestConfig::with_cases(32), |(price in any::<Money<Jpy>>())| {
    ///     prop_assert_eq!(-(-price.clone()), price);
    /// });
    /// ```
    fn arbitrary_with(options: MoneyOptions) -> Self::Strategy {
        money(&options)
    }
}

impl Arbitrary for AnyMoney {
    type Parameters = MoneyOptions;
    type Strategy = BoxedStrategy<AnyMoney>;

    /// [`any_money`].
    ///
    /// ```
    /// use ducat::AnyMoney;
    /// use ducat::testing::proptest::prelude::*;
    ///
    /// proptest!(ProptestConfig::with_cases(32), |(amount in any::<AnyMoney>())| {
    ///     prop_assert_eq!(amount.checked_sub(&amount).map(|zero| zero.is_zero()), Ok(true));
    /// });
    /// ```
    fn arbitrary_with(options: MoneyOptions) -> Self::Strategy {
        any_money(&options)
    }
}

// ---------------------------------------------------------------------------------------------
// Assertions

/// Asserts that two amounts are equal by value, as `==` compares them (ducat's `equals` and
/// `toBeMoney`): the same currency and amount, whatever the scales, so 1.0 EUR equals 1.00 EUR.
/// Either side may be a [`Money`](crate::Money) or an [`AnyMoney`](crate::AnyMoney), by value
/// or by reference.
///
/// On failure it panics with both sides and their scales, and an optional message as
/// [`assert_eq!`]'s:
///
/// ```text
/// assertion `left == right` failed (money, by value): the total
///   left: 1.00 EUR (scale 2)
///  right: 1.001 EUR (scale 3)
/// ```
///
/// ```
/// use ducat::iso::Eur;
/// use ducat::{AnyMoney, Money, assert_money_eq};
///
/// let one: Money<Eur> = "1.00".parse()?;
/// assert_money_eq!(one, Money::<Eur>::from_units(10, 1)?);
/// assert_money_eq!(one, "1.000 EUR".parse::<AnyMoney>()?, "parsed {}", "back");
/// # Ok::<(), ducat::Error>(())
/// ```
#[macro_export]
macro_rules! assert_money_eq {
    ($left:expr, $right:expr $(,)?) => {
        match (&$left, &$right) {
            (left, right) => {
                if *left != *right {
                    ::core::panic!(
                        "assertion `left == right` failed (money, by value)\n  left: {} (scale {})\n right: {} (scale {})",
                        left,
                        left.scale(),
                        right,
                        right.scale(),
                    );
                }
            }
        }
    };
    ($left:expr, $right:expr, $($message:tt)+) => {
        match (&$left, &$right) {
            (left, right) => {
                if *left != *right {
                    ::core::panic!(
                        "assertion `left == right` failed (money, by value): {}\n  left: {} (scale {})\n right: {} (scale {})",
                        ::core::format_args!($($message)+),
                        left,
                        left.scale(),
                        right,
                        right.scale(),
                    );
                }
            }
        }
    };
}

/// Asserts that two amounts are identical: the same currency, amount *and* scale, as ducat's
/// `identical`, for round trips where the scale must survive. 1.0 EUR is `==` to 1.00 EUR but
/// not identical to it. Both sides are [`Money`](crate::Money) in one currency, or both
/// [`AnyMoney`](crate::AnyMoney), by value or by reference.
///
/// On failure it panics with both sides and their scales, and an optional message as
/// [`assert_eq!`]'s:
///
/// ```text
/// assertion `left.identical(right)` failed (same value and scale)
///   left: 1.0 EUR (scale 1)
///  right: 1.00 EUR (scale 2)
/// ```
///
/// ```
/// use ducat::iso::Eur;
/// use ducat::{Money, assert_identical};
///
/// let price: Money<Eur> = Money::from_units(1234, 3)?;
/// let back = Money::<Eur>::parse_at(&price.to_decimal(), 3, ducat::Rounding::Unnecessary)?;
/// assert_identical!(back, price, "{} survives a decimal round trip", price);
/// # Ok::<(), ducat::Error>(())
/// ```
#[macro_export]
macro_rules! assert_identical {
    ($left:expr, $right:expr $(,)?) => {
        match (&$left, &$right) {
            (left, right) => {
                if !left.identical(right) {
                    ::core::panic!(
                        "assertion `left.identical(right)` failed (same value and scale)\n  left: {} (scale {})\n right: {} (scale {})",
                        left,
                        left.scale(),
                        right,
                        right.scale(),
                    );
                }
            }
        }
    };
    ($left:expr, $right:expr, $($message:tt)+) => {
        match (&$left, &$right) {
            (left, right) => {
                if !left.identical(right) {
                    ::core::panic!(
                        "assertion `left.identical(right)` failed (same value and scale): {}\n  left: {} (scale {})\n right: {} (scale {})",
                        ::core::format_args!($($message)+),
                        left,
                        left.scale(),
                        right,
                        right.scale(),
                    );
                }
            }
        }
    };
}
