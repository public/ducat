//! ducat's integration tests, as one test binary: each module was its own binary under `tests/`,
//! and linking ducat, proptest and serde_json into every one of them dominated the build.
//!
//! Run one module with `cargo test -p ducat --test it <module>::`, e.g. `--test it spec::` (add
//! `-- --nocapture` for the conformance runner's per-area counts).

mod common;

mod allocate;
mod currency_data;
mod currency_data_api;
mod exact_rate;
mod excel;
mod finance;
mod iso_table;
mod policy;
mod pricing_math;
mod processor_tables;
mod processors;
mod rate_providers;
mod rate_sources;
mod regressions;
mod spec;
mod tax_fixed;
// ducat::testing needs the `proptest` feature: `cargo test -p ducat --features proptest --test it testing::`
#[cfg(feature = "proptest")]
mod testing;
mod wire;
