//! Dated tables loaded on demand: ducat's `snapshots` and `snapshotsFrom` (`src/provider.ts`).
//!
//! ducat's loader is async (`(day) => Promise<RateProvider | undefined>`); the port's is a plain
//! function, so nothing here needs a runtime. [`snapshots`] shows how an async loader drives it.

use alloc::boxed::Box;
use alloc::collections::BTreeMap;
use alloc::rc::Rc;
#[cfg(target_has_atomic = "ptr")]
use alloc::sync::Arc;
use core::fmt;
use core::marker::PhantomData;

use super::{RateProvider, RateTable, Time};
use crate::Error;
use crate::date::Date;

/// Options for [`snapshots`] and [`snapshots_from`] (ducat's `SnapshotOptions`).
///
/// [`Default`] is ducat's: a lookback of 4 days (Good Friday to Easter Monday) and 32 days kept.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct SnapshotOptions {
    /// How many earlier days to try when a day has no table (weekends, holidays).
    pub lookback: u32,
    /// How many loaded days to keep; the least recently used are dropped. At least 1.
    pub max: usize,
}

impl Default for SnapshotOptions {
    fn default() -> Self {
        Self {
            lookback: 4,
            max: 32,
        }
    }
}

impl SnapshotOptions {
    /// Checks the options as [`snapshots`] does, for a caller that wants to refuse them before
    /// loading anything.
    ///
    /// # Errors
    ///
    /// [`Error::NotPositive`] for a `max` of 0 (ducat's `RangeError`). `lookback` is a `u32`, so
    /// ducat's other check, a non-negative integer lookback, can't fail here.
    pub const fn check(&self) -> Result<(), Error> {
        if self.max == 0 {
            Err(Error::NotPositive)
        } else {
            Ok(())
        }
    }
}

/// A provider a snapshot lookup can return: a [`RateProvider`] that may say when it was
/// published.
///
/// ducat passes over a loaded provider whose `availableAt` is after the instant asked for, which
/// only a `RateTable` (or a provider with that property) has. Here that is
/// [`available_at`](SnapshotTable::available_at): [`RateTable`] gives its own, and a provider of
/// your own can keep the default, `None`, for "always available". Mix kinds as
/// `Box<dyn SnapshotTable>`.
pub trait SnapshotTable: RateProvider {
    /// When the table was published, if that is known.
    fn available_at(&self) -> Option<Time> {
        None
    }
}

impl SnapshotTable for RateTable {
    fn available_at(&self) -> Option<Time> {
        Self::available_at(self)
    }
}

impl<T: SnapshotTable + ?Sized> SnapshotTable for &T {
    fn available_at(&self) -> Option<Time> {
        (**self).available_at()
    }
}

impl<T: SnapshotTable + ?Sized> SnapshotTable for Box<T> {
    fn available_at(&self) -> Option<Time> {
        (**self).available_at()
    }
}

impl<T: SnapshotTable + ?Sized> SnapshotTable for Rc<T> {
    fn available_at(&self) -> Option<Time> {
        (**self).available_at()
    }
}

#[cfg(target_has_atomic = "ptr")]
impl<T: SnapshotTable + ?Sized> SnapshotTable for Arc<T> {
    fn available_at(&self) -> Option<Time> {
        (**self).available_at()
    }
}

/// Loads one UTC day's table for [`snapshots`]: `Ok(Some(table))`, `Ok(None)` when the day has
/// none (a weekend, a holiday, a day not published yet), or the error that fails the lookup.
///
/// A closure `FnMut(Date) -> Result<Option<T>, E>` is one.
pub trait SnapshotLoader<T, E> {
    /// The table for `day`, if there is one.
    ///
    /// # Errors
    ///
    /// Whatever loading fails with; [`Snapshots::at`] returns it as it is.
    fn load(&mut self, day: Date) -> Result<Option<T>, E>;
}

impl<F, T, E> SnapshotLoader<T, E> for F
where
    F: FnMut(Date) -> Result<Option<T>, E>,
{
    fn load(&mut self, day: Date) -> Result<Option<T>, E> {
        self(day)
    }
}

