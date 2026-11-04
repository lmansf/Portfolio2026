/* ─────────────────────────────────────────────────────────────
 * sql-engine.js — DuckDB-Wasm for the site's "SQL source" editors.
 *
 * One engine per page, shared by every caption editor (sql-source.js) and
 * started only when a visitor first presses Run. It loads the pinned
 * DuckDB-Wasm from jsDelivr, then:
 *   - attaches the synthetic Owl Park sample data
 *     (/data/playground/owl_park.duckdb.gz) READ_ONLY as `owl_park`,
 *   - runs /data/console/site.sql to build the site tables (projects,
 *     experience, skills, credentials, resume, and the nest box) in this
 *     tab's memory,
 *   - builds the fraud_* tables listed in data/console/snapshot-tables.json
 *     from /data/fraud-snapshot.json, the same aggregates-only file the /live
 *     page draws (totals, one row per day, the score histogram, catch rate
 *     by pattern; never an order, card or person),
 *   - puts both on the search path, so `FROM projects` and `FROM orders`
 *     both work,
 *   - switches off extension install/autoload and all external access
 *     (files, URLs, ATTACH, COPY), caps memory, and locks the configuration
 *     so a query can't turn any of it back on.
 * Nothing a visitor types leaves their device: there are no keys and no
 * backend connections. A visitor can change the site tables in their own tab
 * (they're in memory); a reload puts them back.
 *
 * Cancel, or a QUERY_TIMEOUT_MS watchdog, stops a query; if DuckDB doesn't
 * stop within KILL_AFTER_MS the worker is thrown away and the next run starts
 * a fresh one. At most MAX_ROWS_KEPT rows of a result are kept.
 * ───────────────────────────────────────────────────────────── */

import snapshotTables from '../data/console/snapshot-tables.json';

export const DUCKDB_VERSION = '1.29.0';
const DUCKDB_ESM = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/+esm`;
const PARK_FILE = 'owl_park.duckdb';
const PARK_URL = `/data/playground/${PARK_FILE}.gz`;
const SITE_SQL_URL = '/data/console/site.sql';
const FRAUD_URL = '/data/fraud-snapshot.json';

/**
 * The fraud_* tables: exactly the snapshot fields named in
 * data/console/snapshot-tables.json (bundled in at build time), nothing else
 * from the file. scripts/build_sql_sources.py builds the same tables to check
 * the /live default queries.
 */
export const SNAPSHOT_TABLES = Object.fromEntries(
    Object.entries(snapshotTables).filter(([name]) => !name.startsWith('_'))
);

// One snapshot value as a SQL literal, or undefined if it isn't the type
// its column says (that row is then left out).
function literal(v, type) {
    if (v === null || v === undefined) return 'NULL';
    if (type === 'DATE') return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `DATE '${v}'` : undefined;
    if (type === 'VARCHAR') return typeof v === 'string' && v.length <= 80 ? `'${v.replace(/'/g, "''")}'` : undefined;
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    if (type === 'INTEGER' && !Number.isInteger(v)) return undefined;
    return String(v);
}

/** SQL that creates the fraud_* tables from a parsed snapshot (empty tables for anything missing). */
export function snapshotTablesSql(snapshot) {
    const out = [];
    for (const [name, spec] of Object.entries(SNAPSHOT_TABLES)) {
        const part = snapshot ? snapshot[spec.snapshot] : null;
        const items = spec.one_row ? (part && typeof part === 'object' ? [part] : []) : (Array.isArray(part) ? part : []);
        const rows = [];
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const vals = spec.columns.map(([col, type, key]) => literal(item[key || col], type));
            if (!vals.includes(undefined)) rows.push(`(${vals.join(', ')})`);
        }
        out.push(`CREATE TABLE ${name} (${spec.columns.map(([c, t]) => `${c} ${t}`).join(', ')});`);
        if (rows.length) out.push(`INSERT INTO ${name} VALUES\n${rows.join(',\n')};`);
    }
    return out.join('\n');
}
export const MAX_ROWS_KEPT = 200000;
export const QUERY_TIMEOUT_MS = 30000;
const KILL_AFTER_MS = 1500;
const MEMORY_LIMIT = '256MB';

