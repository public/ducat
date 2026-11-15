#!/usr/bin/env python3
"""Reference vectors for ducat's rate-source parsers, computed with Python's standard library
(csv-style reading by hand, xml.etree, json, datetime and fractions) from the files in
spec/fixtures/ and small inline variants, and the rules in docs/reference/rate-sources.md,
independently of ducat's TypeScript:

    spec/vectors/convert/sources.json

checked by test/spec.test.ts and the Rust port's rust/crates/ducat/tests/it/spec.rs.

Publication times follow the sources' stated rules with the clock rules written out here rather
than read from the system's time-zone data, so the output doesn't depend on the machine: the ECB's
16:00 in Frankfurt (CET, CEST from the last Sunday of March to the last Sunday of October, the EU
rule since 1996) and the Bank of Canada's 16:30 in Toronto (EST, EDT from the second Sunday of
March to the first Sunday of November, the rule since 2007).

Deterministic: regenerate with
    python3 scripts/gen-rate-source-vectors.py
and check that nothing changed with --check.
"""
import json
import re
import sys
import xml.etree.ElementTree as ElementTree
from datetime import date, datetime, timedelta, timezone
from fractions import Fraction

sys.dont_write_bytecode = True  # no __pycache__ in scripts/
from spec_vectors import ISO4217_PUBLISHED, ROOT, file_text, vector_path, write_or_check  # noqa: E402

# bumped when the output's layout changes
GENERATOR_VERSION = "1"
FIXTURES = ROOT / "spec" / "fixtures"


class Refused(Exception):
    """What the parser must refuse: `kind` is "syntax" (an unreadable file) or "range"."""

    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


def syntax():
    raise Refused("syntax")


# --- numbers and rates -------------------------------------------------------------------------

PLAIN = re.compile(r"^\d+(?:\.\d+)?$")
PUBLISHED = re.compile(r"^(?:0|[1-9]\d*)\.\d*0$")
MISSING = {"", "ND", "N/A", "NA", "N.A.", "-", "–", "—", "NAN", "NULL"}


def canonical(value: Fraction) -> str:
    den, twos, fives = value.denominator, 0, 0
    while den % 2 == 0:
        den, twos = den // 2, twos + 1
    while den % 5 == 0:
        den, fives = den // 5, fives + 1
    if den != 1:
        return f"{value.numerator}/{value.denominator}"
    places = max(twos, fives)
    units = value.numerator * 10**places // value.denominator
    digits = str(abs(units)).rjust(places + 1, "0")
    text = digits if places == 0 else f"{digits[:-places]}.{digits[-places:]}"
    return ("-" if units < 0 else "") + text


def cell(text: str):
    """A published rate cell: its decimal text, or None for a missing-value marker."""
    stripped = text.strip()
    if stripped.upper() in MISSING:
        return None
    if not PLAIN.match(stripped):
        syntax()
    return stripped


def with_decimals(text: str, decimals: int) -> str:
    whole, _, fraction = text.partition(".")
    if len(fraction) >= decimals:
        return text
    return f"{whole}.{fraction.ljust(decimals, '0')}"


def rate_json(source, target, value: Fraction, info: dict, quote=None, text=None) -> dict:
    """ducat's toJSON of a rate: the published text when a one-for-one quote keeps it."""
    if value <= 0:
        raise Refused("range")
    if quote is not None and "per" not in quote and not quote.get("inverted"):
        shown = quote["rate"]
    elif text is not None and PUBLISHED.match(text):
        shown = text
    else:
        shown = canonical(value)
    out = {"from": source, "to": target, "rate": shown}
    for key in ("source", "asOf", "availableAt", "validUntil", "type"):
        if info.get(key) is not None:
            out[key] = info[key]
    if quote is not None and ("per" in quote or quote.get("inverted")):
        out["quote"] = quote
    return out


def from_quote(source, target, quote: dict, info: dict) -> dict:
    """A rate from a published quote: rate / per, or per / rate when inverted."""
    if not PLAIN.match(quote["rate"]):
        raise Refused("range")
    per = quote.get("per", 1)
    if not isinstance(per, int) or isinstance(per, bool) or per < 1:
        raise Refused("range")
    published = Fraction(quote["rate"])
    if published == 0:
        raise Refused("range")
    value = per / published if quote.get("inverted") else published / per
    kept = {"rate": quote["rate"]}
    if per != 1:
        kept["per"] = per
    if quote.get("inverted"):
        kept["inverted"] = True
    return rate_json(source, target, value, info, kept)


def table(base, info: dict, entries: list, quoted=False) -> dict:
    """A one-base table: entries are (currency, text or quote or None), in order."""
    rates, missing = [], []
    for currency, entry in entries:
        if entry is None:
            missing.append(currency)
        elif quoted:
            rates.append(from_quote(base, currency, entry, info))
        else:
            rates.append(rate_json(base, currency, Fraction(entry), info, text=entry))
    out = {"base": base}
    for key in ("asOf", "availableAt", "validUntil"):
        if info.get(key) is not None:
            out[key] = info[key]
    out["missing"] = missing
    out["rates"] = rates
    return out


def newest_first(tables: list) -> list:
    return sorted(tables, key=lambda t: t["asOf"], reverse=True)


def add_day_rate(days: dict, day: str, currency: str, rate):
    rates = days.setdefault(day, {})
    if currency in rates and rates[currency] != rate:
        syntax()
    rates[currency] = rate


def calendar_day(year: int, month: int, day: int) -> str:
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        syntax()


def iso_calendar(text: str) -> bool:
    match = re.match(r"^(\d{4})-(\d\d)-(\d\d)$", text)
    if not match:
        return False
    try:
        date(int(match[1]), int(match[2]), int(match[3]))
        return True
    except ValueError:
        return False


def instant(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


# --- CSV, RFC 4180 -----------------------------------------------------------------------------


def csv_rows(text: str) -> list:
    """Records of a CSV file: a cell may be quoted ("" for a quote); a stray or unclosed quote is
    refused. Blank lines are skipped; CRLF and LF both end a record."""
    rows, row, current, state = [], [], "", "start"
    i = 0

    def end():
        nonlocal row, current, state
        row.append(current)
        if len(row) > 1 or row[0].strip() != "":
            rows.append(row)
        row, current, state = [], "", "start"

    while i < len(text):
        char = text[i]
        if state == "quoted":
            if char != '"':
                current += char
            elif text[i + 1 : i + 2] == '"':
                current += '"'
                i += 1
            else:
                state = "closed"
        elif char == ",":
            row.append(current)
            current, state = "", "start"
        elif char == "\n":
            end()
        elif char == "\r" and text[i + 1 : i + 2] == "\n":
            pass
        elif char == '"' and state == "start":
            state = "quoted"
        elif char == '"' or state == "closed":
            syntax()
        else:
            current += char
            state = "plain"
        i += 1
    if state == "quoted":
        syntax()
    if current != "" or row:
        end()
    return rows


def without_bom(text: str) -> str:
    return text[1:] if text.startswith("\ufeff") else text


# --- time zones: the stated publication times ---------------------------------------------------


def last_sunday(year: int, month: int) -> date:
    day = date(year, month + 1, 1) - timedelta(days=1) if month < 12 else date(year, 12, 31)
    return day - timedelta(days=(day.weekday() + 1) % 7)


def nth_sunday(year: int, month: int, n: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(6 - first.weekday()) % 7 + 7 * (n - 1))


def frankfurt_offset(day: date) -> int:
    """CET +1, CEST +2 from the last Sunday of March to the last Sunday of October (exclusive): the
    clocks change at 01:00 UTC, so on a change day noon UTC is already on the new offset."""
    return 2 if last_sunday(day.year, 3) <= day < last_sunday(day.year, 10) else 1


def toronto_offset(day: date) -> int:
    """EST −5, EDT −4 from the second Sunday of March to the first Sunday of November (exclusive);
    the change is at 02:00 local, before noon UTC."""
    return -4 if nth_sunday(day.year, 3, 2) <= day < nth_sunday(day.year, 11, 1) else -5


def local_time(day: str, hour: int, minute: int, offset: int) -> str:
    moment = datetime.fromisoformat(day).replace(hour=hour, minute=minute, tzinfo=timezone.utc)
    return instant(moment - timedelta(hours=offset))


def ecb_published(day: str) -> str:
    return local_time(day, 16, 0, frankfurt_offset(date.fromisoformat(day)))


def boc_published(day: str) -> str:
    return local_time(day, 16, 30, toronto_offset(date.fromisoformat(day)))


# --- the ECB -----------------------------------------------------------------------------------

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]


