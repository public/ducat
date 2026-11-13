#!/usr/bin/env python3
"""Reference vectors for @ducatjs/money/finance and /excel, computed in exact rational arithmetic with
Python's fractions module, written as tables of @ducatjs/money-spec: spec/vectors/finance/fractions.json
(checked by test/finance.oracle.test.ts) and spec/vectors/excel/fractions.json (checked by
test/excel.oracle.test.ts).
The Excel section, below, also covers the edge cases in scripts/excel_edge_cases.py, which
scripts/gen-calc-vectors.py runs through LibreOffice Calc.

This is a second implementation, written from the definitions rather than from the TypeScript: day
numbers come from datetime.date.toordinal, NPVs are summed term by term as fractions, and the IRR is
bracketed by bisection on the real line before it is truncated to the grid.

Deterministic: the same seeds always write the same files. Regenerate with
    python3 scripts/gen-finance-vectors.py
and check that nothing changed with --check.
"""
import calendar
import datetime
import json
import random
import sys
from decimal import Decimal, localcontext
from fractions import Fraction

sys.dont_write_bytecode = True  # no __pycache__ in scripts/
import excel_edge_cases  # noqa: E402
from spec_vectors import file_text, vector_path, write_or_check  # noqa: E402

# bumped when the output's layout changes; the values depend only on the seeds
GENERATOR_VERSION = "2"

SEED = 20261108
CURRENCIES = [("EUR", 2), ("JPY", 0), ("KWD", 3)]
MODES = ["halfEven", "halfExpand", "halfTrunc", "halfCeil", "halfFloor", "expand", "trunc", "ceil", "floor"]
CONVENTIONS = ["ACT/360", "ACT/365F", "ACT/ACT ISDA", "30/360", "30E/360", "30E/360 ISDA"]


def round_fraction(value: Fraction, mode: str) -> int:
    """value rounded to an integer with ducat's rounding `mode`"""
    floor, remainder = divmod(value.numerator, value.denominator)
    if remainder == 0:
        return floor
    positive = value > 0
    if mode == "floor":
        return floor
    if mode == "ceil":
        return floor + 1
    if mode == "trunc":
        return floor if positive else floor + 1
    if mode == "expand":
        return floor + 1 if positive else floor
    half = Fraction(remainder, value.denominator) - Fraction(1, 2)
    if half < 0:
        return floor
    if half > 0:
        return floor + 1
    if mode == "halfEven":
        return floor if floor % 2 == 0 else floor + 1
    if mode == "halfExpand":
        return floor + 1 if positive else floor
    if mode == "halfTrunc":
        return floor if positive else floor + 1
    if mode == "halfCeil":
        return floor + 1
    if mode == "halfFloor":
        return floor
    raise ValueError(mode)


def round_major(value: Fraction, exponent: int, mode: str) -> int:
    """an amount in major units rounded to minor units"""
    return round_fraction(value * 10**exponent, mode)


def parse(text: str) -> datetime.date:
    return datetime.date.fromisoformat(text)


def is_last_of_february(date: datetime.date) -> bool:
    return date.month == 2 and (date + datetime.timedelta(days=1)).month == 3


def days_in_year(year: int) -> int:
    return (datetime.date(year + 1, 1, 1) - datetime.date(year, 1, 1)).days


def year_fraction(start: datetime.date, end: datetime.date, convention: str, maturity=None) -> Fraction:
    days = end.toordinal() - start.toordinal()
    if convention == "ACT/360":
        return Fraction(days, 360)
    if convention == "ACT/365F":
        return Fraction(days, 365)
    if convention == "ACT/ACT ISDA":
        total = Fraction(0)
        cursor = start
        while cursor < end:
            year_end = datetime.date(cursor.year + 1, 1, 1)
            piece_end = min(year_end, end)
            total += Fraction((piece_end - cursor).days, days_in_year(cursor.year))
            cursor = piece_end
        return total
    d1, d2 = start.day, end.day
    if convention == "30/360":
        if d1 == 31:
            d1 = 30
        if d2 == 31 and d1 > 29:
            d2 = 30
    elif convention == "30E/360":
        d1 = min(d1, 30)
        d2 = min(d2, 30)
    elif convention == "30E/360 ISDA":
        if d1 == 31 or is_last_of_february(start):
            d1 = 30
        if d2 == 31:
            d2 = 30
        if is_last_of_february(end):
            if maturity is None:
                raise ValueError("needs maturity")
            if not maturity:
                d2 = 30
    else:
        raise ValueError(convention)
    return Fraction(360 * (end.year - start.year) + 30 * (end.month - start.month) + (d2 - d1), 360)


