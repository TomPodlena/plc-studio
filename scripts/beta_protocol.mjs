#!/usr/bin/env node
// Navrh zaznamu do data/verification.json a protokolu do docs/verification/ z vyplneneho PROTOKOL.md
// beta testera (sablona z packages/core/src/verify_pack.ts). Jen NAVRH k rucni kontrole - nic nezapisuje
// do data/ ani docs/ (postup: docs/verification/POSTUP_BETA.md).
//
//   node scripts/beta_protocol.mjs PROTOKOL.md [MANIFEST.json] [--out SLOZKA]
//
// Bez --out vypise oba navrhy na vystup. Se --out zapise <SLOZKA>/zaznam.json a <SLOZKA>/<ide>-<verze>.md.
// Cte jen strukturu sablony (poradi oddilu "## " a tabulek), ne prelozene nadpisy - funguje pro protokol
// v kteremkoli jazyce aplikace. Osobni udaje: e-maily a telefonni cisla v textu nahradi [ODSTRANENO]
// a vypise varovani; jmena, firmy a licencni cisla automaticky poznat nejde - zkontrolovat RUCNE.
// Bez zavislosti (Node 20+).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outIx = args.indexOf("--out");
const outDir = outIx >= 0 ? args[outIx + 1] : null;
const files = args.filter((a, i) => !a.startsWith("--") && !(outIx >= 0 && i === outIx + 1));
const [protoFile, manifestFile] = files;
if (!protoFile) {
  console.error("Pouziti: node scripts/beta_protocol.mjs PROTOKOL.md [MANIFEST.json] [--out SLOZKA]");
  process.exit(2);
}

const warnings = [];
const warn = (m) => warnings.push(m);

// ---------- osobni udaje ----------
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w.])\+?\d[\d ()/-]{7,}\d(?![\w.])/g;
export function scrub(text, where) {
  let s = String(text);
  const e = s.match(EMAIL), p = s.match(PHONE);
  if (e) { warn(`${where}: odstranen e-mail (${e.length}x)`); s = s.replace(EMAIL, "[ODSTRANENO]"); }
  // telefon jen jako souvisla cisla s mezerami / pomlckami, ne cisla verzi (1.110Q, 3.5.21.60) ani pocty
  if (p) {
    const real = p.filter((x) => x.replace(/\D/g, "").length >= 9 && !/^\d{4}-\d{2}-\d{2}$/.test(x.trim()));
    if (real.length) { warn(`${where}: odstraneno telefonni cislo (${real.length}x)`); for (const x of real) s = s.split(x).join("[ODSTRANENO]"); }
  }
  return s;
}

