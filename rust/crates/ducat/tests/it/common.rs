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
