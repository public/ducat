//! ducat against rust_decimal, rusty-money, bigdecimal, fixed and plain integer minor units.
//!
//! Every library gets the same inputs (EUR at scale 2) and, where it can, the same semantics: see
//! README.md for what each one does less of. `check_agreement` runs before any timing and asserts
//! that the libraries' results agree wherever their semantics are equal, so a benchmark can't
//! quietly time a different computation.

use std::hint::black_box;
use std::str::FromStr;
use std::time::Duration;

use bigdecimal::{BigDecimal, RoundingMode};
use criterion::{BenchmarkId, Criterion, criterion_group};
use ducat::allocate::Remainder;
use ducat::convert::Rate;
use ducat::iso::{Eur, Usd};
use ducat::{Money, Ratio, Rounding};
use fixed::types::I64F64;
use rust_decimal::{Decimal, RoundingStrategy};
use rusty_money::{ExchangeRate, Money as RmMoney, Round, iso};

// Normal-size inputs.
const A: &str = "1234.56";
const B: &str = "789.01";
/// rusty-money parses in its currency's locale: EUR uses `,` for decimals and `.` for groups.
const A_RM: &str = "1234,56";
const FACTOR: &str = "1.075";
const RATE: &str = "1.0832";
const DIVISOR: i32 = 3;
const TOTAL: &str = "100.00";
const WEIGHTS: [i32; 3] = [1, 2, 3];

// Past i128: 4.4 × 10^41 and 9.9 × 10^40 cents, beyond i128::MAX ≈ 1.7 × 10^38, so ducat takes
// its heap (BigInt) path. Only bigdecimal can represent these among the others.
const BIG_A: &str = "4412345678901234567890123456789012345678.12";
const BIG_B: &str = "987654321098765432109876543210987654321.09";
const BIG_TOTAL: &str = "4412345678901234567890123456789012345678.00";

const SUM_COUNT: usize = 1000;

fn de(s: &str) -> Money<Eur> {
    s.parse().unwrap()
}

fn rd(s: &str) -> Decimal {
    Decimal::from_str_exact(s).unwrap()
}

fn bd(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).unwrap()
}

fn fx(s: &str) -> I64F64 {
    I64F64::from_str(s).unwrap()
}

fn rm(s: &str) -> RmMoney<'static, iso::Currency> {
    RmMoney::from_decimal(rd(s), iso::EUR)
}

// ---------------------------------------------------------------------------------------------
// The baseline: i64 cents, with i128 intermediates and hand-written half-even rounding. No
// currency, no scale: the caller knows both. Overflow is checked.

mod minor {
    /// A strict decimal string with at most two decimals, to cents.
    pub fn parse(s: &str) -> Option<i64> {
        let (neg, s) = match s.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, s),
        };
        let (int, frac) = match s.split_once('.') {
            Some((i, f)) => (i, f),
            None => (s, ""),
        };
        if int.is_empty() || frac.len() > 2 {
            return None;
        }
        let mut v: i64 = 0;
        for b in int.bytes().chain(frac.bytes()) {
            if !b.is_ascii_digit() {
                return None;
            }
            v = v.checked_mul(10)?.checked_add(i64::from(b - b'0'))?;
        }
        for _ in frac.len()..2 {
            v = v.checked_mul(10)?;
        }
        Some(if neg { -v } else { v })
    }

    /// `num ÷ den` rounded half to even; `den > 0`.
    pub fn div_half_even(num: i128, den: i128) -> i128 {
        let q = num.div_euclid(den);
        let r = num.rem_euclid(den);
        let twice = 2 * r;
        if twice > den || (twice == den && q % 2 != 0) {
            q + 1
        } else {
            q
        }
    }

    /// `cents × num ÷ den`, half to even, back to i64.
    pub fn mul_ratio(cents: i64, num: i128, den: i128) -> Option<i64> {
        i64::try_from(div_half_even(i128::from(cents).checked_mul(num)?, den)).ok()
    }

    /// Largest remainder (Hamilton), ties to the earlier part, as ducat's `Remainder::Largest`.
    pub fn allocate(cents: i64, weights: &[i64]) -> Vec<i64> {
        let total: i128 = weights.iter().map(|&w| i128::from(w)).sum();
        let mut parts = Vec::with_capacity(weights.len());
        let mut rems = Vec::with_capacity(weights.len());
        let mut left = i128::from(cents);
        for &w in weights {
            let exact = i128::from(cents) * i128::from(w);
            let q = exact.div_euclid(total);
            parts.push(q);
            rems.push(exact.rem_euclid(total));
            left -= q;
        }
        let mut order: Vec<usize> = (0..weights.len()).collect();
        order.sort_by(|&x, &y| rems[y].cmp(&rems[x]).then(x.cmp(&y)));
        for &i in order.iter().take(usize::try_from(left).unwrap()) {
            parts[i] += 1;
        }
        parts
            .into_iter()
            .map(|p| i64::try_from(p).unwrap())
            .collect()
    }

    pub fn to_string(cents: i64) -> String {
        let sign = if cents < 0 { "-" } else { "" };
        let abs = cents.unsigned_abs();
        format!("{sign}{}.{:02}", abs / 100, abs % 100)
    }
}

