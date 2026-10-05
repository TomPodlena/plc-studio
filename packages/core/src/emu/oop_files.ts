/**
 * PLCdesk — emulátor: kontrola souborů stylu OOP, které se importují místo ST výpisu.
 *
 * TwinCAT (.TcPOU / .TcIO / .TcGVL) a PLCopen XML s rozšířením CODESYS (addData: method,
 * property, interface, pouinheritance, interfaceasplaintext) se rozeberou zpět na deklarace
 * a těla objektů, z nich se sestaví výpis (`oopListing`, stejný zápis jako generátor) a ten se
 * porovná s ST výpisem, který emulátor překládá a spouští. Shoda = importovaný kód je TENTÝŽ
 * program, jaký emulátor ověřil. U PLCopen se navíc porovnají proměnné strukturované části
 * (`<interface>`, kterou čte import CODESYS) s textovou deklarací.
 *
 * Kontrola sama import v IDE nenahrazuje. Tvar PLCopen XML je ověřen skutečným importem a překladem
 * v CODESYS V3.5 SP21 Patch 6 (2026-10-05); TwinCAT (TcPOU i PLCopen) importem ověřen není.
 */
import type { PlatformKey } from "../model.js";
import type { EmuFinding } from "./types.js";
import { oopListing, type OopListingObj } from "../codegen_oop.js";
import { tr } from "../i18n.js";

const unCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
const unEsc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const norm = (s: string) => s.replace(/\r/g, "").split("\n").map(l => l.trimEnd()).join("\n").trim();

/** Objekty ST výpisu (INTERFACE / FUNCTION_BLOCK / PROGRAM … END_*) podle jména. */
export function stObjects(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^(INTERFACE|FUNCTION_BLOCK|PROGRAM)\b[^\n]*$[\s\S]*?^END_\1\b/gm)) {
    const head = m[0].split("\n")[0].replace(/\b(EXTENDS|IMPLEMENTS)\b.*$/, "").trim().split(/\s+/);
    out.set(head[head.length - 1].toUpperCase(), m[0]);
  }
  return out;
}

/* ------------------------------------------------------------------ TwinCAT */

function tag(x: string, name: string): string | undefined {
  const m = new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">").exec(x);
  return m ? m[1] : undefined;
}
/** Objekt z .TcPOU / .TcIO (Declaration, Implementation, Method, Property/Get). */
export function tcObject(xml: string): { name: string; obj: OopListingObj } | undefined {
  const root = /<(POU|Itf)\s[^>]*Name="([^"]+)"[^>]*>([\s\S]*)<\/\1>/.exec(xml);
  if (!root) return undefined;
  const itf = root[1] === "Itf";
  let inner = root[3];
  const methods: OopListingObj["methods"] = [], props: OopListingObj["props"] = [];
  inner = inner.replace(/<Method\s[^>]*>([\s\S]*?)<\/Method>/g, (_a, m: string) => {
    methods.push({ decl: unCdata(tag(m, "Declaration") || ""), body: unCdata(tag(tag(m, "Implementation") || "", "ST") || "") });
    return "";
  });
  inner = inner.replace(/<Property\s[^>]*>([\s\S]*?)<\/Property>/g, (_a, p: string) => {
    const get = /<Get\s[^>]*>([\s\S]*?)<\/Get>/.exec(p);
    props.push({ decl: unCdata(tag(p.replace(/<Get\s[\s\S]*<\/Get>/, ""), "Declaration") || ""), get: get ? unCdata(tag(tag(get[1], "Implementation") || "", "ST") || "") : "" });
    return "";
  });
  const decl = unCdata(tag(inner, "Declaration") || "");
  const kind: OopListingObj["kind"] = itf ? "interface" : /^\s*PROGRAM\b/.test(decl) ? "program" : "fb";
  return { name: root[2], obj: { kind, decl, body: itf ? "" : unCdata(tag(tag(inner, "Implementation") || "", "ST") || ""), methods, props } };
}

/* ------------------------------------------------------------------ PLCopen XML */

/*
 * Textová deklarace se čte JEN z míst, odkud ji čte import CODESYS V3.5 SP21 Patch 6 (ověřeno 2026-10-05):
 * POU = `<data …/interfaceasplaintext>` v addData POU za `</body>`; Method / Property / Interface =
 * `<InterfaceAsPlainText>` jako přímý potomek elementu. Jinde ji CODESYS ignoruje — emulátor ji pak
 * nenajde a porovnání se ST výpisem nesouhlasí (stejně jako by se lišila deklarace v IDE).
 */