def random_date(rng: random.Random) -> datetime.date:
    # month ends and February are where the conventions differ, so they are drawn often
    year = rng.randint(1996, 2044)
    month = rng.randint(1, 12)
    last = (datetime.date(year + month // 12, month % 12 + 1, 1) - datetime.timedelta(days=1)).day
    day = rng.choice([1, 15, 28, 29, 30, 31, last, last, rng.randint(1, last)])
    return datetime.date(year, month, min(day, last))


def rate_string(rng: random.Random, zero_ok: bool = True) -> str:
    """an annual rate from 0.0001 to 0.25 as a decimal string with up to 5 places"""
    if zero_ok and rng.random() < 0.05:
        return "0"
    places = rng.randint(2, 5)
    value = rng.randint(1, 25 * 10 ** (places - 2))
    text = str(value).rjust(places, "0")
    return ("0." + text).rstrip("0").rstrip(".")


def year_fraction_cases(rng: random.Random) -> list:
    cases = []
    for convention in CONVENTIONS:
        for _ in range(150):
            start = random_date(rng)
            end = start + datetime.timedelta(days=rng.choice([rng.randint(0, 120), rng.randint(0, 3000)]))
            if rng.random() < 0.3:
                end = random_date(rng)
                if end < start:
                    start, end = end, start
            case = {"start": start.isoformat(), "end": end.isoformat(), "convention": convention}
            maturity = None
            if convention == "30E/360 ISDA":
                # the flag is drawn here, on its own: true, false or (sometimes) left out
                maturity = rng.choice([True, False, None, True, False])
                if maturity is not None:
                    case["maturity"] = maturity
            try:
                value = year_fraction(start, end, convention, maturity)
                case["want"] = f"{value.numerator}/{value.denominator}"
            except ValueError:
                case["want"] = "throws"
            cases.append(case)
    return cases


def interest_cases(rng: random.Random) -> list:
    cases = []
    for _ in range(300):
        currency, exponent = rng.choice(CURRENCIES)
        principal = rng.randint(1, 10**9)
        rate = rate_string(rng)
        start = random_date(rng)
        end = start + datetime.timedelta(days=rng.randint(0, 800))
        convention = rng.choice(CONVENTIONS)
        mode = rng.choice(MODES)
        maturity = rng.choice([True, False]) if convention == "30E/360 ISDA" else None
        exact = Fraction(principal, 10**exponent) * Fraction(rate) * year_fraction(start, end, convention, maturity)
        case = {
                "currency": currency,
                "principal": str(principal),
                "rate": rate,
                "from": start.isoformat(),
                "to": end.isoformat(),
                "dayCount": convention,
                "mode": mode,
                "want": str(round_major(exact, exponent, mode)),
        }
        if maturity is not None:
            case["maturity"] = maturity
        cases.append(case)
    return cases


def compound_cases(rng: random.Random) -> list:
    cases = []
    for _ in range(150):
        currency, exponent = rng.choice(CURRENCIES)
        principal = rng.randint(1, 10**9)
        rate = rate_string(rng)
        per_year = rng.choice([1, 2, 4, 12, 52, 365])
        periods = rng.randint(0, 400)
        mode = rng.choice(MODES)
        exact = Fraction(principal, 10**exponent) * (1 + Fraction(rate) / per_year) ** periods
        cases.append(
            {
                "currency": currency,
                "principal": str(principal),
                "rate": rate,
                "perYear": per_year,
                "periods": periods,
                "mode": mode,
                "want": str(round_major(exact, exponent, mode)),
            }
        )
    return cases


def schedule(loan: int, exponent: int, rate: Fraction, per_year: int, periods: int, method: str, mode: str,
             balloon: int, residual: str):
    """rows of (payment, interest, principal, balance) in minor units, from the definitions"""
    r = rate / per_year
    rows = []
    if method == "linear" or (method == "annuity" and r == 0):
        # equal principal parts of loan - balloon, floored; the last part takes the remainder
        regular = (loan - balloon) // periods
        balance = loan
        for k in range(periods):
            principal = balance if k == periods - 1 else regular
            interest = round_fraction(balance * r, mode)
            balance -= principal
            rows.append((principal + interest, interest, principal, balance))
        return rows[0][0], rows
    if method == "interestOnly":
        interest = round_fraction(loan * r, mode)
        for k in range(periods):
            last = k == periods - 1
            principal = loan if last else 0
            rows.append((principal + interest, interest, principal, 0 if last else loan))
        return interest, rows
    growth = (1 + r) ** periods
    exact_payment = (loan * growth - balloon) * r / (growth - 1)
    payment = round_fraction(exact_payment, mode)
    balance = loan
    for k in range(periods):
        interest = round_fraction(balance * r, mode)
        last = k == periods - 1
        owed = balance + interest
        if last or payment >= owed:
            if last and residual == "lastInterest":
                final = payment + balloon
                rows.append((final, final - balance, balance, 0))
            else:
                rows.append((owed, interest, balance, 0))
            break
        principal = payment - interest
        balance -= principal
        rows.append((payment, interest, principal, balance))
    return payment, rows


def amortise_cases(rng: random.Random) -> list:
    cases = []
    while len(cases) < 400:
        currency, exponent = rng.choice(CURRENCIES)
        loan = rng.choice([rng.randint(1, 10**4), rng.randint(10**4, 10**9)])
        rate = rate_string(rng)
        per_year = rng.choice([1, 4, 12, 12, 12, 26, 52])
        periods = rng.choice([1, 2, 3, rng.randint(1, 60), rng.randint(1, 360)])
        method = rng.choice(["annuity", "annuity", "linear", "interestOnly"])
        mode = rng.choice(MODES)
        balloon = 0
        if method != "interestOnly" and rng.random() < 0.25:
            balloon = rng.randint(0, loan)
        # lastInterest needs interest to put the residual in: an annuity at a non-zero rate
        residual = rng.choice(["lastPayment", "lastInterest"]) if method == "annuity" and rate != "0" else "lastPayment"
        payment, rows = schedule(loan, exponent, Fraction(rate), per_year, periods, method, mode, balloon, residual)
        if any(row[1] < 0 for row in rows):
            # lastInterest refuses a negative last interest; that path has its own unit test
            continue
        case = {
            "currency": currency,
            "loan": str(loan),
            "rate": rate,
            "perYear": per_year,
            "periods": periods,
            "method": method,
            "mode": mode,
            "residual": residual,
            "payment": str(payment),
            "rows": len(rows),
            "totalInterest": str(sum(row[1] for row in rows)),
            "last": [str(value) for value in rows[-1]],
            # a weighted sum of the interest and payment columns: catches a value in the wrong row
            "checksum": str(sum((k + 1) * (row[0] + 7 * row[1]) for k, row in enumerate(rows))),
        }
        if balloon:
            case["balloon"] = str(balloon)
        cases.append(case)
    return cases


def discounted_sum(rate: Fraction, flows: list) -> Fraction:
    """the textbook form: the first flow at period 0, undiscounted"""
    return sum((Fraction(flow) / (1 + rate) ** t for t, flow in enumerate(flows)), Fraction(0))


def excel_npv(rate: Fraction, flows: list) -> Fraction:
    """Excel's NPV: the first flow at the end of period 1"""
    return sum((Fraction(flow) / (1 + rate) ** (t + 1) for t, flow in enumerate(flows)), Fraction(0))


def npv_cases(rng: random.Random) -> list:
    cases = []
    for _ in range(200):
        currency, exponent = rng.choice(CURRENCIES)
        count = rng.randint(1, 40)
        flows = [rng.randint(-10**7, 10**7) for _ in range(count)]
        rate = rng.choice([rate_string(rng), "-" + rate_string(rng, zero_ok=False), "1.5"])
        mode = rng.choice(MODES)
        npv = excel_npv(Fraction(rate), flows) / 10**exponent
        present = discounted_sum(Fraction(rate), flows) / 10**exponent
        cases.append(
            {
                "currency": currency,
                "flows": [str(flow) for flow in flows],
                "rate": rate,
                "mode": mode,
                "npv": str(round_major(npv, exponent, mode)),
                "discountedSum": str(round_major(present, exponent, mode)),
            }
        )
    return cases


def sign(value: Fraction) -> int:
    return (value > 0) - (value < 0)


def irr_grid(flows: list, digits: int) -> int:
    """the IRR truncated to `digits` places, as an integer count of 10^-digits"""
    first_sign = sign(Fraction(next(flow for flow in flows if flow != 0)))
    low, high = Fraction(-1), Fraction(1)
    while sign(discounted_sum(high, flows)) not in (first_sign, 0):
        high *= 2
    if sign(discounted_sum(Fraction(0), flows)) == first_sign:
        high = Fraction(0)
    else:
        low = Fraction(0) if high == 1 else high / 2
    # bisect on the real line until the bracket is far narrower than the grid
    width = Fraction(1, 10 ** (digits + 3))
    low_sign = -first_sign if low == -1 else sign(discounted_sum(low, flows))
    while high - low > width:
        middle = (low + high) / 2
        middle_sign = sign(discounted_sum(middle, flows))
        if middle_sign == 0:
            low = high = middle
            break
        if middle_sign == low_sign:
            low = middle
        else:
            high = middle
    unit = 10**digits
    grid = (low * unit).numerator // (low * unit).denominator
    # the root is in [low, high]; step to the grid point at or below it with a sign change above
    while True:
        here = Fraction(grid, unit)
        above = Fraction(grid + 1, unit)
        here_sign = -first_sign if here == -1 else sign(discounted_sum(here, flows))
        if here_sign == 0 or here_sign != sign(discounted_sum(above, flows)):
            return grid
        grid += 1


def irr_cases(rng: random.Random) -> list:
    cases = []
    for _ in range(120):
        currency, exponent = rng.choice(CURRENCIES)
        count = rng.randint(2, 30)
        outlay = rng.randint(1, 10**7)
        flows = [-outlay] + [rng.randint(0, 10**6) for _ in range(count - 1)]
        if all(flow == 0 for flow in flows[1:]):
            flows[-1] = 1
        if rng.random() < 0.3:
            flows = [-flow for flow in flows]
        digits = rng.randint(2, 12)
        grid = irr_grid(flows, digits)
        cases.append({"currency": currency, "flows": [str(flow) for flow in flows], "digits": digits, "lower": str(grid)})
    return cases


def bracketed_irr_cases(rng: random.Random) -> list:
    """flows with two known rational IRRs, and brackets (off the grid) around each"""
    cases = []
    for _ in range(80):
        currency, exponent = rng.choice(CURRENCIES)
        first = Fraction(rng.randint(-500, 3000), 10000)
        second = first + Fraction(rng.randint(1, 3000), 10000)
        g1, g2 = 1 + first, 1 + second
        # c0·g² + c1·g + c2 = k·(g − g1)(g − g2), scaled so every flow is a whole minor unit
        k = rng.choice([1, -1]) * rng.randint(1, 1000) * 10**8
        flows = [k, -k * (g1 + g2), k * g1 * g2]
        assert all(flow.denominator == 1 for flow in flows)
        digits = rng.randint(1, 8)
        unit = 10**digits
        which = rng.choice([0, 1])
        root = [first, second][which]
        gap = second - first
        # bracket ends strictly between the roots' neighbourhoods, at 6 decimals off the grid
        if which == 0:
            low = first - Fraction(rng.randint(1, 1000), 10**4)
            high = first + gap * Fraction(rng.randint(1, 99), 100)
        else:
            low = second - gap * Fraction(rng.randint(1, 99), 100)
            high = second + Fraction(rng.randint(1, 1000), 10**4)
        low = max(low, Fraction(-99, 100))
        to_text = lambda value: f"{value.numerator}/{value.denominator}"
        lower = (root * unit).numerator // (root * unit).denominator
        cases.append(
            {
                "currency": currency,
                "flows": [str(int(flow)) for flow in flows],
                "digits": digits,
                "bracket": [to_text(low), to_text(high)],
                "lower": str(lower),
            }
        )
    return cases


def proration_cases(rng: random.Random) -> list:
    cases = []
    for _ in range(150):
        currency, exponent = rng.choice(CURRENCIES)
        price = rng.randint(-10**8, 10**8)
        start = random_date(rng)
        length = rng.randint(1, 400)
        end = start + datetime.timedelta(days=length)
        points = sorted(rng.sample(range(1, length), min(length - 1, rng.randint(0, 6)))) if length > 1 else []
        used_start = rng.randint(0, length)
        used_end = rng.randint(used_start, length)
        mode = rng.choice(MODES)
        prorated = round_fraction(Fraction(price * (used_end - used_start), length), mode)
        # splitPeriod: Hamilton's largest remainder, ties to the earlier piece, by sign of the price
        weights = [b - a for a, b in zip([0] + points, points + [length])]
        magnitude = abs(price)
        shares = [magnitude * w // length for w in weights]
        remainders = [magnitude * w % length for w in weights]
        left = magnitude - sum(shares)
        order = sorted(range(len(weights)), key=lambda i: (-remainders[i], i))
        for i in order[:left]:
            shares[i] += 1
        pieces = [share if price >= 0 else -share for share in shares]
        day = lambda offset: (start + datetime.timedelta(days=offset)).isoformat()
        cases.append(
            {
                "currency": currency,
                "price": str(price),
                "period": [start.isoformat(), end.isoformat()],
                "used": [day(used_start), day(used_end)],
                "at": [day(point) for point in points],
                "mode": mode,
                "prorate": str(prorated),
                "split": [str(piece) for piece in pieces],
            }
        )
    return cases


def payment_date_cases(rng: random.Random) -> list:
    """payment dates: monthly steps on the anchor's day, clamped to shorter months, or 7/14 days"""
    cases = []
    for _ in range(120):
        anchor = random_date(rng)
        per_year = rng.choice([1, 2, 3, 4, 6, 12, 26, 52])
        count = rng.randint(1, 60)
        dates = []
        for i in range(count):
            if per_year in (26, 52):
                dates.append(anchor + datetime.timedelta(days=i * (364 // per_year)))
                continue
            months = anchor.month - 1 + i * (12 // per_year)
            year, month = anchor.year + months // 12, months % 12 + 1
            last = calendar.monthrange(year, month)[1]
            dates.append(datetime.date(year, month, min(anchor.day, last)))
        cases.append({"firstPayment": anchor.isoformat(), "perYear": per_year, "count": count, "dates": [d.isoformat() for d in dates]})
    return cases


# ---------------------------------------------------------------------------------------------
# @ducatjs/money/excel: written to test/vectors/excel.json, checked by test/excel.oracle.test.ts
#
# FV, PV and PMT are rational: exact fractions. NPER, RATE, XNPV and XIRR are irrational in
# general, so the oracle carries its own bounds: the logarithms and exponentials come from Python's
# decimal module (ln and exp are correctly rounded) and every result is widened by far more than
# its rounding, then combined in exact fractions; precision is raised until the bounds settle
# every value written. Nothing is compared with a float.
# ---------------------------------------------------------------------------------------------

EXCEL_SEED = SEED + 100
ROUNDING = MODES


def to_text(value: Fraction) -> str:
    return f"{value.numerator}/{value.denominator}"


def edge_minor(amount: str) -> int:
    """a two-decimal amount in major units as minor units"""
    value = Fraction(amount) * 100
    assert value.denominator == 1, amount
    return int(value)


def annuity_values(rate: Fraction, n: int, pmt: Fraction, pv: Fraction, fv: Fraction, timing: int) -> dict:
    """Excel's FV, PV and PMT from their definitions, with Excel's sign convention"""
    growth = (1 + rate) ** n
    # the payments' future value: pmt·(1 + r·type) at the end of each period, summed
    annuity = Fraction(n) if rate == 0 else ((growth - 1) / rate)
    paid = pmt * (1 + rate * timing) * annuity
    values = {"fv": -(pv * growth + paid), "pv": -(fv + paid) / growth}
    if n >= 1:
        values["pmt"] = -(pv * growth + fv) / ((1 + rate * timing) * annuity)
    return values


def annuity_vector(currency: str, exponent: int, rate: str, n: int, minors: dict, timing: int, note=None) -> dict:
    unit = Fraction(1, 10**exponent)
    values = annuity_values(Fraction(rate), n, minors["pmt"] * unit, minors["pv"] * unit, minors["fv"] * unit, timing)
    case = {"currency": currency, "rate": rate, "nper": n, "type": timing}
    case.update({name: str(minors[name]) for name in ("pmt", "pv", "fv")})
    case["results"] = {
        name: {"exact": to_text(value), "rounded": {mode: str(round_major(value, exponent, mode)) for mode in ROUNDING}}
        for name, value in values.items()
    }
    if note:
        case["note"] = note
    return case


def periodic_rate_text(rng: random.Random) -> str:
    """a periodic rate from -0.05 to 0.3 with up to 7 places, sometimes 0"""
    if rng.random() < 0.08:
        return "0"
    places = rng.randint(1, 7)
    units = rng.randint(-5 * 10**places // 100, 3 * 10**places // 10)
    if units == 0:
        units = 1
    digits = str(abs(units)).rjust(places + 1, "0")
    return ("-" if units < 0 else "") + digits[:-places] + "." + digits[-places:]


def annuity_cases_excel(rng: random.Random) -> list:
    cases = []
    for _ in range(200):
        currency, exponent = rng.choice(CURRENCIES)
        rate = periodic_rate_text(rng)
        n = rng.choice([1, 2, 12, 60, 360, rng.randint(1, 480)])
        minors = {
            name: 0 if rng.random() < 0.15 else rng.randint(-limit, limit)
            for name, limit in (("pmt", 10**7), ("pv", 10**9), ("fv", 10**9))
        }
        cases.append(annuity_vector(currency, exponent, rate, n, minors, rng.randint(0, 1)))
    for edge in excel_edge_cases.ANNUITIES:
        minors = {name: edge_minor(edge[name]) for name in ("pmt", "pv", "fv")}
        cases.append(annuity_vector("USD", 2, edge["rate"], edge["nper"], minors, edge["type"], edge["note"]))
    return cases


# ---- bounds from decimal: [low, high] fractions around ln and exp ---------------------------

def to_decimal(value: Fraction):
    return Decimal(value.numerator) / Decimal(value.denominator)


def ln_bounds(value: Fraction, precision: int) -> tuple:
    """[low, high] around ln(value), value > 0"""
    with localcontext() as context:
        context.prec = precision
        result = Fraction(to_decimal(value).ln())
    # the argument is rounded (relative 10^(1-p)/2, so ln moves by under 10^(1-p)) and ln is
    # correctly rounded (half a unit of its last place): 10^(2-p)·(1 + |ln|) covers both tenfold
    error = Fraction(1, 10 ** (precision - 2)) * (1 + abs(result))
    return result - error, result + error


def exp_bounds(low: Fraction, high: Fraction, precision: int) -> tuple:
    """[low, high] around exp(y) for every y in [low, high]"""
    with localcontext() as context:
        context.prec = precision
        bottom = Fraction(to_decimal(low).exp())
        top = Fraction(to_decimal(high).exp())
    # the argument's rounding moves exp by a factor of at most 1 + |y|·10^(1-p), and exp is
    # correctly rounded: a relative 10^(2-p)·(1 + |y|) covers both
    slack = Fraction(1, 10 ** (precision - 2))
    return (bottom * (1 - slack * (1 + abs(low))), top * (1 + slack * (1 + abs(high))))


def exact_root(value: int, order: int):
    """the integer `order`th root of value ≥ 0 when it is exact, else None"""
    if value < 2:
        return value
    # the floor of the root by bisection on integers
    low, high = 0, 1 << (value.bit_length() // order + 1)
    while low < high:
        middle = (low + high + 1) // 2
        if middle**order <= value:
            low = middle
        else:
            high = middle - 1
    return low if low**order == value else None


def rational_power(base: Fraction, exponent: Fraction):
    """base^exponent when it is rational (base > 0), else None"""
    num = exact_root(base.numerator, exponent.denominator)
    den = exact_root(base.denominator, exponent.denominator)
    if num is None or den is None:
        return None
    return Fraction(num, den) ** exponent.numerator


# ---- XNPV ------------------------------------------------------------------------------------

def dated_terms(values: list, dates: list, convention: str) -> list:
    """(years from the first date, value) for each flow"""
    start = parse(dates[0])
    return [(year_fraction(start, parse(day), convention, False), Fraction(value)) for value, day in zip(values, dates)]


def xnpv_exact(growth: Fraction, terms: list):
    """XNPV when it is rational: Σ C_f·g^(−f) over the fractional parts f, with every irrational
    g^(−f) multiplying a coefficient of exactly 0; else None"""
    groups = {}
    for years, value in terms:
        whole = years.numerator // years.denominator
        part = years - whole
        groups[part] = groups.get(part, Fraction(0)) + value * growth ** (-whole)
    total = Fraction(0)
    for part, coefficient in groups.items():
        if coefficient == 0:
            continue
        factor = rational_power(growth, -part) if part != 0 else Fraction(1)
        if factor is None:
            return None
        total += coefficient * factor
    return total


def xnpv_bounds(growth: Fraction, terms: list, precision: int) -> tuple:
    log_low, log_high = ln_bounds(growth, precision)
    low = high = Fraction(0)
    for years, value in terms:
        if years == 0:
            low += value
            high += value
            continue
        # g^(−t) = exp(−t·ln g), decreasing in ln g
        bottom, top = exp_bounds(-years * log_high, -years * log_low, precision)
        if value >= 0:
            low, high = low + value * bottom, high + value * top
        else:
            low, high = low + value * top, high + value * bottom
    return low, high


def settle(compute, done, what: str):
    """runs compute(precision) with more digits until done(result) holds"""
    precision = 40
    while precision <= 5000:
        result = compute(precision)
        if done(result):
            return result
        precision *= 2
    raise ValueError(f"the oracle can't settle {what}")


def xnpv_vector(currency: str, exponent: int, rate: str, minors: list, dates: list, digits: int,
                convention=None, note=None) -> dict:
    growth = 1 + Fraction(rate)
    unit = Fraction(1, 10**exponent)
    terms = dated_terms([minor * unit for minor in minors], dates, convention or "ACT/365F")
    case = {"currency": currency, "rate": rate, "values": [str(minor) for minor in minors], "dates": dates, "digits": digits}
    if convention:
        case["dayCount"] = convention
    exact = xnpv_exact(growth, terms)
    if exact is not None:
        case["exact"] = to_text(exact)
        case["rounded"] = {mode: str(round_major(exact, exponent, mode)) for mode in ROUNDING}
    else:
        # bounds 10^-(digits + 20) wide, which must lie inside ducat's interval, and narrow
        # enough that every rounding is settled
        width = Fraction(1, 10 ** (digits + 20))

        def settled(bounds):
            low, high = bounds
            return high - low <= width and all(
                round_major(low, exponent, mode) == round_major(high, exponent, mode) for mode in ROUNDING
            )

        low, high = settle(lambda precision: xnpv_bounds(growth, terms, precision), settled, "XNPV")
        places = 10 ** (digits + 20)
        case["low"] = decimal_text(Fraction((low * places).numerator // (low * places).denominator, places), digits + 20)
        high_scaled = -((-high * places).numerator // (-high * places).denominator)
        case["high"] = decimal_text(Fraction(high_scaled, places), digits + 20)
        case["rounded"] = {mode: str(round_major(low, exponent, mode)) for mode in ROUNDING}
    if note:
        case["note"] = note
    return case


def decimal_text(value: Fraction, places: int) -> str:
    """value, a multiple of 10^-places, as a decimal string"""
    scaled = value * 10**places
    assert scaled.denominator == 1
    digits = str(abs(scaled.numerator)).rjust(places + 1, "0")
    return ("-" if scaled < 0 else "") + digits[:-places] + "." + digits[-places:]


def dated_schedule(rng: random.Random, count: int) -> list:
    start = random_date(rng)
    later = [start + datetime.timedelta(days=rng.choice([0, rng.randint(1, 400), rng.randint(1, 3650), 365 * rng.randint(1, 10)])) for _ in range(count - 1)]
    return [start.isoformat()] + [day.isoformat() for day in later]


def xnpv_cases(rng: random.Random) -> list:
    cases = []
    while len(cases) < 150:
        currency, exponent = rng.choice(CURRENCIES)
        count = rng.randint(2, 12)
        minors = [-rng.randint(1, 10**9)] + [rng.randint(-10**8, 10**9) for _ in range(count - 1)]
        if not any(minor > 0 for minor in minors):
            minors[-1] = rng.randint(1, 10**9)
        rate = rng.choice([periodic_rate_text(rng), "-0.5", "1", "0.1"])
        convention = rng.choice([None, None, None, None, "ACT/ACT ISDA", "ACT/360"])
        try:
            cases.append(xnpv_vector(currency, exponent, rate, minors, dated_schedule(rng, count),
                                     rng.randint(0, 12), convention))
        except ValueError:
            continue  # a value the oracle can't settle (none expected)
    for edge in excel_edge_cases.XNPVS:
        minors = [edge_minor(value) for value in edge["values"]]
        cases.append(xnpv_vector("USD", 2, edge["rate"], minors, edge["dates"], 10, note=edge["note"]))
    return cases


# ---- the floored root on a grid, for RATE and XIRR -------------------------------------------

def grid_root(sign_at, digits: int, minus_sign: int, plus_sign: int):
    """the largest grid point k (rate k/10^digits) at or below the one root above -1, where the
    sign goes from minus_sign (near -1) to plus_sign (large rates); None when the root is within
    10^-digits of -1"""
    unit = 10**digits
    here = sign_at(0)
    if here == 0:
        return 0
    if here == plus_sign:
        low, high = -unit + 1, 0
        lowest = sign_at(low)
        if lowest == 0:
            return low
        if lowest != minus_sign:
            return None
    else:
        low, high = 0, unit
        while sign_at(high) != plus_sign:
            if sign_at(high) == 0:
                return high
            low, high = high, high * 2
    while high - low > 1:
        middle = (low + high) // 2
        middle_sign = sign_at(middle)
        if middle_sign == 0:
            return middle
        if middle_sign == minus_sign:
            low = middle
        else:
            high = middle
    return low


def npv_sign(flows: list, rate: Fraction) -> int:
    """the sign of Σ flowₜ / (1 + rate)^t, by Horner's rule in exact fractions"""
    discount = 1 / (1 + rate)
    total = Fraction(0)
    for flow in reversed(flows):
        total = total * discount + flow
    return sign(total)


def sign_changes(values: list) -> int:
    signs = [sign(Fraction(value)) for value in values if value != 0]
    return sum(1 for a, b in zip(signs, signs[1:]) if a != b)


def rate_vector(currency: str, n: int, minors: dict, timing: int, digits: int, note=None):
    pmt, pv, fv = minors["pmt"], minors["pv"], minors["fv"]
    # the flows RATE's equation implies: pv at 0, pmt at 1..n (0..n-1 at the start), fv at n
    flows = [pmt] * (n + 1)
    if timing == 1:
        flows[0], flows[n] = pv + pmt, fv
    else:
        flows[0], flows[n] = pv, pmt + fv
    case = {"currency": currency, "nper": n, "pmt": str(pmt), "pv": str(pv), "fv": str(fv), "type": timing, "digits": digits}
    if note:
        case["note"] = note
    if sign_changes(flows) != 1:
        return None
    nonzero = [flow for flow in flows if flow != 0]
    unit = 10**digits
    lower = grid_root(lambda k: npv_sign(flows, Fraction(k, unit)), digits, sign(Fraction(nonzero[-1])), sign(Fraction(nonzero[0])))
    if lower is None:
        return None
    case["lower"] = str(lower)
    return case


def rate_cases_excel(rng: random.Random) -> list:
    cases = []
    while len(cases) < 120:
        currency, exponent = rng.choice(CURRENCIES)
        n = rng.choice([1, 2, 12, 36, 60, 360, rng.randint(1, 480)])
        timing = rng.randint(0, 1)
        loan = rng.randint(10**4, 10**9)
        if rng.random() < 0.6:
            balloon = 0 if rng.random() < 0.5 else rng.randint(0, loan // 2)
            payment = (loan - balloon) * rng.randint(60, 400) // (100 * n) + 1
            minors = {"pmt": -payment, "pv": loan, "fv": -balloon}
        else:
            payment = loan * rng.randint(30, 150) // (100 * n) + 1
            minors = {"pmt": -payment, "pv": -rng.randint(0, loan // 4), "fv": loan}
        case = rate_vector(currency, n, minors, timing, rng.randint(2, 14))
        if case is not None:
            cases.append(case)
    for edge in excel_edge_cases.RATES:
        minors = {name: edge_minor(edge[name]) for name in ("pmt", "pv", "fv")}
        case = rate_vector("USD", edge["nper"], minors, edge["type"], 16, edge["note"])
        assert case is not None, edge
        cases.append(case)
    return cases


def xnpv_sign(growth: Fraction, terms: list) -> int:
    exact = xnpv_exact(growth, terms)
    if exact is not None:
        return sign(exact)
    low, high = settle(lambda precision: xnpv_bounds(growth, terms, precision),
                       lambda bounds: bounds[0] > 0 or bounds[1] < 0, "the sign of XNPV")
    return 1 if low > 0 else -1


def xirr_vector(currency: str, exponent: int, minors: list, dates: list, digits: int, note=None):
    case = {"currency": currency, "values": [str(minor) for minor in minors], "dates": dates, "digits": digits}
    if note:
        case["note"] = note
    terms = dated_terms(minors, dates, "ACT/365F")
    combined = {}
    for years, value in terms:
        combined[years] = combined.get(years, 0) + value
    ordered = [combined[years] for years in sorted(combined) if combined[years] != 0]
    if not ordered or sign_changes(ordered) != 1:
        return None
    unit = 10**digits
    lower = grid_root(lambda k: xnpv_sign(1 + Fraction(k, unit), terms), digits, sign(ordered[-1]), sign(ordered[0]))
    if lower is None:
        return None
    case["lower"] = str(lower)
    return case


def xirr_cases(rng: random.Random) -> list:
    cases = []
    while len(cases) < 80:
        currency, exponent = rng.choice(CURRENCIES)
        count = rng.randint(2, 10)
        outlay = rng.randint(10**4, 10**9)
        total = outlay * rng.randint(30, 300) // 100
        returns = [rng.randint(0, total // (count - 1) * 2) for _ in range(count - 1)]
        if sum(returns) == 0:
            returns[-1] = total
        dates = dated_schedule(rng, count)
        # the outlay first, then returns on dates at or after it
        case = xirr_vector(currency, exponent, [-outlay] + returns, dates, rng.randint(2, 12))
        if case is not None:
            cases.append(case)
    for edge in excel_edge_cases.XIRRS:
        minors = [edge_minor(value) for value in edge["values"]]
        case = xirr_vector("USD", 2, minors, edge["dates"], 12, edge["note"])
        assert case is not None, edge
        cases.append(case)
    return cases


# ---- NPER ------------------------------------------------------------------------------------

def nper_vector(currency: str, rate: str, minors: dict, timing: int, digits: int, note=None) -> dict:
    r = Fraction(rate)
    pmt, pv, fv = (Fraction(minors[name]) for name in ("pmt", "pv", "fv"))
    case = {"currency": currency, "rate": rate, "type": timing, "digits": digits}
    case.update({name: str(minors[name]) for name in ("pmt", "pv", "fv")})
    if note:
        case["note"] = note
    unit = 10**digits
    if r == 0:
        if pmt == 0:
            case["lower"] = "throws"
            return case
        value = -(pv + fv) / pmt
        case["exact"] = to_text(value)
        case["lower"] = str((value * unit).numerator // (value * unit).denominator)
        return case
    paid = pmt * (1 + r * timing)
    top, bottom = paid - fv * r, paid + pv * r
    if top == 0 or bottom == 0 or (top > 0) != (bottom > 0):
        case["lower"] = "throws"
        return case
    growth, base = top / bottom, 1 + r

    def floors(precision):
        a_low, a_high = ln_bounds(growth, precision)
        b_low, b_high = ln_bounds(base, precision)
        if b_low <= 0 <= b_high:
            return None
        quotients = [a / b for a in (a_low, a_high) for b in (b_low, b_high)]
        return [(q * unit).numerator // (q * unit).denominator for q in (min(quotients), max(quotients))]

    def done(result):
        return result is not None and (result[0] == result[1] or result[1] - result[0] == 1)

    low, high = settle(floors, done, "NPER")
    if low != high:
        # the bounds straddle the grid point `high`: it is the value only if growth = base^(high/unit)
        candidate = Fraction(high, unit)
        power = rational_power(base, candidate) if abs(candidate.numerator) * base.numerator.bit_length() < 2**16 else None
        if power == growth:
            case["exact"] = to_text(candidate)
            low = high
        else:
            low, high = settle(floors, lambda result: result is not None and result[0] == result[1], "NPER")
    elif growth == 1:
        case["exact"] = "0/1"
    case["lower"] = str(low)
    return case


def nper_cases(rng: random.Random) -> list:
    cases = []
    while len(cases) < 150:
        currency, exponent = rng.choice(CURRENCIES)
        rate = periodic_rate_text(rng)
        minors = {
            name: 0 if rng.random() < 0.1 else rng.randint(-limit, limit)
            for name, limit in (("pmt", 10**7), ("pv", 10**9), ("fv", 10**9))
        }
        try:
            case = nper_vector(currency, rate, minors, rng.randint(0, 1), rng.randint(0, 25))
        except ValueError:
            continue  # a value the oracle can't settle (none expected)
        if case["lower"] == "throws" and rng.random() < 0.9:
            continue  # keep a few refusals, mostly values
        cases.append(case)
    for edge in excel_edge_cases.NPERS:
        minors = {name: edge_minor(edge[name]) for name in ("pmt", "pv", "fv")}
        cases.append(nper_vector("USD", edge["rate"], minors, edge["type"], 12, edge["note"]))
    return cases


def excel_vectors() -> dict:
    rng = random.Random(EXCEL_SEED)
    return {
        "annuities": annuity_cases_excel(rng),
        "nper": nper_cases(rng),
        "rate": rate_cases_excel(rng),
        "xnpv": xnpv_cases(rng),
        "xirr": xirr_cases(rng),
    }


def provenance(seed: int) -> dict:
    return {
        "source": "python-fractions",
        "generator": {
            "name": "scripts/gen-finance-vectors.py",
            "version": f"{GENERATOR_VERSION} (seed {seed})",
        },
        "method": "A second implementation of each definition in exact fractions. Irrational values are bounded from Python's correctly rounded decimal ln and exp, widened well past their rounding, with the precision raised until the bounds settle every value written.",
    }


def tables(prefix: str, sections: dict) -> list:
    return [{"op": f"{prefix}.{name}", "rows": rows} for name, rows in sections.items()]


def main() -> None:
    rng = random.Random(SEED)
    finance = {
        "yearFraction": year_fraction_cases(rng),
        "interest": interest_cases(rng),
        "compound": compound_cases(rng),
        "amortise": amortise_cases(rng),
        "npv": npv_cases(rng),
        "irr": irr_cases(rng),
        "irrBracketed": bracketed_irr_cases(rng),
        "proration": proration_cases(rng),
        "paymentDates": payment_date_cases(rng),
    }
    texts = {
        vector_path("finance", "fractions"): file_text(
            "finance",
            "fractions",
            "ducat's /finance functions (day counts, interest, compounding, amortisation, proration, payment dates) and Excel's NPV and IRR, on random cases.",
            provenance(SEED),
            tables("finance", finance),
        ),
        vector_path("excel", "fractions"): file_text(
            "excel",
            "fractions",
            "Excel's FV, PV, PMT, NPER, RATE, XNPV and XIRR, on random cases and the edge cases in scripts/excel_edge_cases.py.",
            provenance(EXCEL_SEED),
            tables("excel", excel_vectors()),
        ),
    }
    write_or_check(texts, "python3 scripts/gen-finance-vectors.py")


if __name__ == "__main__":
    main()
