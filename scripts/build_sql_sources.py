"""Fill in the "SQL source" captions under the site's data-backed pieces.

Each caption is a collapsed <details> under a visual (the project cards, the
experience timeline, the toolkit, the /live charts...) holding the query
that produces that piece's text. assets/sql-source.js turns it into an
editor: a visitor can change the query, run it in the browser with DuckDB,
and the piece redraws from the result. The pages mark each caption's place
with a pair of comments, and the piece itself with data-sql-piece:

    <div class="toolkit" data-sql-piece="toolkit">...</div>
    <!-- sql-source: toolkit -->
    ...generated <details>...
    <!-- /sql-source -->

    python3 scripts/build_sql_sources.py          # rewrite the captions
    python3 scripts/build_sql_sources.py --check  # fail if a caption is stale
                                                  # or a query is wrong

The default query for each caption is data/sql-sources/<name>.sql, and the
page's own HTML is that query's result, rendered ahead of time so it reads
the same for crawlers and without JavaScript. This script proves it:

* Site tables. The query runs over the site's own tables
  (data/console/site.sql, which scripts/build_console_data.py builds from
  index.html and projects.html) and must return exactly the text the page
  shows.
* /live. The query runs over the fraud_* tables described in
  data/console/snapshot-tables.json, built from data/fraud-snapshot.json the
  same way the browser builds them, and must return that snapshot's numbers.
  Each /live caption also quotes, in a nested <details>, the part of
  scripts/fraud-snapshot.sql (the read-only Supabase query that writes the
  snapshot) behind the piece: the shared `base` CTE, the piece's own CTE,
  and the entry of the final json_build_object that publishes it. Those are
  cut from that file, and the run fails if one is no longer there.

Each caption also needs exactly one data-sql-piece with its name on its page.
Nothing is written unless every query and excerpt checks out.

Needs the duckdb Python package (pip install duckdb).
"""

import html
import json
import re
import sys
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_console_data as site  # noqa: E402  (the page parser and table builder)

ROOT = site.ROOT
SOURCES = ROOT / "data" / "sql-sources"
SNAPSHOT_SQL = ROOT / "scripts" / "fraud-snapshot.sql"
SNAPSHOT_JSON = ROOT / "data" / "fraud-snapshot.json"
SNAPSHOT_TABLES = ROOT / "data" / "console" / "snapshot-tables.json"
MODELS = ROOT / "data" / "pipeline" / "models.json"
REPO = "https://github.com/lmansf/Portfolio2026/blob/main"
MARKER = re.compile(
    r"(?P<indent>[ \t]*)<!-- sql-source: (?P<name>[a-z0-9-]+) -->\n.*?<!-- /sql-source -->",
    re.S)

TABLES_NOTE = (f'This query writes what&rsquo;s shown above, from <a href="{REPO}/data/console/site.sql" '
               'target="_blank" rel="noopener">the site&rsquo;s own tables</a>; a check fails the '
               'build if it ever stops matching.')
LIVE_NOTE = ('This query writes what&rsquo;s shown above, from the same aggregates-only snapshot '
             'the page draws; a check fails the build if it ever stops matching.')
UPSTREAM_SUMMARY = "Where the numbers come from"
UPSTREAM_NOTE = (f'Part of <a href="{REPO}/scripts/fraud-snapshot.sql" target="_blank" '
                 'rel="noopener">the read-only query</a> that runs once a day on Supabase '
                 'and publishes the snapshot.')


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

# name -> (the upstream CTEs to quote, the key of the final json_build_object
# entry that publishes the last of them). The key is also the snapshot field
# the default query has to reproduce.
LIVE_SOURCES = {
    "live-totals": (["base", "totals"], "totals"),
    "live-daily": (["base", "daily"], "daily"),
    "live-scores": (["base", "bins"], "score_bins"),
    "live-patterns": (["base", "patterns"], "patterns"),
}

# Every caption's piece, as data/pipeline/models.json describes it: the
# tables it reads (for its lineage and its /status link) and what its
# accessible name says it belongs to (the visible text stays "SQL source").
def load_models():
    return json.loads(MODELS.read_text(encoding="utf-8"))


MODEL = load_models()
LABELS = {name: spec["label"] for name, spec in MODEL["pieces"].items()}


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


