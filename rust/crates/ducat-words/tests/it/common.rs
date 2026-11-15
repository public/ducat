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