def ecb_table(day: str, entries: list, options: dict) -> dict:
    info = {"source": "ECB", "asOf": day, "type": "reference"}
    if options.get("availableAt") is True:
        info["availableAt"] = ecb_published(day)
    return table("EUR", info, entries)


def ecb_day(text: str) -> str:
    match = re.match(r"^(\d{4})-(\d\d)-(\d\d)$", text)
    if match:
        return calendar_day(int(match[1]), int(match[2]), int(match[3]))
    match = re.match(r"^(\d{1,2}) ([A-Za-z]+) (\d{4})$", text)
    if not match or match[2].lower() not in MONTHS:
        syntax()
    return calendar_day(int(match[3]), MONTHS.index(match[2].lower()) + 1, int(match[1]))


# A day is a Cube with only a time attribute, written with a closing tag: <Cube time='…'/> isn't
# one, and a file of only those has no day.
OPEN_DAY = re.compile(r"""<Cube\s+time=["']\d{4}-\d\d-\d\d["']\s*>""")


def ecb_xml(text: str, options: dict) -> list:
    """The Cube elements must nest (anything else is not an ECB file); a day's inner cubes are its
    rates, written <Cube …/> or <Cube …></Cube>."""
    try:
        root = ElementTree.fromstring(without_bom(text).encode())
    except ElementTree.ParseError:
        syntax()
    days, tables = len(OPEN_DAY.findall(without_bom(text))), []
    for cube in root.iter():
        # a day without inner cubes has no rates, written open or self-closing
        if not cube.tag.endswith("Cube") or "time" not in cube.attrib:
            continue
        day = ecb_day(cube.attrib["time"])
        entries = []
        for inner in cube:
            currency, rate = inner.attrib.get("currency"), inner.attrib.get("rate")
            if currency is None and rate is None:
                continue
            if currency is None or not re.match(r"^[A-Z]{3}$", currency) or rate is None or not PLAIN.match(rate):
                syntax()
            entries.append((currency, rate))
        if entries:
            tables.append(ecb_table(day, entries, options))
    if days == 0:
        syntax()
    return newest_first(tables)


def ecb_csv(text: str, options: dict) -> list:
    lines = [line for line in re.split(r"\r?\n", without_bom(text)) if line.strip() != ""]
    columns = [c.strip() for c in (lines[0] if lines else "").split(",")]
    if columns[0] != "Date":
        syntax()
    tables = []
    for line in lines[1:]:
        cells = [c.strip() for c in line.split(",")]
        day = ecb_day(cells[0])
        entries, quoted = [], 0
        for i, currency in enumerate(columns[1:], start=1):
            if not currency:
                continue
            rate = cell(cells[i] if i < len(cells) else "")
            entries.append((currency, rate))
            quoted += rate is not None
        if quoted:
            tables.append(ecb_table(day, entries, options))
    return newest_first(tables)


CAPPED = {"THB": 3, "LTL": 4}


def read_decimals(text: str) -> int:
    if not re.match(r"^\d{1,2}$", text) or int(text) > 30:
        syntax()
    return int(text)


def stated(currency: str, text: str) -> int:
    decimals = read_decimals(text)
    return min(decimals, CAPPED.get(currency, decimals))


def sdmx_records(text: str):
    rows = csv_rows(without_bom(text))
    if not rows:
        syntax()
    header, body = rows[0], rows[1:]
    if any(len(cells) != len(header) for cells in body):
        syntax()
    return header, body


def sdmx_columns(header: list, required: list) -> dict:
    columns = {}
    for i, name in enumerate(header):
        columns[name.strip()] = i
    if any(name not in columns for name in required):
        syntax()
    return columns


def sdmx_decimals(text: str) -> list:
    header, body = sdmx_records(text)
    columns = sdmx_columns(header, ["CURRENCY", "DECIMALS"])
    decimals = {}
    for cells in body:
        currency = cells[columns["CURRENCY"]].strip()
        decimals[currency] = stated(currency, cells[columns["DECIMALS"]].strip())
    return list(decimals.items())


def ecb_sdmx(text: str, options: dict) -> list:
    header, body = sdmx_records(text)
    columns = sdmx_columns(header, ["CURRENCY", "CURRENCY_DENOM", "TIME_PERIOD", "OBS_VALUE"])
    given = dict(options.get("decimals", []))

    def at(cells, name):
        return cells[columns[name]].strip()

    def optional(cells, name, default=None):
        return cells[columns[name]].strip() if name in columns else default

    days = {}
    for cells in body:
        currency, day = at(cells, "CURRENCY"), at(cells, "TIME_PERIOD")
        if (
            at(cells, "CURRENCY_DENOM") != "EUR"
            or optional(cells, "FREQ", "D") != "D"
            or optional(cells, "EXR_TYPE", "SP00") != "SP00"
            or optional(cells, "EXR_SUFFIX", "A") != "A"
        ):
            syntax()
        if not re.match(r"^[A-Z]{3}$", currency) or not re.match(r"^\d{4}-\d\d-\d\d$", day):
            syntax()
        if optional(cells, "UNIT_MULT", "") not in ("", "0"):
            syntax()
        rate = cell(at(cells, "OBS_VALUE"))
        if rate is not None:
            decimals = given.get(currency)
            own = optional(cells, "DECIMALS")
            if own not in (None, ""):
                decimals = stated(currency, own)
            if decimals is not None:
                rate = with_decimals(rate, decimals)
        add_day_rate(days, calendar_day(int(day[:4]), int(day[5:7]), int(day[8:])), currency, rate)
    tables = [ecb_table(day, list(rates.items()), options) for day, rates in days.items() if any(r is not None for r in rates.values())]
    return newest_first(tables)


# --- the Bank of Canada ------------------------------------------------------------------------


def boc(text: str, options: dict) -> list:
    try:
        parsed = json.loads(text)
    except ValueError:
        syntax()
    if not isinstance(parsed, dict) or not isinstance(parsed.get("observations"), list):
        syntax()
    series_re = re.compile(r"^FX([A-Z]{3})CAD$")
    detail = parsed.get("seriesDetail") or {}
    if not isinstance(detail, dict):
        detail = {}
    expected = []
    for series in detail:
        if not series_re.match(series):
            syntax()
        expected.append(series)
    days = {}
    for observation in parsed["observations"]:
        day = observation.get("d") if isinstance(observation, dict) else None
        if not isinstance(day, str) or not iso_calendar(day):
            syntax()
        for series, value_cell in observation.items():
            if series == "d":
                continue
            match = series_re.match(series)
            if not match:
                syntax()
            # a cell is {"v": text or null}; anything else can't be read
            if not isinstance(value_cell, dict) or "v" not in value_cell:
                syntax()
            value = value_cell["v"]
            if value is not None and not isinstance(value, str):
                syntax()
            rate = None if value is None else cell(value)
            if rate is not None and Fraction(rate) == 0:
                syntax()
            add_day_rate(days, day, match[1], rate)
        for series in expected:
            currency = series_re.match(series)[1]
            if currency not in days.get(day, {}):
                add_day_rate(days, day, currency, None)
    tables = []
    for day, rates in days.items():
        if not any(rate is not None for rate in rates.values()):
            continue
        info = {"source": "BoC", "asOf": day, "type": "average"}
        if options.get("availableAt", True) is not False:
            info["availableAt"] = boc_published(day)
        entries = [(c, None if r is None else {"rate": r, "inverted": True}) for c, r in rates.items()]
        tables.append(table("CAD", info, entries, quoted=True))
    return newest_first(tables)


