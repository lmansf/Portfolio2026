/* ─────────────────────────────────────────────────────────────
 * playground.js — the /playground SQL box.
 *
 * Safety model (every query runs on the visitor's own device):
 *   - DuckDB-Wasm is pinned and loaded from jsDelivr only on this page.
 *   - The data is one prebuilt DuckDB file (/data/playground/owl_park.duckdb.gz,
 *     synthetic, no personal fields), attached READ_ONLY: INSERT, UPDATE,
 *     DELETE, CREATE and DROP on it fail. Temp tables live only in this tab.
 *   - After setup, extension install/autoload and all external access
 *     (files, URLs, ATTACH, COPY) are switched off and the configuration is
 *     locked, so a query can't turn them back on.
 *   - The page's Content-Security-Policy (vercel.json) only lets it connect
 *     to itself and jsDelivr. There are no keys or backend connections.
 *   - Results are written with textContent, never as HTML.
 *   - At most MAX_ROWS_KEPT rows of a result are read; Cancel, or a
 *     QUERY_TIMEOUT_MS watchdog, stops a query, and if DuckDB doesn't stop
 *     within a moment the worker is terminated and restarted on the next run.
 *
 * On a Save-Data connection nothing downloads until the first Run.
 * ───────────────────────────────────────────────────────────── */

const DUCKDB_VERSION = '1.29.0';
const DUCKDB_ESM = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/+esm`;
const DATA_BASE = '/data/playground/';
// One DuckDB database file holding the four tables (see generate.py there).
const DATA_FILE = 'owl_park.duckdb';
const TABLES = ['park_days', 'products', 'orders', 'order_items'];
const MAX_ROWS_SHOWN = 500;
const MAX_ROWS_KEPT = 200000;      // rows read from a result (and the CSV cap)
const QUERY_TIMEOUT_MS = 30000;    // watchdog: cancel a query after this long
const KILL_AFTER_MS = 1500;        // ...and restart DuckDB if it won't stop
const MEMORY_LIMIT = '256MB';      // DuckDB working memory; a bigger query fails cleanly

const STARTERS = [
    {
        label: 'Revenue by month',
        sql: `-- Monthly revenue from completed orders, by sales channel
SELECT strftime(o.visit_date, '%Y-%m') AS month,
       o.channel,
       count(DISTINCT o.order_id)          AS orders,
       round(sum(i.quantity * i.unit_price), 2) AS revenue
FROM orders o
JOIN order_items i USING (order_id)
WHERE o.status = 'completed'
GROUP BY ALL
ORDER BY month, revenue DESC;`
    },
    {
        label: 'Rain vs. attendance',
        sql: `-- Does rain keep guests home? Compare dry and rainy weekdays
-- within each month, so summer crowds don't hide the effect.
SELECT strftime(visit_date, '%B') AS month,
       round(avg(attendance) FILTER (WHERE rain_inches = 0))    AS dry_day_avg,
       round(avg(attendance) FILTER (WHERE rain_inches >= 0.5)) AS rainy_day_avg,
       count(*) FILTER (WHERE rain_inches >= 0.5)              AS rainy_days
FROM park_days
WHERE NOT is_weekend AND NOT is_holiday
GROUP BY month, month(visit_date)
ORDER BY month(visit_date);`
    },
    {
        label: 'Best sellers',
        sql: `-- What sells, and each product's share of revenue (a window function)
SELECT p.product_name,
       p.category,
       sum(i.quantity) AS units,
       round(sum(i.quantity * i.unit_price), 2) AS revenue,
       round(100 * revenue / sum(revenue) OVER (), 1) AS pct_of_revenue
FROM order_items i
JOIN orders o   USING (order_id)
JOIN products p USING (product_id)
WHERE o.status = 'completed'
GROUP BY ALL
ORDER BY revenue DESC;`
    },
    {
        label: 'How far ahead people book',
        sql: `-- Online orders: how many days before the visit were they placed?
