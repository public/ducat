#!/usr/bin/env python3
"""Reference vectors for ducat's /format and /parse, from an independent formatter and parser:
a standard-library Python implementation of Unicode TR35's number and currency formatting
(https://www.unicode.org/reports/tr35/tr35-numbers.html: patterns, symbols, numbering systems,
grouping and minimum grouping digits, currency spacing, accounting patterns, currency names with
plural rules from https://www.unicode.org/reports/tr35/tr35-numbers.html#Language_Plural_Rules)
over the CLDR 48 snapshot in data/cldr/, and of the parse rules docs/reference/parse.md documents,
reading the separators, group sizes and currency symbols from the same data. It never runs ducat
or Intl.

ducat formats through the runtime's Intl, whose ICU 78.3 (Node 24, Bun) carries CLDR 48, so when
ducat's TypeScript passes these vectors, two independent implementations of TR35 on the same CLDR
release agree. The rows depend on the runtime's Intl data, and the files say so (runtimeIntl).

    spec/vectors/format/cldr.json          CLDR 48 (every locale but fr-CH)
    spec/vectors/parse/cldr.json
    spec/vectors/format/icu-overrides.json CLDR 48 with ICU 78.3's overrides (fr-CH)
    spec/vectors/parse/icu-overrides.json

checked by test/spec.test.ts and the Rust port's rust/crates/ducat/tests/spec.rs.

Deterministic: regenerate with
    python3 scripts/gen-format-vectors.py
and check that nothing changed with --check.
"""
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ElementTree
from fractions import Fraction

sys.dont_write_bytecode = True  # no __pycache__ in scripts/
from spec_vectors import ISO4217_PUBLISHED, ROOT, file_text, vector_path, write_or_check  # noqa: E402

GENERATOR_VERSION = "1"
CLDR = ROOT / "data" / "cldr"
CLDR_VERSION = "48.0"
MODES = ["halfEven", "halfExpand", "halfTrunc", "halfCeil", "halfFloor", "expand", "trunc", "ceil", "floor"]


class Refused(Exception):
    def __init__(self, kind):
        super().__init__(kind)
        self.kind = kind


# --- data ----------------------------------------------------------------------------------------


def load(relative: str):
    return json.loads((CLDR / relative).read_text())


def iso_exponents() -> dict:
    root = ElementTree.parse(ROOT / "data" / "iso4217-list-one.xml").getroot()
    out = {}
    for entry in root.iter("CcyNtry"):
        code, units = entry.findtext("Ccy"), (entry.findtext("CcyMnrUnts") or "").strip()
        if code is not None and units != "N.A.":
            out[code] = int(units)
    return out


EXPONENT = iso_exponents()
AVAILABLE = set(load("availableLocales.json")["availableLocales"]["full"])
DEFAULT_CONTENT = set(load("defaultContent.json")["defaultContent"])
FOLDERS = {path.name for path in (CLDR / "main").iterdir()}
NUMBERING = load("supplemental/numberingSystems.json")["supplemental"]["numberingSystems"]
PLURALS = load("supplemental/plurals.json")["supplemental"]["plurals-type-cardinal"]


def folder(tag: str) -> str:
    """The cldr-json folder holding a tag's data: the tag itself, or the locale it is the default
    content of (de-DE is de's), with any -u- extension dropped."""
    base = tag.split("-u-")[0]
    while base not in FOLDERS:
        if base not in DEFAULT_CONTENT or "-" not in base:
            raise KeyError(f"no snapshot data for {tag}")
        base = base.rsplit("-", 1)[0]
    return base


def has_data(tag: str) -> bool:
    """Whether CLDR has data for the tag's language and region: an available locale, or default
    content (de-DE). Script subtags aren't used here."""
    base = tag.split("-u-")[0]
    return base in AVAILABLE or base in DEFAULT_CONTENT


def currencies(name: str) -> dict:
    """A locale's currencies: data/cldr/ writes each locale's as what differs from the locale it
    inherits from (its "inherits" field, up to root), so they are merged down the chain."""
    body = load(f"main/{name}/currencies.json")["main"][name]
    out = {} if "inherits" not in body else currencies(body["inherits"])
    out = {code: dict(entry) for code, entry in out.items()}
    for code, entry in body["numbers"]["currencies"].items():
        out[code] = {**out.get(code, {}), **entry}
    return out


class Locale:
    def __init__(self, tag: str):
        name = folder(tag)
        self.folder = name
        self.numbers = load(f"main/{name}/numbers.json")["main"][name]["numbers"]
        self.currencies = currencies(name)
        self.system = self.numbers["defaultNumberingSystem"]
        self.symbols = self.numbers[f"symbols-numberSystem-{self.system}"]
        self.formats = self.numbers[f"currencyFormats-numberSystem-{self.system}"]
        self.decimal_formats = self.numbers[f"decimalFormats-numberSystem-{self.system}"]
        self.digits = NUMBERING[self.system]["_digits"]
        self.minimum_grouping = int(self.numbers["minimumGroupingDigits"])
        self.language = name.split("-")[0]

    def currency_decimal(self) -> str:
        return self.symbols.get("currencyDecimal", self.symbols["decimal"])

    def currency_group(self) -> str:
        return self.symbols.get("currencyGroup", self.symbols["group"])

    def symbol(self, code: str, display: str) -> str:
        entry = self.currencies.get(code, {})
        if display == "code":
            return code
        if display == "narrowSymbol":
            return entry.get("symbol-alt-narrow", entry.get("symbol", code))
        return entry.get("symbol", code)

    def name(self, code: str, category: str) -> str:
        entry = self.currencies.get(code, {})
        return entry.get(f"displayName-count-{category}", entry.get("displayName-count-other", entry.get("displayName", code)))