// Apache Arrow type ids (stable across arrow-js versions).
export const ARROW = { Int: 2, Float: 3, Bool: 6, Decimal: 7, Date: 8, Time: 9, Timestamp: 10, Interval: 11, List: 12, Struct: 13 };
// Arrow TimeUnit (second, millisecond, microsecond, nanosecond) → microseconds.
const MICROS_PER_TIME_UNIT = [1e6, 1e3, 1, 1e-3];

export function createEngine({ onStatus = () => {} } = {}) {
    let connPromise = null;
    let dbRef = null;
    let activeConn = null;
    let running = false;
    let cancelled = false;
    let abortRun = null;
    let watchdog = null;
    let killTimer = null;

    function ready() {
        if (!connPromise) {
            connPromise = openDuckDB().catch((err) => {
                connPromise = null;
                onStatus('DuckDB didn’t load. Check your connection, then press Run to try again.');
                console.error(err);
                throw err;
            });
        }
        return connPromise;
    }

    async function openDuckDB() {
        onStatus('Loading DuckDB…');
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

            onStatus('Loading the data…');
            const [parkBytes, siteSql, snapshot] = await Promise.all([
                fetch(PARK_URL).then((r) => {
                    if (!r.ok) throw new Error(`Couldn’t fetch the sample data (${r.status})`);
                    return r.arrayBuffer();
                }),
                fetch(SITE_SQL_URL).then((r) => {
                    if (!r.ok) throw new Error(`Couldn’t fetch the site tables (${r.status})`);
                    return r.text();
                }),
                // The live numbers are a nice extra: if they don't load, the
                // table is just empty and everything else still works.
                fetch(FRAUD_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null)
            ]);
            await db.registerFileBuffer(PARK_FILE, await gunzip(new Uint8Array(parkBytes)));

            const conn = await db.connect();
            await conn.query(`ATTACH '${PARK_FILE}' AS owl_park (READ_ONLY)`);
            await conn.query(siteSql);
            try {
                await conn.query(snapshotTablesSql(snapshot));
            } catch {
                for (const name of Object.keys(SNAPSHOT_TABLES)) await conn.query(`DROP TABLE IF EXISTS ${name}`);
                await conn.query(snapshotTablesSql(null));
            }
            await conn.query("SET search_path = 'memory.main,owl_park.main'");
            // Lock it down: from here a query can read the tables (and make
            // tables in this tab) but can't load extensions, touch files or
            // URLs, attach databases, or change these settings.
            await conn.query(`SET memory_limit = '${MEMORY_LIMIT}'`);
            await conn.query('SET autoinstall_known_extensions = false');
            await conn.query('SET autoload_known_extensions = false');
            await conn.query('SET enable_external_access = false');
            await conn.query('SET lock_configuration = true');
            onStatus('Ready.');
            return conn;
        } catch (err) {
            if (dbRef === db) dbRef = null;
            try { await db.terminate(); } catch { /* already gone */ }
            throw err;
        }
    }

    // Throw away a DuckDB worker that won't stop; the next run starts fresh.
    function resetEngine() {
        const db = dbRef;
        dbRef = null;
        connPromise = null;
        activeConn = null;
        if (db) db.terminate().catch(() => {});
    }

    // Run one query (or a script). Resolves { result, ms } or rejects; a
    // cancelled run rejects with err.cancelled set to 'user' or 'timeout'
    // and err.killed when the worker had to be thrown away.
    async function run(sql) {
        if (running) throw new Error('busy');
        running = true;
        cancelled = false;
        let stoppedBy = null;
        try {
            const conn = await ready();
            activeConn = conn;
            const aborted = new Promise((_, reject) => {
                abortRun = (why) => { stoppedBy = why; reject(new Error(why)); };
            });
            watchdog = setTimeout(() => cancel('timeout'), QUERY_TIMEOUT_MS);
            const t0 = performance.now();
            const result = await Promise.race([runQuery(conn, sql), aborted]);
            if (cancelled) throw new Error('cancelled');
            return { result, ms: performance.now() - t0 };
        } catch (err) {
            if (cancelled) {
                const e = new Error('cancelled');
                e.cancelled = cancelled;
                e.killed = stoppedBy === 'killed';
                throw e;
            }
            throw err;
        } finally {
            clearTimeout(watchdog);
            clearTimeout(killTimer);
            watchdog = killTimer = abortRun = null;
            running = false;
        }
    }

    // Returns { fields, numRows, batches, truncated } (Arrow RecordBatches).
    async function runQuery(conn, sql) {
        let reader;
        try {
            reader = await conn.send(sql, true); // batch-by-batch reader that Cancel can interrupt
        } catch (err) {
            // The streaming (cancellable) path takes one statement at a time;
            // scripts run whole, and the watchdog still covers them.
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
        if (activeConn) activeConn.cancelSent().catch(() => false);
        killTimer = setTimeout(() => {
            if (!running) return;
            resetEngine();
            if (abortRun) abortRun('killed');
        }, KILL_AFTER_MS);
    }

    return {
        ready,
        run,
        cancel,
        get running() { return running; },
        get loaded() { return connPromise !== null; }
    };
}

