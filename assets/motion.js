/* ─────────────────────────────────────────────────────────────
 * motion.js — the walking owl and scroll reveals.
 *
 * Self-contained: it injects its own small stylesheet, so a page opts in
 * with one tag (`<script defer src="/assets/motion.min.js"></script>`)
 * and nothing in shell.css / pages.css depends on it.
 *
 *  1. Owl lane. A short strip between <main> and the footer where a barn
 *     owl (art from Owl Park, github.com/lmansf/Welcome-to-Owl-Park) waddles
 *     along the footer's top edge. The owl is a link to exploreowlpark.com.
 *     It lives in its own reserved strip, so it never sits on top of text
 *     or buttons. Visitors can hide it ("Hide owl"); the choice is kept in
 *     localStorage. It only animates while the strip is on screen and the
 *     tab is visible. With prefers-reduced-motion it stands still.
 *  2. Scroll reveals. Cards and section heads that start below the fold
 *     fade up as they scroll into view. Off with reduced motion, without
 *     IntersectionObserver, and for print. Re-runs after transition.js
 *     swaps <main> on in-site navigation.
 * Full page loads between pages (e.g. to and from 404) fade via the
 * cross-document `@view-transition` opt-in in shell.css, not here: the
 * inbound page is checked for it at first render, before deferred scripts
 * run. In-site Home <-> Projects navigation keeps transition.js's own
 * View Transition.
 * ───────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var PARK_URL = 'https://exploreowlpark.com';
    var STORE_KEY = 'owl-walker-hidden';
    var OWL_SRC = '/assets/owl-walker.webp';
    var BLINK_SRC = '/assets/owl-walker-blink.webp';

    var mql = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    function reduceMotion() { return !!(mql && mql.matches); }

    /* ─── Styles ─── */
    var CSS = [
        /* Owl lane: its own space above the footer. */
        '.owl-lane { position: relative; z-index: 1; width: 100%; max-width: var(--max-w, 920px); margin: auto auto 0; padding: 0 var(--gutter, 1rem); height: 60px; box-sizing: border-box; pointer-events: none; }',
        '.owl-lane + footer.shell-footer { margin-top: 0; }',
        '.owl-lane__track { position: relative; height: 100%; margin-right: 5.5rem; }',
        '.owl-lane.is-hidden { height: 34px; }',
        '.owl-lane.is-hidden .owl-walker { display: none; }',

        '.owl-walker { position: absolute; left: 0; bottom: 0; width: 44px; height: 55px; display: block; pointer-events: auto; text-decoration: none; will-change: transform; -webkit-tap-highlight-color: transparent; }',
        '.owl-walker:focus-visible { outline: 2px solid var(--focus-ring, #35607b); outline-offset: 4px; border-radius: var(--r-sm, 8px); }',
        '.owl-walker__face { position: absolute; inset: 0; transform-origin: 50% 100%; }',
        '.owl-walker.is-right .owl-walker__face { transform: scaleX(-1); }',
        '.owl-walker__sprite { position: absolute; inset: 0; transform-origin: 50% 100%; }',
        '.owl-walker__sprite img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; user-select: none; -webkit-user-drag: none; }',
        '.owl-walker__sprite img + img { visibility: hidden; }',
        '.owl-walker.is-blink .owl-walker__sprite img + img { visibility: visible; }',
        '.owl-walker.is-blink .owl-walker__sprite img:first-child { visibility: hidden; }',
        '.owl-walker.is-walking .owl-walker__sprite { animation: owl-waddle 0.42s ease-in-out infinite alternate; }',
        '@keyframes owl-waddle { from { transform: rotate(-5deg) translateY(0); } to { transform: rotate(5deg) translateY(-2px); } }',
        '.owl-walker.is-hop .owl-walker__sprite { animation: owl-hop 0.5s cubic-bezier(0.34, 1.4, 0.64, 1); }',
        '@keyframes owl-hop { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-9px) scaleY(1.04); } 70% { transform: translateY(0) scaleY(0.94); } }',

        /* Speech bubble: floats above the owl's head, into main's empty bottom padding. */
        '.owl-walker__bubble { position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translate(calc(-50% + var(--bubble-shift, 0px)), 4px); white-space: nowrap; font: 600 0.78rem/1.2 var(--font-text, system-ui, sans-serif); color: var(--ink-1, #3a281c); background: var(--surface-1, #f6eee2); border: 1px solid var(--hairline, #e4d5c0); border-radius: var(--r-pill, 999px); padding: 0.32rem 0.7rem; box-shadow: var(--shadow-sm, 0 1px 2px rgba(0,0,0,.1)); opacity: 0; transition: opacity 180ms ease, transform 180ms ease; pointer-events: none; }',
        '.owl-walker__bubble::after { content: ""; position: absolute; top: 100%; left: calc(50% - var(--bubble-shift, 0px)); margin-left: -5px; border: 5px solid transparent; border-top-color: var(--surface-1, #f6eee2); }',
        '.owl-walker:hover .owl-walker__bubble, .owl-walker:focus-visible .owl-walker__bubble, .owl-walker.is-talking .owl-walker__bubble { opacity: 1; transform: translate(calc(-50% + var(--bubble-shift, 0px)), 0); }',

        '.owl-lane__toggle { position: absolute; right: var(--gutter, 1rem); bottom: 10px; pointer-events: auto; font: 500 0.75rem/1 var(--font-text, system-ui, sans-serif); color: var(--ink-3, #6f5945); background: transparent; border: 1px solid transparent; border-radius: var(--r-pill, 999px); padding: 0.4rem 0.65rem; cursor: pointer; }',
        '.owl-lane__toggle:hover { color: var(--ink-1, #3a281c); background: var(--surface-2, #ede1cf); }',
        '.owl-lane__toggle:focus-visible { outline: 2px solid var(--focus-ring, #35607b); outline-offset: 2px; }',

        /* Scroll reveals: only applied by JS, only to elements below the fold. */
        '.reveal { opacity: 0; transform: translateY(14px); transition: opacity 520ms var(--ease-out, ease-out), transform 520ms var(--ease-out, ease-out); transition-delay: var(--reveal-delay, 0ms); }',
        '.reveal.is-revealed { opacity: 1; transform: none; }',

        '@media (prefers-reduced-motion: reduce) { .owl-walker__sprite { animation: none !important; } .reveal { opacity: 1; transform: none; transition: none; } }',
        '@media print { .owl-lane { display: none; } .reveal { opacity: 1 !important; transform: none !important; } }'
    ].join('\n');

    function injectStyles() {
        if (document.getElementById('motion-styles')) return;
        var style = document.createElement('style');
        style.id = 'motion-styles';
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    /* ─── Storage (may throw in private windows) ─── */
    function isHidden() {
        try { return window.localStorage.getItem(STORE_KEY) === '1'; } catch (e) { return false; }
    }
    function setHidden(v) {
        try {
            if (v) window.localStorage.setItem(STORE_KEY, '1');
            else window.localStorage.removeItem(STORE_KEY);
        } catch (e) { /* ignore */ }
    }

    /* ─────────────────────────────────────────────────────────────
     * 1. The owl
     * ───────────────────────────────────────────────────────────── */
    function mountOwl() {
        var footer = document.querySelector('footer.shell-footer');
        if (!footer || document.querySelector('.owl-lane')) return;

        var lane = document.createElement('div');
        lane.className = 'owl-lane';
        lane.innerHTML =
            '<div class="owl-lane__track">' +
                '<a class="owl-walker" href="' + PARK_URL + '" target="_blank" rel="noopener" ' +
                    'aria-label="Visit Owl Park, my online owl park (opens in a new tab)">' +
                    '<span class="owl-walker__bubble" aria-hidden="true">Visit Owl Park ↗</span>' +
                    '<span class="owl-walker__face"><span class="owl-walker__sprite">' +
                        '<img alt="" width="44" height="55" decoding="async" draggable="false">' +
                        '<img alt="" width="44" height="55" decoding="async" draggable="false">' +
                    '</span></span>' +
                '</a>' +
            '</div>' +
            '<button type="button" class="owl-lane__toggle"></button>';
        footer.parentNode.insertBefore(lane, footer);

        var track = lane.querySelector('.owl-lane__track');
        var owl = lane.querySelector('.owl-walker');
        var bubble = owl.querySelector('.owl-walker__bubble');
        var imgs = owl.querySelectorAll('img');
        var toggle = lane.querySelector('.owl-lane__toggle');

        var OWL_W = 44;
        var x = 0;
        var target = 0;
        var speed = 34;            // px per second
        var state = 'idle';
        var idleUntil = 0;
        var nextBlink = 0;
        var blinkOff = 0;
        var lastT = 0;
        var raf = 0;
        var inView = false;
        var greeted = false;
        var pointerOver = false;
        var focusPaused = false;
        var loaded = false;

        function paused() { return pointerOver || focusPaused; }
        function maxX() { return Math.max(0, track.clientWidth - OWL_W); }
        function rand(a, b) { return a + Math.random() * (b - a); }

        function loadArt() {
            if (loaded) return;
            loaded = true;
            imgs[0].src = OWL_SRC;
            imgs[1].src = BLINK_SRC;
        }

        function place() {
            owl.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0)';
            if (paused() || owl.classList.contains('is-talking')) placeBubble();
        }

        // Keep the bubble inside the viewport: it is centred on the owl, which can
        // stand a few px from the screen edge on phones (body clips overflow-x).
        function placeBubble() {
            var pad = 8;
            var half = bubble.offsetWidth / 2;
            var centre = track.getBoundingClientRect().left + x + OWL_W / 2;
            var vw = document.documentElement.clientWidth || window.innerWidth;
            var shift = 0;
            if (centre - half < pad) shift = pad - (centre - half);
            else if (centre + half > vw - pad) shift = (vw - pad) - (centre + half);
            owl.style.setProperty('--bubble-shift', shift.toFixed(1) + 'px');
        }

        function setToggleLabel() {
            var hidden = lane.classList.contains('is-hidden');
            toggle.textContent = hidden ? 'Show owl' : 'Hide owl';
            toggle.setAttribute('aria-label', hidden ? 'Show the owl' : 'Hide the owl');
        }

        function talk(ms) {
            placeBubble();
            owl.classList.add('is-talking');
            clearTimeout(talk.t);
            talk.t = setTimeout(function () { owl.classList.remove('is-talking'); }, ms);
        }

        function pickTarget() {
            var m = maxX();
            if (m < 40) { target = x; return; }
            var t = x;
            for (var i = 0; i < 6 && Math.abs(t - x) < Math.min(80, m / 3); i++) t = rand(0, m);
            target = t;
        }

        function startIdle(t) {
            state = 'idle';
            owl.classList.remove('is-walking');
            idleUntil = t + rand(1400, 4200);
            if (Math.random() < 0.22) {
                owl.classList.remove('is-hop');
                void owl.offsetWidth; // restart the hop animation
                owl.classList.add('is-hop');
                setTimeout(function () { owl.classList.remove('is-hop'); }, 520);
            }
        }

        function frame(t) {
            raf = 0;
            if (!inView || document.hidden || reduceMotion() || lane.classList.contains('is-hidden')) { lastT = 0; return; }
            var dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
            if (!lastT && state === 'idle') idleUntil = t + rand(1400, 4200);
            lastT = t;

            // Blink now and then.
            if (!nextBlink) nextBlink = t + rand(2000, 5000);
            if (t >= nextBlink && !blinkOff) { owl.classList.add('is-blink'); blinkOff = t + 140; }
            if (blinkOff && t >= blinkOff) { owl.classList.remove('is-blink'); blinkOff = 0; nextBlink = t + rand(2500, 6000); }

            if (paused()) {
                owl.classList.remove('is-walking');
            } else if (state === 'idle') {
                if (t >= idleUntil && !owl.classList.contains('is-talking')) {
                    pickTarget();
                    if (Math.abs(target - x) > 2) {
                        state = 'walk';
                        owl.classList.toggle('is-right', target > x);
                        owl.classList.add('is-walking');
                    } else {
                        idleUntil = t + 2000;
                    }
                }
            } else if (state === 'walk') {
                owl.classList.add('is-walking');
                var step = speed * dt;
                var d = target - x;
                if (Math.abs(d) <= step) { x = target; startIdle(t); }
                else x += step * (d > 0 ? 1 : -1);
                x = Math.min(Math.max(0, x), maxX());
                place();
            }
            raf = requestAnimationFrame(frame);
        }

        function run() {
            if (reduceMotion()) return; // stands still
            if (!raf) raf = requestAnimationFrame(frame);
        }

        function settle() {
            // Starting / resting spot. Reduced motion: stand at the left end.
            x = reduceMotion() ? 0 : Math.min(x, maxX());
            if (!x && !reduceMotion()) x = Math.round(maxX() * 0.15);
            place();
        }

        var hasPointer = 'PointerEvent' in window;
        owl.addEventListener(hasPointer ? 'pointerenter' : 'mouseenter', function () { pointerOver = true; placeBubble(); });
        owl.addEventListener(hasPointer ? 'pointerleave' : 'mouseleave', function () { pointerOver = false; });
        if (hasPointer) owl.addEventListener('pointercancel', function () { pointerOver = false; });
        owl.addEventListener('focus', function () {
            var keyboard = true;
            try { keyboard = owl.matches(':focus-visible'); } catch (e) { /* ignore */ }
            focusPaused = keyboard;
            if (keyboard) placeBubble();
        });
        owl.addEventListener('blur', function () { focusPaused = false; });

        toggle.addEventListener('click', function () {
            var hide = !lane.classList.contains('is-hidden');
            lane.classList.toggle('is-hidden', hide);
            setHidden(hide);
            setToggleLabel();
            if (!hide) { loadArt(); settle(); talk(2600); run(); }
        });

        if (isHidden()) lane.classList.add('is-hidden');
        setToggleLabel();
        settle();

        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) {
                entries.forEach(function (e) {
                    inView = e.isIntersecting;
                    if (!inView || lane.classList.contains('is-hidden')) return;
                    loadArt();
                    if (!greeted) { greeted = true; talk(3200); }
                    run();
                });
            }, { rootMargin: '200px 0px' }).observe(lane);
        } else {
            inView = true;
            if (!lane.classList.contains('is-hidden')) loadArt();
            run();
        }

        document.addEventListener('visibilitychange', function () { if (!document.hidden) run(); });
        window.addEventListener('resize', function () { x = Math.min(x, maxX()); target = Math.min(target, maxX()); place(); });
        if (mql && mql.addEventListener) {
            mql.addEventListener('change', function () { owl.classList.remove('is-walking'); state = 'idle'; settle(); run(); });
        }
    }

    /* ─────────────────────────────────────────────────────────────
     * 2. Scroll reveals
     * ───────────────────────────────────────────────────────────── */
    var CARD_SELECTOR = [
        '.section-head', '.project', '.xp__item', '.toolkit__group',
        '.now__row', '.about', '.connect', '.contact-row', '.projects-more'
    ].join(',');

    var revealObserver = null;

    function scanReveals() {
        if (reduceMotion() || !('IntersectionObserver' in window)) return;
        var main = document.querySelector('main');
        if (!main) return;

        if (!revealObserver) {
            revealObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (e) {
                    if (!e.isIntersecting) return;
                    var el = e.target;
                    el.classList.add('is-revealed');
                    el.setAttribute('data-revealed', '');
                    revealObserver.unobserve(el);
                    // Hand the element back to its own styles (e.g. the .project hover lift).
                    setTimeout(function () {
                        el.classList.remove('reveal', 'is-revealed');
                        el.style.removeProperty('--reveal-delay');
                    }, 820);
                });
            }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
        }

        // Known blocks first; any top-level section with none of them is revealed whole,
        // so a renamed or new section still gets the effect.
        var targets = Array.prototype.slice.call(main.querySelectorAll(CARD_SELECTOR));
        Array.prototype.forEach.call(main.querySelectorAll(':scope > section'), function (s) {
            if (!s.querySelector(CARD_SELECTOR) && !s.matches(CARD_SELECTOR)) targets.push(s);
        });

        var fold = window.innerHeight || document.documentElement.clientHeight;
        var siblingCount = new Map();
        targets.forEach(function (el) {
            if (el.classList.contains('reveal') || el.hasAttribute('data-revealed')) return;
            // Skip anything nested in another target (no double animation).
            for (var p = el.parentElement; p && p !== main; p = p.parentElement) {
                if (targets.indexOf(p) !== -1) return;
            }
            // Only hide what starts below the fold, so nothing already on screen blinks out.
            if (el.getBoundingClientRect().top < fold) return;
            var parent = el.parentElement;
            var n = siblingCount.get(parent) || 0;
            siblingCount.set(parent, n + 1);
            el.style.setProperty('--reveal-delay', Math.min(n, 3) * 70 + 'ms');
            el.classList.add('reveal');
            revealObserver.observe(el);
        });
    }

    function watchMainSwaps() {
        var main = document.querySelector('main');
        if (!main || !('MutationObserver' in window)) return;
        var pending = 0;
        new MutationObserver(function () {
            if (pending) return;
            pending = requestAnimationFrame(function () { pending = 0; scanReveals(); });
        }).observe(main, { childList: true });
    }

    function init() {
        injectStyles();
        mountOwl();
        // Let transition.js's first-paint fade settle before measuring the fold.
        requestAnimationFrame(function () { scanReveals(); });
        watchMainSwaps();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
