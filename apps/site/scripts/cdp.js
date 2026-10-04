// Headless Edge (nebo Chrome) pres Chrome DevTools Protocol. Bez zavislosti:
// WebSocket a fetch jsou v Node 22+ vestavene.
//   const b = await launch();  const page = await b.page();
//   await page.goto(url);  await page.eval("document.title");  b.close();

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CANDIDATES = [
  process.env.BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const b = CANDIDATES.find((p) => fs.existsSync(p));
  if (!b) throw new Error("Nenasel jsem Edge ani Chrome. Cestu zadej v promenne BROWSER.");
  return b;
}

async function waitJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("Prohlizec nenastartoval");
}

class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    this.handlers = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.waiting.has(m.id)) {
        const { resolve, reject } = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method && this.handlers.has(m.method)) {
        const hs = this.handlers.get(m.method);
        this.handlers.delete(m.method);
        hs.forEach((h) => h(m.params));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method) {
    return new Promise((r) => {
      const hs = this.handlers.get(method) || [];
      hs.push(r);
      this.handlers.set(method, hs);
    });
  }
  async goto(url, settle = 300) {
    const loaded = this.once("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
    await this.eval("document.fonts ? document.fonts.ready.then(() => true) : true", true);
    await sleep(settle);
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) {
      throw new Error("JS: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
  async viewport(w, h) {
    await this.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 800 });
  }
  async screenshot(file) {
    const s = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    fs.writeFileSync(file, Buffer.from(s.data, "base64"));
  }
}

export async function launch(port = 9300 + Math.floor(Math.random() * 400)) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "plcdesk-cdp-"));
  const proc = spawn(
    findBrowser(),
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--allow-file-access-from-files",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  await waitJson(`http://127.0.0.1:${port}/json/version`);
  return {
    async page() {
      const targets = await waitJson(`http://127.0.0.1:${port}/json/list`);
      const t = targets.find((x) => x.type === "page");
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((r, j) => {
        ws.addEventListener("open", r);
        ws.addEventListener("error", j);
      });
      const p = new Page(ws);
      await p.send("Page.enable");
      await p.send("Runtime.enable");
      return p;
    },
    close() {
      proc.kill();
      setTimeout(() => {
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
      }, 800);
    },
  };
}
