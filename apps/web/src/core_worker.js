/* PLCdesk — výpočetní Worker (module worker) nad týmž jádrem jako aplikace.

   Drahé výpočty (ověření simulací, dokumentace, souhrn schvalování pro odznak, emulace kódu) běží tady,
   ať hlavní vlákno nezamrzne — po vzoru desktopu (bridge.py DualBridge: pracovní proces Node).
   Logiku nekopíruje: volá tytéž funkce packages/core/dist jako hlavní vlákno.

   Protokol (worker_client.js): požadavek { id, op, args, state: { lang, emu } } → odpověď
   { id, ok: true, value } | { id, ok: false, error }. Stav jádra se před každou operací srovná
   s hlavním vláknem: jazyk (setLang), dokument 15 emulace (registerEmuModule jen když je přihlášený
   i v aplikaci — emuGate). Bezpečnostní modul a HMI jsou přihlášené vždy (jako v app.js). Licence
   (gate) přichází v argumentech operace. Výsledky se vrací strukturovaným klonem — obsah je bajtově
   shodný se synchronním výpočtem (test apps/web/tests/worker_parity.html). */
import {
  setLang, getLang, registerSafetyModule, registerHmiModule, registerEmuModule, unregisterEmuModule, emuModuleRegistered,
  syncIO, licensedProjectFiles, verifyDesign, approvalItems, approvalBadgeOf, genFor, emulateCompile, emulateRunMany,
} from "../../../packages/core/dist/index.js";

registerSafetyModule();
registerHmiModule();

function applyState(st) {
  if (!st) return;
  if (st.lang && st.lang !== getLang()) setLang(st.lang);
  if (st.emu && !emuModuleRegistered()) registerEmuModule();
  else if (!st.emu && emuModuleRegistered()) unregisterEmuModule();
}

/** Projekt bez sekvence ověření nemá — výsledek ověření (z cache workeru) se posílá jen, když existuje. */
const verifyOf = prj => (prj.program && prj.program.seq.length ? verifyDesign(prj) : null);

const OPS = {
  ping: () => "pong",
  /** Dokumentace (krok 9): soubory projektu podle licence + ověření simulací pro cache hlavního vlákna. */
  docs({ prj, gate }) {
    syncIO(prj);
    const files = licensedProjectFiles(prj, gate);
    return { files, verify: verifyOf(prj) };
  },
  /** Ověření návrhu simulací (kroky Schválení / Oživení — výsledek převezme cache hlavního vlákna). */
  verify({ prj }) {
    syncIO(prj);
    return { verify: verifyDesign(prj) };
  },
  /** Odznak „Neschváleno: N“ — plný souhrn schvalování (s ověřením simulací), bez limitu velikosti projektu. */
  badge({ prj }) {
    syncIO(prj);
    const key = JSON.stringify(prj);
    const sum = { ...approvalBadgeOf(prj, approvalItems(prj)), key };   // = approval_step.js approvalBadge
    return { sum, verify: verifyOf(prj) };
  },
  /** Emulace jedné platformy (krok Generovat → Emulace): soubory, překlad, běh. Cache emulace zůstává
      ve workeru — dokument 15 ji při generování dokumentace jen přečte. */
  emu({ prj, plat, scope }) {
    syncIO(prj);
    const files = genFor(prj, plat);
    const comp = emulateCompile(prj, plat);
    const run = emulateRunMany(prj, [plat], { scope })[plat];
    return { files, comp, run };
  },
};

self.onmessage = e => {
  const { id, op, args, state } = e.data || {};
  try {
    applyState(state);
    const fn = OPS[op];
    if (!fn) throw new Error("unknown op " + op);
    const t0 = performance.now();
    const value = fn(args || {});
    self.postMessage({ id, ok: true, value, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
self.postMessage({ ready: true });
