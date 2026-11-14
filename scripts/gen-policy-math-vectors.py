#!/usr/bin/env python3
"""Reference vectors from Python's fractions module for rounding policies, retail price endings,
tiered pricing, the math helpers (average, ratioOf, divideToIntegral, remainder, trimScale and exact
ratio arithmetic) and the two exact finance functions (interestExact, discountedSumExact), written
as tables of @ducatjs/money-spec:

    spec/vectors/rounding/policy-fractions.json
    spec/vectors/pricing/fractions.json
    spec/vectors/math/fractions.json
    spec/vectors/finance/exact-fractions.json

and checked by test/spec.test.ts and the Rust port's rust/crates/ducat/tests/spec.rs.

Every expected value is computed here, independently of ducat, from the definitions in ducat's
docs (docs/reference/policy.md, pricing.md, math.md and finance.md): exact Fractions throughout,
rounded once at the end by the definition of each rounding mode (ties are exact comparisons of
Fractions, never floats).

Deterministic: the same seed always writes the same files. Regenerate with
    python3 scripts/gen-policy-math-vectors.py
and check that nothing changed with --check.
"""
import datetime
import random
import sys
from fractions import Fraction

sys.dont_write_bytecode = True  # no __pycache__ in scripts/
from spec_vectors import ISO4217_PUBLISHED, file_text, vector_path, write_or_check  # noqa: E402

SEED = 20261115
ROWS_PER_TABLE = 150
# bumped when the output's layout changes; the values depend only on the seed
GENERATOR_VERSION = "1"
CURRENCIES = [("JPY", 0), ("EUR", 2), ("USD", 2), ("KWD", 3), ("CLF", 4)]
EXPONENTS = dict(CURRENCIES)
MODES = ["halfEven", "halfExpand", "halfTrunc", "halfCeil", "halfFloor", "expand", "trunc", "ceil", "floor"]


# --- exact helpers ------------------------------------------------------------------------------


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


def decimal_places(text: str) -> int:
    return len(text.split(".")[1]) if "." in text else 0


def parse_decimal(text: str) -> Fraction:
    return Fraction(text)


def shortest_decimal(value: Fraction):
    """the value as a decimal at the smallest scale that holds it, or None if it doesn't terminate"""
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
    scale = max(twos, fives)
    return plain(int(value * 10**scale), scale)


def random_amount(rng: random.Random, currency: str, max_extra: int = 3) -> tuple[str, Fraction]:
    """an amount at the currency's exponent, or at a few more (or fewer) decimals"""
    exponent = EXPONENTS[currency]
    scale = max(0, exponent + rng.randint(-1, max_extra))
    bound = rng.choice([10**3, 10**6, 10**9, 10**15, 10**25])
    units = rng.randint(-bound, bound)
    return plain(units, scale), Fraction(units, 10**scale)


def random_decimal(rng: random.Random, low: int, high: int, max_places: int) -> tuple[str, Fraction]:
    places = rng.randint(0, max_places)
    units = rng.randint(low, high)
    return plain(units, places), Fraction(units, 10**places)


def random_factor(rng: random.Random) -> tuple[str, Fraction]:
    if rng.random() < 0.75:
        text, value = random_decimal(rng, 1, 10**9, 7)
    else:
        value = Fraction(rng.randint(1, 10**6), rng.choice([3, 6, 7, 9, 11, 12, 40, 125]))
        text = rational(value)
    if rng.random() < 0.3:
        return ("-" + text if not text.startswith("-") else text), -value
    return text, value


# --- rounding policies --------------------------------------------------------------------------


def random_policy(rng: random.Random, currency: str) -> dict:
    """a policy: maybe a scale, an increment, a mode, and sometimes a currency (mostly the amount's)"""
    policy = {}
    if rng.random() < 0.5:
        policy["scale"] = rng.randint(0, 6)
    policy["increment"] = rng.choice([1, 1, 1, 2, 5, 5, 10, 25, 50, 100, 1000])
    policy["rounding"] = rng.choice(MODES)
    roll = rng.random()
    if roll < 0.15:
        policy["currency"] = currency
    elif roll < 0.25:
        policy["currency"] = rng.choice([code for code, _ in CURRENCIES if code != currency])
    return policy


