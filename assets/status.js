/* ─────────────────────────────────────────────────────────────
 * status.js — the /status page: the site's nightly data run.
 *
 * Reads /data/pipeline/run-log.json (written by scripts/data_run.py on every
 * run) and draws the latest run's sources, every check grouped by table
 * (failed tables first and open), and a short history. It shows what the log
 * says, failures and stale sources included. Text goes in through
 * textContent only.
 * ───────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    const root = document.querySelector('[data-status]');
    if (!root) return;

    const LOG_URL = '/data/pipeline/run-log.json';
    const TZ = 'America/New_York';
    const SOURCE_NAMES = {
        site_pages: 'Site pages',
        fraud_snapshot: 'Fraud snapshot',
        github: 'GitHub public API'
    };
    const STATUS_WORDS = { ok: 'OK', failed: 'Failed', skipped: 'Skipped' };

    const $ = (sel) => root.querySelector(sel);
    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }
    const fmtStamp = (iso) => new Date(iso).toLocaleString('en-US', {
        timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }) + ' ET';
    const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
    function ago(iso) {
        const h = (Date.now() - Date.parse(iso)) / 36e5;
        if (!Number.isFinite(h)) return '';
        if (h < 1) return 'under an hour ago';
        if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`;
        return `${Math.round(h / 24)} days ago`;
    }

    function dot(ok) {
        const d = el('span', `status-dot ${ok ? 'status-dot--ok' : 'status-dot--bad'}`);
        d.setAttribute('aria-hidden', 'true');
        return d;
    }

    function renderSummary(run) {
        const s = $('[data-status-summary]');
        s.replaceChildren(dot(run.passed === run.total),
            el('span', '', `${run.passed} of ${run.total} checks passed`),
            el('span', 'status-summary__meta',
                ` · last run ${fmtStamp(run.finished_at)} (${run.trigger}), ${ago(run.finished_at)}`));
    }

    function renderSources(run) {
        const list = $('[data-status-sources]');
        list.replaceChildren(...run.sources.map((src) => {
            const li = el('li', 'status-source');
            const head = el('p', 'status-source__head');
            head.append(dot(src.status === 'ok'), el('span', 'status-source__name', SOURCE_NAMES[src.name] || src.name),
                el('span', 'status-source__state', STATUS_WORDS[src.status] || src.status));
            li.append(head);
            const when = src.as_of ? `Data as of ${fmtStamp(src.as_of)}. ` : 'No successful pull yet. ';
            li.append(el('p', 'status-source__detail', when + (src.detail || '')));
            return li;
        }));
    }

    function renderTables(run) {
        const wrap = $('[data-status-tables]');
        const groups = new Map();
        for (const c of run.checks) {
            if (!groups.has(c.node)) groups.set(c.node, []);
            groups.get(c.node).push(c);
        }
        const tables = run.tables || {};
        const entries = [...groups.entries()].sort((a, b) => {
            const fa = a[1].some((c) => c.status !== 'pass');
            const fb = b[1].some((c) => c.status !== 'pass');
            return fa === fb ? 0 : fa ? -1 : 1;
        });
        wrap.replaceChildren(...entries.map(([node, checks]) => {
            const failed = checks.filter((c) => c.status !== 'pass').length;
            const box = el('details', 'status-table');
            box.id = `t-${node}`;
            if (failed) box.open = true;
            const sum = el('summary', 'status-table__head');
            const isTable = Object.prototype.hasOwnProperty.call(tables, node);
            sum.append(dot(!failed), el('code', 'status-table__name', node),
                el('span', 'status-table__count', `${checks.length - failed} of ${checks.length} passed`));
            if (isTable && Number.isFinite(tables[node].rows)) {
                const n = tables[node].rows;
                sum.append(el('span', 'status-table__meta', `${n.toLocaleString('en-US')} row${n === 1 ? '' : 's'}`));
            }
            box.append(sum);
            const ul = el('ul', 'status-checks');
            for (const c of checks) {
                const li = el('li', `status-check${c.status === 'pass' ? '' : ' status-check--bad'}`);
                li.append(dot(c.status === 'pass'), el('span', 'status-check__name', c.name),
                    el('span', 'status-check__detail', c.detail));
                ul.append(li);
            }
            box.append(ul);
            return box;
        }));
        const failedTables = entries.filter(([, cs]) => cs.some((c) => c.status !== 'pass')).length;
        $('[data-status-checks-hint]').textContent = failedTables
            ? `${failedTables} of ${entries.length} with a failure`
            : `all ${entries.length} passing`;
        // A link to /status#t-<table> opens that table.
        const target = location.hash && document.getElementById(location.hash.slice(1));
        if (target && target.tagName === 'DETAILS') {
            target.open = true;
            target.scrollIntoView({ block: 'start' });
        }
    }

    function renderHistory(log) {
        const list = $('[data-status-history]');
        list.replaceChildren(...(log.history || []).slice(0, 14).map((h) => {
            const li = el('li', 'status-run');
            const ok = h.passed === h.total;
            li.append(dot(ok), el('span', 'status-run__day', fmtDay(h.finished_at)),
                el('span', 'status-run__count', `${h.passed} of ${h.total}`),
                el('span', 'status-run__trigger', h.trigger));
            li.title = fmtStamp(h.finished_at);
            return li;
        }));
    }

    function fail(msg) {
        $('[data-status-summary]').textContent = msg;
    }

    fetch(LOG_URL, { cache: 'no-cache' })
        .then((r) => {
            if (r.status === 404) return null;
            if (!r.ok) throw new Error(String(r.status));
            return r.json();
        })
        .then((log) => {
            const run = log && log.latest;
            if (!run || !Array.isArray(run.checks) || !Array.isArray(run.sources)) {
                fail('No run has finished yet. The first one publishes its results here.');
                return;
            }
            renderSummary(run);
            renderSources(run);
            renderTables(run);
            renderHistory(log);
            root.querySelectorAll('[data-status-only]').forEach((n) => { n.hidden = false; });
        })
        .catch(() => {
            fail('');
            $('[data-status-error]').hidden = false;
        });
})();
