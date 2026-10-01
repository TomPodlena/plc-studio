/* PLC Studio — aplikační shell: stav, navigace, render. */
import { blankProject, sampleComplex } from "../../../packages/core/dist/index.js";
import { seedFromProject, SAMPLE_DESC } from "./ai.js";
import { makeSteps } from "./steps.js";
import { $ } from "./util.js";

const LS_KEY = "plcstudio.state";
const STEPS = ["Projekt", "AI návrh", "Platformy", "Zařízení", "I/O", "Schéma", "Program", "Generovat", "Dokumentace"];

const S = {
  prj: blankProject(),
  ai: { turns: [], last: null, draft: "" },
  step: 0,
};

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ prj: S.prj, ai: S.ai, step: S.step })); } catch { /* ignore */ }
}
function load() {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) {
      const d = JSON.parse(s);
      S.prj = Object.assign(blankProject(), d.prj || {});
      S.ai = d.ai || { turns: [], last: null, draft: "" };
      S.step = d.step ?? 0;
    }
  } catch { /* ignore */ }
}

function stepDone(i) {
  if (i === 0) return !!S.prj.meta.name;
  if (i === 2) return S.prj.platforms.length > 0;
  if (i === 3) return S.prj.devices.length > 0;
  return false;
}

const steps = makeSteps({ S, save, render });
const RENDERERS = [steps.rProjekt, steps.rAI, steps.rPlat, steps.rDev, steps.rIO, steps.rSchema, steps.rProg, steps.rGen, steps.rDocs];

function render() {
  const nav = $("stepper");
  nav.innerHTML = STEPS.map((s, i) => "<button class='" + (i === S.step ? "on" : (stepDone(i) ? "done" : "")) + "' data-i='" + i + "'>" + (i + 1) + " · " + s + "</button>").join("")
    + "<button class='helpbtn" + (S.step === "help" ? " on" : "") + "' data-help>?&nbsp;Nápověda</button>";
  nav.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { S.step = b.hasAttribute("data-help") ? "help" : +b.dataset.i; save(); render(); }));
  $("projName").textContent = S.prj.meta.name ? "— " + S.prj.meta.name : "";
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

load();
if (!S.prj.devices.length && !S.prj.meta.name) {
  S.prj = sampleComplex();
  S.ai = seedFromProject(S.prj, SAMPLE_DESC.complex, "Ukázkový návrh složité linky — předvyplněno jako příklad práce AI návrháře.");
}
render();
