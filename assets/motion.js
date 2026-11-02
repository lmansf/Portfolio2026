/* ─────────────────────────────────────────────────────────────
 * motion.js — the walking owl, scroll reveals and the site's small motion touches.
 *
 * A page opts in with one tag (`<script defer src="/assets/motion.min.js"></script>`);
 * the script loads its own stylesheet (assets/motion.min.css) and nothing in
 * shell.css / pages.css depends on it.
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
 *  3. Copy email: a small copy button beside mailto buttons, with a
 *     "Copied" note.
 *  4. Count-up numbers ([data-countup]) the first time they scroll into view.
 *  5. Live pulse: a dot beside "Live numbers" links showing how fresh the
 *     /live snapshot is.
 * Hover lift and press feedback on buttons and links are plain CSS in
 * motion.css. Everything is off or static with prefers-reduced-motion.
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

    var CSS_HREF = '/assets/motion.min.css';
    var stylesReady = false;

    /* Load motion.css, then call done. External (not inline) so a strict
     * style-src 'self' CSP allows it; done runs once, also on error, so a
     * failed load never leaves reveal targets hidden (they are only tagged
     * after this, and without the stylesheet the tags do nothing). */
    function loadStyles(done) {
        var called = false;
        function finish(ok) { if (called) return; called = true; done(ok); }
        var existing = document.getElementById('motion-styles');
        if (existing) { finish(true); return; }
        var link = document.createElement('link');
        link.id = 'motion-styles';
        link.rel = 'stylesheet';
        link.href = CSS_HREF;
        link.onload = function () { finish(true); };
        link.onerror = function () { finish(false); };
        document.head.appendChild(link);
    }

    /* ─── Storage (may throw in private windows) ─── */
    function isHidden() {
        try { return window.localStorage.getItem(STORE_KEY) === '1'; } catch { return false; }
    }
    function setHidden(v) {
        try {
            if (v) window.localStorage.setItem(STORE_KEY, '1');
            else window.localStorage.removeItem(STORE_KEY);
        } catch { /* ignore */ }
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
            try { keyboard = owl.matches(':focus-visible'); } catch { /* ignore */ }
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

    /* ─────────────────────────────────────────────────────────────
     * 3. Copy email
     * A small "Copy email" button in the row of each mailto button (.btn), so a
     * visitor without a mail app can still grab the address. Added by script
     * only, so without JavaScript the page is unchanged. The "Copied" note is a
     * bubble over the button (no layout shift) and is also announced.
     * ───────────────────────────────────────────────────────────── */
    var COPY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';

    var announcer = null;
    function announce(text) {
        if (!announcer) {
            announcer = document.createElement('p');
            announcer.className = 'sr-only';
            announcer.setAttribute('role', 'status');
            announcer.setAttribute('aria-live', 'polite');
            document.body.appendChild(announcer);
        }
        announcer.textContent = '';
        setTimeout(function () { announcer.textContent = text; }, 30);
    }

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
        return new Promise(function (resolve, reject) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.className = 'copy-scratch';
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch { ok = false; }
            ta.remove();
            if (ok) resolve(); else reject(new Error('copy failed'));
        });
    }

    function mountCopyEmail() {
        var links = document.querySelectorAll('main a.btn[href^="mailto:"]');
        Array.prototype.forEach.call(links, function (link) {
            var row = link.parentElement;
            if (!row || row.querySelector('.copy-email')) return;
            var address = '';
            try { address = decodeURIComponent(link.getAttribute('href').slice(7).split('?')[0]); } catch { return; }
            if (!address) return;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn--ghost copy-email';
            btn.setAttribute('aria-label', 'Copy email address');
            btn.title = 'Copy ' + address;
            btn.innerHTML = COPY_ICON + '<span class="copy-email__note" aria-hidden="true"></span>';
            // At the end of the row, so the buttons already there don't move.
            row.appendChild(btn);
            var note = btn.querySelector('.copy-email__note');
            var timer = 0;
            btn.addEventListener('click', function () {
                copyText(address).then(function () {
                    note.textContent = 'Copied';
                    announce('Email address copied');
                }, function () {
                    note.textContent = address;
                    announce('Couldn’t copy. The address is ' + address);
                }).then(function () {
                    btn.classList.add('is-noted');
                    clearTimeout(timer);
                    timer = setTimeout(function () { btn.classList.remove('is-noted'); }, 1800);
                });
            });
        });
    }

    /* ─────────────────────────────────────────────────────────────
     * 4. Count-up numbers
     * An element marked data-countup ticks up from zero once, the first time it
     * scrolls into view. The real value stays in the page the whole time (kept
     * in place, just transparent, under an aria-hidden runner), so screen
     * readers, no-JS and print always get the exact final text and nothing
     * shifts. Elements already on screen when the page opens are left alone, so
     * a number never blinks back to zero; scripts that fill a value in later
     * (live.js) dispatch `motion:countup` to run it right away.
     * ───────────────────────────────────────────────────────────── */
    var NUM_RE = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/;
    var countObserver = null;

    function parseCount(text) {
        var m = NUM_RE.exec(text);
        if (!m) return null;
        var raw = m[2];
        var value = parseFloat(raw.replace(/,/g, ''));
        if (!isFinite(value) || value <= 0) return null;
        var dot = raw.indexOf('.');
        return {
            prefix: m[1], suffix: m[3], value: value,
            decimals: dot === -1 ? 0 : raw.length - dot - 1,
            commas: raw.indexOf(',') !== -1
        };
    }

    function formatCount(p, v) {
        var s = p.commas
            ? v.toLocaleString('en-US', { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals })
            : v.toFixed(p.decimals);
        return p.prefix + s + p.suffix;
    }

    function runCount(el) {
        if (el.hasAttribute('data-counted')) return;
        el.setAttribute('data-counted', '');
        var finalText = el.textContent;
        var p = parseCount(finalText.trim());
        if (!p || reduceMotion()) return;

        var keep = document.createElement('span');
        keep.className = 'countup__final';
        keep.textContent = finalText;
        var runner = document.createElement('span');
        runner.className = 'countup__run';
        runner.setAttribute('aria-hidden', 'true');
        el.textContent = '';
        el.appendChild(keep);
        el.appendChild(runner);
        el.classList.add('countup');

        var dur = 1100;
        var start = 0;
        var step = Math.pow(10, -p.decimals);
        function tick(t) {
            if (!start) start = t;
            var k = Math.min(1, (t - start) / dur);
            var eased = 1 - Math.pow(1 - k, 3);
            var v = Math.round((p.value * eased) / step) * step;
            runner.textContent = formatCount(p, v);
            if (k < 1) { requestAnimationFrame(tick); return; }
            el.classList.remove('countup');
            el.textContent = finalText;
        }
        runner.textContent = formatCount(p, 0);
        requestAnimationFrame(tick);
    }

    function observeCount(el, force) {
        if (el.hasAttribute('data-counted') || el.hasAttribute('data-count-watch')) return;
        if (reduceMotion() || !('IntersectionObserver' in window)) return;
        var fold = window.innerHeight || document.documentElement.clientHeight;
        var rect = el.getBoundingClientRect();
        if (!force) {
            if (rect.top < fold) { el.setAttribute('data-counted', ''); return; }
        } else if (rect.bottom > 0 && rect.top < fold) {
            runCount(el);
            return;
        }
        if (!countObserver) {
            countObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (e) {
                    if (!e.isIntersecting) return;
                    countObserver.unobserve(e.target);
                    runCount(e.target);
                });
            }, { threshold: 0.6 });
        }
        el.setAttribute('data-count-watch', '');
        countObserver.observe(el);
    }

    function scanCounts() {
        Array.prototype.forEach.call(document.querySelectorAll('[data-countup]'), function (el) { observeCount(el, false); });
    }

    /* ─────────────────────────────────────────────────────────────
     * 5. Live pulse
     * A small dot beside each "Live numbers" link that shows how fresh the
     * /live snapshot is: a soft breathing dot when it was published in the last
     * 36 hours and the checkout generator is running, a still, muted dot
     * otherwise. Positioned in the gap beside the link, so nothing moves when
     * it appears. Freshness is also in the link's title and accessible name.
     * ───────────────────────────────────────────────────────────── */
    var SNAPSHOT_URL = '/data/fraud-snapshot.json';
    var STALE_HOURS = 36;
    var PAUSED_HOURS = 6;
    var snapshotPromise = null;

    function getSnapshot() {
        if (!snapshotPromise) {
            snapshotPromise = window.fetch
                ? fetch(SNAPSHOT_URL, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
                : Promise.resolve(null);
        }
        return snapshotPromise;
    }

    function ago(ms) {
        var h = ms / 36e5;
        if (h < 1) return 'less than an hour ago';
        if (h < 36) { var n = Math.round(h); return n + (n === 1 ? ' hour ago' : ' hours ago'); }
        var d = Math.floor(h / 24);
        return d + (d === 1 ? ' day ago' : ' days ago');
    }

    function mountLivePulse() {
        var links = document.querySelectorAll('main a.project__link[href="/live"]');
        if (!links.length) return;
        getSnapshot().then(function (s) {
            if (!s || typeof s.generated_at !== 'string') return;
            var gen = Date.parse(s.generated_at);
            if (!isFinite(gen)) return;
            var age = Date.now() - gen;
            var latest = s.latest_event_at ? Date.parse(s.latest_event_at) : NaN;
            var paused = !isFinite(latest) || (gen - latest) / 36e5 > PAUSED_HOURS;
            var fresh = age / 36e5 <= STALE_HOURS && !paused;
            var label = 'updated ' + ago(Math.max(0, age));
            Array.prototype.forEach.call(links, function (link) {
                if (link.querySelector('.live-pulse')) return;
                var dot = document.createElement('span');
                dot.className = 'live-pulse ' + (fresh ? 'is-fresh' : 'is-stale');
                dot.setAttribute('aria-hidden', 'true');
                var sr = document.createElement('span');
                sr.className = 'sr-only';
                sr.textContent = ' (' + label + ')';
                link.classList.add('has-live-pulse');
                link.insertBefore(dot, link.firstChild);
                link.appendChild(sr);
                link.title = 'Live numbers, ' + label;
            });
        });
    }

    function enhanceMain() {
        mountCopyEmail();
        scanCounts();
        mountLivePulse();
    }

    function watchMainSwaps() {
        var main = document.querySelector('main');
        if (!main || !('MutationObserver' in window)) return;
        var pending = 0;
        new MutationObserver(function () {
            if (pending) return;
            pending = requestAnimationFrame(function () { pending = 0; scanReveals(); enhanceMain(); });
        }).observe(main, { childList: true });
    }

    function init() {
        loadStyles(function (ok) {
            if (!ok) return; // no stylesheet: leave the page as it is
            stylesReady = true;
            flushPendingCounts();
            mountOwl();
            // Let transition.js's first-paint fade settle before measuring the fold.
            requestAnimationFrame(function () { scanReveals(); enhanceMain(); });
            watchMainSwaps();
        });
    }

    // live.js fills its stat tiles after a fetch and asks for them to count up.
    // If that lands before this stylesheet does, the request waits for it, but
    // only briefly: a number that has been on screen a while is left as it is
    // rather than blinking back to zero.
    var pendingCounts = null;
    function flushPendingCounts() {
        if (!pendingCounts) return;
        var fresh = Date.now() - pendingCounts.at < 400;
        var els = pendingCounts.els;
        pendingCounts = null;
        if (fresh) Array.prototype.forEach.call(els, function (el) { observeCount(el, true); });
    }
    document.addEventListener('motion:countup', function (e) {
        if (!(e.detail && e.detail.elements)) return;
        if (!stylesReady) { pendingCounts = { els: e.detail.elements, at: Date.now() }; return; }
        Array.prototype.forEach.call(e.detail.elements, function (el) { observeCount(el, true); });
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
