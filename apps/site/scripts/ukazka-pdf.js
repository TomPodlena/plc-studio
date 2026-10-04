#!/usr/bin/env node
// Ukazkova dokumentace (PDF) primo z jadra: vezme vzorovy projekt sampleComplex(),
// cast polozek schvali smyslenou osobou (a jednu po schvaleni zmeni, aby bylo videt
// "zmeneno po schvaleni"), vezme docFiles() + schemata z allProjectFiles() a pres
// headless Edge (CDP Page.printToPDF) z nich slozi PDF s titulni stranou a patickou.
//
// Jadro jen cte z packages/core/dist (nic v nem nemeni). Spusteni z apps/site:
//   node scripts/ukazka-pdf.js            -> assets/ukazka/ukazka-dokumentace-{cs,en,de}.pdf
//   node scripts/ukazka-pdf.js --html     -> navic necha mezivysledek HTML v docasne slozce
// Obrazky na web (vykresy z jadra, nahledy stran) dela scripts/obrazky.js nad stejnym projektem.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch } from "./cdp.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.join(ROOT, "..", "..", "packages", "core", "dist", "index.js");
const OUT = path.join(ROOT, "assets", "ukazka");
const LANGS = ["cs", "en", "de"];
const KEEP_HTML = process.argv.includes("--html");

const C = await import(pathToFileURL(CORE).href);
// Bezpecnostni modul (funkce, okruh, bezpecnostni program) zapina klient - jako aplikace
if (C.registerSafetyModule && !C.safetyModuleRegistered()) C.registerSafetyModule();
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "site.json"), "utf-8"));
const BRAND = site.brand;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (s, v) => s.replace(/\{\{site\.(\w+)\}\}/g, (m, k) => site[k] ?? m).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

// Jadro se zatim jmenuje PLC Studio; ve vystupu ukazky pouzijeme nazev produktu.
export const rebrand = (s) => s.replace(/PLC Studio/g, BRAND).replace(/PLCStudio/g, BRAND);

// Vykresy jadra berou barvy z CSS promennych stranky (var(--accent, #00707e) ...). Jako <img>
// nebo data: URI stranku nevidi, proto se tokeny znacky PLCdesk (brand/README.md, svetly rezim)
// nastavi primo v SVG dokumentu. Jadro se nemeni.
const DRAWING_TOKENS = `<style>:root{--accent:#2457C5;--chip:#E7ECF6;--muted:#5A6881}</style>`;
// Titulni strana je tmava plocha: symbol znacky ve variante inverse (brand/plcdesk-symbol-inverse.svg)
// a logotyp v pismu Barlow (OFL, assets/fonts) vlozenem do PDF jako data: URI.
const SYMBOL_INVERSE = fs
  .readFileSync(path.join(ROOT, "..", "..", "brand", "plcdesk-symbol-inverse.svg"), "utf-8")
  .replace(/<title>[^<]*<\/title>\s*/, "")
  .replace(/role="img" aria-label="[^"]*"/, 'aria-hidden="true"');
const BARLOW_CSS = [400, 700]
  .map((w) => `@font-face { font-family: Barlow; font-weight: ${w}; src: url(data:font/woff2;base64,${fs
    .readFileSync(path.join(ROOT, "assets", "fonts", `barlow-${w}-latin.woff2`)).toString("base64")}) format("woff2"); }`)
  .join("\n");
export const drawing = (svg) => rebrand(svg).replace(/<svg\b[^>]*>/, (m) => m + DRAWING_TOKENS);

// ---------- Markdown -> HTML (jen to, co generuji dokumenty jadra) ----------

function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:]|$)/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/NESCHVÁLENO|NOT APPROVED|NICHT FREIGEGEBEN/g, (m) => `<span class="ns">${m}</span>`);
  return t;
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

