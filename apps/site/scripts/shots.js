#!/usr/bin/env node
// Nafoti vsechny stranky ve vsech jazycich v sirkach 320 / 390 / 768 / 1440 px a ZMERI
// vodorovne preteceni. Konci chybou (exit 1), kdyz cokoli pretece.
// Vyzaduje bezici `node scripts/serve.js` (nebo BASE=http://127.0.0.1:8787 pro wrangler dev).
// Spusteni: node scripts/shots.js [sirka]      Vystup: _shots/*.png

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./cdp.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "_shots");
const BASE = process.env.BASE || "http://localhost:4173";

const VIEWS = [
  { name: "320", w: 320, h: 720 },
  { name: "390", w: 390, h: 844 },
  { name: "768", w: 768, h: 1024 },
  { name: "1440", w: 1440, h: 900 },
];
const LANGS = ["cs", "en", "de"];
const PAGES = ["", "funkce", "platformy", "cenik", "ukazka", "stazeni", "kontakt", "podminky", "soukromi", "cookies"];

// Pozor: uvnitr retezce nepouzivat zpetna lomitka.
const PROBE = `(() => {
  const vw = document.documentElement.clientWidth;
  const seen = new Map();
  document.querySelectorAll('body *').forEach(el => {
    // .art = dekorativni SVG orezane rodicem (overflow: hidden); jeho cary mohou presahovat
    if (el.closest('.skip, .hp, .art')) return;
    if (!el.getClientRects().length) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const over = Math.max(Math.round(r.right - vw), Math.round(-r.left));
    if (over > 1) {
      const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(' ').join('.') : '';
      const key = el.tagName.toLowerCase() + cls + ' ' + (el.textContent || '').trim().slice(0, 30);
      if (!seen.has(key) || seen.get(key) < over) seen.set(key, over);
    }
  });
  return JSON.stringify({ overflowPx: Math.max(0, document.documentElement.scrollWidth - vw),
    culprits: [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5) });
})()`;

const SCROLL = `(async () => {
  const H = document.documentElement.scrollHeight;
  for (let y = 0; y < H; y += innerHeight * 0.7) { scrollTo({ top: y, behavior: "instant" }); await new Promise((r) => setTimeout(r, 25)); }
  scrollTo({ top: 0, behavior: "instant" });
  await new Promise((r) => setTimeout(r, 800));
  return true;
})()`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const only = process.argv[2];
const problems = [];
const browser = await launch();
try {
  const page = await browser.page();
  for (const v of VIEWS) {
    if (only && v.name !== only) continue;
    await page.viewport(v.w, v.h);
    for (const lang of LANGS) {
      for (const p of PAGES) {
        const url = `${BASE}${lang === "cs" ? "" : "/" + lang}/${p ? p + "/" : ""}`;
        await page.goto(url, 150);
        // projet stranku dolu a zpet: animace pri scrollu (IntersectionObserver) se odkryji jako u ctenare
        await page.eval(SCROLL, true);
        const states = [["", null]];
        // mobilni menu otevrene se musi taky vejit
        if (v.w < 1024 && p === "") states.push(["-menu", "document.querySelector('.burger').click()"]);
        for (const [suffix, action] of states) {
          if (action) { await page.eval(action); await sleep(250); }
          const m = JSON.parse(await page.eval(PROBE));
          const tag = `${lang}/${p || "home"}${suffix} @ ${v.w}px`;
          const bad = m.overflowPx > 0 || m.culprits.length > 0;
          if (bad) {
            problems.push(tag);
            console.log(`  PRETEKA  ${tag}: +${m.overflowPx}px ${JSON.stringify(m.culprits)}`);
          } else {
            console.log(`  ok       ${tag}`);
          }
          await page.screenshot(path.join(OUT, `${lang}-${p || "home"}${suffix}-${v.name}.png`));
        }
      }
    }
  }
} finally {
  browser.close();
}
console.log(`\nHotovo. Preteceni: ${problems.length}. Snimky v _shots/`);
process.exit(problems.length ? 1 : 0);
