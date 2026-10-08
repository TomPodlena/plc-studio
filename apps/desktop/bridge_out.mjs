/* PLCdesk — operace mostu pro výstupy kroku Generovat: HMI (hmi*), emulace kódu (emu.*) a exporty
   SISTEMA / EPLAN (exports). Logika je v jádře; tady se jen skládají odpovědi pro desktop
   (steps/hmi.py, steps/emulace.py, steps/exporty.py) — web má totéž v apps/web/src/*_step.js.

   Emulace je drahá: dokument 15_emulace_prekladu.md se do sady projektu přihlásí
   (registerEmuModule) až po výslovném ověření všech platforem projektu („emu.finish“) a jen
   pro tu podobu projektu; emuGate() ho před sestavením dokumentace odhlásí, když se projekt
   mezitím změnil — běžné překreslení dokumentace emulaci nikdy nespustí. */
import * as core from "../../packages/core/dist/index.js";

let emuKey = null;           // projekt (JSON po syncIO), pro který platí přihlášený dokument 15

/** Odhlásí dokument 15, když neplatí pro projekt `prj` (volá operace files před dokumentací). */
export function emuGate(prj) {
  if (!core.emuModuleRegistered()) return;
  if (!prj || !emuKey) { core.unregisterEmuModule(); emuKey = null; return; }
  core.syncIO(prj);
  if (JSON.stringify(prj) !== emuKey) { core.unregisterEmuModule(); emuKey = null; }
}

/** SVG obrazovky HMI pro plátno desktopu: data-dev nese jméno zařízení → id (odkazy panelu zařízení). */
function screenSvg(prj, s) {
  const ids = new Map(prj.devices.map(d => [core.esc(d.name), d.id]));
  return core.hmiScreenSVG(s).replace(/ data-dev="([^"]*)"/g, (_m, n) => ids.has(n) ? ' data-dev="' + ids.get(n) + '"' : "");
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

