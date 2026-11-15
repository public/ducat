//! `Decimal`, an exact NUMERIC/DECIMAL value, and `DecimalColumnSize`.

use core::fmt;
use core::str::FromStr;

use diesel::deserialize::FromSqlRow;
use diesel::expression::AsExpression;
use diesel::sql_types::Numeric;
#[cfg(feature = "sqlite")]
use diesel::sql_types::Text;
use ducat::{AnyMoney, CurrencyCode, Int};
use ducat_sql_core::ColumnSize;

use crate::{Error, MoneyValue};

/// An exact decimal, `units × 10^−scale`, as a NUMERIC or DECIMAL column holds it: the value and
/// its scale (the digits after the point the column stored, trailing zeros included), with no
/// currency.
///
/// It is what a Postgres NUMERIC, a MySQL DECIMAL or a SQLite TEXT decimal decodes to and encodes
/// from, through diesel, with the database features (the SQL types `Numeric`, and `Text` for
/// SQLite). Read it beside a currency column and make
/// money with [`Decimal::to_money`] or [`Decimal::to_money_at_exponent`]; write money with
/// [`Decimal::from_money`], or with [`DecimalColumnSize::fit`] for a NUMERIC(p, s) column.
///
/// The scale is at most [`ducat::MAX_SCALE`] (1000), as in ducat; Postgres allows up to 16383
/// and such a value is refused on read. Equality is structural: `1.0` and `1.00` differ.
///
/// ```
/// use ducat_diesel::Decimal;
///
/// let price: Decimal = "-12.3400".parse()?;
/// assert_eq!((price.units().to_string().as_str(), price.scale()), ("-123400", 4));
/// assert_eq!(price.to_string(), "-12.3400");
/// # Ok::<(), ducat_diesel::Error>(())
/// ```
#[derive(Clone, PartialEq, Eq, Hash, Default, AsExpression, FromSqlRow)]
#[diesel(sql_type = Numeric)]
#[cfg_attr(feature = "sqlite", diesel(sql_type = Text))]
pub struct Decimal(pub(crate) ducat_sql_core::Decimal);

impl Decimal {
    /// The decimal `units × 10^−scale`.
    ///
    /// # Errors
    ///
    /// [`Error::Ducat`] with [`ducat::Error::InvalidScale`] for a scale beyond
    /// [`ducat::MAX_SCALE`].
    pub fn new(units: impl Into<Int>, scale: u16) -> Result<Self, Error> {
        Ok(Self(ducat_sql_core::Decimal::new(units.into(), scale)?))
    }

    /// The value in units of 10^−scale: `1234` for `12.34`.
    #[must_use]
    pub const fn units(&self) -> &Int {
        self.0.units()
    }

    /// The number of digits after the point.
    #[must_use]
    pub const fn scale(&self) -> u16 {
        self.0.scale()
    }

    /// The money's amount at its own scale.
    #[must_use]
    pub fn from_money<M: MoneyValue>(money: &M) -> Self {
        Self(ducat_sql_core::Decimal::from_money_parts(
            money.units(),
            money.scale(),
        ))
    }

    /// Money in `currency`, keeping every digit and the stored scale, but never less than the
    /// currency's exponent: `12` in EUR is 12.00 EUR and `1.5000` is 1.5000 EUR. This is how
    /// ducat's `parseMoneyComposite` reads the composite type's amount.
    ///
    /// # Errors
    ///
    /// None in practice: the scale only grows, up to [`ducat::MAX_SCALE`].
    pub fn to_money(&self, currency: CurrencyCode) -> Result<AnyMoney, Error> {
        Ok(self.0.to_money(currency)?)
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
        Ok(self.0.to_money_at_exponent(currency)?)
    }
}

impl fmt::Debug for Decimal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Decimal")
            .field("units", self.units())
            .field("scale", &self.scale())
            .finish()
    }
}

impl fmt::Display for Decimal {
    /// The exact decimal at its scale: `12.34`, `-0.50`, `0.00`, `100`. Never an exponent.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.0, f)
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
        Ok(Self(text.parse()?))
    }
}

/// The declared size of a NUMERIC(precision, scale) or DECIMAL(precision, scale) column.
///
/// ```
/// use ducat::iso::Eur;
/// use ducat::Money;
/// use ducat_diesel::{DecimalColumnSize, DEFAULT_DECIMAL_SIZE};
///
/// let price: Money<Eur> = "12.30".parse()?;
/// assert_eq!(DEFAULT_DECIMAL_SIZE.fit(&price)?.to_string(), "12.30");
/// assert!(DecimalColumnSize::new(5, 4)?.fit(&price).is_err()); // two integer digits, room for one
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct DecimalColumnSize(pub(crate) ColumnSize);

/// NUMERIC(19,4): 15 integer digits and 4 decimals, enough for every ISO 4217 exponent. ducat's
/// default for its MySQL decimal column.
pub const DEFAULT_DECIMAL_SIZE: DecimalColumnSize = DecimalColumnSize(ColumnSize::DEFAULT);

impl DecimalColumnSize {
    /// NUMERIC(`precision`, `scale`).
    ///
    /// # Errors
    ///
    /// [`Error::InvalidColumnSize`] unless `precision` is at least 1 and `scale` at most
    /// `precision`.
    pub const fn new(precision: u16, scale: u16) -> Result<Self, Error> {
        let size = Self(ColumnSize::new_unchecked(precision, scale));
        if !size.0.is_valid() {
            return Err(Error::InvalidColumnSize(size));
        }
        Ok(size)
    }

    /// The total number of significant digits.
    #[must_use]
    pub const fn precision(&self) -> u16 {
        self.0.precision()
    }

    /// The digits after the point.
    #[must_use]
    pub const fn scale(&self) -> u16 {
        self.0.scale()
    }

    /// Checks that the column holds `currency`'s amounts without rounding: its scale is at
    /// least the exponent (ducat's `checkDecimalSize`).
    ///
    /// # Errors
    ///
    /// [`Error::ColumnScaleBelowExponent`].
    pub fn check_currency(&self, currency: CurrencyCode) -> Result<(), Error> {
        Ok(self.0.check_currency(currency)?)
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
        let decimal = self.0.fit(money.units(), money.scale(), money.currency())?;
        Ok(Decimal(decimal))
    }
}

impl fmt::Debug for DecimalColumnSize {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DecimalColumnSize")
            .field("precision", &self.precision())
            .field("scale", &self.scale())
            .finish()
    }
}

impl fmt::Display for DecimalColumnSize {
    /// `NUMERIC(19,4)`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.0, f)
    }
}