/// Dated tables from a loader, loaded on demand and kept by day: ducat's `Snapshots`, from
/// [`snapshots`].
pub struct Snapshots<L, T, E> {
    load: L,
    lookback: u32,
    max: usize,
    /// Each day's table, with the stamp of its last use.
    tables: BTreeMap<Date, (u64, T)>,
    /// The days by last use, least recent first.
    uses: BTreeMap<u64, Date>,
    next_use: u64,
    error: PhantomData<fn() -> E>,
}

impl<L, T, E> fmt::Debug for Snapshots<L, T, E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Snapshots")
            .field("lookback", &self.lookback)
            .field("max", &self.max)
            .field("days", &self.tables.keys().collect::<alloc::vec::Vec<_>>())
            .finish_non_exhaustive()
    }
}

/// Dated tables from a loader you supply: ducat's `snapshots`.
///
/// `load(day)` returns that UTC day's table, `Ok(None)` when there is none, or an error. A lookup
/// ([`Snapshots::at`]) asks for the day of `as_of`, then each day before it, up to `lookback`
/// days, and stops at the first table it gets. Loaded tables are kept by day, up to `max` days,
/// the least recently used dropped first. Misses and errors are not kept, so a table that isn't
/// published yet is tried again next time. An error fails the lookup rather than falling back to
/// an older day, so an outage doesn't silently become a stale rate. A table whose
/// [`available_at`](SnapshotTable::available_at) is after the instant asked for is passed over,
/// so a lookup at 09:00 on a publication day gets the day before.
///
/// ```
/// use ducat::convert::{Date, RateInfo, RateTable, SnapshotOptions, Time, snapshots};
///
/// let friday = RateTable::with_base("EUR".parse()?, RateInfo {
///     as_of: Some("2026-11-06".parse()?),
///     ..RateInfo::default()
/// })
/// .rate("USD".parse()?, "1.1165")?
/// .build();
/// // a file per day, say: here the one day there is
/// let mut history = snapshots(
///     |day: Date| Ok::<_, ducat::Error>((day.to_string() == "2026-11-06").then(|| friday.clone())),
///     SnapshotOptions::default(),
/// )?;
/// let fx = history.at(&"2026-11-08".parse::<Time>()?)?; // a Sunday: Friday's table
/// assert_eq!(fx.as_of(), Some("2026-11-06".parse()?));
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Async loading
///
/// The lookup is synchronous; an async loader (an HTTP client, a database) drives it from the
/// outside. Have the loader answer from a store and ask for any day the store doesn't hold; then
/// load that day, put it in the store and look up again. The store gives each answer once, so a
/// miss isn't kept and is asked for again by the next lookup, as in ducat. Each lookup loads days
/// one after the other, newest first, and stops at the first table, as ducat's does.
///
/// ```
/// use std::collections::HashMap;
/// use std::future::Future;
/// use std::sync::{Arc, Mutex};
///
/// use ducat::convert::{Date, RateInfo, RateTable, SnapshotOptions, Time, snapshots};
///
/// /// The loader's error: a day to load first, or ducat's.
/// enum Load {
///     Need(Date),
///     Rates(ducat::Error),
/// }
///
/// impl From<ducat::Error> for Load {
///     fn from(error: ducat::Error) -> Self {
///         Self::Rates(error)
///     }
/// }
///
/// type Store = Arc<Mutex<HashMap<Date, Option<Arc<RateTable>>>>>;
///
/// /// The table at `as_of`, loading days with `fetch` (your async client) as the lookup asks.
/// async fn at<L, F, Fut>(
///     history: &mut ducat::convert::Snapshots<L, Arc<RateTable>, Load>,
///     store: &Store,
///     fetch: F,
///     as_of: &Time,
/// ) -> Result<Arc<RateTable>, ducat::Error>
/// where
///     L: ducat::convert::SnapshotLoader<Arc<RateTable>, Load>,
///     F: Fn(Date) -> Fut,
///     Fut: Future<Output = Result<Option<RateTable>, ducat::Error>>,
/// {
///     loop {
///         match history.at(as_of) {
///             Ok(table) => return Ok(Arc::clone(table)),
///             Err(Load::Rates(error)) => return Err(error),
///             Err(Load::Need(day)) => {
///                 let table = fetch(day).await?.map(Arc::new);
///                 store.lock().unwrap().insert(day, table);
///             }
///         }
///     }
/// }
///
/// let store = Store::default();
/// let answers = Arc::clone(&store);
/// let mut history = snapshots(
///     move |day: Date| match answers.lock().unwrap().remove(&day) {
///         Some(table) => Ok(table),
///         None => Err(Load::Need(day)),
///     },
///     SnapshotOptions::default(),
/// )?;
///
/// // the async client; this one has Friday's table and nothing else
/// let fetch = |day: Date| async move {
///     let friday: Date = "2026-11-06".parse()?;
///     if day != friday {
///         return Ok(None);
///     }
///     let info = RateInfo { as_of: Some(friday.into()), ..RateInfo::default() };
///     Ok(Some(RateTable::with_base("EUR".parse()?, info).rate("USD".parse()?, "1.1165")?.build()))
/// };
///
/// let sunday: Time = "2026-11-08".parse()?;
/// let lookup = at(&mut history, &store, fetch, &sunday);
/// // run it on your runtime: `lookup.await`; this one never waits, so one poll finishes it
/// let mut lookup = std::pin::pin!(lookup);
/// let mut context = std::task::Context::from_waker(std::task::Waker::noop());
/// let std::task::Poll::Ready(table) = lookup.as_mut().poll(&mut context) else {
///     unreachable!("the fake client never waits")
/// };
/// assert_eq!(table?.as_of(), Some("2026-11-06".parse()?));
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// ducat shares one pending load between concurrent lookups of a day; a [`Snapshots`] takes
/// `&mut self`, so lookups don't overlap.
///
/// # Errors
///
/// As [`SnapshotOptions::check`]: [`Error::NotPositive`] for a `max` of 0.
pub fn snapshots<L, T, E>(load: L, options: SnapshotOptions) -> Result<Snapshots<L, T, E>, Error>
where
    L: SnapshotLoader<T, E>,
    T: SnapshotTable,
    E: From<Error>,
{
    options.check()?;
    Ok(Snapshots {
        load,
        lookback: options.lookback,
        max: options.max,
        tables: BTreeMap::new(),
        uses: BTreeMap::new(),
        next_use: 0,
        error: PhantomData,
    })
}

