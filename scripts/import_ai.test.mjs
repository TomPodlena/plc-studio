/* Testy AI vrstvy importu (apps/web/src/import_ai.js) — bez volání API (fetch je mock).
   node --test scripts/import_ai.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as core from "../packages/core/dist/index.js";
import {
  importInstructions, buildImportMessages, estimateImport, importNorm, splitImport, aiCallImport, aiImport,
  imageSize, imageTokens, pdfPages, iecName, combineRaw, IMPORT_MODELS, IMPORT_PRICES_DATE, API_LIMITS,
} from "../apps/web/src/import_ai.js";

const b64 = s => Buffer.from(s, "latin1").toString("base64");
/** Hlavička PNG s rozměry (pro čtení rozměrů stačí IHDR). */
function png(w, h, pad = 0) {
  const b = Buffer.alloc(33 + pad);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b.toString("base64");
}
/** JPEG s APP0 a SOF0. */
function jpeg(w, h) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0x00, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.from([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]).toString("base64");
}
function pdf(pages) {
  let s = "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count " + pages + " >> endobj\n";
  for (let i = 0; i < pages; i++) s += (3 + i) + " 0 obj << /Type /Page /Parent 2 0 R >> endobj\n";
  return b64(s + "%%EOF");
}
const EX = {
  files: [{ name: "tags.csv", fmt: "Prostý I/O list", ok: true, signals: 2, pous: 0 }],
  signals: [
    { tag: "M1_fbkRunning", dt: "BOOL", addr: "%I0.0", cmt: "Čerpadlo běh", dir: "DI", src: { file: "tags.csv", line: 2 }, dev: "M1", sig: "fbkRunning" },
    { tag: "M1_outRun", dt: "BOOL", addr: "%Q0.0", cmt: "Čerpadlo", dir: "DO", src: { file: "tags.csv", line: 3 }, dev: "M1", sig: "outRun" },
  ],
  pous: [],
  platform: "siemens",
  unparsed: [{ name: "schema.pdf", mime: "application/pdf" }, { name: "stitek.jpg", mime: "image/jpeg" }, { name: "popis.txt", text: "Čerpadlo M1 běží 5 s.\nVálec Y1 upne díl." }],
};
const FILES = [
  { name: "schema.pdf", mime: "application/pdf", data: pdf(3) },
  { name: "stitek.jpg", mime: "image/jpeg", data: jpeg(1920, 1080) },
];

test("instrukce obsahují pravidla importu a přesná data", () => {
  const t = importInstructions(EX);
  for (const s of ["NIC NEVYMÝŠLEJ", '"evidence"', '"conf"', "IEC 81346", "-M1 → \"M1\"", "NIKDY neodvozuj", "bezpečnostní logiku",
    '"conflicts"', '"missing"', '"interlocks"', '"takt"', "limLo", "setpoint", '"role"', '"questions"', "M1_fbkRunning; %I0.0"]) {
    assert.ok(t.includes(s), "chybí: " + s);
  }
  assert.ok(!t.includes("Texty určené uživateli"), "čeština bez pokynu k jazyku");
  core.setLang("de");
  try { assert.ok(importInstructions(EX).includes("Deutsch")); } finally { core.setLang("cs"); }
  // návrh z přesných dat a výsledek předchozí části
  const prj = core.blankProject();
  prj.devices.push({ id: 1, name: "M1", cls: "Motor", desc: "Čerpadlo", opt: { fbk: true }, unit: "", rmin: 0, rmax: 100 });
  core.syncIO(prj);
  const t2 = importInstructions(EX, prj, { known: { devices: [{ name: "Y7", cls: "Ventil", desc: "Upínání" }] }, part: { i: 2, n: 3 } });
  // delta protokol: známý stav kompaktně (bez JSON celého projektu), odpověď jen doplněk
  assert.ok(t2.includes("ZNÁMÝ STAV") && t2.includes("JEN DOPLNĚK"));
  assert.ok(/\nM1; Motor\(fbk\); fbkRunning=%I0\.0, outRun=%Q0\.0; Čerpadlo\n/.test(t2), t2.slice(-800));
  assert.ok(t2.includes("\nY7; Ventil; ; Upínání"));
  assert.ok(!t2.includes('"name":"M1"'));
  assert.ok(t2.includes("dotaz 2 z 3"));
  assert.ok(t.includes("Vrať celou zjištěnou sestavu") && !t.includes("JEN DOPLNĚK"));
  assert.ok(t.includes("nejvýš 60 zařízení") && t.includes('"more"'));
});

