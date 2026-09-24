#!/usr/bin/env python3
"""Documentation index for docs/ (standard library only).

Every doc in docs/ starts with YAML-style front matter carrying audit info:

    ---
    title: Dice engine
    area: web                 # architecture | server | web | gameplay | setup | reference
    topic: dice               # short keyword used by `topic`
    related_code:
      - apps/web/src/dice/**
    created: 2026-09-24
    last_updated: 2026-09-24
    last_audited: 2026-09-24
    audited_by: claude
    status: current           # current | stale | draft
    change_log:
      - "2026-09-24: Initial version"
    ---

Commands:
    find <code_path>...   docs related to code files (glob match on related_code)
    topic <name>          docs for a topic or area (also matches directory names)
    list                  every doc with status and audit date
    rebuild               regenerate docs/index.json from front matter
    check                 validate: required fields, <=500 lines, dead related_code
                          globs, index freshness; warn on docs whose code changed
                          after last_audited (via git). Exit 1 on errors.
    stale                 only the "code changed since last audit" report
    audit <doc>...        stamp last_audited (and last_updated) with today's date
"""
from __future__ import annotations

import datetime as _dt
import fnmatch
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
INDEX = DOCS / "index.json"
MAX_LINES = 500
REQUIRED = ["title", "area", "topic", "related_code", "created", "last_updated", "last_audited", "audited_by", "status", "change_log"]
STATUSES = {"current", "stale", "draft"}
LIST_FIELDS = {"related_code", "change_log"}


