//! Money as locale text, from CLDR's patterns and symbols: ducat's `format` and `formatToParts`.

use alloc::string::String;
use alloc::vec::Vec;

use ducat::{AnyMoney, Int, MAX_SCALE, Ratio, Rounding};

use crate::Error;
use crate::locale::Locale;
use crate::pattern::{self, Affix, Pattern, Subpattern};
use crate::plural::{self, Operands};
use crate::tables::{Numbers, category_tag};
use crate::unicode;

/// How the currency is shown.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum CurrencyDisplay {
    /// The locale's symbol: `€`, `US$`, `CHF` (`Intl`'s `currencyDisplay: 'symbol'`).
    #[default]
    Symbol,
    /// The narrow symbol: `$` for USD and CAD alike (`'narrowSymbol'`).
    NarrowSymbol,
    /// The ISO code: `EUR` (`'code'`).
    Code,
    /// The name, in the number's plural form and the locale's word order: `1.00 US dollars`
    /// (`'name'`).
    Name,
}

/// How a negative amount is shown.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum CurrencySign {
    /// With the minus sign: `-$1.00` (`Intl`'s `currencySign: 'standard'`).
    #[default]
    Standard,
    /// In the locale's accounting form, often in parentheses: `($1.00)` (`'accounting'`).
    Accounting,
}

/// How the sign is shown: `Intl`'s `signDisplay`.
///
/// A negative amount that `Intl`'s rounding takes to zero (−0.004 at two fraction digits) is a
/// negative zero, as in `Intl`: [`Auto`](Self::Auto) and [`Always`](Self::Always) show its minus
/// sign (`-€0.00`), the others don't. ducat's own `digits` round to a plain zero first.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum SignDisplay {
    /// The minus sign for negative amounts, negative zero included (`'auto'`).
    #[default]
    Auto,
    /// No sign at all: `$1.00` for −1 (`'never'`); in the accounting form too.
    Never,
    /// The plus sign for positive amounts and zero, the minus sign for negative ones (`'always'`).
    Always,
    /// The plus sign for positive amounts, the minus sign for negative ones, none for zero,
    /// negative zero included (`'exceptZero'`).
    ExceptZero,
    /// The minus sign for negative amounts, but not for negative zero (`'negative'`).
    Negative,
}

/// Where group separators go: `Intl`'s `useGrouping`.
///
/// `From<bool>` is `Intl`'s reading of a boolean: `true` is [`Always`](Self::Always), `false`
/// [`Off`](Self::Off).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum UseGrouping {
    /// The locale's group sizes from its minimum grouping digits (CLDR's
    /// `minimumGroupingDigits`: 2 in es and it, so `1234,00 €` but `12.345,00 €`) (`'auto'`).
    #[default]
    Auto,
    /// Grouped from the first group on, whatever the locale's minimum: `1.234,00 €` in es
    /// (`'always'`, `true`); three-digit groups where the pattern has none.
    Always,
    /// Grouped from two digits beyond the first group on, or the locale's minimum if it is more:
    /// `$1234.00` but `$12,345.00` (`'min2'`).
    Min2,
    /// Never grouped (`false`).
    Off,
}

impl From<bool> for UseGrouping {
    fn from(grouping: bool) -> Self {
        if grouping { Self::Always } else { Self::Off }
    }
}

/// Which rounding wins when both fraction and significant digits are given: `Intl`'s
/// `roundingPriority`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum RoundingPriority {
    /// Significant digits when either is given, else fraction digits (`'auto'`).
    #[default]
    Auto,
    /// The rounding that keeps more digits (`'morePrecision'`). Without significant digits they
    /// are 1 to 21, so `1.20` shows as `1.2`: significant digits drop trailing zeros.
    MorePrecision,
    /// The rounding that keeps fewer digits (`'lessPrecision'`).
    LessPrecision,
}

/// Whether a whole amount keeps its fraction digits: `Intl`'s `trailingZeroDisplay`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum TrailingZeroDisplay {
    /// As the fraction digits say (`'auto'`).
    #[default]
    Auto,
    /// None at all when the amount, rounded, is whole: `€5` for 5.00, `€5.50` for 5.5
    /// (`'stripIfInteger'`). A name takes the plural of the number shown (`1 US dollar`).
    StripIfInteger,
}

/// How the number is written: `Intl`'s `notation`.
///
/// The fraction and significant digits round the number as written (the mantissa, `1.23` of
/// `$1.23K`), as ECMA-402 says; ducat's fraction digits default to the amount's scale, so
/// `$1,234.50` is `$1.23K` (ducat always gives `Intl` its fraction digits, so `Intl`'s compact
/// default of at most two significant digits never applies).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Notation {
    /// Plain digits (`'standard'`).
    #[default]
    Standard,
    /// One integer digit and a power of ten: `$1.23E3` (`'scientific'`).
    Scientific,
    /// One to three integer digits and a power of ten divisible by three: `$12.35E3`
    /// (`'engineering'`).
    Engineering,
    /// The locale's abbreviations, CLDR's compact patterns: `$1.23K`, `1,23 Mio. €`, `€15.00L`
    /// (`'compact'`). [`UseGrouping::Auto`] is [`UseGrouping::Min2`] here, as in `Intl`. Needs the
    /// `compact` feature (without it, `"compact"` is [`Error::InvalidOptions`]).
    #[cfg(feature = "compact")]
    Compact,
}

#[cfg_attr(
    not(feature = "compact"),
    doc = "[`Notation::Compact`]: crate::Notation"
)]
/// Which compact patterns [`Notation::Compact`] takes: `Intl`'s `compactDisplay`. A symbol or
/// code always takes CLDR's short currency patterns (it has no long ones), as ICU does; a name
/// takes the decimal patterns of this length (`1.2 thousand US dollars`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum CompactDisplay {
    /// `1.2K` (`'short'`).
    #[default]
    Short,
    /// `1.2 thousand` (`'long'`).
    Long,
}

/// `FromStr` for the option enums: `Intl`'s names, [`Error::InvalidOptions`] (its `RangeError`)
/// for any other.
macro_rules! intl_names {
    ($kind:ty { $($name:literal => $value:expr),* $(,)? }) => {
        impl core::str::FromStr for $kind {
            type Err = Error;

            fn from_str(name: &str) -> Result<Self, Error> {
                match name {
                    $($name => Ok($value),)*
                    _ => Err(Error::InvalidOptions),
                }
            }
        }
    };
}

intl_names!(SignDisplay {
    "auto" => Self::Auto,
    "never" => Self::Never,
    "always" => Self::Always,
    "exceptZero" => Self::ExceptZero,
    "negative" => Self::Negative,
});
// Intl reads the strings "true" and "false" as the default, and "" as false
intl_names!(UseGrouping {
    "auto" => Self::Auto,
    "always" => Self::Always,
    "min2" => Self::Min2,
    "true" => Self::Auto,
    "false" => Self::Auto,
    "" => Self::Off,
});

