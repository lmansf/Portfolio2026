"""The site's nightly data run: pull every source, rebuild, test, log.

The site treats its own data like a small data product. This script is the
one orchestrated run behind it. The `Data run` workflow
(.github/workflows/data-run.yml) runs it every night and commits what it
writes; a pull request runs it as a dry run.

    python3 scripts/data_run.py              # run and write the files below
    python3 scripts/data_run.py --dry-run    # run, print the results, write nothing
    python3 scripts/data_run.py --offline    # skip the GitHub API (keep the last pull)

1. Extract. Three sources, described with everything else in
   data/pipeline/models.json:
   * the site pages: data/console/site.sql is rebuilt from index.html and
     projects.html (scripts/build_console_data.py);
   * the fraud snapshot: data/fraud-snapshot.json, which the `Fraud
     snapshot` workflow publishes from Supabase (this run only reads it);
   * GitHub: public events and public repositories for github.com/lmansf,
     from the public REST API. Staged as data/pipeline/stg_github_events.json
     (id, type, repo, time: no commit messages, names or emails) and
     modelled into data/pipeline/github.json by
     data/pipeline/sql/github_activity.sql.
   A source that fails keeps its last good files and is logged as failed,
   so its freshness checks fail visibly; the site never breaks over it.
2. Load every mart into DuckDB, the same tables the SQL source editors query.
3. Test. Each mart's tests in models.json (row counts, no nulls, unique keys,
   accepted values, expressions that must hold, freshness), plus two the run
   adds itself: every column is described in models.json, and each SQL source
   caption's default query still returns what its page shows.
4. Log. data/pipeline/run-log.json keeps the latest run in full (sources,
   tables, every check, and which checks each caption's piece depends on)
   and a short history of the last 30 runs. /status and the trust badges
   beside each SQL source read it.

Exit status: 0 when the run finished, whatever its checks found (failures
are data, logged and shown on /status); 1 when a definition is broken (a
test's SQL errors, or models.json names a table or caption that doesn't
exist), so a pull request can't ship a broken test.

Needs the duckdb Python package (pip install duckdb==1.5.6).
"""

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_console_data as site  # noqa: E402
import build_sql_sources as captions  # noqa: E402

ROOT = site.ROOT
PIPE = ROOT / "data" / "pipeline"
MODELS = PIPE / "models.json"
RUN_LOG = PIPE / "run-log.json"
STG_GITHUB = PIPE / "stg_github_events.json"
GITHUB_DATA = PIPE / "github.json"
GITHUB_TABLES = PIPE / "github-tables.json"
GITHUB_MODEL = PIPE / "sql" / "github_activity.sql"
SITE_SQL = site.OUT
SNAPSHOT_JSON = captions.SNAPSHOT_JSON

GITHUB_USER = "lmansf"
GITHUB_API = "https://api.github.com"
WINDOW_DAYS = 30
HISTORY = 30
SITE_MARTS = ("projects", "experience", "skills", "credentials", "resume")


def now_utc():
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def dump(data):
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


# ── 1. Extract ──
def github_get(path, token):
    req = urllib.request.Request(GITHUB_API + path, headers={
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "loganmansfield.org data run",
        **({"Authorization": f"Bearer {token}"} if token else {}),
    })
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode("utf-8"))


def pull_github(started):
    """Staged events and repos from the public API, or raise."""
    token = os.environ.get("GITHUB_TOKEN")
    cutoff = started - timedelta(days=WINDOW_DAYS)
    events = []
    for page in (1, 2, 3):  # the API serves at most 300 recent events
        batch = github_get(f"/users/{GITHUB_USER}/events/public?per_page=100&page={page}", token)
        if not isinstance(batch, list):
            raise ValueError("the events endpoint didn't return a list")
        for e in batch:
            when = parse_iso(e.get("created_at"))
            if not e.get("public") or when is None or when < cutoff:
                continue
            events.append({"id": str(e.get("id")), "type": str(e.get("type")),
                           "repo": str((e.get("repo") or {}).get("name")), "created_at": iso(when)})
        if len(batch) < 100:
            break
    repos = github_get(f"/users/{GITHUB_USER}/repos?type=owner&sort=pushed&per_page=100", token)
    if not isinstance(repos, list):
        raise ValueError("the repos endpoint didn't return a list")
    repos = [{
        "repo": r.get("full_name"),
        "language": r.get("language"),
        "stars": int(r.get("stargazers_count") or 0),
        "pushed_on": (r.get("pushed_at") or "")[:10] or None,
        "archived": bool(r.get("archived")),
    } for r in repos if not r.get("fork") and not r.get("private")]
    events.sort(key=lambda e: (e["created_at"], e["id"]))
    repos.sort(key=lambda r: r["repo"])
    return events, repos


