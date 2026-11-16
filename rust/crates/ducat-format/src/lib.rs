//! Locale formatting and parsing of money for [`ducat`]: a port of ducat's `@ducatjs/money/format`
//! and `@ducatjs/money/parse`, from CLDR 48's data (the repository's `data/cldr/`, with the
//! values ICU 78.3 ships instead of CLDR's in `data/icu/`), with no ICU and no floats.
//!
//! ```
//! # #[cfg(all(feature = "en", feature = "de"))] {
//! use ducat::{AnyMoney, CurrencyCode};
//! use ducat_format::{
//!     CurrencyDisplay, FormatOptions, Locale, ParseMoneyOptions, ParseOptions, format, parse,
//!     parse_money,
//! };
//!
//! let eur = CurrencyCode::iso("EUR")?;
//! let price = AnyMoney::parse("1234.5", eur)?;
//! let german = Locale::new("de-DE")?;
//! assert_eq!(format(&price, &german, &FormatOptions::default())?, "1.234,50\u{a0}€");
//! let english = Locale::new("en-GB")?;
//! let code = FormatOptions::new().display(CurrencyDisplay::Code);
//! assert_eq!(format(&price, &english, &code)?, "EUR\u{a0}1,234.50");
//!
//! assert_eq!(parse("1.234,50 €", eur, &german, &ParseOptions::default())?, price);
//! let detected = parse_money("CHF 1’234.50", &Locale::new("de-CH")?, &ParseMoneyOptions::default())?;
//! assert_eq!(detected.to_decimal(), "1234.50");
//! assert_eq!(detected.currency().as_str(), "CHF");
//! # }
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//!
//! It matches ducat's TypeScript on every format and parse vector of ducat's conformance suite,
//! where ducat formats through the runtime's `Intl` (ICU 78.3, which carries CLDR 48). It follows
//! ICU's data where ICU ships other values than CLDR (fr-CH's group separator, my's unit pattern,
//! the separators of a currency's own pattern), not its code's bugs: a currency's name is always
//! written as TR35 has it, the number in the unit pattern with the plural name, with the
//! separators of the currency's symbol form (so [`parse()`] reads it back), the decimal pattern's
//! grouping and no symbol. Rounding is ducat's exact kernel on the decimal; there are no floats.
//!
//! # Locales and what they cost
//!
//! The data covers the 430 locales CLDR rates modern, with one Cargo feature per language
//! (`en`, `de`, `zh`, …; `full` for all 101). A tag the build has no data for falls back by
//! TR35's rules, dropping subtags down to root (`und`): it still formats, and [`Locale::has_data`]
//! says whether parsing will take it. TypeScript's `Intl` knows every locale its runtime ships;
//! here the set is fixed when the crate is built.
//!
//! The default set is 31 languages (313 locales): the languages ducat's vectors use and the most
//! spoken others. Two more default features add data to every built locale: `compact`, CLDR's
//! compact patterns ([`Notation::Compact`]), and `numbering-systems`, the numbering systems other
//! than a locale's default ([`FormatOptions::numbering_system`], `-u-nu-`). In a stripped release
//! binary the default set costs about 1.23 MB of data, 31 KB of it compact patterns and 21 KB
//! numbering systems; `full` about 3.42 MB (81 KB and 33 KB); root alone nearly nothing
//! (`examples/locales.rs` measures it). To keep only what you use:
//!
//! ```toml
//! [dependencies]
//! ducat-format = { version = "…", default-features = false, features = ["std", "en"] }
//! ```
//!
//! The crate needs only `alloc` (`default-features = false` without `std`).
//!
//! # Notation and numbering systems
//!
//! ```
//! # #[cfg(all(feature = "en", feature = "ar", feature = "compact"))] {
//! use ducat::{AnyMoney, CurrencyCode};
//! use ducat_format::{CompactDisplay, CurrencyDisplay, FormatOptions, Locale, Notation, format};
//!
//! let usd = CurrencyCode::iso("USD")?;
//! let revenue = AnyMoney::parse("1234567.89", usd)?;
//! let english = Locale::new("en")?;
//! let compact = FormatOptions::new().notation(Notation::Compact);
//! assert_eq!(format(&revenue, &english, &compact)?, "$1.23M");
//! let long = compact
//!     .display(CurrencyDisplay::Name)
//!     .compact_display(CompactDisplay::Long);
//! assert_eq!(format(&revenue, &english, &long)?, "1.23 million US dollars");
//! let scientific = FormatOptions::new().notation(Notation::Scientific);
//! assert_eq!(format(&revenue, &english, &scientific)?, "$1.23E6");
//! // Egyptian Arabic in Western digits, by the tag or the option
//! let latn = Locale::new("ar-EG-u-nu-latn")?;
//! assert_eq!(format(&revenue, &latn, &FormatOptions::new())?, "\u{200f}1,234,567.89\u{a0}US$");
//! # }
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

// without `compact` there is no Notation::Compact to link to
#![cfg_attr(not(feature = "compact"), doc = "[`Notation::Compact`]: crate::Notation")]
#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]
#![warn(missing_docs)]

extern crate alloc;

#[cfg(feature = "compact")]
mod compact;
// which items a build uses depends on its language features
#[rustfmt::skip]
#[allow(dead_code, unused_imports)]
mod data;
mod error;
mod format;
#[rustfmt::skip]
#[allow(dead_code)]
mod icu;
mod locale;
mod parse;
mod pattern;
mod plural;
mod tables;
mod unicode;

pub use error::{Error, SyntaxError};
pub use format::{
    CompactDisplay, CurrencyDisplay, CurrencySign, FormatOptions, Notation, Part, PartKind,
    RoundingPriority, SignDisplay, TrailingZeroDisplay, UseGrouping, currency_name,
    currency_symbol, format, format_to_parts,
};
pub use locale::{Locale, LocaleMatcher, locales};
pub use parse::{ParseMoneyOptions, ParseOptions, parse, parse_money};

/// The longest text [`parse()`] and [`parse_money`] read, in bytes: an amount is far shorter, and
/// the bound keeps the work per call small.
pub const MAX_INPUT: usize = 1024;

/// The CLDR release the data comes from.
pub const CLDR_VERSION: &str = data::CLDR_VERSION;
/// The ICU release whose overrides of CLDR's data are applied.
pub const ICU_VERSION: &str = icu::ICU_VERSION;
