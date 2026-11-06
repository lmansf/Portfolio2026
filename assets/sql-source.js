/* ─────────────────────────────────────────────────────────────
 * sql-source.js — the runnable "SQL source" captions.
 *
 * Under each data-backed piece of a page (the project cards, the timeline,
 * the toolkit, the /live charts...) sits a collapsed
 * <details class="sql-src" data-sql-source="name"> holding the query that
 * produces that piece. The page's HTML already is that query's result
 * (scripts/build_sql_sources.py renders and checks it), so crawlers, print
 * and no-JS visitors get the real text and a readable query.
 *
 * When a caption is first opened, this file swaps its <pre> for an editor.
 * Run loads DuckDB-Wasm (sql-engine.js, once per page) and runs the query
 * over the site's own tables; if the result has the columns the piece needs,
 * the piece [data-sql-piece="name"] is redrawn from it. Anything else (an
 * error, no rows, columns that don't fit) leaves the piece as it was and
 * shows a plain message or the result as a small table instead, so a broken
 * edit never blanks the page. Reset puts back the default query and the
 * piece; a reload does the same.
 *
 * Redrawing reuses the page's own elements: a row whose key (a title, a
 * category...) matches an existing card refills that card, so its links and
 * buttons keep working; other rows get a copy of the first card with its
 * links removed. Text only ever goes in through textContent, and links built
 * from a `links` column only accept https:// and same-site paths.
 *
 * The nest box: one default query hints that not every table makes it onto
 * a page. The riddle in that table spells a claim_egg('…') call; running it
 * in any editor asks /api/egg/claim for a one-time code (docs/egg-codes.md).
 * ───────────────────────────────────────────────────────────── */

import { createEngine, toObjects, cleanError, formatMs, SNAPSHOT_TABLES } from './sql-engine.js';

const EGG_KEY = 'sqlc-egg';
const EGG_FOUND = 'You found the nest.';
const EGG_CLAIM_URL = '/api/egg/claim';
const EGG_CODE = /^EGG-[0-9A-Z-]{20,30}$/;
const HIDDEN_TABLES = new Set(['nest_box']);
const MAX_ITEMS = 60;
const MAX_TABLE_ROWS = 50;
const MAX_DAYS = 400;
const WRITES = /\b(insert|update|delete|create|drop|alter|truncate)\b/i;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/* ── Small DOM helpers ── */
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

const squash = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

