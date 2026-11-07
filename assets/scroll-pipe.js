/* scroll-pipe.js: Home's scroll-linked pipeline rail.
 *
 * Once the hero replay has scrolled out of view, a slim rail appears in
 * the left margin with the same three stages as the hero (Ingest, Transform,
 * Serve, linking to the same pages). One checkout dot travels down it as
 * the visitor scrolls Home: it starts grey like the hero's raw dots, turns
 * teal once it has passed the fraud rules, and reaches Serve at the end of
 * the page. Each stage lights when the dot reaches it.
 *
 * Progressive enhancement and opt-outs:
 *   - built by this script, so no-JS visitors see nothing extra
 *   - wide screens only (CSS shows it from 1280px, where the margin has room);
 *     phones and tablets get nothing and no scroll work runs there
 *   - text mode (html.text-mode, set by theme.js) hides it
 *   - prefers-reduced-motion keeps the stages lighting but drops the moving
 *     dot and every transition
 * The rail is aria-hidden and its links are out of the tab order, because
 * the hero already carries the same links as text.
 */
(function () {
    "use strict";
    var hero = document.querySelector(".page-home .hero");
    if (!hero || !window.matchMedia) return;

    var wide = window.matchMedia("(min-width: 1280px)");
    var STAGES = [
        { kind: "Ingest", what: "Owl Park webstore", href: "/projects#owl-park" },
        { kind: "Transform", what: "Fraud rules", href: "/projects#fraud" },
        { kind: "Serve", what: "Live numbers", href: "/live" }
    ];

    var rail = document.createElement("div");
    rail.className = "scroll-pipe";
    rail.setAttribute("aria-hidden", "true");
    var html = '<span class="scroll-pipe__track"><span class="scroll-pipe__fill"></span><span class="scroll-pipe__dot"></span></span><ol class="scroll-pipe__stops">';
    STAGES.forEach(function (s, i) {
        html += '<li class="scroll-pipe__stop" data-stop="' + i + '"><a href="' + s.href + '" tabindex="-1" title="' + s.what + '">' +
            '<span class="scroll-pipe__node"></span><span class="scroll-pipe__kind">' + s.kind + '</span></a></li>';
    });
    rail.innerHTML = html + "</ol>";
    document.body.appendChild(rail);

    var stops = rail.querySelectorAll(".scroll-pipe__stop");
    var root = document.documentElement;
    var heroGone = false, ticking = false, listening = false, lastP = -1;

    function progress() {
        var max = root.scrollHeight - window.innerHeight;
        if (max <= 0) return 1;
        return Math.max(0, Math.min(1, (window.scrollY || root.scrollTop) / max));
    }

    function paint() {
        ticking = false;
        var p = progress();
        if (Math.abs(p - lastP) < 0.001) return;
        lastP = p;
        rail.style.setProperty("--p", p.toFixed(4));
        for (var i = 0; i < stops.length; i++) {
            var at = i / (stops.length - 1);
            stops[i].setAttribute("data-state", p + 0.002 >= at ? "on" : "off");
        }
        rail.classList.toggle("is-served", p >= 0.5);
    }

    function onScroll() {
        if (!ticking) { ticking = true; window.requestAnimationFrame(paint); }
    }

    function show() {
        rail.classList.toggle("is-shown", heroGone && wide.matches);
    }

    function wire() {
        var on = wide.matches;
        if (on && !listening) {
            window.addEventListener("scroll", onScroll, { passive: true });
            window.addEventListener("resize", onScroll, { passive: true });
            listening = true;
            lastP = -1;
            paint();
        } else if (!on && listening) {
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
            listening = false;
        }
        show();
    }

    if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (entries) {
            heroGone = !entries[entries.length - 1].isIntersecting;
            show();
        }, { threshold: 0 }).observe(hero);
    } else {
        heroGone = true;
    }

    if (wide.addEventListener) wide.addEventListener("change", wire);
    else if (wide.addListener) wide.addListener(wire);
    wire();
})();
