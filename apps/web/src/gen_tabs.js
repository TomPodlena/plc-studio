/* PLCdesk — krok 8 Generovat se záložkami: Kód (steps.js rGen beze změny), HMI, Emulace kódu,
   SISTEMA a EPLAN. Zvolená záložka se drží mezi překresleními (a v sessionStorage). */
import { tr, N_, escHtml as esc, validateProject, syncIO } from "../../../packages/core/dist/index.js";
import { makeHmiTab } from "./hmi_step.js";
import { makeEmuTab } from "./emu_step.js";
import { makeExportsTab } from "./exports_step.js";

const TABS = [["code", N_("Kód")], ["hmi", N_("HMI")], ["emu", N_("Emulace kódu")], ["exports", N_("SISTEMA a EPLAN")]];
const KEY = "plcstudio.genTab";

export function makeGenTabs(ctx, rGen) {
  const { S, save, render } = ctx;
  /* krok (index) → odkaz z upozornění na chyby návrhu */
  const FIX_STEPS = [[3, N_("Otevřít krok Zařízení")], [4, N_("Otevřít krok I/O")], [6, N_("Otevřít krok Program")]];

  /** Výrazné upozornění nad záložkami, když validace návrhu hlásí chyby; stahování zůstává povolené. */
  function errorBox(el) {
    const p = S.prj;
    if (!p.devices.length) return;
    let errs = [];
    try { syncIO(p); errs = validateProject(p).filter(i => i.level === "error"); } catch (e) { console.warn("validateProject:", e); return; }
    if (!errs.length) return;
    const box = document.createElement("div");
    box.className = "notice err generr"; box.id = "genErrors"; box.setAttribute("role", "alert");
    box.innerHTML = "<b>" + tr("Návrh obsahuje chyby ({n}).", { n: errs.length }) + "</b> " +
      tr("Vygenerovaný kód nemusí jít v IDE přeložit nebo nebude fungovat podle návrhu — oprav je v kroku Zařízení, I/O nebo Program. Stahování zůstává povolené.") +
      "<ul style='margin:6px 0;padding-left:18px'>" + errs.slice(0, 6).map(i => "<li><code>" + esc(i.where) + "</code> — " + esc(i.msg) + "</li>").join("") +
      (errs.length > 6 ? "<li>" + tr("… a dalších {n}", { n: errs.length - 6 }) + "</li>" : "") + "</ul>" +
      "<div class='row' style='margin-top:6px'>" + FIX_STEPS.map(([i, l]) => "<button class='small' data-fix='" + i + "'>" + tr(l) + " →</button>").join("") + "</div>";
    el.appendChild(box);
    box.querySelectorAll("[data-fix]").forEach(b => b.addEventListener("click", () => { S.step = +b.dataset.fix; save(); render(); }));
  }
  const hmi = makeHmiTab(ctx), emu = makeEmuTab(ctx), exp = makeExportsTab(ctx);
  let tab = "code";
  try { const t = sessionStorage.getItem(KEY); if (TABS.some(([k]) => k === t)) tab = t; } catch { /* bez úložiště */ }

  function rGenTabs(el) {
    errorBox(el);
    const bar = document.createElement("div");
    bar.className = "gentabs";
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", tr("Výstupy"));
    bar.innerHTML = TABS.map(([k, l]) => "<button role='tab' data-gt='" + k + "' aria-selected='" + (k === tab) + "'>" + tr(l) + "</button>").join("");
    el.appendChild(bar);
    bar.querySelectorAll("[data-gt]").forEach(b => b.addEventListener("click", () => {
      tab = b.dataset.gt;
      try { sessionStorage.setItem(KEY, tab); } catch { /* bez úložiště */ }
      render();
    }));
    if (tab === "hmi") hmi.render(el);
    else if (tab === "emu") emu.render(el);
    else if (tab === "exports") exp.render(el);
    else rGen(el);
  }
  return { rGenTabs, select: t => { tab = t; } };
}
