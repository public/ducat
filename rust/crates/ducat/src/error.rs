//! The error type every fallible operation returns.

use core::fmt;

use crate::CurrencyCode;

/// Why an operation failed.
///
/// Every variant maps onto one of the five neutral kinds of ducat's conformance suite (see
/// [`Error::kind`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Error {
    /// The exact result doesn't fit the scale, and the rounding mode was
    /// [`Rounding::Unnecessary`](crate::Rounding::Unnecessary).
    Rounding,
    /// Two amounts in different currencies were combined.
    CurrencyMismatch {
        /// The currency of the value the operation was called on.
        expected: CurrencyCode,
        /// The currency of the other operand.
        actual: CurrencyCode,
    },
    /// A value doesn't fit the type it is narrowed to (such as an [`Int`](crate::Int) beyond
    /// `i128`, or a count beyond `usize`), or more parts are asked for than can be held.
    Overflow,
    /// A division by zero, or a ratio with a zero denominator.
    DivisionByZero,
    /// A scale that isn't an integer from 0 to [`MAX_SCALE`](crate::MAX_SCALE).
    InvalidScale,
    /// A currency code that isn't in ISO 4217 List One with a minor unit, and wasn't made with
    /// [`CurrencyCode::custom`].
    UnknownCurrency,
    /// A custom currency code or exponent that isn't allowed (see [`CurrencyCode::custom`]).
    InvalidCurrency,
    /// Text that doesn't follow the grammar it is parsed with.
    Syntax,
    /// A decimal string's exponent, or its number of decimal places, is beyond
    /// [`MAX_SCALE`](crate::MAX_SCALE).
    ExponentOutOfRange,
    /// A floating-point value that is NaN or infinite.
    NotFinite,
    /// A floating-point value whose shortest decimal form has more than 15 significant digits,
    /// so it can't be told apart from a floating-point artefact. Pass a decimal string instead.
    TooManyDigits,
    /// An exchange rate that is zero or negative.
    NonPositiveRate,
    /// An allocation with no weights, or a split or instalment plan with a count of zero.
    NoWeights,
    /// An allocation whose weights are all zero.
    ZeroWeights,
    /// A negative allocation weight or percentage.
    NegativeWeight,
    /// A unit, maximum or increment that must be positive and isn't.
    NotPositive,
    /// A total that must not be negative (for `chunk`) and is.
    NegativeTotal,
    /// A schedule that can't add up to its total: more than one rest tranche, percentages over
    /// 100, tranches that exceed the total, or a leftover with no rest tranche.
    InvalidSchedule,
    /// A tax percentage of −100 or below, which no net amount can be extracted from.
    InvalidPercent,
    /// A calendar date that isn't one: not `YYYY-MM-DD`, or not a day from 0000-01-01 to 9999-12-31.
    InvalidDate,
    /// A date computed past 9999-12-31 (or before 0000-01-01), such as a payment date.
    DateOutOfRange,
    /// A year fraction whose end date is before its start date.
    EndBeforeStart,
    /// A `30E/360 ISDA` year fraction ending on the last day of February without `maturity`.
    MaturityRequired,
    /// A number of periods outside the range allowed (at most 100,000, and at least one for a schedule).
    InvalidPeriods,
    /// A number of periods per year that isn't allowed: zero, or one payment dates can't step by.
    InvalidPerYear,
    /// A rate at or below −1 per period: everything lost in one period.
    RateTooLow,
    /// A negative loan rate.
    NegativeRate,
    /// A loan that isn't positive.
    InvalidLoan,
    /// A balloon that isn't between zero and the loan, or one on an interest-only loan.
    InvalidBalloon,
    /// An amount that isn't a whole number of the rounding's unit (the currency's minor unit).
    NotAMultiple,
    /// A residual on the last interest for anything but an annuity with a non-zero rate, or one larger than the last interest.
    InvalidResidual,
    /// No cash flows.
    NoFlows,
    /// Cash flows that never change sign, so they have no internal rate of return.
    NoSignChange,
    /// Cash flows that change sign more than once, so they can have several rates of return, and no bracket to pick one.
    SeveralSignChanges,
    /// A rate bracket that isn't two increasing rates above −1 with values of opposite signs at its ends.
    InvalidBracket,
    /// A rate within 10^−digits of −1, where the value is undefined: ask for more digits.
    RateNearMinusOne,
    /// A rate above 2^1024 per period, past which no root is searched for.
    RateTooHigh,
    /// Decimal places beyond 100 (or, for a periodic rate, `digits × per_year` over 50,000).
    InvalidDigits,
    /// A proration period that doesn't end after it starts.
    InvalidPeriod,
    /// A used part, or change points, that don't lie inside the proration period in increasing order.
    OutsidePeriod,
    /// A proration instant that can't be counted: a Unix time beyond ±(2^53 − 1) seconds, or a Unix
    /// time (or a date-time) in a proration counted in days.
    InvalidInstant,
    /// A savings plan with both a contribution and a target, or neither.
    InvalidSavingsPlan,
    /// A savings plan whose last start-timed contribution can't be settled.
    Unsettled,
    /// A power `(1 + rate)^periods` that would pass the bits allowed: use fewer periods or a shorter rate.
    PowerTooLarge,
    /// No payment at a rate of 0, where the number of periods is undefined (Excel's #DIV/0!).
    NoPayment,
    /// Payments that never settle the amounts, so there is no number of periods (Excel's #NUM!).
    NeverSettles,
    /// A value that couldn't be settled within the precision allowed: too close to a grid point, a rate too close to 0, or bounds that don't narrow enough.
    PrecisionExhausted,
    /// Values and dates of different lengths.
    LengthMismatch,
    /// Dated flows without both a positive and a negative value (Excel's #NUM!).
    OneSignOnly,
    /// A date before the first one, which starts the schedule (Excel's #NUM!).
    DateBeforeFirst,
    /// Dated flows that cancel on every date, so every rate is a root.
    FlowsCancel,
    /// A year fraction whose discount factor needs a root too large to bracket.
    RootTooLarge,
}

