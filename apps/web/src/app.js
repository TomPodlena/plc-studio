/* PLCdesk — aplikační shell: stav, navigace, render, jazyk. */
import { blankProject, PLAT, LANGS, tr, N_, setLang, getLang, registerSafetyModule, registerHmiModule, escHtml as esc, syncIO, isVerified } from "../../../packages/core/dist/index.js";
import { get as workerGet, peek as workerPeek, forget as workerForget, workerActive, pendingCard } from "./worker_client.js";
import { makeSteps } from "./steps.js";
import { makeImportWizard } from "./import_wizard.js";
import { makeSafetyStep } from "./safety_step.js";
import { makeApprovalStep, approvalBadge, setApproverSource } from "./approval_step.js";
import { makeBizSteps } from "./biz_steps.js";
import { approverNames } from "./biz_view.js";
import { makeCommissionStep } from "./commission_step.js";
import { $, normProject, normAi, setProjectHeader, rememberNumber, saveBytesUngated } from "./util.js";
import { initProjectDir, suggestNumberAsync } from "./project_dir.js";
import { makeGenTabs } from "./gen_tabs.js";
import { emuGate } from "./emu_step.js";
import { trn } from "./plural.js";
import { initLicense, renderLicenseBadge, licenseBanner, openLicenseDialog } from "./license.js";

/* Bezpečnostní modul: položky ke schválení (nebezpečí, funkce, návrh, program), kroky validace
   v oživení, dokumenty 13/14, bezpečnostní program a položky kusovníku. */
registerSafetyModule();
/* HMI: dokument 16_hmi.md a soubory HMI v sadě projektu (levné). Emulace (dokument 15) je drahá —
   přihlásí se až po výslovném ověření v kroku Generovat → Emulace kódu (emu_step.js, emuGate). */
registerHmiModule();

const LS_KEY = "plcstudio.state";
const LANG_KEY = "plcstudio.lang";
/* Názvy kroků jsou konstanta modulu → jen označené N_(), překlad až při vykreslení. */
const STEPS = [N_("Projekt"), N_("AI návrh"), N_("Platformy"), N_("Zařízení"), N_("I/O"), N_("Schéma"), N_("Program"), N_("Generovat"), N_("Dokumentace"), N_("Kusovník"),
  N_("Bezpečnost"), N_("Schválení"), N_("Oživení")];
const STEP_APPROVAL = 11;   // krok 12 Schválení (index) — cíl odznaku v hlavičce

const S = {
  prj: blankProject(),
  ai: { turns: [], last: null, draft: "" },
  step: 0,
};

/* Nepovedené uložení (plné úložiště — QuotaExceeded —, zakázané úložiště) se nezahazuje tiše:
   trvalé varování pod lištou kroků, dokud se uložení znovu nepodaří. */
let saveFailed = false;
function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ prj: S.prj, ai: S.ai, step: S.step }));
    rememberNumber(S.prj.meta && S.prj.meta.number);      // historie čísel pro návrh dalšího (util.js)
    if (saveFailed) { saveFailed = false; showSaveWarn(); }
  } catch (e) {
    if (!saveFailed) console.warn("save:", e);
    saveFailed = true; showSaveWarn();
  }
}
function showSaveWarn() {
  let w = document.getElementById("saveWarn");
  if (!saveFailed) { if (w) w.hidden = true; return; }
  if (!w) {
    w = document.createElement("div");
    w.id = "saveWarn"; w.className = "notice err savewarn"; w.setAttribute("role", "alert");
    $("stepper").after(w);
  }
  w.hidden = false;
  w.innerHTML = "<b>" + tr("Projekt se neukládá!") + "</b> " + tr("Úložiště prohlížeče je plné nebo zakázané, takže změny po zavření či obnovení stránky ztratíš. Ulož si návrh hned tlačítkem Export návrhu (JSON) v kroku Projekt. Místo uvolníš zmenšením projektu — nejvíc zabírají staré revize (odeber je z exportovaného JSON a načti ho znovu) — nebo smazáním dat této stránky v prohlížeči až po exportu.");
}
/** Poškozený uložený stav z tohoto spuštění: text ke stažení zálohy (i když se ho do úložiště uložit nepodařilo). */
let corrupt = null;
/** Načte uložený stav; vrací true, pokud nějaký byl (i prázdný projekt — ten se ukázkou nepřepisuje).
    Poškozený stav = jako první návštěva (prázdný projekt s navrženým číslem) + hláška se zálohou (jako desktop). */
