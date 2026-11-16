//! The generator of `src/data.rs` (CLDR 48's number, currency and plural data for every locale of
//! the snapshot in the repository's `data/cldr/`), of `src/icu.rs` (the number symbols ICU 78.3's
//! shipped data overrides, from `data/icu/`) and of the `[features]` table in `Cargo.toml`, and
//! the check that all three are its output. To regenerate them:
//!
//! ```text
//! DUCAT_REGENERATE=1 cargo test -p ducat-format --test it data::
//! ```

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::path::PathBuf;

use serde_json::Value;

/// The languages built by default: those the spec's format and parse vectors use, and the most
/// spoken others.
const DEFAULT_LANGUAGES: [&str; 31] = [
    "ar", "bn", "da", "de", "en", "es", "fa", "fil", "fr", "he", "hi", "id", "it", "ja", "ko",
    "mr", "ms", "nl", "pl", "pt", "ru", "sv", "sw", "ta", "te", "th", "tr", "uk", "ur", "vi", "zh",
];

const CATEGORIES: [&str; 6] = ["zero", "one", "two", "few", "many", "other"];

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn json(relative: &str) -> Value {
    let path = root().join("data/cldr").join(relative);
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap()
}

fn text(value: &Value) -> &str {
    value
        .as_str()
        .unwrap_or_else(|| panic!("not a string: {value}"))
}

/// The feature a locale belongs to: its language (root belongs to none, it is always built).
fn language(locale: &str) -> &str {
    locale.split('-').next().unwrap()
}

fn cfg(languages: &BTreeSet<String>) -> String {
    if languages.contains("und") {
        return String::new();
    }
    let features = languages
        .iter()
        .map(|language| format!("feature = {language:?}"))
        .collect::<Vec<_>>();
    if features.len() == 1 {
        format!("#[cfg({})]\n", features[0])
    } else {
        format!("#[cfg(any({}))]\n", features.join(", "))
    }
}

/// A Rust identifier for a locale: `en-IN` is `L_EN_IN`.
fn ident(prefix: &str, name: &str) -> String {
    format!("{prefix}_{}", name.replace('-', "_").to_uppercase())
}

/// A relation of a plural rule, `n % 100 != 11..13`, as Rust.
fn relation(text: &str) -> String {
    let (left, equal, right) = if let Some((left, right)) = text.split_once("!=") {
        (left, false, right)
    } else {
        let (left, right) = text.split_once('=').unwrap();
        (left, true, right)
    };
    let (operand, modulus) = match left.trim().split_once('%') {
        Some((operand, modulus)) => (operand.trim(), modulus.trim().parse::<u32>().unwrap()),
        None => (left.trim(), 0),
    };
    let operand = match operand {
        "n" => "N",
        "i" => "I",
        "v" => "V",
        "w" => "W",
        "f" => "F",
        "t" => "T",
        "c" | "e" => "E",
        other => panic!("plural operand {other} in {text:?}"),
    };
    let ranges = right
        .split(',')
        .map(|item| {
            let item = item.trim();
            let (low, high) = item.split_once("..").unwrap_or((item, item));
            format!(
                "({}, {})",
                low.parse::<u32>().unwrap(),
                high.parse::<u32>().unwrap()
            )
        })
        .collect::<Vec<_>>();
    format!(
        "Relation {{ operand: Operand::{operand}, modulus: {modulus}, equal: {equal}, ranges: &[{}] }}",
        ranges.join(", ")
    )
}

fn plural_rules(rules: &Value) -> String {
    let mut out = Vec::new();
    for category in CATEGORIES {
        if category == "other" {
            continue;
        }
        let Some(rule) = rules.get(format!("pluralRule-count-{category}")) else {
            continue;
        };
        let condition = text(rule).split('@').next().unwrap().trim();
        let any = condition
            .split(" or ")
            .map(|alternative| {
                let all = alternative.split(" and ").map(relation).collect::<Vec<_>>();
                format!("&[{}]", all.join(", "))
            })
            .collect::<Vec<_>>();
        out.push(format!(
            "Rule {{ category: {category:?}, any: &[{}] }}",
            any.join(", ")
        ));
    }
    format!("&[{}]", out.join(", "))
}

/// A numbering system's block of a locale's numbers.json (`symbols`, `decimalFormats`,
/// `currencyFormats`), else latn's, as TR35 falls back for a numbering system without data.
fn block<'a>(numbers: &'a Value, kind: &str, system: &str) -> &'a Value {
    numbers
        .get(format!("{kind}-numberSystem-{system}"))
        .unwrap_or(&numbers[format!("{kind}-numberSystem-latn")])
}

