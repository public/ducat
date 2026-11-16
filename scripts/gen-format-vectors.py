#!/usr/bin/env python3
"""Reference vectors for ducat's /format and /parse, from an independent formatter and parser:
a standard-library Python implementation of Unicode TR35's number and currency formatting
(https://www.unicode.org/reports/tr35/tr35-numbers.html: patterns, symbols, numbering systems,
grouping and minimum grouping digits, currency spacing, accounting patterns, currency names with
plural rules from https://www.unicode.org/reports/tr35/tr35-numbers.html#Language_Plural_Rules),
with the Intl.NumberFormat options ducat passes on read as ECMA-402 defines them
(https://tc39.es/ecma402/#sec-setnfdigitoptions: signDisplay, useGrouping, minimumIntegerDigits,
fraction and significant digits, roundingIncrement, roundingMode, roundingPriority and
trailingZeroDisplay), over the CLDR 48 snapshot in data/cldr/, and of the parse rules docs/reference/parse.md documents,
reading the separators, group sizes and currency symbols from the same data. It never runs ducat
or Intl.

ducat formats through the runtime's Intl, whose ICU 78.3 (Node 24, Bun) carries CLDR 48, so when
ducat's TypeScript passes these vectors, two independent implementations of TR35 on the same CLDR
release agree. The rows depend on the runtime's Intl data, and the files say so (runtimeIntl).

    spec/vectors/format/cldr.json          CLDR 48 (every locale but fr-CH)
    spec/vectors/parse/cldr.json
    spec/vectors/format/icu-overrides.json CLDR 48 with ICU 78.3's overrides (fr-CH)
    spec/vectors/parse/icu-overrides.json

checked by test/spec.test.ts and the Rust port's rust/crates/ducat/tests/it/spec.rs.

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

GENERATOR_VERSION = "2"
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
    def __init__(self, tag: str, system=None):
        """A locale's data in a numbering system (its default without one). A numbering system the
        locale has no data for takes latn's symbols and patterns with its own digits (TR35)."""
        name = folder(tag)
        self.folder = name
        self.numbers = load(f"main/{name}/numbers.json")["main"][name]["numbers"]
        self.currencies = currencies(name)
        self.system = system or self.numbers["defaultNumberingSystem"]

        def block(kind: str) -> dict:
            return self.numbers.get(f"{kind}-numberSystem-{self.system}", self.numbers[f"{kind}-numberSystem-latn"])

        self.symbols = block("symbols")
        self.formats = block("currencyFormats")
        self.decimal_formats = block("decimalFormats")
        self.digits = NUMBERING[self.system]["_digits"]
        self.minimum_grouping = int(self.numbers["minimumGroupingDigits"])
        self.language = name.split("-")[0]

    def compact_patterns(self, kind: str, length: str) -> dict:
        """The compact patterns ({"1000-count-one": "0K", ...}) of a decimalFormats or
        currencyFormats block: the numbering system's, else latn's, as ICU falls back."""
        inner = "decimalFormat" if kind == "decimalFormats" else "standard"
        own = self.numbers.get(f"{kind}-numberSystem-{self.system}", {}).get(length, {}).get(inner)
        latn = self.numbers[f"{kind}-numberSystem-latn"].get(length, {}).get(inner)
        return own if own is not None else (latn or {})

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


def locale(tag: str, system=None) -> Locale:
    key = (tag, system, WITH_ICU["on"])
    if key not in LOCALES:
        loc = Locale(tag, system)
        if WITH_ICU["on"]:
            for system, symbols in icu_symbols(tag).items():
                if system == loc.system:
                    loc.symbols = {**loc.symbols, **symbols}
        LOCALES[key] = loc
    return LOCALES[key]


# --- plural rules (TR35 Part 3, Language Plural Rules) --------------------------------------------


def operands(text: str, exponent: int = 0) -> dict:
    """The plural operands of a number as displayed, e.g. "1.00": n 1, i 1, v 2, w 0, f 0, t 0;
    c and e are the exponent of a number shown in scientific notation (TR35)."""
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
        "c": exponent,
        "e": exponent,
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


def plural_category(language: str, text: str, exponent: int = 0) -> str:
    """The plural category of a number as displayed. CLDR's rules exclude each other except with
    an exponent (fr's one, i = 0,1, and many, e != 0..5, both hold for 1E-3): there the first
    holding category by name is taken, as ICU tests its rule table, which is sorted by key."""
    values = operands(text, exponent)
    holding = []
    for key, rule in PLURALS[language].items():
        category = key.removeprefix("pluralRule-count-")
        condition = rule.split("@")[0].strip()
        if category == "other" or condition == "":
            continue
        if any(all(relation_holds(part, values) for part in alternative.split(" and ")) for alternative in condition.split(" or ")):
            if exponent == 0:
                return category
            holding.append(category)
    return min(holding) if holding else "other"


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
    pos, neg, _ = subpatterns(pattern)
    return pos, neg


def subpatterns(pattern: str):
    """A pattern's positive, negative and plus subpatterns, each as (prefix, number, suffix). The
    plus subpattern (TR35's explicit plus sign, for signDisplay "always" and "exceptZero") is the
    negative one with its minus sign replaced by the plus sign; where the negative subpattern has
    no minus sign (accounting's parentheses) or there is none, it is the positive subpattern with
    the plus sign before it, as ICU writes it."""
    positive, _, negative = pattern.partition(";")

    def parts(sub: str):
        match = re.match(r"^([^#0-9,.]*)([#0-9,.]+)(.*)$", sub)
        if match is None:
            raise ValueError(f"pattern {pattern!r}")
        return match.groups()

    pos = parts(positive)
    neg = parts(negative) if negative else ("-" + pos[0], pos[1], pos[2])
    if negative and "-" in neg[0] + neg[2]:
        plus = (neg[0].replace("-", "+"), neg[1], neg[2].replace("-", "+"))
    else:
        plus = ("+" + pos[0], pos[1], pos[2])
    return pos, neg, plus


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


def number_chars(loc: Locale, digits: str, pattern_number: str, decimal: str, group: str, grouping="auto"):
    """The number's characters as (type, char): integer and fraction digits in the locale's
    numbering system, group and decimal separators. `grouping` is useGrouping's strategy: False
    for none, "auto" for the pattern's group sizes from the locale's minimum grouping digits,
    "min2" for at least two, "always" for one (and three-digit groups for a pattern without)."""
    whole, _, fraction = digits.partition(".")
    sizes = group_sizes(pattern_number)
    if grouping == "always" and sizes is None:
        sizes = (3, 3)
    minimum = {"auto": loc.minimum_grouping, "min2": max(2, loc.minimum_grouping), "always": 1}.get(grouping)
    out = []
    positions = []
    if grouping is not False and sizes is not None and len(whole) >= sizes[0] + minimum:
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