function load() {
  let s = null;
  try { s = localStorage.getItem(LS_KEY); } catch { /* bez úložiště */ }
  if (!s) return false;
  try {
    const d = JSON.parse(s);
    S.prj = normProject(d.prj || {});
    S.ai = normAi(d.ai);
    S.step = d.step === "help" || (Number.isInteger(d.step) && d.step >= 0 && d.step < STEPS.length) ? d.step : 0;
    if (S.prj.guidsAdded) save();   // migrace: doplněné GUID (core guid.ts) hned uložit — projekt změněn
  } catch (e) {
    /* poškozený stav: začni znovu, ale původní text neztrať — první uložení by ho přepsalo.
       Záloha pod vlastním klíčem (jen jedna, nejnovější); bez místa aspoň do konzole. */
    console.warn("load: poškozený uložený stav, záloha v " + LS_KEY + ".corrupt", e);
    S.prj = blankProject(); S.ai = { turns: [], last: null, draft: "" }; S.step = 0;
    let kept = false;
    try { localStorage.setItem(LS_KEY + ".corrupt", s); kept = true; } catch { console.warn("load: zálohu nelze uložit", s.slice(0, 2000)); }
    corrupt = { text: s, kept };
    const exc = String(e && e.message || e).slice(0, 200);
    S.notice = { step: 0, level: "err", corrupt: true, title: tr("Rozpracovaný návrh nejde načíst"), text: kept
      ? tr("Uložený stav aplikace je poškozený ({exc}) — začínám s prázdným návrhem. Původní data jsou zálohovaná v úložišti prohlížeče; stáhni si je tlačítkem Stáhnout zálohu.", { exc })
      : tr("Uložený stav aplikace je poškozený ({exc}) — začínám s prázdným návrhem. Zálohu se do úložiště prohlížeče nepodařilo uložit — stáhni si ji hned tlačítkem Stáhnout zálohu, po zavření stránky se ztratí.", { exc }) };
    return false;
  }
  return true;
}
/** Záloha poškozeného stavu ke stažení (vlastní data uživatele — mimo licenční bránu výstupů). */
function corruptBackupText() {
  if (corrupt) return corrupt.text;
  try { return localStorage.getItem(LS_KEY + ".corrupt"); } catch { return null; }
}

/* ---------------------------------------------------------------- jazyk
   Volba se pamatuje v localStorage (výchozí čeština); neznámý kód jádro vrátí jako "cs".
   Parametr adresy ?lang=en má přednost (odkaz na aplikaci v daném jazyce). */
function loadLang() {
  const q = new URLSearchParams(location.search).get("lang");
  if (q) return q;
  try { return localStorage.getItem(LANG_KEY) || "cs"; } catch { return "cs"; }
}
function applyLang(l) {
  document.documentElement.lang = setLang(l);
}

function stepDone(i) {
  if (i === 0) return !!S.prj.meta.name;
  if (i === 2) return S.prj.platforms.length > 0;
  if (i === 3) return S.prj.devices.length > 0;
  /* kroky 11–13 (jako desktop): ze souhrnu odznaku, jen pokud patří k aktuálnímu projektu */
  const b = badgeSum && badgeFresh ? badgeSum : null;
  if (b && i === STEP_APPROVAL - 1) return !!b.safetyOk;
  if (b && i === STEP_APPROVAL) return !!b.ok;
  if (b && i === STEP_APPROVAL + 1) return !!b.commissionDone;
  return false;
}
/** Souhrn odznaku patří k aktuálnímu projektu? (nastaví render a showBadge) */
let badgeFresh = false;
/** Značky hotových kroků v liště bez překreslení kroku (souhrn odznaku dorazí později). */
function markDone() {
  $("stepper").querySelectorAll("button[data-i]").forEach(b => {
    const i = +b.dataset.i;
    if (i === S.step) return;
    const done = stepDone(i);
    b.classList.toggle("done", done);
    b.textContent = navLabel(i, done);
  });
}
/** Popisek kroku v liště: hotový krok s fajfkou (jako desktop). */
const navLabel = (i, done) => (done ? "✔ " : "") + (i + 1) + " · " + tr(STEPS[i]);

