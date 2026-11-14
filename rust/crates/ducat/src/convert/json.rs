//! serde support for rates, in ducat's `RateJSON` shape: `from`, `to`, `rate` (the exact
//! decimal, or `num/den`), then `source`, `asOf`, `availableAt`, `validUntil` and `type` where
//! set, `quote` when it says more than `rate` does (a `per` or an inverted quote), and
//! `derivedFrom`. Deserializing is ducat's `rateFromJSON`: it rebuilds the metadata and the audit
//! chain, and keeps a published decimal's digits. Unknown fields are ignored, as ducat ignores
//! them; only ISO 4217 codes deserialize, and times are read strictly (see
//! [`UtcInstant`](super::UtcInstant)).

use alloc::string::{String, ToString};
use alloc::vec::Vec;
use core::fmt;

use serde::de::{self, IgnoredAny, MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use super::{AnyRate, MoneyBag, Rate, RateInfo, RateQuote, RateType, Time, published_digits};
use crate::{Currency, CurrencyCode};

impl Serialize for RateQuote {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let fields = 1 + usize::from(self.per.is_some()) + usize::from(self.inverted);
        let mut map = serializer.serialize_map(Some(fields))?;
        map.serialize_entry("rate", &self.rate)?;
        if let Some(per) = self.per {
            map.serialize_entry("per", &per)?;
        }
        if self.inverted {
            map.serialize_entry("inverted", &true)?;
        }
        map.end()
    }
}

impl Serialize for AnyRate {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let info = &self.info;
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("from", self.from.as_str())?;
        map.serialize_entry("to", self.to.as_str())?;
        map.serialize_entry("rate", &self.to_string())?;
        if let Some(source) = &info.source {
            map.serialize_entry("source", source)?;
        }
        for (key, time) in [
            ("asOf", info.as_of),
            ("availableAt", info.available_at),
            ("validUntil", info.valid_until),
        ] {
            if let Some(time) = time {
                map.serialize_entry(key, &time.to_string())?;
            }
        }
        if let Some(rate_type) = &info.rate_type {
            map.serialize_entry("type", rate_type.as_str())?;
        }
        if let Some(quote) = info.quote.as_ref().filter(|quote| !quote.is_direct()) {
            map.serialize_entry("quote", quote)?;
        }
        if !self.derived_from.is_empty() {
            map.serialize_entry("derivedFrom", &self.derived_from)?;
        }
        map.end()
    }
}

impl<F: Currency, T: Currency> Serialize for Rate<F, T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.inner.serialize(serializer)
    }
}

impl Serialize for MoneyBag {
    /// The totals as a list of money values, as ducat's `toJSON`.
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_seq(self.values())
    }
}

/// A quote's fields.
struct QuoteVisitor;

impl<'de> Visitor<'de> for QuoteVisitor {
    type Value = RateQuote;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a quote: `{\"rate\":\"136.80\",\"per\":100}`")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<RateQuote, A::Error> {
        let (mut rate, mut per, mut inverted) = (None, None, false);
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "rate" => rate = Some(map.next_value::<String>()?),
                "per" => per = Some(map.next_value::<i64>()?),
                "inverted" => inverted = map.next_value::<bool>()?,
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(RateQuote {
            rate: rate.ok_or_else(|| de::Error::missing_field("rate"))?,
            per,
            inverted,
        })
    }
}

impl<'de> Deserialize<'de> for RateQuote {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(QuoteVisitor)
    }
}

fn code<E: de::Error>(text: &str) -> Result<CurrencyCode, E> {
    text.parse().map_err(E::custom)
}

fn time<E: de::Error>(text: &str) -> Result<Time, E> {
    text.parse().map_err(E::custom)
}

struct RateVisitor;

impl<'de> Visitor<'de> for RateVisitor {
    type Value = AnyRate;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a rate: `{\"from\":\"EUR\",\"to\":\"USD\",\"rate\":\"1.1165\"}`")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<AnyRate, A::Error> {
        let (mut from, mut to, mut rate) = (None, None, None);
        let mut info = RateInfo::default();
        let mut derived_from = Vec::new();
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "from" => from = Some(code(&map.next_value::<String>()?)?),
                "to" => to = Some(code(&map.next_value::<String>()?)?),
                "rate" => rate = Some(map.next_value::<String>()?),
                "source" => info.source = Some(map.next_value()?),
                "asOf" => info.as_of = Some(time(&map.next_value::<String>()?)?),
                "availableAt" => info.available_at = Some(time(&map.next_value::<String>()?)?),
                "validUntil" => info.valid_until = Some(time(&map.next_value::<String>()?)?),
                "type" => {
                    info.rate_type = Some(RateType::from(map.next_value::<String>()?.as_str()))
                }
                "quote" => info.quote = Some(map.next_value()?),
                "derivedFrom" => derived_from = map.next_value::<Vec<AnyRate>>()?,
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        let from = from.ok_or_else(|| de::Error::missing_field("from"))?;
        let to = to.ok_or_else(|| de::Error::missing_field("to"))?;
        let text = rate.ok_or_else(|| de::Error::missing_field("rate"))?;
        let mut built = AnyRate::new(from, to, text.as_str())
            .and_then(|built| built.with_info(info))
            .map_err(de::Error::custom)?;
        if built.info.quote.is_none() {
            built.info.quote = published_digits(&text);
        }
        built.derived_from = derived_from;
        Ok(built)
    }
}

impl<'de> Deserialize<'de> for AnyRate {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(RateVisitor)
    }
}

impl<'de, F: Currency, T: Currency> Deserialize<'de> for Rate<F, T> {
    /// As [`AnyRate`]'s, and the pair must be `F` → `T`.
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let rate = AnyRate::deserialize(deserializer)?;
        Self::try_from(rate).map_err(de::Error::custom)
    }
}
