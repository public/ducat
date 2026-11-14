#!/usr/bin/env python3
"""Reference vectors from Python's fractions module for exact amounts and exchange rates, written as
tables of @ducatjs/money-spec (spec/vectors/exact/fractions.json and
spec/vectors/convert/rates-fractions.json) and checked by test/spec.test.ts and the Rust port's
rust/crates/ducat/tests/spec.rs.

Deterministic: the same seed always writes the same files. Regenerate with
    python3 scripts/gen-exact-vectors.py
and check that nothing changed with --check.

Every value is an exact Fraction; a result is rounded once, at the end, by the definition of each
rounding mode below (ties are exact comparisons of Fractions, never floats).
"""
import random
import sys
from fractions import Fraction

sys.dont_write_bytecode = True  # no __pycache__ in scripts/
from spec_vectors import ISO4217_PUBLISHED, file_text, vector_path, write_or_check  # noqa: E402

SEED = 20261114
ROWS_PER_TABLE = 200
# bumped when the output's layout changes; the values depend only on the seed
GENERATOR_VERSION = "1"
CURRENCIES = [("JPY", 0), ("EUR", 2), ("USD", 2), ("KWD", 3), ("CLF", 4)]
EXPONENTS = dict(CURRENCIES)
MODES = ["halfEven", "halfExpand", "halfTrunc", "halfCeil", "halfFloor", "expand", "trunc", "ceil", "floor"]
# the largest scale an exact amount may be written at (spec/README.md, as ducat's MAX_SCALE)
MAX_SCALE = 1000


def round_fraction(value: Fraction, scale: int, mode: str) -> int:
    """value rounded once to `scale` decimals with ducat's rounding `mode`, in units of 10^-scale"""
    scaled = value * 10**scale
    floor = scaled.numerator // scaled.denominator
    remainder = scaled - floor  # 0 <= remainder < 1
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
    ties = {
        "halfEven": floor if floor % 2 == 0 else ceil,
        "halfExpand": away,
        "halfTrunc": toward_zero,
        "halfCeil": ceil,
        "halfFloor": floor,
    }
    return ties[mode]


def rational(value: Fraction) -> str:
    """reduced numerator/denominator, or the integer alone: the spec's rational form"""
    return str(value)


def plain(units: int, scale: int) -> str:
    """units × 10^-scale as a plain decimal with exactly `scale` places"""
    sign = "-" if units < 0 else ""
    digits = str(abs(units)).rjust(scale + 1, "0")
    if scale == 0:
        return sign + digits
    return f"{sign}{digits[:-scale]}.{digits[-scale:]}"


def terminating_scale(value: Fraction, minimum: int):
    """the smallest scale >= minimum at which value is an exact decimal, or None"""
    den = value.denominator
    twos = fives = 0
    while den % 2 == 0:
        den //= 2
        twos += 1
    while den % 5 == 0:
        den //= 5
        fives += 1
    if den != 1:
        return None
    scale = max(twos, fives, minimum)
    return scale if scale <= MAX_SCALE else None


def decimal_text(value: Fraction, places: int) -> str:
    """an exactly representable value at `places` decimals"""
    return plain(int(value * 10**places), places)


def random_minor(rng: random.Random) -> int:
    bound = rng.choice([10**4, 10**12, 2**53, 10**30, 10**45])
    return rng.randint(-bound, bound)


def random_decimal(rng: random.Random, low: int, high: int, max_places: int) -> tuple[str, Fraction]:
    places = rng.randint(0, max_places)
    units = rng.randint(low, high)
    return plain(units, places), Fraction(units, 10**places)


def random_rate(rng: random.Random) -> tuple[str, Fraction]:
    """a positive rate: mostly a decimal as a source would publish it, sometimes a fraction"""
    if rng.random() < 0.7:
        return random_decimal(rng, 1, 10**10, 8)
    value = Fraction(rng.randint(1, 10**9), rng.randint(1, 10**9))
    return rational(value), value


def money_value(minor: int, currency: str) -> Fraction:
    return Fraction(minor, 10 ** EXPONENTS[currency])


def divide_round(rng: random.Random) -> dict:
    currency, exponent = rng.choice(CURRENCIES)
    minor = random_minor(rng)
    divisor_text, divisor = random_decimal(rng, 1, 10**9, 6)
    if rng.random() < 0.5:
        divisor, divisor_text = -divisor, "-" + divisor_text
    mode = rng.choice(MODES)
    exact = money_value(minor, currency) / divisor
    rounded = round_fraction(exact, exponent, mode)
    residual = exact - Fraction(rounded, 10**exponent)
    return {"currency": currency, "minor": str(minor), "divisor": divisor_text, "mode": mode, "rounded": str(rounded), "residual": rational(residual)}


def to_money(rng: random.Random) -> dict:
    currency, exponent = rng.choice(CURRENCIES)
    num = random_minor(rng)
    # denominators of 2s and 5s (exact at some scale) and others (no finite decimal)
    if rng.random() < 0.6:
        den = 2 ** rng.randint(0, 40) * 5 ** rng.randint(0, 40)
    else:
        den = rng.choice([3, 7, 9, 11, 12, 30, 1000003]) * 2 ** rng.randint(0, 5)
    value = Fraction(num, den)
    scale = terminating_scale(value, exponent)
    return {"currency": currency, "num": str(num), "den": str(den), "money": None if scale is None else decimal_text(value, scale)}


