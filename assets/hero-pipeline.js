/* hero-pipeline.js: the Home hero's one moving moment.
 *
 * Points of "raw data" enter on the left (ingest), get sorted into lanes
 * (transform), swirl together into an owl that tilts its head, then break
 * apart and settle into the name (serve). Once settled, the pointer pushes
 * points aside and they spring back.
 *
 * Progressive enhancement: the stage ships `hidden` and the real <h1>
 * stays visible, so no-JS visitors and browsers without canvas see the
 * plain hero. When this script starts, it shows the stage and adds
 * `hero--pipe` to the hero, which keeps the <h1> for screen readers and
 * search but hides it visually (the canvas is aria-hidden).
 * Under prefers-reduced-motion the finished name is drawn once, with no
 * animation and no Replay button. The loop only runs while the stage is
 * on screen and the tab is visible.
 */
(function () {
    "use strict";
    var stage = document.querySelector("[data-hero-pipe]");
    if (!stage) return;
    var cv = stage.querySelector("canvas");
    var hero = stage.closest(".hero");
    var replay = stage.querySelector("[data-hero-replay]");
    var ctx = cv && cv.getContext && cv.getContext("2d");
    if (!ctx || !hero) return;

    var mqMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    var mqDark = window.matchMedia("(prefers-color-scheme: dark)");
    var NAME = (hero.querySelector(".hero__name") || {}).textContent || "Logan Mansfield";
    NAME = NAME.replace(/\.\s*$/, "").trim();
    var MAX_POINTS = 2600;

    var W = 0, H = 0, P = [], OC = [0, 0], t0 = 0, mx = -1e4, my = -1e4;
    var colors = {};
    var running = false, onScreen = true, rafId = 0, lastW = -1;

    function readColors() {
        var cs = getComputedStyle(document.documentElement);
        colors = {
            c1: cs.getPropertyValue("--pipe-1").trim() || "#8a97a3",
            c2: cs.getPropertyValue("--pipe-2").trim() || "#c97a00",
            c3: cs.getPropertyValue("--pipe-3").trim() || "#0f7b6c",
            line: cs.getPropertyValue("--hairline").trim() || "#d3d8d6",
            font: cs.getPropertyValue("--font-display").trim() || "sans-serif"
        };
    }

    /* Points inside whatever `draw` paints on an offscreen canvas. */
    function samplePoints(w, h, draw, step) {
        var oc = document.createElement("canvas");
        oc.width = Math.max(1, Math.floor(w));
        oc.height = Math.max(1, Math.floor(h));
        var o = oc.getContext("2d");
        draw(o, oc.width, oc.height);
        var data = o.getImageData(0, 0, oc.width, oc.height).data, pts = [];
        for (var y = 0; y < oc.height; y += step) {
            for (var x = 0; x < oc.width; x += step) {
                if (data[(y * oc.width + x) * 4 + 3] > 128) pts.push([x, y]);
            }
        }
        return pts;
    }

    /* Owl silhouette in a 100 x 100 box, with the eyes and beak cut out. */
    function drawOwl(o, ox, oy, s) {
        o.save();
        o.translate(ox, oy);
        o.scale(s / 100, s / 100);
        o.fillStyle = "#000";
        o.beginPath(); o.ellipse(40, 62, 28, 34, 0, 0, Math.PI * 2); o.fill();
        o.beginPath(); o.ellipse(40, 30, 25, 21, 0, 0, Math.PI * 2); o.fill();
        o.beginPath(); o.moveTo(17, 22); o.lineTo(20, 2); o.lineTo(31, 14); o.fill();
        o.beginPath(); o.moveTo(63, 22); o.lineTo(60, 2); o.lineTo(49, 14); o.fill();
        o.beginPath();
        o.moveTo(30, 94); o.lineTo(36, 100); o.lineTo(38, 94);
        o.moveTo(42, 94); o.lineTo(44, 100); o.lineTo(50, 94);
        o.fill();
        o.globalCompositeOperation = "destination-out";
        o.beginPath(); o.arc(30, 30, 8.5, 0, Math.PI * 2); o.arc(50, 30, 8.5, 0, Math.PI * 2); o.fill();
        o.beginPath(); o.moveTo(37, 38); o.lineTo(43, 38); o.lineTo(40, 45); o.fill();
        o.restore();
    }

    function build(w, h) {
        W = w; H = h;
        var words = NAME.split(/\s+/);
        var two = w < 640 && words.length > 1;
        var fs = two ? Math.min(w * 0.19, h * 0.3) : Math.min(w * 0.11, h * 0.42);
        var step = w < 640 ? 4 : 5;
        var pts = samplePoints(w, h, function (o, ow, oh) {
            o.fillStyle = "#000";
            o.textAlign = "center";
            o.textBaseline = "middle";
            o.font = "800 " + fs + "px " + colors.font;
            if (two) {
                o.fillText(words[0], ow / 2, oh * 0.38);
                o.fillText(words.slice(1).join(" "), ow / 2, oh * 0.38 + fs * 1.0);
            } else {
                o.fillText(NAME, ow / 2, oh * 0.54);
            }
        }, step);
        if (pts.length > MAX_POINTS) {
            var keep = [], every = pts.length / MAX_POINTS;
            for (var k = 0; k < MAX_POINTS; k++) keep.push(pts[Math.floor(k * every)]);
            pts = keep;
        }
        var lanes = 7, gate = w * 0.3;
        var os = Math.min(h * 0.86, w * 0.9);
        var oxx = w * 0.52 - os * 0.4, oyy = (h - os) / 2 + 4;
        OC = [oxx + os * 0.4, oyy + os * 0.55];
        var cand = samplePoints(w, h, function (o) { drawOwl(o, oxx, oyy, os); }, 2);
        /* Shuffle the owl's pixels so the points cover it evenly (no stripes). */
        for (var c = cand.length - 1; c > 0; c--) {
            var r = Math.floor(Math.random() * (c + 1)), tmp = cand[c];
            cand[c] = cand[r]; cand[r] = tmp;
        }
        P = pts.map(function (p, i) {
            var o = cand[i % Math.max(1, cand.length)] || [w / 2, h / 2];
            return {
                sx: -Math.random() * w * 0.35 - 10, sy: Math.random() * h,
                gx: gate + (Math.random() - 0.5) * w * 0.12, gy: h * (0.18 + 0.7 * ((i % lanes) / (lanes - 1))),
                ox: o[0], oy: o[1], tx: p[0], ty: p[1],
                x: p[0], y: p[1], vx: 0, vy: 0,
                d: Math.random() * 1.1, a: Math.random() * Math.PI * 2
            };
        });
    }

    function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

    /* Timeline in seconds: lanes by about 2.4, owl formed by about 4,
     * owl holds and tilts its head until 5.6, name settled by about 7.6. */
    var OWL_IN = 1.3, OWL_DUR = 1.6, HOLD_START = 4.2, HOLD_END = 5.6, NAME_DUR = 1.5;

    function draw(T, still) {
        ctx.clearRect(0, 0, W, H);
        ctx.strokeStyle = colors.line;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        [W / 3, W * 2 / 3].forEach(function (x) {
            ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, H); ctx.stroke();
        });
        ctx.setLineDash([]);
        var sz = W < 640 ? 2.4 : 3;
        var hu = clamp01((T - HOLD_START) / (HOLD_END - HOLD_START));
        var tilt = 0.13 * Math.sin(Math.PI * 2 * hu), ct = Math.cos(tilt), st = Math.sin(tilt);
        var swirlR = Math.min(W, H) * 0.3;
        var settled = true;
        for (var i = 0; i < P.length; i++) {
            var p = P[i], x, y, col;
            if (still) {
                x = p.tx; y = p.ty; col = colors.c3;
            } else {
                var a1 = clamp01((T - p.d) / OWL_IN);
                var a2 = clamp01((T - p.d - OWL_IN) / OWL_DUR);
                var a3 = clamp01((T - HOLD_END - p.d * 0.5) / NAME_DUR);
                var rx = p.ox - OC[0], ry = p.oy - OC[1];
                var ox = OC[0] + rx * ct - ry * st, oy = OC[1] + rx * st + ry * ct;
                if (a1 < 1) {
                    var k1 = ease(a1);
                    x = p.sx + (p.gx - p.sx) * k1; y = p.sy + (p.gy - p.sy) * k1;
                    col = k1 < 0.7 ? colors.c1 : colors.c2;
                } else if (a2 < 1 || a3 <= 0) {
                    /* Murmuration: circle the owl, tightening onto its outline. */
                    var k2 = ease(a2), r = Math.sin(Math.PI * a2) * swirlR, ang = p.a + T * 2.4;
                    var m = Math.min(1, a2 * 1.6);
                    var cx = p.gx + (OC[0] - p.gx) * m, cy = p.gy + (OC[1] - p.gy) * m;
                    x = (cx + Math.cos(ang) * r) * (1 - k2) + ox * k2;
                    y = (cy + Math.sin(ang) * r * 0.8) * (1 - k2) + oy * k2;
                    col = colors.c2;
                } else {
                    /* The owl breaks apart: points lift and spread, then land in the name. */
                    var k3 = ease(a3), lift = Math.sin(k3 * Math.PI) * (H * 0.18);
                    x = ox + (p.tx - ox) * k3 + Math.cos(p.a) * lift;
                    y = oy + (p.ty - oy) * k3 + Math.sin(p.a) * lift * 0.6;
                    col = k3 < 0.6 ? colors.c2 : colors.c3;
                }
                if (a3 >= 1) {
                    var dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy;
                    if (d2 < 5000) {
                        var f = (5000 - d2) / 5000 * 3, dl = Math.sqrt(d2 + 1);
                        p.vx += dx / dl * f; p.vy += dy / dl * f;
                    }
                    p.vx += (p.tx - p.x) * 0.06; p.vy += (p.ty - p.y) * 0.06;
                    p.vx *= 0.82; p.vy *= 0.82;
                    p.x += p.vx; p.y += p.vy;
                    x = p.x; y = p.y; col = colors.c3;
                    if (Math.abs(p.vx) + Math.abs(p.vy) > 0.05) settled = false;
                } else {
                    p.x = x; p.y = y; p.vx = 0; p.vy = 0;
                    settled = false;
                }
            }
            ctx.fillStyle = col;
            ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        }
        return settled;
    }

    function frame(now) {
        rafId = 0;
        if (!running) return;
        var settled = draw((now - t0) / 1000, false);
        /* Once everything has landed and the pointer is away, stop drawing
         * until the pointer comes back, a replay, or a resize. */
        if (settled && mx < -1e3) { running = false; return; }
        if (onScreen && !document.hidden) rafId = requestAnimationFrame(frame);
        else running = false;
    }
    function start() {
        if (mqMotion.matches) { draw(0, true); return; }
        if (!running) {
            running = true;
            if (!rafId) rafId = requestAnimationFrame(frame);
        }
    }

    function fit() {
        var r = cv.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.width = Math.round(r.width * dpr);
        cv.height = Math.round(r.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        lastW = r.width;
        build(r.width, r.height);
        if (mqMotion.matches) draw(0, true); else start();
    }

    function begin() {
        readColors();
        stage.hidden = false;
        hero.classList.add("hero--pipe");
        if (replay && !mqMotion.matches) replay.hidden = false;
        t0 = performance.now();
        fit();
        t0 = performance.now();
        start();

        if ("ResizeObserver" in window) {
            var pending = 0;
            new ResizeObserver(function () {
                if (pending) cancelAnimationFrame(pending);
                pending = requestAnimationFrame(function () { pending = 0; fit(); });
            }).observe(cv);
        }
        if ("IntersectionObserver" in window) {
            new IntersectionObserver(function (entries) {
                onScreen = entries[0].isIntersecting;
                if (onScreen) start();
            }).observe(stage);
        }
        document.addEventListener("visibilitychange", function () { if (!document.hidden) start(); });
        cv.addEventListener("pointermove", function (e) {
            var r = cv.getBoundingClientRect();
            mx = e.clientX - r.left; my = e.clientY - r.top;
            start();
        }, { passive: true });
        cv.addEventListener("pointerleave", function () { mx = my = -1e4; });
        if (replay) replay.addEventListener("click", function () {
            t0 = performance.now();
            start();
        });
        var onScheme = function () { readColors(); if (mqMotion.matches) draw(0, true); else start(); };
        if (mqDark.addEventListener) mqDark.addEventListener("change", onScheme);
        var onMotion = function () {
            if (replay) replay.hidden = mqMotion.matches;
            if (mqMotion.matches) { running = false; draw(0, true); } else { t0 = performance.now() - 20000; start(); }
        };
        if (mqMotion.addEventListener) mqMotion.addEventListener("change", onMotion);
    }

    /* Wait for the display font so the name is sampled in the real face
     * (or give up after 1.5 s and use whatever is loaded). */
    var family = "Schibsted Grotesk";
    var ready = document.fonts && document.fonts.load
        ? Promise.race([
            document.fonts.load('800 64px "' + family + '"'),
            new Promise(function (res) { setTimeout(res, 1500); })
        ]).catch(function () {})
        : Promise.resolve();
    ready.then(begin);
    /* If the font arrives after we gave up, resample once in the real face. */
    if (document.fonts && document.fonts.load) {
        document.fonts.load('800 64px "' + family + '"').then(function () {
            if (!stage.hidden && lastW > 0) { readColors(); fit(); }
        }).catch(function () {});
    }
})();
