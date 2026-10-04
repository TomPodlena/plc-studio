/* PLCdesk — aplikační shell: stav, navigace, render, jazyk. */
import { blankProject, sampleComplex, PLAT, LANGS, tr, N_, setLang, getLang, registerSafetyModule } from "../../../packages/core/dist/index.js";
import { seedFromProject, SAMPLE_DESC } from "./ai.js";
import { makeSteps } from "./steps.js";
import { makeImportWizard } from "./import_wizard.js";
import { makeSafetyStep } from "./safety_step.js";
import { makeApprovalStep, approvalBadge } from "./approval_step.js";
import { makeCommissionStep } from "./commission_step.js";
import { $, normProject, normAi } from "./util.js";

/* Bezpečnostní modul: položky ke schválení (nebezpečí, funkce, návrh, program), kroky validace
   v oživení, dokumenty 13/14, bezpečnostní program a položky kusovníku. */
registerSafetyModule();

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

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ prj: S.prj, ai: S.ai, step: S.step })); } catch { /* ignore */ }
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
const RENDERERS = [steps.rProjekt, steps.rAI, steps.rPlat, steps.rDev, steps.rIO, steps.rSchema, steps.rProg, steps.rGen, steps.rDocs, steps.rBom,
  safety.rSafety, approval.rApproval, commission.rCommission];

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

/* Statické texty hlavičky a patičky (v index.html jsou česky jako výchozí). */
function renderStatic() {
  $("badgeTagline").textContent = tr("AI návrh · schéma · kód · dokumentace");
  $("badgePlat").textContent = tr("{n} platforem", { n: Object.keys(PLAT).length });
  $("stepper").setAttribute("aria-label", tr("Kroky návrhu"));
  $("lang").setAttribute("aria-label", tr("Jazyk rozhraní"));
  $("lang").value = getLang();
  $("btnPrev").textContent = "← " + tr("Zpět");
  $("btnNext").textContent = tr("Pokračovat") + " →";
}

function render() {
  renderStatic();
  const nav = $("stepper");
  nav.innerHTML = STEPS.map((s, i) => "<button class='" + (i === S.step ? "on" : (stepDone(i) ? "done" : "")) + "' data-i='" + i + "'>" + (i + 1) + " · " + tr(s) + "</button>").join("")
    + "<button class='helpbtn" + (S.step === "help" ? " on" : "") + "' data-help>?&nbsp;" + tr("Nápověda") + "</button>";
  nav.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { S.step = b.hasAttribute("data-help") ? "help" : +b.dataset.i; save(); render(); }));
  $("projName").textContent = S.prj.meta.name ? "— " + S.prj.meta.name : "";
  $("projName").title = S.prj.meta.name || "";
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
  r($("view"));
  wizard.render();
  showBadge();
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
if (!load()) {   // první návštěva: předvyplněná ukázka
  S.prj = sampleComplex();
  S.ai = seedFromProject(S.prj, tr(SAMPLE_DESC.complex), tr("Ukázkový návrh složité linky — předvyplněno jako příklad práce AI návrháře."));
}
render();
