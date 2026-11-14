//! Stripe exchange rates as exact rates, for converting and reconciling balance transactions
//! (ducat's `@ducatjs/money/stripe-fx`).

use super::{AnyRate, RateInfo, Time, UtcInstant};
use crate::{AnyMoney, CurrencyCode, Error, Ratio};

/// The fields of a Stripe BalanceTransaction used here.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StripeBalanceTransaction<'a> {
    /// The gross amount, in the currency's smallest unit as Stripe counts it.
    pub amount: i64,
    /// The balance currency, in Stripe's lowercase (`usd`).
    pub currency: &'a str,
    /// The `exchange_rate` JSON number, as its decimal text (`1.234`), or `None` when nothing was
    /// converted. Text rather than a float, so the library reads no float: ducat reads the JSON
    /// number at its shortest decimal form, which this text is.
    pub exchange_rate: Option<&'a str>,
    /// Seconds since the Unix epoch.
    pub created: Option<i64>,
}

/// 2^53 − 1, the largest integer a double holds exactly.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

fn code(text: &str) -> Result<CurrencyCode, Error> {
    let upper = text.to_ascii_uppercase();
    CurrencyCode::iso(&upper).or_else(|_| CurrencyCode::historic(&upper))
}

fn stripe_info(transaction: &StripeBalanceTransaction<'_>) -> Result<RateInfo, Error> {
    let as_of = transaction
        .created
        .map(|seconds| UtcInstant::from_unix_seconds(seconds).map(Time::Instant))
        .transpose()?;
    Ok(RateInfo {
        source: Some("stripe".into()),
        as_of,
        ..RateInfo::default()
    })
}

/// A JSON number's text as ducat reads it: at most 15 significant digits unless it is a safe
/// integer, as a double holds 15 faithfully.
fn json_number(text: &str) -> Result<Ratio, Error> {
    let value: Ratio = text.parse()?;
    let mantissa = text.split(['e', 'E']).next().unwrap_or(text);
    let digits: alloc::string::String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let significant = digits.trim_start_matches('0').trim_end_matches('0').len();
    let safe_integer = value.denom() == &crate::Int::ONE
        && value
            .numer()
            .to_i64()
            .is_some_and(|whole| whole.unsigned_abs() <= MAX_SAFE_INTEGER);
    if significant > 15 && !safe_integer {
        return Err(Error::TooManyDigits);
    }
    Ok(value)
}

/// The rate Stripe quotes on a balance transaction, from the charge currency `from` to the
/// balance currency: "the amount in currency A, multiplied by the exchange_rate, equals the amount
/// in currency B". `as_of` is the transaction's `created` time. `None` when nothing was converted.
///
/// # Errors
///
/// [`Error::NonPositiveRate`] for a rate that isn't positive; [`Error::TooManyDigits`] for one a
/// JSON number can't carry; [`Error::UnknownCurrency`] for a code that isn't a currency.
pub fn stripe_rate(
    from: &str,
    transaction: &StripeBalanceTransaction<'_>,
) -> Result<Option<AnyRate>, Error> {
    let Some(text) = transaction.exchange_rate else {
        return Ok(None);
    };
    let rate = AnyRate::new(code(from)?, code(transaction.currency)?, json_number(text)?)?;
    rate.with_info(stripe_info(transaction)?).map(Some)
}

/// The exact rate Stripe applied: the balance transaction's gross amount ÷ the charged amount.
///
/// # Errors
///
/// [`Error::NonPositiveRate`] when the quotient isn't positive (a zero or negative amount), and as
/// [`AnyMoney::from_stripe`] for the balance currency.
pub fn stripe_implied_rate(
    charged: &AnyMoney,
    transaction: &StripeBalanceTransaction<'_>,
) -> Result<AnyRate, Error> {
    let settled = AnyMoney::from_stripe(transaction.amount, code(transaction.currency)?)?;
    let quotient = settled
        .exact()
        .value()
        .div(charged.exact().value())
        .map_err(|_| Error::NonPositiveRate)?;
    AnyRate::new(charged.currency(), settled.currency(), quotient)?
        .with_info(stripe_info(transaction)?)
}