const FACTOR_NUM: i128 = 1075;
const FACTOR_DEN: i128 = 1000;
const RATE_NUM: i128 = 10832;
const RATE_DEN: i128 = 10000;

// ---------------------------------------------------------------------------------------------

/// Asserts that the results agree where the semantics are equal, and documents where they don't.
fn check_agreement() {
    let rate = Rate::<Eur, Usd>::parse(RATE).unwrap();
    let factor: Ratio = FACTOR.parse().unwrap();
    let a = de(A);

    // multiply, half-even to cents: 1234.56 × 1.075 = 1327.152 → 1327.15
    let want = "1327.15";
    assert_eq!(
        a.multiply(&factor, Rounding::HalfEven)
            .unwrap()
            .to_decimal(),
        want
    );
    let r = (rd(A) * rd(FACTOR)).round_dp_with_strategy(2, RoundingStrategy::MidpointNearestEven);
    assert_eq!(r.to_string(), want);
    let r = (rm(A) * rd(FACTOR)).round(2, Round::HalfEven);
    assert_eq!(*r.amount(), rd(want));
    let r = (bd(A) * bd(FACTOR)).with_scale_round(2, RoundingMode::HalfEven);
    assert_eq!(r.to_string(), want);
    let c = minor::mul_ratio(minor::parse(A).unwrap(), FACTOR_NUM, FACTOR_DEN).unwrap();
    assert_eq!(minor::to_string(c), want);

    // divide by 3: 411.52
    let want = "411.52";
    assert_eq!(
        a.divide(DIVISOR, Rounding::HalfEven).unwrap().to_decimal(),
        want
    );
    let r = (rd(A) / Decimal::from(DIVISOR))
        .round_dp_with_strategy(2, RoundingStrategy::MidpointNearestEven);
    assert_eq!(r.to_string(), want);
    let r = (rm(A) / DIVISOR).round(2, Round::HalfEven);
    assert_eq!(*r.amount(), rd(want));
    let r = (bd(A) / BigDecimal::from(DIVISOR)).with_scale_round(2, RoundingMode::HalfEven);
    assert_eq!(r.to_string(), want);
    let c = minor::mul_ratio(minor::parse(A).unwrap(), 1, i128::from(DIVISOR)).unwrap();
    assert_eq!(minor::to_string(c), want);

    // convert at 1.0832: 1337.275392 → 1337.28 USD
    let want = "1337.28";
    assert_eq!(
        rate.convert(&a, Rounding::HalfEven).unwrap().to_decimal(),
        want
    );
    let rm_rate = ExchangeRate::new(iso::EUR, iso::USD, rd(RATE)).unwrap();
    let r = rm_rate.convert(&rm(A)).unwrap().round(2, Round::HalfEven);
    assert_eq!(*r.amount(), rd(want));
    assert_eq!(r.currency(), iso::USD);

    // allocation: ducat, the baseline and rusty-money (whole units) differ, by design
    let split: Vec<String> = de(TOTAL)
        .split(3, Remainder::Largest)
        .unwrap()
        .iter()
        .map(Money::to_decimal)
        .collect();
    assert_eq!(split, ["33.34", "33.33", "33.33"]);
    assert_eq!(minor::allocate(10_000, &[1, 1, 1]), [3334, 3333, 3333]);
    let by: Vec<String> = de(TOTAL)
        .allocate(WEIGHTS, Remainder::Largest)
        .unwrap()
        .iter()
        .map(Money::to_decimal)
        .collect();
    assert_eq!(by, ["16.67", "33.33", "50.00"]);
    assert_eq!(minor::allocate(10_000, &[1, 2, 3]), [1667, 3333, 5000]);
    // rusty-money allocates whole major units (34, 33, 33 and 17, 33, 50 euros)
    let rm_split: Vec<Decimal> = rm(TOTAL)
        .allocate_to(3)
        .unwrap()
        .iter()
        .map(|m| *m.amount())
        .collect();
    assert_eq!(rm_split, [rd("34"), rd("33"), rd("33")]);
    let rm_by: Vec<Decimal> = rm(TOTAL)
        .allocate(WEIGHTS.to_vec())
        .unwrap()
        .iter()
        .map(|m| *m.amount())
        .collect();
    assert_eq!(rm_by, [rd("17"), rd("33"), rd("50")]);

    // to string
    assert_eq!(a.to_decimal(), A);
    assert_eq!(rd(A).to_string(), A);
    assert_eq!(bd(A).to_string(), A);
    assert_eq!(minor::to_string(minor::parse(A).unwrap()), A);
    assert_eq!(rm(A).to_string(), "€1.234,56");
    // fixed is binary: 1234.56 is stored as the nearest multiple of 2^-64, printed back as the
    // shortest decimal that reads back to it
    assert_eq!(fx(A).to_string(), A);

    // sums
    let (de_v, rd_v, bd_v, minor_v, ..) = sum_inputs();
    let total = de_v.iter().sum::<Money<Eur>>().to_decimal();
    assert_eq!(rd_v.iter().sum::<Decimal>().to_string(), total);
    assert_eq!(bd_v.iter().sum::<BigDecimal>().to_string(), total);
    assert_eq!(minor::to_string(minor_v.iter().sum()), total);

    // past i128: only bigdecimal
    let big = de(BIG_A);
    let want = (bd(BIG_A) * bd(FACTOR))
        .with_scale_round(2, RoundingMode::HalfEven)
        .to_string();
    assert_eq!(
        big.multiply(&factor, Rounding::HalfEven)
            .unwrap()
            .to_decimal(),
        want
    );
    let want = (bd(BIG_A) / BigDecimal::from(DIVISOR))
        .with_scale_round(2, RoundingMode::HalfEven)
        .to_string();
    assert_eq!(
        big.divide(DIVISOR, Rounding::HalfEven)
            .unwrap()
            .to_decimal(),
        want
    );
    let want = (bd(BIG_A) * bd(RATE))
        .with_scale_round(2, RoundingMode::HalfEven)
        .to_string();
    assert_eq!(
        rate.convert(&big, Rounding::HalfEven).unwrap().to_decimal(),
        want
    );
    assert_eq!(
        (&big + &de(BIG_B)).to_decimal(),
        (bd(BIG_A) + bd(BIG_B)).to_string()
    );
    assert_eq!(big.to_decimal(), bd(BIG_A).to_string());
    assert!(
        Decimal::from_str(BIG_A).is_err(),
        "rust_decimal holds 96 bits"
    );
}

