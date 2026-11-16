#!/usr/bin/env python3
"""Reference vectors for ducat's money JSON in a database column (moneyJson's jsonToDriver and
jsonFromDriver in src/sql.ts, the shape of Money#toJSON and fromJSON), computed with Python's
standard library from the shape's definition, independently of ducat's TypeScript:

- written: `{"amount":"<decimal>","currency":"<code>"}`, the keys in that order and no spaces
  (ECMAScript's JSON.stringify of `{ amount, currency }`), the amount a string at the currency's
  ISO 4217 exponent; money at another scale is refused (`range`), and so is money in another
  currency than the column's (`currency-mismatch`);
- read: the text is JSON (RFC 8259, https://www.rfc-editor.org/rfc/rfc8259; NaN and Infinity
  aren't, `syntax`), an object whose `amount` and `currency` are strings (else `type`), other
  members ignored and the last of duplicate names winning (ECMAScript's JSON.parse); the currency
  an ISO 4217 code with a minor unit (else `range`), then the amount in ducat's grammar
  (`[+-]?digits(.digits)?([eE][+-]?digits)?`, else `syntax`) at that currency's exponent without
  rounding (`rounding`), then the column's currency (`currency-mismatch`).

    spec/vectors/wire/money-json.json

checked by test/spec.test.ts and the Rust port's ducat-sqlx and ducat-diesel tests
(tests/it/money_json.rs).

Deterministic: regenerate with
    python3 scripts/gen-money-json-vectors.py
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

SEED = 20261116
GENERATOR_VERSION = "1"
# ASCII digits only, the whole string (Python's \d and $ would take other digits and a final newline)
AMOUNT = re.compile(r"([+-]?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?", re.ASCII)
CURRENCIES = ["EUR", "USD", "JPY", "KWD", "BHD", "CLF", "GBP"]


def iso_exponents() -> dict:
    root = ElementTree.parse(ROOT / "data" / "iso4217-list-one.xml").getroot()
    out = {}
    for entry in root.iter("CcyNtry"):
        code, units = entry.findtext("Ccy"), (entry.findtext("CcyMnrUnts") or "").strip()
        if code is not None and units != "N.A.":
            out[code] = int(units)
    return out


EXPONENT = iso_exponents()


class Refused(Exception):
    def __init__(self, kind):
        super().__init__(kind)
        self.kind = kind


def decimal_at(value: Fraction, scale: int) -> str:
    """The exact decimal text of value at scale (value must be a multiple of 10^-scale)."""
    units = value * 10**scale
    assert units.denominator == 1
    digits = str(abs(units.numerator)).rjust(scale + 1, "0")
    text = digits if scale == 0 else f"{digits[:-scale]}.{digits[-scale:]}"
    return f"-{text}" if units.numerator < 0 else text


def fraction_digits(amount: str) -> int:
    return len(amount.partition(".")[2])


def to_json(amount: str, currency: str, column) -> str:
    if column is not None and column != currency:
        raise Refused("currency-mismatch")
    if fraction_digits(amount) != EXPONENT[currency]:
        raise Refused("range")
    text = decimal_at(Fraction(amount), EXPONENT[currency])
    return json.dumps({"amount": text, "currency": currency}, separators=(",", ":"), ensure_ascii=False)


def refuse_constant(name):
    raise ValueError(f"{name} is not JSON")


def from_json(text: str, column) -> tuple:
    try:
        parsed = json.loads(text, parse_constant=refuse_constant)
    except ValueError:
        raise Refused("syntax")
    if not isinstance(parsed, dict):
        raise Refused("type")
    amount, currency = parsed.get("amount"), parsed.get("currency")
    if not isinstance(amount, str) or not isinstance(currency, str):
        raise Refused("type")
    if currency not in EXPONENT:
        raise Refused("range")
    match = AMOUNT.fullmatch(amount)
    if match is None:
        raise Refused("syntax")
    sign, integer, fraction, exponent = match.groups()
    value = Fraction(int(integer + (fraction or "")), 10 ** len(fraction or "")) * Fraction(10) ** int(exponent or "0")
    value = -value if sign == "-" else value
    scale = EXPONENT[currency]
    if (value * 10**scale).denominator != 1:
        raise Refused("rounding")
    if column is not None and column != currency:
        raise Refused("currency-mismatch")
    return decimal_at(value, scale), currency


def attempt(row: dict, fields: list, run) -> dict:
    try:
        values = run()
        return {**row, **dict(zip(fields, values)), "error": None}
    except Refused as refused:
        return {**row, **{field: None for field in fields}, "error": refused.kind}


def with_column(row: dict, column) -> dict:
    return row if column is None else {**row, "column": column}


def random_amount(rng: random.Random, currency: str) -> str:
    units = rng.choice([rng.randrange(-10**4, 10**4), rng.randrange(-2**63, 2**63), rng.randrange(-10**30, 10**30)])
    return decimal_at(Fraction(units, 10 ** EXPONENT[currency]), EXPONENT[currency])


def to_rows(rng: random.Random) -> list:
    cases = [
        ("12.34", "EUR", None),
        ("-0.01", "EUR", None),
        ("0.00", "EUR", None),
        ("1000", "JPY", None),
        ("1.234", "KWD", None),
        ("0.0001", "CLF", None),
        ("90071992547409.93", "EUR", None),
        ("-92233720368547758.08", "EUR", None),
        ("123456789012345678901234567890.12", "USD", None),
        ("12.34", "EUR", "EUR"),
        ("1.234", "KWD", "KWD"),
        # another scale than the exponent: round it first
        ("1.005", "EUR", None),
        ("12", "EUR", None),
        ("12.3400", "EUR", None),
        ("1.5", "JPY", None),
        ("1.00", "USD", "EUR"),
        ("1.005", "USD", "EUR"),
    ]
    rows = [with_column({"amount": a, "currency": c}, col) for a, c, col in cases]
    while len(rows) < 60:
        currency = rng.choice(CURRENCIES)
        rows.append(with_column({"amount": random_amount(rng, currency), "currency": currency}, rng.choice([None, None, currency])))
    return [
        attempt(row, ["wire"], lambda row=row: (to_json(row["amount"], row["currency"], row.get("column")),))
        for row in rows
    ]


def from_rows(rng: random.Random) -> list:
    money = lambda amount, currency: json.dumps({"amount": amount, "currency": currency}, separators=(",", ":"))
    cases = [
        (money("12.34", "EUR"), None),
        ('{"currency":"EUR","amount":"12.3"}', None),
        (' {\n  "amount" : "1.230",\t"currency" : "EUR" } ', None),
        ('{"amount": "12.34", "currency": "EUR"}', None),  # Postgres's jsonb text
        (money("+1", "JPY"), None),
        (money("1.5e1", "JPY"), None),
        (money("1E-2", "EUR"), None),
        (money("-0", "EUR"), None),
        (money("-0.000", "KWD"), None),
        (money("0.001", "KWD"), None),
        (money("123456789012345678901234567890.12", "USD"), None),
        (money("-92233720368547758.09", "EUR"), None),
        ('{"amount":"1","amount":"2","currency":"EUR"}', None),
        ('{"amount":"1","currency":"USD","currency":"EUR"}', None),
        ('{"amount":"1","currency":"EUR","note":{"a":[1,null,true]},"scale":4}', None),
        ('{"amount":"1","currency":"\\u0045UR"}', None),
        ('{"amount":"\\u0031.5","currency":"EUR"}', None),
        (money("12.34", "EUR"), "EUR"),
        (money("1000", "JPY"), "JPY"),
        (money("1.234", "KWD"), "KWD"),
        # rounding: more decimals than the currency's
        (money("12.345", "EUR"), None),
        (money("1.5", "JPY"), None),
        (money("1.0001", "KWD"), None),
        (money("1e-3", "EUR"), None),
        # the amount's grammar
        (money(".5", "EUR"), None),
        (money("5.", "EUR"), None),
        (money(" 1", "EUR"), None),
        (money("1 ", "EUR"), None),
        (money("1,5", "EUR"), None),
        (money("", "EUR"), None),
        (money("0x10", "EUR"), None),
        (money("1e", "EUR"), None),
        (money("--1", "EUR"), None),
        (money("NaN", "EUR"), None),
        (money("Infinity", "EUR"), None),
        (money("١", "EUR"), None),
        (money("1\n", "EUR"), None),
        # not JSON
        ("", None),
        ("{", None),
        ("{'amount':'1','currency':'EUR'}", None),
        ('{"amount":"1","currency":"EUR"} x', None),
        ('{"amount":"1","currency":"EUR",}', None),
        ("NaN", None),
        ('{"amount":"1","currency":"EUR","x":NaN}', None),
        ("12.34 EUR", None),
        # JSON, not money JSON
        ("42", None),
        ("null", None),
        ("true", None),
        ("[]", None),
        ('["12.34","EUR"]', None),
        ('"12.34 EUR"', None),
        ('"{\\"amount\\":\\"1\\",\\"currency\\":\\"EUR\\"}"', None),
        ("{}", None),
        ('{"amount":12.34,"currency":"EUR"}', None),
        ('{"amount":"1"}', None),
        ('{"currency":"EUR"}', None),
        ('{"amount":"1","currency":null}', None),
        ('{"amount":null,"currency":"EUR"}', None),
        ('{"amount":["1"],"currency":"EUR"}', None),
        ('{"Amount":"1","Currency":"EUR"}', None),
        ('{"amount":"1","currency":978}', "EUR"),
        # codes that aren't ISO 4217 with a minor unit, before the amount is read
        (money("1", "ABC"), None),
        (money("1", "eur"), None),
        (money("1", "EUR "), None),
        (money("1", "constructor"), None),
        (money("1", "XAU"), None),
        (money("x", "ABC"), None),
        (money("1.005", "ABC"), "EUR"),
        # another currency than the column's, after the amount
        (money("1", "USD"), "EUR"),
        (money("1.005", "USD"), "EUR"),
        (money("x", "USD"), "EUR"),
        (money("1", "JPY"), "KWD"),
    ]
    rows = [with_column({"wire": text}, column) for text, column in cases]
    while len(rows) < 120:
        currency = rng.choice(CURRENCIES)
        rows.append(with_column({"wire": money(random_amount(rng, currency), currency)}, rng.choice([None, None, currency, "EUR"])))
    return [attempt(row, ["amount", "currency"], lambda row=row: from_json(row["wire"], row.get("column"))) for row in rows]


def main() -> None:
    rng = random.Random(SEED)
    tables = [
        {"op": "wire.toMoneyJson", "rows": to_rows(rng)},
        {"op": "wire.fromMoneyJson", "rows": from_rows(rng)},
    ]
    for table in tables:
        print(table["op"], len(table["rows"]), file=sys.stderr)
    provenance = {
        "source": "python-fractions",
        "generator": {"name": "scripts/gen-money-json-vectors.py", "version": f"{GENERATOR_VERSION} (seed {SEED})"},
        "method": "The money JSON shape's definition (ECMAScript's JSON.stringify of { amount, currency } and JSON.parse, RFC 8259) computed with Python's json and fractions, independently of ducat's TypeScript, with the ISO 4217 exponents of data/iso4217-list-one.xml.",
        "data": {"iso4217": ISO4217_PUBLISHED},
    }
    texts = {
        vector_path("wire", "money-json"): file_text(
            "wire",
            "money-json",
            "Money as JSON in a JSON, JSONB or TEXT column (moneyJson): the exact text written, at the currency's exponent, and the text read back, with what a column refuses: other scales, other currencies, text that isn't JSON or isn't money JSON, unknown codes, malformed amounts and amounts that would round.",
            provenance,
            tables,
        ),
    }
    write_or_check(texts, "python3 scripts/gen-money-json-vectors.py")


if __name__ == "__main__":
    main()
