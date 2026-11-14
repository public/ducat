#!/usr/bin/env python3
"""Reference vectors for ducat's wire formats, computed with Python's standard library and
fractions from the formats' published definitions, independently of ducat's TypeScript:

- google.type.Money (https://github.com/googleapis/googleapis/blob/master/google/type/money.proto):
  `units` an int64, `nanos` from -999,999,999 to +999,999,999 with the sign of a non-zero `units`,
  in its ProtoJSON form (https://protobuf.dev/programming-guides/json/: int64 written as a string;
  int32 and int64 read from numbers or strings, exponent notation included);
- ISO 20022's ActiveOrHistoricCurrencyAndAmount (https://www.iso20022.org, the XML schemas'
  simple type: xs:decimal with fractionDigits 5, totalDigits 18, minInclusive 0, and an ISO 4217
  code; xs:decimal's lexical form per https://www.w3.org/TR/xmlschema-2/#decimal);
- ISO 4217 minor units as `{ value, currency }`;
- dinero.js 1's `toObject()` shape `{ amount, currency, precision }`
  (https://v1.dinerojs.com/module-dinero#~toObject).

    spec/vectors/wire/formats.json

checked by test/spec.test.ts and the Rust port's rust/crates/ducat/tests/spec.rs.

Deterministic: regenerate with
    python3 scripts/gen-wire-vectors.py
and check that nothing changed with --check.
"""
import json
import random
import re
import sys
import xml.etree.ElementTree as ElementTree
from fractions import Fraction

sys.dont_write_bytecode = True  # no __pycache__ in scripts/
from spec_vectors import ISO4217_PUBLISHED, ROOT, file_text, vector_path, write_or_check  # noqa: E402

SEED = 20261119
GENERATOR_VERSION = "1"
MODES = ["halfEven", "halfExpand", "halfTrunc", "halfCeil", "halfFloor", "expand", "trunc", "ceil", "floor"]
INT64 = 2**63
SAFE = 2**53 - 1
NANOS = 10**9


def iso_exponents() -> dict:
    root = ElementTree.parse(ROOT / "data" / "iso4217-list-one.xml").getroot()
    out = {}
    for entry in root.iter("CcyNtry"):
        code, units = entry.findtext("Ccy"), (entry.findtext("CcyMnrUnts") or "").strip()
        if code is not None and units != "N.A.":
            out[code] = int(units)
    return out


EXPONENT = iso_exponents()
HISTORIC = json.loads((ROOT / "data" / "historic.json").read_text())["exponents"]
# withdrawn ISO codes (List Three) a program may hold: their exponent while current
EXPONENT_ALL = {**HISTORIC, **EXPONENT}
CURRENCIES = ["EUR", "USD", "JPY", "KWD", "BHD", "CLF", "GBP"]


class Refused(Exception):
    def __init__(self, kind):
        super().__init__(kind)
        self.kind = kind


def round_integer(value: Fraction, mode: str) -> int:
    floor = value.numerator // value.denominator
    rest = value - floor
    if rest == 0:
        return floor
    if mode == "unnecessary":
        raise Refused("rounding")
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


def at_scale(value: Fraction, scale: int, mode: str) -> str:
    return scaled(round_integer(value * 10**scale, mode), scale)


# --- google.type.Money -------------------------------------------------------------------------

PROTO_INTEGER = re.compile(r"^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$")


