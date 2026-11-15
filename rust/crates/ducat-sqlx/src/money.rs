//! The money kinds columns take, and the fixed-currency column shapes.

use ducat::{AnyMoney, Currency, CurrencyCode, Int, Money};

use crate::{Decimal, Error};

mod sealed {
    pub trait Sealed {}
    impl Sealed for ducat::AnyMoney {}
    impl<C: ducat::Currency> Sealed for ducat::Money<C> {}
}

/// The two money types, [`AnyMoney`] and [`Money<C>`], for the column shapes and helpers that
/// take either. Sealed: it is implemented for those two only.
pub trait MoneyValue: Sized + sealed::Sealed {
    /// The currency.
    fn currency(&self) -> CurrencyCode;
    /// The amount in units of 10^−scale.
    fn units(&self) -> &Int;
    /// The scale.
    fn scale(&self) -> u16;
    /// The currency a stored code names: for [`AnyMoney`] the ISO 4217 currency with that code,
    /// for `Money<C>` `C`'s currency, if the code is `C`'s.
    ///
    /// # Errors
    ///
    /// [`Error::UnknownCurrency`] for a code that isn't ISO 4217 (`AnyMoney`);
    /// [`Error::CurrencyMismatch`] for another code than `C`'s (`Money<C>`).
    fn resolve_currency(code: &str) -> Result<CurrencyCode, Error>;
    /// The money from an [`AnyMoney`] in [`resolve_currency`](MoneyValue::resolve_currency)'s
    /// currency.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] when `money` isn't in `C` (`Money<C>`).
    fn from_any(money: AnyMoney) -> Result<Self, Error>;
}

impl MoneyValue for AnyMoney {
    fn currency(&self) -> CurrencyCode {
        AnyMoney::currency(self)
    }

    fn units(&self) -> &Int {
        AnyMoney::units(self)
    }

    fn scale(&self) -> u16 {
        AnyMoney::scale(self)
    }

    fn resolve_currency(code: &str) -> Result<CurrencyCode, Error> {
        CurrencyCode::iso(code).map_err(|_| Error::UnknownCurrency(code.into()))
    }

    fn from_any(money: AnyMoney) -> Result<Self, Error> {
        Ok(money)
    }
}

impl<C: Currency> MoneyValue for Money<C> {
    fn currency(&self) -> CurrencyCode {
        C::CODE
    }

    fn units(&self) -> &Int {
        Money::units(self)
    }

    fn scale(&self) -> u16 {
        Money::scale(self)
    }

    fn resolve_currency(code: &str) -> Result<CurrencyCode, Error> {
        if code == C::CODE.as_str() {
            Ok(C::CODE)
        } else {
            Err(Error::CurrencyMismatch {
                expected: C::CODE.as_str().into(),
                actual: code.into(),
            })
        }
    }

    fn from_any(money: AnyMoney) -> Result<Self, Error> {
        let actual = money.currency();
        Money::try_from(money).map_err(|_| Error::CurrencyMismatch {
            expected: C::CODE.as_str().into(),
            actual: actual.as_str().to_string(),
        })
    }
}

/// Checks that money is at its currency's exponent, the one scale a column of minor units or a
/// fixed-currency decimal stores (ducat's `checkIsoScale`).
fn check_exponent_scale<M: MoneyValue>(money: &M) -> Result<(), Error> {
    let expected = u16::from(money.currency().exponent());
    if money.scale() != expected {
        return Err(Error::ScaleMismatch {
            scale: money.scale(),
            expected,
        });
    }
    Ok(())
}

/// The minor units to store in a BIGINT (Postgres, MySQL) or INTEGER (SQLite) column: `1234` for
/// 12.34 EUR. This is ducat's `minorToDriver`, for money whose currency is stored elsewhere (in
/// a column of its own); [`MinorColumn`] binds a `Money<C>` directly.
///
/// ```
/// use ducat::{AnyMoney, CurrencyCode};
///
/// let eur = CurrencyCode::iso("EUR")?;
/// assert_eq!(ducat_sqlx::minor_units(&AnyMoney::parse("12.34", eur)?)?, 1234);
/// assert!(ducat_sqlx::minor_units(&AnyMoney::parse_at("12.345", eur, 3, ducat::Rounding::Unnecessary)?).is_err());
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
///
/// # Errors
///
/// [`Error::ScaleMismatch`] unless the money is at its currency's exponent (round it first);
/// [`Error::OutOfRange`] beyond ±(2^63 − 1) minor units, where MySQL outside strict mode would
/// store the nearest limit instead.
pub fn minor_units<M: MoneyValue>(money: &M) -> Result<i64, Error> {
    check_exponent_scale(money)?;
    money.units().to_i64().ok_or(Error::OutOfRange)
}

