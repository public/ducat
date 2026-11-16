//! ducat-diesel's integration tests, as one test binary.
//!
//! The conversion tests need no database: they read hand-built values through diesel's
//! `FromSql` and write through its bind collector (`values`). `sqlite::` runs against an
//! in-memory SQLite (the `sqlite` feature); `postgres::` and `mysql::` run against the servers in
//! `DUCAT_PG_URL` and `DUCAT_MYSQL_URL` (through diesel-async's pure Rust connections), as
//! ducat's TypeScript database tests do, and skip without them, unless `DUCAT_REQUIRE_DB=1` (CI's
//! setting), when a missing URL fails.

mod columns;
mod common;
#[cfg(feature = "postgres")]
mod composite;
mod decimal;
#[cfg(feature = "mysql")]
mod mysql;
#[cfg(feature = "postgres")]
mod numeric;
#[cfg(feature = "postgres")]
mod postgres;
mod scaled;
#[cfg(feature = "sqlite")]
mod sqlite;
mod values;