// ── Reading results ──

// Call fn(columns, rowInBatch, rowIndex) for the first `limit` rows.
export function eachRow(result, limit, fn) {
    let seen = 0;
    for (const batch of result.batches) {
        if (seen >= limit) break;
        const cols = result.fields.map((_, j) => batch.getChildAt(j));
        for (let i = 0; i < batch.numRows && seen < limit; i++, seen++) fn(cols, i, seen);
    }
}

// Rows as plain objects of display-ready JS values (lists → arrays,
// structs → objects, dates → strings). With { numbers: true }, numeric
// columns stay JS numbers (for the /live charts) instead of display text.
export function toObjects(result, limit, { numbers = false } = {}) {
    const out = [];
    eachRow(result, limit, (cols, i) => {
        const row = {};
        result.fields.forEach((f, j) => {
            const v = getCell(cols[j], i, f.type);
            if (v === null) row[f.name] = null;
            else if (numbers && isNumericType(f.type) && (typeof v === 'number' || typeof v === 'bigint')) row[f.name] = Number(v);
            else row[f.name] = plain(v, f.type);
        });
        out.push(row);
    });
    return out;
}

function plain(v, type) {
    const id = type && type.typeId;
    if (id === ARROW.List && v && typeof v.toArray === 'function') {
        const child = type.children && type.children[0] ? type.children[0].type : null;
        return Array.from(v.toArray(), (x) => (x === null || x === undefined ? null : plain(x, child)));
    }
    if (id === ARROW.Struct && v && typeof v.toJSON === 'function') {
        const obj = v.toJSON();
        const out = {};
        (type.children || []).forEach((c) => {
            const x = obj[c.name];
            out[c.name] = x === null || x === undefined ? null : plain(x, c.type);
        });
        return out;
    }
    if (typeof v === 'string' || typeof v === 'boolean') return v;
    return formatValue(v, type);
}

// Value of row i in an Arrow column vector, or null.
export function getCell(col, i, type) {
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
export function isNumericType(type) {
    const id = type && type.typeId;
    return id === ARROW.Int || id === ARROW.Float || id === ARROW.Decimal;
}

export function formatValue(v, type) {
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

export function csvCell(s) {
    const text = String(s);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function cleanError(err) {
    const msg = (err && err.message) ? err.message : String(err);
    return msg.replace(/^Error:\s*/, '').trim();
}

export function formatMs(ms) {
    return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}