/// A BIGINT (Postgres, MySQL) or INTEGER (SQLite) column of minor units in a fixed currency:
/// `1234` is 12.34 EUR. ducat's `moneyMinor` column shape.
///
/// Reading gives the money at the currency's exponent. Writing refuses money at another scale
/// ([`Error::ScaleMismatch`]: round it first) and beyond ±(2^63 − 1) minor units
/// ([`Error::OutOfRange`]). SQLite and MySQL values that aren't integers (a SQLite REAL, a MySQL
/// DOUBLE) are refused, never truncated.
///
/// ```
/// use ducat::{iso::Eur, Money};
/// use ducat_sqlx::MinorColumn;
///
/// let total = MinorColumn::<Eur>("12.34".parse()?);
/// assert_eq!(total.minor_units()?, 1234);
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct MinorColumn<C: Currency>(pub Money<C>);

impl<C: Currency> MinorColumn<C> {
    /// The minor units the column stores.
    ///
    /// # Errors
    ///
    /// As [`minor_units`].
    pub fn minor_units(&self) -> Result<i64, Error> {
        minor_units(&self.0)
    }

    /// The money from stored minor units.
    #[must_use]
    pub fn from_minor_units(minor: i64) -> Self {
        Self(Money::from_minor(minor))
    }
}

impl<C: Currency> From<Money<C>> for MinorColumn<C> {
    fn from(money: Money<C>) -> Self {
        Self(money)
    }
}

impl<C: Currency> From<MinorColumn<C>> for Money<C> {
    fn from(column: MinorColumn<C>) -> Self {
        column.0
    }
}

/// A decimal column in a fixed currency, at the currency's exponent: Postgres NUMERIC, MySQL
/// DECIMAL, or SQLite TEXT (SQLite's NUMERIC affinity would store some decimals as REAL and lose
/// digits). ducat's `moneyDecimal` column shape.
///
/// Reading accepts trailing zeros (`12.3400` from a NUMERIC(19,4) is 12.34 EUR) and refuses more
/// significant decimals than the currency has, `NaN` and the infinities. Writing refuses money at
/// another scale than the exponent ([`Error::ScaleMismatch`]). For a column with a declared
/// size, bind [`DecimalColumnSize::fit`](crate::DecimalColumnSize::fit)'s [`Decimal`], which
/// also refuses what the column couldn't hold unchanged.
///
/// ```
/// use ducat::{iso::Jpy, Money};
/// use ducat_sqlx::DecimalColumn;
///
/// let price = DecimalColumn::<Jpy>("1500".parse()?);
/// assert_eq!(price.to_decimal()?.to_string(), "1500");
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct DecimalColumn<C: Currency>(pub Money<C>);

impl<C: Currency> DecimalColumn<C> {
    /// The decimal the column stores.
    ///
    /// # Errors
    ///
    /// [`Error::ScaleMismatch`] unless the money is at its currency's exponent.
    pub fn to_decimal(&self) -> Result<Decimal, Error> {
        check_exponent_scale(&self.0)?;
        Ok(Decimal::from_money(&self.0))
    }

    /// The money from a stored decimal, at the currency's exponent.
    ///
    /// # Errors
    ///
    /// As [`Decimal::to_money_at_exponent`].
    pub fn from_decimal(decimal: &Decimal) -> Result<Self, Error> {
        let money = decimal.to_money_at_exponent(C::CODE)?;
        Ok(Self(Money::from_any(money)?))
    }
}

impl<C: Currency> From<Money<C>> for DecimalColumn<C> {
    fn from(money: Money<C>) -> Self {
        Self(money)
    }
}

impl<C: Currency> From<DecimalColumn<C>> for Money<C> {
    fn from(column: DecimalColumn<C>) -> Self {
        column.0
    }
}