# --- ECMA-402's number options (https://tc39.es/ecma402/#sec-setnfdigitoptions) -------------------

SIGN_DISPLAYS = ["auto", "never", "always", "exceptZero", "negative"]
INCREMENTS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000]


def number_option(value, low: int, high: int, fallback):
    """DefaultNumberOption: the fallback for undefined, else an integer in [low, high] (RangeError
    otherwise; the rows use integers only)."""
    if value is None:
        return fallback
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        raise Refused("range")
    return value


def string_option(options: dict, key: str, allowed: list, fallback: str) -> str:
    value = options.pop(key, None)
    if value is None:
        return fallback
    if value not in allowed:
        raise Refused("range")
    return value


def digit_options(options: dict, scale: int) -> dict:
    """SetNumberFormatDigitOptions, with ducat's minimumFractionDigits and maximumFractionDigits
    (the amount's scale) under the caller's, so the fraction digits are always given."""
    mnid = number_option(options.pop("minimumIntegerDigits", None), 1, 21, 1)
    mnfd = options.pop("minimumFractionDigits", scale)
    mxfd = options.pop("maximumFractionDigits", scale)
    mnsd = options.pop("minimumSignificantDigits", None)
    mxsd = options.pop("maximumSignificantDigits", None)
    increment = number_option(options.pop("roundingIncrement", None), 1, 5000, 1)
    if increment not in INCREMENTS:
        raise Refused("range")
    mode = string_option(options, "roundingMode", MODES, "halfExpand")
    priority = string_option(options, "roundingPriority", ["auto", "morePrecision", "lessPrecision"], "auto")
    trailing = string_option(options, "trailingZeroDisplay", ["auto", "stripIfInteger"], "auto")
    has_sd = mnsd is not None or mxsd is not None
    need_sd, need_fd = True, True
    if priority == "auto":
        need_sd = has_sd
        need_fd = not need_sd
    out = {"mnid": mnid, "increment": increment, "mode": mode, "trailing": trailing}
    if need_sd:
        out["mnsd"] = number_option(mnsd, 1, 21, 1) if has_sd else 1
        out["mxsd"] = number_option(mxsd, out["mnsd"], 21, 21) if has_sd else 21
    if need_fd:
        # both are given (ducat's scale where the caller gives none)
        out["mnfd"] = number_option(mnfd, 0, 100, None)
        out["mxfd"] = number_option(mxfd, 0, 100, None)
        if out["mnfd"] > out["mxfd"]:
            raise Refused("range")
    out["type"] = ("significantDigits" if need_sd else "fractionDigits") if priority == "auto" else priority
    if increment != 1:
        if out["type"] != "fractionDigits":
            raise Refused("type")
        if out["mxfd"] != out["mnfd"]:
            raise Refused("range")
    return out


def decimal_text(units: int, magnitude: int) -> str:
    """units × 10^magnitude (units >= 0) written out, with -magnitude fraction digits."""
    if magnitude >= 0:
        return str(units * 10**magnitude)
    return scaled(units, -magnitude)


def strip_zeros(text: str, cut: int) -> str:
    """Up to `cut` trailing fraction zeros removed, and a decimal point left last."""
    if "." not in text:
        return text
    while cut > 0 and text.endswith("0"):
        text, cut = text[:-1], cut - 1
    return text.removesuffix(".")


def raw_fixed(x: Fraction, mnfd: int, mxfd: int, increment: int, mode: str):
    """ToRawFixed: x rounded (signed, so the unsigned rounding mode follows its sign) to a multiple
    of increment × 10^-mxfd; the text of its magnitude, the rounded value and the magnitude."""
    count = round_integer(x * 10**mxfd / increment, mode) * increment
    return strip_zeros(decimal_text(abs(count), -mxfd), mxfd - mnfd), Fraction(count, 10**mxfd), -mxfd


