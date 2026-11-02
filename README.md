# loganmansfield.org — portfolio

Personal portfolio for **Logan Mansfield**, a data analyst moving into
analytics engineering (Tampa, FL — open to remote and relocation). Static
HTML/CSS/JS, no build step, deployed on Vercel.

## Site structure

A deliberately lean two-page site, plus a SQL playground and one archived
project page:

- **Home** (`index.html`, `/`) — intro, availability and contact buttons
  (résumé PDF, email, LinkedIn, GitHub), a three-line "now" strip, three
  featured projects, an experience timeline, credentials (B.S. Biology, Towson)
  and a toolkit grouped into data stack / forecasting & ML / platforms run at
  ZooTampa, a short about, and the fastest ways to connect.
- **Projects** (`projects.html`, `/projects`) — featured: the Fraud Detection
  Pipeline (running on a schedule; links to the branch that holds the code),
  Owl Park (live at exploreowlpark.com), and Lighthouse; then Quack Query,
  USL Attendance Forecasting, Roll Call, eFrog (live), Attendance Nowcast,
  Member Segmentation (RFM), and the archived Owl Park data architecture.
  Cards have anchor ids (`#fraud`, `#owl-park`, `#lighthouse`, …) so the home
  page and legacy redirects can deep-link to them. The home page repeats the
  three featured cards in shorter form, so keep the two in step when editing
  card copy.
- **SQL Playground** (`playground.html`, `/playground`) — an in-browser SQL
  box: DuckDB-Wasm (pinned, from jsDelivr, loaded only on this page) over
  synthetic Owl Park ticket and webstore data, with starter queries, a
  results table, and CSV download. See "SQL playground data" below.
- **Owl Park** (`owl-park-infographic.html`, `/owl-park`) — a standalone
  infographic of the archived end-to-end data pipeline.
- **404** (`404.html`) — branded not-found page.

Clean URLs (`/projects`, `/playground`, `/owl-park`) and legacy redirects (e.g. `/fraud` →
`/projects#fraud`, `/pipeline` → `/owl-park`) are configured in `vercel.json`.

## Design: "Barn Owl"

The palette is taken from the barn owl (*Tyto alba*): the pale heart-shaped
facial disc and cream breast as the page surfaces, deep eye-brown as ink, the
plumage browns (tan → caramel → chestnut → umber) as warm accents, and one
creamy, milk-washed blue as the action color (links, buttons, focus ring,
soft fills). Day is the default theme; Night follows
`prefers-color-scheme: dark`. Every text/background pair meets WCAG AA.

Type is Fraunces (display, 600) for headlines and Figtree for everything else,
loaded from Google Fonts; code uses the system monospace stack. Corners are
soft and tappable things are pills.

## Assets

- `assets/tokens.css` — design tokens (Day + Night palette, type, radii,
  shadows, motion). Imported first on every page.
- `assets/shell.css` — ambient background, top bar, nav, footer, focus rings,
  view transitions.
- `assets/pages.css` — page components: hero, now strip, project cards,
  experience timeline, chips and toolkit groups, about, connect cards, buttons.
- `assets/transition.js` — SPA-style page transitions and the mobile nav.
  Only in-site page swaps fade; the first load paints immediately so the hero
  is on screen at once. Dismissing the mobile nav (Escape, backdrop, burger)
  returns focus to the burger, whose label toggles Open/Close navigation.
- `assets/theme.js` — optional per-company accent theming via `?ink=<company>`
  (see [`docs/referrers.md`](docs/referrers.md)).
- `assets/playground.css` — the `/playground` page only: starter chips,
  editor, run bar, results table, and the table reference.
- `assets/playground.js` — the SQL box (an ES module, loaded only by
  `playground.html`): loads the pinned DuckDB-Wasm, attaches the data file,
  runs and renders queries, and builds the CSV. It also keeps
  `transition.js` from swapping `<main>` in place on in-site links, so
  leaving the page is a full navigation that tears down the DuckDB worker.
  Pinned version and limits are the constants at the top of the file.
- `assets/profilepicture.webp` — circular hero avatar on the home page.
- `assets/crow.png`, `assets/favicon-crow.png`, `mini.jpg` — the crow mark
  (painted via CSS mask), favicon, and alternate (JPEG) icon.
- `assets/og-card.jpg` — 1200×630 share card (generated from the profile
  picture) used as `og:image` on every page, with `summary_large_image`
  Twitter cards.
- `assets/apple-touch-icon.png`, `assets/icon-192.png`, `assets/icon-512.png`
  — home-screen icons referenced from `manifest.json`.
- `assets/loganmansfield.pdf` — résumé served from the site. Every résumé
  link opens it in a new tab (`target="_blank"`) rather than forcing a
  download.

The pages load the minified `.min` variants. After editing any source asset,
regenerate its minified file:

    npx esbuild <src> --minify --outfile=<min> --allow-overwrite

