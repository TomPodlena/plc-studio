/* PLC Studio — most mezi desktopovou aplikací (Python/tkinter) a jádrem.
   Běží jako trvalý proces: na stdin čte požadavky (jeden JSON na řádek),
   na stdout vrací odpovědi (jeden JSON na řádek). Veškerá logika zůstává
   v packages/core — desktop je jen další UI nad stejným jádrem. */
import { createInterface } from "node:readline";
import * as core from "../../packages/core/dist/index.js";
import * as ai from "../web/src/ai.js";

/* ---------------------------------------------------------------- mini DOM
   Importéry SimaticML a L5X potřebují DOMParser, který v Node není. Stačí jim
   getElementsByTagName / getAttribute / textContent / parentElement, takže
   místo závislosti (linkedom…) je tu malý tolerantní XML parser. */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unent = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1));
  return ENT[e] ?? m;
});

class XNode {
  constructor(tagName, parent) {
    this.tagName = tagName; this.parentElement = parent;
    this.attrs = {}; this.children = []; this.text = "";
  }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(""); }
  getElementsByTagName(n) {
    const out = [];
    const walk = (el) => { for (const c of el.children) { if (n === "*" || c.tagName === n) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}

class MiniDOMParser {
  parseFromString(src) {
    const root = new XNode("#document", null);
    let cur = root;
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(src))) {
      if (m[1] !== undefined) cur.text += m[1];
      else if (m[2] !== undefined) { if (cur.parentElement) cur = cur.parentElement; }
      else if (m[3] !== undefined) {
        const el = new XNode(m[3], cur);
        const ra = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let a;
        while ((a = ra.exec(m[4] || ""))) el.attrs[a[1]] = unent(a[2] ?? a[3] ?? "");
        cur.children.push(el);
        if (!m[5]) cur = el;
      }
      else if (m[6] !== undefined) cur.text += unent(m[6]);
    }
    return root;
  }
}
core.setDOMParser(MiniDOMParser);

/* ---------------------------------------------------------------- živá simulace */
let live = null;      // core.Simulator
let liveSeq = [];     // názvy kroků sekvence

function liveState() {
  const events = live.events.splice(0);           // události od minulého dotazu
  if (live.steps.length > 60) live.steps.splice(0, live.steps.length - 60);
  if (live.errors.length > 60) live.errors.splice(0, live.errors.length - 60);
  const i = live.seqIndex;
  return {
    frame: live.frame(), events,
    stepTitle: i >= 0 ? liveSeq[i] : "", stepCount: liveSeq.length,
    cycles: live.cycles, lastCycleTime: live.lastCycleTime, outputsOn: live.outputsOn(),
  };
}

/* ---------------------------------------------------------------- operace */
const sheetName =(m, i) => String(i + 1).padStart(2, "0") + "_" + m.dir + m.idx + "_X" + (i + 1);

