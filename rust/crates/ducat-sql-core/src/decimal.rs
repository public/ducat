//! `Decimal`, an exact decimal with its scale, and `ColumnSize`.

use core::fmt;
use core::str::FromStr;

use ducat::{AnyMoney, CurrencyCode, Int, MAX_SCALE, Rounding};

use crate::Error;

/// An exact decimal, `units × 10^−scale`, with a scale of at most [`ducat::MAX_SCALE`].
#[derive(Clone, Debug, PartialEq, Eq, Hash, Default)]
pub struct Decimal {
    units: Int,
    scale: u16,
}

impl Decimal {
    /// The decimal `units × 10^−scale`.
    ///
    /// # Errors
    ///
    /// [`Error::Ducat`] with [`ducat::Error::InvalidScale`] for a scale beyond
    /// [`ducat::MAX_SCALE`].
    pub fn new(units: Int, scale: u16) -> Result<Self, Error> {
        if scale > MAX_SCALE {
            return Err(ducat::Error::InvalidScale.into());
        }
        Ok(Self { units, scale })
    }

    /// A money's amount, whose scale ducat keeps within [`ducat::MAX_SCALE`].
    #[must_use]
    pub fn from_money_parts(units: &Int, scale: u16) -> Self {
        Self {
            units: units.clone(),
            scale,
        }
    }

    /// The value in units of 10^−scale.
    #[must_use]
    pub const fn units(&self) -> &Int {
        &self.units
    }

    /// The number of digits after the point.
    #[must_use]
    pub const fn scale(&self) -> u16 {
        self.scale
    }

    /// Money in `currency`, keeping every digit and the scale, but never less than the
    /// currency's exponent (ducat's `parseMoneyComposite`).
    ///
    /// # Errors
    ///
    /// None in practice: the scale only grows, up to [`ducat::MAX_SCALE`].
    pub fn to_money(&self, currency: CurrencyCode) -> Result<AnyMoney, Error> {
        let money = AnyMoney::from_units(self.units.clone(), self.scale, currency)?;
        let exponent = u16::from(currency.exponent());
        if self.scale >= exponent {
            return Ok(money);
        }
        Ok(money.to_scale(exponent, Rounding::Unnecessary)?)
    }

    /// Money in `currency` at the currency's exponent, without rounding (ducat's
    /// `decimalFromDriver`).
    ///
    /// # Errors
    ///
    /// [`Error::Ducat`] with [`ducat::Error::Rounding`] for more significant decimals than the
    /// exponent.
    pub fn to_money_at_exponent(&self, currency: CurrencyCode) -> Result<AnyMoney, Error> {
        let money = AnyMoney::from_units(self.units.clone(), self.scale, currency)?;
        Ok(money.to_scale(u16::from(currency.exponent()), Rounding::Unnecessary)?)
    }

    /// The digits of the magnitude, the integer part's (without leading zeros, possibly empty)
    /// and the fraction's (exactly `scale` digits).
    #[must_use]
    pub fn split_digits(&self) -> (String, String) {
        let digits = self.units.abs().to_string();
        let scale = usize::from(self.scale);
        if digits.len() > scale {
            let (integer, fraction) = digits.split_at(digits.len() - scale);
            let integer = if integer == "0" { "" } else { integer };
            (integer.into(), fraction.into())
        } else {
            let mut fraction = "0".repeat(scale - digits.len());
            fraction.push_str(&digits);
            (String::new(), fraction)
        }
    }

    /// The value from a sign and the digit string of `units` (ASCII digits, maybe empty for 0).
    ///
    /// # Errors
    ///
    /// [`Error::Malformed`] for a character that isn't an ASCII digit; [`Error::Ducat`] with
    /// [`ducat::Error::InvalidScale`] for a scale beyond [`ducat::MAX_SCALE`].
    pub fn from_digits(negative: bool, digits: &str, scale: u16) -> Result<Self, Error> {
        let trimmed = digits.trim_start_matches('0');
        let units = if trimmed.is_empty() {
            Int::ZERO
        } else {
            if !trimmed.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(Error::Malformed("not a decimal digit"));
            }
            let magnitude: Int = trimmed
                .parse()
                .map_err(|_| Error::Malformed("not a decimal digit"))?;
            if negative { -magnitude } else { magnitude }
        };
        Self::new(units, scale)
    }
}

impl fmt::Display for Decimal {
    /// The exact decimal at its scale: `12.34`, `-0.50`, `0.00`, `100`. Never an exponent.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (integer, fraction) = self.split_digits();
        if self.units.is_negative() {
            f.write_str("-")?;
        }
        f.write_str(if integer.is_empty() { "0" } else { &integer })?;
        if !fraction.is_empty() {
            f.write_str(".")?;
            f.write_str(&fraction)?;
        }
        Ok(())
    }
}

