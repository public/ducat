//! MySQL: DECIMAL and BIGINT values built by hand (as libmysqlclient and diesel-async hand them
//! to diesel), and against the server in `DUCAT_MYSQL_URL` (CI's mysql:8.4 service), in strict
//! mode as ducat's TypeScript tests run it, through diesel-async's `AsyncMysqlConnection`
//! (mysql_async, prepared statements).

use diesel::dsl::sql;
use diesel::mysql::MysqlType;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Numeric, Text};
use diesel_async::{AsyncConnection, AsyncMysqlConnection, RunQueryDsl, SimpleAsyncConnection};
use ducat::iso::{Eur, Jpy};
use ducat::{AnyMoney, Money};
use ducat_diesel::{
    DEFAULT_DECIMAL_SIZE, Decimal, DecimalColumn, DecimalColumnSize, Error, MinorColumn,
    minor_units,
};

use crate::common::{AMOUNTS, database_url, decimal, iso};
use crate::values::mysql::{read, write};
use crate::values::{decode_error, downcast_query};

#[test]
fn decimals_read_and_write_as_text() {
    assert_eq!(
        read::<Numeric, Decimal>(b"12.3400", MysqlType::Numeric),
        Ok(decimal("12.3400"))
    );
    assert_eq!(
        read::<Numeric, Decimal>(b"-0.01", MysqlType::String),
        Ok(decimal("-0.01"))
    );
    assert_eq!(
        read::<Numeric, DecimalColumn<Eur>>(b"12.3400", MysqlType::Numeric)
            .map(|column| column.0.to_string()),
        Ok("12.34 EUR".into())
    );
    assert_eq!(
        read::<Numeric, DecimalColumn<Jpy>>(b"12.3400", MysqlType::Numeric),
        Err(Error::Ducat(ducat::Error::Rounding))
    );
    for (bytes, ty, name) in [
        (0.1_f64.to_ne_bytes().to_vec(), MysqlType::Double, "DOUBLE"),
        (0.1_f32.to_ne_bytes().to_vec(), MysqlType::Float, "FLOAT"),
        (12_i64.to_ne_bytes().to_vec(), MysqlType::LongLong, "BIGINT"),
        (b"12".to_vec(), MysqlType::Blob, "BLOB"),
    ] {
        assert_eq!(
            read::<Numeric, Decimal>(&bytes, ty),
            Err(Error::UnexpectedType(name.into()))
        );
    }
    assert!(matches!(
        read::<Numeric, Decimal>(b"1e3", MysqlType::Numeric),
        Err(Error::Malformed(_))
    ));
    assert!(matches!(
        read::<Numeric, Decimal>(&[0xFF, b'1'], MysqlType::Numeric),
        Err(Error::Malformed(_))
    ));
    assert_eq!(
        write::<Numeric, _>(&decimal("-12.3400")),
        Ok((b"-12.3400".to_vec(), MysqlType::Numeric))
    );
    let price: Money<Eur> = "12.34".parse().unwrap();
    assert_eq!(
        write::<Numeric, _>(&DecimalColumn(price)),
        Ok((b"12.34".to_vec(), MysqlType::Numeric))
    );
    let fine = Money::<Eur>::from_units(1005, 3).unwrap();
    assert_eq!(
        write::<Numeric, _>(&DecimalColumn(fine)),
        Err(Error::ScaleMismatch {
            scale: 3,
            expected: 2
        })
    );
}

