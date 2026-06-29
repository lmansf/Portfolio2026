/* ─────────────────────────────────────────────────────────────
 * transition.js — page transitions + nav for the 2-page site.
 *
 * Scope: Home + Projects. Handles the SPA-style page swap (with the
 * View Transitions API where supported), the burger / site-nav dropdown,
 * scroll + focus reset on navigation, and back/forward (popstate).
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

            if (updateHistory) {
                history.pushState({}, newTitle, url);
            }

            // Reset scroll, then move focus to the top of the new content for
            // keyboard / screen-reader users.
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
            const focusTarget = document.getElementById('main-content') || main;
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
    if (burger) burger.setAttribute('aria-expanded', 'true');
    const firstLink = nav.querySelector('.site-nav__item');
    if (firstLink) setTimeout(() => firstLink.focus(), 50);
}

function closeSiteNav() {
    const nav = getSiteNav();
    if (!nav) return;
    document.body.classList.remove('site-nav-open');
    nav.setAttribute('aria-hidden', 'true');
    const burger = document.querySelector('[data-burger]');
    if (burger) burger.setAttribute('aria-expanded', 'false');
}

function toggleSiteNav() {
    document.body.classList.contains('site-nav-open') ? closeSiteNav() : openSiteNav();
}

document.addEventListener('DOMContentLoaded', () => {
    if (window.location.protocol === 'file:') {
        console.warn('Page transitions require a local server (CORS restrictions on file://).');
    }

    // Initial page fade-in
    const main = document.querySelector('main');
    if (main) {
        main.classList.add('page-initial-state');
        requestAnimationFrame(() => {
            main.classList.add('page-initial-enter');
            main.classList.remove('page-initial-state');
            setTimeout(() => main.classList.remove('page-initial-enter'), 500);
        });
    }

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
            closeSiteNav();
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
            return;
        }

        closeSiteNav();

        const normalizedHref = normalizeInternalPath(href);
        const currentPath = normalizeInternalPath(window.location.pathname);
        if (normalizedHref === currentPath) {
            e.preventDefault();
            return;
        }
        if (isTransitionPage(normalizedHref)) {
            e.preventDefault();
            navigateTo(href);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('site-nav-open')) {
            closeSiteNav();
        }
    });

    window.addEventListener('popstate', async () => {
        const path = normalizeInternalPath(window.location.pathname);
        if (isTransitionPage(path)) {
            await navigateTo(path, { updateHistory: false });
            return;
        }
        window.location.reload();
    });
});
