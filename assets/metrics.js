/* ─────────────────────────────────────────────────────────────
 * metrics.js — the site's metrics, from data/pipeline/metrics.json.
 *
 * Every rate the site shows (catch rate, good customers declined, fraud
 * dollars stopped, …) is defined once in metrics.json as numerator /
 * denominator over the fraud_* tables. This module computes them for the
 * /live page; the SQL source editors and the nightly data run use the same
 * definitions through data/pipeline/metrics.sql (scripts/build_metrics.py),
 * so a number on the page, in a query and in the site copy can't drift apart.
 * esbuild bundles the JSON in (live.min.js is built with --bundle).
 * ───────────────────────────────────────────────────────────── */

import defs from '../data/pipeline/metrics.json';

export const METRICS = defs.metrics;

// "fraud_dollars_stopped + fraud_dollars_approved" over one row; NaN if a
// column is missing or isn't a number.
function evaluate(expr, row) {
    let total = 0;
    let sign = 1;
    for (const tok of expr.split(/\s*([+-])\s*/)) {
        if (tok === '+') sign = 1;
        else if (tok === '-') sign = -1;
        else {
            const v = row ? row[tok] : undefined;
            if (typeof v !== 'number' || !Number.isFinite(v)) return NaN;
            total += sign * v;
        }
    }
    return total;
}

/**
 * The value of metric `name` for one row of `table` (fraud_totals,
 * fraud_daily or fraud_patterns), or NaN when it can't be computed (a
 * missing column, or nothing to divide by).
 */
export function metric(name, row, table = 'fraud_totals') {
    const def = METRICS[name];
    if (!def) throw new Error(`No metric ${name} in data/pipeline/metrics.json`);
    const over = def.tables[table];
    if (!over) throw new Error(`Metric ${name} isn't defined on ${table}`);
    const num = evaluate(over.numerator || def.numerator, row);
    const den = evaluate(over.denominator || def.denominator, row);
    return den > 0 ? num / den : NaN;
}
