/**
 * PLC Studio — reverse engineering: import existujících projektů.
 * Parsery exportů (SimaticML, L5X, GVL/ST, CSV/tab tabulky, prostý I/O list)
 * a rekonstrukce zařízení + I/O z tagů.
 *
 * Pozn.: XML parsery potřebují DOMParser (prohlížeč). V Node je lze použít
 * s polyfillem (např. linkedom) předaným přes setDOMParser().
 */
import { Device, IoEntry, DeviceClass, Dir, CLS, devSignals } from "./model.js";
import { tr } from "./i18n.js";

export interface ImportedTag { tag: string; dt: string; addr: string; cmt: string; dev?: string; cls?: string; _dir?: Dir; }
export interface ParseResult { fmt: string; tags: ImportedTag[]; blocks: string[]; }
export interface BuiltDesign { devices: Device[]; io: IoEntry[]; nextId: number; }

type DomParserCtor = new () => { parseFromString(s: string, t: string): any };
let DP: DomParserCtor | null = (typeof DOMParser !== "undefined") ? DOMParser as unknown as DomParserCtor : null;
export function setDOMParser(ctor: DomParserCtor): void { DP = ctor; }

export function detectAndParse(text: string): ParseResult {
  const t = text.trim();
  if (!t) return { fmt: "", tags: [], blocks: [] };
  if (/<SW\.Tags\.PlcTagTable/i.test(t)) return parseSimaticML(t);
  if (/<RSLogix5000Content|<Controller[\s>]/i.test(t)) return parseL5X(t);
  if (/VAR_GLOBAL/i.test(t) || /FUNCTION_BLOCK|PROGRAM\s+\w+|ORGANIZATION_BLOCK/i.test(t)) return parseSTSource(t);
  if (/^TYPE,SCOPE,NAME/im.test(t) || /^TAG,/im.test(t)) return parseRockwellCSV(t);
  if (/\t.*\t/.test(t.split(/\r?\n/)[0] || "") && /BOOL|Bit|INT|REAL|WORD/i.test(t)) return parseLabelTable(t);
  return parsePlainIO(t);
}

export function normAddr(a: string): string {
  if (!a) return "";
  a = a.trim().toUpperCase();
  let m = a.match(/^%([IQ])X?(\d+)\.(\d+)$/); if (m) return "%" + m[1] + m[2] + "." + m[3];
  m = a.match(/^%([IQ])[WD](\d+)/); if (m) return "%" + m[1] + "W" + m[2];
  m = a.match(/^X([0-9A-F]+)$/); if (m) { const i = parseInt(m[1], 16); return "%I" + (i >> 3) + "." + (i & 7); }
  m = a.match(/^Y([0-9A-F]+)$/); if (m) { const i = parseInt(m[1], 16); return "%Q" + (i >> 3) + "." + (i & 7); }
  return "";
}

export function guessDir(name: string, dt: string, addr: string): Dir {
  if (/^%I\d+\.\d+$/.test(addr)) return "DI";
  if (/^%Q\d+\.\d+$/.test(addr)) return "DO";
  if (/^%IW/.test(addr)) return "AI";
  if (/^%QW/.test(addr)) return "AO";
  if (/INT|REAL|WORD|DINT/i.test(dt || "")) return /out|set|sp|cmd/i.test(name) ? "AO" : "AI";
  return /out|cmd|povel|run$|open$|lamp|valve|^Y|^H/i.test(name) ? "DO" : "DI";
}

/* ------------------------------------------------ sdílené nástroje (i pro reverse.ts) */

/** Uzel minimálního XML stromu (bez DOMParseru — jádro běží i v Node bez závislostí). */
export interface XmlNode { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string; pos: number; }

const XML_ENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
export function xmlDecode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (XML_ENT[e] ?? m));
}

/**
 * Tolerantní XML parser: elementy, atributy, text a CDATA (text = přímý obsah uzlu).
 * Neuzavřené / přebývající značky nevadí. Vrací umělý kořen `#document`.
 */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "", pos: 0 };
  const stack: XmlNode[] = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w.:-]+)\s*>|<([\w.:-]+)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      const i = stack.map(n => n.name).lastIndexOf(m[2]);
      if (i > 0) stack.length = i;
    } else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] || "").matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = xmlDecode(a[2] ?? a[3] ?? "");
      const n: XmlNode = { name: m[3], attrs, children: [], text: "", pos: m.index };
      top.children.push(n);
      if (m[5] !== "/") stack.push(n);
    } else if (m[6] !== undefined) top.text += xmlDecode(m[6]);
  }
  return root;
}
/** Všichni potomci se jménem `name` (bez ohledu na předponu jmenného prostoru). */
export function xmlAll(n: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of n.children) {
    if (c.name === name || c.name.endsWith(":" + name)) out.push(c);
    xmlAll(c, name, out);
  }
  return out;
}
/** První přímý potomek se jménem `name`. */
export function xmlChild(n: XmlNode | undefined, name: string): XmlNode | undefined {
  return n ? n.children.find(c => c.name === name || c.name.endsWith(":" + name)) : undefined;
}
/** Text uzlu včetně potomků. */
export function xmlText(n: XmlNode | undefined): string {
  if (!n) return "";
  return n.text + n.children.map(xmlText).join("");
}

