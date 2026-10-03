/**
 * PLCopen XML (TC6) export — jeden importovatelný soubor pro CODESYS V3.5,
 * TwinCAT 3 a EcoStruxure Machine Expert: POU (FB knihovna + MAIN, ST)
 * + globální proměnné GVL_IO s adresami.
 *
 * Zdrojem je FINÁLNÍ text, který jde do Gen_Library.st a MAIN.st pro danou platformu
 * (přeložené komentáře, ruční povely, porucha stroje, meze, rawMax, cmtSafe…) — žádné
 * surové šablony, aby se import nikdy nelišil od ručně vložených souborů.
 *
 * Namespace tc6_0200 (nejširší kompatibilita; CODESYS/TwinCAT round-trip).
 * Import v IDE: Project / PLC projekt → Import PLCopenXML. Import je aditivní —
 * duplicitní názvy POU hlásí chybu (smazat staré, nebo importovat do prázdné aplikace).
 */
import { Project, PlatformKey, addrFor, dtFor, esc } from "./model.js";
import { genLibrary, genMainIEC } from "./codegen.js";

export interface ParsedVar { name: string; type: string; init?: string; comment?: string; address?: string; }
export interface ParsedPou {
  name: string; kind: "functionBlock" | "program";
  inputs: ParsedVar[]; outputs: ParsedVar[]; locals: ParsedVar[];
  body: string;
}

/** Rozparsuje náš vlastní, dobře formovaný ST POU (generovaný FB / MAIN) na interface + tělo. */
export function parseStPou(src: string): ParsedPou {
  const head = src.match(/^\s*(FUNCTION_BLOCK|PROGRAM)\s+"?(\w+)"?/m);
  if (!head) throw new Error("parseStPou: chybí hlavička POU");
  const kind = head[1] === "PROGRAM" ? "program" : "functionBlock";
  const name = head[2];
  const inputs: ParsedVar[] = [], outputs: ParsedVar[] = [], locals: ParsedVar[] = [];
  const re = /^\s*(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR)\b([\s\S]*?)^\s*END_VAR/gm;
  let m: RegExpExecArray | null, lastEnd = 0;
  while ((m = re.exec(src))) {
    lastEnd = re.lastIndex;
    const bucket = m[1] === "VAR_INPUT" ? inputs : m[1] === "VAR_OUTPUT" ? outputs : locals;
    for (const line of m[2].split("\n")) {
      const vm = line.match(/^\s*([A-Za-z_]\w*)\s*(?:AT\s*(%[\w.*]+)\s*)?:\s*([A-Za-z_]\w*)\s*(?::=\s*([^;]+?)\s*)?;\s*(?:\(\*\s*(.*?)\s*\*\))?/);
      if (vm && !/^(VAR|END)/i.test(vm[1])) {
        bucket.push({ name: vm[1], address: vm[2], type: vm[3], init: vm[4], comment: vm[5] });
      }
    }
  }
  let body = src.slice(lastEnd);
  body = body.replace(/END_(FUNCTION_BLOCK|PROGRAM)\s*$/m, "").trim();
  return { name, kind, inputs, outputs, locals, body };
}

/** Všechny FUNCTION_BLOCK z textu knihovny (Gen_Library.st obsahuje víc bloků za sebou). */
export function splitLibrary(lib: string): string[] {
  return lib.match(/^FUNCTION_BLOCK\b[\s\S]*?^END_FUNCTION_BLOCK\b/gm) || [];
}

const ELEMENTARY = new Set(["BOOL", "BYTE", "WORD", "DWORD", "SINT", "INT", "DINT", "LINT", "UINT", "REAL", "LREAL", "TIME", "STRING"]);

function typeXml(t: string): string {
  const u = t.toUpperCase();
  return ELEMENTARY.has(u) ? "<" + u + " />" : '<derived name="' + esc(t) + '" />';
}

function varXml(v: ParsedVar, indent: string): string {
  let s = indent + '<variable name="' + esc(v.name) + '"' + (v.address ? ' address="' + esc(v.address) + '"' : "") + ">\n";
  s += indent + "  <type>" + typeXml(v.type) + "</type>\n";
  if (v.init !== undefined) s += indent + '  <initialValue><simpleValue value="' + esc(v.init) + '" /></initialValue>\n';
  if (v.comment) s += indent + '  <documentation><xhtml xmlns="http://www.w3.org/1999/xhtml">' + esc(v.comment) + "</xhtml></documentation>\n";
  s += indent + "</variable>\n";
  return s;
}

function varsSection(tag: string, vars: ParsedVar[], indent: string): string {
  if (!vars.length) return "";
  return indent + "<" + tag + ">\n" + vars.map(v => varXml(v, indent + "  ")).join("") + indent + "</" + tag + ">\n";
}

function pouXml(p: ParsedPou): string {
  return `    <pou name="${esc(p.name)}" pouType="${p.kind}">
      <interface>
${varsSection("inputVars", p.inputs, "        ")}${varsSection("outputVars", p.outputs, "        ")}${varsSection("localVars", p.locals, "        ")}      </interface>
      <body>
        <ST>
          <xhtml xmlns="http://www.w3.org/1999/xhtml">${esc(p.body)}</xhtml>
        </ST>
      </body>
    </pou>
`;
}

/**
 * Kompletní PLCopen TC6 XML projektu: knihovna FB (jen použité třídy — přesně bloky
 * z Gen_Library.st), MAIN (= MAIN.st) a GVL_IO s adresami dle cílové platformy.
 */
export function genPLCopenXML(prj: Project, plat: PlatformKey = "codesys"): string {
  const now = new Date().toISOString().slice(0, 19);
  const pous: ParsedPou[] = splitLibrary(genLibrary(prj, plat)).map(parseStPou);
  pous.push(parseStPou(genMainIEC(prj, plat)));

  let gvl = "";
  for (const e of prj.io) {
    const at = addrFor(plat, e);
    gvl += varXml({ name: e.tag, type: dtFor(e), address: at || undefined, comment: e.cmt || undefined }, "            ");
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<project xmlns="http://www.plcopen.org/xml/tc6_0200">
  <fileHeader companyName="PLCdesk" productName="PLCdesk" productVersion="0.1" creationDateTime="${now}" />
  <contentHeader name="${esc(prj.meta.name || "PLCdesk-Project")}" modificationDateTime="${now}">
    <coordinateInfo>
      <fbd><scaling x="1" y="1" /></fbd>
      <ld><scaling x="1" y="1" /></ld>
      <sfc><scaling x="1" y="1" /></sfc>
    </coordinateInfo>
  </contentHeader>
  <types>
    <dataTypes />
    <pous>
${pous.map(pouXml).join("")}    </pous>
  </types>
  <instances>
    <configurations>
      <configuration name="Default">
        <resource name="Application">
          <task name="MainTask" interval="PT0.020S" priority="1">
            <pouInstance name="MAIN" typeName="MAIN" />
          </task>
          <globalVars name="GVL_IO">
${gvl}          </globalVars>
        </resource>
      </configuration>
    </configurations>
  </instances>
</project>
`;
}
