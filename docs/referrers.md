# Per-company referrer color themes

Send the portfolio with a company key appended and the site loads in that
company's brand accent instead of the default creamy blue. Purely cosmetic
and client-side (no tracking); the public link stays blue.

## How it works
`assets/theme.js` runs synchronously in each page's `<head>` (before paint, so
there's no color flash). It reads the `?ink=` query parameter, looks it up in
the `THEMES` map, and overrides the accent CSS variables on `:root`
(`--accent`, `--accent-ink`, `--on-accent`, `--focus-ring`). The accent glow
derives from `--accent` automatically. Unknown / missing key → default creamy blue.

Only the **accent** changes — the cream (or Night) canvas and layout stay, so
contrast remains legible.

(The query parameter is `?ink=`; not to be confused with the per-theme `ink`
field below, which is the link-text color.)

Each theme has four values:
- **`accent`** — the brand-*exact* hex. Used for button fills, the soft tint
  and the ambient glow.
- **`ink`** — the link-text color in Day, darkened until it clears WCAG AA
  (4.5:1) as small text on the cream card surface.
- **`inkDark`** — the link-text color in Night, lifted until it clears AA on
  the Night card surface.
- **`on`** — text/icons that sit *on top* of an accent fill (the CTA button),
  in both schemes.

## URLs
| Company  | URL                                  |
|----------|--------------------------------------|
| Netflix  | `https://<site>/?ink=netflix`        |
| Meta     | `https://<site>/?ink=meta`           |
| Google   | `https://<site>/?ink=google`         |
| Stripe   | `https://<site>/?ink=stripe`         |
| Amazon   | `https://<site>/?ink=amazon`         |
| Microsoft| `https://<site>/?ink=microsoft`      |
| Spotify  | `https://<site>/?ink=spotify`        |
| LinkedIn | `https://<site>/?ink=linkedin`       |
| Anthropic| `https://<site>/?ink=anthropic`      |
| Claude   | `https://<site>/?ink=claude`         |

(Keys are case-insensitive. Works on any page, e.g. `/projects?ink=meta`.)

## Current palette (official brand colors)
| Key      | Accent (brand) | Link ink (Day) | Link ink (Night) | Text-on-accent | Notes                           |
|----------|----------------|----------------|------------------|----------------|---------------------------------|
| netflix  | `#e50914`      | `#d70813`      | `#ec4f57`        | `#ffffff`      | Netflix Red                     |
| meta     | `#0866ff`      | `#0860f1`      | `#3682ff`        | `#ffffff`      | Meta Blue                       |
| google   | `#4285f4`      | `#3469c1`      | `#4285f4`        | `#06141a`      | Google Blue                     |
| stripe   | `#635bff`      | `#5c54ec`      | `#7c75ff`        | `#ffffff`      | Stripe "blurple"                |
| amazon   | `#ff9900`      | `#9a5d00`      | `#ff9900`        | `#06141a`      | Amazon Orange                   |
| microsoft| `#00a4ef`      | `#0072a6`      | `#00a4ef`        | `#06141a`      | Microsoft logo blue             |
| spotify  | `#1ed760`      | `#117c37`      | `#1ed760`        | `#06141a`      | Spotify Green                   |
| linkedin | `#0a66c2`      | `#0a66c2`      | `#458bd1`        | `#ffffff`      | LinkedIn Blue (already AA on Day)|
| anthropic| `#d97757`      | `#9f5740`      | `#d97757`        | `#06141a`      | Claude coral                    |
| claude   | `#d97757`      | `#9f5740`      | `#d97757`        | `#06141a`      | alias of `anthropic`            |

The Day ink column is the brand color darkened until it clears WCAG AA
(4.5:1) as small text on the cream card surface (`--surface-1`, `#f6eee2`,
where most links sit); the Night ink column is the lift that clears AA on
the Night card surface (`#261c15`). Where the brand color already passes,
ink equals accent.

## Add a company
Edit the `THEMES` object in `assets/theme.js`, then regenerate the minified file:

    npx esbuild assets/theme.js --minify --outfile=assets/theme.min.js --allow-overwrite

Set `accent` to the brand-exact hex. Then check its contrast as link text on
the Day card surface (`#f6eee2`): if it clears 4.5:1, set `ink` equal to
`accent`; if it falls short, darken it until it clears ~4.6:1 and use that
for `ink`. Do the same against the Night card surface (`#261c15`) for
`inkDark`, lifting toward white instead. Set `on` (text shown on accent-filled buttons)
to dark `#06141a` for bright accents or `#ffffff` for dark/saturated ones.
