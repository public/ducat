# ducat-format

Locale formatting and parsing of money for [ducat](https://docs.rs/ducat): a port of ducat's
`@ducatjs/money/format` and `@ducatjs/money/parse`, from CLDR 48's data (with the values ICU 78.3
ships where they differ), with no ICU and no floats.

```rust
use ducat::{AnyMoney, CurrencyCode};
use ducat_format::{
    CurrencyDisplay, FormatOptions, Locale, ParseMoneyOptions, ParseOptions, format, parse,
    parse_money,
};

let eur = CurrencyCode::iso("EUR")?;
let price = AnyMoney::parse("1234.5", eur)?;
let german = Locale::new("de-DE")?;
assert_eq!(format(&price, &german, &FormatOptions::default())?, "1.234,50\u{a0}€");
let english = Locale::new("en-GB")?;
let code = FormatOptions::new().display(CurrencyDisplay::Code);
assert_eq!(format(&price, &english, &code)?, "EUR\u{a0}1,234.50");

assert_eq!(parse("1.234,50 €", eur, &german, &ParseOptions::default())?, price);
let detected = parse_money("CHF 1’234.50", &Locale::new("de-CH")?, &ParseMoneyOptions::default())?;
assert_eq!(detected.to_decimal(), "1234.50");
assert_eq!(detected.currency().as_str(), "CHF");
```

It matches ducat's TypeScript on every format and parse vector of ducat's conformance suite.

## Locales and what they cost

The data covers the 430 locales CLDR rates modern, with one Cargo feature per language (`en`, `de`,
`zh`, …; `full` for all 101). A tag the build has no data for falls back by TR35's rules down to
root. The default set is 31 languages (313 locales), about 1.15 MB of data in a stripped release
binary; `full` about 3.24 MB. To keep only what you use:

```toml
[dependencies]
ducat-format = { version = "0.1", default-features = false, features = ["std", "en"] }
```

The crate needs only `alloc` (`default-features = false` without `std`).

License: MIT AND Unicode-3.0. The crate's code is MIT (LICENSE); the embedded CLDR and ICU data is © Unicode,
Inc., under the Unicode License v3 (LICENSE-UNICODE). NOTICE lists the data and its sources.