def raw_precision(x: Fraction, mnsd: int, mxsd: int, mode: str):
    """ToRawPrecision: x rounded to mxsd significant digits; as raw_fixed."""
    if x == 0:
        exponent, count = 0, 0
    else:
        size = abs(x)
        exponent = len(str(size.numerator // size.denominator)) - 1 if size >= 1 else -1
        while size < Fraction(10) ** exponent:
            exponent -= 1
        count = round_integer(x / Fraction(10) ** (exponent - mxsd + 1), mode)
        if abs(count) == 10**mxsd:
            exponent, count = exponent + 1, count // 10
    magnitude = exponent - mxsd + 1
    text = decimal_text(abs(count), magnitude)
    if mxsd > mnsd:
        text = strip_zeros(text, mxsd - mnsd)
    return text, count * Fraction(10) ** magnitude, magnitude


def numeric_text(x: Fraction, digits: dict):
    """FormatNumericToString: the magnitude's ASCII digits as shown and the rounded value."""
    kind = digits["type"]
    fixed = precision = None
    if kind != "significantDigits":
        fixed = raw_fixed(x, digits["mnfd"], digits["mxfd"], digits["increment"], digits["mode"])
    if kind != "fractionDigits":
        precision = raw_precision(x, digits["mnsd"], digits["mxsd"], digits["mode"])
    if fixed is not None and precision is not None:
        fixed_more_precise = fixed[2] < precision[2]
        if kind == "morePrecision":
            result = fixed if fixed_more_precise else precision
        else:
            result = precision if fixed_more_precise else fixed
    else:
        result = fixed or precision
    text, rounded, _ = result
    if digits["trailing"] == "stripIfInteger" and rounded.denominator == 1:
        text = text.split(".")[0]
    whole = text.split(".")[0]
    if len(whole) < digits["mnid"]:
        text = "0" * (digits["mnid"] - len(whole)) + text
    return text, rounded


def sign_type(sign_display: str, negative: bool, zero: bool) -> str:
    """Which subpattern a number takes (ECMA-402's GetNumberFormatPattern): negative includes a
    negative amount that rounded to zero, which "auto" and "always" show with its minus sign."""
    if sign_display == "never":
        return "positive"
    if sign_display in ("auto", "always"):
        if negative:
            return "negative"
        return "plus" if sign_display == "always" else "positive"
    if negative and not zero:
        return "negative"
    return "plus" if sign_display == "exceptZero" and not zero else "positive"


# --- notation (https://tc39.es/ecma402/#sec-computeexponent) and numbering systems -----------------

NOTATIONS = ["standard", "scientific", "engineering", "compact"]
# Unicode BCP 47's type: what numberingSystem must look like (RangeError otherwise)
NU_TYPE = re.compile(r"^[a-zA-Z0-9]{3,8}(-[a-zA-Z0-9]{3,8})*$")
# ICU's default ignorables, [[:Zs:][\t][:Bidi_Control:][:Variation_Selector:]]: the literals
# around a compact pattern's abbreviation
BIDI_CONTROLS = {0x61C, 0x200E, 0x200F, *range(0x202A, 0x202F), *range(0x2066, 0x206A)}
VARIATION_SELECTORS = {*range(0x180B, 0x180E), 0x180F, *range(0xFE00, 0xFE10), *range(0xE0100, 0xE01F0)}


def ignorable(ch: str) -> bool:
    return unicodedata.category(ch) == "Zs" or ch == "\t" or ord(ch) in BIDI_CONTROLS or ord(ch) in VARIATION_SELECTORS


def unicode_nu(tag: str):
    """The type of the tag's -u- extension's nu keyword, lowercase (the first, if repeated)."""
    parts = tag.split("-")
    if "u" not in [part.lower() for part in parts[1:]]:
        return None
    start = [part.lower() for part in parts].index("u", 1) + 1
    key, values, found = None, [], None
    for part in parts[start:] + ["zz"]:
        if len(part) == 1:
            part = "zz"
        if len(part) == 2:
            if key == "nu" and found is None:
                found = "-".join(values)
            key, values = part.lower(), []
        else:
            values.append(part.lower())
    return found


def numeric_system(name) -> bool:
    return name is not None and name in NUMBERING and NUMBERING[name]["_type"] == "numeric"


def numbering_system(tag: str, option):
    """ResolveLocale's nu: the option where it is supported (every numeric system is, for every
    locale, as in ICU), else the tag's -u-nu- where supported, else the locale's default. (V8
    drops the tag's -u-nu- for any option, supported or not; JavaScriptCore keeps it, as
    ECMA-402 says: the rows leave that case out.)"""
    if numeric_system(option):
        return option
    extension = unicode_nu(tag)
    if numeric_system(extension):
        return extension
    return None


def lookup(tag: str) -> str:
    """ECMA-402's LookupMatcher (RFC 4647 lookup) over CLDR's available locales and default
    contents, the tag's extensions removed: subtags dropped from the end (a singleton with the
    one after it) until one is available. V8's "best fit" is the same matcher."""
    candidate = tag.split("-u-")[0]
    while True:
        if candidate in AVAILABLE or candidate in DEFAULT_CONTENT:
            return candidate
        cut = candidate.rfind("-")
        if cut < 0:
            raise KeyError(f"lookup finds no locale for {tag}")
        if cut >= 2 and candidate[cut - 2] == "-":
            cut -= 2
        candidate = candidate[:cut]


def magnitude_of(x: Fraction) -> int:
    """floor(log10(|x|)) for x != 0, exactly."""
    size = abs(x)
    exponent = len(str(size.numerator // size.denominator)) - 1 if size >= 1 else -1
    while size < Fraction(10) ** exponent:
        exponent -= 1
    return exponent


def compact_table(patterns: dict) -> dict:
    """{magnitude: {category: pattern}} from {"1000-count-one": "0K", ...}."""
    table = {}
    for key, pattern in patterns.items():
        power, _, category = key.partition("-count-")
        table.setdefault(len(power) - 1, {})[category] = pattern
    return table


def compact_exponent(table: dict, magnitude: int) -> int:
    """ICU's compact multiplier: the magnitude less the other pattern's zeros but one (above the
    largest magnitude, the largest's); 0 for a 0 pattern, below a thousand, or no data."""
    if not table or magnitude < 0:
        return 0
    entry = table.get(min(magnitude, max(table)))
    if not entry or entry.get("other", "0") == "0":
        return 0
    zeros = entry["other"].split(";")[0].count("0")
    return min(magnitude, max(table)) - zeros + 1


def compact_pattern(table: dict, language: str, text: str, rounded: Fraction, exponent: int, negative: bool):
    """The compact pattern for a rounded mantissa (as ICU's CompactData::getPattern picks it):
    by the rounded value's magnitude, CLDR's explicit 0 and 1 forms for a whole mantissa (ICU's i
    keeps the sign, so -1 isn't 1), else the mantissa's plural form, else other; None for 0."""
    if not table or rounded == 0:
        return None
    magnitude = magnitude_of(rounded) + exponent
    if magnitude < 0:
        return None
    entry = table.get(min(magnitude, max(table)), {})
    pattern = None
    if rounded.denominator == 1:
        whole = abs(rounded)
        if whole == 0:
            pattern = entry.get("0")
        elif whole == 1 and not negative:
            pattern = entry.get("1")
    if pattern is None:
        pattern = entry.get(plural_category(language, text), entry.get("other"))
    return None if pattern in (None, "0") else pattern


def compact_subpatterns(pattern: str):
    """A compact pattern's positive, negative and plus subpatterns, as subpatterns() makes them,
    each (prefix, suffix, has_number): its run of zeros is the number."""

    def parts(sub: str):
        quoted, start, end = False, None, len(sub)
        for index, ch in enumerate(sub):
            if start is not None:
                if ch != "0":
                    end = index
                    break
            elif ch == "'":
                quoted = not quoted
            elif not quoted and ch == "0":
                start = index
        if start is None:
            return sub, "", False
        return sub[:start], sub[end:], True

    positive, _, negative = pattern.partition(";")
    pos = parts(positive)
    neg = parts(negative) if negative else ("-" + pos[0], pos[1], pos[2])
    if negative and "-" in neg[0] + neg[1]:
        plus = (neg[0].replace("-", "+"), neg[1].replace("-", "+"), pos[2])
    else:
        plus = ("+" + pos[0], pos[1], pos[2])
    return pos, neg, plus


def compact_affix_chars(loc: Locale, affix: str, currency: str):
    """A compact pattern's affix: its literal text is the abbreviation (the compact part), the
    default ignorables at either end of each run literals, as ICU trims a field."""
    out, run = [], []

    def flush():
        text = "".join(run)
        start = 0
        while start < len(text) and ignorable(text[start]):
            start += 1
        end = len(text)
        while end > start and ignorable(text[end - 1]):
            end -= 1
        out.extend(("literal", ch) for ch in text[:start])
        out.extend(("compact", ch) for ch in text[start:end])
        out.extend(("literal", ch) for ch in text[end:])
        run.clear()

    for ch in affix:
        if ch in "¤-+":
            flush()
            out.extend(affix_chars(loc, ch, currency))
        elif ch != "'":
            run.append(ch)
    flush()
    return out


def exponent_chars(loc: Locale, exponent: int):
    """Scientific notation's exponent: the exponential symbol, the minus sign for a negative
    exponent, its digits in the numbering system."""
    out = symbol_chars(loc.symbols["exponential"], "exponentSeparator")
    if exponent < 0:
        out += symbol_chars(loc.symbols["minusSign"], "exponentMinusSign")
    return out + [("exponentInteger", loc.digits[int(ch)]) for ch in str(abs(exponent))]


def shifted_text(text: str, exponent: int) -> str:
    """ASCII digits (no sign) times 10^exponent, written out with their visible digits."""
    whole, _, fraction = text.partition(".")
    digits = whole + fraction
    point = len(whole) + exponent
    if point <= 0:
        out = "0." + "0" * -point + digits
    elif point >= len(digits):
        out = digits + "0" * (point - len(digits))
    else:
        out = digits[:point] + "." + digits[point:]
    out = out.lstrip("0")
    return "0" + out if out == "" or out.startswith(".") else out


def format_parts(amount: str, currency: str, tag: str, options: dict) -> list:
    """The parts of a money amount formatted the way ducat documents: its scale's fraction digits
    (or `digits`, rounded first with `rounding`), and the Intl options ducat passes on, as
    ECMA-402's Intl.NumberFormat reads them, over TR35's patterns."""
    options = dict(options or {})
    digits = options.pop("digits", None)
    rounding = options.pop("rounding", None)
    if rounding is not None and digits is None:
        raise Refused("type")
    if digits is not None and any(key in options for key in ("minimumFractionDigits", "maximumFractionDigits", "minimumSignificantDigits", "maximumSignificantDigits", "roundingIncrement")):
        raise Refused("type")
    value = Fraction(amount)
    if digits is not None:
        amount = scaled(round_integer(value * 10**digits, rounding or "halfExpand"), digits)
        value = Fraction(amount)
    # Intl.NumberFormat's constructor, in its order: localeMatcher and numberingSystem, the locale,
    # the currency options, notation, the digit options, compactDisplay, then useGrouping and
    # signDisplay
    matcher = string_option(options, "localeMatcher", ["lookup", "best fit"], None)
    system_option = options.pop("numberingSystem", None)
    if system_option is not None and not NU_TYPE.match(system_option):
        raise Refused("range")
    if matcher is not None:
        # V8's "best fit" is its lookup
        tag = lookup(tag) + (tag[tag.index("-u-"):] if "-u-" in tag else "")
    display = string_option(options, "currencyDisplay", ["symbol", "narrowSymbol", "code", "name"], "symbol")
    sign = string_option(options, "currencySign", ["standard", "accounting"], "standard")
    notation = string_option(options, "notation", NOTATIONS, "standard")
    number_options = digit_options(options, places_of(amount))
    compact_display = string_option(options, "compactDisplay", ["short", "long"], "short")
    grouping = options.pop("useGrouping", None)
    if grouping is True:
        grouping = "always"
    elif grouping in (False, ""):
        grouping = False
    elif grouping in (None, "true", "false"):
        grouping = "auto"
    elif grouping not in ("always", "auto", "min2"):
        raise Refused("range")
    if notation == "compact" and grouping == "auto":
        # V8 hands ICU no grouping strategy for auto, and ICU's compact default is min2
        grouping = "min2"
    sign_display = string_option(options, "signDisplay", SIGN_DISPLAYS, "auto")
    if options:
        raise ValueError(f"options not modelled: {options}")
    loc = locale(tag.split("-u-")[0], numbering_system(tag, system_option))
    table = {}
    if notation == "compact":
        # a symbol or code takes the short currency patterns (CLDR has no long ones), a name the
        # decimal ones of compactDisplay (short where a locale has no long ones), as ICU
        if display == "name":
            table = compact_table(loc.compact_patterns("decimalFormats", compact_display) or loc.compact_patterns("decimalFormats", "short"))
        else:
            table = compact_table(loc.compact_patterns("currencyFormats", "short"))

    def exponent_for(magnitude: int) -> int:
        if notation == "scientific":
            return magnitude
        if notation == "engineering":
            return magnitude // 3 * 3
        if notation == "compact":
            return compact_exponent(table, magnitude)
        return 0

    # ComputeExponent: the mantissa rounded, scaled again if it rounded up to the next power
    exponent = 0
    text, rounded = numeric_text(value, number_options)
    if value != 0 and notation != "standard":
        magnitude = magnitude_of(value)
        exponent = exponent_for(magnitude)
        text, rounded = numeric_text(value / Fraction(10) ** exponent, number_options)
        if rounded != 0 and magnitude_of(rounded) != magnitude - exponent:
            exponent = exponent_for(magnitude + 1)
            text, rounded = numeric_text(value / Fraction(10) ** exponent, number_options)
    scientific = notation in ("scientific", "engineering")
    subpattern = sign_type(sign_display, value < 0, rounded == 0)
    decimal, group = loc.currency_decimal(), loc.currency_group()
    pick = ("positive", "negative", "plus").index(subpattern)
    compact = compact_pattern(table, loc.language, text, rounded, exponent, value < 0) if notation == "compact" else None
    standard = loc.decimal_formats["standard"] if display == "name" else loc.formats[sign]
    symbol = "" if display == "name" else loc.symbol(currency, display)
    number_pattern = subpatterns(standard)[0][1]
    number = number_chars(loc, text, number_pattern, decimal, group, grouping)
    if scientific:
        number += exponent_chars(loc, exponent)
    if compact is not None:
        prefix, suffix, has_number = compact_subpatterns(compact)[pick]
        chars = spaced(loc, compact_affix_chars(loc, prefix, symbol), number if has_number else [], compact_affix_chars(loc, suffix, symbol))
    else:
        prefix, _, suffix = subpatterns(standard)[pick]
        chars = spaced(loc, affix_chars(loc, prefix, symbol), number, affix_chars(loc, suffix, symbol))
    if display != "name":
        return merge(chars)
    # the plural form of the number as shown, in the decimal pattern; no accounting form. In
    # compact notation the amount's, rounded as standard notation rounds it (ICU chooses it
    # before it scales the number); in scientific notation the whole value's, with its exponent
    if notation == "compact":
        category = plural_category(loc.language, numeric_text(value, number_options)[0])
    elif scientific:
        category = plural_category(loc.language, shifted_text(text, exponent), exponent)
    else:
        category = plural_category(loc.language, text)
    name = loc.name(currency, category)
    unit = loc.formats.get(f"unitPattern-count-{category}", loc.formats["unitPattern-count-other"])
    out = []
    for piece in re.split(r"(\{[01]\})", unit):
        if piece == "{0}":
            out.extend(chars)
        elif piece == "{1}":
            out.extend(("currency", ch) for ch in name)
        else:
            out.extend(("literal", ch) for ch in piece)
    return merge(out)


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
    rows.extend(option_rows())
    rows.extend(notation_rows())
    # what format refuses: Intl's digit options beside digits, rounding without digits, an
    # invalid display or a malformed tag
    for options in [{"digits": 2, "maximumFractionDigits": 3}, {"digits": 2, "minimumFractionDigits": 1}, {"digits": 2, "maximumSignificantDigits": 3}, {"digits": 2, "roundingIncrement": 5}, {"rounding": "halfEven"}, {"currencyDisplay": "symbols"}, {"currencySign": "negative"}]:
        rows.append(format_row("1.00", "EUR", "en", options))
    for tag in ["en_US", "e", "en-US-", "123"]:
        rows.append(format_row("1.00", "EUR", tag))
    return rows


# The Intl options ducat passes on, across locales with each kind of pattern: a negative
# subpattern with a minus sign (nl, de-CH), accounting parentheses (en, fr), bidi marks around the
# signs (ar-EG, fa-IR), a minimum of two grouping digits (es, it), lakh grouping (en-IN), other
# digits (ar-EG, fa-IR) and another minus sign (sv-SE)
OPTION_TAGS = ["en", "de-DE", "es", "nl", "ar-EG", "en-IN", "fa-IR", "de-CH", "fr", "sv-SE", "ja", "it"]
# useGrouping's values: booleans, its three strategies, and the strings "true" and "false", which
# Intl reads as the default
GROUPINGS = [True, False, "always", "auto", "min2", "true", "false"]


def option_rows() -> list:
    rows = []
    # signDisplay: every value, in both currency signs, for a negative, zero and positive amount
    for tag in OPTION_TAGS:
        currency = LOCAL_CURRENCY[tag]
        exponent = EXPONENT[currency]
        for sign_display in SIGN_DISPLAYS:
            for sign in SIGNS:
                for units in (-123456, 0, 123456):
                    options = {"signDisplay": sign_display}
                    if sign != "standard":
                        options["currencySign"] = sign
                    rows.append(format_row(scaled(units, exponent), currency, tag, options))
    # with the code and the name, whose number takes the decimal pattern's signs
    for tag in ["en", "nl", "ar-EG", "fa-IR", "de-CH", "ru-RU"]:
        for sign_display in SIGN_DISPLAYS:
            for display in ("code", "name"):
                for amount in ("-1.00", "0.00", "2.00"):
                    rows.append(format_row(amount, "USD", tag, {"signDisplay": sign_display, "currencyDisplay": display}))
    # a negative amount Intl rounds to zero keeps its minus sign with "auto" and "always"; one
    # ducat's digits rounds to zero is zero
    for tag in ["en", "nl", "de-CH", "ar-EG"]:
        for sign_display in SIGN_DISPLAYS:
            for sign in SIGNS:
                options = {"signDisplay": sign_display, "minimumFractionDigits": 2, "maximumFractionDigits": 2}
                if sign != "standard":
                    options["currencySign"] = sign
                rows.append(format_row("-0.004", "EUR", tag, options))
            rows.append(format_row("-0.004", "EUR", tag, {"signDisplay": sign_display, "digits": 2}))
            rows.append(format_row("0.004", "EUR", tag, {"signDisplay": sign_display, "minimumFractionDigits": 0, "maximumFractionDigits": 0}))
    # useGrouping: each value around each locale's grouping threshold
    for tag in OPTION_TAGS:
        currency = LOCAL_CURRENCY[tag]
        exponent = EXPONENT[currency]
        for grouping in GROUPINGS:
            for whole in (123, 1234, 12345, -1234567):
                rows.append(format_row(scaled(whole * 10**exponent + (5 if exponent else 0), exponent), currency, tag, {"useGrouping": grouping}))
    for tag in ["en", "es", "en-IN"]:
        for grouping in GROUPINGS:
            for amount in ("1234.00", "1234567.00"):
                rows.append(format_row(amount, "USD", tag, {"useGrouping": grouping, "currencyDisplay": "name"}))
    # minimumIntegerDigits: padding, which is grouped as the number is
    for tag in ["en", "es", "de-DE", "en-IN", "ar-EG", "fa-IR"]:
        for minimum in (1, 2, 4, 5, 21):
            for amount in ("0.05", "1.00", "1234.50", "-12.30"):
                rows.append(format_row(amount, "EUR", tag, {"minimumIntegerDigits": minimum}))
        rows.append(format_row("1.00", "EUR", tag, {"minimumIntegerDigits": 6, "useGrouping": False}))
        rows.append(format_row("1.00", "EUR", tag, {"minimumIntegerDigits": 6, "useGrouping": "min2"}))
        rows.append(format_row("1.00", "EUR", tag, {"minimumIntegerDigits": 3, "currencyDisplay": "name"}))
    # significant digits: a minimum, a maximum, both, over zero, fractions, carries and large values
    significant = [
        {"maximumSignificantDigits": 3}, {"minimumSignificantDigits": 3}, {"minimumSignificantDigits": 2, "maximumSignificantDigits": 4},
        {"minimumSignificantDigits": 5}, {"minimumSignificantDigits": 21}, {"maximumSignificantDigits": 1},
        {"minimumSignificantDigits": 1, "maximumSignificantDigits": 21}, {"minimumSignificantDigits": 4, "maximumSignificantDigits": 4},
        # fraction digits beside them are ignored without roundingPriority, out of range or not
        {"maximumSignificantDigits": 3, "maximumFractionDigits": 1}, {"maximumSignificantDigits": 3, "maximumFractionDigits": 500},
    ]
    for tag in ["en", "de-DE", "ar-EG"]:
        for options in significant:
            for amount in ("0.00", "0.05", "1.00", "9.99", "-1234.56", "1234567.89", "0.001234", "-99.995", "12345678901234567.89"):
                rows.append(format_row(amount, "EUR", tag, options))
    # roundingMode: every mode, with fraction digits, significant digits and increments, at ties
    # and off them, on either side of zero, and past a double's digits (Intl reads a string)
    rounding_cases = [
        ({"minimumFractionDigits": 2, "maximumFractionDigits": 2}, ["1.005", "-1.005", "1.015", "-1.015", "1.004", "-1.006", "9999999999999999.995", "-9999999999999999.995"]),
        ({"minimumFractionDigits": 0, "maximumFractionDigits": 0}, ["2.50", "-2.50", "3.50", "-3.50", "2.51", "-0.50", "0.49"]),
        ({"minimumFractionDigits": 0, "maximumFractionDigits": 2}, ["1.505", "-1.505", "1.999"]),
        ({"maximumSignificantDigits": 2}, ["1250.00", "-1250.00", "1350.00", "9.95", "-0.125", "123456789012345678.90"]),
        ({"minimumFractionDigits": 2, "maximumFractionDigits": 2, "roundingIncrement": 5}, ["1.025", "1.074", "-1.025", "1.075"]),
        ({"minimumFractionDigits": 1, "maximumFractionDigits": 1, "roundingIncrement": 25}, ["1.125", "-3.75"]),
        ({"maximumSignificantDigits": 2, "minimumFractionDigits": 0, "maximumFractionDigits": 1, "roundingPriority": "lessPrecision"}, ["12.35", "-0.125"]),
    ]
    for options, amounts in rounding_cases:
        for amount in amounts:
            for mode in MODES:
                for tag in ["en", "de-DE"]:
                    rows.append(format_row(amount, "EUR", tag, {**options, "roundingMode": mode}))
    # without Intl rounding, or after ducat's own, a mode changes nothing
    for mode in MODES:
        rows.append(format_row("1.25", "EUR", "en", {"roundingMode": mode}))
        rows.append(format_row("1.255", "EUR", "en", {"digits": 2, "rounding": "floor", "roundingMode": mode}))
    # roundingPriority: fraction digits against significant digits, the more or the less precise
    priority_options = [
        {}, {"maximumSignificantDigits": 2}, {"minimumSignificantDigits": 2}, {"maximumSignificantDigits": 3, "minimumFractionDigits": 0, "maximumFractionDigits": 1},
        {"minimumSignificantDigits": 3, "minimumFractionDigits": 0, "maximumFractionDigits": 0}, {"maximumSignificantDigits": 5, "minimumFractionDigits": 2, "maximumFractionDigits": 3},
    ]
    for priority in ("auto", "morePrecision", "lessPrecision"):
        for options in priority_options:
            for amount in ("1.20", "9.99", "1234.56", "0.00", "0.05", "-0.123456", "12345678901234567890.12"):
                rows.append(format_row(amount, "EUR", "en", {**options, "roundingPriority": priority}))
        for tag in ["de-DE", "ar-EG"]:
            rows.append(format_row("1234.56", "EUR", tag, {"maximumSignificantDigits": 2, "roundingPriority": priority}))
        rows.append(format_row("1.20", "EUR", "en", {"digits": 2, "roundingPriority": priority}))
    # trailingZeroDisplay: whole amounts lose their fraction digits, the others keep them all
    for tag in ["en", "de-DE", "ar-EG", "ru-RU", "ja", "fr"]:
        for trailing in ("auto", "stripIfInteger"):
            for amount, options in [("1.00", {}), ("1.50", {}), ("0.00", {}), ("-5.00", {}), ("1234.00", {}), ("1.001", {"minimumFractionDigits": 2, "maximumFractionDigits": 2}), ("4.999", {"digits": 2}), ("1.00", {"currencyDisplay": "name"}), ("2.00", {"currencyDisplay": "name"}), ("-5.00", {"currencySign": "accounting"})]:
                rows.append(format_row(amount, "EUR", tag, {**options, "trailingZeroDisplay": trailing}))
    # together: an invoice line (+/- signs, no grouping, whole amounts plain) and a padded code
    for tag in ["en", "de-DE", "nl", "ar-EG"]:
        for amount in ("1234.00", "-1234.50", "0.00"):
            rows.append(format_row(amount, "EUR", tag, {"signDisplay": "exceptZero", "useGrouping": False, "trailingZeroDisplay": "stripIfInteger"}))
            rows.append(format_row(amount, "EUR", tag, {"signDisplay": "always", "currencySign": "accounting", "minimumIntegerDigits": 6, "useGrouping": "always"}))
    # what Intl refuses: values out of range (RangeError), an increment beside significant digits
    # or roundingPriority (TypeError), in Intl's order
    for options in [
        {"signDisplay": "plus"}, {"useGrouping": "yes"}, {"minimumIntegerDigits": 0}, {"minimumIntegerDigits": 22},
        {"minimumSignificantDigits": 0}, {"minimumSignificantDigits": 22}, {"maximumSignificantDigits": 0}, {"maximumSignificantDigits": 22},
        {"minimumSignificantDigits": 4, "maximumSignificantDigits": 3}, {"roundingMode": "up"}, {"roundingMode": "unnecessary"},
        {"roundingPriority": "most"}, {"trailingZeroDisplay": "strip"}, {"roundingIncrement": 3}, {"roundingIncrement": 5000},
        {"roundingIncrement": 5, "maximumSignificantDigits": 3}, {"roundingIncrement": 1, "maximumSignificantDigits": 3},
        {"roundingIncrement": 5, "roundingPriority": "morePrecision"}, {"roundingIncrement": 5, "maximumFractionDigits": 3},
        {"roundingIncrement": 5, "maximumSignificantDigits": 3, "maximumFractionDigits": 3}, {"roundingIncrement": 5, "useGrouping": "yes"},
        {"minimumIntegerDigits": 0, "roundingIncrement": 5, "maximumSignificantDigits": 3},
        {"maximumSignificantDigits": 3, "minimumFractionDigits": 3, "maximumFractionDigits": 1, "roundingPriority": "morePrecision"},
        {"maximumSignificantDigits": 3, "maximumFractionDigits": 101, "roundingPriority": "lessPrecision"},
        {"maximumFractionDigits": 1}, {"minimumSignificantDigits": 3, "digits": 2}, {"digits": 2, "signDisplay": "plus"},
        {"digits": 2, "roundingMode": "up"}, {"currencyDisplay": "symbols", "signDisplay": "plus"},
    ]:
        rows.append(format_row("1.00", "EUR", "en", options))
    return rows


# Notation and numbering systems: locales with each kind of compact pattern (a suffix, en's K;
# a spaced one, fr's k; one before the number, sw-KE's elfu, with a negative subpattern; no
# abbreviation for thousands, de-DE and ja; lakhs and crores, hi-IN, en-IN and bn), default
# numbering systems other than latn (ar-EG, fa-IR, bn) and locales with another one (hi-IN's
# deva, th-TH's thai)
NOTATION_TAGS = ["en", "de-DE", "fr", "es", "it", "ja", "ar-EG", "fa-IR", "hi-IN", "th-TH", "bn", "sw-KE", "ru-RU", "sv-SE", "de-CH", "en-IN", "pt-BR", "nl"]
COMPACT_AMOUNTS = [
    "0.00", "5.00", "-5.00", "999.99", "999.995", "1234.50", "-1234.56", "12345.67", "123456.78", "999999.99",
    "1000000.00", "-1500000.00", "123456789.12", "1000000000.00", "12345678901234.56", "1234567890123456789.00",
]
SCIENTIFIC_AMOUNTS = ["0.00", "0.001234", "-0.5", "1.00", "9.999", "1234.50", "-1234567.89", "999999.99", "12345678901234567.89"]


def notation_rows() -> list:
    rows = []
    # compact notation: symbol, code, and names short and long, around each magnitude, rounding
    # up to the next one (999999.99 is 1.00M) and past the largest pattern (T)
    for tag in NOTATION_TAGS:
        for amount in COMPACT_AMOUNTS:
            for options in ({}, {"currencyDisplay": "code"}, {"currencyDisplay": "name"}, {"currencyDisplay": "name", "compactDisplay": "long"}, {"compactDisplay": "long"}):
                if options.get("currencyDisplay") == "name" and len(amount) > 19:
                    continue
                rows.append(format_row(amount, "EUR", tag, {"notation": "compact", **options}))
        # whole numbers: CLDR's explicit 1 forms (fr's mille, but -1 millier) and plural forms
        for amount in ("1000", "-1000", "2000", "1", "21000", "1500000", "-1"):
            rows.append(format_row(amount, "JPY", tag, {"notation": "compact", "currencyDisplay": "name", "compactDisplay": "long"}))
            rows.append(format_row(amount, "JPY", tag, {"notation": "compact"}))
    # signs: no accounting form in a compact pattern (but in the standard one below a thousand),
    # the plus sign, and the sign before the pattern or in its negative subpattern
    for tag in ["en", "fr", "ar-EG", "fa-IR", "sw-KE", "de-CH", "sv-SE", "bn"]:
        for options in ({"currencySign": "accounting"}, {"signDisplay": "always"}, {"signDisplay": "exceptZero"}, {"signDisplay": "never"}, {"signDisplay": "always", "currencyDisplay": "name", "compactDisplay": "long"}):
            for amount in ("-1234567.00", "-5.00", "0.00", "1234.00", "-0.001"):
                rows.append(format_row(amount, "USD" if amount != "-0.001" else "KWD", tag, {"notation": "compact", **options}))
    # rounding the mantissa: Intl's digit options apply to it, and grouping defaults to min2
    compact_rounding = [
        {"maximumSignificantDigits": 2}, {"minimumSignificantDigits": 3}, {"minimumFractionDigits": 0, "maximumFractionDigits": 0},
        {"minimumFractionDigits": 0, "maximumFractionDigits": 1}, {"minimumFractionDigits": 2, "maximumFractionDigits": 2, "roundingIncrement": 5},
        {"minimumIntegerDigits": 3}, {"trailingZeroDisplay": "stripIfInteger"}, {"roundingMode": "floor"}, {"roundingMode": "ceil", "maximumSignificantDigits": 1},
        {"maximumSignificantDigits": 2, "roundingPriority": "morePrecision"}, {"maximumSignificantDigits": 2, "roundingPriority": "lessPrecision"},
        # (no explicit "auto": V8 groups it as min2 in compact notation, JavaScriptCore as the locale does)
        {"useGrouping": "always"}, {"useGrouping": "min2"}, {"useGrouping": False}, {"useGrouping": True}, {"useGrouping": "true"},
        {"digits": 0}, {"digits": 1, "rounding": "floor"},
    ]
    for tag in ["en", "de-DE", "ja", "en-IN", "ar-EG"]:
        for options in compact_rounding:
            for amount in ("1234.56", "-9995.00", "999999.50", "1234.00", "12345678901234567.89"):
                rows.append(format_row(amount, "EUR", tag, {"notation": "compact", **options}))
    # scientific and engineering notation: the standard patterns (accounting too), the mantissa
    # rounded, the exponent with its sign and the numbering system's digits; names in the plural
    # of the whole value, with CLDR's e operand
    for tag in ["en", "de-CH", "ar-EG", "fa-IR", "sv-SE", "bn", "hi-IN", "nl", "fr", "es", "ru-RU", "th-TH"]:
        for notation in ("scientific", "engineering"):
            for options in ({}, {"currencyDisplay": "name"}, {"currencySign": "accounting"}, {"currencyDisplay": "code"}):
                for amount in SCIENTIFIC_AMOUNTS:
                    rows.append(format_row(amount, "EUR", tag, {"notation": notation, **options}))
        for amount in ("1", "1000000", "1500000", "2"):
            rows.append(format_row(amount, "JPY", tag, {"notation": "scientific", "currencyDisplay": "name"}))
        rows.append(format_row("0.001", "KWD", tag, {"notation": "scientific", "currencyDisplay": "name"}))
    for options in [
        {"maximumSignificantDigits": 2}, {"minimumIntegerDigits": 3}, {"minimumIntegerDigits": 5, "useGrouping": "always"}, {"minimumFractionDigits": 0, "maximumFractionDigits": 0},
        {"signDisplay": "always"}, {"signDisplay": "exceptZero"}, {"trailingZeroDisplay": "stripIfInteger"}, {"roundingIncrement": 25, "minimumFractionDigits": 2, "maximumFractionDigits": 2},
    ]:
        for notation in ("scientific", "engineering"):
            for amount in ("12345.00", "-0.00999", "9.995", "0.00"):
                rows.append(format_row(amount, "EUR", "en", {"notation": notation, **options}))
    # numbering systems: the option and -u-nu-, the option over the tag's, a locale's own systems
    # and any numeric one in latn's patterns; unsupported values (algorithmic, unknown, another
    # case) are ignored, as Intl ignores them
    systems = [
        ("ar-EG", "latn"), ("ar-EG-u-nu-latn", None), ("ar-EG-u-nu-latn", "arab"), ("fa-IR", "latn"), ("fa-IR-u-nu-latn", None), ("hi-IN", "deva"),
        ("hi-IN-u-nu-deva", None), ("th-TH", "thai"), ("th-TH-u-nu-thai", None), ("bn", "latn"), ("bn-u-nu-latn", None), ("en", "thai"), ("en", "deva"),
        ("en", "hanidec"), ("en-u-nu-beng", None), ("de-DE", "deva"), ("de-CH-u-nu-thai", None), ("ja", "fullwide"), ("ru-RU", "tamldec"),
        ("en", "roman"), ("en", "native"), ("en", "xyz"), ("en", "ARAB"), ("en-u-nu-roman", None), ("ar-EG-u-nu-xyz", None), ("ar-EG", "finance"),
        ("en-u-nu-thai-nu-deva", None), ("en-u-ca-gregory-nu-thai", None), ("hi-IN-u-nu-deva", "latn"), ("ar-EG", "arab"),
    ]
    for tag, system in systems:
        options = {} if system is None else {"numberingSystem": system}
        for amount in ("-1234567.50", "0.05"):
            rows.append(format_row(amount, "EUR", tag, options))
        for extra in ({"currencyDisplay": "name"}, {"notation": "compact"}, {"notation": "scientific"}, {"currencySign": "accounting"}):
            rows.append(format_row("-1234567.50", "EUR", tag, {**options, **extra}))
    # localeMatcher: both values match a tag to the same locale (V8's best fit is its lookup):
    # dropped subtags, default contents and extensions
    for tag in ["en-US", "de-XX", "fr-CA", "es-419", "en-001", "pt-XX", "de-CH-u-nu-thai", "ar-EG-u-nu-latn", "zh-Hans-CN", "zh-Hant-HK", "ja-JP"]:
        for matcher in ("lookup", "best fit"):
            rows.append(format_row("-1234.50", "EUR", tag, {"localeMatcher": matcher}))
            rows.append(format_row("1234567.00", "EUR", tag, {"localeMatcher": matcher, "notation": "compact", "currencyDisplay": "name"}))
    # what Intl refuses, in its order: localeMatcher, numberingSystem, the currency options,
    # notation, the digit options, compactDisplay (read whatever the notation), useGrouping and
    # signDisplay; ducat's own TypeError first
    for options in [
        {"notation": "x"}, {"notation": "Compact"}, {"compactDisplay": "x"}, {"compactDisplay": "x", "notation": "compact"}, {"localeMatcher": "x"}, {"localeMatcher": "Lookup"},
        {"numberingSystem": "ab"}, {"numberingSystem": "latn-x"}, {"numberingSystem": "latn_x"}, {"numberingSystem": ""}, {"numberingSystem": "abcdefghi"}, {"numberingSystem": "latn-arab"},
        {"localeMatcher": "x", "numberingSystem": "ab"}, {"numberingSystem": "ab", "currencyDisplay": "symbols"}, {"notation": "x", "minimumIntegerDigits": 0},
        {"notation": "x", "roundingIncrement": 5, "maximumSignificantDigits": 3}, {"compactDisplay": "x", "roundingIncrement": 5, "maximumSignificantDigits": 3},
        {"compactDisplay": "x", "minimumIntegerDigits": 0}, {"compactDisplay": "x", "useGrouping": "x"}, {"numberingSystem": "ab", "roundingIncrement": 5, "maximumSignificantDigits": 3},
        {"numberingSystem": "ab", "digits": 2, "maximumFractionDigits": 3}, {"notation": "x", "rounding": "floor"}, {"notation": "compact", "roundingIncrement": 5, "maximumSignificantDigits": 3},
        {"notation": "compact", "compactDisplay": "long", "signDisplay": "plus"},
    ]:
        rows.append(format_row("1.00", "EUR", "en", options))
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
    "were settled after looking at ICU's output, so agreement on them is not independent evidence; the text of every other row is. "
    "So was the explicit plus sign (signDisplay always and exceptZero) where TR35 leaves it open: the negative subpattern with its minus sign replaced by the plus sign, "
    "or, where the negative subpattern has no minus sign (accounting's parentheses) or there is none, the plus sign before the positive subpattern. "
    "So were the notation rules where ECMA-402 leaves the data to the implementation (spec/README.md): which compact pattern applies (CLDR's short currency patterns for a symbol or code, "
    "the decimal ones of compactDisplay for a name; by the rounded magnitude and the mantissa's plural form, CLDR's explicit 1 form for a positive mantissa only; its negative subpattern or the minus sign before it), "
    "the compact part without the default ignorables around it, min2 grouping by default in compact notation, the plural form of a name (the amount's in compact notation, the whole value's with its exponent in scientific, the first holding category by name), "
    "and V8's locale matching (best fit is lookup)."
)


def main() -> None:
    method = (
        "Unicode TR35's number and currency formatting (https://www.unicode.org/reports/tr35/tr35-numbers.html), with the Intl.NumberFormat options ducat passes on read as ECMA-402 defines them "
        "(SetNumberFormatDigitOptions, FormatNumericToString, ToRawFixed, ToRawPrecision and GetNumberFormatPattern: https://tc39.es/ecma402/#sec-setnfdigitoptions; "
        "rounding on exact fractions, never a double; useGrouping's min2 and auto from CLDR's minimumGroupingDigits), and the parse rules of docs/reference/parse.md, "
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
            "Money formatted as currency in the locales the documentation and tests use: every display (symbol, narrow symbol, code, name) and sign (standard, accounting), digits and rounding, amounts beyond a double's digits, the Intl options ducat passes on (signDisplay, useGrouping, minimumIntegerDigits, fraction and significant digits, roundingIncrement, roundingMode, roundingPriority, trailingZeroDisplay), and the options format and Intl refuse; the text and its parts.",
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
