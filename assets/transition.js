/* ─────────────────────────────────────────────────────────────
 * transition.js — the burger / site-nav dropdown (focus returns to the
 * burger when the menu is dismissed).
 *
 * In-site links are ordinary full page loads, so Home is always the real
 * index.html with all of its scripts (the hero replay included), whether a
 * visitor lands on / or follows the Home tab or logo. Page changes still
 * fade through the cross-document `@view-transition` opt-in in shell.css.
 * (This file used to swap <main> in place between Home and Projects, which
 * brought back Home's markup without re-running its hero.)
 * ───────────────────────────────────────────────────────────── */

/* ─── Burger / site-nav dropdown ─── */
function getSiteNav() {
    return document.getElementById('site-nav');
}

function openSiteNav() {
    const nav = getSiteNav();
    if (!nav) return;
    // Pin the panel under the burger using its actual bounding rect (avoids the
    // scrollbar-width mismatch between fixed positioning and the sticky header).
    const burger = document.querySelector('[data-burger]');
    const panel = nav.querySelector('.site-nav__panel');
    if (burger && panel) {
        const r = burger.getBoundingClientRect();
        panel.style.top = Math.round(r.bottom + 8) + 'px';
        panel.style.right = Math.round(window.innerWidth - r.right) + 'px';
    }
    document.body.classList.add('site-nav-open');
    nav.setAttribute('aria-hidden', 'false');
    nav.removeAttribute('inert');
    if (burger) {
        burger.setAttribute('aria-expanded', 'true');
        burger.setAttribute('aria-label', 'Close navigation');
    }
    const firstLink = nav.querySelector('.site-nav__item');
    if (firstLink) setTimeout(() => firstLink.focus(), 50);
}

// options.restoreFocus: move focus back to the burger. Pass it when the menu
// is dismissed in place (Escape, backdrop, burger); omit it when a link was
// followed, since navigation moves focus itself.
function closeSiteNav(options = {}) {
    const nav = getSiteNav();
    if (!nav) return;
    const wasOpen = document.body.classList.contains('site-nav-open');
    document.body.classList.remove('site-nav-open');
    nav.setAttribute('aria-hidden', 'true');
    nav.setAttribute('inert', '');
    const burger = document.querySelector('[data-burger]');
    if (burger) {
        burger.setAttribute('aria-expanded', 'false');
        burger.setAttribute('aria-label', 'Open navigation');
        // Hand focus back to the burger when the menu is dismissed without
        // following a link (Escape, backdrop, burger), so keyboard users
        // aren't dropped onto <body>.
        if (wasOpen && options.restoreFocus) burger.focus();
    }
}

function toggleSiteNav() {
    document.body.classList.contains('site-nav-open') ? closeSiteNav({ restoreFocus: true }) : openSiteNav();
}

document.addEventListener('DOMContentLoaded', () => {
    closeSiteNav();

    document.body.addEventListener('click', (e) => {
        // Burger toggle
        if (e.target.closest('[data-burger]')) {
            e.preventDefault();
            toggleSiteNav();
            return;
        }

        // Backdrop close
        if (e.target.closest('[data-nav-close]')) {
            closeSiteNav({ restoreFocus: true });
            return;
        }

        // Any link: close the menu and let the browser follow it.
        const link = e.target.closest('a');
        if (!link) return;
        if (link.getAttribute('href') === '#') e.preventDefault();
        closeSiteNav();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('site-nav-open')) {
            closeSiteNav({ restoreFocus: true });
        }
    });
});
