//! SQLite, in memory: ducat's drizzle/sqlite column shapes (TEXT decimals, INTEGER minor units)
//! through sqlx, and the values SQLite's dynamic typing could slip in instead.

use ducat::iso::{Eur, Jpy, Kwd};
use ducat::{AnyMoney, Money, Rounding};
use ducat_sqlx::{Decimal, DecimalColumn, Error, MinorColumn, minor_units};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Row, SqlitePool};

use crate::common::{AMOUNTS, decimal, iso};

async fn database() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("an in-memory SQLite");
    sqlx::raw_sql(
        "CREATE TABLE items (
            id INTEGER PRIMARY KEY,
            price TEXT,
            total_minor INTEGER,
            currency TEXT,
            loose
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

#[tokio::test]
async fn amounts_round_trip_in_both_shapes() {
    let pool = database().await;
    for (id, (amount, code)) in AMOUNTS.iter().enumerate() {
        let money = AnyMoney::parse(amount, iso(code)).unwrap();
        sqlx::query("INSERT INTO items (id, price, total_minor, currency) VALUES (?, ?, ?, ?)")
            .bind(i64::try_from(id).unwrap())
            .bind(Decimal::from_money(&money))
            .bind(minor_units(&money).unwrap())
            .bind(code)
            .execute(&pool)
            .await
            .unwrap();
    }
    let rows = sqlx::query(
        "SELECT price, total_minor, currency, typeof(price) AS kind FROM items ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    for (row, (amount, code)) in rows.iter().zip(AMOUNTS) {
        let currency = iso(&row.get::<String, _>("currency"));
        assert_eq!(currency, iso(code));
        assert_eq!(row.get::<String, _>("kind"), "text");
        let price: Decimal = row.get("price");
        assert_eq!(price.to_string(), amount);
        let original = AnyMoney::parse(amount, currency).unwrap();
        assert!(
            price
                .to_money_at_exponent(currency)
                .unwrap()
                .identical(&original)
        );
        let minor: i64 = row.get("total_minor");
        assert!(AnyMoney::from_minor(minor, currency).identical(&original));
    }
}

#[tokio::test]
async fn fixed_currency_columns() {
    let pool = database().await;
    let price: Money<Eur> = "92233720368547758.07".parse().unwrap();
    sqlx::query("INSERT INTO items (id, price, total_minor) VALUES (1, ?, ?)")
        .bind(DecimalColumn(price.clone()))
        .bind(MinorColumn(price.clone()))
        .execute(&pool)
        .await
        .unwrap();
    let (DecimalColumn(decimal_back), MinorColumn(minor_back)): (
        DecimalColumn<Eur>,
        MinorColumn<Eur>,
    ) = sqlx::query_as("SELECT price, total_minor FROM items WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(decimal_back.identical(&price) && minor_back.identical(&price));

    // trailing zeros read; more decimals than the currency's don't
    sqlx::raw_sql("INSERT INTO items (id, price) VALUES (2, '12.3400'), (3, '12.345'), (4, '1.5')")
        .execute(&pool)
        .await
        .unwrap();
    let (DecimalColumn(read),): (DecimalColumn<Eur>,) =
        sqlx::query_as("SELECT price FROM items WHERE id = 2")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(read.to_string(), "12.34 EUR");
    let error = sqlx::query_as::<_, (DecimalColumn<Eur>,)>("SELECT price FROM items WHERE id = 3")
        .fetch_one(&pool)
        .await
        .unwrap_err();
    assert_eq!(
        decode_error(&error),
        Some(&Error::Ducat(ducat::Error::Rounding))
    );
    let error = sqlx::query_as::<_, (DecimalColumn<Jpy>,)>("SELECT price FROM items WHERE id = 4")
        .fetch_one(&pool)
        .await
        .unwrap_err();
    assert_eq!(
        decode_error(&error),
        Some(&Error::Ducat(ducat::Error::Rounding))
    );
    let (DecimalColumn(dinars),): (DecimalColumn<Kwd>,) =
        sqlx::query_as("SELECT price FROM items WHERE id = 4")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(dinars.to_string(), "1.500 KWD");
}

#[tokio::test]
async fn writes_refuse_what_the_column_would_change() {
    let pool = database().await;
    let fine = Money::<Eur>::from_units(1005, 3).unwrap();
    // try_bind hands back the encoder's own error
    let mut query = sqlx::query::<sqlx::Sqlite>("INSERT INTO items (id, price) VALUES (1, ?)");
    let error = query.try_bind(DecimalColumn(fine.clone())).unwrap_err();
    let mismatch = Error::ScaleMismatch {
        scale: 3,
        expected: 2,
    };
    assert_eq!(error.downcast_ref::<Error>(), Some(&mismatch));
    let mut query =
        sqlx::query::<sqlx::Sqlite>("INSERT INTO items (id, total_minor) VALUES (1, ?)");
    let error = query.try_bind(MinorColumn(fine.clone())).unwrap_err();
    assert_eq!(error.downcast_ref::<Error>(), Some(&mismatch));
    let beyond: Money<Eur> = "92233720368547758.08".parse().unwrap();
    let error = query.try_bind(MinorColumn(beyond.clone())).unwrap_err();
    assert_eq!(error.downcast_ref::<Error>(), Some(&Error::OutOfRange));
    // bind keeps it for execute, as text
    for result in [
        sqlx::query("INSERT INTO items (id, price) VALUES (1, ?)")
            .bind(DecimalColumn(fine.clone()))
            .execute(&pool)
            .await,
        sqlx::query("INSERT INTO items (id, total_minor) VALUES (1, ?)")
            .bind(MinorColumn(beyond))
            .execute(&pool)
            .await,
    ] {
        let error = result.unwrap_err();
        assert!(matches!(error, sqlx::Error::Encode(_)), "{error:?}");
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM items")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let rounded = fine.to_scale(2, Rounding::HalfEven).unwrap();
    sqlx::query("INSERT INTO items (id, price) VALUES (1, ?)")
        .bind(DecimalColumn(rounded))
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn reals_and_other_storage_classes_are_refused() {
    let pool = database().await;
    // a column without affinity keeps what it's given: a REAL, an INTEGER, a TEXT
    sqlx::raw_sql(
        "INSERT INTO items (id, loose) VALUES (1, 0.1), (2, 12), (3, '12.34'), (4, 1e300), (5, x'3132')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let decimal_at = |id: i64| {
        let pool = pool.clone();
        async move {
            sqlx::query("SELECT loose FROM items WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap()
                .try_get::<Decimal, _>("loose")
        }
    };
    let minor_at = |id: i64| {
        let pool = pool.clone();
        async move {
            sqlx::query("SELECT loose FROM items WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap()
                .try_get::<MinorColumn<Eur>, _>("loose")
        }
    };
    assert_eq!(decimal_at(3).await.unwrap(), decimal("12.34"));
    assert_eq!(minor_at(2).await.unwrap().0.to_string(), "0.12 EUR");
    for id in [1, 2, 4, 5] {
        assert!(decimal_at(id).await.is_err(), "row {id} as a decimal");
    }
    for id in [1, 3, 4, 5] {
        assert!(minor_at(id).await.is_err(), "row {id} as minor units");
    }
    // unchecked, the decoder itself still refuses the REAL rather than truncating it
    let row = sqlx::query("SELECT loose FROM items WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let error = row
        .try_get_unchecked::<MinorColumn<Eur>, _>("loose")
        .unwrap_err();
    assert_eq!(
        decode_error(&error),
        Some(&Error::UnexpectedType("REAL".into()))
    );
    let error = row.try_get_unchecked::<Decimal, _>("loose").unwrap_err();
    assert_eq!(
        decode_error(&error),
        Some(&Error::UnexpectedType("REAL".into()))
    );
    // NULL is an Option
    let row = sqlx::query("SELECT price FROM items WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.get::<Option<Decimal>, _>("price"), None);
}

#[tokio::test]
async fn malformed_text_is_refused() {
    let pool = database().await;
    sqlx::raw_sql(
        "INSERT INTO items (id, price) VALUES (1, 'NaN'), (2, '1e3'), (3, ' 1'), (4, '')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let rows = sqlx::query("SELECT price FROM items ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    let errors: Vec<_> = rows
        .iter()
        .map(|row| row.try_get::<Decimal, _>("price").unwrap_err())
        .collect();
    assert_eq!(decode_error(&errors[0]), Some(&Error::NotANumber));
    for error in &errors[1..] {
        assert!(
            matches!(decode_error(error), Some(Error::Malformed(_))),
            "{error:?}"
        );
    }
}
