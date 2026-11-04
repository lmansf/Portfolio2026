/* ─────────────────────────────────────────────────────────────
 * console.js — the SQL console docked along the bottom of the site.
 *
 * The site is a small database (data/console/site.sql, built from the pages
 * by scripts/build_console_data.py, plus the synthetic Owl Park sample data).
 * The console starts as one slim bar; the pages above it are plain HTML and
 * work exactly as before, with or without it. Opening the bar loads DuckDB in
 * the browser (sql-engine.js) and shows an editor:
 *
 *   - Nav as queries: while the console is open, the top nav's Home and
 *     Projects links type their page's query into the editor and run it,
 *     instead of swapping the page. The results render as the site's own
 *     cards (project cards, the experience timeline, chips), with a Table
 *     view and a link to the full page.
 *   - Editable: change any query and run it again (Ctrl or ⌘ + Enter).
 *   - Everything runs on the visitor's device; nothing they type is sent
 *     anywhere. Results are written with textContent, and card links only
 *     ever point at https:// addresses or this site's own paths. A card's
 *     "How the data flows" link opens the diagram's modal through the
 *     page's own trigger (pipeline.js), as the page's card does.
 *
 * Whether the console is open is remembered in localStorage (per visitor,
 * best effort: it starts collapsed when storage is unavailable).
 * ───────────────────────────────────────────────────────────── */

import { createEngine, toObjects, eachRow, getCell, formatValue, isNumericType, cleanError, formatMs, csvCell, MAX_ROWS_KEPT, QUERY_TIMEOUT_MS } from './sql-engine.js';

const OPEN_KEY = 'sqlc-open';
const MAX_ROWS_SHOWN = 500;
const MAX_CARDS = 60;

// Each page the nav can reach, as the query that "is" that page.
const ROUTES = {
    '/': {
        name: 'Home',
        sql: `-- Home: who I am and where to reach me
SELECT * FROM resume;`
    },
    '/projects': {
        name: 'Projects',
        sql: `-- Projects: featured first, in the order the page shows them
SELECT * FROM projects
ORDER BY featured DESC, sort_order;`
    }
};

const ROUTE_ALIASES = { '/index.html': '/', '/projects.html': '/projects' };

function routeFor(pathname) {
    const clean = (pathname || '/').replace(/\/+$/, '') || '/';
    const key = ROUTE_ALIASES[clean] || clean;
    return ROUTES[key] ? key : null;
}

const store = {
    get(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
    set(key, value) {
        try {
            if (value === null) window.localStorage.removeItem(key);
            else window.localStorage.setItem(key, value);
        } catch { /* private mode: not remembered */ }
    }
};

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) {
        if (c === null || c === undefined || c === false) continue;
        node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
}

// Only https:// links and this site's own paths ever become hrefs.
function safeHref(url) {
    if (typeof url !== 'string') return null;
    const u = url.trim();
    if (/^https:\/\/[^\s/]+/i.test(u)) return u;
    if (/^\/(?![\/\\])[^\s\\\x00-\x1f\x7f]*$/.test(u)) return u;
    if (/^mailto:[^\s@]+@[^\s@]+$/i.test(u)) return u;
    return null;
}

// "How the data flows" links (/projects#<figure id>) open the diagram's modal
// through the page's own [data-flow-open] trigger (see pipeline.js).
const FLOW_LINK = /^\/projects#([a-z0-9-]+)$/i;

function flowTrigger(href) {
    const m = FLOW_LINK.exec(href);
    return m ? document.querySelector('[data-flow-open="' + m[1].toLowerCase() + '"]') : null;
}

function linkEl(label, url, cls) {
    const href = safeHref(url);
    if (!href) return el('span', { class: cls, text: label });
    const external = /^https:\/\//i.test(href);
    const a = el('a', {
        class: cls,
        href,
        target: external ? '_blank' : null,
        rel: external ? 'noopener' : null
    }, label + (external ? ' ↗' : ''));
    if (!external && FLOW_LINK.test(href)) {
        const trigger = flowTrigger(href);
        if (trigger && trigger.tagName === 'BUTTON') a.setAttribute('aria-haspopup', 'dialog');
        a.addEventListener('click', (e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            e.stopPropagation();
            const t = flowTrigger(href);
            if (!t) { window.location.assign(href); return; }
            t.click();
            const dialog = document.getElementById(FLOW_LINK.exec(href)[1].toLowerCase() + '-dialog');
            if (dialog) {
                dialog.addEventListener('close', () => {
                    if (document.documentElement.contains(a)) a.focus({ preventScroll: true });
                }, { once: true });
            }
        });
    }
    return a;
}

