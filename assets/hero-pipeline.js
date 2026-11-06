/* hero-pipeline.js: the Home hero, a replay of the fraud pipeline.
 *
 * The dots are checkouts from the fraud pipeline's own snapshot
 * (/data/fraud-snapshot.json, the same aggregates /live draws). They
 * arrive from Owl Park's webstore and gather into an owl (ingest), stream
 * through the scoring gate where the fraud share turns amber and the share
 * the rules caught drops into a "flagged" tray (transform), and the rest,
 * missed fraud included, settle into the name (serve). Each stage label
 * links to the project that does that step and counts up its real number.
 * Once settled, the pointer pushes points aside and they spring back.
 *
 * Progressive enhancement: the stage ships `hidden` and the real <h1>
 * stays visible, so no-JS visitors and browsers without canvas see the
 * plain hero (theme.js holds the stage's empty box in place from the
 * first paint, so the intro doesn't jump on a phone). When this script starts, it shows the stage and adds
 * `hero--pipe` to the hero, which keeps the <h1> for screen readers and
 * search but hides it visually (the canvas is aria-hidden; the stage links
 * carry the numbers as text). If the snapshot can't be read, the dots run
 * the same path with no fraud split and the labels show no numbers.
 * Under prefers-reduced-motion the finished state is drawn once, with no
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
    var note = stage.querySelector("[data-hero-note]");
    var nums = {};
    Array.prototype.forEach.call(stage.querySelectorAll("[data-hero-num]"), function (el) {
        nums[el.getAttribute("data-hero-num")] = el;
    });
    var ctx = cv && cv.getContext && cv.getContext("2d");
    /* theme.js holds the stage's place (`hero-wait`) until this script
     * starts; with no canvas, give the plain hero back. */
    var waiting = document.documentElement.classList;
    if (!ctx || !hero) { waiting.remove("hero-wait"); return; }

    var mqMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    var mqDark = window.matchMedia("(prefers-color-scheme: dark)");
    var NAME = (hero.querySelector(".hero__name") || {}).textContent || "Logan Mansfield";
    NAME = NAME.replace(/\.\s*$/, "").trim();
    var MAX_POINTS = 2600;
    var SNAPSHOT_URL = "/data/fraud-snapshot.json";

    /* Snapshot totals; null until read (or if it can't be read). */
    var snap = null;

    var W = 0, H = 0, P = [], OC = [0, 0], TRAY = [0, 0], t0 = 0, mx = -1e4, my = -1e4;
    var colors = {};
    var running = false, onScreen = true, rafId = 0, lastW = -1, shown = {}, begun = false;

    function readColors() {
        var cs = getComputedStyle(document.documentElement);
        colors = {
            raw: cs.getPropertyValue("--ink-3").trim() || "#4a5660",
            fraud: cs.getPropertyValue("--pipe-2").trim() || "#c97a00",
            ok: cs.getPropertyValue("--pipe-3").trim() || "#0f7b6c",
            line: cs.getPropertyValue("--hairline").trim() || "#d3d8d6",
            font: cs.getPropertyValue("--font-display").trim() || "sans-serif",
            mono: cs.getPropertyValue("--font-mono").trim() || "monospace"
        };
    }

    function fmt(n) { return Math.round(n).toLocaleString("en-US"); }

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

    function shuffle(a) {
        for (var c = a.length - 1; c > 0; c--) {
            var r = Math.floor(Math.random() * (c + 1)), tmp = a[c];
            a[c] = a[r]; a[r] = tmp;
        }
        return a;
    }

    /* Shares from the snapshot: what fraction of checkouts were fraud, and
     * what fraction of the fraud the rules caught (reviewed or declined). */
    function shares() {
        if (!snap) return { fraud: 0, caught: 0 };
        return {
            fraud: snap.checkouts > 0 ? Math.min(1, snap.fraud / snap.checkouts) : 0,
            caught: snap.fraud > 0 ? Math.min(1, snap.fraud_caught / snap.fraud) : 0
        };
    }

    function build(w, h) {
        W = w; H = h;
        var phone = w < 640;
        var words = NAME.split(/\s+/);
        var two = phone && words.length > 1;
        var fs = two ? Math.min(w * 0.19, h * 0.24) : Math.min(w * 0.11, h * 0.36);
        var step = phone ? 4 : 5;
        var namePts = samplePoints(w, h, function (o, ow, oh) {
            o.fillStyle = "#000";
            o.textAlign = "center";
            o.textBaseline = "middle";
            o.font = "800 " + fs + "px " + colors.font;
            if (two) {
                o.fillText(words[0], ow / 2, oh * 0.43);
                o.fillText(words.slice(1).join(" "), ow / 2, oh * 0.43 + fs * 1.0);
            } else {
                o.fillText(NAME, ow / 2, oh * 0.56);
            }
        }, step);
        if (namePts.length > MAX_POINTS) {
            var keep = [], every = namePts.length / MAX_POINTS;
            for (var k = 0; k < MAX_POINTS; k++) keep.push(namePts[Math.floor(k * every)]);
            namePts = keep;
        }

        /* Caught fraud goes to the tray instead of the name, so add that many
         * extra points; missed fraud is a random share of the name's points. */
        var sh = shares();
        var caughtShare = sh.fraud * sh.caught;
        var nTray = Math.round(namePts.length * caughtShare / Math.max(0.01, 1 - caughtShare));
        var nMissed = Math.min(namePts.length, Math.round((namePts.length + nTray) * sh.fraud * (1 - sh.caught)));
        var trayStep = phone ? 4 : 5, trayCols = Math.max(1, Math.ceil(Math.sqrt(nTray * 3)));
        TRAY = [w / 2, h - (phone ? 52 : 58)];
        var trayRows = Math.ceil(nTray / trayCols);
        var trayPts = [];
        for (var t = 0; t < nTray; t++) {
            var col = t % trayCols, row = Math.floor(t / trayCols);
            trayPts.push([TRAY[0] + (col - (trayCols - 1) / 2) * trayStep, TRAY[1] + (row - (trayRows - 1) / 2) * trayStep]);
        }

        /* The owl sits in the ingest column, below the stage labels. */
        var top = phone ? 70 : 64;
        var os = Math.min((h - top - 44) * 0.92, (w / 3) / 0.62);
        var oxx = w / 6 - os * 0.4, oyy = top + (h - top - os) / 2;
        OC = [oxx + os * 0.4, oyy + os * 0.55];
        var cand = shuffle(samplePoints(w, h, function (o) { drawOwl(o, oxx, oyy, os); }, 2));

        var targets = namePts.map(function (p) { return { x: p[0], y: p[1], kind: "ok" }; });
        shuffle(targets.map(function (_, i) { return i; })).slice(0, nMissed).forEach(function (i) {
            targets[i].kind = "missed";
        });
        trayPts.forEach(function (p) { targets.push({ x: p[0], y: p[1], kind: "caught" }); });
        shuffle(targets);

        var lanes = 7, gate = w * 0.5;
        P = targets.map(function (tg, i) {
            var o = cand[i % Math.max(1, cand.length)] || [w / 6, h / 2];
            return {
                sx: -Math.random() * w * 0.25 - 10, sy: top + Math.random() * (h - top),
                ox: o[0], oy: o[1],
                gx: gate + (Math.random() - 0.5) * w * 0.06,
                gy: h * (0.28 + 0.5 * ((i % lanes) / (lanes - 1))) + (Math.random() - 0.5) * 8,
                tx: tg.x, ty: tg.y, kind: tg.kind,
                x: tg.x, y: tg.y, vx: 0, vy: 0,
                d: Math.random() * 1.0, d2: Math.random() * 0.9, a: Math.random() * Math.PI * 2
            };
        });
    }

    function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

    /* Timeline in seconds: checkouts gather into the owl by about 2.6, the
     * owl tilts its head until 3.9, points reach the scoring gate by about
     * 5.8 and land in the name or the tray by about 7.2. */
    var IN_DUR = 1.6, HOLD_START = 2.7, HOLD_END = 3.9, GATE_DUR = 1.0, OUT_DUR = 1.4;
    var GATE_AT = HOLD_END + 0.45 + GATE_DUR;
    var END = HOLD_END + 0.9 + GATE_DUR + OUT_DUR + 0.3;

    function setNum(key, text, fraud) {
        var el = nums[key];
        if (!el || shown[key] === text) return;
        shown[key] = text;
        el.textContent = text;
        if (el.classList) el.classList.toggle("is-fraud", !!fraud);
    }

    /* Stage labels count up as each step happens. */
    function counters(T) {
        if (!snap) return;
        var k1 = clamp01(T / (IN_DUR + 1.0));
        setNum("ingest", fmt(snap.checkouts * ease(k1)) + " checkouts");
        var k2 = clamp01((T - HOLD_END - GATE_DUR) / (0.9 + OUT_DUR * 0.5));
        setNum("transform", k2 > 0 ? fmt(snap.fraud_caught * ease(k2)) + " of " + fmt(snap.fraud * ease(k2)) + " fraud caught" : "", k2 > 0);
        setNum("serve", T >= END - 0.4 ? fmt(snap.false_declines) + " good orders declined" : "");
    }

    function draw(T, still) {
        if (still) T = END + 1;
        counters(T);
        ctx.clearRect(0, 0, W, H);
        ctx.strokeStyle = colors.line;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        [W / 3, W * 2 / 3].forEach(function (x) {
            ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, H); ctx.stroke();
        });
        ctx.setLineDash([]);

        if (snap) {
            /* The scoring gate: a line in the transform column that lights
             * up while checkouts pass through it. */
            var gateOn = clamp01(1 - Math.abs(T - GATE_AT) / 1.1);
            /* Fades away once checkouts have passed, so it never crosses the name. */
            var gateFade = clamp01((GATE_AT + 1.6 - T) / 0.8);
            ctx.globalAlpha = (0.35 + 0.65 * gateOn) * gateFade;
            ctx.strokeStyle = gateOn > 0.05 ? colors.fraud : colors.line;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(W / 2, H * 0.24); ctx.lineTo(W / 2, H * 0.8); ctx.stroke();
            ctx.globalAlpha = 1;

            /* The flagged tray's caption, once caught checkouts start landing. */
            var trayOn = clamp01((T - (HOLD_END + GATE_DUR + 0.6)) / 0.8);
            if (snap.fraud_caught > 0 && trayOn > 0) {
                ctx.globalAlpha = trayOn;
                ctx.fillStyle = colors.raw;
                ctx.font = "600 " + (W < 640 ? 9 : 10) + "px " + colors.mono;
                ctx.textAlign = "center";
                ctx.textBaseline = "bottom";
                ctx.fillText("FLAGGED", TRAY[0], TRAY[1] - (W < 640 ? 12 : 16));
                ctx.globalAlpha = 1;
            }
        }

        var sz = W < 640 ? 2.4 : 3;
        var hu = clamp01((T - HOLD_START) / (HOLD_END - HOLD_START));
        var tilt = 0.13 * Math.sin(Math.PI * 2 * hu), ct = Math.cos(tilt), st = Math.sin(tilt);
        var settled = true;
        for (var i = 0; i < P.length; i++) {
            var p = P[i], x, y, col;
            var finalCol = p.kind === "ok" ? colors.ok : colors.fraud;
            if (still) {
                x = p.tx; y = p.ty; col = finalCol;
            } else {
                var a1 = clamp01((T - p.d) / IN_DUR);
                var g0 = HOLD_END + p.d2;
                var a2 = clamp01((T - g0) / GATE_DUR);
                var a3 = clamp01((T - g0 - GATE_DUR) / OUT_DUR);
                var rx = p.ox - OC[0], ry = p.oy - OC[1];
                var ox = OC[0] + rx * ct - ry * st, oy = OC[1] + rx * st + ry * ct;
                if (a2 <= 0) {
                    /* Checkouts arrive and gather into the owl, swirling in. */
                    var k1 = ease(a1), r = Math.sin(Math.PI * a1) * Math.min(W / 6, H * 0.3), ang = p.a + T * 2.4;
                    x = p.sx + (ox - p.sx) * k1 + Math.cos(ang) * r;
                    y = p.sy + (oy - p.sy) * k1 + Math.sin(ang) * r * 0.8;
                    col = colors.raw;
                } else if (a3 <= 0) {
                    /* The owl streams out to the scoring gate. */
                    var k2 = ease(a2);
                    x = ox + (p.gx - ox) * k2;
                    y = oy + (p.gy - oy) * k2;
                    col = colors.raw;
                } else {
                    /* Past the gate: scored, colored, and sent to the name or the tray. */
                    var k3 = ease(a3), lift = Math.sin(k3 * Math.PI) * (H * 0.08);
                    x = p.gx + (p.tx - p.gx) * k3 + Math.cos(p.a) * lift;
                    y = p.gy + (p.ty - p.gy) * k3 + Math.sin(p.a) * lift * 0.6;
                    col = finalCol;
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
                    x = p.x; y = p.y; col = finalCol;
                    if (Math.abs(p.vx) + Math.abs(p.vy) > 0.05) settled = false;
                } else {
                    p.x = x; p.y = y; p.vx = 0; p.vy = 0;
                    settled = false;
                }
            }
            ctx.fillStyle = col;
            ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        }
        return settled && T > END;
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

    function showNote() {
        if (!note || !snap || !P.length) return;
        /* Phones get the short form so the note stays on one line under the tray. */
        var per = "1 dot ≈ " + fmt(snap.checkouts / P.length) + " checkouts";
        note.textContent = (W < 640 ? snap.window_days + "-day snapshot · " :
            "Replaying the fraud pipeline's " + snap.window_days + "-day snapshot of simulated checkouts · ") + per;
        note.hidden = false;
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
        showNote();
        if (mqMotion.matches) draw(0, true); else start();
    }

    function begin() {
        begun = true;
        readColors();
        stage.hidden = false;
        hero.classList.add("hero--pipe");
        waiting.remove("hero-wait");
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

    /* Read the snapshot's totals: aggregate counts only, the same file /live draws. */
    var dataReady = window.fetch
        ? fetch(SNAPSHOT_URL, { credentials: "omit" }).then(function (r) {
            return r.ok ? r.json() : null;
        }).then(function (d) {
            var t = d && d.totals;
            if (t && t.checkouts > 0 && t.fraud >= 0 && t.fraud_caught >= 0) {
                snap = {
                    checkouts: +t.checkouts, fraud: +t.fraud, fraud_caught: +t.fraud_caught,
                    false_declines: +t.false_declines || 0, window_days: +d.window_days || 30
                };
            }
        }).catch(function () {})
        : Promise.resolve();

    /* Wait for the display font (so the name is sampled in the real face)
     * and the snapshot, or start after 1.5 s with whatever has arrived. */
    var family = "Schibsted Grotesk";
    var fontReady = document.fonts && document.fonts.load
        ? document.fonts.load('800 64px "' + family + '"').catch(function () {})
        : Promise.resolve();
    var allReady = Promise.all([fontReady, dataReady]);
    var late = false;
    Promise.race([allReady, new Promise(function (res) { setTimeout(function () { late = true; res(); }, 1500); })]).then(begin);
    /* If the font or the data arrived after we started, rebuild once. */
    allReady.then(function () {
        if (late && begun && !stage.hidden && lastW > 0) { readColors(); t0 = performance.now(); fit(); }
    });
})();
