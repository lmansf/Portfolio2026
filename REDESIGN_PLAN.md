# Portfolio 2026 — Redesign Plan

**Direction (locked):** Refined minimalism+ · Data-forward palette · Mobile-first IA · Plan + visual mockup.

This document is the contract for the overhaul. It takes the site from a warm-gold, desktop-first, JS-driven multi-page setup to a mobile-first, data-forward design with cinematic moments per page and continuous flow between them.

---

## 1. Why this overhaul

The current site is solid and personal but suffers from three things that work against a 2026 portfolio for an analytics engineer:

1. **Pages feel similar to land on.** Each page repeats the same header → intro panel → content slab pattern. There's no "wow, what's this" moment when you arrive.
2. **Pages don't connect.** Once you land on Projects, nothing pulls you toward Data Engineering. Once you finish Data Engineering, nothing pulls you toward Shop. Each page is a dead end.
3. **The aesthetic reads "warm portfolio" rather than "data engineer."** The gold-on-charcoal is distinctive but doesn't visually say "I work with pipelines, dashboards, and live data."

The overhaul keeps everything that's load-bearing (Crowbot, the Owl Park architecture story, the working mock shop, the resume PDF, the n8n feedback form) and rebuilds the surface around them.

---

## 2. Design language

### 2.1 Tokens — `--*` CSS custom properties

These replace the existing token set in `index.css` / `style.css`. One consolidated `tokens.css` will be imported by all pages.

```
/* Surfaces */
--bg              #0a0e14    near-black, slight blue cast
--surface-1       #11161e    cards / panels
--surface-2       #1a212d    elevated cards, modals
--surface-3       #232c3b    hover state for elevated

/* Ink */
--ink-1           #f5f7fa    primary text
--ink-2           #9aa6b8    secondary text, captions
--ink-3           #5a6679    disabled / very subtle

/* Accents */
--accent          #6ee7ff    electric cyan — primary data accent
--accent-2        #ffb86b    warm amber — callback to old palette, used sparingly for CTAs
--accent-glow     rgba(110, 231, 255, 0.18)   for soft glow halos
--success         #6ee9a6
--danger          #ff7a8a

/* Lines */
--hairline        rgba(245, 247, 250, 0.08)
--hairline-strong rgba(245, 247, 250, 0.16)
--focus-ring      #6ee7ff

/* Type */
--font-display    "Geist", "Inter Display", "Inter", system-ui, sans-serif
--font-text       "Inter", system-ui, sans-serif
--font-mono       "Geist Mono", "JetBrains Mono", ui-monospace, monospace

/* Radii */
--r-sm  6px
--r-md  10px
--r-lg  16px
--r-xl  24px

/* Motion */
--ease-out        cubic-bezier(0.16, 1, 0.3, 1)
--ease-in-out     cubic-bezier(0.65, 0, 0.35, 1)
--dur-fast        140ms
--dur-base        260ms
--dur-slow        520ms
```

Only the tokens above ship — no hardcoded hex values anywhere in page CSS.

### 2.2 Typography scale

A single fluid scale used everywhere. Mobile values listed first; desktop is the upper end of `clamp()`.

```
display-xl  clamp(2.5rem, 7vw, 4.5rem)   tight tracking, font-display
display-lg  clamp(2rem,  5vw, 3.25rem)
h1          clamp(1.6rem, 3.6vw, 2.25rem)
h2          clamp(1.25rem, 2.6vw, 1.5rem)
h3          1.05rem
body        1rem (16px) line-height 1.6
small       0.875rem
caption     0.78rem  letter-spacing 0.04em uppercase, font-mono
```

The display weight is variable (400 → 700) so heroes can be ultra-tight 700-weight while body stays a comfortable 400.

### 2.3 The data-forward "feel"

Three small, repeatable moves do the heavy lifting:

- **Hairline overlays.** Every section uses 1px `--hairline` borders or single dividers — not boxes. It reads schematic, like a spec sheet.
- **Mono numerals everywhere.** Stats, dates, prices, version numbers, the live clock — all `font-mono` with `tabular-nums`. Instantly says "data."
- **Cyan glow as accent, not as decoration.** Cyan only appears on (a) interactive states, (b) one cinematic accent per page (the hero glow), and (c) live-data indicators. Restraint is the brand.