fn amount_at(i: usize) -> String {
    // 1,000 amounts from 0.13 to 9,991.08, deterministic
    let cents = (i * 7_919 + 13) % 1_000_000;
    format!("{}.{:02}", cents / 100, cents % 100)
}

type SumInputs = (
    Vec<Money<Eur>>,
    Vec<Decimal>,
    Vec<BigDecimal>,
    Vec<i64>,
    Vec<RmMoney<'static, iso::Currency>>,
    Vec<I64F64>,
);

fn sum_inputs() -> SumInputs {
    let text: Vec<String> = (0..SUM_COUNT).map(amount_at).collect();
    (
        text.iter().map(|s| de(s)).collect(),
        text.iter().map(|s| rd(s)).collect(),
        text.iter().map(|s| bd(s)).collect(),
        text.iter().map(|s| minor::parse(s).unwrap()).collect(),
        text.iter().map(|s| rm(s)).collect(),
        text.iter().map(|s| fx(s)).collect(),
    )
}

// ---------------------------------------------------------------------------------------------

const DUCAT: &str = "ducat";
const RUST_DECIMAL: &str = "rust_decimal";
const RUSTY_MONEY: &str = "rusty-money";
const BIGDECIMAL: &str = "bigdecimal";
const FIXED: &str = "fixed";
const MINOR: &str = "i64-minor";