export function md(src) {
  const lines = src.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre>${esc(buf.join("\n"))}</pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      const n = Math.min(h[1].length + 1, 6);
      out.push(`<h${n}>${inline(h[2])}</h${n}>`);
      i++;
      continue;
    }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = splitRow(l);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
          `</tbody></table>`
      );
      continue;
    }
    if (/^>\s?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${md(buf.join("\n"))}</blockquote>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let it = lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, "");
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) it += " " + lines[i++].trim();
        const box = /^\[( |x)\]\s*/i.exec(it);
        items.push(box ? `<li class="box">${box[1] === " " ? "☐" : "☑"} ${inline(it.slice(box[0].length))}</li>` : `<li>${inline(it)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (!l.trim()) {
      i++;
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*\||\s*([-*]|\d+\.)\s+)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

function csv(src) {
  const rows = src.replace(/\r/g, "").replace(/^﻿/, "").split("\n").filter((r) => r.trim());
  const delim = (rows[0].match(/;/g) || []).length >= (rows[0].match(/,/g) || []).length ? ";" : ",";
  const split = (r) => {
    const out = [];
    let cur = "", q = false;
    for (let k = 0; k < r.length; k++) {
      const ch = r[k];
      if (q) {
        if (ch === '"' && r[k + 1] === '"') { cur += '"'; k++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const [head, ...body] = rows.map(split);
  return (
    `<table class="csv"><thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>` +
    body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") +
    `</tbody></table>`
  );
}

// Vyrez dlouheho dokumentu: prvnich `keep` kapitol "## "
function excerpt(body, keep, note) {
  const parts = body.split(/\n(?=## )/);
  if (parts.length <= keep + 1) return body;
  return parts.slice(0, keep + 1).join("\n") + `\n\n> ${note}\n`;
}

const svgImg = (svg) => `<img class="sheet" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" alt="">`;

// ---------- projekt ukazky ----------

export function sampleProject(t) {
  const prj = C.sampleComplex();
  const at = "2026-10-02T09:00:00.000Z";
  const approveKeys = (k) =>
    k.startsWith("dev:") ||
    ["io", "seq", "interlocks", "limits", "verify", "safety:hazards"].includes(k) ||
    /^safety:SF[1-4](:design)?$/.test(k);
  for (const it of C.approvalItems(prj)) {
    if (approveKeys(it.key) && it.ready !== false) C.approve(prj, it.key, t.approver, t.approver_note, at);
  }
  // Zmena po schvaleni: prodlouzeny hlidaci cas jednoho kroku -> sekvence se vrati ke schvaleni
  const step = prj.program.seq.find((s) => s.timeS > 0);
  if (step) step.timeS += 2;
  return prj;
}

export function buildHtml(lang, t) {
  C.setLang(lang);
  const prj = sampleProject(t);
  const docs = C.docFiles(prj);
  const files = C.allProjectFiles(prj);
  const doc = (p) => docs.find((d) => d.path === p);
  const file = (name) => files.find((f) => f.name === name);
  const sum = C.approvalSummary(prj);

  const sections = [];
  const add = (d, html, cls = "") =>
    sections.push({ title: `${d.tab}`, sub: d.title, path: d.path, html, cls });

  for (const p of ["00_prehled_dokumentace.md", "11_schvaleni.md", "01_funkcni_specifikace_FDS.md"]) {
    const d = doc(p);
    if (d) add(d, md(rebrand(d.body)));
  }
  for (const p of ["02_io_list.csv", "03_svorkovnice.csv"]) {
    const d = doc(p);
    if (d) add(d, csv(rebrand(d.body)));
  }
  for (const [name, title] of [
    ["blokove_schema.svg", t.fig_block],
    ["DI1_X1.svg", t.fig_sheet],
    ["bezpecnostni_okruh.svg", t.fig_safety],
  ]) {
    const f = file(name);
    if (f) sections.push({ title, sub: f.save, path: f.save, html: svgImg(drawing(f.body)), cls: "land" });
  }
  {
    const d = doc("04_seznam_alarmu.csv");
    if (d) add(d, csv(rebrand(d.body)), "land");
  }
  for (const p of ["05_testovaci_protokol_FAT.md", "06_navod_k_obsluze.md", "13_bezpecnostni_funkce.md"]) {
    const d = doc(p);
    if (d) add(d, md(rebrand(d.body)));
  }
  {
    const f = files.find((x) => /CEKA_NA_SCHVALENI/.test(x.name));
    if (f) sections.push({ title: t.safety_prog, sub: f.save, path: f.save, html: md(rebrand(f.body)) });
  }
  {
    const d = doc("12_protokol_ozivovani.md");
    if (d) add(d, md(excerpt(rebrand(d.body), 3, t.excerpt_note)));
  }
  {
    const f = files.find((x) => x.name === "Gen_Main.scl");
    if (f) {
      const lines = rebrand(f.body).split("\n");
      const cut = lines.slice(0, 110).join("\n") + (lines.length > 110 ? `\n\n(* … ${t.code_note} *)` : "");
      sections.push({ title: t.code, sub: f.save, path: f.save, html: `<pre class="code">${esc(cut)}</pre>` });
    }
  }

  const toc = sections.map((s, i) => `<li><span>${String(i + 1).padStart(2, "0")}</span> ${esc(s.title)} <em>${esc(s.sub)}</em></li>`).join("");
  const footer = fill(t.footer, {});
  const stamp = fill(t.approval_line, { ok: sum.approved, stale: sum.stale, total: sum.total });

  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${esc(fill(t.doc_title, {}))}</title>
<style>
${BARLOW_CSS}
@page { size: A4; margin: 16mm 15mm 18mm;
  @bottom-left { content: "${footer}"; font: 8pt "Segoe UI", Arial, sans-serif; color: #5A6881; }
  @bottom-right { content: counter(page) " / " counter(pages); font: 8pt "Segoe UI", Arial, sans-serif; color: #5A6881; } }
@page :first { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }
@page land { size: A4 landscape; margin: 12mm 14mm 16mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 9.5pt/1.45 "Segoe UI", Arial, sans-serif; color: #111A2E; }
.cover { height: 297mm; padding: 28mm 22mm; display: flex; flex-direction: column; background: #0E1422; color: #DDE3F0; break-after: page; }
.cover .brand { display: flex; align-items: center; gap: 2mm; color: #FFFFFF; } .cover .brand svg { width: 12mm; height: 12mm; } .cover .brand span { font: 400 20pt/1 Barlow, "Segoe UI", Arial, sans-serif; letter-spacing: -.01em; } .cover .brand b { font-weight: 700; }
.cover h1 { font-size: 30pt; line-height: 1.1; margin: 34mm 0 6mm; font-weight: 700; }
.cover .proj { font-size: 14pt; margin: 0 0 3mm; } .cover .desc { color: #93A0BA; max-width: 140mm; }
.cover .meta { margin-top: 10mm; font: 9pt Consolas, monospace; color: #93A0BA; }
.cover .stamp { display: inline-block; margin-top: 8mm; border: 2px solid #e8a06a; color: #f3c49f; padding: 3mm 4mm; font: 600 9pt Consolas, monospace; text-transform: uppercase; letter-spacing: .04em; max-width: 150mm; }
.cover ol { list-style: none; padding: 0; margin: auto 0 0; columns: 2; column-gap: 10mm; font-size: 9pt; }
.cover li { padding: 1.2mm 0; border-top: 1px solid #2A3550; break-inside: avoid; } .cover li span { color: #6E9BFF; font-family: Consolas, monospace; margin-right: 2mm; } .cover li em { color: #8592AC; font-style: normal; font-size: 7.5pt; display: block; padding-left: 7mm; }
.cover .note { margin-top: 8mm; font-size: 8pt; color: #8592AC; }
section { break-before: page; }
section.land { page: land; }
.sh { border-bottom: 2px solid #111A2E; padding-bottom: 2mm; margin-bottom: 4mm; display: flex; justify-content: space-between; gap: 6mm; align-items: baseline; }
.sh b { font-size: 13pt; } .sh span { font: 8pt Consolas, monospace; color: #5A6881; }
h2 { font-size: 13pt; margin: 5mm 0 2mm; } h3 { font-size: 11pt; margin: 4mm 0 2mm; } h4, h5, h6 { font-size: 10pt; margin: 3mm 0 1.5mm; }
p { margin: 0 0 2mm; } ul, ol { margin: 0 0 2mm; padding-left: 5mm; } li { margin: .5mm 0; } li.box { list-style: none; margin-left: -4mm; }
table { width: 100%; border-collapse: collapse; margin: 1mm 0 3mm; font-size: 8pt; }
th, td { border: 1px solid #C9D1DD; padding: 1mm 1.5mm; text-align: left; vertical-align: top; overflow-wrap: break-word; hyphens: auto; }
th { background: #ECEFF5; font-weight: 600; } tr { break-inside: avoid; }
table.csv { font-size: 7.5pt; }
blockquote { margin: 0 0 3mm; padding: 2mm 3mm; border-left: 3px solid #a24a12; background: #fbeadf; }
blockquote p { margin: 0; }
.ns { color: #a24a12; font-weight: 700; }
code { font: 8pt Consolas, monospace; background: #E7ECF6; padding: 0 1mm; }
pre { font: 7.5pt/1.35 Consolas, monospace; background: #F5F6F9; border: 1px solid #D6DCE6; padding: 3mm; white-space: pre-wrap; }
img.sheet { width: 100%; max-height: 165mm; object-fit: contain; display: block; }
hr { border: 0; border-top: 1px solid #D6DCE6; margin: 3mm 0; }
a { color: inherit; }
</style></head><body>
<div class="cover">
  <div class="brand">${SYMBOL_INVERSE}<span>${esc(BRAND).replace(/^([A-Z]+)/, "<b>$1</b>")}</span></div>
  <h1>${esc(fill(t.doc_title, {}))}</h1>
  <p class="proj">${esc(prj.meta.name)}</p>
  <p class="desc">${esc(prj.meta.desc)}</p>
  <p class="meta">${esc(fill(t.meta_line, { devs: prj.devices.length, io: prj.io.length, date: C.today() }))}</p>
  <div class="stamp">${esc(stamp)}</div>
  <p class="note">${esc(fill(t.cover_note, {}))}</p>
  <ol>${toc}</ol>
</div>
${sections
  .map((s) => `<section class="${s.cls}"><div class="sh"><b>${esc(s.title)}</b><span>${esc(s.path)}</span></div>\n${s.html}\n</section>`)
  .join("\n")}
</body></html>`;
}

// ---------- beh ----------

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  try {
    const page = await browser.page();
    for (const lang of LANGS) {
      const content = JSON.parse(fs.readFileSync(path.join(ROOT, "content", `${lang}.json`), "utf-8"));
      const t = content.pdf;
      const html = buildHtml(lang, t);
      // mezivysledek NIKDY do assets/ (build by ho zverejnil)
      const tmp = path.join(os.tmpdir(), `plcdesk-ukazka-${lang}.html`);
      if (KEEP_HTML) console.log(`HTML: ${tmp}`);
      fs.writeFileSync(tmp, html);
      await page.goto(pathToFileURL(tmp).href, 500);
      const pdf = await page.send("Page.printToPDF", { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
      const file = path.join(OUT, `ukazka-dokumentace-${lang}.pdf`);
      fs.writeFileSync(file, Buffer.from(pdf.data, "base64"));
      const pages = (Buffer.from(pdf.data, "base64").toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
      console.log(`${path.relative(ROOT, file)}  ${(fs.statSync(file).size / 1024).toFixed(0)} kB, ${pages} stran`);
      if (!KEEP_HTML) fs.rmSync(tmp, { force: true });
    }
  } finally {
    browser.close();
  }
  console.log("Obrazky na web: node scripts/obrazky.js");
}

// jen pri primem spusteni (obrazky.js si odsud bere projekt a HTML dokumentace)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
