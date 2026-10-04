/* Drobné UI utility. */
import { tr, blankProject, CLS, PLAT, isGuid, ensureGuids } from "../../../packages/core/dist/index.js";
import { aiNorm } from "./ai.js";
import { normSafety } from "./safety_view.js";

const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
/**
 * Projekt z načteného JSON (import / localStorage) v bezpečném tvaru: zahodí, co neodpovídá
 * modelu (jinak by rozbitý soubor shodil vykreslení a uložil se). Nejde-li o projekt, vyhodí chybu.
 */
export function normProject(raw) {
  if (!isObj(raw)) throw new Error("not a project");
  const p = blankProject();
  if (isObj(raw.meta)) {
    p.meta = { ...raw.meta, name: String(raw.meta.name ?? ""), desc: String(raw.meta.desc ?? "") };
    if (!(Number.isFinite(raw.meta.takt) && raw.meta.takt > 0)) delete p.meta.takt;
  }
  if (Array.isArray(raw.platforms)) p.platforms = raw.platforms.filter(k => k in PLAT);
  /* styl kódu: jen "oop" se ukládá (výchozí klasický = bez pole) */
  if (raw.codeStyle === "oop") p.codeStyle = "oop";
  if (Array.isArray(raw.devices)) {
    const seen = new Set();
    p.devices = raw.devices.filter(d => isObj(d) && CLS[d.cls] && Number.isFinite(d.id) && !seen.has(d.id) && seen.add(d.id))
      .map(d => {
        const nd = { ...d, name: String(d.name ?? ""), desc: String(d.desc ?? ""), opt: isObj(d.opt) ? d.opt : {} };
        /* polohovací pohon: tabulka záznamů jen v platném tvaru (číslo, název, poloha) */
        if (d.records !== undefined) {
          if (Array.isArray(d.records)) nd.records = d.records.filter(r => isObj(r) && Number.isInteger(r.no))
            .map(r => ({ no: r.no, name: String(r.name ?? ""), ...(Number.isFinite(r.pos) ? { pos: r.pos } : {}) }));
          else delete nd.records;
        }
        return nd;
      });
  }
  const ids = new Set(p.devices.map(d => d.id));
  if (Array.isArray(raw.io)) p.io = raw.io.filter(e => isObj(e) && typeof e.key === "string" && ids.has(e.devId))
    .map(e => ({ ...e, tag: String(e.tag ?? ""), addr: String(e.addr ?? ""), cmt: String(e.cmt ?? "") }));
  if (isObj(raw.program)) {
    const pr = raw.program;
    p.program = {
      ...p.program, ...pr,
      estop: ids.has(pr.estop) ? pr.estop : "",
      interlocks: Array.isArray(pr.interlocks) ? pr.interlocks.filter(id => ids.has(id) && id !== pr.estop) : [],
      seq: Array.isArray(pr.seq) ? pr.seq.filter(s => isObj(s) && typeof s.act === "string" && (s.act === "wait" || ids.has(s.dev)))
        .map(s => ({ ...s, timeS: Number(s.timeS) > 0 ? Number(s.timeS) : 1 })) : [],
    };
  }
  /* volby kusovníku: platforma, výrobce po kategoriích, úpravy řádků (jen texty a čísla) */
  if (isObj(raw.bom)) {
    const b = {};
    if (raw.bom.plat in PLAT) b.plat = raw.bom.plat;
    if (isObj(raw.bom.brand)) {
      const br = Object.fromEntries(Object.entries(raw.bom.brand).filter(([, v]) => typeof v === "string"));
      if (Object.keys(br).length) b.brand = br;
    }
    if (isObj(raw.bom.lines)) {
      const ls = {};
      for (const [id, o] of Object.entries(raw.bom.lines)) {
        if (!isObj(o)) continue;
        const c = {};
        for (const f of ["brand", "type", "orderCode", "supplier", "note"]) if (typeof o[f] === "string") c[f] = o[f];
        if (Number.isFinite(o.qty) && o.qty >= 0) c.qty = o.qty;
        if (Object.keys(c).length) ls[id] = c;
      }
      if (Object.keys(ls).length) b.lines = ls;
    }
    p.bom = b;
  }
  /* schválení položek a výsledky oživení: jen záznamy v platném tvaru (jinak by shodily kroky 11–13) */
  const str = v => typeof v === "string";
  if (isObj(raw.approvals)) {
    const a = {};
    for (const [k, r] of Object.entries(raw.approvals)) {
      if (!isObj(r) || !["approved", "rejected", "proposed"].includes(r.state) || !str(r.by) || !r.by.trim() || !str(r.at) || !str(r.hash)) continue;
      a[k] = { state: r.state, by: r.by, at: r.at, hash: r.hash, ...(str(r.note) && r.note ? { note: r.note } : {}) };
    }
    if (Object.keys(a).length) p.approvals = a;
  }
  if (isObj(raw.commissioning)) {
    const c = {};
    for (const [k, r] of Object.entries(raw.commissioning)) {
      if (!isObj(r) || !["ok", "nok", "na"].includes(r.result) || !str(r.by) || !r.by.trim() || !str(r.at)) continue;
      c[k] = { result: r.result, by: r.by, at: r.at, ...(str(r.note) && r.note ? { note: r.note } : {}), ...(str(r.measured) && r.measured ? { measured: r.measured } : {}) };
    }
    if (Object.keys(c).length) p.commissioning = c;
  }
  /* bezpečnostní data (úpravy návrhu funkcí, parametry výpočtu) */
  const sf = normSafety(raw.safety);
  if (sf) p.safety = sf;
  p.nextId = Math.max(Number.isFinite(raw.nextId) ? raw.nextId : 1, ...p.devices.map(d => d.id + 1));
  /* GUID (export EPLAN páruje podle nich): převzít uložené, chybějící doplnit — nikdy při exportu */
  if (isGuid(raw.guid)) p.guid = raw.guid;
  if (isObj(raw.moduleGuids)) {
    const mg = Object.fromEntries(Object.entries(raw.moduleGuids).filter(([, g]) => isGuid(g)));
    if (Object.keys(mg).length) p.moduleGuids = mg;
  }
  /* migrace: starý projekt bez GUID → doplnit; volající ho podle `guidsAdded` uloží (projekt změněn) */
  const hadGuid = isGuid(raw.guid);
  const added = ensureGuids(p);
  Object.defineProperty(p, "guidsAdded", { value: added || !hadGuid, enumerable: false });
  return p;
}