#[cfg(feature = "compact")]
intl_names!(Notation {
    "standard" => Self::Standard,
    "scientific" => Self::Scientific,
    "engineering" => Self::Engineering,
    "compact" => Self::Compact,
});
#[cfg(not(feature = "compact"))]
intl_names!(Notation {
    "standard" => Self::Standard,
    "scientific" => Self::Scientific,
    "engineering" => Self::Engineering,
});
intl_names!(CompactDisplay {
    "short" => Self::Short,
    "long" => Self::Long,
});
intl_names!(RoundingPriority {
    "auto" => Self::Auto,
    "morePrecision" => Self::MorePrecision,
    "lessPrecision" => Self::LessPrecision,
});
intl_names!(TrailingZeroDisplay {
    "auto" => Self::Auto,
    "stripIfInteger" => Self::StripIfInteger,
});

/// Options of [`format()`]: ducat's `FormatOptions`, which are `Intl.NumberFormat`'s options plus
/// `digits` and `rounding`.
///
/// Without any, the amount is shown with as many fraction digits as its scale, unrounded. With
/// `digits`, it is first rounded once, exactly, to that many decimal places with `rounding`
/// (default half-expand), then shown with them. `Intl`'s fraction and significant digits and
/// rounding increment round too, with `rounding_mode` (default half-expand), as `Intl` does: here
/// on the decimal, exactly, with ducat's rounding kernel. As in ducat, the fraction digits
/// `Intl` is given default to the amount's scale (or `digits`).
///
/// An invoice line: signs on both sides of zero, no grouping, whole amounts without decimals.
///
/// ```
/// # #[cfg(feature = "en")] {
/// use ducat::{AnyMoney, CurrencyCode};
/// use ducat_format::{
///     FormatOptions, Locale, SignDisplay, TrailingZeroDisplay, UseGrouping, format,
/// };
///
/// let usd = CurrencyCode::iso("USD")?;
/// let english = Locale::new("en")?;
/// let line = FormatOptions::new()
///     .sign_display(SignDisplay::ExceptZero)
///     .use_grouping(UseGrouping::Off)
///     .trailing_zero_display(TrailingZeroDisplay::StripIfInteger);
/// assert_eq!(format(&AnyMoney::parse("1234.00", usd)?, &english, &line)?, "+$1234");
/// assert_eq!(format(&AnyMoney::parse("-1234.50", usd)?, &english, &line)?, "-$1234.50");
/// assert_eq!(format(&AnyMoney::parse("0.00", usd)?, &english, &line)?, "$0");
/// # }
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub struct FormatOptions {
    /// How the currency is shown.
    pub currency_display: CurrencyDisplay,
    /// How a negative amount is shown.
    pub currency_sign: CurrencySign,
    /// Decimal places to round to, once and exactly, and to show.
    pub digits: Option<u16>,
    /// How `digits` rounds (default [`Rounding::HalfExpand`]); only with `digits`.
    pub rounding: Option<Rounding>,
    /// `Intl`'s `minimumFractionDigits` (default: the amount's scale).
    pub minimum_fraction_digits: Option<u16>,
    /// `Intl`'s `maximumFractionDigits` (default: the amount's scale).
    pub maximum_fraction_digits: Option<u16>,
    /// `Intl`'s `minimumSignificantDigits`, 1 to 21 (default 1 when significant digits are used).
    pub minimum_significant_digits: Option<u16>,
    /// `Intl`'s `maximumSignificantDigits`, the minimum to 21 (default 21 when significant digits
    /// are used).
    pub maximum_significant_digits: Option<u16>,
    /// `Intl`'s `roundingIncrement`: 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000,
    /// 2500 or 5000 units of the last fraction digit.
    pub rounding_increment: Option<u16>,
    /// `Intl`'s `roundingMode`, how its fraction digits, significant digits and increment round
    /// (default [`Rounding::HalfExpand`]); [`Rounding::Unnecessary`] is no `Intl` mode
    /// ([`Error::InvalidOptions`]). It changes nothing where `Intl` doesn't round (after `digits`).
    pub rounding_mode: Option<Rounding>,
    /// `Intl`'s `roundingPriority`.
    pub rounding_priority: RoundingPriority,
    /// `Intl`'s `minimumIntegerDigits`, 1 to 21: the integer part padded with zeros, which are
    /// grouped as digits are (`$00,001.00`).
    pub minimum_integer_digits: Option<u16>,
    /// `Intl`'s `trailingZeroDisplay`.
    pub trailing_zero_display: TrailingZeroDisplay,
    /// `Intl`'s `signDisplay`.
    pub sign_display: SignDisplay,
    /// `Intl`'s `useGrouping`. In compact notation [`UseGrouping::Auto`] is
    /// [`UseGrouping::Min2`], as in V8 (ICU's compact default, which an explicit `'auto'` gets
    /// too).
    pub use_grouping: UseGrouping,
    /// `Intl`'s `notation`.
    pub notation: Notation,
    #[cfg_attr(
        not(feature = "compact"),
        doc = "[`Notation::Compact`]: crate::Notation"
    )]
    /// `Intl`'s `compactDisplay`: with [`Notation::Compact`], the length of a name's
    /// abbreviations.
    pub compact_display: CompactDisplay,
    /// `Intl`'s `numberingSystem` (`"arab"`, `"latn"`, `"deva"`), over the locale's `-u-nu-`
    /// and its default. One of 3 to 8 letters and digits (or several, joined by `-`), else
    /// [`Error::InvalidOptions`] (`Intl`'s `RangeError`); one this build doesn't support (an
    /// algorithmic one such as `"roman"`, `"native"`, or one without the `numbering-systems`
    /// feature other than the locale's default) is ignored, as `Intl` ignores it.
    pub numbering_system: Option<String>,
}

impl FormatOptions {
    /// The default options.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// With this currency display.
    #[must_use]
    pub const fn display(mut self, display: CurrencyDisplay) -> Self {
        self.currency_display = display;
        self
    }

    /// With this sign display.
    #[must_use]
    pub const fn sign(mut self, sign: CurrencySign) -> Self {
        self.currency_sign = sign;
        self
    }

    /// Rounded once, exactly, to `digits` decimal places with `rounding` (`None` for
    /// half-expand), and shown with them.
    #[must_use]
    pub const fn digits(mut self, digits: u16, rounding: Option<Rounding>) -> Self {
        self.digits = Some(digits);
        self.rounding = rounding;
        self
    }

    /// With `Intl`'s `signDisplay`.
    #[must_use]
    pub const fn sign_display(mut self, sign_display: SignDisplay) -> Self {
        self.sign_display = sign_display;
        self
    }

    /// With `Intl`'s `useGrouping`.
    #[must_use]
    pub const fn use_grouping(mut self, use_grouping: UseGrouping) -> Self {
        self.use_grouping = use_grouping;
        self
    }

    /// With `Intl`'s `notation`.
    #[must_use]
    pub const fn notation(mut self, notation: Notation) -> Self {
        self.notation = notation;
        self
    }

