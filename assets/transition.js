/* ─────────────────────────────────────────────────────────────
 * transition.js — page transitions + shared interactions.
 *
 * 2026 overhaul:
 * - Removed: snake easter egg, blog unlock state, blog hover popup.
 * - Updated: pages allowlist (work.html / pipeline.html, no blog).
 * - Kept:    page-swap logic, modal handling, mobile nav, shop prefetch.
 * - Added:   shell hooks (tab-bar active state, Crowbot FAB toggle).
 *
 * View Transitions API integration is planned for Phase 5; for now this
 * keeps the existing custom JS swap so the new shell can be wired in
 * without changing the transition mechanism.
 * ───────────────────────────────────────────────────────────── */

function syncBodyElement(currentSelector, incomingDoc) {
    const currentElement = document.querySelector(currentSelector);
    const incomingElement = incomingDoc.querySelector(currentSelector);

    if (incomingElement) {
        if (currentElement) {
            currentElement.outerHTML = incomingElement.outerHTML;
        } else {
            document.body.insertBefore(incomingElement, document.querySelector('script'));
        }
    } else if (currentElement) {
        currentElement.remove();
    }
}

function animateProjectsLoadIn() {
    const main = document.querySelector('main.projects-view');
    if (!main) return;

    const animationTargets = [
        document.querySelector('.bg-layer'),
        main.querySelector('.projects-intro'),
        main.querySelector('.projects-layout'),
        document.querySelector('footer .footer-socials')
    ].filter(Boolean);

    animationTargets.forEach((element) => {
        element.classList.remove('projects-load-enter');
        void element.offsetWidth;
        element.classList.add('projects-load-enter');
    });

    setTimeout(() => {
        animationTargets.forEach((element) => {
            element.classList.remove('projects-load-enter');
        });
    }, 500);
}

function normalizeInternalPath(url) {
    const cleanedUrl = (url || '').split('#')[0].split('?')[0];
    if (!cleanedUrl || cleanedUrl === '/' || cleanedUrl === './') return 'index.html';
    return (cleanedUrl.split('/').pop() || 'index.html').toLowerCase();
}

function isTransitionPage(path) {
    return ['index.html', 'work.html', 'pipeline.html', 'shop.html', 'resume.html', 'feedback.html'].includes(path);
}

function isAtsResumeLink(link) {
    if (!link) return false;
    const href = (link.getAttribute('href') || '').toLowerCase();
    return href.endsWith('assets/resume_ats.txt') || href.endsWith('/assets/resume_ats.txt');
}

function getManagedStylesheet(doc) {
    return Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).find((link) => {
        const href = (link.getAttribute('href') || '').toLowerCase();
        return href.includes('assets/index.css') || href.includes('assets/style.css');
    }) || null;
}

function getPageScriptDescriptors(doc) {
    return Array.from(doc.querySelectorAll('script[src]'))
        .map((script) => ({
            src: script.getAttribute('src'),
            type: script.getAttribute('type') || 'text/javascript'
        }))
        .filter((script) => {
            if (!script.src) return false;
            const normalizedSrc = script.src.toLowerCase();
            if (normalizedSrc.includes('/_vercel/insights/script.js')) return false;
            if (normalizedSrc.endsWith('assets/transition.js')) return false;
            return true;
        });
}

async function syncPageScripts(incomingDoc) {
    const scripts = getPageScriptDescriptors(incomingDoc);
    for (const { src, type } of scripts) {
        if (document.querySelector(`script[src="${src}"]`)) continue;

        const scriptElement = document.createElement('script');
        scriptElement.src = src;
        if (type && type !== 'text/javascript') {
            scriptElement.type = type;
        }
        scriptElement.defer = true;

        await new Promise((resolve) => {
            scriptElement.addEventListener('load', resolve, { once: true });
            scriptElement.addEventListener('error', resolve, { once: true });
            document.body.appendChild(scriptElement);
        });
    }
}