/* Průvodce importem stávajícího zařízení (modální okno nad kroky; vstup z kroku Projekt a Zařízení). */
let wizard = null;
/* refresh: hlavička po úpravě bez překreslení kroku (řádek kusovníku) — odznaky schválení a revize */
const steps = makeSteps({ S, save, render, openImport: () => wizard && wizard.open(), refresh: () => { showBadge(); biz.updateBadge(); scheduleBadge(); } });
wizard = makeImportWizard({ S, save, render });
const sctx = { S, save, render, showBadge };
const safety = makeSafetyStep(sctx), approval = makeApprovalStep(sctx), commission = makeCommissionStep(sctx);
const genTabs = makeGenTabs(sctx, steps.rGen);   // Generovat: Kód / HMI / Emulace / SISTEMA a EPLAN
/* revize a knihovna (krok Projekt), přidání z knihovny (Zařízení), Kusovník / Nabídka — biz_steps.js */
const biz = makeBizSteps(sctx);
setApproverSource(() => approverNames(S.prj));   // schvalovatelé z firemní knihovny projektu
const RENDERERS = [el => { steps.rProjekt(el); biz.rRevisions(el); biz.rLibrary(el); }, steps.rAI, steps.rPlat,
  el => { steps.rDev(el); biz.rDevLibrary(el); }, steps.rIO, steps.rSchema, steps.rProg, genTabs.rGenTabs, steps.rDocs,
  el => biz.rBomTabs(el, steps.rBom), safety.rSafety,
  el => verified(el, "12", N_("Schválení návrhu"), approval.rApproval), el => verified(el, "13", N_("Oživení"), commission.rCommission)];

/** Kroky, které potřebují ověření simulací (Schválení, Oživení): u velkého projektu desítky sekund →
    spočítá ho Worker (worker_client.js), výsledek převezme cache jádra a krok se pak vykreslí beze změny. */
const refetched = new Set();
function verified(el, num, title, r) {
  const p = S.prj;
  if (workerActive() && p.devices.length && p.program.seq.length) {
    syncIO(p);
    if (!isVerified(p)) {
      const step = S.step;
      const redraw = () => { if (S.step === step) { const y = window.scrollY; render(); window.scrollTo({ top: y }); } };
      let w = workerGet("verify", { prj: p }, { slot: "verify", onDone: redraw });
      /* hotové, ale cache jádra ho mezitím vyřadila (jiný jazyk, starší projekt) → znovu z cache Workeru */
      if (!w.pending && !isVerified(p) && !refetched.has(w.key)) { refetched.add(w.key); workerForget(w.key); w = workerGet("verify", { prj: p }, { slot: "verify", onDone: redraw }); }
      if (w.pending) { pendingCard(el, num, tr(title), w, tr("Ověřuji návrh simulací…"), redraw); return; }
    }
  }
  r(el);
}

/* ---------------------------------------------------------------- odznak „Neschváleno: N"
   pending + stale ze schvalování; počítá se odloženě po vykreslení a jen při změně projektu
   (souhrn potřebuje ověření simulací — u velkého projektu sekundy). Klik → krok Schválení. */
