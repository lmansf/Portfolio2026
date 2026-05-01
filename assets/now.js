/* ─────────────────────────────────────────────────────────────
 * now.js — hydrates the home page Now card.
 *
 * Reads assets/now.json and fills in the .now__value cells. Updates
 * the local-time row every second. Falls back gracefully if the
 * fetch fails (the static HTML defaults stay visible).
 *
 * Designed to be re-runnable after page transitions: each call to
 * window.initializeNowCard() is idempotent.
 * ───────────────────────────────────────────────────────────── */

(function () {
    let clockInterval = null;
    let cachedData = null;

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el && text != null) el.textContent = text;
    }

    function renderClock(timezone, tzLabel) {
        const el = document.getElementById('now-clock');
        if (!el) return;
        try {
            const t = new Date().toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
                timeZone: timezone || 'America/New_York'
            });
            el.textContent = `${t} ${tzLabel || 'EST'}`;
        } catch {
            // Bad timezone or locale — fall back to local
            const t = new Date().toLocaleTimeString('en-US', { hour12: false });
            el.textContent = t;
        }
    }

    function startClock(timezone, tzLabel) {
        if (clockInterval) clearInterval(clockInterval);
        renderClock(timezone, tzLabel);
        clockInterval = setInterval(() => renderClock(timezone, tzLabel), 1000);
    }

    function applyData(data) {
        if (!data) return;
        cachedData = data;

        setText('now-status', data.now);

        const latestEl = document.getElementById('now-latest');
        if (latestEl && data.latest) {
            const text = data.latest.label || '';
            const ago = data.latest.ago ? ` · ${data.latest.ago}` : '';
            if (data.latest.href) {
                latestEl.innerHTML = '';
                const a = document.createElement('a');
                a.href = data.latest.href;
                a.textContent = `${text}${ago} →`;
                latestEl.appendChild(a);
            } else {
                latestEl.textContent = `${text}${ago}`;
            }
        }

        if (Array.isArray(data.stack)) {
            setText('now-stack', data.stack.join(' · '));
        }

        startClock(data.timezone, data.tz_label);
    }

    async function fetchAndApply() {
        try {
            const res = await fetch('assets/now.json', { cache: 'no-store' });
            if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
            const data = await res.json();
            applyData(data);
        } catch (err) {
            console.warn('now.json not loaded; using static fallback.', err);
            // Still start the clock with sensible defaults
            startClock('America/New_York', 'EST');
        }
    }

    function initialize() {
        // Only run if the now-card markup exists on this page
        if (!document.querySelector('.now')) {
            if (clockInterval) {
                clearInterval(clockInterval);
                clockInterval = null;
            }
            return;
        }
        fetchAndApply();
    }

    window.initializeNowCard = initialize;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
