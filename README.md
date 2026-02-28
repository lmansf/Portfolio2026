# Portfolio Website

This repository contains a static personal portfolio website with a dedicated blog page. The site is designed to be lightweight, fast, and easy to deploy, using plain HTML, CSS, and JavaScript.

## Website Overview

The website has three core views:

- **Home page** (`index.html`) — the main landing experience.
- **Projects page** (`projects.html`) — a curated overview of selected work.
- **Blog page** (`blog.html`) — blog content powered by frontend JavaScript.
- **Mock Shop page** (`shop.html`) — product catalog loaded from Supabase.

## Supabase Data Sources

The site currently reads Supabase data directly in the browser using the public anon key model.

Supabase tables currently used by the frontend:

- `public.blogposts`
- `public.products`

- `assets/blog.js` reads `public.blogposts`.
- `assets/shop.js` reads `public.products` and maps these fields:
   - `id` (required, unique)
   - `product_name` (required)
   - `category`
   - `description`
   - `unit_price` (required)
   - `stock` (required; used for both product stock and ticket capacity)

Write behavior in use:

- `assets/shop.js` updates `public.products.stock` during mock checkout.

External automation boundary:

- Ticket-buying, dynamic-pricing, and inventory replenishment agents are orchestrated externally in n8n workflows.
- Those agent workflows are not stored in this repository; this repo contains only the user-facing web app and direct Supabase interactions.

No additional Supabase tables are referenced in this repository at this time.

## Layout and File Structure

```text
portfolio2-main/
├─ index.html                # Main portfolio landing page
├─ projects.html             # Projects showcase page
├─ blog.html                 # Blog page
├─ vercel.json               # Deployment/routing + cache headers
├─ robots.txt
├─ sitemap.xml
└─ assets/
   ├─ index.min.css          # Home page optimized CSS
   ├─ style.css              # Shared styling for projects/blog
   ├─ transition.min.js      # Optimized transition script
   ├─ blog.js                # Blog page logic
   ├─ crane.jpg
   ├─ archive/
   │  └─ profile-images/
   │     ├─ profilepicCranes-400.avif
   │     ├─ profilepicCranes-400.jpg
   │     └─ profilepicCranes.jpeg
   ├─ resume_current.pdf
   └─ resume_ats.txt
```

## Performance Optimizations Implemented

This project received a focused optimization pass for faster load, improved Core Web Vitals, and leaner deployment:

- Removed Font Awesome dependency from `index.html`, `projects.html`, and `blog.html`.
- Replaced marquee icon `<i>` tags with inline Unicode symbols to eliminate webfont/CSS overhead.
- Improved hero image delivery on the home page with AVIF + JPEG fallback using `<picture>`.
- Added high-priority preload/fetch settings for the LCP hero image.
- Kept minified route-critical assets in use (`assets/index.min.css`, `assets/transition.min.js`).
- Preserved strong cache headers in `vercel.json` for static assets (`max-age=31536000, immutable`).
- Removed unneeded local optimization artifacts (temporary Lighthouse output and unused WebP variant).

## Lighthouse Snapshot (Desktop)

Latest optimization run reached a **100/100 Performance score** with key metrics in excellent range:

- FCP: ~0.2s
- LCP: ~0.3s
- TBT: 0ms
- CLS: 0

## Author Note

The latest performance optimization pass was authored by **GitHub Copilot (GPT-5.3-Codex)**.

## AI Development Note

This website and the user-facing implementation were developed with assistance from:

- **GPT-5.3-Codex**
- **Gemini 3.1 Pro**