let badgeSum = null, badgeTimer = 0;
const BADGE_LIVE_DEVICES = 60;   // do této velikosti se odznak přepočítá po každé změně
function showBadge(sum) {
  badgeSum = sum || badgeSum;
  badgeFresh = !!badgeSum && !!S.prj.devices.length && (!badgeSum.key || badgeSum.key === JSON.stringify(S.prj));
  markDone();
  const b = $("badgeApproval");
  /* bez zařízení odznak není (jako desktop); při nule „✔ Vše schváleno“ (jako desktop) */
  if (!badgeSum || !S.prj.devices.length) { b.hidden = true; return; }
  const n = badgeSum.pending + badgeSum.stale + (badgeSum.unverified || 0);   // „čeká na ověření“ = neschváleno
  b.hidden = false;
  b.classList.toggle("allok", !n);
  b.textContent = n ? tr("Neschváleno: {n}", { n }) + (badgeSum.old ? " ?" : "") : "✔ " + tr("Vše schváleno");
  b.title = (n ? tr("Položky bez platného schválení (čeká, změněno po schválení) — otevře krok Schválení") : tr("Všechny položky jsou schválené — otevře krok Schválení"))
    + (badgeSum.old ? " · " + tr("Projekt se od výpočtu změnil; u velkého projektu se počet přepočítá v krocích Dokumentace a Schválení.") : "");
  b.classList.toggle("stale", badgeSum.stale > 0);
}
function scheduleBadge() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => {
    /* s Workerem (worker_client.js): plný souhrn mimo hlavní vlákno, bez limitu velikosti projektu;
       do výsledku levný souhrn (dolní odhad „?“) — výsledek ho přepíše, jen když patří k aktuálnímu projektu */
    if (workerActive()) {
      try {
        syncIO(S.prj);
        const r = workerGet("badge", { prj: S.prj }, { slot: "badge", onDone: v => { if (workerPeek("badge", { prj: S.prj }) === v) showBadge(v.sum); } });
        if (!r.pending) showBadge(r.value.sum);
        else { const s = approvalBadge(S.prj, false); if (s) showBadge(s); }
      } catch (e) { console.warn("approval badge:", e); }
      return;
    }
    /* souhrn potřebuje ověření simulací — u velkého projektu (sekundy) jen v krocích, které ho počítají stejně */
    const compute = S.prj.devices.length <= BADGE_LIVE_DEVICES || [8, 10, 11, 12].includes(S.step);
    try { const s = approvalBadge(S.prj, compute); if (s) showBadge(s); else $("badgeApproval").hidden = true; } catch (e) { console.warn("approval badge:", e); }
  }, 400);
}
$("badgeApproval").addEventListener("click", () => { S.step = STEP_APPROVAL; save(); render(); });
$("badgeLicense").addEventListener("click", () => openLicenseDialog());

/* Statické texty hlavičky a patičky (v index.html jsou česky jako výchozí). */
function renderStatic() {
  $("badgeTagline").textContent = tr("AI návrh · schéma · kód · dokumentace");
  /* počet platforem vybraných v projektu (ne všech, které PLCdesk umí) */
  $("badgePlat").textContent = trn(S.prj.platforms.length, N_("{n} platforma|{n} platformy|{n} platforem"));
  $("stepper").setAttribute("aria-label", tr("Kroky návrhu"));
  $("lang").setAttribute("aria-label", tr("Jazyk rozhraní"));
  $("badgeLicense").setAttribute("aria-label", tr("Licence a tarif"));
  $("lang").value = getLang();
  $("btnPrev").textContent = "← " + tr("Zpět");
  $("btnNext").textContent = tr("Pokračovat") + " →";
}

