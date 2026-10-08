/* PLCdesk — aplikační shell: stav, navigace, render, jazyk. */
import { blankProject, PLAT, LANGS, tr, N_, setLang, getLang, registerSafetyModule, registerHmiModule } from "../../../packages/core/dist/index.js";
import { makeSteps } from "./steps.js";
import { makeImportWizard } from "./import_wizard.js";
import { makeSafetyStep } from "./safety_step.js";
import { makeApprovalStep, approvalBadge, setApproverSource } from "./approval_step.js";
import { makeBizSteps } from "./biz_steps.js";
import { approverNames } from "./biz_view.js";
import { makeCommissionStep } from "./commission_step.js";
import { $, normProject, normAi, setProjectHeader, rememberNumber, suggestNumber } from "./util.js";
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
/** Načte uložený stav; vrací true, pokud nějaký byl (i prázdný projekt — ten se ukázkou nepřepisuje). */
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
  } catch { /* poškozený stav: začni znovu */ }
  return true;
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
  return false;
}

/* Průvodce importem stávajícího zařízení (modální okno nad kroky; vstup z kroku Projekt a Zařízení). */
let wizard = null;
const steps = makeSteps({ S, save, render, openImport: () => wizard && wizard.open() });
wizard = makeImportWizard({ S, save, render });
const sctx = { S, save, render, showBadge };
const safety = makeSafetyStep(sctx), approval = makeApprovalStep(sctx), commission = makeCommissionStep(sctx);
const genTabs = makeGenTabs(sctx, steps.rGen);   // Generovat: Kód / HMI / Emulace / SISTEMA a EPLAN
/* revize a knihovna (krok Projekt), přidání z knihovny (Zařízení), Kusovník / Nabídka — biz_steps.js */
const biz = makeBizSteps(sctx);
setApproverSource(() => approverNames(S.prj));   // schvalovatelé z firemní knihovny projektu
const RENDERERS = [el => { steps.rProjekt(el); biz.rRevisions(el); biz.rLibrary(el); }, steps.rAI, steps.rPlat,
  el => { steps.rDev(el); biz.rDevLibrary(el); }, steps.rIO, steps.rSchema, steps.rProg, genTabs.rGenTabs, steps.rDocs,
  el => biz.rBomTabs(el, steps.rBom), safety.rSafety, approval.rApproval, commission.rCommission];

/* ---------------------------------------------------------------- odznak „Neschváleno: N"
   pending + stale ze schvalování; počítá se odloženě po vykreslení a jen při změně projektu
   (souhrn potřebuje ověření simulací — u velkého projektu sekundy). Klik → krok Schválení. */
let badgeSum = null, badgeTimer = 0;
const BADGE_LIVE_DEVICES = 60;   // do této velikosti se odznak přepočítá po každé změně
function showBadge(sum) {
  badgeSum = sum || badgeSum;
  const b = $("badgeApproval");
  if (!badgeSum) { b.hidden = true; return; }
  const n = badgeSum.pending + badgeSum.stale + (badgeSum.unverified || 0);   // „čeká na ověření“ = neschváleno
  b.hidden = !n;
  b.textContent = tr("Neschváleno: {n}", { n }) + (badgeSum.old ? " ?" : "");
  b.title = tr("Položky bez platného schválení (čeká, změněno po schválení) — otevře krok Schválení")
    + (badgeSum.old ? " · " + tr("Projekt se od výpočtu změnil; u velkého projektu se počet přepočítá v krocích Dokumentace a Schválení.") : "");
  b.classList.toggle("stale", badgeSum.stale > 0);
}
function scheduleBadge() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => {
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
  nav.innerHTML = STEPS.map((s, i) => "<button class='" + (i === S.step ? "on" : (stepDone(i) ? "done" : "")) + "' data-i='" + i + "'>" + (i + 1) + " · " + tr(s) + "</button>").join("")
    + "<button class='helpbtn" + (S.step === "help" ? " on" : "") + "' data-help>?&nbsp;" + tr("Nápověda") + "</button>";
  nav.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { S.step = b.hasAttribute("data-help") ? "help" : +b.dataset.i; save(); render(); }));
  setProjectHeader(S.prj);
  const num = typeof S.step === "number";
  $("btnPrev").style.visibility = (num && S.step > 0) ? "visible" : "hidden";
  $("btnNext").style.visibility = (num && S.step < STEPS.length - 1) ? "visible" : "hidden";
  const r = (S.step === "help") ? steps.rHelp : (RENDERERS[S.step] || steps.rProjekt);
  $("view").innerHTML = "";
  /* jednorázová zpráva (výsledek importu) — jen v kroku, pro který vznikla; jinam se nepřenáší */
  if (S.notice && S.notice.step !== S.step) S.notice = null;
  if (S.notice) {
    const n = document.createElement("div");
    n.className = "notice " + S.notice.level; n.id = "notice"; n.setAttribute("role", "status");
    n.textContent = S.notice.text;
    $("view").appendChild(n);
  }
  /* licence: pás nad kroky s výstupy (Generovat, Dokumentace, Kusovník) — nad limitem Free výrazně */
  if ([7, 8, 9].includes(S.step)) licenseBanner($("view"), S.prj);
  renderLicenseBadge($("badgeLicense"));
  r($("view"));
  wizard.render();
  showBadge();
  biz.updateBadge();   // označení revize v hlavičce („B*“ = změněno od revize)
  scheduleBadge();
  window.scrollTo({ top: 0 });
}

$("btnPrev").addEventListener("click", () => { if (typeof S.step === "number" && S.step > 0) { S.step--; save(); render(); } });
$("btnNext").addEventListener("click", () => { if (typeof S.step === "number" && S.step < STEPS.length - 1) { S.step++; save(); render(); } });

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
await initLicense({ project: () => S.prj, onChange: () => render() });
if (!load()) {   // první návštěva: prázdný projekt (žádná ukázka) s navrženým číslem projektu
  S.prj = blankProject();
  const num = suggestNumber();
  if (num) S.prj.meta.number = num;
}
render();
