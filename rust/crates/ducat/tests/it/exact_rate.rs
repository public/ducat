//! ExactMoney and Rate: ducat's documented examples. The contract is the spec's `exact` and
//! `rate.*` vectors; these check the API around them (typed currencies, metadata of the text).

use ducat::convert::{AnyRate, Rate};
use ducat::exact::ExactMoney;
use ducat::iso::{Chf, Eur, Huf, Jpy, Usd};
use ducat::{Error, Money, Rounding};

#[test]
fn exact_examples() {
    let chf = |text: &str| text.parse::<Money<Chf>>().unwrap();
    let share = chf("10.03").exact().divide(3).unwrap();
    assert_eq!(share.to_string(), "1003/300 CHF");
    let bigger = &share + &chf("0.50");
    assert_eq!(bigger.to_string(), "1153/300 CHF");
    assert!(share < chf("3.35").exact());
    assert!(!share.is_exact(None));
    assert_eq!(
        share.round(Rounding::HalfEven, None).unwrap().to_string(),
        "3.34 CHF"
    );
    assert_eq!(
        share
            .round_with_residual(Rounding::HalfEven, None)
            .unwrap()
            .residual
            .to_string(),
        "1/300 CHF"
    );
    let eur = |text: &str| text.parse::<Money<Eur>>().unwrap();
    let parts = eur("12").exact().extract_tax("20").unwrap();
    assert_eq!(
        (parts.net.to_string(), parts.tax.to_string()),
        ("10 EUR".into(), "2 EUR".into())
    );
    assert_eq!(
        eur("10.01").exact().add_tax("7.7").unwrap().tax.to_string(),
        "77077/100000 EUR"
    );
    let thirds: ExactMoney<Eur> = [
        eur("1").exact().divide(3).unwrap(),
        eur("2").exact().divide(3).unwrap(),
    ]
    .into_iter()
    .sum();
    assert_eq!(thirds.to_string(), "1 EUR");
    assert_eq!(
        eur("10.00").multiply_exact("1.0775").unwrap().to_string(),
        "10.775 EUR"
    );
    assert_eq!(
        eur("10.00").multiply_exact(2).unwrap().to_string(),
        "20.00 EUR"
    );
    assert_eq!(eur("10.00").multiply_exact("1/3"), Err(Error::Rounding));
    assert_eq!(
        eur("1")
            .exact()
            .divide(8)
            .unwrap()
            .to_money(None)
            .unwrap()
            .to_string(),
        "0.125 EUR"
    );
    assert_eq!(
        eur("10").exact().divide(3).unwrap().to_money(None),
        Err(Error::Rounding)
    );
    assert_eq!(
        eur("1").exact().extract_tax("-100").map(|_| ()),
        Err(Error::InvalidPercent)
    );
}

#[test]
fn rate_examples() {
    assert_eq!(
        Rate::<Eur, Huf>::parse("363.90").unwrap().to_string(),
        "363.90"
    );
    let eur_usd = Rate::<Eur, Usd>::parse("1.1165").unwrap();
    assert_eq!(eur_usd.inverse().to_string(), "2000/2233");
    assert_eq!(
        eur_usd
            .convert(&"100".parse().unwrap(), Rounding::HalfEven)
            .unwrap()
            .to_string(),
        "111.65 USD"
    );
    let detailed = Rate::<Eur, Usd>::parse("1.1165")
        .unwrap()
        .convert_detailed(&"0.07".parse().unwrap(), Rounding::HalfEven)
        .unwrap();
    assert_eq!(detailed.value.to_string(), "0.08 USD");
    assert_eq!(detailed.residual.to_string(), "-369/200000 USD");
    let chain = eur_usd
        .inverse()
        .and_then(&Rate::<Eur, Jpy>::parse("162.457").unwrap());
    assert_eq!(chain.ratio().to_string(), "324914/2233");
    assert_eq!(eur_usd.with_margin("-0.02").unwrap().to_string(), "1.09417");
    assert_eq!(
        eur_usd.round(2, Rounding::HalfEven).unwrap().to_string(),
        "1.12"
    );
    assert_eq!(
        eur_usd.to_decimal(6, Rounding::HalfEven).unwrap(),
        "1.116500"
    );
    assert!(matches!(
        Rate::<Eur, Usd>::new(0),
        Err(Error::NonPositiveRate)
    ));
    let implied =
        Rate::<Eur, Usd>::implied(&"100".parse().unwrap(), &"111.65".parse().unwrap()).unwrap();
    assert_eq!(implied, eur_usd);
    let any = AnyRate::parse("EUR".parse().unwrap(), "USD".parse().unwrap(), "1.1165").unwrap();
    let wrong = AnyRate::parse("GBP".parse().unwrap(), "JPY".parse().unwrap(), "190").unwrap();
    assert!(matches!(
        any.and_then(&wrong),
        Err(Error::CurrencyMismatch { .. })
    ));
    let dollars = "1".parse::<Money<Usd>>().unwrap().to_any();
    assert!(matches!(
        any.convert(&dollars, Rounding::HalfEven),
        Err(Error::CurrencyMismatch { .. })
    ));
}
