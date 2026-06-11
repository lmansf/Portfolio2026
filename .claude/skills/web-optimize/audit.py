#!/usr/bin/env python3
"""Static-site audit: errors, performance, click-through. See SKILL.md."""
import json
import os
import re
import sys
from collections import defaultdict
from html.parser import HTMLParser

VOID = {'meta', 'link', 'br', 'img', 'input', 'hr', 'source', 'wbr', 'area',
        'base', 'col', 'embed', 'track', 'param'}
BIG_ASSET = 200 * 1024


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.unbalanced = [], []
        self.links, self.assets, self.imgs, self.ids = [], [], [], []
        self.stylesheets, self.scripts = [], []
        self.title = self.meta_desc = False
        self.og, self.tw, self.preconnects = set(), set(), set()
        self.cta_words = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag not in VOID:
            self.stack.append(tag)
        if 'id' in a:
            self.ids.append(a['id'])
        if tag == 'a' and a.get('href') is not None:
            self.links.append((a['href'], a.get('rel', ''), a.get('target', '')))
        if tag == 'img':
            self.imgs.append(a)
            if a.get('src'):
                self.assets.append(a['src'])
        if tag == 'script' and a.get('src'):
            self.scripts.append(a)
            self.assets.append(a['src'])
        if tag == 'link':
            rel = a.get('rel', '')
            if 'stylesheet' in rel and a.get('href'):
                self.stylesheets.append(a['href'])
                self.assets.append(a['href'])
            if 'preconnect' in rel and a.get('href'):
                self.preconnects.add(a['href'])
            if 'icon' in rel and a.get('href'):
                self.assets.append(a['href'])
        if tag == 'meta':
            n, p = a.get('name', ''), a.get('property', '')
            if n == 'description' and a.get('content'):
                self.meta_desc = True
            if p.startswith('og:'):
                self.og.add(p)
            if n.startswith('twitter:'):
                self.tw.add(n)
        if tag == 'title':
            self.title = True

    def handle_endtag(self, tag):
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        elif tag in self.stack:
            while self.stack and self.stack[-1] != tag:
                self.unbalanced.append(self.stack.pop())
            self.stack.pop()
        else:
            self.unbalanced.append('/' + tag)


def load_routes(root):
    rewrites, redirects = {}, {}
    cfg = os.path.join(root, 'vercel.json')
    if os.path.exists(cfg):
        data = json.load(open(cfg))
        for r in data.get('rewrites', []):
            rewrites[r['source']] = r['destination']
        for r in data.get('redirects', []):
            redirects[r['source']] = r['destination']
    return rewrites, redirects


def resolve(href, page_dir, root, rewrites, redirects):
    """Return True if an internal href resolves to a file or route."""
    href = href.split('#')[0].split('?')[0]
    if not href:
        return True  # pure fragment; flagged separately as dead link if '#'
    if href in rewrites:
        href = rewrites[href]
    if href in redirects:
        return True
    if href.startswith('/'):
        path = os.path.join(root, href.lstrip('/'))
    else:
        path = os.path.join(page_dir, href)
    return os.path.exists(path) or os.path.exists(path + '.html')


def main():
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
    rewrites, redirects = load_routes(root)
    pages = sorted(f for f in os.listdir(root) if f.endswith('.html'))
    report = defaultdict(lambda: defaultdict(list))

    for name in pages:
        path = os.path.join(root, name)
        p = Page()
        p.feed(open(path, encoding='utf-8').read())
        err, perf, ctr = (report[name][k] for k in ('ERROR', 'PERF', 'CTR'))

        if p.stack or p.unbalanced:
            err.append(f'unbalanced tags: {p.stack + p.unbalanced}')
        dupes = {i for i in p.ids if p.ids.count(i) > 1}
        if dupes:
            err.append(f'duplicate ids: {sorted(dupes)}')
        for href, rel, target in p.links:
            if href == '#':
                err.append('dead link href="#"')
            elif href.startswith(('http://', 'https://')):
                if target == '_blank' and 'noopener' not in rel:
                    err.append(f'external _blank without noopener: {href[:60]}')
            elif not href.startswith(('mailto:', 'tel:', 'javascript:')):
                if not resolve(href, root, root, rewrites, redirects):
                    err.append(f'broken internal link: {href}')
        for src in p.assets:
            if src.startswith(('http', '//', 'data:', '/_vercel/')):
                continue  # external or injected by the host at deploy time
            f = os.path.join(root, src.lstrip('/')) if src.startswith('/') \
                else os.path.join(root, src)
            f = f.split('#')[0].split('?')[0]
            if not os.path.exists(f):
                err.append(f'missing asset: {src}')
            elif os.path.getsize(f) > BIG_ASSET:
                perf.append(f'large asset {os.path.getsize(f)//1024}KB: {src}')

        for ref in p.stylesheets + [s.get('src', '') for s in p.scripts]:
            if ref.startswith('http') or '.min.' in ref or not ref:
                continue
            base, ext = os.path.splitext(ref.lstrip('/'))
            minf = os.path.join(root, f'{base}.min{ext}')
            if os.path.exists(minf):
                perf.append(f'unminified ref (min exists): {ref}')
        for img in p.imgs:
            if img.get('loading') != 'lazy' and 'fetchpriority' not in img:
                perf.append(f'img without loading=lazy: {img.get("src", "?")[:50]}')
            if not img.get('alt'):
                err.append(f'img missing alt: {img.get("src", "?")[:50]}')
        for s in p.scripts:
            if 'defer' not in s and 'async' not in s and s.get('src', '').startswith('assets'):
                perf.append(f'blocking script: {s.get("src")}')
        if len(p.stylesheets) > 4:
            perf.append(f'{len(p.stylesheets)} render-blocking stylesheets')
        if any('fonts.googleapis' in s for s in p.stylesheets) and \
                not any('fonts.gstatic' in pc for pc in p.preconnects):
            perf.append('google fonts without fonts.gstatic preconnect')

        if not p.title:
            ctr.append('missing <title>')
        if not p.meta_desc:
            ctr.append('missing meta description')
        need_og = {'og:title', 'og:description', 'og:type', 'og:url'}
        if need_og - p.og:
            ctr.append(f'missing Open Graph: {sorted(need_og - p.og)}')
        if 'twitter:card' not in p.tw:
            ctr.append('missing twitter:card')

    total = 0
    for name in pages:
        cats = report[name]
        items = [(k, v) for k, v in cats.items() if v]
        if not items:
            continue
        print(f'\n== {name} ==')
        for cat, msgs in items:
            seen = []
            for m in msgs:
                if m not in seen:
                    seen.append(m)
            for m in seen:
                n = msgs.count(m)
                print(f'  [{cat}] {m}' + (f' (x{n})' if n > 1 else ''))
                total += 1
    print(f'\n{total} finding(s) across {len(pages)} page(s).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
