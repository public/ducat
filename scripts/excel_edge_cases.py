"""Edge cases for the Excel functions, shared by scripts/gen-finance-vectors.py (the exact oracle)
and scripts/gen-calc-vectors.py (LibreOffice Calc), so both are computed on the same inputs.

Amounts are in major units of a two-decimal currency, as Calc takes them. Each case has a `note`
saying what it covers.
"""

# Excel's FV, PV and PMT take the same five arguments (each reads the two amounts it needs)
ANNUITIES = [
    {"note": "a rate of 0", "rate": "0", "nper": 12, "pmt": "-100.00", "pv": "-1000.00", "fv": "2500.00", "type": 0},
    {"note": "a rate of 0, payments at the start", "rate": "0", "nper": 7, "pmt": "-33.33", "pv": "100.00", "fv": "0", "type": 1},
    {"note": "payments at the start, a non-zero future value", "rate": "0.005", "nper": 60, "pmt": "-250.00", "pv": "-5000.00", "fv": "20000.00", "type": 1},
    {"note": "a negative rate", "rate": "-0.02", "nper": 24, "pmt": "-100.00", "pv": "5000.00", "fv": "-1000.00", "type": 0},
    {"note": "a negative rate, payments at the start", "rate": "-0.05", "nper": 10, "pmt": "120.00", "pv": "-900.00", "fv": "0", "type": 1},
    {"note": "a rate near -1", "rate": "-0.9", "nper": 6, "pmt": "-1.00", "pv": "1000.00", "fv": "0", "type": 0},
    {"note": "one period", "rate": "0.07", "nper": 1, "pmt": "-500.00", "pv": "1000.00", "fv": "-600.00", "type": 0},
    {"note": "one period, payments at the start", "rate": "0.07", "nper": 1, "pmt": "-500.00", "pv": "1000.00", "fv": "-600.00", "type": 1},
    {"note": "40 years monthly", "rate": "0.004", "nper": 480, "pmt": "-450.00", "pv": "-10000.00", "fv": "0", "type": 0},
    {"note": "a high rate over many periods (a large growth)", "rate": "0.3", "nper": 360, "pmt": "-1.00", "pv": "-0.01", "fv": "0", "type": 1},
    {"note": "a tiny rate over 360 periods: (1 + r)^n - 1 cancels in doubles", "rate": "0.000000001", "nper": 360, "pmt": "-1000.00", "pv": "300000.00", "fv": "0", "type": 0},
    {"note": "a tiny rate, payments at the start", "rate": "0.0000001", "nper": 120, "pmt": "-2500.00", "pv": "0", "fv": "310000.00", "type": 1},
    {"note": "no payment", "rate": "0.03", "nper": 30, "pmt": "0", "pv": "-1000.00", "fv": "500.00", "type": 0},
    {"note": "no present or future value", "rate": "0.01", "nper": 36, "pmt": "-300.00", "pv": "0", "fv": "0", "type": 0},
    {"note": "a payment and values that cancel at this rate", "rate": "0.1", "nper": 2, "pmt": "-121.00", "pv": "210.00", "fv": "0", "type": 0},
]

# NPER: `exact` marks the cases whose number of periods is a decimal, so `exact` is set
NPERS = [
    {"note": "a rate of 0", "rate": "0", "pmt": "-150.00", "pv": "1000.00", "fv": "0", "type": 0},
    {"note": "a rate of 0, a non-zero future value, at the start", "rate": "0", "pmt": "-70.00", "pv": "-100.00", "fv": "1000.00", "type": 1},
    {"note": "exactly 2 periods", "rate": "0.1", "pmt": "-1.21", "pv": "2.10", "fv": "0", "type": 0},
    {"note": "exactly 3 periods: growth (1 + r)^3", "rate": "0.1", "pmt": "0", "pv": "-1000.00", "fv": "1331.00", "type": 0},
    {"note": "exactly 1/2 period: growth (1 + r)^(1/2)", "rate": "0.21", "pmt": "0", "pv": "-100.00", "fv": "110.00", "type": 0},
    {"note": "payments at the start, a non-zero future value", "rate": "0.01", "pmt": "-100.00", "pv": "-1000.00", "fv": "10000.00", "type": 1},
    {"note": "a negative rate", "rate": "-0.03", "pmt": "-200.00", "pv": "5000.00", "fv": "0", "type": 0},
    {"note": "a negative number of periods", "rate": "0.05", "pmt": "100.00", "pv": "1000.00", "fv": "0", "type": 0},
    {"note": "a tiny rate", "rate": "0.000000001", "pmt": "-1000.00", "pv": "300000.00", "fv": "0", "type": 0},
    {"note": "payments that never settle the loan (no value)", "rate": "0.1", "pmt": "-50.00", "pv": "1000.00", "fv": "0", "type": 0},
]

