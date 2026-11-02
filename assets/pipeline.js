/* ─────────────────────────────────────────────────────────────
 * pipeline.js — makes each .flow diagram on /projects interactive.
 *
 * The markup already holds every stage and its note, so without JS the
 * page shows them all as a list. This script turns each diagram into a
 * tabs widget (WAI-ARIA tabs pattern, automatic activation):
 *   - click or tap a stage, or hover it with a mouse, to read its note
 *   - arrow keys move between stages (left/right on a wide screen,
 *     up/down on a phone, both always work), Home and End jump to the ends
 *   - "Play the flow" steps through the stages once; any other choice
 *     stops it
 * Stages before the selected one are marked data-state="past" so the CSS
 * lights the path the data has taken.
 *
 * transition.js swaps the contents of <main> on in-site navigation (it
 * does not bring the new page's <head>), so this script is loaded on
 * every page, adds pipeline.min.css itself the first time a diagram
 * appears, and sets diagrams up on load and whenever <main> changes.
 * ───────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var STEP_MS = 1900;
    var wide = window.matchMedia ? window.matchMedia('(min-width: 720px)') : null;
    var finePointer = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;

    function setup(flow) {
        if (flow.classList.contains('is-ready')) return;
        var list = flow.querySelector('[data-flow-stages]');
        var tabs = Array.prototype.slice.call(flow.querySelectorAll('[data-flow-tab]'));
        var panels = tabs.map(function (tab) { return document.getElementById(tab.getAttribute('aria-controls')); });
        if (!list || !tabs.length || panels.some(function (p) { return !p; })) return;

        var playBtn = flow.querySelector('[data-flow-play]');
        var timer = null;
        var current = 0;

        list.setAttribute('role', 'tablist');
        Array.prototype.forEach.call(list.children, function (li) { li.setAttribute('role', 'presentation'); });
        tabs.forEach(function (tab, i) {
            tab.setAttribute('role', 'tab');
            panels[i].setAttribute('role', 'tabpanel');
            panels[i].setAttribute('tabindex', '0');
        });

        function orient() {
            list.setAttribute('aria-orientation', wide && wide.matches ? 'horizontal' : 'vertical');
        }

        function select(index, moveFocus) {
            current = index;
            tabs.forEach(function (tab, i) {
                var on = i === index;
                tab.setAttribute('aria-selected', on ? 'true' : 'false');
                tab.tabIndex = on ? 0 : -1;
                tab.parentNode.setAttribute('data-state', i < index ? 'past' : on ? 'current' : 'next');
                panels[i].hidden = !on;
            });
            if (moveFocus) tabs[index].focus();
        }

        function stop() {
            if (timer) window.clearInterval(timer);
            timer = null;
            if (playBtn) {
                playBtn.setAttribute('aria-pressed', 'false');
                playBtn.querySelector('[data-flow-play-label]').textContent = 'Play the flow';
            }
        }

        function play() {
            select(0, false);
            playBtn.setAttribute('aria-pressed', 'true');
            playBtn.querySelector('[data-flow-play-label]').textContent = 'Pause';
            timer = window.setInterval(function () {
                if (current >= tabs.length - 1) { stop(); return; }
                select(current + 1, false);
            }, STEP_MS);
        }

        tabs.forEach(function (tab, i) {
            tab.addEventListener('click', function () { stop(); select(i, false); });
            tab.addEventListener('pointerenter', function (e) {
                if (e.pointerType === 'mouse' && finePointer && finePointer.matches && !timer) select(i, false);
            });
            tab.addEventListener('keydown', function (e) {
                var next = null;
                switch (e.key) {
                    case 'ArrowRight': case 'ArrowDown': next = (i + 1) % tabs.length; break;
                    case 'ArrowLeft': case 'ArrowUp': next = (i - 1 + tabs.length) % tabs.length; break;
                    case 'Home': next = 0; break;
                    case 'End': next = tabs.length - 1; break;
                }
                if (next === null) return;
                e.preventDefault();
                stop();
                select(next, true);
            });
        });

        if (playBtn) {
            playBtn.hidden = false;
            playBtn.addEventListener('click', function () {
                if (timer) stop(); else play();
            });
        }

        orient();
        if (wide && wide.addEventListener) wide.addEventListener('change', orient);
        select(0, false);
        flow.classList.add('is-ready');
    }

    // projects.html preloads the stylesheet (so it never blocks the first
    // paint); here it is applied, or added after an in-site page swap.
    function ensureStyles() {
        var preload = document.querySelector('link[rel="preload"][href="/assets/pipeline.min.css"]');
        if (preload) { preload.rel = 'stylesheet'; return; }
        if (document.querySelector('link[rel="stylesheet"][href="/assets/pipeline.min.css"]')) return;
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/assets/pipeline.min.css';
        document.head.appendChild(link);
    }

    function init() {
        var flows = document.querySelectorAll('[data-flow]');
        if (!flows.length) return;
        ensureStyles();
        Array.prototype.forEach.call(flows, setup);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Re-run when transition.js swaps new contents into <main>.
    var main = document.querySelector('main');
    if (main && window.MutationObserver) {
        new MutationObserver(init).observe(main, { childList: true });
    }
})();
