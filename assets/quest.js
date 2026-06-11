/* quest.js — site tour tracker + flock easter egg.
 * Tracks which core pages a visitor has seen (localStorage only, no network)
 * and shows a small progress pill. Completing the tour celebrates and points
 * to LinkedIn. Konami code (↑↑↓↓←→←→BA) releases the crows.
 */
(function () {
    'use strict';

    var STOPS = [
        { path: '/', label: 'Home' },
        { path: '/sql', label: 'SQL' },
        { path: '/python', label: 'Python' },
        { path: '/bi', label: 'BI' },
        { path: '/ai-engineering', label: 'AI Engineering' }
    ];
    var KEY = 'lm-quest-visited';
    var DONE_KEY = 'lm-quest-celebrated';
    var LINKEDIN = 'https://www.linkedin.com/in/lmansf96/';
    var reduceMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function currentPath() {
        var p = location.pathname.replace(/\.html$/, '').replace(/\/$/, '');
        if (p === '' || p === '/index') return '/';
        return p;
    }

    function getVisited() {
        try { return JSON.parse(localStorage.getItem(KEY)) || []; }
        catch (e) { return []; }
    }

    function setVisited(list) {
        try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* private mode */ }
    }

    var style = document.createElement('style');
    style.textContent = [
        '.quest-pill{position:fixed;left:1rem;bottom:1rem;z-index:60;display:flex;align-items:center;gap:.45rem;',
        'padding:.5rem .85rem;border:1px solid var(--hairline-strong);border-radius:999px;cursor:pointer;',
        'background:var(--surface-1);color:var(--ink-1);font:500 .8rem/1 var(--font-mono);',
        'box-shadow:0 4px 14px rgba(44,31,23,.12);transition:transform var(--dur-fast) var(--ease-out)}',
        '.quest-pill:hover{transform:translateY(-2px)}',
        '.quest-pill.is-done{border-color:var(--accent-2);background:var(--surface-2)}',
        '.quest-panel{position:fixed;left:1rem;bottom:3.6rem;z-index:61;width:min(15.5rem,calc(100vw - 2rem));',
        'padding:.9rem;border:1px solid var(--hairline-strong);border-radius:var(--r-lg);',
        'background:var(--surface-1);box-shadow:0 10px 30px rgba(44,31,23,.18);display:none}',
        '.quest-panel.is-open{display:block}',
        '.quest-panel h3{margin:0 0 .15rem;font:600 .85rem var(--font-display);color:var(--ink-1)}',
        '.quest-panel p{margin:0 0 .6rem;font:400 .72rem/1.4 var(--font-text);color:var(--ink-2)}',
        '.quest-panel ul{list-style:none;margin:0;padding:0}',
        '.quest-panel li a{display:flex;justify-content:space-between;gap:.5rem;padding:.34rem .4rem;',
        'border-radius:var(--r-sm);font:500 .78rem var(--font-text);color:var(--ink-1);text-decoration:none}',
        '.quest-panel li a:hover{background:var(--surface-2)}',
        '.quest-panel li a .quest-mark{color:var(--ink-3)}',
        '.quest-panel li.is-visited a .quest-mark{color:var(--success)}',
        '.quest-cta{display:block;margin-top:.6rem;padding:.5rem .6rem;border-radius:var(--r-md);text-align:center;',
        'background:var(--accent);color:#fffbf3;font:600 .78rem var(--font-text);text-decoration:none}',
        '.quest-cta:hover{filter:brightness(1.06)}',
        '.quest-burst{position:fixed;z-index:80;pointer-events:none;font-size:1.3rem;',
        'animation:quest-fall 1.6s var(--ease-out) forwards}',
        '@keyframes quest-fall{from{transform:translateY(0) rotate(0);opacity:1}',
        'to{transform:translateY(45vh) rotate(60deg);opacity:0}}',
        '.quest-crow{position:fixed;z-index:80;left:-3rem;pointer-events:none;font-size:1.6rem;',
        'animation:quest-fly var(--quest-dur,3s) linear forwards}',
        '@keyframes quest-fly{to{transform:translateX(calc(100vw + 6rem))}}',
        '@media (prefers-reduced-motion:reduce){.quest-burst,.quest-crow{animation:none;display:none}}'
    ].join('');
    document.head.appendChild(style);

    /* ── Progress tracking ── */
    var visited = getVisited();
    var here = currentPath();
    if (STOPS.some(function (s) { return s.path === here; }) && visited.indexOf(here) === -1) {
        visited.push(here);
        setVisited(visited);
    }
    var done = visited.length >= STOPS.length;

    var pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'quest-pill' + (done ? ' is-done' : '');
    pill.setAttribute('aria-expanded', 'false');
    pill.setAttribute('aria-controls', 'quest-panel');
    pill.setAttribute('aria-label', 'Site tour progress: ' + visited.length + ' of ' + STOPS.length + ' pages explored');
    pill.innerHTML = (done ? '🏆' : '🗺️') + ' <span>' + visited.length + '/' + STOPS.length + '</span>';

    var panel = document.createElement('div');
    panel.id = 'quest-panel';
    panel.className = 'quest-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Site tour');
    panel.innerHTML =
        '<h3>' + (done ? 'Tour complete! 🎉' : 'Explore the portfolio') + '</h3>' +
        '<p>' + (done
            ? 'You have seen the whole tour — the logical next step is a conversation.'
            : 'Visit every stop to complete the tour. No prize, just well-modeled data.') + '</p>' +
        '<ul>' + STOPS.map(function (s) {
            var seen = visited.indexOf(s.path) !== -1;
            return '<li class="' + (seen ? 'is-visited' : '') + '">' +
                '<a href="' + s.path + '">' + s.label +
                ' <span class="quest-mark">' + (seen ? '✓' : '○') + '</span></a></li>';
        }).join('') + '</ul>' +
        (done ? '<a class="quest-cta" href="' + LINKEDIN + '" target="_blank" rel="noopener noreferrer">Let’s talk on LinkedIn ↗</a>' : '');

    document.body.appendChild(pill);
    document.body.appendChild(panel);

    pill.addEventListener('click', function () {
        var open = panel.classList.toggle('is-open');
        pill.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) {
        if (!panel.contains(e.target) && e.target !== pill && !pill.contains(e.target)) {
            panel.classList.remove('is-open');
            pill.setAttribute('aria-expanded', 'false');
        }
    });

    /* ── Completion celebration (once) ── */
    function burst(emojis, count) {
        if (reduceMotion) return;
        for (var i = 0; i < count; i++) {
            var node = document.createElement('span');
            node.className = 'quest-burst';
            node.textContent = emojis[i % emojis.length];
            node.style.left = (8 + Math.random() * 84) + 'vw';
            node.style.top = (5 + Math.random() * 25) + 'vh';
            node.style.animationDelay = (Math.random() * 0.5) + 's';
            document.body.appendChild(node);
            setTimeout(function (n) { return function () { n.remove(); }; }(node), 2400);
        }
    }
    if (done && !localStorage.getItem(DONE_KEY)) {
        try { localStorage.setItem(DONE_KEY, '1'); } catch (e) { /* ignore */ }
        burst(['🎉', '✨', '🐦‍⬛'], 18);
        panel.classList.add('is-open');
        pill.setAttribute('aria-expanded', 'true');
    }

    /* ── Easter egg: Konami code releases the flock ── */
    var KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
        'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    var buffer = [];
    document.addEventListener('keydown', function (e) {
        buffer.push(e.key);
        if (buffer.length > KONAMI.length) buffer.shift();
        if (buffer.join(',').toLowerCase() === KONAMI.join(',').toLowerCase()) {
            buffer = [];
            releaseTheCrows();
        }
    });

    function releaseTheCrows() {
        if (reduceMotion) {
            pill.innerHTML = '🐦‍⬛ <span>Caw!</span>';
            return;
        }
        for (var i = 0; i < 12; i++) {
            var crow = document.createElement('span');
            crow.className = 'quest-crow';
            crow.textContent = '🐦‍⬛';
            crow.style.top = (5 + Math.random() * 70) + 'vh';
            crow.style.setProperty('--quest-dur', (2.2 + Math.random() * 2.5) + 's');
            crow.style.animationDelay = (Math.random() * 1.2) + 's';
            document.body.appendChild(crow);
            setTimeout(function (n) { return function () { n.remove(); }; }(crow), 6500);
        }
    }

    /* ── A note for fellow devtools archaeologists ── */
    /* eslint-disable no-console */
    console.log(
        '%c   __\n' +
        '  ( o>    Caw! You found the console.\n' +
        '  ///\\    Curiosity is the first analytics skill.\n' +
        '  \\V_/_\n',
        'font-family:monospace'
    );
    console.log('Try the Konami code on any page: ↑ ↑ ↓ ↓ ← → ← → B A');
    console.log('Hiring? Let’s talk: ' + LINKEDIN);
})();