test("zprávy mají bloky document, image a text se správnými typy", () => {
  const r = buildImportMessages(EX, FILES);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].role, "user");
  const c = r.messages[0].content;
  const doc = c.find(b => b.type === "document");
  assert.deepEqual(Object.keys(doc.source).sort(), ["data", "media_type", "type"]);
  assert.equal(doc.source.type, "base64");
  assert.equal(doc.source.media_type, "application/pdf");
  assert.equal(doc.source.data, FILES[0].data);
  const img = c.find(b => b.type === "image");
  assert.equal(img.source.media_type, "image/jpeg");
  assert.equal(img.source.data, FILES[1].data);
  // popisek souboru před blokem, text souboru s čísly řádků, instrukce na konci
  assert.match(c[c.indexOf(doc) - 1].text, /schema\.pdf.*3 str/);
  assert.ok(c.some(b => b.type === "text" && b.text.includes("popis.txt") && b.text.includes("2: Válec Y1")));
  assert.ok(c[c.length - 1].text.includes("NIC NEVYMÝŠLEJ"));
  assert.deepEqual(r.files.sort(), ["popis.txt", "schema.pdf", "stitek.jpg"]);
  assert.equal(r.parts, 1);
});

test("hlavičky souborů: rozměry obrázků, strany PDF, tokeny podle dokumentace", () => {
  assert.deepEqual(imageSize(png(800, 600)), { w: 800, h: 600 });
  assert.deepEqual(imageSize(jpeg(1920, 1080)), { w: 1920, h: 1080 });
  assert.equal(imageSize(b64("nic")), null);
  assert.equal(pdfPages(pdf(7)), 7);
  // tabulka z https://platform.claude.com/docs/en/build-with-claude/vision (ověřeno 2026-10-03)
  assert.equal(imageTokens(1000, 1000, false), 1296);
  assert.equal(imageTokens(1920, 1080, false), 1560);
  assert.equal(imageTokens(1920, 1080, true), 2691);
  assert.equal(imageTokens(2000, 1500, false), 1564);
  assert.equal(imageTokens(2000, 1500, true), 3888);
  assert.equal(imageTokens(3840, 2160, true), 4784);
});

test("odhad ceny dává rozumná čísla", () => {
  assert.equal(IMPORT_PRICES_DATE, "2026-10-03");
  const e = estimateImport(FILES, "claude-sonnet-5-5", { ex: EX });
  assert.ok(e.inputTokens > 3 * 2250 && e.inputTokens < 60000, "vstup " + e.inputTokens);
  assert.ok(e.parts[0].outputTokens >= 9000 && e.parts[0].outputTokens <= 32000 * e.parts[0].rounds);
  const plain = e.inputTokens - e.cacheWriteTokens - e.cacheReadTokens;
  const usd = (plain * 2 + e.cacheWriteTokens * 2 * 1.25 + e.cacheReadTokens * 2 * 0.1 + e.outputTokens * 10) / 1e6;
  assert.ok(Math.abs(e.usd - usd) < 1e-3);
  assert.ok(e.usd > 0.005 && e.usd < 1, "cena " + e.usd);
  assert.equal(e.parts.length, 1);
  assert.deepEqual(e.parts[0].files.sort(), ["popis.txt", "schema.pdf", "stitek.jpg"]);
  // dražší model = vyšší cena, Haiku má obrázky ve standardním rozlišení (méně tokenů)
  const o = estimateImport(FILES, "claude-opus-5-5", { ex: EX }), h = estimateImport(FILES, "claude-haiku-4-5-20251001", { ex: EX });
  assert.ok(o.usd > e.usd && h.usd < e.usd && h.inputTokens < e.inputTokens);
  // neznámý model: varování a cena nejdražšího
  const u = estimateImport(FILES, "claude-neznamy", { ex: EX });
  assert.ok(u.warnings.some(w => w.includes("claude-neznamy")));
  assert.ok(u.usd >= estimateImport(FILES, "claude-fable-5-1", { ex: EX }).usd * 0.99);
  for (const m of Object.keys(IMPORT_MODELS)) assert.ok(IMPORT_MODELS[m].in > 0 && IMPORT_MODELS[m].out > IMPORT_MODELS[m].in);
  // velký manuál: výstup se rozdělí do navazujících odpovědí, každá pod limitem; neúplnost nehrozí
  const manual = estimateImport([{ name: "manual.pdf", mime: "application/pdf", data: pdf(89) }], "claude-sonnet-5-5");
  assert.ok(manual.parts[0].rounds > 1 && manual.parts[0].outputTokens / manual.parts[0].rounds < 32000);
  assert.ok(manual.warnings.some(w => w.includes("navazujících")));
  assert.ok(!manual.warnings.some(w => w.includes("neúplný")));
  assert.ok(manual.cacheReadTokens > 0 && manual.cacheWriteTokens > 0);   // pokračování čtou podklady z cache
});