    /// With `Intl`'s `compactDisplay`.
    #[must_use]
    pub const fn compact_display(mut self, compact_display: CompactDisplay) -> Self {
        self.compact_display = compact_display;
        self
    }

    /// With `Intl`'s `numberingSystem`.
    #[must_use]
    pub fn numbering_system(mut self, numbering_system: &str) -> Self {
        self.numbering_system = Some(String::from(numbering_system));
        self
    }

    /// With `Intl`'s `roundingMode`.
    #[must_use]
    pub const fn rounding_mode(mut self, rounding_mode: Rounding) -> Self {
        self.rounding_mode = Some(rounding_mode);
        self
    }

    /// With `Intl`'s `trailingZeroDisplay`.
    #[must_use]
    pub const fn trailing_zero_display(mut self, trailing: TrailingZeroDisplay) -> Self {
        self.trailing_zero_display = trailing;
        self
    }
}

/// The kind of a [`Part`], as `Intl.NumberFormat`'s `formatToParts` names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum PartKind {
    /// Digits before the decimal separator, between group separators.
    Integer,
    /// A group separator.
    Group,
    /// The decimal separator.
    Decimal,
    /// Digits after the decimal separator.
    Fraction,
    /// The minus sign.
    MinusSign,
    /// The plus sign.
    PlusSign,
    /// The currency's symbol, code or name.
    Currency,
    /// Anything else: spaces, parentheses, bidi marks.
    Literal,
    /// A compact pattern's abbreviation (`K`, `Mio.`, `mil millones`), without the spaces and
    /// bidi marks around it, which are literals (as ICU trims them).
    Compact,
    /// The exponent's separator: `E`, `×10^`.
    ExponentSeparator,
    /// The exponent's minus sign.
    ExponentMinusSign,
    /// The exponent's digits.
    ExponentInteger,
}

impl PartKind {
    /// `Intl`'s name for the kind: `"integer"`, `"minusSign"`.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Integer => "integer",
            Self::Group => "group",
            Self::Decimal => "decimal",
            Self::Fraction => "fraction",
            Self::MinusSign => "minusSign",
            Self::PlusSign => "plusSign",
            Self::Currency => "currency",
            Self::Literal => "literal",
            Self::Compact => "compact",
            Self::ExponentSeparator => "exponentSeparator",
            Self::ExponentMinusSign => "exponentMinusSign",
            Self::ExponentInteger => "exponentInteger",
        }
    }
}

/// A piece of formatted text: ducat's `formatToParts` item.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Part {
    /// What the piece is.
    pub kind: PartKind,
    /// Its text.
    pub value: String,
}

/// Which subpattern a number takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SignForm {
    Positive,
    Negative,
    Plus,
}

/// The number to show: its subpattern, its digits in ASCII (`"1234.50"`; in scientific and
/// compact notation the mantissa's, `"1.23"`), and the power of ten they are scaled by.
struct Shown {
    sign: SignForm,
    digits: String,
    /// The power of ten the digits are scaled by: written after them in scientific and
    /// engineering notation, the compact pattern's in compact notation, 0 otherwise.
    exponent: i64,
    /// Whether the exponent is written (`E3`).
    scientific: bool,
    /// The power of ten of the rounded value's leading digit (`None` for zero): which compact
    /// pattern applies.
    #[cfg_attr(not(feature = "compact"), allow(dead_code))]
    magnitude: Option<i64>,
}

impl Shown {
    /// The digits of the value shown, the mantissa times 10^exponent (`"1230"` for `1.23K`),
    /// which a currency name's plural form is chosen for.
    fn value_digits(&self) -> String {
        shifted_digits(&self.digits, self.exponent)
    }
}

/// ASCII digits (`"1.23"`, no sign) times 10^`exponent`, written out.
fn shifted_digits(digits: &str, exponent: i64) -> String {
    if exponent == 0 {
        return String::from(digits);
    }
    let (integer, fraction) = digits.split_once('.').unwrap_or((digits, ""));
    let mut all = String::with_capacity(integer.len() + fraction.len());
    all.push_str(integer);
    all.push_str(fraction);
    // the position of the decimal point in `all`
    let point = i64::try_from(integer.len()).unwrap_or(i64::MAX) + exponent;
    let mut out = String::new();
    if point <= 0 {
        out.push_str("0.");
        for _ in point..0 {
            out.push('0');
        }
        out.push_str(&all);
    } else {
        let point = usize::try_from(point).unwrap_or(usize::MAX);
        if point >= all.len() {
            out.push_str(&all);
            for _ in all.len()..point {
                out.push('0');
            }
        } else {
            out.push_str(&all[..point]);
            out.push('.');
            out.push_str(&all[point..]);
        }
    }
    let trimmed = out.trim_start_matches('0');
    if trimmed.is_empty() || trimmed.starts_with('.') {
        let mut zero = String::from("0");
        zero.push_str(trimmed);
        zero
    } else {
        String::from(trimmed)
    }
}

/// The largest fraction digits `Intl` takes.
const MAX_FRACTION_DIGITS: u16 = 100;

/// The most significant and integer digits `Intl` takes.
const MAX_DIGITS: u16 = 21;

const INCREMENTS: [u16; 15] = [
    1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000,
];

/// `money` rounded to `scale` fraction digits, or an error ducat would report as a range error.
fn rescale(money: &AnyMoney, scale: u16, rounding: Rounding) -> Result<AnyMoney, Error> {
    if scale > MAX_SCALE {
        return Err(Error::InvalidOptions);
    }
    money.to_scale(scale, rounding).map_err(Error::Money)
}

/// 10^`exponent`.
fn pow10(exponent: u32) -> Int {
    let ten = Int::from(10_u8);
    let mut out = Int::from(1_u8);
    for _ in 0..exponent {
        out = out * ten.clone();
    }
    out
}

/// An exact decimal, `units` × 10^−`scale`: an amount, or its mantissa in scientific and
/// compact notation.
#[derive(Clone)]
struct Decimal {
    units: Int,
    scale: i64,
}

impl Decimal {
    fn of(money: &AnyMoney) -> Self {
        Self {
            units: money.units().clone(),
            scale: i64::from(money.scale()),
        }
    }

    /// The value times 10^−`exponent`.
    fn shifted(&self, exponent: i64) -> Self {
        Self {
            units: self.units.clone(),
            scale: self.scale + exponent,
        }
    }

    /// The power of ten of the leading digit, `None` for zero.
    fn magnitude(&self) -> Option<i64> {
        if self.units.is_zero() {
            return None;
        }
        let length = i64::try_from(alloc::format!("{}", self.units.abs()).len()).ok()?;
        Some(length - 1 - self.scale)
    }
}