SELECT CASE WHEN lead_days = 0 THEN 'same day'
            WHEN lead_days <= 3 THEN '1-3 days'
            WHEN lead_days <= 7 THEN '4-7 days'
            ELSE '8+ days' END AS booked_ahead,
       count(*) AS orders,
       round(100.0 * orders / sum(orders) OVER (), 1) AS pct_of_orders
FROM (
    SELECT date_diff('day', ordered_at::DATE, visit_date) AS lead_days
    FROM orders
    WHERE channel <> 'gate' AND status = 'completed'
)
GROUP BY booked_ahead
ORDER BY min(lead_days);`
    },
    {
        label: '7-day revenue trend',
        sql: `-- Daily revenue with a rolling 7-day average, last 30 days
WITH daily AS (
    SELECT o.visit_date, sum(i.quantity * i.unit_price) AS revenue
    FROM orders o
    JOIN order_items i USING (order_id)
    WHERE o.status = 'completed'
    GROUP BY o.visit_date
)
SELECT d.visit_date,
       d.day_of_week,
       d.attendance,
       round(daily.revenue, 2) AS revenue,
       round(avg(daily.revenue) OVER (
           ORDER BY d.visit_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
       ), 2) AS revenue_7day_avg
FROM park_days d
JOIN daily USING (visit_date)
ORDER BY d.visit_date DESC
LIMIT 30;`
    },
    {
        label: 'Pick a fraud cutoff',
        sql: `-- For each risk-score cutoff: how much fraud it would catch,
-- and how many good orders it would wrongly flag.
SELECT cutoff,
       count(*) FILTER (WHERE is_fraud AND risk_score >= cutoff)     AS fraud_caught,
       round(100.0 * fraud_caught / count(*) FILTER (WHERE is_fraud), 1) AS catch_rate_pct,
       count(*) FILTER (WHERE NOT is_fraud AND risk_score >= cutoff) AS good_orders_flagged