export const OUT_OPS = {
  /* HMI: obrazovky (SVG s odkazy na zařízení), tagy, alarmy, specifikace exportů všech platforem. */
  hmi({ prj }) {
    core.syncIO(prj);
    const m = core.buildHmi(prj);
    const specs = {};
    for (const k of Object.keys(core.PLAT)) {
      const s = core.hmiExportSpec(k);
      specs[k] = s ? { product: s.product, files: s.files.map(f => ({ name: f.name, format: core.tr(f.format), status: f.status, statusLabel: core.hmiStatusLabel(f.status), sources: f.sources })) } : null;
    }
    return {
      prj, file: core.HMI_DOC_FILE,
      screens: m.screens.map(s => ({ id: s.id, kind: s.kind, title: s.title, page: s.page, pages: s.pages, svg: screenSvg(prj, s), raw: core.hmiScreenSVG(s) })),
      tags: m.tags.map(t => ({ ...t, paths: Object.fromEntries(Object.keys(core.PLAT).map(k => [k, core.hmiPlcPath(k, t, prj)])) })),
      alarms: m.alarms.map(a => ({ ...a, clsLabel: core.alarmClassLabel(a.cls) })),
      specs, unverified: core.hmiStatusLabel("unverified"),
    };
  },
  /* Soubory exportu HMI pro platformu; Siemens navíc sešit .xlsx (binárně, base64). */
  "hmi.files"({ prj, plat }) {
    core.syncIO(prj);
    const m = core.buildHmi(prj);
    return { files: core.hmiFiles(prj, plat, m), xlsx: plat === "siemens" ? b64(core.hmiSiemensWorkbook(prj, m)) : null, xlsxName: "hmi_siemens.xlsx" };
  },
  /* Samostatné webové HMI (otevře se v prohlížeči). */
  "hmi.web"({ prj }) {
    core.syncIO(prj);
    return { html: core.hmiWebHtml(prj) };
  },

  /* Emulace jedné platformy: překlad (nálezy s polohou a zdrojem) + běh proti návrhu.
     Po platformách, aby desktop mohl ukazovat průběh; cache jádra má klíč po platformách,
     dokument 15 pak výsledek jen přečte. */
  "emu.platform"({ prj, plat }) {
    core.syncIO(prj);
    const scope = prj.program.seq.length <= 40 ? "full" : "quick";   // jako emuDocMd
    const files = core.genFor(prj, plat);
    const compile = core.emulateCompile(prj, plat);
    const run = core.emulateRunMany(prj, [plat], { scope })[plat];
    return { plat, scope, label: core.EMU_DIALECTS[plat].label, compile, run, files };
  },
  /* Popisy pravidel emulátoru (přeložené). */
  "emu.rules"() {
    return Object.fromEntries(Object.entries(core.EMU_RULES).map(([k, v]) => [k, core.tr(v)]));
  },
  /* Konec ověření: dokument 15 jen s výsledkem pro všechny platformy projektu. */
  "emu.finish"({ prj, plats = [] }) {
    core.syncIO(prj);
    const doc = prj.platforms.length > 0 && prj.platforms.every(p => plats.includes(p));
    if (doc) { core.registerEmuModule(); emuKey = JSON.stringify(prj); }
    else { core.unregisterEmuModule(); emuKey = null; }
    return { doc, file: core.EMU_DOC_FILE };
  },
  /* Platí přihlášený dokument 15 pro tento projekt? */
  "emu.state"({ prj }) {
    emuGate(prj);
    return { doc: core.emuModuleRegistered(), file: core.EMU_DOC_FILE };
  },

  /* „Uložit vše do složky projektu“ (plc_studio/datadir.py): celá sada projektu roztříděná do podsložek
     (core projectFolderFiles = licensedProjectFiles) + sešit HMI Siemens (.xlsx, base64). Licence se
     uplatní tady na každý soubor (patička Free / zamčené DXF / nad limitem) — Python jen zapisuje.
     `lic` = volby generátoru (knihovna bloků), `gate` = brána projektu (license.state). */
  datadir({ prj, lic = null, gate = null }) {
    emuGate(prj);
    core.syncIO(prj);
    const apply = (name, body) => gate ? core.applyLicenseToFile(name, body, gate) : { body };
    const files = core.projectFolderFiles(prj, lic).map(f => {
      const r = apply(f.path.split("/").pop(), f.body);
      return r.blocked ? { path: f.path, blocked: r.blocked } : { path: f.path, body: r.body };
    });
    const bins = [];
    if (prj.platforms.includes("siemens") && core.hmiModuleRegistered()) {
      const path = core.PROJECT_DIRS.hmi + "/hmi_siemens.xlsx";
      if (gate && gate.over) bins.push({ path, blocked: gate.reason });
      else bins.push({ path, b64: b64(core.hmiSiemensWorkbook(prj, core.buildHmi(prj))) });
    }
    return { prj, files, bins, project: core.projectFileName(prj), dirs: core.PROJECT_DIRS };
  },

  /* Exporty SISTEMA a EPLAN: soubory, stav ověření, kontrola AML, údaje pro postup. */
  exports({ prj }) {
    core.syncIO(prj);
    const sx = core.sistemaExport(prj);
    const eplan = prj.io.length ? core.eplanFiles(prj) : [];
    const issues = prj.io.length ? core.validateEplan(prj) : [];
    return {
      prj,
      sistema: {
        files: Object.entries(sx.files).filter(([n]) => n !== core.SISTEMA_FILE).map(([name, body]) => ({ name, body, save: name.startsWith("sistema_") ? name : "sistema_" + name })),
        doc: { name: core.SISTEMA_FILE, body: sx.files[core.SISTEMA_FILE] },
        verified: sx.verified, fns: sx.model.fns.length, approved: !!sx.model.approved, ssm: core.sistemaFileName(prj),
      },
      eplan: {
        files: eplan.map(f => ({ name: f.name, body: f.body, save: f.name.startsWith("eplan_") ? f.name : "eplan_" + f.name })),
        verified: core.tr(core.EPLAN_VERIFIED), aml: core.eplanAmlName(prj), conv: core.eplanConverterId(prj), script: core.EPLAN_SCRIPT_NAME,
        errors: issues.filter(i => i.level === "error").length, warnings: issues.filter(i => i.level !== "error").length,
        issues: issues.slice(0, 8).map(i => (i.level === "error" ? "✖ " : "⚠ ") + i.where + ": " + i.msg),
      },
    };
  },
};
