//! Functions named after Excel's, with Excel's arguments and sign conventions, as in ducat's
//! `/excel`: where Excel's double evaluation is well conditioned they match its value, and where it
//! isn't they give the exact value or root, which is correct. ducat's own calculations, under its
//! own names, are in [`crate::finance`].

pub use crate::finance::rates::{irr, npv};