const PLAIN = /<data name="http:\/\/www\.3s-software\.com\/plcopenxml\/interfaceasplaintext"[^>]*>\s*<InterfaceAsPlainText>\s*<xhtml[^>]*>([\s\S]*?)<\/xhtml>\s*<\/InterfaceAsPlainText>\s*<\/data>/;
const ELEM_PLAIN = /<InterfaceAsPlainText>\s*<xhtml[^>]*>([\s\S]*?)<\/xhtml>\s*<\/InterfaceAsPlainText>/;
const xbody = (s: string) => { const m = /<ST>\s*<xhtml[^>]*>([\s\S]*?)<\/xhtml>\s*<\/ST>/.exec(s); return m ? unEsc(m[1]) : ""; };
/** POU: data v addData za </body> (bez metod a vlastností). */
const pouPlainOf = (tail: string) => {
  const own = tail.replace(/<data name="[^"]*\/plcopenxml\/(method|property)"[^>]*>[\s\S]*?<\/(Method|Property)>\s*<\/data>/g, "");
  const m = PLAIN.exec(own); return m ? unEsc(m[1]) : undefined;
};
/** Method / Property / Interface: přímý potomek (ne v addData, ne v GET / SET). */
const elemPlainOf = (inner: string) => {
  const own = inner.replace(/<(GetAccessor|SetAccessor)>[\s\S]*?<\/\1>/g, "").replace(/<addData>[\s\S]*?<\/addData>/g, "");
  const m = ELEM_PLAIN.exec(own); return m ? unEsc(m[1]) : undefined;
};
/** Jména proměnných strukturované části `<interface>` (bez addData). */
const ifaceVars = (s: string) => {
  const m = /<interface>([\s\S]*?)<\/interface>/.exec(s);
  return m ? [...m[1].replace(/<addData>[\s\S]*?<\/addData>/g, "").matchAll(/<variable name="([^"]+)"/g)].map(x => x[1]) : [];
};
/** Jména proměnných z textové deklarace (řádky `jméno : typ`). */
const declVars = (decl: string) => [...decl.replace(/\(\*[\s\S]*?\*\)/g, "").matchAll(/^\s*(\w+)\s*:\s*[^;]+;/gm)].map(x => x[1]);

export function plcopenObjects(xml: string): Array<{ name: string; obj: OopListingObj; varsXml: string[]; methodsVars: Array<{ name: string; xml: string[]; decl: string[] }> }> {
  const out: ReturnType<typeof plcopenObjects> = [];
  for (const m of xml.matchAll(/<pou name="([^"]+)" pouType="(\w+)">([\s\S]*?)<\/pou>/g)) {
    const body = m[3];
    const ifaceEnd = body.indexOf("</interface>");
    const iface = body.slice(0, ifaceEnd + 12), rest = body.slice(ifaceEnd + 12);
    const tail = rest.slice(rest.indexOf("</body>"));
    const methods: OopListingObj["methods"] = [], props: OopListingObj["props"] = [], methodsVars: Array<{ name: string; xml: string[]; decl: string[] }> = [];
    for (const mm of tail.matchAll(/<Method name="([^"]+)"[^>]*>([\s\S]*?)<\/Method>/g)) {
      const decl = elemPlainOf(mm[2]) || "";
      methods.push({ decl, body: xbody(mm[2]) });
      methodsVars.push({ name: mm[1], xml: ifaceVars(mm[2]), decl: declVars(decl) });
    }
    for (const pm of tail.matchAll(/<Property name="([^"]+)"[^>]*>([\s\S]*?)<\/Property>/g)) {
      const ga = /<GetAccessor>([\s\S]*?)<\/GetAccessor>/.exec(pm[2]);
      props.push({ decl: elemPlainOf(pm[2]) || "", get: ga ? xbody(ga[1]) : "" });
    }
    out.push({ name: m[1], varsXml: ifaceVars(iface), methodsVars,
      obj: { kind: m[2] === "program" ? "program" : "fb", decl: pouPlainOf(tail) || "", body: xbody(rest.slice(0, rest.indexOf("</body>") + 7)), methods, props } });
  }
  for (const m of xml.matchAll(/<Interface name="([^"]+)"[^>]*>([\s\S]*?)<\/Interface>/g)) {
    const b = m[2];
    const methods = [...b.matchAll(/<Method name="[^"]+"[^>]*>([\s\S]*?)<\/Method>/g)].map(x => ({ decl: elemPlainOf(x[1]) || "", body: "" }));
    const props = [...b.matchAll(/<Property name="[^"]+"[^>]*>([\s\S]*?)<\/Property>/g)].map(x => ({ decl: elemPlainOf(x[1]) || "", get: "" }));
    const own = b.replace(/<Methods>[\s\S]*?<\/Methods>/, "").replace(/<Properties>[\s\S]*?<\/Properties>/, "");
    out.push({ name: m[1], varsXml: [], methodsVars: [], obj: { kind: "interface", decl: elemPlainOf(own) || "", body: "", methods, props } });
  }
  return out;
}

