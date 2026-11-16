//! Snapshots of the ECB's rates over a [`Transport`]: ducat's `snapshotsFrom(await fetchEcb(..))`
//! in one call, and a loader that fetches each day as a lookup asks for it.

use std::fmt;

use ducat::convert::{
    Date, Publication, RateTable, SnapshotLoader, SnapshotOptions, Snapshots, SnapshotsFrom,
    snapshots, snapshots_from,
};

use crate::ecb::ECB_FIRST_DAY;
use crate::{
    FetchEcbOptions, FetchEcbRangeOptions, FetchError, Response, Transport, checked,
    ecb_range_requests, ecb_range_tables, fetch_ecb,
};

/// Fetches an ECB eurofxref file with [`fetch_ecb`] and gives snapshots over its days: ducat's
/// `snapshotsFrom(await fetchEcb(options), snapshotOptions)`, in one call. Use
/// [`EcbHistory::NinetyDays`](crate::EcbHistory::NinetyDays) (or `All`) for a history; the
/// default file holds the latest day only.
///
/// ```
/// use ducat::convert::{SnapshotOptions, Time};
/// use ducat_fetch::{EcbHistory, FetchEcbOptions, Response, TransportError, ecb_snapshots};
///
/// // your transport (UreqTransport, say); this one has a two-day file
/// let mut transport = |_url: &str, _headers: &[(&str, &str)]| {
///     Ok::<_, TransportError>(Response::new(200, r#"<Cube>
///         <Cube time="2026-11-06"><Cube currency="USD" rate="1.1165"/></Cube>
///         <Cube time="2026-11-05"><Cube currency="USD" rate="1.1224"/></Cube>
///     </Cube>"#))
/// };
/// let options = FetchEcbOptions { history: EcbHistory::NinetyDays, ..FetchEcbOptions::default() };
/// let history = ecb_snapshots(&mut transport, &options, SnapshotOptions::default())?;
/// let sunday = history.at(&"2026-11-08".parse::<Time>()?)?; // Friday's table
/// assert_eq!(sunday.as_of(), Some("2026-11-06".parse()?));
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
///
/// # Errors
///
/// [`FetchError::Snapshot`] with [`ducat::Error::NotPositive`] for a `max` of 0, before the
/// request (ducat, which takes the fetched tables, refuses it after); otherwise as [`fetch_ecb`].
pub fn ecb_snapshots<T: Transport + ?Sized>(
    transport: &mut T,
    options: &FetchEcbOptions<'_>,
    snapshot_options: SnapshotOptions,
) -> Result<SnapshotsFrom, FetchError> {
    snapshot_options.check()?;
    let tables = fetch_ecb(transport, options)?;
    Ok(snapshots_from(tables, snapshot_options)?)
}

/// A [`SnapshotLoader`] that fetches one day of ECB rates from the ECB Data Portal at a time:
/// [`fetch_ecb_range`](crate::fetch_ecb_range) from and to that day, with the published digits.
///
/// The first load fetches the series' DECIMALS too and keeps them, so each later day is one
/// request. A day without rates (a weekend, a TARGET holiday, a day not yet published: the API's
/// 404) has no table, and neither has a day before 1999-01-04, the ECB's first, where
/// [`fetch_ecb_range`](crate::fetch_ecb_range) would refuse the start; a lookback reaching back
/// past it ends with no table rather than an error. ducat has no such loader: it's
/// `snapshots(async (day) => (await fetchEcbRange({ start: day, end: day, .. }))[0])`.
pub struct EcbDayLoader<'a, T> {
    transport: T,
    currencies: &'a [&'a str],
    available_at: Publication<'a>,
    series: Option<Response>,
}

impl<T> fmt::Debug for EcbDayLoader<'_, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EcbDayLoader")
            .field("currencies", &self.currencies)
            .field("available_at", &self.available_at)
            .field("has_series", &self.series.is_some())
            .finish_non_exhaustive()
    }
}

