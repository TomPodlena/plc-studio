#!/usr/bin/env node
// Build: templates/ + content/ -> dist/
// Bez zavislosti. Spusteni: node scripts/build.js   (musi koncit "0 varovani")
//
// Postup je prevzaty z webu NATA Atelier: sablona + JSON + {{tecka.cesta}}.
// Navic:
//   {{#each cesta}} ... {{/each}}   opakovani pro pole (uvnitr {{.pole}}, {{.}}, {{@n}} = 01, {{@i}} = 0)
//   {{cesta|li}}                    pole retezcu -> <li>…</li>
//   {{cesta|note}}                  nepovinny text -> <p class="note">…</p> (chybi = nic, bez varovani)
// Nazev znacky a adresa webu jsou jen v content/site.json; texty je pisou jako {{site.brand}}.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const TPL = path.join(ROOT, "templates");
export const LANGS = ["cs", "en", "de"]; // cs = zdroj pravdy, servirovana na /

const site = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "site.json"), "utf-8"));
const SITE_URL = (process.env.SITE_URL || site.url).replace(/\/$/, "");
site.url = SITE_URL;

// Verejny klic Turnstile smi byt v repozitari (tajny protejsek je secret Workeru).
// Bez TURNSTILE_SITEKEY se pouzije testovaci klic Cloudflare, ktery pusti kazdeho.
const TURNSTILE_TEST_SITEKEY = "1x00000000000000000000AA";
const TURNSTILE_SITEKEY = process.env.TURNSTILE_SITEKEY || TURNSTILE_TEST_SITEKEY;

// Stranky: klic = sablona i klic obsahu; out = cesta bez jazykoveho prefixu
export const PAGES = [
  { key: "home", out: "" },
  { key: "funkce", out: "funkce" },
  { key: "platformy", out: "platformy" },
  { key: "cenik", out: "cenik" },
  { key: "ukazka", out: "ukazka" },
  { key: "stazeni", out: "stazeni" },
  { key: "kontakt", out: "kontakt" },
  { key: "podminky", out: "podminky", tpl: "legal" },
  { key: "soukromi", out: "soukromi", tpl: "legal" },
  { key: "cookies", out: "cookies", tpl: "legal" },
];
const IN_MENU = ["funkce", "platformy", "cenik", "ukazka", "kontakt"];

let warnings = 0;
function warn(msg) {
  console.warn("  WARN " + msg);
  warnings++;
}

// ---------- pomocne ----------

const get = (obj, p) => p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const prefix = (lang) => (lang === "cs" ? "" : `/${lang}`);
export const url = (lang, out) => (out === "" ? `${prefix(lang)}/` : `${prefix(lang)}/${out}/`);

function brandLogo(b) {
  const m = /^([A-Z]+)(.+)$/.exec(b);
  return m ? `<b>${esc(m[1])}</b>${esc(m[2])}` : esc(b);
}

const FILTERS = {
  li: (v) => (Array.isArray(v) ? v.map((x) => `<li>${x}</li>`).join("") : undefined),
  note: (v) => (v ? `<p class="note">${v}</p>` : ""),
  // odstavce; polozky zacinajici "- " se slozi do seznamu
  p: (v) => {
    if (!Array.isArray(v)) return undefined;
    let out = "", ul = [];
    const flush = () => { if (ul.length) out += `<ul class="ticks">${ul.map((x) => `<li>${x}</li>`).join("")}</ul>`; ul = []; };
    for (const x of v) { if (x.startsWith("- ")) ul.push(x.slice(2)); else { flush(); out += `<p>${x}</p>`; } }
    flush();
    return out;
  },
};
const OPTIONAL = new Set(["note"]);

// Hodnota s filtrem; undefined = chybi (varovani)
function value(src, expr, where) {
  const [p, filter] = expr.split("|");
  const v = p === "" ? src : get(src, p);
  if (filter) {
    if (!FILTERS[filter]) {
      warn(`${where}: neznamy filtr ${filter}`);
      return "";
    }
    if (v === undefined && OPTIONAL.has(filter)) return "";
    if (v === undefined) return undefined;
    return FILTERS[filter](v);
  }
  return v;
}

