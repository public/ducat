#!/usr/bin/env python3
"""Reference vectors for ducat's rate metadata, rate providers and multi-currency bags, computed with
Python's fractions and standard library from the rules in ducat's docs (docs/reference/convert.md:
"Rates", "Providers" and "Totals in several currencies"; docs/reference/rate-sources.md,
"Providers"), independently of ducat's TypeScript:

    spec/vectors/convert/providers.json

checked by test/spec.test.ts and the Rust port's rust/crates/ducat/tests/it/spec.rs.

Times are modelled as the documents describe them, not as strings: an instant is a point at
millisecond precision; a date is a whole UTC day, which starts at 00:00:00.000Z (for asOf,
availableAt and a lookup's start) and ends after 23:59:59.999Z (for validUntil and a date `at`).

Deterministic: the same seed always writes the same files. Regenerate with
    python3 scripts/gen-rate-provider-vectors.py
and check that nothing changed with --check.
"""
import random
import re
import sys
import xml.etree.ElementTree as ElementTree
from datetime import datetime, timedelta, timezone
from fractions import Fraction

sys.dont_write_bytecode = True  # no __pycache__ in scripts/
from spec_vectors import ISO4217_PUBLISHED, ROOT, file_text, vector_path, write_or_check  # noqa: E402

SEED = 20261118
# bumped when the output's layout changes; the values depend only on the seed
GENERATOR_VERSION = "1"
MODES = ["halfEven", "halfExpand", "halfTrunc", "halfCeil", "halfFloor", "expand", "trunc", "ceil", "floor"]
CURRENCIES = ["EUR", "USD", "JPY", "GBP", "CHF", "KWD", "SEK", "HUF"]
MS = timedelta(milliseconds=1)
DAY = timedelta(days=1)


def iso_exponents() -> dict:
    root = ElementTree.parse(ROOT / "data" / "iso4217-list-one.xml").getroot()
    exponents = {}
    for entry in root.iter("CcyNtry"):
        code = entry.findtext("Ccy")
        units = (entry.findtext("CcyMnrUnts") or "").strip()
        if code is not None and units != "N.A.":
            exponents[code] = int(units)
    return exponents


EXPONENT = iso_exponents()


# --- numbers -----------------------------------------------------------------------------------


def read_rate(text: str) -> Fraction:
    """A decimal ('1.1165') or 'num/den'."""
    if "/" in text:
        num, den = text.split("/")
        return Fraction(int(num), int(den))
    return Fraction(text)


