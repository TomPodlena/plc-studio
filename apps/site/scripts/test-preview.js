#!/usr/bin/env node
// Proklika jednosouborovy nahled ve vsech jazycich v headless Edge (CDP) a overi odkazy,
// prepinani jazyku, menu na mobilu, obrazky a PDF. Druha cast zkousi ostry lokalni web
// (scripts/serve.js): formular ke stazeni, past na boty, odkaz z e-mailu, stranku 404.
// Viditelnost se meri pres getClientRects(), ne pres atribut hidden (CSS ho muze prebit).
//
// Spusteni: node scripts/test-preview.js [nahled.html]     (BASE=http://localhost:4173)

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch, sleep } from "./cdp.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.resolve(process.argv[2] || path.join(ROOT, "preview.html"));
const BASE = process.env.BASE || "http://localhost:4173";
const LANGS = ["cs", "en", "de"];
const KEYS = ["home", "funkce", "platformy", "cenik", "ukazka", "stazeni", "kontakt", "podminky", "soukromi", "cookies"];

let fails = 0;
function check(label, got, want) {
  const ok = typeof want === "function" ? want(got) : got === want;
  if (!ok) fails++;
  console.log(`  ${ok ? "ok   " : "CHYBA"} ${label}: ${typeof got === "string" ? got : JSON.stringify(got)}`);
}

