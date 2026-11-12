#!/usr/bin/env python3
"""Spreadsheet reference vectors for /finance's Excel-named functions (npv, irr), computed by
LibreOffice Calc's NPV and IRR, for fv, pv, pmt, nper and rate, computed by Calc's FV, PV, PMT,
NPER and RATE, for xnpv and xirr, computed by Calc's XNPV and XIRR, and for periodicRate and annualRate, computed by Calc's POWER, all written to
test/vectors/finance-calc.json, which test/finance.excel.test.ts checks.

Calc computes in doubles, so its results are compared at 15 significant digits (NPV) and at the
spreadsheet's stated IRR accuracy. This needs LibreOffice (`soffice`) and is not run in CI: the
JSON file is the record. Regenerate with
    python3 scripts/gen-calc-vectors.py
Deterministic inputs: the same seed always writes the same cases.
"""
import csv
from fractions import Fraction
import json
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.sax.saxutils import quoteattr

SEED = 20261108
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "test" / "vectors" / "finance-calc.json"
MAX_FLOWS = 40
# 16 significant digits, as text, so the CSV export doesn't round the double
SCIENTIFIC = "0.000000000000000E+00"


def column(index: int) -> str:
    name = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def amount(rng: random.Random) -> str:
    """a cash flow in major units with two decimals"""
    cents = rng.randint(-10**9, 10**9)
    sign = "-" if cents < 0 else ""
    return f"{sign}{abs(cents) // 100}.{abs(cents) % 100:02d}"