#[test]
fn minor_units_read_signed_integers_only() {
    let eur = |result: Result<MinorColumn<Eur>, Error>| result.map(|column| column.0.to_string());
    assert_eq!(
        eur(read::<BigInt, _>(
            &1234_i64.to_ne_bytes(),
            MysqlType::LongLong
        )),
        Ok("12.34 EUR".into())
    );
    assert_eq!(
        eur(read::<BigInt, _>(
            &i64::MIN.to_ne_bytes(),
            MysqlType::LongLong
        )),
        Ok("-92233720368547758.08 EUR".into())
    );
    assert_eq!(
        eur(read::<BigInt, _>(&(-5_i32).to_ne_bytes(), MysqlType::Long)),
        Ok("-0.05 EUR".into())
    );
    assert_eq!(
        eur(read::<BigInt, _>(
            &(-300_i16).to_ne_bytes(),
            MysqlType::Short
        )),
        Ok("-3.00 EUR".into())
    );
    assert_eq!(
        eur(read::<BigInt, _>(&[0xFF], MysqlType::Tiny)),
        Ok("-0.01 EUR".into())
    );
    // diesel-async hands a narrower integer over in eight bytes: the leading ones are its value
    assert_eq!(
        eur(read::<BigInt, _>(&7_i64.to_ne_bytes(), MysqlType::Long)),
        Ok("0.07 EUR".into())
    );
    for (bytes, ty, name) in [
        (
            u64::MAX.to_ne_bytes().to_vec(),
            MysqlType::UnsignedLongLong,
            "BIGINT UNSIGNED",
        ),
        (
            1_u32.to_ne_bytes().to_vec(),
            MysqlType::UnsignedLong,
            "INT UNSIGNED",
        ),
        (0.5_f64.to_ne_bytes().to_vec(), MysqlType::Double, "DOUBLE"),
        (b"12".to_vec(), MysqlType::Numeric, "DECIMAL"),
        (b"12".to_vec(), MysqlType::String, "VARCHAR"),
    ] {
        assert_eq!(
            read::<BigInt, MinorColumn<Eur>>(&bytes, ty),
            Err(Error::UnexpectedType(name.into()))
        );
    }
    // truncated values are errors, where diesel's own reader would index out of bounds
    for (bytes, ty) in [
        (&[][..], MysqlType::Tiny),
        (&[1][..], MysqlType::Short),
        (&[1, 2, 3][..], MysqlType::Long),
        (&[1, 2, 3, 4, 5, 6, 7][..], MysqlType::LongLong),
        (&[0; 9][..], MysqlType::LongLong),
    ] {
        assert!(
            matches!(
                read::<BigInt, MinorColumn<Eur>>(bytes, ty),
                Err(Error::Malformed(_))
            ),
            "{ty:?} {bytes:?}"
        );
    }
    let price: Money<Eur> = "-12.34".parse().unwrap();
    assert_eq!(
        write::<BigInt, _>(&MinorColumn(price)),
        Ok(((-1234_i64).to_ne_bytes().to_vec(), MysqlType::LongLong))
    );
    let beyond: Money<Eur> = "92233720368547758.08".parse().unwrap();
    assert_eq!(
        write::<BigInt, _>(&MinorColumn(beyond)),
        Err(Error::OutOfRange)
    );
}

diesel::table! {
    ducat_diesel_items (id) {
        id -> Integer,
        price -> Nullable<Numeric>,
        wide -> Nullable<Numeric>,
        minor -> Nullable<BigInt>,
        currency -> Nullable<Text>,
    }
}

use ducat_diesel_items as items;

async fn connect(url: &str) -> AsyncMysqlConnection {
    let mut connection = AsyncMysqlConnection::establish(url)
        .await
        .expect("a MySQL server");
    // one statement at a time: the text protocol's multi-statement support is a client flag
    for statement in [
        "SET SESSION sql_mode = 'STRICT_ALL_TABLES'",
        "DROP TABLE IF EXISTS ducat_diesel_items",
        "CREATE TABLE ducat_diesel_items (
            id INT PRIMARY KEY,
            price DECIMAL(19,4),
            wide DECIMAL(38,4),
            minor BIGINT,
            currency VARCHAR(8),
            loose DOUBLE,
            unsigned_minor BIGINT UNSIGNED
         )",
    ] {
        connection.batch_execute(statement).await.unwrap();
    }
    connection
}

#[tokio::test(flavor = "current_thread")]
async fn mysql() {
    let Some(url) = database_url("DUCAT_MYSQL_URL") else {
        return;
    };
    let connection = &mut connect(&url).await;
    amounts_round_trip(connection).await;
    fixed_currency_columns(connection).await;
    sized_writes(connection).await;
    inexact_types_are_refused(connection).await;
    connection
        .batch_execute("DROP TABLE ducat_diesel_items")
        .await
        .unwrap();
}

/// ducat's suite amounts, as DECIMAL(38,4) and BIGINT minor units beside a currency.
async fn amounts_round_trip(connection: &mut AsyncMysqlConnection) {
    let wide = DecimalColumnSize::new(38, 4).unwrap();
    for (id, (amount, code)) in AMOUNTS.iter().enumerate() {
        let money = AnyMoney::parse(amount, iso(code)).unwrap();
        diesel::insert_into(items::table)
            .values((
                items::id.eq(i32::try_from(id).unwrap()),
                items::wide.eq(wide.fit(&money).unwrap()),
                items::minor.eq(minor_units(&money).unwrap()),
                items::currency.eq(*code),
            ))
            .execute(connection)
            .await
            .unwrap();
    }
    let rows: Vec<(Decimal, i64, String)> = items::table
        .order(items::id)
        .select((
            sql::<Numeric>("wide"),
            sql::<BigInt>("minor"),
            sql::<Text>("currency"),
        ))
        .load(connection)
        .await
        .unwrap();
    assert_eq!(rows.len(), AMOUNTS.len());
    for ((stored, minor, currency), (amount, code)) in rows.iter().zip(AMOUNTS) {
        let currency = iso(currency);
        let original = AnyMoney::parse(amount, iso(code)).unwrap();
        // DECIMAL(38,4) pads to four decimals
        assert_eq!(stored.scale(), 4);
        assert!(
            stored
                .to_money_at_exponent(currency)
                .unwrap()
                .identical(&original)
        );
        assert!(AnyMoney::from_minor(*minor, currency).identical(&original));
    }
    // 2^53 + 1 minor units, exactly
    let MinorColumn(beyond): MinorColumn<Eur> =
        diesel::select(sql::<BigInt>("CAST(9007199254740993 AS SIGNED)"))
            .get_result(connection)
            .await
            .unwrap();
    assert_eq!(beyond.to_string(), "90071992547409.93 EUR");
    diesel::delete(items::table)
        .execute(connection)
        .await
        .unwrap();
}