# --- the Federal Reserve -----------------------------------------------------------------------

FED_COUNTRIES = {"AL": "AUD", "EU": "EUR", "NZ": "NZD", "UK": "GBP", "BZ": "BRL", "CA": "CAD", "CH": "CNY", "DN": "DKK", "HK": "HKD", "IN": "INR", "JA": "JPY", "MA": "MYR", "MX": "MXN", "NO": "NOK", "SF": "ZAR", "SI": "SGD", "KO": "KRW", "SL": "LKR", "SD": "SEK", "SZ": "CHF", "TA": "TWD", "TH": "THB", "VES": "VEB"}


def fed(text: str, options: dict) -> list:
    rows = csv_rows(without_bom(text))
    series = next((r for r in rows if r[0].strip() == "Time Period"), None)
    if series is None:
        syntax()

    def labelled(label):
        row = next((r for r in rows if r[0].strip() == label), None)
        if row is None or len(row) != len(series):
            syntax()
        return row

    currencies, multipliers, units = labelled("Currency:"), labelled("Multiplier:"), labelled("Unit:")
    columns = []
    for i in range(1, len(series)):
        match = re.match(r"^(?:H10/H10/)?RXI(\$US)?_N\.B\.([A-Z]{2,3})$", series[i].strip())
        currency = currencies[i].strip()
        if match is None or not re.match(r"^[A-Z]{3}$", currency) or currency == "USD":
            syntax()
        if FED_COUNTRIES.get(match[2], currency) != currency:
            syntax()
        if any(c == currency for c, _ in columns):
            syntax()
        if units[i].strip() != "Currency" or multipliers[i].strip() != "1":
            syntax()
        columns.append((currency, match[1] is not None))
    observations = rows[rows.index(series) + 1 :]
    if not observations:
        syntax()
    days = {}
    for cells in observations:
        day = cells[0].strip()
        if not iso_calendar(day) or len(cells) != len(series):
            syntax()
        for i, (currency, _) in enumerate(columns):
            add_day_rate(days, day, currency, cell(cells[i + 1]))
    tables = []
    for day, published in days.items():
        entries = []
        for currency, inverted in columns:
            rate = published.get(currency)
            entries.append((currency, None if rate is None else ({"rate": rate, "inverted": True} if inverted else {"rate": rate})))
        if any(e is not None for _, e in entries):
            tables.append(table("USD", {"source": "FRB", "asOf": day, "type": "noon buying"}, entries, quoted=True))
    return newest_first(tables)


# --- the Bank of England and HMRC --------------------------------------------------------------

BOE_SERIES = {"XUDLADS": "AUD", "XUDLZOS3": "BGN", "XUDLCDS": "CAD", "XUDLBK89": "CNY", "XUDLBK25": "CZK", "XUDLDKS": "DKK", "XUDLERS": "EUR", "XUDLHDS": "HKD", "XUDLBK33": "HUF", "XUDLBK97": "INR", "XUDLBK78": "ILS", "XUDLJYS": "JPY", "XUDLBK83": "MYR", "XUDLNDS": "NZD", "XUDLNKS": "NOK", "XUDLBK47": "PLN", "XUDLZOS4": "RON", "XUDLSRS": "SAR", "XUDLSGS": "SGD", "XUDLZRS": "ZAR", "XUDLBK93": "KRW", "XUDLSKS": "SEK", "XUDLSFS": "CHF", "XUDLTWS": "TWD", "XUDLBK87": "THB", "XUDLBK95": "TRY", "XUDLUSS": "USD"}
SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def boe(text: str, options: dict) -> list:
    decimals = options.get("decimals", 4)
    rows = csv_rows(without_bom(text))
    if not rows or rows[0][0].strip() != "DATE" or len(rows[0]) < 2:
        syntax()
    header, body = rows[0], rows[1:]
    currencies = []
    for code in header[1:]:
        if code.strip() not in BOE_SERIES:
            syntax()
        currencies.append(BOE_SERIES[code.strip()])
    if len(set(currencies)) != len(currencies) or not body:
        syntax()
    days = {}
    for cells in body:
        if len(cells) != len(header):
            syntax()
        match = re.match(r"^(\d\d) ([A-Z][a-z]{2}) (\d{4})$", cells[0].strip())
        if not match or match[2] not in SHORT_MONTHS:
            syntax()
        day = f"{match[3]}-{SHORT_MONTHS.index(match[2]) + 1:02d}-{match[1]}"
        if not iso_calendar(day):
            syntax()
        for i, currency in enumerate(currencies):
            add_day_rate(days, day, currency, cell(cells[i + 1]))
    tables = []
    for day, rates in days.items():
        if any(r is not None for r in rates.values()):
            entries = [(c, None if r is None else {"rate": with_decimals(r, decimals)}) for c, r in rates.items()]
            tables.append(table("GBP", {"source": "BoE", "asOf": day, "type": "spot"}, entries, quoted=True))
    if not tables:
        syntax()
    return newest_first(tables)


def hmrc_published(start: str) -> str:
    """The end (UTC) of the Wednesday before the penultimate Thursday of the month before: that is,
    the start of the penultimate Thursday."""
    first = date.fromisoformat(start).replace(day=1)
    last = first - timedelta(days=1)
    thursday = last - timedelta(days=(last.weekday() - 3) % 7)
    return f"{(thursday - timedelta(days=7)).isoformat()}T00:00:00.000Z"


def hmrc(text: str, options: dict) -> list:
    rows = csv_rows(without_bom(text))
    names = [n.strip() for n in rows[0]] if rows else []
    wanted = ["Currency Code", "Currency Units per £1", "Start date", "End date"]
    if any(name not in names for name in wanted):
        syntax()
    code_at, rate_at, start_at, end_at = (names.index(name) for name in wanted)
    body = rows[1:]
    if not body:
        syntax()

    def uk(text):
        match = re.match(r"^(\d\d)/(\d\d)/(\d{4})$", text.strip())
        day = f"{match[3]}-{match[2]}-{match[1]}" if match else ""
        if not iso_calendar(day):
            syntax()
        return day

    periods = {}
    for cells in body:
        if len(cells) != len(names):
            syntax()
        code = cells[code_at].strip()
        if not re.match(r"^[A-Z]{3}$", code) or code == "GBP":
            syntax()
        start, end = uk(cells[start_at]), uk(cells[end_at])
        if end < start:
            syntax()
        rate = cell(cells[rate_at])
        if rate is None:
            syntax()
        add_day_rate(periods.setdefault((start, end), {}), start, code, rate)
    tables = []
    for (start, end), codes in periods.items():
        info = {"source": "HMRC", "asOf": start, "validUntil": end, "type": "customs"}
        if options.get("availableAt", True) is not False:
            info["availableAt"] = hmrc_published(start)
        tables.append(table("GBP", info, list(codes[start].items())))
    return newest_first(tables)


