# Per-company referrer color themes

Send the portfolio with a company key appended and the site loads in that
company's brand accent instead of the default electric cyan. Purely cosmetic
and client-side (no tracking); the public link stays cyan.

## How it works
`assets/theme.js` runs synchronously in each page's `<head>` (before paint, so
there's no color flash). It reads the `?for=` query parameter, looks it up in
the `THEMES` map, and overrides the accent CSS variables on `:root`
(`--accent`, `--accent-ink`, `--on-accent`, `--focus-ring`). The accent glow
derives from `--accent` automatically. Unknown / missing key → default cyan.

Only the **accent** changes — the dark canvas and layout stay, so contrast
remains legible.

Each theme has three values:
- **`accent`** — the brand-*exact* hex. Used for fills, the waveform mark,
  corner ticks and the ambient glow.
- **`ink`** — the link-text color. A few brand colors (Netflix/Meta/Stripe)
  dip just under WCAG AA (4.5:1) as small text on the near-black canvas, so
  `ink` lifts them a touch toward white for legibility. Where the brand color
  already clears AA (Google/Amazon), `ink` equals `accent`.
- **`on`** — text/icons that sit *on top* of an accent fill (the CTA button).

## URLs
| Company  | URL                                  |
|----------|--------------------------------------|
| Netflix  | `https://<site>/?for=netflix`        |
| Meta     | `https://<site>/?for=meta`           |
| Google   | `https://<site>/?for=google`         |
| Stripe   | `https://<site>/?for=stripe`         |
| Amazon   | `https://<site>/?for=amazon`         |

(Keys are case-insensitive. Works on any page, e.g. `/projects?for=meta`.)

## Current palette (official brand colors)
| Key      | Accent (brand) | Link ink   | Text-on-accent | Notes                          |
|----------|----------------|------------|----------------|--------------------------------|
| netflix  | `#e50914`      | `#ea3a43`  | `#ffffff`      | Netflix Red                    |
| meta     | `#0866ff`      | `#2678ff`  | `#ffffff`      | Meta Blue                      |
| google   | `#4285f4`      | `#4285f4`  | `#06141a`      | Google Blue (already AA)       |
| stripe   | `#635bff`      | `#6f68ff`  | `#ffffff`      | Stripe "blurple"               |
| amazon   | `#ff9900`      | `#ff9900`  | `#06141a`      | Amazon Orange (already AA)     |

## Add a company
Edit the `THEMES` object in `assets/theme.js`, then regenerate the minified file:

    npx esbuild assets/theme.js --minify --outfile=assets/theme.min.js --allow-overwrite

Set `accent` to the brand-exact hex. Then check its contrast as link text on
the near-black background (`#0c1116`): if it clears 4.5:1, set `ink` equal to
`accent`; if it falls short, blend it a little toward white until it clears
~4.6:1 and use that for `ink`. Set `on` (text shown on accent-filled buttons)
to dark `#06141a` for bright accents or `#ffffff` for dark/saturated ones.
