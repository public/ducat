//! Postgres NUMERIC through diesel's own [`PgNumeric`], converted exactly to and from
//! [`Decimal`].

use diesel::pg::data_types::PgNumeric;
use ducat_sql_core::numeric::Numeric;

use crate::{Decimal, Error};

/// diesel's digits are `i16`; Postgres's are 0 to 9999, so a negative one is as malformed as one
/// beyond 9999, and reads as one (its bits as a `u16` are above 32767).
fn digit_bits(digit: i16) -> u16 {
    u16::from_be_bytes(digit.to_be_bytes())
}

impl TryFrom<&PgNumeric> for Decimal {
    type Error = Error;

    /// The NUMERIC's exact value: the base-10000 digits as ducat's integer, the display scale
    /// (`PgNumeric`'s `scale`) as the scale.
    ///
    /// ```
    /// use diesel::pg::data_types::PgNumeric;
    /// use ducat_diesel::Decimal;
    ///
    /// // 12.34: 12 × 10000^0 + 3400 × 10000^−1, shown with 2 decimals
    /// let numeric = PgNumeric::Positive { weight: 0, scale: 2, digits: vec![12, 3400] };
    /// assert_eq!(Decimal::try_from(&numeric)?.to_string(), "12.34");
    /// # Ok::<(), ducat_diesel::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::NotANumber`] for `NaN`; [`Error::Malformed`] for more than 32767 digits, a digit
    /// outside 0 to 9999, a display scale beyond 16383, or non-zero digits beyond the display
    /// scale (Postgres itself truncates those away on input; here they are refused, never
    /// dropped); [`Error::Ducat`] with [`ducat::Error::InvalidScale`] for a display scale beyond
    /// [`ducat::MAX_SCALE`].
    fn try_from(numeric: &PgNumeric) -> Result<Self, Error> {
        let (negative, weight, scale, digits) = match numeric {
            PgNumeric::Positive {
                weight,
                scale,
                digits,
            } => (false, weight, scale, digits),
            PgNumeric::Negative {
                weight,
                scale,
                digits,
            } => (true, weight, scale, digits),
            PgNumeric::NaN => return Err(Error::NotANumber),
        };
        let numeric = Numeric {
            negative,
            weight: *weight,
            dscale: *scale,
            digits: digits.iter().copied().map(digit_bits).collect(),
        };
        Ok(Self(numeric.to_decimal()?))
    }
}

impl TryFrom<PgNumeric> for Decimal {
    type Error = Error;

    /// As `TryFrom<&PgNumeric>`.
    fn try_from(numeric: PgNumeric) -> Result<Self, Error> {
        Self::try_from(&numeric)
    }
}

impl TryFrom<&Decimal> for PgNumeric {
    type Error = Error;

    /// The shortest NUMERIC for the decimal, as Postgres writes it: no leading or trailing zero
    /// digits, the decimal's scale as the display scale, and zero as no digits, positive.
    ///
    /// ```
    /// use diesel::pg::data_types::PgNumeric;
    /// use ducat_diesel::Decimal;
    ///
    /// let numeric = PgNumeric::try_from(&"-0.0005".parse::<Decimal>()?)?;
    /// assert_eq!(numeric, PgNumeric::Negative { weight: -1, scale: 4, digits: vec![5] });
    /// # Ok::<(), ducat_diesel::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::OutOfRange`] for a value whose weight or digit count doesn't fit NUMERIC's
    /// 16-bit fields (beyond about 10^131072).
    fn try_from(decimal: &Decimal) -> Result<Self, Error> {
        let numeric = Numeric::from_decimal(&decimal.0)?;
        let digits = numeric
            .digits
            .iter()
            .map(|&digit| i16::try_from(digit).map_err(|_| Error::OutOfRange))
            .collect::<Result<Vec<_>, _>>()?;
        let (weight, scale) = (numeric.weight, numeric.dscale);
        Ok(if numeric.negative {
            Self::Negative {
                weight,
                scale,
                digits,
            }
        } else {
            Self::Positive {
                weight,
                scale,
                digits,
            }
        })
    }
}

impl TryFrom<Decimal> for PgNumeric {
    type Error = Error;

    /// As `TryFrom<&Decimal>`.
    fn try_from(decimal: Decimal) -> Result<Self, Error> {
        Self::try_from(&decimal)
    }
}
