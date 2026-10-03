#!/usr/bin/env node
// Slozi z hotoveho dist/ JEDEN samostatny HTML soubor s CELYM webem ve vsech jazycich -
// ke schvaleni (poslat e-mailem, otevrit z disku). Odkazy a prepinac jazyka uvnitr funguji,
// CSS, obrazky i ukazkova PDF jsou vlozene. Formular v nahledu nic neodesila.
// Spusteni: node scripts/preview.js [vystup.html]   (vychozi: preview.html)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "preview.html"));

if (!fs.existsSync(DIST)) {
  console.error("Nejdriv spust: node scripts/build.js");
  process.exit(1);
}

const LANGS = ["cs", "en", "de"];
const KEYS = ["home", "funkce", "platformy", "cenik", "ukazka", "stazeni", "kontakt", "podminky", "soukromi", "cookies"];
const out = (k) => (k === "home" ? "" : k);
const pages = [];
for (const lang of LANGS) {
  for (const key of KEYS) {
    const url = `${lang === "cs" ? "" : "/" + lang}/${out(key) ? out(key) + "/" : ""}`;
    pages.push({ lang, key, url, id: `${lang}-${key}` });
  }
}
const content = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(ROOT, "content", `${l}.json`), "utf-8"))]));
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "site.json"), "utf-8"));

const readPage = (url) => fs.readFileSync(path.join(DIST, url.replace(/^\//, ""), "index.html"), "utf-8");
const between = (s, a, b) => {
  const i = s.indexOf(a);
  return s.slice(i + a.length, s.indexOf(b, i));
};

// ---- soubory (obrazky, PDF): kazdy JEDNOU, v HTML jen klic ----
const assets = new Map();
const key = (u) => {
  if (!assets.has(u)) assets.set(u, "a" + assets.size);
  return assets.get(u);
};
const PIX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const urlToId = new Map(pages.map((p) => [p.url, p.id]));
const dead = new Set();
function rewrite(html, lang) {
  return html
    .replace(/ loading="lazy"/g, "") // skryte sekce by se jinak nikdy nenacetly
    .replace(/data-sitekey="[^"]*"/g, 'data-sitekey="1x00000000000000000000AA"') // nahled: testovaci klic Turnstile
    .replace(/src="(\/assets\/[^"]+)"/g, (m, u) => `src="${PIX}" data-asset="${key(u)}"`)
    .replace(/href="(\/assets\/[^"]+)"/g, (m, u) => `href="#" data-asset-href="${key(u)}" data-name="${path.basename(u)}"`)
    .replace(/href="(\/[^"#]*)"/g, (m, u) => {
      const id = urlToId.get(u.split("?")[0]);
      if (id) return `href="#pv-${id}"`;
      dead.add(u);
      return `href="#pv-${lang}-home" data-dead="${u}"`;
    });
}

const blocks = [];
for (const lang of LANGS) {
  const lp = pages.filter((p) => p.lang === lang);
  const first = readPage(lp[0].url);
  const header = between(first, '<header class="site-head">', "</header>");
  const footer = between(first, '<footer class="site-foot">', "</footer>");
  const sections = lp
    .map((p) => `<section class="pv-page" id="pv-${p.id}" data-key="${p.key}" hidden>${rewrite(between(readPage(p.url), '<main id="main">', "</main>"), lang)}</section>`)
    .join("\n");
  blocks.push(
    `<div class="pv-lang" data-lang="${lang}" lang="${lang}" hidden>\n` +
      `<header class="site-head">${rewrite(header, lang)}</header>\n<main>\n${sections}\n</main>\n` +
      `<footer class="site-foot">${rewrite(footer, lang)}</footer>\n</div>`
  );
}