# ICU's shipped locale data, where it deliberately overrides CLDR (data/icu/README.md): ICU 78.3's
# icu4c/source/data/locales/<locale>.txt at tag release-78.3. Only number symbols are overridden
# among the tags here (fr_CH's group separator), so only those are read.
ICU = ROOT / "data" / "icu"
ICU_VERSION = "78.3"
ICU_SYMBOL = re.compile(r'^\s*(\w+)\{"([^"]*)"\}\s*$')


def icu_symbols(tag: str) -> dict:
    """The number symbols ICU's locale file sets for the tag's numbering systems, or {}."""
    path = ICU / f"{tag.replace('-', '_')}.txt"
    if not path.exists():
        return {}
    out, path_stack = {}, []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        stripped = line.strip()
        if stripped.endswith("{") and not stripped.startswith("//"):
            path_stack.append(stripped[:-1])
        elif stripped == "}":
            path_stack.pop()
        elif len(path_stack) == 4 and path_stack[1] == "NumberElements" and path_stack[3] == "symbols":
            match = ICU_SYMBOL.match(line)
            if match is None:
                raise ValueError(f"{path.name}: {line!r}")
            out.setdefault(path_stack[2], {})[match.group(1)] = match.group(2)
    return out


ICU_TAGS = sorted(path.stem.replace("_", "-") for path in ICU.glob("*.txt"))
# whether locale() applies ICU's overrides: off for the CLDR file, on for the ICU-overrides file
WITH_ICU = {"on": False}
LOCALES = {}


def locale(tag: str) -> Locale:
    key = (tag, WITH_ICU["on"])
    if key not in LOCALES:
        loc = Locale(tag)
        if WITH_ICU["on"]:
            for system, symbols in icu_symbols(tag).items():
                if system == loc.system:
                    loc.symbols = {**loc.symbols, **symbols}
        LOCALES[key] = loc
    return LOCALES[key]


# --- plural rules (TR35 Part 3, Language Plural Rules) --------------------------------------------


def operands(text: str) -> dict:
    """The plural operands of a number as displayed, e.g. "1.00": n 1, i 1, v 2, w 0, f 0, t 0."""
    digits = text.lstrip("-")
    whole, _, fraction = digits.partition(".")
    trimmed = fraction.rstrip("0")
    return {
        "n": abs(Fraction(digits)),
        "i": int(whole),
        "v": len(fraction),
        "w": len(trimmed),
        "f": int(fraction or "0"),
        "t": int(trimmed or "0"),
        "c": 0,
        "e": 0,
    }


RELATION = re.compile(r"^([niftvwce])(?:\s*%\s*(\d+))?\s*(!=|=)\s*([\d.,\s]+)$")


def relation_holds(relation: str, values: dict) -> bool:
    match = RELATION.match(relation.strip())
    if match is None:
        raise ValueError(f"plural relation {relation!r}")
    operand, modulus, operator, ranges = match.groups()
    value = values[operand]
    if modulus is not None:
        value = value % int(modulus)
    found = False
    for item in ranges.split(","):
        low, _, high = item.strip().partition("..")
        low_value = int(low)
        high_value = int(high) if high else low_value
        if value == int(value) and low_value <= value <= high_value:
            found = True
    return found if operator == "=" else not found


def plural_category(language: str, text: str) -> str:
    values = operands(text)
    for key, rule in PLURALS[language].items():
        category = key.removeprefix("pluralRule-count-")
        condition = rule.split("@")[0].strip()
        if category == "other" or condition == "":
            continue
        if any(all(relation_holds(part, values) for part in alternative.split(" and ")) for alternative in condition.split(" or ")):
            return category
    return "other"


# --- formatting (TR35 Part 3, Number Format Patterns) ---------------------------------------------


def round_integer(value: Fraction, mode: str) -> int:
    floor = value.numerator // value.denominator
    rest = value - floor
    if rest == 0:
        return floor
    ceil = floor + 1
    zero, away = (floor, ceil) if value > 0 else (ceil, floor)
    simple = {"floor": floor, "ceil": ceil, "trunc": zero, "expand": away}
    if mode in simple:
        return simple[mode]
    if rest != Fraction(1, 2):
        return floor if rest < Fraction(1, 2) else ceil
    return {"halfEven": floor if floor % 2 == 0 else ceil, "halfExpand": away, "halfTrunc": zero, "halfCeil": ceil, "halfFloor": floor}[mode]


def scaled(units: int, places: int) -> str:
    sign = "-" if units < 0 else ""
    digits = str(abs(units)).rjust(places + 1, "0")
    return sign + (digits if places == 0 else f"{digits[:-places]}.{digits[-places:]}")


def places_of(text: str) -> int:
    return len(text.split(".")[1]) if "." in text else 0


def split_pattern(pattern: str):
    """A pattern's positive and negative subpatterns, each as (prefix, number, suffix). Without a
    negative subpattern the negative is the minus sign before the positive one (TR35)."""
    positive, _, negative = pattern.partition(";")

    def parts(sub: str):
        match = re.match(r"^([^#0-9,.]*)([#0-9,.]+)(.*)$", sub)
        if match is None:
            raise ValueError(f"pattern {pattern!r}")
        return match.groups()

    pos = parts(positive)
    neg = parts(negative) if negative else ("-" + pos[0], pos[1], pos[2])
    return pos, neg


