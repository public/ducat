//! Functions named after Excel's (NPV, IRR, FV, PV, PMT, NPER, RATE, XNPV and XIRR), with Excel's
//! arguments and sign conventions, as in ducat's `/excel`: where Excel's double evaluation is well
//! conditioned they match its value at its 15 significant digits, and where it isn't they give the
//! exact value or root, which is correct. Where Excel guesses (several possible rates, no
//! convergence), they return an error. Every amount is exact until it is rounded once, with an
//! explicit [`Rounding`](crate::Rounding); irrational results are bounded or floored to a number
//! of decimal places by exact integer arithmetic, with no floats. ducat's own calculations, under
//! its own names, are in [`crate::finance`].
//!
//! ```
//! use ducat::{Money, Rounding};
//! use ducat::excel::{PaymentTiming, pmt};
//! use ducat::iso::Usd;
//!
//! let loan: Money<Usd> = "10000".parse()?;
//! // Excel's PMT(8%/12, 10, 10000)
//! let payment = pmt("0.08/12", 10, &loan, None, PaymentTiming::End, Rounding::HalfExpand)?;
//! assert_eq!(payment.to_decimal(), "-1037.03");
//! # Ok::<(), ducat::Error>(())
//! ```

mod annuity;
mod big;
mod dated;

pub use crate::finance::rates::{irr, npv, npv_exact};
pub use annuity::{Nper, PaymentTiming, fv, fv_exact, nper, pmt, pmt_exact, pv, pv_exact, rate};
pub use dated::{XnpvBounds, XnpvOptions, xirr, xnpv, xnpv_bounds};