test("kalibrace odhadu podle ostrého testu (Sonnet 5.5, 2026-10-03)", () => {
  // schéma Festo: 9 stran, 16 MB (těžké strany) → skutečnost 22,1k vstup / 12,1k výstup / 0,165 USD
  const heavy = b64(Buffer.from(pdf(9), "base64").toString("latin1") + " ".repeat(9 * 200000));
  const f = estimateImport([{ name: "schema.pdf", mime: "application/pdf", data: heavy }], "claude-sonnet-5-5");
  assert.ok(f.inputTokens >= 22129 && f.inputTokens <= 22129 * 1.6, "vstup " + f.inputTokens);
  assert.ok(f.outputTokens >= 12072 && f.outputTokens <= 12072 * 1.6, "výstup " + f.outputTokens);
  assert.ok(f.usd >= 0.165 && f.usd <= 0.165 * 1.6, "cena " + f.usd);
  // I/O list Unitronics: 2 strany, 20 kB → skutečnost 6,5k vstup / 20,5k výstup (57 zařízení) / 0,218 USD
  const u = estimateImport([{ name: "io.pdf", mime: "application/pdf", data: pdf(2) }], "claude-sonnet-5-5");
  assert.ok(u.inputTokens >= 6499 && u.inputTokens <= 6499 * 1.6, "vstup " + u.inputTokens);
  assert.ok(u.outputTokens >= 20469 * 0.95 && u.outputTokens <= 20469 * 1.6, "výstup " + u.outputTokens);
  assert.ok(u.usd >= 0.218 * 0.95 && u.usd <= 0.218 * 1.6, "cena " + u.usd);
  // přírůstkově uložené PDF má objekty stran dvakrát — rozhoduje /Count kořene
  const twice = Buffer.from(pdf(9), "base64").toString("latin1");
  assert.equal(pdfPages(b64(twice + "\n" + twice.replace("%PDF-1.4", ""))), 9);
});

test("velké podklady se dělí podle limitů API, nevejdoucí se přeskočí", () => {
  // 25 velkých fotek: nad 20 obrázků v dotazu jen do 2000 px → dva dotazy
  const photos = Array.from({ length: 25 }, (_, i) => ({ name: "foto" + i + ".png", mime: "image/png", data: png(4000, 3000) }));
  const sp = splitImport({ files: [], signals: [], pous: [], unparsed: [] }, photos, "claude-sonnet-5-5");
  assert.equal(sp.parts.length, 2);
  assert.equal(sp.parts[0].length, API_LIMITS.manyImages);
  // malé obrázky (do 2000 px) se vejdou do jednoho dotazu
  const small = photos.map(p => ({ ...p, data: png(1200, 900) }));
  assert.equal(splitImport({ unparsed: [] }, small, "claude-sonnet-5-5").parts.length, 1);
  // PDF přes limit stran modelu s kontextem 200k (100 stran) → přeskočeno s upozorněním
  const big = [{ name: "eplan.pdf", mime: "application/pdf", data: pdf(120) }];
  const h = splitImport({ unparsed: [] }, big, "claude-haiku-4-5-20251001");
  assert.equal(h.skipped.length, 1);
  assert.match(h.warnings[0], /eplan\.pdf.*120.*100/);
  // u modelu s 1M kontextem projde
  assert.equal(splitImport({ unparsed: [] }, big, "claude-sonnet-5-5").skipped.length, 0);
  // příliš velký obrázek a nepodporovaný formát
  const bad = splitImport({ unparsed: [] }, [
    { name: "obri.png", mime: "image/png", data: png(9000, 100) },
    { name: "vykres.dwg", data: b64("AC1032") },
  ], "claude-sonnet-5-5");
  assert.deepEqual(bad.skipped.map(s => s.name), ["obri.png", "vykres.dwg"]);
  // rozpočet tokenů: dlouhý text se rozdělí na kusy a ty do více dotazů
  const long = { name: "program.st", text: Array.from({ length: 30000 }, (_, i) => "x" + i + " := y" + i + " AND z; (* komentář *)").join("\n") };
  const t = splitImport({ unparsed: [] }, [long], "claude-sonnet-5-5", { partTokens: 100000 });
  assert.ok(t.parts.length >= 2);
  assert.ok(t.parts.flat().every(it => it.tokens <= 100000));
  // další dotaz nese výsledek předchozího (jako známý stav)
  const m2 = buildImportMessages({ unparsed: [] }, photos, { part: 1, known: { devices: [{ name: "M9", cls: "Motor" }] } });
  assert.equal(m2.parts, 2);
  assert.equal(m2.messages[0].content.filter(b => b.type === "image").length, 5);
  assert.ok(m2.messages[0].content.at(-1).text.includes("\nM9; Motor"));
  // přesně zpracovaný soubor se znovu neposílá
  const ex2 = { files: [{ name: "tags.csv", fmt: "x", ok: true, signals: 1, pous: 0 }], unparsed: [] };
  assert.equal(splitImport(ex2, [{ name: "tags.csv", text: "a;b" }], "claude-sonnet-5-5").parts[0].length, 0);
});