/// The power of ten of the leading digit of ASCII digits (`"0.05"` is −2), `None` for zero.
fn text_magnitude(text: &str) -> Option<i64> {
    let (integer, fraction) = text.split_once('.').unwrap_or((text, ""));
    let integer = integer.trim_start_matches('0');
    if !integer.is_empty() {
        return i64::try_from(integer.len()).ok().map(|length| length - 1);
    }
    let zeros = fraction.bytes().position(|byte| byte != b'0')?;
    i64::try_from(zeros).ok().map(|zeros| -zeros - 1)
}

/// `Intl`'s digit options, resolved as `SetNumberFormatDigitOptions` resolves them, with ducat's
/// fraction digits (the amount's scale) under the caller's.
struct Digits {
    minimum_integer: usize,
    increment: u16,
    mode: Rounding,
    strip_if_integer: bool,
    /// `(minimum, maximum)` significant digits, where they take part.
    significant: Option<(u16, u16)>,
    /// `(minimum, maximum)` fraction digits, where they take part.
    fraction: Option<(u16, u16)>,
    /// With both: whether the more precise result wins (`morePrecision`).
    more_precise: bool,
}

/// A number rounded as the digit options say: its ASCII digits as shown, whether it is zero, and
/// the power of ten of its leading digit.
struct Rounded {
    text: String,
    zero: bool,
    magnitude: Option<i64>,
}

impl Digits {
    /// The options for an amount at `scale`, or `Intl`'s errors in its order.
    fn new(options: &FormatOptions, scale: u16) -> Result<Self, Error> {
        let in_range = |value: u16, low: u16, high: u16| {
            if (low..=high).contains(&value) {
                Ok(value)
            } else {
                Err(Error::InvalidOptions)
            }
        };
        let minimum_integer = in_range(options.minimum_integer_digits.unwrap_or(1), 1, MAX_DIGITS)?;
        let increment = options.rounding_increment.unwrap_or(1);
        if !INCREMENTS.contains(&increment) {
            return Err(Error::InvalidOptions);
        }
        let mode = match options.rounding_mode {
            None => Rounding::HalfExpand,
            Some(Rounding::Unnecessary) => return Err(Error::InvalidOptions),
            Some(mode) => mode,
        };
        let has_significant = options.minimum_significant_digits.is_some()
            || options.maximum_significant_digits.is_some();
        let auto = options.rounding_priority == RoundingPriority::Auto;
        let significant = if !auto || has_significant {
            let minimum = in_range(
                options.minimum_significant_digits.unwrap_or(1),
                1,
                MAX_DIGITS,
            )?;
            let maximum = in_range(
                options.maximum_significant_digits.unwrap_or(MAX_DIGITS),
                minimum,
                MAX_DIGITS,
            )?;
            Some((minimum, maximum))
        } else {
            None
        };
        // ducat always gives Intl fraction digits, so compact notation's default (ECMA-402's
        // "not hasFd and notation is compact") never applies
        let fraction = if !auto || !has_significant {
            let minimum = in_range(
                options.minimum_fraction_digits.unwrap_or(scale),
                0,
                MAX_FRACTION_DIGITS,
            )?;
            let maximum = in_range(
                options.maximum_fraction_digits.unwrap_or(scale),
                0,
                MAX_FRACTION_DIGITS,
            )?;
            if minimum > maximum {
                return Err(Error::InvalidOptions);
            }
            Some((minimum, maximum))
        } else {
            None
        };
        if increment != 1 {
            match fraction {
                Some((minimum, maximum)) if significant.is_none() => {
                    if minimum != maximum {
                        return Err(Error::InvalidOptions);
                    }
                }
                _ => return Err(Error::IncrementNeedsFractionDigits),
            }
        }
        Ok(Self {
            minimum_integer: usize::from(minimum_integer),
            increment,
            mode,
            strip_if_integer: options.trailing_zero_display == TrailingZeroDisplay::StripIfInteger,
            significant,
            fraction,
            more_precise: options.rounding_priority == RoundingPriority::MorePrecision,
        })
    }

    /// `FormatNumericToString`: the magnitude's ASCII digits as shown, whether the rounded value
    /// is zero, and its magnitude.
    fn apply(&self, x: &Decimal) -> Result<Rounded, Error> {
        let fixed = self
            .fraction
            .map(|(minimum, maximum)| raw_fixed(x, minimum, maximum, self.increment, self.mode))
            .transpose()?;
        let precision = self
            .significant
            .map(|(minimum, maximum)| raw_precision(x, minimum, maximum, self.mode))
            .transpose()?;
        let raw = match (fixed, precision) {
            (Some(fixed), Some(precision)) => {
                let fixed_more_precise = fixed.magnitude < precision.magnitude;
                if fixed_more_precise == self.more_precise {
                    fixed
                } else {
                    precision
                }
            }
            (Some(raw), None) | (None, Some(raw)) => raw,
            (None, None) => return Err(Error::InvalidOptions),
        };
        let magnitude = if raw.zero {
            None
        } else {
            text_magnitude(&raw.text)
        };
        let mut text = raw.text;
        let (integer, fraction) = text.split_once('.').unwrap_or((&text, ""));
        let whole = fraction.bytes().all(|byte| byte == b'0');
        let mut integer_digits = integer.len();
        if self.strip_if_integer && whole {
            text.truncate(integer_digits);
        }
        if integer_digits < self.minimum_integer {
            let mut padded = String::with_capacity(self.minimum_integer + text.len());
            while integer_digits < self.minimum_integer {
                padded.push('0');
                integer_digits += 1;
            }
            padded.push_str(&text);
            text = padded;
        }
        Ok(Rounded {
            text,
            zero: raw.zero,
            magnitude,
        })
    }
}

/// A rounded number: its magnitude's ASCII digits, trailing zeros stripped as asked, whether it
/// is zero, and the power of ten of its last digit (`Intl`'s rounding magnitude).
struct Raw {
    text: String,
    zero: bool,
    magnitude: i64,
}

/// The digits of `count` × 10^`magnitude` (`count`'s magnitude), with −`magnitude` fraction
/// digits, then at most `cut` trailing fraction zeros removed (and a decimal point left last).
fn decimal_text(count: &Int, magnitude: i64, cut: u16) -> Result<String, Error> {
    let digits = alloc::format!("{}", count.abs());
    let mut text = if magnitude >= 0 {
        let mut text = digits;
        if text != "0" {
            for _ in 0..magnitude {
                text.push('0');
            }
        }
        text
    } else {
        let places = usize::try_from(-magnitude).map_err(|_| Error::InvalidOptions)?;
        let mut padded = String::new();
        for _ in digits.len()..=places {
            padded.push('0');
        }
        padded.push_str(&digits);
        padded.insert(padded.len() - places, '.');
        padded
    };
    if text.contains('.') {
        let mut cut = cut;
        while cut > 0 && text.ends_with('0') {
            text.pop();
            cut -= 1;
        }
        if text.ends_with('.') {
            text.pop();
        }
    }
    Ok(text)
}

