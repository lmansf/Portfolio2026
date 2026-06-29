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

## URLs
| Company  | URL                                  |
|----------|--------------------------------------|
| Netflix  | `https://<site>/?for=netflix`        |
| Meta     | `https://<site>/?for=meta`           |
| Google   | `https://<site>/?for=google`         |
| Spotify  | `https://<site>/?for=spotify`        |
| Amazon   | `https://<site>/?for=amazon`         |

(Keys are case-insensitive. Works on any page, e.g. `/projects?for=meta`.)

## Current palette
| Key      | Accent     | Text-on-accent |
|----------|------------|----------------|
| netflix  | `#f6121d`  | `#ffffff`      |
| meta     | `#3897ff`  | `#06141a`      |
| google   | `#5b9bff`  | `#06141a`      |
| spotify  | `#1ed760`  | `#06141a`      |
| amazon   | `#ff9900`  | `#06141a`      |

## Add a company
Edit the `THEMES` object in `assets/theme.js`, then regenerate the minified file:

    npx esbuild assets/theme.js --minify --outfile=assets/theme.min.js --allow-overwrite

Pick an accent bright enough to read on the near-black background (`#0c1116`)
— aim for ≥4.5:1 as link text — and set `on` (text shown on accent-filled
buttons) to dark `#06141a` for bright accents or `#ffffff` for dark ones.
Note: very dark brand reds (e.g. authentic Netflix red) can't fully hit AA on
the button text; that's expected for those specific brands.
