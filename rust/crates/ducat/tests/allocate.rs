//! Allocation, instalments, schedules, chunks and cash rounding: regression tests for the bug
//! classes in `docs/research/rust-money-libs.md` (T1–T4), and conservation properties on both
//! sides of the `i128` boundary.

use ducat::allocate::{InstalmentRemainder, Remainder, Tranche};
use ducat::iso::{Chf, Eur, Usd};
use ducat::{AnyMoney, Error, Int, Money, Rounding};
use proptest::prelude::*;

const ALL: [Remainder; 5] = [
    Remainder::Largest,
    Remainder::First,
    Remainder::Last,
    Remainder::ToFirst,
    Remainder::ToLast,
];

/// The parts' units, which these tests keep within i128.
fn units<C: ducat::Currency>(parts: &[Money<C>]) -> Vec<i128> {
    parts
        .iter()
        .map(|part| part.units().to_i128().expect("within i128"))
        .collect()
}

fn total<C: ducat::Currency>(parts: &[Money<C>]) -> Int {
    parts.iter().map(|part| part.units().clone()).sum()
}

/// T1: a total with a sub-minor fraction is allocated in full, at its own scale, never floored.
#[test]
fn t1_sub_minor_totals_are_conserved() {
    let whole = Money::<Usd>::parse_at("1.005", 3, Rounding::Unnecessary).unwrap();
    for remainder in ALL {
        let parts = whole.split(2, remainder).unwrap();
        assert!(parts.iter().all(|part| part.scale() == 3));
        assert_eq!(parts.iter().sum::<Money<Usd>>(), whole);
    }
}

/// T2: no unit is invented or lost at the i128 limits, or past them.
#[test]
fn t2_limits() {
    let past = Int::from(i128::MAX) * Int::from(i128::MAX);
    for amount in [
        Int::from(i128::MAX),
        Int::from(i128::MAX - 1),
        Int::from(i128::MIN),
        Int::from(i128::MIN + 1),
        past.clone(),
        -past,
    ] {
        let money = Money::<Eur>::from_minor(amount.clone());
        for remainder in ALL {
            assert_eq!(total(&money.split(3, remainder).unwrap()), amount);
            assert_eq!(
                total(&money.allocate([u64::MAX, 1, u64::MAX], remainder).unwrap()),
                amount
            );
            assert_eq!(
                total(
                    &money
                        .allocate([u128::MAX, u128::MAX, 1], remainder)
                        .unwrap()
                ),
                amount
            );
        }
    }
}

/// T3: under largest remainder, reordering the weights reorders the shares and nothing else,
/// when no tie on remainder involves parts of different weights.
#[test]
fn t3_order_independence() {
    let weights = [98u32, 92, 98, 123, 102, 92];
    let money = Money::<Eur>::from_minor(100_001);
    let mut base: Vec<(u32, i128)> = weights
        .iter()
        .copied()
        .zip(units(&money.allocate(weights, Remainder::Largest).unwrap()))
        .collect();
    base.sort_unstable();
    let mut reversed = weights;
    reversed.reverse();
    let mut other: Vec<(u32, i128)> = reversed
        .iter()
        .copied()
        .zip(units(
            &money.allocate(reversed, Remainder::Largest).unwrap(),
        ))
        .collect();
    other.sort_unstable();
    assert_eq!(base, other);
}

/// T3's limit, as ducat documents it: a tie on remainder goes to the earlier part, so when parts
/// of different weights tie, the order decides. 2 units by (1, 3): the shares 0.5 and 1.5 tie,
/// and the leftover goes to the weight 1; by (3, 1) it goes to the weight 3.
#[test]
fn t3_ties_go_to_the_earlier_part() {
    let money = Money::<Eur>::from_minor(2);
    assert_eq!(
        units(&money.allocate([1, 3], Remainder::Largest).unwrap()),
        [1, 1]
    );
    assert_eq!(
        units(&money.allocate([3, 1], Remainder::Largest).unwrap()),
        [2, 0]
    );
}

/// T4: zero weights get exactly zero, whatever the strategy.
#[test]
fn t4_zero_weights() {
    for remainder in ALL {
        let parts = Money::<Eur>::from_minor(1)
            .allocate([0, 1, 1], remainder)
            .unwrap();
        assert_eq!(units(&parts)[0], 0, "{remainder}");
        assert_eq!(units(&parts).iter().sum::<i128>(), 1);
    }
}

