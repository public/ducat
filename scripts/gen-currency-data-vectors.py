#!/usr/bin/env python3
"""Reference vectors for ducat's currency data, read straight from data/ with Python's standard
library (json and xml.etree), independently of ducat's own generator (scripts/gen-currencies.mjs):

    spec/vectors/currency/data.json   ISO exponents and numeric codes, historic codes, CLDR's
                                      cash fractions, territories, crypto units
    spec/vectors/cash/rules.json      the cash-rounding rules, and amounts rounded through them

checked by test/spec.test.ts and the Rust port's rust/crates/ducat/tests/spec.rs.

The three figures a currency can have are kept apart, and none is derived from another: the ISO 4217
exponent (an amount's scale; for a withdrawn code, the one ISO gave it while it was current), CLDR's
display and cash digits (data/cldr-cash.json, which holds only the currencies CLDR cash-rounds), and
the cash rules (data/cash-rounding.json).

Deterministic: the same seed always writes the same files. Regenerate with
    python3 scripts/gen-currency-data-vectors.py
and check that nothing changed with --check.
"""
import json
import random
import re
import sys
import xml.etree.ElementTree as ElementTree
from fractions import Fraction

sys.dont_write_bytecode = True  # no __pycache__ in scripts/
from spec_vectors import ROOT, file_text, vector_path, write_or_check  # noqa: E402

SEED = 20261116
# bumped when the output's layout changes; the values depend only on the seed and data/
GENERATOR_VERSION = "1"
# the CLDR release data/cldr-territories.json and data/cldr-cash.json were read from
CLDR_RELEASE = "49"
MODES = ["halfEven", "halfExpand", "halfTrunc", "halfCeil", "halfFloor", "expand", "trunc", "ceil", "floor"]


def read_json(name: str):
    return json.loads((ROOT / "data" / name).read_text(encoding="utf-8"))


def read_xml(name: str):
    return ElementTree.parse(ROOT / "data" / name).getroot()


# --- the data -----------------------------------------------------------------------------------


def list_one():
    """ISO 4217 List One: code -> (exponent or None for N.A., numeric code), the first entry of each"""
    root = read_xml("iso4217-list-one.xml")
    codes = {}
    for entry in root.iter("CcyNtry"):
        code = entry.findtext("Ccy")
        if code is None:
            continue
        units = entry.findtext("CcyMnrUnts").strip()
        exponent = None if units == "N.A." else int(units)
        numeric = entry.findtext("CcyNbr").strip()
        if code in codes:
            assert codes[code] == (exponent, numeric), code
        else:
            codes[code] = (exponent, numeric)
    return root.get("Pblshd"), codes


def list_three():
    """ISO 4217 List Three: code -> (name, numeric, withdrawn). A withdrawal date is a month, a year,
    or a range of them ('1989 to 1990', '1990-07 to 1990-09'): the latest of its dates, compared as
    text. A code withdrawn in several entries (country by country) takes the entry with the latest
    date, and the first such entry when two tie."""
    root = read_xml("iso4217-list-three.xml")
    entries = {}
    for entry in root.iter("HstrcCcyNtry"):
        code = entry.findtext("Ccy")
        if code is None:
            continue
        dates = re.findall(r"\b\d{4}(?:-\d{2}\b)?", entry.findtext("WthdrwlDt") or "")
        assert dates, code
        withdrawn = sorted(dates)[-1]
        name = entry.findtext("CcyNm").strip()
        numeric = entry.findtext("CcyNbr")
        numeric = numeric.strip() if numeric is not None else None
        if code not in entries or entries[code][2] < withdrawn:
            entries[code] = (name, numeric, withdrawn)
    return root.get("Pblshd"), entries


def historic(active: dict) -> dict:
    """the historic table: data/historic.json's codes with List Three's name, numeric code and date,
    and the non-ISO codes with their own name"""
    data = read_json("historic.json")
    _, three = list_three()
    table = {}
    for code, exponent in data["exponents"].items():
        assert code in three and code not in active, code
        name, numeric, withdrawn = three[code]
        table[code] = {"exponent": exponent, "name": name, "numeric": numeric, "withdrawn": withdrawn}
    for code, entry in data["nonIso"].items():
        assert code not in three and code not in active, code
        table[code] = {"exponent": entry["exponent"], "name": entry["name"], "numeric": None, "withdrawn": None}
    return table


def cldr_cash() -> dict:
    return read_json("cldr-cash.json")["currencies"]


def territories() -> dict:
    regions = read_json("cldr-territories.json")["regions"]
    assert list(regions) == sorted(regions)
    return regions