# RATE: one sign change in the flows each implies
RATES = [
    {"note": "a rate of exactly 0", "nper": 10, "pmt": "-100.00", "pv": "1000.00", "fv": "0", "type": 0},
    {"note": "a rate of exactly 0.05, one period", "nper": 1, "pmt": "-105.00", "pv": "100.00", "fv": "0", "type": 0},
    {"note": "a rate of exactly 0.1, two periods", "nper": 2, "pmt": "-121.00", "pv": "210.00", "fv": "0", "type": 0},
    {"note": "a negative rate", "nper": 24, "pmt": "-180.00", "pv": "5000.00", "fv": "0", "type": 0},
    {"note": "payments at the start, a balloon", "nper": 60, "pmt": "-450.00", "pv": "25000.00", "fv": "-5000.00", "type": 1},
    {"note": "a savings plan to a future value", "nper": 120, "pmt": "-200.00", "pv": "-1000.00", "fv": "40000.00", "type": 0},
    {"note": "ill-conditioned: a rate near 1e-9 over 360 periods", "nper": 360, "pmt": "-1000.00", "pv": "359999.95", "fv": "0", "type": 0},
    {"note": "ill-conditioned: a rate near -1e-9 over 360 periods", "nper": 360, "pmt": "-1000.00", "pv": "360000.06", "fv": "0", "type": 0},
    {"note": "ill-conditioned: a rate near 1e-10 over 480 periods, at the start", "nper": 480, "pmt": "-1000.00", "pv": "479999.99", "fv": "0", "type": 1},
    {"note": "40 years monthly", "nper": 480, "pmt": "-600.00", "pv": "100000.00", "fv": "0", "type": 0},
]

# XNPV: the first date starts the schedule
XNPVS = [
    {"note": "a rate of 0", "rate": "0", "values": ["-1000.00", "300.00", "800.00"], "dates": ["2020-01-01", "2020-07-01", "2021-03-15"]},
    {"note": "dates equal to the first", "rate": "0.08", "values": ["-1000.00", "200.00", "-50.00", "900.00"], "dates": ["2020-01-01", "2020-01-01", "2020-01-01", "2020-06-30"]},
    {"note": "every date on the first", "rate": "0.08", "values": ["-1000.00", "1200.00"], "dates": ["2020-01-01", "2020-01-01"]},
    {"note": "whole years apart", "rate": "0.07", "values": ["-1000.00", "500.00", "700.00"], "dates": ["2019-01-01", "2020-01-01", "2020-12-31"]},
    {"note": "irrational terms that cancel, leaving an exact tie", "rate": "1", "values": ["1.00", "0.01", "-10.00", "20.00"], "dates": ["2020-01-01", "2020-12-31", "2020-04-10", "2021-04-10"]},
    {"note": "flows on one date that cancel", "rate": "0.05", "values": ["-100.00", "40.00", "-40.00", "150.00"], "dates": ["2020-01-01", "2020-05-01", "2020-05-01", "2021-01-01"]},
    {"note": "a negative rate", "rate": "-0.5", "values": ["-1000.00", "200.00", "300.00"], "dates": ["2020-01-01", "2021-08-01", "2023-02-14"]},
    {"note": "a rate near -1", "rate": "-0.95", "values": ["-1000.00", "1.00", "0.50"], "dates": ["2020-01-01", "2022-01-01", "2026-06-01"]},
    {"note": "thirty years", "rate": "0.06", "values": ["-100000.00", "5000.00", "5000.00", "150000.00"], "dates": ["2000-01-01", "2010-06-30", "2020-12-31", "2029-12-31"]},
    {"note": "leap days", "rate": "0.04", "values": ["-500.00", "250.00", "260.00"], "dates": ["2020-02-29", "2021-02-28", "2024-02-29"]},
]

# XIRR: one sign change once combined by date, except the cases noted
XIRRS = [
    {"note": "a rate of exactly 0.1, whole years apart", "values": ["-100.00", "110.00"], "dates": ["2020-01-01", "2020-12-31"]},
    {"note": "a root on the grid with irrational factors that cancel", "values": ["0", "-1000.00", "1100.00"], "dates": ["2021-01-01", "2021-03-01", "2022-03-01"]},
    {"note": "dates equal to the first", "values": ["-600.00", "-400.00", "300.00", "900.00"], "dates": ["2020-01-01", "2020-01-01", "2020-09-01", "2021-09-01"]},
    {"note": "a negative rate", "values": ["-1000.00", "300.00", "400.00"], "dates": ["2020-01-01", "2021-01-01", "2022-06-01"]},
    {"note": "a rate near -1", "values": ["-1000.00", "0.10"], "dates": ["2020-01-01", "2021-01-01"]},
    {"note": "a high rate", "values": ["-100.00", "500.00"], "dates": ["2020-01-01", "2020-03-01"]},
    {"note": "thirty years", "values": ["-10000.00", "500.00", "500.00", "40000.00"], "dates": ["2000-01-01", "2010-01-01", "2020-01-01", "2029-12-31"]},
    {"note": "flows on one date that cancel", "values": ["-1000.00", "250.00", "-250.00", "1200.00"], "dates": ["2020-01-01", "2020-06-01", "2020-06-01", "2021-06-01"]},
]