def group_sizes(number_pattern: str):
    """Primary and secondary grouping sizes of "#,##,##0.00" (3, 2) or "#,##0.00" (3, 3)."""
    integer = number_pattern.split(".")[0]
    runs = integer.split(",")
    if len(runs) == 1:
        return None
    primary = len(runs[-1])
    secondary = len(runs[-2]) if len(runs) > 2 else primary
    return primary, secondary


def is_digit(ch: str) -> bool:
    return unicodedata.category(ch) == "Nd"


def currency_matches(ch: str) -> bool:
    """[[:^S:]&[:^Z:]], CLDR's currencyMatch in every locale here: not a symbol, not a separator."""
    return unicodedata.category(ch)[0] not in "SZ"


def number_chars(loc: Locale, digits: str, pattern_number: str, decimal: str, group: str):
    """The number's characters as (type, char): integer and fraction digits in the locale's
    numbering system, group and decimal separators."""
    whole, _, fraction = digits.partition(".")
    sizes = group_sizes(pattern_number)
    out = []
    positions = []
    if sizes is not None and len(whole) >= sizes[0] + loc.minimum_grouping:
        primary, secondary = sizes
        cut = len(whole) - primary
        positions.append(cut)
        while cut > secondary:
            cut -= secondary
            positions.append(cut)
    for index, ch in enumerate(whole):
        if index in positions:
            out.append(("group", group))
        out.append(("integer", loc.digits[int(ch)]))
    if fraction:
        out.append(("decimal", decimal))
        out.extend(("fraction", loc.digits[int(ch)]) for ch in fraction)
    return out


def affix_chars(loc: Locale, affix: str, currency: str):
    out = []
    for ch in affix:
        if ch == "¤":
            out.extend(symbol_chars(currency, "currency"))
        elif ch == "-":
            out.extend(symbol_chars(loc.symbols["minusSign"], "minusSign"))
        elif ch == "+":
            out.extend(symbol_chars(loc.symbols["plusSign"], "plusSign"))
        elif ch == "'":
            continue
        else:
            out.append(("literal", ch))
    return out


def symbol_chars(symbol: str, kind: str):
    """A symbol's characters as parts. TR35 doesn't define parts; here a symbol's bidi marks
    (format characters, such as the RLM ending ar-EG's EGP symbol or the ALM starting its minus
    sign) are literals, and the rest is the symbol's part."""
    return [("literal" if unicodedata.category(ch) == "Cf" else kind, ch) for ch in symbol]


def spaced(loc: Locale, prefix: list, number: list, suffix: list) -> list:
    """TR35 currency spacing: insertBetween where a currency that ends (or starts) with a
    non-symbol, non-separator character touches a digit."""
    spacing = loc.formats["currencySpacing"]
    if prefix and number and prefix[-1][0] == "currency" and currency_matches(prefix[-1][1]) and is_digit(number[0][1]):
        prefix = prefix + [("literal", ch) for ch in spacing["beforeCurrency"]["insertBetween"]]
    if suffix and number and suffix[0][0] == "currency" and currency_matches(suffix[0][1]) and is_digit(number[-1][1]):
        suffix = [("literal", ch) for ch in spacing["afterCurrency"]["insertBetween"]] + suffix
    return prefix + number + suffix


def merge(chars: list) -> list:
    parts = []
    for kind, ch in chars:
        if parts and parts[-1]["type"] == kind:
            parts[-1]["value"] += ch
        else:
            parts.append({"type": kind, "value": ch})
    return parts


def format_parts(amount: str, currency: str, tag: str, options: dict) -> list:
    """The parts of a money amount formatted the way ducat documents: its scale's fraction digits
    (or `digits`, rounded first with `rounding`), currencyDisplay and currencySign."""
    options = dict(options or {})
    digits = options.pop("digits", None)
    rounding = options.pop("rounding", None)
    if rounding is not None and digits is None:
        raise Refused("type")
    if digits is not None and any(key in options for key in ("minimumFractionDigits", "maximumFractionDigits", "minimumSignificantDigits", "maximumSignificantDigits", "roundingIncrement")):
        raise Refused("type")
    display = options.pop("currencyDisplay", "symbol")
    sign = options.pop("currencySign", "standard")
    if options:
        raise ValueError(f"options not modelled: {options}")
    if display not in ("symbol", "narrowSymbol", "code", "name") or sign not in ("standard", "accounting"):
        raise Refused("range")
    value = Fraction(amount)
    if digits is not None:
        amount = scaled(round_integer(value * 10**digits, rounding or "halfExpand"), digits)
        value = Fraction(amount)
    loc = locale(tag)
    negative = value < 0
    text = amount.lstrip("-")
    decimal, group = loc.currency_decimal(), loc.currency_group()
    if display == "name":
        # the plural form of the number as shown, in the decimal pattern; no accounting form
        pos, neg = split_pattern(loc.decimal_formats["standard"])
        prefix, number_pattern, suffix = neg if negative else pos
        number = affix_chars(loc, prefix, "") + number_chars(loc, text, number_pattern, decimal, group) + affix_chars(loc, suffix, "")
        category = plural_category(loc.language, amount)
        name = loc.name(currency, category)
        unit = loc.formats.get(f"unitPattern-count-{category}", loc.formats["unitPattern-count-other"])
        out = []
        for piece in re.split(r"(\{[01]\})", unit):
            if piece == "{0}":
                out.extend(number)
            elif piece == "{1}":
                out.extend(("currency", ch) for ch in name)
            else:
                out.extend(("literal", ch) for ch in piece)
        return merge(out)
    pos, neg = split_pattern(loc.formats[sign])
    prefix, number_pattern, suffix = neg if negative else pos
    symbol = loc.symbol(currency, display)
    return merge(spaced(loc, affix_chars(loc, prefix, symbol), number_chars(loc, text, number_pattern, decimal, group), affix_chars(loc, suffix, symbol)))


