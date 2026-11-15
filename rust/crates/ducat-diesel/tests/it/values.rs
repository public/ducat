//! Values read and written without a database, through diesel's own traits: `FromSql` on
//! hand-built bytes (`PgValue::new`, `MysqlValue::new`) and `ToSql` through diesel's bind
//! collector, so the bytes are the ones a connection would send.

#![allow(dead_code)] // each database module uses its own share

use ducat_diesel::Error;

/// The crate's error inside one of diesel's boxes; a load wraps it once more, in a
/// `DeserializeFieldError` naming the field.
pub fn downcast(error: Box<dyn std::error::Error + Send + Sync>) -> Error {
    let error = match error.downcast::<diesel::result::DeserializeFieldError>() {
        Ok(field) => field.error,
        Err(error) => error,
    };
    match error.downcast::<Error>() {
        Ok(error) => *error,
        Err(other) => panic!("not ducat-diesel's error: {other}"),
    }
}

/// The crate's error inside a `diesel::result::Error::DeserializationError`, as a load fails.
pub fn decode_error(error: diesel::result::Error) -> Error {
    match error {
        diesel::result::Error::DeserializationError(error) => downcast(error),
        other => panic!("not a deserialization error: {other}"),
    }
}

/// The crate's error inside a `diesel::result::Error::SerializationError`.
pub fn downcast_query(error: diesel::result::Error) -> Error {
    match error {
        diesel::result::Error::SerializationError(error) => downcast(error),
        other => panic!("not a serialization error: {other}"),
    }
}

#[cfg(feature = "postgres")]
pub mod pg {
    use std::num::NonZeroU32;

    use diesel::deserialize::FromSql;
    use diesel::pg::{Pg, PgMetadataLookup, PgTypeMetadata, PgValue};
    use diesel::query_builder::BindCollector;
    use diesel::query_builder::bind_collector::RawBytesBindCollector;
    use diesel::serialize::ToSql;
    use diesel::sql_types::HasSqlType;
    use ducat_diesel::Error;

    /// The OIDs the fake lookup gives `ducat_money` and its array.
    pub const MONEY_OID: u32 = 90_001;
    pub const MONEY_ARRAY_OID: u32 = 90_002;

    /// A metadata lookup that knows only the composite type, as a connection resolves it.
    struct Lookup;

    impl PgMetadataLookup for Lookup {
        fn lookup_type(&mut self, type_name: &str, schema: Option<&str>) -> PgTypeMetadata {
            assert_eq!((type_name, schema), ("ducat_money", None));
            PgTypeMetadata::new(MONEY_OID, MONEY_ARRAY_OID)
        }
    }

    /// `T` read from the bytes of a value of type `oid`.
    pub fn read<ST, T: FromSql<ST, Pg>>(bytes: &[u8], oid: u32) -> Result<T, Error> {
        let oid = NonZeroU32::new(oid).expect("an OID");
        T::from_sql(PgValue::new(bytes, &oid)).map_err(super::downcast)
    }

    /// The bytes diesel sends for `value` as `ST`, and the type OID it sends them as.
    pub fn write_typed<ST, T: ToSql<ST, Pg>>(value: &T) -> Result<(Vec<u8>, u32), Error>
    where
        Pg: HasSqlType<ST>,
    {
        let mut collector = RawBytesBindCollector::<Pg>::new();
        collector
            .push_bound_value::<ST, T>(value, &mut Lookup)
            .map_err(super::downcast_query)?;
        let bytes = collector.binds.pop().flatten().expect("a value, not NULL");
        let oid = collector
            .metadata
            .pop()
            .expect("metadata")
            .oid()
            .expect("an OID");
        Ok((bytes, oid))
    }

    /// The bytes diesel sends for `value` as `ST`.
    pub fn write<ST, T: ToSql<ST, Pg>>(value: &T) -> Result<Vec<u8>, Error>
    where
        Pg: HasSqlType<ST>,
    {
        write_typed::<ST, T>(value).map(|(bytes, _)| bytes)
    }
}

#[cfg(feature = "mysql")]
pub mod mysql {
    use diesel::deserialize::FromSql;
    use diesel::mysql::{Mysql, MysqlType, MysqlValue};
    use diesel::query_builder::BindCollector;
    use diesel::query_builder::bind_collector::RawBytesBindCollector;
    use diesel::serialize::ToSql;
    use diesel::sql_types::HasSqlType;
    use ducat_diesel::Error;

    /// `T` read from the bytes of a value of type `ty`.
    pub fn read<ST, T: FromSql<ST, Mysql>>(bytes: &[u8], ty: MysqlType) -> Result<T, Error> {
        T::from_sql(MysqlValue::new(bytes, ty)).map_err(super::downcast)
    }

    /// The bytes diesel sends for `value` as `ST`, and the MySQL type it sends them as.
    pub fn write<ST, T: ToSql<ST, Mysql>>(value: &T) -> Result<(Vec<u8>, MysqlType), Error>
    where
        Mysql: HasSqlType<ST>,
    {
        let mut collector = RawBytesBindCollector::<Mysql>::new();
        collector
            .push_bound_value::<ST, T>(value, &mut ())
            .map_err(super::downcast_query)?;
        let bytes = collector.binds.pop().flatten().expect("a value, not NULL");
        Ok((bytes, collector.metadata.pop().expect("metadata")))
    }
}
