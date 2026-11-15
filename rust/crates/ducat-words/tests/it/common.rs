//! Helpers shared by the modules of the test binary.

use std::path::PathBuf;

/// The languages the crate builds in, with their constants' suffixes.
pub const LANGUAGES: [(&str, &str); 7] = [
    ("en", "EN"),
    ("de", "DE"),
    ("fr", "FR"),
    ("es", "ES"),
    ("it", "IT"),
    ("nl", "NL"),
    ("pt", "PT"),
];

/// The repository's root.
pub fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

/// Wall-clock budgets. A timed test keeps its assertion; with `DUCAT_REPORT_BUDGETS` set it also
/// prints `budget <test path> <case or ""> used <ms> of <budget ms> (<pct>%)`, one line per test
/// (a property test's slowest case), so CI can see how close the tests run to their budgets.
// used by `words`, which the build's languages may compile out
#[allow(dead_code, unused_imports, unused_macros)]
pub mod budget {
    use std::sync::Mutex;
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

    /// The slowest of a property test's cases (measured cases, numbered from 1).
    pub struct Worst(Mutex<(u32, u32, Duration)>);

    impl Worst {
        pub const fn new() -> Self {
            Self(Mutex::new((0, 0, Duration::ZERO)))
        }

        pub fn record(&self, used: Duration) {
            let mut state = self.0.lock().unwrap_or_else(|poison| poison.into_inner());
            state.0 += 1;
            if state.0 == 1 || used > state.2 {
                state.1 = state.0;
                state.2 = used;
            }
        }

        /// Prints the slowest case, as `case-<n>-of-<count>`, once the cases ran.
        pub fn report(&self, test: &str, budget: Duration) {
            let (count, slowest, used) =
                *self.0.lock().unwrap_or_else(|poison| poison.into_inner());
            report(test, &format!("case-{slowest}-of-{count}"), used, budget);
        }
    }
}