async function syncManagedStylesheet(incomingDoc) {
    const incomingStylesheet = getManagedStylesheet(incomingDoc);
    if (!incomingStylesheet) return;

    const incomingHref = incomingStylesheet.getAttribute('href');
    const currentStylesheet = getManagedStylesheet(document);

    if (!incomingHref) return;

    if (currentStylesheet) {
        const currentHref = currentStylesheet.getAttribute('href');
        if (currentHref === incomingHref) return;

        await new Promise((resolve) => {
            currentStylesheet.addEventListener('load', resolve, { once: true });
            currentStylesheet.addEventListener('error', resolve, { once: true });
            currentStylesheet.setAttribute('href', incomingHref);
        });
        return;
    }

    const newStylesheet = incomingStylesheet.cloneNode(true);
    await new Promise((resolve) => {
        newStylesheet.addEventListener('load', resolve, { once: true });
        newStylesheet.addEventListener('error', resolve, { once: true });
        document.head.appendChild(newStylesheet);
    });
}

async function getIncomingDocumentForNavigation(url, normalizedTarget) {
    const response = await fetch(url);
    const html = await response.text();
    return new DOMParser().parseFromString(html, 'text/html');
}

async function navigateTo(url, options = {}) {
    if (navigateTo.isNavigating) return;
    navigateTo.isNavigating = true;

    const { updateHistory = true } = options;
    const main = document.querySelector('main');
    const normalizedTarget = normalizeInternalPath(url);
    const isProjectsDestination = normalizedTarget === 'work.html';

    try {
        // 1. Fetch the new page in parallel with any exit animation
        const docPromise = getIncomingDocumentForNavigation(url, normalizedTarget);
        const doc = await docPromise;

        await syncManagedStylesheet(doc);
        await syncPageScripts(doc);

        // 2. Define the swap. View Transitions API runs this inside a snapshot.
        async function doSwap() {
            const newMain = doc.querySelector('main');
            const newTitle = doc.querySelector('title').innerText;
            const newHeader = doc.querySelector('header');

            if (main && newMain) {
                main.innerHTML = newMain.innerHTML;
                main.className = newMain.className;
            }

            syncBodyElement('.bg-layer', doc);

            if (newHeader) {
                const header = document.querySelector('header');
                if (header) header.innerHTML = newHeader.innerHTML;
                closeMobileNav();
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

            // Bottom tab bar (sync if present)
            syncBodyElement('.tabbar', doc);
            // Explicitly activate the correct tab based on the navigation target.
            // This is more reliable than the incoming HTML's hardcoded is-active because
            // history.pushState hasn't run yet, so window.location.pathname is still old.
            document.querySelectorAll('.tabbar__item[data-route]').forEach((item) => {
                const route = item.getAttribute('data-route');
                if (route === normalizedTarget) {
                    item.classList.add('is-active');
                    item.setAttribute('aria-current', 'page');
                } else {
                    item.classList.remove('is-active');
                    item.removeAttribute('aria-current');
                }
            });
            positionTabIndicator(true);

            // Modal/overlay containers outside <main>
            syncBodyElement('.project-modal-overlay', doc);
            activeProjectModal = null;

            document.title = newTitle;

            if (updateHistory) {
                history.pushState({}, newTitle, url);
            }

            // Reset scroll
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        }

        // 3. Run the swap with View Transitions when supported.
        const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduceMotion && typeof document.startViewTransition === 'function') {
            const vt = document.startViewTransition(() => doSwap());
            try { await vt.finished; } catch { /* ignore — user may have navigated again */ }
        } else {
            // Legacy fade fallback
            const exitTargets = [main, document.querySelector('.bg-layer')].filter(Boolean);
            exitTargets.forEach((el) => el.classList.add('page-exit'));
            await new Promise((resolve) => setTimeout(resolve, reduceMotion ? 0 : 300));
            await doSwap();
            const enterTargets = [document.querySelector('main'), document.querySelector('.bg-layer')].filter(Boolean);
            enterTargets.forEach((el) => {
                el.classList.remove('page-exit');
                el.classList.add('page-enter');
            });
            setTimeout(() => {
                enterTargets.forEach((el) => el.classList.remove('page-enter'));
            }, reduceMotion ? 0 : 300);
        }

        // 4. Re-initialize page-specific scripts
        if (normalizedTarget === 'shop.html' && window.initializeShopDemo) {
            window.initializeShopDemo();
        }
        if (normalizedTarget === 'index.html' && window.initializeNowCard) {
            window.initializeNowCard();
        }
        if (normalizedTarget === 'pipeline.html' && window.initializePipeline) {
            window.initializePipeline();
        }
        if (normalizedTarget === 'resume.html' && window.initializeSkillBars) {
            window.initializeSkillBars();
        }
        if (normalizedTarget === 'feedback.html' && window.initializeFeedbackChips) {
            window.initializeFeedbackChips();
        }

        // Re-wire shell behavior on the new document
        wireShopPrefetchInteractions();
        scheduleShopProductsPrefetch();
        wireUpnextPrefetch();
        updateTabBarActiveState(false);

        if (isProjectsDestination) {
            animateProjectsLoadIn();
        }

    } catch (err) {
        console.error('Navigation failed:', err);
        window.location.href = url;
    } finally {
        navigateTo.isNavigating = false;
    }
}

