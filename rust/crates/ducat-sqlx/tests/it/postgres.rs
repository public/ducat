//! Postgres, against the server in `DUCAT_PG_URL` (CI's postgres:18 service), in a schema of
//! its own: NUMERIC in both formats, BIGINT, the composite type and its `sum`, and the arrays.

use std::str::FromStr;

use ducat::iso::{Eur, Jpy, Kwd};
use ducat::{AnyMoney, Money};
use ducat_sqlx::pg::{MoneyRecord, PgMoney, money_type_sql};
use ducat_sqlx::{DEFAULT_DECIMAL_SIZE, Decimal, DecimalColumn, Error, MinorColumn};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{PgPool, Row};

use crate::common::{AMOUNTS, database_url, decimal, iso, pow10};

const SCHEMA: &str = "ducat_sqlx_test";

async fn connect(url: &str) -> PgPool {
    let options = PgConnectOptions::from_str(url)
        .expect("a Postgres URL")
        .options([("search_path", SCHEMA)]);
    // one connection, so the statements below run in order on it
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("a Postgres server");
    sqlx::raw_sql(&format!(
        "DROP SCHEMA IF EXISTS {SCHEMA} CASCADE; CREATE SCHEMA {SCHEMA};
         DROP SCHEMA IF EXISTS ducat_sqlx_other CASCADE; CREATE SCHEMA ducat_sqlx_other;"
    ))
    .execute(&pool)
    .await
    .unwrap();
    for statement in money_type_sql("ducat_money")
        .unwrap()
        .into_iter()
        .chain(money_type_sql("ducat_sqlx_other.amount").unwrap())
    {
        sqlx::raw_sql(&statement).execute(&pool).await.unwrap();
    }
    sqlx::raw_sql(
        "CREATE TABLE items (
            id integer PRIMARY KEY,
            price ducat_money,
            n numeric,
            n19 numeric(19,4),
            minor bigint
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
async fn postgres() {
    let Some(url) = database_url("DUCAT_PG_URL") else {
        return;
    };
    let pool = connect(&url).await;
    numeric_round_trips(&pool).await;
    numeric_text_format(&pool).await;
    special_values(&pool).await;
    bigint_minor_units(&pool).await;
    fixed_currency_decimals(&pool).await;
    composite_round_trips(&pool).await;
    composite_refusals(&pool).await;
    composite_sum(&pool).await;
    other_composite_names(&pool).await;
    pool.close().await;
}

/// Decimals through a NUMERIC parameter and back, binary both ways, and Postgres's own text of
/// them.
async fn numeric_round_trips(pool: &PgPool) {
    let mut values: Vec<Decimal> = AMOUNTS.iter().map(|(amount, _)| decimal(amount)).collect();
    values.extend(
        [
            "0",
            "0.0000",
            "-0.0001",
            "0.00000001",
            "12.3400",
            "-9223372036854775808",
            "9223372036854775809",
            "170141183460469231731687303715884105728",
        ]
        .map(decimal),
    );
    values.push(Decimal::new(pow10(1000), 0).unwrap());
    values.push(Decimal::new(1, 1000).unwrap());
    values.push(Decimal::new(pow10(1000), 1000).unwrap());
    values.push(Decimal::new(-15, 1).unwrap().clone());
    for value in &values {
        let row = sqlx::query("SELECT $1::numeric AS n, $1::numeric::text AS text")
            .bind(value)
            .fetch_one(pool)
            .await
            .unwrap();
        assert_eq!(&row.get::<Decimal, _>("n"), value);
        assert_eq!(row.get::<String, _>("text"), value.to_string());
    }
    // arrays, NULLs inside included
    let array: Vec<Option<Decimal>> = vec![Some(decimal("1.10")), None, Some(decimal("-2.5"))];
    let back: Vec<Option<Decimal>> = sqlx::query_scalar("SELECT $1::numeric[]")
        .bind(&array)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(back, array);
    // Postgres's own arithmetic, read back exactly
    let sum: Decimal = sqlx::query_scalar("SELECT 0.1::numeric + 0.2::numeric")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(sum, decimal("0.3"));
    let quotient: Decimal = sqlx::query_scalar("SELECT 1::numeric / 3")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(quotient, decimal("0.33333333333333333333"));
}

/// The simple query protocol returns text: the same values decode from it.
async fn numeric_text_format(pool: &PgPool) {
    let rows = sqlx::raw_sql(
        "SELECT 12.3400::numeric AS a, (-0.0001)::numeric AS b, 92233720368547758.07::numeric AS c,
                ROW(1.5000, 'EUR')::ducat_money AS d, ARRAY[1.10, NULL]::numeric[] AS e,
                9223372036854775807::bigint AS f",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    let row = &rows[0];
    assert_eq!(row.get::<Decimal, _>("a"), decimal("12.3400"));
    assert_eq!(row.get::<Decimal, _>("b"), decimal("-0.0001"));
    assert_eq!(row.get::<Decimal, _>("c"), decimal("92233720368547758.07"));
    let PgMoney(composite) = row.get::<PgMoney, _>("d");
    assert_eq!(composite.to_string(), "1.5000 EUR");
    assert_eq!(
        row.get::<Vec<Option<Decimal>>, _>("e"),
        [Some(decimal("1.10")), None]
    );
    assert_eq!(
        row.get::<MinorColumn<Eur>, _>("f").minor_units(),
        Ok(i64::MAX)
    );
}

/// `NaN` and the infinities are refused in both formats, alone, in arrays and in composites.
async fn special_values(pool: &PgPool) {
    for (special, expected) in [
        ("NaN", Error::NotANumber),
        ("Infinity", Error::Infinite { negative: false }),
        ("-Infinity", Error::Infinite { negative: true }),
    ] {
        let binary = sqlx::query(&format!("SELECT '{special}'::numeric AS n"))
            .fetch_one(pool)
            .await
            .unwrap();
        let error = binary.try_get::<Decimal, _>("n").unwrap_err();
        assert_eq!(decode_error(&error), Some(&expected), "{special}, binary");
        let text = sqlx::raw_sql(&format!("SELECT '{special}'::numeric AS n"))
            .fetch_one(pool)
            .await
            .unwrap();
        let error = text.try_get::<Decimal, _>("n").unwrap_err();
        assert_eq!(decode_error(&error), Some(&expected), "{special}, text");
        let array = sqlx::query(&format!("SELECT ARRAY[1, '{special}']::numeric[] AS n"))
            .fetch_one(pool)
            .await
            .unwrap();
        assert!(array.try_get::<Vec<Decimal>, _>("n").is_err());
        let composite = sqlx::query(&format!(
            "SELECT ROW('{special}'::numeric, 'EUR')::ducat_money AS m"
        ))
        .fetch_one(pool)
        .await
        .unwrap();
        let error = composite.try_get::<PgMoney, _>("m").unwrap_err();
        assert_eq!(
            decode_error(&error),
            Some(&expected),
            "{special}, composite"
        );
    }
}

async fn bigint_minor_units(pool: &PgPool) {
    for (id, (amount, code)) in AMOUNTS
        .iter()
        .enumerate()
        .filter(|(_, (_, code))| *code == "EUR")
    {
        let price: Money<Eur> = amount.parse().unwrap();
        sqlx::query("INSERT INTO items (id, minor) VALUES ($1, $2)")
            .bind(i32::try_from(id).unwrap())
            .bind(MinorColumn(price.clone()))
            .execute(pool)
            .await
            .unwrap();
        let MinorColumn(back): MinorColumn<Eur> =
            sqlx::query_scalar("SELECT minor FROM items WHERE id = $1")
                .bind(i32::try_from(id).unwrap())
                .fetch_one(pool)
                .await
                .unwrap();
        assert!(back.identical(&price), "{amount} {code}");
    }
    let yen: Vec<MinorColumn<Jpy>> = sqlx::query_scalar("SELECT ARRAY[1000, -1]::bigint[]")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(yen[0].0.to_string(), "1000 JPY");
    // a NUMERIC isn't a BIGINT
    let row = sqlx::query("SELECT 1::numeric AS n")
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(row.try_get::<MinorColumn<Eur>, _>("n").is_err());
    sqlx::raw_sql("DELETE FROM items")
        .execute(pool)
        .await
        .unwrap();
}

/// A NUMERIC(19,4) column: Postgres rounds `1.23456` silently, so `fit` refuses it, and reads
/// at the exponent take the column's trailing zeros.
async fn fixed_currency_decimals(pool: &PgPool) {
    sqlx::raw_sql("INSERT INTO items (id, n19) VALUES (100, '1.23456')")
        .execute(pool)
        .await
        .unwrap();
    let stored: Decimal = sqlx::query_scalar("SELECT n19 FROM items WHERE id = 100")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(stored, decimal("1.2346"));
    let precise = Money::<Eur>::from_units(123_456, 5).unwrap();
    assert!(matches!(
        DEFAULT_DECIMAL_SIZE.fit(&precise),
        Err(Error::WouldRound { .. })
    ));

    let price: Money<Eur> = "123456789012345.67".parse().unwrap();
    sqlx::query("INSERT INTO items (id, n19) VALUES (101, $1)")
        .bind(DEFAULT_DECIMAL_SIZE.fit(&price).unwrap())
        .execute(pool)
        .await
        .unwrap();
    let row = sqlx::query("SELECT n19, n19::text AS text FROM items WHERE id = 101")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(row.get::<String, _>("text"), "123456789012345.6700");
    let DecimalColumn(back) = row.get::<DecimalColumn<Eur>, _>("n19");
    assert!(back.identical(&price));
    // three decimals of a dinar at the exponent; a fourth significant one is refused
    let (DecimalColumn(dinars),): (DecimalColumn<Kwd>,) =
        sqlx::query_as("SELECT 1.2340::numeric(19,4)")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(dinars.to_string(), "1.234 KWD");
    let row = sqlx::query("SELECT 1.2345::numeric(19,4) AS n")
        .fetch_one(pool)
        .await
        .unwrap();
    let error = row.try_get::<DecimalColumn<Kwd>, _>("n").unwrap_err();
    assert_eq!(
        decode_error(&error),
        Some(&Error::Ducat(ducat::Error::Rounding))
    );
    sqlx::raw_sql("DELETE FROM items")
        .execute(pool)
        .await
        .unwrap();
}

/// ducat's composite round trip, value, currency and scale, as pg-types.test.ts stores them.
async fn composite_round_trips(pool: &PgPool) {
    let mut prices: Vec<AnyMoney> = AMOUNTS
        .iter()
        .map(|(amount, code)| AnyMoney::parse(amount, iso(code)).unwrap())
        .collect();
    prices.push(AnyMoney::from_units(15_000, 4, iso("EUR")).unwrap());
    prices.push(AnyMoney::from_units(pow10(40), 1000, iso("CLF")).unwrap());
    for (id, price) in prices.iter().enumerate() {
        sqlx::query("INSERT INTO items (id, price) VALUES ($1, $2)")
            .bind(i32::try_from(id).unwrap())
            .bind(PgMoney(price.clone()))
            .execute(pool)
            .await
            .unwrap();
    }
    let back: Vec<PgMoney> = sqlx::query_scalar("SELECT price FROM items ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap();
    assert_eq!(back.len(), prices.len());
    for (PgMoney(read), price) in back.iter().zip(&prices) {
        assert!(read.identical(price), "{read} for {price}");
    }
    // the text Postgres writes for each, as ducat's parseMoneyComposite reads it
    let texts: Vec<String> = sqlx::query_scalar("SELECT price::text FROM items ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap();
    for (text, price) in texts.iter().zip(&prices) {
        let read: AnyMoney = text.parse::<MoneyRecord>().unwrap().to_money().unwrap();
        assert!(read.identical(price), "{text}");
    }
    // the text ducat's toMoneyComposite writes, cast by Postgres
    for price in &prices {
        let text = MoneyRecord::from_money(price).to_string();
        let PgMoney(read): PgMoney = sqlx::query_scalar("SELECT $1::text::ducat_money")
            .bind(&text)
            .fetch_one(pool)
            .await
            .unwrap();
        assert!(read.identical(price), "{text}");
    }
    // typed, arrays, and the fields themselves
    let euros: Vec<PgMoney<Money<Eur>>> = sqlx::query_scalar(
        "SELECT array_agg(price ORDER BY id) FROM items WHERE (price).currency = 'EUR'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(euros[1].0.to_string(), "12.34 EUR");
    let records: Vec<MoneyRecord> = sqlx::query_scalar("SELECT $1::ducat_money[]")
        .bind(vec![PgMoney(prices[1].clone()), PgMoney(prices[3].clone())])
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(records[1].to_string(), r#"(1000,"JPY")"#);
    let (amount, currency): (Decimal, String) =
        sqlx::query_as("SELECT (price).amount, (price).currency FROM items WHERE id = 11")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!((amount, currency.as_str()), (decimal("1.5000"), "EUR"));
    // a typed read of another currency
    let row = sqlx::query("SELECT price FROM items WHERE id = 3")
        .fetch_one(pool)
        .await
        .unwrap();
    let error = row.try_get::<PgMoney<Money<Eur>>, _>("price").unwrap_err();
    assert!(matches!(
        decode_error(&error),
        Some(Error::CurrencyMismatch { .. })
    ));
}

async fn composite_refusals(pool: &PgPool) {
    for (sql, expected) in [
        (
            "SELECT ROW(NULL, 'EUR')::ducat_money AS m",
            Error::NullField("amount"),
        ),
        (
            "SELECT ROW(1, NULL)::ducat_money AS m",
            Error::NullField("currency"),
        ),
        (
            "SELECT ROW(1, 'XXX1')::ducat_money AS m",
            Error::UnknownCurrency("XXX1".into()),
        ),
    ] {
        let row = sqlx::query(sql).fetch_one(pool).await.unwrap();
        let error = row.try_get::<PgMoney, _>("m").unwrap_err();
        assert_eq!(decode_error(&error), Some(&expected), "{sql}");
        let row = sqlx::raw_sql(sql).fetch_one(pool).await.unwrap();
        let error = row.try_get::<PgMoney, _>("m").unwrap_err();
        assert_eq!(decode_error(&error), Some(&expected), "{sql}, text");
    }
    // a custom currency, through the record
    let record: MoneyRecord = sqlx::query_scalar("SELECT ROW(2.5, 'CREDIT')::ducat_money")
        .fetch_one(pool)
        .await
        .unwrap();
    let credits = ducat::CurrencyCode::custom("CREDIT", 4).unwrap();
    assert_eq!(
        record.to_any_money(credits).unwrap().to_string(),
        "2.5000 CREDIT"
    );
    // a NUMERIC isn't the composite
    let row = sqlx::query("SELECT 1::numeric AS m")
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(row.try_get::<PgMoney, _>("m").is_err());
}

/// ducat's `sum` aggregate over the composite, read back exactly.
async fn composite_sum(pool: &PgPool) {
    let PgMoney(total): PgMoney =
        sqlx::query_scalar("SELECT sum(price) FROM items WHERE (price).currency = 'EUR'")
            .fetch_one(pool)
            .await
            .unwrap();
    // the EUR amounts, BIGINT's limits included, and 1.5000 (four decimals)
    assert_eq!(total.to_string(), "90071992547423.7300 EUR");
    let empty: Option<PgMoney> = sqlx::query_scalar("SELECT sum(price) FROM items WHERE false")
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(empty.is_none());
    let mixed = sqlx::query("SELECT sum(price) FROM items")
        .fetch_one(pool)
        .await;
    assert!(mixed.is_err(), "summing two currencies raises");
}

/// A composite of another name, in another schema, decodes by its fields.
async fn other_composite_names(pool: &PgPool) {
    let PgMoney(dinars): PgMoney<Money<Kwd>> =
        sqlx::query_scalar("SELECT ducat_sqlx_other.sum(x) FROM (VALUES (ROW(1.5, 'KWD')::ducat_sqlx_other.amount), (ROW(0.5, 'KWD')::ducat_sqlx_other.amount)) AS t(x)")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(dinars.to_string(), "2.000 KWD");
}