function expandEach(html, ctx, where) {
  const re = /\{\{#each ([a-z0-9_.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
  return html.replace(re, (m, p, body) => {
    const arr = get(ctx, p);
    if (!Array.isArray(arr)) {
      warn(`${where}: {{#each ${p}}} neni pole`);
      return "";
    }
    return arr
      .map((item, i) =>
        body
          .replace(/\{\{@n\}\}/g, String(i + 1).padStart(2, "0"))
          .replace(/\{\{@i\}\}/g, String(i))
          .replace(/\{\{\.\}\}/g, () => (typeof item === "string" ? item : (warn(`${where}: {{.}} na objektu`), "")))
          .replace(/\{\{\.([a-z0-9_.|]+)\}\}/g, (mm, e) => {
            const v = value(item, e, where);
            if (v === undefined) {
              warn(`${where}: chybi polozka .${e} v ${p}[${i}]`);
              return "";
            }
            return v;
          })
      )
      .join("");
  });
}

function fillVars(html, ctx, where) {
  return html.replace(/\{\{([a-z0-9_.|]+)\}\}/g, (m, e) => {
    const v = value(ctx, e, where);
    if (v === undefined || (typeof v === "object" && !Array.isArray(v))) {
      warn(`${where}: chybi klic ${e}`);
      return "";
    }
    return Array.isArray(v) ? v.join(", ") : String(v);
  });
}

// ---------- kontrola obsahu ----------

// Struktura vsech jazyku musi byt shodna s cestinou (stejne klice, stejne delky poli)
function sameShape(a, b, p, lang) {
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return warn(`${lang}: ${p} ma byt pole`);
    if (a.length !== b.length) warn(`${lang}: ${p} ma ${b.length} polozek, cestina ${a.length}`);
    a.forEach((x, i) => b[i] !== undefined && sameShape(x, b[i], `${p}[${i}]`, lang));
    return;
  }
  if (a && typeof a === "object") {
    if (!b || typeof b !== "object") return warn(`${lang}: ${p} ma byt objekt`);
    for (const k of Object.keys(a)) {
      if (!(k in b)) warn(`${lang}: chybi klic ${p}.${k}`);
      else sameShape(a[k], b[k], `${p}.${k}`, lang);
    }
    for (const k of Object.keys(b)) if (!(k in a)) warn(`${lang}: prebyva klic ${p}.${k}`);
    return;
  }
  if (typeof a !== typeof b) warn(`${lang}: ${p} ma jiny typ nez v cestine`);
}

function checkContent(c, lang) {
  const raw = JSON.stringify(c);
  // znacka jen v site.json
  if (raw.includes(site.brand)) warn(`${lang}.json: nazev znacky napsany primo, pouzij {{site.brand}}`);
  if (lang !== "cs" && /Kč|CZK/.test(raw)) warn(`${lang}.json: obsahuje Kč (ceny mimo cestinu v EUR)`);
}

// ---------- render ----------

const templates = {};
for (const f of fs.readdirSync(TPL)) {
  if (f.endsWith(".html")) templates[f.replace(/\.html$/, "")] = fs.readFileSync(path.join(TPL, f), "utf-8");
}

function navBlock(c, lang, active) {
  return IN_MENU.map((k) => {
    const cur = k === active ? ' aria-current="page"' : "";
    return `<a href="${url(lang, PAGES.find((p) => p.key === k).out)}"${cur}>${esc(c.nav[k])}</a>`;
  }).join("\n        ");
}

function langSwitch(lang, out) {
  return LANGS.map((l) => {
    const cur = l === lang ? ' aria-current="true"' : "";
    return `<a href="${url(l, out)}"${cur} hreflang="${l}" lang="${l}">${l.toUpperCase()}</a>`;
  }).join("\n        ");
}

function render(tpl, c, lang, key, out) {
  const where = `${lang}/${key}`;
  const ctx = { ...c, site, page: c[key] };
  let html = templates._base.replace("{{BODY}}", templates[tpl]);

  html = expandEach(html, ctx, where);

  const hreflang =
    LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${SITE_URL}${url(l, out)}">`).join("\n") +
    `\n<link rel="alternate" hreflang="x-default" href="${SITE_URL}${url("cs", out)}">`;

  const blocks = {
    "BLOCK.key": key,
    "BLOCK.title": (c[key] && c[key].title) || c.meta.title,
    "BLOCK.description": (c[key] && c[key].description) || c.meta.description,
    "BLOCK.hreflang": key === "notfound" ? "" : hreflang,
    "BLOCK.canonical": `${SITE_URL}${url(lang, out)}`,
    "BLOCK.robots": key === "notfound" ? '<meta name="robots" content="noindex">' : "",
    "BLOCK.nav": navBlock(c, lang, key),
    "BLOCK.langswitch": langSwitch(lang, out),
    "BLOCK.brand_logo": brandLogo(site.brand),
    "BLOCK.turnstile_sitekey": TURNSTILE_SITEKEY,
    "BLOCK.year": String(new Date().getFullYear()),
    "BLOCK.checked_date": new Intl.DateTimeFormat(c.meta.locale.replace("_", "-"), { dateStyle: "long" }).format(
      new Date(site.platforms_checked + "T12:00:00Z")
    ),
  };
  for (const p of PAGES) blocks[`BLOCK.url_${p.key}`] = url(lang, p.out);
  for (const [k, v] of Object.entries(blocks)) html = html.split(`{{${k}}}`).join(v);

  // texty mohou obsahovat {{site.*}} - proto vic pruchodu
  for (let i = 0; i < 3 && /\{\{[a-z]/.test(html); i++) html = fillVars(html, ctx, where);
  const left = html.match(/\{\{[^}]*\}\}/g);
  if (left) warn(`${where}: nenahrazeno ${[...new Set(left)].join(" ")}`);
  return html;
}

// ---------- objednavka (Stripe Payment Links / Paddle overlay checkout) ----------
// Volba poskytovatele: site.json payments.provider (nebo PAYMENT_PROVIDER pri buildu);
// musi sedet s PAYMENT_PROVIDER ve wrangler.toml. Bez volby vedou tlacitka na Kontakt.
const PAY = { ...site.payments, provider: process.env.PAYMENT_PROVIDER ?? site.payments?.provider ?? "" };
if (!["", "stripe", "paddle"].includes(PAY.provider)) warn(`payments.provider "${PAY.provider}" neni stripe ani paddle`);

function checkout(html, lang) {
  const paddle = PAY.provider === "paddle";
  for (const plan of ["pro", "firma"]) {
    let attrs = `href="${url(lang, "kontakt")}"`;
    if (PAY.provider === "stripe") {
      const link = PAY[`stripe_link_${plan}`];
      if (!link) warn(`${lang}/cenik: chybi payments.stripe_link_${plan}`);
      else attrs = `href="${esc(link)}${link.includes("?") ? "&" : "?"}client_reference_id=${lang}" rel="noopener"`;
    } else if (paddle) {
      const price = PAY[`paddle_price_${plan}`];
      if (!price || !PAY.paddle_client_token) warn(`${lang}/cenik: chybi payments.paddle_price_${plan} nebo paddle_client_token`);
      else attrs = `href="#objednat" data-paddle-price="${esc(price)}"`;
    }
    html = html.replace(new RegExp(`data-plan="${plan}" href="[^"]*"`), `data-plan="${plan}" ${attrs}`);
  }
  if (paddle && PAY.paddle_client_token) {
    const sandbox = PAY.paddle_client_token.startsWith("test_");
    html = html.replace(
      "</body>",
      `<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
<script>
(function () {
  if (!window.Paddle) return;
  ${sandbox ? 'Paddle.Environment.set("sandbox");' : ""}
  Paddle.Initialize({ token: ${JSON.stringify(PAY.paddle_client_token)} });
  document.querySelectorAll("[data-paddle-price]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      Paddle.Checkout.open({
        items: [{ priceId: a.dataset.paddlePrice, quantity: 1 }],
        customData: { plan: a.dataset.plan, locale: ${JSON.stringify(lang)} },
        settings: { locale: ${JSON.stringify(lang)} }
      });
    });
  });
})();
</script>
</body>`
    );
  }
  return html;
}

function writePage(lang, out, html) {
  const dir = path.join(DIST, prefix(lang).replace(/^\//, ""), out);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
}

// ---------- beh ----------

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const content = Object.fromEntries(
  LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(ROOT, "content", `${l}.json`), "utf-8"))])
);
for (const l of LANGS) {
  checkContent(content[l], l);
  if (l !== "cs") sameShape(content.cs, content[l], "", l);
}