def policy_round(value: Fraction, currency: str, policy: dict):
    """value (an exact amount in `currency`) rounded once by the policy, as a decimal at the
    policy's scale, or None when the policy is for another currency"""
    if "currency" in policy and policy["currency"] != currency:
        return None
    scale = policy.get("scale", EXPONENTS[currency])
    increment = policy["increment"]
    # rounding to the nearest multiple of increment × 10^-scale: count increments, then back
    steps = round_fraction(value / increment, scale, policy["rounding"])
    return plain(steps * increment, scale), Fraction(steps * increment, 10**scale)


def first(result):
    return None if result is None else result[0]


def policy_multiply(rng: random.Random) -> dict:
    currency, _ = rng.choice(CURRENCIES)
    amount_text, amount = random_amount(rng, currency)
    factor_text, factor = random_factor(rng)
    policy = random_policy(rng, currency)
    return {"currency": currency, "amount": amount_text, "factor": factor_text, "policy": policy, "want": first(policy_round(amount * factor, currency, policy))}


def policy_divide(rng: random.Random) -> dict:
    currency, _ = rng.choice(CURRENCIES)
    amount_text, amount = random_amount(rng, currency)
    divisor_text, divisor = random_factor(rng)
    policy = random_policy(rng, currency)
    return {"currency": currency, "amount": amount_text, "divisor": divisor_text, "policy": policy, "want": first(policy_round(amount / divisor, currency, policy))}


def policy_round_row(rng: random.Random) -> dict:
    currency, _ = rng.choice(CURRENCIES)
    amount_text, amount = random_amount(rng, currency, max_extra=6)
    policy = random_policy(rng, currency)
    return {"currency": currency, "amount": amount_text, "policy": policy, "want": first(policy_round(amount, currency, policy))}


def policy_convert(rng: random.Random) -> dict:
    currency, _ = rng.choice(CURRENCIES)
    to = rng.choice([code for code, _ in CURRENCIES if code != currency])
    amount_text, amount = random_amount(rng, currency)
    rate_text, rate = random_decimal(rng, 1, 10**10, 8)
    policy = random_policy(rng, to)
    return {"currency": currency, "amount": amount_text, "to": to, "rate": rate_text, "policy": policy, "want": first(policy_round(amount * rate, to, policy))}


def difference(left: tuple[str, Fraction], right_text: str) -> str:
    """left − right as a decimal at the larger of their scales (exact)"""
    scale = max(decimal_places(left[0]), decimal_places(right_text))
    value = left[1] - parse_decimal(right_text)
    return plain(int(value * 10**scale), scale)


def policy_tax(rng: random.Random) -> dict:
    """percentage and extractTax round their result by the policy; discount the discounted price
    and addTax the gross, the amount charged; the other part is the exact difference"""
    currency, _ = rng.choice(CURRENCIES)
    amount_text, amount = random_amount(rng, currency)
    percent_text, percent = random_decimal(rng, 0, 100_000, 3)
    policy = random_policy(rng, currency)
    share = percent / 100
    row = {"currency": currency, "amount": amount_text, "percent": percent_text, "policy": policy}
    percentage = policy_round(amount * share, currency, policy)
    discounted = policy_round(amount * (1 - share), currency, policy)
    gross = policy_round(amount * (1 + share), currency, policy)
    net = policy_round(amount / (1 + share), currency, policy)
    row["percentage"] = first(percentage)
    row["discount"] = first(discounted)
    row["addTax"] = None if gross is None else {"tax": difference(gross, amount_text), "gross": gross[0]}
    row["extractTax"] = None if net is None else {"net": net[0], "tax": difference((amount_text, amount), net[0])}
    return row