const OPS = {
  /* Konstanty jádra v jazyce `lang` (výchozí čeština) a katalog překladů pro okno.
     Jazyk je stav procesu mostu: platí pro všechny další operace (dokumentace, hlášení
     simulace, diagramy…), dokud ho další `init` nezmění. */
  init({ lang } = {}) {
    const l = core.setLang(lang);
    return {
      LANG: l, LANGS: core.LANGS, I18N: core.catalog(l),
      PLAT: core.platInfo(), CLS: core.clsInfo(), IECPLATS: core.IECPLATS,
      DO_ROLES: Object.fromEntries(Object.entries(core.DO_ROLES).map(([k, v]) => [k, core.tr(v)])),
      SAMPLE_DESC: Object.fromEntries(Object.entries(ai.SAMPLE_DESC).map(([k, v]) => [k, core.tr(v)])),
      AI_EXAMPLE: core.tr(ai.AI_EXAMPLE),
      node: process.version,
    };
  },

  /* Obecné volání funkce jádra. Vrací i argumenty — funkce jako syncIO nebo
     autoAddr projekt mění na místě a volající potřebuje změněný stav. */
  call({ fn, args = [] }) {
    if (typeof core[fn] !== "function") throw new Error(core.tr("Neznámá funkce jádra: {fn}", { fn }));
    const result = core[fn](...args);
    return { result: result === undefined ? null : result, args };
  },

  /* Kusovník: řádky, nabídka katalogu po kategoriích (přeložené texty), dodavatelé, CSV.
     Jedna operace místo volání pro každý řádek. */
  bom({ prj }) {
    const b = core.buildBom(prj);
    const options = {}, sups = new Map();
    for (const l of b.lines) {
      const k = core.catKey(l.cat, b.plat);
      if (!options[k]) {
        options[k] = core.bomOptions(l.cat, b.plat).map(o => ({
          id: o.id, brand: o.brand.brand, series: (o.brand.series || []).map(x => core.tr(x)),
          typical: o.brand.typical ? core.tr(o.brand.typical) : "", orderCode: o.brand.orderCode || "",
          src: o.brand.src || "", suppliers: (o.brand.suppliers || []).map(x => core.tr(x)), note: o.brand.note ? core.tr(o.brand.note) : "",
        }));
      }
      for (const s of core.suppliersFor(k)) sups.set(s.name, { ...s, name: core.tr(s.name), note: s.note ? core.tr(s.note) : "" });
    }
    return { plat: b.plat, lines: b.lines.map(l => ({ ...l, key: core.catKey(l.cat, b.plat) })), options,
      suppliers: [...sups.values()], date: core.CATALOG_DATE, csv: core.bomCsv(prj) };
  },

  /* Odkazy na dokumentaci platforem pro nápovědu (názvy přeložené). */
  refs() {
    return Object.fromEntries(Object.entries(core.PLATFORM_REFS)
      .map(([k, v]) => [k, v.map(r => ({ ...r, title: core.tr(r.title) }))]));
  },

  /* Pomocné funkce AI návrháře (instrukce, normalizace, vytažení JSON). */
  ai({ fn, args = [] }) {
    if (!["aiInstructions", "aiNorm", "extractJson", "seedFromProject"].includes(fn)) throw new Error(core.tr("Neznámá funkce AI: {fn}", { fn }));
    return { result: ai[fn](...args) };
  },

  /* Schémata: moduly a výkresy se musí počítat nad stejnými objekty I/O
     (svgBlock páruje kanály identitou), proto jedna složená operace. */
  schema({ prj }) {
    core.syncIO(prj);
    const mods = core.modules(prj);
    const rows = [];
    mods.forEach((m, mi) => m.ch.forEach((e, i) => {
      const d = core.devById(prj, e.devId) || {};
      rows.push({
        key: e.key, devId: e.devId, sheet: mi,
        svorka: "X" + (mi + 1) + ":" + (i + 1), modul: m.dir + m.idx, kanal: i,
        addr: e.addr, tag: e.tag, cmt: (d.name ? d.name + " · " : "") + (e.cmt || ""),
      });
    }));
    return {
      prj,
      block: mods.length ? core.svgBlock(prj, mods) : "",
      flow: core.svgFlow(prj, prj.program.seq.length ? core.simulate(prj) : null),
      sheets: mods.map((m, i) => ({
        title: core.tr("{mod} — svorkovnice X{n}", { mod: m.dir + m.idx, n: i + 1 }),
        base: sheetName(m, i),
        svg: core.sheetSVG(prj, m, i + 1, i + 1, mods.length),
        dxf: core.sheetDXF(prj, m, i + 1, i + 1, mods.length),
      })),
      rows,
      csv: core.svorkyCSV(prj),
    };
  },

  /* Svorky signálů: klíč I/O → svorka, modul, kanál a index listu zapojení. */
  terminals({ prj }) {
    core.syncIO(prj);
    const map = {};
    core.modules(prj).forEach((m, mi) => m.ch.forEach((e, i) => {
      map[e.key] = { svorka: "X" + (mi + 1) + ":" + (i + 1), modul: m.dir + m.idx, kanal: i, sheet: mi };
    }));
    return { prj, map };
  },

  /* Simulace: seznam scénářů, běh jednoho scénáře (+ diagramy), ověření. */
  scenarios({ prj }) {
    core.syncIO(prj);
    return { prj, scenarios: core.simScenarios(prj) };
  },
  simulate({ prj, opts }) {
    core.syncIO(prj);
    const run = core.simulate(prj, opts || {});
    return { run, flow: core.svgFlow(prj, run), timing: core.svgTiming(prj, run) };
  },
  verify({ prj }) {
    core.syncIO(prj);
    const v = core.verifyProject(prj);
    return { ok: v.ok, checks: v.checks, scenarios: v.scenarios, matrix: v.matrix };
  },

  /* Živá simulace: simulátor žije v tomto procesu, aplikace ho krokuje a posílá
     stav tlačítek. `live.step` vrací aktuální snímek a události od minula. */
  "live.start"({ prj }) {
    core.syncIO(prj);
    live = new core.Simulator(prj);
    liveSeq = prj.program.seq.map(s => core.stepTitle(prj, s));
    /* moduly PLC s kanály — pro grafické schéma (vodiče zařízení ↔ modul) */
    const mods = core.modules(prj).map(m => ({ name: m.dir + m.idx, dir: m.dir, ch: m.ch.map(e => e.key) }));
    return { prj, machine: core.svgMachine(prj), mods, ...liveState() };
  },
  "live.step"({ ms = 0, controls = {}, start = false, ack = false }) {
    if (!live) throw Object.assign(new Error(core.tr("Živá simulace neběží.")), { code: "no_live" });
    const c = live.controls;
    for (const k of ["modeAuto", "estop"]) if (typeof controls[k] === "boolean") c[k] = controls[k];
    for (const k of ["frozen", "fault"]) if (Array.isArray(controls[k])) c[k] = controls[k];
    for (const k of ["di", "man", "ai", "force"]) if (controls[k] && typeof controls[k] === "object") c[k] = controls[k];
    if (start) live.pressStart();
    if (ack) live.pressAck();
    if (ms > 0) live.run(Math.min(ms, 5000) / 1000);
    else live.applyInputs();        // zastavený čas: zásah je vidět hned, program zareaguje scanem
    return liveState();
  },

  gen({ prj }) {
    core.syncIO(prj);
    const out = {};
    for (const pl of prj.platforms) out[pl] = core.genFor(prj, pl);
    return { prj, out };
  },

  files({ prj }) {
    core.syncIO(prj);
    return { prj, files: core.allProjectFiles(prj) };
  },

  /* Import: analýza + rekonstrukce zařízení v jednom kroku (jen náhled). */
  import({ text }) {
    const res = core.detectAndParse(text || "");
    const built = core.buildDevicesFromTags(res.tags);
    return { res, built };
  },
};

/* ---------------------------------------------------------------- smyčka */
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");

rl.on("line", (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { send({ id: null, ok: false, error: core.tr("Neplatný JSON požadavku.") }); return; }
  try {
    const op = OPS[req.op];
    if (!op) throw new Error(core.tr("Neznámá operace: {op}", { op: req.op }));
    send({ id: req.id, ok: true, result: op(req) });
  } catch (e) {
    send({ id: req.id, ok: false, error: String((e && e.message) || e), code: (e && e.code) || "" });
  }
});
rl.on("close", () => process.exit(0));
