/* PLCdesk — revize, nabídka a firemní knihovna ve webu (fáze 3B).
   Pohled skládá biz_view.js (sdílený s desktopem), logika je v jádře. Tady jen HTML a zápis
   voleb uživatele. Kde se to zobrazuje:
     - krok Projekt: karty „Revize a změny“ a „Firemní knihovna“ pod kartou projektu,
     - hlavička: odznak revize („B“, „B*“ = změněno od revize) → karta revizí,
     - krok Zařízení: „Přidat z knihovny“ (jen s připojenou knihovnou),
     - krok Kusovník: záložky Kusovník / Nabídka,
     - krok Schválení: zvýraznění položek dotčených změnou od revize (approval_step.js). */
import { escHtml as esc, tr, getLang } from "../../../packages/core/dist/index.js";
import {
  revisionView, revisionMd, issueRevision, revisionBadge,
  quoteView, importPrices, setQuote, quoteFiles,
  libraryView, loadLibrary, saveLibrary, libraryTemplate, attachToProject, detachLibrary, libraryDeviceTypes, addFromLibrary,
} from "./biz_view.js";
import { card, downloadFile, $ } from "./util.js";
import { approverName } from "./approval_step.js";

const LIB_KEY = "plcstudio.library";        // načtená firemní knihovna (nastavení prohlížeče)
const STEP_PROJECT = 0, STEP_DEV = 3, STEP_APPROVAL = 11, STEP_COMMISSION = 12;
const CURRENCIES = ["CZK", "EUR", "USD", "GBP", "CHF", "PLN", "HUF", "CNY"];

/** Text souboru: UTF-8 (i s BOM), UTF-16 s BOM, jinak Windows-1250 (český Excel) — jako desktop. */
export async function readFileText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if ((buf[0] === 0xFF && buf[1] === 0xFE) || (buf[0] === 0xFE && buf[1] === 0xFF)) return new TextDecoder(buf[0] === 0xFF ? "utf-16le" : "utf-16be").decode(buf);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""); }
  catch { return new TextDecoder("windows-1250").decode(buf); }
}

const chip = (tone, text) => "<span class='st st-" + tone + "'>" + esc(text) + "</span>";
/** Číslo do pole: desetinná čárka v jazycích, které ji používají (pole přijímá čárku i tečku). */
const numVal = v => v === null || v === undefined ? "" : ["cs", "de", "es"].includes(getLang()) ? String(v).replace(".", ",") : String(v);

