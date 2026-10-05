/**
 * PLCdesk — emulátor: strukturní kontrola PLCopen_Import.xml pro import CODESYS (rodina CODESYS).
 *
 * Pravidla ze SKUTEČNÉHO importu a překladu v CODESYS V3.5 SP21 Patch 6 (3.5.21.60, Control Win V3 x64,
 * 2026-10-05) a z exportu téhož IDE (tvar, který import čte):
 *  1. GVL v `<instances><configurations><configuration …>` CODESYS odmítne („Object 'Default' is not
 *     accepted by parent object…“) a přeskočí celou konfiguraci → GVL_IO chybí (C46 a stovky následných
 *     chyb). GVL patří do `<addData><data name="…/plcopenxml/globalvars">` projektu; obsah musí být
 *     totožný s GVL_IO.st (jména, typy, adresy).
 *  2. Rozhraní POU v `<interface>` = deklarace v ST: sekce inputVars / outputVars / inOutVars / localVars
 *     ve stejném pořadí. VAR_IN_OUT jako localVars → C37 „'Axis' is no input of 'FB_AXIS'“ + C540.
 *  3. Styl OOP: textová deklarace (`InterfaceAsPlainText`, nese ABSTRACT / přístup / komentáře / atributy)
 *     u POU v addData ZA `</body>`, u Method / Property / Interface jako přímý potomek elementu. Jinde
 *     ji CODESYS ignoruje a deklaraci postaví ze strukturované části (bez modifikátorů).
 * Emulátor ≠ import výrobce: kontrola hlídá jen zjištěné odchylky, ne celé chování importu.
 */
import type { PlatformKey } from "../model.js";
import type { EmuFinding, Unit, Pou, VarBlock } from "./types.js";
import { tr } from "../i18n.js";
import { SRC } from "./dialects.js";

const F = "PLCopen_Import.xml";
/** Zdroj pravidel: nápověda CODESYS (import PLCopenXML); ověřeno importem 3.5.21.60 (2026-10-05). */
const SRC_PLCOPEN = SRC.cdsPlcopen;

const SECTION: Record<string, string> = { inputVars: "in", outputVars: "out", inOutVars: "inout", localVars: "var", tempVars: "temp" };
const KIND_OF: Partial<Record<VarBlock["kind"], string>> = { in: "in", out: "out", inout: "inout", var: "var", const: "var", stat: "var", temp: "temp" };
const unEsc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Proměnné strukturované části `<interface>…</interface>` jako `sekce:jméno` (bez addData). */
function xmlVars(iface: string): string[] {
  const out: string[] = [];
  const s = iface.replace(/<addData>[\s\S]*?<\/addData>/g, "");
  for (const m of s.matchAll(/<(inputVars|outputVars|inOutVars|localVars|tempVars)\b[^>]*>([\s\S]*?)<\/\1>/g))
    for (const v of m[2].matchAll(/<variable name="([^"]+)"/g)) out.push(SECTION[m[1]] + ":" + unEsc(v[1]).toUpperCase());
  return out;
}
/** Totéž z deklarace ST (parser emulátoru). */
function stVars(blocks: VarBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) { const k = KIND_OF[b.kind]; if (k) for (const d of b.decls) out.push(k + ":" + d.name.toUpperCase()); }
  return out;
}
/* pořadí sekcí v XML se smí lišit od ST (TC6: inputVars, outputVars, inOutVars, localVars); pořadí uvnitř sekce ne */
const RANK = ["in", "out", "inout", "var", "temp"];
const bySection = (a: string[]) => RANK.flatMap(r => a.filter(x => x.startsWith(r + ":")));
const sameVars = (a: string[], b: string[]) => bySection(a).join(",") === bySection(b).join(",");
const show = (a: string[]) => a.map(x => x.replace(/^(\w+):/, "$1 ")).join(", ") || "—";

/** Typ proměnné v XML (`<BOOL />`, `<derived name="X" />`). */
const xmlType = (v: string) => { const m = /<type>\s*<(?:derived name="([^"]+)"|(\w+))\s*\/>/.exec(v); return m ? (m[1] || m[2]).toUpperCase() : "?"; };