function render() {
  emuGate(S.prj);   // dokument 15 jen pro projekt, pro který emulace proběhla
  renderStatic();
  showSaveWarn();   // text varování v aktuálním jazyce
  const nav = $("stepper");
  nav.innerHTML = STEPS.map((s, i) => { const done = i !== S.step && stepDone(i); return "<button class='" + (i === S.step ? "on" : (done ? "done" : "")) + "' data-i='" + i + "'>" + esc(navLabel(i, done)) + "</button>"; }).join("")
    + "<button class='helpbtn" + (S.step === "help" ? " on" : "") + "' data-help>?&nbsp;" + tr("Nápověda") + "</button>";
  nav.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { S.step = b.hasAttribute("data-help") ? "help" : +b.dataset.i; save(); render(); }));
  setProjectHeader(S.prj);
  const num = typeof S.step === "number";
  if (num) lastNumStep = S.step;
  $("btnPrev").style.visibility = (num && S.step > 0) ? "visible" : "hidden";
  $("btnNext").style.visibility = (num && S.step < STEPS.length - 1) ? "visible" : "hidden";
  const r = (S.step === "help") ? steps.rHelp : (RENDERERS[S.step] || steps.rProjekt);
  $("view").innerHTML = "";
  /* jednorázová zpráva (výsledek importu) — jen v kroku, pro který vznikla; jinam se nepřenáší */
  if (S.notice && S.notice.step !== S.step) S.notice = null;
  if (S.notice) {
    const n = document.createElement("div");
    n.className = "notice " + S.notice.level; n.id = "notice"; n.setAttribute("role", S.notice.level === "err" ? "alert" : "status");
    if (S.notice.title) { const b = document.createElement("b"); b.textContent = S.notice.title; n.append(b, " "); }
    n.append(S.notice.text);
    if (S.notice.corrupt) {
      /* poškozený uložený stav: záloha ke stažení (opravený JSON jde načíst v kroku Projekt) */
      const row = document.createElement("div");
      row.className = "row"; row.style.margin = "8px 0 0";
      row.innerHTML = "<button class='small primary' id='bCorruptDl'>" + esc(tr("Stáhnout zálohu")) + "</button><button class='small' id='bCorruptHide'>" + esc(tr("Skrýt")) + "</button>";
      row.querySelector("#bCorruptDl").addEventListener("click", () => {
        const t = corruptBackupText();
        if (t != null) saveBytesUngated("plcstudio.state.corrupt.json", t, "application/json");
      });
      row.querySelector("#bCorruptHide").addEventListener("click", () => { S.notice = null; n.remove(); });
      n.appendChild(row);
    }
    $("view").appendChild(n);
  }
  /* licence: pás nad kroky s výstupy (Generovat, Dokumentace, Kusovník) — nad limitem Free výrazně */
  if ([7, 8, 9].includes(S.step)) licenseBanner($("view"), S.prj);
  renderLicenseBadge($("badgeLicense"));
  /* chyba vykreslení kroku (neočekávaná data projektu) nesmí shodit zbytek aplikace — hláška místo prázdné stránky */
  try { r($("view")); } catch (e) {
    console.error("render:", e);
    const n = document.createElement("div");
    n.className = "notice err"; n.setAttribute("role", "alert");
    n.textContent = tr("Krok se nepodařilo zobrazit: {err}. Projekt zůstává uložený; zkontroluj data v předchozích krocích nebo si ho ulož tlačítkem Export návrhu (JSON) v kroku Projekt.", { err: e && e.message || String(e) });
    $("view").appendChild(n);
  }
  wizard.render();
  showBadge();
  biz.updateBadge();   // označení revize v hlavičce („B*“ = změněno od revize)
  scheduleBadge();
  window.scrollTo({ top: 0 });
}

$("btnPrev").addEventListener("click", () => { if (typeof S.step === "number" && S.step > 0) { S.step--; save(); render(); } });
$("btnNext").addEventListener("click", () => { if (typeof S.step === "number" && S.step < STEPS.length - 1) { S.step++; save(); render(); } });

/* ---------------------------------------------------------------- klávesové zkratky
   Ctrl+S uložit projekt, Ctrl+O otevřít projekt, Alt+← / Alt+→ předchozí / další krok, F1 Nápověda
   (desktop totéž v app.py). Rozepsané pole se před akcí uloží (událost change, jako při opuštění pole);
   nad modálním oknem (import, licence) zkratky nepracují. */
let lastNumStep = 0;          // krok, ze kterého se otevřela Nápověda (Alt+← z ní vrací zpět)
function toast(text, err = false) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.className = "notice toast" + (err ? " err" : "");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 5000);
}
/** Pole s fokusem, jehož hodnota se liší od vykreslené: vyvolá change (uložení jako při opuštění pole). */
function commitFocused() {
  const el = document.activeElement;
  if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName) || /^(checkbox|radio|button|file)$/.test(el.type)) return;
  if (el.value !== el.defaultValue) {
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (el.isConnected) el.defaultValue = el.value;   // stejná hodnota se podruhé neukládá (visibilitychange + pagehide)
  }
}
/* Zavření / obnovení karty, přepnutí jinam (mobil: karta na pozadí může být bez varování zahozena):
   rozepsané pole uložit jako při opuštění pole — handlery jsou synchronní a save() zapíše do localStorage
   hned (desktop totéž při zavření okna). */
