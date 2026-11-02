#!/usr/bin/env python3
"""Build the résumé from resume-src/resume.md.

Writes (only when the result fits on one page; otherwise assets/ is left untouched):
  assets/loganmansfield.pdf  (one US Letter page, linked from every page)
  assets/resume_ats.txt      (plain-text copy for ATS uploads)

Run from the repo root:  python3 resume-src/build.py
(paths are resolved relative to this file, so any working directory works)
Needs: reportlab (pip install reportlab) and the Carlito font
(fonts-crosextra-carlito); falls back to Helvetica without it.

Markdown subset understood by this script:
  # Name            first line, large heading
  plain lines       right after the name: subtitle, then contact line
  ## Section        ruled section heading (printed in capitals)
  ### Role          bold line (a job title)
  - text            bullet
  **bold** text     inline bold anywhere
  blank line        paragraph break (no extra space is added)
"""

import os
import re
import sys
from io import BytesIO

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable,
    ListFlowable,
    ListItem,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "resume-src", "resume.md")
PDF = os.path.join(ROOT, "assets", "loganmansfield.pdf")
TXT = os.path.join(ROOT, "assets", "resume_ats.txt")

FONT_DIRS = [
    "/usr/share/fonts/truetype/crosextra",
    os.path.expanduser("~/.fonts"),
    "/Library/Fonts",
]


def register_fonts():
    for d in FONT_DIRS:
        reg, bold = (
            os.path.join(d, "Carlito-Regular.ttf"),
            os.path.join(d, "Carlito-Bold.ttf"),
        )
        if os.path.exists(reg) and os.path.exists(bold):
            pdfmetrics.registerFont(TTFont("Carlito", reg))
            pdfmetrics.registerFont(TTFont("Carlito-Bold", bold))
            pdfmetrics.registerFontFamily(
                "Carlito", normal="Carlito", bold="Carlito-Bold"
            )
            return "Carlito", "Carlito-Bold"
    print("warning: Carlito not found, using Helvetica", file=sys.stderr)
    return "Helvetica", "Helvetica-Bold"


def inline(text):
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)


class Rule(Flowable):
    def __init__(self, width, thickness=0.7):
        super().__init__()
        self.width, self.thickness, self.height = width, thickness, thickness

    def draw(self):
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, 0, self.width, 0)


def build(base_size=10.0):
    regular, bold = register_fonts()
    lead = base_size * 1.15
    body = ParagraphStyle("body", fontName=regular, fontSize=base_size, leading=lead)
    name = ParagraphStyle("name", parent=body, fontName=bold, fontSize=20, leading=23)
    sub = ParagraphStyle("sub", parent=body, fontSize=base_size + 1, leading=lead + 1)
    section = ParagraphStyle(
        "section",
        parent=body,
        fontName=bold,
        fontSize=base_size + 1,
        leading=lead + 1,
        spaceBefore=5,
        spaceAfter=1,
    )
    role = ParagraphStyle("role", parent=body, fontName=bold, spaceBefore=2)
    bullet = ParagraphStyle("bullet", parent=body)

    margin_x, margin_y = 0.5 * inch, 0.4 * inch
    width = letter[0] - 2 * margin_x
    lines = open(SRC, encoding="utf-8").read().splitlines()

    story, bullets, txt = [], [], []
    seen_name = False
    header_lines = 0
    after_section = False

    def txt_break():
        if txt and txt[-1] and not after_section:
            txt.append("")

    def flush_bullets():
        if bullets:
            story.append(
                ListFlowable(
                    [
                        ListItem(Paragraph(inline(b), bullet), leftIndent=11, value="•")
                        for b in bullets
                    ],
                    bulletType="bullet",
                    start="•",
                    leftIndent=11,
                    bulletFontName=regular,
                    bulletFontSize=base_size,
                    bulletOffsetY=0,
                )
            )
            bullets.clear()

    for raw in lines:
        line = raw.rstrip()
        if not line:
            flush_bullets()
            continue
        if line.startswith("# "):
            story.append(Paragraph(inline(line[2:]), name))
            txt.append(line[2:])
            seen_name = True
            continue
        if line.startswith("## "):
            flush_bullets()
            title = line[3:].upper()
            story.append(Paragraph(inline(title), section))
            story.append(Rule(width))
            story.append(Spacer(1, 2))
            txt += ["", title]
            header_lines = 99
            after_section = True
            continue
        if line.startswith("### "):
            flush_bullets()
            story.append(Paragraph(inline(line[4:]), role))
            txt_break()
            txt.append(line[4:])
            after_section = False
            continue
        if line.startswith("- "):
            bullets.append(line[2:])
            txt.append("- " + line[2:].replace("**", ""))
            after_section = False
            continue
        if txt and txt[-1].startswith("- "):
            txt_break()
        flush_bullets()
        style = body
        if seen_name and header_lines == 0:
            style = sub
        header_lines += 1
        story.append(Paragraph(inline(line), style))
        txt.append(line.replace("**", ""))
        after_section = False
    flush_bullets()

    pages = []
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=margin_x,
        rightMargin=margin_x,
        topMargin=margin_y,
        bottomMargin=margin_y,
        invariant=1,
        title="Logan Mansfield - Résumé",
        author="Logan Mansfield",
        subject="Résumé",
        creator="resume-src/build.py",
    )
    doc.build(
        story,
        onLaterPages=lambda c, d: pages.append(d.page),
        onFirstPage=lambda c, d: pages.append(d.page),
    )
    return len(pages), buf.getvalue(), "\n".join(txt).strip() + "\n"


if __name__ == "__main__":
    # Shrink the type a touch if the content spills onto a second page.
    for size in (10.0, 9.75, 9.5, 9.25):
        n, pdf, ats = build(size)
        if n == 1:
            break
    if n != 1:
        sys.exit(
            f"résumé does not fit on one page ({n} pages at {size}pt); "
            f"trim resume-src/resume.md ({os.path.relpath(PDF, ROOT)} and "
            f"{os.path.relpath(TXT, ROOT)} left unchanged)"
        )
    with open(PDF, "wb") as f:
        f.write(pdf)
    with open(TXT, "w", encoding="utf-8") as f:
        f.write(ats)
    print(
        f"Built {os.path.relpath(PDF, ROOT)} (1 page, {size}pt) "
        f"and {os.path.relpath(TXT, ROOT)}"
    )