// A cell value as display text: lists joined, structs as JSON.
function text(v) {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(text).join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

// Only https:// links and this site's own paths ever become hrefs.
function safeHref(url) {
    if (typeof url !== 'string') return null;
    const u = url.trim();
    if (/^https:\/\/[^\s/]+/i.test(u)) return u;
    if (/^\/(?![\/\\])[^\s\\\x00-\x1f\x7f]*$/.test(u)) return u;
    return null;
}

// "How the data flows" links (/projects#<figure id>) open the diagram's modal
// through the page's own [data-flow-open] trigger (see pipeline.js).
const FLOW_LINK = /^\/projects#([a-z0-9-]+)$/i;

function linkEl(label, url) {
    const href = safeHref(url);
    if (!href) return el('span', { class: 'project__link', text: label });
    const external = /^https:\/\//i.test(href);
    const a = el('a', {
        class: 'project__link',
        href,
        target: external ? '_blank' : null,
        rel: external ? 'noopener' : null
    }, label + (external ? ' ↗' : ''));
    const m = FLOW_LINK.exec(href);
    if (!external && m) {
        a.addEventListener('click', (e) => {
            const trigger = document.querySelector(`[data-flow-open="${m[1].toLowerCase()}"]:not(a)`);
            if (!trigger || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            e.stopPropagation();
            trigger.click();
        });
    }
    return a;
}

/* ── Fields: how one column is read from and written into an item ── */
const find = (node, sel) => (sel === ':scope' ? node : node.querySelector(sel));

// Plain text of an element.
const textField = (col, sel) => ({
    col, sel,
    read: (node) => { const e = find(node, sel); return e ? squash(e.textContent) : null; },
    write(node, v, pristine) {
        const e = find(node, sel);
        if (!e) return;
        const p = pristine && find(pristine, sel);
        // Same text as the page had: keep the page's markup (inline links, entities).
        if (p && squash(p.textContent) === squash(text(v))) e.innerHTML = p.innerHTML;
        else e.textContent = text(v);
        e.hidden = v === null;
    },
    hide(node) { const e = find(node, sel); if (e) e.hidden = true; }
});

// An element's own text, leaving a child element (a badge, a note) alone.
const ownText = (col, sel) => ({
    col, sel,
    read(node) {
        const e = find(node, sel);
        if (!e) return null;
        return squash(Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''));
    },
    write(node, v) {
        const e = find(node, sel);
        if (!e) return;
        Array.from(e.childNodes).filter((n) => n.nodeType === 3).forEach((n) => n.remove());
        const hasChild = e.firstElementChild !== null;
        e.prepend(document.createTextNode(text(v) + (hasChild ? ' ' : '')));
    },
    hide() { /* the key column: always present */ }
});

// A small span inside `parentSel` (a badge in a title, a note after a role).
const childSpan = (col, parentSel, cls, wrap = (s) => s) => ({
    col, sel: `${parentSel === ':scope' ? '' : parentSel + ' '}.${cls}`,
    read(node) {
        const e = find(node, parentSel);
        const s = e && e.querySelector(`.${cls}`);
        return s ? squash(s.textContent) : null;
    },
    write(node, v) {
        const parent = find(node, parentSel);
        if (!parent) return;
        let s = parent.querySelector(`.${cls}`);
        if (v === null || text(v) === '') { if (s) s.hidden = true; return; }
        if (!s) {
            s = el('span', { class: cls });
            parent.append(' ', s);
        }
        s.textContent = wrap(text(v));
        s.hidden = false;
    },
    hide(node) {
        const parent = find(node, parentSel);
        const s = parent && parent.querySelector(`.${cls}`);
        if (s) s.hidden = true;
    }
});

// A list column drawn as <li>s.
const listField = (col, sel, liClass) => ({
    col, sel,
    read: (node) => { const e = find(node, sel); return e ? Array.from(e.children, (li) => squash(li.textContent)) : null; },
    write(node, v, pristine) {
        const e = find(node, sel);
        if (!e) return;
        const items = (v === null ? [] : Array.isArray(v) ? v : [v]).slice(0, MAX_ITEMS).map(text);
        const p = pristine && find(pristine, sel);
        if (p && JSON.stringify(Array.from(p.children, (li) => squash(li.textContent))) === JSON.stringify(items.map(squash))) {
            e.innerHTML = p.innerHTML; // same list: keep the page's own markup
        } else {
            const parts = [];
            items.forEach((x) => parts.push(el('li', { class: liClass, text: x }), '\n'));
            e.replaceChildren(...parts);
        }
        e.hidden = items.length === 0;
    },
    hide(node) { const e = find(node, sel); if (e) e.hidden = true; }
});

/* ── The pieces ── */
const projectFields = [
    ownText('title', '.project__title'),
    childSpan('badge', '.project__title', 'project__badge'),
    textField('eyebrow', '.project__eyebrow'),
    textField('year', '.project__date'),
    textField('summary', '.project__desc'),
    listField('tags', '.project__tags', null)
];
const cards = { kind: 'items', item: 'article.project', key: 'title', fields: projectFields, links: '.project__links' };

const PIECES = {
    now: {
        kind: 'items', item: '.now__row', key: 'label', one: true,
        fields: [textField('label', '.now__label'), textField('value', '.now__value')],
        nodeKey: (node) => squash(find(node, '.now__label').textContent).toLowerCase(),
        // One row in, one line per column out: the column name is the label.
        transform: (rows, cols) => cols.map((c) => ({
            label: c.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()),
            value: rows[0][c],
            _key: c.toLowerCase().replace(/_/g, ' ')
        }))
    },
    featured: cards,
    'projects-featured': cards,
    'projects-more': cards,
    experience: {
        kind: 'items', item: 'li.xp__item', key: 'role', freshDrop: ['xp__item--now'],
        fields: [
            ownText('role', '.xp__role'),
            childSpan('note', '.xp__role', 'xp__note', (s) => `(${s})`),
            textField('org', '.xp__org'),
            textField('dates', '.xp__dates'),
            textField('summary', '.xp__desc')
        ]
    },
    credentials: {
        kind: 'items', item: 'li.chip', key: 'credential',
        fields: [ownText('credential', ':scope'), childSpan('detail', ':scope', 'chip__sub')]
    },
    toolkit: {
        kind: 'items', item: '.toolkit__group', key: 'category',
        fields: [textField('category', '.toolkit__label'), listField('skills', '.chip-list', 'chip')],
        fresh(node, i) {
            const id = `tk-sql-${i}`;
            const h = node.querySelector('.toolkit__label');
            const ul = node.querySelector('.chip-list');
            if (h) h.id = id;
            if (ul) ul.setAttribute('aria-labelledby', id);
        }
    },
    'live-totals': { kind: 'live', key: 'totals' },
    'live-daily': { kind: 'live', key: 'daily', need: ['day', 'checkouts', 'fraud', 'fraud_caught'] },
    'live-scores': { kind: 'live', key: 'score_bins', need: ['score_from', 'score_to', 'legit', 'fraud'] },
    'live-patterns': { kind: 'live', key: 'patterns', need: ['pattern', 'fraud', 'caught'] }
};

/* ── The engine, shared by every editor on the page ── */
let engine = null;
let statusTarget = null;
let schema = null; // { tables: [...], columns: [...] } for friendlier errors

function getEngine() {
    if (!engine) engine = createEngine({ onStatus: (msg) => { if (statusTarget && msg !== 'Ready.') setStatus(statusTarget, msg); } });
    return engine;
}

async function loadSchema(eng) {
    if (schema) return schema;
    try {
        const { result } = await eng.run(
            "SELECT DISTINCT table_name AS t, lower(column_name) AS c, table_catalog AS db FROM information_schema.columns");
        const rows = toObjects(result, 5000);
        schema = {
            tables: [...new Set(rows.filter((r) => r.db === 'memory' && !HIDDEN_TABLES.has(r.t)).map((r) => r.t))].sort(),
            all: new Set(rows.map((r) => r.t.toLowerCase())),
            columns: new Set(rows.map((r) => r.c))
        };
    } catch (err) {
        if (err && (err.message === 'busy' || err.cancelled)) throw err;
        return { tables: [], all: new Set(), columns: new Set() };
    }
    return schema;
}