# --- parsing (docs/reference/parse.md) -------------------------------------------------------------

# the decimal digit blocks parse reads: ASCII, Arabic-Indic, Persian, Devanagari, Thai
DIGIT_ZEROS = [0x30, 0x660, 0x6F0, 0x966, 0xE50]


def digit_value(ch: str) -> int:
    code = ord(ch)
    for zero in DIGIT_ZEROS:
        if zero <= code <= zero + 9:
            return code - zero
    return -1


def affix_allowed(ch: str) -> bool:
    category = unicodedata.category(ch)
    return category[0] in "LZ" or category in ("Sc", "Cf") or ch.isspace() or ch in ".()+-−"


def is_space(ch: str) -> bool:
    return ch.isspace() or unicodedata.category(ch)[0] == "Z"


def separators(tag: str):
    loc = locale(tag)
    return loc.currency_decimal(), loc.currency_group()


def locale_group_sizes(tag: str) -> list:
    loc = locale(tag)
    sizes = []
    for sign in ("standard", "accounting"):
        found = group_sizes(split_pattern(loc.formats[sign])[0][1]) or (3, 3)
        if found not in sizes:
            sizes.append(found)
    return sizes


def runs_fit(runs: list, sizes: list) -> bool:
    """Digit runs between group separators fit a size: a first run of 1 to secondary digits,
    middle runs of secondary, a last run of primary."""
    for primary, secondary in sizes:
        if runs[-1] == primary and 1 <= runs[0] <= secondary and all(run == secondary for run in runs[1:-1]):
            return True
    return False


def money_at(text: str, currency: str, options: dict) -> str:
    """money(text, currency, options): the ISO exponent (or options.scale), rounding refused
    unless options.rounding is given."""
    scale = options.get("scale", EXPONENT[currency])
    value = Fraction(text)
    units = value * 10**scale
    if units.denominator != 1 and "rounding" not in options:
        raise Refused("rounding")
    return scaled(round_integer(units, options.get("rounding", "halfExpand")), scale)


def parse_number(text: str, currency: str, tag: str, options: dict) -> str:
    if not has_data(tag):
        raise Refused("range")
    decimal, group = separators(tag)
    chars = list(text)
    digit_at = [i for i, ch in enumerate(chars) if digit_value(ch) >= 0]
    if not digit_at:
        raise Refused("syntax")
    first, last = digit_at[0], digit_at[-1]
    prefix, suffix = "".join(chars[:first]), "".join(chars[last + 1 :])
    affix = prefix + suffix
    if not all(affix_allowed(ch) for ch in affix):
        raise Refused("syntax")
    negative = any(ch in "-−(" for ch in affix)

    def is_group(ch: str) -> bool:
        return ch == group or (is_space(group) and is_space(ch)) or (group in "'’" and ch in "'’") or ch == "٬"

    out = "0." if prefix.endswith(decimal) else ""
    seen_decimal = out != ""
    runs, run, in_fraction = [], 0, seen_decimal
    for ch in chars[first : last + 1]:
        value = digit_value(ch)
        if value >= 0:
            out += str(value)
            run += 1
        elif ch == decimal or ch == "٫":
            if seen_decimal:
                raise Refused("syntax")
            seen_decimal = True
            out += "."
            runs.append(run)
            in_fraction = True
        elif is_group(ch):
            if seen_decimal:
                raise Refused("syntax")
            runs.append(run)
            run = 0
        else:
            raise Refused("syntax")
    if not in_fraction:
        runs.append(run)
    if len(runs) > 1 and not options.get("lenient", False) and not runs_fit(runs, locale_group_sizes(tag)):
        raise Refused("syntax")
    money_options = {key: value for key, value in options.items() if key != "lenient"}
    return money_at(("-" if negative else "") + out, currency, money_options)


def normalized(text: str) -> str:
    return "".join(ch for ch in text if not (is_space(ch) or unicodedata.category(ch) == "Cf"))


CANDIDATES = sorted(EXPONENT)
SYMBOL_TABLES = {}


def symbol_table(tag: str) -> dict:
    # currency symbols don't depend on ICU's overrides (number symbols only)
    if tag not in SYMBOL_TABLES:
        loc = locale(tag)
        table = {}
        for code in CANDIDATES:
            for display in ("symbol", "narrowSymbol"):
                symbol = normalized(loc.symbol(code, display))
                if symbol != code:
                    table.setdefault(symbol, set()).add(code)
        SYMBOL_TABLES[tag] = table
    return SYMBOL_TABLES[tag]