impl FromStr for Decimal {
    type Err = Error;

    /// Decimal text, `-?[0-9]+(\.[0-9]+)?` (ducat's `parseNumeric`); `NaN` and the infinities
    /// (Postgres's spellings, any case) are their own errors.
    fn from_str(text: &str) -> Result<Self, Error> {
        if text.eq_ignore_ascii_case("nan") {
            return Err(Error::NotANumber);
        }
        if text.eq_ignore_ascii_case("infinity") || text.eq_ignore_ascii_case("inf") {
            return Err(Error::Infinite { negative: false });
        }
        if text.eq_ignore_ascii_case("-infinity") || text.eq_ignore_ascii_case("-inf") {
            return Err(Error::Infinite { negative: true });
        }
        let (negative, rest) = match text.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, text),
        };
        let (integer, fraction) = match rest.split_once('.') {
            Some((integer, fraction)) => (integer, fraction),
            None => (rest, ""),
        };
        let is_digits = |part: &str| part.bytes().all(|byte| byte.is_ascii_digit());
        if integer.is_empty()
            || !is_digits(integer)
            || !is_digits(fraction)
            || (fraction.is_empty() && rest.contains('.'))
        {
            return Err(Error::Malformed(
                "expected decimal text, -?[0-9]+(.[0-9]+)?",
            ));
        }
        let scale = u16::try_from(fraction.len()).map_err(|_| ducat::Error::InvalidScale)?;
        if scale > MAX_SCALE {
            return Err(ducat::Error::InvalidScale.into());
        }
        let mut digits = String::with_capacity(integer.len() + fraction.len());
        digits.push_str(integer);
        digits.push_str(fraction);
        Self::from_digits(negative, &digits, scale)
    }
}

/// The declared size of a NUMERIC(precision, scale) or DECIMAL(precision, scale) column, valid
/// or not: [`ColumnSize::is_valid`] tells.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ColumnSize {
    precision: u16,
    scale: u16,
}

impl ColumnSize {
    /// NUMERIC(19,4), ducat's default for its MySQL decimal column.
    pub const DEFAULT: Self = Self {
        precision: 19,
        scale: 4,
    };

    /// NUMERIC(`precision`, `scale`), unchecked.
    #[must_use]
    pub const fn new_unchecked(precision: u16, scale: u16) -> Self {
        Self { precision, scale }
    }

    /// Whether the precision is at least 1 and the scale at most the precision.
    #[must_use]
    pub const fn is_valid(&self) -> bool {
        self.precision != 0 && self.scale <= self.precision
    }

    /// The total number of significant digits.
    #[must_use]
    pub const fn precision(&self) -> u16 {
        self.precision
    }

    /// The digits after the point.
    #[must_use]
    pub const fn scale(&self) -> u16 {
        self.scale
    }

    /// Checks that the column's scale is at least `currency`'s exponent (ducat's
    /// `checkDecimalSize`).
    ///
    /// # Errors
    ///
    /// [`Error::ColumnScaleBelowExponent`].
    pub fn check_currency(&self, currency: CurrencyCode) -> Result<(), Error> {
        if self.scale < u16::from(currency.exponent()) {
            return Err(Error::ColumnScaleBelowExponent {
                size: *self,
                exponent: currency.exponent(),
            });
        }
        Ok(())
    }

    /// The exact decimal to bind for this column for an amount (`units` at `scale`) in
    /// `currency`, or an error if the database would change it (ducat's `toNumeric`): any scale
    /// up to the column's, and trailing zeros beyond it dropped.
    ///
    /// # Errors
    ///
    /// [`Error::ColumnScaleBelowExponent`], [`Error::WouldRound`],
    /// [`Error::TooManyIntegerDigits`].
    pub fn fit(&self, units: &Int, scale: u16, currency: CurrencyCode) -> Result<Decimal, Error> {
        self.check_currency(currency)?;
        let decimal = Decimal::from_money_parts(units, scale);
        let (integer, fraction) = decimal.split_digits();
        let significant = fraction.trim_end_matches('0').len();
        if significant > usize::from(self.scale) {
            return Err(Error::WouldRound {
                size: *self,
                decimals: u16::try_from(significant).unwrap_or(u16::MAX),
            });
        }
        if integer.len() > usize::from(self.precision - self.scale) {
            return Err(Error::TooManyIntegerDigits { size: *self });
        }
        if decimal.scale <= self.scale {
            return Ok(decimal);
        }
        let mut digits = integer;
        digits.push_str(&fraction[..usize::from(self.scale)]);
        Decimal::from_digits(decimal.units.is_negative(), &digits, self.scale)
    }
}

impl fmt::Display for ColumnSize {
    /// `NUMERIC(19,4)`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "NUMERIC({},{})", self.precision, self.scale)
    }
}