# ── /live: the fraud_* tables, built from the snapshot like the browser does ──
def snapshot_tables():
    return {k: v for k, v in json.loads(SNAPSHOT_TABLES.read_text(encoding="utf-8")).items()
            if not k.startswith("_")}


def build_live_tables(con, snapshot, tables):
    for name, spec in tables.items():
        cols = spec["columns"]
        con.execute(f"CREATE TABLE {name} ("
                    + ", ".join(f"{c[0]} {c[1]}" for c in cols) + ")")
        part = snapshot.get(spec["snapshot"])
        rows = ([part] if part else []) if spec.get("one_row") else (part or [])
        for r in rows:
            con.execute(f"INSERT INTO {name} VALUES (" + ", ".join("?" * len(cols)) + ")",
                        [r.get(c[2] if len(c) > 2 else c[0]) for c in cols])


def check_live_source(con, snapshot, tables, name):
    """None if the /live caption's default query returns the snapshot's numbers, else why not."""
    key = LIVE_SOURCES[name][1]
    spec = next((s for s in tables.values() if s["snapshot"] == key), None)
    if spec is None:
        return f"{name}: no table in data/console/snapshot-tables.json reads the snapshot's {key!r}"
    rename = {c[0]: (c[2] if len(c) > 2 else c[0]) for c in spec["columns"]}
    cur = con.execute((SOURCES / f"{name}.sql").read_text(encoding="utf-8"))
    cols = [rename.get(d[0], d[0]) for d in cur.description]
    got = [dict(zip(cols, r)) for r in cur.fetchall()]
    part = snapshot.get(key)
    if part is None:
        return (f"{name}: data/fraud-snapshot.json has no {key!r}; the fraud-snapshot workflow's "
                f"jq allow-list and data/console/snapshot-tables.json must name the same fields")
    want = [{c: r.get(c) for c in cols} for r in ([part] if spec.get("one_row") else part)]
    got = [{c: (v.isoformat() if hasattr(v, "isoformat") else v) for c, v in r.items()} for r in got]
    if got != want:
        return (f"data/sql-sources/{name}.sql doesn't return the snapshot's {key}:\n"
                f"  query:    {got[:3]!r}\n  snapshot: {want[:3]!r}")
    return None


def check_live_sources(con, snapshot, tables):
    return [e for e in (check_live_source(con, snapshot, tables, n) for n in LIVE_SOURCES) if e]


# ── Site tables: run each query and compare with the page ──
def norm(v):
    if isinstance(v, (list, tuple)):
        return [norm(x) for x in v]
    return v


def check_table_source(con, pages, name):
    """None if the caption's default query returns exactly what its page shows, else why not."""
    page, shown = TABLE_SOURCES[name]
    sql = (SOURCES / f"{name}.sql").read_text(encoding="utf-8")
    got = norm(con.execute(sql).fetchall())
    want = norm(shown(pages[page]))
    if got != want:
        return (f"data/sql-sources/{name}.sql doesn't return what {page} shows:\n"
                f"  query: {got!r}\n  page:  {want!r}")
    return None


def check_table_sources(con, pages):
    return [e for e in (check_table_source(con, pages, n) for n in TABLE_SOURCES) if e]


# ── HTML ──
def status_link(name):
    """A link to the /status group holding this caption's checks (its first table in models.json)."""
    table = MODEL["pieces"][name]["tables"][0]
    return f' <a href="/status#t-{html.escape(table)}">See its checks</a>.'


def lineage(name):
    """The piece's path from raw to mart, from models.json: every node upstream of
    its tables, grouped by layer, as a small ordered list. Each step links to
    its entry in the data catalog (/catalog, scripts/build_catalog.py)."""
    nodes = MODEL["nodes"]
    seen, stack = [], list(MODEL["pieces"][name]["tables"])
    while stack:
        n = stack.pop(0)
        if n in seen:
            continue
        if n not in nodes:
            sys.exit(f"{name}: lineage names {n!r}, which isn't a node in data/pipeline/models.json")
        seen.append(n)
        stack.extend(nodes[n].get("upstream", []))
    steps = []
    for layer in ("raw", "staging", "mart"):
        for n in reversed(seen):
            node = nodes[n]
            if node["layer"] != layer:
                continue
            text = (f'<code>{html.escape(n)}</code>' if layer == "mart"
                    else html.escape(node["label"]))
            where = html.escape(node.get("where", ""))
            steps.append(f'<li class="sql-src__step"><span class="sql-src__layer">{layer}</span> '
                         f'<a class="sql-src__node" href="/catalog#t-{html.escape(n)}" title="{where}">{text}</a></li>')
    return ('<ol class="sql-src__lineage" aria-label="Lineage, from raw source to the table this query reads">'
            + "".join(steps) + '</ol>')