def crypto(active: dict) -> dict:
    units = read_json("crypto-units.json")["units"]
    assert not set(units) & set(active)
    return units


def cash_rules(active: dict) -> list:
    """the cash rules, each increment in the currency's ISO minor units"""
    rules = []
    for rule in read_json("cash-rounding.json")["rules"]:
        exponent = active[rule["currency"]][0]
        whole, _, fraction = rule["increment"].partition(".")
        assert len(fraction) <= exponent, rule
        rules.append({
            "currency": rule["currency"],
            "increment": int(whole + fraction.ljust(exponent, "0")),
            "countries": rule["countries"],
            "verified": rule["verified"],
            "rounding": rule.get("rounding", "halfExpand"),
        })
    return rules


# --- helpers ------------------------------------------------------------------------------------


def round_fraction(value: Fraction, scale: int, mode: str) -> int:
    """value rounded once to `scale` decimals with ducat's rounding `mode`, in units of 10^-scale"""
    scaled = value * 10**scale
    floor = scaled.numerator // scaled.denominator
    remainder = scaled - floor
    if remainder == 0:
        return floor
    ceil = floor + 1
    negative = scaled < 0
    toward_zero = ceil if negative else floor
    away = floor if negative else ceil
    directed = {"floor": floor, "ceil": ceil, "trunc": toward_zero, "expand": away}
    if mode in directed:
        return directed[mode]
    if remainder < Fraction(1, 2):
        return floor
    if remainder > Fraction(1, 2):
        return ceil
    ties = {"halfEven": floor if floor % 2 == 0 else ceil, "halfExpand": away, "halfTrunc": toward_zero, "halfCeil": ceil, "halfFloor": floor}
    return ties[mode]


def plain(units: int, scale: int) -> str:
    sign = "-" if units < 0 else ""
    digits = str(abs(units)).rjust(scale + 1, "0")
    return sign + digits if scale == 0 else f"{sign}{digits[:-scale]}.{digits[-scale:]}"


def places(text: str) -> int:
    return len(text.split(".")[1]) if "." in text else 0


# --- currency/data.json -------------------------------------------------------------------------


def figures(active, table, cldr, crypto_units, rules) -> list:
    """every code the data knows, with each figure in its own field"""
    codes = sorted(set(active) | set(table) | set(cldr) | set(crypto_units) | {"XYZ"})
    rows = []
    for code in codes:
        iso = active.get(code)
        row = {
            "code": code,
            "iso": None if iso is None else {"exponent": iso[0], "numeric": iso[1]},
            "historic": table.get(code),
            "cldr": cldr.get(code),
            # the code's cash rules, in table order: a figure of their own, never the exponent's
            "cash": [{key: rule[key] for key in ["increment", "countries", "verified", "rounding"]} for rule in rules if rule["currency"] == code],
            "minorUnit": None if iso is None or iso[0] is None else plain(1, iso[0]),
        }
        rows.append(row)
    return rows


def from_numeric(rng, active) -> list:
    """the active code with a numeric code, from its text or number: '008', '8' and 8 are ALL"""
    by_numeric = {}
    for code, (_, numeric) in sorted(active.items()):
        assert numeric not in by_numeric, numeric
        by_numeric[numeric] = code
    rows = []
    for numeric, code in sorted(by_numeric.items()):
        rows.append({"numeric": numeric, "currency": code})
        if numeric.startswith("0"):
            rows.append({"numeric": numeric.lstrip("0") or "0", "currency": code})
    # numbers ISO doesn't assign, and text that isn't a numeric code at all
    unassigned = [number for number in range(1000) if f"{number:03d}" not in by_numeric]
    for number in rng.sample(unassigned, 20):
        rows.append({"numeric": str(number), "currency": None})
    for text in ["1000", "abc", "-1", "", "9.5", "0x10", " 978 "]:
        stripped = text.strip()
        valid = re.fullmatch(r"\d{1,3}", stripped) is not None
        rows.append({"numeric": text, "currency": by_numeric.get(stripped.zfill(3)) if valid else "throws"})
    return rows


def territory_use(use: dict) -> dict:
    return {"currency": use["currency"], "from": use.get("from"), "to": use.get("to"), "tender": use.get("tender", True)}


def wanted(use: dict, on, include_non_tender: bool) -> bool:
    if not use["tender"] and not include_non_tender:
        return False
    if on is None:
        return True
    # 'YYYY-MM-DD' strings compare in date order; an unknown start counts as "always"
    return (use["from"] is None or use["from"] <= on) and (use["to"] is None or on <= use["to"])


def random_day(rng) -> str:
    return f"{rng.randint(1900, 2030):04d}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}"


