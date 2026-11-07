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
 * clears AA on the Night card surface (--surface-1, #3a4453).
 * `on` is the text/icon color that sits on top of an accent fill (the CTA);
 * it is used in both schemes because the fill stays brand-exact.
 *
 * Add companies here and document them in docs/referrers.md. */
(function () {
    var THEMES = {
        netflix:   { accent: '#e50914', ink: '#d70813', inkDark: '#f4989c', on: '#ffffff' },
        meta:      { accent: '#0866ff', ink: '#0860f1', inkDark: '#84b3ff', on: '#ffffff' },
        google:    { accent: '#4285f4', ink: '#3469c1', inkDark: '#8ab3f8', on: '#06141a' },
        stripe:    { accent: '#635bff', ink: '#5c54ec', inkDark: '#aeaaff', on: '#ffffff' },
        amazon:    { accent: '#ff9900', ink: '#9a5d00', inkDark: '#ff9900', on: '#06141a' },
        microsoft: { accent: '#00a4ef', ink: '#0072a6', inkDark: '#45bdf3', on: '#06141a' },
        spotify:   { accent: '#1ed760', ink: '#117c37', inkDark: '#1ed760', on: '#06141a' },
        linkedin:  { accent: '#0a66c2', ink: '#0a66c2', inkDark: '#89b6e2', on: '#ffffff' },
        anthropic: { accent: '#d97757', ink: '#9f5740', inkDark: '#e5a38d', on: '#06141a' },
        claude:    { accent: '#d97757', ink: '#9f5740', inkDark: '#e5a38d', on: '#06141a' }
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
        s.setProperty('--accent-soft', 'color-mix(in srgb, ' + t.accent + ' ' + (dark ? '34%' : '22%') + ', ' + (dark ? '#283039' : '#fdf9f3') + ')');
        s.setProperty('--accent-mist', 'color-mix(in srgb, ' + t.accent + ' ' + (dark ? '20%' : '10%') + ', ' + (dark ? '#283039' : '#fdf9f3') + ')');
        s.setProperty('--accent-glow', 'color-mix(in srgb, ' + t.accent + ' 16%, transparent)');
    } catch (e) { /* no-op */ }
})();

/* Reading preferences, kept per visitor in localStorage (both off by default):
 *  - Text mode (`text-mode` on <html>): no animation anywhere, no hero
 *    replay, no walking owl, no background texture; just the words. The
 *    switch is the "Text" button in the top bar.
 *  - Projects list view (`projects-list` on <html>): /projects shows a
 *    numbered index (number, title, type, year, links) instead of cards.
 *    The switch is the Cards / List control in the Projects intro.
 * Both classes go on before the first paint (this file is render-blocking
 * in <head>), so a page never flashes the other look. The buttons are
 * `hidden` in the HTML and only shown here, so without JS nothing offers a
 * switch that can't work. Changing text mode fires `textmodechange` on
 * window (detail: { on }) for hero-pipeline.js and motion.js. */
(function () {
    var root = document.documentElement;
    var TEXT_KEY = 'lm-text-mode';
    var VIEW_KEY = 'lm-projects-view';
    function get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function set(k, v) {
        try {
            if (v === null) window.localStorage.removeItem(k);
            else window.localStorage.setItem(k, v);
        } catch (e) { /* private mode: the choice lasts for this page only */ }
    }
    if (get(TEXT_KEY) === '1') root.classList.add('text-mode');
    if (get(VIEW_KEY) === 'list') root.classList.add('projects-list');

    function wire() {
        Array.prototype.forEach.call(document.querySelectorAll('[data-text-mode-toggle]'), function (btn) {
            var sync = function () { btn.setAttribute('aria-pressed', root.classList.contains('text-mode') ? 'true' : 'false'); };
            sync();
            btn.hidden = false;
            btn.addEventListener('click', function () {
                var on = !root.classList.contains('text-mode');
                root.classList.toggle('text-mode', on);
                if (on) root.classList.remove('hero-wait');
                set(TEXT_KEY, on ? '1' : null);
                sync();
                try { window.dispatchEvent(new CustomEvent('textmodechange', { detail: { on: on } })); } catch (e) { /* old browser */ }
            });
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-view-switch]'), function (group) {
            var buttons = group.querySelectorAll('[data-view]');
            var sync = function () {
                var list = root.classList.contains('projects-list');
                Array.prototype.forEach.call(buttons, function (b) {
                    b.setAttribute('aria-pressed', (b.getAttribute('data-view') === 'list') === list ? 'true' : 'false');
                });
            };
            sync();
            group.hidden = false;
            Array.prototype.forEach.call(buttons, function (b) {
                b.addEventListener('click', function () {
                    var list = b.getAttribute('data-view') === 'list';
                    root.classList.toggle('projects-list', list);
                    set(VIEW_KEY, list ? 'list' : null);
                    sync();
                });
            });
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
    else wire();
})();

/* Home hero: hold the pipeline stage's place from the first paint.
 * hero-pipeline.js unhides the stage a moment after load; on a phone that
 * pushed the whole intro down by the stage's height (a big layout shift).
 * With `hero-wait` on <html>, pages.css shows the empty stage and the
 * smaller photo straight away, so nothing moves when the dots start.
 * hero-pipeline.js removes the class when it starts or gives up; if it
 * never runs (blocked or failed to load), the class comes off after a few
 * seconds and the plain hero shows. Other pages have no stage, so the
 * class does nothing there. */
(function () {
    var root = document.documentElement;
    /* Text mode shows the plain hero straight away: nothing to wait for. */
    if (root.classList.contains('text-mode')) return;
    root.classList.add('hero-wait');
    setTimeout(function () {
        if (!document.querySelector('.hero--pipe')) root.classList.remove('hero-wait');
    }, 6000);
})();