impl<'a, T: Transport> EcbDayLoader<'a, T> {
    /// A loader of `currencies` (empty: every currency) over `transport`, with `available_at` as
    /// [`FetchEcbRangeOptions::available_at`].
    ///
    /// # Errors
    ///
    /// [`FetchError::InvalidCurrency`] for a code that isn't three ASCII capitals, before any
    /// request.
    pub fn new(
        transport: T,
        currencies: &'a [&'a str],
        available_at: Publication<'a>,
    ) -> Result<Self, FetchError> {
        let loader = Self {
            transport,
            currencies,
            available_at,
            series: None,
        };
        ecb_range_requests(&loader.options(ECB_FIRST_DAY))?;
        Ok(loader)
    }

    /// The transport back.
    pub fn into_transport(self) -> T {
        self.transport
    }

    fn options(&self, day: Date) -> FetchEcbRangeOptions<'a> {
        FetchEcbRangeOptions {
            start: day,
            end: Some(day),
            currencies: self.currencies,
            available_at: self.available_at,
        }
    }
}

impl<T: Transport> SnapshotLoader<RateTable, FetchError> for EcbDayLoader<'_, T> {
    /// The day's table, if the ECB published one.
    ///
    /// # Errors
    ///
    /// As [`fetch_ecb_range`](crate::fetch_ecb_range): [`FetchError::Status`],
    /// [`FetchError::Parse`] or [`FetchError::Transport`].
    fn load(&mut self, day: Date) -> Result<Option<RateTable>, FetchError> {
        if day < ECB_FIRST_DAY {
            return Ok(None);
        }
        let options = self.options(day);
        let requests = ecb_range_requests(&options)?;
        let series = match self.series.take() {
            Some(series) => series,
            None => {
                let series = requests.series.send(&mut self.transport)?;
                checked(&requests.series, &series)?;
                series
            }
        };
        let data = requests.data.send(&mut self.transport);
        // keep the DECIMALS whatever the data does
        let series = self.series.insert(series);
        let tables = ecb_range_tables(&requests, series, &data?, &options)?;
        Ok(tables
            .into_iter()
            .find(|table| table.as_of().is_some_and(|as_of| as_of.day() == day)))
    }
}

/// Snapshots of the ECB's rates fetched day by day as lookups ask for them, through an
/// [`EcbDayLoader`]: for lookups scattered over the years, where [`ecb_snapshots`] over the full
/// history would download it all.
///
/// ```
/// use ducat::convert::{Publication, SnapshotOptions, Time};
/// use ducat_fetch::{Response, TransportError, ecb_day_snapshots};
///
/// let mut urls = Vec::new();
/// let transport = |url: &str, _headers: &[(&str, &str)]| {
///     urls.push(url.to_owned());
///     Ok::<_, TransportError>(if url.contains("detail=nodata") {
///         Response::new(200, "KEY,CURRENCY,DECIMALS\nEXR.D.USD.EUR.SP00.A,USD,4\n")
///     } else if url.contains("startPeriod=2026-11-06&") {
///         let header = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE";
///         Response::new(200, format!("{header}\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-11-06,1.1165\n"))
///     } else {
///         Response::new(404, "No results found.")
///     })
/// };
/// let mut history =
///     ecb_day_snapshots(transport, &["USD"], Publication::Stated, SnapshotOptions::default())?;
/// let sunday = history.at(&"2026-11-08".parse::<Time>()?)?;
/// assert_eq!(sunday.as_of(), Some("2026-11-06".parse()?));
/// drop(history);
/// assert_eq!(urls.len(), 4); // the DECIMALS, then the 8th, the 7th and the 6th
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
///
/// # Errors
///
/// [`FetchError::InvalidCurrency`] as [`EcbDayLoader::new`], then [`FetchError::Snapshot`] with
/// [`ducat::Error::NotPositive`] for a `max` of 0, both before any request. A lookup fails with
/// the loader's errors, or [`FetchError::Snapshot`] with [`ducat::Error::NoSnapshot`].
pub fn ecb_day_snapshots<'a, T: Transport>(
    transport: T,
    currencies: &'a [&'a str],
    available_at: Publication<'a>,
    options: SnapshotOptions,
) -> Result<Snapshots<EcbDayLoader<'a, T>, RateTable, FetchError>, FetchError> {
    let loader = EcbDayLoader::new(transport, currencies, available_at)?;
    Ok(snapshots(loader, options)?)
}