#[test]
fn errors() {
    let money = Money::<Eur>::from_minor(100);
    assert_eq!(
        money.allocate(Vec::<u32>::new(), Remainder::Largest),
        Err(Error::NoWeights)
    );
    assert_eq!(
        money.allocate([0, 0], Remainder::Largest),
        Err(Error::ZeroWeights)
    );
    assert_eq!(
        money.allocate([1, -1], Remainder::Largest),
        Err(Error::NegativeWeight)
    );
    assert_eq!(
        money.allocate(["1", "-0.5"], Remainder::Largest),
        Err(Error::NegativeWeight)
    );
    assert_eq!(
        money.allocate(["1,5"], Remainder::Largest),
        Err(Error::Syntax)
    );
    assert_eq!(money.split(0, Remainder::First), Err(Error::NoWeights));
    assert_eq!(
        money.split(usize::MAX, Remainder::First),
        Err(Error::Overflow)
    );
    assert_eq!(
        money.instalments(3, Some(&Money::from_minor(0)), InstalmentRemainder::ToFirst),
        Err(Error::NotPositive)
    );
    assert_eq!(money.chunk(&Money::from_minor(0)), Err(Error::NotPositive));
    assert_eq!(
        Money::<Eur>::from_minor(-1).chunk(&Money::from_minor(1)),
        Err(Error::NegativeTotal)
    );
    assert_eq!(
        Money::<Eur>::from_minor(i128::MAX).chunk(&Money::from_minor(1)),
        Err(Error::Overflow)
    );
    assert_eq!(
        money.round_to_increment(&Money::from_minor(-5), Rounding::HalfExpand),
        Err(Error::NotPositive)
    );
    assert_eq!(
        money.schedule(&[Tranche::rest(), Tranche::rest()]),
        Err(Error::InvalidSchedule)
    );
    assert_eq!(
        money.schedule(&[Tranche::percent(101).unwrap(), Tranche::rest()]),
        Err(Error::InvalidSchedule)
    );
    assert_eq!(
        money.schedule(&[Tranche::amount(Money::from_minor(101)), Tranche::rest()]),
        Err(Error::InvalidSchedule)
    );
    assert_eq!(
        money.schedule(&[Tranche::percent(50).unwrap()]),
        Err(Error::InvalidSchedule)
    );
    let any = money.to_any();
    let usd = AnyMoney::from_minor(1, "USD".parse().unwrap());
    assert!(matches!(
        any.chunk(&usd),
        Err(Error::CurrencyMismatch { .. })
    ));
    assert!(matches!(
        any.instalments(2, Some(&usd), InstalmentRemainder::First),
        Err(Error::CurrencyMismatch { .. })
    ));
    assert!(matches!(
        any.schedule(&[Tranche::amount(usd.clone()), Tranche::rest()]),
        Err(Error::CurrencyMismatch { .. })
    ));
    assert!(matches!(
        any.round_to_increment(&usd, Rounding::HalfExpand),
        Err(Error::CurrencyMismatch { .. })
    ));
}

