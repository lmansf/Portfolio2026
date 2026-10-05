#!/usr/bin/env python3
"""seo-check.py — guard the site's search/identity invariants (stdlib only).

    python3 scripts/seo-check.py

Checks every root-level *.html page and exits 1 on any failure:
  - <html lang>, exactly one <h1>, every <img> has alt; the headshot's alt is
    "Logan Mansfield"; the homepage <h1> contains "Logan Mansfield".
  - Titles: homepage "Logan Mansfield — …", every other page "… | Logan Mansfield";
    titles and meta descriptions unique across indexable pages; the homepage and
    /about descriptions lead with the full name.
  - Indexable pages (no robots noindex) have an absolute https canonical on
    loganmansfield.org that is listed in sitemap.xml, and og:url == canonical.
  - Open Graph + Twitter tags present; og:image is an absolute URL whose file
    exists here and whose real pixel size matches og:image:width/height.
  - JSON-LD parses; the full Person node (#person) is identical on every page
    that carries it, and its image exists at the declared size; every reference
    to #person uses the same name and url; on ProfilePage pages the Person
    description equals the visible short bio (.bio__text / .hero__bio) word for
    word; breadcrumb URLs are canonical pages (the last one this page's); a
    CollectionPage's hasPart name/description/keywords match the visible
    project cards.
  - Links to the profiles listed in the Person sameAs carry rel="me".
  - data/mentions.json is valid: every entry has title, outlet, date
    (YYYY-MM-DD, YYYY-MM or YYYY) and an http(s) url.
"""
import datetime
import json
import re
import struct
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = "https://loganmansfield.org"
PERSON_ID = f"{ORIGIN}/#person"
NAME = "Logan Mansfield"
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lang = None
        self.title = None
        self.meta = {}
        self.links = []          # (rel, href) from <link>
        self.anchors = []        # (href, rel)
        self.imgs = []           # attrs
        self.h1 = []             # text of each h1
        self.ld = []             # raw JSON-LD strings
        self.bio = []            # text of .bio__text / .hero__bio
        self._capture = None     # ("title"|"h1"|"ld"|"bio", depth)
        self._buf = []
        self._depth = 0

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        if tag not in VOID:
            self._depth += 1
        if tag == "html":
            self.lang = a.get("lang")
        elif tag == "meta":
            key = a.get("name") or a.get("property")
            if key:
                self.meta[key.lower()] = a.get("content", "")
        elif tag == "link":
            self.links.append((a.get("rel", "").lower(), a.get("href", "")))
        elif tag == "a":
            self.anchors.append((a.get("href", ""), a.get("rel", "").lower().split()))
        elif tag == "img":
            self.imgs.append(a)
        if self._capture is None:
            classes = a.get("class", "").split()
            if tag == "title":
                self._start("title")
            elif tag == "h1":
                self._start("h1")
            elif tag == "script" and a.get("type") == "application/ld+json":
                self._start("ld")
            elif "bio__text" in classes or "hero__bio" in classes:
                self._start("bio")

    def _start(self, kind):
        self._capture = (kind, self._depth)
        self._buf = []

    def handle_endtag(self, tag):
        if self._capture and self._depth == self._capture[1]:
            kind = self._capture[0]
            text = "".join(self._buf)
            if kind == "title":
                self.title = " ".join(text.split())
            elif kind == "h1":
                self.h1.append(" ".join(text.split()))
            elif kind == "ld":
                self.ld.append(text)
            elif kind == "bio":
                self.bio.append(" ".join(text.split()))
            self._capture = None
        if tag not in VOID:
            self._depth -= 1

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_data(self, data):
        if self._capture:
            self._buf.append(data)