def random_percent(rng: random.Random) -> tuple[str, Fraction]:
    if rng.random() < 0.8:
        return random_decimal(rng, 0, 100_000, 3)
    return random_decimal(rng, 0, 10**7, 2)


def add_tax(rng: random.Random) -> dict:
    currency, _ = rng.choice(CURRENCIES)
    minor = random_minor(rng)
    percent_text, percent = random_percent(rng)
    net = money_value(minor, currency)
    tax = net * percent / 100
    return {"currency": currency, "minor": str(minor), "percent": percent_text, "tax": rational(tax), "gross": rational(net + tax)}


def extract_tax(rng: random.Random) -> dict:
    currency, _ = rng.choice(CURRENCIES)
    minor = random_minor(rng)
    percent_text, percent = random_percent(rng)
    gross = money_value(minor, currency)
    net = gross / (1 + percent / 100)
    return {"currency": currency, "minor": str(minor), "percent": percent_text, "net": rational(net), "tax": rational(gross - net)}


def multiply_exact(rng: random.Random) -> dict:
    currency, exponent = rng.choice(CURRENCIES)
    minor = random_minor(rng)
    if rng.random() < 0.8:
        factor_text, factor = random_decimal(rng, -(10**12), 10**12, 10)
    else:
        factor = Fraction(rng.randint(-(10**6), 10**6), rng.choice([3, 6, 7, 8, 40, 125]))
        factor_text = rational(factor)
    value = money_value(minor, currency) * factor
    scale = terminating_scale(value, exponent)
    return {"currency": currency, "minor": str(minor), "factor": factor_text, "want": None if scale is None else decimal_text(value, scale)}


def rate_inverse(rng: random.Random) -> dict:
    text, value = random_rate(rng)
    return {"rate": text, "inverse": rational(1 / value)}


def random_via(rng: random.Random, length: int) -> list[str]:
    """a path of `length` currencies, each different from the one before"""
    path = [rng.choice(CURRENCIES)[0]]
    while len(path) < length:
        path.append(rng.choice([code for code, _ in CURRENCIES if code != path[-1]]))
    return path


def rate_chain(rng: random.Random) -> dict:
    count = rng.randint(1, 4)
    rates = [random_rate(rng) for _ in range(count)]
    composite = Fraction(1)
    for _, value in rates:
        composite *= value
    return {"via": random_via(rng, count + 1), "rates": [text for text, _ in rates], "composite": rational(composite)}


def rate_convert(rng: random.Random) -> dict:
    count = rng.randint(1, 3)
    via = random_via(rng, count + 1)
    rates = [random_rate(rng) for _ in range(count)]
    minor = random_minor(rng)
    mode = rng.choice(MODES)
    exact = money_value(minor, via[0])
    for _, value in rates:
        exact *= value
    target_exponent = EXPONENTS[via[-1]]
    want = round_fraction(exact, target_exponent, mode)
    residual = exact - Fraction(want, 10**target_exponent)
    return {"via": via, "rates": [text for text, _ in rates], "minor": str(minor), "mode": mode, "want": str(want), "residual": rational(residual)}


PROVENANCE = {
    "source": "python-fractions",
    "generator": {"name": "scripts/gen-exact-vectors.py", "version": f"{GENERATOR_VERSION} (seed {SEED})"},
    "method": "Python's fractions module: every value an exact Fraction, rounded once at the end by the definition of each mode, with ties found by exact comparison.",
    "data": {"iso4217": ISO4217_PUBLISHED},
}


def main() -> None:
    rng = random.Random(SEED)

    def table(op: str, make) -> dict:
        return {"op": op, "rows": [make(rng) for _ in range(ROWS_PER_TABLE)]}

    exact_tables = [
        table("exact.divideRound", divide_round),
        table("exact.toMoney", to_money),
        table("exact.addTax", add_tax),
        table("exact.extractTax", extract_tax),
        table("exact.multiplyExact", multiply_exact),
    ]
    rate_tables = [
        table("rate.inverse", rate_inverse),
        table("rate.chain", rate_chain),
        table("rate.convert", rate_convert),
    ]
    texts = {
        vector_path("exact", "fractions"): file_text(
            "exact",
            "fractions",
            "Exact amounts: dividing and rounding once with the residual, the exact decimal form, exact tax, and exact multiplication, by Python's fractions module.",
            PROVENANCE,
            exact_tables,
        ),
        vector_path("convert", "rates-fractions"): file_text(
            "convert",
            "rates-fractions",
            "Exchange rates: inverses, chains, and converting through a chain rounded once with the residual, by Python's fractions module.",
            PROVENANCE,
            rate_tables,
        ),
    }
    write_or_check(texts, "python3 scripts/gen-exact-vectors.py")


if __name__ == "__main__":
    main()