fn id(lib: &str, size: &str) -> BenchmarkId {
    BenchmarkId::new(lib, size)
}

fn parse(c: &mut Criterion) {
    let mut g = c.benchmark_group("parse");
    g.bench_function(id(DUCAT, "normal"), |b| {
        b.iter(|| black_box(A).parse::<Money<Eur>>().unwrap())
    });
    g.bench_function(id(RUST_DECIMAL, "normal"), |b| {
        b.iter(|| Decimal::from_str_exact(black_box(A)).unwrap())
    });
    g.bench_function(id(RUSTY_MONEY, "normal"), |b| {
        b.iter(|| RmMoney::from_str(black_box(A_RM), iso::EUR).unwrap())
    });
    g.bench_function(id(BIGDECIMAL, "normal"), |b| {
        b.iter(|| BigDecimal::from_str(black_box(A)).unwrap())
    });
    g.bench_function(id(FIXED, "normal"), |b| {
        b.iter(|| I64F64::from_str(black_box(A)).unwrap())
    });
    g.bench_function(id(MINOR, "normal"), |b| {
        b.iter(|| minor::parse(black_box(A)).unwrap())
    });
    g.bench_function(id(DUCAT, "big"), |b| {
        b.iter(|| black_box(BIG_A).parse::<Money<Eur>>().unwrap())
    });
    g.bench_function(id(BIGDECIMAL, "big"), |b| {
        b.iter(|| BigDecimal::from_str(black_box(BIG_A)).unwrap())
    });
    g.finish();
}

fn add(c: &mut Criterion) {
    let mut g = c.benchmark_group("add");
    let (da, db) = (de(A), de(B));
    g.bench_function(id(DUCAT, "normal"), |b| {
        b.iter(|| black_box(&da) + black_box(&db))
    });
    let (ra, rb) = (rd(A), rd(B));
    g.bench_function(id(RUST_DECIMAL, "normal"), |b| {
        b.iter(|| black_box(ra).checked_add(black_box(rb)).unwrap())
    });
    let (ma, mb) = (rm(A), rm(B));
    g.bench_function(id(RUSTY_MONEY, "normal"), |b| {
        b.iter(|| black_box(ma) + black_box(mb))
    });
    let (ba, bb) = (bd(A), bd(B));
    g.bench_function(id(BIGDECIMAL, "normal"), |b| {
        b.iter(|| black_box(&ba) + black_box(&bb))
    });
    let (fa, fb) = (fx(A), fx(B));
    g.bench_function(id(FIXED, "normal"), |b| {
        b.iter(|| black_box(fa).checked_add(black_box(fb)).unwrap())
    });
    let (ia, ib) = (minor::parse(A).unwrap(), minor::parse(B).unwrap());
    g.bench_function(id(MINOR, "normal"), |b| {
        b.iter(|| black_box(ia).checked_add(black_box(ib)).unwrap())
    });
    let (da, db) = (de(BIG_A), de(BIG_B));
    g.bench_function(id(DUCAT, "big"), |b| {
        b.iter(|| black_box(&da) + black_box(&db))
    });
    let (ba, bb) = (bd(BIG_A), bd(BIG_B));
    g.bench_function(id(BIGDECIMAL, "big"), |b| {
        b.iter(|| black_box(&ba) + black_box(&bb))
    });
    g.finish();
}