/// One key of a numbering system's block, else latn's.
fn key<'a>(numbers: &'a Value, kind: &str, system: &str, name: &str) -> &'a Value {
    let own = block(numbers, kind, system);
    own.get(name)
        .unwrap_or_else(|| &numbers[format!("{kind}-numberSystem-latn")][name])
}

/// A table of compact patterns (`{"1000-count-one": "0K", …}`) as `compact::Table` encodes it:
/// two-digit magnitude, plural tag, pattern; a category with the `other` pattern is left out.
fn compact_table(patterns: Option<&Value>) -> String {
    let Some(patterns) = patterns.and_then(Value::as_object) else {
        return String::new();
    };
    let mut entries: BTreeMap<(usize, char), String> = BTreeMap::new();
    for (name, pattern) in patterns {
        if name.contains("-alt-") {
            continue;
        }
        let (power, category) = name
            .split_once("-count-")
            .unwrap_or_else(|| panic!("{name}"));
        assert!(
            power.starts_with('1') && power[1..].bytes().all(|b| b == b'0'),
            "{name}"
        );
        let tag = match category {
            "0" => 'z',
            "1" => 'y',
            "zero" => '0',
            "one" => '1',
            "two" => '2',
            "few" => '3',
            "many" => '4',
            "other" => '5',
            other => panic!("compact category {other}"),
        };
        let pattern = text(pattern);
        assert!(!pattern.contains('\u{1f}'), "{pattern:?}");
        entries.insert((power.len() - 1, tag), pattern.to_owned());
    }
    let mut out = Vec::new();
    for (&(magnitude, tag), pattern) in &entries {
        assert!(magnitude < 100);
        let other = &entries[&(magnitude, '5')];
        if tag != '5' && pattern == other {
            continue;
        }
        out.push(format!("{magnitude:02}{tag}{pattern}"));
    }
    out.join("\u{1f}")
}

/// A numbering system's compact patterns as the Rust expression `Compact { … }`: its own, else
/// latn's (ICU falls back so), the short currency ones a table each.
fn compact(numbers: &Value, system: &str) -> String {
    let own_or_latn = |kind: &str, length: &str, inner: &str| {
        let own = numbers
            .get(format!("{kind}-numberSystem-{system}"))
            .and_then(|formats| formats.get(length))
            .and_then(|formats| formats.get(inner));
        let latn = numbers[format!("{kind}-numberSystem-latn")]
            .get(length)
            .and_then(|formats| formats.get(inner));
        compact_table(own.or(latn))
    };
    format!(
        "Compact {{ decimal_short: Table({:?}), decimal_long: Table({:?}), currency_short: Table({:?}) }}",
        own_or_latn("decimalFormats", "short", "decimalFormat"),
        own_or_latn("decimalFormats", "long", "decimalFormat"),
        own_or_latn("currencyFormats", "short", "standard"),
    )
}

/// A locale's number data in a numbering system as the Rust expression `Numbers { … }`, with
/// `{compact}` standing for its compact patterns' static.
fn numbers(locale: &str, numbers: &Value, systems: &Value, system: &str) -> String {
    let digits: Vec<char> = text(&systems[system]["_digits"]).chars().collect();
    assert_eq!(digits.len(), 10, "{locale} {system}");
    let symbols = block(numbers, "symbols", system);
    let formats = block(numbers, "currencyFormats", system);
    let decimal = symbols
        .get("currencyDecimal")
        .unwrap_or(&symbols["decimal"]);
    let group = symbols.get("currencyGroup").unwrap_or(&symbols["group"]);
    let spacing = key(numbers, "currencyFormats", system, "currencySpacing");
    for side in ["beforeCurrency", "afterCurrency"] {
        // the rule src/format.rs implements
        assert_eq!(
            spacing[side]["currencyMatch"], "[[:^S:]&[:^Z:]]",
            "{locale}"
        );
        assert_eq!(spacing[side]["surroundingMatch"], "[:digit:]", "{locale}");
    }
    // a numbering system without unit patterns (sd's arab) uses latn's, as TR35 falls back to
    // latn for numbering-system data
    let units_from = if formats.get("unitPattern-count-other").is_some() {
        formats
    } else {
        &numbers["currencyFormats-numberSystem-latn"]
    };
    let mut units = Vec::new();
    for category in CATEGORIES {
        if let Some(pattern) = units_from.get(format!("unitPattern-count-{category}")) {
            units.push(format!("({category:?}, {:?})", text(pattern)));
        }
    }
    assert!(
        units_from.get("unitPattern-count-other").is_some(),
        "{locale}"
    );
    format!(
        "Numbers {{ digits: {digits:?}, decimal: {:?}, group: {:?}, minus: {:?}, plus: {:?}, minimum_grouping: {}, decimal_pattern: {:?}, currency_pattern: {:?}, accounting_pattern: {:?}, spacing: ({:?}, {:?}), unit_patterns: &[{}], exponential: {:?}, #[cfg(feature = \"compact\")] compact: &{{compact}} }}",
        text(decimal),
        text(group),
        text(&symbols["minusSign"]),
        text(&symbols["plusSign"]),
        text(&numbers["minimumGroupingDigits"]),
        text(key(numbers, "decimalFormats", system, "standard")),
        text(key(numbers, "currencyFormats", system, "standard")),
        text(key(numbers, "currencyFormats", system, "accounting")),
        text(&spacing["beforeCurrency"]["insertBetween"]),
        text(&spacing["afterCurrency"]["insertBetween"]),
        units.join(", "),
        text(&symbols["exponential"]),
    )
}