/// The signed count of `step` × 10^`magnitude` nearest `x` by `mode`, rounded once by ducat's
/// kernel; rounding the signed amount is `Intl`'s unsigned rounding mode for its sign.
fn round_at(x: &Decimal, magnitude: i64, step: u16, mode: Rounding) -> Result<Int, Error> {
    // x / (step × 10^magnitude) = units × 10^-(scale + magnitude) / step
    let shift = x.scale + magnitude;
    let exponent = u32::try_from(shift.unsigned_abs()).map_err(|_| Error::InvalidOptions)?;
    let (numerator, denominator) = if shift >= 0 {
        (x.units.clone(), pow10(exponent) * Int::from(step))
    } else {
        (x.units.clone() * pow10(exponent), Int::from(step))
    };
    let count = Ratio::new(numerator, denominator)
        .and_then(|ratio| ratio.round_to_units(0, mode))
        .map_err(Error::Money)?;
    Ok(count * Int::from(step))
}

/// `ToRawFixed`: `x` rounded to a multiple of `increment` × 10^−`maximum`.
fn raw_fixed(
    x: &Decimal,
    minimum: u16,
    maximum: u16,
    increment: u16,
    mode: Rounding,
) -> Result<Raw, Error> {
    let magnitude = -i64::from(maximum);
    let count = round_at(x, magnitude, increment, mode)?;
    Ok(Raw {
        text: decimal_text(&count, magnitude, maximum - minimum)?,
        zero: count.is_zero(),
        magnitude,
    })
}

/// `ToRawPrecision`: `x` rounded to `maximum` significant digits.
fn raw_precision(x: &Decimal, minimum: u16, maximum: u16, mode: Rounding) -> Result<Raw, Error> {
    let (mut exponent, mut count) = match x.magnitude() {
        None => (0, Int::from(0_u8)),
        Some(exponent) => {
            let count = round_at(x, exponent - i64::from(maximum) + 1, 1, mode)?;
            (exponent, count)
        }
    };
    // rounded up to 10^maximum: one digit more, at the next power of ten
    let digits = alloc::format!("{}", count.abs());
    if digits.len() > usize::from(maximum) {
        exponent += 1;
        let shorter: Int = digits[..digits.len() - 1]
            .parse()
            .map_err(|_| Error::InvalidOptions)?;
        count = if count.is_negative() {
            -shorter
        } else {
            shorter
        };
    }
    let magnitude = exponent - i64::from(maximum) + 1;
    Ok(Raw {
        text: decimal_text(&count, magnitude, maximum - minimum)?,
        zero: count.is_zero(),
        magnitude,
    })
}

/// How the notation scales a number: `ComputeExponentForMagnitude`.
#[derive(Clone, Copy)]
enum Scaling {
    /// Standard notation: never.
    None,
    /// Scientific notation: to one integer digit.
    Scientific,
    /// Engineering notation: to a power of ten divisible by three.
    Engineering,
    /// Compact notation: by the compact patterns' zeros.
    #[cfg(feature = "compact")]
    Compact(crate::compact::Table),
}

impl Scaling {
    fn exponent(self, magnitude: i64) -> i64 {
        match self {
            Self::None => 0,
            Self::Scientific => magnitude,
            Self::Engineering => magnitude.div_euclid(3) * 3,
            #[cfg(feature = "compact")]
            Self::Compact(table) => table.exponent(magnitude),
        }
    }
}

/// `x` rounded and scaled as the notation says (ECMA-402's `ComputeExponent`): the rounded
/// mantissa and its exponent. A mantissa rounded up to the next power of ten is scaled again.
fn notate(digits: &Digits, x: &Decimal, scaling: Scaling) -> Result<(Rounded, i64), Error> {
    let Some(magnitude) = x.magnitude() else {
        return Ok((digits.apply(x)?, 0));
    };
    let exponent = scaling.exponent(magnitude);
    let rounded = digits.apply(&x.shifted(exponent))?;
    match rounded.magnitude {
        None => return Ok((rounded, exponent)),
        Some(found) if found == magnitude - exponent => return Ok((rounded, exponent)),
        Some(_) => {}
    }
    let next = scaling.exponent(magnitude + 1);
    if next == exponent {
        return Ok((rounded, exponent));
    }
    Ok((digits.apply(&x.shifted(next))?, next))
}