fn multiply(c: &mut Criterion) {
    let mut g = c.benchmark_group("multiply");
    let factor: Ratio = FACTOR.parse().unwrap();
    let da = de(A);
    g.bench_function(id(DUCAT, "normal"), |b| {
        b.iter(|| {
            black_box(&da)
                .multiply(black_box(&factor), Rounding::HalfEven)
                .unwrap()
        })
    });
    let (ra, rf) = (rd(A), rd(FACTOR));
    g.bench_function(id(RUST_DECIMAL, "normal"), |b| {
        b.iter(|| {
            black_box(ra)
                .checked_mul(black_box(rf))
                .unwrap()
                .round_dp_with_strategy(2, RoundingStrategy::MidpointNearestEven)
        })
    });
    let ma = rm(A);
    g.bench_function(id(RUSTY_MONEY, "normal"), |b| {
        b.iter(|| (black_box(ma) * black_box(rf)).round(2, Round::HalfEven))
    });
    let (ba, bf) = (bd(A), bd(FACTOR));
    g.bench_function(id(BIGDECIMAL, "normal"), |b| {
        b.iter(|| (black_box(&ba) * black_box(&bf)).with_scale_round(2, RoundingMode::HalfEven))
    });
    let (fa, ff) = (fx(A), fx(FACTOR));
    g.bench_function(id(FIXED, "normal"), |b| {
        b.iter(|| black_box(fa).checked_mul(black_box(ff)).unwrap())
    });
    let ia = minor::parse(A).unwrap();
    g.bench_function(id(MINOR, "normal"), |b| {
        b.iter(|| minor::mul_ratio(black_box(ia), FACTOR_NUM, FACTOR_DEN).unwrap())
    });
    let da = de(BIG_A);
    g.bench_function(id(DUCAT, "big"), |b| {
        b.iter(|| {
            black_box(&da)
                .multiply(black_box(&factor), Rounding::HalfEven)
                .unwrap()
        })
    });
    let ba = bd(BIG_A);
    g.bench_function(id(BIGDECIMAL, "big"), |b| {
        b.iter(|| (black_box(&ba) * black_box(&bf)).with_scale_round(2, RoundingMode::HalfEven))
    });
    g.finish();
}

fn divide(c: &mut Criterion) {
    let mut g = c.benchmark_group("divide");
    let da = de(A);
    g.bench_function(id(DUCAT, "normal"), |b| {
        b.iter(|| {
            black_box(&da)
                .divide(black_box(DIVISOR), Rounding::HalfEven)
                .unwrap()
        })
    });
    let (ra, rdv) = (rd(A), Decimal::from(DIVISOR));
    g.bench_function(id(RUST_DECIMAL, "normal"), |b| {
        b.iter(|| {
            black_box(ra)
                .checked_div(black_box(rdv))
                .unwrap()
                .round_dp_with_strategy(2, RoundingStrategy::MidpointNearestEven)
        })
    });
    let ma = rm(A);
    g.bench_function(id(RUSTY_MONEY, "normal"), |b| {
        b.iter(|| (black_box(ma) / black_box(DIVISOR)).round(2, Round::HalfEven))
    });
    let (ba, bdv) = (bd(A), BigDecimal::from(DIVISOR));
    g.bench_function(id(BIGDECIMAL, "normal"), |b| {
        b.iter(|| (black_box(&ba) / black_box(&bdv)).with_scale_round(2, RoundingMode::HalfEven))
    });
    let fa = fx(A);
    g.bench_function(id(FIXED, "normal"), |b| {
        b.iter(|| {
            black_box(fa)
                .checked_div_int(black_box(i128::from(DIVISOR)))
                .unwrap()
        })
    });
    let ia = minor::parse(A).unwrap();
    g.bench_function(id(MINOR, "normal"), |b| {
        b.iter(|| minor::mul_ratio(black_box(ia), 1, black_box(i128::from(DIVISOR))).unwrap())
    });
    let da = de(BIG_A);
    g.bench_function(id(DUCAT, "big"), |b| {
        b.iter(|| {
            black_box(&da)
                .divide(black_box(DIVISOR), Rounding::HalfEven)
                .unwrap()
        })
    });
    let ba = bd(BIG_A);
    g.bench_function(id(BIGDECIMAL, "big"), |b| {
        b.iter(|| (black_box(&ba) / black_box(&bdv)).with_scale_round(2, RoundingMode::HalfEven))
    });
    g.finish();
}

