#!/usr/bin/env python3
"""Reference vectors for ducat's payment-processor amounts, computed with Python's standard library
from the processors' rules in data/ (stripe, adyen, checkout, paypal, braintree and klarna .json) and
the definitions in ducat's docs (docs/reference/processors.md, docs/explanation/decisions.md),
independently of ducat's TypeScript and its generator:

    spec/vectors/processors/rules.json

checked by test/spec.test.ts and the Rust port's rust/crates/ducat/tests/spec.rs.

Deterministic: the same seed always writes the same files. Regenerate with
    python3 scripts/gen-processor-vectors.py
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

SEED = 20261117
# bumped when the output's layout changes; the values depend only on the seed and data/
GENERATOR_VERSION = "1"
MODES = ["halfEven", "halfExpand", "halfTrunc", "halfCeil", "halfFloor", "expand", "trunc", "ceil", "floor"]
PROCESSORS = ["stripe", "adyen", "checkout", "paypal", "braintree", "klarna"]
# the processors whose amount is an integer at the processor's exponent; the others take a decimal
# string in major units
INTEGER = {"stripe", "adyen", "checkout", "klarna"}
# which signs each accepts, checked after rounding (docs/reference/processors.md, "Signs")
SIGNS = {"stripe": "any", "adyen": "any", "checkout": "nonNegative", "paypal": "nonNegative", "braintree": "positive", "klarna": "any"}
# currency codes are read case-insensitively, except by Adyen, whose table is looked up as given
CASE_SENSITIVE = {"adyen"}
MAX_SAFE = 2**53 - 1


def read_json(name: str):
    return json.loads((ROOT / "data" / name).read_text(encoding="utf-8"))


def iso_exponents() -> dict:
    root = ElementTree.parse(ROOT / "data" / "iso4217-list-one.xml").getroot()
    exponents = {}
    for entry in root.iter("CcyNtry"):
        code = entry.findtext("Ccy")
        units = (entry.findtext("CcyMnrUnts") or "").strip()
        if code is not None and units != "N.A.":
            exponents[code] = int(units)
    return exponents


def historic_exponents() -> dict:
    data = read_json("historic.json")
    exponents = dict(data["exponents"])
    exponents.update({code: entry["exponent"] for code, entry in data["nonIso"].items()})
    return exponents


# --- each processor's rules: code -> (exponent, multiple, context multiple) ---------------------


def stripe_rules() -> dict:
    """Two decimals unless listed: zero-decimal, three-decimal (last digit 0: a multiple of 10), and
    the special cases' API exponents. ISK and UGX are sent as two-decimal values ending in 00 (a
    multiple of 100, decisions.md "Stripe UGX is x100"); HUF and TWD payouts are whole units (a
    payout multiple of 100). The context multiple is the payout's."""
    data = read_json("stripe.json")
    rules = {}
    for code in data["presentment"]:
        exponent, charge, payout = data["defaultExponent"], 1, 1
        if code in data["zeroDecimal"]:
            exponent = 0
        if code in data["threeDecimal"]:
            exponent, charge, payout = 3, 10, 10
        special = data["specialCases"].get(code)
        if special is not None:
            exponent = special["apiExponent"]
            if code in ("ISK", "UGX"):
                charge = payout = 100
            if code in ("HUF", "TWD"):
                payout = 100
        rules[code] = (exponent, charge, payout)
    return rules


def adyen_rules() -> dict:
    return {code: (exponent, 1, 1) for code, exponent in read_json("adyen.json")["exponents"].items()}


def checkout_rules() -> dict:
    """The listed exponents, 2 for every other currency; a payment's multiple (10 for the
    three-decimal currencies, 100 for CLP); the context multiple is the Standalone API's (CLP 1)."""
    data = read_json("checkout.json")
    rules = {}
    for code in data["currencies"]:
        multiple = data["multiples"].get(code, 1)
        rules[code] = (data["exponents"].get(code, data["defaultExponent"]), multiple, data["standaloneMultiples"].get(code, multiple))
    return rules


def iso_default_rules(name: str, iso: dict) -> dict:
    """PayPal, Braintree and Klarna: the listed exponents, the ISO exponent for the others"""
    data = read_json(f"{name}.json")
    assert data["defaultExponent"] == "iso"
    exponents = data.get("exponents", {})
    return {code: (exponents.get(code, iso.get(code)), 1, 1) for code in data["currencies"]}


# --- arithmetic ---------------------------------------------------------------------------------


