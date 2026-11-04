"""Build the /catalog page (catalog.html) from the site's own definitions.

Everything on the page comes from the files the nightly data run tests
against, so the catalog can't drift from them:

  * data/pipeline/models.json: every table from raw to staging to mart, its
    owner, where it lives, its description, its columns and its tests, and
    which "SQL source" captions read it;
  * data/pipeline/metrics.json: the site's metrics and the site copy that
    quotes them;
  * the tables themselves, built in DuckDB the way the run builds them
    (data/console/site.sql, the fraud snapshot, data/pipeline/metrics.sql),
    for each column's type.

How fresh each table is changes every night, so it isn't in the HTML:
assets/catalog.js fills it in from data/pipeline/run-log.json.

catalog.html marks the generated part with a pair of comments:

    <!-- catalog -->
    ...generated...
    <!-- /catalog -->

    python3 scripts/build_catalog.py           # rewrite it
    python3 scripts/build_catalog.py --check   # exit 1 if it's stale

The hidden hunt table isn't in models.json, so it isn't here either; the
script refuses to publish a page that names it.
"""

import html
import json
import re
import sys
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_metrics as metric_defs  # noqa: E402
import build_sql_sources as captions  # noqa: E402
import data_run  # noqa: E402

ROOT = captions.ROOT
PAGE = ROOT / "catalog.html"
MARK = re.compile(r"(?P<indent>[ \t]*)<!-- catalog -->\n.*?<!-- /catalog -->", re.S)
HIDDEN = ("nest_box",)
SOURCE_NAMES = {"site_pages": "the site pages", "fraud_snapshot": "the fraud snapshot",
                "github": "the GitHub pull"}


def esc(s):
    return html.escape(str(s), quote=True)


def column_types():
    """{table: {column: type}} for every table the run builds."""
    con = duckdb.connect()
    con.execute(captions.site.OUT.read_text(encoding="utf-8"))
    snapshot = json.loads(captions.SNAPSHOT_JSON.read_text(encoding="utf-8"))
    captions.build_live_tables(con, snapshot, captions.snapshot_tables())
    gh = {k: v for k, v in json.loads(data_run.GITHUB_TABLES.read_text(encoding="utf-8")).items()
          if not k.startswith("_")}
    captions.build_live_tables(con, {}, gh)
    con.execute(metric_defs.OUT.read_text(encoding="utf-8"))
    out = {}
    for table, col, typ in con.execute(
            "SELECT table_name, column_name, data_type FROM duckdb_columns() "
            "WHERE schema_name = 'main' ORDER BY table_name, column_index").fetchall():
        out.setdefault(table, {})[col] = typ
    return out


def test_text(node, t):
    if t["type"] == "freshness":
        return f"updated within {node['freshness']['max_hours']} hours"
    return data_run.describe_test(t)


def node_link(name, nodes):
    node = nodes[name]
    text = f"<code>{esc(name)}</code>" if node["layer"] == "mart" else esc(node["label"])
    return f'<a href="#t-{esc(name)}">{text}</a>'


def upstream_chain(name, nodes):
    """Every node upstream of `name`, raw first."""
    seen, stack = [], list(nodes[name].get("upstream", []))
    while stack:
        n = stack.pop(0)
        if n not in seen:
            seen.append(n)
            stack.extend(nodes[n].get("upstream", []))
    order = {"raw": 0, "staging": 1, "mart": 2}
    return sorted(reversed(seen), key=lambda n: order[nodes[n]["layer"]])


def fact(label, value):
    return f'<div class="cat-fact"><dt>{esc(label)}</dt><dd>{value}</dd></div>'


def mart(name, node, models, types, ind):
    nodes = models["nodes"]
    fresh = node.get("freshness")
    max_hours = fresh["max_hours"] if fresh else data_run.SITE_MAX_HOURS
    source = SOURCE_NAMES.get(fresh["from"], fresh["from"]) if fresh else "the site pages"
    readers = [f"{esc(p['page'])}: {esc(p['label'])}" for p in models["pieces"].values()
               if name in p["tables"]]
    chain = " → ".join(node_link(n, nodes) for n in upstream_chain(name, nodes))
    facts = [
        fact("Owner", esc(node.get("owner", models["owner"]))),
        fact("Built from", chain),
        fact("Lives in", esc(node.get("where", ""))),
        fact("Freshness", f"Rebuilt every run; expected within {max_hours} hours of {esc(source)}"),
    ]
    if readers:
        facts.append(fact("Shown on", "; ".join(readers)))
    cols = []
    for col, desc in node.get("columns", {}).items():
        typ = types.get(name, {}).get(col, "")
        cols.append(f'{ind}            <li class="cat-col"><code class="cat-col__name">{esc(col)}</code>'
                    f'<span class="cat-col__type">{esc(typ)}</span>'
                    f'<span class="cat-col__desc">{esc(desc)}</span></li>')
    tests = [test_text(node, t) for t in node.get("tests", [])] + ["every column is described"]
    return "\n".join([
        f'{ind}<details class="cat-table" id="t-{esc(name)}">',
        f'{ind}    <summary class="cat-table__head"><code class="cat-table__name">{esc(name)}</code>'
        f'<span class="cat-table__fresh" data-cat-fresh="{esc(name)}" data-max-hours="{max_hours}" hidden></span>'
        f'<span class="cat-table__desc">{esc(node["description"])}</span></summary>',
        f'{ind}    <div class="cat-table__body">',
        f'{ind}        <dl class="cat-facts">' + "".join(facts) + '</dl>',
        f'{ind}        <ul class="cat-cols" aria-label="Columns of {esc(name)}">',
        *cols,
        f'{ind}        </ul>',
        f'{ind}        <p class="cat-tests">Tested for: {esc("; ".join(tests))}. '
        f'<a href="/status#t-{esc(name)}">Latest results</a>.</p>',
        f'{ind}    </div>',
        f'{ind}</details>',
    ])


