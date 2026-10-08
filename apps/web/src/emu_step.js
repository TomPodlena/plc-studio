/* PLCdesk — krok Generovat, záložka Emulace: ověření vygenerovaného kódu emulátorem překladu
   a běhu (jádro emu/: emulateCompile + emulateRunMany). EMULÁTOR NENÍ PŘEKLADAČ VÝROBCE — výhrada
   je v UI i v dokumentu 15 a neodstraňuje se.

   Výkon: emulace je drahá, proto se pouští jen na pokyn (tlačítko), po platformách s průběhem.
   Dokument 15_emulace_prekladu.md se do dokumentace přihlásí (registerEmuModule) až po ověření
   všech platforem projektu a jen pro tu podobu projektu, pro kterou výsledek platí: emuGate()
   (volá app.js při každém vykreslení) modul po změně projektu odhlásí — běžné překreslení
   dokumentace tak emulaci nikdy nespustí a dokument 15 bere výsledek z cache jádra
   (stejné volby jako emuDocMd: platformy projektu, rozsah full / quick podle počtu kroků). */
import {
  PLAT, escHtml as esc, tr, N_, syncIO, genFor, emulateCompile, emulateRunMany, EMU_RULES, EMU_DIALECTS, EMU_DOC_FILE,
  registerEmuModule, unregisterEmuModule, emuModuleRegistered,
} from "../../../packages/core/dist/index.js";
import { card } from "./util.js";
import { trn } from "./plural.js";

/** Rozsah běhu jako v dokumentu 15 (emuDocMd): plná matice do 40 kroků, nad tím rychlá sada. */
export const emuScope = p => p.program.seq.length <= 40 ? "full" : "quick";
const projKey = p => { syncIO(p); return JSON.stringify(p); };

/* výsledek poslední emulace (modul — přežije překreslení i přechod mezi kroky) */
let RES = null;      // { key, plats, comp: {plat: res}, run: {plat: res}, files: {plat: {name: body}}, ms, scope, doc }
let RUN = null;      // probíhající běh { plats, i, phase, stop }

/** Odhlásí dokument 15, když výsledek emulace neplatí pro aktuální projekt (volá app.js při vykreslení). */
export function emuGate(p) {
  if (emuModuleRegistered() && (!RES || !RES.doc || RES.key !== projKey(p))) unregisterEmuModule();
}
/** Stav pro testy a hlavičku: platí výsledek pro projekt? */
export function emuState(p) { return RES ? { current: RES.key === projKey(p), doc: emuModuleRegistered(), plats: RES.plats } : null; }

const where = f => f.file ? f.file + (f.line ? ":" + f.line + (f.col ? ":" + f.col : "") : "") : "—";
const lvlChip = l => l === "error" ? "<span class='st st-rej'>✖ " + tr("chyba") + "</span>" : l === "warn" ? "<span class='st st-stale'>⚠ " + tr("upozornění") + "</span>" : "<span class='st st-wait'>" + tr("informace") + "</span>";

