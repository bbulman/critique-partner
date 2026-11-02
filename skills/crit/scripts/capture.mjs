#!/usr/bin/env node
// crit: capture a page the way a critic needs to see it, plus facts its claims can be checked against.
//
//   capture.mjs <url | file.html> --out <dir> [--viewports 390x844,1280x800] [--storage <state.json>]
//               [--slices 12] [--settle 700] [--reduced-motion]
//
// Writes into <dir>: evidence.json; <w>-fold.png (the first screen at width w); <w>-full-<n>.png
// (the whole page in screen-sized slices, top to bottom, at most --slices of them); text-<w>.txt
// (the visible text at width w); page.html (the rendered DOM) and text.txt, from the widest viewport.
//
// The page is scrolled once before anything is captured, so scroll-triggered reveals and lazy images
// have fired. Headless Chromium renders a visible page; the in-app browser pane renders a hidden one,
// where reveals never fire, which is why evidence comes from here and not from the pane.
//
// --storage loads a Playwright storage state (cookies and localStorage), for pages behind sign-in.
// Playwright resolves from the current project first, then from the global npm root.

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = 'usage: capture.mjs <url | file.html> --out <dir> [--viewports 390x844,1280x800] [--storage <state.json>] [--slices 12] [--settle 700] [--reduced-motion]';

function parseArgs(argv) {
  const a = { viewports: '390x844,1280x800', slices: 12, settle: 700, reducedMotion: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--out') a.out = argv[++i];
    else if (k === '--viewports') a.viewports = argv[++i];
    else if (k === '--storage') a.storage = argv[++i];
    else if (k === '--slices') a.slices = parseInt(argv[++i], 10);
    else if (k === '--settle') a.settle = parseInt(argv[++i], 10);
    else if (k === '--reduced-motion') a.reducedMotion = true;
    else if (k === '-h' || k === '--help') { console.log(USAGE); process.exit(0); }
    else if (k.startsWith('--')) throw new Error(`unknown option ${k}\n${USAGE}`);
    else rest.push(k);
  }
  a.target = rest[0];
  if (!a.target || !a.out) throw new Error(USAGE);
  if (!(a.slices > 0)) throw new Error('--slices must be a positive number');
  return a;
}

