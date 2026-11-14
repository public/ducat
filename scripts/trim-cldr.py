#!/usr/bin/env python3
"""Builds data/cldr/, the trimmed CLDR snapshot the format and parse oracle reads
(scripts/gen-format-vectors.py), from the cldr-json release archive:

    curl -L -A curl/8 -o cldr-48.0.0-json-full.zip \\
      https://github.com/unicode-org/cldr-json/releases/download/48.0.0/cldr-48.0.0-json-full.zip
    python3 scripts/trim-cldr.py cldr-48.0.0-json-full.zip

It checks the archive's sha256 against data/cldr/README.md's, then keeps only what ducat's
/format and /parse need, for the locales their documentation and tests use:

- each locale's numbers.json (its numbering systems' symbols and the standard decimal and
  currency patterns) and currencies.json (every currency's symbols and names);
- the supplemental plural and ordinal rules and numbering-system digits, for those languages;
- cldr-core's list of available locales and default-content locales, which decide which tags
  have data (de-DE is de's default content; de-XX has none);
- the en, de, fr, es, it, nl and pt list patterns, for ducat-words' word for "and";
- the Unicode License v3 the data is under.

cldr-json's main/ files are already resolved (en-IN's carries everything it inherits), so no
parent locales are needed. Standard library only; the output is deterministic, so running it
again on the same archive changes nothing.
"""
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "cldr"

# The locales the format and parse documentation, tests and vectors use, as cldr-json folders.
# Tags such as en-US, de-DE or ja-JP are their language's default content and have no folder.
LOCALES = [
    "ar-EG", "ar-KW", "da", "de", "de-AT", "de-CH", "en", "en-AU", "en-CA", "en-GB", "en-IE",
    "en-IN", "en-NZ", "es", "es-MX", "fa", "fr", "fr-CA", "fr-CH", "fr-CI", "fr-CM", "fr-SN", "hi",
    "it", "ja", "nl", "pt", "ru", "sv", "sw-KE", "th",
]
# ducat-words' languages (data/rbnf/): their list patterns give the word for "and"
LIST_LOCALES = ["de", "en", "es", "fr", "it", "nl", "pt"]

# numbers.json: what a currency format reads (TR35 Part 3, Numbers)
NUMBER_KEYS = re.compile(r"^(defaultNumberingSystem|otherNumberingSystems|minimumGroupingDigits|symbols-numberSystem-.+|decimalFormats-numberSystem-.+|currencyFormats-numberSystem-.+)$")
# within a decimal or currency formats block: the standard patterns, not compact or long forms
FORMAT_KEYS = re.compile(r"^(standard|standard-alphaNextToNumber|standard-noCurrency|accounting|accounting-alphaNextToNumber|accounting-noCurrency|currencySpacing|currencyPatternAppendISO|unitPattern-count-.+)$")
CURRENCY_KEYS = re.compile(r"^(displayName|displayName-count-.+|symbol|symbol-alt-narrow)$")


def archive_sha256() -> str:
    match = re.search(r"sha256 `([0-9a-f]{64})`", (OUT / "README.md").read_text())
    if match is None:
        sys.exit("data/cldr/README.md records no sha256")
    return match.group(1)


def read(archive: zipfile.ZipFile, name: str):
    return json.loads(archive.read(name))


def write(relative: str, value) -> None:
    path = OUT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=1) + "\n")


def used_systems(numbers: dict) -> list:
    systems = {"latn", numbers["defaultNumberingSystem"]}
    return sorted(systems)


def trim_numbers(numbers: dict) -> dict:
    systems = used_systems(numbers)
    out = {}
    for key, value in numbers.items():
        if not NUMBER_KEYS.match(key):
            continue
        system = key.rsplit("-numberSystem-", 1)[1] if "-numberSystem-" in key else None
        if system is not None and system not in systems:
            continue
        if isinstance(value, dict) and key.startswith(("decimalFormats", "currencyFormats")):
            value = {name: part for name, part in value.items() if FORMAT_KEYS.match(name)}
        out[key] = value
    return out


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python3 scripts/trim-cldr.py cldr-48.0.0-json-full.zip")
    zip_path = Path(sys.argv[1])
    digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    if digest != archive_sha256():
        sys.exit(f"{zip_path}: sha256 {digest}, not the one data/cldr/README.md records")
    with zipfile.ZipFile(zip_path) as archive:
        languages = sorted({locale.split("-")[0] for locale in LOCALES})
        systems = set()
        for locale in LOCALES:
            numbers = read(archive, f"cldr-numbers-full/main/{locale}/numbers.json")
            body = numbers["main"][locale]
            trimmed = trim_numbers(body["numbers"])
            systems.update(used_systems(body["numbers"]))
            write(f"main/{locale}/numbers.json", {"main": {locale: {"identity": body["identity"], "numbers": trimmed}}})
            currencies = read(archive, f"cldr-numbers-full/main/{locale}/currencies.json")
            body = currencies["main"][locale]
            names = {
                code: {key: value for key, value in entry.items() if CURRENCY_KEYS.match(key)}
                for code, entry in body["numbers"]["currencies"].items()
            }
            write(f"main/{locale}/currencies.json", {"main": {locale: {"identity": body["identity"], "numbers": {"currencies": names}}}})
        for locale in LIST_LOCALES:
            lists = read(archive, f"cldr-misc-full/main/{locale}/listPatterns.json")
            body = lists["main"][locale]
            write(f"main/{locale}/listPatterns.json", {"main": {locale: body}})
        for name, key in (("plurals", "plurals-type-cardinal"), ("ordinals", "plurals-type-ordinal")):
            data = read(archive, f"cldr-core/supplemental/{name}.json")["supplemental"]
            rules = {language: data[key][language] for language in languages}
            write(f"supplemental/{name}.json", {"supplemental": {"version": data["version"], key: rules}})
        data = read(archive, "cldr-core/supplemental/numberingSystems.json")["supplemental"]
        kept = {system: data["numberingSystems"][system] for system in sorted(systems)}
        write("supplemental/numberingSystems.json", {"supplemental": {"version": data["version"], "numberingSystems": kept}})
        available = read(archive, "cldr-core/availableLocales.json")["availableLocales"]["full"]
        write("availableLocales.json", {"availableLocales": {"full": available}})
        write("defaultContent.json", read(archive, "cldr-core/defaultContent.json"))
        (OUT / "LICENSE").write_bytes(archive.read("cldr-core/LICENSE"))
    print(f"wrote {OUT.relative_to(ROOT)}/ from {zip_path.name}")


if __name__ == "__main__":
    main()