def canonical(value: Fraction) -> str:
    """The exact decimal when it terminates, else 'num/den'; an integer without a point."""
    den = value.denominator
    twos = fives = 0
    while den % 2 == 0:
        den //= 2
        twos += 1
    while den % 5 == 0:
        den //= 5
        fives += 1
    if den != 1:
        return f"{value.numerator}/{value.denominator}"
    places = max(twos, fives)
    return scaled(value.numerator * 10**places // value.denominator, places)


def scaled(units: int, places: int) -> str:
    """An integer at `places` as a plain decimal, every digit written ('-0.05')."""
    sign = "-" if units < 0 else ""
    digits = str(abs(units)).rjust(places + 1, "0")
    if places == 0:
        return sign + digits
    return f"{sign}{digits[:-places]}.{digits[-places:]}"


def round_to_integer(value: Fraction, mode: str) -> int:
    floor = value.numerator // value.denominator
    rest = value - floor
    if rest == 0:
        return floor
    ceil = floor + 1
    toward_zero, away = (floor, ceil) if value > 0 else (ceil, floor)
    if mode == "floor":
        return floor
    if mode == "ceil":
        return ceil
    if mode == "trunc":
        return toward_zero
    if mode == "expand":
        return away
    if rest != Fraction(1, 2):
        return floor if rest < Fraction(1, 2) else ceil
    return {
        "halfEven": floor if floor % 2 == 0 else ceil,
        "halfExpand": away,
        "halfTrunc": toward_zero,
        "halfCeil": ceil,
        "halfFloor": floor,
    }[mode]


def rational_text(value: Fraction) -> str:
    return str(value.numerator) if value.denominator == 1 else f"{value.numerator}/{value.denominator}"


# --- times -------------------------------------------------------------------------------------

DATE = re.compile(r"^\d{4}-\d\d-\d\d$")
INSTANT = re.compile(r"^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.(\d{3}))?)?(Z|[+-]\d\d:\d\d)$")


class Time:
    """A date (a whole UTC day) or an instant (UTC, to the millisecond)."""

    def __init__(self, text: str):
        if DATE.match(text):
            self.is_date = True
            self.day = datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            self.point = self.day
            self.text = text
            return
        match = INSTANT.match(text)
        assert match, text
        year, month, day, hour, minute, second, millis, zone = match.groups()
        moment = datetime(int(year), int(month), int(day), int(hour), int(minute), int(second or 0), int(millis or 0) * 1000, tzinfo=timezone.utc)
        if zone != "Z":
            sign = 1 if zone[0] == "+" else -1
            moment -= sign * timedelta(hours=int(zone[1:3]), minutes=int(zone[4:6]))
        self.is_date = False
        self.point = moment
        self.day = moment.replace(hour=0, minute=0, second=0, microsecond=0)
        self.text = moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"

    @property
    def start(self) -> datetime:
        return self.point

    @property
    def end(self) -> datetime:
        """The last instant covered: a date's 23:59:59.999Z."""
        return self.day + DAY - MS if self.is_date else self.point


def norm(text):
    return None if text is None else Time(text).text


def has_ended(valid_until: str, at: str) -> bool:
    """`valid_until` has passed at `at`: a date `valid_until` covers its whole day; a date `at` is
    the start of its day."""
    return Time(at).start > Time(valid_until).end


def has_started(available_at: str, at: str) -> bool:
    """Published by `at`: a date `available_at` from the start of its day; a date `at` means by the
    end of that day."""
    return Time(available_at).start <= Time(at).end


def oldest(first, second):
    if first is None or second is None:
        return first if second is None else second
    return first if Time(first).start <= Time(second).start else second


def latest(first, second):
    if first is None or second is None:
        return first if second is None else second
    return first if Time(first).start >= Time(second).start else second


def earliest_end(first, second):
    """The validUntil that ends first; on a tie, the instant form."""
    if first is None or second is None:
        return first if second is None else second
    a, b = Time(first), Time(second)
    if a.end != b.end:
        return first if a.end < b.end else second
    return second if a.is_date else first


# --- rates -------------------------------------------------------------------------------------

PUBLISHED = re.compile(r"^(?:0|[1-9]\d*)\.\d*0$")
TIMING = ["asOf", "availableAt", "validUntil"]


class RateError(Exception):
    pass


class Rate:
    def __init__(self, source, target, value: Fraction, info=None, derived=None):
        if value <= 0:
            raise RateError("range")
        self.source, self.target, self.value = source, target, value
        info = info or {}
        self.info = {}
        if "source" in info:
            self.info["source"] = info["source"]
        for key in TIMING:
            if key in info:
                self.info[key] = norm(info[key])
        if "type" in info:
            self.info["type"] = info["type"]
        quote = info.get("quote")
        if quote is not None:
            # a quote is a positive published price for a positive whole number of units, and it
            # describes the rate exactly: quote / per, or per / quote when inverted
            per = quote.get("per", 1)
            if not isinstance(per, int) or isinstance(per, bool) or per < 1:
                raise RateError("range")
            published = read_rate(quote["rate"])
            if published <= 0:
                raise RateError("range")
            described = per / published if quote.get("inverted") is True else published / per
            if described != value:
                raise RateError("range")
            self.info["quote"] = quote
        self.derived = derived

    def text(self) -> str:
        quote = self.info.get("quote")
        if quote is not None and "per" not in quote and quote.get("inverted") is not True:
            return quote["rate"]
        return canonical(self.value)

    def json(self) -> dict:
        out = {"from": self.source, "to": self.target, "rate": self.text()}
        for key in ["source", *TIMING, "type"]:
            if key in self.info:
                out[key] = self.info[key]
        quote = self.info.get("quote")
        if quote is not None and ("per" in quote or quote.get("inverted") is True):
            out["quote"] = quote
        if self.derived is not None:
            out["derivedFrom"] = [rate.json() for rate in self.derived]
        return out

    def timing(self, kind=None) -> dict:
        info = {key: self.info[key] for key in TIMING if key in self.info}
        if kind is not None:
            info["type"] = kind
        return info

    def inverse(self):
        kind = self.info.get("type")
        if kind is not None:
            kind = {"bid": "ask", "ask": "bid"}.get(kind, kind)
        info = self.timing(kind)
        quote = self.info.get("quote")
        if quote is not None:
            rest = {key: value for key, value in quote.items() if key != "inverted"}
            info["quote"] = rest if quote.get("inverted") is True else {**rest, "inverted": True}
        return Rate(self.target, self.source, 1 / self.value, info, [self])

    def and_then(self, following):
        if following.source != self.target:
            raise RateError("mismatch")
        kind = self.info.get("type") if self.info.get("type") == following.info.get("type") else None
        info = {}
        for key, pick in (("asOf", oldest), ("availableAt", latest), ("validUntil", earliest_end)):
            value = pick(self.info.get(key), following.info.get(key))
            if value is not None:
                info[key] = value
        if kind is not None:
            info["type"] = kind
        return Rate(self.source, following.target, self.value * following.value, info, [self, following])

    def with_margin(self, margin: str):
        return Rate(self.source, self.target, self.value * (1 + Fraction(margin)), self.timing(), [self])

    def round(self, places: int, mode: str):
        units = round_to_integer(self.value * 10**places, mode)
        return Rate(self.source, self.target, Fraction(units, 10**places), self.timing(self.info.get("type")), [self])

    def expired(self, now: str) -> bool:
        return "validUntil" in self.info and has_ended(self.info["validUntil"], now)

    def available(self, at: str) -> bool:
        return "availableAt" not in self.info or has_started(self.info["availableAt"], at)


def exchange_rate(source, target, text, info=None) -> Rate:
    rate = Rate(source, target, read_rate(text), info)
    if "quote" not in rate.info and PUBLISHED.match(text):
        rate.info["quote"] = {"rate": text}
    return rate


def from_spec(spec: dict) -> Rate:
    return exchange_rate(spec["from"], spec["to"], spec["rate"], spec.get("info"))


def from_json(json: dict) -> Rate:
    derived = None if "derivedFrom" not in json else [from_json(item) for item in json["derivedFrom"]]
    rate = Rate(json["from"], json["to"], read_rate(json["rate"]), json, derived)
    if "quote" not in rate.info and PUBLISHED.match(json["rate"]):
        rate.info["quote"] = {"rate": json["rate"]}
    return rate


# --- providers ---------------------------------------------------------------------------------


def applies_at(info: dict, at: str) -> bool:
    if info.get("asOf") is not None and Time(at).day < Time(info["asOf"]).day:
        return False
    if info.get("availableAt") is not None and not has_started(info["availableAt"], at):
        return False
    return info.get("validUntil") is None or not has_ended(info["validUntil"], at)


class Table:
    def __init__(self, spec: dict):
        self.header = {}
        if "list" in spec:
            rates = [from_spec(item) for item in spec["list"]]
        else:
            table = spec["table"]
            base = table["base"]
            info = {key: table[key] for key in ["source", *TIMING, "type"] if key in table}
            rates, missing = [], []
            for currency, entry in table["rates"]:
                if entry is None:
                    missing.append(currency)
                elif isinstance(entry, dict):
                    if entry["from"] != base or entry["to"] != currency:
                        raise RateError("mismatch")
                    rates.append(from_spec(entry))
                else:
                    rates.append(exchange_rate(base, currency, entry, info))
            self.header["base"] = base
            for key in TIMING:
                if key in table:
                    self.header[key] = norm(table[key])
            if missing:
                self.header["missing"] = missing
        self.rates = rates
        self.pairs = {}
        for rate in rates:
            self.pairs[(rate.source, rate.target)] = rate

    def rate(self, source, target, at):
        rate = self.pairs.get((source, target))
        if rate is None:
            return None
        if at is not None and not (applies_at(rate.info, at) and applies_at(self.header, at)):
            return None
        return rate


def provider(spec: dict):
    """A lookup function (source, target, at) -> Rate or None, from a provider description."""
    if "table" in spec or "list" in spec:
        return Table(spec).rate
    if "identity" in spec:
        return lambda source, target, at: exchange_rate(source, target, "1") if source == target else None
    if "chain" in spec:
        parts = [provider(part) for part in spec["chain"]]

        def chained(source, target, at):
            for part in parts:
                found = part(source, target, at)
                if found is not None:
                    return found
            return None

        return chained
    if "reversed" in spec:
        inner = provider(spec["reversed"])

        def reverse(source, target, at):
            found = inner(target, source, at)
            return None if found is None else found.inverse()

        return reverse
    inner, base = provider(spec["of"]), spec["via"]

    def leg(source, target, at):
        found = inner(source, target, at)
        if found is not None:
            return found
        found = inner(target, source, at)
        return None if found is None else found.inverse()

    def through(source, target, at):
        if source == target:
            return None
        if base in (source, target):
            return leg(source, target, at)
        first = leg(source, base, at)
        if first is None:
            return None
        second = leg(base, target, at)
        return None if second is None else first.and_then(second)

    return through


def rate_of(spec, source, target, at) -> Rate:
    found = provider(spec)(source, target, at)
    if found is None:
        raise RateError("unavailable")
    return found


# --- money -------------------------------------------------------------------------------------


def money_value(amount: str) -> Fraction:
    return Fraction(amount)


def places_of(amount: str) -> int:
    return len(amount.split(".")[1]) if "." in amount else 0


def convert_value(value: Fraction, rate: Fraction, scale: int, mode: str) -> str:
    units = value * rate * 10**scale
    if mode == "unnecessary":
        if units.denominator != 1:
            raise RateError("rounding")
        return scaled(units.numerator, scale)
    return scaled(round_to_integer(units, mode), scale)


# --- rows --------------------------------------------------------------------------------------

DAYS = ["2026-11-05", "2026-11-06", "2026-11-07"]


def instant(rng, day: str, midnight=True) -> str:
    """An instant on (or, by offset, about) `day`, in one of the unambiguous forms."""
    if midnight and rng.random() < 0.15:
        return rng.choice([f"{day}T00:00:00Z", f"{day}T23:59:59.999Z", f"{day}T00:00:00.000Z"])
    hour, minute = rng.randrange(24), rng.randrange(60)
    form = rng.randrange(5)
    if form == 0:
        text = f"{day}T{hour:02d}:{minute:02d}Z"
    elif form == 1:
        text = f"{day}T{hour:02d}:{minute:02d}:{rng.randrange(60):02d}Z"
    elif form == 2:
        text = f"{day}T{hour:02d}:{minute:02d}:{rng.randrange(60):02d}.{rng.randrange(1000):03d}Z"
    else:
        offset_hours = rng.choice([1, 2, 5, 9, 14, 3])
        sign = rng.choice("+-")
        offset_minutes = rng.choice([0, 0, 30])
        text = f"{day}T{hour:02d}:{minute:02d}:{rng.randrange(60):02d}{sign}{offset_hours:02d}:{offset_minutes:02d}"
    if not midnight and Time(text).point == Time(text).day:
        return instant(rng, day, midnight)
    return text


def time(rng, midnight=True) -> str:
    day = rng.choice(DAYS)
    return day if rng.random() < 0.4 else instant(rng, day, midnight)


def rate_text(rng) -> str:
    kind = rng.randrange(6)
    if kind == 0:
        return f"{rng.randrange(1, 200)}.{rng.randrange(100):02d}0"  # published trailing zero
    if kind == 1:
        return f"{rng.randrange(1, 4000)}/{rng.randrange(1, 4000)}"
    if kind == 2:
        return f"0.{rng.randrange(1, 10**6):06d}"
    if kind == 3:
        return str(rng.randrange(1, 400))
    return f"{rng.randrange(1, 200)}.{rng.randrange(1, 10**4)}"


def info(rng, kinds=("mid", "bid", "ask", "reference"), midnight_until=True) -> dict:
    out = {}
    if rng.random() < 0.3:
        out["source"] = rng.choice(["ECB", "BoC", "desk", "Stripe"])
    if rng.random() < 0.6:
        out["asOf"] = time(rng, midnight=False)
    if rng.random() < 0.5:
        out["availableAt"] = time(rng, midnight=False)
    if rng.random() < 0.6:
        out["validUntil"] = time(rng, midnight=midnight_until)
    if rng.random() < 0.5:
        out["type"] = rng.choice(kinds)
    return out


def spec(rng, source, target, quoted=True) -> dict:
    text = rate_text(rng)
    out = {"from": source, "to": target, "rate": text}
    details = info(rng)
    if quoted and rng.random() < 0.2:
        # a quote that describes the rate: the rate is computed from it
        roll = rng.randrange(4)
        published = rng.choice(["136.80", "0.7320", "12.5", "1.3650", "0.9100", "150"])
        per = rng.choice([100, 1000])
        if roll == 0 and "/" not in text:
            details["quote"] = {"rate": text}
        elif roll == 1:
            details["quote"] = {"rate": published, "per": per}
            text = canonical(Fraction(published) / per)
        elif roll == 2:
            details["quote"] = {"rate": published, "inverted": True}
            text = canonical(1 / Fraction(published))
        else:
            details["quote"] = {"rate": published, "per": per, "inverted": True}
            text = canonical(per / Fraction(published))
        out["rate"] = text
    if details:
        out["info"] = details
    return out


def pair(rng, source=None):
    source = source or rng.choice(CURRENCIES)
    return source, rng.choice([code for code in CURRENCIES if code != source])


def derive_rows(rng) -> list:
    rows = []
    # same-day chains of a date and an instant, both orders, and the midnight edges
    edges = [
        ("2026-11-06", "2026-11-06T15:00:00Z"),
        ("2026-11-06", "2026-11-07T00:00:00Z"),
        ("2026-11-06", "2026-11-06T23:59:59.999Z"),
        ("2026-11-06", "2026-11-07T00:30:00+01:00"),
        ("2026-11-06", "2026-11-06T23:30:00-01:00"),
        ("2026-11-06", "2026-11-06"),
        ("2026-11-06", "2026-11-05T23:59:59.999Z"),
    ]
    for first, second in edges:
        for until in ((first, second), (second, first)):
            a = {"from": "EUR", "to": "USD", "rate": "1.10", "info": {"validUntil": until[0]}}
            b = {"from": "USD", "to": "JPY", "rate": "150", "info": {"validUntil": until[1]}}
            rows.append({"rate": a, "steps": [{"op": "andThen", "rate": b}]})
    for times in (("2026-11-06", "2026-11-06T15:00:00Z"), ("2026-11-06T09:00:00+01:00", "2026-11-06")):
        for key in ("asOf", "availableAt"):
            for order in (times, times[::-1]):
                a = {"from": "EUR", "to": "USD", "rate": "1.10", "info": {key: order[0]}}
                b = {"from": "USD", "to": "JPY", "rate": "150", "info": {key: order[1]}}
                rows.append({"rate": a, "steps": [{"op": "andThen", "rate": b}]})
    # inverse of quoted rates, twice
    for quote in ({"rate": "136.80", "per": 100}, {"rate": "1.3650", "inverted": True}, {"rate": "1.10"}):
        rate = {"from": "NOK", "to": "JPY", "rate": "1.10", "info": {"quote": quote, "type": "bid"}}
        if "per" in quote:
            rate = {"from": "JPY", "to": "NOK", "rate": "1.368", "info": {"quote": quote, "type": "bid"}}
        if quote.get("inverted"):
            rate = {"from": "USD", "to": "CAD", "rate": "200/273", "info": {"quote": quote}}
        rows.append({"rate": rate, "steps": [{"op": "inverse"}]})
        rows.append({"rate": rate, "steps": [{"op": "inverse"}, {"op": "inverse"}]})
    # published digits
    # quotes that don't describe their rate are refused at construction: an inverted quote that
    # isn't the inverse, a per of 0, and a negative per (the wrong sign)
    for source, target, text, quote in [
        ("JPY", "SEK", "169.8653", {"rate": "1.3650", "inverted": True}),
        ("EUR", "USD", "290", {"rate": "0.9100", "inverted": True}),
        ("KWD", "SEK", "26.288", {"rate": "0.9100", "inverted": True}),
        ("JPY", "NOK", "1.368", {"rate": "136.80", "per": 0}),
        ("JPY", "NOK", "1.368", {"rate": "136.80", "per": -100}),
        ("JPY", "NOK", "136.80", {"rate": "136.80", "per": 100}),
        ("NOK", "JPY", "6.50", {"rate": "6.50", "per": 100, "inverted": True}),
    ]:
        rows.append({"rate": {"from": source, "to": target, "rate": text, "info": {"quote": quote}}, "steps": [{"op": "inverse"}]})
    for text in ["1.10", "01.50", "136.80", "1.1165", "2.000", "0.50", "10", "5/4", "2000/2233"]:
        rows.append({"rate": {"from": "EUR", "to": "USD", "rate": text}, "steps": []})
        rows.append({"rate": {"from": "EUR", "to": "USD", "rate": text}, "steps": [{"op": "round", "places": 2, "rounding": "halfEven"}]})
    while len(rows) < 240:
        source, target = pair(rng)
        start = spec(rng, source, target)
        steps = []
        for _ in range(rng.randrange(1, 5)):
            roll = rng.randrange(4)
            if roll == 0:
                steps.append({"op": "inverse"})
                source, target = target, source
            elif roll == 1:
                _, following = pair(rng, target)
                steps.append({"op": "andThen", "rate": spec(rng, target, following)})
                target = following
            elif roll == 2:
                steps.append({"op": "withMargin", "margin": rng.choice(["-0.02", "0.015", "-0.005", "0.1", "1/3"])})
            else:
                steps.append({"op": "round", "places": rng.randrange(0, 7), "rounding": rng.choice(MODES)})
        rows.append({"rate": start, "steps": steps})
    # a quote is a positive price per positive units, whatever the signs: a negative number over a
    # negative per, and a zero number, are refused at construction
    for text, quote in [
        ("1.368", {"rate": "-136.80", "per": -100}),
        ("1.368", {"rate": "0", "per": 100}),
        ("1.368", {"rate": "0", "inverted": True}),
    ]:
        rows.append({"rate": {"from": "JPY", "to": "NOK", "rate": text, "info": {"quote": quote}}, "steps": [{"op": "inverse"}]})
    out = []
    for row in rows:
        try:
            rate = from_spec(row["rate"])
            for step in row["steps"]:
                if step["op"] == "inverse":
                    rate = rate.inverse()
                elif step["op"] == "andThen":
                    rate = rate.and_then(from_spec(step["rate"]))
                elif step["op"] == "withMargin":
                    rate = rate.with_margin(step["margin"])
                else:
                    rate = rate.round(step["places"], step["rounding"])
            out.append({**row, "json": rate.json(), "error": None})
        except RateError as error:
            out.append({**row, "json": None, "error": str(error)})
    return out


def validity_rows(rng) -> list:
    rows = []
    boundary = [
        ("2026-11-06", "2026-11-06T23:59:59.999Z"),
        ("2026-11-06", "2026-11-07T00:00:00Z"),
        ("2026-11-06", "2026-11-07"),
        ("2026-11-06", "2026-11-06"),
        ("2026-11-06", "2026-11-07T00:59:59+01:00"),
        ("2026-11-06", "2026-11-06T23:00:00-01:00"),
        ("2026-11-06T15:00:00Z", "2026-11-06T15:00:00Z"),
        ("2026-11-06T15:00:00Z", "2026-11-06T15:00:00.001Z"),
        ("2026-11-06T15:00:00Z", "2026-11-06"),
        ("2026-11-06T15:00:00Z", "2026-11-07"),
        ("2026-11-06T00:00:00Z", "2026-11-06"),
        ("2026-11-06T16:00:00+01:00", "2026-11-06T15:00:00Z"),
    ]
    for first, second in boundary:
        rows.append({"availableAt": first, "validUntil": first, "at": second})
        rows.append({"availableAt": second, "validUntil": second, "at": first})
    rows.append({"at": "2026-11-06T15:00:00Z"})
    while len(rows) < 220:
        row = {}
        if rng.random() < 0.8:
            row["availableAt"] = time(rng)
        if rng.random() < 0.8:
            row["validUntil"] = time(rng)
        row["at"] = time(rng)
        rows.append(row)
    out = []
    for row in rows:
        details = {key: row[key] for key in ("availableAt", "validUntil") if key in row}
        rate = exchange_rate("EUR", "USD", "1.1", details)
        out.append({**row, "expired": rate.expired(row["at"]), "available": rate.available(row["at"])})
    return out


def json_rows(rng) -> list:
    inputs = [
        {"from": "EUR", "to": "USD", "rate": "1.10"},
        {"from": "EUR", "to": "USD", "rate": "1.1", "quote": {"rate": "1.1"}},
        {"from": "EUR", "to": "USD", "rate": "1.10", "quote": {"rate": "1.10"}},
        {"from": "EUR", "to": "USD", "rate": "1.10", "quote": {"rate": "1.2"}},
        {"from": "EUR", "to": "USD", "rate": "0", "source": "ECB"},
        {"from": "EUR", "to": "USD", "rate": "-1.5"},
        {"from": "JPY", "to": "NOK", "rate": "1.368", "quote": {"rate": "136.80", "per": 100}},
        {"from": "CAD", "to": "USD", "rate": "200/273", "quote": {"rate": "1.3650", "inverted": True}},
        {"from": "NOK", "to": "JPY", "rate": "200/13", "quote": {"rate": "6.50", "per": 100, "inverted": True}},
        {"from": "EUR", "to": "USD", "rate": "290", "quote": {"rate": "0.9100", "inverted": True}},
        {"from": "JPY", "to": "NOK", "rate": "1.368", "quote": {"rate": "136.80", "per": 0}},
        {"from": "JPY", "to": "NOK", "rate": "1.368", "quote": {"rate": "136.80", "per": 1.5}},
        {"from": "JPY", "to": "NOK", "rate": "1.368", "quote": {"rate": "136.80", "per": -100}},
        {"from": "JPY", "to": "NOK", "rate": "-1.368", "quote": {"rate": "136.80", "per": -100}},
        {"from": "JPY", "to": "NOK", "rate": "1.368", "quote": {"rate": "-136.80", "per": -100}},
        {"from": "EUR", "to": "USD", "rate": "1.1", "quote": {"rate": "0"}},
        {"from": "EUR", "to": "USD", "rate": "1.1165", "source": "ECB", "asOf": "2026-11-06", "availableAt": "2026-11-06T16:00:00+01:00", "validUntil": "2026-11-07T00:00Z", "type": "reference"},
        {"from": "USD", "to": "EUR", "rate": "2000/2233", "asOf": "2026-11-06", "derivedFrom": [{"from": "EUR", "to": "USD", "rate": "1.1165", "source": "ECB", "asOf": "2026-11-06"}]},
    ]
    rows = [{"json": item} for item in inputs]
    for row in derive_rows(random.Random(SEED + 1))[:60]:
        if row["json"] is not None:
            rows.append({"json": row["json"]})
    out = []
    for row in rows:
        try:
            out.append({**row, "want": from_json(row["json"]).json(), "error": None})
        except RateError as error:
            out.append({**row, "want": None, "error": str(error)})
    return out


def amount(rng, currency) -> str:
    places = EXPONENT[currency]
    return scaled(rng.randrange(-10**7, 10**7) if rng.random() < 0.2 else rng.randrange(1, 10**7), places)


def strict_rows(rng) -> list:
    rows = []
    for until, now in [
        ("2026-11-06", "2026-11-06T23:59:59.999Z"),
        ("2026-11-06", "2026-11-07T00:00:00.000Z"),
        ("2026-11-06T15:00:00Z", "2026-11-06T15:00:00.000Z"),
        ("2026-11-06T15:00:00Z", "2026-11-06T15:00:00.001Z"),
        ("2026-11-06T16:00:00+01:00", "2026-11-06T15:30:00.000Z"),
    ]:
        rows.append({"rate": {"from": "EUR", "to": "USD", "rate": "1.1", "info": {"validUntil": until}}, "amount": "100.00", "rounding": "halfEven", "now": now})
    while len(rows) < 80:
        source, target = pair(rng)
        details = {"validUntil": time(rng)} if rng.random() < 0.85 else {}
        rate = {"from": source, "to": target, "rate": rate_text(rng)}
        if details:
            rate["info"] = details
        rows.append({"rate": rate, "amount": amount(rng, source), "rounding": rng.choice([*MODES, "unnecessary"]), "now": Time(instant(rng, rng.choice(DAYS))).text})
    out = []
    for row in rows:
        rate = from_spec(row["rate"])
        try:
            if rate.expired(row["now"]):
                raise RateError("expired")
            want = convert_value(money_value(row["amount"]), rate.value, EXPONENT[rate.target], row["rounding"])
            out.append({**row, "want": want, "error": None})
        except RateError as error:
            out.append({**row, "want": None, "error": str(error)})
    return out


def ecb_table(rng, day=None, with_header=True) -> dict:
    day = day or rng.choice(DAYS)
    table = {"base": "EUR"}
    if with_header:
        table["source"] = "ECB"
        table["asOf"] = day
        if rng.random() < 0.5:
            table["availableAt"] = rng.choice([f"{day}T15:00:00Z", f"{day}T16:00:00+01:00", day])
        if rng.random() < 0.4:
            table["validUntil"] = rng.choice([day, f"{day}T23:00:00Z", (Time(day).day + DAY).strftime("%Y-%m-%d")])
        if rng.random() < 0.3:
            table["type"] = "reference"
    rates = []
    for code in rng.sample([c for c in CURRENCIES if c not in ("EUR", "JPY")], rng.randrange(2, 6)):
        rates.append([code, None if rng.random() < 0.12 else rate_text(rng)])
    if rng.random() < 0.6:
        rates.append(["JPY", rate_text(rng)])
    elif rng.random() < 0.4:
        rates.append(["JPY", {"from": "EUR", "to": "JPY", "rate": "162.457", "info": {"source": "desk", "asOf": day}}])
    table["rates"] = rates
    return {"table": table}


def list_table(rng) -> dict:
    items = []
    for _ in range(rng.randrange(1, 5)):
        source, target = pair(rng)
        items.append(spec(rng, source, target, quoted=False))
    return {"list": items}


def any_provider(rng, depth=0) -> dict:
    roll = rng.randrange(8 if depth < 2 else 3)
    if roll == 0:
        return list_table(rng)
    if roll in (1, 2):
        return ecb_table(rng)
    if roll == 3:
        return {"via": rng.choice(["EUR", "USD"]), "of": any_provider(rng, depth + 1)}
    if roll == 4:
        return {"reversed": any_provider(rng, depth + 1)}
    if roll == 5:
        return {"identity": True}
    return {"chain": [any_provider(rng, depth + 1) for _ in range(rng.randrange(1, 4))]}


def codes_in(spec) -> list:
    """The currencies a provider description mentions, so lookups mostly ask for pairs it may have."""
    if isinstance(spec, dict):
        found = [value for key, value in spec.items() if key in ("from", "to", "base", "via") and isinstance(value, str)]
        for key, value in spec.items():
            if key == "rates":
                for code, entry in value:
                    found.append(code)
                    found.extend(codes_in(entry))
            elif isinstance(value, (dict, list)):
                found.extend(codes_in(value))
        return found
    if isinstance(spec, list):
        return [code for item in spec for code in codes_in(item)]
    return []


def answered(rng, spec, source, target, at) -> bool:
    """Whether to keep a random lookup: every answered one, and a few of the unanswered."""
    try:
        rate_of(spec, source, target, at)
        return True
    except RateError:
        return rng.random() < 0.08


def asked_pair(rng, spec) -> tuple:
    codes = sorted(set(codes_in(spec))) or CURRENCIES
    if rng.random() < 0.15:
        codes = CURRENCIES
    return rng.choice(codes), rng.choice(codes)


def lookup_rows(rng) -> list:
    rows = []
    fixed = {"table": {"base": "EUR", "source": "ECB", "asOf": "2026-11-06", "availableAt": "2026-11-06T15:00:00Z", "rates": [["USD", "1.1165"], ["JPY", "162.457"], ["GBP", None]]}}
    for at in [None, "2026-11-05", "2026-11-06", "2026-11-06T14:59:59.999Z", "2026-11-06T15:00:00Z", "2026-11-06T16:00:00+01:00", "2026-11-07T08:00:00+09:00", "2026-11-07"]:
        for source, target in [("EUR", "USD"), ("USD", "EUR"), ("USD", "JPY"), ("EUR", "GBP"), ("EUR", "EUR")]:
            for wrapped in (fixed, {"via": "EUR", "of": fixed}, {"chain": [fixed, {"identity": True}]}):
                row = {"provider": wrapped, "from": source, "to": target}
                if at is not None:
                    row["asOf"] = at
                rows.append(row)
    duplicate = {"list": [{"from": "EUR", "to": "USD", "rate": "1.1"}, {"from": "EUR", "to": "USD", "rate": "1.2", "info": {"validUntil": "2026-11-06"}}]}
    for at in [None, "2026-11-06T23:59:59.999Z", "2026-11-07T00:00:00Z"]:
        row = {"provider": duplicate, "from": "EUR", "to": "USD"}
        if at:
            row["asOf"] = at
        rows.append(row)
    while len(rows) < 320:
        described = any_provider(rng)
        source, target = asked_pair(rng, described)
        row = {"provider": described, "from": source, "to": target}
        if rng.random() < 0.6:
            row["asOf"] = time(rng)
        if answered(rng, described, source, target, row.get("asOf")):
            rows.append(row)
    out = []
    for row in rows:
        try:
            found = rate_of(row["provider"], row["from"], row["to"], row.get("asOf"))
            out.append({**row, "rate": found.json(), "error": None})
        except RateError as error:
            out.append({**row, "rate": None, "error": str(error)})
    return out


def table_rows(rng) -> list:
    rows = [
        {"table": {"base": "EUR", "rates": []}},
        {"table": {"base": "EUR", "rates": [["USD", {"from": "EUR", "to": "GBP", "rate": "0.85"}]]}},
        {"table": {"base": "EUR", "rates": [["USD", {"from": "USD", "to": "EUR", "rate": "0.85"}]]}},
        {"table": {"base": "EUR", "asOf": "2026-11-06T16:00:00+01:00", "rates": [["USD", "0"]]}},
        {"list": []},
    ]
    while len(rows) < 60:
        rows.append(ecb_table(rng, with_header=rng.random() < 0.8) if rng.random() < 0.75 else list_table(rng))
    out = []
    for row in rows:
        try:
            table = Table(row)
            out.append({**row, "header": table.header, "pairs": [f"{rate.source}/{rate.target}" for rate in table.rates], "error": None})
        except RateError as error:
            out.append({**row, "header": None, "pairs": None, "error": str(error)})
    return out


def convert_rows(rng) -> list:
    rows = []
    while len(rows) < 200:
        described = any_provider(rng)
        source, target = asked_pair(rng, described)
        row = {"amount": amount(rng, source), "currency": source, "to": target, "provider": described, "rounding": rng.choice([*MODES, "unnecessary"])}
        if rng.random() < 0.3:
            row["asOf"] = time(rng)
        if rng.random() < 0.2:
            row["resultScale"] = rng.randrange(0, 6)
        if answered(rng, described, source, target, row.get("asOf")):
            rows.append(row)
    out = []
    for row in rows:
        try:
            rate = rate_of(row["provider"], row["currency"], row["to"], row.get("asOf"))
            scale = row.get("resultScale", EXPONENT[row["to"]])
            out.append({**row, "want": convert_value(money_value(row["amount"]), rate.value, scale, row["rounding"]), "error": None})
        except RateError as error:
            out.append({**row, "want": None, "error": str(error)})
    return out


def bag_provider(rng) -> dict:
    return rng.choice([
        {"via": "EUR", "of": full_table(rng)},
        {"via": "EUR", "of": full_table(rng)},
        {"chain": [{"identity": True}, {"via": "EUR", "of": full_table(rng)}]},
        {"via": "EUR", "of": ecb_table(rng, with_header=False)},
        {"via": "EUR", "of": {"table": {"base": "EUR", "asOf": "2026-11-06", "rates": [[code, rate_text(rng)] for code in CURRENCIES if code != "EUR"]}}},
        {"chain": [{"identity": True}, {"via": "USD", "of": list_table(rng)}]},
    ])


def full_table(rng) -> dict:
    return {"table": {"base": "EUR", "asOf": "2026-11-06", "rates": [[code, rate_text(rng)] for code in CURRENCIES if code != "EUR"]}}


def items(rng) -> list:
    return [[amount(rng, code), code] for code in (rng.choice(CURRENCIES[:5]) for _ in range(rng.randrange(0, 7)))]


def bag_rows(rng) -> list:
    rows = []
    while len(rows) < 160:
        row = {"items": items(rng), "to": rng.choice(CURRENCIES[:5]), "provider": bag_provider(rng), "rounding": rng.choice(MODES)}
        if rng.random() < 0.4:
            row["asOf"] = time(rng)
        if rng.random() < 0.2:
            row["resultScale"] = rng.randrange(0, 5)
        rows.append(row)
    out = []
    for row in rows:
        totals = {}
        for amount_text, code in row["items"]:
            value, places = totals.get(code, (Fraction(0), 0))
            totals[code] = (value + money_value(amount_text), max(places, places_of(amount_text)))
        listed = [[code, scaled(int(value * 10**places), places)] for code, (value, places) in totals.items()]
        try:
            exact = Fraction(0)
            for code, (value, _) in totals.items():
                exact += value if code == row["to"] else value * rate_of(row["provider"], code, row["to"], row.get("asOf")).value
            scale = row.get("resultScale", EXPONENT[row["to"]])
            total = scaled(round_to_integer(exact * 10**scale, row["rounding"]), scale)
            out.append({**row, "totals": listed, "exact": rational_text(exact), "total": total, "error": None})
        except RateError as error:
            out.append({**row, "totals": listed, "exact": None, "total": None, "error": str(error)})
    return out


def sort_rows(rng) -> list:
    rows = []
    while len(rows) < 80:
        row = {"items": items(rng), "base": rng.choice(CURRENCIES[:5]), "provider": bag_provider(rng)}
        if rng.random() < 0.3:
            row["asOf"] = time(rng)
        rows.append(row)
    out = []
    for row in rows:
        try:
            keyed = []
            for index, (amount_text, code) in enumerate(row["items"]):
                value = money_value(amount_text)
                if code != row["base"]:
                    value *= rate_of(row["provider"], code, row["base"], row.get("asOf")).value
                keyed.append((value, index))
            order = [index for _, index in sorted(keyed, key=lambda entry: entry[0])]
            out.append({**row, "order": order, "error": None})
        except RateError as error:
            out.append({**row, "order": None, "error": str(error)})
    return out


def main() -> None:
    rng = random.Random(SEED)
    provenance = {
        "source": "python-fractions",
        "generator": {"name": "scripts/gen-rate-provider-vectors.py", "version": f"{GENERATOR_VERSION} (seed {SEED})"},
        "method": "Rates, their metadata and providers modelled from docs/reference/convert.md with Python's fractions and datetime, times as instants and whole UTC days rather than strings, independently of ducat's TypeScript.",
        "data": {"iso4217": ISO4217_PUBLISHED},
    }
    tables = [
        {"op": "rate.derive", "rows": derive_rows(rng)},
        {"op": "rate.validity", "rows": validity_rows(rng)},
        {"op": "rate.fromJSON", "rows": json_rows(rng)},
        {"op": "rate.strictConvert", "rows": strict_rows(rng)},
        {"op": "provider.table", "rows": table_rows(rng)},
        {"op": "provider.rate", "rows": lookup_rows(rng)},
        {"op": "provider.convert", "rows": convert_rows(rng)},
        {"op": "bag.total", "rows": bag_rows(rng)},
        {"op": "bag.sort", "rows": sort_rows(rng)},
    ]
    for table in tables:
        print(table["op"], len(table["rows"]), file=sys.stderr)
    texts = {
        vector_path("convert", "providers"): file_text(
            "convert",
            "providers",
            "Rate metadata (asOf, availableAt, validUntil, type, quote, derivedFrom) through inverses, chains, margins and rounding; availability and expiry of dates and instants at UTC day boundaries; the JSON form; strict validity; rate tables, chain, reversed, via and identity; converting through a provider; and multi-currency bags totalled and sorted through one.",
            provenance,
            tables,
        ),
    }
    write_or_check(texts, "python3 scripts/gen-rate-provider-vectors.py")


if __name__ == "__main__":
    main()
