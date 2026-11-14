//! Crypto currencies and tokens as a table (BTC with 8 decimals, ETH with 18, SOL with 9, and
//! common Ethereum tokens), and exact conversions to and from base units (satoshi, wei, lamport):
//! ducat's `/crypto`. Each unit's decimals come from the source that defines it (see
//! `data/crypto-units.json`); a token's belong to its contract on one network, Ethereum mainnet's
//! here.
//!
//! ```
//! use ducat::{AnyMoney, CurrencyCode};
//!
//! let eth = CurrencyCode::crypto("ETH")?;
//! let one = AnyMoney::from_base_units("1000000000000000000", eth)?;
//! assert_eq!(one.to_string(), "1.000000000000000000 ETH");
//! assert_eq!(AnyMoney::parse("0.00000001", CurrencyCode::crypto("BTC")?)?.to_base_units()?.to_string(), "1");
//! # Ok::<(), ducat::Error>(())
//! ```

use crate::currency_data::CRYPTO;
use crate::{AnyMoney, Currency, CurrencyCode, Error, Int, Money};

/// The longest base-unit count `from_base_units` reads, which bounds the work on untrusted input.
const MAX_DIGITS: usize = 1000;

/// One entry of the crypto table.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct CryptoUnit {
    code: CurrencyCode,
    name: &'static str,
    base_unit: Option<&'static str>,
    network: &'static str,
    contract: Option<&'static str>,
}

impl CryptoUnit {
    fn of(index: usize) -> Self {
        let (code, name, decimals, base_unit, network, contract) = CRYPTO[index];
        Self {
            code: CurrencyCode::build(code.as_bytes(), decimals),
            name,
            base_unit,
            network,
            contract,
        }
    }

    /// The code, with the unit's decimals as its exponent.
    #[must_use]
    pub const fn code(&self) -> CurrencyCode {
        self.code
    }

    /// Decimal places of one unit in base units: 8 for BTC (satoshi), 18 for ETH (wei).
    #[must_use]
    pub const fn decimals(&self) -> u8 {
        self.code.exponent()
    }

    /// The name.
    #[must_use]
    pub const fn name(&self) -> &'static str {
        self.name
    }

    /// The base unit's name, for a native currency: `"satoshi"`, `"wei"`, `"lamport"`.
    #[must_use]
    pub const fn base_unit(&self) -> Option<&'static str> {
        self.base_unit
    }

    /// The network the decimals are for; a token's can differ on another one.
    #[must_use]
    pub const fn network(&self) -> &'static str {
        self.network
    }

    /// The token's contract address on that network, for a token.
    #[must_use]
    pub const fn contract(&self) -> Option<&'static str> {
        self.contract
    }
}

/// The table entry for a code, or `None` for a code that isn't in it.
#[must_use]
pub fn unit(code: &str) -> Option<CryptoUnit> {
    CRYPTO
        .binary_search_by(|entry| entry.0.cmp(code))
        .ok()
        .map(CryptoUnit::of)
}

/// Every entry of the table, by code.
pub fn units() -> impl ExactSizeIterator<Item = CryptoUnit> {
    (0..CRYPTO.len()).map(CryptoUnit::of)
}

impl CurrencyCode {
    /// A code from the crypto table, with its decimals as the exponent (ducat's
    /// `defineCryptoCurrencies`). It equals `CurrencyCode::custom(code, decimals)`.
    ///
    /// # Errors
    ///
    /// [`Error::UnknownCurrency`] for a code that isn't in the crypto table.
    pub fn crypto(code: &str) -> Result<Self, Error> {
        unit(code)
            .map(|entry| entry.code)
            .ok_or(Error::UnknownCurrency)
    }
}

/// `units × 10^−scale` as a count of 10^−decimals base units.
fn base_units(units: &Int, scale: u16, decimals: u8) -> Result<Int, Error> {
    let decimals = u16::from(decimals);
    if scale <= decimals {
        return Ok(units.mul_pow10(u32::from(decimals - scale)));
    }
    // more decimals than the currency has: only exact when the extra digits are zeros
    let (quotient, rest) = units.div_rem(&Int::ONE.mul_pow10(u32::from(scale - decimals)));
    if rest.is_zero() {
        Ok(quotient)
    } else {
        Err(Error::Rounding)
    }
}

/// A base-unit count read strictly: digits with an optional minus sign, no leading zeros, nothing
/// else.
fn parse_count(text: &str) -> Result<Int, Error> {
    let digits = text.strip_prefix('-').unwrap_or(text);
    let well_formed = !digits.is_empty()
        && text.len() <= MAX_DIGITS + 1
        && digits.bytes().all(|byte| byte.is_ascii_digit())
        && (digits == "0" || !digits.starts_with('0'));
    if !well_formed {
        return Err(Error::Syntax);
    }
    text.parse()
}

impl<C: Currency> Money<C> {
    /// The amount as a count of base units (satoshi for BTC, wei for ETH): 10^−exponent of the
    /// currency, so it works for any currency.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] for an amount with more decimals than the exponent, unless they are
    /// zeros: there is no fraction of a base unit.
    pub fn to_base_units(&self) -> Result<Int, Error> {
        base_units(&self.amount.units, self.amount.scale, C::CODE.exponent())
    }

    /// The amount with `units` base units, at the currency's exponent. The count is read strictly,
    /// since it usually comes from an API or a node: digits with an optional minus sign, and
    /// nothing else (no spaces, plus signs, points, exponents, separators or leading zeros).
    ///
    /// # Errors
    ///
    /// [`Error::Syntax`] for anything else, or more than 1000 digits.
    pub fn from_base_units(units: &str) -> Result<Self, Error> {
        Ok(Self::from_minor(parse_count(units)?))
    }
}

impl AnyMoney {
    /// As [`Money::to_base_units`].
    ///
    /// # Errors
    ///
    /// As [`Money::to_base_units`].
    pub fn to_base_units(&self) -> Result<Int, Error> {
        base_units(
            &self.amount.units,
            self.amount.scale,
            self.currency().exponent(),
        )
    }

    /// As [`Money::from_base_units`].
    ///
    /// # Errors
    ///
    /// As [`Money::from_base_units`].
    pub fn from_base_units(units: &str, currency: CurrencyCode) -> Result<Self, Error> {
        Ok(Self::from_minor(parse_count(units)?, currency))
    }
}
