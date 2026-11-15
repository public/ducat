//! MySQL, against the server in `DUCAT_MYSQL_URL` (CI's mysql:8.4 service), in strict mode as
//! ducat's TypeScript tests run it: DECIMAL and BIGINT in both protocols, and the types that
//! aren't exact.

use ducat::iso::{Eur, Jpy};
use ducat::{AnyMoney, Money};
use ducat_sqlx::{
    DEFAULT_DECIMAL_SIZE, Decimal, DecimalColumn, DecimalColumnSize, Error, MinorColumn,
    minor_units,
};
use sqlx::mysql::MySqlPoolOptions;
use sqlx::{Executor, MySqlPool, Row};

use crate::common::{AMOUNTS, database_url, decimal, iso};

async fn connect(url: &str) -> MySqlPool {
    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .after_connect(|connection, _| {
            Box::pin(async move {
                connection
                    .execute("SET SESSION sql_mode = 'STRICT_ALL_TABLES'")
                    .await?;
                Ok(())
            })
        })
        .connect(url)
        .await
        .expect("a MySQL server");
    sqlx::raw_sql(
        "DROP TABLE IF EXISTS ducat_sqlx_items;
         CREATE TABLE ducat_sqlx_items (
            id INT PRIMARY KEY,
            price DECIMAL(19,4),
            wide DECIMAL(38,4),
            minor BIGINT,
            currency VARCHAR(8),
            loose DOUBLE,
            unsigned_minor BIGINT UNSIGNED
         )",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool
}

/// The error a decode failed with, from sqlx's `ColumnDecode` error.
fn decode_error(error: &sqlx::Error) -> Option<&Error> {
    match error {
        sqlx::Error::ColumnDecode { source, .. } => source.downcast_ref::<Error>(),
        _ => None,
    }
}

#[tokio::test(flavor = "current_thread")]
async fn mysql() {
    let Some(url) = database_url("DUCAT_MYSQL_URL") else {
        return;
    };
    let pool = connect(&url).await;
    amounts_round_trip(&pool).await;
    fixed_currency_columns(&pool).await;
    sized_writes(&pool).await;
    inexact_types_are_refused(&pool).await;
    sqlx::raw_sql("DROP TABLE ducat_sqlx_items")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
}

/// ducat's suite amounts, as DECIMAL(38,4) and BIGINT minor units beside a currency, read back
/// through the binary (prepared) and the text protocol.
async fn amounts_round_trip(pool: &MySqlPool) {
    let wide = DecimalColumnSize::new(38, 4).unwrap();
    for (id, (amount, code)) in AMOUNTS.iter().enumerate() {
        let money = AnyMoney::parse(amount, iso(code)).unwrap();
        sqlx::query("INSERT INTO ducat_sqlx_items (id, wide, minor, currency) VALUES (?, ?, ?, ?)")
            .bind(i32::try_from(id).unwrap())
            .bind(wide.fit(&money).unwrap())
            .bind(minor_units(&money).unwrap())
            .bind(code)
            .execute(pool)
            .await
            .unwrap();
    }
    let binary = sqlx::query("SELECT wide, minor, currency FROM ducat_sqlx_items ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap();
    let text = sqlx::raw_sql("SELECT wide, minor, currency FROM ducat_sqlx_items ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap();
    for rows in [&binary, &text] {
        assert_eq!(rows.len(), AMOUNTS.len());
        for (row, (amount, code)) in rows.iter().zip(AMOUNTS) {
            let currency = iso(&row.get::<String, _>("currency"));
            let original = AnyMoney::parse(amount, iso(code)).unwrap();
            let stored: Decimal = row.get("wide");
            // DECIMAL(38,4) pads to four decimals
            assert_eq!(stored.scale(), 4);
            assert!(
                stored
                    .to_money_at_exponent(currency)
                    .unwrap()
                    .identical(&original)
            );
            let minor: i64 = row.get("minor");
            assert!(AnyMoney::from_minor(minor, currency).identical(&original));
        }
    }
    // 2^53 + 1 minor units, exactly
    let MinorColumn(beyond): MinorColumn<Eur> =
        sqlx::query_scalar("SELECT CAST(9007199254740993 AS SIGNED)")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(beyond.to_string(), "90071992547409.93 EUR");
    sqlx::raw_sql("DELETE FROM ducat_sqlx_items")
        .execute(pool)
        .await
        .unwrap();
}

async fn fixed_currency_columns(pool: &MySqlPool) {
    let price: Money<Eur> = "12.34".parse().unwrap();
    sqlx::query("INSERT INTO ducat_sqlx_items (id, price, minor) VALUES (1, ?, ?)")
        .bind(DecimalColumn(price.clone()))
        .bind(MinorColumn(price.clone()))
        .execute(pool)
        .await
        .unwrap();
    let (DecimalColumn(decimal_back), MinorColumn(minor_back)): (
        DecimalColumn<Eur>,
        MinorColumn<Eur>,
    ) = sqlx::query_as("SELECT price, minor FROM ducat_sqlx_items WHERE id = 1")
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(decimal_back.identical(&price) && minor_back.identical(&price));
    let stored: Decimal = sqlx::query_scalar("SELECT price FROM ducat_sqlx_items WHERE id = 1")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(stored, decimal("12.3400"));
    // a yen column refuses the cents
    let error = sqlx::query_as::<_, (DecimalColumn<Jpy>,)>(
        "SELECT price FROM ducat_sqlx_items WHERE id = 1",
    )
    .fetch_one(pool)
    .await
    .unwrap_err();
    assert_eq!(
        decode_error(&error),
        Some(&Error::Ducat(ducat::Error::Rounding))
    );
    sqlx::raw_sql("DELETE FROM ducat_sqlx_items")
        .execute(pool)
        .await
        .unwrap();
}

/// What DECIMAL(19,4) couldn't hold unchanged is refused before MySQL sees it.
async fn sized_writes(pool: &MySqlPool) {
    let too_big: Money<Eur> = "1000000000000000".parse().unwrap();
    assert!(matches!(
        DEFAULT_DECIMAL_SIZE.fit(&too_big),
        Err(Error::TooManyIntegerDigits { .. })
    ));
    // strict mode would refuse it too; the guard means it never gets that far
    let fits: Money<Eur> = "999999999999999.99".parse().unwrap();
    sqlx::query("INSERT INTO ducat_sqlx_items (id, price) VALUES (2, ?)")
        .bind(DEFAULT_DECIMAL_SIZE.fit(&fits).unwrap())
        .execute(pool)
        .await
        .unwrap();
    let DecimalColumn(back): DecimalColumn<Eur> =
        sqlx::query_scalar("SELECT price FROM ducat_sqlx_items WHERE id = 2")
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(back.identical(&fits));
    sqlx::raw_sql("DELETE FROM ducat_sqlx_items")
        .execute(pool)
        .await
        .unwrap();
}

/// A DOUBLE has been through a float, and an unsigned BIGINT isn't BIGINT's range: both are
/// refused, checked or not, in both protocols.
async fn inexact_types_are_refused(pool: &MySqlPool) {
    sqlx::raw_sql("INSERT INTO ducat_sqlx_items (id, loose, unsigned_minor) VALUES (3, 0.1, 18446744073709551615)")
        .execute(pool)
        .await
        .unwrap();
    let sql = "SELECT loose, unsigned_minor FROM ducat_sqlx_items WHERE id = 3";
    let binary = sqlx::query(sql).fetch_one(pool).await.unwrap();
    let text = sqlx::raw_sql(sql).fetch_one(pool).await.unwrap();
    for row in [&binary, &text] {
        assert!(row.try_get::<Decimal, _>("loose").is_err());
        assert!(row.try_get::<DecimalColumn<Eur>, _>("loose").is_err());
        assert!(row.try_get::<MinorColumn<Eur>, _>("loose").is_err());
        assert!(
            row.try_get::<MinorColumn<Eur>, _>("unsigned_minor")
                .is_err()
        );
        let error = row.try_get_unchecked::<Decimal, _>("loose").unwrap_err();
        assert_eq!(
            decode_error(&error),
            Some(&Error::UnexpectedType("DOUBLE".into()))
        );
        let error = row
            .try_get_unchecked::<MinorColumn<Eur>, _>("loose")
            .unwrap_err();
        assert_eq!(
            decode_error(&error),
            Some(&Error::UnexpectedType("DOUBLE".into()))
        );
        let error = row
            .try_get_unchecked::<MinorColumn<Eur>, _>("unsigned_minor")
            .unwrap_err();
        assert_eq!(
            decode_error(&error),
            Some(&Error::UnexpectedType("BIGINT UNSIGNED".into()))
        );
    }
    // decimal text in a string column is still exact
    let from_text: Decimal = sqlx::query_scalar("SELECT CAST('12.50' AS CHAR)")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(from_text, decimal("12.50"));
    sqlx::raw_sql("DELETE FROM ducat_sqlx_items")
        .execute(pool)
        .await
        .unwrap();
}
