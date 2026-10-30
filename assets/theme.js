/* Per-company accent theming via ?ink=<company> — cosmetic, client-side only.
 * Swaps ONLY the action color (links, buttons, focus ring, soft fills); the
 * cream canvas and layout are unchanged so contrast stays AA. No match ->
 * the default creamy-blue accent.
 *
 * `accent` is the brand-exact color used for button fills and the soft tint.
 * `ink` is the link-text color in Day: brand colors that dip under WCAG AA
 * (4.5:1) as small text on the cream card surface (--surface-1, #f6eee2)
 * are darkened until they pass; where the brand color already clears AA it
 * equals `accent`.
 * `inkDark` is the link-text color in Night, lifted toward white until it
 * clears AA on the Night card surface (--surface-1, #261c15).
 * `on` is the text/icon color that sits on top of an accent fill (the CTA);
 * it is used in both schemes because the fill stays brand-exact.
 *
 * Add companies here and document them in docs/referrers.md. */
(function () {
    var THEMES = {
        netflix:   { accent: '#e50914', ink: '#d70813', inkDark: '#ec4f57', on: '#ffffff' },
        meta:      { accent: '#0866ff', ink: '#0860f1', inkDark: '#3682ff', on: '#ffffff' },
        google:    { accent: '#4285f4', ink: '#3469c1', inkDark: '#4285f4', on: '#06141a' },
        stripe:    { accent: '#635bff', ink: '#5c54ec', inkDark: '#7c75ff', on: '#ffffff' },
        amazon:    { accent: '#ff9900', ink: '#9a5d00', inkDark: '#ff9900', on: '#06141a' },
        microsoft: { accent: '#00a4ef', ink: '#0072a6', inkDark: '#00a4ef', on: '#06141a' },
        spotify:   { accent: '#1ed760', ink: '#117c37', inkDark: '#1ed760', on: '#06141a' },
        linkedin:  { accent: '#0a66c2', ink: '#0a66c2', inkDark: '#458bd1', on: '#ffffff' },
        anthropic: { accent: '#d97757', ink: '#9f5740', inkDark: '#d97757', on: '#06141a' },
        claude:    { accent: '#d97757', ink: '#9f5740', inkDark: '#d97757', on: '#06141a' }
    };
    try {
        var key = new URLSearchParams(window.location.search).get('ink');
        if (!key) return;
        var t = THEMES[key.toLowerCase()];
        if (!t) return;
        var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        var ink = dark ? t.inkDark : t.ink;
        var s = document.documentElement.style;
        s.setProperty('--accent', t.accent);
        s.setProperty('--accent-ink', ink);
        s.setProperty('--on-accent', t.on);
        s.setProperty('--focus-ring', ink);
        s.setProperty('--accent-soft', 'color-mix(in srgb, ' + t.accent + ' ' + (dark ? '34%' : '22%') + ', ' + (dark ? '#1b140f' : '#fdf9f3') + ')');
        s.setProperty('--accent-mist', 'color-mix(in srgb, ' + t.accent + ' ' + (dark ? '20%' : '10%') + ', ' + (dark ? '#1b140f' : '#fdf9f3') + ')');
        s.setProperty('--accent-glow', 'color-mix(in srgb, ' + t.accent + ' 16%, transparent)');
    } catch (e) { /* no-op */ }
})();