function loadPlaywright() {
  const bases = [process.cwd()];
  try {
    bases.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {}
  for (const base of bases) {
    for (const name of ['playwright', '@playwright/test']) {
      try { return createRequire(join(base, 'package.json'))(name); } catch {}
    }
  }
  throw new Error('Playwright was not found in this project or the global npm root. Install it with: npm i -g playwright && npx playwright install chromium');
}

// Runs in the page. Bounded everywhere: a critic needs the shape of the page, not every node.
function collectFacts({ mobile }) {
  const MAX_TEXT = 400;
  const isVis = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity || '1') > 0.05;
  };
  const text = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  // Icon fonts draw glyphs from ligature words ("account_circle"); those are icons, not copy.
  const ICON_FONT = /material (symbols|icons)|font ?awesome|icomoon|glyphicons/i;
  const isIcon = el => ICON_FONT.test(getComputedStyle(el).fontFamily);
  const labelOf = el => {
    const parts = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const p = w.currentNode.parentElement;
      if (p && !isIcon(p)) parts.push(w.currentNode.nodeValue);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  };
  const sel = el => {
    const t = el.tagName.toLowerCase();
    if (el.id) return `${t}#${el.id}`;
    const c = [...el.classList].slice(0, 2).join('.');
    return c ? `${t}.${c}` : t;
  };
  const absTop = el => Math.round(el.getBoundingClientRect().top + scrollY);
  const tally = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));
  const parse = c => {
    const m = String(c).match(/^rgba?\(([^)]+)\)$/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
  });
  const lum = ({ r, g, b }) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // The solid colour behind an element, or null when an image or gradient sits behind its text.
  const bgOf = el => {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    return out;
  };

  // Mobile emulation widens the layout viewport to fit content that overflows, so innerWidth and
  // innerHeight grow with the bug; the visible screen is clientWidth and the visual viewport.
  const vw = document.documentElement.clientWidth || innerWidth;
  const fold = (window.visualViewport && visualViewport.height) || innerHeight;
  const headings = [...document.querySelectorAll('h1,h2,h3,h4')].filter(isVis).slice(0, 50)
    .map(h => ({ level: +h.tagName[1], text: text(h).slice(0, 100), y: absTop(h) }));

  const textEls = [];
  const seen = new Set();
  let iconGlyphs = 0;
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    while (walker.nextNode() && textEls.length < MAX_TEXT) {
      const el = walker.currentNode.parentElement;
      if (el && !seen.has(el) && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName) && isVis(el)) {
        seen.add(el);
        if (isIcon(el)) iconGlyphs++;
        else textEls.push(el);
      }
    }
  }
  const families = new Map(), sizes = new Map(), textColors = new Map();
  const low = [];
  let contrastUnknown = 0;
  for (const el of textEls) {
    const s = getComputedStyle(el);
    tally(families, s.fontFamily.split(',')[0].replace(/["']/g, '').trim());
    const px = Math.round(parseFloat(s.fontSize));
    tally(sizes, px);
    tally(textColors, s.color);
    const fg = parse(s.color), bg = bgOf(el);
    if (!fg || !bg) { contrastUnknown++; continue; }
    const fgc = fg.a < 1 ? blend(fg, bg) : fg;
    const l1 = lum(fgc), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const large = px >= 24 || (px >= 18.66 && parseInt(s.fontWeight, 10) >= 700);
    if (ratio < (large ? 3 : 4.5)) {
      low.push({
        selector: sel(el), text: text(el).slice(0, 60), ratio: +ratio.toFixed(2), sizePx: px, color: s.color,
        background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`, y: absTop(el),
      });
    }
  }

  const buttons = [], smallTargets = [];
  const clickables = [...document.querySelectorAll('a[href],button,[role="button"],input[type="submit"],input[type="button"]')]
    .filter(isVis).slice(0, 400);
  for (const el of clickables) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const bg = parse(s.backgroundColor);
    // A white button on a white page reads as outlined, so a fill counts only when it differs from what is behind it.
    const behind = (el.parentElement && bgOf(el.parentElement)) || (document.body && bgOf(document.body));
    const differs = !behind || (bg && Math.abs(bg.r - behind.r) + Math.abs(bg.g - behind.g) + Math.abs(bg.b - behind.b) > 40);
    const filled = Boolean(bg && bg.a > 0.5 && differs) || (s.backgroundImage && s.backgroundImage !== 'none');
    const outlined = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none';
    const isButton = filled || outlined || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.tagName === 'INPUT';
    if (!isButton) continue;
    const label = labelOf(el).slice(0, 60) || el.getAttribute('aria-label') || el.getAttribute('title') || el.value
      || (text(el) ? `[icon] ${text(el).slice(0, 30)}` : '');
    const y = absTop(el);
    buttons.push({
      text: label, selector: sel(el), style: filled ? 'filled' : outlined ? 'outlined' : 'text',
      background: s.backgroundColor, color: s.color, radius: s.borderRadius, aboveFold: y < fold, y,
      w: Math.round(r.width), h: Math.round(r.height),
    });
    if (mobile && (r.width < 44 || r.height < 44)) smallTargets.push({ text: label, selector: sel(el), w: Math.round(r.width), h: Math.round(r.height) });
  }

  const gradients = [], shadows = new Map(), radii = new Map(), backgrounds = new Map(), overflowing = [];
  let gradientCount = 0, textGradients = 0;
  // A carousel or scroller inside the page clips its own overflow; body and html don't count, since
  // overflow-x: hidden there hides the bug rather than fixing it.
  const contained = el => {
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(n).overflowX)) return true;
    }
    return false;
  };
  const all = document.body ? [...document.body.querySelectorAll('*')].slice(0, 3000) : [];
  for (const el of all) {
    const s = getComputedStyle(el);
    if (s.display === 'none') continue;
    if (overflowing.length < 10 && isVis(el)) {
      const r = el.getBoundingClientRect();
      const crossesEdge = (r.left < vw - 1 && r.right > vw + 1) || (r.left < -1 && r.right > 1);
      if (crossesEdge && !overflowing.some(o => o.el.contains(el)) && !contained(el)) {
        overflowing.push({ el, selector: sel(el), text: text(el).slice(0, 40), left: Math.round(r.left), right: Math.round(r.right) });
      }
    }
    if (s.backgroundImage.includes('gradient')) {
      gradientCount++;
      if (s.webkitBackgroundClip === 'text' || s.backgroundClip === 'text') textGradients++;
      if (gradients.length < 10 && isVis(el)) gradients.push({ selector: sel(el), value: s.backgroundImage.slice(0, 140) });
    }
    if (s.boxShadow && s.boxShadow !== 'none') tally(shadows, s.boxShadow.slice(0, 90));
    if (s.borderRadius && s.borderRadius !== '0px') tally(radii, s.borderRadius);
    const bg = parse(s.backgroundColor);
    if (bg && bg.a > 0) tally(backgrounds, s.backgroundColor);
  }

  const imgs = [...document.images].filter(isVis);
  const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea')].filter(isVis);
  const sizeKeys = [...sizes.keys()];

  return {
    title: document.title,
    lang: document.documentElement.lang || null,
    description: document.querySelector('meta[name="description"]')?.content || null,
    hasPasswordField: [...document.querySelectorAll('input[type="password"]')].some(isVis),
    visibleWidth: vw,
    horizontalScroll: document.documentElement.scrollWidth > vw + 1,
    overflowing: overflowing.map(({ el, ...o }) => o),
    headings,
    h1Count: headings.filter(h => h.level === 1).length,
    buttons: buttons.slice(0, 30),
    buttonCount: buttons.length,
    filledButtonsAboveFold: buttons.filter(b => b.aboveFold && b.style === 'filled').map(b => b.text),
    smallTouchTargets: mobile ? { under44px: smallTargets.length, sample: smallTargets.slice(0, 10) } : null,
    type: {
      families: top(families, 8),
      sizesPx: top(sizes, 12),
      smallestPx: sizeKeys.length ? Math.min(...sizeKeys) : null,
      iconGlyphs,
      loadedFaces: [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => `${f.family.replace(/["']/g, '')} ${f.weight}`))].slice(0, 20),
    },
    color: { text: top(textColors, 12), backgrounds: top(backgrounds, 12) },
    contrast: {
      note: 'ratio of text colour to the solid colour behind it; flagged under 4.5:1, or 3:1 for text 24px+ or 18.66px+ bold',
      checked: textEls.length - contrastUnknown,
      unknown: contrastUnknown,
      flaggedCount: low.length,
      flagged: low.sort((a, b) => a.ratio - b.ratio).slice(0, 20),
    },
    gradients: { count: gradientCount, onText: textGradients, sample: gradients },
    shadows: top(shadows, 6),
    radii: top(radii, 10),
    images: {
      count: imgs.length,
      missingAlt: imgs.filter(i => !i.hasAttribute('alt')).map(sel).slice(0, 10),
      emptyAlt: imgs.filter(i => i.getAttribute('alt') === '').length,
    },
    unlabeledFields: fields
      .filter(f => !(f.labels && f.labels.length) && !f.getAttribute('aria-label') && !f.getAttribute('aria-labelledby'))
      .map(f => ({ selector: sel(f), placeholder: f.getAttribute('placeholder') || '' })).slice(0, 10),
  };
}

// The same page, ignoring a trailing slash, a fragment and the order of nothing else.
const samePage = (a, b) => {
  try {
    const x = new URL(a), y = new URL(b);
    return x.origin === y.origin && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '') && x.search === y.search;
  } catch { return a === b; }
};

async function main() {
  // Capture waits for fonts itself, for three seconds at most. Playwright's own wait before every
  // screenshot has no cap, so a hung request stalls it too. The variable is Playwright-internal; if
  // it ever stops working, a hung page fails with a timeout again rather than capturing wrongly.
  process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
  const args = parseArgs(process.argv.slice(2));
  const out = resolve(args.out);
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(args.target)
    ? args.target
    : existsSync(args.target) ? pathToFileURL(resolve(args.target)).href : null;
  if (!url) throw new Error(`not a URL or an existing file: ${args.target}`);
  const viewports = args.viewports.split(',').map(s => {
    const [w, h] = s.trim().split('x').map(Number);
    if (!w || !h) throw new Error(`bad viewport "${s}": use WIDTHxHEIGHT, e.g. 390x844`);
    return { w, h, key: `${w}x${h}` };
  });
  const widest = viewports.reduce((m, v) => (v.w > m.w ? v : m), viewports[0]);
  mkdirSync(out, { recursive: true });

  const { chromium } = loadPlaywright();
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    throw new Error(`Chromium did not launch (${String(e.message).split('\n')[0]}). Run: npx playwright install chromium`);
  }

  const evidence = {
    target: args.target, url, finalUrl: null, status: null, capturedAt: new Date().toISOString(),
    signedIn: Boolean(args.storage), reducedMotion: args.reducedMotion, viewports: {},
    console: { errors: [], failedRequests: [] }, files: {},
  };
  const note = (list, line) => { if (list.length < 15) list.push(line); };

  try {
    for (const vp of viewports) {
      const mobile = vp.w < 768;
      const context = await browser.newContext({
        viewport: { width: vp.w, height: vp.h },
        deviceScaleFactor: mobile ? 2 : 1,
        isMobile: mobile,
        hasTouch: mobile,
        reducedMotion: args.reducedMotion ? 'reduce' : 'no-preference',
        ...(args.storage ? { storageState: resolve(args.storage) } : {}),
      });
      const page = await context.newPage();
      page.on('console', m => { if (m.type() === 'error') note(evidence.console.errors, `[${vp.key}] ${m.text().slice(0, 200)}`); });
      page.on('pageerror', e => note(evidence.console.errors, `[${vp.key}] ${String(e.message).slice(0, 200)}`));
      page.on('response', r => { if (r.status() >= 400) note(evidence.console.failedRequests, `[${vp.key}] ${r.status()} ${r.url().slice(0, 160)}`); });
      page.on('requestfailed', r => note(evidence.console.failedRequests, `[${vp.key}] failed ${r.url().slice(0, 160)}`));

      // DOM ready is enough to start; one request that never answers mustn't sink the capture.
      let res;
      try {
        res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        throw new Error(`could not load ${url}: ${String(e.message).split('\n')[0]}`);
      }
      const loaded = await page.waitForLoadState('load', { timeout: 15000 }).then(() => true, () => false);
      if (loaded) await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      else evidence.loadIncomplete = true;
      if (evidence.status === null) {
        evidence.status = res ? res.status() : null;
        evidence.finalUrl = page.url();
      }
      // Chrome holds fonts.ready until the document finishes loading, so it waits on a hung request too.
      await page.evaluate(() => Promise.race([
        document.fonts ? document.fonts.ready.then(() => true) : true,
        new Promise(r => setTimeout(() => r(false), 3000)),
      ])).catch(() => {});
      await page.evaluate(async () => {
        const step = Math.max(200, Math.floor(innerHeight * 0.8));
        // Measured once and capped, so an infinite feed can't keep the loop running.
        const limit = Math.min(document.documentElement.scrollHeight, 40000);
        for (let y = 0, n = 0; y < limit && n < 80; y += step, n++) {
          scrollTo(0, y);
          await new Promise(r => setTimeout(r, 120));
        }
        scrollTo(0, 0);
      });
      await page.waitForTimeout(args.settle);

      const files = { fold: `${vp.w}-fold.png`, slices: [] };
      await page.screenshot({ path: join(out, files.fold) });
      const pageHeight = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
      const screens = Math.max(1, Math.ceil(pageHeight / vp.h));
      const n = Math.min(args.slices, screens);
      // Scrolled screens rather than cuts of one tall image, so a fixed header or bottom bar shows
      // on every screen, as it does for the reader.
      for (let i = 0; i < n; i++) {
        await page.evaluate(top => scrollTo(0, top), Math.min(i * vp.h, Math.max(0, pageHeight - vp.h)));
        await page.waitForTimeout(250);
        const file = `${vp.w}-full-${i + 1}.png`;
        await page.screenshot({ path: join(out, file) });
        files.slices.push(file);
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(150);
      const facts = await page.evaluate(collectFacts, { mobile });
      facts.looksLikeSignIn = facts.hasPasswordField || /(log|sign)[-_]?in/i.test(new URL(page.url()).pathname);
      files.text = `text-${vp.w}.txt`;
      writeFileSync(join(out, files.text), await page.evaluate(() => (document.body ? document.body.innerText : '')));
      evidence.viewports[vp.key] = { files, pageHeight, screens, captured: files.slices.length, truncated: screens > files.slices.length, facts };

      if (vp === widest) {
        writeFileSync(join(out, 'page.html'), await page.content());
        writeFileSync(join(out, 'text.txt'), await page.evaluate(() => (document.body ? document.body.innerText : '')));
        evidence.files = { html: 'page.html', text: 'text.txt' };
      }
      await context.close();
    }
  } catch (e) {
    // Keep what was captured, so the critic can still see how far it got.
    evidence.error = e.message;
    writeFileSync(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
    throw e;
  } finally {
    await browser.close();
  }
  evidence.redirected = !samePage(url, evidence.finalUrl);
  writeFileSync(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));

  console.log(`crit capture: ${url} -> ${out}`);
  console.log(`  status ${evidence.status} · final ${evidence.finalUrl} · console errors ${evidence.console.errors.length} · failed requests ${evidence.console.failedRequests.length}`);
  for (const [key, v] of Object.entries(evidence.viewports)) {
    const f = v.facts;
    console.log(`  ${key}: ${v.screens} screens (${v.captured} captured${v.truncated ? ', rest not captured' : ''}) · h1 ${f.h1Count} · filled buttons above the fold ${f.filledButtonsAboveFold.length} · contrast flags ${f.contrast.flaggedCount} · horizontal scroll ${f.horizontalScroll ? 'YES' : 'no'} · elements past the screen edge ${f.overflowing.length}`);
  }
  if (evidence.status >= 400) console.log(`  WARNING: the page answered ${evidence.status}. Check the URL before critiquing it.`);
  if (evidence.loadIncomplete) console.log('  WARNING: the page never finished loading (a request hung), so the capture shows it as it stood after 15 seconds.');
  if (evidence.redirected) console.log(`  WARNING: the page ended at ${evidence.finalUrl}, not ${url}. A redirect or a fallback route may be serving a different page; check it is the page you mean.`);
  if (Object.values(evidence.viewports).some(v => v.facts.looksLikeSignIn)) {
    console.log('  WARNING: this looks like a sign-in screen. Capture again with --storage <state.json> to see the signed-in page, or critique the sign-in screen on purpose.');
  }
}

main().catch(e => {
  console.error(`crit capture failed: ${e.message}`);
  process.exit(1);
});