def upstream_item(name, node, ind):
    return (f'{ind}<li class="cat-source" id="t-{esc(name)}">'
            f'<p class="cat-source__head"><span class="cat-layer">{esc(node["layer"])}</span> '
            f'<span class="cat-source__name">{esc(node["label"])}</span></p>'
            f'<p class="cat-source__desc">{esc(node["description"])}</p>'
            f'<p class="cat-source__where">{esc(node.get("where", ""))}</p></li>')


def metric_item(name, m, claims, ind):
    sig = f"{name}({', '.join(metric_defs.params(m))})"
    tables = []
    for table in m["tables"]:
        d = metric_defs.definition(m, table)
        tables.append(f"<code>{esc(table)}</code>" + ("" if d == metric_defs.definition(m) else
                                                       f" as <code>{esc(d)}</code>"))
    lines = [f'{ind}<li class="cat-metric" id="m-{esc(name)}">',
             f'{ind}    <p class="cat-metric__head"><span class="cat-metric__label">{esc(m["label"])}</span> '
             f'<code class="cat-metric__sig">{esc(sig)}</code></p>',
             f'{ind}    <p class="cat-metric__desc">{esc(m["description"])} '
             f'<code>{esc(metric_defs.definition(m))}</code>, on {", ".join(tables)}.</p>']
    for c in claims:
        where = " and ".join(data_run.PAGE_NAMES.get(p, p) for p in c["pages"])
        bound = (f"{data_run.pct(c['min'])}" if c["min"] == c["max"]
                 else f"{data_run.pct(c['min'])} to {data_run.pct(c['max'])}")
        lines.append(f'{ind}    <p class="cat-metric__claim">{esc(where)} quote it as '
                     f'&ldquo;{esc(c["quote"])}&rdquo;; the nightly run checks it stays {esc(bound)}.</p>')
    lines.append(f'{ind}</li>')
    return "\n".join(lines)


def build(indent):
    models = json.loads(captions.MODELS.read_text(encoding="utf-8"))
    defs = metric_defs.load()
    bad = data_run.validate(models) + metric_defs.problems(defs)
    if bad:
        sys.exit("can't build the catalog:\n  " + "\n  ".join(bad))
    types = column_types()
    nodes = models["nodes"]
    ind = indent + "    "
    marts = [n for n, v in nodes.items() if v["layer"] == "mart"]
    ups = [n for n, v in nodes.items() if v["layer"] != "mart"]
    out = [
        f'{indent}<section aria-labelledby="cat-tables" class="status-section">',
        f'{ind}<header class="section-head">',
        f'{ind}    <h2 class="section-head__title" id="cat-tables">Tables</h2>',
        f'{ind}    <span class="section-head__hint">{len(marts)} tables, each queryable in any SQL source</span>',
        f'{ind}</header>',
        f'{ind}<div class="cat-tables">',
        *[mart(n, nodes[n], models, types, ind + "    ") for n in marts],
        f'{ind}</div>',
        f'{indent}</section>',
        '',
        f'{indent}<section aria-labelledby="cat-metrics" class="status-section">',
        f'{ind}<header class="section-head">',
        f'{ind}    <h2 class="section-head__title" id="cat-metrics">Metrics</h2>',
        f'{ind}    <span class="section-head__hint">each is also a SQL macro</span>',
        f'{ind}</header>',
        f'{ind}<ul class="cat-metrics">',
        *[metric_item(n, m, [c for c in defs.get("claims", []) if c["metric"] == n], ind + "    ")
          for n, m in defs["metrics"].items()],
        f'{ind}</ul>',
        f'{indent}</section>',
        '',
        f'{indent}<section aria-labelledby="cat-sources" class="status-section">',
        f'{ind}<header class="section-head">',
        f'{ind}    <h2 class="section-head__title" id="cat-sources">Sources and staging</h2>',
        f'{ind}</header>',
        f'{ind}<ul class="cat-sources">',
        *[upstream_item(n, nodes[n], ind + "    ") for n in ups],
        f'{ind}</ul>',
        f'{indent}</section>',
    ]
    text = "\n".join(out)
    for word in HIDDEN:
        if word in text:
            sys.exit(f"the catalog would name {word}, which stays hidden: take it out of models.json")
    return text


def render(page):
    m = MARK.search(page)
    if not m:
        sys.exit("catalog.html has no <!-- catalog --> ... <!-- /catalog --> block")
    indent = m.group("indent")
    body = build(indent)
    return page[:m.start()] + f"{indent}<!-- catalog -->\n{body}\n{indent}<!-- /catalog -->" + page[m.end():]


def main():
    check = "--check" in sys.argv[1:]
    page = PAGE.read_text(encoding="utf-8")
    out = render(page)
    if check:
        if out != page:
            sys.exit("catalog.html is stale: run python3 scripts/build_catalog.py")
        print("catalog.html is current")
        return
    PAGE.write_text(out, encoding="utf-8")
    print("wrote catalog.html")


if __name__ == "__main__":
    main()
