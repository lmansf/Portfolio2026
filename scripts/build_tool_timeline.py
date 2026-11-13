"""Draw Home's "Tools over time" chart from data/tool-timeline.json.

The chart is plain HTML and CSS (styles under "Tools over time" in
assets/pages.css), written into index.html between a pair of comments:

    <!-- tool-timeline -->
    ...generated <figure> and its data-source table...
    <!-- /tool-timeline -->

Each tool is a lane, years run down the page, each span of use is a box,
and thin lines trace the order the tools were picked up (spans sorted by
start date, then lane). Roles and credentials sit on a rail to the right;
milestones that share a date share one dot.

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
REPO = "https://github.com/lmansf/Portfolio2026/blob/main"
MARKER = re.compile(r"(?P<indent>[ \t]*)<!-- tool-timeline -->\n.*?<!-- /tool-timeline -->", re.S)
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Box edges inside a lane, as a share of the lane's width.
BOX_L, BOX_R = 0.16, 0.84
# Rail label layout, in months of chart height, once for narrow screens
# and once from 960px up (pages.css switches between them). Each is
# (months a label line takes, gap between labels, characters before a
# label wraps): a phone draws about 4.6px a month with 11.5px labels in a
# 7.2rem rail; from 960px it's 5.4px a month with 13px labels in a rail
# of 15rem or more.
LAYOUTS = {"lab": (3.6, 1.2, 17), "lab-w": (3.2, 1.0, 30)}

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


def pct(v, total):
    return f"{v / total * 100:.3f}".rstrip("0").rstrip(".") + "%"


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
    boxes = []
    for lane, tool in enumerate(tools):
        for span in tool["spans"]:
            a, b = start_of(span["from"]), end_of(span["to"])
            if not 0 <= a < b <= total:
                raise SystemExit(f"tool-timeline.json: {tool['name']} span {span} is outside "
                                 f"{data['start']} to {data['through']} or ends before it starts")
            boxes.append({"lane": lane, "tool": tool, "span": span, "a": a, "b": b})

    # Connectors: the order each span was picked up.
    order = sorted(boxes, key=lambda x: (x["a"], x["lane"]))
    paths = []
    for p, q in zip(order, order[1:]):
        if p["lane"] == q["lane"]:
            if q["a"] > p["b"]:
                x = (p["lane"] + 0.5) * 100
                paths.append((x, p["b"] * 10, x, q["a"] * 10))
            continue
        right = q["lane"] > p["lane"]
        x1 = (p["lane"] + (BOX_R if right else BOX_L)) * 100
        x2 = (q["lane"] + (BOX_L if right else BOX_R)) * 100
        if p["b"] <= q["a"]:  # p ended first: corner to corner
            paths.append((x1, p["b"] * 10, x2, q["a"] * 10))
        else:  # p still running: a short hop into q's first months
            y = (q["a"] + min(2, (q["b"] - q["a"]) / 3)) * 10
            paths.append((x1, y, x2, y))

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
        rail.append({"date": date, "items": items, "dot": dot})
    rail.sort(key=lambda r: r["dot"])
    for key, (line, gap, chars) in LAYOUTS.items():
        tops, heights = [], []
        for i, r in enumerate(rail):
            h = (sum(math.ceil(len(it["label"]) / chars) for it in r["items"]) + 1) * line
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
    w('    <div class="tl__grid" aria-hidden="true">')
    w('        <div class="tl__heads">')
    for lane, tool in enumerate(tools):
        w(f'            <span class="tl__head tl--{esc(tool["id"])}" style="--lane: {lane}">{esc(tool["name"])}</span>')
    w('        </div>')
    w('        <div class="tl__axis">')
    for year in range(y0, ty + 1):
        at = (year - y0) * 12
        if at < total:
            w(f'            <span class="tl__tick" style="--at: {pct(at, total)}">{year}</span>')
    w('            <span class="tl__tick tl__tick--now" style="--at: 100%">Now</span>')
    w('        </div>')
    w('        <div class="tl__plot">')
    for lane in range(lanes):
        w(f'            <span class="tl__guide" style="--lane: {lane}"></span>')
    w(f'            <svg class="tl__links" viewBox="0 0 {lanes * 100} {total * 10}" preserveAspectRatio="none" focusable="false">')
    for x1, y1, x2, y2 in paths:
        w(f'                <path d="M{x1:g} {y1:g} L{x2:g} {y2:g}"/>')
    w('            </svg>')
    for bx in boxes:
        title = f'{bx["tool"]["name"]} · {span_text(bx["span"])}'
        ongoing = " tl__box--now" if bx["span"]["to"] is None else ""
        w(f'            <span class="tl__box tl--{esc(bx["tool"]["id"])}{ongoing}" '
          f'style="--lane: {bx["lane"]}; --top: {pct(bx["a"], total)}; --h: {pct(bx["b"] - bx["a"], total)}" '
          f'title="{esc(title)}"></span>')
    w('        </div>')
    w('        <ol class="tl__rail">')
    for r in rail:
        kinds = {i["kind"] for i in r["items"]}
        kind = "credential" if kinds == {"credential"} else "role"
        w(f'            <li class="tl__ms tl__ms--{kind}" style="--dot: {pct(r["dot"], total)}; --lab: {pct(r["lab"], total)}; --lab-w: {pct(r["lab-w"], total)}">')
        w('                <span class="tl__dot"></span>')
        w('                <span class="tl__lab">')
        for i in r["items"]:
            w(f'                    <span class="tl__name">{esc(i["label"])}</span>')
        w(f'                    <span class="tl__when">{esc(label(r["date"]))}</span>')
        w('                </span>')
        w('            </li>')
    w('        </ol>')
    w('    </div>')
    w('    <figcaption class="tl__caption">Each box is a stretch of time I used that tool; the lines trace the order I picked them up. Hollow dots are roles, filled dots are certifications and workshops.</figcaption>')
    w('</figure>')
    w('<details class="sql-src tl__source">')
    w('    <summary class="sql-src__toggle" aria-label="Data source for the tools timeline">Data source</summary>')
    w('    <div class="sql-src__panel">')
    w('        <table class="tl__table">')
    w('            <caption class="visually-hidden">Tools and when I used them</caption>')
    w('            <thead><tr><th scope="col">Tool</th><th scope="col">When</th></tr></thead>')
    w('            <tbody>')
    for tool in tools:
        when = "<br>".join(esc(span_text(s)) for s in tool["spans"])
        w(f'                <tr><th scope="row">{esc(tool["name"])}</th><td>{when}</td></tr>')
    w('            </tbody>')
    w('        </table>')
    w('        <table class="tl__table">')
    w('            <caption class="visually-hidden">Roles and credentials</caption>')
    w('            <thead><tr><th scope="col">Milestone</th><th scope="col">When</th></tr></thead>')
    w('            <tbody>')
    for ms in sorted(data["milestones"], key=lambda m: parse(m["date"])[0] * 12 + (parse(m["date"])[1] or 6)):
        w(f'                <tr><th scope="row">{esc(ms.get("detail") or ms["label"])}</th><td>{esc(label(ms["date"]))}</td></tr>')
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