const TYPES = { ".svg": "image/svg+xml", ".pdf": "application/pdf", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2" };
const assetMap = {};
for (const [u, k] of assets) {
  const f = path.join(DIST, u.replace(/^\//, ""));
  if (!fs.existsSync(f)) {
    dead.add(u);
    continue;
  }
  assetMap[k] = `data:${TYPES[path.extname(f)] || "application/octet-stream"};base64,${fs.readFileSync(f).toString("base64")}`;
}

// CSS: pisma a obrazky z url(/assets/...) vlozit jako data: URI (nahled se otevira z disku)
const css = fs.readFileSync(path.join(DIST, "assets", "style.css"), "utf-8").replace(/url\((["']?)(\/assets\/[^"')]+)\1\)/g, (m, q, u) => {
  const f = path.join(DIST, u.replace(/^\//, ""));
  if (!fs.existsSync(f)) {
    dead.add(u);
    return m;
  }
  return `url("data:${TYPES[path.extname(f)] || "application/octet-stream"};base64,${fs.readFileSync(f).toString("base64")}")`;
});
const baseScript = between(readPage("/"), "// Mobilni menu", "</script>");
const LABEL = Object.fromEntries(LANGS.map((l) => [l, Object.fromEntries(KEYS.map((k) => [k, content[l].nav[k]]))]));
const favicon = `data:image/svg+xml;base64,${fs.readFileSync(path.join(DIST, "assets", "img", "favicon.svg")).toString("base64")}`;

const html = `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${site.brand} Web — náhled</title>
<link rel="icon" type="image/svg+xml" href="${favicon}">
<style>
${css}
/* --- jen pro nahled --- */
.pv-note { background: #fff6d6; border-bottom: 1px solid #e6d58f; padding: 8px 16px; font-size: 13px; text-align: center; }
.pv-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 80; background: var(--dark); display: flex; gap: 4px;
  overflow-x: auto; padding: 8px 10px; border-top: 1px solid var(--dark-line); font: 500 12px/1 var(--mono); }
@media (min-width: 1100px) { .pv-bar { justify-content: center; } }
.pv-bar button { flex: 0 0 auto; background: none; border: 1px solid transparent; color: var(--dark-muted); padding: 7px 10px; cursor: pointer; font: inherit; border-radius: 4px; white-space: nowrap; }
.pv-bar button:hover { color: var(--dark-ink); }
.pv-bar button.on { background: var(--dark-ink); color: var(--dark); }
.pv-bar .sep { flex: 0 0 1px; background: var(--dark-line); margin: 2px 6px; }
body { padding-bottom: 54px; }
</style>
</head>
<body>
<p class="pv-note">Náhled webu ${site.brand} ke schválení. Dole přepínáte stránky a jazyk. Formulář ani objednávka v náhledu nic neodesílají. Právní texty jsou návrh k revizi právníkem.</p>
${blocks.join("\n")}
<nav class="pv-bar" aria-label="Přepínač stránek"></nav>
<script>
var ASSETS = ${JSON.stringify(assetMap)};
var PAGES = ${JSON.stringify(pages.map((p) => ({ id: p.id, lang: p.lang, key: p.key })))};
var LANGS = ${JSON.stringify(LANGS)};
var KEYS = ${JSON.stringify(KEYS)};
var LABEL = ${JSON.stringify(LABEL)};

document.querySelectorAll("[data-asset]").forEach(function (el) {
  var d = ASSETS[el.dataset.asset];
  if (d) el.src = d;
});
// PDF a dalsi soubory: data: URI -> blob, at jde stahnout i otevrit
document.querySelectorAll("[data-asset-href]").forEach(function (a) {
  var d = ASSETS[a.dataset.assetHref];
  if (!d) return;
  var bin = atob(d.split(",")[1]), arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  a.href = URL.createObjectURL(new Blob([arr], { type: d.slice(5, d.indexOf(";")) }));
  a.setAttribute("download", a.dataset.name);
});

var bar = document.querySelector(".pv-bar");
var current = "cs-home";
function exists(id) { return PAGES.some(function (p) { return p.id === id; }); }
function goLang(l) {
  var k = current.replace(/^[a-z]{2}-/, "");
  location.hash = "pv-" + (exists(l + "-" + k) ? l + "-" + k : l + "-home");
}
document.querySelectorAll(".langs a[hreflang]").forEach(function (a) {
  a.addEventListener("click", function (e) { e.preventDefault(); goLang(a.getAttribute("hreflang")); });
});
function build(lang) {
  bar.textContent = "";
  KEYS.forEach(function (k) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = LABEL[lang][k];
    b.dataset.go = lang + "-" + k;
    b.addEventListener("click", function () { location.hash = "pv-" + b.dataset.go; });
    bar.appendChild(b);
  });
  var s = document.createElement("span"); s.className = "sep"; bar.appendChild(s);
  LANGS.forEach(function (l) {
    var b = document.createElement("button");
    b.type = "button"; b.textContent = l.toUpperCase(); b.dataset.lang = l;
    b.addEventListener("click", function () { goLang(l); });
    bar.appendChild(b);
  });
}
function show(id) {
  if (!exists(id)) id = "cs-home";
  current = id;
  var lang = id.slice(0, 2), k = id.slice(3);
  document.documentElement.lang = lang;
  document.querySelectorAll(".pv-lang").forEach(function (w) { w.hidden = w.dataset.lang !== lang; });
  document.querySelectorAll(".pv-page").forEach(function (s) { s.hidden = s.id !== "pv-" + id; });
  var vis = document.querySelector(".pv-lang:not([hidden])");
  vis.querySelectorAll(".langs a[hreflang]").forEach(function (a) {
    if (a.getAttribute("hreflang") === lang) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
  });
  vis.querySelectorAll(".nav-links a").forEach(function (a) {
    if (a.getAttribute("href") === "#pv-" + id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  var nav = vis.querySelector(".nav"), burger = vis.querySelector(".burger");
  if (nav) nav.classList.remove("is-open");
  if (burger) burger.setAttribute("aria-expanded", "false");
  build(lang);
  bar.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.go === id || b.dataset.lang === lang); });
  window.scrollTo(0, 0);
}
// kotvy uvnitr stranky (#navrh…) nechame byt, prepina jen #pv-…
window.addEventListener("hashchange", function () {
  if (location.hash.indexOf("#pv-") === 0) show(location.hash.slice(4));
});
show(location.hash.indexOf("#pv-") === 0 ? location.hash.slice(4) : "cs-home");

// Formular v nahledu nic neodesila
document.querySelectorAll("form[data-lead]").forEach(function (f) {
  f.addEventListener("submit", function (e) {
    e.preventDefault(); e.stopImmediatePropagation();
    var m = f.querySelector(".form-msg"); m.className = "form-msg"; m.textContent = "(Náhled: formulář se neodesílá.)";
  }, true);
});

${baseScript.replace(/document\.querySelector\("\.burger"\)/, 'document.querySelector(".pv-lang .burger")')}
// menu v nahledu: kazdy jazyk ma vlastni hlavicku
document.querySelectorAll(".pv-lang").forEach(function (w) {
  var b = w.querySelector(".burger"), n = w.querySelector(".nav");
  if (!b || !n || w.dataset.lang === "cs") return;
  b.addEventListener("click", function () {
    var open = b.getAttribute("aria-expanded") === "true";
    b.setAttribute("aria-expanded", String(!open));
    n.classList.toggle("is-open", !open);
  });
});
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
if (dead.size) {
  console.error("Mrtve odkazy:", [...dead].join(", "));
  process.exitCode = 1;
}
console.log(`Nahled: ${OUT}  ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB  (${pages.length} stranek, ${assets.size} souboru)`);
