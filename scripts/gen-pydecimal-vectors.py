#!/usr/bin/env python3
"""Reference vectors from Python's decimal module (an implementation of the General Decimal Arithmetic
specification), written as tables of @ducatjs/money-spec (spec/vectors/rounding/pydecimal.json,
convert/pydecimal.json and tax/pydecimal.json) and checked by test/spec.test.ts.

Deterministic: the same seed always writes the same file. Regenerate with
    python3 scripts/gen-pydecimal-vectors.py
and check that nothing changed with --check.

Rounding modes: decimal has no half-ceil or half-floor, so those two are built from half-up and
half-down by the sign of the value (ties toward +infinity / -infinity). Every other mode is decimal's own.
"""
import json
import random
import sys
from decimal import (
    ROUND_CEILING,
    ROUND_DOWN,
    ROUND_FLOOR,
    ROUND_HALF_DOWN,
    ROUND_HALF_EVEN,
    ROUND_HALF_UP,
    ROUND_UP,
    Context,
    Decimal,
    localcontext,
)

sys.dont_write_bytecode = True  # no __pycache__ in scripts/
from spec_vectors import ISO4217_PUBLISHED, file_text, vector_path, write_or_check  # noqa: E402

SEED = 20261107
COUNT_PER_OP = 250
# bumped when the output's layout changes; the values depend only on the seed
GENERATOR_VERSION = "2"
# each operation's spec area and table operation (spec/README.md, "Table operations")
AREAS = {
    "multiply": "rounding",
    "divide": "rounding",
    "toScale": "rounding",
    "convert": "convert",
    "percentage": "tax",
    "addTax": "tax",
    "extractTax": "tax",
    "discount": "tax",
}
DESCRIPTIONS = {
    "rounding": "Multiplying, dividing and rescaling money in minor units, rounded once in every mode, by Python's decimal module.",
    "convert": "Converting money between currencies at a rate, rounded once in every mode, by Python's decimal module.",
    "tax": "Percentages, discounts, and adding and extracting tax, rounded once in every mode, by Python's decimal module.",
}
CURRENCIES = [("JPY", 0), ("EUR", 2), ("KWD", 3), ("CLF", 4)]
MODES = {
    "halfEven": ROUND_HALF_EVEN,
    "halfExpand": ROUND_HALF_UP,
    "halfTrunc": ROUND_HALF_DOWN,
    "expand": ROUND_UP,
    "trunc": ROUND_DOWN,
    "ceil": ROUND_CEILING,
    "floor": ROUND_FLOOR,
    "halfCeil": None,
    "halfFloor": None,
}


def round_to_scale(value: Decimal, scale: int, mode: str) -> Decimal:
    """value rounded once to `scale` decimals with ducat's rounding `mode`"""
    step = Decimal(1).scaleb(-scale)
    rounding = MODES[mode]
    if rounding is None:
        # half-ceil sends ties toward +infinity: half-up above zero, half-down below; half-floor mirrors it
        ties_away_from_zero = (mode == "halfCeil") == (value > 0)
        rounding = ROUND_HALF_UP if ties_away_from_zero else ROUND_HALF_DOWN
    return value.quantize(step, rounding=rounding)


def plain(value: Decimal) -> str:
    """fixed-point notation always: str() can produce scientific notation such as 1E+3"""
    return format(value, "f")


def minor_units(value: Decimal, scale: int) -> str:
    return str(int(value.scaleb(scale)))


def make_case(rng: random.Random, operation: str) -> dict:
    def random_amount():
        currency, exponent = rng.choice(CURRENCIES)
        bound = rng.choice([10**4, 10**12, 2**53, 10**30])
        return currency, exponent, rng.randint(-bound, bound)

    def random_decimal(low: int, high: int, max_scale: int) -> Decimal:
        scale = rng.randint(0, max_scale)
        return Decimal(rng.randint(low, high)).scaleb(-scale)

    currency, exponent, minor = random_amount()
    mode = rng.choice(list(MODES))
    amount = Decimal(minor).scaleb(-exponent)
    case = {"currency": currency, "minor": str(minor), "mode": mode}

    if operation == "multiply":
        factor = random_decimal(-(10**12), 10**12, 8)
        product = round_to_scale(amount * factor, exponent, mode)
        case |= {"factor": plain(factor), "want": minor_units(product, exponent)}

    elif operation == "divide":
        divisor = random_decimal(-(10**9), 10**9, 6)
        if divisor == 0:
            divisor = Decimal("1.5")
        quotient = round_to_scale(amount / divisor, exponent, mode)
        case |= {"divisor": plain(divisor), "want": minor_units(quotient, exponent)}

    elif operation == "toScale":
        # mostly rounding down to fewer decimals, sometimes exact rescaling up
        if rng.random() < 0.3:
            scale = rng.randint(0, exponent + 2)
        else:
            scale = rng.randint(0, max(0, exponent - 1))
        rescaled = round_to_scale(amount, scale, mode)
        case |= {"scale": scale, "want": minor_units(rescaled, scale)}

    elif operation == "convert":
        target, target_exponent = rng.choice(CURRENCIES)
        rate = random_decimal(1, 10**10, 8)
        converted = round_to_scale(amount * rate, target_exponent, mode)
        case |= {"to": target, "rate": plain(rate), "want": minor_units(converted, target_exponent)}

    else:
        # percentages: occasionally up to 100000 %, mostly 0 to 100 % with 3 decimals
        percent = Decimal(rng.randint(0, 100_000)).scaleb(-rng.randint(0, 3))
        if rng.random() < 0.8:
            percent = Decimal(rng.randint(0, 100_000)).scaleb(-3)
        share = round_to_scale(amount * percent / 100, exponent, mode)
        case["percent"] = format(percent, "f")

        if operation == "percentage":
            case["want"] = minor_units(share, exponent)
        elif operation == "discount":
            case["want"] = minor_units(amount - share, exponent)
        elif operation == "addTax":
            case["tax"] = minor_units(share, exponent)
            case["gross"] = minor_units(amount + share, exponent)
        else:
            # extractTax
            net = round_to_scale(amount / (1 + percent / 100), exponent, mode)
            case["net"] = minor_units(net, exponent)
            case["tax"] = minor_units(amount - net, exponent)

    return case


PROVENANCE = {
    "source": "python-decimal",
    "generator": {"name": "scripts/gen-pydecimal-vectors.py", "version": f"{GENERATOR_VERSION} (seed {SEED})"},
    "method": "Python's decimal module at 400 digits, rounded once with each rounding mode; half-ceil and half-floor are half-up or half-down by the value's sign.",
    "data": {"iso4217": ISO4217_PUBLISHED},
}


def main() -> None:
    rng = random.Random(SEED)
    operations = ["multiply", "divide", "toScale", "convert", "percentage", "addTax", "extractTax", "discount"]

    # 400 digits: every exact product fits, and no 400-digit quotient lies on a rounding boundary
    tables_by_area: dict = {}
    with localcontext(Context(prec=400, Emax=10**6, Emin=-(10**6))):
        for operation in operations:
            rows = [make_case(rng, operation) for _ in range(COUNT_PER_OP)]
            tables_by_area.setdefault(AREAS[operation], []).append({"op": f"minor.{operation}", "rows": rows})

    texts = {
        vector_path(area, "pydecimal"): file_text(area, "pydecimal", DESCRIPTIONS[area], PROVENANCE, tables)
        for area, tables in tables_by_area.items()
    }
    write_or_check(texts, "python3 scripts/gen-pydecimal-vectors.py")

if __name__ == "__main__":
    main()