def policy_exact_round(rng: random.Random) -> dict:
    currency, _ = rng.choice(CURRENCIES)
    num = rng.randint(-(10**15), 10**15)
    den = rng.choice([1, 3, 7, 8, 12, 40, 125, 997, 10**6])
    value = Fraction(num, den)
    policy = random_policy(rng, currency)
    result = policy_round(value, currency, policy)
    return {
        "currency": currency,
        "num": str(num),
        "den": str(den),
        "policy": policy,
        "want": first(result),
        "residual": None if result is None else rational(value - result[1]),
    }


def policy_check(rng: random.Random) -> dict:
    """whether the amount is exactly what the policy produces: at its scale and on its increment"""
    currency, exponent = rng.choice(CURRENCIES)
    policy = random_policy(rng, currency)
    policy.pop("currency", None)
    if rng.random() < 0.3:
        policy["currency"] = currency
    scale = policy.get("scale", exponent)
    if rng.random() < 0.6:
        amount_scale = scale
    else:
        amount_scale = max(0, scale + rng.choice([-1, 1, 2]))
    units = rng.randint(-(10**9), 10**9)
    if rng.random() < 0.5:
        units -= units % policy["increment"]
    valid = amount_scale == scale and units % policy["increment"] == 0
    return {"currency": currency, "amount": plain(units, amount_scale), "policy": policy, "valid": valid}


# --- pricing -------------------------------------------------------------------------------------


def price_ending(rng: random.Random) -> dict:
    """the allowed prices are ending + k × step; the count of steps above the ending is rounded once"""
    currency, _ = rng.choice(CURRENCIES)
    amount_text, amount = random_amount(rng, currency, max_extra=1)
    amount = abs(amount)
    amount_text = amount_text.lstrip("-")
    scale = decimal_places(amount_text)
    step_text, step = rng.choice([("1", Fraction(1)), ("10", Fraction(10)), ("5", Fraction(5)), ("0.5", Fraction(1, 2)), ("0.25", Fraction(1, 4)), ("100", Fraction(100))])
    # an ending in [0, step), with up to two decimals
    ending_units = rng.randint(0, int(step * 100) - 1)
    ending = Fraction(ending_units, 100)
    ending_text = shortest_decimal(ending)
    mode = rng.choice(MODES)
    row = {"currency": currency, "amount": amount_text, "ending": ending_text, "step": step_text, "mode": mode}
    unit = Fraction(1, 10**scale)
    if (ending / unit).denominator != 1 or (step / unit).denominator != 1:
        row["want"] = None  # the ending or step has more decimals than the price
        return row
    steps = round_fraction((amount - ending) / step, 0, mode)
    row["want"] = plain(int((ending + steps * step) * 10**scale), scale)
    return row


def random_quantity(rng: random.Random) -> tuple[str, Fraction]:
    roll = rng.random()
    if roll < 0.6:
        value = Fraction(rng.randint(0, 3000))
        return str(value), value
    if roll < 0.85:
        return random_decimal(rng, 0, 300_000, 3)
    value = Fraction(rng.randint(0, 9000), rng.choice([3, 7, 9]))
    return rational(value), value