/// The day `count` days before `day`, or `None` before 0000-01-01, where the lookback stops.
fn days_before(day: Date, count: u32) -> Option<Date> {
    day.add_days(-i64::from(count)).ok()
}

/// Whether a table published at `available_at` can answer at `as_of` (ducat's `hasStarted`).
fn published_by(available_at: Option<Time>, as_of: &Time) -> bool {
    available_at.is_none_or(|available_at| available_at.has_started_by(as_of))
}

impl<L, T, E> Snapshots<L, T, E>
where
    L: SnapshotLoader<T, E>,
    T: SnapshotTable,
    E: From<Error>,
{
    /// The latest table at or before `as_of` (a date or an instant, by its UTC day), within the
    /// lookback: ducat's `Snapshots#at`.
    ///
    /// The days are loaded one at a time, newest first, and the first table published by `as_of`
    /// is the answer; older days aren't loaded. A lookback that would go before 0000-01-01 stops
    /// there.
    ///
    /// # Errors
    ///
    /// The loader's error, as soon as it fails; [`Error::NoSnapshot`] (converted into `E`) with
    /// the day of `as_of` when no day in the lookback has a table published by then (ducat's
    /// `RateUnavailableError('*', '*', day)`).
    pub fn at(&mut self, as_of: &Time) -> Result<&T, E> {
        let first = as_of.day();
        let mut found = None;
        for back in 0..=self.lookback {
            let Some(day) = days_before(first, back) else {
                break;
            };
            if let Some(available_at) = self.load_day(day)? {
                if published_by(available_at, as_of) {
                    found = Some(day);
                    break;
                }
            }
        }
        // a day just loaded or used is kept: there is room for at least one
        if let Some((_, table)) = found.and_then(|day| self.tables.get(&day)) {
            return Ok(table);
        }
        Err(Error::NoSnapshot { as_of: first }.into())
    }

    /// Loads `day` (or takes it from those kept, as the most recently used): `Some` with its
    /// table's publication time when it has one, which is then kept.
    fn load_day(&mut self, day: Date) -> Result<Option<Option<Time>>, E> {
        let stamp = self.next_use;
        if let Some((used, table)) = self.tables.get_mut(&day) {
            self.uses.remove(used);
            *used = stamp;
            self.uses.insert(stamp, day);
            self.next_use += 1;
            return Ok(Some(table.available_at()));
        }
        // ducat makes room when the load starts, before knowing whether the day has a table, so a
        // miss still drops the least recently used day
        if self.tables.len() >= self.max {
            if let Some((_, oldest)) = self.uses.pop_first() {
                self.tables.remove(&oldest);
            }
        }
        let Some(table) = self.load.load(day)? else {
            return Ok(None);
        };
        let available_at = table.available_at();
        self.tables.insert(day, (stamp, table));
        self.uses.insert(stamp, day);
        self.next_use += 1;
        Ok(Some(available_at))
    }
}

