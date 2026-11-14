//! The generator of `src/data.rs` (CLDR 48's number, currency and plural data for every locale of
//! the snapshot in the repository's `data/cldr/`), of `src/icu.rs` (the number symbols ICU 78.3's
//! shipped data overrides, from `data/icu/`) and of the `[features]` table in `Cargo.toml`, and
//! the check that all three are its output. To regenerate them:
//!
//! ```text
//! DUCAT_REGENERATE=1 cargo test -p ducat-format --test data
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

/// A locale's number data as the Rust expression `Numbers { … }`.
fn numbers(locale: &str, numbers: &Value, systems: &Value) -> String {
    let system = text(&numbers["defaultNumberingSystem"]);
    let digits: Vec<char> = text(&systems[system]["_digits"]).chars().collect();
    assert_eq!(digits.len(), 10, "{locale} {system}");
    let symbols = &numbers[format!("symbols-numberSystem-{system}")];
    let formats = &numbers[format!("currencyFormats-numberSystem-{system}")];
    let decimals = &numbers[format!("decimalFormats-numberSystem-{system}")];
    let decimal = symbols
        .get("currencyDecimal")
        .unwrap_or(&symbols["decimal"]);
    let group = symbols.get("currencyGroup").unwrap_or(&symbols["group"]);
    let spacing = &formats["currencySpacing"];
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
        "Numbers {{ digits: {digits:?}, decimal: {:?}, group: {:?}, minus: {:?}, plus: {:?}, minimum_grouping: {}, decimal_pattern: {:?}, currency_pattern: {:?}, accounting_pattern: {:?}, spacing: ({:?}, {:?}), unit_patterns: &[{}] }}",
        text(decimal),
        text(group),
        text(&symbols["minusSign"]),
        text(&symbols["plusSign"]),
        text(&numbers["minimumGroupingDigits"]),
        text(&decimals["standard"]),
        text(&formats["standard"]),
        text(&formats["accounting"]),
        text(&spacing["beforeCurrency"]["insertBetween"]),
        text(&spacing["afterCurrency"]["insertBetween"]),
        units.join(", ")
    )
}

fn currency(code: &str, entry: &Value) -> String {
    let mut fields = Vec::new();
    for (key, tag) in [
        ("symbol", 's'),
        ("symbol-alt-narrow", 'n'),
        ("displayName", 'd'),
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

/// `src/icu.rs`: each overridden locale's number data with ICU's symbols over CLDR's.
fn generate_icu(systems: &Value) -> String {
    let mut out = String::new();
    writeln!(
        out,
        "// GENERATED by rust/crates/ducat-format/tests/data.rs from data/icu/ (ICU 78.3) over data/cldr/."
    )
    .unwrap();
    writeln!(
        out,
        "// Do not edit by hand: run `DUCAT_REGENERATE=1 cargo test -p ducat-format --test data`."
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(out, "use crate::tables::Numbers;").unwrap();
    writeln!(out).unwrap();
    writeln!(out, "/// The ICU release of these overrides.").unwrap();
    writeln!(out, "pub(crate) const ICU_VERSION: &str = \"78.3\";").unwrap();
    let mut files: Vec<PathBuf> = std::fs::read_dir(root().join("data/icu"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "txt"))
        .collect();
    files.sort();
    let mut arms = Vec::new();
    for path in files {
        let locale = path
            .file_stem()
            .unwrap()
            .to_str()
            .unwrap()
            .replace('_', "-");
        let symbols = icu_symbols(&std::fs::read_to_string(&path).unwrap());
        let mut numbers_json = json(&format!("main/{locale}/numbers.json"));
        let body = &mut numbers_json["main"][locale.as_str()]["numbers"];
        let system = text(&body["defaultNumberingSystem"]).to_owned();
        let Some(overrides) = symbols.get(&system) else {
            continue;
        };
        let table = body[format!("symbols-numberSystem-{system}")]
            .as_object_mut()
            .unwrap();
        for (key, value) in overrides {
            table.insert(key.clone(), Value::String(value.clone()));
        }
        let lang = language(&locale).to_owned();
        writeln!(out).unwrap();
        writeln!(out, "#[cfg(feature = {lang:?})]").unwrap();
        writeln!(
            out,
            "static {}: Numbers = {};",
            ident("NUMBERS", &locale),
            numbers(&locale, body, systems)
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
    let mut numbers_users: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut plural_users: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut entries = Vec::new();
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
        let body = numbers(locale, &numbers_json["main"][locale]["numbers"], systems);
        numbers_users
            .entry(body)
            .or_default()
            .insert(lang.to_owned());
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
        entries.push((
            locale.clone(),
            lang.to_owned(),
            parent,
            numbers_json,
            key,
            list,
        ));
    }

    let numbers_ids: BTreeMap<&String, usize> = numbers_users
        .keys()
        .enumerate()
        .map(|(index, body)| (body, index))
        .collect();

    let mut out = String::new();
    writeln!(
        out,
        "// GENERATED by rust/crates/ducat-format/tests/data.rs from data/cldr/ (CLDR 48)."
    )
    .unwrap();
    writeln!(
        out,
        "// Do not edit by hand: run `DUCAT_REGENERATE=1 cargo test -p ducat-format --test data`."
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "use crate::tables::{{CurrencyData, LocaleData, Numbers, Operand, Relation, Rule}};"
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(out, "/// The CLDR release of these tables.").unwrap();
    writeln!(out, "pub(crate) const CLDR_VERSION: &str = \"48.0\";").unwrap();
    for (body, users) in &numbers_users {
        writeln!(out).unwrap();
        write!(out, "{}", cfg(users)).unwrap();
        writeln!(
            out,
            "static NUMBERS_{}: Numbers = {body};",
            numbers_ids[body]
        )
        .unwrap();
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
    for (locale, lang, parent, numbers_json, key, list) in &entries {
        let body = numbers(
            locale,
            &numbers_json["main"][locale.as_str()]["numbers"],
            systems,
        );
        let users = BTreeSet::from([lang.clone()]);
        writeln!(out).unwrap();
        write!(out, "{}", cfg(&users)).unwrap();
        writeln!(
            out,
            "static {}: LocaleData = LocaleData {{ name: {locale:?}, parent: {parent:?}, numbers: &NUMBERS_{}, plurals: {}, currencies: &[{}] }};",
            ident("L", locale),
            numbers_ids[&body],
            ident("PLURALS", key),
            list.join(", ")
        )
        .unwrap();
    }
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
    writeln!(features, "# BEGIN GENERATED by tests/data.rs").unwrap();
    writeln!(features, "[features]").unwrap();
    let defaults = DEFAULT_LANGUAGES
        .iter()
        .map(|language| format!("{language:?}"))
        .collect::<Vec<_>>();
    writeln!(features, "default = [\"std\", {}]", defaults.join(", ")).unwrap();
    writeln!(
        features,
        "## The standard library; the crate needs only `alloc`."
    )
    .unwrap();
    writeln!(features, "std = [\"ducat/std\"]").unwrap();
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
    writeln!(features, "# END GENERATED by tests/data.rs").unwrap();
    Generated {
        data: out,
        icu: generate_icu(systems),
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
        "{} is stale: run `DUCAT_REGENERATE=1 cargo test -p ducat-format --test data`",
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