// ---------- cteni sablony ----------
const md = fs.readFileSync(protoFile, "utf-8").replace(/\r\n?/g, "\n");
const lines = md.split("\n");
// oddily "## " v poradi sablony: 0 prostredi, 1 vysledky, 2 vypis hlaseni, 3 rucni zasahy, 4 snimky, 5 simulace, 6 dalsi
const sections = [];
for (const l of lines) {
  if (/^## /.test(l)) sections.push({ title: l.slice(3).trim(), lines: [] });
  else if (sections.length) sections.at(-1).lines.push(l);
}
if (sections.length < 7) {
  console.error(`Soubor nema tvar sablony PROTOKOL.md (oddilu "## ": ${sections.length}, ocekavano 7).`);
  process.exit(1);
}
const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
const tableRows = (sec) => sec.lines.filter((l) => /^\s*\|/.test(l)).map(cells).filter((r) => !r.every((c) => /^:?-{3,}:?$/.test(c))).slice(1);
const empty = (v) => !v || v === "…" || v === "...";

const env = tableRows(sections[0]).map((r) => r[1] ?? "");
const [version, platformCell, ide, idePatch, cpu, os, ideLang, dateCell] = env;
const plat = (/\(([a-z0-9]+)\)\s*$/.exec(platformCell || "") || [])[1];
if (!plat) { console.error("Klic platformy v tabulce Prostredi chybi (radek 2: 'Nazev (klic)')."); process.exit(1); }
for (const [k, v] of [["IDE a verze", ide], ["datum overeni", dateCell]]) if (empty(v)) warn(`Prostredi: nevyplneno ${k}`);

const results = tableRows(sections[1]).filter((r) => r.length >= 8).map((r) => ({
  sample: r[0], style: r[1], file: r[2], impErr: r[3], impWarn: r[4], buildErr: r[5], buildWarn: r[6], note: scrub(r[7], `Vysledky ${r[2]}`),
}));
const num = (v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : null);
const filled = results.filter((r) => [r.impErr, r.buildErr].some((v) => num(v) !== null));
if (!filled.length) warn("Vysledky: zadny radek nema vyplneny pocet chyb");
for (const r of results) {
  for (const k of ["impErr", "impWarn", "buildErr", "buildWarn"]) if (!empty(r[k]) && r[k] !== "—" && num(r[k]) === null) warn(`Vysledky ${r.file}: "${r[k]}" neni cele cislo`);
}

const textOf = (i) => scrub(sections[i].lines.join("\n").trim(), sections[i].title);
const manual = textOf(3), shots = textOf(4), sim = textOf(5), other = textOf(6);
const log = scrub(sections[2].lines.join("\n").trim(), "Vypis hlaseni");

// ---------- manifest ----------
let manifest = null;
if (manifestFile) {
  manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
  if (manifest.format !== "plcdesk-verify-pack") warn("MANIFEST.json: neni balik k overeni PLCdesk");
  if (manifest.platform !== plat) warn(`MANIFEST.json: platforma ${manifest.platform} != ${plat} z protokolu`);
  if (String(manifest.version) !== String(version).trim()) warn(`MANIFEST.json: verze ${manifest.version} != ${version} z protokolu`);
}

// ---------- navrh zaznamu ----------
const VERIF = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "verification.json"), "utf-8"));
const cur = VERIF.platforms[plat];
if (!cur) { console.error(`Platforma ${plat} neni v data/verification.json.`); process.exit(1); }
const ideClean = scrub([ide, idePatch].filter((v) => !empty(v)).join(" ").replace(/\s+/g, " ").trim(), "IDE");
if (/[áčďéěíňóřšťúůýž]/i.test(ideClean)) warn("ide obsahuje cestinu - pole ide je technicke (bez ceskych znaku), uprav rucne");
const isoDate = (s) => {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s || "") || null;
  if (m) return m[0];
  const d = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(s || "");
  return d ? `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : null;
};
const date = isoDate(dateCell) || (warn("datum overeni neni ve tvaru RRRR-MM-DD ani D. M. RRRR - doplneno dnesni"), new Date().toISOString().slice(0, 10));
const allClean = filled.length > 0 && filled.every((r) => num(r.impErr) === 0 && num(r.buildErr) === 0);
const slug = (ideClean || plat).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || plat;
const evidenceFile = `docs/verification/${slug}.md`;
// formaty: soubor z vysledku s 0 chybami importu i prekladu -> "ide"
const byName = new Map();
for (const r of filled) {
  const n = path.basename(r.file);
  byName.set(n, (byName.get(n) ?? true) && num(r.impErr) === 0 && num(r.buildErr) === 0);
}
// soubor je "ide" jen kdyz prosel bez chyb ve VSECH vzorech, kde ho tester zkousel
const okFiles = new Set([...byName].filter(([, ok]) => ok).map(([n]) => n));
const formats = (cur.formats || []).map((f) => {
  const names = f.file.split(/,\s*/).map((x) => x.trim());
  return names.some((n) => okFiles.has(n)) ? { ...f, state: "ide", note: f.note } : f;
});
const entry = {
  state: allClean ? "verified" : cur.state,
  ide: ideClean || null,
  date,
  scope: cur.scope,
  summary: allClean
    ? `TODO: import a překlad v ${ideClean || "IDE"} bez chyb (vzory ${[...new Set(filled.map((r) => r.sample))].join(", ")}) — upravit, česky (klíč překladu)`
    : `TODO: shrnutí výsledku beta testu (${filled.length} souborů s výsledkem, chyby u ${filled.filter((r) => num(r.impErr) || num(r.buildErr)).length}) — stav zůstává ${cur.state}`,
  notVerified: `TODO: co zůstává neověřené (dosud: ${cur.notVerified})`,
  evidence: [evidenceFile, ...(cur.evidence || []).filter((e) => e !== evidenceFile)],
  formats: formats.map(({ note, ...f }) => (note ? { ...f, note } : f)),
};
if (!allClean) warn("Nekde jsou chyby nebo chybi vysledky: navrh stav NEMENI (zustava " + cur.state + "). Nalezy resit v kodu / emulatoru.");

// ---------- navrh protokolu (bez osobnich udaju) ----------
const row = (c) => "| " + c.map((x) => String(x ?? "").replace(/\|/g, "\\|")).join(" | ") + " |";
const out = [];
out.push(`# PLCdesk × ${ideClean || plat} — beta test platformy ${plat} (${date})`, "");
out.push("> NÁVRH ze skriptu scripts/beta_protocol.mjs — před uložením zkontrolovat ručně (osobní údaje, licenční čísla, závěr). Tester se neuvádí.", "");
out.push("## Shrnutí", "", `- Stav platformy: ${cur.state} → návrh **${entry.state}**`, `- Výsledky: ${filled.length} řádků s počty, soubory bez chyb ve všech vzorech: ${[...okFiles].join(", ") || "žádné"}`, "- TODO: závěr vlastními slovy", "");
out.push("## Prostředí", "", row(["Položka", "Hodnota"]), row(["---", "---"]));
for (const [k, v] of [["Verze PLCdesk", version], ["Platforma", platformCell], ["IDE a verze", ide], ["Update / SP", idePatch], ["CPU / zařízení", cpu], ["Operační systém", os], ["Jazyk IDE", ideLang], ["Datum", date]]) {
  out.push(row([k, scrub(empty(v) ? "—" : v, "Prostredi " + k)]));
}
if (manifest) out.push(row(["MANIFEST.json", `verze ${manifest.version}, commit ${manifest.commit || "—"}, vytvořen ${manifest.created || "—"}`]));
out.push("", "## Výsledky", "", row(["Vzor", "Styl", "Soubor", "Import: chyby", "Import: varování", "Překlad: chyby", "Překlad: varování", "Poznámka"]),
  row(["---", "---", "---", "---", "---", "---", "---", "---"]));