/// Snapshots over tables already held, by the day of their `as_of`: ducat's `snapshotsFrom`, from
/// [`snapshots_from`].
#[derive(Clone, Debug)]
pub struct SnapshotsFrom {
    by_day: BTreeMap<Date, RateTable>,
    lookback: u32,
}

/// Snapshots over tables you already hold (an ECB 90-day history, say), each under the UTC day
/// of its `as_of`: ducat's `snapshotsFrom`. A table without an `as_of` is left out, and of two
/// tables on one day the later wins. A lookup goes as [`Snapshots::at`]'s; nothing is loaded, so
/// `max` is only checked.
///
/// ```
/// use ducat::convert::{RateInfo, RateProvider, RateQuery, RateTable, SnapshotOptions, Time};
/// use ducat::convert::snapshots_from;
///
/// let day = |as_of: &str, usd: &str| -> Result<RateTable, ducat::Error> {
///     let info = RateInfo { as_of: Some(as_of.parse()?), ..RateInfo::default() };
///     Ok(RateTable::with_base("EUR".parse()?, info).rate("USD".parse()?, usd)?.build())
/// };
/// let history = snapshots_from(
///     [day("2026-11-06", "1.1165")?, day("2026-11-05", "1.1224")?],
///     SnapshotOptions::default(),
/// )?;
/// let fx = history.at(&"2026-11-08".parse::<Time>()?)?; // a Sunday: Friday's table
/// let rate = fx.rate("EUR".parse()?, "USD".parse()?, &RateQuery::default());
/// assert_eq!(rate.map(|rate| rate.to_string()).as_deref(), Some("1.1165"));
/// # Ok::<(), ducat::Error>(())
/// ```
///
/// # Errors
///
/// As [`SnapshotOptions::check`]: [`Error::NotPositive`] for a `max` of 0.
pub fn snapshots_from(
    tables: impl IntoIterator<Item = RateTable>,
    options: SnapshotOptions,
) -> Result<SnapshotsFrom, Error> {
    let mut by_day = BTreeMap::new();
    for table in tables {
        if let Some(as_of) = table.as_of() {
            by_day.insert(as_of.day(), table);
        }
    }
    options.check()?;
    Ok(SnapshotsFrom {
        by_day,
        lookback: options.lookback,
    })
}

impl SnapshotsFrom {
    /// The latest table at or before `as_of` (by its UTC day) within the lookback, and published
    /// by then: ducat's `Snapshots#at`.
    ///
    /// # Errors
    ///
    /// [`Error::NoSnapshot`] with the day of `as_of` when there is none.
    pub fn at(&self, as_of: &Time) -> Result<&RateTable, Error> {
        let first = as_of.day();
        // the lookback stops at 0000-01-01
        let earliest = days_before(first, self.lookback)
            .unwrap_or_else(|| Date::new(0, 1, 1).unwrap_or(first));
        self.by_day
            .range(earliest..=first)
            .rev()
            .map(|(_, table)| table)
            .find(|table| published_by(table.available_at(), as_of))
            .ok_or(Error::NoSnapshot { as_of: first })
    }
}