The current heavy crosshatch background goes. It's replaced with a much subtler animated gradient mesh fixed behind the page (one element, GPU-cheap, respects `prefers-reduced-motion`).

---

## 3. Information architecture

### 3.1 Pages (after overhaul)

| Slug              | Page              | Purpose                                              | Status        |
| ----------------- | ----------------- | ---------------------------------------------------- | ------------- |
| `/`               | Home              | Who, what now, paths into work                       | Redesigned    |
| `/work`           | Projects          | Featured + recent builds                             | Renamed + redesigned |
| `/pipeline`       | Data Engineering  | Owl Park architecture story                          | Renamed + redesigned |
| `/shop`           | Mock Shop         | Live demo with agents narration                      | Redesigned    |
| `/resume`         | Resume            | Resume preview + download options                    | Redesigned    |
| `/feedback`       | Feedback          | n8n form + chat fallback                             | Redesigned    |
| `/blog.html`      | —                 | **Removed**                                          | Deleted       |

Renaming `projects.html` → `work.html` and `architecture.html` → `pipeline.html` is optional but recommended — they're more evocative and clearly distinguish "what I built" from "how data flows."

### 3.2 Mobile-first navigation model

The current header drops the nav into a hamburger drawer below 900px. That works but isn't truly mobile-first. New model:

**Mobile (< 768px):**

- **Top app bar.** 56px tall. Just logo + a minimal section indicator (e.g., "Work / Featured"). Collapses on scroll down, returns on scroll up.
- **Bottom tab bar.** 64px tall, fixed, safe-area-inset aware. Five items: `Home / Work / Pipeline / Shop / More`. The "More" sheet slides up and contains Resume, Feedback, ATS Resume, socials.
- The bottom bar is the *primary* nav. Everything routes through there. It's how every native app on the user's phone already works.

**Desktop (≥ 768px):**

- The bottom tab bar collapses up into a horizontal top nav, anchored top-right. Same items, same order, no hamburger ever appears.
- The "More" sheet becomes a hover-revealed dropdown.

This is what "mobile-first structure" means in practice: the design starts from the bottom-bar pattern and progressively enhances upward, never the other way around.

### 3.3 Cohesion: making each page flow into the next

Three mechanisms:

1. **"Up next" rail at the bottom of every page.** A single horizontally-scrolling card strip showing the next two pages in the journey, with a one-line tease of what's there (e.g., on Home: "Up next → Featured: Webstore Performance Monitor"). Always visible above the bottom tab bar. This is the single biggest fix for the "dead end" problem.
2. **View Transitions API.** The browser-native `view-transition-name` mechanism replaces the current custom JS swap. A shared element (the page title slug, e.g., `WORK / 02`) morphs across the navigation, so there's a visible thread between pages instead of a fade-out / fade-in.
3. **Page numbering.** Each page is numbered as part of the journey: `01 / Now`, `02 / Work`, `03 / Pipeline`, `04 / Shop`, `05 / Resume`, `06 / Feedback`. Numbers appear in the top app bar and in the "up next" rail. This subtly turns the site into a sequence rather than a collection.

---

## 4. Page-by-page concepts

Each page gets one **cinematic moment** — the thing that makes landing there feel different from the last page. Everything else is restrained on purpose so the moment lands.

### 4.1 `/` Home — `01 / Now`

**Cinematic moment:** A live "now" card. Right below the name, three lines update in real time:

```
NOW          Building Power BI reports with the PBI MCP server
LOCAL TIME   14:32:08 EST
LATEST       Pushed Owl Park · 2h ago
```

The clock ticks (already have `time.js`). The "latest" line can read from a small JSON file you commit to (or a GitHub API call later). The "now" line is editable in one place. This card is the visual signature of the home page.

