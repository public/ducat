//! Which currencies a territory uses and since when, from CLDR (ducat's `/territories`).
//!
//! ```
//! use ducat::territories::{TerritoryOptions, currency_territories, territory_currencies};
//!
//! let germany = territory_currencies("DE", &TerritoryOptions::default())?;
//! assert_eq!(germany.iter().map(|use_| use_.currency).collect::<Vec<_>>(), ["EUR", "DEM"]);
//! let in_1990 = TerritoryOptions { on: Some("1990-01-01"), ..TerritoryOptions::default() };
//! assert_eq!(territory_currencies("DE", &in_1990)?[0].currency, "DEM");
//! assert_eq!(currency_territories("CHF", &TerritoryOptions::default())?, ["CH", "LI"]);
//! # Ok::<(), ducat::Error>(())
//! ```

use alloc::vec::Vec;

use crate::Error;
use crate::currency_data::TERRITORIES;

/// One currency a territory uses or used, from CLDR. The code is text: a withdrawn code CLDR
/// lists may have no sourced exponent, so it isn't always a [`CurrencyCode`](crate::CurrencyCode).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct TerritoryCurrency {
    /// The ISO 4217 code.
    pub currency: &'static str,
    /// The first day of use (`YYYY-MM-DD`), where CLDR gives one.
    pub from: Option<&'static str>,
    /// The last day of use, for a currency the territory no longer uses.
    pub to: Option<&'static str>,
    /// `false` for a code that isn't legal tender there, such as a fund code (CHE, USN, CLF).
    pub tender: bool,
}

/// Which uses to list.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct TerritoryOptions<'a> {
    /// Only the currencies in use on this day, `YYYY-MM-DD`: `Some("2001-06-01")` gives both EUR
    /// and DEM for Germany. Without it, every currency CLDR lists, current and past.
    pub on: Option<&'a str>,
    /// Whether to include codes that aren't legal tender (fund codes such as CHE).
    pub include_non_tender: bool,
}

impl TerritoryOptions<'_> {
    /// `on` is `YYYY-MM-DD` in shape, as ducat checks it: digits and dashes, compared as text.
    fn check(&self) -> Result<(), Error> {
        let Some(day) = self.on else {
            return Ok(());
        };
        let bytes = day.as_bytes();
        let shaped = bytes.len() == 10
            && bytes.iter().enumerate().all(|(index, &byte)| {
                if index == 4 || index == 7 {
                    byte == b'-'
                } else {
                    byte.is_ascii_digit()
                }
            });
        if shaped {
            Ok(())
        } else {
            Err(Error::InvalidDate)
        }
    }

    fn wants(&self, use_: &TerritoryCurrency) -> bool {
        if !use_.tender && !self.include_non_tender {
            return false;
        }
        let Some(day) = self.on else {
            return true;
        };
        // 'YYYY-MM-DD' strings compare in date order; an unknown start counts as "always"
        use_.from.is_none_or(|from| from <= day) && use_.to.is_none_or(|to| day <= to)
    }
}

fn uses(index: usize) -> impl Iterator<Item = TerritoryCurrency> {
    TERRITORIES[index]
        .1
        .iter()
        .map(|&(currency, from, to, tender)| TerritoryCurrency {
            currency,
            from,
            to,
            tender,
        })
}

/// The currencies a territory (an ISO 3166 alpha-2 code such as `"DE"`, or a CLDR region) uses or
/// has used, newest first, with the days CLDR gives. Fund and accounting codes are left out unless
/// `include_non_tender` is set. A territory CLDR doesn't know gives an empty list.
///
/// # Errors
///
/// [`Error::InvalidDate`] for an `on` that isn't `YYYY-MM-DD`.
pub fn territory_currencies(
    territory: &str,
    options: &TerritoryOptions<'_>,
) -> Result<Vec<TerritoryCurrency>, Error> {
    options.check()?;
    Ok(TERRITORIES
        .binary_search_by(|entry| entry.0.cmp(territory))
        .map(|index| uses(index).filter(|use_| options.wants(use_)).collect())
        .unwrap_or_default())
}

/// The territories that use or used a currency, in code order: `["CH", "LI"]` for CHF. With `on`,
/// only those using it on that day.
///
/// # Errors
///
/// [`Error::InvalidDate`] for an `on` that isn't `YYYY-MM-DD`.
pub fn currency_territories(
    currency: &str,
    options: &TerritoryOptions<'_>,
) -> Result<Vec<&'static str>, Error> {
    options.check()?;
    Ok((0..TERRITORIES.len())
        .filter(|&index| uses(index).any(|use_| use_.currency == currency && options.wants(&use_)))
        .map(|index| TERRITORIES[index].0)
        .collect())
}