def round_units(value: Fraction, mode: str) -> int:
    """value rounded once to an integer with ducat's rounding `mode`; None for 'unnecessary' when
    inexact"""
    floor = value.numerator // value.denominator
    remainder = value - floor
    if remainder == 0:
        return floor
    if mode == "unnecessary":
        return None
    ceil = floor + 1
    negative = value < 0
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


def to_wire(processor: str, rule, units: int, scale: int, mode: str, context: bool):
    """(wire, error): the amount at the processor's exponent, rescaled with `mode` and then made a
    multiple of the processor's multiple with it, each step rounding once ('unnecessary' refuses),
    its sign checked after rounding; an integer beyond 2^53 - 1, and more than 15 digits before
    PayPal's point, are range errors"""
    exponent, multiple, context_multiple = rule
    multiple = context_multiple if context else multiple
    if exponent >= scale:
        minor = units * 10 ** (exponent - scale)
    else:
        minor = round_units(Fraction(units, 10 ** (scale - exponent)), mode)
        if minor is None:
            return None, "rounding"
    if minor % multiple != 0:
        steps = round_units(Fraction(minor, multiple), mode)
        if steps is None:
            return None, "rounding"
        minor = steps * multiple
    if processor in INTEGER and abs(minor) > MAX_SAFE:
        return None, "range"
    sign = SIGNS[processor]
    if sign != "any" and minor < 0:
        return None, "range"
    if sign == "positive" and minor == 0:
        return None, "range"
    if processor in INTEGER:
        return str(minor), None
    text = plain(minor, exponent)
    if processor == "paypal" and len(text.lstrip("-").split(".")[0]) > 15:
        return None, "range"
    return text, None