export const $ = (id) => document.getElementById(id);

/** AI konverzace z úložiště / importu v bezpečném tvaru. */
export function normAi(a) {
  const ok = a && typeof a === "object" && Array.isArray(a.turns);
  return ok ? { turns: a.turns.filter(t => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string"), last: a.last && typeof a.last === "object" && Array.isArray(a.last.devices) ? aiNorm(a.last) : null, draft: String(a.draft || "") }
    : { turns: [], last: null, draft: "" };
}

export function card(el, num, title, inner) {
  const c = document.createElement("section");
  c.className = "card";
  c.innerHTML = '<h2><span class="n">' + num + "</span>" + title + "</h2>" + inner;
  el.appendChild(c);
  return c;
}

export function copyText(txt, btn) {
  const done = () => {
    if (!btn) return;
    const t = btn.textContent;
    btn.textContent = tr("Zkopírováno");
    setTimeout(() => (btn.textContent = t), 1500);
  };
  try { navigator.clipboard.writeText(txt).then(done).catch(() => {}); } catch { /* bez clipboardu */ }
}

const MIME = {
  svg: "image/svg+xml", dxf: "application/dxf", csv: "text/csv;charset=utf-8",
  md: "text/markdown;charset=utf-8", xml: "application/xml", json: "application/json",
};
export function downloadFile(name, body) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const blob = new Blob([body], { type: MIME[ext] || "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
/** Víc souborů po sobě: prohlížeč zahazuje stahování spuštěná v jednom okamžiku (ověřeno: z 28 jich došlo 9). */
export async function downloadFiles(list, btn) {
  if (btn) btn.disabled = true;
  try {
    for (const [i, [name, body]] of list.entries()) {
      if (i) await new Promise(r => setTimeout(r, 250));
      downloadFile(name, body);
    }
  } finally { if (btn) btn.disabled = false; }
}