/* ------------------------------------------------------------------ kontrola */

/**
 * Porovná objekty souborů pro import (TcPOU / PLCopen XML) s ST výpisem. `stFiles` = jméno →
 * text ST souborů (Gen_Library.st, FB_Sequence.st, MAIN.st).
 */
export function checkOopFiles(files: Record<string, string>, plat: PlatformKey, out: EmuFinding[]): void {
  const st = new Map<string, { text: string; file: string }>();
  for (const [n, t] of Object.entries(files)) if (/\.st$/i.test(n) && n !== "GVL_IO.st") for (const [k, v] of stObjects(t)) st.set(k, { text: v, file: n });
  const err = (file: string, msg: string) => out.push({ level: "error", rule: "xml", file, line: 0, col: 0, platform: plat, msg });
  const compare = (file: string, name: string, obj: OopListingObj) => {
    const s = st.get(name.toUpperCase());
    if (!s) { err(file, tr("Objekt {name} ze souboru {file} chybí v ST výpisu", { name, file })); return; }
    if (norm(oopListing(obj)) !== norm(s.text)) err(file, tr("Objekt {name} v souboru {file} se liší od ST výpisu {st} (importoval by se jiný kód, než jaký emulátor ověřil)", { name, file, st: s.file }));
  };
  const seen = new Set<string>();
  for (const [n, t] of Object.entries(files)) {
    if (!/\.(TcPOU|TcIO)$/i.test(n)) continue;
    const o = tcObject(t);
    if (!o) { err(n, tr("Soubor {file} nemá kořen POU / Itf", { file: n })); continue; }
    if (!/<TcPlcObject Version="1\.1\.0\.1"/.test(t)) err(n, tr("Soubor {file}: chybí kořen TcPlcObject Version=\"1.1.0.1\"", { file: n }));
    const ids = [...t.matchAll(/\sId="\{([0-9a-f-]{36})\}"/gi)].map(x => x[1].toLowerCase());
    if (new Set(ids).size !== ids.length) err(n, tr("Soubor {file}: Id objektů nejsou jedinečná", { file: n }));
    seen.add(o.name.toUpperCase());
    compare(n, o.name, o.obj);
  }
  if (seen.size) for (const k of st.keys()) if (!seen.has(k)) err("*.TcPOU", tr("Objekt {name} z ST výpisu nemá soubor TwinCAT (.TcPOU / .TcIO)", { name: k }));
  const g = files["GVL_IO.TcGVL"];
  if (g !== undefined && files["GVL_IO.st"] !== undefined && norm(unCdata(tag(g, "Declaration") || "")) !== norm(files["GVL_IO.st"]))
    err("GVL_IO.TcGVL", tr("Objekt {name} v souboru {file} se liší od ST výpisu {st} (importoval by se jiný kód, než jaký emulátor ověřil)", { name: "GVL_IO", file: "GVL_IO.TcGVL", st: "GVL_IO.st" }));
  const x = files["PLCopen_Import.xml"];
  if (x !== undefined && /plcopenxml\/(method|property|interface|pouinheritance)/.test(x)) {
    const objs = plcopenObjects(x);
    for (const o of objs) {
      compare("PLCopen_Import.xml", o.name, o.obj);
      const dv = declVars(o.obj.decl);
      if (o.obj.kind !== "interface" && o.varsXml.join(",") !== dv.join(",")) err("PLCopen_Import.xml", tr("POU {name}: proměnné v <interface> ({a}) neodpovídají deklaraci ({b})", { name: o.name, a: o.varsXml.join(", "), b: dv.join(", ") }));
      for (const mv of o.methodsVars) if (mv.xml.join(",") !== mv.decl.join(",")) err("PLCopen_Import.xml", tr("Metoda {name}: proměnné v <interface> ({a}) neodpovídají deklaraci ({b})", { name: o.name + "." + mv.name, a: mv.xml.join(", "), b: mv.decl.join(", ") }));
    }
    const names = new Set(objs.map(o => o.name.toUpperCase()));
    for (const k of st.keys()) if (!names.has(k)) err("PLCopen_Import.xml", tr("Objekt {name} z ST výpisu v PLCopen XML chybí", { name: k }));
  }
}