/// Whether a numbering system name is `Intl`'s `type`: subtags of 3 to 8 letters and digits.
fn is_type(name: &str) -> bool {
    !name.is_empty()
        && name.split('-').all(|part| {
            (3..=8).contains(&part.len()) && part.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
}

/// The amount ducat hands `Intl` (rounded once by `digits`) and `Intl`'s digit options, or the
/// errors in ducat's and `Intl`'s order: ducat's own first, then `numberingSystem`, `notation`
/// (an enum here) and the digit options.
fn prepare(money: &AnyMoney, options: &FormatOptions) -> Result<(Decimal, u16, Digits), Error> {
    let intl_digits = options.minimum_fraction_digits.is_some()
        || options.maximum_fraction_digits.is_some()
        || options.minimum_significant_digits.is_some()
        || options.maximum_significant_digits.is_some()
        || options.rounding_increment.is_some();
    let rounded;
    let money = if options.digits.is_some() || options.rounding.is_some() {
        // ducat rounds once, exactly; Intl's digit options beside it would round again
        let Some(digits) = options.digits else {
            return Err(Error::ConflictingOptions);
        };
        if intl_digits {
            return Err(Error::ConflictingOptions);
        }
        // Intl shows at most 100 fraction digits
        if digits > MAX_FRACTION_DIGITS {
            return Err(Error::InvalidOptions);
        }
        rounded = rescale(
            money,
            digits,
            options.rounding.unwrap_or(Rounding::HalfExpand),
        )?;
        &rounded
    } else {
        money
    };
    if options
        .numbering_system
        .as_deref()
        .is_some_and(|name| !is_type(name))
    {
        return Err(Error::InvalidOptions);
    }
    let digits = Digits::new(options, money.scale())?;
    Ok((Decimal::of(money), money.scale(), digits))
}

/// The number `options` show for `x`, rounded and scaled as they say, and its subpattern.
fn shown(
    x: &Decimal,
    digits: &Digits,
    sign_display: SignDisplay,
    scaling: Scaling,
) -> Result<Shown, Error> {
    let (rounded, exponent) = notate(digits, x, scaling)?;
    // a negative amount Intl rounds to zero is a negative zero (ECMA-402's
    // GetNumberFormatPattern)
    let negative = x.units.is_negative();
    let zero = rounded.zero;
    let sign = match sign_display {
        SignDisplay::Never => SignForm::Positive,
        SignDisplay::Auto | SignDisplay::Always if negative => SignForm::Negative,
        SignDisplay::Auto => SignForm::Positive,
        SignDisplay::Always => SignForm::Plus,
        SignDisplay::ExceptZero | SignDisplay::Negative if negative && !zero => SignForm::Negative,
        SignDisplay::ExceptZero if !zero => SignForm::Plus,
        SignDisplay::ExceptZero | SignDisplay::Negative => SignForm::Positive,
    };
    Ok(Shown {
        sign,
        digits: rounded.text,
        exponent,
        scientific: matches!(scaling, Scaling::Scientific | Scaling::Engineering),
        magnitude: rounded.magnitude.map(|magnitude| magnitude + exponent),
    })
}

/// The group sizes and the minimum grouping digits `use_grouping` gives a pattern's grouping, or
/// `None` for no grouping.
fn group_rule(
    numbers: &Numbers,
    grouping: Option<(usize, usize)>,
    use_grouping: UseGrouping,
) -> Option<((usize, usize), usize)> {
    let locale = usize::from(numbers.minimum_grouping.max(1));
    match use_grouping {
        UseGrouping::Off => None,
        UseGrouping::Auto => grouping.map(|sizes| (sizes, locale)),
        UseGrouping::Min2 => grouping.map(|sizes| (sizes, locale.max(2))),
        // ICU's aligned grouping: three-digit groups where the pattern has none
        UseGrouping::Always => Some((grouping.unwrap_or((3, 3)), 1)),
    }
}

/// Collects characters into parts, merging adjacent characters of one kind.
#[derive(Default)]
struct Parts {
    parts: Vec<Part>,
}

impl Parts {
    fn push(&mut self, kind: PartKind, ch: char) {
        if let Some(last) = self.parts.last_mut() {
            if last.kind == kind {
                last.value.push(ch);
                return;
            }
        }
        let mut value = String::new();
        value.push(ch);
        self.parts.push(Part { kind, value });
    }

    fn push_text(&mut self, kind: PartKind, text: &str) {
        for ch in text.chars() {
            self.push(kind, ch);
        }
    }

    /// A symbol's characters: its bidi marks (format characters) are literals.
    fn push_symbol(&mut self, kind: PartKind, text: &str) {
        for ch in text.chars() {
            self.push(
                if unicode::is_format(ch) {
                    PartKind::Literal
                } else {
                    kind
                },
                ch,
            );
        }
    }

    /// A compact pattern's text: the abbreviation, with the spaces and bidi marks around it
    /// literals (ICU's default ignorables, which it trims from a field).
    fn push_compact(&mut self, text: &str) {
        let start = text.find(|ch| !unicode::is_ignorable(ch));
        let Some(start) = start else {
            self.push_text(PartKind::Literal, text);
            return;
        };
        let end = text
            .char_indices()
            .rev()
            .find(|&(_, ch)| !unicode::is_ignorable(ch))
            .map_or(text.len(), |(at, ch)| at + ch.len_utf8());
        self.push_text(PartKind::Literal, &text[..start]);
        self.push_text(PartKind::Compact, &text[start..end]);
        self.push_text(PartKind::Literal, &text[end..]);
    }

    fn extend(&mut self, other: Self) {
        for part in other.parts {
            self.push_text(part.kind, &part.value);
        }
    }
}

/// Whether currency spacing applies to this character of the currency (CLDR's
/// `[[:^S:]&[:^Z:]]`).
fn spaces(ch: char) -> bool {
    !unicode::is_symbol(ch) && !unicode::is_separator(ch)
}

/// The number's characters: digits in the numbering system, group and decimal separators, and
/// in scientific notation the exponent.
fn number(
    numbers: &Numbers,
    system_digits: &[char; 10],
    (decimal, group): (&str, &str),
    shown: &Shown,
    grouping: Option<((usize, usize), usize)>,
) -> Parts {
    let digits = shown.digits.as_str();
    let (integer, fraction) = digits.split_once('.').unwrap_or((digits, ""));
    let mut out = Parts::default();
    let length = integer.len();
    let grouped = grouping
        .filter(|&((primary, _), minimum)| length >= primary + minimum)
        .map(|(sizes, _)| sizes);
    for (at, byte) in integer.bytes().enumerate() {
        if let Some((primary, secondary)) = grouped {
            let left = length - at;
            if at > 0 && left >= primary && (left == primary || (left - primary) % secondary == 0) {
                out.push_text(PartKind::Group, group);
            }
        }
        out.push(PartKind::Integer, system_digits[usize::from(byte - b'0')]);
    }
    if !fraction.is_empty() {
        out.push_text(PartKind::Decimal, decimal);
        for byte in fraction.bytes() {
            out.push(PartKind::Fraction, system_digits[usize::from(byte - b'0')]);
        }
    }
    if shown.scientific {
        out.push_symbol(PartKind::ExponentSeparator, numbers.exponential);
        if shown.exponent < 0 {
            out.push_symbol(PartKind::ExponentMinusSign, numbers.minus);
        }
        for byte in alloc::format!("{}", shown.exponent.unsigned_abs()).bytes() {
            out.push(
                PartKind::ExponentInteger,
                system_digits[usize::from(byte - b'0')],
            );
        }
    }
    out
}

/// A prefix or suffix; in a compact pattern its text is the abbreviation.
fn affixes(out: &mut Parts, numbers: &Numbers, affixes: &[Affix], currency: &str, compact: bool) {
    for affix in affixes {
        match affix {
            Affix::Literal(text) if compact => out.push_compact(text),
            Affix::Literal(text) => out.push_text(PartKind::Literal, text),
            Affix::Currency => out.push_symbol(PartKind::Currency, currency),
            Affix::Minus => out.push_symbol(PartKind::MinusSign, numbers.minus),
            Affix::Plus => out.push_symbol(PartKind::PlusSign, numbers.plus),
        }
    }
}

/// The currency's symbol, narrow symbol or code in this locale.
fn symbol(locale: &Locale, code: &str, display: CurrencyDisplay) -> &'static str {
    let symbol = || locale.currency_field(code, |entry| entry.field('s'));
    match display {
        CurrencyDisplay::NarrowSymbol => locale
            .currency_field(code, |entry| entry.field('n'))
            .or_else(symbol),
        _ => symbol(),
    }
    .unwrap_or("")
}

/// The currency's name for a number in `category`.
fn name(locale: &Locale, code: &str, category: &str) -> Option<&'static str> {
    locale
        .currency_field(code, |entry| entry.field(category_tag(category)))
        .or_else(|| locale.currency_field(code, |entry| entry.field('5')))
        .or_else(|| locale.currency_field(code, |entry| entry.field('d')))
}

/// Checks the currency is one `Intl` formats: three ASCII letters.
fn currency_code(money: &AnyMoney) -> Result<alloc::string::String, Error> {
    let code = money.currency();
    let code = code.as_str();
    if code.len() != 3 || !code.bytes().all(|byte| byte.is_ascii_alphabetic()) {
        return Err(Error::InvalidCurrency);
    }
    Ok(code.to_ascii_uppercase())
}

/// The subpattern for a sign form.
fn subpattern(pattern: &Pattern, sign: SignForm) -> &Subpattern {
    match sign {
        SignForm::Positive => &pattern.positive,
        SignForm::Negative => &pattern.negative,
        SignForm::Plus => &pattern.plus,
    }
}

