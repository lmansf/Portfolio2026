#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────
 * render.mjs — re-render assets/og-card.jpg (the 1200×630 Open Graph /
 * Twitter card) from card.html. Only needed when the name card text changes.
 *
 * The tooling is installed OUTSIDE the repo so no package.json lands at the
 * root (Vercel would start treating the site as a Node project):
 *
 *   npm i --prefix /tmp/og-tools playwright @fontsource/inter @fontsource/jetbrains-mono
 *   node scripts/og-card/render.mjs /tmp/og-tools [path/to/chromium]
 *
 * Without a Chromium path it uses Playwright's own browser.
 * ───────────────────────────────────────────────────────────── */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [toolsArg, executablePath] = process.argv.slice(2);
if (!toolsArg) {
    console.error('usage: node scripts/og-card/render.mjs <tools-dir> [chromium-path]');
    process.exit(1);
}
const tools = resolve(toolsArg);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const { chromium } = createRequire(join(tools, 'package.json'))('playwright');

const html = readFileSync(join(here, 'card.html'), 'utf8')
    .replaceAll('__TOOLS__', pathToFileURL(tools).href)
    .replaceAll('__ASSETS__', pathToFileURL(join(root, 'assets')).href);
const page_ = join(mkdtempSync(join(tmpdir(), 'og-card-')), 'card.html');
writeFileSync(page_, html);

const browser = await chromium.launch({ executablePath, args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(page_).href);
await page.evaluate(() => document.fonts.ready);
const out = join(root, 'assets', 'og-card.jpg');
await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
await browser.close();
console.log(`Wrote ${out}`);
