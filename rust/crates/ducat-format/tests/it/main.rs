//! ducat-format's integration tests, as one test binary (one link of ducat, proptest and
//! serde_json instead of one per file). A module that needs languages beyond the build's is
//! compiled out, as its own binary was skipped before.
//!
//! Run one module with `cargo test -p ducat-format --test it <module>::`, e.g. `--test it spec::`
//! (add `-- --nocapture` for the conformance runner's counts).

mod common;

mod data;
#[cfg(all(
    feature = "en",
    feature = "de",
    feature = "zh",
    feature = "sr",
    feature = "pa",
    feature = "uz"
))]
mod locale;
mod props;
mod root;
#[cfg(all(
    feature = "en",
    feature = "fr",
    feature = "my",
    feature = "zh",
    feature = "sr"
))]
mod runtime;
// the languages of the format and parse vectors
#[cfg(all(
    feature = "ar",
    feature = "da",
    feature = "de",
    feature = "en",
    feature = "es",
    feature = "fa",
    feature = "fr",
    feature = "hi",
    feature = "it",
    feature = "ja",
    feature = "nl",
    feature = "pt",
    feature = "ru",
    feature = "sv",
    feature = "sw",
    feature = "th"
))]
mod spec;
