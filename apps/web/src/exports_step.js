/* PLCdesk — krok Generovat, záložka SISTEMA a EPLAN: exporty pro kontrolu PL v SISTEMA (IFA) a pro
   EPLAN Electric P8 (AutomationML AR APC + seznamy + skript). Obsah počítá jádro (sistema.ts,
   eplan.ts); stav obou je „neověřeno importem“ a UI ho ukazuje u každého souboru. Stejné soubory
   jsou i v kroku Dokumentace (skupiny SISTEMA a EPLAN). Desktop: steps/exporty.py (operace exports). */
import {
  escHtml as esc, tr, N_, syncIO, sistemaExport, sistemaFileName, SISTEMA_FILE, eplanFiles, eplanAmlName, eplanConverterId, validateEplan,
  EPLAN_SCRIPT_NAME, EPLAN_VERIFIED,
} from "../../../packages/core/dist/index.js";
import { card, downloadFile, downloadFiles } from "./util.js";
import { trn } from "./plural.js";


export function makeExportsTab(ctx) {
  const { S, save, render } = ctx;
  const view = { file: null };
  const go = i => { S.step = i; save(); render(); };

  function fileRows(list, pre) {
    return "<div class='tablewrap'><table class='hmitable'><thead><tr><th>" + tr("Soubor") + "</th><th>" + tr("Stav ověření") + "</th><th></th></tr></thead><tbody>" +
      list.map(f => "<tr data-file='" + esc(pre + f.name) + "'" + (view.file === pre + f.name ? " class='sel'" : "") + "><td class='mono'><button class='linkbtn' data-xshow='" + esc(pre + f.name) + "'>" + esc(f.name) + "</button></td><td><span class='st st-stale'>" + tr("neověřeno importem") + "</span></td><td><button class='small' data-xdl='" + esc(pre + f.name) + "'>" + tr("Stáhnout") + "</button></td></tr>").join("") +
      "</tbody></table></div>";
  }

  function render_(el) {
    const p = S.prj;
    syncIO(p);
    if (!p.devices.length) { card(el, "08", tr("SISTEMA a EPLAN"), "<p class='hint'>" + tr("Nejdřív přidej zařízení (krok 4), nech si je navrhnout v kroku AI návrh, nebo použij volbu Import.") + "</p>"); return; }
    const all = {};

    /* ---- SISTEMA */
    const sx = sistemaExport(p);
    const sList = Object.entries(sx.files).filter(([n]) => n !== SISTEMA_FILE).map(([name, body]) => ({ name, body }));
    const nFns = sx.model.fns.length;
    for (const f of sList) all["s:" + f.name] = f;
    all["s:" + SISTEMA_FILE] = { name: SISTEMA_FILE, body: sx.files[SISTEMA_FILE] };
    let hs = "<p class='hint' style='margin-top:0;max-width:86ch'>" + tr("Výpočet PL v PLCdesk je zjednodušený (sloupcový graf ISO 13849-1, bez PFHd). Tento export předá funkce, subsystémy, kanály a bloky do SISTEMA, kde se PL a PFHd spočítá metodou IFA. Platí výsledek ze SISTEMA po kontrole odpovědnou osobou.") + "</p>" +
      "<p class='warnbox' data-verified='sistema'>" + esc(tr("Stav ověření: {state}.", { state: sx.verified })) + "</p>";
    if (!nFns) hs += "<p class='hint'>" + tr("Projekt nemá bezpečnostní funkce s PLr — není co exportovat.") + "</p><div class='row'><button class='small' data-go='10'>" + tr("Bezpečnost") + " ↗</button></div>";
    else {
      hs += "<div class='stats'><span class='stat'>" + trn(nFns, N_("{n} bezpečnostní funkce|{n} bezpečnostní funkce|{n} bezpečnostních funkcí")) + "</span>" +
        (sx.model.approved ? "<span class='stat st-ok'><b>✔</b> " + tr("bezpečnostní funkce schváleny") + "</span>" : "<span class='stat st-rej'><b>" + tr("NESCHVÁLENO") + "</b></span>") + "</div>" +
        fileRows(sList, "s:") +
        "<h4>" + tr("Postup v SISTEMA") + "</h4><ol class='plain steps'>" +
        "<li>" + tr("Stáhni SISTEMA zdarma ze stránek IFA (bez registrace) a nainstaluj.") + "</li>" +
        "<li>" + tr("Soubor → Otevřít → `{file}`. Pokud SISTEMA nabídne převod na novější vydání normy, potvrď ho.", { file: sistemaFileName(p) }).replace(/`([^`]+)`/g, "<code>$1</code>") + "</li>" +
        "<li>" + tr("U každého subsystému zkontroluj kategorii a potvrď požadavky kategorie a podmínky PL (záložky Kategorie a PL) — export je záměrně nevyplňuje.") + "</li>" +
        "<li>" + tr("U bloků ověř B10d / MTTFd a DC podle datasheetů konkrétních variant; u přístrojů s PL doplň PFHd z prohlášení výrobce (zástupné hodnoty jsou označené).") + "</li>" +
        "<li>" + tr("Výsledné PL a PFHd zapiš do tabulky v kap. 4 a rozdíly vyřeš; protokol SISTEMA přilož k technické dokumentaci.") + "</li></ol>" +
        "<div class='row'><button class='small' data-xshow='s:" + SISTEMA_FILE + "'>" + tr("Celý postup a předpis ({file})", { file: SISTEMA_FILE }) + "</button><button class='small primary' id='sxAll'>" + tr("Stáhnout soubory pro SISTEMA") + "</button></div>";
    }

    /* ---- EPLAN */
    let he;
    const eList = p.io.length ? eplanFiles(p) : [];
    if (!eList.length) he = "<p class='hint'>" + tr("Projekt zatím nemá signály I/O — export do EPLAN vznikne z tabulky I/O.") + "</p>";
    else {
      for (const f of eList) all["e:" + f.name] = f;
      const issues = validateEplan(p);
      const nErr = issues.filter(i => i.level === "error").length, nWarn = issues.length - nErr;
      he = "<p class='hint' style='margin-top:0;max-width:86ch'>" + tr("AutomationML (AR APC 1.4.0) se stanicí PLC, kartami a symbolickými adresami, seznam zařízení z kusovníku, svorky a vodiče shodné s výkresy a skript pro EPLAN, který import spustí jedním krokem.") + "</p>" +
        "<p class='warnbox' data-verified='eplan'>" + esc(tr("Stav ověření: {state}.", { state: tr(EPLAN_VERIFIED) })) + "</p>" +
        "<div class='stats'><span class='stat" + (nErr ? " st-rej" : " st-ok") + "'>" + tr("kontrola exportu: <b>{e}</b> chyb, <b>{w}</b> upozornění", { e: nErr, w: nWarn }) + "</span></div>" +
        (issues.length ? "<ul class='plain warnlist'>" + issues.slice(0, 8).map(i => "<li>" + (i.level === "error" ? "✖ " : "⚠ ") + esc(i.where + ": " + i.msg) + "</li>").join("") + "</ul>" : "") +
        fileRows(eList, "e:") +
        "<h4>" + tr("Postup v EPLAN") + "</h4><ol class='plain steps'>" +
        "<li>" + tr("Otevři cílový projekt EPLAN (firemní šablona s kmenovými daty).") + "</li>" +
        "<li>" + tr("Projektová data → PLC → Import PLC dat: soubor {file}, konvertor {conv}, porovnání objektů podle ID — nebo spusť skript {script} (Soubor → Extras → Skripty → Spustit).", { file: "<code>" + esc(eplanAmlName(p)) + "</code>", conv: "<code>" + esc(eplanConverterId(p)) + "</code>", script: "<code>" + esc(EPLAN_SCRIPT_NAME) + "</code>" }) + "</li>" +
        "<li>" + tr("Seznam zařízení načti importem zařízení (eplan_zarizeni.csv), svorky a vodiče jsou podklad pro svorkovnice a označení spojů.") + "</li>" +
        "<li>" + tr("První import zkontroluj a nálezy zapiš — podrobnosti a omezení jsou v README_EPLAN.txt.") + "</li></ol>" +
        "<div class='row'><button class='small' data-xshow='e:README_EPLAN.txt'>" + tr("Zobrazit README_EPLAN.txt") + "</button><button class='small primary' id='epAll'>" + tr("Stáhnout soubory pro EPLAN") + "</button></div>";
    }

    const c = card(el, "08", tr("Exporty SISTEMA a EPLAN"),
      "<div class='expgrid'><section><h3 style='margin-top:0'>" + tr("SISTEMA (IFA) — kontrola PL") + "</h3>" + hs + "</section>" +
      "<section><h3 style='margin-top:0'>" + tr("EPLAN Electric P8") + "</h3>" + he + "</section></div>" +
      "<div class='codebox' style='margin-top:12px'" + (view.file && all[view.file] ? "" : " hidden") + " id='xPrevBox'><pre class='code' id='xPrev'></pre></div>" +
      "<p class='note'>" + tr("Soubory jsou i v kroku Dokumentace (skupiny SISTEMA a EPLAN). Licenci EPLAN PLCdesk nemá — export je kontrolovaný vlastní strukturální kontrolou a schématy, skutečný import je potřeba vyzkoušet.") + "</p>");
    const show = () => {
      const f = all[view.file];
      c.querySelector("#xPrevBox").hidden = !f;
      c.querySelector("#xPrev").textContent = f ? f.body : "";
      c.querySelectorAll("tr[data-file]").forEach(r => r.classList.toggle("sel", r.dataset.file === view.file));
    };
    show();
    c.querySelectorAll("[data-xshow]").forEach(b => b.addEventListener("click", () => { view.file = b.dataset.xshow; show(); c.querySelector("#xPrevBox").scrollIntoView({ block: "nearest" }); }));
    const saveName = k => (k.startsWith("e:") ? (all[k].name.startsWith("eplan_") ? "" : "eplan_") : (all[k].name.startsWith("sistema_") ? "" : "sistema_")) + all[k].name;
    c.querySelectorAll("[data-xdl]").forEach(b => b.addEventListener("click", () => downloadFile(saveName(b.dataset.xdl), all[b.dataset.xdl].body)));
    c.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => go(+b.dataset.go)));
    const sAll = c.querySelector("#sxAll");
    if (sAll) sAll.addEventListener("click", () => downloadFiles(Object.keys(all).filter(k => k.startsWith("s:")).map(k => [saveName(k), all[k].body]), sAll));
    const eAll = c.querySelector("#epAll");
    if (eAll) eAll.addEventListener("click", () => downloadFiles(Object.keys(all).filter(k => k.startsWith("e:")).map(k => [saveName(k), all[k].body]), eAll));
  }
  return { render: render_ };
}