PARSERS = {"ecbXml": ecb_xml, "ecbCsv": ecb_csv, "ecbSdmx": ecb_sdmx, "boc": boc, "fed": fed, "boe": boe, "hmrc": hmrc}


def source_text(row: dict) -> str:
    if "fixture" in row:
        return (FIXTURES / row["fixture"]).read_text(encoding="utf-8")
    return row["text"]


def parse(row: dict) -> list:
    options = dict(row.get("options", {}))
    if "decimalsFrom" in options:
        options["decimals"] = sdmx_decimals((FIXTURES / options.pop("decimalsFrom")).read_text(encoding="utf-8"))
    return PARSERS[row["parser"]](source_text(row), options)


# --- the inputs --------------------------------------------------------------------------------

ECB_XML = "<gesmes:Envelope xmlns:gesmes='http://www.gesmes.org/xml/2002-08-01'><Cube>{}</Cube></gesmes:Envelope>"


def ecb_xml_day(cubes: str, day: str = "2026-11-06") -> str:
    return f"<Cube time='{day}'>{cubes}</Cube>"


SDMX_HEADER = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE"


def sdmx_row(currency: str, day: str, value: str, kind: str = "SP00") -> str:
    return f"EXR.D.{currency}.EUR.{kind}.A,D,{currency},EUR,{kind},A,{day},{value}"


def valet(*observations, detail=None) -> str:
    body = {"observations": list(observations)}
    if detail is not None:
        body = {"seriesDetail": {name: {} for name in detail}, **body}
    return json.dumps(body)


FED_HEADER = '"Series Description","Euro","Japanese Yen"\n"Unit:","Currency","Currency"\n"Multiplier:","1","1"\n"Currency:","EUR","JPY"\n"Unique Identifier: ","H10/H10/RXI$US_N.B.EU","H10/H10/RXI_N.B.JA"\n"Time Period","RXI$US_N.B.EU","RXI_N.B.JA"'
HMRC_HEADER = "Country/Territories,Currency,Currency Code,Currency Units per £1,Start date,End date"


def hmrc_row(code: str, rate: str, start: str = "01/11/2026", end: str = "30/11/2026") -> str:
    return f"Somewhere,Unit,{code},{rate},{start},{end}"