**Layout (mobile):**
- 56px top bar
- Hero: name + role + 1 sentence pitch (display-xl, tight)
- Now card (the cinematic moment)
- Crowbot panel (kept — it's distinctive). Slimmed header, fuller embed.
- "Up next" rail → Work
- Bottom tab bar

The YouTube iframe currently in the profile card moves into Work as a project tile (it's a project artifact, not a "who I am" element). That alone makes Home feel less cluttered.

### 4.2 `/work` Projects — `02 / Work`

**Cinematic moment:** The featured project — Webstore Performance Monitor — gets a full-bleed hero with a looping silent video/screenshot of the dashboard. On scroll, the card peels back to reveal the tile grid. This replaces the current modal.

**Layout:**
- Hero featured tile (full width on mobile)
- Filter chips: `All · Power BI · Python · ML · Data · Cert` (sticky on scroll)
- Tile grid: 1-col mobile → 2-col tablet → 3-col desktop. Tiles use the panel-vertical / panel-compact / panel-split variants you already have, simplified.
- "Up next" rail → Pipeline

The 5-item "Recent Projects" list becomes real tiles, each with an image, tag, and one-line outcome. The current text-only list is one of the weakest spots on the site.

### 4.3 `/pipeline` Data Engineering — `03 / Pipeline`

**Cinematic moment:** Scroll-driven pipeline diagram. As you scroll, the four phases (Ingest → Store → Transform → Analyze) light up one at a time. Data dots animate from one stage to the next as they enter the viewport. Built with IntersectionObserver + CSS — no library.

**Layout:**
- Hero: "Owl Park E-Commerce Pipeline" + the Supabase / Fabric / n8n / Power BI stack as mono caption
- The scroll-driven diagram (replaces the iframe-scaled infographic)
- Four phase cards beneath, expandable for technical details (current `phase-card` content moves here)
- "Open the full infographic" link goes to `owl-park-infographic.html` (kept as-is — it's a real artifact)
- "Up next" rail → Shop

The current iframe-scaled-down infographic is the weakest interaction on the site. It's tiny on mobile, hard to read on desktop, and provides no progressive engagement. Replacing it with a scroll diagram is the single highest-leverage change in the whole overhaul.

### 4.4 `/shop` Mock Shop — `04 / Shop`

**Cinematic moment:** A live "agent activity" ticker. A small panel above the product grid streams events: `14:32 · pricing-agent → ride pass +$0.50 (demand)` / `14:33 · restock-agent → corn dog +12 units`. These come from your existing Supabase data (or are simulated). It instantly proves the shop is wired to a live system and not a static demo.

**Layout (mobile):**
- Hero: "Mock E-Commerce Store" + 1 sentence pitch
- Agent ticker (cinematic moment)
- Product grid: 2-col mobile, snappable horizontal scroll with snap-points
- Floating cart button (fixed bottom-right, above tab bar) — opens a sheet for cart + checkout
- "Up next" rail → Resume

The current side-by-side products + checkout layout doesn't survive the mobile-first translation. The bottom-sheet checkout is the modern pattern.

### 4.5 `/resume` Resume — `05 / Resume`

**Cinematic moment:** Animated skill bars that count up on enter. Six bars, each with a years-experience number that ticks from 0 to its real value when scrolled into view. A small but expensive-feeling moment.

**Layout:**
- Hero: "Resume" + a one-line summary
- Three CTAs side-by-side: `View PDF · Download · ATS Version (.txt)`
- Skill bars panel (the cinematic moment)
- The PDF iframe stays, but only on tap-to-expand on mobile (PDFs are a poor mobile experience by default — show a styled preview card and let the user open in their PDF reader)
- "Up next" rail → Feedback

### 4.6 `/feedback` Feedback — `06 / Feedback`

**Cinematic moment:** The page asks one question at a time, conversational style: "What brings you here?" → option chips. This is just visual — it gates the n8n form behind a conversational entry, but the data still goes to the same form when you submit. Soft cyan glow on the active chip.

**Layout:**
- Hero: "Feedback" + "Tell me what worked, what didn't, what's next."
- Conversational chip selector (cinematic moment) → reveals form
- Embedded n8n form (or a "Open Feedback Form" CTA that opens it in a new tab — same as today)
- "Up next" rail → Home (closes the loop)

---

## 5. Removing the blog

The blog removal touches more than just deleting `blog.html`. The current site has a whole easter-egg around the blog being "locked":

- Drag the 🐍 emoji from the footer marquee onto the Blog nav link to unlock blog.html.
- Hover popup: "This page is under construction"
- `setupInteractiveSnake()`, `getLockedBlogLinkFromEventTarget()`, `applyBlogUnlockState()`, `showBlogHoverPopup()`, the `BLOG_UNLOCK_KEY` session state, the `.blog-disabled` / `.blog-shuddering` CSS classes — all live in `transition.js` and the stylesheet.

**Removal checklist:**
- Delete `blog.html` (both the wrapper at root and the real one in the nested folder)
- Delete `assets/blog.js`
- Remove every `<a href="blog.html">` from all five remaining pages' nav
- Strip from `transition.js`: `applyBlogUnlockState`, `setupInteractiveSnake`, all snake-drag handlers, `BLOG_UNLOCK_KEY`, `removeLegacyUnlockState`, `getLockedBlogLinkFromEventTarget`, `shudderDisabledBlog`, the blog-related branches in the click handler, the blog hover popup module
- Remove `'blog.html'` from the `isTransitionPage()` allowlist
- Strip blog-related CSS from `style.css` (`.blog-disabled`, `.blog-shuddering`, `.blog-hover-popup`, `.marquee-snake-handle`, `.blog-view` if only used by feedback/resume/data — verify and keep if shared)
- Add a redirect in `vercel.json`: `/blog.html → /` (301), so any inbound links don't 404

The interactive snake was a fun touch — if you want to keep that personality but lose the blog dependency, it can become an easter egg on the home page where dragging the snake onto the "Now" card swaps the now-message to a Python in-joke. That's optional and not in the v1 scope.

---

## 6. Implementation phases

Six phases, each independently shippable. You can pause after any of them and the site is still in a consistent state.

### Phase 1 — Foundation (no visual change yet)
- Add `assets/tokens.css` with the full token set from §2.1
- Refactor `assets/index.css` and `assets/style.css` to consume the tokens (find/replace existing hardcoded hex with `var(--*)`)
- Verify nothing visually changed — this is a clean substitution

### Phase 2 — Blog removal + nav cleanup
- Execute the removal checklist in §5
- Verify all five remaining pages still navigate correctly
- Add the `/blog.html → /` redirect in `vercel.json`

### Phase 3 — New shell (header + bottom tab bar + footer)
- Replace the header in all five pages with the new top app bar
- Add the bottom tab bar (a single component included on every page)
- Replace the footer marquee with a redesigned ticker — same content, mono type, less visually loud
- Wire `prefers-reduced-motion` to disable the marquee animation when set
- Check tab bar safe-area on iOS (`env(safe-area-inset-bottom)`)

### Phase 4 — Page-by-page redesign
In this order — the order itself creates a buildable journey:
1. **Home** — establishes the design language. Other pages copy patterns from here.
2. **Work** — the highest-traffic destination. Worth getting right second.
3. **Pipeline** — the most ambitious cinematic moment (scroll-driven diagram). Most code work.
4. **Shop** — needs careful mobile redesign for the cart sheet.
5. **Resume** — straightforward.
6. **Feedback** — straightforward.

After each page lands, smoke-test on real mobile (not just devtools) — touch targets and scroll feel can't be measured at desk.

### Phase 5 — Cohesion layer
- Add the "Up next" rail component, included in the footer of all pages
- Add page numbering to the top bar
- Replace the custom `transition.js` page-swap with the View Transitions API (`document.startViewTransition`). The current file's prefetch, modal, and mobile-nav logic stay; only the swap logic is replaced. ~150 lines come out, ~30 go in.
- Add `view-transition-name` to the page title element so it morphs across navigations

### Phase 6 — Polish
- Motion tuning: every animation passes through `prefers-reduced-motion: reduce`
- Accessibility audit (WCAG 2.1 AA): contrast on cyan-on-graphite, focus rings everywhere, every interactive element keyboard-reachable, ARIA labels on the tab bar items, screen-reader test of the page-numbering pattern
- Performance pass: lazy-load the YouTube iframe, prefetch the next page in the journey when the "Up next" rail enters the viewport, audit total JS payload
- Real-device QA on iOS Safari + Chrome Android (the iOS bottom tab bar is finicky)

**Estimated effort:** Phase 1–2 are an afternoon each. Phase 3 is a day. Phase 4 is roughly 1–2 days per page (so ~1.5 weeks). Phase 5 is a day. Phase 6 is a day. Two to three weeks of focused evening work, depending on polish bar.

---

## 7. File-level changes

```
DELETE
  blog.html (root wrapper)
  portfolio2-main/blog.html
  portfolio2-main/assets/blog.js

ADD
  portfolio2-main/assets/tokens.css         design tokens
  portfolio2-main/assets/main.css           consolidated styles (replaces index.css + style.css over time)
  portfolio2-main/assets/now.json           home "now" card data
  portfolio2-main/assets/upnext.js          "Up next" rail logic
  portfolio2-main/assets/pipeline-scroll.js scroll-driven diagram for /pipeline
  portfolio2-main/assets/agent-ticker.js    live agent feed for /shop

UPDATE
  portfolio2-main/index.html                hero + now card + crowbot
  portfolio2-main/projects.html → work.html
  portfolio2-main/architecture.html → pipeline.html
  portfolio2-main/shop.html
  portfolio2-main/resume.html
  portfolio2-main/feedback.html
  portfolio2-main/assets/transition.js      strip blog logic + replace with View Transitions API
  portfolio2-main/assets/index.css, style.css   collapse into main.css
  portfolio2-main/vercel.json               add /blog → /, /architecture → /pipeline, /projects → /work redirects

KEEP AS-IS
  portfolio2-main/owl-park-infographic.html (linked from /pipeline)
  portfolio2-main/assets/resume_current.pdf
  portfolio2-main/assets/resume_ats.txt
  portfolio2-main/assets/data/products.json
  portfolio2-main/assets/shop.js (the supabase wiring is good — only the layout-touching parts change)
  portfolio2-main/assets/time.js
  portfolio2-main/mini.jpg, all images
```

If you keep the old `projects.html` / `architecture.html` URLs instead of renaming, that's fine — drop the rename rows. The plan works either way.

---

## 8. What this gets you

- **Each page is exciting to land on** because each has one cinematic moment (now card / featured video peel / scroll pipeline / agent ticker / count-up bars / conversational chips). Design language is restrained around it so the moment lands.
- **Each page flows to the next** because every page ends with an "Up next" rail and uses View Transitions to morph the title across navigations. Page numbers turn the site into a sequence.
- **Blog is gone**, redirected, and the unlock easter-egg code is cleaned up.
- **The look says "2026 data engineer"** — graphite + cyan, mono numerals, hairline structure, restrained motion. It's the Linear/Vercel/Stripe school of restraint, applied to a portfolio.
- **Mobile is the primary target.** Bottom tab bar, sheet checkout, snap-scroll grids, safe-area handling. Desktop is the progressive enhancement, not the default.

---

## 9. Open questions for Logan to resolve

These don't block the mockup but will need answers before Phase 4:

1. **Rename pages?** `projects → work`, `architecture → pipeline` — yes / no?
2. **Keep the snake easter egg?** Move it to home as a Python joke, or retire it entirely?
3. **Crowbot placement.** Stay on home, or move to a floating button accessible from every page? (Floating is the more "AI-portfolio in 2026" move.)
4. **Featured project hero asset.** Do you have a clean dashboard screenshot or short screen-recording of the Webstore Performance Monitor we can use as the hero?
5. **Now-card source of truth.** Manually edited `now.json`, or pulled from a GitHub gist / endpoint?

The mockup at `mockup-home.html` makes specific choices for #3 (Crowbot stays on home) and #5 (`now.json`) so we can see the whole thing — those are easy to change later.
