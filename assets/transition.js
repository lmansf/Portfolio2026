/* ─────────────────────────────────────────────────────────────
 * transition.js — page transitions + nav for the 2-page site.
 *
 * Scope: Home + Projects. Handles the SPA-style page swap (with the
 * View Transitions API where supported), the burger / site-nav dropdown
 * (focus returns to the burger when the menu is dismissed),
 * scroll + focus on navigation (to the `#hash` target when the link names
 * one, e.g. /projects#fraud, otherwise the top of the page), and
 * back/forward (popstate, hash preserved; hash-only changes are left to the
 * browser so in-page links do not re-swap the page).
 * ───────────────────────────────────────────────────────────── */

function normalizeInternalPath(url) {
    const rawUrl = (url || '').trim();
    if (!rawUrl || rawUrl === '/' || rawUrl === './') return 'index.html';

    const base = (typeof window !== 'undefined' && window.location && window.location.origin)
        ? window.location.origin
        : 'http://localhost';

    let pathname = '';
    try {
        pathname = new URL(rawUrl, base).pathname || '';
    } catch {
        pathname = rawUrl.split('#')[0].split('?')[0];
    }

    const normalizedPathname = pathname.replace(/\/+$/, '') || '/';
    const segment = (normalizedPathname.split('/').pop() || 'index').toLowerCase();
    const routeAliases = {
        '': 'index.html',
        index: 'index.html',
        projects: 'projects.html'
    };

    if (segment.endsWith('.html')) return segment;
    return routeAliases[segment] || segment;
}

function isTransitionPage(path) {
    return ['index.html', 'projects.html'].includes(path);
}

function getHashTarget(url) {
    let hash = '';
    try {
        hash = new URL(url, window.location.origin).hash;
    } catch {
        hash = '';
    }
    if (!hash || hash.length < 2) return null;
    try {
        return document.getElementById(decodeURIComponent(hash.slice(1)));
    } catch {
        return null;
    }
}

async function getIncomingDocumentForNavigation(url) {
    const response = await fetch(url);
    const html = await response.text();
    return new DOMParser().parseFromString(html, 'text/html');
}

async function navigateTo(url, options = {}) {
    if (navigateTo.isNavigating) return;
    navigateTo.isNavigating = true;

    const { updateHistory = true } = options;
    const main = document.querySelector('main');

    try {
        const doc = await getIncomingDocumentForNavigation(url);

        // Swap <main>, header, footer, and title. Runs inside a View Transition
        // snapshot when supported.
        async function doSwap() {
            const newMain = doc.querySelector('main');
            const newTitle = doc.querySelector('title').innerText;
            const newHeader = doc.querySelector('header');

            if (main && newMain) {
                main.innerHTML = newMain.innerHTML;
                main.className = newMain.className;
            }

            if (newHeader) {
                const header = document.querySelector('header');
                if (header) header.innerHTML = newHeader.innerHTML;
                closeSiteNav();
            }

            const footer = document.querySelector('footer');
            const newFooter = doc.querySelector('footer');
            if (newFooter) {
                if (footer) {
                    footer.outerHTML = newFooter.outerHTML;
                } else {
                    document.body.insertBefore(newFooter, document.querySelector('script'));
                }
            } else if (footer) {
                footer.remove();
            }

            document.title = newTitle;
            navigateTo.renderedPath = normalizeInternalPath(url);

            if (updateHistory) {
                history.pushState({}, newTitle, url);
            }

            // Scroll to the hash target when the URL names one; otherwise reset
            // to the top. Then move focus there for keyboard / screen-reader users.
            const hashTarget = getHashTarget(url);
            if (hashTarget) {
                hashTarget.scrollIntoView({ block: 'start', behavior: 'instant' });
            } else {
                window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
            }
            const focusTarget = hashTarget || document.getElementById('main-content') || main;
            if (focusTarget) {
                focusTarget.setAttribute('tabindex', '-1');
                focusTarget.focus({ preventScroll: true });
            }
        }

        const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduceMotion && typeof document.startViewTransition === 'function') {
            const vt = document.startViewTransition(() => doSwap());
            try { await vt.finished; } catch { /* user may have navigated again */ }
        } else {
            // Legacy fade fallback
            if (main) main.classList.add('page-exit');
            await new Promise((resolve) => setTimeout(resolve, reduceMotion ? 0 : 300));
            await doSwap();
            const m = document.querySelector('main');
            if (m) {
                m.classList.remove('page-exit');
                m.classList.add('page-enter');
                setTimeout(() => m.classList.remove('page-enter'), reduceMotion ? 0 : 300);
            }
        }
    } catch (err) {
        console.error('Navigation failed:', err);
        window.location.href = url;
    } finally {
        navigateTo.isNavigating = false;
    }
}

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
    if (window.location.protocol === 'file:') {
        console.warn('Page transitions require a local server (CORS restrictions on file://).');
    }

    closeSiteNav();
    navigateTo.renderedPath = normalizeInternalPath(window.location.pathname);

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

        // Internal nav links
        const link = e.target.closest('a');
        if (!link) return;
        const href = link.getAttribute('href');
        if (!href) return;

        if (href === '#') {
            e.preventDefault();
            closeSiteNav();
            return;
        }
        if (href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') || link.target === '_blank' || href.endsWith('.pdf')) {
            closeSiteNav();
            return;
        }

        closeSiteNav();

        const normalizedHref = normalizeInternalPath(href);
        const currentPath = normalizeInternalPath(window.location.pathname);
        if (normalizedHref === currentPath) {
            if (!href.includes('#')) e.preventDefault();
            return;
        }
        if (isTransitionPage(normalizedHref)) {
            e.preventDefault();
            navigateTo(href);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('site-nav-open')) {
            closeSiteNav({ restoreFocus: true });
        }
    });

    window.addEventListener('popstate', async () => {
        const path = normalizeInternalPath(window.location.pathname);
        // Hash-only changes (in-page links such as "See how it flows", or
        // back/forward between hashes on the same page) also fire popstate.
        // The page is already rendered, so leave the browser's native hash
        // scroll (and the target's scroll-margin) to do the work instead of
        // re-fetching and re-swapping <main>, which would reset its state.
        if (path === navigateTo.renderedPath) return;
        if (isTransitionPage(path)) {
            await navigateTo(path + window.location.hash, { updateHistory: false });
            return;
        }
        window.location.reload();
    });
});