def npv_cases(rng: random.Random) -> list:
    cases = []
    for _ in range(300):
        count = rng.randint(1, MAX_FLOWS)
        places = rng.randint(1, 5)
        # from -0.5 to 3, with `places` decimals, built from an integer (no float formatting)
        units = rng.randint(-(10**places) // 2, 3 * 10**places)
        digits = str(abs(units)).rjust(places + 1, "0")
        rate = ("-" if units < 0 else "") + digits[:-places] + "." + digits[-places:]
        cases.append({"rate": rate, "flows": [amount(rng) for _ in range(count)]})
    return cases


def irr_cases(rng: random.Random) -> list:
    cases = []
    for _ in range(200):
        count = rng.randint(2, 30)
        outlay = rng.randint(1, 10**7)
        # returns sized so the IRR lands in a range Calc's Newton iteration from 10% reaches
        scale = outlay * rng.choice([0.05, 0.1, 0.2, 0.4])
        flows = [-outlay] + [rng.randint(0, int(scale) + 1) for _ in range(count - 1)]
        if sum(flows[1:]) == 0:
            flows[-1] = outlay
        text = [f"{flow // 100}.{flow % 100:02d}" if flow >= 0 else f"-{-flow // 100}.{-flow % 100:02d}" for flow in flows]
        cases.append({"flows": text})
    return cases


def decimal_rate(rng: random.Random, low_tenths: int, high_tenths: int) -> str:
    """a rate from low_tenths/10 to high_tenths/10 with 1 to 6 decimals, built from an integer"""
    places = rng.randint(1, 6)
    units = rng.randint(low_tenths * 10**places // 10, high_tenths * 10**places // 10)
    digits = str(abs(units)).rjust(places + 1, "0")
    return ("-" if units < 0 else "") + digits[:-places] + "." + digits[-places:]


def rate_cases(rng: random.Random) -> tuple:
    """annual rates for periodicRate and periodic rates for annualRate, with periods per year"""
    periodic = []
    for _ in range(150):
        per_year = rng.choice([1, 2, 4, 12, 52, 360, 365, 366, rng.randint(1, 400)])
        periodic.append({"annual": decimal_rate(rng, -9, 20), "perYear": per_year})
    annual = []
    for _ in range(150):
        per_year = rng.choice([1, 2, 4, 12, 52, 365, rng.randint(1, 400)])
        annual.append({"periodic": decimal_rate(rng, -1, 1), "perYear": per_year})
    return periodic, annual


def cents_text(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    return f"{sign}{abs(cents) // 100}.{abs(cents) % 100:02d}"


def annuity_cases(rng: random.Random) -> dict:
    """inputs for FV, PV and PMT (any signs), NPER (payments that settle) and RATE (one sign change)"""
    def periodic_rate() -> str:
        return "0" if rng.random() < 0.1 else decimal_rate(rng, -1, 3)

    def amount(limit: int) -> str:
        return "0" if rng.random() < 0.1 else cents_text(rng.randint(-limit, limit))

    general = []
    for _ in range(150):
        general.append({
            "rate": periodic_rate(),
            "nper": rng.choice([1, 12, 60, 360, rng.randint(1, 480)]),
            "pmt": amount(10**7),
            "pv": amount(10**9),
            "fv": amount(10**9),
            "type": rng.randint(0, 1),
        })
    nper = []
    for _ in range(75):
        rate = "0" if rng.random() < 0.1 else decimal_rate(rng, 0, 1)
        loan = rng.randint(10**4, 10**9)
        units, places = rate.replace("-", "").split(".") if "." in rate else (rate, "")
        # an interest charge below the payment, so the loan is paid off; or a savings plan
        interest = loan * int(units + places) // 10 ** len(places)
        payment = interest + rng.randint(1, max(2, loan // 12))
        if rng.random() < 0.5:
            case = {"pmt": cents_text(-payment), "pv": cents_text(loan), "fv": "0"}
        else:
            case = {"pmt": cents_text(-payment), "pv": cents_text(-rng.randint(0, loan)), "fv": cents_text(loan * rng.randint(1, 20))}
        case.update({"rate": rate, "type": rng.randint(0, 1)})
        nper.append(case)
    # any signs and rates from -5% to 10%, kept where NPER has a value (its log's argument is
    # positive), so negative rates and negative numbers of periods are covered
    while len(nper) < 150:
        rate = decimal_rate(rng, -1, 1)
        timing = rng.randint(0, 1)
        pmt, pv, fv = (rng.randint(-10**7, 10**7) for _ in range(3))
        r = Fraction(rate)
        paid = pmt * (1 + r * timing)
        top, bottom = paid - fv * r, paid + pv * r
        if r == 0 or pmt == 0 or top == 0 or bottom == 0 or (top > 0) != (bottom > 0):
            continue
        nper.append({"pmt": cents_text(pmt), "pv": cents_text(pv), "fv": cents_text(fv), "rate": rate, "type": timing})
    # Microsoft's RATE example first, then loans (some with a balloon left, as a negative fv) and
    # savings plans (paid out, then a positive fv), at either timing: one sign change each
    rate_cases_ = [{"nper": 48, "pmt": "-200", "pv": "8000", "fv": "0", "type": 0}]
    while len(rate_cases_) < 150:
        periods = rng.choice([12, 36, 60, 360, rng.randint(2, 480)])
        timing = rng.randint(0, 1)
        amount = rng.randint(10**4, 10**9)
        if rng.random() < 0.6:
            balloon = 0 if rng.random() < 0.5 else rng.randint(0, amount // 2)
            # payments totalling from 0.6 to 4 times the loan: a rate from about -8% upwards
            payment = (amount - balloon) * rng.randint(60, 400) // (100 * periods) + 1
            if timing == 1 and payment >= amount:
                continue
            rate_cases_.append({"nper": periods, "pmt": cents_text(-payment), "pv": cents_text(amount), "fv": cents_text(-balloon), "type": timing})
        else:
            start = rng.randint(0, amount // 4)
            payment = amount * rng.randint(30, 150) // (100 * periods) + 1
            rate_cases_.append({"nper": periods, "pmt": cents_text(-payment), "pv": cents_text(-start), "fv": cents_text(amount), "type": timing})
    return {"fv": general, "pv": general, "pmt": general, "nper": nper, "rate": rate_cases_}


def dated_cases(rng: random.Random) -> tuple:
    """flows on dates for XNPV (any rate above -1) and XIRR (an outlay, then returns)"""
    import datetime

    def schedule(count: int) -> list:
        start = datetime.date(2000, 1, 1) + datetime.timedelta(days=rng.randint(0, 9000))
        # the first date starts the schedule; the others are later, in any order
        later = [start + datetime.timedelta(days=rng.randint(1, 3650)) for _ in range(count - 1)]
        return [start.isoformat()] + [day.isoformat() for day in later]

    xnpv = []
    for _ in range(150):
        count = rng.randint(2, 20)
        values = [cents_text(-rng.randint(1, 10**9))] + [cents_text(rng.randint(-10**8, 10**9)) for _ in range(count - 1)]
        if not any(not value.startswith("-") and value != "0.00" for value in values[1:]):
            values[-1] = cents_text(rng.randint(1, 10**9))
        xnpv.append({"rate": decimal_rate(rng, -5, 10), "values": values, "dates": schedule(count)})
    xirr = []
    for _ in range(150):
        count = rng.randint(2, 20)
        outlay = rng.randint(10**4, 10**9)
        # returns totalling 0.5 to 3 times the outlay, all after it: one sign change
        total = outlay * rng.randint(50, 300) // 100
        returns = [rng.randint(0, total // (count - 1) * 2) for _ in range(count - 1)]
        if sum(returns) == 0:
            returns[-1] = total
        dates = schedule(count)
        xirr.append({"values": [cents_text(-outlay)] + [cents_text(value) for value in returns], "dates": dates})
    return xnpv, xirr


def date_cell(value: str) -> str:
    return f'<table:table-cell office:value-type="date" office:date-value={quoteattr(value)}/>'


def cell(value: str) -> str:
    return f'<table:table-cell office:value-type="float" office:value={quoteattr(value)}/>'


def formula_cell(formula: str) -> str:
    return f'<table:table-cell table:formula={quoteattr("of:=" + formula)} office:value-type="string"/>'


def sheet(npv: list, irr: list, periodic: list, annual: list, annuities: dict, dated: tuple) -> str:
    rows = []
    last = column(MAX_FLOWS)  # column of the last flow (flows start in column B)
    for i, case in enumerate(npv, start=1):
        cells = [cell(case["rate"])] + [cell(flow) for flow in case["flows"]]
        cells += ["<table:table-cell/>"] * (MAX_FLOWS + 1 - len(cells))
        cells.append(formula_cell(f'TEXT(NPV([.A{i}];[.B{i}:.{last}{i}]);"{SCIENTIFIC}")'))
        rows.append("<table:table-row>" + "".join(cells) + "</table:table-row>")
    offset = len(npv)
    for j, case in enumerate(irr, start=offset + 1):
        cells = ["<table:table-cell/>"] + [cell(flow) for flow in case["flows"]]
        cells += ["<table:table-cell/>"] * (MAX_FLOWS + 1 - len(cells))
        guess = f";{case['guess']}" if "guess" in case else ""
        cells.append(formula_cell(f'TEXT(IRR([.B{j}:.{last}{j}]{guess});"{SCIENTIFIC}")'))
        rows.append("<table:table-row>" + "".join(cells) + "</table:table-row>")
    # two rows per periodic case, the rate and 1 + rate (the subtraction loses digits), one per annual
    formulas = []
    for case in periodic:
        formulas.append((case["annual"], case["perYear"], "POWER(1+[.A{i}];1/[.B{i}])-1"))
        formulas.append((case["annual"], case["perYear"], "POWER(1+[.A{i}];1/[.B{i}])"))
    for case in annual:
        formulas.append((case["periodic"], case["perYear"], "POWER(1+[.A{i}];[.B{i}])-1"))
    for k, (rate, per_year, formula) in enumerate(formulas, start=offset + len(irr) + 1):
        cells = [cell(rate), cell(str(per_year))]
        cells += ["<table:table-cell/>"] * (MAX_FLOWS + 1 - len(cells))
        cells.append(formula_cell(f'TEXT({formula.format(i=k)};"{SCIENTIFIC}")'))
        rows.append("<table:table-row>" + "".join(cells) + "</table:table-row>")
    # Excel's argument order for each function, from columns A to E
    order = {
        "fv": ("rate", "nper", "pmt", "pv", "type"),
        "pv": ("rate", "nper", "pmt", "fv", "type"),
        "pmt": ("rate", "nper", "pv", "fv", "type"),
        "nper": ("rate", "pmt", "pv", "fv", "type"),
        "rate": ("nper", "pmt", "pv", "fv", "type"),
    }
    row = offset + len(irr) + len(formulas)
    for name, arguments in order.items():
        for case in annuities[name]:
            row += 1
            cells = [cell(str(case[argument])) for argument in arguments]
            cells += ["<table:table-cell/>"] * (MAX_FLOWS + 1 - len(cells))
            refs = ";".join(f"[.{column(index)}{row}]" for index in range(len(arguments)))
            cells.append(formula_cell(f'TEXT({name.upper()}({refs});"{SCIENTIFIC}")'))
            rows.append("<table:table-row>" + "".join(cells) + "</table:table-row>")
    # XNPV and XIRR: the rate in A, values from B, dates from V (20 columns each)
    for name, cases in (("XNPV", dated[0]), ("XIRR", dated[1])):
        for case in cases:
            row += 1
            count = len(case["values"])
            cells = [cell(case.get("rate", "0"))]
            cells += [cell(value) for value in case["values"]] + ["<table:table-cell/>"] * (20 - count)
            cells += [date_cell(day) for day in case["dates"]] + ["<table:table-cell/>"] * (20 - count)
            cells += ["<table:table-cell/>"] * (MAX_FLOWS + 1 - len(cells))
            values = f"[.B{row}:.{column(count)}{row}]"
            dates = f"[.V{row}:.{column(20 + count)}{row}]"
            call = f"XNPV([.A{row}];{values};{dates})" if name == "XNPV" else f"XIRR({values};{dates})"
            cells.append(formula_cell(f'TEXT({call};"{SCIENTIFIC}")'))
            rows.append("<table:table-row>" + "".join(cells) + "</table:table-row>")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"
  office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
<office:body><office:spreadsheet><table:table table:name="vectors">
{chr(10).join(rows)}
</table:table></office:spreadsheet></office:body></office:document>
"""


def run_calc(document: str) -> list:
    soffice = shutil.which("soffice")
    if soffice is None:
        sys.exit("LibreOffice (soffice) is needed to regenerate these vectors")
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / "vectors.fods"
        source.write_text(document)
        profile = Path(directory) / "profile"
        subprocess.run(
            [
                soffice,
                "--headless",
                "--norestore",
                f"-env:UserInstallation=file://{profile}",
                "--convert-to",
                "csv",
                "--outdir",
                directory,
                str(source),
            ],
            check=True,
            capture_output=True,
            timeout=300,
        )
        with open(Path(directory) / "vectors.csv", newline="") as handle:
            return [row[-1] for row in csv.reader(handle)]


def version() -> str:
    result = subprocess.run(["soffice", "--version"], capture_output=True, text=True, check=True)
    return result.stdout.strip()


def microsoft_cases() -> tuple:
    """Microsoft's documented examples, run through Calc too, so the two sources can be compared"""
    fixture = json.loads((ROOT / "test" / "fixtures" / "excel" / "microsoft.json").read_text())
    npv = [
        {"rate": example["rate"], "flows": example["values"], "microsoft": example["formula"]}
        for example in fixture["npv"]["examples"]
    ]
    irr = []
    for example in fixture["irr"]["examples"]:
        case = {"flows": example["values"], "microsoft": example["formula"]}
        if "guess" in example:
            case["guess"] = example["guess"]
        irr.append(case)
    return npv, irr


def main() -> None:
    rng = random.Random(SEED)
    microsoft_npv, microsoft_irr = microsoft_cases()
    npv = microsoft_npv + npv_cases(rng)
    irr = microsoft_irr + irr_cases(rng)
    # a generator of their own, so adding these cases left the npv and irr ones as they were
    periodic, annual = rate_cases(random.Random(SEED + 1))
    annuities = annuity_cases(random.Random(SEED + 2))
    dated = dated_cases(random.Random(SEED + 3))
    results = run_calc(sheet(npv, irr, periodic, annual, annuities, dated))
    expected = len(npv) + len(irr) + 2 * len(periodic) + len(annual)
    expected += sum(len(cases) for cases in annuities.values()) + len(dated[0]) + len(dated[1])
    if len(results) != expected:
        sys.exit(f"expected {expected} results, got {len(results)}")
    for case, result in zip(npv, results):
        case["calc"] = result
    for case, result in zip(irr, results[len(npv):]):
        case["calc"] = result
    rest = results[len(npv) + len(irr):]
    for index, case in enumerate(periodic):
        case["calc"] = rest[2 * index]
        case["calcOnePlus"] = rest[2 * index + 1]
    for case, result in zip(annual, rest[2 * len(periodic):]):
        case["calc"] = result
    rest = rest[2 * len(periodic) + len(annual):]
    annuity_vectors = {}
    for name, cases in annuities.items():
        # fv, pv and pmt share their inputs: each gets its own copies with its own result
        annuity_vectors[name] = [dict(case, calc=result) for case, result in zip(cases, rest)]
        rest = rest[len(cases):]
    for name, cases in (("xnpv", dated[0]), ("xirr", dated[1])):
        annuity_vectors[name] = [dict(case, calc=result) for case, result in zip(cases, rest)]
        rest = rest[len(cases):]
    vectors = {
        "comment": "Generated by scripts/gen-calc-vectors.py with LibreOffice Calc; do not edit.",
        "calc": version(),
        "npv": npv,
        "irr": irr,
        "periodicRate": periodic,
        "annualRate": annual,
        **annuity_vectors,
    }
    OUT.write_text(json.dumps(vectors, indent=1) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
