/* ─────────────────────────────────────────────────────────────
 * notfound.js — the 404 page's incident report.
 *
 * The page reads as a mock postmortem: the query that "failed", a timeline
 * and the findings. Without JavaScript it is plain, readable HTML. With it:
 *
 *   - the requested path goes into the query and the timeline. It only ever
 *     goes in through textContent or a textarea's value (never as HTML), is
 *     cleaned of control characters and capped in length, and its single
 *     quotes are doubled inside the SQL string literal;
 *   - the timeline shows real timings from this page load (Navigation
 *     Timing), when the browser has them;
 *   - the root cause line picks a likely reason from document.referrer
 *     (a link on this site, a link from elsewhere, or none);
 *   - the query becomes an editor. Run loads DuckDB-Wasm (sql-engine.js, the
 *     same engine as the "SQL source" captions, started only on Run) and adds
 *     a small in-tab `site_pages` table of the real pages, so the default
 *     query honestly returns 0 rows and dropping the WHERE line lists the
 *     pages that exist. Results are drawn as a small table with textContent;
 *     only paths from SITE_PAGES become links. The site tables and the
 *     nest-box hunt work here too, as in every editor.
 * Nothing a visitor types leaves the tab.
 * ───────────────────────────────────────────────────────────── */

import { createEngine, toObjects, cleanError, formatMs } from './sql-engine.js';
import { friendlyError, maybeEgg } from './sql-source.js';

// The pages that exist (keep in step with vercel.json's rewrites).
export const SITE_PAGES = [
    ['Home', '/'],
    ['Projects', '/projects'],
    ['Owl Park architecture', '/owl-park'],
    ['Live fraud data', '/live'],
    ['Data run status', '/status'],
    ['Data catalog', '/catalog'],
    ['Résumé', '/resume']
];
const PAGE_PATHS = new Set(SITE_PAGES.map(([, path]) => path));
const HIDDEN_TABLES = new Set(['nest_box']);
const MAX_PATH = 80;
const MAX_ROWS = 50;

const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

const PAGES_SQL = `CREATE TABLE IF NOT EXISTS site_pages AS
SELECT * FROM (VALUES ${SITE_PAGES.map(([t, p]) => `(${sqlString(t)}, ${sqlString(p)})`).join(', ')}) AS t(title, path)`;

/** The requested path as safe, readable text: decoded, no control characters, capped. */
export function cleanPath(raw) {
    let p = typeof raw === 'string' ? raw : '/';
    try { p = decodeURIComponent(p); } catch { /* keep it encoded */ }
    p = p.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '');
    if (!p.startsWith('/')) p = `/${p}`;
    if (p.length > MAX_PATH) p = `${p.slice(0, MAX_PATH - 1)}…`;
    return p;
}

export function defaultQuery(path) {
    return `SELECT title, path\nFROM site_pages\nWHERE path = ${sqlString(path)};`;
}

/** Which root cause fits: a link on this site, a link from elsewhere, or neither. */
export function rootCause(referrer, origin) {
    let ref = null;
    try { ref = referrer ? new URL(referrer) : null; } catch { ref = null; }
    if (ref && ref.origin === origin) return 'A broken link on this very site. That one’s on me.';
    if (ref) return 'A link on another site points at a page that isn’t here, or isn’t here anymore.';
    return 'A mistyped address, an old bookmark, or a page that moved.';
}

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

