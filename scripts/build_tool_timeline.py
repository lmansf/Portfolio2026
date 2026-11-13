"""Draw Home's "Tools over time" chart from data/tool-timeline.json.

The chart is plain HTML and CSS (styles under "Tools over time" in
assets/pages.css), written into index.html between a pair of comments:

    <!-- tool-timeline -->
    ...generated <figure> and its data-source table...
    <!-- /tool-timeline -->

Each tool is a lane with its own color, years run down the page in soft
bands, and each span of use is a box: solid for paid work, outlined for
personal projects (each span's "use"). Hovering a box shows its dates, how
it was used and the projects built with it (its "built" list, each checked
against the project titles on projects.html so nothing is made up). The
chart never states a length of experience. Roles and credentials sit on a
rail to the right; milestones that share a date share one entry.
assets/motion.js plays the chart in once when it scrolls into view (boxes
grow in start order, the rail lights up, each step keyed by its --i);
without it, or with reduced motion or text mode, the chart is simply drawn.

    python3 scripts/build_tool_timeline.py          # rewrite the block
    python3 scripts/build_tool_timeline.py --check  # fail if it is stale

The output depends only on the JSON (its "through" month is the chart's
"Now"), never on today's date, so the check is stable in CI.
"""

import html
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "tool-timeline.json"
PAGE = ROOT / "index.html"
PROJECTS = ROOT / "projects.html"
USES = {"work": "Paid work", "projects": "Personal projects"}
REPO = "https://github.com/lmansf/Portfolio2026/blob/main"
MARKER = re.compile(r"(?P<indent>[ \t]*)<!-- tool-timeline -->\n.*?<!-- /tool-timeline -->", re.S)
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Rail label layout, in months of chart height, once for narrow screens
# and once from 960px up (pages.css switches between them). Each is
# (months a text line takes, months a credential line takes, gap between
# labels, characters before a label wraps). Tune these with the CSS if the
# rail's sizes change.
LAYOUTS = {"lab": (2.9, 3.4, 1.6, 15), "lab-w": (2.7, 3.2, 1.6, 26)}

esc = html.escape


def parse(value):
    """'2019-08' -> (2019, 8); '2025' -> (2025, None)."""
    m = re.fullmatch(r"(\d{4})(?:-(\d{2}))?", value or "")
    if not m:
        raise SystemExit(f"tool-timeline.json: bad date {value!r} (use YYYY-MM or YYYY)")
    month = int(m[2]) if m[2] else None
    if month is not None and not 1 <= month <= 12:
        raise SystemExit(f"tool-timeline.json: bad month in {value!r}")
    return int(m[1]), month


def label(value):
    year, month = parse(value)
    return f"{MONTHS[month - 1]} {year}" if month else str(year)


def span_text(span):
    start, end = label(span["from"]), (label(span["to"]) if span["to"] else "now")
    return start if start == end else f"{start} – {end}"


def span_short(span):
    """The years only, as the box shows them: 2019–22, 2023–now, 2025."""
    a = parse(span["from"])[0]
    if span["to"] is None:
        return f"{a}–now"
    b = parse(span["to"])[0]
    return str(a) if a == b else f"{a}–{str(b)[2:]}"


def project_titles():
    """Project names as projects.html titles them (badges like "Live" left out)."""
    page = PROJECTS.read_text(encoding="utf-8")
    titles = set()
    for m in re.finditer(r'<h3 class="project__title">(.*?)</h3>', page, re.S):
        title = re.sub(r"<span[^>]*>.*?</span>", "", m[1], flags=re.S)
        titles.add(html.unescape(re.sub(r"\s+", " ", title)).strip())
    return titles


def use_text(span):
    """How a span was used, as the hover card and the table say it."""
    text = USES[span["use"]]
    if span.get("note"):
        text += f", {span['note'][0].lower()}{span['note'][1:]}"
    return text


def pct(v, total):
    return f"{v / total * 100:.3f}".rstrip("0").rstrip(".") + "%"


