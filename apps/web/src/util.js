/* Drobné UI utility. */
import { tr, blankProject, CLS, PLAT } from "../../../packages/core/dist/index.js";
import { aiNorm } from "./ai.js";

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
  if (Array.isArray(raw.devices)) {
    const seen = new Set();
    p.devices = raw.devices.filter(d => isObj(d) && CLS[d.cls] && Number.isFinite(d.id) && !seen.has(d.id) && seen.add(d.id))
      .map(d => ({ ...d, name: String(d.name ?? ""), desc: String(d.desc ?? ""), opt: isObj(d.opt) ? d.opt : {} }));
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
  p.nextId = Math.max(Number.isFinite(raw.nextId) ? raw.nextId : 1, ...p.devices.map(d => d.id + 1));
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