def model_github(events, repos, fetched_at):
    """Run the github_activity model over the staged events."""
    con = duckdb.connect()
    con.execute("CREATE TABLE stg_github_events (id VARCHAR, type VARCHAR, repo VARCHAR, created_at VARCHAR)")
    if events:
        con.executemany("INSERT INTO stg_github_events VALUES (?, ?, ?, ?)",
                        [(e["id"], e["type"], e["repo"], e["created_at"]) for e in events])
    cur = con.execute(GITHUB_MODEL.read_text(encoding="utf-8"))
    cols = [d[0] for d in cur.description]
    activity = [{c: (v.isoformat() if hasattr(v, "isoformat") else v) for c, v in zip(cols, row)}
                for row in cur.fetchall()]
    return {"fetched_at": fetched_at, "user": GITHUB_USER, "window_days": WINDOW_DAYS,
            "activity": activity, "repos": repos}


def extract(started, offline):
    """Returns (sources log, files to write, the data each mart loads from)."""
    sources, writes = [], {}

    # Site pages → site.sql
    pages = None
    try:
        pages = {p: site.parse(ROOT / p) for p in ("index.html", "projects.html")}
        sql = site.build()
        if not SITE_SQL.exists() or SITE_SQL.read_text(encoding="utf-8") != sql:
            writes[SITE_SQL] = sql
        sources.append({"name": "site_pages", "status": "ok", "as_of": iso(started),
                        "detail": "Rebuilt the site tables from index.html and projects.html."})
    except Exception as err:  # noqa: BLE001  (logged, and the last site.sql stays)
        if SITE_SQL.exists():
            sql, kept = SITE_SQL.read_text(encoding="utf-8"), "kept the last site.sql"
        else:
            sql, kept = "", "and there is no earlier site.sql to keep"
        sources.append({"name": "site_pages", "status": "failed", "as_of": None,
                        "detail": f"Couldn't parse the pages ({err}); {kept}."})

    # Fraud snapshot (published by the Fraud snapshot workflow)
    snapshot = read_json(SNAPSHOT_JSON)
    if isinstance(snapshot, dict) and parse_iso(snapshot.get("generated_at")):
        sources.append({"name": "fraud_snapshot", "status": "ok", "as_of": iso(parse_iso(snapshot["generated_at"])),
                        "detail": "Read data/fraud-snapshot.json, published from Supabase by the Fraud snapshot job."})
    else:
        snapshot = None
        sources.append({"name": "fraud_snapshot", "status": "failed", "as_of": None,
                        "detail": "data/fraud-snapshot.json is missing or unreadable."})

    # GitHub public API → staging → mart
    github = read_json(GITHUB_DATA)
    if offline:
        sources.append({"name": "github", "status": "skipped", "as_of": (github or {}).get("fetched_at"),
                        "detail": "Offline run; kept the last pull."})
    else:
        try:
            events, repos = pull_github(started)
            github = model_github(events, repos, iso(started))
            writes[STG_GITHUB] = dump({"fetched_at": iso(started), "user": GITHUB_USER, "events": events})
            writes[GITHUB_DATA] = dump(github)
            sources.append({"name": "github", "status": "ok", "as_of": iso(started),
                            "detail": f"Pulled {len(events)} public event{'s' if len(events) != 1 else ''} and "
                                      f"{len(repos)} public repositor{'ies' if len(repos) != 1 else 'y'}."})
        except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError) as err:
            reason = getattr(err, "code", None) or getattr(err, "reason", None) or err
            sources.append({"name": "github", "status": "failed", "as_of": (github or {}).get("fetched_at"),
                            "detail": f"The GitHub API didn't answer ({reason}); kept the last pull."})
    return sources, writes, {"site_sql": sql, "pages": pages, "snapshot": snapshot, "github": github}


