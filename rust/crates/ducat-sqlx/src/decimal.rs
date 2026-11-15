//! `Decimal`, an exact NUMERIC/DECIMAL value, and `DecimalColumnSize`.

use core::fmt;
use core::str::FromStr;

use ducat::{AnyMoney, CurrencyCode, Int, MAX_SCALE, Rounding};

use crate::{Error, MoneyValue};

/// An exact decimal, `units × 10^−scale`, as a NUMERIC or DECIMAL column holds it: the value and
/// its scale (the digits after the point the column stored, trailing zeros included), with no
/// currency.
///
/// It is what a Postgres NUMERIC, a MySQL DECIMAL or a SQLite TEXT decimal decodes to and encodes
/// from, through sqlx, with the database features. Read it beside a currency column and make
/// money with [`Decimal::to_money`] or [`Decimal::to_money_at_exponent`]; write money with
/// [`Decimal::from_money`], or with [`DecimalColumnSize::fit`] for a NUMERIC(p, s) column.
///
/// The scale is at most [`ducat::MAX_SCALE`] (1000), as in ducat; Postgres allows up to 16383
/// and such a value is refused on read. Equality is structural: `1.0` and `1.00` differ.
///
/// ```
/// use ducat_sqlx::Decimal;
///
/// let price: Decimal = "-12.3400".parse()?;
/// assert_eq!((price.units().to_string().as_str(), price.scale()), ("-123400", 4));
/// assert_eq!(price.to_string(), "-12.3400");
/// # Ok::<(), ducat_sqlx::Error>(())
/// ```
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
    pub fn new(units: impl Into<Int>, scale: u16) -> Result<Self, Error> {
        if scale > MAX_SCALE {
            return Err(ducat::Error::InvalidScale.into());
        }
        Ok(Self {
            units: units.into(),
            scale,
        })
    }

    /// The value in units of 10^−scale: `1234` for `12.34`.
    #[must_use]
    pub const fn units(&self) -> &Int {
        &self.units
    }

    /// The number of digits after the point.
    #[must_use]
    pub const fn scale(&self) -> u16 {
        self.scale
    }

    /// The money's amount at its own scale.
    #[must_use]
    pub fn from_money<M: MoneyValue>(money: &M) -> Self {
        Self {
            units: money.units().clone(),
            scale: money.scale(),
        }
    }

    /// Money in `currency`, keeping every digit and the stored scale, but never less than the
    /// currency's exponent: `12` in EUR is 12.00 EUR and `1.5000` is 1.5000 EUR. This is how
    /// ducat's `parseMoneyComposite` reads the composite type's amount.
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

    /// Money in `currency` at the currency's exponent, without rounding: `12.3400` from a
    /// NUMERIC(19,4) column is 12.34 EUR, and `12.345` is an error. This is how ducat's
    /// fixed-currency decimal columns read (`decimalFromDriver`).
    ///
    /// # Errors
    ///
    /// [`Error::Ducat`] with [`ducat::Error::Rounding`] when the value has more significant
    /// decimals than the currency's exponent.
    pub fn to_money_at_exponent(&self, currency: CurrencyCode) -> Result<AnyMoney, Error> {
        let money = AnyMoney::from_units(self.units.clone(), self.scale, currency)?;
        Ok(money.to_scale(u16::from(currency.exponent()), Rounding::Unnecessary)?)
    }

    /// The digits of the magnitude, the integer part's (without leading zeros, possibly empty)
    /// and the fraction's (exactly `scale` digits).
    pub(crate) fn split_digits(&self) -> (String, String) {
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
    pub(crate) fn from_digits(negative: bool, digits: &str, scale: u16) -> Result<Self, Error> {
        let trimmed = digits.trim_start_matches('0');
        let units = if trimmed.is_empty() {
            Int::ZERO
        } else {
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

    /// Decimal text as Postgres NUMERIC, MySQL DECIMAL and ducat's SQLite TEXT columns write it:
    /// an optional `-`, one or more ASCII digits, and optionally a point and one or more digits.
    /// The scale is the number of digits after the point. `NaN`, `Infinity` and `-Infinity`
    /// (Postgres's spellings, any case) are their own errors; `+1`, `.5`, `1.`, `1e3`, grouping and
    /// whitespace are malformed, as in ducat's `parseNumeric`.
    ///
    /// # Errors
    ///
    /// [`Error::NotANumber`], [`Error::Infinite`], [`Error::Malformed`], or [`Error::Ducat`] with
    /// [`ducat::Error::InvalidScale`] for more than [`ducat::MAX_SCALE`] decimals.
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

/// The declared size of a NUMERIC(precision, scale) or DECIMAL(precision, scale) column.
///
/// ```
/// use ducat::iso::Eur;
/// use ducat::Money;
/// use ducat_sqlx::{DecimalColumnSize, DEFAULT_DECIMAL_SIZE};
///
/// let price: Money<Eur> = "12.30".parse()?;
/// assert_eq!(DEFAULT_DECIMAL_SIZE.fit(&price)?.to_string(), "12.30");
/// assert!(DecimalColumnSize::new(5, 4)?.fit(&price).is_err()); // two integer digits, room for one
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct DecimalColumnSize {
    precision: u16,
    scale: u16,
}

/// NUMERIC(19,4): 15 integer digits and 4 decimals, enough for every ISO 4217 exponent. ducat's
/// default for its MySQL decimal column.
pub const DEFAULT_DECIMAL_SIZE: DecimalColumnSize = DecimalColumnSize {
    precision: 19,
    scale: 4,
};

impl DecimalColumnSize {
    /// NUMERIC(`precision`, `scale`).
    ///
    /// # Errors
    ///
    /// [`Error::InvalidColumnSize`] unless `precision` is at least 1 and `scale` at most
    /// `precision`.
    pub const fn new(precision: u16, scale: u16) -> Result<Self, Error> {
        let size = Self { precision, scale };
        if precision == 0 || scale > precision {
            return Err(Error::InvalidColumnSize(size));
        }
        Ok(size)
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

    /// Checks that the column holds `currency`'s amounts without rounding: its scale is at
    /// least the exponent (ducat's `checkDecimalSize`).
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

    /// The exact decimal to bind for this column, or an error if the database would change the
    /// money: Postgres rounds extra decimals silently on insert and rejects too many integer
    /// digits, and MySQL outside strict mode clamps. Any scale up to the column's is accepted,
    /// and trailing zeros beyond it are dropped since they don't change the value. This is
    /// ducat's `toNumeric`.
    ///
    /// # Errors
    ///
    /// [`Error::ColumnScaleBelowExponent`] for a column that would round the currency;
    /// [`Error::WouldRound`] for significant decimals beyond the column's scale;
    /// [`Error::TooManyIntegerDigits`].
    pub fn fit<M: MoneyValue>(&self, money: &M) -> Result<Decimal, Error> {
        self.check_currency(money.currency())?;
        let decimal = Decimal::from_money(money);
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

impl fmt::Display for DecimalColumnSize {
    /// `NUMERIC(19,4)`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "NUMERIC({},{})", self.precision, self.scale)
    }
}