def image_size(path):
    data = path.read_bytes()
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    if data[:2] == b"\xff\xd8":
        i = 2
        while i < len(data):
            marker, length = data[i + 1], struct.unpack(">H", data[i + 2:i + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return w, h
            i += 2 + length
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        chunk = data[12:16]
        if chunk == b"VP8X":
            w = 1 + int.from_bytes(data[24:27], "little")
            h = 1 + int.from_bytes(data[27:30], "little")
            return w, h
        if chunk == b"VP8 ":
            w, h = struct.unpack("<HH", data[26:30])
            return w & 0x3FFF, h & 0x3FFF
        if chunk == b"VP8L":
            b = data[21:25]
            return 1 + (b[0] | (b[1] & 0x3F) << 8), 1 + (b[1] >> 6 | b[2] << 2 | (b[3] & 0x0F) << 10)
    return None


class ProjectCards(HTMLParser):
    """Visible project cards: title (minus badges), description, tags."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.cards = []
        self._field = None       # "title" | "desc" | "tag"
        self._skip = 0           # depth inside a .project__badge
        self._buf = []

    def handle_starttag(self, tag, attrs):
        classes = dict(attrs).get("class", "") or ""
        classes = classes.split()
        if tag == "article" and "project" in classes:
            self.cards.append({"title": "", "desc": "", "tags": []})
        if not self.cards:
            return
        if "project__badge" in classes:
            self._skip += 1
        elif "project__title" in classes or "project__desc" in classes:
            self._field, self._buf = ("title" if "project__title" in classes else "desc"), []
        elif tag == "li" and self._field is None:
            self._field, self._buf = "tag", []

    def handle_endtag(self, tag):
        if self._skip and tag == "span":
            self._skip -= 1
            return
        if self._field and tag in ("h2", "h3", "p", "li"):
            text = " ".join("".join(self._buf).split())
            card = self.cards[-1]
            if self._field == "tag":
                card["tags"].append(text)
            else:
                card[self._field] = text
            self._field = None

    def handle_data(self, data):
        if self._field and not self._skip:
            self._buf.append(data)


def valid_date(value):
    """A real calendar date written as YYYY-MM-DD, YYYY-MM or YYYY."""
    m = re.fullmatch(r"(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?", value)
    if not m:
        return False
    try:
        datetime.date(int(m[1]), int(m[2] or 1), int(m[3] or 1))
    except ValueError:
        return False
    return True


def walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)


def main():
    errors = []
    pages = {}
    for path in sorted(ROOT.glob("*.html")):
        p = Page()
        p.feed(path.read_text(encoding="utf-8"))
        pages[path.name] = p

    sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    sitemap_locs = set(re.findall(r"<loc>([^<]+)</loc>", sitemap))

    titles, descs = {}, {}
    person_full = {}
    profiles = set()
    for name, p in pages.items():
        err = lambda msg: errors.append(f"{name}: {msg}")  # noqa: E731
        noindex = any(re.search(r"\b(noindex|none)\b", p.meta.get(k, ""), re.I) for k in ("robots", "googlebot"))
        canonical = next((h for r, h in p.links if r == "canonical"), None)
        is_home = canonical == f"{ORIGIN}/"

        if not p.lang:
            err("<html> has no lang attribute")
        if len(p.h1) != 1:
            err(f"expected exactly one <h1>, found {len(p.h1)}")
        if is_home and p.h1 and NAME not in p.h1[0]:
            err(f'homepage <h1> "{p.h1[0]}" does not contain "{NAME}"')
        for img in p.imgs:
            if "alt" not in img:
                err(f"<img src={img.get('src')}> has no alt")
            if "profilepicture" in img.get("src", "") and img.get("alt") != NAME:
                err(f'headshot alt should be "{NAME}"')

        title = p.title or ""
        desc = p.meta.get("description", "")
        if not title:
            err("missing <title>")
        elif is_home and not title.startswith(f"{NAME} — "):
            err(f'homepage title "{title}" should be "{NAME} — <headline>"')
        elif not is_home and not title.endswith(f" | {NAME}"):
            err(f'title "{title}" should be "<Page> | {NAME}"')
        if not desc:
            err("missing meta description")

        for key in ("og:title", "og:description", "og:type", "og:image", "og:image:width",
                    "og:image:height", "og:image:alt", "twitter:card"):
            if not p.meta.get(key):
                err(f"missing {key}")
        if p.meta.get("twitter:card") != "summary_large_image":
            err("twitter:card should be summary_large_image")
        og_image = p.meta.get("og:image", "")
        if og_image:
            if not og_image.startswith(f"{ORIGIN}/"):
                err(f"og:image {og_image} is not an absolute {ORIGIN} URL")
            else:
                local = ROOT / og_image[len(ORIGIN) + 1:]
                size = image_size(local) if local.exists() else None
                if size is None:
                    err(f"og:image file {local.relative_to(ROOT)} is missing or unreadable")
                elif (str(size[0]), str(size[1])) != (p.meta.get("og:image:width"), p.meta.get("og:image:height")):
                    err(f"og:image is {size[0]}×{size[1]} but tags say "
                        f"{p.meta.get('og:image:width')}×{p.meta.get('og:image:height')}")

        if not noindex:
            if not canonical or not canonical.startswith(f"{ORIGIN}/"):
                err(f"canonical {canonical!r} is not an absolute {ORIGIN} URL")
            elif canonical not in sitemap_locs:
                err(f"canonical {canonical} is not in sitemap.xml (run node scripts/build-sitemap.mjs)")
            if p.meta.get("og:url") != canonical:
                err(f"og:url {p.meta.get('og:url')!r} != canonical {canonical!r}")
            if title in titles:
                err(f'title duplicates {titles[title]}')
            titles[title] = name
            if desc in descs:
                err(f"meta description duplicates {descs[desc]}")
            descs[desc] = name

        has_profile_page = False
        cards = None
        for raw in p.ld:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as e:
                err(f"JSON-LD does not parse: {e}")
                continue
            for node in walk(data):
                if node.get("@type") == "BreadcrumbList":
                    items = [li.get("item") for li in node.get("itemListElement", [])]
                    if not noindex and items and items[-1] != canonical:
                        err(f"last breadcrumb {items[-1]!r} != canonical {canonical!r}")
                    for url in items:
                        if url not in sitemap_locs:
                            err(f"breadcrumb URL {url!r} is not a canonical page in sitemap.xml")
                if node.get("@type") == "CollectionPage":
                    if cards is None:
                        parser = ProjectCards()
                        parser.feed((ROOT / name).read_text(encoding="utf-8"))
                        cards = {c["title"]: c for c in parser.cards}
                    for part in node.get("hasPart", []):
                        card = cards.get(part.get("name"))
                        if not card:
                            err(f"hasPart {part.get('name')!r} matches no visible project card title")
                            continue
                        if part.get("description") != card["desc"]:
                            err(f"hasPart {part.get('name')!r} description differs from the visible card text")
                        if part.get("keywords") != ", ".join(card["tags"]):
                            err(f"hasPart {part.get('name')!r} keywords differ from the card tags {card['tags']}")
                if node.get("@type") == "ProfilePage":
                    has_profile_page = True
                if node.get("@id") != PERSON_ID:
                    continue
                extra = set(node) - {"@id", "@type", "name", "url"}
                if extra:
                    person_full[name] = node
                    profiles.update(node.get("sameAs", []))
                elif len(node) > 1 and (node.get("name"), node.get("url")) not in ((None, None), (NAME, f"{ORIGIN}/")):
                    err(f"#person reference has name/url {node.get('name')!r}/{node.get('url')!r}")

        if has_profile_page:
            if not desc.startswith(NAME):
                err(f'meta description should lead with "{NAME}"')
            person = person_full.get(name)
            if not person:
                err("ProfilePage without a full Person node")
            elif not p.bio:
                err("ProfilePage without a visible short bio (.bio__text / .hero__bio)")
            elif any(b != person.get("description") for b in p.bio):
                err("visible short bio differs from the Person description in the JSON-LD")

    if person_full:
        first_page, first = next(iter(person_full.items()))
        image = first.get("image", {})
        url = image.get("url", "") if isinstance(image, dict) else image
        local = ROOT / url[len(ORIGIN) + 1:] if url.startswith(f"{ORIGIN}/") else None
        size = image_size(local) if local and local.exists() else None
        if size is None:
            errors.append(f"{first_page}: Person image {url!r} is missing or not an on-site image")
        elif isinstance(image, dict) and (image.get("width"), image.get("height")) != size:
            errors.append(f"{first_page}: Person image is {size[0]}×{size[1]} but JSON-LD says "
                          f"{image.get('width')}×{image.get('height')}")
        for name, node in person_full.items():
            if node != first:
                errors.append(f"{name}: Person node differs from the one in {first_page}")

    for name, p in pages.items():
        for href, rel in p.anchors:
            if href.rstrip("/") in {u.rstrip("/") for u in profiles} and "me" not in rel:
                errors.append(f'{name}: link to {href} is missing rel="me"')

    mentions_path = ROOT / "data" / "mentions.json"
    try:
        mentions = json.loads(mentions_path.read_text(encoding="utf-8"))["mentions"]
        assert isinstance(mentions, list)
    except Exception as e:  # noqa: BLE001
        errors.append(f"data/mentions.json: must be {{\"mentions\": [...]}} ({e})")
        mentions = []
    for i, m in enumerate(mentions):
        where = f"data/mentions.json entry {i}"
        if not isinstance(m, dict):
            errors.append(f"{where}: must be an object")
            continue
        for key in ("title", "outlet", "date", "url"):
            if not isinstance(m.get(key), str) or not m[key].strip():
                errors.append(f"{where}: missing {key}")
        if isinstance(m.get("date"), str) and not valid_date(m["date"]):
            errors.append(f"{where}: date must be a real date as YYYY-MM-DD, YYYY-MM or YYYY")
        if isinstance(m.get("url"), str) and not re.match(r"https?://", m["url"]):
            errors.append(f"{where}: url must start with http:// or https://")

    if errors:
        print("SEO check failed:\n- " + "\n- ".join(errors))
        return 1
    print(f"SEO check passed ({len(pages)} pages, {len(mentions)} mentions).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
