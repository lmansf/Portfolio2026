"""Build data/console/site.sql, the site's own tables.

The tables (projects, experience, skills, credentials, resume) are read from
the pages themselves, so they can never say something the pages don't. The
"SQL source" captions query them (scripts/build_sql_sources.py checks that
each caption's query returns exactly what its page shows):

    python3 scripts/build_console_data.py          # rewrite site.sql
    python3 scripts/build_console_data.py --check  # fail if site.sql is stale

Sources: projects.html (every project card) and index.html (hero, "Now" rows,
contact buttons, experience timeline, credentials, toolkit, footer brand).
Rerun after editing either page. Standard library only. (The "console" in the
name and path is left over from the retired SQL console.)

If data/console/extra.sql exists, its statements are appended verbatim after
the generated tables: that is the hook for tables that don't come from the
pages (today the nest-box hunt, docs/egg-codes.md). It's the only
hand-written SQL in site.sql, and --check covers it too.
"""

import html
import re
import sys
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "console" / "site.sql"
SITE = "https://loganmansfield.org"
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}


# ── A tiny DOM: enough to find elements by class and read their text ──
class Node:
    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent = tag, dict(attrs), parent
        self.children = []

    @property
    def classes(self):
        return (self.attrs.get("class") or "").split()

    def text(self):
        out = []
        for c in self.children:
            out.append(c if isinstance(c, str) else c.text())
        return "".join(out)

    def clean_text(self):
        return re.sub(r"\s+", " ", self.text()).strip()

    def walk(self):
        for c in self.children:
            if isinstance(c, Node):
                yield c
                yield from c.walk()

    def find_all(self, tag=None, cls=None):
        return [n for n in self.walk()
                if (tag is None or n.tag == tag) and (cls is None or cls in n.classes)]

    def find(self, tag=None, cls=None):
        found = self.find_all(tag, cls)
        return found[0] if found else None

    def ancestor(self, cls):
        n = self.parent
        while n is not None:
            if cls in n.classes:
                return n
            n = n.parent
        return None


class Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root", {}, None)
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def parse(path):
    b = Builder()
    b.feed(path.read_text(encoding="utf-8"))
    return b.root


def main_of(doc):
    return doc.find("main")


# ── Extractors ──
def own_text(node, skip_cls):
    """Text of a node without the children carrying skip_cls (e.g. a badge)."""
    out = []
    for c in node.children:
        if isinstance(c, str):
            out.append(c)
        elif skip_cls not in c.classes:
            out.append(c.text())
    return re.sub(r"\s+", " ", "".join(out)).strip()


def link_url(href, page):
    href = href.strip()
    if href.startswith("#"):
        return page + href
    return href


def projects(doc):
    rows = []
    for order, art in enumerate(main_of(doc).find_all("article", "project"), start=1):
        title_el = art.find(cls="project__title")
        badge = art.find(cls="project__badge")
        links = []
        for a in art.find_all("a", "project__link"):
            label = re.sub(r"\s*[↗→]\s*$", "", a.clean_text())
            links.append((label, link_url(a.attrs.get("href", ""), "/projects")))
        rows.append({
            "slug": art.attrs.get("id"),
            "title": own_text(title_el, "project__badge"),
            "badge": badge.clean_text() if badge else None,
            "eyebrow": art.find(cls="project__eyebrow").clean_text(),
            "year": int(art.find(cls="project__date").clean_text()),
            "featured": "project--featured" in art.classes,
            "status": "archived" if "project--archived" in art.classes else "active",
            "summary": art.find(cls="project__desc").clean_text(),
            "tags": [li.clean_text() for li in art.find(cls="project__tags").find_all("li")],
            "links": links,
            "sort_order": order,
        })
    return rows


def month_start(text):
    m = re.match(r"([A-Za-z]{3})[a-z]*\s+(\d{4})", text.strip())
    if not m:
        return None
    return date(int(m.group(2)), MONTHS[m.group(1).lower()], 1)


def experience(doc):
    rows = []
    for item in main_of(doc).find_all("li", "xp__item"):
        role_el = item.find(cls="xp__role")
        note = item.find(cls="xp__note")
        dates = item.find(cls="xp__dates").clean_text()
        start_txt, end_txt = re.split(r"\s*[–-]\s*", dates, maxsplit=1)
        org, _, place = item.find(cls="xp__org").clean_text().partition(" · ")
        current = end_txt.strip().lower() == "present"
        rows.append({
            "role": own_text(role_el, "xp__note"),
            "note": note.clean_text().strip("()") if note else None,
            "org": org,
            "location": place or None,
            "started": month_start(start_txt),
            "ended": None if current else month_start(end_txt),
            "is_current": current,
            "summary": item.find(cls="xp__desc").clean_text(),
            "sort_order": len(rows) + 1,
        })
    return rows


def skills(doc):
    rows = []
    for group in main_of(doc).find_all(cls="toolkit__group"):
        category = group.find(cls="toolkit__label").clean_text()
        for chip in group.find_all("li", "chip"):
            rows.append({"skill": chip.clean_text(), "category": category, "sort_order": len(rows) + 1})
    return rows


