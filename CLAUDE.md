# Portfolio2026 — working notes

Static HTML/CSS/JS portfolio (no build step), deployed on Vercel. Routing is in
`vercel.json`; design tokens in `assets/tokens.css` (the "Barn Owl" palette:
cream surfaces, brown ink, creamy-blue action color, Day + Night themes);
minified `.min` assets are what the pages load, so regenerate them after
editing source (esbuild is fine:
`npx esbuild <src> --minify --outfile=<min> --allow-overwrite`).

Text colors must stay WCAG AA on every surface token: chestnut, the blue
accent, and the ink tokens pass; tan and caramel are fills, not text.

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
