"""Fill in the "SQL source" captions under the site's data-backed pieces.

Each caption is a collapsed <details> under a visual (the project cards, the
experience timeline, the toolkit, the /live charts...) that shows the SQL
behind it. The pages mark each caption's place with a pair of comments:

    <!-- sql-source: toolkit -->
    ...generated <details>...
    <!-- /sql-source -->

    python3 scripts/build_sql_sources.py          # rewrite the captions
    python3 scripts/build_sql_sources.py --check  # fail if a caption is stale
                                                  # or a query is wrong

Two kinds of source:

* Site tables. data/sql-sources/<name>.sql is a query over the site's own
  tables (data/console/site.sql, which scripts/build_console_data.py builds
  from index.html and projects.html). This script runs every query in DuckDB
  and fails unless it returns exactly the text the page shows, so a caption
  can never drift from what it sits under.
* /live. Each chart's caption is an excerpt of scripts/fraud-snapshot.sql,
  the read-only query that feeds data/fraud-snapshot.json: the shared `base`
  CTE, the chart's own CTE, and the entry of the final json_build_object
  that publishes it, rewritten as a select of its own. All three are cut
  from that file, so editing it and rerunning this script keeps the captions
  honest; the run fails if a CTE or entry it quotes is no longer there.

Nothing is written unless every query and excerpt checks out.

Needs the duckdb Python package (pip install duckdb).
"""

import html
import re
import sys
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_console_data as site  # noqa: E402  (the page parser and table builder)

ROOT = site.ROOT
SOURCES = ROOT / "data" / "sql-sources"
SNAPSHOT_SQL = ROOT / "scripts" / "fraud-snapshot.sql"
REPO = "https://github.com/lmansf/Portfolio2026/blob/main"
MARKER = re.compile(
    r"(?P<indent>[ \t]*)<!-- sql-source: (?P<name>[a-z0-9-]+) -->\n.*?<!-- /sql-source -->",
    re.S)

TABLES_NOTE = (f'Runs against <a href="{REPO}/data/console/site.sql" target="_blank" '
               'rel="noopener">the site&rsquo;s own tables</a>, built from these pages; '
               'a check fails the build if it stops returning what&rsquo;s shown.')
LIVE_NOTE = (f'Part of <a href="{REPO}/scripts/fraud-snapshot.sql" target="_blank" '
             'rel="noopener">the read-only query</a> that runs once a day on Supabase '
             'and publishes this page&rsquo;s totals.')


# ── What each page piece shows, read straight from the page ──
def featured_cards(doc, featured):
    return [(r["title"], r["eyebrow"], r["year"], r["summary"], r["tags"])
            for r in site.projects(doc) if r["featured"] == featured]


def project_cards(doc, featured):
    return [(r["title"], r["badge"], r["eyebrow"], r["year"], r["summary"], r["tags"])
            for r in site.projects(doc) if r["featured"] == featured]


def timeline(doc):
    rows = []
    for item in site.main_of(doc).find_all("li", "xp__item"):
        note = item.find(cls="xp__note")
        rows.append((
            site.own_text(item.find(cls="xp__role"), "xp__note"),
            note.clean_text().strip("()") if note else None,
            item.find(cls="xp__org").clean_text(),
            item.find(cls="xp__dates").clean_text(),
            item.find(cls="xp__desc").clean_text(),
        ))
    return rows


def toolkit(doc):
    return [(g.find(cls="toolkit__label").clean_text(),
             [c.clean_text() for c in g.find_all("li", "chip")])
            for g in site.main_of(doc).find_all(cls="toolkit__group")]


def now_strip(doc):
    vals = {r.find(cls="now__label").clean_text().lower(): r.find(cls="now__value").clean_text()
            for r in site.main_of(doc).find_all(cls="now__row")}
    return [(vals.get("now"), vals.get("building"), vals.get("latest"))]


def credentials(doc):
    return [(r["credential"], r["detail"]) for r in site.credentials(doc)]


# name -> (page, function giving the rows the page shows)
TABLE_SOURCES = {
    "now": ("index.html", now_strip),
    "featured": ("index.html", lambda d: featured_cards(d, True)),
    "experience": ("index.html", timeline),
    "credentials": ("index.html", credentials),
    "toolkit": ("index.html", toolkit),
    "projects-featured": ("projects.html", lambda d: project_cards(d, True)),
    "projects-more": ("projects.html", lambda d: project_cards(d, False)),
}

