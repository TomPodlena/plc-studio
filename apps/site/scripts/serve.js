#!/usr/bin/env node
// Lokalni nahled hotoveho dist/ VCETNE API: /api/* obslouzi primo worker/index.js
// nad SQLite v pameti (vyvojovy rezim, zadne e-maily ani Turnstile).
// Spusteni: node scripts/serve.js [port] [--demo]  -> http://localhost:4173/
// Sprava zakazniku: ADMIN_TOKEN=lokalni node scripts/serve.js --demo -> http://localhost:4173/sprava/
// (--demo = smyslena ukazkova data zakazniku; bez ADMIN_TOKEN je sprava zavrena jako v ostrem provozu)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../worker/index.js";
import { localEnv, seedDemo } from "./local-env.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || 4173;
// ASSETS jako na Cloudflare: Worker si jim bere /sprava (run_worker_first) a prida hlavicky
const env = localEnv({ PUBLIC_SITE: `http://localhost:${PORT}`, ASSETS: { fetch: async (req) => staticResponse(new URL(req.url).pathname) } });
if (process.argv.includes("--demo")) seedDemo(env.DB.db);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".woff2": "font/woff2",
};

// Ostry klic Turnstile plati jen pro domenu webu - lokalne ho nahradi testovaci klic Cloudflare
// (dist/ pro nasazeni zustava beze zmeny).
const TURNSTILE_TEST_SITEKEY = "1x00000000000000000000AA";
const testSitekey = (html) => html.replace(/data-sitekey="[^"]*"/g, `data-sitekey="${TURNSTILE_TEST_SITEKEY}"`);

async function api(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(
    new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers: req.headers, body }),
    env
  );
  await send(res, r);
}

// Staticky soubor z dist/ jako Response (html_handling auto-trailing-slash, 404 stranka)
function staticResponse(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  let file = path.join(DIST, clean);
  if (!file.startsWith(DIST)) return new Response("Forbidden", { status: 403 });
  if (!path.extname(file)) {
    if (!clean.endsWith("/") && fs.existsSync(path.join(file, "index.html"))) {
      return new Response(null, { status: 307, headers: { Location: clean + "/" } });
    }
    file = path.join(file, "index.html");
  }
  if (!fs.existsSync(file)) {
    return new Response(testSitekey(fs.readFileSync(path.join(DIST, "404.html"), "utf-8")), { status: 404, headers: { "Content-Type": TYPES[".html"] } });
  }
  const type = TYPES[path.extname(file)] || "application/octet-stream";
  const body = path.extname(file) === ".html" ? testSitekey(fs.readFileSync(file, "utf-8")) : fs.readFileSync(file);
  return new Response(body, { status: 200, headers: { "Content-Type": type } });
}

async function send(res, r) {
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}

http
  .createServer((req, res) => {
    const p = req.url.split("?")[0];
    if (req.url.startsWith("/api/") || p === "/sprava" || p.startsWith("/sprava/")) {
      api(req, res).catch((e) => res.writeHead(500).end(String(e)));
      return;
    }
    send(res, staticResponse(req.url)).catch((e) => res.writeHead(500).end(String(e)));
  })
  .listen(PORT, () => console.log(`Nahled bezi na http://localhost:${PORT}/ (API ve vyvojovem rezimu)` +
    (env.ADMIN_TOKEN ? `, sprava http://localhost:${PORT}/sprava/` : "")));
