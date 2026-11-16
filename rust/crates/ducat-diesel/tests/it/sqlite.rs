//! SQLite, in memory: ducat's drizzle/sqlite column shapes (TEXT decimals, INTEGER minor units)
//! through diesel, and the values SQLite's dynamic typing could slip in instead.

use diesel::dsl::sql;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Text};
use diesel::sqlite::SqliteConnection;
use ducat::iso::{Eur, Jpy, Kwd};
use ducat::{AnyMoney, Money, Rounding};
use ducat_diesel::{Decimal, DecimalColumn, Error, MinorColumn, minor_units};

use crate::common::{AMOUNTS, decimal, iso};
use crate::values::{decode_error, downcast_query};

diesel::table! {
    items (id) {
        id -> BigInt,
        price -> Nullable<Text>,
        total_minor -> Nullable<BigInt>,
        currency -> Nullable<Text>,
    }
}

fn database() -> SqliteConnection {
    let mut connection = SqliteConnection::establish(":memory:").expect("an in-memory SQLite");
    diesel::sql_query(
        "CREATE TABLE items (
            id INTEGER PRIMARY KEY,
            price TEXT,
            total_minor INTEGER,
            currency TEXT,
            loose
        )",
    )
    .execute(&mut connection)
    .unwrap();
    connection
}

/// Row `id`'s `column` read as the SQL type `ST`, whatever the value is.
fn read_as<ST, T>(connection: &mut SqliteConnection, column: &str, id: i64) -> QueryResult<T>
where
    ST: diesel::sql_types::SingleValue + diesel::expression::TypedExpressionType + 'static,
    T: diesel::deserialize::FromSqlRow<ST, diesel::sqlite::Sqlite> + 'static,
    diesel::sqlite::Sqlite: diesel::sql_types::HasSqlType<ST>,
{
    items::table
        .filter(items::id.eq(id))
        .select(sql::<ST>(column))
        .first(connection)
}

#[test]
fn amounts_round_trip_in_both_shapes() {
    let connection = &mut database();
    for (id, (amount, code)) in AMOUNTS.iter().enumerate() {
        let money = AnyMoney::parse(amount, iso(code)).unwrap();
        diesel::insert_into(items::table)
            .values((
                items::id.eq(i64::try_from(id).unwrap()),
                items::price.eq(Decimal::from_money(&money)),
                items::total_minor.eq(minor_units(&money).unwrap()),
                items::currency.eq(*code),
            ))
            .execute(connection)
            .unwrap();
    }
    let rows: Vec<(Decimal, i64, String, String)> = items::table
        .order(items::id)
        .select((
            sql::<Text>("price"),
            sql::<BigInt>("total_minor"),
            sql::<Text>("currency"),
            sql::<Text>("typeof(price)"),
        ))
        .load(connection)
        .unwrap();
    assert_eq!(rows.len(), AMOUNTS.len());
    for ((price, minor, currency, kind), (amount, code)) in rows.iter().zip(AMOUNTS) {
        let currency = iso(currency);
        assert_eq!(currency, iso(code));
        assert_eq!(kind, "text");
        assert_eq!(price.to_string(), amount);
        let original = AnyMoney::parse(amount, currency).unwrap();
        assert!(
            price
                .to_money_at_exponent(currency)
                .unwrap()
                .identical(&original)
        );
        assert!(AnyMoney::from_minor(*minor, currency).identical(&original));
    }
}