/* ─── Up-next prefetch: prefetch each Up-next card's HTML when it enters viewport ─── */
let upnextPrefetched = new Set();
let upnextObserver = null;

function prefetchUrl(url) {
    if (!url) return;
    const norm = normalizeInternalPath(url);
    if (upnextPrefetched.has(norm)) return;
    upnextPrefetched.add(norm);
    fetch(url, { method: 'GET' }).catch(() => {});
}

function wireUpnextPrefetch() {
    if (upnextObserver) {
        upnextObserver.disconnect();
        upnextObserver = null;
    }
    if (!('IntersectionObserver' in window)) return;
    const cards = Array.from(document.querySelectorAll('.upnext__card[href]'));
    if (!cards.length) return;
    upnextObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const href = entry.target.getAttribute('href') || '';
                if (href && !href.startsWith('http') && !href.startsWith('#')) {
                    prefetchUrl(href);
                }
                upnextObserver.unobserve(entry.target);
            }
        });
    }, { rootMargin: '200px 0px' });
    cards.forEach((card) => upnextObserver.observe(card));
}

let activeProjectModal = null;

function openProjectModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    activeProjectModal = modal;
}

function closeProjectModal(modal) {
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    if (activeProjectModal === modal) {
        activeProjectModal = null;
    }
}

/* ─── Shop prefetch (retired with the live shop) — kept as no-ops so existing call sites still work ─── */
function scheduleShopProductsPrefetch() { /* no-op */ }
function wireShopPrefetchInteractions() { /* no-op */ }
/* ─── Mobile nav (legacy hamburger drawer — Phase 4 will replace) ─── */
function setMobileNavExpanded(isExpanded) {
    const navToggle = document.querySelector('[data-nav-toggle]');
    if (!navToggle) return;
    navToggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
}

function closeMobileNav() {
    document.body.classList.remove('mobile-nav-open');
    setMobileNavExpanded(false);
}

function toggleMobileNav() {
    const shouldOpen = !document.body.classList.contains('mobile-nav-open');
    document.body.classList.toggle('mobile-nav-open', shouldOpen);
    setMobileNavExpanded(shouldOpen);
}

/* ─── New shell behavior: bottom tab bar active state + Crowbot FAB sheet ─── */

