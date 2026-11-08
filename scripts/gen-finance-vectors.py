#!/usr/bin/env python3
"""Reference vectors for @ducatjs/money/finance, computed in exact rational arithmetic with Python's
fractions module, written to test/vectors/finance.json and checked by test/finance.oracle.test.ts.

This is a second implementation, written from the definitions rather than from the TypeScript: day
numbers come from datetime.date.toordinal, NPVs are summed term by term as fractions, and the IRR is
bracketed by bisection on the real line before it is truncated to the grid.

Deterministic: the same seed always writes the same file. Regenerate with
    python3 scripts/gen-finance-vectors.py
and check that nothing changed with --check.
"""
import datetime
import json
import random
import sys
from fractions import Fraction
from pathlib import Path

SEED = 20261108
OUT = Path(__file__).resolve().parent.parent / "test" / "vectors" / "finance.json"
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


def year_fraction(start: datetime.date, end: datetime.date, convention: str, termination=None) -> Fraction:
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
        if d2 == 31 or (is_last_of_february(end) and end != termination):
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
            termination = None
            if convention == "30E/360 ISDA" and rng.random() < 0.5:
                termination = end
                case["terminationDate"] = end.isoformat()
            value = year_fraction(start, end, convention, termination)
            case["want"] = f"{value.numerator}/{value.denominator}"
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
        exact = Fraction(principal, 10**exponent) * Fraction(rate) * year_fraction(start, end, convention)
        cases.append(
            {
                "currency": currency,
                "principal": str(principal),
                "rate": rate,
                "from": start.isoformat(),
                "to": end.isoformat(),
                "dayCount": convention,
                "mode": mode,
                "want": str(round_major(exact, exponent, mode)),
            }
        )
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
        residual = rng.choice(["lastPayment", "lastInterest"]) if method == "annuity" else "lastPayment"
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


def present_value(rate: Fraction, flows: list) -> Fraction:
    return sum((Fraction(flow) / (1 + rate) ** t for t, flow in enumerate(flows)), Fraction(0))


def npv_cases(rng: random.Random) -> list:
    cases = []
    for _ in range(200):
        currency, exponent = rng.choice(CURRENCIES)
        count = rng.randint(1, 40)
        flows = [rng.randint(-10**7, 10**7) for _ in range(count)]
        rate = rng.choice([rate_string(rng), "-" + rate_string(rng, zero_ok=False), "1.5"])
        mode = rng.choice(MODES)
        exact = present_value(Fraction(rate), flows) / 10**exponent
        cases.append(
            {
                "currency": currency,
                "flows": [str(flow) for flow in flows],
                "rate": rate,
                "mode": mode,
                "want": str(round_major(exact, exponent, mode)),
            }
        )
    return cases


def sign(value: Fraction) -> int:
    return (value > 0) - (value < 0)


def irr_grid(flows: list, digits: int) -> int:
    """the IRR truncated to `digits` places, as an integer count of 10^-digits"""
    first_sign = sign(Fraction(next(flow for flow in flows if flow != 0)))
    low, high = Fraction(-1), Fraction(1)
    while sign(present_value(high, flows)) not in (first_sign, 0):
        high *= 2
    if sign(present_value(Fraction(0), flows)) == first_sign:
        high = Fraction(0)
    else:
        low = Fraction(0) if high == 1 else high / 2
    # bisect on the real line until the bracket is far narrower than the grid
    width = Fraction(1, 10 ** (digits + 3))
    low_sign = -first_sign if low == -1 else sign(present_value(low, flows))
    while high - low > width:
        middle = (low + high) / 2
        middle_sign = sign(present_value(middle, flows))
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
        here_sign = -first_sign if here == -1 else sign(present_value(here, flows))
        if here_sign == 0 or here_sign != sign(present_value(above, flows)):
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


def main() -> None:
    rng = random.Random(SEED)
    vectors = {
        "comment": "Generated by scripts/gen-finance-vectors.py; do not edit.",
        "yearFraction": year_fraction_cases(rng),
        "interest": interest_cases(rng),
        "compound": compound_cases(rng),
        "amortise": amortise_cases(rng),
        "npv": npv_cases(rng),
        "irr": irr_cases(rng),
    }
    text = json.dumps(vectors, indent=1) + "\n"
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text() != text:
            print(f"{OUT.name} is out of date; run python3 scripts/gen-finance-vectors.py", file=sys.stderr)
            sys.exit(1)
        print(f"{OUT.name} is up to date")
        return
    OUT.write_text(text)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