#[test]
fn fixed_currency_columns() {
    let connection = &mut database();
    let price: Money<Eur> = "92233720368547758.07".parse().unwrap();
    diesel::insert_into(items::table)
        .values((
            items::id.eq(1),
            items::price.eq(DecimalColumn(price.clone())),
            items::total_minor.eq(MinorColumn(price.clone())),
        ))
        .execute(connection)
        .unwrap();
    let (DecimalColumn(decimal_back), MinorColumn(minor_back)) = items::table
        .filter(items::id.eq(1))
        .select((sql::<Text>("price"), sql::<BigInt>("total_minor")))
        .first::<(DecimalColumn<Eur>, MinorColumn<Eur>)>(connection)
        .unwrap();
    assert!(decimal_back.identical(&price) && minor_back.identical(&price));
    // through the schema's Nullable columns, as Options
    let (read_price, read_minor) = items::table
        .filter(items::id.eq(1))
        .select((items::price, items::total_minor))
        .first::<(Option<DecimalColumn<Eur>>, Option<MinorColumn<Eur>>)>(connection)
        .unwrap();
    assert_eq!(read_price.map(|column| column.0), Some(price.clone()));
    assert_eq!(read_minor.map(|column| column.0), Some(price));

    // trailing zeros read; more decimals than the currency's don't
    diesel::sql_query(
        "INSERT INTO items (id, price) VALUES (2, '12.3400'), (3, '12.345'), (4, '1.5')",
    )
    .execute(connection)
    .unwrap();
    let DecimalColumn(read) = read_as::<Text, DecimalColumn<Eur>>(connection, "price", 2).unwrap();
    assert_eq!(read.to_string(), "12.34 EUR");
    let error = read_as::<Text, DecimalColumn<Eur>>(connection, "price", 3).unwrap_err();
    assert_eq!(decode_error(error), Error::Ducat(ducat::Error::Rounding));
    let error = read_as::<Text, DecimalColumn<Jpy>>(connection, "price", 4).unwrap_err();
    assert_eq!(decode_error(error), Error::Ducat(ducat::Error::Rounding));
    let DecimalColumn(dinars) =
        read_as::<Text, DecimalColumn<Kwd>>(connection, "price", 4).unwrap();
    assert_eq!(dinars.to_string(), "1.500 KWD");
}

#[test]
fn writes_refuse_what_the_column_would_change() {
    let connection = &mut database();
    let fine = Money::<Eur>::from_units(1005, 3).unwrap();
    let mismatch = Error::ScaleMismatch {
        scale: 3,
        expected: 2,
    };
    let error = diesel::insert_into(items::table)
        .values((
            items::id.eq(1),
            items::price.eq(DecimalColumn(fine.clone())),
        ))
        .execute(connection)
        .unwrap_err();
    assert_eq!(downcast_query(error), mismatch);
    let error = diesel::insert_into(items::table)
        .values((
            items::id.eq(1),
            items::total_minor.eq(MinorColumn(fine.clone())),
        ))
        .execute(connection)
        .unwrap_err();
    assert_eq!(downcast_query(error), mismatch);
    let beyond: Money<Eur> = "92233720368547758.08".parse().unwrap();
    let error = diesel::insert_into(items::table)
        .values((items::id.eq(1), items::total_minor.eq(MinorColumn(beyond))))
        .execute(connection)
        .unwrap_err();
    assert_eq!(downcast_query(error), Error::OutOfRange);
    let count: i64 = items::table.count().get_result(connection).unwrap();
    assert_eq!(count, 0);
    let rounded = fine.to_scale(2, Rounding::HalfEven).unwrap();
    diesel::insert_into(items::table)
        .values((items::id.eq(1), items::price.eq(DecimalColumn(rounded))))
        .execute(connection)
        .unwrap();
}

#[test]
fn reals_and_other_storage_classes_are_refused() {
    let connection = &mut database();
    // a column without affinity keeps what it's given: a REAL, an INTEGER, a TEXT
    diesel::sql_query(
        "INSERT INTO items (id, loose) VALUES (1, 0.1), (2, 12), (3, '12.34'), (4, 1e300), (5, x'3132')",
    )
    .execute(connection)
    .unwrap();
    assert_eq!(
        read_as::<Text, Decimal>(connection, "loose", 3).unwrap(),
        decimal("12.34")
    );
    assert_eq!(
        read_as::<BigInt, MinorColumn<Eur>>(connection, "loose", 2)
            .unwrap()
            .0
            .to_string(),
        "0.12 EUR"
    );
    for (id, kind) in [(1, "REAL"), (2, "INTEGER"), (4, "REAL"), (5, "BLOB")] {
        let error = read_as::<Text, Decimal>(connection, "loose", id).unwrap_err();
        assert_eq!(
            decode_error(error),
            Error::UnexpectedType(kind.into()),
            "row {id}"
        );
    }
    for (id, kind) in [(1, "REAL"), (3, "TEXT"), (4, "REAL"), (5, "BLOB")] {
        let error = read_as::<BigInt, MinorColumn<Eur>>(connection, "loose", id).unwrap_err();
        assert_eq!(
            decode_error(error),
            Error::UnexpectedType(kind.into()),
            "row {id}"
        );
    }
    // NULL is an Option
    let price: Option<Decimal> = items::table
        .filter(items::id.eq(1))
        .select(items::price)
        .first(connection)
        .unwrap();
    assert_eq!(price, None);
}