function cellText(v) {
    if (v === null || v === undefined) return 'NULL';
    if (Array.isArray(v)) return v.map(cellText).join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/* ── Timeline: real timings from this page load ── */
function fillTimeline(root) {
    let nav = null;
    try { nav = performance.getEntriesByType('navigation')[0] || null; } catch { nav = null; }
    if (!nav) return;
    const start = nav.requestStart || nav.startTime || 0;
    const marks = {
        request: 0,
        response: nav.responseStart - start,
        ready: (nav.domInteractive || nav.responseEnd) - start
    };
    root.querySelectorAll('[data-nf-t]').forEach((node) => {
        const ms = marks[node.getAttribute('data-nf-t')];
        if (!Number.isFinite(ms) || ms < 0) return;
        node.textContent = `+${Math.round(ms).toLocaleString('en-US')} ms`;
    });
}

/* ── The editor ── */
let engine = null;
let schema = null;

async function loadSchema(eng) {
    if (schema) return schema;
    try {
        const { result } = await eng.run(
            "SELECT DISTINCT table_name AS t, lower(column_name) AS c, table_catalog AS db FROM information_schema.columns");
        const rows = toObjects(result, 5000);
        schema = {
            tables: [...new Set(rows.filter((r) => r.db === 'memory' && !HIDDEN_TABLES.has(r.t)).map((r) => r.t))].sort(),
            all: new Set(rows.map((r) => String(r.t).toLowerCase())),
            columns: new Set(rows.map((r) => r.c))
        };
    } catch {
        return { tables: [], all: new Set(), columns: new Set() };
    }
    return schema;
}

function resultTable(result) {
    const names = result.fields.map((f) => f.name);
    const rows = toObjects(result, MAX_ROWS);
    const body = rows.length
        ? rows.map((r) => el('tr', {}, ...names.map((n) => {
            const v = r[n];
            // Only the site's own page paths become links.
            if (n.toLowerCase() === 'path' && typeof v === 'string' && PAGE_PATHS.has(v)) {
                return el('td', {}, el('a', { href: v, text: v }));
            }
            return el('td', { text: cellText(v) });
        })))
        : [el('tr', {}, el('td', { class: 'nf-empty', colspan: String(Math.max(1, names.length)), text: '(0 rows)' }))];
    const wrap = el('div', { class: 'sql-src__result', tabindex: '0', role: 'region', 'aria-label': 'Query result' },
        el('table', { class: 'sql-src__table' },
            el('thead', {}, el('tr', {}, ...names.map((n) => el('th', { scope: 'col', text: n })))),
            el('tbody', {}, ...body)));
    if (result.numRows > MAX_ROWS) wrap.append(el('p', { class: 'sql-src__more', text: `First ${MAX_ROWS} of ${plural(result.numRows, 'row')}.` }));
    return wrap;
}

function mountEditor(root, sql) {
    const host = root.querySelector('[data-nf-editor]');
    const status = root.querySelector('[data-nf-status]');
    const hint = root.querySelector('[data-nf-hint]');
    if (!host || !status) return;

    const input = el('textarea', {
        class: 'sql-src__input nf-input', id: 'nf-sql', spellcheck: 'false', autocomplete: 'off',
        autocapitalize: 'off', autocorrect: 'off', 'aria-label': 'The query that failed', rows: '3',
        'aria-describedby': hint ? 'nf-hint' : null
    });
    input.value = sql;
    const run = el('button', { class: 'sql-src__btn sql-src__btn--run', type: 'button' }, 'Run');
    const reset = el('button', { class: 'sql-src__btn', type: 'button', disabled: true }, 'Reset');
    const out = el('div', { class: 'sql-src__out nf-out' });
    host.replaceChildren(input, el('div', { class: 'sql-src__bar' }, run, reset), out);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Result: 0 rows. Press Run to check.';
    if (hint) { hint.id = 'nf-hint'; hint.hidden = false; }

    const fit = () => {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight + 2, 360)}px`;
    };
    requestAnimationFrame(fit);
    const syncReset = () => { reset.disabled = input.value === sql && !out.firstChild; };
    input.addEventListener('input', () => { fit(); syncReset(); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); }
    });

    let running = false;
    const state = { out };

    async function go() {
        if (running) { engine && engine.cancel('user'); return; }
        const text = input.value;
        if (!text.trim()) { status.textContent = 'Type a query first.'; return; }
        if (!engine) engine = createEngine({ onStatus: (msg) => { if (running && msg !== 'Ready.') status.textContent = msg; } });
        running = true;
        run.textContent = 'Stop';
        status.textContent = engine.loaded ? 'Running…' : 'Loading DuckDB…';
        let res = null;
        let failure = null;
        try {
            await engine.run(PAGES_SQL);
            res = await engine.run(text);
        } catch (err) {
            failure = err;
        } finally {
            running = false;
            run.textContent = 'Run';
        }
        if (failure) {
            if (failure.cancelled) {
                status.textContent = failure.cancelled === 'timeout' ? 'That ran past 30 seconds, so it was stopped.' : 'Stopped.';
            } else if (!engine.loaded) {
                status.textContent = 'DuckDB didn’t load. Check your connection and press Run to try again.';
            } else if (failure.message === 'busy') {
                status.textContent = 'Another query is still running. Try again in a moment.';
            } else {
                const raw = cleanError(failure);
                const msg = friendlyError(raw, await loadSchema(engine), text);
                status.textContent = 'Incident escalated: the query errored.';
                out.replaceChildren(el('div', { class: 'sql-src__error', role: 'alert' },
                    el('p', { text: msg.title }), msg.hint ? el('p', { text: msg.hint }) : null));
            }
            syncReset();
            return;
        }
        const took = formatMs(res.ms);
        if (maybeEgg(state, res.result, text)) {
            status.textContent = `1 row · ${took}`;
            syncReset();
            return;
        }
        const n = res.result.numRows;
        if (!res.result.fields.length) {
            out.replaceChildren();
            status.textContent = `Done · ${took}. That query returned no columns.`;
        } else {
            out.replaceChildren(resultTable(res.result));
            status.textContent = n === 0
                ? `Result: 0 rows · ${took}. Confirmed: still not found.`
                : `Result: ${plural(n, 'row')} · ${took}. Incident resolved.`;
        }
        syncReset();
    }

    run.addEventListener('click', go);
    reset.addEventListener('click', () => {
        input.value = sql;
        out.replaceChildren();
        status.textContent = 'Result: 0 rows. Press Run to check.';
        fit();
        syncReset();
        input.focus();
    });
}

/* ── Start ── */
function start() {
    const root = document.querySelector('[data-nf]');
    if (!root) return;
    const path = cleanPath(location.pathname);
    const sql = defaultQuery(path);
    root.querySelectorAll('[data-nf-path]').forEach((node) => { node.textContent = path; });
    const pre = root.querySelector('[data-nf-sql]');
    if (pre) pre.textContent = sql;
    const cause = root.querySelector('[data-nf-cause]');
    if (cause) cause.textContent = rootCause(document.referrer, location.origin);
    fillTimeline(root);
    mountEditor(root, sql);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
