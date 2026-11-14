//! serde support: ducat's JSON shape, `{"amount":"12.34","currency":"EUR"}`.
//!
//! - **Serialize** writes the exact amount at the value's own scale, as a string, and the code.
//!   No format gets a float.
//! - **Deserialize** reads the amount as [`FromStr`](core::str::FromStr) does: at the currency's
//!   exponent, without rounding. So 12.340 EUR at scale 3 serializes as `"12.340"`, which reads
//!   back as 12.34 EUR, and 1.005 EUR at scale 3 serializes as `"1.005"`, which is an error on
//!   the way back in rather than a lost digit. Both are ducat's `toJSON` and `fromJSON`.
//! - Only ISO 4217 codes deserialize: a custom currency's exponent isn't in the JSON.

use core::fmt;
use core::marker::PhantomData;

use serde::de::{self, MapAccess, Visitor};
use serde::ser::SerializeStruct;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::{AnyMoney, Currency, Money};

impl Serialize for AnyMoney {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("Money", 2)?;
        state.serialize_field("amount", &self.to_decimal())?;
        state.serialize_field("currency", self.currency().as_str())?;
        state.end()
    }
}

impl<C: Currency> Serialize for Money<C> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("Money", 2)?;
        state.serialize_field("amount", &self.to_decimal())?;
        state.serialize_field("currency", C::CODE.as_str())?;
        state.end()
    }
}

enum Field {
    Amount,
    Currency,
}

impl<'de> Deserialize<'de> for Field {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct FieldVisitor;
        impl Visitor<'_> for FieldVisitor {
            type Value = Field;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("`amount` or `currency`")
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<Field, E> {
                match value {
                    "amount" => Ok(Field::Amount),
                    "currency" => Ok(Field::Currency),
                    other => Err(E::unknown_field(other, FIELDS)),
                }
            }
        }
        deserializer.deserialize_identifier(FieldVisitor)
    }
}

const FIELDS: &[&str] = &["amount", "currency"];

/// A string field, borrowed where the format allows and owned otherwise.
struct Text(alloc::string::String);

impl<'de> Deserialize<'de> for Text {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct TextVisitor;
        impl Visitor<'_> for TextVisitor {
            type Value = Text;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a string")
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<Text, E> {
                Ok(Text(value.into()))
            }
        }
        deserializer.deserialize_str(TextVisitor)
    }
}

struct MoneyVisitor;

impl<'de> Visitor<'de> for MoneyVisitor {
    type Value = AnyMoney;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(r#"money as {"amount": "12.34", "currency": "EUR"}"#)
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<AnyMoney, A::Error> {
        let mut amount: Option<Text> = None;
        let mut currency: Option<Text> = None;
        while let Some(key) = map.next_key()? {
            match key {
                Field::Amount if amount.is_some() => {
                    return Err(de::Error::duplicate_field("amount"));
                }
                Field::Currency if currency.is_some() => {
                    return Err(de::Error::duplicate_field("currency"));
                }
                Field::Amount => amount = Some(map.next_value()?),
                Field::Currency => currency = Some(map.next_value()?),
            }
        }
        let amount = amount.ok_or_else(|| de::Error::missing_field("amount"))?;
        let currency = currency.ok_or_else(|| de::Error::missing_field("currency"))?;
        let code = currency.0.parse().map_err(de::Error::custom)?;
        AnyMoney::parse(&amount.0, code).map_err(de::Error::custom)
    }

    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<AnyMoney, A::Error> {
        let amount: Text = seq
            .next_element()?
            .ok_or_else(|| de::Error::invalid_length(0, &self))?;
        let currency: Text = seq
            .next_element()?
            .ok_or_else(|| de::Error::invalid_length(1, &self))?;
        let code = currency.0.parse().map_err(de::Error::custom)?;
        AnyMoney::parse(&amount.0, code).map_err(de::Error::custom)
    }
}

impl<'de> Deserialize<'de> for AnyMoney {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_struct("Money", FIELDS, MoneyVisitor)
    }
}

impl<'de, C: Currency> Deserialize<'de> for Money<C> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let any = AnyMoney::deserialize(deserializer)?;
        let _: PhantomData<C> = PhantomData;
        Money::try_from(any).map_err(de::Error::custom)
    }
}