# --------------------------------------------------------------------------- parsing
def parse_front_matter(text: str) -> tuple[dict, int]:
    """Parse the limited YAML subset used in docs. Returns (fields, end_line_index)."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, 0
    meta: dict = {}
    key = None
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return meta, i
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = re.match(r"^\s+-\s+(.*)$", line)
        if m and key:
            if not isinstance(meta.get(key), list):
                meta[key] = []
            meta[key].append(_unquote(m.group(1)))
            continue
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if m:
            key = m.group(1)
            value = re.sub(r"\s+#.*$", "", m.group(2)).strip()
            meta[key] = [] if (value == "" and key in LIST_FIELDS) else _unquote(value)
    return meta, 0


def _unquote(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return v


def load_docs() -> list[dict]:
    docs = []
    for path in sorted(DOCS.rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        meta, _ = parse_front_matter(text)
        docs.append({
            "path": path.relative_to(ROOT).as_posix(),
            "lines": len(text.splitlines()),
            "meta": meta,
        })
    return docs


# --------------------------------------------------------------------------- matching
def glob_to_regex(pattern: str) -> re.Pattern:
    """Translate a glob with ** support into a regex over posix paths."""
    out = ""
    i = 0
    while i < len(pattern):
        c = pattern[i]
        if pattern.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
            continue
        if pattern.startswith("**", i):
            out += ".*"
            i += 2
            continue
        if c == "*":
            out += "[^/]*"
        elif c == "?":
            out += "[^/]"
        else:
            out += re.escape(c)
        i += 1
    return re.compile(f"^{out}$")


def matches(pattern: str, path: str) -> bool:
    path = path.removeprefix("./")
    pattern = pattern.removeprefix("./")
    if pattern.endswith("/"):
        pattern += "**"
    return bool(glob_to_regex(pattern).match(path))


def repo_files() -> list[str]:
    try:
        out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
        return [l for l in out.splitlines() if l]
    except Exception:
        files = []
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [d for d in dirnames if d not in {"node_modules", ".git", "dist", "campaigns", "models"}]
            for f in filenames:
                files.append(Path(dirpath, f).relative_to(ROOT).as_posix())
        return files


def last_commit_date(path: str) -> str | None:
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%cs", "--", path], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        return out or None
    except Exception:
        return None


def modified_uncommitted(path: str) -> bool:
    try:
        out = subprocess.run(["git", "status", "--porcelain", "--", path], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        return bool(out)
    except Exception:
        return False


# --------------------------------------------------------------------------- index
def build_index(docs: list[dict]) -> dict:
    by_code: dict[str, list[str]] = {}
    by_topic: dict[str, list[str]] = {}
    by_area: dict[str, list[str]] = {}
    entries = []
    for d in docs:
        m = d["meta"]
        entries.append({
            "path": d["path"],
            "title": m.get("title", ""),
            "area": m.get("area", ""),
            "topic": m.get("topic", ""),
            "status": m.get("status", ""),
            "last_updated": m.get("last_updated", ""),
            "last_audited": m.get("last_audited", ""),
            "related_code": m.get("related_code", []) or [],
        })
        for pat in m.get("related_code", []) or []:
            by_code.setdefault(pat, []).append(d["path"])
        if m.get("topic"):
            by_topic.setdefault(m["topic"], []).append(d["path"])
        if m.get("area"):
            by_area.setdefault(m["area"], []).append(d["path"])
    return {
        "_comment": "Generated by scripts/docs_index.py rebuild. Do not edit by hand.",
        "docs": entries,
        "by_code": dict(sorted(by_code.items())),
        "by_topic": dict(sorted(by_topic.items())),
        "by_area": dict(sorted(by_area.items())),
    }


def index_json(docs: list[dict]) -> str:
    return json.dumps(build_index(docs), indent=2) + "\n"


# --------------------------------------------------------------------------- commands
def cmd_find(paths: list[str]) -> int:
    docs = load_docs()
    found_any = False
    for raw in paths:
        p = Path(raw)
        rel = (p.resolve().relative_to(ROOT) if p.is_absolute() or p.exists() else p).as_posix()
        hits = [d for d in docs if any(matches(pat, rel) for pat in d["meta"].get("related_code", []) or [])]
        print(f"{rel}:")
        for d in hits:
            m = d["meta"]
            print(f"  {d['path']}  — {m.get('title', '')} [{m.get('status', '?')}, audited {m.get('last_audited', '?')}]")
        if not hits:
            print("  (no docs reference this file — consider adding it to a doc's related_code)")
        found_any = found_any or bool(hits)
    return 0 if found_any else 1


def cmd_topic(name: str) -> int:
    name = name.lower()
    docs = load_docs()
    hits = [
        d for d in docs
        if name in str(d["meta"].get("topic", "")).lower()
        or name == str(d["meta"].get("area", "")).lower()
        or f"/{name}/" in d["path"].lower()
        or name in str(d["meta"].get("title", "")).lower()
    ]
    for d in hits:
        print(f"{d['path']}  — {d['meta'].get('title', '')}")
    if not hits:
        topics = sorted({str(d['meta'].get('topic', '')) for d in docs} | {str(d['meta'].get('area', '')) for d in docs})
        print(f"No docs for '{name}'. Topics/areas: {', '.join(t for t in topics if t)}")
        return 1
    return 0


def cmd_list() -> int:
    for d in load_docs():
        m = d["meta"]
        print(f"{m.get('status', '?'):8} {m.get('last_audited', '?'):10} {d['lines']:4}L  {d['path']}  — {m.get('title', '')}")
    return 0


def cmd_rebuild() -> int:
    INDEX.write_text(index_json(load_docs()), encoding="utf-8")
    print(f"Wrote {INDEX.relative_to(ROOT)}")
    return 0


def stale_report(docs: list[dict]) -> list[str]:
    files = repo_files()
    warnings = []
    for d in docs:
        m = d["meta"]
        audited = str(m.get("last_audited", ""))
        for pat in m.get("related_code", []) or []:
            for f in (f for f in files if matches(pat, f)):
                changed = last_commit_date(f)
                if (changed and audited and changed > audited) or (audited and modified_uncommitted(f) and audited < _dt.date.today().isoformat()):
                    warnings.append(f"{d['path']}: {f} changed ({changed or 'uncommitted'}) after last_audited {audited}")
    return warnings


def cmd_check() -> int:
    docs = load_docs()
    files = repo_files()
    errors, warnings = [], []
    for d in docs:
        m, p = d["meta"], d["path"]
        if not m:
            errors.append(f"{p}: missing front matter")
            continue
        for f in REQUIRED:
            if f not in m or m[f] in ("", None):
                errors.append(f"{p}: missing '{f}'")
        if d["lines"] > MAX_LINES:
            errors.append(f"{p}: {d['lines']} lines (max {MAX_LINES}) — split it")
        if m.get("status") and m["status"] not in STATUSES:
            errors.append(f"{p}: status must be one of {sorted(STATUSES)}")
        for f in ("created", "last_updated", "last_audited"):
            if m.get(f) and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(m[f])):
                errors.append(f"{p}: {f} must be YYYY-MM-DD")
        for pat in m.get("related_code", []) or []:
            if not any(matches(pat, f) for f in files):
                errors.append(f"{p}: related_code '{pat}' matches no file")
        if m.get("status") == "stale":
            warnings.append(f"{p}: marked stale")
    if INDEX.exists():
        if INDEX.read_text(encoding="utf-8") != index_json(docs):
            errors.append("docs/index.json is out of date — run: python3 scripts/docs_index.py rebuild")
    else:
        errors.append("docs/index.json missing — run: python3 scripts/docs_index.py rebuild")
    warnings += stale_report(docs)
    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"ERROR {e}")
    print(f"{len(docs)} docs, {len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


def cmd_stale() -> int:
    w = stale_report(load_docs())
    for line in w:
        print(line)
    if not w:
        print("All docs audited after their related code last changed.")
    return 0


def cmd_audit(paths: list[str]) -> int:
    today = _dt.date.today().isoformat()
    for raw in paths:
        path = (ROOT / raw) if not Path(raw).is_absolute() else Path(raw)
        text = path.read_text(encoding="utf-8")
        text = re.sub(r"^last_audited:.*$", f"last_audited: {today}", text, count=1, flags=re.M)
        path.write_text(text, encoding="utf-8")
        print(f"Stamped {path.relative_to(ROOT)} last_audited={today}")
    return cmd_rebuild()


def main(argv: list[str]) -> int:
    if not argv or argv[0] in {"-h", "--help", "help"}:
        print(__doc__)
        return 0
    cmd, args = argv[0], argv[1:]
    if cmd == "find" and args:
        return cmd_find(args)
    if cmd == "topic" and args:
        return cmd_topic(" ".join(args))
    if cmd == "list":
        return cmd_list()
    if cmd == "rebuild":
        return cmd_rebuild()
    if cmd == "check":
        return cmd_check()
    if cmd == "stale":
        return cmd_stale()
    if cmd == "audit" and args:
        return cmd_audit(args)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
