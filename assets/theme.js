/* Per-company accent theming via ?for=<company> — cosmetic, client-side only.
 * Swaps ONLY the accent (links, mark, ticks, CTA, glow); the dark canvas and
 * layout are unchanged so contrast stays AA. No match -> default cyan brand.
 * Add companies here and document them in docs/referrers.md. */
(function () {
    var THEMES = {
        netflix: { accent: '#f6121d', on: '#ffffff' },
        meta:    { accent: '#3897ff', on: '#06141a' },
        google:  { accent: '#5b9bff', on: '#06141a' },
        spotify: { accent: '#1ed760', on: '#06141a' },
        amazon:  { accent: '#ff9900', on: '#06141a' }
    };
    try {
        var key = new URLSearchParams(window.location.search).get('for');
        if (!key) return;
        var t = THEMES[key.toLowerCase()];
        if (!t) return;
        var s = document.documentElement.style;
        s.setProperty('--accent', t.accent);
        s.setProperty('--accent-ink', t.accent);
        s.setProperty('--on-accent', t.on);
        s.setProperty('--focus-ring', t.accent);
    } catch (e) { /* no-op */ }
})();
