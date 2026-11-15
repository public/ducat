"""Collects criterion's median estimates (ns per iteration) into one JSON object.

Usage: python3 collect.py <criterion dir> <out.json>, after each `cargo bench -p ducat-benches`.
The criterion dir is $CARGO_TARGET_DIR/criterion.
"""

import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
out = {}
for est in sorted(root.glob("*/*/*/new/estimates.json")):
    size, lib, group = est.parts[-3], est.parts[-4], est.parts[-5]
    data = json.loads(est.read_text())
    med = data["median"]
    out[f"{group}/{lib}/{size}"] = {
        "median_ns": med["point_estimate"],
        "ci95_ns": [med["confidence_interval"]["lower_bound"], med["confidence_interval"]["upper_bound"]],
    }
pathlib.Path(sys.argv[2]).write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
print(len(out), "benchmarks")