# ── 2. Load ──
def load(data):
    con = duckdb.connect()
    con.execute(data["site_sql"])
    captions.build_live_tables(con, data["snapshot"] or {}, captions.snapshot_tables())
    gh_tables = {k: v for k, v in read_json(GITHUB_TABLES, {}).items() if not k.startswith("_")}
    captions.build_live_tables(con, data["github"] or {}, gh_tables)
    return con


# ── 3. Test ──
def ident(name):
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", name):
        raise ValueError(f"not a plain column or table name: {name!r}")
    return name


def lit(v):
    return "'" + str(v).replace("'", "''") + "'"


def describe_test(t):
    kind = t["type"]
    if kind == "row_count":
        lo, hi = t.get("min"), t.get("max")
        if lo is not None and lo == hi:
            return f"exactly {lo} row{'s' if lo != 1 else ''}"
        if hi is not None:
            return f"{lo or 0} to {hi} rows"
        return f"at least {lo} row{'s' if lo != 1 else ''}" if lo else "any number of rows"
    if kind == "not_null":
        return "no blanks in " + ", ".join(t["columns"])
    if kind == "unique":
        cols = t["columns"]
        return f"{cols[0]} is unique" if len(cols) == 1 else f"{' and '.join(cols)} are unique together"
    if kind == "accepted_values":
        return f"{t['column']} is one of " + ", ".join(t["values"])
    if kind == "freshness":
        return None  # filled in with the table's own limit
    return t["name"]


def slug(text):
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:60]


def run_test(con, table, t):
    """(passed, detail) for one test; raises if the test itself is broken."""
    tbl = ident(table)
    kind = t["type"]
    if kind == "row_count":
        n = con.execute(f"SELECT count(*) FROM {tbl}").fetchone()[0]
        ok = n >= t.get("min", 0) and (t.get("max") is None or n <= t["max"])
        return ok, f"{n:,} row{'s' if n != 1 else ''}"
    if kind == "not_null":
        nulls = []
        for c in t["columns"]:
            n = con.execute(f"SELECT count(*) FROM {tbl} WHERE {ident(c)} IS NULL").fetchone()[0]
            if n:
                nulls.append(f"{c} ({n})")
        return not nulls, ("blank: " + ", ".join(nulls)) if nulls else "none blank"
    if kind == "unique":
        cols = ", ".join(ident(c) for c in t["columns"])
        n = con.execute(f"SELECT count(*) FROM (SELECT {cols} FROM {tbl} GROUP BY ALL HAVING count(*) > 1)").fetchone()[0]
        return n == 0, f"{n} repeated" if n else "no repeats"
    if kind == "accepted_values":
        col = ident(t["column"])
        values = ", ".join(lit(v) for v in t["values"])
        bad = [r[0] for r in con.execute(
            f"SELECT DISTINCT {col} FROM {tbl} WHERE {col} IS NOT NULL AND {col} NOT IN ({values}) ORDER BY 1").fetchall()]
        return not bad, ("unexpected: " + ", ".join(map(str, bad[:5]))) if bad else "all expected"
    if kind == "expression":
        if t.get("scalar"):
            ok = con.execute(f"SELECT coalesce(({t['sql']}), false)").fetchone()[0]
            return bool(ok), "holds" if ok else "doesn't hold"
        n = con.execute(f"SELECT count(*) FROM {tbl} WHERE NOT coalesce(({t['sql']}), false)").fetchone()[0]
        return n == 0, f"{n} row{'s' if n != 1 else ''} break it" if n else "holds on every row"
    raise ValueError(f"unknown test type {kind!r}")


def age_text(hours):
    if hours < 1:
        return "under an hour old"
    if hours < 48:
        return f"{hours:.0f} hours old"
    return f"{hours / 24:.0f} days old"