def meanings(piece: str, tag: str, options: dict) -> list:
    candidates = options.get("currencies")
    allowed = (lambda code: code in EXPONENT) if candidates is None else (lambda code: code in candidates)
    if re.fullmatch(r"[A-Z]{3}", piece) and allowed(piece):
        return [piece]
    for symbol, code in (options.get("symbols") or {}).items():
        if normalized(symbol) == piece:
            return [code]
    for source in (tag, "en", "en-CA"):
        found = sorted(code for code in symbol_table(source).get(piece, ()) if allowed(code))
        if found:
            return found
    return []


def parse_money(text: str, tag: str, options: dict) -> dict:
    if not has_data(tag):
        raise Refused("range")
    hint = options.get("hint")
    lenient = options.get("lenient", False)
    chars = list(text)
    digit_at = [i for i, ch in enumerate(chars) if digit_value(ch) >= 0]
    if not digit_at:
        raise Refused("syntax")
    first, last = digit_at[0], digit_at[-1]

    def separator(piece: str) -> bool:
        return piece == "" or piece in (".", ",", "٫")

    pieces = []
    for side in ("".join(chars[:first]), "".join(chars[last + 1 :])):
        for run in re.split(r"[()+\-−]+", side):
            whole = normalized(run)
            if separator(whole):
                continue
            if meanings(whole, tag, options):
                pieces.append(whole)
            else:
                pieces.extend(piece for piece in re.split(r"[\s   -‏ -‮ -⁤　﻿]+", run) if not separator(piece))
    detected = None
    for piece in pieces:
        found = meanings(piece, tag, options)
        if len(found) == 1:
            currency = found[0]
        elif hint is not None and hint in found:
            currency = hint
        else:
            raise Refused("syntax")
        if detected is not None and detected != currency:
            raise Refused("syntax")
        detected = currency
    if detected is None:
        if hint is None or not lenient:
            raise Refused("syntax")
        detected = hint
    elif hint is not None and detected != hint:
        raise Refused("syntax")
    number_options = {key: value for key, value in options.items() if key in ("scale", "rounding", "lenient")}
    return {"amount": parse_number(text, detected, tag, number_options), "currency": detected}


# --- rows ----------------------------------------------------------------------------------------

BCP47 = re.compile(r"^[a-zA-Z]{2,3}(-[a-zA-Z]{4})?(-([a-zA-Z]{2}|\d{3}))?(-u(-[a-zA-Z0-9]{2,8})+)?$")

# The locales the format and parse documentation and tests use, with each one's own currency
LOCAL_CURRENCY = {
    "en": "USD", "en-US": "USD", "en-GB": "GBP", "en-IN": "INR", "en-CA": "CAD", "en-IE": "EUR",
    "en-AU": "AUD", "en-NZ": "NZD", "de": "EUR", "de-DE": "EUR", "de-CH": "CHF", "de-AT": "EUR",
    "fr": "EUR", "fr-FR": "EUR", "fr-CH": "CHF", "fr-SN": "XOF", "fr-CM": "XAF", "fr-CI": "XOF",
    "fr-CA": "CAD", "es": "EUR", "es-MX": "MXN", "it": "EUR", "nl": "EUR", "pt": "BRL",
    "pt-BR": "BRL", "ja": "JPY", "ja-JP": "JPY", "ar-EG": "EGP", "ar-KW": "KWD", "th-TH": "THB",
    "sw-KE": "KES", "sv-SE": "SEK", "ru-RU": "RUB", "hi-IN": "INR", "fa-IR": "IRR", "da-DK": "DKK",
}
TAGS = list(LOCAL_CURRENCY)
OTHER_CURRENCIES = ["EUR", "USD", "JPY", "KWD"]
# amounts in minor units: zero, small, a thousand with a fraction, millions, and above 10^15
# minor units, where ducat hands Intl a decimal string instead of a double
UNITS = [0, 5, -100, 123450, -1234567, 123456789012, 1234567890123456789]
VARIANT_UNITS = [100, -123450]
DISPLAYS = ["symbol", "narrowSymbol", "code", "name"]
SIGNS = ["standard", "accounting"]


def attempt(row: dict, fields: list, run) -> dict:
    try:
        values = run()
        row.update(dict(zip(fields, values)))
        row["error"] = None
    except Refused as refused:
        row.update({field: None for field in fields})
        row["error"] = refused.kind
    return row


def format_row(amount: str, currency: str, tag: str, options=None) -> dict:
    row = {"amount": amount, "currency": currency, "locale": tag}
    if options:
        row["options"] = options

    def run():
        if not BCP47.match(tag):
            raise Refused("range")
        parts = format_parts(amount, currency, tag, options)
        return "".join(part["value"] for part in parts), parts

    return attempt(row, ["text", "parts"], run)