# name -> (CTEs to quote, the key of the final json_build_object entry that
# publishes the last of them)
LIVE_SOURCES = {
    "live-totals": (["base", "totals"], "totals"),
    "live-daily": (["base", "daily"], "daily"),
    "live-scores": (["base", "bins"], "score_bins"),
    "live-patterns": (["base", "patterns"], "patterns"),
}

# What each caption's accessible name says it belongs to (the visible text
# stays "SQL source").
LABELS = {
    "now": "the now strip",
    "featured": "the featured projects",
    "experience": "the experience timeline",
    "credentials": "the credentials",
    "toolkit": "the toolkit",
    "projects-featured": "the featured projects",
    "projects-more": "the more builds",
    "live-totals": "the last 30 days totals",
    "live-daily": "the fraud per day chart",
    "live-scores": "the score distribution chart",
    "live-patterns": "the catch rate by fraud pattern table",
}


# ── /live: cut CTEs and final-select entries out of fraud-snapshot.sql ──
def close_paren(text, start, what):
    """Index just past the ')' matching the '(' before `start`, skipping
    parentheses inside quoted strings and `--` comments."""
    depth, i, n = 1, start, len(text)
    while i < n:
        ch = text[i]
        if ch == "'":
            end = text.find("'", i + 1)
            while end != -1 and text[end + 1:end + 2] == "'":
                end = text.find("'", end + 2)
            if end == -1:
                sys.exit(f"{what}: unterminated string literal in scripts/fraud-snapshot.sql")
            i = end + 1
            continue
        if ch == '"':
            end = text.find('"', i + 1)
            if end == -1:
                sys.exit(f"{what}: unterminated quoted identifier in scripts/fraud-snapshot.sql")
            i = end + 1
            continue
        if text.startswith("--", i):
            end = text.find("\n", i)
            i = n if end == -1 else end + 1
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    sys.exit(f"{what}: unbalanced parentheses in scripts/fraud-snapshot.sql")


def snapshot_ctes(text):
    """Map CTE name -> its full `name as (...)` text, as written in the file."""
    ctes = {}
    for m in re.finditer(r"^(?:with )?([a-z_]+) as \(\n", text, re.M):
        end = close_paren(text, m.end(), f"CTE {m.group(1)}")
        start = m.start() + (5 if text[m.start():].startswith("with ") else 0)
        ctes[m.group(1)] = text[start:end]
    return ctes


def snapshot_entry(text, key, name):
    """The `(select ... from cte)` published under `key` in the final
    json_build_object, as `select ... as key from cte;`."""
    m = re.search(rf"^\s*'{re.escape(key)}', \(select ", text, re.M)
    if not m:
        sys.exit(f"{name}: no '{key}', (select ...) entry in scripts/fraud-snapshot.sql; "
                 "update LIVE_SOURCES in scripts/build_sql_sources.py")
    end = close_paren(text, m.end(), f"{name}: the '{key}' entry")
    inner = text[m.end() - len("select "):end - 1]
    tail = re.search(r"\s+from\s+([a-z_]+)\s*$", inner)
    if not tail:
        sys.exit(f"{name}: the '{key}' entry in scripts/fraud-snapshot.sql doesn't end in "
                 "`from <cte>`; update LIVE_SOURCES in scripts/build_sql_sources.py")
    expr, cte = inner[:tail.start()], tail.group(1)
    lines = expr.split("\n")
    if len(lines) > 1:
        cut = min(len(ln) - len(ln.lstrip(" ")) for ln in lines[1:] if ln.strip())
        lines[1:] = [(" " * 9 + ln[cut:]) if ln.strip() else ln for ln in lines[1:]]
        expr = "\n".join(lines)
    one_line = f"{expr} as {key} from {cte};"
    if len(lines) == 1 and len(one_line) <= 80:
        return one_line, cte
    return f"{expr} as {key}\nfrom {cte};", cte


def live_sql(name, text, ctes):
    names, key = LIVE_SOURCES[name]
    missing = [n for n in names if n not in ctes]
    if missing:
        sys.exit(f"{name}: no CTE named {', '.join(missing)} in scripts/fraud-snapshot.sql")
    final, cte = snapshot_entry(text, key, name)
    if cte != names[-1]:
        sys.exit(f"{name}: the '{key}' entry in scripts/fraud-snapshot.sql selects from "
                 f"{cte}, not {names[-1]}; update LIVE_SOURCES in scripts/build_sql_sources.py")
    body = ",\n".join(ctes[n] for n in names)
    return "with " + body + "\n" + final


