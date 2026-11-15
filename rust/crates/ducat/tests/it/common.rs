//! Helpers shared by the modules of the test binary.

use std::path::PathBuf;

use ducat::convert::Time;
use ducat::iso::{Eur, Usd};
use ducat::{CurrencyCode, Error, Money, Rounding};

pub type Result = core::result::Result<(), Error>;

pub const EXACT: Rounding = Rounding::Unnecessary;

/// The repository's root.
pub fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

pub fn unescape(text: &str) -> String {
    text.replace("&apos;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

pub fn eur(text: &str) -> Money<Eur> {
    text.parse().unwrap()
}

pub fn usd(text: &str) -> Money<Usd> {
    text.parse().unwrap()
}

pub fn code(text: &str) -> CurrencyCode {
    text.parse().unwrap()
}

pub fn time(text: &str) -> Time {
    text.parse().unwrap()
}

/// Wall-clock budgets. A timed test keeps its assertion; with `DUCAT_REPORT_BUDGETS` set it also
/// prints `budget <test path> <case or ""> used <ms> of <budget ms> (<pct>%)`, one line per
/// test, so CI can see how close the tests run to their budgets.
pub mod budget {
    use std::time::Duration;

    /// The test's path, `<package>/<module path>::<name>`.
    macro_rules! test_path {
        ($name:ident) => {
            concat!(
                env!("CARGO_PKG_NAME"),
                "/",
                module_path!(),
                "::",
                stringify!($name)
            )
        };
    }
    pub(crate) use test_path;

    fn reporting() -> bool {
        std::env::var_os("DUCAT_REPORT_BUDGETS").is_some()
    }

    /// Prints one budget line, if `DUCAT_REPORT_BUDGETS` is set; an empty case prints as `""`.
    pub fn report(test: &str, case: &str, used: Duration, budget: Duration) {
        if !reporting() {
            return;
        }
        let case = if case.is_empty() { "\"\"" } else { case };
        println!(
            "budget {test} {case} used {:.1} of {} ({:.2}%)",
            used.as_secs_f64() * 1000.0,
            budget.as_millis(),
            100.0 * used.as_secs_f64() / budget.as_secs_f64()
        );
    }
}