const urls = [];
for (const lang of LANGS) {
  const c = content[lang];
  for (const p of PAGES) {
    let html = render(p.tpl || p.key, c, lang, p.key, p.out);
    if (p.key === "cenik") html = checkout(html, lang);
    writePage(lang, p.out, html);
    urls.push(`${SITE_URL}${url(lang, p.out)}`);
  }
  console.log(`Built ${lang}: ${PAGES.length} stranek`);
}
// 404 (Worker ho vraci pro neznamou adresu - viz not_found_handling ve wrangler.toml)
fs.writeFileSync(path.join(DIST, "404.html"), render("notfound", content.cs, "cs", "notfound", ""));

fs.writeFileSync(
  path.join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`
);
fs.writeFileSync(path.join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

for (const dir of ["assets", "admin", "ukazka"]) {
  const src = path.join(ROOT, dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(DIST, dir), { recursive: true });
}

// mrtve odkazy: kazde href/src zacinajici "/" musi v dist existovat (krome /api/)
function exists(u) {
  const clean = decodeURIComponent(u.split(/[?#]/)[0]);
  if (clean.startsWith("/api/")) return true;
  const f = path.join(DIST, clean);
  return fs.existsSync(f) && (fs.statSync(f).isFile() || fs.existsSync(path.join(f, "index.html")));
}
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (e.name.endsWith(".html") && !f.includes(`${path.sep}admin${path.sep}`)) out.push(f);
  }
  return out;
}
for (const f of walk(DIST)) {
  const html = fs.readFileSync(f, "utf-8");
  for (const m of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
    if (!exists(m[1])) warn(`${path.relative(DIST, f)}: mrtvy odkaz ${m[1]}`);
  }
}

// administrace (Sveltia CMS) musi odpovidat strukture textu
try {
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "cms-config.js"), "--check"], { stdio: "pipe" });
} catch {
  warn("admin/config.yml neodpovida content/cs.json - spust: node scripts/cms-config.js");
}

if (TURNSTILE_SITEKEY === TURNSTILE_TEST_SITEKEY) {
  console.log("\n  POZOR: Turnstile bezi na TESTOVACIM klici (pusti kazdeho). Ostry klic: TURNSTILE_SITEKEY=... pri buildu.");
}
// Provozovatel a ucinnost pravnich textu: dokud je "TBC", jen upozorneni (ne chyba, ne varovani buildu)
const tbc = [
  ...Object.entries(site.operator || {}).filter(([, v]) => v === "TBC").map(([k]) => `operator.${k}`),
  ...(site.legal_effective === "TBC" ? ["legal_effective"] : []),
];
if (tbc.length) console.log(`  POZOR: v content/site.json zustava TBC: ${tbc.join(", ")} (pravni stranky to zobrazi).`);
if (!PAY.provider) console.log("  POZOR: platby vypnute (payments.provider prazdne) - tlacitka Pro/Firma vedou na Kontakt.");
if (/UCET/.test(SITE_URL)) {
  console.log(`  POZOR: adresa webu je zastupna (${SITE_URL}). Ostra: content/site.json nebo SITE_URL=... pri buildu.`);
}

console.log(`\nHotovo. ${urls.length} URL, ${warnings} varovani.`);
process.exitCode = warnings ? 1 : 0;
