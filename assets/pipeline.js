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
 *     pauses it, and Play again carries on from the current stage
 * Stages before the selected one are marked data-state="past" so the CSS
 * lights the path the data has taken.
 *
 * Each diagram opens in a modal <dialog> from its card's "How the data
 * flows" link ([data-flow-open="<figure id>"]), which this script turns
 * into a button. On Projects the diagrams sit in a fallback section at the
 * end of <main> ([data-flow-fallback]) that is hidden here; on Home the
 * diagram is fetched from /projects.html the first time it is opened.
 * Without JS the links still work: they jump to the fallback section.
 * The native modal dialog makes the page behind it inert (focus stays in
 * it) and closes on Esc; a click on the backdrop closes it too, and focus
 * goes back to the button that opened it. A /projects#<figure id> address
 * opens that diagram's modal on load; closing that one moves focus to the
 * diagram's card (or the page heading) instead.
 *
 * This script is loaded on Home as well as Projects (both show the
 * featured diagrams), adds pipeline.min.css itself the first time a
 * diagram appears, and sets diagrams up on load and whenever <main>
 * changes.
 * ───────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var STEP_MS = 1900;
    var wide = window.matchMedia ? window.matchMedia('(min-width: 880px)') : null;
    var finePointer = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;

    function orient(list) {
        list.setAttribute('aria-orientation', wide && wide.matches ? 'horizontal' : 'vertical');
    }

    function orientAll() {
        Array.prototype.forEach.call(document.querySelectorAll('[data-flow-stages]'), orient);
    }

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
            if (current >= tabs.length - 1) select(0, false);
            playBtn.setAttribute('aria-pressed', 'true');
            playBtn.querySelector('[data-flow-play-label]').textContent = 'Pause';
            timer = window.setInterval(function () {
                if (!document.documentElement.contains(flow) || current >= tabs.length - 1) { stop(); return; }
                select(current + 1, false);
            }, STEP_MS);
        }

        tabs.forEach(function (tab, i) {
            tab.addEventListener('click', function () { stop(); select(i, false); });
            // pointermove, not pointerenter: scrolling the page under a resting
            // mouse fires enter events, and the selection shouldn't jump then.
            tab.addEventListener('pointermove', function (e) {
                if (i === current || timer) return;
                if (e.pointerType === 'mouse' && finePointer && finePointer.matches) select(i, false);
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

        orient(list);
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

    /* ── Modals ── */
    var opener = null;

    function stopPlaying(flow) {
        var btn = flow && flow.querySelector('[data-flow-play][aria-pressed="true"]');
        if (btn) btn.click();
    }

    function dialogFor(id) {
        var dialog = document.getElementById(id + '-dialog');
        if (dialog) return dialog;
        var main = document.querySelector('main');
        if (!main) return null;
        dialog = document.createElement('dialog');
        dialog.className = 'flow-dialog';
        dialog.id = id + '-dialog';
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', id + '-title');
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'flow-dialog__close';
        close.setAttribute('aria-label', 'Close');
        close.setAttribute('autofocus', '');
        close.innerHTML = '<span aria-hidden="true">&times;</span>';
        close.addEventListener('click', function () { dialog.close(); });
        var body = document.createElement('div');
        body.className = 'flow-dialog__body';
        dialog.appendChild(close);
        dialog.appendChild(body);
        // A click that lands on the <dialog> itself, not on its contents, is
        // a click on the backdrop.
        dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
        dialog.addEventListener('close', function () {
            stopPlaying(dialog.querySelector('[data-flow]'));
            if (location.hash === '#' + id && history.replaceState) {
                history.replaceState(history.state, '', location.pathname + location.search);
            }
            var back = opener;
            opener = null;
            if (back && document.documentElement.contains(back)) { back.focus(); return; }
            var card = document.getElementById(id.replace(/-flow$/, '')) || document.querySelector('main h1');
            if (!card) return;
            if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1');
            card.focus({ preventScroll: true });
            card.scrollIntoView({ block: 'start' });
        });
        main.appendChild(dialog);
        return dialog;
    }

    // The figure, from this page or (on Home) from /projects.html.
    var fetched = null;
    function findFigure(id) {
        var here = document.getElementById(id);
        if (here) return Promise.resolve(here);
        if (!window.fetch || !window.DOMParser) return Promise.reject(new Error('no fetch'));
        if (!fetched) {
            fetched = fetch('/projects.html', { credentials: 'same-origin' })
                .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
                .then(function (html) { return new DOMParser().parseFromString(html, 'text/html'); })
                .catch(function (err) { fetched = null; throw err; });
        }
        return fetched.then(function (doc) {
            var fig = doc.getElementById(id);
            if (!fig || !fig.hasAttribute('data-flow')) throw new Error('missing ' + id);
            return document.importNode(fig, true);
        });
    }

    function openFlow(id, from) {
        var dialog = dialogFor(id);
        if (!dialog || typeof dialog.showModal !== 'function') return Promise.reject(new Error('no dialog'));
        if (dialog.open) return Promise.resolve();
        var body = dialog.querySelector('.flow-dialog__body');
        var ready;
        if (body.querySelector('[data-flow]')) {
            ready = Promise.resolve();
        } else if (dialog.flowLoading) {
            ready = dialog.flowLoading;
        } else {
            ready = dialog.flowLoading = findFigure(id).then(function (fig) {
                dialog.flowLoading = null;
                if (body.querySelector('[data-flow]')) return;
                body.appendChild(fig);
                ensureStyles();
                setup(fig);
            }, function (err) {
                dialog.flowLoading = null;
                throw err;
            });
        }
        if (from) from.setAttribute('aria-busy', 'true');
        return ready.then(function () {
            if (from) from.removeAttribute('aria-busy');
            if (!document.documentElement.contains(dialog) || dialog.open) return;
            opener = from || null;
            dialog.showModal();
            var close = dialog.querySelector('.flow-dialog__close');
            if (close) close.focus();
            body.scrollTop = 0;
        }, function (err) {
            if (from) from.removeAttribute('aria-busy');
            throw err;
        });
    }

    // Swap each "How the data flows" link for a real button (it opens a
    // dialog, it doesn't go anywhere); if the diagram can't be shown, go to
    // the link's address after all.
    function upgradeTriggers() {
        Array.prototype.forEach.call(document.querySelectorAll('a[data-flow-open]'), function (link) {
            var id = link.getAttribute('data-flow-open');
            var href = link.getAttribute('href');
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = link.className + ' project__link--button';
            btn.setAttribute('data-flow-open', id);
            btn.setAttribute('aria-haspopup', 'dialog');
            btn.textContent = link.textContent;
            btn.addEventListener('click', function () {
                openFlow(id, btn).catch(function () { window.location.href = href; });
            });
            link.parentNode.replaceChild(btn, link);
        });
    }

    function hideFallback() {
        if (typeof HTMLDialogElement !== 'function') return;
        Array.prototype.forEach.call(document.querySelectorAll('[data-flow-fallback]'), function (s) { s.hidden = true; });
    }

    function openFromHash() {
        var id = location.hash.slice(1);
        if (!id || !/^[a-z0-9-]+$/i.test(id)) return;
        var fig = document.getElementById(id);
        if (!fig || !fig.hasAttribute('data-flow') || fig.hasAttribute('data-flow-shown')) return;
        if (!fig.closest('[data-flow-fallback]')) return;
        fig.setAttribute('data-flow-shown', '');
        var dialog = dialogFor(id);
        if (!dialog) return;
        dialog.querySelector('.flow-dialog__body').appendChild(fig);
        openFlow(id, null).catch(function () {});
    }

    function init() {
        var flows = document.querySelectorAll('[data-flow]');
        var triggers = document.querySelectorAll('[data-flow-open]');
        if (!flows.length && !triggers.length) return;
        ensureStyles();
        Array.prototype.forEach.call(flows, setup);
        if (typeof HTMLDialogElement !== 'function') return;
        upgradeTriggers();
        hideFallback();
        openFromHash();
    }

    if (wide && wide.addEventListener) wide.addEventListener('change', orientAll);

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
