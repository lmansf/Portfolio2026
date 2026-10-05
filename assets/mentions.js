/* ─────────────────────────────────────────────────────────────
 * mentions.js — fills the "Elsewhere / Mentions" section on /about from
 * data/mentions.json (talks, guest posts, podcasts, features).
 *
 * The section ships with the `hidden` attribute and is only revealed once the
 * file holds at least one valid entry, so an empty list shows nothing. Entry
 * shape (documented in docs/mentions.md):
 *   { "title": "…", "outlet": "…", "date": "YYYY-MM-DD", "url": "https://…" }
 *
 * Runs on first load and again after transition.js swaps a page in.
 * ───────────────────────────────────────────────────────────── */
(function () {
    var SRC = '/data/mentions.json';

    function isValid(m) {
        if (!m || typeof m.title !== 'string' || !m.title.trim() || typeof m.url !== 'string') return false;
        try {
            var protocol = new URL(m.url).protocol;
            return protocol === 'https:' || protocol === 'http:';
        } catch (e) {
            return false;
        }
    }

    // Accepts "YYYY-MM-DD", "YYYY-MM" or "YYYY"; anything else is not shown.
    function formatDate(value) {
        var m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value || '');
        if (!m) return null;
        var opts = { year: 'numeric', timeZone: 'UTC' };
        if (m[2]) opts.month = 'short';
        if (m[3]) opts.day = 'numeric';
        var date = new Date(Date.UTC(+m[1], m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1));
        return date.toLocaleDateString('en-US', opts);
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    function render() {
        var section = document.querySelector('[data-mentions]');
        var list = section && section.querySelector('[data-mentions-list]');
        if (!list || section.getAttribute('data-mentions-loaded')) return;
        section.setAttribute('data-mentions-loaded', '');

        fetch(SRC, { cache: 'no-cache' })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) {
                var items = (data && Array.isArray(data.mentions) ? data.mentions : []).filter(isValid);
                if (!items.length) return;
                // Newest first; undated entries last.
                items.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });

                items.forEach(function (m) {
                    var item = el('li', 'mention');
                    var link = el('a', 'mention__title', m.title.trim());
                    link.href = m.url;
                    link.target = '_blank';
                    link.rel = 'noopener';
                    item.appendChild(link);

                    var meta = el('p', 'mention__meta');
                    if (typeof m.outlet === 'string' && m.outlet.trim()) meta.appendChild(el('span', 'mention__outlet', m.outlet.trim()));
                    var label = formatDate(m.date);
                    if (label) {
                        var time = el('time', 'mention__date', label);
                        time.dateTime = m.date;
                        meta.appendChild(time);
                    }
                    if (meta.childNodes.length) item.appendChild(meta);
                    list.appendChild(item);
                });
                section.hidden = false;
            })
            .catch(function () { /* leave the section hidden */ });
    }

    document.addEventListener('DOMContentLoaded', render);
    document.addEventListener('page:swap', render);
})();