const flushFocused = () => { try { commitFocused(); } catch (e) { console.warn("commitFocused:", e); } };
addEventListener("pagehide", flushFocused);
addEventListener("beforeunload", flushFocused);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushFocused(); });
const modalOpen = () => [...document.querySelectorAll("[aria-modal='true']")].some(m => m.getClientRects().length > 0);
function gotoStep(step) { commitFocused(); S.step = step; save(); render(); }
document.addEventListener("keydown", async e => {
  if (e.defaultPrevented || e.isComposing || e.repeat && e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const ours = (ctrl && (key === "s" || key === "o")) || (e.altKey && !e.ctrlKey && !e.metaKey && (key === "ArrowLeft" || key === "ArrowRight")) || (key === "F1" && !e.ctrlKey && !e.altKey);
  if (!ours) return;
  e.preventDefault();                 // prohlížeč: Uložit stránku, Otevřít soubor, Zpět / Vpřed, nápověda prohlížeče
  if (modalOpen()) return;
  if (key === "F1") { if (S.step !== "help") gotoStep("help"); return; }
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const cur = typeof S.step === "number" ? S.step : null;
    if (cur === null) { if (key === "ArrowLeft") gotoStep(lastNumStep); return; }
    const to = cur + (key === "ArrowLeft" ? -1 : 1);
    if (to >= 0 && to < STEPS.length) gotoStep(to);
    return;
  }
  if (key === "s") {
    commitFocused();
    try { const r = await steps.saveProject(); if (r) toast(r.text); }
    catch (er) { toast(tr("Uložení se nezdařilo") + ": " + (er && er.message || String(er)), true); }
    return;
  }
  if (key === "o") { commitFocused(); await steps.openProject(msg => toast(msg, true)); }
});

/* Přepínač jazyka: názvy jazyků se nepřekládají; změna překreslí celou aplikaci. */
$("lang").innerHTML = Object.entries(LANGS).map(([k, name]) => "<option value='" + k + "'>" + name + "</option>").join("");
$("lang").addEventListener("change", e => {
  applyLang(e.target.value);
  try { localStorage.setItem(LANG_KEY, getLang()); } catch { /* ignore */ }
  // ?lang= v adrese má přednost — přepiš ho, jinak by se po obnovení stránky vrátil původní jazyk
  const u = new URL(location.href);
  if (u.searchParams.has("lang")) { u.searchParams.set("lang", getLang()); history.replaceState(null, "", u); }
  render();
});

applyLang(loadLang());
/* licence (license.js): ověří uloženou licenci před prvním vykreslením, kontrola na pozadí nejvýš 1× denně */
/* Start nesmí uváznout ani spadnout na poškozeném úložišti (licence, IndexedDB) — každá část
   s časovým limitem a vlastním zachycením chyby; aplikace se vykreslí vždy. */
const guard = (label, p, ms = 4000) => {
  let timer = 0;
  return Promise.race([
    Promise.resolve().then(() => p()),
    new Promise(res => { timer = setTimeout(() => { console.warn(label + ": časový limit"); res(null); }, ms); }),
  ]).catch(e => { console.warn(label + ":", e); return null; }).finally(() => clearTimeout(timer));
};
await guard("license", () => initLicense({ project: () => S.prj, onChange: () => render() }));
/* kořenový adresář projektů (project_dir.js): handle z IndexedDB a stav oprávnění — bez dotazu */
await guard("projectDir", () => initProjectDir(), 1500);   // plné / vadné úložiště: IndexedDB se nemusí ozvat — start nečeká déle
if (!load()) {   // první návštěva: prázdný projekt (žádná ukázka) s navrženým číslem projektu
  S.prj = blankProject();
  const num = await guard("number", () => suggestNumberAsync(), 1500);     // ze složek kořene, bez přístupu z historie prohlížeče
  if (num) S.prj.meta.number = num;
}
render();
