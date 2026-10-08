/* Renderery kroků workflow. ctx = { S, save, render } — stav vlastní app.js.
   Texty pro uživatele jdou přes tr() (český text = klíč překladu); struktura HTML zůstává mimo klíče. */
import {
  PLAT, CLS, esc, blankProject, devById, nextName, syncIO, autoAddr, modules, wireNo,
  validateProject, sanitizeTag, genFor, allProjectFiles, licensedGen, licensedProjectFiles,
  svgBlock, sheetSVG, sheetDXF, svorkyCSV,
  tr, N_, getLang, DO_ROLES, stepTitle, projectFileName, projectFolderName, projectNumberProblem,
  devDefaults, isMotionClass, hasRange, ACTS_FOR, maxRecord, recordsText, parseRecords,
  buildBom, bomOptions, bomPlatform, bomCsv, catKey, suppliersFor, SUPPLIERS, CATALOG_DATE, PLATFORM_REFS,
  hwAddrText, AXIS_FIELDS, axisCfgOf, axisPositionsText, parseAxisPositions, axisSupport, hasAxis, verificationInfo,
  verifyPackArchive, licenseSiteUrl,
  renameDevice, setDeviceDesc, setDeviceOpts, setDeviceRange, deviceOpts, deviceNameProblem,
  updateStep, insertStep, duplicateStep, setIoTag, setIoAddr, setIoCmt,
} from "../../../packages/core/dist/index.js";
import { $, card, copyText, downloadFile, downloadFiles, downloadProjectZip, suggestNumber, saveBytesUngated, normProject, normAi, setProjectHeader } from "./util.js";
import { gateFor } from "./license.js";
import { aiSettings, saveAiSettings, aiCall, aiListModels, AI_MODELS, AI_DEFAULT_MODEL, extractJson, aiNorm, seedFromProject, AI_EXAMPLE } from "./ai.js";

/** Šířka číselného pole konfigurace osy podle délky textu (číslice + rezerva na šipky pole). */
const axWidth = t => "calc(" + Math.max(5, String(t).length + 1) + "ch + 34px)";