def format_rows(tags: list, general: bool) -> list:
    """Rows for each tag, and with `general` the rows that test options and values in fixed
    locales."""
    rows = []
    for tag in tags:
        currencies = list(dict.fromkeys([LOCAL_CURRENCY[tag], *OTHER_CURRENCIES]))
        for currency in currencies:
            for units in UNITS:
                rows.append(format_row(scaled(units, EXPONENT[currency]), currency, tag))
        for currency in dict.fromkeys([LOCAL_CURRENCY[tag], "USD"]):
            for display in DISPLAYS:
                for sign in SIGNS:
                    if (display, sign) == ("symbol", "standard"):
                        continue
                    options = {"currencyDisplay": display} if display != "symbol" else {}
                    if sign != "standard":
                        options["currencySign"] = sign
                    for units in VARIANT_UNITS:
                        rows.append(format_row(scaled(units, EXPONENT[currency]), currency, tag, options))
    if not general:
        return rows
    # currency names in each plural form: whole numbers shown without fraction digits, and the
    # same numbers with them (1.00 is "other" in English)
    for tag in ["en", "fr", "pt-BR", "ru-RU", "ar-EG", "sw-KE", "ja", "de-DE", "hi-IN"]:
        currency = LOCAL_CURRENCY[tag]
        for whole in [0, 1, 2, 3, 5, 11, 21, 100, 1000000]:
            amount = scaled(whole * 10 ** EXPONENT[currency], EXPONENT[currency])
            rows.append(format_row(amount, currency, tag, {"currencyDisplay": "name", "digits": 0}))
            rows.append(format_row(amount, currency, tag, {"currencyDisplay": "name"}))
        rows.append(format_row(scaled(15, 1), currency, tag, {"currencyDisplay": "name", "digits": 1}))
    # digits and rounding: once, exactly, in every mode, padding, and amounts that round to zero
    for amount, scale, digits in [("1.005", 3, 2), ("-1.005", 3, 2), ("2.5", 1, 0), ("-2.5", 1, 0), ("0.123456", 6, 4), ("-0.004", 3, 2), ("0.004", 3, 2), ("12.3", 1, 4), ("9999999999999999.995", 3, 2)]:
        for mode in MODES:
            for tag in ["en", "de-DE"]:
                rows.append(format_row(amount, "EUR", tag, {"digits": digits, "rounding": mode}))
    for tag in ["en", "de-DE", "ar-EG", "en-IN"]:
        rows.append(format_row("1.005", "EUR", tag, {"digits": 2}))
        rows.append(format_row("12.3", "EUR", tag, {"digits": 4}))
        rows.append(format_row("1234.5", "JPY", tag, {"digits": 0}))
        rows.append(format_row("-1234.5678", "KWD", tag, {"digits": 3, "currencySign": "accounting"}))
    # scales beyond the currency's, and past the 15 digits a double holds
    for tag in ["en", "de-DE", "fr", "ar-EG", "en-IN", "fa-IR"]:
        for amount in ["0.000001", "-0.123456789012345678", "123456789.123456789012", "12345678901234567.89", "-9007199254740993.00", "0.00"]:
            rows.append(format_row(amount, "EUR", tag))
    # what format refuses: Intl's digit options beside digits, rounding without digits, an
    # invalid display or a malformed tag
    for options in [{"digits": 2, "maximumFractionDigits": 3}, {"digits": 2, "minimumFractionDigits": 1}, {"digits": 2, "maximumSignificantDigits": 3}, {"digits": 2, "roundingIncrement": 5}, {"rounding": "halfEven"}, {"currencyDisplay": "symbols"}, {"currencySign": "negative"}]:
        rows.append(format_row("1.00", "EUR", "en", options))
    for tag in ["en_US", "e", "en-US-", "123"]:
        rows.append(format_row("1.00", "EUR", tag))
    return rows


def parse_row(text: str, currency: str, tag: str, options=None) -> dict:
    row = {"input": text, "currency": currency, "locale": tag}
    if options:
        row["options"] = options
    return attempt(row, ["amount"], lambda: [parse_number(text, currency, tag, options or {})])


def parse_money_row(text: str, tag: str, options=None) -> dict:
    row = {"input": text, "locale": tag}
    if options:
        row["options"] = options
    return attempt(row, ["money"], lambda: [parse_money(text, tag, options or {})])


def text_of(amount: str, currency: str, tag: str, options=None) -> str:
    return "".join(part["value"] for part in format_parts(amount, currency, tag, options))


