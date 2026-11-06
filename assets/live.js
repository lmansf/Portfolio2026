/* ─────────────────────────────────────────────────────────────
 * live.js — draws the /live page from /data/fraud-snapshot.json.
 *
 * The snapshot holds aggregates only (counts, rates, dollar totals, a
 * score histogram), produced once a day by scripts/fraud-snapshot.sql.
 * Charts are plain SVG built here; no chart library, no database key.
 * Every value is also reachable without hover: stat tiles, captions,
 * and the daily table.
 *
 * Once the tiles are filled, the checkouts, caught and dollars values are
 * marked data-countup and a `motion:countup` event asks motion.js to count
 * them up. motion.js owns that animation; this file only sets the final
 * text, which is what screen readers, no-JS and print get.
 *
 * The "SQL source" editors (sql-source.js) can redraw the page from a
 * visitor's query: this file keeps the published snapshot in
 * window.__liveSnapshot and redraws from whatever a `live:render` event
 * carries, falling back to the published numbers if that doesn't draw.
 *
 * Every rate here (catch rate, good customers declined, dollars stopped,
 * timeouts, catch rate by day and by pattern) comes from metric() in
 * metrics.js, so it's the definition in data/pipeline/metrics.json that the
 * SQL editors, the nightly data run and the site copy use too. Built with
 * esbuild --bundle --format=iife (see the README).
 * ───────────────────────────────────────────────────────────── */
import { metric } from './metrics.js';