def parse_inputs() -> list:
    rows = [
        {"parser": "ecbXml", "fixture": "ecb/eurofxref-daily.xml"},
        {"parser": "ecbXml", "fixture": "ecb/eurofxref-daily.xml", "options": {"availableAt": True}},
        {"parser": "ecbXml", "fixture": "ecb/eurofxref-hist-2d.xml"},
        {"parser": "ecbCsv", "fixture": "ecb/eurofxref.csv"},
        {"parser": "ecbCsv", "fixture": "ecb/eurofxref-hist.csv"},
        {"parser": "ecbCsv", "fixture": "ecb/eurofxref-hist.csv", "options": {"availableAt": True}},
        {"parser": "ecbSdmx", "fixture": "ecb-sdmx/exr-d-full.csv"},
        {"parser": "ecbSdmx", "fixture": "ecb-sdmx/exr-d-dataonly.csv"},
        {"parser": "ecbSdmx", "fixture": "ecb-sdmx/exr-d-dataonly.csv", "options": {"decimalsFrom": "ecb-sdmx/exr-d-nodata.csv"}},
        {"parser": "ecbSdmx", "fixture": "ecb-sdmx/exr-d-last1.csv"},
        {"parser": "boc", "fixture": "boc/fx-rates-daily.json"},
        {"parser": "boc", "fixture": "boc/fx-rates-daily.json", "options": {"availableAt": False}},
        {"parser": "fed", "fixture": "fed/h10-daily.csv"},
        {"parser": "boe", "fixture": "boe/spot-sample.csv"},
        {"parser": "boe", "fixture": "boe/spot-sample.csv", "options": {"decimals": 6}},
        {"parser": "hmrc", "fixture": "hmrc/monthly_csv_2026-11.csv"},
        {"parser": "hmrc", "fixture": "hmrc/monthly_csv_2026-11.csv", "options": {"availableAt": False}},
    ]
    # the ECB's publication time either side of each clock change, and on the change days
    for day in ["2026-03-27", "2026-03-30", "2026-10-23", "2026-10-26", "2027-03-26", "2027-03-29", "2026-01-05", "2026-07-01"]:
        rows.append({"parser": "ecbXml", "text": ECB_XML.format(ecb_xml_day("<Cube currency='USD' rate='1.1000'/>", day)), "options": {"availableAt": True}})
    # the ECB XML: spacing, a byte-order mark, an empty inner cube, a day without rates
    rows += [
        {"parser": "ecbXml", "text": "\ufeff" + ECB_XML.format(ecb_xml_day('<Cube currency="JPY" rate="170"/>', "2026-11-05") + ecb_xml_day("<Cube/><Cube currency='USD' rate='1.1'/>"))},
        {"parser": "ecbXml", "text": ECB_XML.format(ecb_xml_day("") + ecb_xml_day("<Cube currency='USD' rate='1.10'/>", "2026-11-05"))},
    ]
    for cube in ["<Cube currency='USD'/>", "<Cube rate='1.1'/>", "<Cube currency='usd' rate='1.1'/>", "<Cube currency='USDX' rate='1.1'/>", "<Cube currency='USD' rate='1.1.1'/>", "<Cube currency='USD' rate='x1.1'/>", "<Cube currency='USD' rate='-1.1'/>"]:
        rows.append({"parser": "ecbXml", "text": ECB_XML.format(ecb_xml_day(cube))})
    # a day ends at its own closing tag: inner cubes written <Cube …></Cube> are all kept, and cubes
    # that don't nest aren't an ECB file; a self-closing day cube isn't a day
    rows += [
        {"parser": "ecbXml", "text": ECB_XML.format(ecb_xml_day("<Cube currency='USD' rate='1.1'></Cube><Cube currency='JPY' rate='170'></Cube>"))},
        {"parser": "ecbXml", "text": ECB_XML.format("<Cube time='2026-11-06'><Cube currency='USD' rate='1.1'/>")},
        {"parser": "ecbXml", "text": ECB_XML.format(ecb_xml_day("<Cube currency='USD' rate='1.1'/>") + "</Cube>")},
        {"parser": "ecbXml", "text": ECB_XML.format("<Cube time='2026-11-06'/>")},
        {"parser": "ecbXml", "text": ECB_XML.format("<Cube time='2026-11-06'/>" + ecb_xml_day("<Cube currency='USD' rate='1.1'/>", "2026-11-05"))},
    ]
    # every month name, in any case
    months = ["January", "february", "MARCH", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    rows.append({"parser": "ecbCsv", "text": "Date,USD\n" + "".join(f"06 {name} 2026,1.1\n" for name in months)})
    rows += [
        {"parser": "ecbXml", "text": "<Envelope/>"},
        {"parser": "ecbXml", "text": ECB_XML.format(ecb_xml_day("<Cube currency='USD' rate='1.1'/>", "2026-02-30"))},
    ]
    # the ECB CSV
    rows += [
        {"parser": "ecbCsv", "text": "Date, USD, JPY\n06 November 2026, 1.1165, 176.77\n05 NOVEMBER 2026, 1.1224, N/A\n"},
        {"parser": "ecbCsv", "text": "\ufeffDate,USD,JPY\r\n\r\n2026-11-06,1.1165\r\n2026-11-05,,\r\n"},
        {"parser": "ecbCsv", "text": "Day,USD\n2026-11-06,1.1\n"},
        {"parser": "ecbCsv", "text": "Date,USD\n2026-11-06,1,1\n"},
        {"parser": "ecbCsv", "text": "Date,USD\n2026-11-06,x\n"},
        {"parser": "ecbCsv", "text": "Date,USD\n31 November 2026,1.1\n"},
        {"parser": "ecbCsv", "text": "Date,USD\n6 Smarch 2026,1.1\n"},
        {"parser": "ecbCsv", "text": ""},
    ]
    # SDMX-CSV
    full = f"{SDMX_HEADER},DECIMALS"
    rows += [
        {"parser": "ecbSdmx", "text": f"{full}\n{sdmx_row('THB', '2026-11-06', '37.459')},4\n{sdmx_row('LTL', '2014-12-31', '3.4528')},5\n{sdmx_row('THB', '2026-11-05', '37.46')},4\n{sdmx_row('USD', '2026-11-05', '1.1')},4\n"},
        {"parser": "ecbSdmx", "text": f"\ufeff{SDMX_HEADER},TITLE\r\n{sdmx_row('USD', '2026-11-06', '1.1165')},\"a, \"\"b\"\"\"\r\n{sdmx_row('JPY', '2026-11-06', '')},x\r\n{sdmx_row('ISK', '2026-11-06', 'NaN')},x\r\n"},
        {"parser": "ecbSdmx", "text": f"{SDMX_HEADER}\n{sdmx_row('USD', '2026-11-06', '1.1')}\n{sdmx_row('USD', '2026-11-06', '1.1')}\n"},
        {"parser": "ecbSdmx", "text": f"{SDMX_HEADER}\n{sdmx_row('USD', '2026-11-06', '1.1')}\n{sdmx_row('USD', '2026-11-06', '1.2')}\n"},
        {"parser": "ecbSdmx", "text": f"{SDMX_HEADER}\nEXR.M.USD.EUR.SP00.A,M,USD,EUR,SP00,A,2026-10,1.16\n"},
        {"parser": "ecbSdmx", "text": f"{SDMX_HEADER}\n{sdmx_row('USD', '2026-11-06', '1.1', 'SP01')}\n"},
        {"parser": "ecbSdmx", "text": f"{SDMX_HEADER}\nEXR.D.USD.GBP.SP00.A,D,USD,GBP,SP00,A,2026-11-06,1.3\n"},
        {"parser": "ecbSdmx", "text": f"{SDMX_HEADER},UNIT_MULT\n{sdmx_row('JPY', '2026-11-06', '1.7677')},2\n"},
        {"parser": "ecbSdmx", "text": f"{SDMX_HEADER},UNIT_MULT\n{sdmx_row('JPY', '2026-11-06', '176.77')},0\n"},
        {"parser": "ecbSdmx", "text": f"{full}\n{sdmx_row('USD', '2026-11-06', '1.1')},99\n"},
        {"parser": "ecbSdmx", "text": f"{SDMX_HEADER}\n{sdmx_row('USD', '2026-11-06', '1.1')},extra\n"},
        {"parser": "ecbSdmx", "text": f"{SDMX_HEADER}\n{sdmx_row('USD', '2026-02-30', '1.1')}\n"},
        {"parser": "ecbSdmx", "text": f"{SDMX_HEADER}\n{sdmx_row('USD', '2026-11-06', '1.1')}x\"\n"},
        {"parser": "ecbSdmx", "text": "KEY,CURRENCY\nx,USD\n"},
        {"parser": "ecbSdmx", "text": ""},
        {"parser": "ecbSdmx", "text": f"{SDMX_HEADER}\n{sdmx_row('USD', '2026-11-06', '')}\n"},
        {"parser": "ecbSdmx", "text": f"{SDMX_HEADER}\n{sdmx_row('USD', '2026-11-06', '1.1')}\n", "options": {"decimals": [["USD", 4]], "availableAt": True}},
    ]
    # Valet
    rows += [
        {"parser": "boc", "text": valet({"d": "2026-11-06", "FXUSDCAD": {"v": "1.3654"}, "FXEURCAD": {"v": ""}})},
        {"parser": "boc", "text": valet({"d": "2026-11-06", "FXUSDCAD": {"v": "1.3654"}, "FXEURCAD": {"v": None}})},
        {"parser": "boc", "text": valet({"d": "2026-11-06", "FXUSDCAD": {"v": "1.3654"}}, detail=["FXUSDCAD", "FXJPYCAD"])},
        {"parser": "boc", "text": valet({"d": "2026-11-06", "FXUSDCAD": {"v": ""}})},
        {"parser": "boc", "text": valet({"d": "2026-11-06", "FXUSDCAD": {"v": "1.36"}}, {"d": "2026-11-06", "FXUSDCAD": {"v": "1.36"}, "FXEURCAD": {"v": "1.60"}})},
        {"parser": "boc", "text": valet({"d": "2026-11-06", "FXUSDCAD": {"v": "1.36"}}, {"d": "2026-11-06", "FXUSDCAD": {"v": "1.37"}})},
        {"parser": "boc", "text": valet({"d": "2026-03-06", "FXUSDCAD": {"v": "1.36"}}, {"d": "2026-03-09", "FXUSDCAD": {"v": "1.36"}}, {"d": "2026-10-30", "FXUSDCAD": {"v": "1.36"}}, {"d": "2026-11-02", "FXUSDCAD": {"v": "1.36"}})},
        {"parser": "boc", "text": valet({"d": "2026-11-06", "FXUSDCAD": {"v": "1.3654"}, "V39079": {"v": "2.25"}})},
        {"parser": "boc", "text": json.dumps({"seriesDetail": {"FXMUSDCAD": {}}, "observations": [{"d": "2026-10-01", "FXMUSDCAD": {"v": "1.3800"}}]})},
        {"parser": "boc", "text": valet({"d": "2026-02-30"})},
        {"parser": "boc", "text": valet({"d": "06/11/2026"})},
        {"parser": "boc", "text": valet({"d": "2026-11-06", "FXUSDCAD": {"v": "0.0000"}})},
        {"parser": "boc", "text": valet({"d": "2026-11-06", "FXUSDCAD": {"v": "1,3654"}})},
        {"parser": "boc", "text": '{"observations":[{"d":"2026-11-06","FXUSDCAD":{"v":1.3654}}]}'},
        {"parser": "boc", "text": "<html>"},
        {"parser": "boc", "text": '{"error":"x"}'},
        {"parser": "boc", "text": "null"},
        {"parser": "boc", "text": '{"observations":[{"d":"2026-11-06","FXUSDCAD":{"v":"1.36"}}'},
    ]
    # H.10
    rows += [
        {"parser": "fed", "text": f"{FED_HEADER}\n2026-11-06,1.1650,ND\n"},
        {"parser": "fed", "text": f"{FED_HEADER}\n2026-11-05,ND,ND\n"},
        {"parser": "fed", "text": f"{FED_HEADER}\n2026-11-06,1.1650,150.0000\n2026-11-06,1.1650,150.0000\n"},
        {"parser": "fed", "text": f"{FED_HEADER}\n2026-11-06,1.1650,150.0000\n2026-11-06,1.1650,151.0000\n"},
        {"parser": "fed", "text": FED_HEADER},
        {"parser": "fed", "text": "<html>"},
        {"parser": "fed", "text": FED_HEADER.replace('"Currency:","EUR","JPY"', '"Currency:","GBP","JPY"') + "\n2026-11-06,1.1,150\n"},
        {"parser": "fed", "text": FED_HEADER.replace('"Currency:","EUR","JPY"', '"Currency:","EUR","USD"') + "\n2026-11-06,1.1,150\n"},
        {"parser": "fed", "text": FED_HEADER.replace('"Multiplier:","1","1"', '"Multiplier:","1","100"') + "\n2026-11-06,1.1,150\n"},
        {"parser": "fed", "text": FED_HEADER.replace('"Unit:","Currency","Currency"\n', "") + "\n2026-11-06,1.1,150\n"},
        {"parser": "fed", "text": FED_HEADER.replace('"RXI_N.B.JA"', '"XYZ"') + "\n2026-11-06,1.1,150\n"},
        {"parser": "fed", "text": f"{FED_HEADER}\n11/06/2026,1.1650,150.0000\n"},
        {"parser": "fed", "text": f"{FED_HEADER}\n2026-11-06,1.1650\n"},
        {"parser": "fed", "text": f"{FED_HEADER}\n2026-11-06,1.1650,n/q\n"},
        {"parser": "fed", "text": f"{FED_HEADER}\n2026-11-06,0.0000,150\n"},
    ]
    # the Bank of England: every series, and every month
    codes = list(BOE_SERIES)
    rows.append({"parser": "boe", "text": f"DATE,{','.join(codes)}\n22 Dec 2025,{','.join(f'{i + 1}.5' for i in range(len(codes)))}\n"})
    rows.append({"parser": "boe", "text": "DATE,XUDLUSS\n" + "".join(f"05 {month} 2025,1.35\n" for month in SHORT_MONTHS)})
    rows += [
        {"parser": "boe", "text": "\ufeff DATE , XUDLUSS \n 05 Dec 2025 , 1.35\n 05 Jan 2025 , 1.3\n"},
        {"parser": "boe", "text": "DATE,XUDLUSS,XUDLERS\n05 Dec 2025,1.35,\n"},
        {"parser": "boe", "text": "DATE,XUDLUSS\n05 Dec 2025,1.35123\n"},
    ]
    for text in ["", "DAY,XUDLUSS\n05 Dec 2025,1.35", "DATE\n05 Dec 2025", "DATE,XUDLFOO\n05 Dec 2025,1.35", "DATE,XUDLUSS, XUDLUSS\n05 Dec 2025,1.35,1.35", "DATE,XUDLUSS", "DATE,XUDLUSS,XUDLERS\n05 Dec 2025,1.35", "DATE,XUDLUSS\n05 Dec 2025,", "DATE,XUDLUSS\n5 Dec 2025,1.35", "DATE,XUDLUSS\n05 DEC 2025,1.35", "DATE,XUDLUSS\n31 Nov 2025,1.35", "DATE,XUDLUSS\n05 Dec 2025,1.35\n05 Dec 2025,1.36"]:
        rows.append({"parser": "boe", "text": text})
    # HMRC
    rows += [
        {"parser": "hmrc", "text": "\n".join([HMRC_HEADER, hmrc_row("EUR", "1.1500", "01/10/2026", "31/10/2026"), hmrc_row("EUR", "1.1600", "15/10/2026", "31/10/2026")])},
        {"parser": "hmrc", "text": "\n".join([HMRC_HEADER, hmrc_row("XOF", "750.1"), hmrc_row("XOF", "750.1"), hmrc_row("USD", "1.3000")]), "options": {"availableAt": False}},
    ]
    for start in ["01/01/2027", "01/03/2027", "01/06/2027", "01/12/2026"]:
        rows.append({"parser": "hmrc", "text": "\n".join([HMRC_HEADER, hmrc_row("EUR", "1.1", start, start)])})
    for body in [hmrc_row("EUR", "1.1") + "\n" + hmrc_row("EUR", "1.2"), hmrc_row("EUR", "1.1", "31/02/2026"), hmrc_row("EUR", "1.1", "01/11/2026", "31/10/2026"), hmrc_row("GBP", "1"), hmrc_row("Euro", "1.1"), hmrc_row("EUR", "1,1"), "Somewhere,Unit,EUR,1.1,01/10/2026", hmrc_row("EUR", ""), hmrc_row("EUR", "N/A")]:
        rows.append({"parser": "hmrc", "text": f"{HMRC_HEADER}\n{body}"})
    rows += [{"parser": "hmrc", "text": "<html>"}, {"parser": "hmrc", "text": HMRC_HEADER}]
    return rows


def parse_rows() -> tuple:
    days_rows, table_rows = [], []
    for row in parse_inputs():
        try:
            tables = parse(row)
            days_rows.append({**row, "days": [t["asOf"] for t in tables], "error": None})
            for index, parsed in enumerate(tables):
                table_rows.append({**row, "index": index, "table": parsed})
        except Refused as refused:
            days_rows.append({**row, "days": None, "error": refused.kind})
    return days_rows, table_rows


def decimals_rows() -> list:
    rows = [
        {"fixture": "ecb-sdmx/exr-d-nodata.csv"},
        {"fixture": "ecb-sdmx/exr-d-full.csv"},
        {"text": "CURRENCY,DECIMALS\n THB , 4 \nUSD,4\nLTL,5\nJPY,2\n"},
        {"text": "CURRENCY,DECIMALS\nUSD,31\n"},
        {"text": "CURRENCY,DECIMALS\nUSD,x\n"},
        {"text": "CURRENCY\nUSD\n"},
        {"text": ""},
    ]
    out = []
    for row in rows:
        try:
            out.append({**row, "decimals": sdmx_decimals(source_text(row)), "error": None})
        except Refused as refused:
            out.append({**row, "decimals": None, "error": refused.kind})
    return out


def quote_rows() -> list:
    rows = [
        {"from": "JPY", "to": "NOK", "quote": {"rate": "6.50", "per": 100}},
        {"from": "USD", "to": "EUR", "quote": {"rate": "1.1650", "inverted": True}},
        {"from": "NOK", "to": "JPY", "quote": {"rate": "6.50", "per": 100, "inverted": True}, "info": {"source": "Norges Bank", "asOf": "2026-11-06"}},
        {"from": "USD", "to": "EUR", "quote": {"rate": "1.1650", "per": 1, "inverted": False}},
        {"from": "CAD", "to": "USD", "quote": {"rate": "1.3654", "inverted": True}, "info": {"source": "BoC", "asOf": "2026-11-06", "availableAt": "2026-11-06T16:30:00-05:00", "type": "average"}},
        {"from": "USD", "to": "EUR", "quote": {"rate": "1,1650"}},
        {"from": "USD", "to": "EUR", "quote": {"rate": "-1.1650"}},
        {"from": "USD", "to": "EUR", "quote": {"rate": "0", "inverted": True}},
        {"from": "USD", "to": "EUR", "quote": {"rate": "0"}},
        {"from": "USD", "to": "EUR", "quote": {"rate": "1.1", "per": 0}},
        {"from": "USD", "to": "EUR", "quote": {"rate": "1.1", "per": -100}},
        {"from": "USD", "to": "EUR", "quote": {"rate": "1e3"}},
    ]
    out = []
    for row in rows:
        info = {key: (Time(value) if key in ("asOf", "availableAt", "validUntil") else value) for key, value in row.get("info", {}).items()}
        try:
            out.append({**row, "rate": from_quote(row["from"], row["to"], row["quote"], info), "error": None})
        except Refused as refused:
            out.append({**row, "rate": None, "error": refused.kind})
    return out


def Time(text: str) -> str:
    """A rate time as ducat stores it: a date as given, an instant in UTC to the millisecond."""
    if re.match(r"^\d{4}-\d\d-\d\d$", text):
        return text
    return instant(datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc))