def territory_currencies(rng, regions) -> list:
    rows = []

    def row(territory, on=None, include=None):
        entry = {"territory": territory}
        if on is not None:
            entry["on"] = on
        if include is not None:
            entry["includeNonTender"] = include
        if on is not None and re.fullmatch(r"\d{4}-\d{2}-\d{2}", on) is None:
            entry["currencies"] = None
        else:
            uses = [territory_use(use) for use in regions.get(territory, [])]
            entry["currencies"] = [use for use in uses if wanted(use, on, include is True)]
        rows.append(entry)

    for territory in regions:
        row(territory)
    names = list(regions)
    for _ in range(80):
        row(rng.choice(names), on=random_day(rng))
    for territory in [name for name in names if any(use.get("tender") is False for use in regions[name])]:
        row(territory, include=True)
    row("DE", on="2001-06-01")
    row("DE", on="1990-01-01")
    row("ZZ")
    row("DE", on="2001-6-1")
    return rows


def currency_territories(rng, regions) -> list:
    currencies = sorted({use["currency"] for uses in regions.values() for use in uses})
    rows = []

    def row(currency, on=None, include=None):
        entry = {"currency": currency}
        if on is not None:
            entry["on"] = on
        if include is not None:
            entry["includeNonTender"] = include
        entry["territories"] = [
            territory
            for territory, uses in regions.items()
            if any(use["currency"] == currency and wanted(territory_use(use), on, include is True) for use in uses)
        ]
        rows.append(entry)

    for currency in currencies:
        row(currency)
    for _ in range(60):
        row(rng.choice(currencies), on=random_day(rng))
    for currency in ["CHE", "CHW", "USN", "CLF", "UYI"]:
        row(currency, include=True)
    row("XYZ")
    return rows


def crypto_unit(crypto_units) -> list:
    rows = []
    for code in sorted(crypto_units) + ["EUR", "btc", "XYZ"]:
        unit = crypto_units.get(code)
        rows.append({
            "code": code,
            "unit": None
            if unit is None
            else {
                "name": unit["name"],
                "decimals": unit["decimals"],
                "baseUnit": unit.get("baseUnit"),
                "network": unit["network"],
                "contract": unit.get("contract"),
            },
        })
    return rows


def to_base_units(rng, crypto_units) -> list:
    rows = []
    for _ in range(80):
        code = rng.choice(sorted(crypto_units))
        decimals = crypto_units[code]["decimals"]
        scale = rng.randint(0, decimals + 3)
        units = rng.randint(-(10**25), 10**25)
        if scale > decimals and rng.random() < 0.5:
            units -= units % 10 ** (scale - decimals)
        amount = plain(units, scale)
        exact = Fraction(units, 10**scale) * 10**decimals
        rows.append({"code": code, "amount": amount, "baseUnits": str(exact.numerator) if exact.denominator == 1 else None})
    return rows


def from_base_units(rng, crypto_units) -> list:
    rows = []
    for _ in range(60):
        code = rng.choice(sorted(crypto_units))
        units = rng.randint(-(10**30), 10**30)
        rows.append({"code": code, "units": str(units), "amount": plain(units, crypto_units[code]["decimals"])})
    # parsed strictly: digits with an optional minus sign, no leading zeros
    for text in ["0", "-0", "007", "+1", "1.0", "1e3", " 1", "1_000", "", "-"]:
        valid = re.fullmatch(r"-?(?:0|[1-9]\d*)", text) is not None
        rows.append({"code": "BTC", "units": text, "amount": plain(int(text), 8) if valid else None})
    return rows


# --- cash/rules.json ----------------------------------------------------------------------------


def cash_rule_for(rules, currency, country=None, include_unverified=True):
    """ducat's cashRule: with a country, the first of the currency's rules that lists it; without, the
    first of its rules, except for EUR, which has no euro-wide rule. A rule only backed by secondary
    sources doesn't apply with includeUnverified false."""
    candidates = [rule for rule in rules if rule["currency"] == currency]
    if country is not None:
        found = next((rule for rule in candidates if country in rule["countries"]), None)
    else:
        found = None if currency == "EUR" or not candidates else candidates[0]
    if found is not None and not include_unverified and not found["verified"]:
        return None
    return found


