//! Postgres, against the server in `DUCAT_PG_URL` (CI's postgres:18 service), in a schema of
//! its own, through diesel-async's `AsyncPgConnection` (tokio-postgres, binary format): NUMERIC,
//! BIGINT, the composite type and its `sum`, and the arrays.

use diesel::dsl::sql;
use diesel::prelude::*;
use diesel::sql_types::{Array, BigInt, Nullable, Numeric, Record, Text};
use diesel_async::{AsyncConnection, AsyncPgConnection, RunQueryDsl, SimpleAsyncConnection};
use ducat::iso::{Eur, Jpy, Kwd};
use ducat::{AnyMoney, Money};
use ducat_diesel::pg::sql_types::DucatMoney;
use ducat_diesel::pg::{MoneyRecord, PgMoney, money_type_sql};
use ducat_diesel::{DEFAULT_DECIMAL_SIZE, Decimal, DecimalColumn, Error, MinorColumn};

use crate::common::{AMOUNTS, database_url, decimal, iso, pow10};
use crate::values::{decode_error, downcast_query};

const SCHEMA: &str = "ducat_diesel_test";

diesel::table! {
    use diesel::sql_types::*;
    use ducat_diesel::pg::sql_types::DucatMoney;

    items (id) {
        id -> Int4,
        price -> Nullable<DucatMoney>,
        n -> Nullable<Numeric>,
        n19 -> Nullable<Numeric>,
        minor -> Nullable<Int8>,
    }
}

async fn connect(url: &str) -> AsyncPgConnection {
    let mut connection = AsyncPgConnection::establish(url)
        .await
        .expect("a Postgres server");
    connection
        .batch_execute(&format!(
            "DROP SCHEMA IF EXISTS {SCHEMA} CASCADE; CREATE SCHEMA {SCHEMA};
             DROP SCHEMA IF EXISTS ducat_diesel_other CASCADE; CREATE SCHEMA ducat_diesel_other;
             SET search_path TO {SCHEMA};"
        ))
        .await
        .unwrap();
    for statement in money_type_sql("ducat_money")
        .unwrap()
        .into_iter()
        .chain(money_type_sql("ducat_diesel_other.amount").unwrap())
    {
        connection.batch_execute(&statement).await.unwrap();
    }
    connection
        .batch_execute(
            "CREATE TABLE items (
                id integer PRIMARY KEY,
                price ducat_money,
                n numeric,
                n19 numeric(19,4),
                minor bigint
            )",
        )
        .await
        .unwrap();
    connection
}

#[tokio::test(flavor = "current_thread")]
async fn postgres() {
    let Some(url) = database_url("DUCAT_PG_URL") else {
        return;
    };
    let connection = &mut connect(&url).await;
    numeric_round_trips(connection).await;
    special_values(connection).await;
    bigint_minor_units(connection).await;
    fixed_currency_decimals(connection).await;
    composite_round_trips(connection).await;
    composite_refusals(connection).await;
    composite_sum(connection).await;
    other_composite_names(connection).await;
    scale_column(connection).await;
    connection
        .batch_execute(&format!(
            "DROP SCHEMA {SCHEMA} CASCADE; DROP SCHEMA ducat_diesel_other CASCADE"
        ))
        .await
        .unwrap();
}

/// Decimals through a NUMERIC parameter and back, and Postgres's own text of them.
async fn numeric_round_trips(connection: &mut AsyncPgConnection) {
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
    values.push(Decimal::new(-15, 1).unwrap());
    for value in &values {
        let (back, text): (Decimal, String) = diesel::select((
            sql::<Numeric>("")
                .bind::<Numeric, _>(value)
                .sql("::numeric"),
            sql::<Text>("")
                .bind::<Numeric, _>(value)
                .sql("::numeric::text"),
        ))
        .get_result(connection)
        .await
        .unwrap();
        assert_eq!(&back, value);
        assert_eq!(text, value.to_string());
    }
    // arrays, NULLs inside included
    let array: Vec<Option<Decimal>> = vec![Some(decimal("1.10")), None, Some(decimal("-2.5"))];
    let back: Vec<Option<Decimal>> = diesel::select(
        sql::<Array<Nullable<Numeric>>>("")
            .bind::<Array<Nullable<Numeric>>, _>(&array)
            .sql("::numeric[]"),
    )
    .get_result(connection)
    .await
    .unwrap();
    assert_eq!(back, array);
    // Postgres's own arithmetic, read back exactly
    let sum: Decimal = diesel::select(sql::<Numeric>("0.1::numeric + 0.2::numeric"))
        .get_result(connection)
        .await
        .unwrap();
    assert_eq!(sum, decimal("0.3"));
    let quotient: Decimal = diesel::select(sql::<Numeric>("1::numeric / 3"))
        .get_result(connection)
        .await
        .unwrap();
    assert_eq!(quotient, decimal("0.33333333333333333333"));
}