## SQL playground data

`data/playground/owl_park.duckdb.gz` (about 300 KB) is one DuckDB database
file with four tables (`park_days`, `products`, `orders`, `order_items`),
written by the seeded script next to it, `generate.py`. Owl Park is fictional
and the data has no personal fields at all, real or simulated. To change the
data, edit the script and rerun it (`python3 -m pip install duckdb numpy`,
then `python3 data/playground/generate.py`); if you add or rename a column,
update the table reference in `playground.html`. The file is written in
DuckDB's v1.1.0 storage format to match the pinned DuckDB-Wasm 1.29.0; move
both together.

How the page keeps visitor queries safe (all of it runs on the visitor's own
device, and there is no key, backend, or database connection on the page):

- The database is attached `READ_ONLY`, so `INSERT`, `UPDATE`, `DELETE`,
  `CREATE` and `DROP` on it fail; temp tables live only in that tab.
- After setup `assets/playground.js` turns off extension autoinstall and
  autoload and `enable_external_access` (no file or URL reads, `ATTACH`,
  `COPY`, `INSTALL`/`LOAD`), then sets `lock_configuration`, so a query
  can't switch any of that back on.
- `vercel.json` gives `/playground` a Content-Security-Policy that only lets
  the page connect to itself and jsDelivr (where the pinned DuckDB-Wasm
  files come from) and blocks inline scripts; the page has no inline script
  for that reason.
- Results are written with `textContent`, never as HTML.
- A result is read up to 200,000 rows (the first 500 are shown; the CSV
  download holds what was read). Cancel, or a 30-second watchdog, stops a
  query; if DuckDB doesn't stop within a moment, the worker is thrown away
  and restarted on the next run. DuckDB's working memory is capped at 256 MB,
  so an oversized query fails with an error instead of exhausting the tab.
- On a Save-Data connection nothing downloads until the first Run.

## Search and sharing metadata

The goal is that a search for "Logan Mansfield" (with or without ZooTampa /
analytics / data) lands on this site with accurate, self-owned information.
Everything lives in the page `<head>` and a few root files — body copy is not
part of it:

- **Head tags** — every page (404 included) has a unique `<title>`, meta
  description, Open Graph tags, the shared `og:image` card, and
  `summary_large_image` Twitter cards (`@StatBird`); the four content pages
  also set `author`, `og:site_name` and `og:locale`. The home page is
  `og:type` `profile` (with `profile:first_name` / `profile:last_name`); the
  others are `website`.
- **Structured data (JSON-LD)** — the home page carries a `WebSite`,
  `ProfilePage`, and `Person` graph: given/family name, both job titles
  (IT Point of Sale Systems Analyst at ZooTampa at Lowry Park, and Data
  Analyst), `worksFor`, `hasOccupation`, `alumniOf`, `hasCredential`
  (certifications and degree), `knowsAbout`, and `sameAs` profile links —
  enough to disambiguate from other people with the same name. Projects,
  SQL Playground and Owl Park are `WebPage`s that reference the home
  `#person` / `#website` ids and carry `BreadcrumbList`s.
- **`sitemap.xml`** / **`robots.txt`** — the four public URLs; bump each
  `<lastmod>` when its page changes.
- **`llms.txt`** — a short, factual plain-text summary (role, employer,
  education, certification, pages, profiles) for AI answer engines. Keep it
  in sync with the structured data and the résumé.

Framing rule for all of the above: the day job is systems ownership (Galaxy
ticketing, eGalaxy webstores, PAR Pixel POS, vendors, park-wide POS
hardware); SQL/Python/Power BI are portfolio and analyst skills. Don't claim
anything Logan hasn't confirmed (no CRM ownership, UAT, M365/D365
admin, or dbt as a skill).

## Local development

No build step — serve the folder and open it:

    python3 -m http.server 8000

Note that `vercel.json` clean URLs/redirects and headers (including the
`/playground` Content-Security-Policy) aren't applied by a plain static
server, so open `/playground.html` directly and expect the page to run
without the CSP; `vercel dev` reproduces production routing and headers if
needed.

## Validation gate

Portfolio changes are validated with the `no-mistakes` skill (`/no-mistakes`)
before opening a PR. See [`CLAUDE.md`](CLAUDE.md) for setup and environment
notes.

## Owl Park (archived project)

An earlier end-to-end pipeline built around a simulated ticket-sales
ecosystem: n8n agents generated demand and managed stock, data landed in
Supabase, Microsoft Fabric modeled it with a medallion architecture, and
Power BI turned it into decisions. A few visuals from that work:

![Purchasing agent workflow](PurchaseAgents.png)
![Warehouse replenishment agent](WarehouseAgent.png)
![Dynamic pricing experiment](DynamicPricing.png)
![Pipeline asset lineage](GlobalAssetLineage.png)
![Dagster assets](Assets.png)
![Power BI dashboard](whole_dashboard.png)