/** Rozdělí řádek CSV/TSV (uvozovky, zdvojené uvozovky uvnitř). */
export function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"' && !cur.trim()) { q = true; cur = ""; }
    else if (ch === delim) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
/** Nejpravděpodobnější oddělovač tabulky (tabulátor, středník, čárka). */
export function guessDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 30);
  const score = (d: string) => lines.reduce((s, l) => s + (splitDelimited(l, d).length > 1 ? 1 : 0), 0);
  const cand = ["\t", ";", ","].map(d => ({ d, s: score(d) }));
  cand.sort((a, b) => b.s - a.s);
  return cand[0].s ? cand[0].d : ",";
}

/**
 * Adresa I/O v notaci platformy → kanonická adresa v Siemens notaci (inverze `addrFor`).
 * Siemens %I/%Q/%IW (i německé %E/%A, bez %, PIW), CODESYS %IX/%QX a %IW = index slova,
 * Mitsubishi X/Y (osmičkově jako FX5, hexadecimálně, když jsou v čísle číslice 8–F).
 * Nepřevoditelné (symbolické, %I*, Rockwell Local:…) = "".
 */
export function canonAddr(raw: string, plat?: string): string {
  if (!raw) return "";
  const a = raw.trim().toUpperCase().replace(/\s+/g, "");
  let m: RegExpMatchArray | null;
  const iec = plat === "codesys" || plat === "beckhoff" || plat === "schneider";
  if ((m = a.match(/^%([IQEA])X(\d+)\.([0-7])$/))) return "%" + (m[1] === "E" ? "I" : m[1] === "A" ? "Q" : m[1]) + m[2] + "." + m[3];
  if ((m = a.match(/^%?([IQEA])(\d+)\.([0-7])$/))) return "%" + (m[1] === "E" || m[1] === "I" ? "I" : "Q") + m[2] + "." + m[3];
  if ((m = a.match(/^%([IQ])W(\d+)$/))) return "%" + m[1] + "W" + (iec ? +m[2] * 2 : +m[2]);
  if ((m = a.match(/^%?P?([IQEA])W(\d+)(?::P)?$/))) return "%" + (m[1] === "E" || m[1] === "I" ? "I" : "Q") + "W" + m[2];
  if ((m = a.match(/^([XY])([0-9A-F]+)$/))) {
    const hex = /[89A-F]/.test(m[2]);
    const i = parseInt(m[2], hex ? 16 : 8);
    return (m[1] === "X" ? "%I" : "%Q") + (i >> 3) + "." + (i & 7);
  }
  return "";
}
/** Je to adresa vnitřní paměti / DB (ne fyzické I/O)? */
export function isMemAddr(raw: string): boolean {
  return /^%?(M|MW|MD|MB|DB|D|L|T|C)\d/i.test((raw || "").trim()) && !/^%?[XY]/i.test(raw.trim());
}

export function parseSimaticML(t: string): ParseResult {
  const tags: ImportedTag[] = [];
  if (!DP) {                                        // Node bez DOMParseru: vlastní parser
    for (const el of xmlAll(parseXml(t), "SW.Tags.PlcTag")) {
      const al = xmlChild(el, "AttributeList");
      const get = (n: string) => xmlText(xmlChild(al, n)).trim();
      const name = get("Name");
      const cmt = xmlText(xmlAll(el, "Text")[0]).trim();
      if (name) tags.push({ tag: name, dt: get("DataTypeName"), addr: normAddr(get("LogicalAddress")), cmt });
    }
  }
  if (DP) try {
    const doc = new DP().parseFromString(t, "text/xml");
    const els = doc.getElementsByTagName("SW.Tags.PlcTag");
    for (const el of Array.from(els) as any[]) {
      const get = (n: string): string => {
        for (const c of Array.from(el.getElementsByTagName(n)) as any[]) {
          if (c.parentElement && c.parentElement.tagName === "AttributeList") return String(c.textContent || "").trim();
        }
        return "";
      };
      const name = get("Name"), dt = get("DataTypeName"), la = get("LogicalAddress");
      let cmt = "";
      const mt = el.getElementsByTagName("Text");
      if (mt.length) cmt = String(mt[0].textContent || "").trim();
      if (name) tags.push({ tag: name, dt, addr: normAddr(la), cmt });
    }
  } catch { /* vadné XML — vrátíme prázdno */ }
  return { fmt: tr("Siemens SimaticML (tabulka tagů)"), tags, blocks: [] };
}

