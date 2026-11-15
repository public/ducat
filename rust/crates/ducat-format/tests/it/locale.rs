//! Locale resolution: TR35's fallback, CLDR's likely scripts, and whether a tag has data as
//! ducat requires it of `Intl`. The expected names are what Node 24 (ICU 78.3) resolves the tags
//! to, where this build has the locale.

use ducat_format::{Error, Locale};

fn resolved(tag: &str) -> (&'static str, bool) {
    let locale = Locale::new(tag).unwrap();
    (locale.data_name(), locale.has_data())
}

#[test]
fn falls_back_by_tr35() {
    assert_eq!(resolved("de"), ("de", true));
    assert_eq!(resolved("de-DE"), ("de", true));
    assert_eq!(resolved("DE-de"), ("de", true));
    assert_eq!(resolved("de-CH"), ("de-CH", true));
    assert_eq!(resolved("de-XX"), ("de", false));
    assert_eq!(resolved("en-US"), ("en", true));
    assert_eq!(resolved("en-ZZ"), ("en", false));
    assert_eq!(resolved("xx-YY"), ("und", false));
    assert_eq!(resolved("de-CH-u-nu-latn"), ("de-CH", true));
    assert_eq!(resolved("en-US-x-private"), ("en", true));
}

#[test]
fn takes_the_script_a_region_writes() {
    // Node: zh-TW, zh-HK and sr-ME have their own data (歐元, evra)
    assert_eq!(resolved("zh-TW"), ("zh-Hant", true));
    assert_eq!(resolved("zh-HK"), ("zh-Hant-HK", true));
    assert_eq!(resolved("zh"), ("zh", true));
    assert_eq!(resolved("zh-CN"), ("zh-Hans", true));
    assert_eq!(resolved("sr-Latn-RS"), ("sr-Latn", true));
    assert_eq!(resolved("sr-ME"), ("sr-Latn-ME", true));
    assert_eq!(resolved("sr"), ("sr", true));
    // Node resolves en-Latn-US to en, so ducat refuses it for parsing too
    assert_eq!(resolved("en-Latn-US"), ("en", false));
    assert_eq!(resolved("zh-Hant-TW"), ("zh-Hant", true));
}

#[test]
fn has_no_data_for_locales_outside_modern_coverage() {
    // Node has pa-Arab and uz-Arab (CLDR's full set); this build has modern coverage only, so the
    // tags fall back and count as without data
    assert_eq!(resolved("pa-PK"), ("pa", false));
    assert_eq!(resolved("uz-Arab"), ("uz", false));
    assert_eq!(resolved("uz-AF"), ("uz", false));
}

#[test]
fn refuses_malformed_tags() {
    for tag in [
        "",
        "en_US",
        "e",
        "en-US-",
        "123",
        "-en",
        "en--US",
        "toolonglanguage",
        "en-u",
        "en-a-b",
    ] {
        assert_eq!(
            Locale::new(tag).unwrap_err(),
            Error::InvalidLocale,
            "{tag:?}"
        );
    }
    assert_eq!(
        Locale::new(&"en-".repeat(200)).unwrap_err(),
        Error::InvalidLocale
    );
}
