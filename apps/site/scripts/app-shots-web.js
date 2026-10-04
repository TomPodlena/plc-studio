#!/usr/bin/env node
// Snimky webove aplikace (apps/web) pro web - volano z scripts/app-shots.py.
// Spusti maly staticky server nad korenem repozitare (web aplikace nacita packages/core/dist),
// otevre aplikaci v headless Edge v kazdem jazyce (?lang=..., prazdne uloziste = ukazkova
// linka LL-03) a nafoti zvolene kroky v okne 1440x900.
// Spusteni: node scripts/app-shots-web.js <slozka-png> [cs en de]

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./cdp.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.join(ROOT, "..", "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "_app_shots"));
const LANGS = process.argv.slice(3).length ? process.argv.slice(3) : ["cs", "en", "de"];
// klic snimku -> index kroku webove aplikace (0 = Projekt ... 5 = Schema, 7 = Generovat)
const SHOTS = [["web-schema", 5]];
const W = 1440, H = 900;

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css",
  ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let f = path.join(REPO, p);
  if (!f.startsWith(REPO)) return res.writeHead(403).end();
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/apps/web/`;

fs.mkdirSync(OUT, { recursive: true });
const browser = await launch();
try {
  const page = await browser.page();
  await page.viewport(W, H);
  for (const lang of LANGS) {
    await page.goto(`${base}?lang=${lang}`, 300);
    await page.eval("localStorage.clear(), true"); // cista navsteva = ukazka v jazyce aplikace
    await page.goto(`${base}?lang=${lang}`, 600);
    for (const [key, step] of SHOTS) {
      await page.eval(`document.querySelector('#stepper button[data-i="${step}"]').click(), true`);
      await sleep(900);
      await page.eval("scrollTo(0, 0), true");
      const s = await page.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
      const file = path.join(OUT, `${key}-${lang}.png`);
      fs.writeFileSync(file, Buffer.from(s.data, "base64"));
      console.log(`  ${key}-${lang}.png`);
    }
  }
} finally {
  browser.close();
  server.close();
}
