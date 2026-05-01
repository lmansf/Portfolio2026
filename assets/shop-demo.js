/* ─────────────────────────────────────────────────────────────
 * shop-demo.js — self-contained play demo for the retired shop.
 *
 * No backend. Products are hardcoded. Add-to-cart updates a local
 * cart object only. Checkout button shows a "demo only" message
 * instead of submitting.
 *
 * Re-runnable via window.initializeShopDemo() so it survives page
 * transitions (back/forward) without the live shop.js wiring.
 * ───────────────────────────────────────────────────────────── */

(function () {
    const PRODUCTS = [
        { id: 'std',     name: 'Standard Admission',   price: 24.00, category: 'Admission',     desc: 'General entry, all-day access to the park.' },
        { id: 'fam',     name: 'Family Bundle (4)',    price: 78.00, category: 'Admission',     desc: 'Four admissions at a discounted bundle rate.' },
        { id: 'eve',     name: 'Evening Pass',         price: 14.00, category: 'Admission',     desc: 'Discounted entry after 4pm — quieter crowds.' },
        { id: 'stu',     name: 'Student Pass',         price: 18.00, category: 'Admission',     desc: 'With valid student ID. Same access as Standard.' },
        { id: 'park',    name: 'Parking',              price: 8.00,  category: 'Add-ons',       desc: 'On-site parking, in/out privileges all day.' },
        { id: 'snack',   name: 'Concessions Voucher',  price: 12.00, category: 'Add-ons',       desc: 'Redeem for any combo at the food stands.' },
        { id: 'corn',    name: 'Corn Dog',             price: 5.50,  category: 'Concessions',   desc: 'Owl Park classic. Single hand-dipped.' },
        { id: 'ride',    name: 'All-Day Ride Pass',    price: 22.00, category: 'Add-ons',       desc: 'Unlimited ride access. Pairs with any admission.' }
    ];

    const TAX_RATE = 0.07;
    const SERVICE_FEE = 1.50;

    let cart = [];

    function fmt(n) {
        return '$' + n.toFixed(2);
    }

    function renderProducts() {
        const grid = document.getElementById('shop-product-grid');
        if (!grid) return;
        grid.innerHTML = '';
        PRODUCTS.forEach((p) => {
            const card = document.createElement('article');
            card.className = 'shop-product-card';
            card.innerHTML = `
                <div class="shop-product-card__head">
                    <span class="shop-product-card__category">${p.category}</span>
                    <span class="shop-product-card__price">${fmt(p.price)}</span>
                </div>
                <h3 class="shop-product-card__name">${p.name}</h3>
                <p class="shop-product-card__desc">${p.desc}</p>
                <button class="shop-product-card__add" type="button" data-add="${p.id}">Add to cart</button>
            `;
            grid.appendChild(card);
        });
    }

    function findProduct(id) {
        return PRODUCTS.find((p) => p.id === id);
    }

    function addToCart(id) {
        const product = findProduct(id);
        if (!product) return;
        const existing = cart.find((c) => c.id === id);
        if (existing) existing.qty += 1;
        else cart.push({ id, qty: 1 });
        renderCart();
    }

    function removeFromCart(id) {
        cart = cart.filter((c) => c.id !== id);
        renderCart();
    }

    function changeQty(id, delta) {
        const item = cart.find((c) => c.id === id);
        if (!item) return;
        item.qty = Math.max(1, item.qty + delta);
        renderCart();
    }

    function totals() {
        const subtotal = cart.reduce((sum, c) => {
            const p = findProduct(c.id);
            return p ? sum + p.price * c.qty : sum;
        }, 0);
        const tax = subtotal * TAX_RATE;
        const fee = subtotal > 0 ? SERVICE_FEE : 0;
        return { subtotal, tax, fee, total: subtotal + tax + fee };
    }

    function renderCart() {
        const itemsEl = document.getElementById('shop-cart-items');
        if (itemsEl) {
            if (cart.length === 0) {
                itemsEl.innerHTML = '<p class="shop-cart-empty">Your cart is empty.</p>';
            } else {
                itemsEl.innerHTML = '';
                cart.forEach((c) => {
                    const p = findProduct(c.id);
                    if (!p) return;
                    const row = document.createElement('div');
                    row.className = 'shop-cart-row';
                    row.innerHTML = `
                        <div class="shop-cart-row__main">
                            <span class="shop-cart-row__name">${p.name}</span>
                            <span class="shop-cart-row__price">${fmt(p.price * c.qty)}</span>
                        </div>
                        <div class="shop-cart-row__controls">
                            <button type="button" data-qty="${p.id}" data-delta="-1" aria-label="Decrease ${p.name} quantity">−</button>
                            <span aria-live="polite">${c.qty}</span>
                            <button type="button" data-qty="${p.id}" data-delta="1" aria-label="Increase ${p.name} quantity">+</button>
                            <button type="button" data-remove="${p.id}" class="shop-cart-row__remove" aria-label="Remove ${p.name}">Remove</button>
                        </div>
                    `;
                    itemsEl.appendChild(row);
                });
            }
        }

        const t = totals();
        setText('shop-subtotal', fmt(t.subtotal));
        setText('shop-tax', fmt(t.tax));
        setText('shop-service-fee', fmt(t.fee));
        setText('shop-total', fmt(t.total));

        // Update floating cart count
        const fab = document.querySelector('[data-cart-fab]');
        if (fab) {
            const count = cart.reduce((s, c) => s + c.qty, 0);
            fab.hidden = count === 0;
            const countEl = fab.querySelector('.count');
            if (countEl) countEl.textContent = String(count);
        }

        // Enable place-order button if cart has items
        const placeBtn = document.getElementById('shop-place-order');
        if (placeBtn) placeBtn.disabled = cart.length === 0;
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function bindHandlers() {
        // Use delegated handlers — survives DOM rerenders
        document.addEventListener('click', (e) => {
            const addBtn = e.target.closest('[data-add]');
            if (addBtn) { e.preventDefault(); addToCart(addBtn.getAttribute('data-add')); return; }

            const removeBtn = e.target.closest('[data-remove]');
            if (removeBtn) { e.preventDefault(); removeFromCart(removeBtn.getAttribute('data-remove')); return; }

            const qtyBtn = e.target.closest('[data-qty]');
            if (qtyBtn) {
                e.preventDefault();
                changeQty(qtyBtn.getAttribute('data-qty'), parseInt(qtyBtn.getAttribute('data-delta'), 10) || 0);
                return;
            }

            // Cart FAB → open cart sheet
            const fabOpen = e.target.closest('[data-cart-fab]');
            if (fabOpen) {
                e.preventDefault();
                openCartSheet();
                return;
            }

            // Cart sheet close
            const close = e.target.closest('[data-cart-close]');
            if (close) { e.preventDefault(); closeCartSheet(); return; }

            const backdrop = e.target.closest('.cart-sheet__backdrop');
            if (backdrop) { closeCartSheet(); return; }
        });

        // Place-order is demo-only — show a message instead of submitting.
        const form = document.getElementById('shop-checkout-form');
        if (form && !form.dataset.demoBound) {
            form.dataset.demoBound = '1';
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const msg = document.getElementById('shop-form-message');
                if (msg) {
                    msg.textContent = 'Demo only — checkout is not connected. The live store has been retired.';
                    msg.style.color = 'var(--accent)';
                }
            });
        }
    }

    function openCartSheet() {
        const sheet = document.getElementById('shop-cart-sheet');
        if (!sheet) return;
        sheet.classList.add('is-open');
        sheet.setAttribute('aria-hidden', 'false');
    }

    function closeCartSheet() {
        const sheet = document.getElementById('shop-cart-sheet');
        if (!sheet) return;
        sheet.classList.remove('is-open');
        sheet.setAttribute('aria-hidden', 'true');
    }

    function initialize() {
        // Reset state
        cart = [];
        renderProducts();
        renderCart();
        bindHandlers();
    }

    window.initializeShopDemo = initialize;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