const RAW = {
  questions: [], name: "Zkušební stanice",
  devices: [
    { name: "-S1", cls: "DI", desc: "Nouzové zastavení (NC)", opt: {} },
    { name: "=A1+S2-M1", cls: "Motor", desc: "Čerpadlo", opt: {} },
    { name: "-B1", cls: "AnalogIn", desc: "Tlak", opt: {}, unit: "bar", rmin: 0, rmax: 250, limHi: 200 },
    { name: "-S2", cls: "DI", desc: "Kryt zavřen", opt: {} },
    { name: "X9", cls: "Robot", desc: "neexistující třída" },
  ],
  estop: "-S1", interlocks: ["-S2"],
  seq: [{ dev: "-M1", act: "start", cond: "fbk", timeS: 3 }, { dev: "", act: "wait", cond: "time", timeS: 5 }],
  takt: 30,
  io: [
    { dev: "-M1", sig: "fbkRunning", addr: "%I4.2", tag: "Pumpe_Lauf", cmt: "K1 pomocný kontakt" },
    { dev: "M1", sig: "outRun", addr: "%Q2.0" },
    { dev: "B1", sig: "raw", addr: "%IW96" },
    { dev: "S1", sig: "in", addr: "Local:1:I.Data.0", nc: true },
  ],
  evidence: {
    "dev:-M1": { conf: "sure", src: [{ file: "schema.pdf", page: 3, quote: "-M1 Čerpadlo 4 kW" }] },
    "dev:B1": { conf: "guess", src: [] },                                        // bez zdroje → pryč
    "dev:S2": { conf: "sure", src: [{ file: "neexistuje.pdf", page: 1 }] },        // neznámý soubor → pryč
    "dev:X9": { conf: "sure", src: [{ file: "schema.pdf", page: 1 }] },            // neznámé zařízení → pryč
    "io:Pumpe_Lauf": { conf: "sure", src: [{ file: "schema.pdf", page: 5, quote: "%I4.2 Pumpe_Lauf" }] },
    "estop": { conf: "sure", src: [{ file: "stitek.jpg" }] },
    "seq:0": { conf: "guess", src: [{ file: "popis.txt", line: 1, quote: "Čerpadlo M1 běží 5 s." }] },
    "seq:9": { conf: "sure", src: [{ file: "popis.txt", line: 1 }] },
    "meta": { conf: "jistě", src: [{ file: "popis.txt" }] },                       // neplatná jistota
    "lock:S2": { conf: "missing", src: [] },
  },
  conflicts: [{ what: "dev:-M1", note: "Výkon 4 kW × 5,5 kW", src: [{ file: "schema.pdf", page: 3 }, { file: "x.pdf" }] }],
  missing: ["Zpětné hlášení M1 v I/O listu chybí"],
  note: "Shrnutí",
};