function init() {
    if (document.querySelector('.sqlc')) return;
    const engine = createEngine({ onStatus: setStatus });
    let lastResult = null;
    let lastRoute = null;
    let view = 'cards';
    let typing = null;
    let busy = false;
    let pendingRoute = null;

    // ── Markup ──
    const toggle = el('button', {
        class: 'sqlc__toggle',
        type: 'button',
        'aria-expanded': 'false',
        'aria-controls': 'sqlc-panel'
    },
    el('span', { class: 'sqlc__prompt', 'aria-hidden': 'true', text: '>_' }),
    el('span', { class: 'sqlc__label', text: 'SQL console' }),
    el('span', { class: 'sqlc__hint', text: 'This site is a database. Query it.' }),
    el('span', { class: 'sqlc__chev', 'aria-hidden': 'true' }));

    const sql = el('textarea', {
        id: 'sqlc-sql',
        class: 'sqlc__sql',
        spellcheck: 'false',
        autocapitalize: 'off',
        autocomplete: 'off',
        autocorrect: 'off',
        rows: "4"
    });
    const runBtn = el('button', { class: 'btn btn--primary sqlc__run', type: 'button' }, 'Run ', el('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }));
    const cancelBtn = el('button', { class: 'btn btn--ghost sqlc__cancel', type: 'button', hidden: true }, 'Cancel');
    const status = el('p', { class: 'sqlc__status', role: 'status', 'aria-live': 'polite', text: 'DuckDB loads when you open the console.' });
    const keys = el('span', { class: 'sqlc__keys', text: 'Ctrl or ⌘ + Enter runs it' });

    const meta = el('p', { class: 'sqlc__meta' });
    const viewCards = el('button', { class: 'sqlc__view', type: 'button', 'aria-pressed': 'true', 'data-view': 'cards' }, 'Cards');
    const viewTable = el('button', { class: 'sqlc__view', type: 'button', 'aria-pressed': 'false', 'data-view': 'table' }, 'Table');
    const views = el('div', { class: 'sqlc__views', role: 'group', 'aria-label': 'Show results as', hidden: true }, viewCards, viewTable);
    const pageLink = el('a', { class: 'sqlc__pagelink', hidden: true });
    const csvBtn = el('button', { class: 'sqlc__csv', type: 'button', hidden: true }, 'CSV');
    const resultHead = el('div', { class: 'sqlc__result-head' }, meta, el('div', { class: 'sqlc__result-tools' }, views, csvBtn, pageLink));
    const out = el('div', { class: 'sqlc__out', tabindex: '0', role: 'region', 'aria-label': 'Query results' });
    const result = el('div', { class: 'sqlc__result', hidden: true }, resultHead, out);
    const error = el('div', { class: 'sqlc__error', role: 'alert', hidden: true });

    const panel = el('div', { class: 'sqlc__panel', id: 'sqlc-panel', role: 'region', 'aria-label': 'SQL editor and results', hidden: true },
        el('div', { class: 'sqlc__inner' },
            el('div', { class: 'sqlc__editor' },
                el('label', { class: 'sr-only', for: 'sqlc-sql', text: 'SQL query' }),
                sql,
                el('div', { class: 'sqlc__bar' }, runBtn, cancelBtn, status, keys)),
            error,
            result));

    const root = el('aside', { class: 'sqlc', 'aria-label': 'SQL console' },
        el('div', { class: 'sqlc__dock' }, toggle),
        panel);
    document.body.append(root);
    document.body.classList.add('has-sqlc');

    // ── Open / close ──
    function isOpen() { return root.classList.contains('is-open'); }

    function open({ focus = true, remember = true } = {}) {
        if (isOpen()) return;
        root.classList.add('is-open');
        panel.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        if (remember) store.set(OPEN_KEY, '1');
        if (!sql.value) loadRouteQuery(routeFor(window.location.pathname));
        updatePageLink();
        if (focus) sql.focus({ preventScroll: true });
        const saveData = navigator.connection && navigator.connection.saveData;
        if (saveData && !engine.loaded) {
            setStatus('Data saver is on, so DuckDB (about 7 MB) loads when you press Run.');
        } else if (!lastResult) {
            run();
        }
    }

    function close({ remember = true } = {}) {
        if (!isOpen()) return;
        if (typing) {
            const { text } = typing;
            stopTyping();
            sql.value = text;
            fit();
        }
        root.classList.remove('is-open');
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        if (remember) store.set(OPEN_KEY, null);
    }

    toggle.addEventListener('click', () => {
        if (isOpen()) {
            close();
            toggle.focus();
        } else {
            open();
        }
    });

    root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) {
            if (busy) return; // Escape inside a run shouldn't drop the panel
            close();
            toggle.focus();
        }
    });

    // ── The editor ──
    function loadRouteQuery(key) {
        lastRoute = key;
        const route = key ? ROUTES[key] : ROUTES['/projects'];
        sql.value = route.sql;
        fit();
    }

    sql.addEventListener('input', () => {
        stopTyping();
        lastRoute = null;
        fit();
    });
    sql.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            run();
        }
    });
    runBtn.addEventListener('click', run);
    cancelBtn.addEventListener('click', () => {
        cancelBtn.disabled = true;
        setStatus('Stopping…');
        engine.cancel('user');
    });

    function setStatus(text) {
        status.textContent = text;
    }

    // Grow the editor with its query (3 to 14 lines); it can still be dragged.
    function fit() {
        const lines = sql.value.split('\n').length;
        sql.rows = Math.max(3, Math.min(14, lines + 1));
    }

    // Type the text into the editor a few characters at a time (instantly
    // with reduced motion). Resolves true once the whole text is in, false
    // when something interrupted it (the visitor typed, or another query
    // started typing).
    function typeInto(text) {
        stopTyping();
        if (reduceMotion()) {
            sql.value = text;
            fit();
            return Promise.resolve(true);
        }
        return new Promise((resolve) => {
            const total = text.length;
            const steps = Math.min(36, total);
            let i = 0;
            sql.value = '';
            sql.rows = Math.max(3, Math.min(14, text.split('\n').length + 1));
            typing = {
                text,
                resolve,
                timer: setInterval(() => {
                    i++;
                    sql.value = text.slice(0, Math.ceil((total * i) / steps));
                    if (i >= steps) stopTyping(true);
                }, 16)
            };
        });
    }

    // Stop the typing animation; with complete, put the whole text in first.
    function stopTyping(complete = false) {
        if (!typing) return;
        clearInterval(typing.timer);
        const { text, resolve } = typing;
        typing = null;
        if (complete) {
            sql.value = text;
            fit();
        }
        resolve(complete);
    }

    // ── Nav as queries ──
    document.addEventListener('click', (e) => {
        if (!isOpen() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const link = e.target instanceof Element ? e.target.closest('.topnav a[href], .site-nav__panel a[href]') : null;
        if (!link || link.target === '_blank') return;
        let url;
        try { url = new URL(link.getAttribute('href'), window.location.href); } catch { return; }
        if (url.origin !== window.location.origin || url.hash) return;
        const key = routeFor(url.pathname);
        if (!key) return;
        e.preventDefault();
        e.stopPropagation(); // keep transition.js from swapping the page
        const backdrop = document.querySelector('body.site-nav-open [data-nav-close]');
        if (backdrop) backdrop.click();
        runRoute(key);
    }, true);

    async function runRoute(key) {
        if (busy) {
            pendingRoute = key;
            setStatus(`Running… the ${ROUTES[key].name} query runs next.`);
            return;
        }
        pendingRoute = null;
        lastRoute = key;
        sql.focus({ preventScroll: true });
        const typed = await typeInto(ROUTES[key].sql);
        if (!typed || busy) return;
        lastRoute = key;
        run();
    }

    // ── Run ──
    async function run() {
        if (busy) return;
        busy = true;
        try {
            stopTyping(true);
            const text = sql.value.trim();
            if (!text) {
                setStatus('Type a query first.');
                sql.focus();
                return;
            }
            const route = lastRoute;
            runBtn.disabled = true;
            error.hidden = true;
            try {
                if (!engine.loaded) setStatus('Loading DuckDB…');
                await engine.ready();
                cancelBtn.hidden = false;
                cancelBtn.disabled = false;
                setStatus('Running…');
                const { result: res, ms } = await engine.run(text);
                render(res, ms, route);
                setStatus(`Done in ${formatMs(ms)}.`);
            } catch (err) {
                if (err && err.cancelled) {
                    const why = err.cancelled === 'timeout'
                        ? `Stopped after ${QUERY_TIMEOUT_MS / 1000} seconds.`
                        : 'Query cancelled.';
                    setStatus(err.killed ? `${why} DuckDB restarts on your next run.` : why);
                } else if (engine.loaded) {
                    showError(err);
                }
            } finally {
                if (document.activeElement === cancelBtn) runBtn.focus();
                cancelBtn.hidden = true;
                runBtn.disabled = false;
            }
        } finally {
            busy = false;
            if (pendingRoute) {
                const next = pendingRoute;
                pendingRoute = null;
                runRoute(next);
            }
        }
    }

    function showError(err) {
        lastResult = null;
        result.hidden = true;
        error.hidden = false;
        const head = el('strong', { text: 'That query didn’t run.' });
        const pre = el('pre', { text: cleanError(err) });
        error.replaceChildren(head, pre);
        setStatus('Fix the query and run it again.');
    }

    // ── Render ──
    viewCards.addEventListener('click', () => setView('cards'));
    viewTable.addEventListener('click', () => setView('table'));
    csvBtn.addEventListener('click', downloadCsv);

    function setView(v) {
        view = v;
        viewCards.setAttribute('aria-pressed', String(v === 'cards'));
        viewTable.setAttribute('aria-pressed', String(v === 'table'));
        if (lastResult) drawBody(lastResult.res);
    }

    pageLink.addEventListener('click', () => { pageLink.hidden = true; });
    window.addEventListener('popstate', updatePageLink);

    function updatePageLink() {
        const route = lastResult && lastResult.route;
        if (route && ROUTES[route] && route !== routeFor(window.location.pathname)) {
            pageLink.hidden = false;
            pageLink.href = route;
            pageLink.textContent = `Open the ${ROUTES[route].name} page →`;
        } else {
            pageLink.hidden = true;
        }
    }

    function render(res, ms, route) {
        lastResult = { res, ms, route };
        error.hidden = true;
        result.hidden = false;
        const total = res.numRows;
        const rowWord = total === 1 ? 'row' : 'rows';
        const count = res.truncated
            ? `More than ${MAX_ROWS_KEPT.toLocaleString('en-US')} rows; kept the first ${total.toLocaleString('en-US')}`
            : `${total.toLocaleString('en-US')} ${rowWord}`;
        meta.textContent = `${count} · ${formatMs(ms)}`;
        csvBtn.hidden = total === 0 || res.fields.length === 0;
        updatePageLink();
        drawBody(res);
        out.scrollTop = 0;
    }

    function drawBody(res) {
        const kind = cardKind(res.fields.map((f) => f.name));
        views.hidden = !kind;
        if (kind && view === 'cards' && res.numRows > 0) {
            out.replaceChildren(drawCards(kind, toObjects(res, MAX_CARDS), res.numRows));
            out.classList.add('is-cards');
        } else {
            out.replaceChildren(drawTable(res));
            out.classList.remove('is-cards');
        }
    }

    function drawTable(res) {
        const fields = res.fields;
        if (fields.length === 0) {
            return el('p', { class: 'sqlc__empty', text: 'The statement ran and returned no columns.' });
        }
        if (res.numRows === 0) {
            return el('p', { class: 'sqlc__empty', text: 'No rows matched.' });
        }
        const table = el('table', { class: 'sqlc__table' });
        const headRow = table.createTHead().insertRow();
        const numeric = fields.map((f) => isNumericType(f.type));
        fields.forEach((f, j) => headRow.append(el('th', { scope: 'col', class: numeric[j] ? 'is-num' : null, text: f.name })));
        const tbody = table.createTBody();
        const frag = document.createDocumentFragment();
        eachRow(res, MAX_ROWS_SHOWN, (cols, i) => {
            const tr = document.createElement('tr');
            for (let j = 0; j < fields.length; j++) {
                const v = getCell(cols[j], i, fields[j].type);
                tr.append(v === null
                    ? el('td', { class: 'is-null', text: 'NULL' })
                    : el('td', { class: numeric[j] ? 'is-num' : null, text: formatValue(v, fields[j].type) }));
            }
            frag.append(tr);
        });
        tbody.append(frag);
        const wrap = el('div', { class: 'sqlc__table-wrap' }, table);
        if (res.numRows > MAX_ROWS_SHOWN) {
            wrap.append(el('p', { class: 'sqlc__empty', text: `Showing the first ${MAX_ROWS_SHOWN} rows. Download the CSV for the rest.` }));
        }
        return wrap;
    }

    function downloadCsv() {
        if (!lastResult) return;
        const res = lastResult.res;
        const lines = [res.fields.map((f) => csvCell(f.name)).join(',')];
        eachRow(res, MAX_ROWS_KEPT, (cols, i) => {
            const cells = [];
            for (let j = 0; j < res.fields.length; j++) {
                const v = getCell(cols[j], i, res.fields[j].type);
                cells.push(v === null ? '' : csvCell(formatValue(v, res.fields[j].type)));
            }
            lines.push(cells.join(','));
        });
        const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: 'query.csv' });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // Remember the open state across pages, but don't grab focus on load.
    if (store.get(OPEN_KEY) === '1') open({ focus: false, remember: false });
}

