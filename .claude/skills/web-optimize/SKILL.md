---
name: web-optimize
description: Audit and optimize a static website for errors, load time, and click-through. Use when asked to optimize, audit, speed up, or health-check a website. Runs an automated audit script, then guides fixes in three passes - error detection, performance, and click-through encouragement.
---

# Website Optimizer

Audit and optimize a static HTML/CSS/JS website in three passes. Run the
automated audit first, fix what it finds, then re-run until clean.

## Step 1 · Automated audit

Run the bundled audit script from the site root (the directory containing the
HTML pages):

```bash
python3 .claude/skills/web-optimize/audit.py [site-root]
```

It reports, per page:
- **Errors**: broken internal links (checked against files and
  `vercel.json` rewrites/redirects), missing referenced assets (img/script/css),
  unbalanced HTML tags, dead `href="#"` links, external links missing
  `rel="noopener"`, duplicate element IDs.
- **Performance**: unminified CSS/JS where a `.min` variant exists, `<img>`
  without `loading="lazy"`, referenced assets over 200 KB, render-blocking
  stylesheet count, missing font preconnects.
- **Click-through**: missing `<title>`, meta description, Open Graph and
  Twitter Card tags, pages without a visible call-to-action link.

## Step 2 · Error pass

Fix every item in the Errors section. Rules of thumb:
- A dead `href="#"` on a project tile should either link somewhere real or be
  demoted to a non-link element (`<article>`), never left as a broken promise.
- Internal links must resolve through the router config (e.g. `vercel.json`
  rewrites), not just to raw `.html` files, so clean URLs keep working.

## Step 3 · Performance pass

- Reference `.min.css`/`.min.js` variants where they exist and are current;
  regenerate them if the source changed (any minifier; even
  `python3 -c` with rcssmin/rjsmin, or careful manual minification).
- Add `loading="lazy"` + `decoding="async"` to below-the-fold images; never to
  the LCP (hero) image — give that one `fetchpriority="high"`.
- Ensure `preconnect` for third-party font/CDN origins and `display=swap` on
  font CSS URLs.
- Check cache headers in the hosting config (long max-age for fingerprinted or
  rarely-changing assets, no-cache for HTML).
- Defer all non-critical scripts (`defer`, never bare `<script src>` in head).

## Step 4 · Click-through pass

- Every page gets a unique `<title>`, meta description (~150 chars, includes
  the page's keyword), and Open Graph + Twitter Card tags (og:title,
  og:description, og:type, og:url, og:image if available, twitter:card).
- Every page ends with exactly one clear call-to-action; link copy says what
  the visitor gets ("See the SQL work →"), not generic "click here" / "open".
- The most important destination must be reachable within one click of the
  hero on every page.

## Step 5 · Verify

Re-run the audit script. Done when Errors is empty and remaining
Performance/Click-through items are consciously accepted (note why). If a local
server and browser are available, spot-check one page per template for console
errors and layout breakage before finishing.
