#!/usr/bin/env node
// Lokalni nahled hotoveho dist/ VCETNE API: /api/* obslouzi primo worker/index.js
// nad SQLite v pameti (vyvojovy rezim, zadne e-maily ani Turnstile).
// Spusteni: node scripts/serve.js [port]  -> http://localhost:4173/

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../worker/index.js";
import { localEnv } from "./local-env.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.argv[2]) || 4173;
const env = localEnv({ PUBLIC_SITE: `http://localhost:${PORT}` });

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
};

async function api(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(
    new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers: req.headers, body }),
    env
  );
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}

http
  .createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      api(req, res).catch((e) => res.writeHead(500).end(String(e)));
      return;
    }
    const clean = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(DIST, clean);
    if (!file.startsWith(DIST)) return res.writeHead(403).end("Forbidden");
    if (!path.extname(file)) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) {
      res.writeHead(404, { "Content-Type": TYPES[".html"] });
      return fs.createReadStream(path.join(DIST, "404.html")).pipe(res);
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`Nahled bezi na http://localhost:${PORT}/ (API ve vyvojovem rezimu)`));
