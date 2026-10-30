/* Per-company accent theming via ?ink=<company> — cosmetic, client-side only.
 * Swaps ONLY the action color (links, buttons, focus ring, soft fills); the
 * cream canvas and layout are unchanged so contrast stays AA. No match ->
 * the default creamy-blue accent.
 *
 * `accent` is the brand-exact color used for button fills and the soft tint.
 * `ink` is the link-text color on the light (Day) canvas: brand colors that
 * dip under WCAG AA (4.5:1) as small text on cream are darkened until they
 * pass; where the brand color already clears AA it equals `accent`.
 * `inkDark` is the link-text color used when the visitor prefers dark mode
 * (the Night canvas), where the brand-exact color is already legible.
 * `on` is the text/icon color that sits on top of an accent fill (the CTA).
 *
 * Add companies here and document them in docs/referrers.md. */
(function () {
    var THEMES = {
        netflix:   { accent: '#e50914', ink: '#e00813', inkDark: '#ea3a43', on: '#ffffff' },
        meta:      { accent: '#0866ff', ink: '#0763f9', inkDark: '#2678ff', on: '#ffffff' },
        google:    { accent: '#4285f4', ink: '#376fcc', inkDark: '#4285f4', on: '#06141a' },
        stripe:    { accent: '#635bff', ink: '#6159f9', inkDark: '#6f68ff', on: '#ffffff' },
        amazon:    { accent: '#ff9900', ink: '#a36100', inkDark: '#ff9900', on: '#06141a' },
        microsoft: { accent: '#00a4ef', ink: '#0076ac', inkDark: '#00a4ef', on: '#06141a' },
        spotify:   { accent: '#1ed760', ink: '#118039', inkDark: '#1ed760', on: '#06141a' },
        linkedin:  { accent: '#0a66c2', ink: '#0a66c2', inkDark: '#3682cd', on: '#ffffff' },
        anthropic: { accent: '#d97757', ink: '#a95c43', inkDark: '#d97757', on: '#06141a' },
        claude:    { accent: '#d97757', ink: '#a95c43', inkDark: '#d97757', on: '#06141a' }
    };
    try {
        var key = new URLSearchParams(window.location.search).get('ink');
        if (!key) return;
        var t = THEMES[key.toLowerCase()];
        if (!t) return;
        var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        var ink = dark ? t.inkDark : t.ink;
        var s = document.documentElement.style;
        s.setProperty('--accent', dark ? t.inkDark : t.accent);
        s.setProperty('--accent-ink', ink);
        s.setProperty('--on-accent', dark ? '#1b140f' : t.on);
        s.setProperty('--focus-ring', ink);
        s.setProperty('--accent-soft', 'color-mix(in srgb, ' + t.accent + ' ' + (dark ? '34%' : '22%') + ', ' + (dark ? '#1b140f' : '#fdf9f3') + ')');
        s.setProperty('--accent-mist', 'color-mix(in srgb, ' + t.accent + ' ' + (dark ? '20%' : '10%') + ', ' + (dark ? '#1b140f' : '#fdf9f3') + ')');
        s.setProperty('--accent-glow', 'color-mix(in srgb, ' + t.accent + ' 16%, transparent)');
    } catch (e) { /* no-op */ }
})();
