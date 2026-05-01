/* ─────────────────────────────────────────────────────────────
 * pipeline-scroll.js — scroll-driven activation of pipeline phases.
 *
 * Each .phase[data-phase] inside [data-pipeline] becomes data-active="true"
 * when it enters the viewport. CSS handles the visual lighting-up and the
 * connector data-dot animation.
 *
 * Idempotent: re-runs cleanly after page transitions via the global
 * window.initializePipeline().
 *
 * Honors prefers-reduced-motion by activating all phases immediately
 * instead of staggering them on scroll.
 * ───────────────────────────────────────────────────────────── */

(function () {
    let observer = null;

    function activateAll(phases) {
        phases.forEach((p) => p.setAttribute('data-active', 'true'));
    }

    function teardown() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    }

    function initialize() {
        teardown();

        const root = document.querySelector('[data-pipeline]');
        if (!root) return;

        const phases = Array.from(root.querySelectorAll('.phase'));
        if (!phases.length) return;

        // Reset state
        phases.forEach((p) => p.removeAttribute('data-active'));

        // Reduced motion: just light them all up at once
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            activateAll(phases);
            return;
        }

        // IntersectionObserver fallback: if not supported, activate all
        if (!('IntersectionObserver' in window)) {
            activateAll(phases);
            return;
        }

        observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.setAttribute('data-active', 'true');
                }
            });
        }, {
            threshold: 0.4,
            rootMargin: '-10% 0px -10% 0px',
        });

        phases.forEach((phase) => observer.observe(phase));
    }

    window.initializePipeline = initialize;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