function positionTabIndicator(instant) {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) instant = true;

    const tabbar = document.querySelector('.tabbar');
    if (!tabbar) return;
    const indicator = tabbar.querySelector('.tabbar__indicator');
    if (!indicator) return;
    const activeItem = tabbar.querySelector('.tabbar__item.is-active');
    if (!activeItem) {
        indicator.style.opacity = '0';
        return;
    }

    const tabbarRect = tabbar.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    const isDesktop = window.innerWidth >= 768;

    function applyPosition() {
        indicator.style.left = `${itemRect.left - tabbarRect.left}px`;
        indicator.style.width = `${itemRect.width}px`;
        indicator.style.opacity = '1';
        if (isDesktop) {
            indicator.style.top = `${itemRect.top - tabbarRect.top}px`;
            indicator.style.height = `${itemRect.height}px`;
        } else {
            indicator.style.top = '0';
            indicator.style.height = '2px';
        }
    }

    if (instant) {
        indicator.style.transition = 'none';
        applyPosition();
        requestAnimationFrame(() => requestAnimationFrame(() => {
            indicator.style.transition = '';
        }));
    } else {
        applyPosition();
    }
}

function updateTabBarActiveState(instant = false) {
    const current = normalizeInternalPath(window.location.pathname);
    document.querySelectorAll('.tabbar__item[data-route]').forEach((item) => {
        const route = item.getAttribute('data-route');
        if (route === current) {
            item.classList.add('is-active');
            item.setAttribute('aria-current', 'page');
        } else {
            item.classList.remove('is-active');
            item.removeAttribute('aria-current');
        }
    });
    positionTabIndicator(instant);
}

const GRADIO_SCRIPT_SRC = 'https://gradio.s3-us-west-2.amazonaws.com/5.49.1/gradio.js';
const GRADIO_APP_SRC = 'https://lmansf96-portfolio-conversation.hf.space';
let crowbotInitialized = false;

function lazyMountCrowbot() {
    if (crowbotInitialized) return;
    crowbotInitialized = true;

    // 1. Inject the Gradio script if not already loaded.
    if (!document.querySelector(`script[src="${GRADIO_SCRIPT_SRC}"]`)) {
        const s = document.createElement('script');
        s.type = 'module';
        s.src = GRADIO_SCRIPT_SRC;
        document.head.appendChild(s);
    }

    // 2. Mount a <gradio-app> inside the sheet body if not already there.
    const body = document.querySelector('#crowbot-sheet .crowbot-sheet__body');
    if (body && !body.querySelector('gradio-app')) {
        const app = document.createElement('gradio-app');
        app.setAttribute('src', GRADIO_APP_SRC);
        body.appendChild(app);
    }
}

function openCrowbotSheet() {
    const sheet = document.getElementById('crowbot-sheet');
    if (!sheet) return;
    crowbotPriorFocus = document.activeElement;
    lazyMountCrowbot();
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('crowbot-sheet-open');
    const fab = document.querySelector('[data-crowbot-fab]');
    if (fab) fab.setAttribute('aria-expanded', 'true');
    // Move keyboard focus into the sheet for screen-reader users
    setTimeout(() => {
        const closeBtn = sheet.querySelector('[data-crowbot-close].crowbot-sheet__close');
        if (closeBtn) closeBtn.focus();
    }, 80);
}

let crowbotPriorFocus = null;

function closeCrowbotSheet() {
    const sheet = document.getElementById('crowbot-sheet');
    if (!sheet) return;
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('crowbot-sheet-open');
    const fab = document.querySelector('[data-crowbot-fab]');
    if (fab) fab.setAttribute('aria-expanded', 'false');
    // Restore focus to whatever opened the sheet (typically the FAB)
    if (crowbotPriorFocus && typeof crowbotPriorFocus.focus === 'function') {
        crowbotPriorFocus.focus();
    }
    crowbotPriorFocus = null;
}

function toggleCrowbotSheet() {
    const sheet = document.getElementById('crowbot-sheet');
    if (!sheet) return;
    sheet.classList.contains('is-open') ? closeCrowbotSheet() : openCrowbotSheet();
}