test("normalizace: projekt kompletní, IEC názvy, evidence jen se zdrojem", () => {
  const p = importNorm(JSON.stringify(RAW), EX, FILES);
  const names = p.prj.devices.map(d => d.name);
  assert.deepEqual(names, ["S1", "M1", "B1", "S2"]);
  assert.equal(iecName("=A1+S2-M1"), "M1");
  const id = n => p.prj.devices.find(d => d.name === n).id;
  assert.equal(p.prj.program.estop, id("S1"));
  assert.deepEqual(p.prj.program.interlocks, [id("S2")]);
  assert.deepEqual(p.prj.program.seq, [{ dev: id("M1"), act: "start", cond: "fbk", timeS: 3 }, { dev: 0, act: "wait", cond: "time", timeS: 5 }]);
  assert.equal(p.prj.meta.takt, 30);
  assert.equal(p.prj.meta.name, "Zkušební stanice");
  assert.deepEqual(p.prj.platforms, ["siemens"]);
  assert.equal(p.prj.devices.find(d => d.name === "B1").limHi, 200);
  // io: adresa jen doložená evidencí io:<tag>, původní tag; ostatní prázdné (doplní jádro po sloučení)
  const io = sig => p.prj.io.find(e => e.devId === id(sig.split(":")[0]) && e.sig === sig.split(":")[1]);
  assert.equal(io("M1:fbkRunning").addr, "%I4.2");
  assert.equal(io("M1:fbkRunning").tag, "Pumpe_Lauf");
  /* tag, který v podkladech doslova není (AI ho složila z označení svorky), se nepřevezme */
  const inv = importNorm({ ...RAW, io: RAW.io.map(e => e.sig === "fbkRunning" ? { ...e, tag: "Q0_X3_7" } : e),
    evidence: { ...RAW.evidence, "io:Q0_X3_7": { conf: "sure", src: [{ file: "schema.pdf", page: 5, quote: "X3 svorka 7" }] } } }, EX, FILES);
  assert.equal(inv.prj.io.find(e => e.sig === "fbkRunning").tag, "M1_fbkRunning");
  assert.equal(io("M1:outRun").addr, "");          // AI uvedla %Q2.0, ale bez zdroje
  assert.equal(io("B1:raw").addr, "");
  assert.equal(p.evidence["io:M1_outRun"].conf, "missing");
  assert.match(p.evidence["io:M1_outRun"].note, /%Q2\.0/);
  assert.equal(io("S1:in").addr, "");              // Rockwell adresa se nepřevádí
  assert.ok(!("io:S1_in" in p.evidence));
  assert.equal(io("S1:in").nc, true);
  assert.equal(p.prj.io.filter(e => e.addr).length, 1);
  // jádro doplní volné adresy a doloženou nechá
  core.syncIO(p.prj);
  assert.ok(p.prj.io.every(e => e.addr));
  assert.equal(io("M1:fbkRunning").addr, "%I4.2");
  assert.equal(new Set(p.prj.io.map(e => e.addr)).size, p.prj.io.length);
  // dvě doložené stejné adresy → první platí, druhá jde do konfliktů
  const dup = importNorm({ ...RAW, io: [...RAW.io, { dev: "S2", sig: "in", addr: "%I4.2" }],
    evidence: { ...RAW.evidence, "io:S2_in": { conf: "sure", src: [{ file: "schema.pdf", page: 6 }] } } }, EX, FILES);
  assert.equal(dup.prj.io.find(e => e.tag === "S2_in").addr, "");
  assert.ok(dup.conflicts.some(c => c.what === "io:S2_in" && c.note.includes("%I4.2")));
  assert.equal(p.prj.devices.find(d => d.name === "M1").opt.fbk, true);   // signál z podkladu zapnul volbu
  // evidence
  assert.deepEqual(p.evidence["dev:M1"], { conf: "sure", src: [{ file: "schema.pdf", page: 3, quote: "-M1 Čerpadlo 4 kW" }] });
  assert.equal(p.evidence["io:Pumpe_Lauf"].conf, "sure");
  assert.equal(p.evidence["seq:0"].src[0].line, 1);
  assert.equal(p.evidence.estop.conf, "sure");
  assert.equal(p.evidence["lock:S2"].conf, "missing");
  for (const k of ["dev:B1", "dev:S2"]) {            // zahozená evidence → k revizi jako „missing"
    assert.equal(p.evidence[k].conf, "missing");
    assert.deepEqual(p.evidence[k].src, []);
  }
  assert.ok(!("dev:X9" in p.evidence) && !("seq:9" in p.evidence) && !("meta" in p.evidence));
  assert.ok(p.dropped.includes("dev:B1") && p.dropped.includes("dev:X9") && p.dropped.includes("meta"));
  assert.deepEqual(p.conflicts, [{ what: "dev:M1", note: "Výkon 4 kW × 5,5 kW", src: [{ file: "schema.pdf", page: 3 }] }]);
  assert.deepEqual(p.missing, ["Zpětné hlášení M1 v I/O listu chybí"]);
  // projekt je použitelný jádrem: generátor projde
  assert.ok(core.genFor(p.prj, "siemens"));
  // prázdná / nesmyslná odpověď nespadne
  const e = importNorm({}, null);
  assert.deepEqual(e.prj.devices, []);
  assert.throws(() => importNorm("žádný json", EX), err => err.code === "invalid_json");
});