/// How the number is written: the numbering system's symbols and digits, the separators, and
/// the grouping.
struct Writer<'a> {
    numbers: &'a Numbers,
    digits: &'a [char; 10],
    separators: (&'a str, &'a str),
    grouping: Option<((usize, usize), usize)>,
}

/// The amount in a subpattern, with currency spacing: a currency that ends (or starts) with a
/// non-symbol touching a digit gets the locale's `insertBetween`. In a compact pattern, the
/// affixes' text is the abbreviation, and a pattern without zeros shows no number (`mille`).
fn in_subpattern(
    writer: &Writer<'_>,
    sub: &Subpattern,
    shown: &Shown,
    currency: &str,
    compact: Option<bool>,
) -> Parts {
    let numbers = writer.numbers;
    let mut out = Parts::default();
    affixes(&mut out, numbers, &sub.prefix, currency, compact.is_some());
    let digits = if compact == Some(false) {
        Parts::default()
    } else {
        number(
            numbers,
            writer.digits,
            writer.separators,
            shown,
            writer.grouping,
        )
    };
    let first_digit = digits
        .parts
        .first()
        .and_then(|part| part.value.chars().next());
    let last_digit = digits
        .parts
        .last()
        .and_then(|part| part.value.chars().last());
    let is_digit = |ch: Option<char>| ch.is_some_and(char::is_numeric);
    if matches!(sub.prefix.last(), Some(Affix::Currency))
        && currency.chars().last().is_some_and(spaces)
        && is_digit(first_digit)
    {
        out.push_text(PartKind::Literal, numbers.spacing.0);
    }
    out.extend(digits);
    if matches!(sub.suffix.first(), Some(Affix::Currency))
        && currency.chars().next().is_some_and(spaces)
        && is_digit(last_digit)
    {
        out.push_text(PartKind::Literal, numbers.spacing.1);
    }
    affixes(&mut out, numbers, &sub.suffix, currency, compact.is_some());
    out
}

/// The amount in a currency or decimal pattern (`source`), or in the compact pattern
/// (`compact`) where one applies, with the source's grouping.
fn in_pattern(
    numbers: &Numbers,
    system_digits: &[char; 10],
    separators: (&str, &str),
    (source, compact): (&str, Option<&str>),
    shown: &Shown,
    currency: &str,
    use_grouping: UseGrouping,
) -> Result<Parts, Error> {
    let pattern = pattern::parse(source).map_err(|_| Error::MalformedData)?;
    let writer = Writer {
        numbers,
        digits: system_digits,
        separators,
        grouping: group_rule(numbers, pattern.grouping, use_grouping),
    };
    if let Some(compact) = compact {
        let (compact, has_number) =
            pattern::parse_compact(compact).map_err(|_| Error::MalformedData)?;
        let sub = subpattern(&compact, shown.sign);
        return Ok(in_subpattern(
            &writer,
            sub,
            shown,
            currency,
            Some(has_number),
        ));
    }
    let sub = subpattern(&pattern, shown.sign);
    Ok(in_subpattern(&writer, sub, shown, currency, None))
}

/// The compact pattern for the shown number from `table`, if one applies (CLDR's plural forms of
/// the mantissa as shown, `1.2` in `1,2 millier`); `None` for standard notation.
#[cfg(feature = "compact")]
fn compact_pattern(locale: &Locale, scaling: Scaling, shown: &Shown) -> Option<&'static str> {
    let Scaling::Compact(table) = scaling else {
        return None;
    };
    let magnitude = shown.magnitude?;
    let category = plural::category(locale.plurals(), &Operands::new(&shown.digits));
    // ICU's explicit 0 and 1 forms, for a whole mantissa
    let (integer, fraction) = shown
        .digits
        .split_once('.')
        .unwrap_or((shown.digits.as_str(), ""));
    let whole = fraction.bytes().all(|byte| byte == b'0');
    let integer = integer.trim_start_matches('0');
    // ICU's `i` keeps the sign: a negative mantissa of 1 isn't the explicit 1 (fr's `mille`, but
    // `-1 millier`)
    let explicit = match (whole, integer) {
        (true, "") => Some('z'),
        (true, "1") if shown.sign != SignForm::Negative => Some('y'),
        _ => None,
    };
    table.pattern(magnitude, explicit, category_tag(category))
}

#[cfg(not(feature = "compact"))]
#[allow(clippy::unnecessary_wraps)]
const fn compact_pattern(_: &Locale, _: Scaling, _: &Shown) -> Option<&'static str> {
    None
}

/// How `options` scale the number, with the compact patterns of the display.
#[allow(unused_variables)]
fn scaling(numbers: &'static Numbers, options: &FormatOptions) -> Scaling {
    match options.notation {
        Notation::Standard => Scaling::None,
        Notation::Scientific => Scaling::Scientific,
        Notation::Engineering => Scaling::Engineering,
        #[cfg(feature = "compact")]
        Notation::Compact => {
            let compact = numbers.compact;
            Scaling::Compact(match options.currency_display {
                CurrencyDisplay::Name => match options.compact_display {
                    // ICU falls back to the short patterns where a locale has no long ones
                    CompactDisplay::Long if !compact.decimal_long.is_empty() => {
                        compact.decimal_long
                    }
                    _ => compact.decimal_short,
                },
                // CLDR has no long currency patterns: ICU takes the short ones
                _ => compact.currency_short,
            })
        }
    }
}