/// `NaN` and the infinities are refused, alone, in arrays and in composites.
async fn special_values(connection: &mut AsyncPgConnection) {
    for (special, expected) in [
        ("NaN", Error::NotANumber),
        ("Infinity", Error::Infinite { negative: false }),
        ("-Infinity", Error::Infinite { negative: true }),
    ] {
        let error = diesel::select(sql::<Numeric>(&format!("'{special}'::numeric")))
            .get_result::<Decimal>(connection)
            .await
            .unwrap_err();
        assert_eq!(decode_error(error), expected, "{special}");
        let error = diesel::select(sql::<Array<Numeric>>(&format!(
            "ARRAY[1, '{special}']::numeric[]"
        )))
        .get_result::<Vec<Decimal>>(connection)
        .await
        .unwrap_err();
        assert_eq!(decode_error(error), expected, "{special}, array");
        let error = diesel::select(sql::<DucatMoney>(&format!(
            "ROW('{special}'::numeric, 'EUR')::ducat_money"
        )))
        .get_result::<PgMoney>(connection)
        .await
        .unwrap_err();
        assert_eq!(decode_error(error), expected, "{special}, composite");
    }
}

async fn bigint_minor_units(connection: &mut AsyncPgConnection) {
    for (id, (amount, code)) in AMOUNTS
        .iter()
        .enumerate()
        .filter(|(_, (_, code))| *code == "EUR")
    {
        let price: Money<Eur> = amount.parse().unwrap();
        let id = i32::try_from(id).unwrap();
        diesel::insert_into(items::table)
            .values((
                items::id.eq(id),
                items::minor.eq(MinorColumn(price.clone())),
            ))
            .execute(connection)
            .await
            .unwrap();
        let back: Option<MinorColumn<Eur>> = items::table
            .filter(items::id.eq(id))
            .select(items::minor)
            .get_result(connection)
            .await
            .unwrap();
        assert!(back.unwrap().0.identical(&price), "{amount} {code}");
    }
    let yen: Vec<MinorColumn<Jpy>> =
        diesel::select(sql::<Array<BigInt>>("ARRAY[1000, -1]::bigint[]"))
            .get_result(connection)
            .await
            .unwrap();
    assert_eq!(yen[0].0.to_string(), "1000 JPY");
    // a write that isn't at the exponent never reaches the server
    let fine = Money::<Eur>::from_units(1005, 3).unwrap();
    let error = diesel::insert_into(items::table)
        .values((items::id.eq(99), items::minor.eq(MinorColumn(fine))))
        .execute(connection)
        .await
        .unwrap_err();
    assert_eq!(
        downcast_query(error),
        Error::ScaleMismatch {
            scale: 3,
            expected: 2
        }
    );
    diesel::delete(items::table)
        .execute(connection)
        .await
        .unwrap();
}