export function makeBizSteps(ctx) {
  const { S, save, render } = ctx;
  const rerender = () => { const y = window.scrollY; render(); window.scrollTo({ top: y }); };
  /* pohled (drží se mezi překresleními) */
  const rv = { from: "", to: "", exact: false, err: "" };
  const qv = { tab: "bom", imp: null };
  const lv = { msg: null };

  /* ================================================================ odznak revize v hlavičce */
  function updateBadge() {
    let b = $("badgeRev");
    if (!b) {
      b = document.createElement("button");
      b.type = "button"; b.id = "badgeRev"; b.className = "badge revbadge"; b.hidden = true;
      const anchor = $("badgeApproval");
      anchor.parentNode.insertBefore(b, anchor);
      b.addEventListener("click", () => {
        S.step = STEP_PROJECT; save(); render();
        const c = document.getElementById("revCard");
        if (c) c.scrollIntoView({ block: "start" });
      });
    }
    let r = null;
    try { r = revisionBadge(S.prj); } catch (e) { console.warn("revision badge:", e); }
    b.hidden = !r || !r.label;
    if (!r || !r.label) return;
    b.textContent = tr("Rev. {rev}", { rev: r.label });
    b.title = r.title;
    b.classList.toggle("mod", !!r.modified);
  }

  /* ================================================================ krok Projekt: revize */
  function rRevisions(el) {
    const p = S.prj;
    let v;
    try { v = revisionView(p, rv); }
    catch (e) { card(el, "01", tr("Revize a změny"), "<p class='errtxt'>" + esc(String(e && e.message || e)) + "</p>"); return; }
    /* výchozí porovnání se nepamatuje (po změně projektu se přepočítá) — rv drží jen volbu uživatele */
    const range = { from: v.from, to: v.to };
    const d = v.diff, rt = v.retest;
    const opt = (val, label, sel) => "<option value='" + esc(val) + "'" + (sel ? " selected" : "") + ">" + esc(label) + "</option>";
    const state = !v.revisions.length ? "<span class='stat'>" + tr("Projekt zatím nemá žádnou revizi.") + "</span>"
      : "<span class='stat'>" + tr("Aktuální revize <b>{rev}</b>", { rev: esc(v.label) }) + "</span>" +
        (v.modified ? "<span class='stat st-stale'>" + tr("obsah se od revize {rev} změnil (rozpracováno)", { rev: esc(v.last) }) + "</span>"
          : "<span class='stat st-ok'>" + tr("beze změny od revize {rev}", { rev: esc(v.last) }) + "</span>");
    let html = `
    <p class="hint" style="margin-top:0;max-width:100ch">${tr("Revize zmrazí stav návrhu a schválení (označení A, B, C…). Potom ukáže, co se od revize změnilo, která schválení změna zneplatní a co je potřeba znovu vyzkoušet. Revize nic neschvaluje — jen zaznamená, co v tu chvíli platilo; výkresy nesou označení revize v popisovém poli.")}</p>
    <div class="stats">${state}</div>
    <div class="grid g3" style="margin-top:12px">
      <label class="f">${tr("Vydává (jméno, povinné)")}<input type="text" id="revBy" maxlength="80" autocomplete="name" value="${esc(approverName())}" placeholder="${esc(tr("jméno a příjmení"))}"></label>
      <label class="f">${tr("Popis změny (důvod revize)")}<input type="text" id="revNote" maxlength="300" placeholder="${esc(tr("např. úprava podle připomínek zákazníka"))}"></label>
      <div class="f" style="justify-content:end"><button class="primary" id="revIssue">${tr("Vydat revizi {rev}", { rev: esc(v.next) })}</button></div>
    </div>
    <div class="errtxt" id="revErr"${rv.err ? "" : " hidden"}>${esc(rv.err)}</div>`;
    if (v.revisions.length) {
      html += "<h3>" + tr("Revize projektu") + "</h3><div class='tablewrap'><table id='revTable'><thead><tr><th>" + tr("Rev") + "</th><th>" + tr("Datum") + "</th><th>" + tr("Vydal") +
        "</th><th>" + tr("Popis změny") + "</th><th>" + tr("Změny proti předchozí") + "</th><th title='" + esc(tr("platně schválené povinné položky v okamžiku vydání / povinných celkem")) + "'>" + tr("Schváleno") + "</th></tr></thead><tbody>" +
        v.revisions.map(r => "<tr data-rev='" + esc(r.id) + "'><td class='mono'><b>" + esc(r.id) + "</b></td><td class='mono'>" + esc(r.date) + "</td><td>" + esc(r.by) + "</td><td>" + esc(r.note || "—") +
          "</td><td>" + chip(r.tone, r.clsLabel) + "</td><td class='mono'>" + esc(r.approved) + "</td></tr>").join("") +
        (v.modified ? "<tr class='revwip'><td class='mono'><b>" + esc(v.label) + "</b></td><td></td><td>—</td><td colspan='3' class='hint'>" + tr("rozpracováno — obsah se od poslední revize změnil") + "</td></tr>" : "") +
        "</tbody></table></div>";
      const toOpts = opt("current", tr("aktuální stav (neuvolněno)"), v.to === "current") + v.revisions.map(r => opt(r.id, tr("revize {rev}", { rev: r.id }), v.to === r.id)).join("");
      html += `<h3 id="revChanges">${tr("Změny")}</h3>
      <div class="row" style="margin-top:4px">
        <label class="f" style="flex-direction:row;gap:6px;align-items:center">${tr("od")} <select id="revFrom">${v.revisions.map(r => opt(r.id, tr("revize {rev}", { rev: r.id }), v.from === r.id)).join("")}</select></label>
        <label class="f" style="flex-direction:row;gap:6px;align-items:center">${tr("do")} <select id="revTo">${toOpts}</select></label>
        <label class="chk" title="${esc(tr("Spustí ověření simulací obou stavů — přesné dotčené položky; u velkého stroje chvíli trvá."))}"><input type="checkbox" id="revExact"${rv.exact ? " checked" : ""}> ${tr("přesně (s ověřením simulací)")}</label>
        <button class="small" id="revMd">${tr("Stáhnout {file}", { file: esc(v.file) })}</button>
      </div>`;
      if (d.empty) html += "<p class='oktxt'>" + tr("Beze změny.") + "</p>";
      else {
        html += "<div class='stats'><span class='stat'>" + tr("Klasifikace") + " " + chip(d.tone, d.clsLabel) + "</span><span class='stat'>" +
          tr("změn <b>{n}</b>", { n: d.changes.length }) + "</span><span class='stat st-ok'>" + tr("kosmetických <b>{n}</b>", { n: d.counts.cosmetic }) +
          "</span><span class='stat st-stale'>" + tr("funkčních <b>{n}</b>", { n: d.counts.functional }) + "</span><span class='stat st-rej'>" + tr("bezpečnostních <b>{n}</b>", { n: d.counts.safety }) + "</span></div>" +
          "<p class='hint'>" + tr("Kosmetická změna (popis, komentář, kusovník) schválení nezneplatní. Funkční změna mění logiku, signály nebo časy programu. Bezpečnostní změna se dotýká bezpečnostních funkcí nebo jejich vstupů a výstupů.") + "</p>" +
          "<div class='tablewrap scrolly'><table id='revDiff'><thead><tr><th>#</th><th>" + tr("Oblast") + "</th><th>" + tr("Položka") + "</th><th>" + tr("Změna (před → po)") + "</th><th>" + tr("Třída") + "</th><th>" + tr("Dotčená schválení") + "</th></tr></thead><tbody>" +
          d.changes.map(c => {
            const keys = [...c.affects.map(a => esc(a.title)), ...c.maybe.map(a => esc(a.title) + " ?")];
            return "<tr class='rc-" + c.cls + "'><td class='mono'>" + c.n + "</td><td>" + esc(c.areaLabel) + "</td><td>" + esc(c.what) + "</td><td>" + esc(c.detail) + "</td><td>" + chip(c.tone, c.clsLabel) +
              "</td><td style='font-size:.76rem'>" + (keys.length ? keys.join(", ") : "—") + "</td></tr>";
          }).join("") + "</tbody></table></div>" +
          (d.unattributed.length ? "<p class='hint' id='revUnattr'>" + tr("Odvozené změny bez přímé vazby na položku návrhu (ovlivňují klasifikaci celku): {list}.", { list: d.unattributed.map(a => esc(a.title)).join(", ") }) + "</p>" : "") +
          (d.maybe ? "<p class='hint'>" + tr("„?“ = položka závisí na ověření simulací, které se pro tento přehled nespouštělo — změní se, pokud změna ovlivní výsledek ověření. Přesný výsledek dá volba „přesně“.") + "</p>" : "");
        /* zneplatněná schválení */
        html += "<h3>" + tr("Zneplatněná schválení ({n})", { n: d.invalidates.length }) + "</h3>";
        if (d.invalidates.length) {
          html += "<ul class='plain' id='revInvalid'>" + d.invalidates.map(i => "<li data-key='" + esc(i.key) + "'><b>" + esc(i.title) + "</b>" +
            (i.by ? " — " + tr("schválil {by}, {date}", { by: esc(i.by), date: esc(i.at) }) : "") + (i.maybe ? " <span class='hint' style='margin:0'>(" + tr("možná — závisí na ověření simulací") + ")</span>" : "") + "</li>").join("") + "</ul>";
        } else html += "<p class='hint'>" + tr("Změna nezneplatňuje žádné platné schválení.") + "</p>";
        if (d.added.length) html += "<p class='hint'>" + tr("Nové povinné položky ke schválení: {list}.", { list: d.added.map(a => esc(a.title)).join(", ") }) + "</p>";
        if (d.invalidates.length || d.added.length) html += "<div class='row' style='margin-top:6px'><button class='small' id='revToAppr'>" + tr("Otevřít krok Schválení") + " →</button></div>";
        /* rozsah opakovaných zkoušek */
        html += "<h3>" + tr("Rozsah opakovaných zkoušek — návrh") + "</h3><ul class='plain'>" + rt.notes.map(n => "<li>" + esc(n) + "</li>").join("") + "</ul>";
        if (rt.fat.length) {
          let sec = "", fat = "";
          for (const f of rt.fat) { if (f.section !== sec) { if (sec) fat += "</ul>"; sec = f.section; fat += "<b style='font-size:.84rem'>" + esc(sec) + "</b><ul class='plain'>"; } fat += "<li>" + esc(f.text) + "</li>"; }
          html += "<h3 style='font-size:.86rem'>" + tr("Body FAT") + "</h3>" + fat + "</ul>";
        }
        if (rt.commissioning.length) {
          html += "<h3 style='font-size:.86rem'>" + tr("Kroky oživení ({n})", { n: rt.commissioning.length }) + "</h3><div class='tablewrap scrolly'><table id='revRetest'><thead><tr><th>ID</th><th>" + tr("Fáze") + "</th><th>" + tr("Krok") + "</th></tr></thead><tbody>" +
            rt.commissioning.map(s => "<tr><td class='mono'>" + esc(s.id) + "</td><td>" + esc(s.phaseLabel) + "</td><td>" + esc(s.title) + "</td></tr>").join("") + "</tbody></table></div>" +
            "<div class='row' style='margin-top:6px'><button class='small' id='revToComm'>" + tr("Otevřít krok Oživení") + " →</button></div>";
        }
        if (rt.safety.length) html += "<h3 style='font-size:.86rem'>" + tr("Validace bezpečnostních funkcí") + "</h3><ul class='plain'>" +
          rt.safety.map(s => "<li><b>" + esc(s.sf) + "</b> " + esc(s.title) + " — " + esc(s.text) + "</li>").join("") + "</ul>";
        html += "<p class='note'>" + tr("Klasifikace změn a rozsah zkoušek navrhuje PLCdesk podle otisků položek schvalování. Rozsah opakovaných zkoušek potvrzuje odpovědná osoba.") + "</p>";
      }
    }
    const c = card(el, "01", tr("Revize a změny"), html);
    c.id = "revCard";
    const err = msg => { rv.err = msg; const e = c.querySelector("#revErr"); e.textContent = msg; e.hidden = !msg; };
    c.querySelector("#revIssue").addEventListener("click", () => {
      const by = c.querySelector("#revBy").value.trim(), note = c.querySelector("#revNote").value.trim();
      if (!by) { err(tr("Zadej jméno osoby, která revizi vydává.")); c.querySelector("#revBy").focus(); return; }
      /* stav až při kliku — pole kroku Projekt (název, popis…) se ukládají bez překreslení karty */
      const now = v.revisions.length ? revisionBadge(p) : null;
      if (now && !now.modified && !window.confirm(tr("Obsah se od revize {rev} nezměnil. Vydat přesto novou revizi?", { rev: now.id }))) return;
      try {
        const r = issueRevision(p, by, note);
        rv.err = ""; rv.from = ""; rv.to = "";
        S.notice = { step: S.step, level: "ok", text: tr("Vydána revize {rev} ({date}, {by}).", { rev: r.id, date: r.date, by: r.by }) };
        save(); rerender();
      } catch (e) { err(String(e && e.message || e)); }
    });
    const sel = (id, f) => { const x = c.querySelector(id); if (x) x.addEventListener("change", f); };
    sel("#revFrom", e => { rv.from = e.target.value; rerender(); });
    sel("#revTo", e => { rv.to = e.target.value; rerender(); });
    sel("#revExact", e => { rv.exact = e.target.checked; rerender(); });
    const md = c.querySelector("#revMd");
    if (md) md.addEventListener("click", () => downloadFile(v.file, revisionMd(p, { ...range, exact: rv.exact })));
    const ta = c.querySelector("#revToAppr");
    if (ta) ta.addEventListener("click", () => {
      const keys = new Set([...d.invalidates.map(i => i.key), ...d.added.map(a => a.key)]);
      S.step = STEP_APPROVAL;
      S.notice = { step: STEP_APPROVAL, level: "warn", text: tr("Položky dotčené změnou {from} → {to}: {n} — zvýrazněné níže.", { from: range.from, to: range.to === "current" ? tr("aktuální stav") : range.to, n: keys.size }) };
      save(); render();
      focusRows("tr[data-key]", r => keys.has(r.dataset.key), "details.apgroup");
    });
    const tc = c.querySelector("#revToComm");
    if (tc) tc.addEventListener("click", () => {
      const ids = new Set(rt.commissioning.map(s => s.id));
      S.step = STEP_COMMISSION;
      S.notice = { step: STEP_COMMISSION, level: "warn", text: tr("Kroky oživení k opakování po změně {from} → {to}: {n} — zvýrazněné níže. Rozsah je návrh, potvrzuje ho odpovědná osoba.", { from: range.from, to: range.to === "current" ? tr("aktuální stav") : range.to, n: ids.size }) };
      save(); render();
      focusRows(".cmrow[data-id]", r => ids.has(r.dataset.id), "details.cmphase");
    });
  }

  /** Po přechodu do jiného kroku zvýrazní řádky, otevře jejich skupiny a posune na první. */
  function focusRows(selector, pick, group) {
    const rows = [...document.querySelectorAll("#view " + selector)].filter(pick);
    for (const r of rows) {
      r.classList.add("revfocus");
      const g = r.closest(group);
      if (g) g.open = true;
    }
    if (rows[0]) rows[0].scrollIntoView({ block: "center" });
  }

  /* ================================================================ krok Projekt: firemní knihovna */
  const loadedLib = () => { try { const s = localStorage.getItem(LIB_KEY); const o = s ? JSON.parse(s) : null; return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; } };
  const storeLib = lib => { try { if (lib) localStorage.setItem(LIB_KEY, JSON.stringify(lib)); else localStorage.removeItem(LIB_KEY); } catch { /* bez úložiště */ } };
  const sameLib = (a, b) => !!a && !!b && JSON.stringify({ ...a, updated: "" }) === JSON.stringify({ ...b, updated: "" });

  function rLibrary(el) {
    const p = S.prj;
    const loaded = loadedLib(), own = p.library || null;
    const cur = loaded || own;
    let v = null;
    try { v = cur ? libraryView(cur, p) : null; } catch (e) { v = null; lv.msg = { level: "err", text: String(e && e.message || e) }; }
    const attached = own ? tr("Knihovna projektu: <b>{name}</b> {v}", { name: esc(own.name || "—"), v: esc(own.version || "") }) : tr("K projektu není připojena žádná knihovna.");
    const loadedTxt = loaded ? (sameLib(loaded, own) ? tr("Načtená knihovna je připojená k projektu.")
      : tr("Načtená knihovna: <b>{name}</b> {v} — k projektu zatím nepřipojena.", { name: esc(loaded.name || "—"), v: esc(loaded.version || "") })) : "";
    let html = `
    <p class="hint" style="margin-top:0;max-width:100ch">${tr("Firemní knihovna = vlastní typy zařízení (s díly kusovníku a časy kroků), vlastní šablony bloků FB se stejným rozhraním jako vestavěné, firemní hlavička kódu a schvalovatelé. Soubor knihovny (.plcdesk-library.json) sdílí celá firma; projekt si nese kopii, aby šel otevřít i bez souboru.")}</p>
    <div class="stats"><span class="stat">${attached}</span>${loadedTxt ? "<span class='stat'>" + loadedTxt + "</span>" : ""}</div>
    <div class="row">
      <label class="small filebtn"><input type="file" id="libFile" accept=".json,application/json" hidden><span class="button small">${tr("Načíst soubor knihovny…")}</span></label>
      <button class="small" id="libSave"${cur ? "" : " disabled"}>${tr("Uložit knihovnu…")}</button>
      <button class="small" id="libCheck"${cur ? "" : " disabled"}>${tr("Ověřit")}</button>
      <button class="small primary" id="libAttach"${loaded && v && !v.errors && !sameLib(loaded, own) ? "" : " disabled"}>${tr("Připojit k projektu")}</button>
      <button class="small danger" id="libDetach"${own ? "" : " disabled"}>${tr("Odpojit od projektu")}</button>
      <button class="small" id="libTpl">${tr("Vzor knihovny…")}</button>
    </div>`;
    if (lv.msg) html += "<div class='notice " + esc(lv.msg.level) + "' style='margin-top:10px'>" + esc(lv.msg.text) + "</div>";
    if (v) {
      const head = loaded && !sameLib(loaded, own) ? tr("Načtená knihovna") : tr("Knihovna projektu");
      html += "<h3>" + esc(head) + ": " + esc(v.name || "—") + " <span class='hint' style='margin:0;font-weight:400'>" + esc(tr("verze {v}", { v: v.version })) + (v.updated ? " · " + esc(v.updated) : "") + "</span></h3>";
      html += "<div class='stats' id='libIssuesSum'>" + (v.errors ? "<span class='stat st-rej'>" + tr("chyb <b>{n}</b>", { n: v.errors }) + "</span>" : "") +
        (v.warns ? "<span class='stat st-stale'>" + tr("upozornění <b>{n}</b>", { n: v.warns }) + "</span>" : "") +
        (!v.errors && !v.warns ? "<span class='stat st-ok'>" + tr("kontrola bez nálezů") + " ✓</span>" : "") + "</div>";
      if (v.issues.length) html += "<details class='help' id='libIssues'" + (v.errors ? " open" : "") + "><summary>" + tr("Nálezy kontroly ({n})", { n: v.issues.length }) + "</summary><div class='body' style='max-width:none'><ul class='plain'>" +
        v.issues.map(i => "<li style='color:var(--" + (i.level === "error" ? "err" : "warn") + ")'><b>" + esc(i.where) + "</b> — " + esc(i.msg) + "</li>").join("") + "</ul></div></details>";
      const co = v.company;
      html += "<div class='grid g2' style='margin-top:10px'><div><h3 style='margin-top:0'>" + tr("Firma") + "</h3>" +
        (co.name ? "<p style='margin:0'><b>" + esc(co.name) + "</b>" + (co.logoText && co.logoText !== co.name ? " · " + esc(co.logoText) : "") + (co.address ? "<br><span class='hint' style='margin:0'>" + esc(co.address) + "</span>" : "") + "</p>" : "<p class='hint'>" + tr("Knihovna neuvádí firmu.") + "</p>") +
        (co.codeHeader.length ? "<p class='hint'>" + tr("Hlavička kódu: {lines}", { lines: co.codeHeader.map(esc).join(" · ") }) + "</p>" : "") + "</div>" +
        "<div><h3 style='margin-top:0'>" + tr("Schvalovatelé") + "</h3>" + (co.approvers.length ? "<ul class='plain' id='libApprovers'>" + co.approvers.map(a => "<li>" + esc(a.name) + (a.role ? " <span class='hint' style='margin:0'>(" + esc(a.role) + ")</span>" : "") + "</li>").join("") + "</ul><p class='hint'>" + tr("Nabízí se jako výběr jména v krocích Schválení, Bezpečnost a Oživení.") + "</p>" : "<p class='hint'>" + tr("Knihovna neuvádí schvalovatele.") + "</p>") + "</div></div>";
      html += "<h3>" + tr("Typy zařízení ({n})", { n: v.deviceTypes.length }) + "</h3>" + (v.deviceTypes.length
        ? "<div class='tablewrap'><table id='libTypes'><thead><tr><th>ID</th><th>" + tr("Popisek") + "</th><th>" + tr("Třída") + "</th><th>" + tr("Předpona") + "</th><th>" + tr("Volby") + "</th><th>" + tr("Díly kusovníku") + "</th><th>" + tr("Hlídací čas kroku") + "</th></tr></thead><tbody>" +
          v.deviceTypes.map(t => "<tr><td class='mono'>" + esc(t.id) + "</td><td>" + esc(t.label) + (t.desc && t.desc !== t.label ? "<div class='apsum'>" + esc(t.desc) + "</div>" : "") + "</td><td>" + esc(t.clsLabel) + "</td><td class='mono'>" + esc(t.prefix) +
            "</td><td style='font-size:.78rem'>" + esc([t.opts, t.range].filter(Boolean).join(" · ") || "—") + "</td><td class='mono'>" + esc(t.bom) + "</td><td class='mono'>" + (t.stepTimeS !== null ? esc(t.stepTimeS + " s") : "—") + "</td></tr>").join("") + "</tbody></table></div>"
        : "<p class='hint'>" + tr("Knihovna nemá vlastní typy zařízení.") + "</p>");
      html += "<h3>" + tr("Šablony bloků ({n})", { n: v.fbTemplates.length }) + "</h3>" + (v.fbTemplates.length
        ? "<div class='tablewrap'><table id='libTpls'><thead><tr><th>ID</th><th>" + tr("Blok") + "</th><th>" + tr("Dialekt") + "</th><th>" + tr("Platformy") + "</th><th>" + tr("Stav") + "</th></tr></thead><tbody>" +
          v.fbTemplates.map(t => "<tr><td class='mono'>" + esc(t.id) + "</td><td class='mono'>FB_" + esc(t.cls) + (t.note ? "<div class='apsum'>" + esc(t.note) + "</div>" : "") + "</td><td class='mono'>" + esc(t.dialect.toUpperCase()) + "</td><td>" + esc(t.platforms) + "</td><td>" + chip(t.status === "error" ? "rej" : "stale", t.statusLabel) + "</td></tr>").join("") + "</tbody></table></div>" +
          "<p class='hint'>" + tr("Vlastní blok simulace neověřuje — simulace a ověření zrcadlí vestavěnou šablonu. Překlad vlastní šablony kontroluje emulátor; odladit v cílovém IDE.") + "</p>"
        : "<p class='hint'>" + tr("Knihovna nemá vlastní šablony bloků — generátor použije vestavěné.") + "</p>");
      if (v.usage.length) html += "<h3>" + tr("Šablony na platformách projektu") + "</h3><div class='tablewrap'><table id='libUsage'><thead><tr><th>" + tr("Platforma") + "</th><th>" + tr("Blok") + "</th><th>" + tr("Použije se") + "</th></tr></thead><tbody>" +
        v.usage.map(u => "<tr><td>" + esc(u.platName) + "</td><td class='mono'>" + esc(u.cls) + "</td><td>" + chip(u.used ? "stale" : "wait", u.text) + (u.why ? "<div class='apsum'>" + esc(u.why) + "</div>" : "") + "</td></tr>").join("") + "</tbody></table></div>";
    }
    const c = card(el, "01", tr("Firemní knihovna"), html);
    c.id = "libCard";
    c.querySelector("#libFile").addEventListener("change", async e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      let text = "";
      try { text = await readFileText(f); } catch (err) { lv.msg = { level: "err", text: String(err && err.message || err) }; rerender(); return; }
      const r = loadLibrary(text);
      if (!r.lib) { lv.msg = { level: "err", text: tr("Knihovnu nejde použít: {why}", { why: r.issues.filter(i => i.level === "error").map(i => i.msg).join(" ") }) }; rerender(); return; }
      storeLib(r.lib);
      const errs = r.issues.filter(i => i.level === "error").length;
      lv.msg = { level: errs ? "warn" : "ok", text: tr("Načtena knihovna {name} {v} ze souboru {file}.", { name: r.lib.name || "—", v: r.lib.version || "", file: f.name }) +
        (errs ? " " + tr("Kontrola našla {n} chyb — oprav soubor a načti ho znovu.", { n: errs }) : "") };
      rerender();
    });
    c.querySelector("#libSave").addEventListener("click", () => { if (!cur) return; const s = saveLibrary(cur); downloadFile(s.name, s.text); });
    c.querySelector("#libCheck").addEventListener("click", () => {
      if (!v) return;
      lv.msg = { level: v.errors ? "err" : v.warns ? "warn" : "ok", text: tr("Ověřeno: {e} chyb, {w} upozornění.", { e: v.errors, w: v.warns }) + (v.usage.length ? " " + tr("Použití šablon na platformách projektu je v tabulce níže.") : "") };
      rerender();
    });
    c.querySelector("#libAttach").addEventListener("click", () => {
      if (!loaded) return;
      try { attachToProject(p, loaded); } catch (err) { lv.msg = { level: "err", text: String(err && err.message || err) }; rerender(); return; }
      lv.msg = { level: "ok", text: tr("Knihovna {name} připojena k projektu. Výchozí volby se převzaly jen tam, kde projekt ještě nic nezvolil.", { name: loaded.name || "—" }) };
      save(); rerender();
    });
    c.querySelector("#libDetach").addEventListener("click", () => {
      if (!window.confirm(tr("Odpojit knihovnu od projektu? Zařízení z ní zůstanou; generátor pak použije vestavěné bloky a kusovník bez dílů knihovny."))) return;
      detachLibrary(p);
      lv.msg = { level: "ok", text: tr("Knihovna odpojena od projektu.") };
      save(); rerender();
    });
    c.querySelector("#libTpl").addEventListener("click", () => { const s = saveLibrary(libraryTemplate()); downloadFile(s.name, s.text); });
  }

  /* ================================================================ krok Zařízení: přidat z knihovny */
  function rDevLibrary(el) {
    const types = libraryDeviceTypes(S.prj);
    const form = el.querySelector("#bAdd");
    if (!types.length || !form) return;
    const row = document.createElement("div");
    row.className = "row"; row.id = "libDevRow";
    row.innerHTML = "<label class='f' style='flex-direction:row;gap:8px;align-items:center'>" + tr("Přidat z knihovny") + " <select id='libDevType'>" +
      types.map(t => "<option value='" + esc(t.id) + "'>" + esc(t.label) + " — " + esc(t.clsLabel) + "</option>").join("") + "</select></label>" +
      "<input type='text' id='libDevName' maxlength='24' style='width:120px' placeholder='" + esc(tr("označení (auto)")) + "' aria-label='" + esc(tr("Označení")) + "'>" +
      "<button class='small' id='libDevAdd'>" + tr("Přidat z knihovny") + "</button><span class='errtxt' id='libDevErr' style='margin:0'></span>" +
      "<span class='hint' style='margin:0'>" + tr("Typ z knihovny doplní třídu, volby, rozsah, meze a díly kusovníku.") + "</span>";
    form.closest(".row").after(row);
    row.querySelector("#libDevAdd").addEventListener("click", () => {
      try {
        const d = addFromLibrary(S.prj, row.querySelector("#libDevType").value, row.querySelector("#libDevName").value);
        S.notice = { step: STEP_DEV, level: "ok", text: tr("Přidáno zařízení {name} z knihovny.", { name: d.name }) };
        save(); rerender();
      } catch (e) { row.querySelector("#libDevErr").textContent = String(e && e.message || e); }
    });
  }

  /* ================================================================ krok Kusovník: záložky */
  function rBomTabs(el, rBom) {
    const t = document.createElement("div");
    t.className = "tabs outer biztabs"; t.setAttribute("role", "tablist");
    t.innerHTML = [["bom", tr("Kusovník")], ["quote", tr("Nabídka")]]
      .map(([k, l]) => "<button role='tab' data-bt='" + k + "' aria-selected='" + (qv.tab === k) + "'>" + esc(l) + "</button>").join("");
    el.appendChild(t);
    t.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { qv.tab = b.dataset.bt; rerender(); }));
    if (qv.tab === "quote") rQuote(el); else rBom(el);
  }

  function rQuote(el) {
    const p = S.prj;
    const intro = "<p class='hint' style='margin-top:0;max-width:100ch'>" + tr("Nabídka je interní podklad: kusovník oceněný podle tvého ceníku a odhad hodin práce z projektu × tvoje sazby. Ceny se nevymýšlí — bez ceníku, sazby nebo kurzu zůstane cena prázdná a položka je v seznamu bez ceny.") + "</p>";
    if (!p.devices.length) { card(el, "10", tr("Nabídka"), intro + "<p class='hint'>" + tr("Nejdřív navrhni zařízení (kroky 2–4).") + "</p>"); return; }
    let v;
    try { v = quoteView(p); } catch (e) { card(el, "10", tr("Nabídka"), intro + "<p class='errtxt'>" + esc(String(e && e.message || e)) + "</p>"); return; }
    const T = v.totals;
    const imp = qv.imp;
    const curOpts = [...new Set([...CURRENCIES, v.currency])].map(c => "<option" + (c === v.currency ? " selected" : "") + ">" + esc(c) + "</option>").join("");
    /* textové pole s desetinnou čárkou i tečkou (type=number by v anglickém prohlížeči čárku zahodil) */
    const num = (path, val, ph, w = 96) => "<input type='text' inputmode='decimal' class='qnum' data-q='" + esc(path) + "' value='" + esc(numVal(val)) + "' placeholder='" + esc(ph || "") + "' style='width:" + w + "px'>";
    let html = intro;
    /* --- ceník */
    html += "<h3 style='margin-top:6px'>" + tr("Ceník") + "</h3><div class='row' style='margin-top:4px'>" +
      "<label class='small filebtn'><input type='file' id='qFile' accept='.csv,.tsv,.txt,text/csv' hidden><span class='button small primary'>" + tr("Načíst ceník (CSV / TSV)…") + "</span></label>" +
      "<label class='f' style='flex-direction:row;gap:6px;align-items:center'>" + tr("měna řádků bez měny") + " <select id='qDefCur'><option value=''>" + tr("podle souboru") + "</option>" + CURRENCIES.map(c => "<option>" + esc(c) + "</option>").join("") + "</select></label>" +
      (v.priceCount ? "<button class='small danger' id='qDropPrices'>" + tr("Odebrat ceník") + "</button>" : "") +
      "<span class='stat'>" + (v.priceCount ? tr("položek ceníku <b>{n}</b>", { n: v.priceCount }) : tr("ceník nenačten")) + "</span></div>" +
      "<p class='hint'>" + tr("Ceník z Excelu (středník, desetinná čárka) nebo TSV; sloupce se poznají podle záhlaví (objednací kód, typ, výrobce, kategorie, cena, měna, dodavatel, dodací lhůta). Párování: objednací kód → typ a výrobce → kategorie.") + "</p>";
    if (imp) {
      html += "<div class='notice " + (imp.count ? (imp.warnings.length ? "warn" : "ok") : "err") + "' id='qImpMsg' style='margin-top:8px'>" +
        esc(imp.count ? tr("Načteno {n} položek ze souboru {file} (oddělovač: {d}).", { n: imp.count, file: imp.file, d: imp.delimiter }) : tr("Ze souboru {file} se nenačetla žádná cena.", { file: imp.file }) + (imp.kept ? " " + tr("Stávající ceník zůstává.") : "")) +
        (imp.warnings.length ? "<ul class='plain warnlist'>" + imp.warnings.map(w => "<li>" + esc(w) + "</li>").join("") + "</ul>" : "") + "</div>";
    }
    if (v.unused.length) html += "<details class='help' id='qUnused'><summary>" + tr("Nepoužité řádky ceníku ({n})", { n: v.unused.length }) + "</summary><div class='body' style='max-width:none'>" +
      "<p class='hint' style='margin-top:0'>" + tr("Řádky, které nepasují na žádnou položku kusovníku — zkontroluj objednací kód, typ nebo výrobce.") + "</p><div class='tablewrap'><table><thead><tr><th>" + tr("Řádek") + "</th><th>" + tr("Objednací kód") + "</th><th>" + tr("Typ") + "</th><th>" + tr("Výrobce") + "</th><th>" + tr("Kategorie") + "</th><th>" + tr("Cena") + "</th></tr></thead><tbody>" +
      v.unused.map(u => "<tr><td class='mono'>" + esc(u.row) + "</td><td class='mono'>" + esc(u.orderCode || "—") + "</td><td>" + esc(u.type || "—") + "</td><td>" + esc(u.brand || "—") + "</td><td>" + esc(u.cat || "—") + "</td><td class='mono'>" + esc(u.price) + "</td></tr>").join("") + "</tbody></table></div></div></details>";
    /* --- měna, sazby */
    html += "<h3>" + tr("Měna, sazby a přirážky") + "</h3><div class='qgrid'>" +
      "<label class='f'>" + tr("Měna nabídky") + "<select id='qCur'>" + curOpts + "</select></label>" +
      v.foreign.map(f => "<label class='f'>" + esc(f.label) + num("fx." + f.cur, f.value, tr("kurz nezadán")) + "</label>").join("") +
      "<label class='f'>" + tr("DPH [%]") + num("vatPct", p.quote?.vatPct, "21") + "</label>" +
      "<label class='f'>" + tr("Přirážka na materiál [%]") + num("marginPct", p.quote?.marginPct, "0") + "</label>" +
      v.rates.map(r => "<label class='f'>" + esc(r.label) + " [" + esc(r.unit) + "]" + num("rates." + r.key, r.value, tr("nezadáno")) + "</label>").join("") + "</div>" +
      (v.foreign.length ? "<p class='hint'>" + tr("Kurz = kolik jednotek měny nabídky stojí 1 jednotka cizí měny. Bez kurzu zůstanou položky v cizí měně bez ceny.") + "</p>" : "") +
      "<p class='hint'>" + tr("Sazby nemají výchozí hodnotu — práce bez sazby zůstane bez ceny.") + "</p>";
    /* --- parametry odhadu */
    html += "<details class='help' id='qParams'" + (qv.paramsOpen ? " open" : "") + "><summary>" + tr("Parametry odhadu hodin") + " <span class='hint' style='margin:0;font-weight:400'>" + tr("prázdné = výchozí hodnota / odhad z projektu") + "</span></summary><div class='body' style='max-width:none'>" +
      "<div class='tablewrap'><table id='qParamTable'><thead><tr><th>" + tr("Parametr") + "</th><th>" + tr("Hodnota") + "</th><th>" + tr("Jednotka") + "</th><th>" + tr("Vysvětlení") + "</th></tr></thead><tbody>" +
      v.params.map(x => "<tr><td><b>" + esc(x.label) + "</b>" + (x.count ? " <span class='hint' style='margin:0'>(" + tr("{n}× v projektu", { n: x.count }) + ")</span>" : "") + "</td><td>" + num("params." + x.key, x.value, x.placeholder, 110) + "</td><td class='mono'>" + esc(x.unit) + "</td><td class='apsum' style='margin:0'>" + esc(x.help) + "</td></tr>").join("") +
      "</tbody></table></div><p class='hint'>" + tr("Výchozí hodnoty jsou orientační — uprav je podle vlastní praxe.") + "</p></div></details>";
    /* --- souhrn */
    html += "<h3>" + tr("Souhrn") + "</h3><div class='qtotals' id='qTotals'>" +
      [[tr("Materiál (nákup)"), T.materialCost], [T.marginLabel, T.margin], [tr("Práce ({h})", { h: T.hours }), T.labor], [tr("Celkem bez DPH"), T.net, "b"], [T.vatLabel, T.vat], [tr("Celkem s DPH"), T.gross, "b"]]
        .map(([l, x, b]) => "<div class='qt" + (b ? " sum" : "") + "'><span>" + esc(l) + "</span><b>" + esc(x) + "</b></div>").join("") + "</div>";
    if (!T.complete) {
      /* práce (chybí sazba) vždy celá, materiál prvních 12 — celý seznam je v tabulce níže (červeně) */
      const lab = v.unpriced.filter(u => u.kind === "labor"), mat = v.unpriced.filter(u => u.kind === "material");
      const li = u => "<li>" + esc(u.label) + " — " + esc(u.reason) + "</li>";
      html += "<div class='warnbox' id='qUnpriced'><b>" + tr("Součty nejsou úplné: {n} položek bez ceny.", { n: v.unpriced.length }) + "</b><ul class='plain'>" +
        lab.map(li).join("") + mat.slice(0, 12).map(li).join("") + (mat.length > 12 ? "<li>" + tr("… a dalších {n}", { n: mat.length - 12 }) + "</li>" : "") + "</ul></div>";
    }
    /* --- materiál */
    html += "<h3>" + tr("Materiál ({n})", { n: v.material.length }) + "</h3><div class='tablewrap scrolly'><table class='qmat' id='qMat'><thead><tr><th>" + tr("Označení") + "</th><th>" + tr("Položka") + "</th><th>" + tr("Výrobce") + "</th><th>" + tr("Typ") +
      "</th><th>" + tr("Objednací kód") + "</th><th>" + tr("Ks") + "</th><th class='num'>" + tr("Cena/ks") + "</th><th class='num'>" + tr("Celkem") + "</th><th>" + tr("Párování") + "</th></tr></thead><tbody>" +
      v.material.map(m => "<tr class='qm-" + esc(m.match) + "'><td class='mono'><b>" + esc(m.tag) + "</b></td><td>" + (m.safety ? "<span class='warnmark'>⚠</span> " : "") + esc(m.item) + "</td><td>" + esc(m.brand) + "</td><td style='font-size:.78rem'>" + esc(m.type) +
        "</td><td class='mono'>" + esc(m.orderCode || "—") + "</td><td class='mono'>" + esc(m.qty) + "</td><td class='mono num'>" + (m.unitPrice ? esc(m.unitPrice) + (m.src ? "<div class='apsum'>" + esc(m.src) + "</div>" : "") : "<span class='noprice'>—</span>") +
        "</td><td class='mono num'>" + (m.total ? esc(m.total) : "<span class='noprice'>—</span>") + "</td><td>" + chip(m.tone, m.matchLabel) + (m.priceRow ? " <span class='hint' style='margin:0'>" + tr("ř. {n}", { n: m.priceRow }) + "</span>" : "") +
        (m.reason && m.match !== "none" ? "<div class='apsum'>" + esc(m.reason) + "</div>" : "") + "</td></tr>").join("") + "</tbody></table></div>" +
      "<p class='hint'>" + tr("Párování „kategorie“ = cena podle kategorie, ne podle konkrétního typu — ověř.") + "</p>";
    /* --- práce */
    html += "<h3>" + tr("Práce") + "</h3><div class='tablewrap'><table id='qLabor'><thead><tr><th>" + tr("Položka") + "</th><th>" + tr("Výpočet") + "</th><th class='num'>" + tr("Množství") + "</th><th class='num'>" + tr("Sazba") + "</th><th class='num'>" + tr("Celkem") + "</th></tr></thead><tbody>" +
      v.labor.map(l => "<tr title='" + esc(l.help) + "'><td>" + esc(l.label) + "</td><td class='mono' style='font-size:.74rem'>" + esc(l.basis) + "</td><td class='mono num'>" + esc(l.qty) + "</td><td class='mono num'>" + (l.rate ? esc(l.rate) : "<span class='noprice'>—</span>") +
        "</td><td class='mono num'>" + (l.total ? esc(l.total) : "<span class='noprice'>—</span>") + "</td></tr>").join("") + "</tbody></table></div>";
    /* --- export */
    html += "<div class='row'><button class='small primary' id='qCsv'>" + tr("Stáhnout CSV") + "</button><button class='small' id='qMd'>" + tr("Stáhnout {file}", { file: esc(v.file) }) + "</button>" +
      "<label class='chk' style='margin:0'><input type='checkbox' id='qInDocs'" + (v.inDocs ? " checked" : "") + "> " + tr("přidat {file} do dokumentace", { file: esc(v.file) }) + "</label>" +
      "<span class='hint' style='margin:0'>" + tr("Interní podklad — do dokumentace pro zákazníka jen na výslovnou volbu.") + "</span></div>";
    const c = card(el, "10", tr("Nabídka — interní podklad"), html);
    c.id = "quoteCard";
    c.querySelector("#qFile").addEventListener("change", async e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      let text = "";
      try { text = await readFileText(f); } catch (err) { qv.imp = { file: f.name, count: 0, warnings: [String(err && err.message || err)], delimiter: "" }; rerender(); return; }
      const r = importPrices(p, text, c.querySelector("#qDefCur").value || undefined);
      qv.imp = { ...r, file: f.name };
      save(); rerender();
    });
    const drop = c.querySelector("#qDropPrices");
    if (drop) drop.addEventListener("click", () => { setQuote(p, "prices", null); qv.imp = null; save(); rerender(); });
    c.querySelector("#qCur").addEventListener("change", e => { setQuote(p, "currency", e.target.value); save(); rerender(); });
    c.querySelectorAll("input[data-q]").forEach(inp => inp.addEventListener("change", () => {
      const s = inp.value.trim().replace(",", ".");
      const n = s === "" ? null : Number(s);
      if (n !== null && !(Number.isFinite(n) && n >= 0)) { inp.setCustomValidity(tr("Zadej nezáporné číslo.")); inp.reportValidity(); return; }
      inp.setCustomValidity("");
      setQuote(p, inp.dataset.q, n); save(); rerender();
    }));
    c.querySelector("#qParams").addEventListener("toggle", e => { qv.paramsOpen = e.target.open; });
    c.querySelector("#qInDocs").addEventListener("change", e => { setQuote(p, "inDocs", e.target.checked); save(); });
    c.querySelector("#qCsv").addEventListener("click", () => { const f = quoteFiles(p); downloadFile(f.csvName, f.csv); });
    c.querySelector("#qMd").addEventListener("click", () => { const f = quoteFiles(p); downloadFile(f.mdName, f.md); });
  }

  return { updateBadge, rRevisions, rLibrary, rDevLibrary, rBomTabs };
}