def parse_rows(tags: list, general: bool):
    parse, money = [], []
    # what format writes reads back, in every locale, display and sign
    for tag in tags:
        for currency in dict.fromkeys([LOCAL_CURRENCY[tag], "EUR", "USD", "JPY"]):
            exponent = EXPONENT[currency]
            for units in [0, 5, -100, 123450, -1234567, 123456789012]:
                amount = scaled(units, exponent)
                for options in [None, {"currencyDisplay": "code"}, {"currencySign": "accounting"}, {"currencyDisplay": "narrowSymbol"}]:
                    if options is not None and units not in (-1234567, 123450):
                        continue
                    text = text_of(amount, currency, tag, options)
                    parse.append(parse_row(text, currency, tag))
                    money.append(parse_money_row(text, tag))
                    if options is None and units == -1234567:
                        money.append(parse_money_row(text, tag, {"hint": currency}))
    if not general:
        # ICU's Swiss apostrophe in both forms, and CLDR's narrow no-break space, which it replaces
        for text in ["CHF 1'234.50", "1'234.50 CHF", "1’234.50 CHF", "1\u202f234.50 CHF", "1'234,50 CHF", "12'34.50 CHF"]:
            parse.append(parse_row(text, "CHF", "fr-CH"))
            money.append(parse_money_row(text, "fr-CH"))
        return parse, money
    # the documentation's examples, and each acceptance and refusal rule
    nbsp, nnbsp = " ", " "
    for text, currency, tag, options in [
        ("1.234,50 €", "EUR", "de-DE", None),
        ("78.00", "EUR", "de-DE", None),
        ("78.00", "EUR", "de-DE", {"lenient": True}),
        ("1.5", "EUR", "de-DE", None),
        ("1.5", "EUR", "de-DE", {"lenient": True}),
        ("(12.50)", "USD", "en-US", None),
        ("CHF 1’234.50", "CHF", "de-CH", None),
        ("CHF 1'234.50", "CHF", "de-CH", None),
        ("1,23,456.78", "INR", "en-IN", None),
        ("123,456.78", "INR", "en-IN", None),
        ("12,34,567.00", "INR", "en", None),
        ("1,234,567.00", "USD", "en", None),
        ("1,2345.00", "USD", "en", None),
        ("12,345,67.00", "USD", "en", None),
        ("1,234.56", "USD", "en", None),
        ("1234.56", "USD", "en", None),
        (f"1{nbsp}234,56 €", "EUR", "fr-FR", None),
        (f"1{nnbsp}234,56 €", "EUR", "fr-FR", None),
        ("1 234,56 €", "EUR", "fr-FR", None),
        ("١٢٣٫٤٥ US$", "USD", "ar-EG", None),
        ("١٬٢٣٤٫٥٠ ج.م.‏", "EGP", "ar-EG", None),
        ("۱۲۳٫۴۵", "IRR", "fa-IR", None),
        ("१२३.४५", "INR", "hi-IN", None),
        ("๑๒๓.๔๕", "THB", "th-TH", None),
        ("-12.50", "USD", "en", None),
        ("−12.50", "USD", "en", None),
        ("12.50-", "USD", "en", None),
        ("+12.50", "USD", "en", None),
        (".50", "USD", "en", None),
        (",50 €", "EUR", "de-DE", None),
        ("abc", "USD", "en", None),
        ("", "USD", "en", None),
        ("about 100 USD", "USD", "en", None),
        ("100 USD!", "USD", "en", None),
        ("#100", "USD", "en", None),
        ("1.2.3", "USD", "en", None),
        ("1,234.5,6", "USD", "en", None),
        ("12x34", "USD", "en", None),
        ("1.234", "USD", "en", None),
        ("1.234", "USD", "en", {"rounding": "halfEven"}),
        ("1.235", "USD", "en", {"rounding": "halfEven"}),
        ("1.5", "USD", "en", {"scale": 4}),
        ("1.23456", "USD", "en", {"scale": 4}),
        ("1.23456", "USD", "en", {"scale": 4, "rounding": "floor"}),
        ("12", "JPY", "ja-JP", None),
        ("12.5", "JPY", "ja-JP", None),
        ("1.500", "KWD", "ar-KW", None),
        ("1,50", "EUR", "de-XX", None),
        ("1.50", "USD", "en-ZZ", None),
        ("1.50", "USD", "xx-YY", None),
        ("1,50", "EUR", "de", None),
    ]:
        parse.append(parse_row(text, currency, tag, options))
    for text, tag, options in [
        ("CHF 1’234.50", "de-CH", None),
        ("1.234,50 €", "de-DE", None),
        ("$5.00", "en-CA", None),
        ("$5.00", "en-CA", {"hint": "CAD"}),
        ("$5.00", "en-CA", {"hint": "USD"}),
        ("$5.00", "en-CA", {"symbols": {"$": "CAD"}}),
        ("12.34", "en", {"hint": "EUR", "lenient": True}),
        ("12.34", "en", {"hint": "EUR"}),
        ("12.34", "en", None),
        ("US$5", "en", None),
        ("CA$5", "en", None),
        ("A$5", "en", None),
        ("US$5", "de-DE", None),
        ("5 £", "en-GB", None),
        ("£5", "en-GB", {"hint": "GBP"}),
        ("¥5", "ja-JP", None),
        ("¥5", "ja-JP", {"hint": "JPY"}),
        ("￥5", "ja-JP", None),
        ("5 kr", "sv-SE", None),
        ("5 kr", "sv-SE", {"hint": "SEK"}),
        ("USD 5", "en", None),
        ("usd 5", "en", None),
        ("USD 5", "en", {"currencies": ["EUR"]}),
        ("EUR 5", "en", {"currencies": ["EUR"]}),
        ("EUR €5", "en", None),
        ("EUR $5", "en", {"hint": "USD"}),
        ("USD 5 EUR", "en", None),
        ("USD 5", "en", {"hint": "EUR"}),
        ("about 100 USD", "en", None),
        ("XTS 5", "en", None),
        ("F CFA 5", "fr-SN", None),
        ("5 F CFA", "fr-SN", None),
        ("5 FCFA", "fr-SN", None),
        ("5 F CFA", "fr-SN", {"symbols": {"F CFA": "XOF"}}),
        ("(USD 5.00)", "en", None),
        ("-€5.00", "en", None),
        ("€-5.00", "nl", None),
        ("1,234,567 USD", "en-IN", None),
        ("12,34,567 USD", "en-IN", None),
        ("1,2,3 USD", "en", {"lenient": True}),
        ("1,2,3 USD", "en", None),
        ("USD .50", "en", None),
        ("USD 5", "en-ZZ", None),
        ("€5", "xx-YY", None),
        ("€5", "de-XX", None),
        ("USD 1.234", "en", None),
        ("USD 1.234", "en", {"rounding": "halfExpand"}),
        ("USD 1.5", "en", {"scale": 3}),
    ]:
        money.append(parse_money_row(text, tag, options))
    return parse, money