test("sedí na typy a funkce jádra (reverse.ts)", () => {
  for (const fn of ["extractFiles", "inferProject", "mergeProposals"]) assert.equal(typeof core[fn], "function", fn);
  const ex = core.extractFiles([{ name: "popis.txt", text: "Čerpadlo M1." }, { name: "schema.pdf", mime: "application/pdf" }]);
  for (const k of ["files", "signals", "pous", "unparsed"]) assert.ok(Array.isArray(ex[k]), k);
  const exact = core.inferProject(ex);
  const ai = importNorm(RAW, ex, FILES);
  for (const k of ["prj", "evidence", "conflicts", "missing"]) assert.ok(k in ai && k in exact, k);
  const merged = core.mergeProposals(exact, ai);
  assert.ok(merged && merged.prj && Array.isArray(merged.prj.devices));
  // zprávy z výstupu jádra: soubor PDF z `unparsed` dostane data z `files`
  const m = buildImportMessages(ex, FILES.slice(0, 1));
  assert.ok(m.messages[0].content.some(b => b.type === "document"));
});

/** Mock fetch: vrací odpovědi v pořadí a pamatuje si požadavky. */
function mockFetch(replies) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { ok: r.status === undefined || r.status < 300, status: r.status || 200, json: async () => r.body };
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}
const reply = (obj, extra = {}) => ({ body: { content: [{ type: "text", text: "```json\n" + JSON.stringify(obj) + "\n```" }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200 }, ...extra } });

test("volání API s bloky document/image (mock fetch)", async () => {
  const f = mockFetch([reply(RAW)]);
  try {
    const { messages } = buildImportMessages(EX, FILES);
    const r = await aiCallImport(messages, { key: "sk-test", model: "claude-sonnet-5-5" });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, "https://api.anthropic.com/v1/messages");
    assert.equal(f.calls[0].init.headers["x-api-key"], "sk-test");
    assert.equal(f.calls[0].init.headers["anthropic-version"], "2023-06-01");
    assert.equal(f.calls[0].body.model, "claude-sonnet-5-5");
    assert.equal(f.calls[0].body.max_tokens, 32000);
    assert.ok(f.calls[0].body.messages[0].content.some(b => b.type === "document"));
    assert.equal(r.usage.input_tokens, 1000);
    assert.ok(r.text.includes("Zkušební stanice"));
  } finally { f.restore(); }
  // chyby: bez klíče nic neodejde, 401 / 413 / zkrácená odpověď / odmítnutí
  await assert.rejects(aiCallImport([], {}), e => e.code === "no_key");
  for (const [r, code] of [[{ status: 401, body: { error: { message: "bad" } } }, "bad_key"], [{ status: 413, body: {} }, "too_large"],
    [{ status: 400, body: { error: { message: "invalid block" } } }, "bad_request"], [{ status: 500, body: {} }, "api_error"],
    [reply(RAW, { stop_reason: "max_tokens" }), "truncated"], [reply(RAW, { stop_reason: "refusal" }), "refusal"]]) {
    const m = mockFetch([r]);
    try { await assert.rejects(aiCallImport([{ role: "user", content: "x" }], { key: "k" }), e => e.code === code); } finally { m.restore(); }
  }
});

test("celý AI import přes více dotazů řetězí výsledek (mock fetch)", async () => {
  const photos = Array.from({ length: 25 }, (_, i) => ({ name: "foto" + i + ".png", mime: "image/png", data: png(4000, 3000) }));
  const first = { ...RAW, devices: RAW.devices.slice(0, 2), evidence: { "dev:M1": RAW.evidence["dev:-M1"] } };
  const f = mockFetch([reply(first), reply(RAW)]);
  const seen = [];
  try {
    const r = await aiImport({ files: [], signals: [], pous: [], unparsed: [] }, [...photos, FILES[0]], { key: "k", model: "claude-sonnet-5-5", onPart: (i, n) => seen.push(i + "/" + n) });
    assert.equal(f.calls.length, 2);
    assert.deepEqual(seen, ["0/2", "1/2"]);
    assert.ok(f.calls[1].body.messages[0].content.at(-1).text.includes("ZNÁMÝ STAV"));
    assert.ok(f.calls[1].body.messages[0].content.at(-1).text.includes("\nM1; Motor"));
    assert.equal(r.usage.input_tokens, 2000);
    assert.equal(r.parts, 2);
    assert.equal(r.partsDone, 2);
    assert.deepEqual(r.proposal.prj.devices.map(d => d.name), ["S1", "M1", "B1", "S2"]);
  } finally { f.restore(); }
});

