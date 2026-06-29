/* Per-company accent theming via ?for=<company> — cosmetic, client-side only.
 * Swaps ONLY the accent (links, mark, ticks, CTA, glow); the dark canvas and
 * layout are unchanged so contrast stays AA. No match -> default cyan brand.
 *
 * `accent` is the brand-exact color used for fills, the waveform mark, corner
 * ticks and the ambient glow. `ink` is the link-text color: for brands whose
 * exact hex dips just under WCAG AA (4.5:1) as small text on the near-black
 * canvas (Netflix/Meta/Stripe), it is lifted a touch toward white so links
 * stay legible; where the brand color already clears AA it equals `accent`.
 * `on` is the text/icon color that sits on top of an accent fill (the CTA).
 *
 * Add companies here and document them in docs/referrers.md. */
(function () {
    var THEMES = {
        netflix: { accent: '#e50914', ink: '#ea3a43', on: '#ffffff' },
        meta:    { accent: '#0866ff', ink: '#2678ff', on: '#ffffff' },
        google:  { accent: '#4285f4', ink: '#4285f4', on: '#06141a' },
        stripe:  { accent: '#635bff', ink: '#6f68ff', on: '#ffffff' },
        amazon:  { accent: '#ff9900', ink: '#ff9900', on: '#06141a' }
    };
    try {
        var key = new URLSearchParams(window.location.search).get('for');
        if (!key) return;
        var t = THEMES[key.toLowerCase()];
        if (!t) return;
        var s = document.documentElement.style;
        s.setProperty('--accent', t.accent);
        s.setProperty('--accent-ink', t.ink);
        s.setProperty('--on-accent', t.on);
        s.setProperty('--focus-ring', t.accent);
    } catch (e) { /* no-op */ }
})();
