//! ducat-words' share of ducat's conformance suite: every `words.spellOut` row in
//! `spec/vectors/words/*.json` (the core runner delegates them here). It fails on a failed row, on
//! an operation it doesn't know, on a row count other than the files' own (and the 6,904 the spec
//! README lists), and on a judgement that can't fail (the first row, changed, must fail).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::ExitCode;

use ducat_words::{CompiledRules, SpelloutRules};
use serde_json::Value;

/// The `words` area's rows, from the spec's README (as the core runner's `CASES_PER_AREA`).
const WORDS_ROWS: usize = 6904;

fn languages() -> BTreeMap<&'static str, SpelloutRules> {
    BTreeMap::from([
        ("en", ducat_words::ENGLISH),
        ("de", ducat_words::GERMAN),
        ("fr", ducat_words::FRENCH),
        ("es", ducat_words::SPANISH),
        ("it", ducat_words::ITALIAN),
        ("nl", ducat_words::DUTCH),
        ("pt", ducat_words::PORTUGUESE),
    ])
}

/// Whether the row's words are what the rules give: `Ok(true)` for a pass.
fn check(rules: &CompiledRules, rule_set: &str, row: &Value) -> Result<bool, String> {
    let number = row["number"].as_str().ok_or("no number")?;
    let value: i128 = number.parse().map_err(|_| format!("bad number {number}"))?;
    let want = row["words"].as_str().ok_or("no words")?;
    let got = rules
        .spell_out(value, Some(rule_set))
        .map_err(|error| format!("{number}: {error}"))?;
    Ok(got == want)
}

/// The whole suite as one test: its counts print with `--nocapture`.
#[test]
fn conformance() -> ExitCode {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../spec/vectors/words");
    let mut paths: Vec<PathBuf> = std::fs::read_dir(&dir)
        .expect("spec/vectors/words")
        .map(|entry| entry.expect("an entry").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    paths.sort();
    let languages = languages();
    let mut compiled: BTreeMap<&str, CompiledRules> = BTreeMap::new();
    let (mut rows_in_files, mut passed, mut failed) = (0, 0, 0);
    let mut errors: Vec<String> = Vec::new();
    let mut mutation_checked = false;

    for path in &paths {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        if doc["area"] != "words" {
            errors.push(format!("{name}: area {} is not words", doc["area"]));
        }
        for table in doc["tables"].as_array().into_iter().flatten() {
            let rows = table["rows"].as_array().map_or(&[][..], Vec::as_slice);
            rows_in_files += rows.len();
            if table["op"] != "words.spellOut" {
                errors.push(format!("{name}: unknown table operation {}", table["op"]));
                failed += rows.len();
                continue;
            }
            let parameters = &table["parameters"];
            let locale = parameters["locale"].as_str().unwrap_or("?");
            let rule_set = parameters["ruleSet"].as_str().unwrap_or("?");
            let Some(rules) = languages.get(locale) else {
                errors.push(format!("{name}: no language {locale}"));
                failed += rows.len();
                continue;
            };
            let key = rules.locale.code();
            if !compiled.contains_key(key) {
                compiled.insert(
                    key,
                    CompiledRules::new(rules).expect("the shipped rules parse"),
                );
            }
            let rules = &compiled[key];
            for row in rows {
                match check(rules, rule_set, row) {
                    Ok(true) => passed += 1,
                    Ok(false) | Err(_) => {
                        failed += 1;
                        let got = check(rules, rule_set, row).err().unwrap_or_default();
                        errors.push(format!(
                            "{name} {locale} {rule_set} {}: wrong words {got}",
                            row["number"]
                        ));
                    }
                }
            }
            // the judgement must be able to fail: a changed expectation is caught
            if !mutation_checked {
                if let Some(first) = rows.first() {
                    let mut changed = first.clone();
                    changed["words"] =
                        Value::String(format!("{}1", first["words"].as_str().unwrap_or("")));
                    if check(rules, rule_set, &changed) != Ok(false) {
                        errors.push(format!("{name}: a changed expectation still passes"));
                    }
                    mutation_checked = true;
                }
            }
        }
    }

    println!("ducat-words conformance ({} files)", paths.len());
    println!(
        "{:<10} {:<26} {:>7} {:>7} {:>7}",
        "area", "operation", "passed", "failed", "skipped"
    );
    println!(
        "{:<10} {:<26} {passed:>7} {failed:>7} {:>7}",
        "words", "words.spellOut", 0
    );
    if rows_in_files != WORDS_ROWS {
        errors.push(format!(
            "the files have {rows_in_files} rows, the README {WORDS_ROWS}"
        ));
    }
    if passed + failed != rows_in_files {
        errors.push(format!("ran {} of {rows_in_files} rows", passed + failed));
    }
    if !mutation_checked {
        errors.push("no row to check the judgement with".into());
    }
    for error in errors.iter().take(40) {
        println!("ERROR {error}");
    }
    if errors.is_empty() {
        println!("words: ok ({passed} rows)");
        ExitCode::SUCCESS
    } else {
        println!("words: {} errors", errors.len());
        ExitCode::FAILURE
    }
}