def tiered_price(rng: random.Random) -> dict:
    currency, exponent = rng.choice(CURRENCIES)
    count = rng.randint(1, 4)
    bounds = sorted(rng.sample(range(1, 2500), count))
    open_last = rng.random() < 0.7
    tiers = []
    for index, bound in enumerate(bounds):
        tier = {"upTo": None if (open_last and index == count - 1) else str(bound)}
        kind = rng.random()
        if kind < 0.85:
            unit_text, _ = random_decimal(rng, 0, 50_000, exponent + rng.randint(0, 3))
            tier["unitAmount"] = unit_text
        if kind >= 0.6:
            flat_text, _ = random_decimal(rng, 0, 100_000, exponent)
            tier["flatAmount"] = flat_text
        tiers.append(tier)
    quantity_text, quantity = random_quantity(rng)
    mode = rng.choice(["graduated", "volume"])
    rounding = rng.choice(MODES)
    row = {"currency": currency, "quantity": quantity_text, "mode": mode, "tiers": tiers, "rounding": rounding}
    if rng.random() < 0.3:
        row["beyondLastTier"] = rng.choice(["throw", "cap"])
    if mode == "volume" and rng.random() < 0.2:
        charge_text, charge = random_quantity(rng)
        row["chargeQuantity"] = charge_text
    else:
        charge = None

    upper_bounds = [None if tier["upTo"] is None else Fraction(tier["upTo"]) for tier in tiers]
    amount = quantity
    last = upper_bounds[-1]
    if last is not None and amount > last:
        if row.get("beyondLastTier", "throw") == "throw":
            row.update({"total": None, "exact": None, "lines": None})
            return row
        amount = last

    def charge_of(tier: dict, units: Fraction) -> Fraction:
        result = Fraction(0)
        if "unitAmount" in tier:
            result += Fraction(tier["unitAmount"]) * units
        if "flatAmount" in tier:
            result += Fraction(tier["flatAmount"])
        return result

    charged = []
    lower = Fraction(0)
    for index, (tier, upper) in enumerate(zip(tiers, upper_bounds)):
        in_tier = upper is None or amount <= upper
        if mode == "volume":
            if in_tier:
                charged.append((index, charge if charge is not None else amount))
                break
        else:
            if index > 0 and lower >= amount:
                break
            top = amount if in_tier else upper
            charged.append((index, top - lower))
            if in_tier:
                break
            lower = upper

    lines = []
    running = Fraction(0)
    rounded_before = 0
    for index, units in charged:
        line_exact = charge_of(tiers[index], units)
        running += line_exact
        rounded = round_fraction(running, exponent, rounding)
        quantity_shown = shortest_decimal(units)
        lines.append({"tier": index, "quantity": quantity_shown if quantity_shown is not None else rational(units), "exact": rational(line_exact), "amount": str(rounded - rounded_before)})
        rounded_before = rounded
    row["total"] = str(rounded_before)
    row["exact"] = rational(running)
    row["lines"] = lines
    return row


# --- math ----------------------------------------------------------------------------------------


def amount_list(rng: random.Random, currency: str) -> list[tuple[str, Fraction]]:
    return [random_amount(rng, currency) for _ in range(rng.randint(1, 8))]


def average(rng: random.Random) -> dict:
    currency, _ = rng.choice(CURRENCIES)
    amounts = amount_list(rng, currency)
    mode = rng.choice(MODES)
    scale = max(decimal_places(text) for text, _ in amounts)
    mean = sum(value for _, value in amounts) / len(amounts)
    return {"currency": currency, "amounts": [text for text, _ in amounts], "mode": mode, "want": plain(round_fraction(mean, scale, mode), scale)}


def two_amounts(rng: random.Random):
    currency, _ = rng.choice(CURRENCIES)
    left = random_amount(rng, currency)
    right = random_amount(rng, currency)
    if rng.random() < 0.1:
        right = ("0", Fraction(0))
    elif rng.random() < 0.3:
        # a divisor much smaller than the dividend, so the quotient is large
        right = random_decimal(rng, -1000, 1000, EXPONENTS[currency] + 1)
    return currency, left, right


def ratio_of(rng: random.Random) -> dict:
    currency, left, right = two_amounts(rng)
    return {"currency": currency, "amount": left[0], "other": right[0], "ratio": None if right[1] == 0 else rational(left[1] / right[1])}


def divide_to_integral(rng: random.Random) -> dict:
    currency, left, right = two_amounts(rng)
    row = {"currency": currency, "amount": left[0], "divisor": right[0]}
    if right[1] == 0:
        row.update({"quotient": None, "remainder": None})
        return row
    quotient_value = left[1] / right[1]
    # truncated toward zero
    quotient = quotient_value.numerator // quotient_value.denominator
    if quotient < 0 and quotient_value != quotient:
        quotient += 1
    rest = left[1] - quotient * right[1]
    scale = max(decimal_places(left[0]), decimal_places(right[0]))
    row.update({"quotient": str(quotient), "remainder": plain(int(rest * 10**scale), scale)})
    return row


