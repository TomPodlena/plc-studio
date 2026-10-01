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

/* ---------------------------------------------------------------- operace */
const sheetName = (m, i) => String(i + 1).padStart(2, "0") + "_" + m.dir + m.idx + "_X" + (i + 1);

const OPS = {
  init() {
    return {
      PLAT: core.PLAT, CLS: core.CLS, IECPLATS: core.IECPLATS,
      SAMPLE_DESC: ai.SAMPLE_DESC, AI_EXAMPLE: ai.AI_EXAMPLE,
      node: process.version,
    };
  },

  /* Obecné volání funkce jádra. Vrací i argumenty — funkce jako syncIO nebo
     autoAddr projekt mění na místě a volající potřebuje změněný stav. */
  call({ fn, args = [] }) {
    if (typeof core[fn] !== "function") throw new Error("Neznámá funkce jádra: " + fn);
    const result = core[fn](...args);
    return { result: result === undefined ? null : result, args };
  },

  /* Pomocné funkce AI návrháře (instrukce, normalizace, vytažení JSON). */
  ai({ fn, args = [] }) {
    if (!["aiInstructions", "aiNorm", "extractJson", "seedFromProject"].includes(fn)) throw new Error("Neznámá funkce AI: " + fn);
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
        svorka: "X" + (mi + 1) + ":" + (i + 1), modul: m.dir + m.idx, kanal: i,
        addr: e.addr, tag: e.tag, cmt: (d.name ? d.name + " · " : "") + (e.cmt || ""),
      });
    }));
    return {
      prj,
      block: mods.length ? core.svgBlock(prj, mods) : "",
      sheets: mods.map((m, i) => ({
        title: m.dir + m.idx + " — svorkovnice X" + (i + 1),
        base: sheetName(m, i),
        svg: core.sheetSVG(prj, m, i + 1, i + 1, mods.length),
        dxf: core.sheetDXF(prj, m, i + 1, i + 1, mods.length),
      })),
      rows,
      csv: core.svorkyCSV(prj),
    };
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
  try { req = JSON.parse(line); } catch { send({ id: null, ok: false, error: "Neplatný JSON požadavku." }); return; }
  try {
    const op = OPS[req.op];
    if (!op) throw new Error("Neznámá operace: " + req.op);
    send({ id: req.id, ok: true, result: op(req) });
  } catch (e) {
    send({ id: req.id, ok: false, error: String((e && e.message) || e), code: (e && e.code) || "" });
  }
});
rl.on("close", () => process.exit(0));