# ── Site tables: run each query and compare with the page ──
def norm(v):
    if isinstance(v, (list, tuple)):
        return [norm(x) for x in v]
    return v


def check_table_sources(con, pages):
    errors = []
    for name, (page, shown) in TABLE_SOURCES.items():
        sql = (SOURCES / f"{name}.sql").read_text(encoding="utf-8")
        got = norm(con.execute(sql).fetchall())
        want = norm(shown(pages[page]))
        if got != want:
            errors.append(f"data/sql-sources/{name}.sql doesn't return what {page} shows:\n"
                          f"  query: {got!r}\n  page:  {want!r}")
    return errors


# ── HTML ──
def caption(name, sql, note, indent):
    code = html.escape(sql.strip("\n"), quote=False)
    label = html.escape(f"SQL source for {LABELS[name]}")
    lines = [
        '<details class="sql-src">',
        f'    <summary class="sql-src__toggle" aria-label="{label}">SQL source</summary>',
        '    <div class="sql-src__panel">',
        f'        <pre class="sql-src__code" tabindex="0"><code>{code}</code></pre>',
        f'        <p class="sql-src__note">{note}</p>',
        '    </div>',
        '</details>',
    ]
    # Only the tag lines get the indent: the <pre> content must stay verbatim.
    out, in_pre = [], False
    for ln in "\n".join(lines).split("\n"):
        out.append(ln if in_pre else indent + ln)
        if "<pre" in ln and "</pre>" not in ln:
            in_pre = True
        elif "</pre>" in ln:
            in_pre = False
    return "\n".join(out)


def render(page_text, sources):
    seen = []

    def sub(m):
        name, indent = m.group("name"), m.group("indent")
        if name not in sources:
            sys.exit(f"unknown sql-source {name!r}")
        seen.append(name)
        sql, note = sources[name]
        return (f"{indent}<!-- sql-source: {name} -->\n{caption(name, sql, note, indent)}\n"
                f"{indent}<!-- /sql-source -->")

    return MARKER.sub(sub, page_text), seen


def main():
    check = "--check" in sys.argv
    pages = {p: site.parse(ROOT / p) for p in ("index.html", "projects.html")}
    con = duckdb.connect()
    con.execute(site.build())
    errors = check_table_sources(con, pages)

    snap = SNAPSHOT_SQL.read_text(encoding="utf-8")
    ctes = snapshot_ctes(snap)
    sources = {n: ((SOURCES / f"{n}.sql").read_text(encoding="utf-8"), TABLES_NOTE)
               for n in TABLE_SOURCES}
    sources.update({n: (live_sql(n, snap, ctes), LIVE_NOTE) for n in LIVE_SOURCES})
    unlabeled = sorted(set(sources) - set(LABELS))
    if unlabeled:
        sys.exit("no LABELS entry in scripts/build_sql_sources.py for: " + ", ".join(unlabeled))

    used, rendered = [], {}
    for page in ("index.html", "projects.html", "live.html"):
        path = ROOT / page
        before = path.read_text(encoding="utf-8")
        after, seen = render(before, sources)
        used += seen
        if after != before:
            rendered[path] = after
    unused = sorted(set(sources) - set(used))
    if unused:
        errors.append("no caption on any page for: " + ", ".join(unused))
    dupes = sorted({n for n in used if used.count(n) > 1})
    if dupes:
        errors.append("more than one caption for: " + ", ".join(dupes))

    if errors:
        sys.exit("\n".join(errors) + "\n(nothing was written)")
    stale = [p.name for p in rendered]
    if check:
        if stale:
            sys.exit("SQL source captions are out of date in " + ", ".join(stale)
                     + ": run python3 scripts/build_sql_sources.py")
        print(f"{len(used)} SQL source captions are current, and every site-table query returns what its page shows")
    else:
        for path, after in rendered.items():
            path.write_text(after, encoding="utf-8")
        print("updated " + (", ".join(stale) if stale else "nothing") + f" ({len(used)} captions)")


if __name__ == "__main__":
    main()
