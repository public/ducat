//! ducat-fetch's integration tests, as one test binary (one link of ducat and ureq instead of one
//! per file). The live smoke test needs the `ureq` transport and is compiled out without it, as its
//! own binary was empty before.
//!
//! Run one module with `cargo test -p ducat-fetch --test it <module>::`, e.g. `--test it fetch::`;
//! the live smoke test is `#[ignore]`d: `cargo test -p ducat-fetch --test it live:: -- --ignored`.

mod fetch;
#[cfg(feature = "ureq")]
mod live;
mod snapshots;