async fn fixed_currency_columns(connection: &mut AsyncMysqlConnection) {
    let price: Money<Eur> = "12.34".parse().unwrap();
    diesel::insert_into(items::table)
        .values((
            items::id.eq(1),
            items::price.eq(DecimalColumn(price.clone())),
            items::minor.eq(MinorColumn(price.clone())),
        ))
        .execute(connection)
        .await
        .unwrap();
    let (decimal_back, minor_back): (Option<DecimalColumn<Eur>>, Option<MinorColumn<Eur>>) =
        items::table
            .filter(items::id.eq(1))
            .select((items::price, items::minor))
            .get_result(connection)
            .await
            .unwrap();
    assert!(decimal_back.unwrap().0.identical(&price) && minor_back.unwrap().0.identical(&price));
    let stored: Option<Decimal> = items::table
        .filter(items::id.eq(1))
        .select(items::price)
        .get_result(connection)
        .await
        .unwrap();
    assert_eq!(stored, Some(decimal("12.3400")));
    // a yen column refuses the cents
    let error = items::table
        .filter(items::id.eq(1))
        .select(sql::<Numeric>("price"))
        .get_result::<DecimalColumn<Jpy>>(connection)
        .await
        .unwrap_err();
    assert_eq!(decode_error(error), Error::Ducat(ducat::Error::Rounding));
    diesel::delete(items::table)
        .execute(connection)
        .await
        .unwrap();
}

/// What DECIMAL(19,4) couldn't hold unchanged is refused before MySQL sees it.
async fn sized_writes(connection: &mut AsyncMysqlConnection) {
    let too_big: Money<Eur> = "1000000000000000".parse().unwrap();
    assert!(matches!(
        DEFAULT_DECIMAL_SIZE.fit(&too_big),
        Err(Error::TooManyIntegerDigits { .. })
    ));
    let fits: Money<Eur> = "999999999999999.99".parse().unwrap();
    diesel::insert_into(items::table)
        .values((
            items::id.eq(2),
            items::price.eq(DEFAULT_DECIMAL_SIZE.fit(&fits).unwrap()),
        ))
        .execute(connection)
        .await
        .unwrap();
    let back: Option<DecimalColumn<Eur>> = items::table
        .filter(items::id.eq(2))
        .select(items::price)
        .get_result(connection)
        .await
        .unwrap();
    assert!(back.unwrap().0.identical(&fits));
    // a write at another scale never reaches the server
    let fine = Money::<Eur>::from_units(1005, 3).unwrap();
    let error = diesel::insert_into(items::table)
        .values((items::id.eq(3), items::price.eq(DecimalColumn(fine))))
        .execute(connection)
        .await
        .unwrap_err();
    assert!(matches!(downcast_query(error), Error::ScaleMismatch { .. }));
    diesel::delete(items::table)
        .execute(connection)
        .await
        .unwrap();
}

/// A DOUBLE has been through a float, and an unsigned BIGINT isn't BIGINT's range: both are
/// refused whatever SQL type the query claims for them.
async fn inexact_types_are_refused(connection: &mut AsyncMysqlConnection) {
    connection
        .batch_execute(
            "INSERT INTO ducat_diesel_items (id, loose, unsigned_minor) VALUES (3, 0.1, 18446744073709551615)",
        )
        .await
        .unwrap();
    let column = |name: &'static str| {
        items::table
            .filter(items::id.eq(3))
            .select(sql::<Numeric>(name))
    };
    let error = column("loose")
        .get_result::<Decimal>(connection)
        .await
        .unwrap_err();
    assert_eq!(decode_error(error), Error::UnexpectedType("DOUBLE".into()));
    let error = column("loose")
        .get_result::<DecimalColumn<Eur>>(connection)
        .await
        .unwrap_err();
    assert_eq!(decode_error(error), Error::UnexpectedType("DOUBLE".into()));
    let minor = |name: &'static str| {
        items::table
            .filter(items::id.eq(3))
            .select(sql::<BigInt>(name))
    };
    let error = minor("loose")
        .get_result::<MinorColumn<Eur>>(connection)
        .await
        .unwrap_err();
    assert_eq!(decode_error(error), Error::UnexpectedType("DOUBLE".into()));
    let error = minor("unsigned_minor")
        .get_result::<MinorColumn<Eur>>(connection)
        .await
        .unwrap_err();
    assert_eq!(
        decode_error(error),
        Error::UnexpectedType("BIGINT UNSIGNED".into())
    );
    // decimal text in a string column is still exact
    let from_text: Decimal = diesel::select(sql::<Numeric>("CAST('12.50' AS CHAR)"))
        .get_result(connection)
        .await
        .unwrap();
    assert_eq!(from_text, decimal("12.50"));
    diesel::delete(items::table)
        .execute(connection)
        .await
        .unwrap();
}