def credentials(doc):
    rows = []
    for chip in main_of(doc).find_all("li", "chip--cred"):
        sub = chip.find(cls="chip__sub")
        rows.append({"credential": own_text(chip, "chip__sub"), "detail": sub.clean_text() if sub else None,
                     "sort_order": len(rows) + 1})
    return rows


def resume(doc):
    main = main_of(doc)
    name = main.find(cls="hero__name").clean_text().rstrip(".")
    # The hero's first clause ("Data analyst moving into analytics
    # engineering: I build…"), with inline tags such as <em> flattened.
    headline = main.find(cls="hero__role").clean_text().split(":", 1)[0].strip()
    # The footer brand reads "Logan Mansfield · Tampa, FL".
    _, _, location = doc.find(cls="footer-brand").clean_text().partition(" · ")
    now = {}
    for row in main.find_all(cls="now__row"):
        now[row.find(cls="now__label").clean_text().lower()] = row.find(cls="now__value").clean_text()
    links = {}
    for a in main.find(cls="contact-row").find_all("a"):
        href = a.attrs.get("href", "")
        if href.startswith("mailto:"):
            links["email"] = href[len("mailto:"):]
        elif "linkedin.com" in href:
            links["linkedin"] = href
        elif "github.com" in href:
            links["github"] = href
        elif href.endswith(".pdf"):
            links["resume_pdf"] = href
    return [{
        "name": name,
        "headline": headline,
        "now": now.get("now"),
        "building": now.get("building"),
        "latest": now.get("latest"),
        "location": location.strip() or None,
        "email": links.get("email"),
        "linkedin": links.get("linkedin"),
        "github": links.get("github"),
        "resume_pdf": links.get("resume_pdf"),
        "site": SITE,
    }]


# ── SQL writing ──
def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, date):
        return f"DATE '{v.isoformat()}'"
    if isinstance(v, list):
        if v and isinstance(v[0], tuple):
            return "[" + ", ".join(
                "{'label': " + lit(a) + ", 'url': " + lit(b) + "}" for a, b in v) + "]"
        return "[" + ", ".join(lit(x) for x in v) + "]"
    return "'" + str(v).replace("'", "''") + "'"


def table_sql(name, comment, columns, rows):
    cols = ",\n    ".join(f"{c} {t}" for c, t in columns)
    lines = [f"-- {comment}", f"CREATE TABLE {name} (\n    {cols}\n);"]
    if rows:
        vals = ",\n".join("    (" + ", ".join(lit(r[c]) for c, _ in columns) + ")" for r in rows)
        lines.append(f"INSERT INTO {name} VALUES\n{vals};")
    return "\n".join(lines)


SCHEMAS = {
    "projects": ("One row per project card on /projects.", [
        ("slug", "VARCHAR"), ("title", "VARCHAR"), ("badge", "VARCHAR"), ("eyebrow", "VARCHAR"),
        ("year", "INTEGER"), ("featured", "BOOLEAN"), ("status", "VARCHAR"), ("summary", "VARCHAR"),
        ("tags", "VARCHAR[]"), ("links", "STRUCT(label VARCHAR, url VARCHAR)[]"), ("sort_order", "INTEGER")]),
    "experience": ("One row per role, newest first on the page.", [
        ("role", "VARCHAR"), ("note", "VARCHAR"), ("org", "VARCHAR"), ("location", "VARCHAR"),
        ("started", "DATE"), ("ended", "DATE"), ("is_current", "BOOLEAN"), ("summary", "VARCHAR"),
        ("sort_order", "INTEGER")]),
    "skills": ("The toolkit on the home page, one row per skill.", [
        ("skill", "VARCHAR"), ("category", "VARCHAR"), ("sort_order", "INTEGER")]),
    "credentials": ("Certifications and workshops.", [
        ("credential", "VARCHAR"), ("detail", "VARCHAR"), ("sort_order", "INTEGER")]),
    "resume": ("One row: who I am and where to reach me.", [
        ("name", "VARCHAR"), ("headline", "VARCHAR"), ("now", "VARCHAR"), ("building", "VARCHAR"),
        ("latest", "VARCHAR"), ("location", "VARCHAR"), ("email", "VARCHAR"), ("linkedin", "VARCHAR"),
        ("github", "VARCHAR"), ("resume_pdf", "VARCHAR"), ("site", "VARCHAR")]),
}


def build():
    home = parse(ROOT / "index.html")
    proj = parse(ROOT / "projects.html")
    data = {
        "projects": projects(proj),
        "experience": experience(home),
        "skills": skills(home),
        "credentials": credentials(home),
        "resume": resume(home),
    }
    parts = [
        "-- Generated by scripts/build_console_data.py from index.html and projects.html.",
        "-- Do not edit by hand: change the pages, then rerun the script.",
        "",
    ]
    for name, (comment, columns) in SCHEMAS.items():
        parts.append(table_sql(name, comment, columns, data[name]))
        parts.append("")
    extra = ROOT / "data" / "console" / "extra.sql"
    if extra.exists():
        parts.append(extra.read_text(encoding="utf-8").rstrip())
        parts.append("")
    return "\n".join(parts)


if __name__ == "__main__":
    sql = build()
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != sql:
            sys.exit("data/console/site.sql is out of date: run python3 scripts/build_console_data.py")
        print("site.sql is current")
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(sql, encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)} ({len(sql):,} bytes)")