/// The numbering systems a locale's numbers.json has data for, other than its default.
fn other_systems(numbers: &Value) -> Vec<String> {
    let default = text(&numbers["defaultNumberingSystem"]);
    let mut out: Vec<String> = numbers
        .as_object()
        .unwrap()
        .keys()
        .filter_map(|name| name.strip_prefix("symbols-numberSystem-"))
        .filter(|system| *system != default)
        .map(str::to_owned)
        .collect();
    out.sort();
    out
}

fn currency(code: &str, entry: &Value) -> String {
    let mut fields = Vec::new();
    for (key, tag) in [
        ("symbol", 's'),
        ("symbol-alt-narrow", 'n'),
        ("displayName", 'd'),
        ("pattern", 'p'),
        ("decimal", '.'),
        ("group", ','),
    ] {
        if let Some(value) = entry.get(key) {
            fields.push(format!("{tag}{}", text(value)));
        }
    }
    for (index, category) in CATEGORIES.iter().enumerate() {
        if let Some(name) = entry.get(format!("displayName-count-{category}")) {
            fields.push(format!("{index}{}", text(name)));
        }
    }
    for field in &fields {
        assert!(!field.contains('\u{1f}'), "{code}: {field:?}");
    }
    assert_eq!(code.len(), 3, "{code}");
    format!(
        "CurrencyData {{ code: *b{code:?}, fields: {:?} }}",
        fields.join("\u{1f}")
    )
}

/// A locale as the generator collects it: name, language (feature), parent, its numbering
/// systems' number blocks (the default first), plural rules key, currency entries.
type Entry = (
    String,
    String,
    String,
    Vec<(String, String)>,
    String,
    Vec<String>,
);

/// The languages with a locale in the snapshot (root aside).
fn languages_of(entries: &[Entry]) -> BTreeSet<String> {
    entries
        .iter()
        .map(|(_, lang, ..)| lang.clone())
        .filter(|lang| lang != "und")
        .collect()
}

/// Deduplicated statics: each body's name (its first user's) and which languages use it, by
/// default or only with the `numbering-systems` feature.
#[derive(Default)]
struct Blocks {
    names: BTreeMap<String, String>,
    users: BTreeMap<String, (BTreeSet<String>, BTreeSet<String>)>,
}

impl Blocks {
    fn add(&mut self, body: String, name: &str, lang: &str, only_with_feature: bool) -> String {
        let name = self
            .names
            .entry(body.clone())
            .or_insert_with(|| name.to_owned())
            .clone();
        let users = self.users.entry(body).or_default();
        if only_with_feature {
            users.1.insert(lang.to_owned());
        } else {
            users.0.insert(lang.to_owned());
        }
        name
    }

    /// The statics by name, each with the `cfg` condition it is built under (`None`: always).
    fn sorted(&self) -> Vec<(String, String, Option<String>)> {
        let mut out: Vec<(String, String, Option<String>)> = self
            .names
            .iter()
            .map(|(body, name)| {
                let (default, with_feature) = &self.users[body];
                (name.clone(), body.clone(), condition(default, with_feature))
            })
            .collect();
        out.sort();
        out
    }
}