def trim_scale(rng: random.Random) -> dict:
    currency, exponent = rng.choice(CURRENCIES)
    scale = exponent + rng.randint(0, 6)
    units = rng.randint(-(10**9), 10**9) * 10 ** rng.randint(0, 6)
    text = plain(units, scale)
    row = {"currency": currency, "amount": text}
    minimum = exponent
    if rng.random() < 0.4:
        minimum = rng.randint(0, scale + 1)
        row["minimumScale"] = minimum
    current = scale
    while current > minimum and units % 10 == 0:
        units //= 10
        current -= 1
    row["want"] = plain(units, current)
    return row


def random_ratio(rng: random.Random) -> tuple[str, Fraction]:
    roll = rng.random()
    if roll < 0.15:
        return "0", Fraction(0)
    if roll < 0.6:
        text, value = random_decimal(rng, -(10**9), 10**9, 6)
        return text, value
    value = Fraction(rng.randint(-(10**9), 10**9), rng.randint(1, 10**6))
    return rational(value), value


def ratio_arithmetic(rng: random.Random) -> dict:
    left_text, left = random_ratio(rng)
    right_text, right = random_ratio(rng)
    if rng.random() < 0.1:
        right_text, right = left_text, left
    return {
        "left": left_text,
        "right": right_text,
        "sum": rational(left + right),
        "difference": rational(left - right),
        "product": rational(left * right),
        "quotient": None if right == 0 else rational(left / right),
        "compare": (left > right) - (left < right),
        "negation": rational(-left),
        "complement": rational(1 - left),
    }


# --- exact finance -------------------------------------------------------------------------------

DAY_COUNTS = ["ACT/360", "ACT/365F", "ACT/ACT ISDA", "30/360", "30E/360", "30E/360 ISDA"]


def is_leap(year: int) -> bool:
    return (year % 4 == 0 and year % 100 != 0) or year % 400 == 0


def last_of_february(date: datetime.date) -> bool:
    return date.month == 2 and date.day == (29 if is_leap(date.year) else 28)


def year_fraction(start: datetime.date, end: datetime.date, convention: str, maturity) -> Fraction:
    """the 2006 ISDA Definitions §4.16 conventions, as docs/reference/finance.md defines them"""
    days = (end - start).days
    if convention == "ACT/360":
        return Fraction(days, 360)
    if convention == "ACT/365F":
        return Fraction(days, 365)
    if convention == "ACT/ACT ISDA":
        if start.year == end.year:
            return Fraction(days, 366 if is_leap(start.year) else 365)
        first = (datetime.date(start.year + 1, 1, 1) - start).days
        last = (end - datetime.date(end.year, 1, 1)).days
        return Fraction(first, 366 if is_leap(start.year) else 365) + (end.year - start.year - 1) + Fraction(last, 366 if is_leap(end.year) else 365)
    d1, d2 = start.day, end.day
    if convention == "30/360":
        d1 = 30 if d1 == 31 else d1
        d2 = 30 if d2 == 31 and d1 == 30 else d2
    elif convention == "30E/360":
        d1, d2 = min(d1, 30), min(d2, 30)
    else:
        d1 = 30 if d1 == 31 or last_of_february(start) else d1
        if last_of_february(end):
            d2 = d2 if maturity else 30
        else:
            d2 = min(d2, 30)
    return Fraction(360 * (end.year - start.year) + 30 * (end.month - start.month) + (d2 - d1), 360)


def random_date(rng: random.Random) -> datetime.date:
    year = rng.randint(2000, 2040)
    month = rng.randint(1, 12)
    if rng.random() < 0.3:
        # month ends, the cases the 30/360 family adjusts
        day = (datetime.date(year + (month == 12), month % 12 + 1, 1) - datetime.timedelta(days=1)).day
    else:
        day = rng.randint(1, 28)
    return datetime.date(year, month, day)