def run_checks(con, models, sources, started, pages, snapshot):
    """Every check, the tables' freshness, and which checks each piece reads."""
    by_source = {s["name"]: s for s in sources}
    nodes = models["nodes"]
    checks, tables, broken = [], {}, []

    def add(check_id, node, name, passed, detail, status=None, piece=None):
        checks.append({"id": check_id, "node": node, "name": name,
                       "status": status or ("pass" if passed else "fail"), "detail": detail,
                       **({"piece": piece} if piece else {})})

    actual = {r[0]: r[1] for r in con.execute(
        "SELECT table_name, list(column_name ORDER BY column_index) FROM duckdb_columns() "
        "WHERE schema_name = 'main' GROUP BY 1").fetchall()}

    for name, node in nodes.items():
        if node.get("layer") != "mart":
            continue
        fresh = node.get("freshness")
        source = by_source.get(fresh["from"] if fresh else "site_pages", {})
        as_of = source.get("as_of")
        if name not in actual:
            if source.get("status") == "failed":
                tables[name] = {"as_of": None, "rows": 0}
                add(f"{name}.built", name, "the table was built", False,
                    f"not built this run: {source['detail']}")
            else:
                broken.append(f"models.json describes {name}, but no such table was built")
            continue
        rows = con.execute(f"SELECT count(*) FROM {ident(name)}").fetchone()[0]
        tables[name] = {"as_of": as_of, "rows": rows}

        described = set(node.get("columns", {}))
        missing = [c for c in actual[name] if c not in described]
        extra = sorted(described - set(actual[name]))
        detail = ("undescribed: " + ", ".join(missing)) if missing else (
            ("described but gone: " + ", ".join(extra)) if extra else f"{len(actual[name])} columns described")
        add(f"{name}.documented", name, "every column is described", not missing and not extra, detail)

        seen = set()
        for t in node.get("tests", []):
            if t["type"] == "freshness":
                if not fresh:
                    broken.append(f"{name}: a freshness test needs a freshness block")
                    continue
                label = f"updated within {fresh['max_hours']} hours"
                when = parse_iso(as_of) if as_of else None
                if when is None:
                    add(f"{name}.freshness", name, label, False, "no successful pull yet")
                else:
                    hours = (started - when).total_seconds() / 3600
                    add(f"{name}.freshness", name, label, hours <= fresh["max_hours"], age_text(hours))
                continue
            label = describe_test(t)
            check_id = f"{name}.{t['type']}" + (f"_{slug('_'.join(t['columns']))}" if t["type"] == "unique" else "")
            if t["type"] == "expression":
                check_id = f"{name}.{slug(t['name'])}"
            while check_id in seen:
                check_id += "_"
            seen.add(check_id)
            try:
                passed, detail = run_test(con, name, t)
                add(check_id, name, label, passed, detail)
            except (duckdb.Error, ValueError, KeyError) as err:
                add(check_id, name, label, False, f"the test itself failed: {err}", status="error")
                broken.append(f"{check_id}: {err}")

    # The captions: each default query still returns what its page shows.
    snapshot_tables = captions.snapshot_tables()
    pieces = {}
    for piece, spec in models["pieces"].items():
        unknown = [t for t in spec["tables"] if t not in tables]
        if unknown:
            broken.append(f"piece {piece} reads unknown table(s): {', '.join(unknown)}")
            continue
        try:
            where = f"{spec['page']}: the SQL source for {spec['label']}"
            if piece in captions.TABLE_SOURCES:
                err = (captions.check_table_source(con, pages, piece) if pages is not None
                       else "the pages couldn't be parsed this run (see the site_pages source)")
                label = f"{where} returns exactly what the page shows"
            elif piece in captions.LIVE_SOURCES:
                err = captions.check_live_source(con, snapshot or {}, snapshot_tables, piece)
                label = f"{where} returns the snapshot's numbers"
            else:
                broken.append(f"piece {piece} has no SQL source caption")
                continue
        except duckdb.Error as e:
            err = str(e)
        add(f"{piece}.matches_page", spec["tables"][0], label, err is None,
            "matches" if err is None else err.split("\n")[0], piece=piece)
        ids = [c["id"] for c in checks if c["node"] in spec["tables"] and c.get("piece") in (None, piece)]
        as_ofs = [tables[t]["as_of"] for t in spec["tables"]]
        pieces[piece] = {"as_of": min((a for a in as_ofs if a), default=None)
                         if all(as_ofs) else None, "checks": ids}
    captioned = set(captions.TABLE_SOURCES) | set(captions.LIVE_SOURCES)
    for piece in sorted(captioned - set(models["pieces"])):
        broken.append(f"SQL source caption {piece} has no entry under pieces in models.json")
    return checks, tables, pieces, broken