FR_CH_EVIDENCE = (
    "fr-CH is left out: CLDR 48's common/main/fr_CH.xml (unicode-org/cldr, tag release-48, lines 215-217) sets only currencyDecimal \".\" for latn, "
    "so its group separator is inherited from fr, U+202F, while ICU 78.3's icu4c/source/data/locales/fr_CH.txt (unicode-org/icu, tag release-78.3, lines 10-13, "
    "sha256 ffb73f672e4bb219dbbdeacf25d98bfafc1f30f85003dc90725556f5cc7b2ef8, copied to data/icu/fr_CH.txt) sets symbols{ currencyDecimal{\".\"} group{\"'\"} }. "
    "fr-CH's rows are in the icu-overrides files instead."
)
PARTS_RULE = (
    "TR35 doesn't define formatToParts: here the number's digits, separators and signs are the integer, group, decimal, fraction and minusSign parts, the symbol or name is the currency part, "
    "bidi marks (format characters) in a symbol are literals, and every other pattern character, including currency spacing, is a literal; adjacent characters of one type merge. "
    "That convention, and how a currency name is shown (the number in the decimal pattern with the currency's separators, never in the accounting form, then unitPattern with the name in the number's plural form), "
    "were settled after looking at ICU's output, so agreement on them is not independent evidence; the text of every other row is."
)


def main() -> None:
    method = (
        "Unicode TR35's number and currency formatting (https://www.unicode.org/reports/tr35/tr35-numbers.html) and the parse rules of docs/reference/parse.md, "
        "implemented with Python's standard library over the CLDR 48.0 JSON snapshot in data/cldr/ (data/cldr/README.md), independently of ducat's TypeScript and of ICU. "
        "ducat formats and parses through the runtime's Intl, whose ICU 78.3 carries CLDR 48, so passing these vectors means two independent implementations agree on the same CLDR release. "
        + PARTS_RULE + " " + FR_CH_EVIDENCE
    )
    icu_method = (
        "The same formatter and parser as the cldr files (scripts/gen-format-vectors.py), with the number symbols ICU 78.3's shipped locale data sets where it deliberately overrides CLDR 48 applied on top: "
        "icu4c/source/data/locales/<locale>.txt at tag release-78.3 of unicode-org/icu, copied to data/icu/ (data/icu/README.md). "
        "A survey of ICU 78.3's symbols, number patterns and currency patterns against CLDR 48 for every locale tag here and its parent chain found one override: "
        "fr_CH.txt (lines 10-13) sets group \"'\", where CLDR 48's fr_CH.xml (tag release-48, lines 215-217) inherits fr's U+202F. "
        + PARTS_RULE
    )
    runtime = "every row: ducat formats and parses with the runtime's Intl (ICU 78.3, CLDR 48 on Node 24 and Bun); an engine with other CLDR data writes other text"
    # the build these rows were checked on: there a canary mismatch fails; elsewhere it skips the locale
    reference = "Node 24 (ICU 78.3, CLDR 48.0)"
    provenance = {"source": "cldr", "generator": {"name": "scripts/gen-format-vectors.py", "version": GENERATOR_VERSION}, "method": method, "data": {"cldr": CLDR_VERSION, "iso4217": ISO4217_PUBLISHED, "runtimeIntl": runtime, "referenceRuntime": reference}}
    icu_provenance = {
        "source": "cldr",
        "generator": {"name": "scripts/gen-format-vectors.py", "version": GENERATOR_VERSION},
        "method": icu_method,
        "data": {"cldr": CLDR_VERSION, "icu": ICU_VERSION, "iso4217": ISO4217_PUBLISHED, "runtimeIntl": runtime + "; these rows also need ICU's own locale data, which overrides CLDR's", "referenceRuntime": reference},
    }
    tags = [tag for tag in TAGS if tag not in ICU_TAGS]
    parse, money = parse_rows(tags, True)
    format_cldr = format_rows(tags, True)
    WITH_ICU["on"] = True
    icu_parse, icu_money = parse_rows(ICU_TAGS, False)
    format_icu = format_rows(ICU_TAGS, False)
    texts = {
        vector_path("format", "cldr"): file_text(
            "format",
            "cldr",
            "Money formatted as currency in the locales the documentation and tests use: every display (symbol, narrow symbol, code, name) and sign (standard, accounting), digits and rounding, amounts beyond a double's digits, and the options format refuses; the text and its parts.",
            provenance,
            [{"op": "format.money", "rows": format_cldr}],
        ),
        vector_path("parse", "cldr"): file_text(
            "parse",
            "cldr",
            "Amounts read back from the text format writes in every locale, display and sign, and each documented acceptance and refusal rule: separators and group positions, lenient, digits of other scripts, signs, scale and rounding, currency detection from codes and symbols, hints and the locales without data.",
            provenance,
            [{"op": "parse.money", "rows": parse}, {"op": "parse.detect", "rows": money}],
        ),
        vector_path("format", "icu-overrides"): file_text(
            "format",
            "icu-overrides",
            "Money formatted as currency in the locales where ICU's shipped data overrides CLDR's (fr-CH's group separator), every display and sign; the text and its parts.",
            icu_provenance,
            [{"op": "format.money", "rows": format_icu}],
        ),
        vector_path("parse", "icu-overrides"): file_text(
            "parse",
            "icu-overrides",
            "Amounts read back from what format writes in the locales where ICU's shipped data overrides CLDR's (fr-CH), and that locale's separators read both ways.",
            icu_provenance,
            [{"op": "parse.money", "rows": icu_parse}, {"op": "parse.detect", "rows": icu_money}],
        ),
    }
    write_or_check(texts, "python3 scripts/gen-format-vectors.py")


if __name__ == "__main__":
    main()
