#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────
 * build-sitemap.mjs — regenerate sitemap.xml from the pages themselves.
 *
 *   node scripts/build-sitemap.mjs           # write sitemap.xml
 *   node scripts/build-sitemap.mjs --check   # exit 1 if sitemap.xml is stale
 *
 * A page is listed when it is a root-level *.html file that declares a
 * <link rel="canonical"> and is not marked noindex. <loc> is that canonical
 * URL, which must be routable through vercel.json (a rewrite, or the file
 * itself). <lastmod> is the date of the last commit that touched the page, or
 * today when the page has uncommitted changes. changefreq/priority are left
 * out on purpose: Google ignores them.
 *
 * Run it whenever a page is added, removed or edited, and commit the result
 * alongside the page change. --check (run in CI) fails when the listed URLs
 * differ from the indexable pages, and warns when a lastmod looks stale.
 * ───────────────────────────────────────────────────────────── */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITEMAP = join(ROOT, 'sitemap.xml');
const ORIGIN = 'https://loganmansfield.org';

function git(...args) {
    try {
        return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } }).trim();
    } catch {
        return '';
    }
}

// Dates are UTC on both paths (dirty file → today; committed → commit date),
// so re-running on a clean tree never flips a lastmod by a day.
const today = () => new Date().toISOString().slice(0, 10);

function lastmodFor(file) {
    const dirty = git('status', '--porcelain', '--', file) !== '';
    if (dirty) return today();
    return git('log', '-1', '--format=%cd', '--date=format-local:%Y-%m-%d', '--', file) || today();
}

function attr(tag, name) {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function pageInfo(file) {
    const html = readFileSync(join(ROOT, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const head = html.slice(0, html.search(/<\/head>/i) + 1 || undefined);
    let canonical = null;
    let noindex = false;
    for (const tag of head.match(/<(link|meta)\b[^>]*>/gi) || []) {
        if (/^<link/i.test(tag) && (attr(tag, 'rel') || '').toLowerCase() === 'canonical') {
            canonical = attr(tag, 'href');
        }
        // robots/googlebot "noindex" or "none" keeps a page out of the index
        // (whole directives only: max-image-preview:none is not noindex).
        if (/^<meta/i.test(tag) && ['robots', 'googlebot'].includes((attr(tag, 'name') || '').toLowerCase())) {
            const directives = (attr(tag, 'content') || '').split(',').map((d) => d.trim().toLowerCase());
            if (directives.includes('noindex') || directives.includes('none')) noindex = true;
        }
    }
    return { file, canonical, noindex };
}

// Vercel-style source pattern → RegExp, for the forms vercel.json uses:
// literals, :name, :name*, :name(regex) and bare (regex) groups.
function sourceToRegExp(source) {
    let out = '';
    for (let i = 0; i < source.length;) {
        const rest = source.slice(i);
        const param = rest.match(/^:(\w+)(\((?:[^()]|\([^()]*\))*\))?([*+?])?/);
        const group = rest.match(/^\((?:[^()]|\([^()]*\))*\)/);
        if (param) {
            out += param[2] ? param[2] : param[3] === '*' ? '(.*)' : '([^/]+)';
            i += param[0].length;
        } else if (group) {
            out += group[0];
            i += group[0].length;
        } else {
            out += source[i].replace(/[.+*?^${}|[\]\\]/g, '\\$&');
            i += 1;
        }
    }
    return new RegExp(`^${out}$`);
}

// A redirect that applies on the canonical host (no host condition, or one
// naming that host) runs before rewrites and the filesystem on Vercel.
function redirectFor(pathname, vercel) {
    const host = new URL(ORIGIN).host;
    return (vercel.redirects || []).find((r) => {
        const hosts = (r.has || []).filter((h) => h.type === 'host').map((h) => h.value);
        if (hosts.length && !hosts.includes(host)) return false;
        return sourceToRegExp(r.source).test(pathname);
    });
}

function routedFile(pathname, vercel) {
    const rewrite = (vercel.rewrites || []).find((r) => r.source === pathname);
    if (rewrite) return rewrite.destination.replace(/^\//, '');
    return pathname.replace(/^\//, '');
}

function collect() {
    const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
    const pages = readdirSync(ROOT)
        .filter((f) => f.endsWith('.html'))
        .map(pageInfo)
        .filter((p) => p.canonical && !p.noindex);

    for (const p of pages) {
        if (!p.canonical.startsWith(`${ORIGIN}/`)) {
            throw new Error(`${p.file}: canonical ${p.canonical} is not on ${ORIGIN}`);
        }
        const pathname = new URL(p.canonical).pathname;
        const redirect = redirectFor(pathname, vercel);
        if (redirect) {
            throw new Error(`${p.file}: canonical ${p.canonical} is redirected by vercel.json (${redirect.source} → ${redirect.destination})`);
        }
        const target = routedFile(pathname, vercel);
        if (target !== p.file) {
            throw new Error(`${p.file}: canonical ${p.canonical} routes to "${target}", not to this file — add a rewrite in vercel.json`);
        }
    }

    // Home first, then alphabetical by URL, so diffs stay stable.
    return pages
        .map((p) => ({ ...p, loc: p.canonical, lastmod: lastmodFor(p.file) }))
        .sort((a, b) => (a.loc === `${ORIGIN}/` ? -1 : b.loc === `${ORIGIN}/` ? 1 : a.loc.localeCompare(b.loc)));
}

function render(entries) {
    const urls = entries
        .map((e) => `  <url>\n    <loc>${e.loc}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n  </url>`)
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by scripts/build-sitemap.mjs — do not edit by hand. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function check(entries) {
    if (!existsSync(SITEMAP)) return { problems: ['sitemap.xml is missing'], warnings: [] };
    const listed = [...readFileSync(SITEMAP, 'utf8').matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)]
        .map((m) => ({ loc: m[1], lastmod: m[2] }));
    const problems = [];
    const warnings = [];

    const want = entries.map((e) => e.loc).sort();
    const have = listed.map((e) => e.loc).sort();
    if (want.join('\n') !== have.join('\n')) {
        problems.push(`URL set differs.\n  pages:       ${want.join(', ')}\n  sitemap.xml: ${have.join(', ')}`);
    }
    // lastmod drift is only a warning: squash merges re-date commits on main,
    // so "page commit is newer than its lastmod" is not proof of staleness.
    for (const e of entries) {
        const entry = listed.find((l) => l.loc === e.loc);
        if (entry && entry.lastmod < e.lastmod) {
            warnings.push(`${e.loc} lastmod ${entry.lastmod} is older than ${e.file}'s last change (${e.lastmod})`);
        }
    }
    return { problems, warnings };
}

let entries;
try {
    entries = collect();
} catch (err) {
    console.error(`build-sitemap: ${err.message}`);
    process.exit(1);
}
if (process.argv.includes('--check')) {
    const { problems, warnings } = check(entries);
    for (const w of warnings) console.warn(`warning: ${w} — run: node scripts/build-sitemap.mjs`);
    if (problems.length) {
        console.error(`sitemap.xml is out of date — run: node scripts/build-sitemap.mjs\n- ${problems.join('\n- ')}`);
        process.exit(1);
    }
    console.log(`sitemap.xml lists every indexable page (${entries.length} URLs).`);
} else {
    writeFileSync(SITEMAP, render(entries));
    console.log(`Wrote sitemap.xml with ${entries.length} URLs:\n${entries.map((e) => `  ${e.lastmod}  ${e.loc}`).join('\n')}`);
}