for (const r of results) out.push(row([r.sample, r.style, r.file, r.impErr, r.impWarn, r.buildErr, r.buildWarn, r.note]));
out.push("", "## Výpis hlášení (od testera)", "", log || "—", "");
out.push("## Ruční zásahy", "", manual || "—", "", "## Snímky obrazovky", "", shots || "—", "", "## Simulace", "", sim || "—", "", "## Další poznámky", "", other || "—", "");
out.push("## Co z toho plyne pro PLCdesk", "", "- TODO: nálezy → opravy v generátoru / emulátoru (commit), co zůstává neověřené", "");
const protocol = out.join("\n");

if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "zaznam.json"), JSON.stringify({ [plat]: entry }, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, `${slug}.md`), protocol);
  console.log(`Zapsano: ${path.join(outDir, "zaznam.json")}, ${path.join(outDir, slug + ".md")}`);
} else {
  console.log("=== navrh zaznamu data/verification.json (platforms." + plat + ") ===");
  console.log(JSON.stringify(entry, null, 2));
  console.log("\n=== navrh protokolu " + evidenceFile + " ===\n");
  console.log(protocol);
}
if (warnings.length) {
  console.error("\nZKONTROLUJ RUCNE:");
  const seen = new Map();
  for (const w of warnings) seen.set(w, (seen.get(w) || 0) + 1);
  for (const [w, n] of seen) console.error("  - " + w + (n > 1 ? ` (${n} radku)` : ""));
}
console.error("\nJmena, firmy a licencni / seriova cisla IDE skript nepozna - projdi protokol pred commitem ocima.");
