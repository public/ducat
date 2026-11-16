# ducat-words

Amounts and numbers in words for [ducat](https://docs.rs/ducat), as cheques, invoices and legal
documents need: a port of ducat's `@ducatjs/money/words`.

The words come from CLDR's rule-based number formats (RBNF), the rules ICU uses, through a small
interpreter of their text (CLDR release 49, embedded in the crate), with no ICU. Each language is a
feature: `en`, `de`, `fr`, `es`, `it`, `nl`, `pt` (all on by default).

```rust
use ducat::iso::Eur;
use ducat::Money;
use ducat_words::{AmountInWordsOptions, ENGLISH, UnitNames, amount_in_words, spell_out};

assert_eq!(spell_out(123, &ENGLISH, None)?, "one hundred twenty-three");
assert_eq!(spell_out(21, &ENGLISH, Some("%spellout-ordinal"))?, "twenty-first");

let euros = UnitNames::new("euros").one("euro");
let price: Money<Eur> = "123.45".parse().unwrap();
let options = AmountInWordsOptions::new(euros);
assert_eq!(
    amount_in_words(&price.to_any(), &ENGLISH, &options)?,
    "one hundred twenty-three euros and 45/100"
);
```

The crate has no CLDR currency names, so the caller gives the currency's name, in the plural forms
the language uses. It needs only `alloc` (`default-features = false` without `std`).

License: MIT AND Unicode-3.0. The crate's code is MIT (LICENSE); the embedded CLDR data is © Unicode, Inc., under
the Unicode License v3 (LICENSE-UNICODE). NOTICE lists the data and its sources.