/// The `cfg` condition for statics the `default` languages always use and the `with_feature`
/// ones only with `numbering-systems`; `None` when root (always built) uses it by default.
fn condition(default: &BTreeSet<String>, with_feature: &BTreeSet<String>) -> Option<String> {
    if default.contains("und") {
        return None;
    }
    let mut any: Vec<String> = default
        .iter()
        .map(|language| format!("feature = {language:?}"))
        .collect();
    let extra: Vec<String> = with_feature
        .iter()
        .filter(|language| !default.contains(*language))
        .map(|language| {
            if language == "und" {
                "feature = \"numbering-systems\"".to_owned()
            } else {
                format!("feature = {language:?}")
            }
        })
        .collect();
    if with_feature.contains("und") {
        any.push("feature = \"numbering-systems\"".to_owned());
    } else if !extra.is_empty() {
        let inner = if extra.len() == 1 {
            extra[0].clone()
        } else {
            format!("any({})", extra.join(", "))
        };
        any.push(format!("all(feature = \"numbering-systems\", {inner})"));
    }
    Some(if any.len() == 1 {
        any.remove(0)
    } else {
        format!("any({})", any.join(", "))
    })
}

struct Generated {
    data: String,
    icu: String,
    features: String,
}

/// The number symbols an ICU locale file sets, by numbering system: the
/// `NumberElements/<system>/symbols` tables of `data/icu/<locale>.txt`.
fn icu_symbols(text: &str) -> BTreeMap<String, BTreeMap<String, String>> {
    let mut out: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    let mut path: Vec<String> = Vec::new();
    for line in text.trim_start_matches('\u{feff}').lines() {
        let line = line.trim();
        if line.starts_with("//") || line.is_empty() {
            continue;
        }
        if let Some(name) = line.strip_suffix('{') {
            path.push(name.to_owned());
        } else if line == "}" {
            path.pop();
        } else if path.len() == 4 && path[1] == "NumberElements" && path[3] == "symbols" {
            let (key, value) = line.split_once('{').unwrap();
            let value = value.strip_suffix('}').unwrap();
            let value = value.strip_prefix('"').unwrap().strip_suffix('"').unwrap();
            out.entry(path[2].clone())
                .or_default()
                .insert(key.to_owned(), value.to_owned());
        }
    }
    out
}

/// The `CurrencyUnitPatterns` table of an ICU curr/ file, if it has one.
fn icu_unit_patterns(text: &str) -> Option<BTreeMap<String, String>> {
    let mut out = BTreeMap::new();
    let mut path: Vec<String> = Vec::new();
    let mut found = false;
    for line in text.trim_start_matches('\u{feff}').lines() {
        let line = line.trim();
        if line.starts_with("//") || line.is_empty() {
            continue;
        }
        if let Some(name) = line.strip_suffix('{') {
            path.push(name.to_owned());
            if path.len() == 2 && path[1] == "CurrencyUnitPatterns" {
                found = true;
            }
        } else if line == "}" {
            path.pop();
        } else if path.len() == 2 && path[1] == "CurrencyUnitPatterns" {
            let (key, value) = line.split_once('{').unwrap();
            let value = value.strip_suffix('}').unwrap();
            let value = value.strip_prefix('"').unwrap().strip_suffix('"').unwrap();
            out.insert(key.to_owned(), value.to_owned());
        }
    }
    found.then_some(out)
}

