/* ─────────────────────────────────────────────────────────────
 * mentions.js — fills the "Elsewhere / Mentions" section on /about from
 * data/mentions.json (talks, guest posts, podcasts, features).
 *
 * The page ships an empty, `hidden` <section data-mentions>. Only when the
 * file holds at least one valid entry does this script build the divider,
 * heading and list inside it and reveal it, so with an empty file neither
 * readers nor non-rendering crawlers see a "Mentions" heading over nothing.
 * Entry shape (documented in docs/mentions.md):
 *   { "title": "…", "outlet": "…", "date": "YYYY-MM-DD", "url": "https://…" }
 *
 * Runs on first load and again after transition.js swaps a page in.
 * ───────────────────────────────────────────────────────────── */
(function () {
    var SRC = '/data/mentions.json';

    function nonEmpty(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // Same contract as scripts/seo-check.py: title, outlet, a real date and
    // an http(s) url are all required.
    function isValid(m) {
        if (!m || !nonEmpty(m.title) || !nonEmpty(m.outlet) || !formatDate(m.date) || typeof m.url !== 'string') return false;
        try {
            var protocol = new URL(m.url).protocol;
            return protocol === 'https:' || protocol === 'http:';
        } catch (e) {
            return false;
        }
    }

    // Accepts real calendar dates as "YYYY-MM-DD", "YYYY-MM" or "YYYY";
    // anything else (incl. impossible dates like 2025-14-02) returns null.
    function formatDate(value) {
        var m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value || '');
        if (!m) return null;
        var year = +m[1], month = m[2] ? +m[2] - 1 : 0, day = m[3] ? +m[3] : 1;
        var date = new Date(Date.UTC(year, month, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
        var opts = { year: 'numeric', timeZone: 'UTC' };
        if (m[2]) opts.month = 'short';
        if (m[3]) opts.day = 'numeric';
        return date.toLocaleDateString('en-US', opts);
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    // Divider + "Elsewhere / Mentions" heading + empty list, in the site's
    // section markup; returns the list.
    function buildSection(section) {
        var divider = el('div', 'wf-divider mentions__divider');
        divider.setAttribute('aria-hidden', 'true');
        var mark = el('span', 'wf-divider__mark');
        mark.appendChild(el('span', 'crow-mark'));
        divider.appendChild(mark);

        var head = el('header', 'section-head');
        var title = el('h2', 'section-head__title', 'Elsewhere / Mentions');
        title.id = 'about-mentions';
        head.appendChild(title);
        head.appendChild(el('span', 'section-head__hint', 'Talks, posts, podcasts & features'));

        var list = el('ul', 'mentions__list');
        section.setAttribute('aria-labelledby', title.id);
        section.appendChild(divider);
        section.appendChild(head);
        section.appendChild(list);
        return list;
    }

    function render() {
        var section = document.querySelector('[data-mentions]');
        if (!section || section.getAttribute('data-mentions-loaded') !== null) return;
        section.setAttribute('data-mentions-loaded', '');

        fetch(SRC, { cache: 'no-cache' })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) {
                var items = (data && Array.isArray(data.mentions) ? data.mentions : []).filter(isValid);
                if (!items.length) return;
                // Newest first.
                items.sort(function (a, b) { return b.date.localeCompare(a.date); });
                var list = buildSection(section);

                items.forEach(function (m) {
                    var item = el('li', 'mention');
                    var link = el('a', 'mention__title', m.title.trim());
                    link.href = m.url;
                    link.target = '_blank';
                    link.rel = 'noopener';
                    item.appendChild(link);

                    var meta = el('p', 'mention__meta');
                    meta.appendChild(el('span', 'mention__outlet', m.outlet.trim()));
                    var time = el('time', 'mention__date', formatDate(m.date));
                    time.dateTime = m.date;
                    meta.appendChild(time);
                    item.appendChild(meta);
                    list.appendChild(item);
                });
                section.hidden = false;
            })
            .catch(function () { /* leave the section hidden */ });
    }

    document.addEventListener('DOMContentLoaded', render);
    document.addEventListener('page:swap', render);
})();