def at_iso_scale_when_exact(units: int, scale: int, iso_exponent: int) -> str:
    """the value at the currency's exponent when that is exact, else at the scale it came with"""
    if iso_exponent >= scale:
        return plain(units * 10 ** (iso_exponent - scale), iso_exponent)
    divisor = 10 ** (scale - iso_exponent)
    return plain(units // divisor, iso_exponent) if units % divisor == 0 else plain(units, scale)


PAYPAL_PATTERN = re.compile(r"((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))")
BRAINTREE_PATTERN = re.compile(r"[0-9]+(\.[0-9]+)?")


def from_wire(processor: str, rule, wire: str, exponent_of_currency: int):
    """(amount, error): a processor's amount back as money, at the currency's exponent when exact"""
    if processor in INTEGER:
        return at_iso_scale_when_exact(int(wire), rule[0], exponent_of_currency), None
    pattern = PAYPAL_PATTERN if processor == "paypal" else BRAINTREE_PATTERN
    if (processor == "paypal" and len(wire) > 32) or pattern.fullmatch(wire) is None:
        return None, "syntax"
    negative = wire.startswith("-")
    whole, _, fraction = wire.lstrip("-").partition(".")
    units = int((whole or "0") + fraction) * (-1 if negative else 1)
    return at_iso_scale_when_exact(units, len(fraction), exponent_of_currency), None


# --- the tables ---------------------------------------------------------------------------------


def rule_rows(rules: dict) -> list:
    rows = []
    for processor in PROCESSORS:
        table = rules[processor]
        for code in sorted(table):
            exponent, multiple, context = table[code]
            rows.append({"processor": processor, "currency": code, "exponent": exponent, "multiple": multiple, "contextMultiple": context})
        for code in ["XYZ", "XAU", "usd" if processor != "klarna" else "eur"]:
            listed = code.upper() in table and processor not in CASE_SENSITIVE
            exponent, multiple, context = table[code.upper()] if listed else (None, None, None)
            rows.append({"processor": processor, "currency": code, "exponent": exponent, "multiple": multiple, "contextMultiple": context})
    return rows


def usable(code: str, iso: dict, historic: dict):
    """the exponent money in `code` has in ducat (ISO, or the historic table's), or None"""
    return iso.get(code, historic.get(code))


def random_amount(rng, exponent: int) -> tuple[int, int]:
    """(units, scale): mostly at the currency's exponent, sometimes finer or coarser"""
    scale = max(0, exponent + rng.choice([0, 0, 0, 1, 2, 3, -1, -2]))
    bound = rng.choice([10**4, 10**8, 10**12, 10**17])
    units = rng.randint(-bound, bound)
    if rng.random() < 0.15:
        units = abs(units)
    if rng.random() < 0.05:
        units = 0
    return units, scale


def to_rows(rng, rules: dict, iso: dict, historic: dict) -> list:
    rows = []
    for processor in PROCESSORS:
        table = rules[processor]
        codes = sorted(code for code in table if usable(code, iso, historic) is not None)
        # every code once, then the codes with exceptions again, and a random sample
        special = [code for code in codes if table[code][0] != usable(code, iso, historic) or table[code][1] != 1 or table[code][2] != 1]
        picks = codes + special * 4 + [rng.choice(codes) for _ in range(40)]
        for code in picks:
            exponent = usable(code, iso, historic)
            units, scale = random_amount(rng, exponent)
            row = {"processor": processor, "currency": code, "amount": plain(units, scale)}
            context = False
            if processor in ("stripe", "checkout") and rng.random() < 0.3:
                context = True
                row["payout" if processor == "stripe" else "standalone"] = True
            mode = "unnecessary" if rng.random() < 0.4 else rng.choice(MODES)
            if mode != "unnecessary":
                row["rounding"] = mode
            row["wire"], row["error"] = to_wire(processor, table[code], units, scale, mode, context)
            rows.append(row)
        # ISO currencies the processor doesn't list: refused, whatever the amount
        for code in [code for code in sorted(iso) if code not in table][:3]:
            rows.append({"processor": processor, "currency": code, "amount": plain(100, iso[code]), "wire": None, "error": "range"})
    return rows


def from_rows(rng, rules: dict, iso: dict, historic: dict) -> list:
    rows = []
    for processor in PROCESSORS:
        table = rules[processor]
        codes = sorted(code for code in table if usable(code, iso, historic) is not None)
        for code in codes + [rng.choice(codes) for _ in range(30)]:
            exponent = table[code][0]
            currency_exponent = usable(code, iso, historic)
            units = rng.randint(-(10**12), 10**12)
            if processor in INTEGER:
                wire = str(units)
            else:
                wire = plain(abs(units) if processor == "braintree" else units, rng.choice([exponent, exponent, max(0, exponent - 1), exponent + 1, exponent + 3]))
            amount, error = from_wire(processor, table[code], wire, currency_exponent)
            rows.append({"processor": processor, "currency": code, "wire": wire, "amount": amount, "error": error})
        if processor not in CASE_SENSITIVE:
            code = codes[0]
            amount, error = from_wire(processor, table[code], "100", usable(code, iso, historic))
            rows.append({"processor": processor, "currency": code.lower(), "wire": "100", "amount": amount, "error": error})
        else:
            rows.append({"processor": processor, "currency": codes[0].lower(), "wire": "100", "amount": None, "error": "range"})
        if processor not in INTEGER:
            code = "USD"
            for wire in ["10", "10.00", ".5", "-1.50", "1.", "1e3", "+1", " 1", "1,00", "", "0.123", "1" * 33]:
                amount, error = from_wire(processor, table[code], wire, iso[code])
                rows.append({"processor": processor, "currency": code, "wire": wire, "amount": amount, "error": error})
    return rows


def main() -> None:
    rng = random.Random(SEED)
    iso = iso_exponents()
    historic = historic_exponents()
    rules = {
        "stripe": stripe_rules(),
        "adyen": adyen_rules(),
        "checkout": checkout_rules(),
        "paypal": iso_default_rules("paypal", iso),
        "braintree": iso_default_rules("braintree", iso),
        "klarna": iso_default_rules("klarna", iso),
    }
    for processor, table in rules.items():
        assert all(isinstance(rule[0], int) for rule in table.values()), processor
    provenance = {
        "source": "reference-data",
        "generator": {"name": "scripts/gen-processor-vectors.py", "version": f"{GENERATOR_VERSION} (seed {SEED})"},
        "method": "The processors' rules read from data/ with Python's standard library, independently of ducat's generator, and each amount computed from them and the definitions in ducat's processor docs with exact integers and Fractions.",
        "data": {"iso4217": ElementTree.parse(ROOT / "data" / "iso4217-list-one.xml").getroot().get("Pblshd")},
    }
    tables = [
        {"op": "processor.rule", "rows": rule_rows(rules)},
        {"op": "processor.toWire", "rows": to_rows(rng, rules, iso, historic)},
        {"op": "processor.fromWire", "rows": from_rows(rng, rules, iso, historic)},
    ]
    texts = {
        vector_path("processors", "rules"): file_text(
            "processors",
            "rules",
            "Payment-processor amounts (Stripe, Adyen, Checkout.com, PayPal, Braintree, Klarna): each processor's exponent and multiples per currency, money to the processor's amount (exact, rounded in a mode, or refused without one), and the processor's amount back to money.",
            provenance,
            tables,
        ),
    }
    write_or_check(texts, "python3 scripts/gen-processor-vectors.py")


if __name__ == "__main__":
    main()