/// `src/icu.rs`: each overridden locale's number data with ICU's symbols and unit patterns over
/// CLDR's.
fn generate_icu(systems: &Value, compacts: &Blocks) -> String {
    let mut out = String::new();
    writeln!(
        out,
        "// GENERATED by rust/crates/ducat-format/tests/it/data.rs from data/icu/ (ICU 78.3) over data/cldr/."
    )
    .unwrap();
    writeln!(
        out,
        "// Do not edit by hand: run `DUCAT_REGENERATE=1 cargo test -p ducat-format --test it data::`."
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(out, "use crate::tables::Numbers;").unwrap();
    writeln!(out).unwrap();
    writeln!(out, "/// The ICU release of these overrides.").unwrap();
    writeln!(out, "pub(crate) const ICU_VERSION: &str = \"78.3\";").unwrap();
    // data/icu/<locale>.txt: ICU's locales/ files whose number symbols override CLDR's;
    // data/icu/curr/<locale>.txt: its curr/ files whose unit patterns do (a curr/ file without
    // CurrencyUnitPatterns has root's, data/icu/curr/root.txt)
    let txt_files = |dir: PathBuf| -> Vec<PathBuf> {
        let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "txt"))
            .collect();
        files.sort();
        files
    };
    let locale_of = |path: &PathBuf| {
        path.file_stem()
            .unwrap()
            .to_str()
            .unwrap()
            .replace('_', "-")
    };
    let mut symbol_overrides: BTreeMap<String, BTreeMap<String, BTreeMap<String, String>>> =
        BTreeMap::new();
    for path in txt_files(root().join("data/icu")) {
        symbol_overrides.insert(
            locale_of(&path),
            icu_symbols(&std::fs::read_to_string(&path).unwrap()),
        );
    }
    let root_units =
        icu_unit_patterns(&std::fs::read_to_string(root().join("data/icu/curr/root.txt")).unwrap())
            .expect("root has unit patterns");
    let mut unit_overrides: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    for path in txt_files(root().join("data/icu/curr")) {
        let locale = locale_of(&path);
        if locale == "root" {
            continue;
        }
        let units = icu_unit_patterns(&std::fs::read_to_string(&path).unwrap())
            .unwrap_or_else(|| root_units.clone());
        unit_overrides.insert(locale, units);
    }
    let overridden: BTreeSet<String> = symbol_overrides
        .keys()
        .chain(unit_overrides.keys())
        .cloned()
        .collect();
    let mut arms = Vec::new();
    for locale in overridden {
        let mut numbers_json = json(&format!("main/{locale}/numbers.json"));
        let body = &mut numbers_json["main"][locale.as_str()]["numbers"];
        let system = text(&body["defaultNumberingSystem"]).to_owned();
        if let Some(overrides) = symbol_overrides
            .get(&locale)
            .and_then(|by_system| by_system.get(&system))
        {
            let table = body[format!("symbols-numberSystem-{system}")]
                .as_object_mut()
                .unwrap();
            for (key, value) in overrides {
                table.insert(key.clone(), Value::String(value.clone()));
            }
        }
        if let Some(units) = unit_overrides.get(&locale) {
            // ICU keeps one set of unit patterns, whatever the numbering system
            for block in [
                format!("currencyFormats-numberSystem-{system}"),
                "currencyFormats-numberSystem-latn".to_owned(),
            ] {
                let formats = body[block.as_str()].as_object_mut().unwrap();
                formats.retain(|key, _| !key.starts_with("unitPattern-count-"));
                for (category, pattern) in units {
                    formats.insert(
                        format!("unitPattern-count-{category}"),
                        Value::String(pattern.clone()),
                    );
                }
            }
        }
        let lang = language(&locale).to_owned();
        writeln!(out).unwrap();
        writeln!(out, "#[cfg(feature = {lang:?})]").unwrap();
        writeln!(
            out,
            "static {}: Numbers = {};",
            ident("NUMBERS", &locale),
            numbers(&locale, body, systems, &system).replace(
                "{compact}",
                &format!("crate::data::{}", compacts.names[&compact(body, &system)])
            )
        )
        .unwrap();
        arms.push((locale, lang));
    }
    writeln!(out).unwrap();
    writeln!(
        out,
        "/// The number data ICU ships for this cldr-json locale, where it overrides CLDR's."
    )
    .unwrap();
    writeln!(
        out,
        "pub(crate) fn numbers(name: &str) -> Option<&'static Numbers> {{"
    )
    .unwrap();
    writeln!(out, "    match name {{").unwrap();
    for (locale, lang) in arms {
        writeln!(
            out,
            "        #[cfg(feature = {lang:?})] {locale:?} => Some(&{}),",
            ident("NUMBERS", &locale)
        )
        .unwrap();
    }
    writeln!(out, "        _ => None,").unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "}}").unwrap();
    out
}