def caption(name, sql, note, indent, upstream=None):
    code = html.escape(sql.strip("\n"), quote=False)
    label = html.escape(f"SQL source for {LABELS[name]}")
    # The trust badge is filled in the browser from data/pipeline/trust.json
    # (it says how long ago the nightly run checked this piece), so the page
    # HTML doesn't change from one night to the next.
    lines = [
        f'<details class="sql-src" data-sql-source="{name}" data-sql-label="{html.escape(LABELS[name])}">',
        f'    <summary class="sql-src__toggle" aria-label="{label}">SQL source'
        '<span class="sql-src__trust" data-sql-trust hidden></span></summary>',
        '    <div class="sql-src__panel">',
        f'        <pre class="sql-src__code" tabindex="0"><code>{code}</code></pre>',
        f'        {lineage(name)}',
        f'        <p class="sql-src__note">{note}{status_link(name)}</p>',
    ]
    if upstream:
        up = html.escape(upstream.strip("\n"), quote=False)
        lines += [
            '        <details class="sql-src__upstream">',
            f'            <summary>{UPSTREAM_SUMMARY}</summary>',
            f'            <pre class="sql-src__code" tabindex="0"><code>{up}</code></pre>',
            f'            <p class="sql-src__note">{UPSTREAM_NOTE}</p>',
            '        </details>',
        ]
    lines += ['    </div>', '</details>']
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
        sql, note, upstream = sources[name]
        return (f"{indent}<!-- sql-source: {name} -->\n{caption(name, sql, note, indent, upstream)}\n"
                f"{indent}<!-- /sql-source -->")

    return MARKER.sub(sub, page_text), seen


def main():
    check = "--check" in sys.argv
    pages = {p: site.parse(ROOT / p) for p in ("index.html", "projects.html")}
    con = duckdb.connect()
    con.execute(site.build())
    errors = check_table_sources(con, pages)

    tables = snapshot_tables()
    build_live_tables(con, json.loads(SNAPSHOT_JSON.read_text(encoding="utf-8")), tables)
    errors += check_live_sources(con, json.loads(SNAPSHOT_JSON.read_text(encoding="utf-8")), tables)

    snap = SNAPSHOT_SQL.read_text(encoding="utf-8")
    ctes = snapshot_ctes(snap)
    query = lambda n: (SOURCES / f"{n}.sql").read_text(encoding="utf-8")  # noqa: E731
    sources = {n: (query(n), TABLES_NOTE, None) for n in TABLE_SOURCES}
    sources.update({n: (query(n), LIVE_NOTE, live_sql(n, snap, ctes)) for n in LIVE_SOURCES})
    unlabeled = sorted(set(sources) - set(LABELS))
    if unlabeled:
        sys.exit("no entry under pieces in data/pipeline/models.json for: " + ", ".join(unlabeled))

    used, rendered = [], {}
    for page in ("index.html", "projects.html", "live.html"):
        path = ROOT / page
        before = path.read_text(encoding="utf-8")
        after, seen = render(before, sources)
        used += seen
        for name in seen:
            pieces = len(re.findall(rf'data-sql-piece="{re.escape(name)}"', before))
            if pieces != 1:
                errors.append(f"{page}: the {name} caption needs exactly one data-sql-piece=\"{name}\" "
                              f"to redraw (found {pieces})")
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
        print(f"{len(used)} SQL source captions are current, and every default query returns what its piece shows")
    else:
        for path, after in rendered.items():
            path.write_text(after, encoding="utf-8")
        print("updated " + (", ".join(stale) if stale else "nothing") + f" ({len(used)} captions)")


if __name__ == "__main__":
    main()