export function makeSteps(ctx) {
  const { S, save, render } = ctx;
  const prj = () => S.prj;
  /** Meze měření, žádaná hodnota a role výstupu jako text (sloupec Volby). */
  function devExtraTxt(d) {
    const u = v => v + (d.unit ? " " + d.unit : "");
    const out = [];
    if (Number.isFinite(d.limLo)) out.push(tr("min {v}", { v: u(d.limLo) }));
    if (Number.isFinite(d.limHi)) out.push(tr("max {v}", { v: u(d.limHi) }));
    if (Number.isFinite(d.setpoint)) out.push(tr("žádaná {v}", { v: u(d.setpoint) }));
    if (d.role && DO_ROLES[d.role]) out.push(tr(DO_ROLES[d.role]));
    if ((d.cls === "Vfd" || d.cls === "PropValve") && Number(d.rampS) > 0) out.push(tr("rampa {t} s", { t: d.rampS }));
    if (d.cls === "PropValve" && Number.isFinite(d.tol)) out.push(tr("tolerance ± {v}", { v: u(d.tol) }));
    if (d.cls === "PosDrive") out.push(tr("záznamy 1–{max}", { max: maxRecord(d) }));
    if (d.cls === "Axis") { const a = axisCfgOf(d); out.push(tr("max. {v} {unit}/s, {n} poloh", { v: a.vMax, unit: d.unit || "", n: a.positions.length })); }
    return out.join(", ");
  }
  /** Přeložené názvy akcí kroku sekvence. */
  const actTxt = () => ({ start: tr("start"), stop: tr("stop"), open: tr("otevřít"), close: tr("zavřít"),
    home: tr("referenční jízda"), posRecord: tr("jízda na záznam"), setPressure: tr("nastavit tlak"), setFlow: tr("nastavit průtok"),
    moveAbs: tr("najet na polohu"), moveRel: tr("posun o dráhu"), velocity: tr("jízda rychlostí"), halt: tr("zastavit osu"), waitInPos: tr("čekat na dojetí osy") });
  /** Číslo z pole formuláře; prázdné / neplatné = undefined (hodnota nezadána). */
  const numIn = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
  /** Výběr role digitálního výstupu (včetně „bez vazby"). */
  const roleOptions = sel => "<option value=''>" + tr("— bez vazby —") + "</option>" +
    Object.keys(DO_ROLES).map(r => "<option value='" + r + "'" + (sel === r ? " selected" : "") + ">" + esc(tr(DO_ROLES[r])) + "</option>").join("");
  /** Hláška poslední úpravy v kroku Zařízení / I/O (ukáže se při dalším vykreslení kroku). */
  let devMsg = null, ioMsg = null, schMsg = null;
  /** Odkaz ze schématu: zvýrazní řádek tabulky, posune na něj a dá fokus do pole k úpravě. */
  function goToRow(root, sel, focusSel) {
    const row = sel && root.querySelector(sel);
    if (!row) return;
    row.classList.add("hl");
    row.scrollIntoView({ block: "center" });
    const f = row.querySelector(focusSel);
    if (f) f.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------- 1 Projekt */
  function rProjekt(el) {
    const p = prj();
    const c = card(el, "01", tr("Projekt"), `
    <div class="grid g2">
      <label class="f">${tr("Název projektu / stroje")}
        <input type="text" id="pName" value="${esc(p.meta.name)}" placeholder="${esc(tr("např. Temperační stanice TS-02"))}">
      </label>
      <label class="f">${tr("Číslo projektu")}
        <input type="text" id="pNumber" value="${esc(p.meta.number || "")}" placeholder="${esc(tr("RRNNNN, např. 260705"))}" aria-describedby="pNumberWarn">
        <span class="hint errtxt" id="pNumberWarn" hidden></span>
      </label>
      <label class="f">${tr("Zákazník")}
        <input type="text" id="pCustomer" value="${esc(p.meta.customer || "")}" placeholder="${esc(tr("jméno nebo firma zákazníka"))}">
      </label>
      <label class="f">${tr("Datum zahájení projektu")}
        <input type="date" id="pStart" value="${esc(p.meta.startDate || "")}" lang="${esc(getLang())}">
      </label>
      <label class="f">${tr("Požadovaný takt [s] (ověří simulace)")}
        <input type="number" id="pTakt" min="0" step="any" value="${Number.isFinite(p.meta.takt) ? p.meta.takt : ""}">
      </label>
    </div>
    <label class="f">${tr("Popis")}
      <textarea id="pDesc" rows="3" style="min-height:0;overflow:hidden" placeholder="${esc(tr("co stroj dělá, pro koho — víc řádků a odstavců jde do dokumentace (FDS, návod)"))}">${esc(p.meta.desc)}</textarea>
    </label>
    <p class="hint">${tr("Číslo projektu, zákazník a datum zahájení se propíšou do popisového pole výkresů, hlaviček dokumentů a README platforem, číslo i do názvů stahovaných souborů — do kódu PLC ne.")}</p>
    <div class="row">
      <button class="small primary" id="bZip">${tr("Stáhnout projekt (ZIP)")}</button>
      <span class="hint" id="zipInfo">${tr("celá projektová složka {folder}: dokumentace, výkresy, program PLC, HMI, bezpečnost, kusovník, oživení, schválení, exporty a projekt — s číslem projektu na začátku názvu každého souboru", { folder: "<code>" + esc(projectFolderName(p)) + "</code>" })}</span>
    </div>
    <div class="row">
      <button class="small" id="bExport">${tr("Export návrhu (JSON)")}</button>
      <button class="small" id="bImportJson">${tr("Načíst návrh (JSON)")}</button>
      <button class="small" id="bImportExisting">${tr("Načíst stávající zařízení…")}</button>
      <button class="small danger" id="bReset">${tr("Nový prázdný projekt")}</button>
    </div>
    <textarea id="jsonBox" hidden style="margin-top:12px;min-height:120px" spellcheck="false" aria-label="${esc(tr("JSON návrhu"))}"></textarea>
    <div class="row" id="jsonRow" hidden>
      <button class="small" id="bJsonCopy">${tr("Kopírovat JSON")}</button>
      <button class="small" id="bJsonDl">${tr("Stáhnout JSON")}</button>
      <button class="small primary" id="bJsonLoad">${tr("Načíst z textu")}</button>
    </div>
    <p class="note">${tr("Projdi kroky zleva doprava — návrh se průběžně ukládá v prohlížeči a mezi kroky se můžeš kdykoli vracet a vstupy upřesňovat; výstupy se vždy přepočítají. Nejrychlejší start: popiš stroj v kroku <b>AI návrh</b>. Existující projekt převezmeš vedlejší volbou <b>Import</b> dole v kroku Zařízení. Pokud s PLC začínáš, otevři <b>Nápovědu</b> (tlačítko vpravo v liště kroků).")}</p>`);
    c.querySelector("#pName").addEventListener("input", e => { p.meta.name = e.target.value; save(); setProjectHeader(p); numWarn(); });
    /* číslo a zákazník: prázdné pole se v projektu neukládá (výstup pak přesně jako bez nich) */
    /* tvar čísla RRNNNN (core projectNumberProblem): jiný tvar jen varuje, číslo se použije, jak je */
    const numWarn = () => {
      const w = c.querySelector("#pNumberWarn"), msg = projectNumberProblem(p.meta.number || "");
      w.textContent = msg ? "⚠ " + msg : ""; w.hidden = !msg;
      const zi = c.querySelector("#zipInfo code");
      if (zi) zi.textContent = projectFolderName(p);
    };
    for (const [id, f] of [["#pNumber", "number"], ["#pCustomer", "customer"]]) c.querySelector(id).addEventListener("input", e => {
      if (e.target.value.trim()) p.meta[f] = e.target.value; else delete p.meta[f];
      save(); setProjectHeader(p); numWarn();
    });
    numWarn();
    c.querySelector("#bZip").addEventListener("click", e => downloadProjectZip(p, JSON.stringify({ prj: S.prj, ai: S.ai }, null, 1), e.currentTarget));
    /* datum zahájení: prohlížeč dává ISO YYYY-MM-DD (zobrazení podle jazyka), prázdné = bez data */
    c.querySelector("#pStart").addEventListener("change", e => {
      if (e.target.value) p.meta.startDate = e.target.value; else delete p.meta.startDate;
      save();
    });
    /* víceřádkový popis: výška podle obsahu */
    const ta = c.querySelector("#pDesc");
    const fit = () => { ta.style.height = "auto"; ta.style.height = (ta.scrollHeight + 2) + "px"; };
    ta.addEventListener("input", e => { p.meta.desc = e.target.value; save(); fit(); });
    requestAnimationFrame(fit);
    c.querySelector("#pTakt").addEventListener("change", e => {
      const v = parseFloat(e.target.value);   // prázdné / nesmysl / ≤ 0 = takt nezadán
      if (Number.isFinite(v) && v > 0) p.meta.takt = v; else delete p.meta.takt;
      save();
    });
    /* nový projekt / ukázka přepíše rozpracovaný návrh — jen po potvrzení (prázdný projekt se nepta) */
    const replaceOk = () => {
      const empty = !S.prj.devices.length && !S.prj.meta.name && !(S.prj.meta.desc || "").trim() && !S.ai.turns.length;
      return empty || window.confirm(tr("Tím se nahradí aktuální návrh ({name}, zařízení: {n}) včetně konverzace v kroku AI návrh. Uložit si ho můžeš tlačítkem Export návrhu (JSON). Pokračovat?",
        { name: S.prj.meta.name || tr("bez názvu"), n: S.prj.devices.length }));
    };
    c.querySelector("#bImportExisting").addEventListener("click", () => ctx.openImport && ctx.openImport());
    c.querySelector("#bReset").addEventListener("click", () => { if (!replaceOk()) return; S.prj = blankProject(); const n = suggestNumber([p.meta.number]); if (n) S.prj.meta.number = n; S.ai = { turns: [], last: null, draft: "" }; save(); render(); });
    const jb = c.querySelector("#jsonBox"), jr = c.querySelector("#jsonRow");
    const payload = () => JSON.stringify({ prj: S.prj, ai: S.ai }, null, 1);
    c.querySelector("#bExport").addEventListener("click", () => { jb.hidden = false; jr.hidden = false; jb.value = payload(); });
    c.querySelector("#bImportJson").addEventListener("click", () => { jb.hidden = false; jr.hidden = false; jb.value = ""; jb.placeholder = tr("Vlož dříve exportovaný JSON návrhu…"); jb.focus(); });
    c.querySelector("#bJsonCopy").addEventListener("click", () => copyText(jb.value || payload(), c.querySelector("#bJsonCopy")));
    c.querySelector("#bJsonDl").addEventListener("click", () => downloadFile(projectFolderName(p) + ".plcstudio.json", jb.value || payload()));
    c.querySelector("#bJsonLoad").addEventListener("click", () => {
      try {
        const d = JSON.parse(jb.value);
        let prjNew;
        try { prjNew = normProject(d && d.prj ? d.prj : d); } catch { alertRow(c, tr("JSON neobsahuje návrh PLCdesk.")); return; }
        S.prj = prjNew;
        S.ai = normAi(d.ai);
        /* projekt bez konverzace (příklad ze samples/, cizí soubor) → krok AI návrh předvyplnit */
        if (!S.ai.turns.length && S.prj.devices.length) {
          S.ai = seedFromProject(S.prj, S.prj.meta.desc || S.prj.meta.name || "",
            tr("Návrh převzatý z otevřeného projektu — pokračuj úpravami: napiš, co změnit, a AI zná celou aktuální sestavu."));
        }
        S.step = 0; save(); render();
      } catch { alertRow(c, tr("Neplatný JSON.")); }
    });
  }
  function alertRow(c, msg) {
    let d = c.querySelector(".errtxt");
    if (!d) { d = document.createElement("div"); d.className = "errtxt"; c.appendChild(d); }
    d.textContent = msg;
  }

  /* ---------------------------------------------------------- 2 AI návrh */
  let aiBusy = false, aiCtl = null, aiStatusMsg = "";
  function aiTurnView(t) {
    if (t.role === "user") return '<div class="msg u"><span class="who">' + tr("Ty") + "</span>" + esc(t.content) + "</div>";
    let r = null;
    try { r = aiNorm(JSON.parse(t.content)); } catch { /* text */ }
    if (!r) return '<div class="msg a"><span class="who">AI</span>' + esc(t.content.slice(0, 300)) + "</div>";
    let h = '<div class="msg a"><span class="who">' + tr("AI návrhář") + "</span>";
    if (r.questions.length) h += "<b>" + tr("Potřebuji upřesnit:") + "</b><ul style='margin:4px 0;padding-left:18px'>" + r.questions.map(q => "<li>" + esc(q) + "</li>").join("") + "</ul>";
    if (r.devices.length) h += r.seq.length
      ? tr("Navrženo <b>{n} zařízení</b> a sekvence o {m} krocích.", { n: r.devices.length, m: r.seq.length })
      : tr("Navrženo <b>{n} zařízení</b>.", { n: r.devices.length });
    if (r.note) h += '<div class="hint" style="margin-top:4px">' + esc(r.note) + "</div>";
    return h + "</div>";
  }
  function aiApply() {
    const pr = S.ai.last;
    if (!pr || !pr.devices.length) return;
    const p = prj();
    /* zařízení se stejným označením a třídou si nechá GUID (identita pro opakovaný export do EPLAN) */
    const oldGuid = Object.fromEntries(p.devices.filter(d => d.guid).map(d => [d.name + "|" + d.cls, d.guid]));
    const oldDev = Object.fromEntries(p.devices.map(d => [d.id, d])), oldIo = p.io;
    p.devices = []; p.io = []; p.nextId = 1;
    const byName = {};
    for (const d of pr.devices) {
      const name = d.name && !byName[d.name] ? d.name : nextName(p, d.cls);
      const nd = { id: p.nextId++, name, cls: d.cls, desc: d.desc, opt: d.opt, unit: d.unit, rmin: d.rmin, rmax: d.rmax };
      if (oldGuid[name + "|" + d.cls]) nd.guid = oldGuid[name + "|" + d.cls];
      // meze měření, žádaná hodnota a role výstupu (aiNorm je už pustil jen u správné třídy)
      if (d.cls === "AnalogIn") { if (Number.isFinite(d.limHi)) nd.limHi = d.limHi; if (Number.isFinite(d.limLo)) nd.limLo = d.limLo; }
      if ((d.cls === "AnalogOut" || d.cls === "Vfd" || d.cls === "PropValve") && Number.isFinite(d.setpoint)) nd.setpoint = d.setpoint;
      for (const f of ["rampS", "tol", "tolTimeS", "selBits", "travelS"]) if (Number.isFinite(d[f])) nd[f] = d[f];
      if (typeof d.libType === "string" && d.libType) nd.libType = d.libType;
      if (Array.isArray(d.records)) nd.records = d.records;
      if (d.cls === "Axis" && d.axis) nd.axis = d.axis;
      if (d.cls === "DO" && DO_ROLES[d.role]) nd.role = d.role;
      p.devices.push(nd); byName[name] = nd;
    }
    /* I/O zařízení, které zůstalo (stejné označení a třída), se převezme i s adresou, komentářem a NC
       (úpravy z kroku I/O); jen klíč dostane nové id. Změněný popis zařízení se propíše do komentáře. */
    p.io = oldIo.flatMap(e => {
      const od = oldDev[e.devId], nd = od && byName[od.name];
      if (!nd || nd.cls !== od.cls) return [];
      const ne = { ...e, devId: nd.id, key: nd.id + ":" + e.sig };
      if (od.desc && nd.desc && nd.desc !== od.desc && typeof ne.cmt === "string" && ne.cmt.startsWith(od.desc)) ne.cmt = nd.desc + ne.cmt.slice(od.desc.length);
      return [ne];
    });
    syncIO(p);
    p.program.estop = (byName[pr.estop] || {}).id || "";
    p.program.interlocks = (pr.interlocks || []).map(n => byName[n]).filter(d => d && d.cls === "DI").map(d => d.id);
    p.program.seq = pr.seq
      .map(s => {
        const d = byName[s.dev];
        const act = ["start", "stop", "open", "close", "wait", "waitOn", "waitOff", "home", "posRecord", "setPressure", "setFlow", "moveAbs", "moveRel", "velocity", "halt", "waitInPos"].includes(s.act) ? s.act : "wait";
        const wait = act === "waitOn" || act === "waitOff";
        // čekání jen na zařízení třídy DI — jinak se krok zahodí (dev 0)
        const dev = act !== "wait" && d && (!wait || d.cls === "DI") ? d.id : 0;
        const st = { dev, act, cond: wait ? "fbk" : s.cond, timeS: s.timeS };
        /* parametry kroků pohonů fáze 2a (otáčky / žádaná, záznam, směr) */
        if (Number.isFinite(s.sp)) st.sp = s.sp;
        if (Number.isInteger(s.rec)) st.rec = s.rec;
        if (s.rev === true) st.rev = true;
        /* kroky servoosy: cíl, rychlost, zrychlení, zpomalení */
        if (typeof s.posRef === "string") st.posRef = s.posRef;
        for (const f of ["pos", "vel", "acc", "dec"]) if (Number.isFinite(s[f])) st[f] = s[f];
        return st;
      })
      .filter(s => s.act === "wait" || s.dev);
    if (Number.isFinite(pr.takt) && pr.takt > 0) p.meta.takt = pr.takt;
    S.step = 3; save(); render();
  }
  /* nabídka modelů: známé + načtené pro klíč; popisek vybraného (vlastní ID je dovoleno) */
  function modelIds(cfg) {
    return [...Object.keys(AI_MODELS), ...(cfg.models || []).filter(m => !(m in AI_MODELS))];
  }
  function modelInfo(cfg) {
    const m = (cfg.model || AI_DEFAULT_MODEL).trim();
    let t = AI_MODELS[m] ? tr(AI_MODELS[m]) : tr("vlastní ID modelu");
    if (cfg.models && cfg.models.length && !cfg.models.includes(m)) t += " · " + tr("pro tento klíč není v seznamu dostupných");
    return t;
  }
  function rAI(el) {
    const cfg = aiSettings();
    const c = card(el, "02", tr("AI návrh systému"), `
    <p class="hint" style="margin-top:0;max-width:75ch">${tr("Popiš stroj vlastními slovy — co dělá, jaké má pohony, válce, co se měří a hlídá. AI navrhne sestavu zařízení, případně se nejdřív doptá na detaily. Návrh převezmeš a doladíš v dalších krocích; AI zná i tvou aktuální sestavu, takže můžeš kdykoli psát jen úpravy.")}</p>
    <details class="help"${cfg.key ? "" : " open"}><summary>${tr("Nastavení AI (Anthropic API klíč)")}</summary><div class="body">
      <div class="grid g2" style="margin-top:8px">
        <label class="f">${tr("API klíč (uloží se jen v tomto prohlížeči)")}
          <input type="password" id="aiKey" value="${esc(cfg.key || "")}" placeholder="sk-ant-…">
        </label>
        <label class="f">${tr("Model")}
          <input type="text" id="aiModel" list="aiModelList" value="${esc(cfg.model || AI_DEFAULT_MODEL)}" spellcheck="false">
          <datalist id="aiModelList">${modelIds(cfg).map(m => `<option value="${esc(m)}">${AI_MODELS[m] ? esc(tr(AI_MODELS[m])) : ""}</option>`).join("")}</datalist>
        </label>
      </div>
      <div class="row" style="margin-top:6px">
        <button class="small" id="aiFetchModels">${tr("Načíst dostupné modely")}</button>
        <span class="hint" style="margin:0" id="aiModelInfo">${esc(modelInfo(cfg))}</span>
      </div>
      <p class="hint">${tr("Klíč získáš na console.anthropic.com. Dotazy jdou přímo z prohlížeče na Anthropic API; v produkční verzi půjdou přes server PLCdesk.")}</p>
    </div></details>
    <div class="chat" id="aiChat">${S.ai.turns.map(aiTurnView).join("")}</div>
    <textarea id="aiInput" style="margin-top:12px;min-height:90px" placeholder="${esc(tr("Popiš stroj… (nebo klikni na Vložit příklad)"))}">${esc(S.ai.draft || "")}</textarea>
    <div class="row">
      <button class="primary" id="aiSend" ${aiBusy ? "disabled" : ""}>${S.ai.turns.length ? tr("Odeslat upřesnění") : tr("Navrhnout zařízení")}</button>
      <button class="small" id="aiExample" ${S.ai.turns.length ? "hidden" : ""}>${tr("Vložit příklad")}</button>
      <button class="small" id="aiStop" ${aiBusy ? "" : "hidden"}>${tr("Stop")}</button>
      <button class="small danger" id="aiClear" ${S.ai.turns.length ? "" : "hidden"}>${tr("Nová konverzace")}</button>
      <span class="hint" style="margin:0" id="aiStatus">${esc(aiStatusMsg)}</span>
    </div>
    <div class="stream" id="aiStream" hidden></div>
    <div id="aiProposal"></div>`);
    const status = c.querySelector("#aiStatus"), ta = c.querySelector("#aiInput");
    aiStatusMsg = "";   // hláška posledního odeslání se ukáže jednou (přežije překreslení po odpovědi)
    c.querySelector("#aiKey").addEventListener("change", e => saveAiSettings({ ...aiSettings(), key: e.target.value.trim() }));
    const info = c.querySelector("#aiModelInfo");
    c.querySelector("#aiModel").addEventListener("change", e => {
      saveAiSettings({ ...aiSettings(), model: e.target.value.trim() || AI_DEFAULT_MODEL });
      e.target.value = aiSettings().model;
      info.textContent = modelInfo(aiSettings());
    });
    c.querySelector("#aiFetchModels").addEventListener("click", async e => {
      const btn = e.target;
      btn.disabled = true; info.textContent = tr("Načítám dostupné modely…");
      try {
        const models = await aiListModels(aiSettings().key);
        saveAiSettings({ ...aiSettings(), models });
        c.querySelector("#aiModelList").innerHTML = modelIds(aiSettings()).map(m => `<option value="${esc(m)}">${AI_MODELS[m] ? esc(tr(AI_MODELS[m])) : ""}</option>`).join("");
        info.textContent = modelInfo(aiSettings()) + " · " + tr("dostupných modelů: {n}", { n: models.length });
      } catch (err) {
        info.textContent = err.code === "no_key" ? err.message : tr("Seznam modelů nejde načíst: {err}", { err: err.detail || err.message });
      } finally { btn.disabled = false; }
    });
    ta.addEventListener("input", () => { S.ai.draft = ta.value; save(); });
    const pr = S.ai.last;
    if (pr && pr.devices.length) {
      const rows = pr.devices.map(d => "<tr><td class='mono'><b>" + esc(d.name) + "</b></td><td>" + tr(CLS[d.cls].label) + "</td><td style='font-size:.8rem'>" + esc(d.desc) + "</td><td style='font-size:.76rem;color:var(--muted)'>" + esc([Object.entries(d.opt).filter(([, v]) => v).map(([k]) => CLS[d.cls].opts[k] ? tr(CLS[d.cls].opts[k]) : k).join(", ") + (d.cls.startsWith("Analog") ? (" " + d.unit + " " + d.rmin + "–" + d.rmax) : ""), devExtraTxt(d)].filter(x => x.trim()).join(" · ")) + "</td></tr>").join("");
      const seqTxt = s => s.act === "wait" ? tr("výdrž {t} s", { t: s.timeS })
        : s.act === "waitOn" ? tr("čekat na {dev}", { dev: s.dev })
          : s.act === "waitOff" ? tr("čekat na {dev} = FALSE", { dev: s.dev }) : (s.dev + " " + (actTxt()[s.act] || s.act));
      c.querySelector("#aiProposal").innerHTML =
        "<h3>" + tr("Navržená sestava") + "</h3><div class='tablewrap'><table><thead><tr><th>" + tr("Označení") + "</th><th>" + tr("Třída") + "</th><th>" + tr("Popis") + "</th><th>" + tr("Volby") + "</th></tr></thead><tbody>" + rows + "</tbody></table></div>" +
        (pr.seq.length ? "<p class='hint'>" + tr("Sekvence: {seq}", { seq: esc(pr.seq.map((s, i) => (i + 1) + ". " + seqTxt(s)).join(" → ")) }) + "</p>" : "") +
        (Number.isFinite(pr.takt) ? "<p class='hint'>" + tr("Takt: {t} s", { t: pr.takt }) + "</p>" : "") +
        "<div class='row'><button class='primary' id='aiApplyBtn'>" + tr("Převzít návrh (nahradí zařízení)") + "</button><span class='hint' style='margin:0'>" + tr("Nesedí? Napiš upřesnění a odešli znovu.") + "</span></div>";
      c.querySelector("#aiApplyBtn").addEventListener("click", aiApply);
    }
    c.querySelector("#aiExample").addEventListener("click", () => { const ex = tr(AI_EXAMPLE); ta.value = ex; S.ai.draft = ex; save(); ta.focus(); status.textContent = ""; });
    c.querySelector("#aiClear").addEventListener("click", () => { S.ai = { turns: [], last: null, draft: "" }; save(); render(); });
    c.querySelector("#aiStop").addEventListener("click", () => { if (aiCtl) aiCtl.abort(); });
    c.querySelector("#aiSend").addEventListener("click", async () => {
      const msg = ta.value.trim();
      if (aiBusy) return;
      if (!msg) { status.textContent = tr("Nejdřív popiš stroj (nebo klikni na Vložit příklad)."); ta.focus(); return; }
      if (!aiSettings().key) { status.textContent = tr("Doplň API klíč v Nastavení AI výše."); return; }
      aiBusy = true;
      c.querySelector("#aiSend").disabled = true; c.querySelector("#aiStop").hidden = false;
      const sBox = c.querySelector("#aiStream"); sBox.hidden = false; sBox.textContent = tr("Přemýšlím…");
      status.textContent = "";
      S.ai.turns.push({ role: "user", content: msg }); S.ai.draft = ""; save();
      aiCtl = new AbortController();
      try {
        const text = await aiCall(S.ai.turns, prj(), { signal: aiCtl.signal });
        sBox.textContent = text;
        const res = extractJson(text);
        S.ai.turns.push({ role: "assistant", content: JSON.stringify(res) });
        const pr2 = aiNorm(res);
        if (pr2.devices.length) S.ai.last = pr2;
        save();
      } catch (e) {
        S.ai.turns.pop(); S.ai.draft = msg; save();
        const msgs = {
          no_key: tr("Doplň API klíč v Nastavení AI."), bad_key: tr("API klíč byl odmítnut (401)."),
          rate_limited: tr("Příliš mnoho dotazů — zkus to za chvíli."),
          invalid_json: tr("Odpověď se nepodařilo přečíst — zkus to znovu."),
          AbortError: "",
        };
        aiStatusMsg = (e && (msgs[e.code] ?? msgs[e.name])) ?? (e.detail ? tr("Nepodařilo se získat odpověď: {detail}", { detail: e.detail }) : tr("Nepodařilo se získat odpověď — zkus to znovu."));
      } finally {
        aiBusy = false; aiCtl = null; render();
      }
    });
  }

  /* ---------------------------------------------------------- 3 Platformy */
  /** Volba stylu kódu — jen když je vybraná platforma, která OOP umí (PLAT[k].oop). */
  function oopStyleHtml(p) {
    const oopPlats = p.platforms.filter(k => PLAT[k] && PLAT[k].oop);
    if (!oopPlats.length) return "";
    const isOop = p.codeStyle === "oop";
    const opt = (v, label, on) => `<label><input type="radio" name="codeStyle" value="${v}" ${on ? "checked" : ""}> ${label}</label>`;
    return `<fieldset class="codestyle">
      <legend>${tr("Styl kódu")}</legend>
      <div class="opts">${opt("classic", tr("Klasický (doporučeno)"), !isOop)}${opt("oop", tr("OOP"), isOop)}</div>
      <p class="hint">${tr("OOP: rozhraní I_Device, abstraktní základ FB_DeviceBase, třídy zařízení s metodami a vlastnostmi, sekvence ve FB_Sequence. Chování je stejné jako u klasického stylu (ověřuje emulátor), mění se jen zápis. Platí pro: {list}; ostatní platformy dostanou klasický kód.", { list: oopPlats.map(k => PLAT[k].name).join(", ") })}</p>
    </fieldset>`;
  }
  /** Balík k ověření pro beta testery (verify_pack.ts): tlačítko + výzva s odkazem na Kontakt webu. */
  function verifyPackHtml(k, pf) {
    return `<span class="vpack"><button class="small" type="button" data-vpack="${k}">${esc(tr("Balík k ověření"))}</button>
      <span class="hint">${esc(tr("Máte {ide}? Ověřte import a pošlete nám protokol — licenci Pro dostanete zdarma.", { ide: pf.ide }))}
      <a href="${esc(licenseSiteUrl("kontakt"))}" target="_blank" rel="noopener">${esc(tr("Kontakt"))}</a></span></span>`;
  }
  /** Stáhne ZIP balíku k ověření. Není to export projektu uživatele (pevné vzory) → licenční brána
   *  ho neblokuje (ani ve Free, ani nad limitem I/O). */
  async function downloadVerifyPack(k, btn) {
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = tr("Připravuji balík…");
    try {
      const a = await verifyPackArchive(k);
      saveBytesUngated(a.name, a.bytes, "application/zip");
    } catch (e) {
      alert(tr("Balík se nepodařilo připravit: {err}", { err: (e && e.message) || String(e) }));
    } finally { btn.disabled = false; btn.textContent = old; }
  }
  function rPlat(el) {
    const p = prj();
    const c = card(el, "03", tr("Cílové platformy"), `
    <p class="hint" style="margin-top:0">${tr("Vyber jednu nebo víc platforem — program se vygeneruje pro každou zvlášť. Logika je stejná (IEC 61131-3 ST), liší se dialekt, soubor s tagy a postup importu.")}</p>
    ${[Object.entries(PLAT).filter(([, pf]) => !pf.base), Object.entries(PLAT).filter(([, pf]) => pf.base)].map((grp, gi) => (gi ? "<p class='hint' style='margin-top:14px'>" + esc(tr("Další řídicí systémy na bázi CODESYS — stejný kód jako CODESYS, postup importu, I/O a kusovník podle výrobce:")) + "</p>" : "") + `
    <div class="platgrid">${grp.map(([k, pf]) => { const v = verificationInfo(k); return `
      <div class="plat ${p.platforms.includes(k) ? "on" : ""}" data-k="${k}" role="button" tabindex="0" aria-pressed="${p.platforms.includes(k)}">
        <span class="plat-head"><b>${pf.name}</b><span class="verif verif-${v.state}" title="${esc(v.tip)}">${esc(v.label)}</span></span><span>${pf.ide} · ${pf.cpu}</span><span class="lng">${tr(pf.lang)} · ${tr(pf.imp)}</span>
        ${hasAxis(p) && !axisSupport(p, k).ok ? "<span class='lng' style='color:var(--warn)' title='" + esc(axisSupport(p, k).why) + "'>" + tr("servoosu nepodporuje") + "</span>" : ""}
        ${v.state === "beta" ? verifyPackHtml(k, pf) : ""}
      </div>`; }).join("")}
    </div>`).join("")}
    <p class="hint" style="margin-top:10px">${tr("Štítek u platformy říká, jak je výstup ověřený: ověřeno v IDE (import a překlad ve skutečném vývojovém prostředí), jazyk ověřen (překladačem, ne v IDE výrobce), beta (jen emulátor PLCdesk). Co ověřené není, ukáže bublina nad štítkem.")}</p>
    ${oopStyleHtml(p)}`);
    /* styl kódu (jen u platforem s OOP — rodina CODESYS) */
    c.querySelectorAll("input[name=codeStyle]").forEach(r => r.addEventListener("change", () => {
      if (r.value === "oop") p.codeStyle = "oop"; else delete p.codeStyle;
      save(); render();
    }));
    /* balík k ověření: klik na tlačítko / odkaz nesmí přepnout výběr platformy */
    c.querySelectorAll("[data-vpack]").forEach(b => b.addEventListener("click", () => downloadVerifyPack(b.dataset.vpack, b)));
    c.querySelectorAll(".vpack").forEach(x => ["click", "keydown"].forEach(t => x.addEventListener(t, e => e.stopPropagation())));
    c.querySelectorAll(".plat").forEach(d => {
      const toggle = () => {
        const k = d.dataset.k;
        p.platforms = p.platforms.includes(k) ? p.platforms.filter(x => x !== k) : [...p.platforms, k];
        save(); render();
      };
      d.addEventListener("click", toggle);
      d.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    });
  }

  /* ---------------------------------------------------------- 4 Zařízení */
  function rDev(el) {
    const p = prj();
    const c = card(el, "04", tr("Návrh zařízení stroje"), `
    <div class="grid g3">
      <label class="f">${tr("Třída")}
        <select id="dCls">${Object.entries(CLS).map(([k, v]) => '<option value="' + k + '">' + tr(v.label) + "</option>").join("")}</select>
      </label>
      <label class="f">${tr("Označení")}
        <input type="text" id="dName" value="${esc(nextName(p, "Motor"))}">
      </label>
      <label class="f">${tr("Popis")}
        <input type="text" id="dDesc" placeholder="${esc(tr("např. Čerpadlo hydrauliky"))}">
      </label>
    </div>
    <div class="row" id="dOpts"></div>
    <div class="row"><button class="primary" id="bAdd">${tr("Přidat zařízení")}</button><span class="errtxt" id="dErr" style="margin:0"></span></div>
    <div id="dList"></div>
    <p class="note">${tr("Třídy Motor / Ventil / Analog dostanou hotový funkční blok (stavový automat, timeouty, status). Třídy DI/DO jsou volné signály pro vlastní logiku.")}
      ${tr("Měnič, polohovací pohon a proporcionální ventil se ovládají přes běžné I/O (DO, DI, analog) — fungují na všech platformách; parametry pohonu (rampy, záznamy) se nastavují v pohonu, README je vypíše.")}</p>`);
    const clsSel = c.querySelector("#dCls"), nameIn = c.querySelector("#dName"), optRow = c.querySelector("#dOpts");
    const renderOpts = () => {
      const k = clsSel.value; const o = CLS[k].opts;
      const df = devDefaults(k), dOpt = df.opt || {};
      const on = ok => dOpt[ok] !== undefined ? !!dOpt[ok] : ok === "fbk" || ok === "fbkOpen";
      const fld = (label, inner) => "<label class='f' style='flex-direction:row;gap:6px;align-items:center'>" + label + " " + inner + "</label>";
      const numF = (id, v, w = 70) => "<input type='number' step='any' id='" + id + "' value='" + (v ?? "") + "' style='width:" + w + "px'>";
      let html = Object.entries(o).map(([ok, ol]) => "<label style='display:flex;gap:5px;align-items:center;font-size:.8rem'><input type='checkbox' id='opt_" + ok + "' " + (on(ok) ? "checked" : "") + "> " + tr(ol) + "</label>").join("");
      if (hasRange(k)) html += fld(tr("jednotka"), "<input type='text' id='dUnit' style='width:70px' value='" + esc(df.unit || "") + "' placeholder='bar'>") +
        fld(tr("rozsah {min} až {max}", { min: numF("dMin", df.rmin ?? 0, 80), max: numF("dMax", df.rmax ?? 100, 80) }), "");
      /* pohony fáze 2a: žádaná, rampa, tolerance, záznamy */
      if (k === "Vfd" || k === "PropValve") html += fld(tr("žádaná hodnota"), numF("dSetp", df.setpoint)) + fld(tr("rampa [s]"), numF("dRamp", df.rampS ?? 0));
      if (k === "PropValve") html += fld(tr("tolerance ±"), numF("dTol", df.tol)) + fld(tr("doba odchylky [s]"), numF("dTolT", df.tolTimeS));
      if (k === "PosDrive") html += fld(tr("bity výběru záznamu"), "<input type='number' min='1' max='6' step='1' id='dBits' value='" + (df.selBits ?? 3) + "' style='width:56px'>") +
        fld(tr("doba jízdy (model) [s]"), numF("dTravel", df.travelS ?? 1)) +
        fld(tr("záznamy"), "<input type='text' id='dRecs' style='width:280px' value='" + esc(recordsText(df.records)) + "' title='" + esc(tr("číslo = název @ poloha; oddělit středníkem")) + "'>");
      /* servoosa (fáze 2b): konfigurační list osy — dynamika, limity, reference, polohy */
      if (k === "Axis") {
        const a = df.axis || {};
        html += fld(tr("jednotka"), "<input type='text' id='dUnit' style='width:60px' value='" + esc(df.unit || "mm") + "'>") +
          AXIS_FIELDS.map(f => fld(esc(tr(f.label)), numF("dAx_" + f.key, a[f.key], 70))).join("") +
          fld(tr("pojmenované polohy"), "<input type='text' id='dAxPos' style='width:260px' value='" + esc(axisPositionsText(a.positions)) + "' title='" + esc(tr("název @ poloha; oddělit středníkem")) + "'>") +
          fld(tr("pohon"), "<input type='text' id='dAxDrive' style='width:220px' placeholder='" + esc(tr("např. servoměnič, PROFINET")) + "'>");
      }
      if (k === "AnalogIn") html += "<label class='f' style='flex-direction:row;gap:6px;align-items:center'>" + tr("mez min") + " <input type='number' id='dLimLo' step='any' style='width:80px'></label>" +
        "<label class='f' style='flex-direction:row;gap:6px;align-items:center'>" + tr("mez max") + " <input type='number' id='dLimHi' step='any' style='width:80px'></label>";
      if (k === "AnalogOut") html += "<label class='f' style='flex-direction:row;gap:6px;align-items:center'>" + tr("žádaná hodnota") + " <input type='number' id='dSetp' step='any' style='width:80px'></label>";
      if (k === "DO") html += "<label class='f' style='flex-direction:row;gap:6px;align-items:center'>" + tr("vazba na stav stroje") + " <select id='dRole'>" + roleOptions("") + "</select></label>";
      optRow.innerHTML = html || "<span class='hint' style='margin:0'>— " + tr("bez voleb") + "</span>";
    };
    clsSel.addEventListener("change", () => { nameIn.value = nextName(p, clsSel.value); renderOpts(); });
    renderOpts();
    c.querySelector("#bAdd").addEventListener("click", () => {
      const k = clsSel.value;
      const opt = {};
      for (const ok of Object.keys(CLS[k].opts)) { const cb = c.querySelector("#opt_" + ok); if (cb) opt[ok] = cb.checked; }
      const name = nameIn.value.trim() || nextName(p, k);
      /* stejná pravidla jako přejmenování a kontrola návrhu (identifikátor, délka, jedinečnost bez ohledu na velikost) */
      const nameErr = deviceNameProblem(p, name);
      if (nameErr) { c.querySelector("#dErr").textContent = nameErr; nameIn.focus(); return; }
      const rmin = numIn((c.querySelector("#dMin") || {}).value), rmax = numIn((c.querySelector("#dMax") || {}).value);
      const nd = {
        id: p.nextId++, name, cls: k,
        desc: c.querySelector("#dDesc").value.trim(), opt,
        unit: (c.querySelector("#dUnit") || {}).value || "",
        rmin: rmin ?? 0,
        rmax: rmax ?? 100,
      };
      // nepovinná pole podle třídy: prázdné = nezadáno (klíč se vůbec nezaloží)
      const val = id => numIn((c.querySelector(id) || {}).value);
      const extra = { limLo: val("#dLimLo"), limHi: val("#dLimHi"), setpoint: val("#dSetp"),
        rampS: val("#dRamp"), tol: val("#dTol"), tolTimeS: val("#dTolT"), selBits: val("#dBits"), travelS: val("#dTravel") };
      for (const [f, v] of Object.entries(extra)) if (v !== undefined) nd[f] = f === "selBits" ? Math.round(v) : v;
      if (k === "PosDrive") nd.records = parseRecords((c.querySelector("#dRecs") || {}).value || "");
      if (k === "Axis") {
        const ax = { ...(devDefaults("Axis").axis || {}) };
        for (const f of AXIS_FIELDS) { const v = val("#dAx_" + f.key); if (v === undefined) delete ax[f.key]; else ax[f.key] = v; }
        ax.positions = parseAxisPositions((c.querySelector("#dAxPos") || {}).value || "");
        const drv = ((c.querySelector("#dAxDrive") || {}).value || "").trim();
        if (drv) ax.drive = drv;
        nd.axis = ax; nd.rmin = 0; nd.rmax = 0;
        if (!nd.unit) nd.unit = "mm";
      }
      const role = (c.querySelector("#dRole") || {}).value;
      if (role && DO_ROLES[role]) nd.role = role;
      p.devices.push(nd);
      syncIO(p); save(); render();
    });
    const list = c.querySelector("#dList");
    if (p.devices.length) {
      /* hláška poslední úpravy (přejmenování, volby…) přežije překreslení kroku jednou */
      let html = devMsg ? "<p class='" + (devMsg.err ? "errtxt" : "oktxt") + "' id='dMsg' role='status'>" + esc(devMsg.text) + "</p>" : "";
      devMsg = null;
      html += "<div class='tablewrap'><table><thead><tr><th>" + tr("Označení") + "</th><th>" + tr("Třída") + "</th><th>" + tr("Popis") + "</th><th>" + tr("Volby") + "</th><th></th></tr></thead><tbody>";
      for (const d of p.devices) {
        /* volby (signály zařízení) a jednotka / rozsah se upravují přímo v řádku */
        const on = deviceOpts(d);
        const opts = Object.entries(CLS[d.cls].opts).map(([k, lbl]) => "<label class='chk' style='font-size:.76rem;margin-right:8px'><input type='checkbox' data-id='" + d.id + "' data-opt='" + k + "' " + (on[k] ? "checked" : "") + "> " + esc(tr(lbl)) + "</label>").join("") +
          (hasRange(d.cls) ? "<label style='display:inline-flex;gap:4px;align-items:center;margin-right:8px'>" + tr("jednotka") + " <input type='text' data-id='" + d.id + "' data-rng='unit' value='" + esc(d.unit || "") + "' style='width:6ch'></label>" +
            "<label style='display:inline-flex;gap:4px;align-items:center'>" + tr("rozsah {min} až {max}", {
              min: "<input type='number' step='any' data-id='" + d.id + "' data-rng='rmin' value='" + d.rmin + "' style='width:72px'>",
              max: "<input type='number' step='any' data-id='" + d.id + "' data-rng='rmax' value='" + d.rmax + "' style='width:72px'>" }) + "</label>" : "");
        // meze / žádaná hodnota / role se upravují přímo v tabulce (prázdné pole = nezadáno)
        const num = (f, label) => "<label style='display:inline-flex;gap:4px;align-items:center;margin-right:8px'>" + label +
          " <input type='number' step='any' data-id='" + d.id + "' data-f='" + f + "' value='" + (Number.isFinite(d[f]) ? d[f] : "") + "' style='width:72px'></label>";
        const extra = d.cls === "AnalogIn" ? num("limLo", tr("mez min")) + num("limHi", tr("mez max"))
          : d.cls === "AnalogOut" ? num("setpoint", tr("žádaná hodnota"))
          : d.cls === "Vfd" ? num("setpoint", tr("žádaná hodnota")) + num("rampS", tr("rampa [s]"))
          : d.cls === "PropValve" ? num("setpoint", tr("žádaná hodnota")) + num("rampS", tr("rampa [s]")) + num("tol", tr("tolerance ±")) + num("tolTimeS", tr("doba odchylky [s]"))
          : d.cls === "PosDrive" ? num("selBits", tr("bity výběru záznamu")) + num("travelS", tr("doba jízdy (model) [s]")) +
            "<label style='display:inline-flex;gap:4px;align-items:center'>" + tr("záznamy") + " <input type='text' data-id='" + d.id + "' data-f='records' value='" + esc(recordsText(d.records)) + "' style='width:260px' title='" + esc(tr("číslo = název @ poloha; oddělit středníkem")) + "'></label>"
            : d.cls === "Axis" ? AXIS_FIELDS.map(f => {
                /* šířka podle obsahu (hodnota / výchozí v placeholderu) — pevná šířka ořezávala 4000, -0.05… */
                const v = Number.isFinite((d.axis || {})[f.key]) ? String(d.axis[f.key]) : "", ph = String(axisCfgOf(d)[f.key] ?? "");
                return "<label style='display:inline-flex;gap:4px;align-items:center;margin-right:8px'>" + esc(tr(f.label)) +
                " <input type='number' step='any' data-id='" + d.id + "' data-ax='" + f.key + "' value='" + v + "' placeholder='" + esc(ph) + "' style='width:" + axWidth(v || ph) + "'></label>";
              }).join("") +
              "<label style='display:inline-flex;gap:4px;align-items:center'>" + tr("pojmenované polohy") + " <input type='text' data-id='" + d.id + "' data-f='axpos' value='" + esc(axisPositionsText((d.axis || {}).positions)) + "' style='width:240px' title='" + esc(tr("název @ poloha; oddělit středníkem")) + "'></label>"
            : d.cls === "DO" ? "<label style='display:inline-flex;gap:4px;align-items:center'>" + tr("vazba na stav stroje") + " <select data-id='" + d.id + "' data-f='role'>" + roleOptions(d.role || "") + "</select></label>" : "";
        html += "<tr data-row='" + d.id + "'><td><input type='text' class='mono' data-id='" + d.id + "' data-f='name' value='" + esc(d.name) + "' aria-label='" + esc(tr("Označení")) + "' style='width:" + Math.max(6, d.name.length + 2) + "ch;font-weight:600'></td><td>" + tr(CLS[d.cls].label) + "</td>" +
          "<td><input type='text' data-id='" + d.id + "' data-f='desc' value='" + esc(d.desc) + "' style='min-width:200px'></td>" +
          "<td style='font-size:.76rem;color:var(--muted)'>" + (opts || (!extra ? "—" : "")) + (extra ? "<div style='margin-top:" + (opts ? "4px" : "0") + "'>" + extra + "</div>" : "") + "</td>" +
          "<td><button class='small danger' data-del='" + d.id + "'>×</button></td></tr>";
      }
      list.innerHTML = html + "</tbody></table></div>";
      /* úpravy přes jádro (edit.ts): výchozí tagy / komentáře signálů jdou se zařízením, ruční zůstanou */
      list.querySelectorAll("input[data-f=name]").forEach(i => i.addEventListener("change", e => {
        const d = devById(p, +e.target.dataset.id);
        if (!d) return;
        const old = d.name, r = renameDevice(p, d.id, e.target.value);
        if (!r.ok) devMsg = { err: true, text: r.error };
        else if (old !== d.name) {
          devMsg = { text: tr("Zařízení {old} přejmenováno na {new}.", { old, new: d.name }) +
            (r.keptTags.length ? " " + tr("Ručně změněné tagy zůstaly beze změny: {tags}.", { tags: r.keptTags.join(", ") }) : "") };
          save();
        }
        render();
      }));
      list.querySelectorAll("input[data-f=desc]").forEach(i => i.addEventListener("change", e => {
        const d = devById(p, +e.target.dataset.id);
        if (d) { setDeviceDesc(p, d.id, e.target.value); save(); refreshIssues(); }
      }));
      list.querySelectorAll("input[data-opt]").forEach(i => i.addEventListener("change", e => {
        const d = devById(p, +e.target.dataset.id);
        if (!d) return;
        const r = setDeviceOpts(p, d.id, { [e.target.dataset.opt]: e.target.checked });
        if (!r.ok) devMsg = { err: true, text: r.error };
        else {
          const parts = [];
          if (r.added.length) parts.push(tr("přidány signály: {tags}", { tags: r.added.join(", ") }));
          if (r.removed.length) parts.push(tr("odebrány signály: {tags}", { tags: r.removed.join(", ") }));
          if (r.affectedSteps.length) parts.push(tr("zkontroluj kroky {steps} — čekaly na odebrané hlášení", { steps: r.affectedSteps.map(n => n + 1).join(", ") }));
          const more = parts.join("; ");
          devMsg = { err: r.affectedSteps.length > 0, text: tr("Volby {dev} uloženy.", { dev: d.name }) + (more ? " " + more[0].toUpperCase() + more.slice(1) + "." : "") };
          save();
        }
        render();
      }));
      list.querySelectorAll("input[data-rng]").forEach(i => i.addEventListener("change", e => {
        const id = +e.target.dataset.id, d = devById(p, id);
        if (!d) return;
        const val = f => (list.querySelector("input[data-id='" + id + "'][data-rng='" + f + "']") || {}).value;
        const rmin = numIn(val("rmin")), rmax = numIn(val("rmax"));
        const r = rmin === undefined || rmax === undefined ? { ok: false, error: tr("Neplatné číslo v poli „{field}“.", { field: tr("rozsah") }) }
          : setDeviceRange(p, id, { unit: val("unit"), rmin, rmax });
        if (!r.ok) { devMsg = { err: true, text: r.error }; render(); return; }
        save(); refreshIssues();
      }));
      const NUM_F = "input[data-f=limLo],input[data-f=limHi],input[data-f=setpoint],input[data-f=rampS],input[data-f=tol],input[data-f=tolTimeS],input[data-f=selBits],input[data-f=travelS]";
      list.querySelectorAll(NUM_F).forEach(i => i.addEventListener("change", e => {
        const d = devById(p, +e.target.dataset.id), v = numIn(e.target.value), f = e.target.dataset.f;
        if (!d) return;
        if (v === undefined) delete d[f]; else d[f] = f === "selBits" ? Math.min(6, Math.max(1, Math.round(v))) : v;
        /* počet bitů výběru záznamu mění signály pohonu */
        if (f === "selBits") { syncIO(p); save(); render(); return; }
        save();
      }));
      list.querySelectorAll("input[data-f=records]").forEach(i => i.addEventListener("change", e => {
        const d = devById(p, +e.target.dataset.id);
        if (!d) return;
        d.records = parseRecords(e.target.value);
        e.target.value = recordsText(d.records);
        save();
      }));
      /* servoosa: číselná pole konfigurace (prázdné = výchozí) a pojmenované polohy */
      list.querySelectorAll("input[data-ax]").forEach(i => i.addEventListener("input", () => { i.style.width = axWidth(i.value || i.placeholder); }));
      list.querySelectorAll("input[data-ax]").forEach(i => i.addEventListener("change", e => {
        const d = devById(p, +e.target.dataset.id), v = numIn(e.target.value), f = e.target.dataset.ax;
        if (!d) return;
        d.axis = { ...(d.axis || {}) };
        if (v === undefined) delete d.axis[f]; else d.axis[f] = v;
        save(); refreshIssues();
      }));
      list.querySelectorAll("input[data-f=axpos]").forEach(i => i.addEventListener("change", e => {
        const d = devById(p, +e.target.dataset.id);
        if (!d) return;
        d.axis = { ...(d.axis || {}), positions: parseAxisPositions(e.target.value) };
        e.target.value = axisPositionsText(d.axis.positions);
        save(); refreshIssues();
      }));
      list.querySelectorAll("select[data-f=role]").forEach(s => s.addEventListener("change", e => {
        const d = devById(p, +e.target.dataset.id);
        if (!d) return;
        if (DO_ROLES[e.target.value]) d.role = e.target.value; else delete d.role;
        save();
      }));
      list.querySelectorAll("button[data-del]").forEach(b => b.addEventListener("click", () => {
        p.devices = p.devices.filter(d => d.id !== +b.dataset.del);
        p.program.seq = p.program.seq.filter(s => s.act === "wait" || devById(p, s.dev));
        if (p.program.estop && !devById(p, p.program.estop)) p.program.estop = "";
        p.program.interlocks = (p.program.interlocks || []).filter(id => devById(p, id));
        syncIO(p); save(); render();
      }));
      // nálezy kontroly, které se týkají zařízení (duplicitní označení, meze, rozsah) — hned u tabulky
      const issuesBox = document.createElement("div");
      list.appendChild(issuesBox);
      const refreshIssues = () => {
        const names = new Set(p.devices.map(d => d.name));
        const devIssues = validateProject(p).filter(i => names.has(i.where));
        issuesBox.innerHTML = devIssues.length ? "<div class='warnbox'><ul style='margin:0;padding-left:18px'>" +
          devIssues.map(i => "<li style='color:var(--" + (i.level === "error" ? "err" : i.level === "info" ? "muted" : "warn") + ")'><code>" + esc(i.where) + "</code> — " + esc(i.msg) + "</li>").join("") + "</ul></div>" : "";
      };
      refreshIssues();
      list.querySelectorAll(NUM_F).forEach(i => i.addEventListener("change", refreshIssues));
      goToRow(list, S.devSel != null ? "tr[data-row='" + S.devSel + "']" : "", "input[data-f=name]");
      S.devSel = null;
    } else list.innerHTML = "<p class='hint'>" + tr("Zatím žádná zařízení — přidej je výše, načti ukázku v kroku Projekt, nech si je navrhnout v kroku AI návrh, nebo použij Import níže.") + "</p>";
    importBlock(el);
  }

  /* Import existujícího projektu — vedlejší volba: otevře průvodce importem stávajícího zařízení
     (soubory, vložený text, přesné zpracování, volitelně AI, revize). */
  function importBlock(el) {
    const c = document.createElement("details");
    c.className = "help";
    c.innerHTML = `<summary>${tr("Vedlejší volba: Import existujícího projektu (reverse engineering)")}</summary><div class="body">
    <p class="hint" style="margin-top:0;max-width:75ch">${tr("Průvodce načte podklady stávajícího stroje — exporty a programy z PLC (SimaticML, L5X, PLCopen XML, GVL/ST, tabulky tagů), I/O listy, PDF schémata, fotky nebo vložený text — a zpětně sestaví zařízení, I/O, E-stop, blokování a sekvenci, u každé položky se zdrojem a jistotou. Hodí se i pro migraci na jinou platformu.")}</p>
    <div class="row"><button class="primary" id="bImportWizard">${tr("Import stávajícího zařízení…")}</button>
      <span class="hint" style="margin:0">${tr("Nic se nepřepíše, dokud převzetí nepotvrdíš.")}</span></div>
    <p class="warnbox">${tr("<b>Co se přenese:</b> tagy, adresy, komentáře, odhad zařízení a tříd. <b>Co ne:</b> logika bloků (jen inventář), HW konfigurace, safety a komunikace — logiku generuje PLCdesk znovu ze šablon.")}</p>
    </div>`;
    el.appendChild(c);
    c.querySelector("#bImportWizard").addEventListener("click", () => ctx.openImport && ctx.openImport());
  }

  /* ---------------------------------------------------------- 5 I/O */
  function rIO(el) {
    const p = prj();
    syncIO(p);
    const dup = {};
    for (const e of p.io) { if (e.addr) dup[e.addr] = (dup[e.addr] || 0) + 1; dup["t:" + e.tag] = (dup["t:" + e.tag] || 0) + 1; }
    let rows = "";
    for (const e of p.io) {
      const d = devById(p, e.devId);
      rows += "<tr data-row='" + esc(e.key) + "'><td class='mono'>" + esc(d ? d.name : "?") + "</td>" +
        "<td class='mono dir" + e.dir + "'>" + e.dir + "</td>" +
        "<td><input type='text' data-k='" + e.key + "' data-f='tag' value='" + esc(e.tag) + "' class='" + (dup["t:" + e.tag] > 1 ? "dup" : "") + "'></td>" +
        "<td><input type='text' data-k='" + e.key + "' data-f='addr' value='" + esc(e.addr) + "' class='" + (e.addr && dup[e.addr] > 1 ? "dup" : "") + "' style='min-width:70px'></td>" +
        "<td style='text-align:center'>" + (e.dir === "DI" ? "<input type='checkbox' data-k='" + e.key + "' data-f='nc' " + (e.nc ? "checked" : "") + " aria-label='NC'>" : "—") + "</td>" +
        "<td><input type='text' data-k='" + e.key + "' data-f='cmt' value='" + esc(e.cmt) + "' style='min-width:160px'></td></tr>";
    }
    const issues = validateProject(p);
    const issuesHtml = issues.length
      ? "<div class='warnbox'><b>" + tr("Kontrola návrhu ({n}):", { n: issues.length }) + "</b><ul style='margin:6px 0;padding-left:18px'>" +
        issues.slice(0, 12).map(i => "<li style='color:var(--" + (i.level === "error" ? "err" : i.level === "info" ? "muted" : "warn") + ")'><code>" + esc(i.where) + "</code> — " + esc(i.msg) + "</li>").join("") +
        (issues.length > 12 ? "<li>" + tr("… a dalších {n}", { n: issues.length - 12 }) + "</li>" : "") + "</ul>" +
        "<button class='small' id='bFixTags'>" + tr("Opravit tagy automaticky (ASCII)") + "</button></div>"
      : "<p class='oktxt'>" + tr("Kontrola návrhu: bez nálezů") + " ✓</p>";
    const c = card(el, "05", tr("I/O mapování"), `
    <div class="stats">
      <span class="stat">${tr("tagů <b>{n}</b>", { n: p.io.length })}</span>
      ${["DI", "DO", "AI", "AO"].map(d => "<span class='stat'>" + d + " <b>" + p.io.filter(e => e.dir === d).length + "</b></span>").join("")}
    </div>
    ${ioMsg ? "<p class='errtxt' id='ioMsg' role='alert'>" + esc(ioMsg) + "</p>" : ""}
    <div class="tablewrap"><table><thead><tr><th>${tr("Zařízení")}</th><th>${tr("Směr")}</th><th>${tr("Tag")}</th><th>${tr("Adresa")}</th><th>NC</th><th>${tr("Komentář")}</th></tr></thead><tbody>${rows || "<tr><td colspan='6' class='hint'>" + tr("žádná zařízení") + "</td></tr>"}</tbody></table></div>
    <div class="row"><button class="small" id="bRenum">${tr("Přečíslovat adresy od nuly")}</button><span class="hint" style="margin:0">${tr("Adresy přiděluje sestava hardwaru (kanál modulu, zápis v Siemens notaci); ruční adresa kanál připne, adresa mimo sestavu zůstane s upozorněním. Pro ostatní platformy se převedou automaticky. NC = rozpínací kontakt (promítne se do schématu). Duplicity červeně.")}</span></div>
    ${issuesHtml}`);
    ioMsg = null;
    c.querySelectorAll("input[data-k]").forEach(i => i.addEventListener("change", e => {
      const en = p.io.find(x => x.key === e.target.dataset.k);
      if (!en) return;
      if (e.target.type === "checkbox") en.nc = e.target.checked;
      else {
        /* jádro (edit.ts): prázdný tag / komentář = výchozí, adresa se kontroluje (Siemens notace nebo
           notace platformy hardwaru, směr, obsazenost) — neplatná se neuloží a pole se vrátí */
        const fn = { tag: setIoTag, addr: setIoAddr, cmt: setIoCmt }[e.target.dataset.f];
        const r = fn(p, en.key, e.target.value);
        if (!r.ok) { ioMsg = r.error; S.ioSel = en.key; }
      }
      save(); render();
    }));
    goToRow(c, S.ioSel ? "tr[data-row='" + CSS.escape(S.ioSel) + "']" : "", "input[data-f=tag]");
    S.ioSel = null;
    c.querySelector("#bRenum").addEventListener("click", () => { for (const e of p.io) e.addr = ""; autoAddr(p, true); save(); render(); });
    const fix = c.querySelector("#bFixTags");
    if (fix) fix.addEventListener("click", () => {
      const used = new Set();
      for (const e of p.io) {
        let t = sanitizeTag(e.tag), tt = t, n = 2;
        while (used.has(tt)) tt = t + "_" + n++;
        used.add(tt); e.tag = tt;
      }
      save(); render();
    });
  }

  /* ---------------------------------------------------------- 6 Schéma */
  function rSchema(el) {
    const p = prj();
    syncIO(p);
    if (!p.io.length) { card(el, "06", tr("Schéma"), "<p class='hint'>" + tr("Nejdřív přidej zařízení (krok 4), nebo si je nech navrhnout v kroku AI návrh.") + "</p>"); return; }
    const mods = modules(p);
    const bd = svgBlock(p, mods);
    const c1 = card(el, "06", tr("Blokové schéma systému"),
      "<div class='tablewrap'><figure style='margin:0'>" + bd + "<figcaption class='hint'>" + tr("Zdroje signálů → moduly PLC → akční členy; moduly ze sestavy hardwaru (vestavěné I/O CPU, karty a vzdálené stanice podle katalogu — stejně jako kusovník).") + "</figcaption></figure></div>" +
      "<div class='row'><button class='small' id='cpBd'>" + tr("Kopírovat SVG") + "</button><button class='small' id='dlBd'>" + tr("Stáhnout SVG") + "</button></div>");
    c1.querySelector("#cpBd").addEventListener("click", () => copyText(bd, c1.querySelector("#cpBd")));
    c1.querySelector("#dlBd").addEventListener("click", () => downloadFile("00_blokove_schema.svg", bd));
    let inner = "";
    mods.forEach((m, i) => {
      const s = sheetSVG(p, m, i + 1, i + 1, mods.length);
      inner += "<h3>" + tr("{mod} — svorkovnice X{n}", { mod: m.dir + m.idx, n: i + 1 }) + "</h3>" +
        "<div class='tablewrap'><figure style='margin:0'>" + s + "</figure></div>" +
        "<div class='row'><button class='small' data-svg='" + i + "'>" + tr("Stáhnout SVG") + "</button><button class='small' data-dxf='" + i + "'>" + tr("Stáhnout DXF") + "</button></div>";
    });
    const c2 = card(el, "·", tr("Elektrické zapojení I/O"), inner +
      "<p class='warnbox'>" + tr("<b>Pozor:</b> NC/NO kontakty dle sloupce NC v kroku I/O; čísla vodičů podle svorkovnice (X1 → -W101…, X2 → -W201…). Jištění, průřezy, relé na výstupech s větší zátěží a stínění analogů doplní projektant elektro — toto je podklad, ne výrobní dokumentace. DXF otevře EPLAN / AutoCAD / LibreCAD.") + "</p>");
    c2.querySelectorAll("[data-svg]").forEach(b => b.addEventListener("click", () => {
      const i = +b.dataset.svg;
      downloadFile(String(i + 1).padStart(2, "0") + "_" + mods[i].dir + mods[i].idx + "_X" + (i + 1) + ".svg", sheetSVG(p, mods[i], i + 1, i + 1, mods.length));
    }));
    c2.querySelectorAll("[data-dxf]").forEach(b => b.addEventListener("click", () => {
      const i = +b.dataset.dxf;
      downloadFile(String(i + 1).padStart(2, "0") + "_" + mods[i].dir + mods[i].idx + "_X" + (i + 1) + ".dxf", sheetDXF(p, mods[i], i + 1, i + 1, mods.length));
    }));
    let rowsHtml = "";
    mods.forEach((m, mi) => m.ch.forEach((e, i) => {
      const d = devById(p, e.devId) || {};
      const nat = hwAddrText(p, e);
      rowsHtml += "<tr data-row='" + esc(e.key) + "'><td class='mono'><a href='#' class='navlink' data-io='" + esc(e.key) + "' title='" + esc(tr("Upravit v kroku I/O")) + "'><b>X" + (mi + 1) + ":" + (i + 1) + "</b></a></td><td class='mono'>" + esc((m.hw ? m.hw.dt + " " : "") + m.dir + m.idx) + "</td><td class='mono'>" + (m.chNo ? m.chNo[i] : i) + "</td>" +
        "<td><input type='text' data-k='" + esc(e.key) + "' data-f='addr' value='" + esc(e.addr) + "' aria-label='" + esc(tr("Adresa")) + "' style='min-width:70px;width:9ch'>" + (nat && nat !== e.addr ? "<div class='mono' style='color:var(--muted);font-size:.72rem'>" + esc(nat) + "</div>" : "") + "</td>" +
        "<td><input type='text' data-k='" + esc(e.key) + "' data-f='tag' value='" + esc(e.tag) + "' aria-label='" + esc(tr("Tag")) + "'></td><td class='mono'>" + wireNo(mi + 1, i) + "</td>" +
        "<td class='mono'>" + esc(d.name || "") + "</td><td><input type='text' data-k='" + esc(e.key) + "' data-f='cmt' value='" + esc(e.cmt || "") + "' aria-label='" + esc(tr("Komentář")) + "' style='min-width:160px'></td></tr>";
    }));
    const c3 = card(el, "·", tr("Svorkovnice"),
      (schMsg && !S.schEd ? "<p class='errtxt' role='alert'>" + esc(schMsg) + "</p>" : "") +
      "<div class='tablewrap'><table><thead><tr><th>" + tr("Svorka") + "</th><th>" + tr("Modul") + "</th><th>" + tr("Kanál") + "</th><th>" + tr("Adresa") + "</th><th>" + tr("Tag") + "</th><th>" + tr("Vodič") + "</th><th>" + tr("Zařízení") + "</th><th>" + tr("Komentář") + "</th></tr></thead><tbody>" + rowsHtml + "</tbody></table></div>" +
      "<div class='row'><button class='small' id='bCsv'>" + tr("Stáhnout svorkovnici (CSV)") + "</button><span class='hint' style='margin:0'>" + tr("Podklad pro projektanta elektro.") + " " + tr("Prázdný tag nebo komentář = výchozí, prázdná adresa = přidělit automaticky; adresu zapiš v Siemens notaci (%I0.0, %QW64) nebo v notaci platformy hardwaru.") + "</span></div>");
    c3.querySelector("#bCsv").addEventListener("click", () => downloadFile("03_svorkovnice.csv", svorkyCSV(p)));
    /* svorkovnice: tag / adresa / komentář přímo v tabulce (jádro edit.ts jako krok I/O) */
    const ioFns = { tag: setIoTag, addr: setIoAddr, cmt: setIoCmt };
    c3.querySelectorAll("input[data-k]").forEach(inp => inp.addEventListener("change", () => {
      const r = ioFns[inp.dataset.f](p, inp.dataset.k, inp.value);
      schMsg = r.ok ? null : r.error;
      S.schTerm = inp.dataset.k;
      save(); render();
    }));
    if (S.schTerm) {
      const row = c3.querySelector("tr[data-row='" + CSS.escape(S.schTerm) + "']");
      if (row) { row.classList.add("hl"); row.scrollIntoView({ block: "nearest" }); }
      S.schTerm = null;
      if (!S.schEd) schMsg = null;
    }

    /* Editor přímo pod schématem: klik na zařízení = popis a jeho signály, klik na signál = popis
       a ten signál (tag, adresa, komentář). Uložení přes jádro (edit.ts), pak schéma znovu. */
    function closeEditor(box) { S.schEd = null; schMsg = null; box.remove(); }
    function showEditor(scroll) {
      el.querySelectorAll(".schEditor").forEach(x => x.remove());
      const ed = S.schEd;
      const d = ed && devById(p, ed.dev);
      if (!d) { S.schEd = null; return; }
      const sigs = p.io.filter(e => e.devId === d.id && (!ed.io || e.key === ed.io));
      const box = document.createElement("div");
      box.className = "schEditor";
      box.style.cssText = "margin:10px 0;padding:10px 12px;border:2px solid var(--accent, #008639);border-radius:6px";
      box.innerHTML =
        "<div class='row' style='margin:0 0 6px;align-items:baseline'><b class='mono'>" + esc(d.name) + "</b><span class='hint' style='margin:0'>" + esc(tr(CLS[d.cls].label)) + "</span>" +
        "<span style='flex:1'></span><a href='#' class='navlink' data-go='dev'>" + tr("Upravit v kroku Zařízení") + " ↗</a>" +
        (ed.io ? "<a href='#' class='navlink' data-go='io' style='margin-left:12px'>" + tr("Upravit v kroku I/O") + " ↗</a>" : "") + "</div>" +
        (schMsg ? "<p class='errtxt' role='alert' style='margin:0 0 6px'>" + esc(schMsg) + "</p>" : "") +
        "<label class='f'>" + tr("Popis") + "<input type='text' data-ed='desc' value='" + esc(d.desc || "") + "'></label>" +
        (sigs.length ? "<div class='tablewrap'><table><thead><tr><th>" + tr("Směr") + "</th><th>" + tr("Tag") + "</th><th>" + tr("Adresa") + "</th><th>" + tr("Komentář") + "</th></tr></thead><tbody>" +
          sigs.map(e => "<tr data-row='" + esc(e.key) + "'><td class='mono dir" + e.dir + "'>" + e.dir + "</td>" +
            "<td><input type='text' data-k='" + esc(e.key) + "' data-f='tag' value='" + esc(e.tag) + "' aria-label='" + esc(tr("Tag")) + "'></td>" +
            "<td><input type='text' data-k='" + esc(e.key) + "' data-f='addr' value='" + esc(e.addr) + "' aria-label='" + esc(tr("Adresa")) + "' style='min-width:70px;width:9ch'></td>" +
            "<td><input type='text' data-k='" + esc(e.key) + "' data-f='cmt' value='" + esc(e.cmt || "") + "' aria-label='" + esc(tr("Komentář")) + "' style='min-width:160px'></td></tr>").join("") +
          "</tbody></table></div>" : "") +
        "<div class='row' style='margin:6px 0 0'><button class='small' data-ed='save'>" + tr("Uložit") + "</button><button class='small' data-ed='close'>" + tr("Zavřít") + "</button>" +
        "<span class='hint' style='margin:0'>" + tr("Prázdný tag nebo komentář = výchozí, prázdná adresa = přidělit automaticky; adresu zapiš v Siemens notaci (%I0.0, %QW64) nebo v notaci platformy hardwaru.") + "</span></div>";
      // pod obrázek, na který se kliklo (blokové schéma nebo list zapojení)
      const figs = c2.querySelectorAll("figure");
      const anchor = (ed.sheet >= 0 && figs[ed.sheet]) || c1.querySelector("figure");
      (anchor.closest(".tablewrap") || anchor).after(box);
      const saveEd = () => {
        const cur = devById(p, d.id);
        if (!cur) return;
        const desc = box.querySelector("[data-ed=desc]").value;
        if (desc.trim() !== (cur.desc || "")) setDeviceDesc(p, cur.id, desc);
        let err = null;
        for (const inp of box.querySelectorAll("input[data-k]")) {
          const e = p.io.find(x => x.key === inp.dataset.k);
          // jen pole, která uživatel změnil (výchozí komentáře mohl právě přepsat nový popis zařízení)
          if (!e || inp.value.trim() === inp.defaultValue.trim()) continue;
          const r = ioFns[inp.dataset.f](p, e.key, inp.value);
          if (!r.ok) { err = r.error; break; }
        }
        schMsg = err;
        save(); render();
      };
      box.querySelector("[data-ed=save]").addEventListener("click", saveEd);
      box.querySelector("[data-ed=close]").addEventListener("click", () => closeEditor(box));
      box.querySelectorAll("input").forEach(i => i.addEventListener("keydown", ev => {
        if (ev.key === "Enter") { ev.preventDefault(); saveEd(); }
        else if (ev.key === "Escape") closeEditor(box);
      }));
      box.querySelectorAll("[data-go]").forEach(a => a.addEventListener("click", ev => {
        ev.preventDefault();
        if (a.dataset.go === "io") { S.ioSel = ed.io; S.step = 4; } else { S.devSel = d.id; S.step = 3; }
        S.schEd = null;
        save(); render();
        window.scrollTo(0, 0);
      }));
      if (scroll) {
        box.scrollIntoView({ block: "nearest" });
        const first = box.querySelector(ed.io ? "input[data-f=tag]" : "[data-ed=desc]");
        if (first) first.focus({ preventScroll: true });
      }
    }
    const pick = ev => {
      const io = ev.target.closest("[data-io]"), dv = ev.target.closest("[data-dev]");
      const fig = ev.target.closest("figure");
      const sheet = fig && c2.contains(fig) ? [...c2.querySelectorAll("figure")].indexOf(fig) : -1;
      const key = io && io.getAttribute("data-io");
      const e = key && p.io.find(x => x.key === key);
      let ed = null;
      if (e) ed = { dev: e.devId, io: e.key, sheet };
      else if (dv && devById(p, +dv.getAttribute("data-dev"))) ed = { dev: +dv.getAttribute("data-dev"), io: null, sheet };
      if (!ed) return;
      S.schEd = ed;
      schMsg = null;
      showEditor(true);
    };
    for (const box of [c1, c2]) {
      box.querySelectorAll("svg [data-io], svg [data-dev]").forEach(n => n.classList.add("navlink"));
      box.querySelectorAll("figure").forEach(f => f.addEventListener("click", pick));
    }
    /* svorka v tabulce = vedlejší odkaz na řádek v kroku I/O */
    c3.querySelectorAll("a[data-io]").forEach(a => a.addEventListener("click", ev => {
      ev.preventDefault();
      S.ioSel = a.dataset.io; S.step = 4;
      save(); render();
      window.scrollTo(0, 0);
    }));
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = tr("Klik na zařízení nebo signál ve schématu otevře pod ním úpravu (popis zařízení, tag, adresa a komentář signálu); svorkovnice se upravuje přímo v tabulce.");
    c1.querySelector("figure").after(hint);
    if (S.schEd) showEditor(true);
  }

  /* ---------------------------------------------------------- 7 Program */
  function rProg(el) {
    const p = prj();
    const diDevs = p.devices.filter(d => d.cls === "DI");
    const actDevs = p.devices.filter(d => d.cls === "Motor" || d.cls === "Ventil" || isMotionClass(d.cls) || d.cls === "Axis");
    const waitDevs = diDevs.filter(d => d.id !== p.program.estop);   // krok může čekat na snímač / tlačítko
    const c = card(el, "07", tr("Logika programu"), `
    <div class="grid g2">
      <label class="f">${tr("Centrální uvolnění (E-stop / bezpečnostní vstup)")}
        <select id="pEstop"><option value="">— ${tr("žádný (doplníš ručně)")} —</option>${diDevs.map(d => "<option value='" + d.id + "' " + (p.program.estop === d.id ? "selected" : "") + ">" + esc(d.name + " – " + d.desc) + "</option>").join("")}</select>
      </label>
      <div class="f" style="justify-content:end"><span class="hint" style="margin:0">${tr("Signál se zapojí do <code>enable</code> všech bloků. Skutečnou bezpečnost řeší safety technika, ne program — viz Nápověda.")}</span></div>
    </div>
    <h3>${tr("Blokovací vstupy (kryty, závory…)")}</h3>
    <p class="hint" style="margin-top:0">${tr("Zaškrtnuté vstupy jsou spolu s E-stopem v <code>enable</code>: FALSE kteréhokoli zastaví stroj (výstupy vypnout, sekvence do klidu, po obnovení nový start). Vstup má mít TRUE = v pořádku (kryt zavřen, závora volná).")}</p>
    <div class="row" id="pLocks">${diDevs.filter(d => d.id !== p.program.estop).map(d => "<label class='chk'><input type='checkbox' data-lock='" + d.id + "' " + ((p.program.interlocks || []).includes(d.id) ? "checked" : "") + "> " + esc(d.name + " – " + d.desc) + "</label>").join("") || "<span class='hint'>" + tr("Projekt nemá další digitální vstupy.") + "</span>"}</div>
    <h3>${tr("Automatická sekvence (volitelné)")}</h3>
    <p class="hint" style="margin-top:0">${tr("Kroky se provedou po řadě v režimu AUTO; generuje se z nich stavový automat (CASE). Přechod = zpětné hlášení, nebo čas. U přechodu na zpětné hlášení je zadaný čas <b>hlídací</b>: když hlášení do té doby nepřijde, program vyhlásí poruchu stroje, zastaví sekvenci a čeká na kvitaci.")} ${tr("Krok může čekat i na digitální vstup (snímač dílu, výsledek kontroly, tlačítko obsluhy): přechod je vždy stav vstupu a zadaný čas je hlídací.")}</p>
    <div id="seqList"></div>
    <div class="row">
      <select id="sDev">${actDevs.concat(waitDevs).map(d => "<option value='" + d.id + "'>" + esc(d.name + " – " + d.desc) + "</option>").join("")}<option value="0">— ${tr("čekání (bez zařízení)")} —</option></select>
      <select id="sAct"></select>
      <select id="sCond"><option value="fbk">${tr("přechod: zpětné hlášení")}</option><option value="time">${tr("přechod: čas")}</option></select>
      <input type="number" id="sTime" value="3" min="1" style="width:70px" aria-label="${esc(tr("čas s"))}"> s
      <span id="sPar"></span>
      <button class="primary small" id="bAddStep">${tr("Přidat krok")}</button>
    </div>
    <div class="row" id="sEditRow" hidden>
      <span class="hint" style="margin:0" id="sEditTxt"></span>
      <button class="primary small" id="bSaveStep">${tr("Uložit změny kroku")}</button>
      <button class="small" id="bInsStep"></button>
      <button class="small" id="bCancelStep">${tr("Zrušit úpravu")}</button>
    </div>
    <p class="errtxt" id="sErr" role="alert" hidden></p>`);
    const sDev = c.querySelector("#sDev"), sAct = c.querySelector("#sAct"), sCond = c.querySelector("#sCond");
    const sPar = c.querySelector("#sPar");
    /* parametr kroku pohonu: otáčky (+ směr) měniče, číslo záznamu pohonu, žádaná ventilu */
    const refreshPar = () => {
      const d = devById(p, +sDev.value), a = sAct.value;
      const numF = (id, label, v, extra = "") => "<label style='display:inline-flex;gap:4px;align-items:center'>" + label + " <input type='number' step='any' id='" + id + "' value='" + (v ?? "") + "' style='width:70px'" + extra + "></label>";
      sPar.innerHTML = !d ? ""
        : d.cls === "Vfd" && a === "start" ? numF("sSp", tr("otáčky") + (d.unit ? " [" + esc(d.unit) + "]" : ""), d.setpoint) + (d.opt && d.opt.rev ? " <label class='chk'><input type='checkbox' id='sRev'> " + tr("vzad") + "</label>" : "")
        : d.cls === "PosDrive" && a === "posRecord" ? "<label style='display:inline-flex;gap:4px;align-items:center'>" + tr("záznam") + " <select id='sRec'>" +
            Array.from({ length: maxRecord(d) }, (_, i) => i + 1).map(n => { const r = (d.records || []).find(x => x.no === n); return "<option value='" + n + "'>" + n + (r && r.name ? " – " + esc(r.name) : "") + "</option>"; }).join("") + "</select></label>"
        : d.cls === "PropValve" ? numF("sSp", tr("žádaná") + (d.unit ? " [" + esc(d.unit) + "]" : ""), d.setpoint)
        : d.cls === "Axis" ? axisPar(d, a, numF)
        : "";
      const ref = c.querySelector("#sPosRef");
      if (ref) { const sync = () => { const pi = c.querySelector("#sPos"); if (pi) pi.disabled = !!ref.value; }; ref.addEventListener("change", sync); sync(); }
    };
    /* kroky servoosy: cíl (pojmenovaná poloha nebo číslo), dráha, rychlost se znaménkem; dynamika nepovinně (prázdné = výchozí z konfigurace osy) */
    const axisPar = (d, a, numF) => {
      const u = d.unit ? " [" + esc(d.unit) + "]" : "", us = d.unit ? " [" + esc(d.unit) + "/s]" : "", us2 = d.unit ? " [" + esc(d.unit) + "/s²]" : "";
      const dyn = numF("sVel", tr("rychlost") + us, "", " placeholder='" + axisCfgOf(d).vDef + "'") + " " + numF("sAcc", tr("zrychlení") + us2, "") + " " + numF("sDec", tr("zpomalení") + us2, "");
      if (a === "moveAbs") return "<label style='display:inline-flex;gap:4px;align-items:center'>" + tr("poloha") + " <select id='sPosRef'><option value=''>" + tr("— zadat číslem —") + "</option>" +
        axisCfgOf(d).positions.map(x => "<option value='" + esc(x.name) + "'>" + esc(x.name + " (" + x.pos + ")") + "</option>").join("") + "</select></label> " + numF("sPos", tr("cíl") + u, "") + " " + dyn;
      if (a === "moveRel") return numF("sPos", tr("dráha") + u, "") + " " + dyn;
      if (a === "velocity") return numF("sVel", tr("rychlost (± = směr)") + us, axisCfgOf(d).vDef) + " " + numF("sAcc", tr("zrychlení") + us2, "") + " " + numF("sDec", tr("zpomalení") + us2, "");
      return "";
    };
    const refreshActs = () => {
      const d = devById(p, +sDev.value), acts = actTxt();
      const opts = !d ? ["wait"] : d.cls === "DI" ? ["waitOn", "waitOff"] : (ACTS_FOR[d.cls] || []);
      const lbl = a => a === "wait" ? tr("čekat") : a === "waitOn" ? tr("čekat na TRUE") : a === "waitOff" ? tr("čekat na FALSE") : (acts[a] || a);
      sAct.innerHTML = opts.map(a => "<option value='" + a + "'>" + lbl(a) + "</option>").join("");
      // čekání na DI: přechod je vždy zpětné hlášení (vstup), čas je hlídací
      if (d && d.cls === "DI") sCond.value = "fbk";
      sCond.disabled = !!(d && d.cls === "DI");
      refreshPar();
    };
    sDev.addEventListener("change", refreshActs); sAct.addEventListener("change", refreshPar); refreshActs();
    c.querySelector("#pEstop").addEventListener("change", e => {
      p.program.estop = +e.target.value || "";
      p.program.interlocks = (p.program.interlocks || []).filter(id => id !== p.program.estop);
      save(); render();
    });
    c.querySelectorAll("[data-lock]").forEach(b => b.addEventListener("change", () => {
      const id = +b.dataset.lock, set = new Set(p.program.interlocks || []);
      if (b.checked) set.add(id); else set.delete(id);
      p.program.interlocks = p.devices.filter(d => set.has(d.id)).map(d => d.id);
      save();
    }));
    /** Krok z formuláře (nový i upravovaný). Kontrolu dělá jádro (edit.ts stepProblem). */
    const readForm = () => {
      const d = devById(p, +sDev.value);
      const st = { dev: d ? d.id : 0, act: d ? sAct.value : "wait", cond: !d ? "time" : d.cls === "DI" ? "fbk" : sCond.value, timeS: numIn(c.querySelector("#sTime").value) ?? NaN };
      const sp = numIn((c.querySelector("#sSp") || {}).value), rec = numIn((c.querySelector("#sRec") || {}).value), rev = c.querySelector("#sRev");
      if (sp !== undefined) st.sp = sp;
      if (rec !== undefined) st.rec = Math.round(rec);
      if (rev && rev.checked) st.rev = true;
      if (d && d.cls === "Axis") {
        const ref = (c.querySelector("#sPosRef") || {}).value;
        if (ref) st.posRef = ref;
        else { const pos = numIn((c.querySelector("#sPos") || {}).value); if (pos !== undefined) st.pos = pos; }
        for (const f of ["Vel", "Acc", "Dec"]) { const v = numIn((c.querySelector("#s" + f) || {}).value); if (v !== undefined) st[f.toLowerCase()] = v; }
      }
      return st;
    };
    /** Výsledek úpravy sekvence z jádra: chyba = hláška u formuláře, jinak uložit a překreslit. */
    const applied = (r, editNext) => {
      const err = c.querySelector("#sErr");
      if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
      S.seqEdit = editNext ? r.index : null;
      save(); render();
    };
    c.querySelector("#bAddStep").addEventListener("click", () => applied(insertStep(p, p.program.seq.length - 1, readForm()), false));
    /* úprava kroku: „Upravit“ u řádku načte krok do formuláře pod seznamem */
    const edIdx = Number.isInteger(S.seqEdit) && S.seqEdit < p.program.seq.length ? S.seqEdit : null;
    if (edIdx === null) S.seqEdit = null;
    else {
      const s = p.program.seq[edIdx], d = s.act === "wait" ? null : devById(p, s.dev);
      sDev.value = d ? String(d.id) : "0";
      refreshActs();
      if ([...sAct.options].some(o => o.value === s.act)) sAct.value = s.act;
      if (!sCond.disabled) sCond.value = s.cond;
      c.querySelector("#sTime").value = s.timeS;
      refreshPar();
      const setV = (id, v) => { const el = c.querySelector(id); if (el && v !== undefined && v !== null) el.value = v; };
      setV("#sSp", s.sp); setV("#sRec", s.rec); setV("#sPos", s.pos); setV("#sVel", s.vel); setV("#sAcc", s.acc); setV("#sDec", s.dec);
      const rev = c.querySelector("#sRev"); if (rev) rev.checked = !!s.rev;
      const ref = c.querySelector("#sPosRef");
      if (ref) { ref.value = s.posRef || ""; ref.dispatchEvent(new Event("change")); }
      c.querySelector("#sEditRow").hidden = false;
      c.querySelector("#sEditTxt").textContent = tr("Upravuješ krok {n} — změň hodnoty a ulož.", { n: edIdx + 1 });
      c.querySelector("#bInsStep").textContent = tr("Vložit za krok {n}", { n: edIdx + 1 });
      c.querySelector("#bSaveStep").addEventListener("click", () => applied(updateStep(p, edIdx, readForm()), true));
      c.querySelector("#bInsStep").addEventListener("click", () => applied(insertStep(p, edIdx, readForm()), true));
      c.querySelector("#bCancelStep").addEventListener("click", () => { S.seqEdit = null; render(); });
    }
    const list = c.querySelector("#seqList");
    if (p.program.seq.length) {
      const acts = actTxt();
      list.innerHTML = p.program.seq.map((s, i) => {
        const d = devById(p, s.dev);
        const head = s.act === "waitOn" || s.act === "waitOff" || (d && (isMotionClass(d.cls) || d.cls === "Axis")) ? stepTitle(p, s) : (d ? d.name : "?") + " " + (acts[s.act] || s.act);
        const txt = s.act === "wait" ? tr("výdrž {t} s", { t: s.timeS }) : head + " → " + (s.cond === "time" ? tr("čas {t} s", { t: s.timeS }) : tr("zpětné hlášení (hlídací čas {t} s)", { t: s.timeS }));
        return "<div class='seqrow" + (i === edIdx ? " editing" : "") + "'><span class='k'>" + tr("Krok {n}", { n: i + 1 }) + "</span><span style='flex:1;font-size:.86rem'>" + esc(txt) + "</span>" +
          "<button class='small' data-ed='" + i + "' title='" + esc(tr("Načíst krok do formuláře pod seznamem a upravit")) + "'>" + tr("Upravit") + "</button>" +
          "<button class='small' data-dup='" + i + "'>" + tr("Duplikovat") + "</button>" +
          "<button class='small' data-up='" + i + "' " + (i === 0 ? "disabled" : "") + ">↑</button><button class='small' data-dn='" + i + "' " + (i === p.program.seq.length - 1 ? "disabled" : "") + ">↓</button><button class='small danger' data-rm='" + i + "'>×</button></div>";
      }).join("");
      /* přesun / odstranění: upravovaný krok se stěhuje s sebou (nebo úprava skončí) */
      const follow = (a, b) => { if (S.seqEdit === a) S.seqEdit = b; else if (S.seqEdit === b) S.seqEdit = a; };
      list.querySelectorAll("[data-ed]").forEach(b => b.addEventListener("click", () => { S.seqEdit = +b.dataset.ed; render(); const f = document.querySelector("#sEditRow"); if (f) f.scrollIntoView({ block: "center" }); }));
      list.querySelectorAll("[data-dup]").forEach(b => b.addEventListener("click", () => applied(duplicateStep(p, +b.dataset.dup), false)));
      list.querySelectorAll("[data-up]").forEach(b => b.addEventListener("click", () => { const i = +b.dataset.up; [p.program.seq[i - 1], p.program.seq[i]] = [p.program.seq[i], p.program.seq[i - 1]]; follow(i, i - 1); save(); render(); }));
      list.querySelectorAll("[data-dn]").forEach(b => b.addEventListener("click", () => { const i = +b.dataset.dn; [p.program.seq[i + 1], p.program.seq[i]] = [p.program.seq[i], p.program.seq[i + 1]]; follow(i, i + 1); save(); render(); }));
      list.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => {
        const i = +b.dataset.rm;
        p.program.seq.splice(i, 1);
        if (S.seqEdit === i) S.seqEdit = null; else if (S.seqEdit > i) S.seqEdit--;
        save(); render();
      }));
    } else list.innerHTML = "<p class='hint'>" + tr("Bez sekvence se vygenerují jen instance zařízení s TODO povely pro ruční režim.") + "</p>";
  }

  /* ---------------------------------------------------------- 8 Generovat */
  let outerTab = 0, innerTab = 0;
  function rGen(el) {
    const p = prj();
    syncIO(p);
    if (!p.devices.length) { card(el, "08", tr("Generování"), "<p class='hint'>" + tr("Nejdřív přidej zařízení (krok 4), nech si je navrhnout v kroku AI návrh, nebo použij volbu Import.") + "</p>"); return; }
    if (!p.platforms.length) { card(el, "08", tr("Generování"), "<p class='hint'>" + tr("Vyber aspoň jednu platformu (krok 3).") + "</p>"); return; }
    const cache = {};
    for (const pl of p.platforms) cache[pl] = licensedGen(p, pl, gateFor(p));   // knihovna bloků jen v tarifu Firma (license.js)
    const plats = p.platforms;
    if (outerTab >= plats.length) outerTab = 0;
    const files = Object.keys(cache[plats[outerTab]]);
    if (innerTab >= files.length) innerTab = 0;
    const c = card(el, "08", tr("Generované zdroje"), `
    <div class="tabs outer" role="tablist">${plats.map((pl, i) => "<button role='tab' aria-selected='" + (i === outerTab) + "' data-o='" + i + "'>" + PLAT[pl].name + "</button>").join("")}</div>
    <div class="tabs" role="tablist" style="margin-top:8px">${files.map((f, i) => "<button role='tab' aria-selected='" + (i === innerTab) + "' data-f='" + i + "'>" + f + "</button>").join("")}</div>
    <div class="codebox"><pre class="code" id="genCode"></pre><button class="copybtn" id="bCopyGen">${tr("Kopírovat")}</button></div>
    <div class="row"><button class="small primary" id="bDlGen">${tr("Stáhnout zobrazený soubor")}</button><button class="small" id="bDlAllGen">${tr("Stáhnout všechny soubory platformy")}</button></div>
    <p class="note">${tr("Postup importu pro danou platformu je v záložce <b>README.txt</b>. Výstup je výchozí kostra — TODO komentáře označují místa k doplnění.")}</p>`);
    const cur = () => { const fs = Object.keys(cache[plats[outerTab]]); return { name: fs[innerTab], body: cache[plats[outerTab]][fs[innerTab]] }; };
    const show = () => { c.querySelector("#genCode").textContent = cur().body; };
    show();
    c.querySelectorAll("[data-o]").forEach(b => b.addEventListener("click", () => { outerTab = +b.dataset.o; innerTab = 0; render(); }));
    c.querySelectorAll("[data-f]").forEach(b => b.addEventListener("click", () => { innerTab = +b.dataset.f; c.querySelectorAll("[data-f]").forEach(x => x.setAttribute("aria-selected", x === b)); show(); }));
    c.querySelector("#bCopyGen").addEventListener("click", () => copyText(cur().body, c.querySelector("#bCopyGen")));
    c.querySelector("#bDlGen").addEventListener("click", () => downloadFile(plats[outerTab] + "_" + cur().name, cur().body));
    c.querySelector("#bDlAllGen").addEventListener("click", () => {
      const pl = plats[outerTab];
      downloadFiles(Object.entries(cache[pl]).map(([n, b]) => [pl + "_" + n, b]), c.querySelector("#bDlAllGen"));
    });
  }

  /* ---------------------------------------------------------- 9 Dokumentace */
  let docSel = 0;
  function rDocs(el) {
    const p = prj();
    syncIO(p);
    if (!p.devices.length) { card(el, "09", tr("Dokumentace"), "<p class='hint'>" + tr("Nejdřív navrhni zařízení (kroky 2–4).") + "</p>"); return; }
    const files = licensedProjectFiles(p, gateFor(p));
    if (docSel >= files.length) docSel = 0;
    const groups = [...new Set(files.map(f => f.group))];
    let listHtml = "";
    for (const g of groups) {
      listHtml += "<h4>" + esc(g) + "</h4>";
      files.forEach((f, i) => { if (f.group === g) listHtml += "<button data-d='" + i + "' aria-selected='" + (i === docSel) + "'>" + esc(f.name) + "</button>"; });
    }
    const c = card(el, "09", tr("Dokumentace projektu"), `
    <p class="hint" style="margin-top:0;max-width:78ch">${tr("Z návrhu se generuje dokumentace běžného automatizačního projektu: FDS, I/O list, svorkovnice, seznam alarmů, FAT protokol, návod k obsluze, SW dokumentace, schémata (SVG + DXF) a zdrojové kódy platforem. Vyber soubor vlevo, prohlédni a ulož, kam potřebuješ.")}</p>
    <div class="docgrid">
      <div class="doclist" role="tablist">${listHtml}</div>
      <div style="min-width:0">
        <div class="row" style="margin:0 0 10px">
          <button class="primary" id="bDocSave">${tr("Stáhnout soubor")}</button>
          <button class="small" id="bDocAll">${tr("Stáhnout vše (po souborech)")}</button>
          <button class="small" id="bDocZip">${tr("Stáhnout projekt (ZIP)")}</button>
          <button class="small" id="bDocCopy">${tr("Kopírovat")}</button>
          <span class="hint" style="margin:0;font-family:var(--font-mono);font-size:.72rem" id="docName"></span>
        </div>
        <div id="docPane"></div>
      </div>
    </div>
    <p class="note">${tr(`Soubory platforem se ukládají s předponou platformy (např. <code>siemens_Gen_Main.scl</code>), ať se v jednom adresáři nepletou. „Stáhnout vše" uloží každý soubor zvlášť — prohlížeč se může zeptat na povolení více stahování.`)} ${tr("Celou projektovou složku — podsložky 01_Dokumentace … 99_Interni a číslo projektu na začátku názvu každého souboru — stáhneš najednou tlačítkem Stáhnout projekt (ZIP).")}</p>`);
    const pane = c.querySelector("#docPane"), nameEl = c.querySelector("#docName");
    const show = () => {
      const f = files[docSel];
      nameEl.textContent = "→ " + f.save;
      if (f.kind === "svg") pane.innerHTML = "<div class='svgprev'>" + f.body + "</div>";
      else if (f.kind === "dxf") pane.innerHTML = "<p class='hint' style='margin:0 0 8px'>" + tr("Náhled výkresu — uloží se jako DXF pro EPLAN / AutoCAD / LibreCAD.") + "</p><div class='svgprev'>" + f.prev + "</div>";
      else { pane.innerHTML = "<div class='codebox'><pre class='code' style='border-radius:8px;max-height:520px'></pre></div>"; pane.querySelector("pre").textContent = f.body; }
      c.querySelectorAll("[data-d]").forEach(b => b.setAttribute("aria-selected", String(+b.dataset.d === docSel)));
    };
    show();
    c.querySelectorAll("[data-d]").forEach(b => b.addEventListener("click", () => { docSel = +b.dataset.d; show(); }));
    c.querySelector("#bDocCopy").addEventListener("click", () => copyText(files[docSel].body, c.querySelector("#bDocCopy")));
    c.querySelector("#bDocSave").addEventListener("click", () => downloadFile(files[docSel].save, files[docSel].body));
    c.querySelector("#bDocAll").addEventListener("click", () => downloadFiles(files.map(f => [f.save, f.body]), c.querySelector("#bDocAll")));
    c.querySelector("#bDocZip").addEventListener("click", e => downloadProjectZip(S.prj, JSON.stringify({ prj: S.prj, ai: S.ai }, null, 1), e.currentTarget));
  }

  /* ---------------------------------------------------------- 10 Kusovník
     Volby uživatele žijí v prj.bom (plat, brand[catKey], lines[id]) — kusovník se z nich
     při každém překreslení sestaví znovu jádrem (buildBom), takže web nic nepočítá sám. */
  const BOM_CUSTOM = "__custom__";           // hodnota volby „vlastní…" ve výběrech (NUL by parser HTML změnil na U+FFFD)
  const bomCustomEdit = new Set();            // řádky / pole, kde uživatel právě zadává vlastní text
  let bomFocus = "";
  /* řazení a filtry tabulky kusovníku — jen pohled (volby projektu se nemění), drží se mezi překresleními */
  const bomView = { sort: null, filters: {} };
  const BOM_COLS = [["pos", "#"], ["tag", N_("Označení")], ["item", N_("Položka")], ["desc", N_("Popis")], ["qty", N_("Ks")],
    ["brand", N_("Výrobce")], ["type", N_("Typ")], ["orderCode", N_("Objednací kód")], ["supplier", N_("Dodavatel")], ["note", N_("Poznámka")]];
  /** Druhy dodavatelů z katalogu (data jsou česky) → přeložitelný popisek. */
  const SUP_KIND = { "distributor": N_("distributor"), "e-shop": N_("e-shop"), "výrobce": N_("výrobce") };
  function rBom(el) {
    const p = prj();
    syncIO(p);
    const intro = "<p class='hint' style='margin-top:0;max-width:80ch'>" +
      tr("Kusovník je podklad k poptávce, ne projekt elektro. Značky a typy jsou typické volby z katalogu PLCdesk; dimenzování (výkony, průřezy, jištění) a bezpečnostní prvky podle posouzení rizik ověří projektant — návrh k revizi.") + " " +
      tr("Katalog k datu {date}.", { date: esc(CATALOG_DATE) }) + "</p>";
    if (!p.devices.length) { card(el, "10", tr("Kusovník"), intro + "<p class='hint'>" + tr("Nejdřív navrhni zařízení (kroky 2–4).") + "</p>"); return; }
    const cfg = p.bom || (p.bom = {});
    const { plat, lines } = buildBom(p);
    const lineCfg = id => { cfg.lines = cfg.lines || {}; return (cfg.lines[id] = cfg.lines[id] || {}); };
    const tidy = () => {   // prázdné volby neukládat (projekt zůstane čistý)
      for (const [id, o] of Object.entries(cfg.lines || {})) if (!Object.keys(o).length) delete cfg.lines[id];
      if (cfg.lines && !Object.keys(cfg.lines).length) delete cfg.lines;
      if (cfg.brand && !Object.keys(cfg.brand).length) delete cfg.brand;
    };
    /* překreslení bez skoku nahoru (render() jinak roluje na začátek stránky) */
    const rerender = () => { const y = window.scrollY; render(); window.scrollTo({ top: y }); };
    const commit = () => { tidy(); save(); rerender(); };
    /* vybraná volba katalogu pro řádek (pro odkaz na zdroj a dodavatele značky) */
    const pickOf = l => {
      const key = catKey(l.cat, plat), opts = bomOptions(l.cat, plat);
      const pick = cfg.lines?.[l.id]?.brand ?? cfg.brand?.[key];
      /* stejné pravidlo jako buildBom: bez volby značka shodná s platformou PLC, jinak první */
      const platBrand = PLAT[plat].name.split(" ")[0].toLowerCase();
      const o = pick !== undefined
        ? opts.find(x => x.id === pick) || opts.find(x => x.brand.brand === pick)
        : opts.find(x => x.brand.brand.toLowerCase().startsWith(platBrand)) || opts[0];
      return { key, opts, pick, opt: o, custom: pick !== undefined && !o, perLine: cfg.lines?.[l.id]?.brand !== undefined };
    };
    const opt = (v, label, sel) => "<option value='" + esc(v) + "'" + (sel ? " selected" : "") + ">" + esc(label) + "</option>";
    /* popisek volby výrobce: hodnota zůstává ID katalogu (brandOptId), řada je klíč překladu (N_ v catalog_data.ts) */
    const brandLabel = o => o.brand.orderCode ? o.id : (o.brand.series || [])[0] ? o.brand.brand + " · " + tr(o.brand.series[0]) : o.brand.brand;
    let rows = "";
    const bomVal = (l, k) => k === "pos" || k === "qty" ? l[k] : String(l[k] ?? "");
    const view = lines.slice();
    if (bomView.sort) {
      const [k, desc] = bomView.sort, num = k === "pos" || k === "qty";
      view.sort((a, b) => (num ? bomVal(a, k) - bomVal(b, k) : bomVal(a, k).localeCompare(bomVal(b, k), getLang())) * (desc ? -1 : 1));
    }
    for (const l of view) {
      const pk = pickOf(l), ov = cfg.lines?.[l.id] || {};
      const customMode = pk.custom || bomCustomEdit.has("b:" + l.id);
      const brandSel = "<select data-bf='brand' data-id='" + esc(l.id) + "' aria-label='" + esc(tr("Výrobce")) + "'>" +
        pk.opts.map(o => opt(o.id, brandLabel(o), !customMode && pk.opt && o.id === pk.opt.id)).join("") +
        (pk.opts.length ? "" : opt("", "—", !customMode && !l.brand)) +
        opt(BOM_CUSTOM, tr("vlastní…"), customMode) + "</select>" +
        (customMode ? "<input type='text' data-bf='brandTxt' data-id='" + esc(l.id) + "' value='" + esc(pk.custom ? l.brand : "") + "' placeholder='" + esc(tr("výrobce")) + "' style='margin-top:4px'>" : "") +
        "<label class='chk' style='font-size:.72rem;margin:4px 0 0' title='" + esc(tr("Volba výrobce platí pro všechny řádky této kategorie (i pro nové).")) + "'><input type='checkbox' data-bf='cat' data-id='" + esc(l.id) + "'" + (!pk.perLine && cfg.brand?.[pk.key] !== undefined ? " checked" : "") + "> " + tr("pro celou kategorii") + "</label>";
      const sups = [...new Set([...(pk.opt?.brand.suppliers || []).map(x => tr(x)), ...suppliersFor(pk.key).map(s => tr(s.name))])];
      const supCustom = bomCustomEdit.has("s:" + l.id) || (l.supplier && !sups.includes(l.supplier));
      const supSel = "<select data-bf='supplier' data-id='" + esc(l.id) + "' aria-label='" + esc(tr("Dodavatel")) + "'>" +
        opt("", "—", !supCustom && !l.supplier) + sups.map(s => opt(s, s, !supCustom && s === l.supplier)).join("") + opt(BOM_CUSTOM, tr("vlastní…"), supCustom) + "</select>" +
        (supCustom ? "<input type='text' data-bf='supplierTxt' data-id='" + esc(l.id) + "' value='" + esc(l.supplier) + "' placeholder='" + esc(tr("dodavatel")) + "' style='margin-top:4px'>" : "");
      const src = !pk.custom && pk.opt?.brand.src && ov.type === undefined
        ? " <a href='" + esc(pk.opt.brand.src) + "' target='_blank' rel='noopener' title='" + esc(tr("Zdroj údajů o typu")) + "'>↗</a>" : "";
      const autoNote = ov.note ? l.note.slice(0, Math.max(0, l.note.length - ov.note.length)).replace(/; $/, "") : l.note;
      rows += "<tr data-row='" + esc(l.id) + "'" + (l.safety ? " class='safety'" : "") + "><td class='mono'>" + l.pos + "</td>" +
        "<td class='mono'><b>" + esc(l.tag) + "</b></td>" +
        "<td>" + (l.safety ? "<span class='warnmark' title='" + esc(tr("Bezpečnostní prvek")) + "'>⚠</span> " : "") + esc(l.item) + "</td>" +
        "<td style='font-size:.78rem;min-width:140px'>" + esc(l.desc) + "</td>" +
        "<td><input type='number' min='0' step='1' data-bf='qty' data-id='" + esc(l.id) + "' value='" + l.qty + "' style='width:64px' aria-label='" + esc(tr("Ks")) + "'> <span class='hint' style='margin:0'>" + esc(l.unit) + "</span></td>" +
        "<td style='min-width:170px'>" + brandSel + "</td>" +
        "<td style='min-width:200px'><input type='text' data-bf='type' data-id='" + esc(l.id) + "' value='" + esc(l.type) + "'>" + src + "</td>" +
        "<td style='min-width:150px'><input type='text' data-bf='orderCode' data-id='" + esc(l.id) + "' value='" + esc(l.orderCode) + "'></td>" +
        "<td style='min-width:150px'>" + supSel + "</td>" +
        "<td style='min-width:160px'>" + (autoNote ? "<div class='bomnote" + (l.safety ? " warn" : "") + "'>" + esc(autoNote) + "</div>" : "") +
        "<input type='text' data-bf='note' data-id='" + esc(l.id) + "' value='" + esc(ov.note || "") + "' placeholder='" + esc(tr("vlastní poznámka")) + "'></td></tr>";
    }
    /* přehled dodavatelů použitých v kusovníku */
    const used = [...new Set(lines.map(l => l.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const supRows = used.map(n => {
      // dodavatelé u značek v katalogu jsou volný text („Festo CZ (přímo)") → shoda i podle začátku názvu
      const base = n.split(" (")[0].toLowerCase();
      const s = SUPPLIERS.find(x => x.name === n || tr(x.name) === n) || SUPPLIERS.find(x => x.name.split(" (")[0].toLowerCase() === base)
        || SUPPLIERS.find(x => base.length > 3 && (x.name.toLowerCase().startsWith(base) || base.startsWith(x.name.split(" (")[0].toLowerCase())));
      const userText = lines.some(l => l.supplier === n && cfg.lines?.[l.id]?.supplier === n);
      return "<tr><td><b>" + esc(n) + "</b></td><td>" + (s?.url ? "<a href='" + esc(s.url) + "' target='_blank' rel='noopener'>" + esc(s.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")) + "</a>" : "—") + "</td><td>" +
        esc(s ? (SUP_KIND[s.kind] ? tr(SUP_KIND[s.kind]) : (s.kind || "—")) : userText ? tr("vlastní") : "—") + "</td><td style='font-size:.78rem'>" + esc(lines.filter(l => l.supplier === n).length) + "</td></tr>";
    }).join("");
    const c = card(el, "10", tr("Kusovník"), intro + `
    <div class="row" style="margin-top:4px">
      <label class="f" style="flex-direction:row;gap:8px;align-items:center">${tr("Platforma HW")}
        <select id="bomPlat">${Object.entries(PLAT).map(([k, pf]) => opt(k, pf.name + (p.platforms.includes(k) ? " ★" : ""), k === plat)).join("")}</select>
      </label>
      <span class="hint" style="margin:0">${tr("★ = platforma zvolená v projektu. Podle platformy se vybere CPU a I/O moduly.")}</span>
    </div>
    <div class="stats"><span class="stat">${tr("řádků <b>{n}</b>", { n: lines.length })}</span><span class="stat">${tr("kusů <b>{n}</b>", { n: lines.reduce((a, l) => a + l.qty, 0) })}</span>${lines.some(l => l.safety) ? "<span class='stat'>⚠ <b>" + lines.filter(l => l.safety).length + "</b></span>" : ""}</div>
    <div class="row" style="margin:6px 0 2px"><span class="hint" style="margin:0" id="bomShown"></span>
      <button class="small" id="bBomFltClear" ${Object.keys(bomView.filters).length ? "" : "hidden"}>${tr("Zrušit filtry")}</button>
      <span class="hint" style="margin:0">${tr("Klik na záhlaví = řazení (▲ / ▼ / původní pořadí); pole pod záhlavím = filtr sloupce.")}</span></div>
    <div class="tablewrap"><table class="bom"><thead><tr>${BOM_COLS.map(([k, t]) => "<th class='sortable' data-sort='" + k + "' title='" + esc(tr("Seřadit")) + "'>" + esc(k === "pos" ? t : tr(t)) + (bomView.sort && bomView.sort[0] === k ? (bomView.sort[1] ? " ▼" : " ▲") : "") + "</th>").join("")}</tr>
      <tr class="filters">${BOM_COLS.map(([k, t]) => "<th><input type='search' data-flt='" + k + "' value='" + esc(bomView.filters[k] || "") + "' placeholder='" + esc(tr("filtr")) + "' aria-label='" + esc(tr("Filtr sloupce {col}", { col: k === "pos" ? t : tr(t) })) + "'></th>").join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    ${lines.some(l => l.safety) ? "<p class='warnbox'>⚠ " + tr("Volba a zapojení podle posouzení rizik (EN ISO 13849) — návrh k revizi.") + "</p>" : ""}
    <div class="row">
      <button class="small primary" id="bBomCsv">${tr("Stáhnout CSV")}</button>
      <button class="small" id="bBomTsv">${tr("Kopírovat jako tabulku")}</button>
      <button class="small danger" id="bBomReset">${tr("Obnovit výchozí volby")}</button>
      <span class="hint" style="margin:0">${tr("CSV se středníky pro Excel; tabulku vložíš do Excelu nebo e-mailu. Množství 0 řádek z kusovníku vyřadí — vrátí ho Obnovit výchozí volby.")}</span>
    </div>
    <h3>${tr("Dodavatelé v kusovníku")}</h3>
    ${used.length ? "<div class='tablewrap'><table><thead><tr><th>" + tr("Dodavatel") + "</th><th>" + tr("Web") + "</th><th>" + tr("Druh") + "</th><th>" + tr("Řádků") + "</th></tr></thead><tbody>" + supRows + "</tbody></table></div>" : "<p class='hint'>" + tr("Žádný dodavatel není vybrán.") + "</p>"}`);

    c.querySelector("#bomPlat").addEventListener("change", e => { cfg.plat = e.target.value; commit(); });
    /* řazení: klik na záhlaví; filtry: skrývání řádků bez překreslení (kurzor zůstane v poli) */
    c.querySelectorAll("th[data-sort]").forEach(th => th.addEventListener("click", () => {
      const k = th.dataset.sort, s = bomView.sort;
      bomView.sort = !s || s[0] !== k ? [k, false] : !s[1] ? [k, true] : null;
      rerender();
    }));
    const applyFilters = () => {
      const f = Object.entries(bomView.filters).filter(([, v]) => v);
      let n = 0;
      c.querySelectorAll("table.bom tbody tr[data-row]").forEach(row => {
        const l = lines.find(x => x.id === row.dataset.row);
        const ok = !l || f.every(([k, v]) => String(bomVal(l, k)).toLowerCase().includes(v.toLowerCase()));
        row.hidden = !ok;
        if (ok) n++;
      });
      c.querySelector("#bomShown").textContent = f.length ? tr("zobrazeno {n} z {m}", { n, m: lines.length }) : "";
      c.querySelector("#bBomFltClear").hidden = !f.length;
    };
    c.querySelectorAll("input[data-flt]").forEach(inp => inp.addEventListener("input", () => {
      const v = inp.value.trim();
      if (v) bomView.filters[inp.dataset.flt] = v; else delete bomView.filters[inp.dataset.flt];
      applyFilters();
    }));
    c.querySelector("#bBomFltClear").addEventListener("click", () => { bomView.filters = {}; rerender(); });
    applyFilters();
    const lineById = id => lines.find(l => l.id === id);
    /* výrobce: pro řádek, nebo pro celou kategorii (pak se volby řádků téže kategorie zruší) */
    const setBrand = (l, val, forCat) => {
      const key = catKey(l.cat, plat);
      const clearLine = id => { const o = cfg.lines?.[id]; if (o) { delete o.brand; delete o.type; delete o.orderCode; delete o.supplier; } };
      if (forCat) {
        cfg.brand = cfg.brand || {};
        if (val === undefined) delete cfg.brand[key]; else cfg.brand[key] = val;
        for (const x of lines) if (catKey(x.cat, plat) === key) clearLine(x.id);
      } else {
        clearLine(l.id);
        if (val !== undefined) lineCfg(l.id).brand = val;
      }
    };
    const catOn = id => !!c.querySelector("input[data-bf=cat][data-id='" + CSS.escape(id) + "']")?.checked;
    c.querySelectorAll("[data-bf]").forEach(inp => {
      const id = inp.dataset.id, l = lineById(id), f = inp.dataset.bf;
      if (!l) return;
      inp.addEventListener("change", () => {
        const v = inp.value;
        if (f === "brand") {
          if (v === BOM_CUSTOM) { bomCustomEdit.add("b:" + id); bomFocus = "b:" + id; rerender(); return; }
          bomCustomEdit.delete("b:" + id);
          setBrand(l, v, catOn(id));
        } else if (f === "brandTxt") {
          const t = v.trim();
          if (!t) return;   // prázdný vlastní text nic nemění
          bomCustomEdit.delete("b:" + id);
          setBrand(l, t, catOn(id));
        } else if (f === "cat") {
          const pk = pickOf(l);
          const cur = pk.pick ?? pk.opt?.id;   // aktuální volba řádku (i výchozí z katalogu)
          if (cur === undefined) return;   // kategorie bez katalogu a bez volby — není co rozšířit
          if (inp.checked) setBrand(l, cur, true);
          else lineCfg(id).brand = cur;
        } else if (f === "supplier") {
          if (v === BOM_CUSTOM) { bomCustomEdit.add("s:" + id); bomFocus = "s:" + id; rerender(); return; }
          bomCustomEdit.delete("s:" + id);
          lineCfg(id).supplier = v;
        } else if (f === "supplierTxt") {
          bomCustomEdit.delete("s:" + id);
          lineCfg(id).supplier = v.trim();
        } else if (f === "qty") {
          const n = numIn(v);
          if (n === undefined || n < 0) delete lineCfg(id).qty; else lineCfg(id).qty = Math.round(n);
        } else if (f === "type" || f === "orderCode") {
          // prázdné pole = zpět na hodnotu z katalogu
          if (v.trim()) lineCfg(id)[f] = v.trim(); else delete lineCfg(id)[f];
        } else if (f === "note") {
          if (v.trim()) lineCfg(id).note = v.trim(); else delete lineCfg(id).note;
        }
        commit();
      });
    });
    if (bomFocus) {   // právě zvolené „vlastní…" → kurzor rovnou do pole pro text
      const [t, id] = [bomFocus.slice(0, 1), bomFocus.slice(2)];
      bomFocus = "";
      const inp = c.querySelector("input[data-bf=" + (t === "b" ? "brandTxt" : "supplierTxt") + "][data-id='" + CSS.escape(id) + "']");
      if (inp) inp.focus();
    }
    c.querySelector("#bBomCsv").addEventListener("click", () => downloadFile(projectFileName(p, "_kusovnik.csv"), bomCsv(p)));
    c.querySelector("#bBomTsv").addEventListener("click", () => {
      const cell = v => String(v ?? "").replace(/[\t\r\n]+/g, " ");
      const head = ["#", tr("Označení"), tr("Položka"), tr("Popis"), tr("Množství"), tr("Jednotka"), tr("Výrobce"), tr("Typ"), tr("Objednací kód"), tr("Dodavatel"), tr("Poznámka")];
      const body = lines.map(l => [l.pos, l.tag, l.item, l.desc, l.qty, l.unit, l.brand, l.type, l.orderCode, l.supplier, l.note]);
      copyText([head, ...body].map(r => r.map(cell).join("\t")).join("\n") + "\n", c.querySelector("#bBomTsv"));
    });
    c.querySelector("#bBomReset").addEventListener("click", () => {
      p.bom = cfg.plat ? { plat: cfg.plat } : {};
      bomCustomEdit.clear();
      save(); render();
    });
  }

  /* ---------------------------------------------------------- Nápověda
     Každý nadpis, odstavec a odrážka je jeden klíč překladu; krátké řádkové značky
     (<b>, <code>, <i>) zůstávají v klíči, struktura (<p>, <ul>, <li>, tabulka) mimo něj. */
  function rHelp(el) {
    const H = (t, b) => "<details class='help'><summary>" + t + "</summary><div class='body'>" + b + "</div></details>";
    const c = document.createElement("section");
    c.className = "card";
    c.innerHTML = "<h2><span class='n'>?</span>" + tr("Škola PLC — nápověda pro začátečníky") + "</h2>"
      + H(tr("Co je PLC a jak funguje"), `
      <p>${tr("PLC (programovatelný logický automat) je průmyslový počítač, který řídí stroj: čte vstupy (tlačítka, snímače), vyhodnotí program a nastaví výstupy (stykače, ventily, signálky). Na rozdíl od běžného PC je stavěný na nepřetržitý provoz, rušení a teploty v rozvaděči.")}</p>
      <p>${tr(`<b>Scan cyklus</b>: <b>1)</b> načti vstupy, <b>2)</b> vykonej program odshora dolů, <b>3)</b> zapiš výstupy — opakuje se každých 1–10 ms. Program nikdy „nečeká" uvnitř; stav do dalšího cyklu musí být v proměnné.`)}</p>
      <p>${tr("Typický projekt = <b>HW konfigurace</b> + <b>tagy</b> + <b>program</b> (bloky).")}</p>`)
      + H(tr("Vstupy a výstupy (DI / DO / AI / AO)"), `
      <ul>
        <li>${tr("<b>DI</b> — digitální vstup 24 V DC: tlačítko, koncák, čidlo.")}</li>
        <li>${tr("<b>DO</b> — digitální výstup: stykač, ventil, signálka; větší zátěž přes relé.")}</li>
        <li>${tr("<b>AI</b> — analogový vstup 0–10 V / 4–20 mA; surové číslo se škáluje na jednotky (FB_AnalogIn). 4–20 mA pozná přerušený vodič.")}</li>
        <li>${tr("<b>AO</b> — analogový výstup: měnič, proporcionální ventil.")}</li>
      </ul>
      <p>${tr(`<b>NC vs. NO:</b> bezpečnostní signály se zapojují NC — TRUE = v pořádku, přerušený vodič = zastavení. Proto E-stop = TRUE znamená „můžeš jet".`)}</p>`)
      + H(tr("Jazyky IEC 61131-3 — kterým psát"), `
      <ul>
        <li>${tr("<b>LAD</b> — žebříček; čte ho údržba, ideální na blokování.")}</li>
        <li>${tr("<b>FBD</b> — grafické bloky, analogová logika.")}</li>
        <li>${tr("<b>ST / SCL</b> — text jako Pascal; výpočty, automaty, data. <b>Tímto generuje PLCdesk</b> — je přenositelný.")}</li>
        <li>${tr("<b>SFC/GRAPH</b> — velké sekvence. <b>IL/STL</b> — jen údržba starého kódu.")}</li>
      </ul>`)
      + H(tr("Stavební bloky programu (FB, FC, DB, instance)"), `
      <ul>
        <li>${tr("<b>FC</b> — bez paměti; výpočty.")}</li>
        <li>${tr("<b>FB</b> — má instanci (paměť). Jeden FB_Motor, deset motorů = deset instancí.")}</li>
        <li>${tr("<b>DB / globální proměnné</b> — data; <b>UDT</b> — vlastní typy.")}</li>
        <li>${tr("<b>OB / task</b> — vstupní body; u Siemens doplnit OB82/86/121/122, jinak CPU při poruše periferie stopne.")}</li>
      </ul>
      <p>${tr("Pravidlo: žádné magické bity a absolutní adresy — vše symbolicky, zařízení jako instance FB.")}</p>`)
      + H(tr("Stavové automaty a časovače"), `
      <p>${tr("Každé zařízení i sekvence je <b>stavový automat</b>: proměnná krok + CASE; každý čekací krok má timeout do chybového stavu. Kostra: <code>CASE statStep OF 0: klid … 10: rozběh (timeout!) … 20: běh … 90: porucha END_CASE</code>.")}</p>
      <p>${tr("<b>TON</b> = zpožděné sepnutí; <b>hrana</b>: <code>trig := sig AND NOT lastSig; lastSig := sig;</code>")}</p>`)
      + H(tr("Bezpečnost — co NIKDY neřešit jen programem"), `
      <p>${tr("Nouzové zastavení, kryty, dvouruční ovládání jsou <b>bezpečnostní funkce</b> dle ISO 13849 / IEC 62061 — musí je zajistit bezpečnostní relé nebo safety PLC dle posouzení rizik. Běžný program s bezpečnostním signálem jen pracuje (zastaví sekvenci) — nesmí být jediné, co člověka chrání. V EU je to součást CE (nařízení 2023/1230).")}</p>`)
      + H(tr("Přehled platforem"), `
      <div class='tablewrap'><table><thead><tr><th>${tr("Výrobce")}</th><th>IDE</th><th>CPU</th><th>${tr("Jazyk")}</th><th>${tr("Import z PLCdesk")}</th></tr></thead><tbody>
      ${Object.values(PLAT).map(pf => "<tr><td><b>" + pf.name + "</b></td><td>" + pf.ide + "</td><td>" + pf.cpu + "</td><td class='mono'>" + tr(pf.lang) + "</td><td style='font-size:.78rem'>" + tr(pf.imp) + "</td></tr>").join("")}
      </tbody></table></div>`)
      + H(tr("Odkazy na platformy"), platRefsHtml())
      + H(tr("Blokové a elektrické schéma — jak je číst"), `
      <p>${tr("<b>Blokové schéma</b>: vlevo zdroje signálů, uprostřed PLC (zdroj 24 V, CPU, moduly z počtu I/O), vpravo akční členy; čára = signál.")}</p>
      <p>${tr("<b>Elektrické zapojení</b>: DI od L+ přes kontakt na svorku; DO ze svorky přes zátěž na M (0 V); analogy smyčka 4–20 mA. Rámeček s referencemi, popisové pole, značení <code>-M1</code> (IEC 81346), čísla vodičů <code>-W1xx</code>, NC/NO dle IEC 60617. Každý list jde stáhnout i jako <b>DXF</b> pro EPLAN/AutoCAD.")}</p>
      <p>${tr("Je to <i>podklad</i>, ne výrobní dokumentace — jištění, průřezy a dispozici řeší projektant elektro.")}</p>`)
      + H(tr("Migrace projektu mezi platformami"), `
      <p>${tr("<b>1)</b> exportuj tagy/GVL ze zdrojové platformy, <b>2)</b> volba Import v kroku Zařízení, <b>3)</b> zkontroluj třídy a adresy, <b>4)</b> vyber cílovou platformu a vygeneruj. Přenese se struktura, tagy, komentáře; HW, safety, komunikace a specifická logika jsou ruční práce.")}</p>`)
      + H(tr("Slovníček"), `
      <ul>
        <li>${tr("<b>Tag</b> — pojmenovaný signál. <b>Instance</b> — paměť jednoho použití FB.")}</li>
        <li>${tr("<b>Scan</b> — průchod programu. <b>Interlock</b> — blokovací podmínka.")}</li>
        <li>${tr("<b>HMI</b> — operátorský panel. <b>Retain</b> — proměnná přežívající vypnutí.")}</li>
        <li>${tr("<b>Openness / L5X / PLCopen XML</b> — formáty pro strojovou výměnu projektů.")}</li>
        <li>${tr("<b>PLCSIM, Logix Echo, GX Simulator…</b> — simulátory CPU.")}</li>
      </ul>`)
      + H(tr("Jak pracovat s PLCdesk"), `
      <ol style='padding-left:20px'>
        <li>${tr("<b>Projekt</b> — pojmenuj; nebo načti ukázku.")}</li>
        <li>${tr("<b>AI návrh</b> — popiš stroj, AI navrhne zařízení a sekvenci (API klíč v nastavení kroku).")}</li>
        <li>${tr("<b>Platformy</b> — vyber cílové systémy.")}</li>
        <li>${tr("<b>Zařízení</b> — dolaď sestavu; Import existujícího projektu je vedlejší volba dole.")}</li>
        <li>${tr("<b>I/O</b> — tagy, adresy, NC; kontrola návrhu hlídá duplicity a přenositelnost tagů.")}</li>
        <li>${tr("<b>Schéma</b> — blokové schéma, elektrické zapojení (SVG/DXF), svorkovnice.")}</li>
        <li>${tr("<b>Program</b> — E-stop a automatická sekvence.")}</li>
        <li>${tr("<b>Generovat</b> — kód po platformách, README s postupem importu.")}</li>
        <li>${tr("<b>Dokumentace</b> — FDS, FAT a spol. po souborech ke stažení.")}</li>
        <li>${tr("<b>Kusovník</b> — komponenty k poptávce: výrobci, typy, objednací kódy a dodavatelé; CSV pro Excel.")}</li>
        <li>${tr("<b>Bezpečnost</b> — nebezpečí a bezpečnostní funkce (PLr z grafu rizik, architektura, výpočet PL, bezpečná vzdálenost), schvalování, bezpečnostní program a výkres okruhu.")}</li>
        <li>${tr("<b>Schválení</b> — odpovědná osoba schvaluje položky návrhu jménem, datem a poznámkou; návrhy ladění z ověření.")}</li>
        <li>${tr("<b>Oživení</b> — plán oživení po fázích, výsledky kroků OK / Nevyhovuje / N/A a protokol (MD, CSV).")}</li>
      </ol>`)
      + H(tr("Schvalování a oživení"), `
      <p>${tr("PLCdesk navrhuje, platí jen to, co odpovědná osoba schválí. Každá položka (zařízení, tabulka I/O, sekvence, E-stop a blokování, takt, výsledek ověření, bezpečnost, plán oživení) se schvaluje jménem, datem a poznámkou. Schválení platí pro obsah v okamžiku schválení — když se položka potom změní, ukáže se „změněno po schválení“ a je potřeba ji schválit znovu. Odznak v hlavičce ukazuje počet neschválených položek.")}</p>
      <p>${tr("Návrhy ladění (delší hlídací čas, meze měření, nesplněný takt…) se dají jedním klikem použít — tím se změní projekt, ale nic se neschválí. Oživení prochází stroj po fázích od rozvaděče po validaci bezpečnostních funkcí; ke každému kroku se zapíše výsledek, naměřená hodnota a kdo ho zapsal.")}</p>`);
    el.appendChild(c);
  }

  /** Druhy odkazů v pořadí, v jakém se v nápovědě ukazují. */
  const REF_KIND = {
    product: N_("Produkt"), ide: N_("Vývojové prostředí (IDE)"), st_ref: N_("Reference jazyka"),
    manual: N_("Příručky"), import: N_("Import a export"), support: N_("Podpora"), cz: N_("Zastoupení v ČR"),
  };
  /** Nápověda: ověřené odkazy na dokumentaci platforem, seskupené podle druhu. */
  function platRefsHtml() {
    let h = "<p>" + tr("Oficiální stránky výrobců: produkt, vývojové prostředí, reference jazyka, příručky, postup importu a podpora. Odkazy byly ověřené k datu rešerše ({date}); výrobci je mohou měnit — když odkaz nefunguje, hledej název dokumentu na webu výrobce.", { date: esc(CATALOG_DATE) }) + "</p>";
    for (const [k, pf] of Object.entries(PLAT)) {
      const refs = PLATFORM_REFS[k] || [];
      if (!refs.length) continue;
      h += "<h4 style='margin:14px 0 4px'>" + esc(pf.name) + "</h4><ul class='refs'>";
      for (const kind of Object.keys(REF_KIND)) {
        const rs = refs.filter(r => r.kind === kind);
        if (!rs.length) continue;
        h += "<li><b>" + tr(REF_KIND[kind]) + ":</b> " + rs.map(r =>
          "<a href='" + esc(r.url) + "' target='_blank' rel='noopener'>" + esc(tr(r.title)) + "</a>" +
          (r.lang && r.lang !== "cs" ? " <span class='reflang'>" + esc(r.lang.toUpperCase()) + "</span>" : "") +
          (r.login ? " <i class='hint'>(" + tr("vyžaduje přihlášení") + ")</i>" : "")).join("; ") + "</li>";
      }
      h += "</ul>";
    }
    return h;
  }

  return { rProjekt, rAI, rPlat, rDev, rIO, rSchema, rProg, rGen, rDocs, rBom, rHelp };
}