// ── Cards: the site's own components, filled from query rows ──

// Which card a result can be drawn as, from its column names.
function cardKind(names) {
    const has = (n) => names.includes(n);
    if (has('title') && (has('summary') || has('eyebrow') || has('tags'))) return 'project';
    if (has('role') && has('org')) return 'experience';
    if (has('name') && has('headline')) return 'profile';
    if (has('skill')) return 'skill';
    if (has('credential')) return 'credential';
    return null;
}

function drawCards(kind, rows, total) {
    const frag = document.createDocumentFragment();
    if (kind === 'project') frag.append(projectCards(rows));
    else if (kind === 'experience') frag.append(experienceCards(rows));
    else if (kind === 'profile') rows.forEach((r) => frag.append(profileCard(r)));
    else if (kind === 'skill') frag.append(skillChips(rows));
    else if (kind === 'credential') frag.append(chipList(rows.map((r) => [r.credential, r.detail]), 'chip chip--cred'));
    if (total > rows.length) {
        frag.append(el('p', { class: 'sqlc__empty', text: `Showing the first ${rows.length} as cards. Switch to Table for all ${total.toLocaleString('en-US')}.` }));
    }
    return frag;
}

function str(v) {
    if (v === null || v === undefined) return '';
    return typeof v === 'string' ? v : String(v);
}

