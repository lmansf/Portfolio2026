/* ─────────────────────────────────────────────────────────────
 * playground.js — the /playground SQL box.
 *
 * Loads DuckDB-Wasm from jsDelivr (pinned) only on this page, reads the
 * four synthetic Owl Park CSVs (gzipped) from /data/playground/ into
 * in-memory tables, then turns off external file and network access and
 * locks the configuration, so queries can only touch those tables. Every
 * query runs on the visitor's device. Results render as a table (first
 * MAX_ROWS_SHOWN rows) with a CSV download of the full result.
 *
 * On a Save-Data connection nothing downloads until the first Run.
 * ───────────────────────────────────────────────────────────── */

const DUCKDB_VERSION = '1.29.0';
const DUCKDB_ESM = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/+esm`;
const DATA_BASE = '/data/playground/';
// Column types for the four CSVs in /data/playground/ (see generate.py there).
const SCHEMA = {
    park_days: `visit_date DATE, day_of_week VARCHAR, is_weekend BOOLEAN, is_holiday BOOLEAN,
        high_temp_f INTEGER, rain_inches DECIMAL(4,2), attendance INTEGER, capacity INTEGER`,
    products: `product_id INTEGER, product_name VARCHAR, category VARCHAR,
        list_price DECIMAL(8,2), weekend_surcharge DECIMAL(8,2)`,
    orders: `order_id INTEGER, ordered_at TIMESTAMP, visit_date DATE, channel VARCHAR,
        guest_region VARCHAR, payment_method VARCHAR, status VARCHAR, risk_score INTEGER, is_fraud BOOLEAN`,
    order_items: `order_id INTEGER, line_no INTEGER, product_id INTEGER, quantity INTEGER,
        unit_price DECIMAL(8,2)`
};
const TABLES = Object.keys(SCHEMA);
const MAX_ROWS_SHOWN = 500;
const MAX_ROWS_CSV = 200000;

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
const ARROW = { Int: 2, Float: 3, Decimal: 7, Date: 8, Timestamp: 10 };

const root = document.querySelector('[data-playground]');
if (root) setup();

function setup() {
    const els = {
        starters: root.querySelector('[data-starters]'),
        sql: root.querySelector('[data-sql]'),
        run: root.querySelector('[data-run]'),
        status: root.querySelector('[data-status]'),
        result: root.querySelector('[data-result]'),
        meta: root.querySelector('[data-meta]'),
        csv: root.querySelector('[data-csv]'),
        wrap: root.querySelector('[data-table-wrap]'),
        error: root.querySelector('[data-error]')
    };

    let connPromise = null;
    let running = false;
    let ranOnce = false;
    let lastTable = null;
    const starterButtons = [];

    // ── Starter chips ──
    STARTERS.forEach((starter, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pg__starter';
        btn.textContent = starter.label;
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', () => {
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
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        URL.revokeObjectURL(workerUrl);
        await db.open({
            query: { castBigIntToDouble: true, castDecimalToDouble: true, castTimestampToDate: true }
        });

        setStatus('Loading the sample data…');
        const files = await Promise.all(Object.keys(SCHEMA).map(async (name) => {
            const res = await fetch(`${DATA_BASE}${name}.csv.gz`);
            if (!res.ok) throw new Error(`Couldn’t fetch ${name}.csv.gz (${res.status})`);
            return [name, await gunzip(new Uint8Array(await res.arrayBuffer()))];
        }));

        const conn = await db.connect();
        for (const [name, bytes] of files) {
            await db.registerFileBuffer(`${name}.csv`, bytes);
            await conn.query(`CREATE TABLE ${name} (${SCHEMA[name]})`);
            await conn.query(`COPY ${name} FROM '${name}.csv' (HEADER)`);
            await db.dropFile(`${name}.csv`);
        }
        // From here on, queries can only see the four tables above.
        await conn.query('SET enable_external_access = false');
        await conn.query('SET lock_configuration = true');

        els.run.disabled = false;
        setStatus('Ready: four tables loaded.');
        return conn;
    }

    // ── Run a query ──
    async function run() {
        const sql = els.sql.value.trim();
        if (running) return;
        if (!sql) {
            setStatus('Type a query first.');
            els.sql.focus();
            return;
        }
        ranOnce = true;
        running = true;
        els.run.disabled = true;
        try {
            const conn = await getConnection();
            els.run.disabled = true;
            setStatus('Running…');
            const t0 = performance.now();
            const table = await conn.query(sql);
            const ms = performance.now() - t0;
            render(table, ms);
            setStatus(`Done in ${formatMs(ms)}.`);
        } catch (err) {
            if (connPromise) showError(err);
        } finally {
            running = false;
            if (connPromise) els.run.disabled = false;
        }
    }

    function showError(err) {
        lastTable = null;
        els.result.hidden = true;
        els.error.hidden = false;
        els.error.replaceChildren();
        const head = document.createElement('strong');
        head.textContent = 'That query didn’t run.';
        const pre = document.createElement('pre');
        pre.textContent = cleanError(err);
        els.error.append(head, pre);
        setStatus('Fix the query and run it again.');
    }

    function cleanError(err) {
        const msg = (err && err.message) ? err.message : String(err);
        return msg.replace(/^Error:\s*/, '').trim();
    }

    // ── Render results ──
    function render(table, ms) {
        lastTable = table;
        els.error.hidden = true;
        els.result.hidden = false;

        const fields = table.schema.fields;
        const total = table.numRows;
        const shown = Math.min(total, MAX_ROWS_SHOWN);
        const cols = fields.map((_, j) => table.getChildAt(j));

        const rowWord = total === 1 ? 'row' : 'rows';
        els.meta.textContent = total > shown
            ? `${total.toLocaleString('en-US')} ${rowWord}, showing the first ${shown} · ${formatMs(ms)}`
            : `${total.toLocaleString('en-US')} ${rowWord} · ${formatMs(ms)}`;
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
        for (let i = 0; i < shown; i++) {
            const tr = document.createElement('tr');
            for (let j = 0; j < fields.length; j++) {
                const td = document.createElement('td');
                const v = cols[j] ? cols[j].get(i) : null;
                if (v === null || v === undefined) {
                    td.textContent = 'NULL';
                    td.className = 'is-null';
                } else {
                    td.textContent = formatValue(v, fields[j].type);
                    if (numeric[j]) td.className = 'is-num';
                }
                tr.appendChild(td);
            }
            frag.appendChild(tr);
        }
        tbody.appendChild(frag);
        els.wrap.replaceChildren(tableEl);
        els.wrap.scrollTop = 0;
        els.wrap.scrollLeft = 0;
    }

    function downloadCsv() {
        if (!lastTable) return;
        const fields = lastTable.schema.fields;
        const cols = fields.map((_, j) => lastTable.getChildAt(j));
        const n = Math.min(lastTable.numRows, MAX_ROWS_CSV);
        const lines = [fields.map((f) => csvCell(f.name)).join(',')];
        for (let i = 0; i < n; i++) {
            const cells = [];
            for (let j = 0; j < fields.length; j++) {
                const v = cols[j] ? cols[j].get(i) : null;
                cells.push(v === null || v === undefined ? '' : csvCell(formatValue(v, fields[j].type)));
            }
            lines.push(cells.join(','));
        }
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

function csvCell(s) {
    const text = String(s);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatMs(ms) {
    return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}