/// The parts of `money` formatted in `locale`: ducat's `formatToParts`.
///
/// A currency CLDR gives its own pattern in the locale (EUR in en-150, en-AT and the other
/// European English locales) is written in that pattern with a symbol, narrow symbol or code,
/// whatever the sign, as ICU's data has it; the accounting form is that pattern too. A name
/// follows TR35 everywhere: the number, with the separators the symbol form uses for the currency
/// (so [`parse()`](crate::parse) reads it back), the decimal pattern's grouping and no symbol, in
/// the unit pattern
/// with the plural name (`-1,234.50 euros` in en-150, `1,234.567 Kuwaiti dinars` in en-NL),
/// never the currency's own pattern or symbol.
///
/// In scientific and engineering notation the number is the rounded mantissa and the exponent,
/// in the same patterns. In compact notation, a number CLDR has a compact pattern for (by its
/// magnitude, rounded, and the plural form of the mantissa shown) is written in that pattern,
/// short currency patterns for a symbol or code, decimal ones of `compact_display` for a name,
/// with the standard pattern's group sizes and the minus or plus sign before it (or in its
/// negative subpattern, where it has one, as sw's; there is no accounting form); other numbers (below a thousand, or `0`
/// patterns such as de's `1000`) take the standard pattern. A name takes the plural form of the
/// whole value with CLDR's `e` operand (`1.5 million euros`), as ICU chooses it.
///
/// # Errors
///
/// [`Error::ConflictingOptions`] for `rounding` without `digits`, or `Intl`'s digit options
/// beside `digits` (ducat's `TypeError`); [`Error::InvalidOptions`] for options out of range
/// (ducat's `RangeError` from `Intl`), a malformed `numbering_system` included;
/// [`Error::InvalidCurrency`] for a code that isn't three letters; [`Error::Money`] where
/// rounding fails.
pub fn format_to_parts(
    money: &AnyMoney,
    locale: &Locale,
    options: &FormatOptions,
) -> Result<Vec<Part>, Error> {
    let code = currency_code(money)?;
    let (x, _, digits) = prepare(money, options)?;
    let (numbers, system_digits) = locale.system(options.numbering_system.as_deref());
    let scaling = scaling(numbers, options);
    let shown = shown(&x, &digits, options.sign_display, scaling)?;
    let compact = compact_pattern(locale, scaling, &shown);
    // compact notation groups from two digits beyond the first group (V8 hands ICU no strategy
    // for auto, and ICU's compact default is min2)
    let use_grouping = match (scaling, options.use_grouping) {
        #[cfg(feature = "compact")]
        (Scaling::Compact(_), UseGrouping::Auto) => UseGrouping::Min2,
        (_, use_grouping) => use_grouping,
    };
    let special = locale.currency_format(&code);
    let special_pattern = special.map(|(pattern, _, _)| pattern);
    let separators = special.map_or((numbers.decimal, numbers.group), |(_, decimal, group)| {
        (decimal, group)
    });
    if options.currency_display != CurrencyDisplay::Name {
        let source = special_pattern.unwrap_or(match options.currency_sign {
            CurrencySign::Standard => numbers.currency_pattern,
            CurrencySign::Accounting => numbers.accounting_pattern,
        });
        let currency: &str = match options.currency_display {
            CurrencyDisplay::Code => &code,
            display => {
                let found = symbol(locale, &code, display);
                if found.is_empty() { &code } else { found }
            }
        };
        return Ok(in_pattern(
            numbers,
            system_digits,
            separators,
            (source, compact),
            &shown,
            currency,
            use_grouping,
        )?
        .parts);
    }
    // a name, as TR35 has it: the number, then the unit pattern for its plural category. The
    // number's sign and grouping come from the locale's decimal pattern (no accounting form; lakhs
    // in ml, mr and or, as Intl writes them); its separators are those the symbol form uses for
    // this currency (a currency's own format's, where it has one), so parse reads it back. A
    // currency's own pattern and symbol never enter it (where ICU's code writes them, it garbles
    // the text: data/icu/README.md).
    let amount = in_pattern(
        numbers,
        system_digits,
        separators,
        (numbers.decimal_pattern, compact),
        &shown,
        "",
        use_grouping,
    )?;
    // the name's plural form, as ICU chooses it: in compact notation the amount's, rounded as
    // standard notation rounds it (ICU picks it before it scales the number: fil's `1.23K euros`
    // for 1234.56, `1.23K euro` for 1234.50); in scientific notation the whole value's with CLDR's
    // `e` operand (fr's `1,5E0 euro`, `1E6 euros`, `1E-3 euros`)
    let value = match scaling {
        #[cfg(feature = "compact")]
        Scaling::Compact(_) => digits.apply(&x)?.text,
        _ => shown.value_digits(),
    };
    let exponent = if shown.scientific { shown.exponent } else { 0 };
    let category = plural::category(
        locale.plurals(),
        &Operands::new(&value).with_exponent(exponent),
    );
    let unit = numbers
        .unit_patterns
        .iter()
        .find(|(found, _)| *found == category)
        .or_else(|| {
            numbers
                .unit_patterns
                .iter()
                .find(|(found, _)| *found == "other")
        })
        .map_or("{0} {1}", |(_, pattern)| *pattern);
    let currency_name = name(locale, &code, category).unwrap_or(&code);
    let mut out = Parts::default();
    let mut rest = unit;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix("{0}") {
            for part in &amount.parts {
                out.push_text(part.kind, &part.value);
            }
            rest = after;
        } else if let Some(after) = rest.strip_prefix("{1}") {
            out.push_symbol(PartKind::Currency, currency_name);
            rest = after;
        } else {
            let ch = rest.chars().next().unwrap_or(' ');
            out.push(PartKind::Literal, ch);
            rest = &rest[ch.len_utf8()..];
        }
    }
    Ok(out.parts)
}

/// `money` formatted in `locale`: ducat's `format`. The text is the parts of
/// [`format_to_parts`], joined.
///
/// # Errors
///
/// As [`format_to_parts`].
pub fn format(money: &AnyMoney, locale: &Locale, options: &FormatOptions) -> Result<String, Error> {
    Ok(format_to_parts(money, locale, options)?
        .into_iter()
        .map(|part| part.value)
        .collect())
}

/// The currency's symbol in `locale` (`€`, `US$`), its narrow symbol, or its code where CLDR has
/// none: ducat's `currencySymbol`, which reads `Intl`.
#[must_use]
pub fn currency_symbol(code: &str, locale: &Locale, narrow: bool) -> &'static str {
    let display = if narrow {
        CurrencyDisplay::NarrowSymbol
    } else {
        CurrencyDisplay::Symbol
    };
    symbol(locale, code, display)
}

/// The currency's display name in `locale` (`US dollar`, `euro`), if CLDR has one: ducat's
/// `currencyName`, which reads `Intl`.
#[must_use]
pub fn currency_name(code: &str, locale: &Locale) -> Option<&'static str> {
    locale.currency_field(code, |entry| entry.field('d'))
}

#[cfg(test)]
mod properties {
    use super::*;
    use crate::locale::Locale;
    use proptest::prelude::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(4096))]

        /// Any pattern text, any digits, any currency text: parts or an error, no panic, and
        /// the parts are the whole text.
        #[test]
        fn writes_any_pattern(
            source in "\\PC{0,48}|[#0,.;'¤+\\- \u{a0}€()]{0,24}",
            integer in "[0-9]{1,40}",
            fraction in "[0-9]{0,12}",
            negative in any::<bool>(),
            currency in "\\PC{0,8}",
        ) {
            let locale = Locale::new("und").unwrap();
            let digits = if fraction.is_empty() { integer } else { alloc::format!("{integer}.{fraction}") };
            let sign = if negative { SignForm::Negative } else { SignForm::Plus };
            let shown = Shown { sign, digits, exponent: 0, scientific: negative, magnitude: None };
            let numbers = locale.numbers();
            if let Ok(parts) = in_pattern(numbers, &numbers.digits, (",", "."), (&source, None), &shown, &currency, UseGrouping::Always) {
                prop_assert!(parts.parts.iter().all(|part| !part.value.is_empty()));
            }
            if let Ok(parts) = in_pattern(numbers, &numbers.digits, (",", "."), ("#,##0", Some(&source)), &shown, &currency, UseGrouping::Always) {
                prop_assert!(parts.parts.iter().all(|part| !part.value.is_empty()));
            }
        }
    }
}
