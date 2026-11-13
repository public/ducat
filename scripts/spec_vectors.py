"""Writes a vector file of @ducatjs/money-spec (spec/README.md): the envelope, then tables of rows,
one row per line so a regeneration diff shows exactly which vectors changed. Shared by the Python
generators in scripts/.

checkedAgainst is the ducat version when the rows last changed: it is kept while the rows stay the
same, so a version bump doesn't make --check fail.
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def vector_path(area: str, name: str) -> Path:
    return ROOT / "spec" / "vectors" / area / f"{name}.json"


def _rows_text(tables: list) -> str:
    parts = []
    for table in tables:
        head = {key: value for key, value in table.items() if key != "rows"}
        head_text = json.dumps(head, ensure_ascii=False, separators=(",", ":"))[:-1]
        body = ",\n".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in table["rows"])
        parts.append(f'{head_text},"rows":[\n{body}\n]}}')
    return "[\n" + ",\n".join(parts) + "\n]"


def _checked_against(path: Path, content_hash: str) -> str:
    if path.exists():
        existing = json.loads(path.read_text())
        if existing.get("contentSha256") == content_hash:
            return existing["checkedAgainst"]
    return json.loads((ROOT / "package.json").read_text())["version"]


def file_text(area: str, name: str, description: str, provenance: dict, tables: list) -> str:
    """The file's text. Each table is {"op": ..., "rows": [...]} plus optional fields."""
    rows = _rows_text(tables)
    content_hash = hashlib.sha256(rows.encode()).hexdigest()
    envelope = {
        "$schema": "../../schema/vectors.schema.json",
        "format": 1,
        "area": area,
        "name": name,
        "description": description,
        "provenance": provenance,
        "checkedAgainst": _checked_against(vector_path(area, name), content_hash),
        "contentSha256": content_hash,
    }
    header = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))[:-1]
    return f'{header},"tables":{rows}}}\n'


def write_or_check(texts: dict, regenerate_command: str) -> None:
    """Writes each {path: text}, or with --check fails if any file differs."""
    if "--check" in sys.argv:
        stale = [path for path, text in texts.items() if not path.exists() or path.read_text() != text]
        if stale:
            names = ", ".join(str(path.relative_to(ROOT)) for path in stale)
            sys.exit(f"{names} out of date; run {regenerate_command}")
        print(", ".join(str(path.relative_to(ROOT)) for path in texts) + " up to date")
        return
    for path, text in texts.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        print(f"wrote {path.relative_to(ROOT)}")