def validate(models):
    nodes, problems = models["nodes"], []
    for name, node in nodes.items():
        if node.get("layer") not in ("raw", "staging", "mart"):
            problems.append(f"{name}: layer must be raw, staging or mart")
        for up in node.get("upstream", []):
            if up not in nodes:
                problems.append(f"{name}: upstream {up!r} isn't a node")
        if node.get("layer") != "raw" and not node.get("upstream"):
            problems.append(f"{name}: a {node.get('layer')} node needs an upstream")
    return problems


# ── 4. Log ──
def commit_sha():
    sha = os.environ.get("GITHUB_SHA")
    if not sha:
        try:
            sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True,
                                 text=True, check=True).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            sha = ""
    return sha[:7] or None


def trigger():
    return {"schedule": "nightly", "workflow_dispatch": "manual", "push": "after a merge",
            "pull_request": "pull request"}.get(os.environ.get("GITHUB_EVENT_NAME", ""), "local")


def summary_markdown(run):
    lines = [f"### Data run: {run['passed']} of {run['total']} checks passed", "",
             "| Source | Status | Detail |", "|---|---|---|"]
    lines += [f"| {s['name']} | {s['status']} | {s['detail']} |" for s in run["sources"]]
    failed = [c for c in run["checks"] if c["status"] != "pass"]
    if failed:
        lines += ["", "| Failed check | Detail |", "|---|---|"]
        lines += [f"| {c['node']}: {c['name']} | {c['detail']} |" for c in failed]
    return "\n".join(lines) + "\n"


def main():
    dry = "--dry-run" in sys.argv
    offline = "--offline" in sys.argv
    started = now_utc()
    models = read_json(MODELS)
    if not isinstance(models, dict):
        sys.exit("data/pipeline/models.json is missing or isn't valid JSON")
    broken = validate(models)

    sources, writes, data = extract(started, offline)
    con = load(data)
    checks, tables, pieces, more = run_checks(con, models, sources, started, data["pages"], data["snapshot"])
    broken += more
    finished = now_utc()

    passed = sum(c["status"] == "pass" for c in checks)
    run = {
        "id": iso(started), "started_at": iso(started), "finished_at": iso(finished),
        "seconds": round((finished - started).total_seconds(), 1),
        "trigger": trigger(), "commit": commit_sha(),
        "status": "passed" if passed == len(checks) else "failed",
        "passed": passed, "total": len(checks),
        "sources": sources, "tables": tables, "checks": checks, "pieces": pieces,
    }
    previous = read_json(RUN_LOG, {}) or {}
    history = [{"id": run["id"], "finished_at": run["finished_at"], "trigger": run["trigger"],
                "status": run["status"], "passed": passed, "total": len(checks),
                "failed": [c["id"] for c in checks if c["status"] != "pass"]}]
    history += [h for h in previous.get("history", []) if h.get("id") != run["id"]][:HISTORY - 1]
    log = {"_about": "Written by scripts/data_run.py on every data run. latest is the newest run in full; "
                     "history is the last 30 runs, newest first. /status and the SQL source trust badges read it.",
           "latest": run, "history": history}

    out = summary_markdown(run)
    print(out)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(out)
    if os.environ.get("GITHUB_ACTIONS"):
        for c in checks:
            if c["status"] != "pass":
                print(f"::warning title=Data check failed::{c['node']}: {c['name']} ({c['detail']})")

    if broken:
        sys.exit("Broken definitions (fix these before merging):\n  " + "\n  ".join(broken))
    if dry:
        print("dry run: nothing written")
        return
    writes[RUN_LOG] = dump(log)
    for path, text in writes.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    print("wrote " + ", ".join(str(p.relative_to(ROOT) if p.is_relative_to(ROOT) else p) for p in writes))


if __name__ == "__main__":
    main()