/// A NUMERIC(19,4) column: Postgres rounds `1.23456` silently, so `fit` refuses it, and reads
/// at the exponent take the column's trailing zeros.
async fn fixed_currency_decimals(connection: &mut AsyncPgConnection) {
    connection
        .batch_execute("INSERT INTO items (id, n19) VALUES (100, '1.23456')")
        .await
        .unwrap();
    let stored: Option<Decimal> = items::table
        .filter(items::id.eq(100))
        .select(items::n19)
        .get_result(connection)
        .await
        .unwrap();
    assert_eq!(stored, Some(decimal("1.2346")));
    let precise = Money::<Eur>::from_units(123_456, 5).unwrap();
    assert!(matches!(
        DEFAULT_DECIMAL_SIZE.fit(&precise),
        Err(Error::WouldRound { .. })
    ));

    let price: Money<Eur> = "123456789012345.67".parse().unwrap();
    diesel::insert_into(items::table)
        .values((
            items::id.eq(101),
            items::n19.eq(DEFAULT_DECIMAL_SIZE.fit(&price).unwrap()),
        ))
        .execute(connection)
        .await
        .unwrap();
    let (back, text): (Option<DecimalColumn<Eur>>, String) = items::table
        .filter(items::id.eq(101))
        .select((items::n19, sql::<Text>("n19::text")))
        .get_result(connection)
        .await
        .unwrap();
    assert_eq!(text, "123456789012345.6700");
    assert!(back.unwrap().0.identical(&price));
    // three decimals of a dinar at the exponent; a fourth significant one is refused
    let DecimalColumn(dinars): DecimalColumn<Kwd> =
        diesel::select(sql::<Numeric>("1.2340::numeric(19,4)"))
            .get_result(connection)
            .await
            .unwrap();
    assert_eq!(dinars.to_string(), "1.234 KWD");
    let error = diesel::select(sql::<Numeric>("1.2345::numeric(19,4)"))
        .get_result::<DecimalColumn<Kwd>>(connection)
        .await
        .unwrap_err();
    assert_eq!(decode_error(error), Error::Ducat(ducat::Error::Rounding));
    // the fixed-currency column writes too
    diesel::insert_into(items::table)
        .values((items::id.eq(102), items::n.eq(DecimalColumn(price.clone()))))
        .execute(connection)
        .await
        .unwrap();
    let text: String = items::table
        .filter(items::id.eq(102))
        .select(sql::<Text>("n::text"))
        .get_result(connection)
        .await
        .unwrap();
    assert_eq!(text, "123456789012345.67");
    diesel::delete(items::table)
        .execute(connection)
        .await
        .unwrap();
}