def num(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def build_block(data, indent):
    y0 = int(data["start"])
    ty, tm = parse(data["through"])
    if tm is None:
        raise SystemExit('tool-timeline.json: "through" needs a month (YYYY-MM)')
    total = (ty - y0) * 12 + tm  # end of the "through" month

    def start_of(v):
        y, m = parse(v)
        return (y - y0) * 12 + ((m - 1) if m else 0)

    def end_of(v):
        if v is None:
            return total
        y, m = parse(v)
        return (y - y0) * 12 + (m if m else 12)

    tools = data["tools"]
    lanes = len(tools)
    titles = project_titles()
    boxes = []
    for lane, tool in enumerate(tools):
        for span in tool["spans"]:
            if span.get("use") not in USES:
                raise SystemExit(f"tool-timeline.json: {tool['name']} span {span['from']} needs \"use\": "
                                 '"work" or "projects"')
            for name in span.get("built", []):
                if name not in titles:
                    raise SystemExit(f"tool-timeline.json: {tool['name']} lists {name!r} under \"built\", "
                                     "but projects.html has no project with that title")
            a, b = start_of(span["from"]), end_of(span["to"])
            if not 0 <= a < b <= total:
                raise SystemExit(f"tool-timeline.json: {tool['name']} span {span} is outside "
                                 f"{data['start']} to {data['through']} or ends before it starts")
            boxes.append({"lane": lane, "tool": tool, "span": span, "a": a, "b": b})

    # The order each span was picked up sets the play-in order (--i).
    order = sorted(boxes, key=lambda x: (x["a"], x["lane"]))
    for i, bx in enumerate(order):
        bx["i"] = i

    # Milestones: one rail entry per date, labels nudged apart so none overlap.
    groups = {}
    for ms in data["milestones"]:
        groups.setdefault(ms["date"], []).append(ms)
    rail = []
    for date, items in groups.items():
        y, m = parse(date)
        dot = (y - y0) * 12 + ((m - 1) + 0.5 if m else 6)
        if not 0 <= dot <= total:
            raise SystemExit(f"tool-timeline.json: milestone date {date} is off the chart")
        kinds = {i["kind"] for i in items}
        rail.append({"date": date, "items": items, "dot": dot,
                     "kind": "credential" if kinds == {"credential"} else "role"})
    rail.sort(key=lambda r: r["dot"])
    for key, (line, cred, gap, chars) in LAYOUTS.items():
        tops, heights = [], []
        for i, r in enumerate(rail):
            each = cred if r["kind"] == "credential" else line
            h = sum(math.ceil(len(it["label"]) / chars) for it in r["items"]) * each + line
            top = max(r["dot"] - line / 2, 0)
            if i:
                top = max(top, tops[-1] + heights[-1] + gap)
            tops.append(top)
            heights.append(h)
        for i in range(len(rail) - 1, -1, -1):
            limit = total if i == len(rail) - 1 else tops[i + 1] - gap
            tops[i] = max(min(tops[i], limit - heights[i]), 0)
        for r, top in zip(rail, tops):
            r[key] = top

    out = []
    w = out.append
    w(f'<figure class="tl" data-tool-timeline style="--tl-lanes: {lanes}; --tl-months: {total}">')
    w('    <ul class="tl__legend">')
    w('        <li class="tl__key tl__key--work">Paid work</li>')
    w('        <li class="tl__key tl__key--projects">Personal projects</li>')
    w('    </ul>')
    w('    <div class="tl__grid" aria-hidden="true">')
    w('        <div class="tl__heads">')
    for lane, tool in enumerate(tools):
        w(f'            <span class="tl__head tl--{esc(tool["id"])}" style="--lane: {lane}">{esc(tool["name"])}</span>')
    w('        </div>')
    w('        <div class="tl__axis">')
    for year in range(y0, ty + 1):
        a = (year - y0) * 12
        b = min(a + 12, total)
        if a < total:
            w(f'            <span class="tl__year" style="--at: {pct((a + b) / 2, total)}">{year}</span>')
    w('        </div>')
    w('        <div class="tl__plot">')
    for year in range(y0, ty + 1, 2):
        a = (year - y0) * 12
        if a < total:
            w(f'            <span class="tl__band" style="--top: {pct(a, total)}; --h: {pct(min(12, total - a), total)}"></span>')
    for bx in boxes:
        tool, span = bx["tool"], bx["span"]
        ongoing = span["to"] is None
        cls = f'tl__box tl__box--{span["use"]} tl--{esc(tool["id"])}' + (" tl__box--now" if ongoing else "")
        if bx["lane"] >= lanes / 2:
            cls += " tl__box--tip-left"
        w(f'            <span class="{cls}" style="--lane: {bx["lane"]}; --top: {pct(bx["a"], total)}; '
          f'--h: {pct(bx["b"] - bx["a"], total)}; --i: {bx["i"]}">')
        w(f'                <span class="tl__name">{esc(tool["name"])}</span>')
        w(f'                <span class="tl__years">{esc(span_short(span))}</span>')
        w('                <span class="tl__tip">')
        w(f'                    <span class="tl__tip-name">{esc(tool["name"])}</span>')
        w(f'                    <span class="tl__tip-when">{esc(span_text(span))}</span>')
        w(f'                    <span class="tl__tip-use">{esc(use_text(span))}</span>')
        if span.get("built"):
            w('                    <span class="tl__tip-built">Built with it:</span>')
            for name in span["built"]:
                w(f'                    <span class="tl__tip-item">{esc(name)}</span>')
        w('                </span>')
        w('            </span>')
    w('            <span class="tl__nowline"><span>Now</span></span>')
    w('        </div>')
    w('        <ol class="tl__rail">')
    for n, r in enumerate(rail):
        w(f'            <li class="tl__ms tl__ms--{r["kind"]}" style="--dot: {pct(r["dot"], total)}; '
          f'--lab: {pct(r["lab"], total)}; --lab-w: {pct(r["lab-w"], total)}; --i: {n}">')
        w('                <span class="tl__dot"></span>')
        w('                <span class="tl__lab">')
        for i in r["items"]:
            w(f'                    <span class="tl__ms-name">{esc(i["label"])}</span>')
        w(f'                    <span class="tl__when">{esc(label(r["date"]))}</span>')
        w('                </span>')
        w('            </li>')
    w('        </ol>')
    w('    </div>')
    w('    <figcaption class="tl__caption">Solid boxes are paid work: SQL and Python as a data analyst at Excel Esports. Outlined boxes are tools I’ve used in my own projects: they show when I picked each one up, not years on the job. Hover a box, or open Data source below, to see what I built with each.</figcaption>')
    w('</figure>')
    w('<details class="sql-src tl__source">')
    w('    <summary class="sql-src__toggle" aria-label="Data source for the tools timeline">Data source</summary>')
    w('    <div class="sql-src__panel">')
    w('        <table class="tl__table">')
    w('            <caption class="visually-hidden">Tools and when I used them</caption>')
    w('            <thead><tr><th scope="col">Tool</th><th scope="col">When</th><th scope="col">How</th></tr></thead>')
    w('            <tbody>')
    for tool in tools:
        for n, s in enumerate(tool["spans"]):
            how = esc(use_text(s)) + (": " + esc(", ".join(s["built"])) if s.get("built") else "")
            head = f'<th scope="row" rowspan="{len(tool["spans"])}">{esc(tool["name"])}</th>' if n == 0 else ""
            w(f'                <tr>{head}<td>{esc(span_text(s))}</td><td class="tl__how">{how}</td></tr>')
    w('            </tbody>')
    w('        </table>')
    w('        <table class="tl__table">')
    w('            <caption class="visually-hidden">Roles and credentials</caption>')
    w('            <thead><tr><th scope="col">Milestone</th><th scope="col" colspan="2">When</th></tr></thead>')
    w('            <tbody>')
    for ms in sorted(data["milestones"], key=lambda m: parse(m["date"])[0] * 12 + (parse(m["date"])[1] or 6)):
        w(f'                <tr><th scope="row">{esc(ms.get("detail") or ms["label"])}</th><td colspan="2">{esc(label(ms["date"]))}</td></tr>')
    w('            </tbody>')
    w('        </table>')
    w(f'        <p class="sql-src__note">Drawn from <a href="{REPO}/data/tool-timeline.json" target="_blank" '
      'rel="noopener">one small data file</a>; a check fails the build if the chart and the file ever disagree.</p>')
    w('    </div>')
    w('</details>')
    return "\n".join((indent + line) if line else line for line in out)


def main():
    check = "--check" in sys.argv[1:]
    data = json.loads(DATA.read_text(encoding="utf-8"))
    page = PAGE.read_text(encoding="utf-8")
    m = MARKER.search(page)
    if not m:
        raise SystemExit("index.html has no <!-- tool-timeline --> ... <!-- /tool-timeline --> block")
    indent = m["indent"]
    block = f"{indent}<!-- tool-timeline -->\n{build_block(data, indent)}\n{indent}<!-- /tool-timeline -->"
    new = page[:m.start()] + block + page[m.end():]
    if check:
        if new != page:
            raise SystemExit("index.html's tools timeline is out of step with data/tool-timeline.json: "
                             "run python3 scripts/build_tool_timeline.py and commit the result")
        print("tools timeline: current")
        return
    if new != page:
        PAGE.write_text(new, encoding="utf-8")
        print("tools timeline: index.html updated")
    else:
        print("tools timeline: already current")


if __name__ == "__main__":
    main()
