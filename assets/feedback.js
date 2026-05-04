(function () {
    /* ── Supabase ──────────────────────────────────────────────── */
    const SUPABASE_URL = 'https://nxyitzzdnzfbdvkfbgcs.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_aOBNA_g5uQvnqygPsaYxqA_MxraaT0S';
    // Lazy-init: only create the client when the form is first submitted.
    // This prevents a CDN failure from crashing the chip UI.
    let _db = null;
    function getDb() {
        if (!_db) {
            if (typeof supabase === 'undefined') throw new Error('Supabase SDK not loaded');
            _db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        }
        return _db;
    }

    /* ── Chip follow-up copy ────────────────────────────────────── */
    const FOLLOWUPS = {
        hire:     "Awesome — drop your role + the most-relevant capability and I'll prioritize replying.",
        learn:    "Tell me which project and I'll send a writeup or jump on a call.",
        critique: "Be brutal. Free-text below — I read every one.",
        'say-hi': "Sweet. Takes 30 seconds. Or just chat with Crowbot.",
        other:    "Tell me anything — form below."
    };

    /* ── Init ───────────────────────────────────────────────────── */
    function initialize() {
        const root     = document.querySelector('[data-feedback]');
        if (!root) return;
        const chips    = Array.from(root.querySelectorAll('[data-feedback-pick]'));
        const reveal   = root.querySelector('.feedback-reveal');
        const followup = root.querySelector('#feedback-followup');
        const reasonEl = document.getElementById('fb-reason');

        chips.forEach((chip) => {
            chip.addEventListener('click', () => {
                chips.forEach(c => c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'));
                reveal.setAttribute('data-revealed', 'true');
                const key = chip.getAttribute('data-feedback-pick');
                if (followup) followup.textContent = FOLLOWUPS[key] || '';
                if (reasonEl) reasonEl.value = key;
            });
        });

        /* ── Form submit ────────────────────────────────────────── */
        const form      = document.getElementById('feedback-form');
        const statusEl  = document.getElementById('fb-status');
        const submitBtn = document.getElementById('fb-submit');

        function setStatus(state, msg) {
            statusEl.setAttribute('data-state', state);
            statusEl.textContent = msg;
        }
        function clearStatus() {
            statusEl.removeAttribute('data-state');
            statusEl.textContent = '';
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearStatus();

            const message = document.getElementById('fb-message').value.trim();
            if (!message) {
                setStatus('error', 'Please enter a message before sending.');
                document.getElementById('fb-message').focus();
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending…';

            const payload = {
                reason:  document.getElementById('fb-reason').value  || null,
                name:    document.getElementById('fb-name').value.trim()  || null,
                email:   document.getElementById('fb-email').value.trim() || null,
                message: message,
            };

            try {
                const { error } = await getDb().from('feedback').insert(payload);
                if (error) throw error;

                setStatus('success', "Thanks — message received! I'll reply if you left an email.");
                form.reset();
                if (reasonEl) reasonEl.value = chips.find(c => c.getAttribute('aria-pressed') === 'true')?.getAttribute('data-feedback-pick') || '';
            } catch (err) {
                console.error('[Feedback]', err);
                setStatus('error', 'Something went wrong. Please try again or reach out on LinkedIn.');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Send feedback <span aria-hidden="true">→</span>';
            }
        });
    }

    window.initializeFeedbackChips = initialize;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