export function checkPlcopenStructure(files: Record<string, string>, units: Unit[], plat: PlatformKey, out: EmuFinding[]): void {
  const x = files[F];
  if (x === undefined) return;
  const err = (msg: string, level: "error" | "warn" = "error") => out.push({ level, rule: "plcopen", file: F, line: 0, col: 0, platform: plat, source: SRC_PLCOPEN, msg });

  /* 1. GVL: ne v configurations, ale v addData …/globalvars projektu, shodně s GVL_IO.st */
  const conf = /<configurations\b[^>]*\/>|<configurations\b[^>]*>([\s\S]*?)<\/configurations>/.exec(x);
  if (conf && conf[1] !== undefined && /<configuration\b/.test(conf[1]))
    err(tr("PLCopen XML má konfiguraci v <configurations> — CODESYS 3.5.21.60 ji při importu odmítne („Object 'Default' is not accepted…“) i s GVL a úlohou; GVL patří do addData …/plcopenxml/globalvars projektu"));
  const ga = /<data name="http:\/\/www\.3s-software\.com\/plcopenxml\/globalvars"[^>]*>([\s\S]*?)<\/data>/.exec(x);
  const gvlXml = ga ? /<globalVars name="GVL_IO"[^>]*>([\s\S]*?)<\/globalVars>/.exec(ga[1]) : null;
  const gvlSt = units.find(u => u.file === "GVL_IO.st");
  const stG = gvlSt ? gvlSt.globals.flatMap(b => b.decls) : [];
  if (!gvlXml) {
    if (stG.length || files["GVL_IO.st"] !== undefined) err(tr("PLCopen XML nemá GVL_IO v addData …/plcopenxml/globalvars projektu — CODESYS po importu nezná GVL_IO (C46 „Identifier 'GVL_IO' not defined“)"));
  } else {
    const xv = [...gvlXml[1].matchAll(/<variable name="([^"]+)"([^>]*)>([\s\S]*?)<\/variable>/g)].map(m => {
      const a = /\saddress="([^"]*)"/.exec(m[2]);
      return unEsc(m[1]).toUpperCase() + ":" + xmlType(m[3]) + "@" + (a ? unEsc(a[1]) : "");
    });
    const sv = stG.map(d => d.name.toUpperCase() + ":" + (d.type.k === "name" ? d.type.name.toUpperCase() : "?") + "@" + (d.at || "").replace(/\s+/g, ""));
    if (xv.join(",") !== sv.join(",")) {
      const miss = sv.filter(v => !xv.includes(v)), extra = xv.filter(v => !sv.includes(v));
      err(tr("GVL_IO v PLCopen XML se liší od GVL_IO.st (jméno : typ @ adresa) — chybí v XML: {a}; navíc v XML: {b}", { a: miss.slice(0, 5).join(", ") || "—", b: extra.slice(0, 5).join(", ") || "—" }));
    }
  }

  /* 2. rozhraní POU (a metod) = deklarace ST */
  const stPous = new Map<string, Pou>();
  for (const u of units) if (u.file !== "GVL_IO.st") for (const p of u.pous) stPous.set(p.name.toUpperCase(), p);
  for (const m of x.matchAll(/<pou name="([^"]+)" pouType="(\w+)">([\s\S]*?)<\/pou>/g)) {
    const name = unEsc(m[1]), body = m[3];
    const p = stPous.get(name.toUpperCase());
    if (!p) { err(tr("POU {name} z PLCopen XML není v ST souborech", { name })); continue; }
    const kind = m[2] === "program" ? "program" : m[2] === "functionBlock" ? "fb" : m[2];
    if (kind !== p.kind) err(tr("POU {name}: druh v XML ({a}) ≠ ST ({b})", { name, a: m[2], b: p.kind }));
    const ie = body.indexOf("</interface>");
    const iface = ie >= 0 ? body.slice(0, ie + 12) : "";
    const a = xmlVars(iface), b = stVars(p.vars);
    if (!sameVars(a, b)) err(tr("POU {name}: proměnné v <interface> ({a}) neodpovídají deklaraci ST ({b}) — sekce inputVars / outputVars / inOutVars / localVars musí odpovídat VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT / VAR", { name, a: show(a), b: show(b) }));
    /* 3. textová deklarace POU: jen v addData za </body>, ne v <interface> */
    if (/interfaceasplaintext/i.test(iface)) err(tr("POU {name}: textová deklarace (InterfaceAsPlainText) je v <interface> — CODESYS ji čte jen z addData POU za </body>, jinak ztratí ABSTRACT / přístup a komentáře", { name }));
    const rest = ie >= 0 ? body.slice(ie + 12) : body;
    const tail = rest.slice(Math.max(0, rest.indexOf("</body>")));
    for (const mm of tail.matchAll(/<Method name="([^"]+)"[^>]*>([\s\S]*?)<\/Method>/g)) {
      const mn = unEsc(mm[1]);
      const sm = p.methods.find(q => q.kind === "method" && q.name.toUpperCase() === mn.toUpperCase());
      if (!sm) { err(tr("Metoda {name} z PLCopen XML není v ST", { name: name + "." + mn })); continue; }
      const mi = /<interface>([\s\S]*?)<\/interface>/.exec(mm[2]);
      const xa = mi ? xmlVars(mi[0]) : [], sb = stVars(sm.vars);
      if (!sameVars(xa, sb)) err(tr("Metoda {name}: proměnné v <interface> ({a}) neodpovídají deklaraci ST ({b})", { name: name + "." + mn, a: show(xa), b: show(sb) }));
      memberPlain(mm[2], name + "." + mn);
    }
    for (const pm of tail.matchAll(/<Property name="([^"]+)"[^>]*>([\s\S]*?)<\/Property>/g)) memberPlain(pm[2], name + "." + unEsc(pm[1]));
  }
  for (const m of x.matchAll(/<Interface name="([^"]+)"[^>]*>([\s\S]*?)<\/Interface>/g)) {
    const b = m[2];
    for (const mm of b.matchAll(/<(Method|Property) name="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) memberPlain(mm[3], m[1] + "." + mm[2]);
    memberPlain(b.replace(/<Methods>[\s\S]*?<\/Methods>/, "").replace(/<Properties>[\s\S]*?<\/Properties>/, ""), m[1]);
  }

  /** Method / Property / Interface: InterfaceAsPlainText jako přímý potomek, ne v addData/data. */
  function memberPlain(inner: string, what: string) {
    const own = inner.replace(/<(GetAccessor|SetAccessor)>[\s\S]*?<\/\1>/g, "");
    if (/<data name="[^"]*\/interfaceasplaintext"/.test(own))
      err(tr("{name}: textová deklarace je zabalená v addData — CODESYS čte InterfaceAsPlainText u metody / vlastnosti / rozhraní jen jako přímý potomek elementu", { name: what }));
  }
}