#[test]
fn malformed_text_is_refused() {
    let connection = &mut database();
    diesel::sql_query(
        "INSERT INTO items (id, price) VALUES (1, 'NaN'), (2, '1e3'), (3, ' 1'), (4, '')",
    )
    .execute(connection)
    .unwrap();
    let error = read_as::<Text, Decimal>(connection, "price", 1).unwrap_err();
    assert_eq!(decode_error(error), Error::NotANumber);
    for id in 2..=4 {
        let error = read_as::<Text, Decimal>(connection, "price", id).unwrap_err();
        assert!(
            matches!(decode_error(error), Error::Malformed(_)),
            "row {id}"
        );
    }
}

/// ducat's `moneyMinor('EUR', { scale })` with `scaledMoney` (ducat#380): `SCALED_EUROS` round-trip
/// with their scales, loaded straight into `ScaledMinorColumn` from the two columns; a NULL
/// amount is `None`, and a NULL or too large scale is refused.
#[test]
fn a_scale_column_round_trips_any_scale() {
    let connection = &mut database();
    use ducat_diesel::ScaledMinorColumn;

    use crate::scaled::{SCALED_EUROS, euros};

    diesel::table! {
        scaled (id) {
            id -> Integer,
            amount_minor -> Nullable<BigInt>,
            amount_scale -> Nullable<Integer>,
        }
    }

    diesel::sql_query(
        "CREATE TABLE scaled (id INTEGER PRIMARY KEY, amount_minor INTEGER, amount_scale INTEGER)",
    )
    .execute(connection)
    .unwrap();
    for (id, (amount, scale, _)) in SCALED_EUROS.into_iter().enumerate() {
        let (units, scale) = ScaledMinorColumn(euros(amount, scale))
            .to_columns()
            .unwrap();
        diesel::insert_into(scaled::table)
            .values((
                scaled::id.eq(i32::try_from(id).unwrap()),
                scaled::amount_minor.eq(units),
                scaled::amount_scale.eq(i32::from(scale)),
            ))
            .execute(connection)
            .unwrap();
    }
    diesel::sql_query(
        "INSERT INTO scaled VALUES (100, NULL, NULL), (101, 5, NULL), (102, 5, 1001)",
    )
    .execute(connection)
    .unwrap();
    let amounts: Vec<ScaledMinorColumn<Eur>> = scaled::table
        .filter(scaled::id.lt(100))
        .order(scaled::id)
        .select((scaled::amount_minor.assume_not_null(), scaled::amount_scale))
        .load(connection)
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
        .unwrap();
    assert_eq!(first.0.to_string(), "1.005 EUR");
    for (id, expected) in [(101, None), (102, Some(1001))] {
        let error = scaled::table
            .filter(scaled::id.eq(id))
            .select((scaled::amount_minor.assume_not_null(), scaled::amount_scale))
            .first::<ScaledMinorColumn<Eur>>(connection)
            .unwrap_err();
        assert_eq!(decode_error(error), Error::InvalidScaleColumn(expected));
    }
    // a nullable amount: NULL is None, whatever the scale
    let rows: Vec<(Option<i64>, Option<i32>)> = scaled::table
        .filter(scaled::id.ge(100))
        .order(scaled::id)
        .select((scaled::amount_minor, scaled::amount_scale))
        .load(connection)
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
}
