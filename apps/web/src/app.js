/* PLC Studio — aplikační shell: stav, navigace, render, jazyk. */
import { blankProject, sampleComplex, PLAT, LANGS, tr, N_, setLang, getLang } from "../../../packages/core/dist/index.js";
import { seedFromProject, SAMPLE_DESC } from "./ai.js";
import { makeSteps } from "./steps.js";
import { $, normProject, normAi } from "./util.js";

const LS_KEY = "plcstudio.state";
const LANG_KEY = "plcstudio.lang";
/* Názvy kroků jsou konstanta modulu → jen označené N_(), překlad až při vykreslení. */
const STEPS = [N_("Projekt"), N_("AI návrh"), N_("Platformy"), N_("Zařízení"), N_("I/O"), N_("Schéma"), N_("Program"), N_("Generovat"), N_("Dokumentace"), N_("Kusovník")];

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

const steps = makeSteps({ S, save, render });
const RENDERERS = [steps.rProjekt, steps.rAI, steps.rPlat, steps.rDev, steps.rIO, steps.rSchema, steps.rProg, steps.rGen, steps.rDocs, steps.rBom];

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
  r($("view"));
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
