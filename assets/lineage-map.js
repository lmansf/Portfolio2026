/* ─────────────────────────────────────────────────────────────
 * lineage-map.js: the draggable lineage map at the top of /catalog.
 *
 * It reads /data/pipeline/models.json (the same definitions the catalog
 * below is generated from) and draws every table as a node in three
 * columns, raw → staging → mart, with a line from each table to the ones
 * built from it. Nodes settle with a small force layout. Drag one with the
 * mouse and its lineage stretches with it; let go and it drifts back into
 * its column. Hover or focus a node to light its whole path, upstream and
 * downstream. Select a node (click, or Enter on its link) to jump to that
 * table's entry below.
 *
 * Progressive enhancement and opt-outs:
 *   - the mount ships `hidden`; without JS, or below 880px wide, the
 *     catalog's own lists below are the lineage (phones keep the plain list)
 *   - text mode (html.text-mode, set by theme.js) hides the map
 *   - prefers-reduced-motion draws the settled layout once with no drift;
 *     a dragged node stays where it's dropped
 *   - the force loop only runs while a node is moving and the map is on
 *     screen; node text goes in through textContent
 * ───────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    const mount = document.querySelector('[data-lineage-map]');
    if (!mount || !window.matchMedia) return;

    const wide = window.matchMedia('(min-width: 880px)');
    const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const COLS = { raw: 0.1, staging: 0.4, mart: 0.8 };
    const LAYER_NAME = { raw: 'raw', staging: 'staging', mart: 'mart' };
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const box = mount.querySelector('[data-lineage-box]');
    const svg = mount.querySelector('svg');
    if (!box || !svg) return;

    let nodes = [];
    let edges = [];
    let byName = {};
    let W = 0;
    let H = 0;
    let built = false;
    let rafId = 0;
    let onScreen = true;
    let drag = null;

    function still() {
        return mqMotion.matches || document.documentElement.classList.contains('text-mode');
    }

    function build(models) {
        const defs = models && models.nodes;
        if (!defs) return false;
        Object.keys(defs).forEach((name) => {
            const d = defs[name];
            if (!COLS.hasOwnProperty(d.layer)) return;
            byName[name] = { name, layer: d.layer, label: d.label || name, ups: [], downs: [], x: 0, y: 0, vx: 0, vy: 0 };
            nodes.push(byName[name]);
        });
        nodes.forEach((n) => {
            (defs[n.name].upstream || []).forEach((u) => {
                const up = byName[u];
                if (!up) return;
                edges.push({ from: up, to: n });
                up.downs.push(n);
                n.ups.push(up);
            });
        });
        if (!nodes.length) return false;

        nodes.forEach((n) => {
            const a = document.createElement('a');
            a.className = 'lmap__node lmap__node--' + n.layer;
            a.href = '#t-' + n.name;
            a.setAttribute('aria-label', n.label + ', ' + LAYER_NAME[n.layer] + ' table');
            const kind = document.createElement('span');
            kind.className = 'lmap__layer';
            kind.textContent = LAYER_NAME[n.layer];
            const label = document.createElement(n.layer === 'mart' ? 'code' : 'span');
            label.className = 'lmap__label';
            label.textContent = n.label;
            a.append(kind, label);
            box.appendChild(a);
            n.el = a;
            wireNode(n);
        });
        edges.forEach((e) => {
            const p = document.createElementNS(SVG_NS, 'path');
            p.setAttribute('class', 'lmap__edge lmap__edge--' + e.from.layer);
            svg.appendChild(p);
            e.el = p;
        });
        return true;
    }

    /* Start each column's nodes in an order that keeps a family together:
     * raw sources in their own order, then each table under its parent. */
    function seed() {
        const rank = {};
        let i = 0;
        nodes.filter((n) => n.layer === 'raw').forEach((r) => {
            rank[r.name] = i++;
            r.downs.forEach((s) => {
                if (rank[s.name] === undefined) rank[s.name] = rank[r.name] + 0.1;
                s.downs.forEach((m, j) => { if (rank[m.name] === undefined) rank[m.name] = rank[s.name] + 0.01 * (j + 1); });
                r.downs.forEach((m, j) => { if (rank[m.name] === undefined) rank[m.name] = rank[r.name] + 0.05 + 0.001 * j; });
            });
        });
        nodes.forEach((n) => { if (rank[n.name] === undefined) rank[n.name] = i++; });
        Object.keys(COLS).forEach((layer) => {
            const col = nodes.filter((n) => n.layer === layer).sort((a, b) => rank[a.name] - rank[b.name]);
            col.forEach((n, k) => {
                n.x = COLS[layer] * W;
                n.y = ((k + 1) / (col.length + 1)) * H;
            });
        });
    }

    function measure() {
        W = box.clientWidth;
        H = box.clientHeight;
        nodes.forEach((n) => {
            n.w = n.el.offsetWidth;
            n.h = n.el.offsetHeight;
        });
    }

    /* One step of the layout: hold each node to its column, pull it toward
     * the nodes it's connected to, and push apart nodes that overlap. */
    function tick() {
        const k = 0.06;
        nodes.forEach((n) => {
            if (n === (drag && drag.node)) return;
            n.vx += (COLS[n.layer] * W - n.x) * k;
            const linked = n.ups.concat(n.downs);
            if (linked.length) {
                const avg = linked.reduce((s, m) => s + m.y, 0) / linked.length;
                n.vy += (avg - n.y) * 0.006;
            }
        });
        for (let a = 0; a < nodes.length; a++) {
            for (let b = a + 1; b < nodes.length; b++) {
                const p = nodes[a];
                const q = nodes[b];
                const dx = q.x - p.x;
                const dy = q.y - p.y;
                const gapX = (p.w + q.w) / 2 + 12 - Math.abs(dx);
                const gapY = (p.h + q.h) / 2 + 14 - Math.abs(dy);
                if (gapX > 0 && gapY > 0) {
                    const push = Math.min(gapY, 40) * 0.3 * (dy >= 0 ? 1 : -1);
                    if (p !== (drag && drag.node)) p.vy -= push;
                    if (q !== (drag && drag.node)) q.vy += push;
                }
            }
        }
        let energy = 0;
        nodes.forEach((n) => {
            if (n === (drag && drag.node)) return;
            n.vx *= 0.7;
            n.vy *= 0.7;
            n.x += n.vx;
            n.y += n.vy;
            const padY = n.h / 2 + 4;
            const padX = n.w / 2 + 4;
            n.y = Math.max(padY, Math.min(H - padY, n.y));
            n.x = Math.max(padX, Math.min(W - padX, n.x));
            energy += Math.abs(n.vx) + Math.abs(n.vy);
        });
        return energy;
    }

    function settle() {
        for (let i = 0; i < 600; i++) { if (tick() < 0.02 && i > 60) break; }
    }

    function draw() {
        nodes.forEach((n) => {
            n.el.style.transform = 'translate(' + Math.round(n.x - n.w / 2) + 'px,' + Math.round(n.y - n.h / 2) + 'px)';
        });
        edges.forEach((e) => {
            const x1 = e.from.x + e.from.w / 2;
            const x2 = e.to.x - e.to.w / 2;
            const mid = (x1 + x2) / 2;
            e.el.setAttribute('d', 'M' + x1.toFixed(1) + ',' + e.from.y.toFixed(1) +
                ' C' + mid.toFixed(1) + ',' + e.from.y.toFixed(1) + ' ' + mid.toFixed(1) + ',' + e.to.y.toFixed(1) +
                ' ' + x2.toFixed(1) + ',' + e.to.y.toFixed(1));
        });
    }

    function loop() {
        rafId = 0;
        const energy = tick();
        draw();
        if ((energy > 0.05 || drag) && onScreen && !still()) rafId = requestAnimationFrame(loop);
    }

    function kick() {
        if (still()) { draw(); return; }
        if (!rafId && onScreen) rafId = requestAnimationFrame(loop);
    }

    /* The whole path through a node: everything upstream and downstream. */
    function lineage(n) {
        const seen = new Set([n]);
        const walk = (m, dir) => m[dir].forEach((o) => { if (!seen.has(o)) { seen.add(o); walk(o, dir); } });
        walk(n, 'ups');
        walk(n, 'downs');
        return seen;
    }

    function highlight(n) {
        const path = n ? lineage(n) : null;
        mount.classList.toggle('is-tracing', !!path);
        nodes.forEach((m) => m.el.classList.toggle('is-on', !!path && path.has(m)));
        edges.forEach((e) => e.el.classList.toggle('is-on', !!path && path.has(e.from) && path.has(e.to)));
    }

    function wireNode(n) {
        const el = n.el;
        el.addEventListener('mouseenter', () => { if (!drag) highlight(n); });
        el.addEventListener('mouseleave', () => { if (!drag) highlight(null); });
        el.addEventListener('focus', () => highlight(n));
        el.addEventListener('blur', () => highlight(null));
        el.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0 || ev.pointerType === 'touch') return;
            const r = box.getBoundingClientRect();
            drag = { node: n, id: ev.pointerId, dx: ev.clientX - r.left - n.x, dy: ev.clientY - r.top - n.y, sx: ev.clientX, sy: ev.clientY, moved: false };
            el.setPointerCapture(ev.pointerId);
            highlight(n);
        });
        el.addEventListener('pointermove', (ev) => {
            if (!drag || drag.id !== ev.pointerId) return;
            if (!drag.moved && Math.abs(ev.clientX - drag.sx) + Math.abs(ev.clientY - drag.sy) < 5) return;
            if (!drag.moved) { drag.moved = true; mount.classList.add('is-dragging'); }
            const r = box.getBoundingClientRect();
            n.x = Math.max(n.w / 2, Math.min(W - n.w / 2, ev.clientX - r.left - drag.dx));
            n.y = Math.max(n.h / 2, Math.min(H - n.h / 2, ev.clientY - r.top - drag.dy));
            n.vx = 0;
            n.vy = 0;
            if (still()) draw(); else kick();
        });
        const end = (ev) => {
            if (!drag || drag.id !== ev.pointerId) return;
            const moved = drag.moved;
            drag = null;
            mount.classList.remove('is-dragging');
            if (moved) {
                el.dataset.dragged = '1';
                setTimeout(() => { delete el.dataset.dragged; }, 0);
                kick();
            }
            if (!el.matches(':hover')) highlight(null);
        };
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
        el.addEventListener('click', (ev) => { if (el.dataset.dragged) ev.preventDefault(); });
    }

    function layout() {
        measure();
        if (!W || !H) return;
        seed();
        settle();
        draw();
    }

    function show() {
        const on = wide.matches && !document.documentElement.classList.contains('text-mode');
        if (on && !built) {
            built = 'loading';
            fetch('/data/pipeline/models.json')
                .then((r) => (r.ok ? r.json() : null))
                .then((models) => {
                    if (!build(models)) { built = false; return; }
                    built = true;
                    mount.hidden = false;
                    layout();
                })
                .catch(() => { built = false; });
            return;
        }
        if (built === true) {
            mount.hidden = !on;
            if (on) layout();
        }
    }

    if ('IntersectionObserver' in window) {
        new IntersectionObserver((entries) => {
            onScreen = entries[entries.length - 1].isIntersecting;
            if (onScreen) kick();
        }).observe(mount);
    }

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (built === true && !mount.hidden) layout(); }, 120);
    });
    if (wide.addEventListener) wide.addEventListener('change', show);
    document.addEventListener('textmodechange', show);
    show();
})();