def interest_exact(rng: random.Random) -> dict:
    currency, exponent = rng.choice(CURRENCIES)
    principal = rng.randint(1, 10**12)
    rate_text, rate = random_decimal(rng, 0, 30_000, 5)
    start = random_date(rng)
    end = start + datetime.timedelta(days=rng.randint(0, 3000))
    convention = rng.choice(DAY_COUNTS)
    row = {"currency": currency, "principal": str(principal), "rate": rate_text, "from": start.isoformat(), "to": end.isoformat(), "dayCount": convention}
    maturity = None
    if convention == "30E/360 ISDA" and last_of_february(end):
        maturity = rng.random() < 0.5
        row["maturity"] = maturity
    fraction = year_fraction(start, end, convention, maturity)
    row["want"] = rational(Fraction(principal, 10**exponent) * rate * fraction)
    return row


def discounted_sum_exact(rng: random.Random) -> dict:
    currency, exponent = rng.choice(CURRENCIES)
    flows = [rng.randint(-(10**9), 10**9) for _ in range(rng.randint(1, 30))]
    if rng.random() < 0.1:
        rate_text, rate = rng.choice([("-1", Fraction(-1)), ("-1.5", Fraction(-3, 2))])
    else:
        # from −9% to 30% a period, in basis points of a basis point
        rate = Fraction(rng.randint(-90_000, 300_000), 1_000_000)
        rate_text = shortest_decimal(rate)
    row = {"currency": currency, "flows": [str(flow) for flow in flows], "rate": rate_text}
    if rate <= -1:
        row["want"] = None
        return row
    total = sum(Fraction(flow, 10**exponent) / (1 + rate) ** period for period, flow in enumerate(flows))
    row["want"] = rational(total)
    return row


PROVENANCE = {
    "source": "python-fractions",
    "generator": {"name": "scripts/gen-policy-math-vectors.py", "version": f"{GENERATOR_VERSION} (seed {SEED})"},
    "method": "Python's fractions module, from the definitions in ducat's reference docs: every value an exact Fraction, rounded once at the end by the definition of each mode, with ties found by exact comparison.",
    "data": {"iso4217": ISO4217_PUBLISHED},
}


def main() -> None:
    rng = random.Random(SEED)

    def table(op: str, make) -> dict:
        return {"op": op, "rows": [make(rng) for _ in range(ROWS_PER_TABLE)]}

    policy_tables = [
        table("policy.multiply", policy_multiply),
        table("policy.divide", policy_divide),
        table("policy.round", policy_round_row),
        table("policy.convert", policy_convert),
        table("policy.tax", policy_tax),
        table("policy.exactRound", policy_exact_round),
        table("policy.check", policy_check),
    ]
    pricing_tables = [
        table("pricing.priceEnding", price_ending),
        table("pricing.tiered", tiered_price),
    ]
    math_tables = [
        table("math.average", average),
        table("math.ratioOf", ratio_of),
        table("math.divideToIntegral", divide_to_integral),
        table("math.trimScale", trim_scale),
        table("math.ratio", ratio_arithmetic),
    ]
    finance_tables = [
        table("finance.interestExact", interest_exact),
        table("finance.discountedSumExact", discounted_sum_exact),
    ]
    texts = {
        vector_path("rounding", "policy-fractions"): file_text(
            "rounding",
            "policy-fractions",
            "Rounding policies (a scale or the currency's exponent, an increment, a mode and an optional currency) applied to multiplication, division, rounding, conversion, tax and exact amounts, and checked by assertScale, by Python's fractions module.",
            PROVENANCE,
            policy_tables,
        ),
        vector_path("pricing", "fractions"): file_text(
            "pricing",
            "fractions",
            "Retail price endings and tiered (graduated and volume) pricing, by Python's fractions module.",
            PROVENANCE,
            pricing_tables,
        ),
        vector_path("math", "fractions"): file_text(
            "math",
            "fractions",
            "Averages, shares, integral division and remainders, trimming the scale, and exact ratio arithmetic, by Python's fractions module.",
            PROVENANCE,
            math_tables,
        ),
        vector_path("finance", "exact-fractions"): file_text(
            "finance",
            "exact-fractions",
            "Exact simple interest and exact discounted sums (ducat's interestExact and discountedSumExact), by Python's fractions module.",
            PROVENANCE,
            finance_tables,
        ),
    }
    write_or_check(texts, "python3 scripts/gen-policy-math-vectors.py")


if __name__ == "__main__":
    main()
