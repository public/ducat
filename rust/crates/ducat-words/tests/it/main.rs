//! ducat-words' integration tests, as one test binary (one link of ducat, proptest and serde_json
//! instead of one per file).
//!
//! Run one module with `cargo test -p ducat-words --test it <module>::`, e.g. `--test it spec::`
//! (add `-- --nocapture` for the conformance runner's counts). A filter matches anywhere in a test's
//! path, so `rules::` also takes `words::arbitrary_rules::`: the generator is `rules::committed`.

mod common;

mod cldr;
#[cfg(all(
    feature = "en",
    feature = "de",
    feature = "fr",
    feature = "es",
    feature = "it",
    feature = "nl",
    feature = "pt"
))]
mod names;
mod rules;
#[cfg(all(
    feature = "en",
    feature = "de",
    feature = "fr",
    feature = "es",
    feature = "it",
    feature = "nl",
    feature = "pt"
))]
mod spec;
#[cfg(all(
    feature = "en",
    feature = "de",
    feature = "fr",
    feature = "es",
    feature = "it",
    feature = "nl",
    feature = "pt"
))]
mod words;