/// The neutral error kinds of ducat's conformance suite.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ErrorKind {
    /// The exact result doesn't fit the scale, and rounding wasn't allowed.
    Rounding,
    /// The operands have different currencies.
    CurrencyMismatch,
    /// An argument (or a result) is out of range.
    Range,
    /// Text that doesn't parse.
    Syntax,
    /// An argument of the wrong kind.
    Type,
}

impl Error {
    /// The neutral kind of this error, as ducat's conformance suite names it.
    #[must_use]
    pub const fn kind(&self) -> ErrorKind {
        match self {
            Self::Rounding => ErrorKind::Rounding,
            Self::CurrencyMismatch { .. } => ErrorKind::CurrencyMismatch,
            Self::Syntax => ErrorKind::Syntax,
            Self::InvalidCurrency => ErrorKind::Type,
            Self::Overflow
            | Self::DivisionByZero
            | Self::InvalidScale
            | Self::UnknownCurrency
            | Self::ExponentOutOfRange
            | Self::NotFinite
            | Self::TooManyDigits
            | Self::NonPositiveRate
            | Self::NoWeights
            | Self::ZeroWeights
            | Self::NegativeWeight
            | Self::NotPositive
            | Self::NegativeTotal
            | Self::InvalidSchedule
            | Self::InvalidPercent
            | Self::InvalidDate
            | Self::DateOutOfRange
            | Self::EndBeforeStart
            | Self::MaturityRequired
            | Self::InvalidPeriods
            | Self::InvalidPerYear
            | Self::RateTooLow
            | Self::NegativeRate
            | Self::InvalidLoan
            | Self::InvalidBalloon
            | Self::NotAMultiple
            | Self::InvalidResidual
            | Self::NoFlows
            | Self::NoSignChange
            | Self::SeveralSignChanges
            | Self::InvalidBracket
            | Self::RateNearMinusOne
            | Self::RateTooHigh
            | Self::InvalidDigits
            | Self::InvalidPeriod
            | Self::OutsidePeriod
            | Self::InvalidInstant
            | Self::InvalidSavingsPlan
            | Self::Unsettled
            | Self::PowerTooLarge
            | Self::NoPayment
            | Self::NeverSettles
            | Self::PrecisionExhausted
            | Self::LengthMismatch
            | Self::OneSignOnly
            | Self::DateBeforeFirst
            | Self::FlowsCancel
            | Self::RootTooLarge => ErrorKind::Range,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Rounding => f.write_str("the exact result needs rounding, and rounding is unnecessary"),
            Self::CurrencyMismatch { expected, actual } => {
                write!(f, "currency mismatch: {expected} vs {actual}")
            }
            Self::Overflow => f.write_str("the value doesn't fit the type it is narrowed to"),
            Self::DivisionByZero => f.write_str("division by zero"),
            Self::InvalidScale => {
                write!(f, "invalid scale: use an integer from 0 to {}", crate::MAX_SCALE)
            }
            Self::UnknownCurrency => f.write_str("unknown currency (not an ISO 4217 code with a minor unit)"),
            Self::InvalidCurrency => f.write_str("invalid custom currency code or exponent"),
            Self::Syntax => f.write_str("invalid decimal string"),
            Self::ExponentOutOfRange => {
                write!(f, "decimal exponent or decimal places beyond {}", crate::MAX_SCALE)
            }
            Self::NotFinite => f.write_str("the floating-point value is not finite"),
            Self::TooManyDigits => f.write_str(
                "the floating-point value has more than 15 significant digits; pass a decimal string",
            ),
            Self::NonPositiveRate => f.write_str("an exchange rate must be positive"),
            Self::NoWeights => f.write_str("there must be at least one weight (or a count of at least one)"),
            Self::ZeroWeights => f.write_str("the weights must not all be zero"),
            Self::NegativeWeight => f.write_str("a weight must not be negative"),
            Self::NotPositive => f.write_str("the unit, maximum or increment must be positive"),
            Self::NegativeTotal => f.write_str("the total must not be negative"),
            Self::InvalidSchedule => f.write_str(
                "the tranches can't add up to the total: one rest at most, percentages at most 100, no more than the total, and a rest for any leftover",
            ),
            Self::InvalidPercent => f.write_str("a tax percentage must be greater than -100"),
            Self::InvalidDate => f.write_str("an invalid date: expected a real day YYYY-MM-DD from 0000-01-01 to 9999-12-31"),
            Self::DateOutOfRange => f.write_str("the date runs past 9999-12-31 or before 0000-01-01"),
            Self::EndBeforeStart => f.write_str("the end date is before the start date"),
            Self::MaturityRequired => f.write_str("'30E/360 ISDA' ending on the last day of February needs maturity: true or false"),
            Self::InvalidPeriods => f.write_str("the number of periods must be from 1 (0 for compounding) to 100000"),
            Self::InvalidPerYear => f.write_str("invalid periods per year"),
            Self::RateTooLow => f.write_str("the rate must be above -1 per period"),
            Self::NegativeRate => f.write_str("the rate must not be negative"),
            Self::InvalidLoan => f.write_str("the loan must be positive"),
            Self::InvalidBalloon => f.write_str("the balloon must be between zero and the loan, and an interest-only loan has none"),
            Self::NotAMultiple => f.write_str("the amounts must be whole numbers of minor units"),
            Self::InvalidResidual => f.write_str("the residual can't go to the last interest: annuities with a non-zero rate only, and no more than that interest"),
            Self::NoFlows => f.write_str("at least one cash flow is needed"),
            Self::NoSignChange => f.write_str("the cash flows never change sign, so they have no IRR"),
            Self::SeveralSignChanges => f.write_str("the cash flows change sign more than once, so they can have several IRRs; pass a bracket"),
            Self::InvalidBracket => f.write_str("the bracket must be two increasing rates above -1, with values of opposite signs at its ends"),
            Self::RateNearMinusOne => f.write_str("the rate is within 10^-digits of -1; ask for more digits"),
            Self::RateTooHigh => f.write_str("the rate is above 2^1024; no root was found below it"),
            Self::InvalidDigits => f.write_str("too many decimal places: at most 100, and digits × perYear at most 50000"),
            Self::InvalidPeriod => f.write_str("a period must end after it starts"),
            Self::OutsidePeriod => f.write_str("the used part and the change points must lie inside the period, in increasing order"),
            Self::InvalidInstant => f.write_str("a Unix time must be within +/-(2^53 - 1) seconds, and it or a date-time needs proration in seconds"),
            Self::InvalidSavingsPlan => f.write_str("give a savings plan a contribution or a target, not both or neither"),
            Self::Unsettled => f.write_str("the last contribution of this savings plan can't be settled"),
            Self::PowerTooLarge => f.write_str("the power (1 + rate)^periods would be too large; use fewer periods or a shorter rate"),
            Self::NoPayment => f.write_str("with no payment at a rate of 0, the number of periods is undefined"),
            Self::NeverSettles => f.write_str("the payments never settle these amounts, so there is no number of periods"),
            Self::PrecisionExhausted => f.write_str("the value couldn't be settled within the precision allowed"),
            Self::LengthMismatch => f.write_str("values and dates must have the same length"),
            Self::OneSignOnly => f.write_str("XNPV and XIRR need at least one positive and one negative value"),
            Self::DateBeforeFirst => f.write_str("a date is before the first date"),
            Self::FlowsCancel => f.write_str("the cash flows cancel on every date, so every rate is a root"),
            Self::RootTooLarge => f.write_str("a year fraction's roots would be too large to bracket"),
        }
    }
}

impl core::error::Error for Error {}
