# Portfolio2026 — working notes

Static HTML/CSS/JS portfolio (no build step), deployed on Vercel. Routing is in
`vercel.json`; design tokens in `assets/tokens.css` (the "Barn Owl" palette:
cream surfaces, brown ink, creamy-blue action color, Day + Night themes);
minified `.min` assets are what the pages load, so regenerate them after
editing source (esbuild is fine:
`npx esbuild <src> --minify --outfile=<min> --allow-overwrite`).

Text colors must stay WCAG AA on every surface token: chestnut, the blue
accent, and the ink tokens pass; tan and caramel are fills, not text.

Motion extras (the walking Owl Park owl, scroll reveals, button hover/press,
the copy-email button, `data-countup` numbers and the `/live` freshness dot) live only in
`assets/motion.js` and `assets/motion.css` (the script loads the stylesheet
itself, never as an inline `<style>`, which the playground's CSP blocks), so a
page opts in with one deferred script tag; `pages.css` is untouched and `shell.css` only carries
the `@view-transition` opt-in (it must be render-blocking to work). Keep the owl
in its reserved lane above the footer (it must never cover content or
buttons), keep every animation off or static under `prefers-reduced-motion`,
and leave the "Hide owl" choice in localStorage working.

`playground.html` (the DuckDB-Wasm SQL playground) is served with a
Content-Security-Policy from `vercel.json`: no inline scripts, and any new
origin the page loads from must be added to that header. Its data file and
safety limits are described in the README's "SQL playground data" section.

Search/share metadata (head tags, JSON-LD, `sitemap.xml`, `robots.txt`,
`llms.txt`, `assets/og-card.jpg`) is documented in the README's "Search and
sharing metadata" section. When a page's head or facts change, bump that
page's `<lastmod>` in `sitemap.xml` and keep `llms.txt` and the Person
JSON-LD consistent with each other and with the résumé.

The résumé (`assets/loganmansfield.pdf` and `assets/resume_ats.txt`) is
generated, not hand-edited: change `resume-src/resume.md` and run
`python3 resume-src/build.py` (reportlab + Carlito; see the README's
"Assets" section). It must stay one Letter page. Content rules: B.S.
Biology, Towson (2019) leads education; no dbt, CRM ownership, UAT, or
M365/D365 admin; titles and dates unchanged; LinkedIn is `in/lmansf96`.

The `/live` page (`live.html`, `assets/live.*`) is fed by
`data/fraud-snapshot.json`, which the `fraud-snapshot` GitHub Action
regenerates daily from `scripts/fraud-snapshot.sql` and commits to `main`.
Keep the SQL output, the workflow's `jq` allow-list, and `live.js` in step
when fields change; the snapshot holds aggregates only and the page must
never carry a database key. See the README's "Live fraud data" section.

## Validate portfolio PRs through the `no-mistakes` gate

Before opening a pull request for this portfolio, validate the change with the
`no-mistakes` skill (invoke `/no-mistakes`). It runs review → test → lint → docs
locally using the `claude` agent, on a committed feature branch.

Setup is handled automatically by the SessionStart hook
(`.claude/scripts/setup-no-mistakes.sh`); run it manually if needed:

    bash .claude/scripts/setup-no-mistakes.sh

### Environment caveats (Claude Code on the web)
- The container is ephemeral, so the `no-mistakes` CLI is reinstalled each
  session by the setup script (a Go build — a few minutes on first run).
- `gh` is **not** available here, so the gate's push / PR / CI steps cannot run
  in-session. Use `/no-mistakes` for the local validation steps, then open the
  PR through the normal GitHub flow (the `github` MCP tools), as we do today.