document.addEventListener('DOMContentLoaded', () => {
    if (window.location.protocol === 'file:') {
        console.warn('Page transitions require a local server (e.g. Live Server) due to CORS restrictions on file:// protocol.');
    }

    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    if (currentPath === 'work.html') {
        animateProjectsLoadIn();
    }

    const initialTargets = [document.querySelector('main'), document.querySelector('.bg-layer')].filter(Boolean);
    initialTargets.forEach((element) => element.classList.add('page-initial-state'));
    requestAnimationFrame(() => {
        initialTargets.forEach((element) => {
            element.classList.add('page-initial-enter');
            element.classList.remove('page-initial-state');
        });
        setTimeout(() => {
            initialTargets.forEach((element) => element.classList.remove('page-initial-enter'));
        }, 500);
    });

    closeMobileNav();
    wireShopPrefetchInteractions();
    scheduleShopProductsPrefetch();
    updateTabBarActiveState(true);
    wireUpnextPrefetch();

    let _resizeTimer;
    window.addEventListener('resize', () => {
        if (window.innerWidth > 900) closeMobileNav();
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => positionTabIndicator(true), 120);
    });

    document.body.addEventListener('click', (e) => {
        // Immediate visual feedback when a tab bar item is clicked
        const clickedTab = e.target.closest('.tabbar__item[data-route]');
        if (clickedTab) {
            document.querySelectorAll('.tabbar__item[data-route]').forEach((item) => {
                if (item === clickedTab) {
                    item.classList.add('is-active');
                    item.setAttribute('aria-current', 'page');
                } else {
                    item.classList.remove('is-active');
                    item.removeAttribute('aria-current');
                }
            });
            positionTabIndicator(false);
        }

        // Hamburger (legacy)
        const navToggle = e.target.closest('[data-nav-toggle]');
        if (navToggle) {
            e.preventDefault();
            toggleMobileNav();
            return;
        }

        if (document.body.classList.contains('mobile-nav-open') && !e.target.closest('header')) {
            closeMobileNav();
        }

        // Crowbot FAB
        const fab = e.target.closest('[data-crowbot-fab]');
        if (fab) {
            e.preventDefault();
            toggleCrowbotSheet();
            return;
        }

        // Crowbot sheet close
        const fabClose = e.target.closest('[data-crowbot-close]');
        if (fabClose) {
            e.preventDefault();
            closeCrowbotSheet();
            return;
        }

        // Crowbot sheet backdrop
        const sheetBackdrop = e.target.closest('.crowbot-sheet__backdrop');
        if (sheetBackdrop) {
            closeCrowbotSheet();
            return;
        }

        // Project modal triggers
        const modalTrigger = e.target.closest('[data-project-modal-open]');
        if (modalTrigger) {
            e.preventDefault();
            openProjectModal(modalTrigger.getAttribute('data-project-modal-open'));
            return;
        }

        const modalClose = e.target.closest('[data-project-modal-close]');
        if (modalClose) {
            closeProjectModal(modalClose.closest('.project-modal-overlay'));
            return;
        }

        const modalBackdrop = e.target.closest('.project-modal-overlay');
        if (modalBackdrop && e.target === modalBackdrop) {
            closeProjectModal(modalBackdrop);
            return;
        }

        // Internal nav link handling
        const link = e.target.closest('a');
        if (!link) return;

        if (isAtsResumeLink(link)) {
            const shouldLeave = window.confirm('You are leaving the portfolio site to open the ATS Resume. Select OK to continue or Cancel to stay on the portfolio.');
            if (!shouldLeave) e.preventDefault();
            closeMobileNav();
            return;
        }

        const href = link.getAttribute('href');
        if (!href) return;

        const normalizedHref = normalizeInternalPath(href);
        const currentPath = normalizeInternalPath(window.location.pathname);

        if (href === '#') {
            e.preventDefault();
            closeMobileNav();
            return;
        }

        if (href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') || link.target === '_blank' || href.endsWith('.pdf')) return;

        closeMobileNav();

        if (normalizedHref === 'index.html' && currentPath !== 'index.html') {
            e.preventDefault();
            window.location.href = 'index.html';
            return;
        }

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
        if (e.key === 'Escape') {
            if (document.body.classList.contains('mobile-nav-open')) closeMobileNav();
            if (document.body.classList.contains('crowbot-sheet-open')) closeCrowbotSheet();
            if (activeProjectModal) closeProjectModal(activeProjectModal);
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