(function () {
    'use strict';

    const root = document.querySelector('[data-live]');
    if (!root) return;

    const SNAPSHOT_URL = '/data/fraud-snapshot.json';
    const TZ = 'America/New_York';
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const STALE_HOURS = 36;
    const PAUSED_HOURS = 6;

    const PATTERN_NAMES = {
        card_testing: 'Card testing',
        fraud_ring: 'Fraud rings',
        gift_card_cashout: 'Gift-card cash-out',
        stolen_card_resale: 'Stolen-card resale',
        account_takeover: 'Account takeover'
    };
    const CROSS_ACCOUNT_PATTERNS = new Set(['fraud_ring', 'account_takeover']);

    /* ── Formatting ── */
    const nf = new Intl.NumberFormat('en-US');
    const fmtInt = (n) => nf.format(Math.round(n));
    const fmtPct = (n, digits = 0) => (Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : '–');
    const fmtMoney = (n) => {
        if (!Number.isFinite(n)) return '–';
        if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
        if (Math.abs(n) >= 1e4) return `$${Math.round(n / 1e3)}K`;
        return `$${fmtInt(n)}`;
    };
    const ratio = (a, b) => (b > 0 ? a / b : NaN);

    // Calendar days arrive as YYYY-MM-DD (already America/New_York days).
    const dayToDate = (day) => new Date(`${day}T12:00:00Z`);
    const fmtDay = (day, opts = { month: 'short', day: 'numeric' }) =>
        dayToDate(day).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
    const etDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
    const fmtStamp = (iso) => new Date(iso).toLocaleString('en-US', {
        timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }) + ' ET';
    const addDays = (day, n) => {
        const d = dayToDate(day);
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    };

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function el(name, attrs = {}, parent) {
        const node = document.createElementNS(SVG_NS, name);
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
        if (parent) parent.appendChild(node);
        return node;
    }

    // A rect with only its data end rounded (4px), flat on the baseline side.
    function topRoundedRect(x, y, w, h, r = 4) {
        if (h <= 0 || w <= 0) return '';
        const rr = Math.min(r, w / 2, h);
        return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
    }
    function flatRect(x, y, w, h) {
        if (h <= 0 || w <= 0) return '';
        return `M${x},${y}H${x + w}V${y + h}H${x}Z`;
    }

    // Round tick step (1, 2, 2.5 or 5 × 10^n) and a top value that is a whole number of steps.
    function niceScale(v, ticks = 4) {
        const step = niceMax(Math.max(v, 1e-9) / ticks);
        return { step, max: Math.max(step, Math.ceil(v / step) * step) };
    }
    function niceMax(v) {
        if (v <= 0) return 1;
        const p = Math.pow(10, Math.floor(Math.log10(v)));
        const m = v / p;
        const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
        return step * p;
    }

    /* ── Tooltip ── */
    const tooltip = root.querySelector('[data-live-tooltip]');
    let tipAnchor = null;
    let tipHtml = '';
    function showTip(html, anchor) {
        if (!tooltip) return;
        tipAnchor = anchor;
        tipHtml = html;
        tooltip.innerHTML = html;
        tooltip.hidden = false;
        const r = anchor.getBoundingClientRect();
        const tw = tooltip.offsetWidth;
        const th = tooltip.offsetHeight;
        let left = r.left + r.width / 2 - tw / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
        let top = r.top - th - 8;
        if (top < 8) top = r.bottom + 8;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }
    let activeGroup = null;
    function hideTip() {
        if (tooltip) tooltip.hidden = true;
        tipAnchor = null;
        tipHtml = '';
        if (activeGroup) { activeGroup.classList.remove('is-active'); activeGroup = null; }
    }
    window.addEventListener('scroll', () => {
        const focused = document.activeElement;
        if (tipAnchor && focused === tipAnchor && focused.classList.contains('hit')) showTip(tipHtml, tipAnchor);
        else hideTip();
    }, { passive: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Esc') hideTip(); });
    // Touch: a tap on a bar shows its numbers (bindTip's click), a tap anywhere else puts them away.
    document.addEventListener('pointerdown', (e) => {
        if (tipAnchor && !(e.target instanceof Element && e.target.closest('.hit'))) hideTip();
    }, { passive: true });

    function bindTip(target, html, group) {
        const on = () => {
            if (activeGroup && activeGroup !== group) activeGroup.classList.remove('is-active');
            activeGroup = group || null;
            group && group.classList.add('is-active');
            showTip(html, target);
        };
        const off = hideTip;
        target.addEventListener('mouseenter', on);
        target.addEventListener('mouseleave', off);
        target.addEventListener('focus', on);
        target.addEventListener('blur', off);
        target.addEventListener('click', on);
    }
    const ttRow = (key, value, swatch) =>
        `<div class="tt-row"><span class="tt-key">${swatch ? `<span class="live-swatch live-swatch--${swatch}"></span>` : ''}${esc(key)}</span><span>${esc(value)}</span></div>`;

    /* ── Validation: refuse anything that isn't the aggregate shape ── */
    function isSnapshot(s) {
        return s && s.simulated === true && s.totals && Array.isArray(s.daily) &&
            Array.isArray(s.score_bins) && Array.isArray(s.patterns) &&
            typeof s.generated_at === 'string';
    }

    /* ── Header ── */
    function renderMeta(s) {
        const updated = root.querySelector('[data-live-updated]');
        if (updated) {
            const latest = s.latest_event_at ? ` · latest checkout scored ${fmtStamp(s.latest_event_at)}` : '';
            updated.textContent = `Updated ${fmtStamp(s.generated_at)}${latest}`;
        }
        const model = root.querySelector('[data-live-model]');
        if (model && s.model_versions) model.textContent = `Model: ${s.model_versions}`;

        const win = root.querySelector('[data-live-window]');
        if (win && s.daily.length) {
            win.textContent = `${fmtDay(s.daily[0].day)} to ${fmtDay(s.daily[s.daily.length - 1].day)} · ${fmtInt(s.totals.active_days)} days with checkouts`;
        }

        const stale = root.querySelector('[data-live-stale]');
        if (!stale) return;
        const ageH = (Date.now() - Date.parse(s.generated_at)) / 36e5;
        const pausedH = s.latest_event_at ? (Date.parse(s.generated_at) - Date.parse(s.latest_event_at)) / 36e5 : 0;
        const notes = [];
        if (ageH > STALE_HOURS) notes.push(`No newer numbers have been published since ${fmtStamp(s.generated_at)}.`);
        if (pausedH > PAUSED_HOURS) notes.push(`The checkout generator has been paused since ${fmtStamp(s.latest_event_at)}, so these numbers stop there.`);
        if (notes.length) {
            stale.textContent = notes.join(' ');
            stale.hidden = false;
        }
    }

    /* ── Stat tiles ── */
    function renderKpis(s, quiet) {
        const t = s.totals;
        const set = (key, value, sub) => {
            const v = root.querySelector(`[data-kpi="${key}"]`);
            const d = root.querySelector(`[data-kpi-sub="${key}"]`);
            if (v) v.textContent = value;
            if (d) d.textContent = sub;
        };
        // A typical full day: the median, leaving out the first and last days (often partial).
        const full = s.daily.slice(1, -1).map((d) => d.checkouts).filter((n) => n > 0).sort((a, b) => a - b);
        const perDay = full.length ? full[Math.floor(full.length / 2)] : NaN;
        set('checkouts', fmtInt(t.checkouts), Number.isFinite(perDay) ? `About ${fmtInt(Math.round(perDay / 100) * 100)} on a typical day` : `${fmtInt(t.active_days)} days with checkouts`);
        set('caught', fmtPct(metric('catch_rate', t)), `${fmtInt(t.fraud_caught)} of ${fmtInt(t.fraud)} fraudulent orders`);
        set('false-declines', fmtInt(t.false_declines), t.false_declines > 0
            ? `${fmtPct(metric('false_decline_rate', t), 2)} of ${fmtInt(t.legit)} legitimate orders`
            : `Out of ${fmtInt(t.legit)} legitimate orders`);
        const fraudDollars = (t.fraud_dollars_stopped || 0) + (t.fraud_dollars_approved || 0);
        set('dollars', fmtMoney(t.fraud_dollars_stopped), `${fmtPct(metric('dollars_stopped_share', t))} of ${fmtMoney(fraudDollars)} attempted`);
        set('latency', `${t.p95_scoring_ms} ms`, `${fmtInt(t.scoring_timeouts)} timeouts failed open (${fmtPct(metric('timeout_rate', t), 1)})`);

        // Ask motion.js to count these up once (it skips zeros, and does
        // nothing under reduced motion). The text set above is the final value.
        if (quiet) return;
        const counted = ['checkouts', 'caught', 'dollars']
            .map((key) => root.querySelector(`[data-kpi="${key}"]`))
            .filter(Boolean);
        counted.forEach((v) => v.setAttribute('data-countup', ''));
        document.dispatchEvent(new CustomEvent('motion:countup', { detail: { elements: counted } }));
    }

    /* ── Daily stacked bars: caught (bottom) + missed (top) ── */
    function renderDaily(s, todayEt) {
        const host = root.querySelector('[data-chart="daily"]');
        if (!host || !s.daily.length) return;
        host.textContent = '';

        const byDay = new Map(s.daily.map((d) => [d.day, d]));
        const first = s.daily[0].day;
        const last = s.daily[s.daily.length - 1].day;
        const days = [];
        for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);

        const width = Math.max(280, host.clientWidth || 640);
        const height = width < 480 ? 220 : 260;
        const m = { top: 12, right: 8, bottom: 28, left: 36 };
        const iw = width - m.left - m.right;
        const ih = height - m.top - m.bottom;
        const scale = niceScale(Math.max(...s.daily.map((d) => d.fraud)));
        const yMax = scale.max;
        const y = (v) => m.top + ih - (v / yMax) * ih;
        const step = iw / days.length;
        const barW = Math.max(3, Math.min(22, step - 2));

        const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, focusable: 'false' }, host);
        const grid = el('g', { class: 'grid', 'aria-hidden': 'true' }, svg);
        const ticks = Math.round(yMax / scale.step);
        for (let i = 0; i <= ticks; i++) {
            const v = scale.step * i;
            const yy = y(v);
            if (i > 0) el('line', { x1: m.left, x2: width - m.right, y1: yy, y2: yy }, grid);
            const t = el('text', { 'aria-hidden': 'true', x: m.left - 6, y: yy + 4, 'text-anchor': 'end' }, svg);
            t.textContent = fmtInt(v);
        }
        el('line', { class: 'baseline', x1: m.left, x2: width - m.right, y1: y(0), y2: y(0) }, svg);

        // Label runs of missing days once, in the middle of the run.
        let runStart = null;
        days.forEach((day, i) => {
            const missing = !byDay.has(day);
            if (missing && runStart === null) runStart = i;
            if ((!missing || i === days.length - 1) && runStart !== null) {
                const end = missing ? i : i - 1;
                const cx = m.left + step * ((runStart + end + 1) / 2);
                const t = el('text', { 'aria-hidden': 'true', x: cx, y: m.top + ih / 2, 'text-anchor': 'middle', class: 'gap-label' }, svg);
                t.textContent = end - runStart >= 2 ? 'paused' : '';
                runStart = null;
            }
        });

        const labelEvery = days.length > 21 ? 7 : days.length > 10 ? 4 : 2;
        days.forEach((day, i) => {
            const x = m.left + step * i + (step - barW) / 2;
            if (i % labelEvery === 0) {
                const t = el('text', { 'aria-hidden': 'true', x: x + barW / 2, y: height - 8, 'text-anchor': 'middle' }, svg);
                t.textContent = fmtDay(day);
            }
        });

        days.forEach((day, i) => {
            const d = byDay.get(day);
            if (!d) return;
            const x = m.left + step * i + (step - barW) / 2;
            const missed = d.fraud - d.fraud_caught;
            const partial = day === todayEt;
            const col = el('g', { class: `col${partial ? ' is-partial' : ''}` }, svg);
            const hCaught = (d.fraud_caught / yMax) * ih;
            const hMissed = (missed / yMax) * ih;
            const gap = d.fraud_caught > 0 && missed > 0 ? 2 : 0;
            const base = y(0);
            if (d.fraud_caught > 0) {
                el('path', { class: `bar bar--caught${partial ? ' bar--partial' : ''}`, d: missed > 0 ? flatRect(x, base - hCaught, barW, hCaught) : topRoundedRect(x, base - hCaught, barW, hCaught) }, col);
            }
            if (missed > 0) {
                el('path', { class: `bar bar--missed${partial ? ' bar--partial' : ''}`, d: topRoundedRect(x, base - hCaught - gap - hMissed, barW, hMissed) }, col);
            }
            const hit = el('rect', {
                class: 'hit', x: m.left + step * i, y: m.top, width: Math.max(step, 1), height: ih,
                tabindex: '0', role: 'img',
                'aria-label': `${fmtDay(day, { weekday: 'short', month: 'short', day: 'numeric' })}${partial ? ', so far' : ''}: ${fmtInt(d.fraud)} fraudulent orders, ${fmtInt(d.fraud_caught)} caught, ${fmtInt(missed)} missed, out of ${fmtInt(d.checkouts)} checkouts`
            }, col);
            const html = `<strong>${esc(fmtDay(day, { weekday: 'short', month: 'short', day: 'numeric' }))}${partial ? ' (so far)' : ''}</strong>` +
                ttRow('Checkouts', fmtInt(d.checkouts)) +
                ttRow('Fraud caught', fmtInt(d.fraud_caught), 'caught') +
                ttRow('Fraud missed', fmtInt(missed), 'missed') +
                ttRow('Catch rate', fmtPct(metric('catch_rate', d, 'fraud_daily'))) +
                ttRow('Good customers declined', fmtInt(d.false_declines));
            bindTip(hit, html, col);
        });

        const caption = root.querySelector('[data-caption="daily"]');
        if (caption) {
            const vols = s.daily.map((d) => d.checkouts).sort((a, b) => a - b);
            const median = vols[Math.floor(vols.length / 2)] || 0;
            // Full days only: skip today and any day the generator ran for part of.
            const full = s.daily.filter((d) => d.day !== todayEt && d.checkouts >= median * 0.8);
            const rates = full.map((d) => metric('catch_rate', d, 'fraud_daily')).filter(Number.isFinite);
            const missingDays = days.filter((d) => !byDay.has(d));
            let text = rates.length
                ? `On full days the model caught between ${fmtPct(Math.min(...rates))} and ${fmtPct(Math.max(...rates))} of fraud.`
                : '';
            if (missingDays.length) text += ` No checkouts ran ${fmtDay(missingDays[0])} to ${fmtDay(missingDays[missingDays.length - 1])} while the generator was paused.`;
            if (byDay.has(todayEt)) text += ' The lighter bar is today, still in progress.';
            caption.textContent = text.trim();
        }
    }

    /* ── Score distribution: share of each group per score bin ── */
    function renderScores(s) {
        const host = root.querySelector('[data-chart="scores"]');
        if (!host) return;
        host.textContent = '';
        const NB = 20;
        const bins = Array.from({ length: NB }, (_, i) => ({ from: i / NB, to: (i + 1) / NB, legit: 0, fraud: 0 }));
        s.score_bins.forEach((b) => {
            const i = Math.min(NB - 1, Math.max(0, Math.round(b.from * NB)));
            bins[i].legit += b.legit || 0;
            bins[i].fraud += b.fraud || 0;
        });
        const totLegit = bins.reduce((a, b) => a + b.legit, 0);
        const totFraud = bins.reduce((a, b) => a + b.fraud, 0);
        bins.forEach((b) => { b.legitShare = ratio(b.legit, totLegit) || 0; b.fraudShare = ratio(b.fraud, totFraud) || 0; });

        const width = Math.max(280, host.clientWidth || 640);
        const height = width < 480 ? 220 : 260;
        const m = { top: 22, right: 8, bottom: 30, left: 40 };
        const iw = width - m.left - m.right;
        const ih = height - m.top - m.bottom;
        const yMax = Math.min(1, niceMax(Math.max(...bins.map((b) => Math.max(b.legitShare, b.fraudShare)))));
        const y = (v) => m.top + ih - (v / yMax) * ih;
        const x = (score) => m.left + score * iw;
        const step = iw / NB;
        const barW = Math.max(2, Math.min(12, (step - 4) / 2));

        const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, focusable: 'false' }, host);
        const grid = el('g', { class: 'grid', 'aria-hidden': 'true' }, svg);
        for (let i = 0; i <= 4; i++) {
            const v = (yMax / 4) * i;
            if (i > 0) el('line', { x1: m.left, x2: width - m.right, y1: y(v), y2: y(v) }, grid);
            const t = el('text', { 'aria-hidden': 'true', x: m.left - 6, y: y(v) + 4, 'text-anchor': 'end' }, svg);
            t.textContent = fmtPct(v);
        }
        el('line', { class: 'baseline', x1: m.left, x2: width - m.right, y1: y(0), y2: y(0) }, svg);
        for (let v = 0; v <= 1.0001; v += 0.25) {
            const t = el('text', { 'aria-hidden': 'true', x: x(v), y: height - 10, 'text-anchor': v === 0 ? 'start' : v >= 1 ? 'end' : 'middle' }, svg);
            t.textContent = v.toFixed(2);
        }

        const th = s.thresholds || {};
        const narrow = width < 520;
        [['Review', th.review_from], ['Decline', th.decline_from]].forEach(([label, v], i) => {
            if (!Number.isFinite(v)) return;
            el('line', { class: 'threshold', x1: x(v), x2: x(v), y1: m.top - 4, y2: y(0) }, svg);
            // Stagger the two labels and flip a label left of its line near the right edge.
            const flip = x(v) > width - (narrow ? 70 : 110);
            const t = el('text', { 'aria-hidden': 'true',
                x: flip ? x(v) - 4 : x(v) + 4, y: m.top + 6 + i * 16,
                'text-anchor': flip ? 'end' : 'start', class: 'threshold-label'
            }, svg);
            t.textContent = narrow ? label : `${label} ≥ ${v.toFixed(2)}`;
        });

        bins.forEach((b, i) => {
            const cx = m.left + step * i + step / 2;
            const col = el('g', { class: 'col' }, svg);
            const hL = (b.legitShare / yMax) * ih;
            const hF = (b.fraudShare / yMax) * ih;
            if (hL > 0) el('path', { class: 'bar bar--legit', d: topRoundedRect(cx - barW - 1, y(0) - Math.max(hL, 1), barW, Math.max(hL, 1)) }, col);
            if (hF > 0) el('path', { class: 'bar bar--fraud', d: topRoundedRect(cx + 1, y(0) - Math.max(hF, 1), barW, Math.max(hF, 1)) }, col);
            const range = `${b.from.toFixed(2)} to ${b.to.toFixed(2)}`;
            const hit = el('rect', {
                class: 'hit', x: m.left + step * i, y: m.top, width: step, height: ih, tabindex: '0', role: 'img',
                'aria-label': `Score ${range}: ${fmtPct(b.legitShare, 1)} of good customers, ${fmtPct(b.fraudShare, 1)} of fraud`
            }, col);
            bindTip(hit, `<strong>Score ${esc(range)}</strong>` +
                ttRow('Good customers', `${fmtPct(b.legitShare, 1)} (${fmtInt(b.legit)})`, 'legit') +
                ttRow('Fraud', `${fmtPct(b.fraudShare, 1)} (${fmtInt(b.fraud)})`, 'fraud'), col);
        });

        const caption = root.querySelector('[data-caption="scores"]');
        if (caption) {
            const t = s.totals || {};
            const eps = 1e-9;
            const hasReview = Number.isFinite(th.review_from);
            const topLegit = bins.reduce((a, b) => (b.legit > 0 ? b.to : a), 0);
            const legitFlagged = Number.isFinite(t.flagged) && Number.isFinite(t.fraud_caught)
                ? Math.max(0, t.flagged - t.fraud_caught)
                : hasReview ? bins.filter((b) => b.to > th.review_from + eps).reduce((a, b) => a + b.legit, 0) : NaN;
            const falseDeclines = Number.isFinite(t.false_declines) ? t.false_declines : NaN;
            const sentences = [];
            if (totLegit > 0 && legitFlagged === 0) {
                sentences.push(hasReview && topLegit <= th.review_from + eps
                    ? `Every good customer scored below ${topLegit.toFixed(2)}, under the review line, so none were declined.`
                    : `Every good customer scored below ${topLegit.toFixed(2)}, and none were sent to review or declined.`);
            } else if (totLegit > 0 && Number.isFinite(legitFlagged)) {
                const defined = metric('legit_flag_rate', t);
                const legitRate = Number.isFinite(defined) ? defined : ratio(legitFlagged, totLegit);
                let line = `${fmtInt(legitFlagged)} good ${legitFlagged === 1 ? 'customer' : 'customers'} (${fmtPct(legitRate, 1)}) scored at or above the review line`;
                if (hasReview) line += ` of ${th.review_from.toFixed(2)}`;
                if (falseDeclines === 0) line += ', but none were declined.';
                else if (Number.isFinite(falseDeclines)) line += `, and ${fmtInt(falseDeclines)} ${falseDeclines === 1 ? 'was' : 'were'} declined.`;
                else line += '.';
                sentences.push(line);
            }
            if (Number.isFinite(t.fraud) && Number.isFinite(t.fraud_caught) && t.fraud > 0) {
                let line = `The cost is the fraud that scores low too: ${fmtPct(metric('miss_rate', t))} of fraudulent orders were approved`;
                line += hasReview ? `, mostly because they scored below the review line of ${th.review_from.toFixed(2)}.` : '.';
                sentences.push(line);
            }
            caption.textContent = sentences.join(' ');
        }
    }

    /* ── Catch rate by pattern ── */
    function renderPatterns(s) {
        const host = root.querySelector('[data-chart="patterns"]');
        if (!host) return;
        host.textContent = '';
        const rows = s.patterns
            .filter((p) => p.fraud > 0)
            .map((p) => ({ ...p, rate: metric('catch_rate', p, 'fraud_patterns'), name: PATTERN_NAMES[p.pattern] || String(p.pattern).replace(/_/g, ' ') }))
            .sort((a, b) => b.rate - a.rate);
        rows.forEach((p) => {
            const row = document.createElement('div');
            row.className = 'live-bar';
            row.innerHTML =
                `<div class="live-bar__head"><span class="live-bar__name">${esc(p.name)}</span>` +
                `<span class="live-bar__value">${fmtPct(p.rate)} · ${fmtInt(p.caught)} of ${fmtInt(p.fraud)}</span></div>` +
                `<div class="live-bar__track" role="img" aria-label="${esc(p.name)}: ${fmtPct(p.rate)} caught"><div class="live-bar__fill" style="width:${(p.rate * 100).toFixed(1)}%"></div></div>`;
            host.appendChild(row);
        });
        const caption = root.querySelector('[data-caption="patterns"]');
        if (caption && rows.length > 1) {
            const best = rows[0];
            const worst = rows[rows.length - 1];
            let text = `The rules catch ${best.name.toLowerCase()} best (${fmtPct(best.rate)}) and ${worst.name.toLowerCase()} worst (${fmtPct(worst.rate)}).`;
            if (CROSS_ACCOUNT_PATTERNS.has(worst.pattern)) text += ' Fraud spread across many accounts looks normal one order at a time.';
            caption.textContent = text;
        }
    }

    /* ── Table view ── */
    function renderTable(s, todayEt) {
        const body = root.querySelector('[data-table="daily"]');
        if (!body) return;
        body.innerHTML = s.daily.slice().reverse().map((d) =>
            `<tr><td>${esc(fmtDay(d.day, { weekday: 'short', month: 'short', day: 'numeric' }))}${d.day === todayEt ? ' (so far)' : ''}</td>` +
            `<td>${fmtInt(d.checkouts)}</td><td>${fmtInt(d.reviewed)}</td><td>${fmtInt(d.declined)}</td>` +
            `<td>${fmtInt(d.fraud)}</td><td>${fmtInt(d.fraud_caught)}</td><td>${fmtInt(d.false_declines)}</td>` +
            `<td>${fmtMoney(d.fraud_dollars_stopped || 0)}</td></tr>`
        ).join('');
    }

    function renderAll(s, quiet) {
        const todayEt = etDay(s.generated_at);
        renderMeta(s);
        renderKpis(s, quiet);
        renderDaily(s, todayEt);
        renderScores(s);
        renderPatterns(s);
        renderTable(s, todayEt);
    }

    function fail() {
        const err = root.querySelector('[data-live-error]');
        if (err) err.hidden = false;
        const updated = root.querySelector('[data-live-updated]');
        if (updated) updated.textContent = 'Latest numbers unavailable right now';
    }

    fetch(SNAPSHOT_URL, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((s) => {
            if (!isSnapshot(s)) throw new Error('Unexpected snapshot shape');
            renderAll(s);
            window.__liveSnapshot = s;
            let shown = s;
            // A visitor's query from a SQL source editor: draw it, or put the
            // published numbers back if it won't draw.
            document.addEventListener('live:render', (e) => {
                const next = e.detail && e.detail.snapshot;
                hideTip();
                try {
                    if (!isSnapshot(next)) throw new Error('Unexpected snapshot shape');
                    renderAll(next, true);
                    shown = next;
                    e.detail.ok = true;
                } catch (err) {
                    console.error(err);
                    renderAll(s, true);
                    shown = s;
                }
            });
            let lastW = window.innerWidth;
            let t = 0;
            window.addEventListener('resize', () => {
                if (Math.abs(window.innerWidth - lastW) < 24) return;
                clearTimeout(t);
                t = setTimeout(() => { lastW = window.innerWidth; hideTip(); renderDaily(shown, etDay(shown.generated_at)); renderScores(shown); }, 150);
            });
        })
        .catch(fail);
})();