def proto_integer(value):
    """A ProtoJSON integer: a JSON number or a string of one, whose value is an integer."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        exact = Fraction(repr(value))
        return exact.numerator if exact.denominator == 1 else None
    if isinstance(value, str) and PROTO_INTEGER.match(value):
        mantissa, _, exponent = value.lower().partition("e")
        if exponent and abs(int(exponent)) > 1000:
            return None
        exact = Fraction(mantissa) * Fraction(10) ** int(exponent or "0")
        return exact.numerator if exact.denominator == 1 else None
    return None


def to_google(amount: str, currency: str, mode: str) -> dict:
    total = round_integer(Fraction(amount) * NANOS, mode)
    units = abs(total) // NANOS * (1 if total >= 0 else -1)
    nanos = total - units * NANOS
    if not -INT64 <= units < INT64:
        raise Refused("range")
    return {"currencyCode": currency, "units": str(units), "nanos": nanos}


def from_google(wire: dict, options: dict) -> str:
    code = wire.get("currencyCode")
    if not isinstance(code, str) or not re.match(r"^[A-Z]{3}$", code):
        raise Refused("range")
    units, nanos = proto_integer(wire.get("units", 0)), proto_integer(wire.get("nanos", 0))
    if units is None or not -INT64 <= units < INT64:
        raise Refused("range")
    if nanos is None or not -999_999_999 <= nanos <= 999_999_999:
        raise Refused("range")
    if (units > 0 and nanos < 0) or (units < 0 and nanos > 0):
        raise Refused("range")
    scale = options.get("scale", EXPONENT[code])
    return at_scale(Fraction(units * NANOS + nanos, NANOS), scale, options.get("rounding", "unnecessary"))


# --- ISO 20022 ---------------------------------------------------------------------------------

ISO_AMOUNT = re.compile(r"^([+-]?)(\d+)(?:\.(\d+))?$")


def iso_code(code: str) -> int:
    if code in EXPONENT_ALL:
        return EXPONENT_ALL[code]
    raise Refused("range")


def fits(whole: str, fraction: str) -> bool:
    fraction, whole = fraction.rstrip("0"), whole.lstrip("0")
    return len(fraction) <= 5 and len(whole) + len(fraction) <= 18


def to_iso(amount: str, currency: str, mode: str, scale) -> dict:
    exponent = iso_code(currency)
    scale = exponent if scale is None else scale
    if not 0 <= scale <= 5:
        raise Refused("range")
    text = at_scale(Fraction(amount), scale, mode)
    if text.startswith("-"):
        raise Refused("range")
    whole, _, fraction = text.partition(".")
    if not fits(whole, fraction):
        raise Refused("range")
    return {"Ccy": currency, "value": text}


def from_iso(wire: dict, options: dict) -> str:
    code, value = wire["Ccy"], wire["value"]
    if not re.match(r"^[A-Z]{3}$", code):
        raise Refused("syntax")
    exponent = iso_code(code)
    match = ISO_AMOUNT.match(value)
    if match is None or not fits(match[2], match[3] or ""):
        raise Refused("syntax")
    exact = Fraction(f"{match[2]}.{match[3] or '0'}")
    if match[1] == "-" and exact != 0:
        raise Refused("range")
    return at_scale(exact, options.get("scale", exponent), options.get("rounding", "unnecessary"))


# --- minor units and dinero.js -----------------------------------------------------------------


def to_minor(amount: str, currency: str, mode: str) -> dict:
    value = round_integer(Fraction(amount) * 10 ** EXPONENT[currency], mode)
    if abs(value) > SAFE:
        raise Refused("range")
    return {"value": value, "currency": currency}


def from_minor(wire: dict) -> str:
    exponent = EXPONENT[wire["currency"]]
    return scaled(wire["value"], exponent)


def to_dinero(amount: str, currency: str) -> dict:
    places = places_of(amount)
    units = int(amount.replace(".", ""))
    if abs(units) > SAFE:
        raise Refused("range")
    return {"amount": units, "currency": currency, "precision": places}


def from_dinero(wire: dict) -> str:
    if not 0 <= wire["precision"] <= 1000:
        raise Refused("range")
    return scaled(wire["amount"], wire["precision"])


# --- rows --------------------------------------------------------------------------------------


def amount(rng, currency: str, extra: int = 0) -> str:
    places = EXPONENT[currency] + extra
    magnitude = rng.choice([10**3, 10**8, 10**15, 10**20])
    units = rng.randrange(-magnitude, magnitude)
    return scaled(units, places)


def attempt(row: dict, field: str, run) -> dict:
    try:
        return {**row, field: run(), "error": None}
    except Refused as refused:
        return {**row, field: None, "error": refused.kind}


def google_rows(rng):
    to_rows = [
        # money.proto's example: $-1.75 is units -1 and nanos -750,000,000
        {"amount": "-1.75", "currency": "USD"},
        {"amount": "0.000000001", "currency": "EUR"},
        {"amount": "-0.5", "currency": "EUR"},
        {"amount": "9223372036854775807.999999999", "currency": "USD"},
        {"amount": "9223372036854775808", "currency": "USD"},
        {"amount": "-9223372036854775808.5", "currency": "USD"},
        {"amount": "1.0000000005", "currency": "EUR"},
        {"amount": "1.0000000005", "currency": "EUR", "rounding": "halfEven"},
        {"amount": "1.0000000015", "currency": "EUR", "rounding": "halfEven"},
        {"amount": "0.00", "currency": "EUR"},
    ]
    while len(to_rows) < 120:
        currency = rng.choice(CURRENCIES)
        row = {"amount": amount(rng, currency, rng.choice([0, 0, 3, 8, 10])), "currency": currency}
        if rng.random() < 0.4:
            row["rounding"] = rng.choice(MODES)
        to_rows.append(row)
    to_out = [attempt(row, "wire", lambda row=row: to_google(row["amount"], row["currency"], row.get("rounding", "unnecessary"))) for row in to_rows]

    from_rows = [
        {"wire": {"currencyCode": "USD", "units": "-1", "nanos": -750000000}},
        {"wire": {"currencyCode": "USD", "units": "12", "nanos": 340000000}},
        {"wire": {"currencyCode": "USD", "units": 5}},
        {"wire": {"currencyCode": "USD", "nanos": -10000000}},
        {"wire": {"currencyCode": "USD", "units": "0", "nanos": -10000000}},
        {"wire": {"currencyCode": "EUR", "units": "12", "nanos": "340000000"}},
        {"wire": {"currencyCode": "EUR", "units": "1.2e1", "nanos": "3.4e8"}},
        {"wire": {"currencyCode": "EUR", "units": 12.0, "nanos": 340000000.0}},
        {"wire": {"currencyCode": "EUR", "units": "120e-1", "nanos": "340000000.0"}},
        {"wire": {"currencyCode": "EUR", "units": "-1", "nanos": "-75e7"}},
        {"wire": {"currencyCode": "EUR", "units": "9223372036854775807"}},
        {"wire": {"currencyCode": "EUR", "units": "9.223372036854775807e18"}},
        {"wire": {"currencyCode": "EUR", "units": "-9223372036854775808"}},
        {"wire": {"currencyCode": "EUR", "units": "9007199254740993"}},
        {"wire": {"currencyCode": "EUR", "units": "1", "nanos": 5000000}, "options": {"scale": 3}},
        {"wire": {"currencyCode": "EUR", "units": "1", "nanos": 5000000}},
        {"wire": {"currencyCode": "EUR", "units": "1", "nanos": 5000000}, "options": {"rounding": "halfEven"}},
        {"wire": {"currencyCode": "EUR", "units": "1", "nanos": 5000000}, "options": {"rounding": "ceil"}},
        {"wire": {"currencyCode": "JPY", "units": "1", "nanos": 500000000}, "options": {"rounding": "halfExpand"}},
    ]
    for bad in [
        {"currencyCode": "eur", "units": "1"},
        {"currencyCode": "EUR", "units": "1.5"},
        {"currencyCode": "EUR", "units": "1.5e0"},
        {"currencyCode": "EUR", "units": " 1"},
        {"currencyCode": "EUR", "units": "+1"},
        {"currencyCode": "EUR", "units": "1e"},
        {"currencyCode": "EUR", "units": ""},
        {"currencyCode": "EUR", "units": 1.5},
        {"currencyCode": "EUR", "units": "9223372036854775808"},
        {"currencyCode": "EUR", "units": "1e19"},
        {"currencyCode": "EUR", "units": "1e999999999"},
        {"currencyCode": "EUR", "units": "1", "nanos": 1000000000},
        {"currencyCode": "EUR", "units": "1", "nanos": "1e9"},
        {"currencyCode": "EUR", "units": "1", "nanos": 0.5},
        {"currencyCode": "EUR", "units": "1", "nanos": "0.5"},
        {"currencyCode": "EUR", "units": "1", "nanos": -1},
        {"currencyCode": "EUR", "units": "-1", "nanos": 1},
        {"currencyCode": "EUR", "units": "-1", "nanos": "1"},
    ]:
        from_rows.append({"wire": bad})
    while len(from_rows) < 120:
        currency = rng.choice(CURRENCIES)
        units = rng.randrange(-10**15, 10**15)
        nanos = 0 if units == 0 else (1 if units > 0 else -1) * rng.randrange(0, NANOS)
        if units == 0:
            nanos = rng.randrange(-NANOS + 1, NANOS)
        if rng.random() < 0.3:
            nanos = nanos // 10 ** (9 - EXPONENT[currency]) * 10 ** (9 - EXPONENT[currency]) if nanos >= 0 else -((-nanos) // 10 ** (9 - EXPONENT[currency]) * 10 ** (9 - EXPONENT[currency]))
        form = rng.randrange(3)
        wire = {"currencyCode": currency, "units": str(units) if form else units, "nanos": nanos if form != 2 else str(nanos)}
        row = {"wire": wire}
        if rng.random() < 0.4:
            row["options"] = {"rounding": rng.choice(MODES)}
        elif rng.random() < 0.2:
            row["options"] = {"scale": rng.randrange(0, 10)}
        from_rows.append(row)
    from_out = [attempt(row, "amount", lambda row=row: from_google(row["wire"], row.get("options", {}))) for row in from_rows]
    return to_out, from_out


def iso_rows(rng):
    to_rows = [
        {"amount": "12.34", "currency": "EUR"},
        {"amount": "12.3400", "currency": "EUR"},
        {"amount": "1000", "currency": "JPY"},
        {"amount": "1.234", "currency": "KWD"},
        {"amount": "12.345", "currency": "EUR"},
        {"amount": "12.345", "currency": "EUR", "rounding": "halfEven"},
        {"amount": "12.345", "currency": "EUR", "writeScale": 3},
        {"amount": "12.345", "currency": "EUR", "writeScale": 6},
        {"amount": "-12.34", "currency": "EUR"},
        {"amount": "-0.004", "currency": "EUR", "rounding": "halfEven"},
        {"amount": "9999999999999999.99", "currency": "EUR"},
        {"amount": "99999999999999999.99", "currency": "EUR"},
        {"amount": "1.0000", "currency": "CLF"},
        {"amount": "7.53450", "currency": "HRK"},
        {"amount": "1.5", "currency": "EUR", "writeScale": 5},
    ]
    while len(to_rows) < 100:
        currency = rng.choice(CURRENCIES)
        row = {"amount": amount(rng, currency, rng.choice([0, 0, 2])), "currency": currency}
        if rng.random() < 0.4:
            row["rounding"] = rng.choice(MODES)
        if rng.random() < 0.15:
            row["writeScale"] = rng.randrange(0, 7)
        to_rows.append(row)
    to_out = [attempt(row, "wire", lambda row=row: to_iso(row["amount"], row["currency"], row.get("rounding", "unnecessary"), row.get("writeScale"))) for row in to_rows]

    from_rows = [{"wire": {"Ccy": "EUR", "value": value}} for value in ["12.34", "12", "0012.3400", "+12.34", "+0012.3400", "-0", "-0.00", "0", "999999999999999999", "9999999999999.99999", "-1", "-0.01", "12.", ".5", "+.5", "-5.", "+-1", "+", "", "1e3", " 1", "1,00", "1.123456", "1" * 19, "12.345"]]
    from_rows += [
        {"wire": {"Ccy": "KWD", "value": "1.234"}},
        {"wire": {"Ccy": "EUR", "value": "12.345"}, "options": {"scale": 3}},
        {"wire": {"Ccy": "EUR", "value": "12.345"}, "options": {"rounding": "halfEven"}},
        {"wire": {"Ccy": "HRK", "value": "7.5345"}},
        {"wire": {"Ccy": "BTC", "value": "1"}},
        {"wire": {"Ccy": "CNH", "value": "1"}},
        {"wire": {"Ccy": "eur", "value": "1"}},
        {"wire": {"Ccy": "CLF", "value": "1.00005"}, "options": {"scale": 5}},
    ]
    while len(from_rows) < 100:
        currency = rng.choice(CURRENCIES)
        places = rng.randrange(0, 6)
        value = scaled(rng.randrange(0, 10 ** rng.randrange(1, 18)), places)
        if rng.random() < 0.2:
            value = "+" + value
        row = {"wire": {"Ccy": currency, "value": value}}
        if rng.random() < 0.4:
            row["options"] = {"rounding": rng.choice(MODES)}
        from_rows.append(row)
    from_out = [attempt(row, "amount", lambda row=row: from_iso(row["wire"], row.get("options", {}))) for row in from_rows]
    return to_out, from_out


def minor_rows(rng):
    to_rows = [{"amount": "12.34", "currency": "EUR"}, {"amount": "500", "currency": "JPY"}, {"amount": "12.345", "currency": "EUR"}, {"amount": "12.345", "currency": "EUR", "rounding": "halfEven"}, {"amount": "90071992547409.91", "currency": "USD"}, {"amount": "90071992547409.92", "currency": "USD"}, {"amount": "-90071992547409.91", "currency": "USD"}]
    while len(to_rows) < 50:
        currency = rng.choice(CURRENCIES)
        row = {"amount": amount(rng, currency, rng.choice([0, 0, 1])), "currency": currency}
        if rng.random() < 0.4:
            row["rounding"] = rng.choice(MODES)
        to_rows.append(row)
    to_out = [attempt(row, "wire", lambda row=row: to_minor(row["amount"], row["currency"], row.get("rounding", "unnecessary"))) for row in to_rows]
    from_rows = [{"wire": {"value": 1234, "currency": "EUR"}}, {"wire": {"value": 500, "currency": "JPY"}}, {"wire": {"value": -5, "currency": "KWD"}}, {"wire": {"value": SAFE, "currency": "USD"}}]
    while len(from_rows) < 40:
        from_rows.append({"wire": {"value": rng.randrange(-SAFE, SAFE), "currency": rng.choice(CURRENCIES)}})
    from_out = [attempt(row, "amount", lambda row=row: from_minor(row["wire"])) for row in from_rows]
    return to_out, from_out


def dinero_rows(rng):
    to_rows = [{"amount": "12.34", "currency": "EUR"}, {"amount": "1.2340", "currency": "EUR"}, {"amount": "5.00", "currency": "USD"}, {"amount": "-0.00", "currency": "EUR"}, {"amount": "90071992547409.91", "currency": "USD"}, {"amount": "90071992547409.92", "currency": "USD"}]
    while len(to_rows) < 40:
        currency = rng.choice(CURRENCIES)
        to_rows.append({"amount": amount(rng, currency, rng.choice([0, 1, 2])), "currency": currency})
    to_out = [attempt(row, "wire", lambda row=row: to_dinero(row["amount"], row["currency"])) for row in to_rows]
    # dinero.js's documented toObject(): Dinero({ amount: 500 }).toObject() is
    # { amount: 500, currency: 'USD', precision: 2 }
    from_rows = [{"wire": {"amount": 500, "currency": "USD", "precision": 2}}, {"wire": {"amount": 500, "currency": "JPY", "precision": 2}}, {"wire": {"amount": 1234, "currency": "EUR", "precision": 2}}, {"wire": {"amount": 12340, "currency": "EUR", "precision": 4}}, {"wire": {"amount": 1, "currency": "EUR", "precision": 1001}}]
    while len(from_rows) < 40:
        from_rows.append({"wire": {"amount": rng.randrange(-SAFE, SAFE), "currency": rng.choice(CURRENCIES), "precision": rng.randrange(0, 12)}})
    from_out = [attempt(row, "amount", lambda row=row: from_dinero(row["wire"])) for row in from_rows]
    return to_out, from_out


def main() -> None:
    rng = random.Random(SEED)
    to_google_rows, from_google_rows = google_rows(rng)
    to_iso_rows, from_iso_rows = iso_rows(rng)
    to_minor_rows, from_minor_rows = minor_rows(rng)
    to_dinero_rows, from_dinero_rows = dinero_rows(rng)
    provenance = {
        "source": "python-fractions",
        "generator": {"name": "scripts/gen-wire-vectors.py", "version": f"{GENERATOR_VERSION} (seed {SEED})"},
        "method": "The formats' published definitions (google/type/money.proto and ProtoJSON, https://protobuf.dev/programming-guides/json/; ISO 20022's ActiveOrHistoricCurrencyAndAmount and xs:decimal, https://www.w3.org/TR/xmlschema-2/#decimal; dinero.js 1's toObject, https://v1.dinerojs.com/module-dinero#~toObject) computed with Python's fractions, independently of ducat's TypeScript, with the specs' own examples first.",
        "data": {"iso4217": ISO4217_PUBLISHED},
    }
    tables = [
        {"op": "wire.toGoogle", "rows": to_google_rows},
        {"op": "wire.fromGoogle", "rows": from_google_rows},
        {"op": "wire.toIso20022", "rows": to_iso_rows},
        {"op": "wire.fromIso20022", "rows": from_iso_rows},
        {"op": "wire.toMinorUnits", "rows": to_minor_rows},
        {"op": "wire.fromMinorUnits", "rows": from_minor_rows},
        {"op": "wire.toDinero", "rows": to_dinero_rows},
        {"op": "wire.fromDinero", "rows": from_dinero_rows},
    ]
    for table in tables:
        print(table["op"], len(table["rows"]), file=sys.stderr)
    texts = {
        vector_path("wire", "formats"): file_text(
            "wire",
            "formats",
            "Money to and from the wire formats: google.type.Money in its ProtoJSON form, ISO 20022 amounts, ISO 4217 minor units and dinero.js objects, exact both ways; what each format can't hold is refused, and malformed input is an error, never a rounding.",
            provenance,
            tables,
        ),
    }
    write_or_check(texts, "python3 scripts/gen-wire-vectors.py")


if __name__ == "__main__":
    main()