function projectCards(rows) {
    const grid = el('div', { class: 'project-grid sqlc__grid' });
    for (const r of rows) {
        const classes = ['project'];
        if (r.featured === true) classes.push('project--featured');
        if (r.status === 'archived') classes.push('project--archived');
        const badge = str(r.badge);
        const badgeCls = /^(live|running)$/i.test(badge) ? ' project__badge--live'
            : /^(retired|archived)$/i.test(badge) ? ' project__badge--muted' : '';
        const tags = Array.isArray(r.tags) ? r.tags.filter((t) => t !== null) : [];
        const links = Array.isArray(r.links) ? r.links.filter((l) => l && l.label) : [];
        grid.append(el('article', { class: classes.join(' ') },
            el('div', { class: 'project__body' },
                (r.eyebrow !== undefined || r.year !== undefined) && el('div', { class: 'project__head' },
                    r.eyebrow ? el('p', { class: 'project__eyebrow', text: str(r.eyebrow) }) : el('span'),
                    r.year !== undefined && r.year !== null ? el('span', { class: 'project__date', text: str(r.year) }) : null),
                el('h3', { class: 'project__title' }, str(r.title),
                    badge ? el('span', { class: 'project__badge' + badgeCls, text: badge }) : null),
                r.summary ? el('p', { class: 'project__desc', text: str(r.summary) }) : null,
                tags.length ? el('ul', { class: 'project__tags' }, ...tags.map((t) => el('li', { text: str(t) }))) : null,
                links.length ? el('div', { class: 'project__links' }, ...links.map((l) => linkEl(str(l.label), l.url, 'project__link'))) : null)));
    }
    return grid;
}