#[test]
fn ducats_examples() {
    let eur = |text: &str| text.parse::<Money<Eur>>().unwrap();
    let decimals = |parts: Vec<Money<Eur>>| parts.iter().map(Money::to_decimal).collect::<Vec<_>>();
    assert_eq!(
        decimals(eur("100").allocate([1, 1, 1], Remainder::Largest).unwrap()),
        ["33.34", "33.33", "33.33"]
    );
    assert_eq!(
        decimals(eur("-100").allocate([1, 1, 1], Remainder::Largest).unwrap()),
        ["-33.34", "-33.33", "-33.33"]
    );
    assert_eq!(
        decimals(
            eur("0.05")
                .allocate(["70", "30"], Remainder::Largest)
                .unwrap()
        ),
        ["0.04", "0.01"]
    );
    assert_eq!(
        decimals(
            eur("100")
                .instalments(6, None, InstalmentRemainder::ToFirst)
                .unwrap()
        ),
        ["16.70", "16.66", "16.66", "16.66", "16.66", "16.66"]
    );
    assert_eq!(
        decimals(eur("1000").chunk(&eur("300")).unwrap()),
        ["300.00", "300.00", "300.00", "100.00"]
    );
    assert_eq!(decimals(eur("0").chunk(&eur("300")).unwrap()), ["0.00"]);
    let schedule = eur("1000")
        .schedule(&[
            Tranche::percent("30").unwrap(),
            Tranche::amount(eur("200")),
            Tranche::rest(),
        ])
        .unwrap();
    assert_eq!(decimals(schedule), ["300.00", "200.00", "500.00"]);
    let capped = eur("1000")
        .schedule(&[
            Tranche::percent_capped(30, eur("250")).unwrap(),
            Tranche::rest(),
        ])
        .unwrap();
    assert_eq!(decimals(capped), ["250.00", "750.00"]);
    let chf = |text: &str| text.parse::<Money<Chf>>().unwrap();
    assert_eq!(
        chf("10.03")
            .round_to_increment(&chf("0.05"), Rounding::HalfExpand)
            .unwrap()
            .to_string(),
        "10.05 CHF"
    );
    assert_eq!(
        chf("10.02")
            .round_to_increment(&chf("0.05"), Rounding::HalfExpand)
            .unwrap()
            .to_string(),
        "10.00 CHF"
    );
    assert_eq!(
        chf("10.02").round_to_increment(&chf("0.05"), Rounding::Unnecessary),
        Err(Error::Rounding)
    );
    assert_eq!("toFirst".parse::<Remainder>(), Ok(Remainder::ToFirst));
}

/// Amounts on both sides of the i128 boundary.
fn amount() -> impl Strategy<Value = Int> {
    prop_oneof![
        any::<i128>().prop_map(Int::from),
        (any::<i128>(), any::<i64>())
            .prop_map(|(high, low)| Int::from(high) * Int::from(u64::MAX) + Int::from(low)),
    ]
}

proptest! {
    /// Conservation, sign and zero weights for every strategy, and nearness for the spreading
    /// ones: every part within one unit of its exact share.
    #[test]
    fn allocation_conserves(amount in amount(), weights in prop::collection::vec(0u64..1_000_000, 1..8), remainder in 0usize..5) {
        prop_assume!(weights.iter().any(|&w| w > 0));
        let remainder = ALL[remainder];
        let parts = Money::<Eur>::from_minor(amount.clone()).allocate(&weights, remainder).unwrap();
        prop_assert_eq!(total(&parts), amount.clone());
        let sum: Int = weights.iter().map(|&w| Int::from(w)).sum();
        for (part, &weight) in parts.iter().zip(&weights) {
            if weight == 0 {
                prop_assert!(part.is_zero());
            }
            prop_assert!(part.signum() == 0 || part.signum() == amount.signum());
            if matches!(remainder, Remainder::Largest | Remainder::First | Remainder::Last) {
                let error = part.units() * &sum - &amount * &Int::from(weight);
                prop_assert!(error.abs() <= sum);
            }
        }
    }

    /// Instalments sum to the total.
    #[test]
    fn instalments_conserve(total_units in amount(), count in 1usize..20, unit in 1i128..10_000, remainder in 0usize..4) {
        let remainder = [InstalmentRemainder::First, InstalmentRemainder::Last, InstalmentRemainder::ToFirst, InstalmentRemainder::ToLast][remainder];
        let parts = Money::<Eur>::from_minor(total_units.clone()).instalments(count, Some(&Money::from_minor(unit)), remainder).unwrap();
        prop_assert_eq!(parts.len(), count);
        prop_assert_eq!(total(&parts), total_units);
    }

    /// Chunks sum to the total, and all but the last are the maximum.
    #[test]
    fn chunks_conserve(whole in 0i128..1_000_000, max in 1i128..10_000) {
        let parts = units(&Money::<Eur>::from_minor(whole).chunk(&Money::from_minor(max)).unwrap());
        prop_assert_eq!(parts.iter().sum::<i128>(), whole);
        prop_assert!(parts[..parts.len() - 1].iter().all(|&part| part == max));
        prop_assert!(*parts.last().unwrap() > 0 || whole == 0);
    }
}