test("chyba nebo Stop v pozdějším dotazu vrátí dílčí výsledek (mock fetch)", async () => {
  const photos = Array.from({ length: 25 }, (_, i) => ({ name: "foto" + i + ".png", mime: "image/png", data: png(4000, 3000) }));
  const ex0 = { files: [], signals: [], pous: [], unparsed: [] };
  const first = { ...RAW, devices: RAW.devices.slice(0, 2), evidence: { "dev:M1": { conf: "sure", src: [{ file: "foto3.png" }] } } };
  // druhý dotaz selže (429)
  let f = mockFetch([reply(first), { status: 429, body: { error: { message: "slow down" } } }]);
  try {
    const r = await aiImport(ex0, photos, { key: "k", model: "claude-sonnet-5-5" });
    assert.equal(r.proposal, null);
    assert.equal(r.error.code, "rate_limited");
    assert.equal(r.partsDone, 1);
    assert.equal(r.parts, 2);
    assert.deepEqual(r.partial.prj.devices.map(d => d.name), ["S1", "M1"]);
    assert.equal(r.partial.evidence["dev:M1"].conf, "sure");
    assert.equal(r.usage.input_tokens, 1000);
  } finally { f.restore(); }
  // Stop (AbortError) během druhého dotazu
  const ctl = new AbortController();
  f = mockFetch([reply(first)]);
  const fetch1 = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url, init) => {
    if (++n === 2) { ctl.abort(); const e = new Error("aborted"); e.name = "AbortError"; throw e; }
    return fetch1(url, init);
  };
  try {
    const r = await aiImport(ex0, photos, { key: "k", model: "claude-sonnet-5-5", signal: ctl.signal });
    assert.equal(r.error.name, "AbortError");
    assert.equal(r.partsDone, 1);
    assert.ok(r.partial.prj.devices.length);
  } finally { f.restore(); }
  // selže hned první dotaz → chyba se vyhodí (není co nabídnout)
  f = mockFetch([{ status: 401, body: {} }]);
  try { await assert.rejects(aiImport(ex0, photos, { key: "k" }), e => e.code === "bad_key"); } finally { f.restore(); }
});

/** Přesný návrh: M1 (motor s adresami z exportu) a S1 (E-stop). */
function exactPrj() {
  const prj = core.blankProject();
  prj.devices.push({ id: 1, name: "M1", cls: "Motor", desc: "", opt: { fbk: true }, unit: "", rmin: 0, rmax: 100 },
    { id: 2, name: "S1", cls: "DI", desc: "E-stop (NC)", opt: {}, unit: "", rmin: 0, rmax: 100 });
  prj.nextId = 3; prj.program.estop = 2;
  core.syncIO(prj);
  prj.io.find(e => e.tag === "M1_fbkRunning").addr = "%I0.5";
  prj.io.find(e => e.tag === "M1_fbkRunning").tag = "Pump_Run";
  return prj;
}

test("delta protokol: doplněk se složí s přesným návrhem", () => {
  const base = exactPrj();
  const ex = { ...EX, signals: [{ tag: "Pump_Run", dt: "BOOL", addr: "%I0.5", cmt: "", dir: "DI", src: { file: "tags.csv", line: 2 } }] };
  const delta = {
    devices: [
      { name: "-M1", desc: "Čerpadlo 4 kW", cls: "DI", opt: { fault: true } },     // doplní popis a volbu, třídu nezmění
      { name: "-Y1", cls: "Ventil", desc: "Upínání", opt: { fbkOpen: true } },     // nové zařízení
    ],
    io: [{ dev: "M1", sig: "fault", addr: "%I0.6" }, { dev: "M1", sig: "fbkRunning", addr: "%I9.9" }, { dev: "Y1", sig: "outOpen", addr: "%Q1.0" }],
    estop: "Y9",
    evidence: {
      "dev:M1": { conf: "sure", src: [{ file: "schema.pdf", page: 2, quote: "-M1 4 kW" }] },
      "dev:Y1": { conf: "sure", src: [{ file: "schema.pdf", page: 3 }] },
      "io:M1_fault": { conf: "sure", src: [{ file: "schema.pdf", page: 2, quote: "%I0.6" }] },
      "io:Y1_outOpen": { conf: "sure", src: [{ file: "schema.pdf", page: 3, quote: "%Q1.0" }] },
    },
    more: false,
  };
  const p = importNorm(delta, ex, FILES, { base });
  assert.deepEqual(p.prj.devices.map(d => d.name), ["M1", "S1", "Y1"]);
  const m1 = p.prj.devices.find(d => d.name === "M1");
  assert.equal(m1.cls, "Motor");
  assert.equal(m1.desc, "Čerpadlo 4 kW");
  assert.deepEqual(m1.opt, { fbk: true, fault: true });
  const io = t => p.prj.io.find(e => e.tag === t);
  assert.equal(io("Pump_Run").addr, "%I0.5");        // přesná adresa zůstala (AI %I9.9 ignorována)
  assert.equal(io("M1_fault").addr, "%I0.6");
  assert.equal(io("Y1_outOpen").addr, "%Q1.0");
  assert.equal(p.prj.program.estop, 2);              // E-stop z přesných dat
  // přesné položky bez evidence AI nejsou „missing"; nové bez evidence ano
  assert.ok(!("dev:S1" in p.evidence) && !("estop" in p.evidence));
  assert.equal(p.evidence["dev:Y1"].conf, "sure");
  assert.ok(!("io:Pump_Run" in p.evidence));
  // sloučení s přesným návrhem jádra
  const merged = core.mergeProposals({ prj: base, evidence: {}, conflicts: [], missing: [] }, p);
  assert.ok(merged.prj.devices.some(d => d.name === "Y1"));
  // skládání dílčích odpovědí: zařízení podle názvu, io podle signálu, evidence a seznamy
  const acc = combineRaw(combineRaw(null, { devices: [{ name: "-B1", cls: "AnalogIn" }], missing: ["a"] }),
    { devices: [{ name: "B1", unit: "bar" }, { name: "H1", cls: "DO" }], missing: ["a", "b"], evidence: { "dev:H1": { conf: "guess", src: [] } } });
  assert.deepEqual(acc.devices.map(d => [d.name, d.cls, d.unit]), [["B1", "AnalogIn", "bar"], ["H1", "DO", undefined]]);
  assert.deepEqual(acc.missing, ["a", "b"]);
  assert.ok("dev:H1" in acc.evidence);
});