export function parseL5X(t: string): ParseResult {
  const tags: ImportedTag[] = [], blocks: string[] = [];
  if (!DP) {                                        // Node bez DOMParseru: vlastní parser
    const doc = parseXml(t);
    for (const el of xmlAll(doc, "Tag")) {
      const name = el.attrs.Name || "", dt = el.attrs.DataType || "";
      if (!name || !/^(BOOL|INT|DINT|SINT|REAL)$/i.test(dt)) continue;
      tags.push({ tag: name, dt, addr: "", cmt: xmlText(xmlChild(el, "Description")).trim() });
    }
    for (const el of xmlAll(doc, "AddOnInstructionDefinition")) blocks.push("AOI " + (el.attrs.Name || ""));
    for (const el of xmlAll(doc, "Routine")) blocks.push("Routine " + (el.attrs.Name || ""));
  }
  if (DP) try {
    const doc = new DP().parseFromString(t, "text/xml");
    for (const el of Array.from(doc.getElementsByTagName("Tag")) as any[]) {
      const name = el.getAttribute("Name") || "", dt = el.getAttribute("DataType") || "";
      if (!name || !/^(BOOL|INT|DINT|SINT|REAL)$/i.test(dt)) continue;
      let cmt = "";
      const d = el.getElementsByTagName("Description");
      if (d.length) cmt = String(d[0].textContent || "").trim();
      tags.push({ tag: name, dt, addr: "", cmt });
    }
    for (const el of Array.from(doc.getElementsByTagName("AddOnInstructionDefinition")) as any[]) blocks.push("AOI " + (el.getAttribute("Name") || ""));
    for (const el of Array.from(doc.getElementsByTagName("Routine")) as any[]) blocks.push("Routine " + (el.getAttribute("Name") || ""));
  } catch { /* ignore */ }
  return { fmt: "Rockwell L5X", tags, blocks };
}

export function parseSTSource(t: string): ParseResult {
  const tags: ImportedTag[] = [], blocks: string[] = [];
  let m: RegExpExecArray | null;
  const reB = /(FUNCTION_BLOCK|PROGRAM|FUNCTION|ORGANIZATION_BLOCK|DATA_BLOCK)\s+"?([A-Za-z_]\w*)"?/g;
  while ((m = reB.exec(t))) blocks.push(m[1] + " " + m[2]);
  const reG = /VAR_GLOBAL[\s\S]*?END_VAR/gi;
  let g: RegExpExecArray | null;
  while ((g = reG.exec(t))) {
    for (const line of g[0].split(/\r?\n/)) {
      const lm = line.match(/^\s*([A-Za-z_]\w*)\s*(?:AT\s*(%[\w.]+))?\s*:\s*([A-Za-z_]\w*)\s*(?::=[^;]*)?;\s*(?:\(\*\s*(.*?)\s*\*\)|\/\/\s*(.*))?/);
      if (lm && !/^VAR|^END/i.test(lm[1])) tags.push({ tag: lm[1], dt: lm[3], addr: normAddr(lm[2] || ""), cmt: (lm[4] || lm[5] || "").trim() });
    }
  }
  return { fmt: tags.length ? tr("ST / SCL zdroj + VAR_GLOBAL") : tr("ST / SCL zdroj"), tags, blocks };
}

export function parseRockwellCSV(t: string): ParseResult {
  const tags: ImportedTag[] = [];
  for (const line of t.split(/\r?\n/)) {
    const c = line.split(",");
    if ((c[0] || "").trim().toUpperCase() !== "TAG") continue;
    const unq = (s: string) => s.replace(/^"|"$/g, "").trim();
    const name = unq(c[2] || ""), cmt = unq(c[3] || ""), dt = unq(c[4] || "");
    if (name) tags.push({ tag: name, dt, addr: "", cmt });
  }
  return { fmt: tr("Rockwell CSV export tagů"), tags, blocks: [] };
}

export function parseLabelTable(t: string): ParseResult {
  const tags: ImportedTag[] = [];
  for (const line of t.split(/\r?\n/).filter(Boolean)) {
    const c = line.split("\t").map(x => x.replace(/^"|"$/g, "").trim());
    if (!c[0] || /^(label name|name|název)/i.test(c[0])) continue;
    const dt = (c[1] || "").replace(/^Bit$/i, "BOOL").replace(/^Word.*$/i, "INT");
    const at = c.find(x => /^[XY][0-9A-F]+$|^%[IQ]/.test(x)) || "";
    const cmt = c.slice(2).find(x => !!x && !/^[XY][0-9A-F]+$|^%|^VAR|^FALSE|^TRUE|^Retain/i.test(x)) || "";
    tags.push({ tag: c[0], dt, addr: normAddr(at), cmt });
  }
  return { fmt: tr("Tabulka proměnných (Mitsubishi / OMRON)"), tags, blocks: [] };
}

