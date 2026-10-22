#!/usr/bin/env python3
"""Print a campaign's session in time order: log lines, tool calls with their outcome, and diag events.

    python3 scripts/session_log.py                  # the most recently active campaign
    python3 scripts/session_log.py cmp_04ee010393   # one campaign
    python3 scripts/session_log.py --since 19:30 --only tool,diag
    python3 scripts/session_log.py --db path/to/dm.sqlite

Read-only (opens the database with mode=ro). Python 3, stdlib only.
"""
import argparse
import datetime as dt
import json
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def line(ts, typ, p):
    t = dt.datetime.fromtimestamp(ts / 1000).strftime("%H:%M:%S")
    if typ == "log":
        who = p.get("speaker") or p.get("kind", "")
        return f"{t} {who}: {p.get('text', '')}"
    if typ == "tool":
        args = json.dumps(p.get("args", {}), ensure_ascii=False)
        res = ""
        if p.get("ok") is False:
            res = f"  !! {p.get('error', '')}"
        elif "result" in p:
            res = f"  -> {p['result'][:160]}"
        return f"{t} [tool:{p.get('source', '')}] {p.get('name')} {args}{res}"
    if typ == "diag":
        rest = {k: v for k, v in p.items() if k != "tag"}
        body = rest.pop("text", None)
        extra = json.dumps(rest, ensure_ascii=False) if rest else ""
        return f"{t} [{p.get('tag')}] {body or ''} {extra}".rstrip()
    return f"{t} [{typ}] {json.dumps(p, ensure_ascii=False)[:300]}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("campaign", nargs="?", help="campaign id (default: most recent events)")
    ap.add_argument("--db", default=os.path.join(ROOT, os.environ.get("DATA_DIR", "campaigns"), "dm.sqlite"))
    ap.add_argument("--since", help="HH:MM (today) to start from")
    ap.add_argument("--only", help="comma-separated event types: log,tool,diag,undo")
    a = ap.parse_args()

    db = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    cid = a.campaign or (db.execute("SELECT campaign_id FROM events ORDER BY id DESC LIMIT 1").fetchone() or [None])[0]
    if not cid:
        sys.exit("No events.")
    since = 0
    if a.since:
        h, m = (int(x) for x in a.since.split(":"))
        since = int(dt.datetime.combine(dt.date.today(), dt.time(h, m)).timestamp() * 1000)
    only = set(a.only.split(",")) if a.only else None
    print(f"# {cid}")
    for ts, typ, payload in db.execute("SELECT ts, type, payload FROM events WHERE campaign_id = ? AND ts >= ? ORDER BY id", (cid, since)):
        if only and typ not in only:
            continue
        print(line(ts, typ, json.loads(payload)))


if __name__ == "__main__":
    main()