fn allocate(c: &mut Criterion) {
    let mut g = c.benchmark_group("split3");
    let dt = de(TOTAL);
    g.bench_function(id(DUCAT, "normal"), |b| {
        b.iter(|| {
            black_box(&dt)
                .split(black_box(3), Remainder::Largest)
                .unwrap()
        })
    });
    let mt = rm(TOTAL);
    g.bench_function(id(RUSTY_MONEY, "normal"), |b| {
        b.iter(|| black_box(mt).allocate_to(black_box(3)).unwrap())
    });
    g.bench_function(id(MINOR, "normal"), |b| {
        b.iter(|| minor::allocate(black_box(10_000), black_box(&[1, 1, 1])))
    });
    let dbig = de(BIG_TOTAL);
    g.bench_function(id(DUCAT, "big"), |b| {
        b.iter(|| {
            black_box(&dbig)
                .split(black_box(3), Remainder::Largest)
                .unwrap()
        })
    });
    g.finish();

    let mut g = c.benchmark_group("allocate123");
    g.bench_function(id(DUCAT, "normal"), |b| {
        b.iter(|| {
            black_box(&dt)
                .allocate(black_box(WEIGHTS), Remainder::Largest)
                .unwrap()
        })
    });
    g.bench_function(id(RUSTY_MONEY, "normal"), |b| {
        b.iter(|| black_box(mt).allocate(black_box(WEIGHTS.to_vec())).unwrap())
    });
    g.bench_function(id(MINOR, "normal"), |b| {
        b.iter(|| minor::allocate(black_box(10_000), black_box(&[1, 2, 3])))
    });
    g.bench_function(id(DUCAT, "big"), |b| {
        b.iter(|| {
            black_box(&dbig)
                .allocate(black_box(WEIGHTS), Remainder::Largest)
                .unwrap()
        })
    });
    g.finish();
}

fn convert(c: &mut Criterion) {
    let mut g = c.benchmark_group("convert");
    let rate = Rate::<Eur, Usd>::parse(RATE).unwrap();
    let da = de(A);
    g.bench_function(id(DUCAT, "normal"), |b| {
        b.iter(|| {
            black_box(&rate)
                .convert(black_box(&da), Rounding::HalfEven)
                .unwrap()
        })
    });
    let (ra, rr) = (rd(A), rd(RATE));
    g.bench_function(id(RUST_DECIMAL, "normal"), |b| {
        b.iter(|| {
            black_box(ra)
                .checked_mul(black_box(rr))
                .unwrap()
                .round_dp_with_strategy(2, RoundingStrategy::MidpointNearestEven)
        })
    });
    let ma = rm(A);
    let rm_rate = ExchangeRate::new(iso::EUR, iso::USD, rr).unwrap();
    g.bench_function(id(RUSTY_MONEY, "normal"), |b| {
        b.iter(|| {
            black_box(&rm_rate)
                .convert(black_box(&ma))
                .unwrap()
                .round(2, Round::HalfEven)
        })
    });
    let (ba, br) = (bd(A), bd(RATE));
    g.bench_function(id(BIGDECIMAL, "normal"), |b| {
        b.iter(|| (black_box(&ba) * black_box(&br)).with_scale_round(2, RoundingMode::HalfEven))
    });
    let (fa, fr) = (fx(A), fx(RATE));
    g.bench_function(id(FIXED, "normal"), |b| {
        b.iter(|| black_box(fa).checked_mul(black_box(fr)).unwrap())
    });
    let ia = minor::parse(A).unwrap();
    g.bench_function(id(MINOR, "normal"), |b| {
        b.iter(|| minor::mul_ratio(black_box(ia), RATE_NUM, RATE_DEN).unwrap())
    });
    let da = de(BIG_A);
    g.bench_function(id(DUCAT, "big"), |b| {
        b.iter(|| {
            black_box(&rate)
                .convert(black_box(&da), Rounding::HalfEven)
                .unwrap()
        })
    });
    let ba = bd(BIG_A);
    g.bench_function(id(BIGDECIMAL, "big"), |b| {
        b.iter(|| (black_box(&ba) * black_box(&br)).with_scale_round(2, RoundingMode::HalfEven))
    });
    g.finish();
}

