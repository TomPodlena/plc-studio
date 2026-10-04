/* PLCdesk — krok 8 Generovat se záložkami: Kód (steps.js rGen beze změny), HMI, Emulace kódu,
   SISTEMA a EPLAN. Zvolená záložka se drží mezi překresleními (a v sessionStorage). */
import { tr, N_ } from "../../../packages/core/dist/index.js";
import { makeHmiTab } from "./hmi_step.js";
import { makeEmuTab } from "./emu_step.js";
import { makeExportsTab } from "./exports_step.js";

const TABS = [["code", N_("Kód")], ["hmi", N_("HMI")], ["emu", N_("Emulace kódu")], ["exports", N_("SISTEMA a EPLAN")]];
const KEY = "plcstudio.genTab";

export function makeGenTabs(ctx, rGen) {
  const { render } = ctx;
  const hmi = makeHmiTab(ctx), emu = makeEmuTab(ctx), exp = makeExportsTab(ctx);
  let tab = "code";
  try { const t = sessionStorage.getItem(KEY); if (TABS.some(([k]) => k === t)) tab = t; } catch { /* bez úložiště */ }

  function rGenTabs(el) {
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