export function parsePlainIO(t: string): ParseResult {
  const tags: ImportedTag[] = [];
  for (const line of t.split(/\r?\n/)) {
    const l = line.trim(); if (!l) continue;
    const delim = l.includes("\t") ? "\t" : (l.includes(";") ? ";" : ",");
    const c = l.split(delim).map(x => x.trim());
    if (/^tag/i.test(c[0]) || /adres/i.test(c[1] || "")) continue;
    if (c.length < 2 || !/^%[IQ]/i.test(c[1] || "")) continue;
    tags.push({ tag: c[0], dt: "", addr: normAddr(c[1]), cmt: c[4] || c[2] || "", dev: c[2] || "", cls: c[3] || "" });
  }
  return { fmt: tr("Prostý I/O list (Tag;Adresa;Zařízení;Třída;Komentář)"), tags, blocks: [] };
}

/** Seskupí importované tagy do zařízení a namapuje role signálů. */
export function buildDevicesFromTags(tags: ImportedTag[]): BuiltDesign {
  const groups: Record<string, ImportedTag[]> = {};
  for (const tg of tags) {
    const dev = tg.dev || (tg.tag.includes("_") ? tg.tag.split("_")[0] : tg.tag);
    (groups[dev] = groups[dev] || []).push(tg);
  }
  const devices: Device[] = [], io: IoEntry[] = [];
  let id = 1;
  for (const [name, list] of Object.entries(groups)) {
    for (const tg of list) tg._dir = guessDir(tg.tag, tg.dt, tg.addr);
    let cls: DeviceClass | "" = (list[0].cls && (list[0].cls as DeviceClass) in CLS) ? list[0].cls as DeviceClass : "";
    if (!cls) {
      if (list.some(t => t._dir === "AI")) cls = "AnalogIn";
      else if (list.some(t => t._dir === "AO")) cls = "AnalogOut";
      else if (/^M\d*$/i.test(name) && list.some(t => t._dir === "DO")) cls = "Motor";
      else if (/^[YV]\d*$/i.test(name) && list.some(t => t._dir === "DO")) cls = "Ventil";
      else if (list.some(t => t._dir === "DO") && list.some(t => t._dir === "DI" && /open|otv|clos|zav/i.test(t.tag))) cls = "Ventil";
      else if (list.some(t => t._dir === "DO") && list.some(t => t._dir === "DI")) cls = "Motor";
      else cls = list.every(t => t._dir === "DO") ? "DO" : "DI";
    }
    const desc = (list.find(t => t.cmt) || { cmt: "" }).cmt || "";
    const d: Device = {
      id, name, cls, desc: desc.split("–")[0].split("-")[0].trim(),
      opt: {}, unit: "", rmin: 0, rmax: 100,
    };
    if (cls === "Motor") {
      d.opt.fbk = list.some(t => t._dir === "DI" && /run|chod|fbk/i.test(t.tag));
      d.opt.fault = list.some(t => /fault|flt|por|err/i.test(t.tag));
    }
    if (cls === "Ventil") {
      d.opt.fbkOpen = list.some(t => /open|otv/i.test(t.tag) && t._dir === "DI");
      d.opt.fbkClosed = list.some(t => /clos|zav/i.test(t.tag) && t._dir === "DI");
    }
    devices.push(d);
    for (const [sig, dir] of devSignals(d).map(x => [x[0], x[1]] as const)) {
      let src: ImportedTag | undefined;
      if (sig === "fbkRunning") src = list.find(t => t._dir === "DI" && /run|chod|fbk/i.test(t.tag));
      else if (sig === "fault") src = list.find(t => /fault|flt|por|err/i.test(t.tag));
      else if (sig === "outRun" || sig === "outOpen" || sig === "out") src = list.find(t => t._dir === "DO");
      else if (sig === "fbkOpen") src = list.find(t => t._dir === "DI" && /open|otv/i.test(t.tag));
      else if (sig === "fbkClosed") src = list.find(t => t._dir === "DI" && /clos|zav/i.test(t.tag));
      else if (sig === "raw") src = list.find(t => t._dir === "AI" || t._dir === "AO");
      else if (sig === "in") src = list.find(t => t._dir === "DI");
      io.push({
        key: id + ":" + sig, devId: id, sig, dir,
        tag: src ? src.tag : name + "_" + sig,
        addr: src ? src.addr : "",
        cmt: src ? src.cmt : "",
        nc: dir === "DI" && !!src && /\bNC\b/i.test(src.cmt || ""),
      });
    }
    id++;
  }
  return { devices, io, nextId: id };
}