def cash_rule_rows(active, rules) -> list:
    rows = []
    keys = []
    for currency in dict.fromkeys(rule["currency"] for rule in rules):
        keys.append((currency, None))
        for rule in rules:
            if rule["currency"] == currency:
                for country in rule["countries"]:
                    keys.append((currency, country))
    keys += [("CHF", "DE"), ("EUR", "DE"), ("GBP", None), ("JPY", None), ("KWD", None), ("HUF", "AT"), ("USD", "EC")]
    for currency, country in keys:
        for include in [True, False]:
            exponent = active[currency][0]
            rule = cash_rule_for(rules, currency, country, include)
            row = {"currency": currency}
            if country is not None:
                row["country"] = country
            if not include:
                row["includeUnverified"] = False
            row["rule"] = None if rule is None else {key: rule[key] for key in ["increment", "countries", "verified", "rounding"]}
            row["cashUnit"] = plain(rule["increment"] if rule else 1, exponent)
            row["cashDigits"] = (0 if rule["increment"] % 10**exponent == 0 else exponent) if rule else exponent
            row["policy"] = None if rule is None else {"scale": exponent, "increment": rule["increment"], "rounding": rule["rounding"]}
            rows.append(row)
    return rows


def cash_round_rows(rng, active, rules) -> list:
    rows = []
    pairs = [(rule["currency"], country) for rule in rules for country in rule["countries"]]
    pairs += [(rule["currency"], None) for rule in rules] + [("EUR", None), ("GBP", None), ("CHF", "DE")]
    for _ in range(300):
        currency, country = rng.choice(pairs)
        exponent = active[currency][0]
        scale = max(0, exponent + rng.randint(-1, 3))
        units = rng.randint(-(10**9), 10**9)
        amount = plain(units, scale)
        value = Fraction(units, 10**scale)
        row = {"currency": currency, "amount": amount}
        if country is not None:
            row["country"] = country
        mode = None
        if rng.random() < 0.3:
            mode = rng.choice(MODES)
            row["rounding"] = mode
        include = rng.random() < 0.8
        if not include:
            row["includeUnverified"] = False
        rule = cash_rule_for(rules, currency, country, include)
        if rule is None:
            # no rule: cashRound leaves the amount as it is, and there is no cash policy
            row["cashRound"] = amount
            row["policy"] = None
        else:
            tie = mode or rule["rounding"]
            step = Fraction(rule["increment"], 10**exponent)
            steps = round_fraction(value / step, 0, tie)
            # cashRound keeps the larger of the two scales; the policy lands on the exponent
            row["cashRound"] = plain(int(steps * step * 10 ** max(scale, exponent)), max(scale, exponent))
            row["policy"] = plain(steps * rule["increment"], exponent)
        rows.append(row)
    return rows


def main() -> None:
    rng = random.Random(SEED)
    published, active = list_one()
    three_published, _ = list_three()
    table = historic(active)
    cldr = cldr_cash()
    regions = territories()
    crypto_units = crypto(active)
    rules = cash_rules(active)
    provenance = {
        "source": "reference-data",
        "generator": {"name": "scripts/gen-currency-data-vectors.py", "version": f"{GENERATOR_VERSION} (seed {SEED})"},
        "method": "Read from data/ with Python's standard library (json, xml.etree), independently of ducat's generator: ISO 4217 List One and List Three, data/historic.json, CLDR's territories and cash fractions, the crypto units and the cash-rounding rules, each figure kept in its own field.",
        "data": {"iso4217": published, "iso4217ListThree": three_published, "cldr": CLDR_RELEASE},
    }
    data_tables = [
        {"op": "currency.figures", "rows": figures(active, table, cldr, crypto_units, rules)},
        {"op": "currency.fromNumeric", "rows": from_numeric(rng, active)},
        {"op": "territory.currencies", "rows": territory_currencies(rng, regions)},
        {"op": "currency.territories", "rows": currency_territories(rng, regions)},
        {"op": "crypto.unit", "rows": crypto_unit(crypto_units)},
        {"op": "crypto.toBaseUnits", "rows": to_base_units(rng, crypto_units)},
        {"op": "crypto.fromBaseUnits", "rows": from_base_units(rng, crypto_units)},
    ]
    cash_tables = [
        {"op": "cash.rule", "rows": cash_rule_rows(active, rules)},
        {"op": "cash.round", "rows": cash_round_rows(rng, active, rules)},
    ]
    texts = {
        vector_path("currency", "data"): file_text(
            "currency",
            "data",
            "Currency data from data/: ISO 4217 exponents and numeric codes, withdrawn and non-ISO codes with the exponent ISO gave them, CLDR's cash fractions, the currencies of each territory, and crypto units with their base units.",
            provenance,
            data_tables,
        ),
        vector_path("cash", "rules"): file_text(
            "cash",
            "rules",
            "The cash-rounding rules (data/cash-rounding.json) by currency and country, their cash units, digits and policies, and amounts rounded through them.",
            provenance,
            cash_tables,
        ),
    }
    write_or_check(texts, "python3 scripts/gen-currency-data-vectors.py")


if __name__ == "__main__":
    main()