# --- rateHistory --------------------------------------------------------------------------------


def time_start(text: str) -> datetime:
    """A date as the start of its UTC day; an instant as it is."""
    if re.match(r"^\d{4}-\d\d-\d\d$", text):
        return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)


def time_end(text: str) -> datetime:
    if re.match(r"^\d{4}-\d\d-\d\d$", text):
        return time_start(text) + timedelta(days=1) - timedelta(milliseconds=1)
    return time_start(text)


def started(available_at: str, at: str) -> bool:
    return time_start(available_at) <= time_end(at)


def ended(valid_until: str, at: str) -> bool:
    return time_start(at) > time_end(valid_until)


def day_of(text: str) -> str:
    return time_start(text).date().isoformat()


def history_lookup(tables: list, source, target, at, lookback: int):
    """The rate, and the days passed over with their reasons, as rate-sources.md describes it: the
    latest table at or before the day asked for that has the pair, published by then and still
    valid, looking back `lookback` days; a table with a validUntil answers its whole period."""
    dated = sorted(tables, key=lambda t: day_of(t["asOf"]), reverse=True)  # stable within a day
    first = day_of(at) if at is not None else (day_of(dated[0]["asOf"]) if dated else None)
    if first is None:
        return None, []
    last = (date.fromisoformat(first) - timedelta(days=lookback)).isoformat()
    periods = any(t.get("validUntil") is not None for t in dated)
    skipped, expected = [], first

    def before(day: str, count: int = 1) -> str:
        return (date.fromisoformat(day) - timedelta(days=count)).isoformat()

    def gaps_until(end_exclusive: str) -> list:
        out, day = [], expected
        while day > end_exclusive:
            out.append([day, "noTable"])
            day = before(day)
        return out

    for entry in dated:
        day = day_of(entry["asOf"])
        if day > first:
            continue
        period_ended = at is not None and entry.get("validUntil") is not None and ended(entry["validUntil"], at)
        covers = entry.get("validUntil") is not None and not period_ended
        if day < last and not covers:
            if not periods:
                break
            continue
        in_window = day >= last
        accounted = day if in_window else before(last)
        gaps = gaps_until(accounted)
        if not covers:
            skipped += gaps
        reason = pass_over(entry, source, target, at, period_ended)
        if reason is None:
            return find(entry, source, target, at), skipped
        if covers:
            skipped += gaps
        skipped.append([day, reason])
        if accounted <= expected:
            expected = before(day) if in_window else accounted
    day = expected
    while day >= last:
        skipped.append([day, "noTable"])
        day = before(day)
    return None, skipped