fn generate() -> Generated {
    let coverage = json("coverageLevels.json");
    let locales: Vec<String> = coverage["effectiveCoverageLevels"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    let parents = json("parents.json");
    let systems = &json("supplemental/numberingSystems.json")["supplemental"]["numberingSystems"];
    let plurals = &json("supplemental/plurals.json")["supplemental"]["plurals-type-cardinal"];
    let default_content = json("defaultContent.json");
    let kept: BTreeSet<&str> = locales.iter().map(String::as_str).collect();

    // which languages need which: a locale inheriting from another language's locale
    let mut needs: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    // each distinct number block (and compact block) is named after the first locale (in code
    // order) that uses it, so a CLDR update renames few of them; its users are the languages
    // that take it as a default numbering system, and those that take it only with the
    // numbering-systems feature
    let mut numbers_blocks = Blocks::default();
    let mut compact_blocks = Blocks::default();
    let mut plural_users: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut entries: Vec<Entry> = Vec::new();
    for locale in &locales {
        let lang = if locale == "und" {
            "und"
        } else {
            language(locale)
        };
        let parent = if locale == "und" {
            String::new()
        } else {
            text(&parents["parents"][locale]).to_owned()
        };
        if !parent.is_empty() && parent != "und" && language(&parent) != lang {
            needs
                .entry(lang.to_owned())
                .or_default()
                .insert(language(&parent).to_owned());
        }
        let numbers_json = json(&format!("main/{locale}/numbers.json"));
        let body = &numbers_json["main"][locale]["numbers"];
        let default = text(&body["defaultNumberingSystem"]).to_owned();
        let mut own = Vec::new();
        for system in std::iter::once(default.clone()).chain(other_systems(body)) {
            // an algorithmic system (no digits) has no numbers of its own
            if systems[&system].get("_digits").is_none() {
                continue;
            }
            let only_with_feature = system != default;
            let suffix = if only_with_feature {
                format!("{locale}-{system}")
            } else {
                locale.clone()
            };
            let compact_name = compact_blocks.add(
                compact(body, &system),
                &ident("COMPACT", &suffix),
                lang,
                only_with_feature,
            );
            let numbers_body =
                numbers(locale, body, systems, &system).replace("{compact}", &compact_name);
            let name = numbers_blocks.add(
                numbers_body,
                &ident("NUMBERS", &suffix),
                lang,
                only_with_feature,
            );
            own.push((system, name));
        }
        // TR35: a locale's plural rules are its own, else its language's, else root's
        let key = [locale.as_str(), language(locale), "und"]
            .into_iter()
            .find(|key| plurals.get(*key).is_some())
            .unwrap()
            .to_owned();
        plural_users
            .entry(key.clone())
            .or_default()
            .insert(lang.to_owned());
        let currencies_json = json(&format!("main/{locale}/currencies.json"));
        let currencies = currencies_json["main"][locale]["numbers"]["currencies"]
            .as_object()
            .unwrap();
        let mut list: Vec<String> = currencies
            .iter()
            .map(|(code, entry)| currency(code, entry))
            .collect();
        list.sort();
        entries.push((locale.clone(), lang.to_owned(), parent, own, key, list));
    }

    let mut out = String::new();
    writeln!(
        out,
        "// GENERATED by rust/crates/ducat-format/tests/it/data.rs from data/cldr/ (CLDR 48)."
    )
    .unwrap();
    writeln!(
        out,
        "// Do not edit by hand: run `DUCAT_REGENERATE=1 cargo test -p ducat-format --test it data::`."
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "use crate::tables::{{CurrencyData, LocaleData, Numbers, Operand, Relation, Rule}};"
    )
    .unwrap();
    writeln!(out, "#[cfg(feature = \"compact\")]").unwrap();
    writeln!(out, "use crate::{{compact::Table, tables::Compact}};").unwrap();
    writeln!(out).unwrap();
    writeln!(out, "/// The CLDR release of these tables.").unwrap();
    writeln!(out, "pub(crate) const CLDR_VERSION: &str = \"48.0\";").unwrap();
    for (name, body, condition) in compact_blocks.sorted() {
        writeln!(out).unwrap();
        let condition = match condition {
            Some(condition) => format!("all(feature = \"compact\", {condition})"),
            None => "feature = \"compact\"".to_owned(),
        };
        writeln!(out, "#[cfg({condition})]").unwrap();
        writeln!(out, "pub(crate) static {name}: Compact = {body};").unwrap();
    }
    for (name, body, condition) in numbers_blocks.sorted() {
        writeln!(out).unwrap();
        if let Some(condition) = condition {
            writeln!(out, "#[cfg({condition})]").unwrap();
        }
        writeln!(out, "static {name}: Numbers = {body};").unwrap();
    }
    for (key, users) in &plural_users {
        writeln!(out).unwrap();
        write!(out, "{}", cfg(users)).unwrap();
        writeln!(
            out,
            "static {}: &[Rule] = {};",
            ident("PLURALS", key),
            plural_rules(&plurals[key])
        )
        .unwrap();
    }
    for (locale, lang, parent, own, key, list) in &entries {
        let users = BTreeSet::from([lang.clone()]);
        writeln!(out).unwrap();
        write!(out, "{}", cfg(&users)).unwrap();
        let others = own[1..]
            .iter()
            .map(|(system, name)| format!("({system:?}, &{name})"))
            .collect::<Vec<_>>();
        writeln!(
            out,
            "static {}: LocaleData = LocaleData {{ name: {locale:?}, parent: {parent:?}, system: {:?}, numbers: &{}, #[cfg(feature = \"numbering-systems\")] systems: &[{}], plurals: {}, currencies: &[",
            ident("L", locale),
            own[0].0,
            own[0].1,
            others.join(", "),
            ident("PLURALS", key),
        )
        .unwrap();
        for entry in list {
            writeln!(out, "    {entry},").unwrap();
        }
        writeln!(out, "] }};").unwrap();
    }
    // the digits of every numeric numbering system, which any locale may be formatted in
    writeln!(out).unwrap();
    writeln!(
        out,
        "/// The name and digits of a numeric numbering system of CLDR's (`arab`, `deva`)."
    )
    .unwrap();
    writeln!(out, "#[cfg(feature = \"numbering-systems\")]").unwrap();
    writeln!(
        out,
        "pub(crate) fn digits(name: &str) -> Option<(&'static str, &'static [char; 10])> {{"
    )
    .unwrap();
    writeln!(out, "    match name {{").unwrap();
    for (name, system) in systems.as_object().unwrap() {
        if system["_type"] != "numeric" {
            continue;
        }
        let digits: Vec<char> = text(&system["_digits"]).chars().collect();
        assert_eq!(digits.len(), 10, "{name}");
        writeln!(out, "        {name:?} => Some(({name:?}, &{digits:?})),").unwrap();
    }
    writeln!(out, "        _ => None,").unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "}}").unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "/// Every locale of the snapshot, built or not, in code order."
    )
    .unwrap();
    let names = entries
        .iter()
        .map(|(locale, ..)| format!("{locale:?}"))
        .collect::<Vec<_>>();
    writeln!(
        out,
        "pub(crate) const NAMES: &[&str] = &[{}];",
        names.join(", ")
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "/// The locale of the snapshot with this cldr-json name, if its language is built."
    )
    .unwrap();
    writeln!(
        out,
        "pub(crate) fn locale(name: &str) -> Option<&'static LocaleData> {{"
    )
    .unwrap();
    writeln!(out, "    match name {{").unwrap();
    for (locale, lang, ..) in &entries {
        write!(out, "        ").unwrap();
        if lang != "und" {
            write!(out, "#[cfg(feature = {lang:?})] ").unwrap();
        }
        writeln!(out, "{locale:?} => Some(&{}),", ident("L", locale)).unwrap();
    }
    writeln!(out, "        _ => None,").unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "}}").unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "/// Whether CLDR names the tag as a locale's default content (`en-US` is `en`'s): it has"
    )
    .unwrap();
    writeln!(
        out,
        "/// that locale's data. Only tags of the snapshot's locales are listed."
    )
    .unwrap();
    writeln!(
        out,
        "pub(crate) fn is_default_content(tag: &str) -> bool {{"
    )
    .unwrap();
    writeln!(out, "    match tag {{").unwrap();
    let mut content: Vec<(&str, &str)> = Vec::new();
    for tag in default_content["defaultContent"].as_array().unwrap() {
        let tag = text(tag);
        let base = tag.rsplit_once('-').map_or("", |(base, _)| base);
        if kept.contains(base) && !kept.contains(tag) {
            content.push((tag, language(base)));
        }
    }
    content.sort_unstable();
    for (tag, lang) in content {
        writeln!(out, "        #[cfg(feature = {lang:?})] {tag:?} => true,").unwrap();
    }
    writeln!(out, "        _ => false,").unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "}}").unwrap();

    // the script a language-region tag means where it isn't the language's own (zh-TW is
    // zh-Hant-TW, but zh is zh-Hans): from CLDR's likely subtags
    let likely = &json("supplemental/likelySubtags.json")["supplemental"]["likelySubtags"];
    let script_of = |value: &Value| text(value).split('-').nth(1).unwrap().to_owned();
    let built = languages_of(&entries);
    writeln!(out).unwrap();
    writeln!(
        out,
        "/// The likely script of a language (`zh` is `Hans`) or of a `language-REGION` tag, where it"
    )
    .unwrap();
    writeln!(
        out,
        "/// differs from the language's (CLDR's likely subtags): `zh-TW` is `Hant`, `sr-ME` `Latn`."
    )
    .unwrap();
    writeln!(
        out,
        "pub(crate) fn likely_script(tag: &str) -> Option<&'static str> {{"
    )
    .unwrap();
    writeln!(out, "    match tag {{").unwrap();
    for (key, value) in likely.as_object().unwrap() {
        let Some((lang, _)) = key.split_once('-') else {
            // a language's own script
            if built.contains(key.as_str()) {
                writeln!(
                    out,
                    "        #[cfg(feature = {key:?})] {key:?} => Some({:?}),",
                    script_of(value)
                )
                .unwrap();
            }
            continue;
        };
        let Some(base) = likely.get(lang) else {
            continue;
        };
        let script = script_of(value);
        if script != script_of(base) && built.contains(lang) {
            writeln!(
                out,
                "        #[cfg(feature = {lang:?})] {key:?} => Some({script:?}),"
            )
            .unwrap();
        }
    }
    writeln!(out, "        _ => None,").unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "}}").unwrap();

    // Cargo.toml's [features]
    let languages: BTreeSet<&str> = entries
        .iter()
        .map(|(_, lang, ..)| lang.as_str())
        .filter(|lang| *lang != "und")
        .collect();
    for language in DEFAULT_LANGUAGES {
        assert!(languages.contains(language), "{language}");
    }
    let mut features = String::new();
    writeln!(features, "# BEGIN GENERATED by tests/it/data.rs").unwrap();
    writeln!(features, "[features]").unwrap();
    let defaults = DEFAULT_LANGUAGES
        .iter()
        .map(|language| format!("{language:?}"))
        .collect::<Vec<_>>();
    writeln!(
        features,
        "default = [\"std\", \"compact\", \"numbering-systems\", {}]",
        defaults.join(", ")
    )
    .unwrap();
    writeln!(
        features,
        "## The standard library; the crate needs only `alloc`."
    )
    .unwrap();
    writeln!(features, "std = [\"ducat/std\"]").unwrap();
    writeln!(
        features,
        "## Compact notation (`Notation::Compact`): CLDR's compact patterns of every built locale."
    )
    .unwrap();
    writeln!(features, "compact = []").unwrap();
    writeln!(
        features,
        "## Numbering systems other than a locale's default (`numberingSystem`, `-u-nu-`): their digits, and the symbols and patterns CLDR gives the built locales for them."
    )
    .unwrap();
    writeln!(features, "numbering-systems = []").unwrap();
    let all = languages
        .iter()
        .map(|language| format!("{language:?}"))
        .collect::<Vec<_>>();
    writeln!(
        features,
        "## Every language of the snapshot (CLDR's modern coverage)."
    )
    .unwrap();
    writeln!(features, "full = [{}]", all.join(", ")).unwrap();
    for language in &languages {
        let count = entries
            .iter()
            .filter(|(_, lang, ..)| lang == language)
            .count();
        writeln!(
            features,
            "## `{language}`: {count} locale{} of CLDR's data.",
            if count == 1 { "" } else { "s" }
        )
        .unwrap();
        let deps = needs
            .get(*language)
            .map(|set| {
                set.iter()
                    .map(|dep| format!("{dep:?}"))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        writeln!(features, "{language} = [{deps}]").unwrap();
    }
    writeln!(features, "# END GENERATED by tests/it/data.rs").unwrap();
    Generated {
        data: out,
        icu: generate_icu(systems, &compact_blocks),
        features,
    }
}

fn check(path: &PathBuf, generated: &str, splice: Option<(&str, &str)>) {
    let committed = std::fs::read_to_string(path).unwrap_or_default();
    let expected = match splice {
        None => generated.to_owned(),
        Some((begin, end)) => {
            let start = committed
                .find(begin)
                .expect("Cargo.toml has the generated block");
            let stop = committed[start..].find(end).unwrap() + start;
            let stop = stop + committed[stop..].find('\n').unwrap() + 1;
            format!("{}{generated}{}", &committed[..start], &committed[stop..])
        }
    };
    if std::env::var_os("DUCAT_REGENERATE").is_some() {
        std::fs::write(path, &expected).unwrap();
        return;
    }
    assert!(
        committed == expected,
        "{} is stale: run `DUCAT_REGENERATE=1 cargo test -p ducat-format --test it data::`",
        path.display()
    );
}

#[test]
fn committed_tables_are_the_generators_output() {
    let generated = generate();
    let crate_dir = root().join("rust/crates/ducat-format");
    check(&crate_dir.join("src/data.rs"), &generated.data, None);
    check(&crate_dir.join("src/icu.rs"), &generated.icu, None);
    check(
        &crate_dir.join("Cargo.toml"),
        &generated.features,
        Some(("# BEGIN GENERATED", "# END GENERATED")),
    );
}