/// ducat's composite round trip, value, currency and scale, as pg-types.test.ts stores them.
async fn composite_round_trips(connection: &mut AsyncPgConnection) {
    let mut prices: Vec<AnyMoney> = AMOUNTS
        .iter()
        .map(|(amount, code)| AnyMoney::parse(amount, iso(code)).unwrap())
        .collect();
    prices.push(AnyMoney::from_units(15_000, 4, iso("EUR")).unwrap());
    prices.push(AnyMoney::from_units(pow10(40), 1000, iso("CLF")).unwrap());
    for (id, price) in prices.iter().enumerate() {
        diesel::insert_into(items::table)
            .values((
                items::id.eq(i32::try_from(id).unwrap()),
                items::price.eq(PgMoney(price.clone())),
            ))
            .execute(connection)
            .await
            .unwrap();
    }
    let back: Vec<Option<PgMoney>> = items::table
        .order(items::id)
        .select(items::price)
        .load(connection)
        .await
        .unwrap();
    assert_eq!(back.len(), prices.len());
    for (read, price) in back.iter().zip(&prices) {
        let read = &read.as_ref().unwrap().0;
        assert!(read.identical(price), "{read} for {price}");
    }
    // the text Postgres writes for each, as ducat's parseMoneyComposite reads it
    let texts: Vec<String> = items::table
        .order(items::id)
        .select(sql::<Text>("price::text"))
        .load(connection)
        .await
        .unwrap();
    for (text, price) in texts.iter().zip(&prices) {
        let read: AnyMoney = text.parse::<MoneyRecord>().unwrap().to_money().unwrap();
        assert!(read.identical(price), "{text}");
    }
    // the text ducat's toMoneyComposite writes, cast by Postgres
    for price in &prices {
        let text = MoneyRecord::from_money(price).to_string();
        let PgMoney(read): PgMoney = diesel::select(
            sql::<DucatMoney>("")
                .bind::<Text, _>(&text)
                .sql("::text::ducat_money"),
        )
        .get_result(connection)
        .await
        .unwrap();
        assert!(read.identical(price), "{text}");
    }
    // typed, arrays, and the fields themselves
    let euros: Vec<PgMoney<Money<Eur>>> = items::table
        .filter(sql::<diesel::sql_types::Bool>("(price).currency = 'EUR'"))
        .select(sql::<Array<DucatMoney>>("array_agg(price ORDER BY id)"))
        .get_result(connection)
        .await
        .unwrap();
    assert_eq!(euros[1].0.to_string(), "12.34 EUR");
    let records: Vec<MoneyRecord> = diesel::select(
        sql::<Array<DucatMoney>>("")
            .bind::<Array<DucatMoney>, _>(vec![
                PgMoney(prices[1].clone()),
                PgMoney(prices[3].clone()),
            ])
            .sql("::ducat_money[]"),
    )
    .get_result(connection)
    .await
    .unwrap();
    assert_eq!(records[1].to_string(), r#"(1000,"JPY")"#);
    let (amount, currency): (Decimal, String) = items::table
        .filter(items::id.eq(11))
        .select((
            sql::<Numeric>("(price).amount"),
            sql::<Text>("(price).currency"),
        ))
        .get_result(connection)
        .await
        .unwrap();
    assert_eq!((amount, currency.as_str()), (decimal("1.5000"), "EUR"));
    // a typed read of another currency
    let error = items::table
        .filter(items::id.eq(3))
        .select(sql::<DucatMoney>("price"))
        .get_result::<PgMoney<Money<Eur>>>(connection)
        .await
        .unwrap_err();
    assert!(matches!(
        decode_error(error),
        Error::CurrencyMismatch { .. }
    ));
}

async fn composite_refusals(connection: &mut AsyncPgConnection) {
    for (query, expected) in [
        ("ROW(NULL, 'EUR')::ducat_money", Error::NullField("amount")),
        ("ROW(1, NULL)::ducat_money", Error::NullField("currency")),
        (
            "ROW(1, 'XXX1')::ducat_money",
            Error::UnknownCurrency("XXX1".into()),
        ),
    ] {
        let error = diesel::select(sql::<DucatMoney>(query))
            .get_result::<PgMoney>(connection)
            .await
            .unwrap_err();
        assert_eq!(decode_error(error), expected, "{query}");
    }
    // a custom currency, through the record
    let record: MoneyRecord = diesel::select(sql::<DucatMoney>("ROW(2.5, 'CREDIT')::ducat_money"))
        .get_result(connection)
        .await
        .unwrap();
    let credits = ducat::CurrencyCode::custom("CREDIT", 4).unwrap();
    assert_eq!(
        record.to_any_money(credits).unwrap().to_string(),
        "2.5000 CREDIT"
    );
    // a NUMERIC isn't the composite
    let error = diesel::select(sql::<DucatMoney>("1::numeric"))
        .get_result::<PgMoney>(connection)
        .await
        .unwrap_err();
    assert!(matches!(decode_error(error), Error::Malformed(_)));
}

/// ducat's `sum` aggregate over the composite, read back exactly.
async fn composite_sum(connection: &mut AsyncPgConnection) {
    let PgMoney(total): PgMoney = items::table
        .filter(sql::<diesel::sql_types::Bool>("(price).currency = 'EUR'"))
        .select(sql::<DucatMoney>("sum(price)"))
        .get_result(connection)
        .await
        .unwrap();
    // the EUR amounts, BIGINT's limits included, and 1.5000 (four decimals)
    assert_eq!(total.to_string(), "90071992547423.7300 EUR");
    let empty: Option<PgMoney> = items::table
        .filter(sql::<diesel::sql_types::Bool>("false"))
        .select(sql::<Nullable<DucatMoney>>("sum(price)"))
        .get_result(connection)
        .await
        .unwrap();
    assert!(empty.is_none());
    let mixed = items::table
        .select(sql::<DucatMoney>("sum(price)"))
        .get_result::<PgMoney>(connection)
        .await;
    assert!(mixed.is_err(), "summing two currencies raises");
}

/// A composite of another name, in another schema, reads as `Record<(Numeric, Text)>`.
async fn other_composite_names(connection: &mut AsyncPgConnection) {
    let PgMoney(dinars): PgMoney<Money<Kwd>> = diesel::select(sql::<Record<(Numeric, Text)>>(
        "ducat_diesel_other.sum(x) FROM (VALUES (ROW(1.5, 'KWD')::ducat_diesel_other.amount), \
         (ROW(0.5, 'KWD')::ducat_diesel_other.amount)) AS t(x)",
    ))
    .get_result(connection)
    .await
    .unwrap();
    assert_eq!(dinars.to_string(), "2.000 KWD");
}

/// ducat's `moneyMinor('EUR', { scale })` with `scaledMoney` (ducat#380): `SCALED_EUROS` round-trip
/// with their scales, loaded straight into `ScaledMinorColumn` from the two columns; a NULL
/// amount is `None`, and a NULL or too large scale is refused.
async fn scale_column(connection: &mut AsyncPgConnection) {
    use ducat_diesel::ScaledMinorColumn;

    use crate::scaled::{SCALED_EUROS, euros};

    diesel::table! {
        scaled (id) {
            id -> Integer,
            amount_minor -> Nullable<BigInt>,
            amount_scale -> Nullable<SmallInt>,
        }
    }

    connection
        .batch_execute("DROP TABLE IF EXISTS scaled; CREATE TABLE scaled (id INT PRIMARY KEY, amount_minor BIGINT, amount_scale SMALLINT)")
        .await
        .unwrap();
    for (id, (amount, scale, _)) in SCALED_EUROS.into_iter().enumerate() {
        let (units, scale) = ScaledMinorColumn(euros(amount, scale))
            .to_columns()
            .unwrap();
        diesel::insert_into(scaled::table)
            .values((
                scaled::id.eq(i32::try_from(id).unwrap()),
                scaled::amount_minor.eq(units),
                scaled::amount_scale.eq(i16::from(scale)),
            ))
            .execute(connection)
            .await
            .unwrap();
    }
    connection
        .batch_execute(
            "INSERT INTO scaled VALUES (100, NULL, NULL), (101, 5, NULL), (102, 5, 1001)",
        )
        .await
        .unwrap();
    let amounts: Vec<ScaledMinorColumn<Eur>> = scaled::table
        .filter(scaled::id.lt(100))
        .order(scaled::id)
        .select((scaled::amount_minor.assume_not_null(), scaled::amount_scale))
        .load(connection)
        .await
        .unwrap();
    assert_eq!(amounts.len(), SCALED_EUROS.len());
    for (read, (amount, at, _)) in amounts.iter().zip(SCALED_EUROS) {
        assert!(read.0.identical(&euros(amount, at)), "{amount}");
    }
    // a scale column declared NOT NULL loads too
    let first: ScaledMinorColumn<Eur> = scaled::table
        .filter(scaled::id.eq(0))
        .select((
            scaled::amount_minor.assume_not_null(),
            scaled::amount_scale.assume_not_null(),
        ))
        .first(connection)
        .await
        .unwrap();
    assert_eq!(first.0.to_string(), "1.005 EUR");
    for (id, expected) in [(101, None), (102, Some(1001))] {
        let error = scaled::table
            .filter(scaled::id.eq(id))
            .select((scaled::amount_minor.assume_not_null(), scaled::amount_scale))
            .first::<ScaledMinorColumn<Eur>>(connection)
            .await
            .unwrap_err();
        assert_eq!(decode_error(error), Error::InvalidScaleColumn(expected));
    }
    // a nullable amount: NULL is None, whatever the scale
    let rows: Vec<(Option<i64>, Option<i16>)> = scaled::table
        .filter(scaled::id.ge(100))
        .order(scaled::id)
        .select((scaled::amount_minor, scaled::amount_scale))
        .load(connection)
        .await
        .unwrap();
    let read: Vec<_> = rows
        .into_iter()
        .map(|(units, scale)| {
            ScaledMinorColumn::<Eur>::from_nullable_columns(units, scale.map(i64::from))
        })
        .collect();
    assert_eq!(
        read,
        [
            Ok(None),
            Err(Error::InvalidScaleColumn(None)),
            Err(Error::InvalidScaleColumn(Some(1001))),
        ]
    );
    connection.batch_execute("DROP TABLE scaled").await.unwrap();
}