def find(entry: dict, source, target, at):
    """The table's rate for the pair, if it applies at `at`."""
    for rate in entry["rates"]:
        if rate["from"] == source and rate["to"] == target:
            if at is None:
                return rate
            for holder in (rate, entry):
                if holder.get("asOf") is not None and day_of(at) < day_of(holder["asOf"]):
                    return None
                if holder.get("availableAt") is not None and not started(holder["availableAt"], at):
                    return None
                if holder.get("validUntil") is not None and ended(holder["validUntil"], at):
                    return None
            return rate
    return None


def pass_over(entry: dict, source, target, at, period_ended: bool):
    if period_ended:
        return "expired"
    if at is not None and entry.get("availableAt") is not None and not started(entry["availableAt"], at):
        return "notYetAvailable"
    if find(entry, source, target, at) is not None:
        return None
    if source in entry["missing"] or target in entry["missing"]:
        return "missing"
    held = next((r for r in entry["rates"] if r["from"] == source and r["to"] == target), None)
    if held is not None and at is not None:
        if held.get("validUntil") is not None and ended(held["validUntil"], at):
            return "expired"
        if held.get("availableAt") is not None and not started(held["availableAt"], at):
            return "notYetAvailable"
    return "notQuoted"


def history_rows() -> list:
    sources = {
        "ecbHist": {"parser": "ecbCsv", "fixture": "ecb/eurofxref-hist.csv"},
        "ecbHistAvailable": {"parser": "ecbCsv", "fixture": "ecb/eurofxref-hist.csv", "options": {"availableAt": True}},
        "fed": {"parser": "fed", "fixture": "fed/h10-daily.csv"},
        "hmrc": {"parser": "hmrc", "fixture": "hmrc/monthly_csv_2026-11.csv"},
        "hmrcAmended": {"parser": "hmrc", "text": "\n".join([HMRC_HEADER, hmrc_row("EUR", "1.1500", "01/10/2026", "31/10/2026"), hmrc_row("EUR", "1.1600", "15/10/2026", "31/10/2026")]), "options": {"availableAt": False}},
        "boe": {"parser": "boe", "fixture": "boe/spot-sample.csv"},
        "hmrcEnded": {"parser": "hmrc", "text": "\n".join([HMRC_HEADER, hmrc_row("EUR", "1.1500", "14/10/2026", "15/10/2026")]), "options": {"availableAt": False}},
    }
    queries = [
        ("ecbHist", "EUR", "USD", None, None),
        ("ecbHist", "EUR", "USD", "2026-11-06", None),
        ("ecbHist", "EUR", "USD", "2026-11-08", None),
        ("ecbHist", "EUR", "USD", "2026-11-08", 1),
        ("ecbHist", "EUR", "USD", "2026-11-12", None),
        ("ecbHist", "EUR", "BGN", "2026-11-06", None),
        ("ecbHist", "EUR", "XAU", "2026-11-06", 2),
        ("ecbHist", "USD", "EUR", "2026-11-06", None),
        ("ecbHist", "EUR", "USD", "2026-11-01", None),
        ("ecbHist", "EUR", "USD", "2026-11-06T23:30:00-05:00", 0),
        ("ecbHistAvailable", "EUR", "USD", "2026-11-06T14:59:59.999Z", None),
        ("ecbHistAvailable", "EUR", "USD", "2026-11-06T15:00:00Z", None),
        ("ecbHistAvailable", "EUR", "USD", "2026-11-06", None),
        ("ecbHistAvailable", "EUR", "JPY", "2026-11-07T09:00:00+01:00", 0),
        ("fed", "USD", "JPY", "2026-01-01", None),
        ("fed", "USD", "EUR", "2026-01-04", None),
        ("fed", "USD", "EUR", "2026-01-04", 1),
        ("fed", "USD", "VEB", "2026-01-06", None),
        ("hmrc", "GBP", "EUR", "2026-11-15", None),
        ("hmrc", "GBP", "EUR", "2026-11-30T23:59:59.999Z", 0),
        ("hmrc", "GBP", "EUR", "2026-12-01", None),
        ("hmrc", "GBP", "EUR", "2026-10-31", None),
        ("hmrc", "GBP", "XYZ", "2026-11-03", None),
        ("hmrc", "GBP", "EUR", "2026-11-02", 0),
        ("hmrc", "GBP", "EUR", None, None),
        ("hmrcAmended", "GBP", "EUR", "2026-10-14", 0),
        ("hmrcAmended", "GBP", "EUR", "2026-10-15", 0),
        ("hmrcAmended", "GBP", "EUR", "2026-11-01", 0),
        ("boe", "GBP", "USD", "2026-01-01", None),
        ("boe", "GBP", "EUR", "2025-12-31", 1),
        ("boe", "GBP", "USD", "2025-12-30", None),
        ("hmrcEnded", "GBP", "EUR", "2026-10-17", None),
        ("hmrcEnded", "GBP", "EUR", "2026-10-15T23:59:59.999Z", None),
        ("hmrcEnded", "GBP", "EUR", "2026-10-25", None),
    ]
    out = []
    for name, source, target, at, lookback in queries:
        row = {"tables": sources[name], "from": source, "to": target}
        if at is not None:
            row["asOf"] = at
        if lookback is not None:
            row["lookback"] = lookback
        rate, skipped = history_lookup(parse(sources[name]), source, target, at, 4 if lookback is None else lookback)
        out.append({**row, "rate": rate, "skipped": skipped})
    return out


# --- Stripe and Adyen ---------------------------------------------------------------------------