FROM orders, range(40, 100, 10) AS r(cutoff)
GROUP BY cutoff
ORDER BY cutoff;`
    }
];

// Apache Arrow type ids (stable across arrow-js versions).
const ARROW = { Int: 2, Float: 3, Decimal: 7, Date: 8, Time: 9, Timestamp: 10, Interval: 11 };
// Arrow TimeUnit (second, millisecond, microsecond, nanosecond) → microseconds.
const MICROS_PER_TIME_UNIT = [1e6, 1e3, 1, 1e-3];

const root = document.querySelector('[data-playground]');
if (root) setup();

function setup() {
    const els = {
        starters: root.querySelector('[data-starters]'),
        sql: root.querySelector('[data-sql]'),
        run: root.querySelector('[data-run]'),
        cancel: root.querySelector('[data-cancel]'),
        status: root.querySelector('[data-status]'),
        result: root.querySelector('[data-result]'),
        meta: root.querySelector('[data-meta]'),
        csv: root.querySelector('[data-csv]'),
        wrap: root.querySelector('[data-table-wrap]'),
        error: root.querySelector('[data-error]')
    };

    let connPromise = null;
    let dbRef = null;
    let activeConn = null;
    let abortRun = null;
    let watchdog = null;
    let killTimer = null;
    let running = false;
    let cancelled = false;
    let ranOnce = false;
    let lastResult = null;
    const starterButtons = [];

    // ── Starter chips ──
    STARTERS.forEach((starter, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pg__starter';
        btn.textContent = starter.label;
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', () => {
            if (running) return; // keep the editor in step with what's running
            loadStarter(i);
            run();
        });
        els.starters.appendChild(btn);
        starterButtons.push(btn);
    });

    function loadStarter(i) {
        els.sql.value = STARTERS[i].sql;
        starterButtons.forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
    }

    loadStarter(0);
    els.sql.addEventListener('input', () => {
        starterButtons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
    });

    // ── Run triggers ──
    els.run.addEventListener('click', run);
    els.cancel.addEventListener('click', cancel);
    els.sql.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            run();
        }
    });

    // Table previews in the reference section
    document.querySelectorAll('[data-preview]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault(); // don't toggle the <details>
            if (running) return;
            const table = btn.getAttribute('data-preview');
            if (!TABLES.includes(table)) return;
            els.sql.value = `SELECT *\nFROM ${table}\nLIMIT 20;`;
            starterButtons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
            const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            root.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
            run();
        });
    });

    els.csv.addEventListener('click', downloadCsv);

    // Links leave this page with a normal navigation. transition.js would
    // otherwise swap <main> in place and leave the DuckDB worker running.
    document.addEventListener('click', (e) => {
        const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
        if (!link || link.target === '_blank') return;
        const href = link.getAttribute('href').trim();
        if (!href || href.startsWith('#') || href.endsWith('.pdf')) return;
        let url;
        try {
            url = new URL(href, window.location.href);
        } catch {
            return;
        }
        if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
        e.stopPropagation();
    }, true);

    // ── Load DuckDB right away unless the visitor asked to save data ──
    const saveData = navigator.connection && navigator.connection.saveData;
    if (saveData) {
        setStatus('Data saver is on, so DuckDB (about 7 MB) loads when you press Run.');
        els.run.disabled = false;
    } else {
        getConnection().then(() => {
            if (!ranOnce) run();
        }, () => {});
    }

    function setStatus(text) {
        els.status.textContent = text;
    }

    function getConnection() {
        if (!connPromise) {
            connPromise = openDuckDB().catch((err) => {
                connPromise = null;
                els.run.disabled = false;
                setStatus('DuckDB didn’t load. Check your connection, then press Run to try again.');
                console.error(err);
                throw err;
            });
        }
        return connPromise;
    }

    async function openDuckDB() {
        els.run.disabled = true;
        setStatus('Loading DuckDB…');
        const duckdb = await import(DUCKDB_ESM);
        const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
        // A cross-origin worker script has to be wrapped in a same-origin blob.
        const workerUrl = URL.createObjectURL(
            new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
        );
        const worker = new Worker(workerUrl);
        const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
        dbRef = db;
        try {
            await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
            URL.revokeObjectURL(workerUrl);
            await db.open({
                query: { castBigIntToDouble: true, castDecimalToDouble: true, castTimestampToDate: true }
            });

            setStatus('Loading the sample data…');
            const res = await fetch(`${DATA_BASE}${DATA_FILE}.gz`);
            if (!res.ok) throw new Error(`Couldn’t fetch the sample data (${res.status})`);
            await db.registerFileBuffer(DATA_FILE, await gunzip(new Uint8Array(await res.arrayBuffer())));

            const conn = await db.connect();
            await conn.query(`ATTACH '${DATA_FILE}' AS owl_park (READ_ONLY)`);
            await conn.query('USE owl_park');
            // Lock it down. From here on a query can read the four tables (and
            // make temp tables in this tab) but can't load extensions, touch
            // files or URLs, attach databases, or change these settings.
            // Keep DuckDB's working memory small enough for a phone's browser tab.
            await conn.query(`SET memory_limit = '${MEMORY_LIMIT}'`);
            await conn.query('SET autoinstall_known_extensions = false');
            await conn.query('SET autoload_known_extensions = false');
            await conn.query('SET enable_external_access = false');
            await conn.query('SET lock_configuration = true');

            els.run.disabled = false;
            setStatus('Ready: four read-only tables loaded.');
            return conn;
        } catch (err) {
            if (dbRef === db) dbRef = null;
            try { await db.terminate(); } catch { /* already gone */ }
            throw err;
        }
    }

    // Throw away the DuckDB worker (a query that won't stop). The next run
    // starts a fresh one; the browser has the files cached by then.
    function resetEngine() {
        const db = dbRef;
        dbRef = null;
        connPromise = null;
        activeConn = null;
        if (db) db.terminate().catch(() => {});
    }

    // ── Run a query ──
    async function run() {
        if (running) return;
        if (!els.sql.value.trim()) {
            setStatus('Type a query first.');
            els.sql.focus();
            return;
        }
        ranOnce = true;
        running = true;
        cancelled = false;
        let stoppedBy = null;
        els.run.disabled = true;
        try {
            const conn = await getConnection();
            activeConn = conn;
            els.run.disabled = true;
            const sql = els.sql.value.trim();
            if (!sql) {
                setStatus('Type a query first.');
                els.sql.focus();
                return;
            }
            setStatus('Running…');
            els.error.hidden = true;
            els.cancel.hidden = false;
            const aborted = new Promise((_, reject) => {
                abortRun = (why) => { stoppedBy = why; reject(new Error(why)); };
            });
            watchdog = setTimeout(() => cancel('timeout'), QUERY_TIMEOUT_MS);
            const t0 = performance.now();
            const result = await Promise.race([runQuery(conn, sql), aborted]);
            const ms = performance.now() - t0;
            if (cancelled) throw new Error('cancelled');
            render(result, ms);
            setStatus(`Done in ${formatMs(ms)}.`);
        } catch (err) {
            if (cancelled) {
                const why = cancelled === 'timeout'
                    ? `Stopped after ${QUERY_TIMEOUT_MS / 1000} seconds.`
                    : 'Query cancelled.';
                setStatus(stoppedBy === 'killed' ? `${why} DuckDB restarts on your next run.` : why);
            } else if (connPromise) {
                showError(err);
            }
        } finally {
            clearTimeout(watchdog);
            clearTimeout(killTimer);
            watchdog = killTimer = abortRun = null;
            if (document.activeElement === els.cancel) els.run.focus();
            els.cancel.hidden = true;
            els.cancel.disabled = false;
            running = false;
            els.run.disabled = false;
        }
    }

    // Returns { fields, numRows, batches, truncated } (Arrow RecordBatches).
    // Reads at most MAX_ROWS_KEPT rows, so a huge result can't eat the tab's memory.
    async function runQuery(conn, sql) {
        let reader;
        try {
            reader = await conn.send(sql, true); // stream: don't build the whole result first
        } catch (err) {
            // DuckDB's streaming (cancellable) path takes one statement at a
            // time; scripts run whole, and the watchdog still covers them.
            if (cancelled || !/single statement/i.test(cleanError(err))) throw err;
            const table = await conn.query(sql);
            return { fields: table.schema.fields, numRows: table.numRows, batches: table.batches, truncated: false };
        }
        const batches = [];
        let numRows = 0;
        let truncated = false;
        for await (const batch of reader) {
            if (cancelled) break;
            batches.push(batch);
            numRows += batch.numRows;
            if (numRows >= MAX_ROWS_KEPT) {
                truncated = true;
                break;
            }
        }
        if (truncated) await conn.cancelSent().catch(() => false);
        const schema = batches.length ? batches[0].schema : reader.schema;
        return { fields: schema ? schema.fields : [], numRows, batches, truncated };
    }

    function cancel(reason = 'user') {
        if (!running || cancelled) return;
        cancelled = reason;
        els.cancel.disabled = true;
        setStatus('Stopping…');
        if (activeConn) activeConn.cancelSent().catch(() => false);
        // If DuckDB doesn't stop on its own, throw the worker away.
        killTimer = setTimeout(() => {
            if (!running) return;
            resetEngine();
            if (abortRun) abortRun('killed');
        }, KILL_AFTER_MS);
    }

    function showError(err) {
        lastResult = null;
        els.result.hidden = true;
        els.error.hidden = false;
        els.error.replaceChildren();
        const head = document.createElement('strong');
        head.textContent = 'That query didn’t run.';
        const pre = document.createElement('pre');
        pre.textContent = cleanError(err);
        els.error.append(head, pre);
        if (/out of memory/i.test(pre.textContent)) {
            const tip = document.createElement('p');
            tip.textContent = 'The result is too big to build in a browser tab. Add a LIMIT, a WHERE, or aggregate it.';
            els.error.append(tip);
        }
        setStatus('Fix the query and run it again.');
    }

    function cleanError(err) {
        const msg = (err && err.message) ? err.message : String(err);
        return msg.replace(/^Error:\s*/, '').trim();
    }

    // ── Render results ──
    function render(result, ms) {
        lastResult = result;
        els.error.hidden = true;
        els.result.hidden = false;

        const fields = result.fields;
        const total = result.numRows;
        const shown = Math.min(total, MAX_ROWS_SHOWN);

        const rowWord = total === 1 ? 'row' : 'rows';
        const count = result.truncated
            ? `More than ${MAX_ROWS_KEPT.toLocaleString('en-US')} rows; kept the first ${total.toLocaleString('en-US')}`
            : `${total.toLocaleString('en-US')} ${rowWord}`;
        const meta = [
            total > shown ? `${count}, showing the first ${shown}` : count,
            formatMs(ms)
        ];
        els.meta.textContent = meta.join(' · ');
        els.csv.hidden = total === 0 || fields.length === 0;

        if (fields.length === 0) {
            const p = document.createElement('p');
            p.className = 'pg__meta';
            p.style.padding = '0.8rem 1rem';
            p.textContent = 'The statement ran and returned no columns.';
            els.wrap.replaceChildren(p);
            return;
        }

        const tableEl = document.createElement('table');
        tableEl.className = 'pg__table';
        const thead = tableEl.createTHead();
        const headRow = thead.insertRow();
        const numeric = fields.map((f) => isNumericType(f.type));
        fields.forEach((f, j) => {
            const th = document.createElement('th');
            th.scope = 'col';
            th.textContent = f.name;
            if (numeric[j]) th.className = 'is-num';
            headRow.appendChild(th);
        });

        const tbody = tableEl.createTBody();
        const frag = document.createDocumentFragment();
        eachRow(result, shown, (cols, i) => {
            const tr = document.createElement('tr');
            for (let j = 0; j < fields.length; j++) {
                const td = document.createElement('td');
                const v = getCell(cols[j], i, fields[j].type);
                if (v === null) {
                    td.textContent = 'NULL';
                    td.className = 'is-null';
                } else {
                    td.textContent = formatValue(v, fields[j].type);
                    if (numeric[j]) td.className = 'is-num';
                }
                tr.appendChild(td);
            }
            frag.appendChild(tr);
        });
        tbody.appendChild(frag);
        els.wrap.replaceChildren(tableEl);
        els.wrap.scrollTop = 0;
        els.wrap.scrollLeft = 0;
    }

    function downloadCsv() {
        if (!lastResult) return;
        const fields = lastResult.fields;
        const lines = [fields.map((f) => csvCell(f.name)).join(',')];
        eachRow(lastResult, MAX_ROWS_KEPT, (cols, i) => {
            const cells = [];
            for (let j = 0; j < fields.length; j++) {
                const v = getCell(cols[j], i, fields[j].type);
                cells.push(v === null ? '' : csvCell(formatValue(v, fields[j].type)));
            }
            lines.push(cells.join(','));
        });
        const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'owl-park-query.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}

// Call fn(columns, rowInBatch) for the first `limit` rows across the batches.
function eachRow(result, limit, fn) {
    let seen = 0;
    for (const batch of result.batches) {
        if (seen >= limit) break;
        const cols = result.fields.map((_, j) => batch.getChildAt(j));
        for (let i = 0; i < batch.numRows && seen < limit; i++, seen++) fn(cols, i);
    }
}

// Value of row i in an Arrow column vector, or null.
function getCell(col, i, type) {
    if (!col) return null;
    const v = col.get(i);
    if (v === null || v === undefined) return null;
    if (type && type.typeId === ARROW.Interval && type.unit === 2) {
        const raw = monthDayNano(col, i);
        if (raw) return raw;
    }
    return v;
}

// The Arrow JS bundled with DuckDB-Wasm reads a MONTH_DAY_NANO interval as if
// it were YEAR_MONTH, so take the row's four int32s (months, days, nanos lo,
// nanos hi) straight from the buffer → [months, days, nanos (BigInt)].
function monthDayNano(col, i) {
    let row = i;
    for (const data of col.data) {
        if (row < data.length) {
            const w = data.values;
            const at = row * 4;
            if (!w || w.length < at + 4) return null;
            return [w[at], w[at + 1], (BigInt(w[at + 3]) << 32n) + BigInt(w[at + 2] >>> 0)];
        }
        row -= data.length;
    }
    return null;
}

// Unzip a .gz download. If the host already decoded it (Content-Encoding:
// gzip), the bytes no longer start with the gzip magic number; use them as is.
async function gunzip(bytes) {
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ── Formatting helpers ──
function isNumericType(type) {
    const id = type && type.typeId;
    return id === ARROW.Int || id === ARROW.Float || id === ARROW.Decimal;
}

function formatValue(v, type) {
    const id = type && type.typeId;
    if (id === ARROW.Date || id === ARROW.Timestamp) {
        const ms = v instanceof Date ? v.getTime() : Number(v);
        if (Number.isFinite(ms)) {
            const iso = new Date(ms).toISOString(); // DuckDB values are UTC wall-clock
            // DATE arrives as day-unit Date32; TIMESTAMP as a millisecond date.
            if (id === ARROW.Date && type.unit === 0) return iso.slice(0, 10);
            return iso.slice(0, 19).replace('T', ' ');
        }
    }
    if (id === ARROW.Time) {
        const micros = Number(v) * (MICROS_PER_TIME_UNIT[type.unit] ?? 1);
        if (Number.isFinite(micros)) return formatClock(Math.round(micros));
    }
    if (id === ARROW.Interval) {
        const text = formatInterval(v, type.unit);
        if (text !== null) return text;
    }
    if (typeof v === 'number') {
        if (Number.isInteger(v)) return String(v);
        return String(Math.round(v * 10000) / 10000);
    }
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') return v;
    if (v instanceof Date) return v.toISOString();
    if (typeof v.toJSON === 'function') {
        return JSON.stringify(v.toJSON(), (_, x) => (typeof x === 'bigint' ? x.toString() : x));
    }
    return String(v);
}

// Microseconds since midnight → HH:MM:SS[.ffffff]; also the time part of intervals.
function formatClock(micros) {
    const sign = micros < 0 ? '-' : '';
    let rest = Math.abs(micros);
    const h = Math.floor(rest / 3.6e9);
    rest -= h * 3.6e9;
    const m = Math.floor(rest / 6e7);
    rest -= m * 6e7;
    const s = Math.floor(rest / 1e6);
    rest -= s * 1e6;
    const pad = (n) => String(n).padStart(2, '0');
    const frac = rest ? '.' + String(rest).padStart(6, '0').replace(/0+$/, '') : '';
    return `${sign}${pad(h)}:${pad(m)}:${pad(s)}${frac}`;
}

// Arrow IntervalUnit 0 arrives as [years, months] (or a month count), 1 as
// [days, millis], and 2 as [months, days, nanos] from monthDayNano() above.
function formatInterval(v, unit) {
    let months = 0;
    let days = 0;
    let micros = 0;
    if (unit === 0 && typeof v === 'number') {
        months = v;
    } else if (unit === 0 && v && v.length >= 2) {
        months = v[0] * 12 + v[1];
    } else if (unit === 1 && v && v.length >= 2) {
        days = v[0];
        micros = v[1] * 1000;
    } else if (unit === 2 && v && v.length >= 3 && typeof v[2] === 'bigint') {
        months = v[0];
        days = v[1];
        micros = Number(v[2] / 1000n);
    } else {
        return null;
    }
    const years = Math.trunc(months / 12);
    months -= years * 12;
    const unitWord = (n, word) => `${n} ${word}${Math.abs(n) === 1 ? '' : 's'}`;
    const parts = [];
    if (years) parts.push(unitWord(years, 'year'));
    if (months) parts.push(unitWord(months, 'month'));
    if (days) parts.push(unitWord(days, 'day'));
    if (micros || parts.length === 0) parts.push(formatClock(micros));
    return parts.join(' ');
}

function csvCell(s) {
    const text = String(s);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatMs(ms) {
    return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}
