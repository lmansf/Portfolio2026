/* ─────────────────────────────────────────────────────────────
 * catalog.js — the one live part of /catalog: how fresh each table is.
 *
 * scripts/build_catalog.py writes the rest of the page from models.json and
 * metrics.json. This reads /data/pipeline/run-log.json (the nightly run's
 * log) and fills each table's quiet badge: "updated 3h ago · 8 of 8 checks
 * passed", or "stale, 2d old · 7 of 8" in chestnut when it's older than its
 * limit or a check failed. With no log yet the badges stay hidden. A link to
 * /catalog#t-<table> opens that table. Text goes in through textContent.
 * ───────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    const root = document.querySelector('[data-catalog]');
    if (!root) return;

    function openFromHash() {
        const target = location.hash && document.getElementById(location.hash.slice(1));
        if (target && target.tagName === 'DETAILS') {
            target.open = true;
            target.scrollIntoView({ block: 'start' });
        }
    }
    openFromHash();
    window.addEventListener('hashchange', openFromHash);

    function age(hours) {
        if (hours < 1) return 'under an hour';
        if (hours < 48) return `${Math.round(hours)}h`;
        return `${Math.round(hours / 24)}d`;
    }

    fetch('/data/pipeline/run-log.json', { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((log) => {
            const run = log && log.latest;
            if (!run || !Array.isArray(run.checks)) return;
            const tables = run.tables || {};
            root.querySelectorAll('[data-cat-fresh]').forEach((badge) => {
                const name = badge.getAttribute('data-cat-fresh');
                const info = tables[name];
                const checks = run.checks.filter((c) => c.node === name);
                if (!info || !checks.length) return;
                const passed = checks.filter((c) => c.status === 'pass').length;
                const limit = Number(badge.getAttribute('data-max-hours'));
                const hours = info.as_of ? Math.max(0, (Date.now() - Date.parse(info.as_of)) / 36e5) : NaN;
                const stale = !Number.isFinite(hours) || (Number.isFinite(limit) && hours > limit);
                const fresh = !Number.isFinite(hours) ? 'no data yet'
                    : stale ? `stale, ${age(hours)} old` : `updated ${age(hours)} ago`;
                badge.textContent = `${fresh} · ${passed} of ${checks.length} checks passed`;
                badge.classList.toggle('cat-table__fresh--warn', stale || passed < checks.length);
                badge.hidden = false;
            });
        })
        .catch(() => { /* the catalog reads fine without it */ });
})();