test("navazující odpovědi (more) a cache podkladů (mock fetch)", async () => {
  const base = exactPrj();
  const r1 = { devices: [{ name: "Y1", cls: "Ventil", desc: "A", opt: {} }], evidence: { "dev:Y1": { conf: "sure", src: [{ file: "schema.pdf", page: 1 }] } }, more: true };
  const r2 = { devices: [{ name: "Y2", cls: "Ventil", desc: "B", opt: {} }], evidence: { "dev:Y2": { conf: "sure", src: [{ file: "schema.pdf", page: 2 }] } }, more: false };
  const f = mockFetch([reply(r1), reply(r2, { usage: { input_tokens: 300, output_tokens: 100, cache_read_input_tokens: 5000 } })]);
  const seen = [];
  try {
    const r = await aiImport(EX, FILES.slice(0, 1), { key: "k", model: "claude-sonnet-5-5", prj: base, code: false, onPart: (i, n, round) => seen.push(i + "/" + n + "/" + round) });
    assert.equal(f.calls.length, 2);
    assert.deepEqual(seen, ["0/1/0", "0/1/1"]);
    const m2 = f.calls[1].body.messages;
    assert.deepEqual(m2.map(m => m.role), ["user", "assistant", "user"]);
    // první zpráva je v obou dotazech stejná (prefix pro cache), označená cache_control
    assert.deepEqual(m2[0], f.calls[0].body.messages[0]);
    assert.deepEqual(m2[0].content.at(-1).cache_control, { type: "ephemeral" });
    assert.ok(m2[1].content.includes('"Y1"') && m2[2].content.startsWith("Pokračuj"));
    assert.deepEqual(r.proposal.prj.devices.map(d => d.name), ["M1", "S1", "Y1", "Y2"]);
    assert.equal(r.usage.cache_read_input_tokens, 5000);
    assert.equal(r.calls, 2);
  } finally { f.restore(); }
});

test("chyba prvního dotazu nese usage, stopReason a zkrácený text", async () => {
  const long = "{\"devices\":[" + "{\"name\":\"M1\",\"cls\":\"Motor\"},".repeat(500);
  let f = mockFetch([{ body: { content: [{ type: "text", text: long }], stop_reason: "max_tokens", usage: { input_tokens: 9000, output_tokens: 32000 } } }]);
  try {
    await assert.rejects(aiImport(EX, FILES, { key: "k", model: "claude-sonnet-5-5" }), e => {
      assert.equal(e.code, "truncated");
      assert.equal(e.stopReason, "max_tokens");
      assert.equal(e.usage.output_tokens, 32000);
      assert.equal(e.textLength, long.length);
      assert.ok(e.text.length < 3200 && e.text.includes("vynecháno"));
      return true;
    });
  } finally { f.restore(); }
  f = mockFetch([{ body: { content: [{ type: "text", text: "Omlouvám se, JSON nebude." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } } }]);
  try {
    await assert.rejects(aiImport(EX, FILES, { key: "k" }), e => e.code === "invalid_json" && e.stopReason === "end_turn" && e.usage.input_tokens === 10 && e.text.includes("Omlouvám"));
  } finally { f.restore(); }
});