/* ── One caption ── */
const editors = new WeakMap();

function hydrate(details) {
    if (editors.has(details)) return;
    const name = details.getAttribute('data-sql-source');
    const cfg = PIECES[name];
    const panel = details.querySelector('.sql-src__panel');
    const pre = panel && panel.querySelector(':scope > pre.sql-src__code');
    if (!cfg || !pre) return;
    const label = details.getAttribute('data-sql-label') || 'this piece';
    const piece = document.querySelector(`[data-sql-piece="${name}"]`);
    const defaultSql = pre.textContent;
    const state = { name, cfg, label, piece, defaultSql, edited: false, wrote: false, saved: null };
    editors.set(details, state);

    const id = `sql-src-${name}`;
    const input = el('textarea', {
        class: 'sql-src__input', id, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off',
        autocorrect: 'off', 'aria-label': `SQL for ${label}`, 'aria-describedby': `${id}-hint`, rows: '3'
    });
    input.value = defaultSql;
    const run = el('button', { class: 'sql-src__btn sql-src__btn--run', type: 'button' }, 'Run');
    const reset = el('button', { class: 'sql-src__btn', type: 'button', disabled: true }, 'Reset');
    const keys = el('span', { class: 'sql-src__keys', 'aria-hidden': 'true', text: isMac ? '⌘ Enter' : 'Ctrl Enter' });
    const status = el('p', { class: 'sql-src__status', role: 'status', 'aria-live': 'polite' });
    const out = el('div', { class: 'sql-src__out' });
    const hint = el('p', { class: 'sql-src__hint', id: `${id}-hint`,
        text: `Edit the query and press Run to redraw ${label} from your result. It runs in your browser; Reset puts it back.` });
    pre.replaceWith(el('div', { class: 'sql-src__editor' }, input,
        el('div', { class: 'sql-src__bar' }, run, reset, keys), status, out));
    const note = panel.querySelector(':scope > .sql-src__note');
    (note || panel.lastChild).after(hint);
    Object.assign(state, { input, run, reset, status, out });

    const fit = () => {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight + 2, 420)}px`;
    };
    requestAnimationFrame(fit);
    input.addEventListener('input', () => { fit(); syncReset(state); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runQuery(state); }
    });
    run.addEventListener('click', () => {
        if (run.getAttribute('aria-disabled') === 'true') return;
        if (state.running) stopRun(state);
        else runQuery(state);
    });
    reset.addEventListener('click', () => resetEditor(state));
}

function syncReset(state) {
    state.reset.disabled = !state.edited && state.input.value === state.defaultSql && !state.out.firstChild;
}

const BUSY = 'Another query is still running. Try again in a moment.';

function setStatus(state, msg) { state.status.textContent = msg; }

async function runQuery(state) {
    const eng = getEngine();
    const sql = state.input.value;
    if (!sql.trim()) { setStatus(state, 'Type a query first.'); return; }
    if (state.running || eng.running) { setStatus(state, BUSY); return; }
    state.running = true;
    state.abandoned = false;
    setRunButton(state, 'Loading…', true);
    if (!statusTarget) statusTarget = state;
    setStatus(state, eng.loaded ? 'Running…' : 'Loading DuckDB (first run only)…');
    state.out.replaceChildren();
    const check = () => {
        if (state.abandoned) { const e = new Error('cancelled'); e.cancelled = 'user'; throw e; }
        if (eng.running) throw new Error('busy');
    };
    let res;
    try {
        await eng.ready();
        check();
        await loadSchema(eng);
        check();
        setRunButton(state, 'Stop', false);
        setStatus(state, 'Running…');
        res = await eng.run(sql);
    } catch (err) {
        finish(state);
        if (err && err.message === 'busy') {
            setStatus(state, BUSY);
        } else if (err && err.cancelled) {
            setStatus(state, err.cancelled === 'timeout'
                ? 'That query ran past 30 seconds, so it was stopped. The page is unchanged.'
                : 'Stopped. The page is unchanged.');
        } else if (!eng.loaded) {
            setStatus(state, 'DuckDB didn’t load. Check your connection and press Run to try again.');
        } else {
            showError(state, err, sql);
        }
        syncReset(state);
        return;
    }
    finish(state);
    if (WRITES.test(sql.replace(/--[^\n]*|'(?:[^']|'')*'/g, ' '))) state.wrote = true;
    try {
        draw(state, res.result, res.ms, sql);
    } catch (err) {
        console.error(err);
        restorePiece(state);
        setStatus(state, `That result couldn’t be drawn, so ${state.label} is back to the default.`);
    }
    syncReset(state);
}

function finish(state) {
    state.running = false;
    setRunButton(state, 'Run', false);
    if (statusTarget === state) statusTarget = null;
}

function setRunButton(state, label, disabled) {
    state.run.textContent = label;
    if (disabled) state.run.setAttribute('aria-disabled', 'true');
    else state.run.removeAttribute('aria-disabled');
}

function stopRun(state) {
    state.abandoned = true;
    getEngine().cancel('user');
}

/* ── Results ── */
function draw(state, result, ms, sql) {
    const took = formatMs(ms);
    const n = result.numRows;
    if (maybeEgg(state, result, sql)) { setStatus(state, `1 row · ${took}`); return; }
    if (!result.fields.length) { setStatus(state, `Done · ${took}. Nothing to draw: the query returned no columns.`); return; }
    if (n === 0) { setStatus(state, `No rows came back (${took}), so ${state.label} stays as it was.`); return; }

    const cols = result.fields.map((f) => f.name.toLowerCase());
    const verdict = state.cfg.kind === 'live'
        ? drawLive(state, result, cols)
        : drawItems(state, result, cols);
    const rows = plural(n, 'row');
    if (verdict.ok) {
        // The dashed frame marks a piece drawn from the visitor's own query.
        state.edited = sql !== state.defaultSql || state.wrote;
        if (state.piece) state.piece.classList.toggle('is-sql-edited', state.edited);
        setStatus(state, `Redrew ${state.label} from ${rows} · ${took}.${verdict.note ? ' ' + verdict.note : ''}`);
    } else {
        setStatus(state, `${rows} · ${took}. ${verdict.why} Here it is as a table; ${state.label} is unchanged.`);
        state.out.replaceChildren(resultTable(result));
    }
}

function rowsOf(result, limit, opts) {
    return toObjects(result, limit, opts).map((r) => {
        const o = {};
        for (const [k, v] of Object.entries(r)) o[k.toLowerCase()] = v;
        return o;
    });
}

function needs(cols, need) {
    const missing = need.filter((c) => !cols.includes(c));
    return missing.length ? `To redraw it, the result needs ${missing.length > 1 ? 'columns' : 'a column'} named ${missing.join(', ')}.` : null;
}

function drawItems(state, result, cols) {
    const { cfg, piece } = state;
    if (!piece) return { ok: false, why: 'That piece isn’t on this page.' };
    let rows;
    if (cfg.transform) {
        if (result.numRows !== 1) return { ok: false, why: `${cap(state.label)} shows one row, and this query returned ${result.numRows}.` };
        rows = cfg.transform(rowsOf(result, 1), cols).slice(0, 12);
    } else {
        const why = needs(cols, [cfg.key]);
        if (why) return { ok: false, why };
        rows = rowsOf(result, MAX_ITEMS);
    }
    const inCols = cfg.transform ? cfg.fields.map((f) => f.col) : cols;
    if (!state.saved) save(state);
    renderItems(state, rows, inCols);
    const more = result.numRows > MAX_ITEMS && !cfg.transform ? `Showing the first ${MAX_ITEMS}.` : '';
    return { ok: true, note: more };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Remember the piece as the page drew it, for Reset.
function save(state) {
    const { cfg, piece } = state;
    const nodes = Array.from(piece.querySelectorAll(`:scope > ${cfg.item}`));
    state.saved = {
        childNodes: Array.from(piece.childNodes),
        items: nodes.map((node) => ({
            node,
            pristine: node.cloneNode(true),
            key: squash(cfg.nodeKey ? cfg.nodeKey(node) : cfg.fields[0].read(node)).toLowerCase()
        }))
    };
}

function renderItems(state, rows, cols) {
    const { cfg, piece, saved } = state;
    const used = new Set();
    const built = rows.map((row, i) => {
        const key = squash(row._key !== undefined ? row._key : text(row[cfg.key])).toLowerCase();
        const match = saved.items.find((it) => !used.has(it) && it.key === key);
        let node;
        let pristine = null;
        if (match) {
            used.add(match);
            node = match.node;
            pristine = match.pristine;
            restoreItem(match);
        } else {
            node = freshItem(state, i);
        }
        for (const f of cfg.fields) {
            if (cols.includes(f.col)) f.write(node, row[f.col] === undefined ? null : row[f.col], pristine);
            else f.hide(node);
        }
        if (cfg.links) drawLinks(node, row, cols, cfg.links, !!match);
        return node;
    });
    const parts = [];
    built.forEach((n) => parts.push('\n', n));
    parts.push('\n');
    piece.replaceChildren(...parts);
}

// A new item for a row the page has no card for: a copy of the first item,
// minus its ids, links and one-off classes.
function freshItem(state, i) {
    const { cfg, saved } = state;
    const node = saved.items[0].pristine.cloneNode(true);
    node.removeAttribute('id');
    node.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
    (cfg.freshDrop || []).forEach((c) => node.classList.remove(c));
    if (cfg.links) node.querySelectorAll(cfg.links).forEach((e) => e.replaceChildren());
    node.querySelectorAll('[class*="--"]').forEach((e) => {
        // A badge's colour belongs to the card it came from.
        if (e.classList.contains('project__badge')) e.className = 'project__badge';
    });
    node.setAttribute('data-sql-new', '');
    if (cfg.fresh) cfg.fresh(node, i);
    return node;
}

// Put an existing item's text back the way the page had it.
function restoreItem(item) {
    const { node, pristine } = item;
    node.querySelectorAll('[data-sql-gen]').forEach((e) => e.remove());
    node.querySelectorAll('[data-sql-hid]').forEach((e) => { e.hidden = false; e.removeAttribute('data-sql-hid'); });
    // Swap back every text holder; the links block (buttons with listeners) is never touched.
    for (const sel of ['.project__title', '.project__eyebrow', '.project__date', '.project__desc', '.project__tags',
        '.xp__role', '.xp__org', '.xp__dates', '.xp__desc', '.toolkit__label', '.now__label', '.now__value']) {
        const live = node.querySelector(sel);
        const orig = pristine.querySelector(sel);
        if (live && orig) live.replaceWith(orig.cloneNode(true));
    }
    if (node.matches('li.chip')) node.innerHTML = pristine.innerHTML;
    const list = node.querySelector('.chip-list');
    const origList = pristine.querySelector('.chip-list');
    if (list && origList && node.matches('.toolkit__group')) list.replaceChildren(...Array.from(origList.childNodes, (c) => c.cloneNode(true)));
    if (list) list.hidden = false;
}

// Links: from a `links` column when the query has one; otherwise a matched
// card keeps its own and a new card has none.
function drawLinks(node, row, cols, sel, matched) {
    const box = node.querySelector(sel);
    if (!box) return;
    if (!cols.includes('links')) { box.hidden = !matched; return; }
    const links = Array.isArray(row.links) ? row.links : [];
    const made = el('div', { class: box.className, 'data-sql-gen': '' },
        ...links.slice(0, 6).filter((l) => l && typeof l === 'object').map((l) => linkEl(text(l.label || l.url), l.url)));
    box.hidden = true;
    box.setAttribute('data-sql-hid', '');
    box.after(made);
}

/* ── /live: redraw the charts from a changed snapshot ── */
const live = { overrides: {} };

function liveSnapshot() {
    return window.__liveSnapshot && typeof window.__liveSnapshot === 'object' ? window.__liveSnapshot : null;
}

function renderLive() {
    const base = liveSnapshot();
    if (!base) return false;
    const snap = { ...base, ...live.overrides };
    const ev = new CustomEvent('live:render', { detail: { snapshot: snap, ok: false } });
    document.dispatchEvent(ev);
    return ev.detail.ok;
}

function drawLive(state, result, cols) {
    const { key, need } = state.cfg;
    const base = liveSnapshot();
    if (!base) return { ok: false, why: 'The live numbers haven’t loaded, so there’s nothing to redraw.' };
    const spec = Object.values(SNAPSHOT_TABLES).find((s) => s.snapshot === key);
    const rename = Object.fromEntries(spec.columns.map(([c, , k]) => [c, k || c]));
    const types = Object.fromEntries(spec.columns.map(([c, t, k]) => [k || c, t]));
    const mapped = cols.map((c) => rename[c] || c);
    const raw = rowsOf(result, MAX_DAYS, { numbers: true }).map((r) => {
        const o = {};
        cols.forEach((c, i) => { o[mapped[i]] = r[c]; });
        return o;
    });
    const numeric = (k) => types[k] === 'INTEGER' || types[k] === 'DOUBLE';
    const bad = (rows, keys) => keys.find((k) => numeric(k) && rows.some((r) => r[k] !== null && r[k] !== undefined && !Number.isFinite(r[k])));
    let value;
    let note = '';

    if (key === 'totals') {
        const known = mapped.filter((k) => numeric(k));
        if (result.numRows !== 1) return { ok: false, why: `The totals are one row, and this query returned ${result.numRows}.` };
        if (!known.length) return { ok: false, why: 'To redraw the tiles, the result needs a fraud_totals column such as checkouts or fraud_caught.' };
        const b = bad(raw, known);
        if (b) return { ok: false, why: `The ${b} column has to be a number.` };
        value = { ...base.totals };
        known.forEach((k) => { if (raw[0][k] !== null) value[k] = raw[0][k]; });
        const ignored = mapped.filter((k) => !numeric(k));
        if (ignored.length) note = `The tiles don’t use ${ignored.join(', ')}.`;
    } else {
        const why = needs(cols, need);
        if (why) return { ok: false, why };
        const b = bad(raw, mapped);
        if (b) return { ok: false, why: `The ${b} column has to be a number.` };
        if (key === 'daily') {
            const byDay = new Map(base.daily.map((d) => [d.day, d]));
            const seen = new Map();
            for (const r of raw) {
                if (typeof r.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.day)) {
                    return { ok: false, why: 'The day column has to be a date.' };
                }
                const was = byDay.get(r.day) || {};
                const row = {};
                for (const [c, , k] of spec.columns) {
                    const name = k || c;
                    const v = name in r ? r[name] : was[name];
                    row[name] = v === null || v === undefined ? (name === 'day' ? r.day : 0) : v;
                }
                seen.set(r.day, row);
            }
            value = [...seen.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
            if (value.length < raw.length) note = 'Repeated days were drawn once.';
        } else {
            value = raw.map((r) => {
                const row = {};
                need.map((c) => rename[c] || c).forEach((k) => { row[k] = r[k] === null || r[k] === undefined ? 0 : r[k]; });
                if (key === 'patterns') row.pattern = text(r.pattern);
                return row;
            });
            if (key === 'score_bins' && value.some((b) => b.from < 0 || b.from > 1)) {
                return { ok: false, why: 'Scores run from 0 to 1, and score_from has values outside that.' };
            }
        }
    }
    const before = live.overrides[key];
    live.overrides[key] = value;
    if (!renderLive()) {
        if (before === undefined) delete live.overrides[key];
        else live.overrides[key] = before;
        renderLive();
        return { ok: false, why: 'The charts couldn’t draw that result.' };
    }
    return { ok: true, note };
}

/* ── Reset ── */
function restorePiece(state) {
    const { cfg, piece, saved } = state;
    if (cfg.kind === 'live') {
        if (cfg.key in live.overrides) {
            delete live.overrides[cfg.key];
            renderLive();
        }
    } else if (piece && saved) {
        saved.items.forEach(restoreItem);
        saved.items.forEach(({ node }) => {
            if (cfg.links) {
                const box = node.querySelector(cfg.links);
                if (box) box.hidden = false;
            }
        });
        piece.replaceChildren(...saved.childNodes);
    }
    if (piece) piece.classList.remove('is-sql-edited');
    state.edited = false;
}

function resetEditor(state) {
    if (state.running) stopRun(state);
    restorePiece(state);
    state.input.value = state.defaultSql;
    state.input.dispatchEvent(new Event('input'));
    state.out.replaceChildren();
    setStatus(state, state.wrote
        ? `Back to the default query and ${state.label}. Changes you made to the tables last until you reload.`
        : `Back to the default query and ${state.label}.`);
    syncReset(state);
    state.reset.disabled = true;
    state.input.setSelectionRange(0, 0);
    state.input.focus({ preventScroll: true });
    state.input.scrollLeft = 0;
    state.input.scrollTop = 0;
}

/* ── Errors ── */
function showError(state, err, sql) {
    const raw = cleanError(err);
    const help = friendlyError(raw, schema || { tables: [], all: new Set(), columns: new Set() }, sql);
    setStatus(state, `${help.title} The page is unchanged.`);
    state.out.replaceChildren(el('div', { class: 'sql-src__error' },
        help.hint ? el('p', { text: help.hint }) : null,
        el('details', { class: 'sql-src__raw' }, el('summary', { text: 'DuckDB’s own message' }), el('pre', { text: raw }))));
}

const KEYWORDS = ['select', 'from', 'where', 'group', 'order', 'by', 'limit', 'join', 'having', 'with', 'as', 'and', 'or', 'not', 'distinct', 'union', 'case', 'when', 'then', 'else', 'end', 'on', 'like', 'between'];
const RESERVED = new Set([...KEYWORDS, 'in', 'is', 'null', 'exists', 'all', 'any', 'asc', 'desc', 'offset', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'using', 'over', 'partition', 'true', 'false', 'cast', 'values', 'except', 'intersect', 'ilike', 'nulls', 'first', 'last', 'into', 'set', 'table', 'create', 'drop', 'insert', 'update', 'delete', 'show', 'tables', 'describe', 'list']);

function nearestKeyword(word) {
    const w = word.toLowerCase();
    if (RESERVED.has(w)) return null;
    let best = null;
    let bestD = w.length < 5 ? 2 : 3;
    for (const k of KEYWORDS) {
        const d = editDistance(w, k);
        if (d > 0 && d < bestD && Math.abs(k.length - w.length) <= 2) { best = k; bestD = d; }
    }
    return best;
}

function editDistance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            // A swapped pair of letters (FORM for FROM) counts as one slip.
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
        }
    }
    return dp[a.length][b.length];
}

/**
 * DuckDB's error text → { title, hint } in plain words. `known` holds the
 * table names (the nest box left out of any list) and lower-case column
 * names, so a typo hint never flags a real name.
 */
export function friendlyError(raw, known, sqlText = '') {
    const listTables = known.tables.length ? `Tables you can use here: ${known.tables.join(', ')}.` : '';
    const realName = (w) => known.all.has(w.toLowerCase()) || known.columns.has(w.toLowerCase());
    let m;
    if ((m = /Table with name (\S+) does not exist!(?:\s*Did you mean "([^"]+)")?/i.exec(raw))) {
        let guess = m[2] ? m[2].replace(/^(memory|owl_park)\.(main\.)?/, '') : null;
        if (guess && HIDDEN_TABLES.has(guess)) guess = null;
        return { title: `There’s no table called ${m[1]}.`, hint: guess ? `Did you mean ${guess}?` : listTables };
    }
    if ((m = /Referenced column "([^"]+)" not found[^]*?Candidate bindings: ([^\n]+)/i.exec(raw))) {
        const cands = m[2].split(',').map((c) => c.trim().replace(/^"|"$/g, '').replace(/^.*\./, '')).filter(Boolean);
        return { title: `There’s no column called ${m[1]} there.`, hint: cands.length ? `Close matches: ${cands.join(', ')}.` : '' };
    }
    if ((m = /Referenced column "([^"]+)" not found/i.exec(raw))) {
        return { title: `There’s no column called ${m[1]} there.`, hint: 'Text goes in single quotes: \'like this\'. DESCRIBE a table to see its columns.' };
    }
    if ((m = /(Scalar|Aggregate|Table) Function with name (\S+) does not exist!(?:\s*Did you mean "([^"]+)")?/i.exec(raw))) {
        return { title: `DuckDB has no function called ${m[2]}.`, hint: m[3] ? `Did you mean ${m[3]}?` : 'Check the spelling, or try count(*), sum(), avg(), min() or max().' };
    }
    if ((m = /syntax error at or near "([^"]+)"/i.exec(raw))) {
        const near = m[1];
        let kw = /^[A-Za-z_]+$/.test(near) && near.length >= 3 && !realName(near) ? nearestKeyword(near) : null;
        let typo = kw ? near : null;
        if (!kw) {
            // The parser often trips one word after the typo (FORM projects).
            for (const w of sqlText.replace(/--[^\n]*|'(?:[^']|'')*'/g, ' ').match(/[A-Za-z_]+/g) || []) {
                if (RESERVED.has(w.toLowerCase()) || realName(w)) continue;
                const k = nearestKeyword(w);
                if (k && editDistance(w.toLowerCase(), k) === 1 && w.length >= 4) { kw = k; typo = w; break; }
            }
        }
        return {
            title: `Something’s off near “${near}”.`,
            hint: kw ? `Did you mean ${kw.toUpperCase()} instead of ${typo}?` : 'Check the spelling and the order: SELECT … FROM … WHERE … GROUP BY … ORDER BY … LIMIT.'
        };
    }
    if (/syntax error at end of input/i.test(raw)) {
        return { title: 'The query stops too early.', hint: 'Something is missing at the end, like the condition after WHERE.' };
    }
    if (/must appear in the GROUP BY clause|GROUP BY clause or must be part of an aggregate/i.test(raw)) {
        return { title: 'A column needs grouping.', hint: 'Every column you select must be in GROUP BY or inside an aggregate like count(*). GROUP BY ALL groups by everything that isn’t aggregated.' };
    }
    if ((m = /Ambiguous reference to column name "([^"]+)"/i.exec(raw))) {
        return { title: `Two tables have a column called ${m[1]}.`, hint: `Say which one with an alias, like p.${m[1]}.` };
    }
    if (/read-only mode|Cannot execute statement of type/i.test(raw)) {
        return { title: 'Those tables are read-only.', hint: 'The site’s own tables can change in this tab, but the Owl Park sample tables can’t.' };
    }
    if (/out of memory/i.test(raw)) {
        return { title: 'That result is too big for a browser tab.', hint: 'Add a LIMIT or a WHERE, or aggregate it.' };
    }
    if (/Conversion Error|Could not convert|Cannot compare values of type|No function matches|Could not choose a best candidate function/i.test(raw)) {
        return { title: 'Two values don’t fit together.', hint: 'Text goes in single quotes, numbers don’t, and CAST(x AS INTEGER) turns one into the other.' };
    }
    if (/Permission Error|disabled (by|through) configuration|configuration has been locked/i.test(raw)) {
        return { title: 'That’s switched off here.', hint: 'Queries can’t read files or URLs, load extensions, or change settings. Everything stays in this tab.' };
    }
    return { title: 'DuckDB couldn’t run that.', hint: listTables };
}

/* ── A result that doesn't fit its piece, as a small table ── */
function resultTable(result) {
    const rows = toObjects(result, MAX_TABLE_ROWS);
    const names = result.fields.map((f) => f.name);
    const table = el('table', { class: 'sql-src__table' },
        el('thead', {}, el('tr', {}, ...names.map((n) => el('th', { scope: 'col', text: n })))),
        el('tbody', {}, ...rows.map((r) => el('tr', {}, ...names.map((n) => el('td', { text: r[n] === null ? 'NULL' : text(r[n]) }))))));
    const wrap = el('div', { class: 'sql-src__result', tabindex: '0', role: 'region', 'aria-label': 'Query result' }, table);
    if (result.numRows > MAX_TABLE_ROWS) wrap.append(el('p', { class: 'sql-src__more', text: `First ${MAX_TABLE_ROWS} of ${plural(result.numRows, 'row')}.` }));
    return wrap;
}

/* ── The nest-box hunt: the right claim_egg() call earns a one-time code ── */
const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
};

export function maybeEgg(state, result, sql) {
    if (result.numRows !== 1 || result.fields.length !== 1) return false;
    if (Object.values(toObjects(result, 1)[0] || {})[0] !== EGG_FOUND) return false;
    const m = /claim_egg\s*\(\s*'([^']{1,40})'\s*\)/i.exec(sql);
    if (!m) return false;
    const card = el('div', { class: 'sql-egg', role: 'status' });
    state.out.replaceChildren(card);
    let saved = null;
    try { saved = JSON.parse(store.get(EGG_KEY) || 'null'); } catch { saved = null; }
    if (saved && typeof saved.code === 'string' && EGG_CODE.test(saved.code)) showEggCode(card, saved, true);
    else claimEgg(card, m[1]);
    return true;
}

async function claimEgg(card, answer) {
    card.replaceChildren(el('p', { class: 'sql-egg__title', text: 'You found the egg.' }),
        el('p', { class: 'sql-egg__text', text: 'Painting your code…' }));
    let res = null;
    try {
        res = await fetch(EGG_CLAIM_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer }),
            credentials: 'omit'
        });
    } catch { res = null; }
    let body = null;
    if (res) { try { body = await res.json(); } catch { body = null; } }
    if (res && res.ok && body && typeof body.code === 'string' && EGG_CODE.test(body.code)) {
        const saved = { code: body.code, issued: typeof body.issued === 'string' ? body.issued.slice(0, 10) : null };
        store.set(EGG_KEY, JSON.stringify(saved));
        showEggCode(card, saved, false);
        return;
    }
    const notReady = res && res.status === 503;
    const retry = el('button', { class: 'sql-src__btn', type: 'button' }, 'Try again');
    retry.addEventListener('click', () => claimEgg(card, answer));
    card.replaceChildren(
        el('p', { class: 'sql-egg__title', text: 'You found the egg.' }),
        el('p', { class: 'sql-egg__text', text: notReady
            ? 'Egg codes aren’t switched on yet, so there’s nothing to claim today. Check back soon.'
            : 'The nest box didn’t answer just now.' }),
        notReady ? null : retry);
}

function showEggCode(card, saved, again) {
    const code = el('code', { class: 'sql-egg__code', text: saved.code });
    const copy = el('button', { class: 'sql-src__btn', type: 'button' }, 'Copy code');
    copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(saved.code);
            copy.textContent = 'Copied';
        } catch {
            const range = document.createRange();
            range.selectNodeContents(code);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    });
    card.replaceChildren(
        el('p', { class: 'sql-egg__title', text: again ? 'You already found the egg. Here’s your code again.' : 'You found the egg.' }),
        el('p', { class: 'sql-egg__text', text: 'Take this code to Owl Park to adopt a painted egg. It works once, so keep it to yourself.' }),
        el('div', { class: 'sql-egg__row' }, code, copy),
        saved.issued ? el('p', { class: 'sql-egg__meta', text: `Issued ${saved.issued}` }) : null);
}

/* ── Trust badges: how fresh each piece is and how its checks did ── */
// The nightly data run (scripts/data_run.py) writes one line per caption to
// trust.json; the badge in each caption's <summary> shows it as written,
// failures and staleness included. No file (before the first run, or
// offline) leaves the badges hidden.
const TRUST_URL = '/data/pipeline/trust.json';
let trustPromise = null;

function loadTrust() {
    if (!trustPromise) {
        trustPromise = fetch(TRUST_URL, { cache: 'no-cache' })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
    }
    return trustPromise;
}

function ageText(hours) {
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
    if (hours < 48) return `${Math.round(hours)}h`;
    return `${Math.round(hours / 24)}d`;
}

function trustText(info, now = Date.now()) {
    if (!info || !Number.isInteger(info.total) || info.total < 1 || !Number.isInteger(info.passed)) return null;
    const checks = `${info.passed} of ${info.total} checks passed`;
    const when = Date.parse(info.as_of);
    if (!Number.isFinite(when)) return { text: `no data yet · ${checks}`, ok: false };
    const hours = Math.max(0, (now - when) / 36e5);
    const fresh = hours <= (Number.isFinite(info.max_hours) ? info.max_hours : 36);
    return {
        text: `${fresh ? `fresh ${ageText(hours)} ago` : `stale, ${ageText(hours)} old`} · ${checks}`,
        ok: fresh && info.passed === info.total
    };
}

function fillTrust() {
    const badges = document.querySelectorAll('details.sql-src[data-sql-source] [data-sql-trust]:not([data-sql-trust-done])');
    if (!badges.length) return;
    badges.forEach((b) => b.setAttribute('data-sql-trust-done', ''));
    loadTrust().then((trust) => {
        const pieces = trust && trust.pieces && typeof trust.pieces === 'object' ? trust.pieces : null;
        if (!pieces) return;
        badges.forEach((badge) => {
            const details = badge.closest('details.sql-src');
            const name = details && details.getAttribute('data-sql-source');
            const info = name && Object.prototype.hasOwnProperty.call(pieces, name) ? pieces[name] : null;
            const t = trustText(info);
            if (!t) return;
            badge.textContent = t.text;
            badge.classList.toggle('sql-src__trust--warn', !t.ok);
            const failed = Array.isArray(info.failed) ? info.failed.filter((f) => typeof f === 'string').slice(0, 5) : [];
            if (failed.length) badge.title = `Failing: ${failed.join('; ')}`;
            badge.hidden = false;
            const summary = badge.closest('summary');
            const label = details.getAttribute('data-sql-label');
            if (summary && label) summary.setAttribute('aria-label', `SQL source for ${label}, ${t.text}`);
        });
    });
}

// Home and Projects swap <main> on in-site navigation (transition.js), so
// fill badges that arrive later too.
fillTrust();
let trustQueued = false;
new MutationObserver(() => {
    if (trustQueued) return;
    trustQueued = true;
    requestAnimationFrame(() => { trustQueued = false; fillTrust(); });
}).observe(document.body, { childList: true, subtree: true });

/* ── Start: hydrate a caption the first time it opens ── */
// `toggle` doesn't bubble, so listen in the capture phase; this also covers
// captions that transition.js swaps in when Home and Projects change page.
document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d instanceof HTMLDetailsElement && d.open && d.matches('details.sql-src[data-sql-source]')) hydrate(d);
}, true);
document.querySelectorAll('details.sql-src[data-sql-source][open]').forEach(hydrate);