fn to_string(c: &mut Criterion) {
    let mut g = c.benchmark_group("to_string");
    let da = de(A);
    g.bench_function(id(DUCAT, "normal"), |b| {
        b.iter(|| black_box(&da).to_decimal())
    });
    let ra = rd(A);
    g.bench_function(id(RUST_DECIMAL, "normal"), |b| {
        b.iter(|| black_box(ra).to_string())
    });
    let ma = rm(A);
    g.bench_function(id(RUSTY_MONEY, "normal"), |b| {
        b.iter(|| black_box(ma).to_string())
    });
    let ba = bd(A);
    g.bench_function(id(BIGDECIMAL, "normal"), |b| {
        b.iter(|| black_box(&ba).to_string())
    });
    let fa = fx(A);
    g.bench_function(id(FIXED, "normal"), |b| {
        b.iter(|| black_box(fa).to_string())
    });
    let ia = minor::parse(A).unwrap();
    g.bench_function(id(MINOR, "normal"), |b| {
        b.iter(|| minor::to_string(black_box(ia)))
    });
    let da = de(BIG_A);
    g.bench_function(id(DUCAT, "big"), |b| b.iter(|| black_box(&da).to_decimal()));
    let ba = bd(BIG_A);
    g.bench_function(id(BIGDECIMAL, "big"), |b| {
        b.iter(|| black_box(&ba).to_string())
    });
    g.finish();
}

fn sum(c: &mut Criterion) {
    let mut g = c.benchmark_group("sum1000");
    let (de_v, rd_v, bd_v, minor_v, rm_v, fx_v) = sum_inputs();
    g.bench_function(id(DUCAT, "normal"), |b| {
        b.iter(|| black_box(&de_v).iter().sum::<Money<Eur>>())
    });
    g.bench_function(id(RUST_DECIMAL, "normal"), |b| {
        b.iter(|| black_box(&rd_v).iter().sum::<Decimal>())
    });
    g.bench_function(id(RUSTY_MONEY, "normal"), |b| {
        b.iter(|| {
            black_box(&rm_v)
                .iter()
                .fold(RmMoney::from_minor(0, iso::EUR), |acc, m| acc + *m)
        })
    });
    g.bench_function(id(BIGDECIMAL, "normal"), |b| {
        b.iter(|| black_box(&bd_v).iter().sum::<BigDecimal>())
    });
    g.bench_function(id(FIXED, "normal"), |b| {
        b.iter(|| {
            black_box(&fx_v)
                .iter()
                .try_fold(I64F64::ZERO, |acc, x| acc.checked_add(*x))
                .unwrap()
        })
    });
    g.bench_function(id(MINOR, "normal"), |b| {
        b.iter(|| {
            black_box(&minor_v)
                .iter()
                .try_fold(0i64, |acc, x| acc.checked_add(*x))
                .unwrap()
        })
    });
    let de_big: Vec<Money<Eur>> = de_v.iter().map(|m| m + &de(BIG_A)).collect();
    let bd_big: Vec<BigDecimal> = bd_v.iter().map(|x| x + bd(BIG_A)).collect();
    assert_eq!(
        de_big.iter().sum::<Money<Eur>>().to_decimal(),
        bd_big.iter().sum::<BigDecimal>().to_string()
    );
    g.bench_function(id(DUCAT, "big"), |b| {
        b.iter(|| black_box(&de_big).iter().sum::<Money<Eur>>())
    });
    g.bench_function(id(BIGDECIMAL, "big"), |b| {
        b.iter(|| black_box(&bd_big).iter().sum::<BigDecimal>())
    });
    g.finish();
}

fn config() -> Criterion {
    Criterion::default()
        .without_plots()
        .warm_up_time(Duration::from_secs(2))
        .measurement_time(Duration::from_secs(4))
}

criterion_group! {
    name = benches;
    config = config();
    targets = parse, add, multiply, divide, allocate, convert, to_string, sum
}

fn main() {
    check_agreement();
    benches();
    Criterion::default().configure_from_args().final_summary();
}