const browser = await launch();
try {
  const page = await browser.page();
  const js = (e) => page.eval(e);
  const vis = "(()=>{const s=[...document.querySelectorAll('.pv-page')].filter(s=>s.getClientRects().length);return s.map(x=>x.id).join(',')})()";
  const shown = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>e.getClientRects().length).length`;

  if (!fs.existsSync(FILE)) throw new Error("Nahled neexistuje: " + FILE);
  await page.viewport(1440, 900);
  await page.goto(pathToFileURL(FILE).href, 600);

  console.log("\nnahled: zakladni stav");
  check("po nacteni je videt prave jedna stranka", await js(vis), "pv-cs-home");
  check("mrtve odkazy", await js("document.querySelectorAll('[data-dead]').length"), 0);
  check("obrazky bez vlozeneho zdroje", await js("[...document.querySelectorAll('[data-asset]')].filter(i=>!i.src.startsWith('data:image')).length"), 0);
  check("obrazky se vykreslily", await js("[...document.querySelectorAll('.pv-page img')].filter(i=>i.naturalWidth===0).length"), 0);
  check("PDF odkazy jsou blob", await js("[...document.querySelectorAll('[data-asset-href]')].filter(a=>!a.href.startsWith('blob:')).length"), 0);

  for (const lang of LANGS) {
    console.log(`\nnahled: jazyk ${lang}`);
    // spodni lista: nejdriv jazyk, pak kazda stranka
    await js(`[...document.querySelectorAll('.pv-bar button')].find(b=>b.dataset.lang==='${lang}').click()`);
    await sleep(120);
    check(`lista -> jazyk ${lang} (stranka zustava)`, await js(vis), (v) => v.startsWith(`pv-${lang}-`));
    for (const k of KEYS) {
      await js(`[...document.querySelectorAll('.pv-bar button')].find(b=>b.dataset.go==='${lang}-${k}').click()`);
      await sleep(120);
      check(`lista -> ${k}`, await js(vis), `pv-${lang}-${k}`);
      const h1 = await js(`(document.querySelector('#pv-${lang}-${k} h1')||{}).textContent||''`);
      if (!h1.trim()) check(`${k}: nadpis h1`, h1, (v) => v.trim().length > 0);
      if (lang !== "cs") {
        const cz = await js(`(document.querySelector('#pv-${lang}-${k}').innerText.match(/[ěščřžůňťďĚŠČŘŽŮ][^\\n]{0,40}/)||[''])[0]`);
        if (cz) check(`${k}: zadna cestina v textu`, cz, "");
      }
    }
    // menu v hlavicce
    await js(`location.hash='#pv-${lang}-home'`);
    await sleep(120);
    const navCount = await js(`document.querySelectorAll('.pv-lang[data-lang=${lang}] .nav-links a').length`);
    for (let i = 0; i < navCount; i++) {
      const href = await js(`document.querySelectorAll('.pv-lang[data-lang=${lang}] .nav-links a')[${i}].getAttribute('href')`);
      await js(`document.querySelectorAll('.pv-lang[data-lang=${lang}] .nav-links a')[${i}].click()`);
      await sleep(120);
      check(`menu ${href}`, await js(vis), href.slice(1));
      check(`  aktivni polozka menu`, await js(`(document.querySelector('.pv-lang[data-lang=${lang}] .nav-links a[aria-current]')||{}).getAttribute?.('href')||''`), href);
    }
    // tlacitko v hero vede na stazeni
    await js(`location.hash='#pv-${lang}-home'`);
    await sleep(120);
    await js(`document.querySelector('#pv-${lang}-home .hero .btn').click()`);
    await sleep(120);
    check("hero tlacitko -> stazeni", await js(vis), `pv-${lang}-stazeni`);
    // FAQ se rozbali
    await js(`location.hash='#pv-${lang}-home'`);
    await sleep(120);
    await js(`document.querySelector('#pv-${lang}-home details.faq summary').click()`);
    check("FAQ se rozbali", await js(`document.querySelector('#pv-${lang}-home details.faq').open`), true);
    // kotva v obsahu stranky Funkce neprepne stranku
    await js(`location.hash='#pv-${lang}-funkce'`);
    await sleep(120);
    await js(`document.querySelector('#pv-${lang}-funkce .toc a[href="#bezpecnost"]').click()`);
    await sleep(200);
    check("kotva #bezpecnost zustane na Funkcich", await js(vis), `pv-${lang}-funkce`);
  }

  console.log("\nnahled: prepinac jazyka drzi stranku");
  await js(`location.hash='#pv-cs-cenik'`);
  await sleep(120);
  for (const l of ["en", "de", "cs"]) {
    await js(`[...document.querySelectorAll('.pv-lang:not([hidden]) .langs a')].find(a=>a.getAttribute('hreflang')==='${l}').click()`);
    await sleep(150);
    check(`hlavicka ${l.toUpperCase()}`, await js(vis), `pv-${l}-cenik`);
  }

  console.log("\nnahled: mobil 390 px");
  await page.viewport(390, 844);
  await js(`location.hash='#pv-de-home'`);
  await sleep(200);
  check("menu zavrene", await js(shown(".pv-lang[data-lang=de] .nav-links a")), 0);
  await js(`document.querySelector('.pv-lang[data-lang=de] .burger').click()`);
  await sleep(200);
  check("burger otevre menu", await js(shown(".pv-lang[data-lang=de] .nav-links a")), (n) => n >= 5);
  await js(`document.querySelectorAll('.pv-lang[data-lang=de] .nav-links a')[2].click()`);
  await sleep(200);
  check("klik v menu prepne stranku", await js(vis), "pv-de-cenik");
  check("a menu zavre", await js(shown(".pv-lang[data-lang=de] .nav-links a")), 0);
  check("bez vodorovneho preteceni", await js("document.documentElement.scrollWidth - document.documentElement.clientWidth"), 0);

  // ---------------- ostry lokalni web ----------------
  console.log(`\nlokalni web ${BASE}`);
  let live = true;
  try {
    const r = await fetch(BASE + "/");
    live = r.ok;
  } catch {
    live = false;
  }
  if (!live) {
    console.log("  (preskoceno - bezi node scripts/serve.js?)");
    fails++;
  } else {
    await page.viewport(1280, 900);
    for (const lang of LANGS) {
      const pre = lang === "cs" ? "" : "/" + lang;
      await page.goto(`${BASE}${pre}/stazeni/`, 300);
      await sleep(3200); // past na boty: pod 3 s server formular "tise pusti"
      await js(`document.querySelector('#email').value='test-${lang}@firma.cz'`);
      await js(`document.querySelector('form[data-lead] button[type=submit]').click()`);
      await sleep(300);
      check(`${lang}: bez souhlasu s podminkami chyba, nic neodeslano`, await js(`document.querySelector('.form-msg').className + ':' + document.querySelectorAll('.form-msg a').length`), "form-msg err:0");
      await js(`document.querySelector('[name=consent]').click()`);
      await js(`document.querySelector('form[data-lead] button[type=submit]').click()`);
      await sleep(900);
      check(`${lang}: formular -> odkaz ke stazeni`, await js(`(document.querySelector('.form-msg a')||{}).getAttribute?.('href')||document.querySelector('.form-msg').textContent`), (v) => /^\/api\/download\?t=/.test(v));
      check(`${lang}: zprava je ok`, await js(`document.querySelector('.form-msg').className`), "form-msg ok");
    }
    // past na boty: vyplnene skryte pole -> ok, ale zadny odkaz
    await page.goto(`${BASE}/stazeni/`, 300);
    await sleep(3200);
    await js(`document.querySelector('#web').value='http://spam'; document.querySelector('#email').value='bot@spam.cz'; document.querySelector('[name=consent]').checked=true`);
    await js(`document.querySelector('form[data-lead] button[type=submit]').click()`);
    await sleep(900);
    check("bot (honeypot): ok bez odkazu", await js(`document.querySelectorAll('.form-msg a').length + ':' + document.querySelector('.form-msg').className`), "0:form-msg ok");
    // prilis rychle odeslani
    await page.goto(`${BASE}/stazeni/`, 50);
    await js(`document.querySelector('#email').value='rychly@spam.cz'; document.querySelector('[name=consent]').checked=true; document.querySelector('form[data-lead] button[type=submit]').click()`);
    await sleep(900);
    check("bot (pod 3 s): ok bez odkazu", await js(`document.querySelectorAll('.form-msg a').length`), 0);
    // odkaz z e-mailu
    await page.goto(`${BASE}/en/stazeni/?t=AbCdEfGhIjKlMnOpQrStUvWx`, 200);
    check("odkaz z e-mailu ukaze tlacitko", await js(shown("[data-token-box] a")), 1);
    check("  mirici na /api/download", await js(`document.querySelector('[data-token-box] a').getAttribute('href')`), (v) => v.startsWith("/api/download?t=AbCd"));
    await page.goto(`${BASE}/stazeni/`, 200);
    check("bez tokenu je tlacitko skryte", await js(shown("[data-token-box]")), 0);
    check("lokalne testovaci klic Turnstile", await js(`document.querySelector('.cf-turnstile').dataset.sitekey`), "1x00000000000000000000AA");
    // zadne cookies ani uloziste prohlizece na zadne strance (stranka Cookies to slibuje)
    for (const p of ["", "funkce", "cenik", "ukazka", "stazeni", "cookies"]) {
      await page.goto(`${BASE}/${p ? p + "/" : ""}`, 300);
      check(`/${p}: cookies a localStorage prazdne`, await js("document.cookie + '|' + localStorage.length + '|' + sessionStorage.length"), "|0|0");
      check(`/${p}: zadne externi pismo ani skript krome Turnstile`, await js("[...document.querySelectorAll('script[src],link[rel=stylesheet],link[rel=preconnect]')].map(e=>e.src||e.href).filter(u=>/^https?:/.test(u)&&!u.startsWith(location.origin)&&!/challenges.cloudflare.com/.test(u)).join(' ')"), "");
    }
    // pravni stranky: navrh s provozovatelem TBC
    for (const l of LANGS) {
      await page.goto(`${BASE}${l === "cs" ? "" : "/" + l}/podminky/`, 200);
      check(`${l}: podminky maji stitek k revizi a TBC`, await js("!!document.querySelector('.pending .stamp') && document.body.innerText.includes('TBC')"), true);
      check(`${l}: podminky obsahuji 2023/1230 a ISO 13849-2`, await js("document.body.innerText.includes('2023/1230') && document.body.innerText.includes('13849-2')"), true);
    }
    // 404
    const r404 = await fetch(BASE + "/neexistuje/");
    check("neznama stranka -> 404", r404.status, 404);
    // PDF na webu
    for (const l of LANGS) {
      const href = await (async () => {
        await page.goto(`${BASE}${l === "cs" ? "" : "/" + l}/ukazka/`, 200);
        return js(`document.querySelector('a[download]').getAttribute('href')`);
      })();
      const r = await fetch(BASE + href);
      check(`${l}: PDF ${href}`, `${r.status} ${r.headers.get("content-type")}`, "200 application/pdf");
    }
  }
} finally {
  browser.close();
}
console.log(fails ? `\nNEPROSLO: ${fails}` : "\nVse proslo.");
process.exit(fails ? 1 : 0);