function monthYear(v) {
    const m = /^(\d{4})-(\d{2})/.exec(str(v));
    if (!m) return str(v);
    return new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function experienceCards(rows) {
    const list = el('ol', { class: 'xp sqlc__xp' });
    for (const r of rows) {
        const now = r.is_current === true;
        const dates = r.started !== undefined
            ? `${monthYear(r.started)} – ${now || !r.ended ? 'present' : monthYear(r.ended)}`
            : '';
        const where = [r.org, r.location].filter(Boolean).map(str).join(' · ');
        list.append(el('li', { class: 'xp__item' + (now ? ' xp__item--now' : '') },
            el('div', { class: 'xp__rail' }, el('span', { class: 'xp__dot', 'aria-hidden': 'true' })),
            el('div', { class: 'xp__card' },
                el('div', { class: 'xp__head' },
                    el('h3', { class: 'xp__role' }, str(r.role), r.note ? el('span', { class: 'xp__note', text: ` (${str(r.note)})` }) : null),
                    dates ? el('span', { class: 'xp__dates', text: dates }) : null),
                where ? el('p', { class: 'xp__org', text: where }) : null,
                r.summary ? el('p', { class: 'xp__desc', text: str(r.summary) }) : null)));
    }
    return list;
}

function profileCard(r) {
    const rows = [['Now', r.now], ['Building', r.building], ['Latest', r.latest]].filter(([, v]) => v);
    const links = [];
    if (r.resume_pdf) links.push(linkEl('Résumé (PDF)', r.resume_pdf, 'btn btn--primary'));
    if (r.email) links.push(linkEl('Email me', `mailto:${str(r.email)}`, 'btn btn--ghost'));
    if (r.linkedin) links.push(linkEl('LinkedIn', r.linkedin, 'btn btn--ghost'));
    if (r.github) links.push(linkEl('GitHub', r.github, 'btn btn--ghost'));
    return el('article', { class: 'sqlc-profile' },
        el('h3', { class: 'sqlc-profile__name', text: str(r.name) }),
        el('p', { class: 'sqlc-profile__headline', text: [r.headline, r.location].filter(Boolean).map(str).join(' · ') }),
        rows.length ? el('div', { class: 'now' }, ...rows.map(([k, v]) => el('div', { class: 'now__row' },
            el('span', { class: 'now__label', text: k }),
            el('span', { class: 'now__value', text: str(v) })))) : null,
        links.length ? el('div', { class: 'contact-row' }, ...links) : null);
}

function skillChips(rows) {
    const groups = new Map();
    for (const r of rows) {
        const g = r.category !== undefined ? str(r.category) || 'Other' : '';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(r.skill);
    }
    const wrap = el('div', { class: 'toolkit' });
    for (const [g, skills] of groups) {
        wrap.append(el('div', { class: 'toolkit__group' },
            g ? el('h3', { class: 'toolkit__label', text: g }) : null,
            chipList(skills.map((s) => [s, null]), 'chip')));
    }
    return wrap;
}

function chipList(items, cls) {
    return el('ul', { class: 'chip-list' }, ...items.map(([main, sub]) =>
        el('li', { class: cls }, str(main), sub ? el('span', { class: 'chip__sub', text: str(sub) }) : null)));
}

// The stylesheet comes with the script (no inline <style>, which the
// playground's Content-Security-Policy blocks); the bar shows once it's in.
function loadStyles() {
    return new Promise((resolve) => {
        const existing = document.querySelector('link[data-sqlc-css]');
        if (existing) { resolve(true); return; }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/assets/console.min.css';
        link.setAttribute('data-sqlc-css', '');
        link.addEventListener('load', () => resolve(true));
        link.addEventListener('error', () => resolve(false)); // no styles: leave the page as it is
        document.head.append(link);
    });
}

function start() {
    loadStyles().then((ok) => { if (ok) init(); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