export function makeEmuTab(ctx) {
  const { S, render } = ctx;
  const view = { sel: null, plat: null, loc: null, info: false };

  async function run(p, plats) {
    const key = projKey(p), scope = emuScope(p);
    RUN = { plats, i: 0, phase: "compile", stop: false };
    const out = { key, plats, comp: {}, run: {}, files: {}, ms: 0, scope, doc: false };
    const t0 = Date.now();
    const tick = () => new Promise(r => setTimeout(r, 0));
    const repaint = () => { const el = document.getElementById("emuProgress"); if (el) el.innerHTML = progressHtml(); };
    try {
      for (let i = 0; i < plats.length && !RUN.stop; i++) {
        RUN.i = i; RUN.phase = "compile"; repaint(); await tick();
        out.files[plats[i]] = genFor(p, plats[i]);
        out.comp[plats[i]] = emulateCompile(p, plats[i]);
        RUN.phase = "run"; repaint(); await tick();
        /* po jedné platformě — cache jádra má klíč po platformách, dokument 15 ho pak jen přečte */
        out.run[plats[i]] = emulateRunMany(p, [plats[i]], { scope })[plats[i]];
      }
    } catch (e) {
      out.error = String((e && e.message) || e);
    }
    out.ms = Date.now() - t0;
    out.stopped = RUN.stop;
    const done = plats.filter(pl => out.run[pl]);
    out.plats = done;
    /* dokument 15 jen s výsledkem pro všechny platformy projektu (jinak by ho dokumentace dopočítávala) */
    out.doc = !out.stopped && !out.error && p.platforms.every(pl => done.includes(pl));
    RES = out;
    RUN = null;
    if (out.doc) registerEmuModule(); else unregisterEmuModule();
    if (!view.plat || !done.includes(view.plat)) view.plat = done[0] || null;
    view.loc = null;
    if (S.step === 7) render();
  }

  function progressHtml() {
    if (!RUN) return "";
    const pl = RUN.plats[RUN.i];
    return "<div class='emuprog'><progress max='" + RUN.plats.length * 2 + "' value='" + (RUN.i * 2 + (RUN.phase === "run" ? 1 : 0)) + "'></progress> " +
      esc(PLAT[pl].name + ": " + (RUN.phase === "run" ? tr("běh kódu proti návrhu") : tr("překlad")) + " (" + (RUN.i + 1) + "/" + RUN.plats.length + ")") + "</div>";
  }

  function summaryRow(pl) {
    const c = RES.comp[pl], r = RES.run[pl];
    const e = c.findings.filter(f => f.level === "error").length, w = c.findings.filter(f => f.level === "warn").length;
    const rt = (r.runtime || []).filter(x => x.level === "error").length;
    const ok = c.ok && r.ok;
    return "<tr data-plat='" + pl + "'" + (pl === view.plat ? " class='sel'" : "") + "><td><button class='linkbtn' data-eplat='" + pl + "'>" + esc(PLAT[pl].name) + "</button></td><td>" + (c.ok ? "<span class='oktxt' style='margin:0'>✔</span>" : "<span class='errtxt' style='margin:0'>✖</span>") + "</td><td class='mono'>" + e + "</td><td class='mono'>" + w + "</td><td class='mono'>" + (r.skipped ? "—" : r.scenarios.length) + "</td><td class='mono'>" + (r.skipped ? "—" : r.diffs.length + (rt ? " + " + trn(rt, N_("{n} běhová chyba|{n} běhové chyby|{n} běhových chyb")) : "")) + "</td><td>" + (ok ? "<span class='st st-ok'>✔ " + tr("bez nálezu") + "</span>" : "<span class='st st-rej'>✖ " + tr("nálezy") + "</span>") + "</td></tr>";
  }

  function detailHtml(pl) {
    const c = RES.comp[pl], r = RES.run[pl];
    const list = c.findings.filter(f => view.info || f.level !== "info");
    const nInfo = c.findings.filter(f => f.level === "info").length;
    let h = "<h3>" + esc(PLAT[pl].name) + " — " + esc(EMU_DIALECTS[pl].label) + "</h3>" +
      "<p class='hint' style='margin-top:0'>" + tr("Ověřené soubory: {files}", { files: esc(c.files.filter(f => f !== "README.txt").join(", ")) }) + "</p>" +
      "<h4>" + tr("Nálezy překladu") + "</h4>";
    if (nInfo) h += "<label class='chk'><input type='checkbox' id='emuInfo'" + (view.info ? " checked" : "") + "> " + trn(nInfo, N_("zobrazit i {n} informaci|zobrazit i {n} informace|zobrazit i {n} informací")) + "</label>";
    if (!list.length) h += "<p class='oktxt'>" + tr("Bez nálezů.") + "</p>";
    else h += "<div class='tablewrap scrolly'><table class='hmitable' id='emuFind'><thead><tr><th>" + tr("Úroveň") + "</th><th>" + tr("Místo") + "</th><th>" + tr("Pravidlo") + "</th><th>" + tr("Nález") + "</th><th>" + tr("Zdroj") + "</th></tr></thead><tbody>" +
      list.slice(0, 300).map((f, i) => "<tr><td>" + lvlChip(f.level) + "</td><td class='mono'>" + (f.file && RES.files[pl][f.file] !== undefined ? "<button class='linkbtn' data-loc='" + i + "'>" + esc(where(f)) + "</button>" : esc(where(f))) + "</td><td class='mono' title='" + esc(EMU_RULES[f.rule] ? tr(EMU_RULES[f.rule]) : "") + "'>" + esc(f.rule) + "</td><td>" + esc(f.msg) + "</td><td>" + (f.source ? "<a href='" + esc(f.source) + "' target='_blank' rel='noopener'>" + tr("zdroj") + "</a>" : "—") + "</td></tr>").join("") +
      "</tbody></table></div>" + (list.length > 300 ? "<p class='hint'>" + tr("… a dalších {n} nálezů.", { n: list.length - 300 }) + "</p>" : "");
    h += "<h4>" + tr("Běh kódu proti návrhu") + "</h4>";
    if (r.skipped) h += "<p class='warnbox'>" + esc(r.skipped) + "</p>";
    else {
      h += "<p class='hint' style='margin-top:0'>" + tr("{n} scénářů, {scans} scanů kódu ({skip} scanů klidu přeskočeno), {d} rozdílů.", { n: r.scenarios.length, scans: r.scans, skip: r.skippedScans || 0, d: r.diffs.length }) + "</p>";
      if (r.diffs.length) h += "<div class='tablewrap scrolly'><table class='hmitable'><thead><tr><th>" + tr("Scénář") + "</th><th>" + tr("Čas [s]") + "</th><th>" + tr("Signál") + "</th><th>" + tr("Návrh (simulace)") + "</th><th>" + tr("Kód") + "</th></tr></thead><tbody>" +
        r.diffs.slice(0, 200).map(d => "<tr><td>" + esc(d.label) + "</td><td class='mono'>" + esc(d.t) + "</td><td class='mono'>" + esc(d.signal) + "</td><td class='mono'>" + esc(d.design) + "</td><td class='mono'>" + esc(d.code) + "</td></tr>").join("") + "</tbody></table></div>";
      else h += "<p class='oktxt'>" + tr("Kód se ve všech scénářích chová stejně jako návrh.") + "</p>";
      for (const f of r.runtime || []) h += "<p class='errtxt'>✖ " + esc(f.msg) + "</p>";
    }
    h += "<div id='emuCode'></div>";
    return { h, list };
  }

  function codeHtml(pl, f) {
    const body = RES.files[pl][f.file] || "";
    const lines = body.split(/\r?\n/);
    const from = Math.max(0, f.line - 30), to = Math.min(lines.length, f.line + 30);
    const w = String(to).length;
    let h = "<h4>" + tr("Náhled kódu: {file}", { file: esc(f.file) }) + "</h4><div class='codebox'><pre class='code emucode'>";
    for (let i = from; i < to; i++) {
      const hit = i + 1 === f.line;
      h += "<span class='ln" + (hit ? " hit" : "") + "'" + (hit ? " id='emuHit'" : "") + ">" + String(i + 1).padStart(w, " ") + "  " + esc(lines[i]) + "</span>\n";
      if (hit && f.col) h += "<span class='ln hit'>" + " ".repeat(w + 2 + f.col - 1) + "^ " + esc(f.msg) + "</span>\n";
    }
    return h + "</pre></div><p class='hint'>" + tr("Celý soubor je v záložce Kód; řádek {line}, sloupec {col}.", { line: f.line, col: f.col || 1 }) + "</p>";
  }

  function render_(el) {
    const p = S.prj;
    syncIO(p);
    if (!p.devices.length) { card(el, "08", tr("Emulace kódu"), "<p class='hint'>" + tr("Nejdřív přidej zařízení (krok 4), nech si je navrhnout v kroku AI návrh, nebo použij volbu Import.") + "</p>"); return; }
    if (!p.platforms.length) { card(el, "08", tr("Emulace kódu"), "<p class='hint'>" + tr("Vyber aspoň jednu platformu (krok 3).") + "</p>"); return; }
    if (!view.sel) view.sel = new Set(p.platforms);
    for (const pl of [...view.sel]) if (!p.platforms.includes(pl)) view.sel.delete(pl);
    const current = RES && RES.key === projKey(p);
    const c = card(el, "08", tr("Ověření kódu emulací"), `
      <div class="emuwarn" role="note"><b>${tr("UPOZORNĚNÍ: Emulátor NENÍ překladač výrobce.")}</b> ${tr("Kód se kontroluje parserem IEC 61131-3 a pravidly dialektů podle manuálů výrobců (zdroje u pravidel). Chování se ověřuje během přeloženého kódu proti modelu stroje simulace. Skutečný překlad v TIA Portal, CODESYS, TwinCAT, Machine Expert, GX Works3, Sysmac Studio, Studio 5000 a UniLogic tím NENÍ nahrazen — reálný import a překlad v IDE je dál nutné ověřit a teprve pak kód nasadit.")}</div>
      <div class="row" id="emuPlats">${p.platforms.map(pl => "<label class='chk'><input type='checkbox' data-eplsel='" + pl + "'" + (view.sel.has(pl) ? " checked" : "") + (RUN ? " disabled" : "") + "> " + esc(PLAT[pl].name) + "</label>").join("")}</div>
      <div class="row" style="margin-top:6px">
        <button class="primary" id="emuRun"${RUN || !view.sel.size ? " disabled" : ""}>${tr("Ověřit kód emulací")}</button>
        <button class="small" id="emuStop"${RUN ? "" : " hidden"}>${tr("Zastavit")}</button>
        <span class="hint" style="margin:0">${emuScope(p) === "full" ? tr("Rozsah běhu: všechny scénáře ověření včetně celé matice stavů.") : tr("Rozsah běhu: rychlá sada (běžný a druhý cyklus, výpadky hlášení, poruchy, E-stop, blokování, kvitace, ruční režim) — projekt má přes 40 kroků; celou matici stavů spustí emulateAll(prj).")}</span>
      </div>
      <div id="emuProgress">${progressHtml()}</div>
      <div id="emuResult"></div>`);
    c.querySelectorAll("[data-eplsel]").forEach(b => b.addEventListener("change", () => {
      if (b.checked) view.sel.add(b.dataset.eplsel); else view.sel.delete(b.dataset.eplsel);
      c.querySelector("#emuRun").disabled = !!RUN || !view.sel.size;
    }));
    c.querySelector("#emuRun").addEventListener("click", () => {
      if (RUN) return;
      const plats = p.platforms.filter(pl => view.sel.has(pl));
      run(p, plats);
      render();
    });
    c.querySelector("#emuStop").addEventListener("click", () => { if (RUN) { RUN.stop = true; c.querySelector("#emuStop").disabled = true; } });
    const res = c.querySelector("#emuResult");
    if (!RES || RUN) {
      if (!RUN) res.innerHTML = "<p class='hint'>" + tr("Emulace zatím neproběhla. Vyber platformy a spusť ověření — výsledek se zapíše i do dokumentu {file} v kroku Dokumentace.", { file: "<code>" + EMU_DOC_FILE + "</code>" }) + "</p>";
      return;
    }
    let h = "";
    if (!current) h += "<p class='warnbox' id='emuStale'>" + tr("Projekt se od emulace změnil — výsledek níže patří k dřívější podobě a dokument {file} se do dokumentace nezařadí. Spusť ověření znovu.", { file: "<code>" + EMU_DOC_FILE + "</code>" }) + "</p>";
    else if (RES.doc) h += "<p class='oktxt' id='emuDoc'>✔ " + tr("Výsledek je v dokumentu {file} (krok Dokumentace).", { file: "<code>" + EMU_DOC_FILE + "</code>" }) + "</p>";
    else h += "<p class='hint' id='emuDoc'>" + tr("Dokument {file} vznikne po ověření všech platforem projektu.", { file: "<code>" + EMU_DOC_FILE + "</code>" }) + "</p>";
    if (RES.error) h += "<p class='errtxt'>" + esc(tr("Emulace skončila chybou: {err}", { err: RES.error })) + "</p>";
    if (RES.stopped) h += "<p class='warnbox'>" + tr("Emulace byla zastavena — výsledek je jen pro dokončené platformy.") + "</p>";
    if (!RES.plats.length) { res.innerHTML = h; return; }
    h += "<div class='tablewrap'><table class='hmitable' id='emuSum'><thead><tr><th>" + tr("Platforma") + "</th><th>" + tr("Překlad") + "</th><th>" + tr("Chyby") + "</th><th>" + tr("Počet upozornění") + "</th><th>" + tr("Běh: scénáře") + "</th><th>" + tr("Rozdíly kód ↔ návrh") + "</th><th>" + tr("Výsledek") + "</th></tr></thead><tbody>" +
      RES.plats.map(summaryRow).join("") + "</tbody></table></div>" +
      "<p class='hint'>" + tr("Celková doba emulace {s} s.", { s: Math.round(RES.ms / 100) / 10 }) + "</p>";
    const d = detailHtml(view.plat);
    res.innerHTML = h + d.h;
    res.querySelectorAll("[data-eplat]").forEach(b => b.addEventListener("click", () => { view.plat = b.dataset.eplat; view.loc = null; render(); }));
    const info = res.querySelector("#emuInfo");
    if (info) info.addEventListener("change", () => { view.info = info.checked; view.loc = null; render(); });
    const showLoc = () => {
      const box = res.querySelector("#emuCode");
      if (view.loc === null || !d.list[view.loc]) { box.innerHTML = ""; return; }
      box.innerHTML = codeHtml(view.plat, d.list[view.loc]);
      const hit = box.querySelector("#emuHit");
      if (hit) { const pre = box.querySelector("pre"); pre.scrollTop = Math.max(0, hit.offsetTop - pre.clientHeight / 2); }
    };
    res.querySelectorAll("[data-loc]").forEach(b => b.addEventListener("click", () => { view.loc = +b.dataset.loc; showLoc(); res.querySelector("#emuCode").scrollIntoView({ block: "nearest" }); }));
    showLoc();
  }
  return { render: render_ };
}