def stripe_rows() -> list:
    data = json.loads((ROOT / "data" / "stripe-fx.json").read_text())
    vector = data["vectors"][0]
    documented = {**vector["balanceTransaction"], "exchange_rate": str(vector["balanceTransaction"]["exchange_rate"])}
    transactions = [
        (vector["charge"]["currency"], {**documented, "created": 1_794_000_000}),
        (vector["charge"]["currency"], documented),
        ("eur", {"amount": 1000, "currency": "eur", "exchange_rate": None}),
        ("gbp", {"amount": 1768, "currency": "jpy", "exchange_rate": "176.8", "created": 0}),
        ("usd", {"amount": 905, "currency": "eur", "exchange_rate": "0.905034", "created": 1_794_000_001}),
        ("eur", {"amount": 1234, "currency": "usd", "exchange_rate": "0"}),
    ]
    out = []
    for charged, transaction in transactions:
        info = {"source": "stripe"}
        if "created" in transaction:
            info["asOf"] = instant(datetime.fromtimestamp(transaction["created"], timezone.utc))
        row = {"from": charged, "transaction": {k: transaction[k] for k in ("amount", "currency", "exchange_rate", "created") if k in transaction}}
        text = transaction.get("exchange_rate")
        try:
            rate = None if text is None else rate_json(charged.upper(), transaction["currency"].upper(), Fraction(text), info)
            out.append({**row, "rate": rate, "error": None})
        except Refused as refused:
            out.append({**row, "rate": None, "error": refused.kind})
    return out


def stripe_implied_rows() -> list:
    exponents = {"USD": 2, "EUR": 2, "JPY": 0, "GBP": 2, "KWD": 3}
    cases = [("10.00", "EUR", {"amount": 1234, "currency": "usd"}), ("10.00", "EUR", {"amount": 1768, "currency": "jpy", "created": 1_794_000_000}), ("1.000", "KWD", {"amount": 325, "currency": "usd"}), ("0.00", "EUR", {"amount": 0, "currency": "usd"})]
    out = []
    for amount, currency, transaction in cases:
        info = {"source": "stripe"}
        if "created" in transaction:
            info["asOf"] = instant(datetime.fromtimestamp(transaction["created"], timezone.utc))
        settled = Fraction(transaction["amount"], 10 ** exponents[transaction["currency"].upper()])
        row = {"amount": amount, "currency": currency, "transaction": transaction}
        try:
            if Fraction(amount) == 0:
                raise Refused("range")
            out.append({**row, "rate": rate_json(currency, transaction["currency"].upper(), settled / Fraction(amount), info), "error": None})
        except Refused as refused:
            out.append({**row, "rate": None, "error": refused.kind})
    return out


ZONES = {"UTC": 0, "GMT": 0, "WET": 0, "WEST": 60, "CET": 60, "CEST": 120, "EET": 120, "EEST": 180, "MSK": 180, "SGT": 480, "HKT": 480, "JST": 540, "KST": 540, "AEST": 600, "AEDT": 660, "NZST": 720, "NZDT": 780, "EST": -300, "EDT": -240, "MST": -420, "MDT": -360, "PST": -480, "PDT": -420}


def zone_offset(label: str):
    named = ZONES.get(label.upper())
    if named is not None:
        return named
    match = re.match(r"^(?:UTC|GMT)?\s*([+-])(\d{1,2})(?::?(\d\d))?$", label)
    if match is None:
        return None
    hours, minutes = int(match[2]), int(match[3] or 0)
    total = hours * 60 + minutes
    if minutes >= 60 or total > 14 * 60:
        return None
    return -total if match[1] == "-" else total


def adyen_rows() -> list:
    data = json.loads((ROOT / "data" / "adyen-fx.json").read_text())
    base = {"Gross Currency": "EUR", "Net Currency": "GBP", "Exchange Rate": "0.86120"}
    rows = [data["vectors"][0]["row"]]
    for created, zone in [("2026-11-06 14:03:11", "CET"), ("2026-11-06 14:03:11", "CEST"), ("2026-11-06T14:03:11.25", "UTC+01:00"), ("2026-11-06 00:30:00", "+0100"), ("2026-11-06 23:30:00", "PST"), ("2026-11-06 14:03:11", "IST"), ("2026-11-06 14:03:11", "+15:00"), ("2026-11-06 14:03:11", "+01:60"), ("2026-11-06 14:03", "GMT"), ("2026-11-06", "CET"), ("06/11/2026 14:03", "CET"), ("2026-11-06 14:03:11", None)]:
        row = {**base, "Creation Date": created}
        if zone is not None:
            row["TimeZone"] = zone
        rows.append(row)
    # every zone it reads by name
    for zone in ZONES:
        rows.append({**base, "Creation Date": "2026-11-06 12:00:00", "TimeZone": zone.lower() if zone == "JST" else zone})
    rows += [{**base, "Exchange Rate": ""}, {**base, "Net Currency": ""}, {"Gross Currency": "EUR", "Exchange Rate": "1"}, {**base, "Exchange Rate": " 0.8612 "}]
    out = []
    for row in rows:
        gross, net, text = row.get("Gross Currency"), row.get("Net Currency"), (row.get("Exchange Rate") or "").strip()
        if not gross or not net or not text:
            out.append({"row": row, "rate": None})
            continue
        info = {"source": "adyen"}
        created = row.get("Creation Date")
        if created is not None:
            match = re.match(r"^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d(?::\d\d(?:\.\d+)?)?)$", created.strip())
            if match is None:
                if re.match(r"^\d{4}-\d\d-\d\d", created):
                    info["asOf"] = created[:10]
            else:
                clock = match[2] if match[2].count(":") == 2 else match[2] + ":00"
                local = datetime.fromisoformat(f"{match[1]}T{clock}").replace(tzinfo=timezone.utc)
                offset = None if row.get("TimeZone") is None else zone_offset(row["TimeZone"].strip())
                info["asOf"] = match[1] if offset is None else instant(local - timedelta(minutes=offset))
        out.append({"row": row, "rate": rate_json(gross, net, Fraction(text), info, text=text)})
    return out


def main() -> None:
    days, tables = parse_rows()
    provenance = {
        "source": "reference-data",
        "generator": {"name": "scripts/gen-rate-source-vectors.py", "version": GENERATOR_VERSION},
        "method": "The fixtures in spec/fixtures/ (and small inline variants) read with Python's standard library, independently of ducat's parsers, by the rules in docs/reference/rate-sources.md; publication times from the sources' stated local times and clock rules written out in the generator.",
        "data": {"iso4217": ISO4217_PUBLISHED},
    }
    ops = [
        {"op": "source.parse", "rows": days},
        {"op": "source.table", "rows": tables},
        {"op": "source.sdmxDecimals", "rows": decimals_rows()},
        {"op": "history.fromQuote", "rows": quote_rows()},
        {"op": "history.lookup", "rows": history_rows()},
        {"op": "fx.stripeRate", "rows": stripe_rows()},
        {"op": "fx.stripeImplied", "rows": stripe_implied_rows()},
        {"op": "fx.adyenRate", "rows": adyen_rows()},
    ]
    for table_ in ops:
        print(table_["op"], len(table_["rows"]), file=sys.stderr)
    texts = {
        vector_path("convert", "sources"): file_text(
            "convert",
            "sources",
            "Rate-source parsers (the ECB's XML, CSV and SDMX-CSV, the Bank of Canada's Valet JSON, the Fed's H.10 CSV, the Bank of England's CSV, HMRC's monthly CSV) on the fixtures in spec/fixtures/ and malformed variants; quoted rates; lookups over dated tables with their fallbacks; and the rates on Stripe balance transactions and Adyen settlement rows.",
            provenance,
            ops,
        ),
    }
    write_or_check(texts, "python3 scripts/gen-rate-source-vectors.py")


if __name__ == "__main__":
    main()
