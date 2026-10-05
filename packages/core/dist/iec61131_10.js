/**
 * IEC 61131-10 Ed. 1.0 (2019) XML — výměnný formát programů PLC podle normy (nástupce PLCopen TC6).
 *
 * Jeden importovatelný soubor `IEC61131-10_Import.xml`: bloky FB (ST), program (ST), globální
 * proměnné a programový soubor / úloha podle normy. Stejný princip jako `plcopen.ts`: zdrojem je
 * FINÁLNÍ text výstupu platformy (Gen_Library.st, MAIN.st, tabulka globálních návěští), ne surové
 * šablony — import = ručně vložené soubory (překlad komentářů, TIMER_100_FB_M, meze, rawMax, adresy).
 *
 * FORMÁT (ověřeno proti schématu normy, ne importem v IDE):
 *  - Schéma: PLCopen „IEC 61131-10 Code Components“ (iec_61131-10_ed1_fdis.zip, `IEC61131_10_Ed1_0.xsd`,
 *    vzor `IEC61131_10_Ed1_0_Example.xml`) — https://www.plcopen.org/standards/xml-echange/code-components/
 *    Licence IEC Code Components (http://www.iec.ch/CCv1) redistribuci bez zakoupené normy nedovoluje →
 *    XSD v repozitáři NENÍ; jen URL + SHA-256 (`IEC10_XSD`), test ho použije z lokální kopie (proměnná
 *    prostředí `IEC61131_10_XSD`), jinak běží jen vlastní strukturní kontrola (`emu/iec61131_10_check.ts`).
 *  - Kořen `<Project xmlns="www.iec.ch/public/TC65SC65BWG7TF10" schemaVersion="1.0">` (namespace BEZ
 *    „http://“ — tak ho má XSD i vzor), pořadí FileHeader → ContentHeader → Types/GlobalNamespace →
 *    Instances; POU `FunctionBlock` / `Program` s `Parameters` (InputVars / OutputVars / InoutVars,
 *    `orderWithinParamSet`), `Vars accessSpecifier="private"`, `MainBody/BodyContent xsi:type="ST"`;
 *    globální proměnné `Instances/Configuration[/Resource]/GlobalVars`, úloha `Task xsi:type="StandardTask"`,
 *    `ProgramInstance`.
 *
 * CÍLE:
 *  - `mitsubishi` (GX Works3, MELSEC iQ-F FX5): Project → Import File → IEC61131-10 XML Format (GX Works3
 *    od 1.110Q, všechny CPU — RCPU, LHCPU, FX5CPU; jen ST). Mapování prvků podle GX Works3 Operating
 *    Manual SH-081215ENG (AU), kap. 3.3 „Importing data (IEC61131-10 XML format)“ a Appendix 8 „XML File
 *    Formats (IEC61131-10 Format)“: Program = programový blok (příklad jména ProgPou), Resource = programový
 *    soubor (příklad MAIN), ProgramInstance = registrace programu, GlobalVars = globální návěští
 *    (Address.address = přiřazení operandu X/Y), Vars private = lokální návěští, Documentation = komentář.
 *    Tvar ověřen i proti vzorům nástroje Jiecc (graviness.com, BSD-2, cíl „MITSUBISHI“, ověřeno autorem
 *    v GX Works3 1.110Q+): globální návěští v `Configuration/GlobalVars`, adresa bez `%` jen v `address`.
 *    FX5 nepodporuje počáteční hodnoty návěští ani „Access from External Device“ (SH-081215ENG) → XML je
 *    nenese (meze a rawMax se předávají při volání; přístup z HMI viz README). Rozšíření AddData výrobce
 *    (VariableComments, ResourceExecutionType, VariableExternalDeviceAccess…) se NEgenerují — manuál
 *    neuvádí jejich jmenný prostor (URI); typ spuštění programu (Scan) se nastaví po importu (README).
 *    Jedna sada GlobalVars — každá je v GX Works3 samostatný seznam návěští s výchozím jménem „Global“
 *    a duplicitní jméno se při importu přeskočí („only the first data is imported“).
 *  - `plcnext` (PŘÍPRAVA, jen v testech — platforma zatím není): PLCnext Engineer, File → Import →
 *    Import From IEC 61131-10 (https://engineer.plcnext.help/2024.0_LTS_en/Import_Types_FromIEC61131.htm).
 *    Zdrojem je kód rodiny CODESYS bez kvalifikace `GVL_IO.` (I/O jako globální proměnné zdroje
 *    `Resource/GlobalVars` bez adres — import propojení na I/O nepřenáší, propojí se v Data List;
 *    program je čte přes `ExternalVars`), úloha + instance programu (do projektu s controllerem).
 *
 * STAV: NEOVĚŘENO importem — GX Works3 ani PLCnext Engineer nejsou k dispozici; README to uvádí.
 */
import { esc, dtFor, stripDia } from "./model.js";
import { genLibrary, genMainIEC, genTagFile } from "./codegen.js";
import { parseStPou, splitLibrary } from "./plcopen.js";
/** Cílový jmenný prostor normy (z XSD i vzoru — bez schématu URL). */
export const IEC10_NS = "www.iec.ch/public/TC65SC65BWG7TF10";
/** Jméno souboru ve výstupu platformy. */
export const IEC10_FILE = "IEC61131-10_Import.xml";
/** Schéma normy: zdroj a otisky (soubor se nedistribuuje — licence IEC Code Components). */
export const IEC10_XSD = {
    page: "https://www.plcopen.org/standards/xml-echange/code-components/",
    zipUrl: "https://www.plcopen.org/download_file/view/0df46fd9-5dc4-40a9-9bcf-bee135b1c253/",
    zip: "iec_61131-10_ed1_fdis.zip",
    zipSha256: "154efd2f9159a96c1c36688541256060361f60e5d6dc3932ba749f09e502f992",
    file: "IEC61131_10_Ed1_0.xsd",
    sha256: "f2d595c077fc2294be5a48ca097848e582afec977de47c0c91ab2a035d5c7680",
    license: "http://www.iec.ch/CCv1",
};
/** Zdroje formátu pro cílová IDE. */
export const IEC10_SRC = {
    gxw3: "https://dl.mitsubishielectric.com/dl/fa/document/manual/plc/sh081215eng/sh081215engau.pdf",
    jiecc: "https://www.graviness.com/iec_61131-3/jiecc.html",
    plcnext: "https://engineer.plcnext.help/2024.0_LTS_en/Import_Types_FromIEC61131.htm",
    plcnextTc6: "https://engineer.plcnext.help/2023.6_en/ImportExport_Types_FromPLCopenXML.htm",
};
export const IEC10_PROFILES = {
    /* GX Works3 OM, Appendix 8: příkladová jména ProgPou (programový blok) a MAIN (programový soubor) =
       nový projekt; při importu do něj se duplicitní jména nahradí (Replace) */
    mitsubishi: { program: "ProgPou", resource: "MAIN", resourceType: "FX5CPU", globalsIn: "configuration", initValues: false, externals: false, task: null },
    plcnext: { program: null, resource: "PLCdesk", resourceType: "PLCnext", globalsIn: "resource", initValues: true, externals: true, task: { name: "Cyclic10ms", interval: "T#10ms", priority: 1 } },
};
const SECTION_RE = /^\s*(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_TEMP|VAR)\b([\s\S]*?)^\s*END_VAR/gm;
const KIND = { VAR_INPUT: "in", VAR_OUTPUT: "out", VAR_IN_OUT: "inout", VAR_TEMP: "temp", VAR: "var" };
const VAR_RE = /^\s*([A-Za-z_]\w*)\s*(?:AT\s*(%[\w.*]+)\s*)?:\s*([A-Za-z_]\w*)\s*(?::=\s*([^;]+?)\s*)?;\s*(?:\(\*\s*(.*?)\s*\*\))?/;
/** Sekce deklarací POU (VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT / VAR / VAR_TEMP) v pořadí ST. */
export function stSections(src) {
    const out = [];
    let m;
    SECTION_RE.lastIndex = 0;
    while ((m = SECTION_RE.exec(src))) {
        const vars = [];
        for (const line of m[2].split("\n")) {
            const vm = line.match(VAR_RE);
            if (vm && !/^(VAR|END)/i.test(vm[1]))
                vars.push({ name: vm[1], address: vm[2], type: vm[3], init: vm[4], comment: vm[5] });
        }
        out.push({ kind: KIND[m[1]], vars });
    }
    return out;
}
/** Úvodní komentář bloku (mezi hlavičkou POU a první sekcí VAR) jako prostý text, jinak "". */
export function stPouDoc(src) {
    const head = /^\s*(?:FUNCTION_BLOCK|PROGRAM)\s+"?\w+"?[^\n]*\n/m.exec(src);
    if (!head)
        return "";
    const rest = src.slice(head.index + head[0].length);
    const v = /^\s*VAR/m.exec(rest);
    const pre = v ? rest.slice(0, v.index) : "";
    return [...pre.matchAll(/\(\*([\s\S]*?)\*\)/g)].map(m => m[1].split("\n").map(s => s.trim()).join(" ").trim()).filter(Boolean).join(" ");
}
/** Typ z editoru globálních návěští GX Works3 (GlobalLabels.csv) → typ IEC. */
const GX_TYPES = {
    "bit": "BOOL", "word [signed]": "INT", "word [unsigned]/bit string [16-bit]": "WORD",
    "double word [signed]": "DINT", "float [single precision]": "REAL", "time": "TIME",
};
/** Rozdělí řádek CSV (uvozovky, zdvojené uvozovky uvnitř). */
function csvCells(line) {
    const out = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
            if (c === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                }
                else
                    q = false;
            }
            else
                cur += c;
        }
        else if (c === '"')
            q = true;
        else if (c === ",") {
            out.push(cur);
            cur = "";
        }
        else
            cur += c;
    }
    out.push(cur);
    return out;
}
/** Globální návěští z GlobalLabels.csv (výstup `genTagFile` pro Mitsubishi) — jméno, typ IEC, operand, komentář. */
export function gxGlobalLabels(csv) {
    const rows = csv.split(/\r?\n/).filter(r => r.trim());
    const head = csvCells(rows[0] || "");
    const ix = (n) => head.indexOf(n);
    const iN = ix("Label Name"), iT = ix("Data Type"), iC = ix("Comment"), iA = ix("Assign (Device/Label)");
    return rows.slice(1).map(r => {
        const c = csvCells(r);
        const t = (c[iT] || "").trim();
        return { name: c[iN], type: GX_TYPES[t.toLowerCase()] || t, address: iA >= 0 && c[iA] ? c[iA] : undefined, comment: iC >= 0 && c[iC] ? c[iC] : undefined };
    });
}
/** Finální texty platformy pro cíl (bez `files` se vygenerují). */
export function iec10Source(prj, target, files) {
    if (target === "mitsubishi") {
        const lib = files?.["Gen_Library.st"] ?? genLibrary(prj, "mitsubishi");
        const main = files?.["MAIN.st"] ?? genMainIEC(prj, "mitsubishi");
        const csv = files?.["GlobalLabels.csv"] ?? genTagFile(prj, "mitsubishi").body;
        return { lib, main, globals: gxGlobalLabels(csv) };
    }
    /* PLCnext (příprava): kód rodiny CODESYS, I/O jako globální proměnné bez kvalifikace GVL_IO a bez adres
       (propojení na I/O se dělá v Data List; import IEC 61131-10 ho nepřenáší) */
    if (prj.devices.some(d => d.cls === "Axis"))
        throw new Error("iec61131_10Xml(plcnext): servoosa není pro PLCnext podporována");
    const unq = (s) => s.replace(/\bGVL_IO\./g, "");
    return {
        lib: unq(genLibrary(prj, "codesys")), main: unq(genMainIEC(prj, "codesys")),
        globals: prj.io.map(e => ({ name: e.tag, type: dtFor(e), comment: e.cmt ? stripDia(e.cmt) : undefined })),
    };
}
/* ------------------------------------------------------------------ zápis XML */
const doc = (t, ind) => t ? ind + '<Documentation xsi:type="SimpleText">' + esc(t) + "</Documentation>\n" : "";
const typeRef = (t) => "<Type><TypeName>" + esc(t) + "</TypeName></Type>";
function variableXml(v, ind, order, p) {
    let s = ind + '<Variable name="' + esc(v.name) + '"' + (order !== null ? ' orderWithinParamSet="' + order + '"' : "") + ">\n";
    s += doc(v.comment, ind + "  ");
    s += ind + "  " + typeRef(v.type) + "\n";
    if (v.init !== undefined && p.initValues)
        s += ind + '  <InitialValue><SimpleValue value="' + esc(v.init) + '" /></InitialValue>\n';
    if (v.address)
        s += ind + '  <Address address="' + esc(v.address) + '" />\n';
    return s + ind + "</Variable>\n";
}
const PARAM_TAG = { in: "InputVars", out: "OutputVars", inout: "InoutVars" };
/** Jeden POU (FunctionBlock / Program) z finálního ST. */
function pouXml(src, p, globals) {
    const pou = parseStPou(src);
    const secs = stSections(src);
    const isProg = pou.kind === "program";
    const tag = isProg ? "Program" : "FunctionBlock";
    const name = isProg && p.program ? p.program : pou.name;
    const I = "      ", I2 = I + "  ", I3 = I2 + "  ", I4 = I3 + "  ";
    let s = I + "<" + tag + ' name="' + esc(name) + '">\n';
    s += doc(stPouDoc(src), I2);
    /* parametry (jen FB) — orderWithinParamSet průběžně přes všechny sekce v pořadí ST */
    const params = secs.filter(x => PARAM_TAG[x.kind] && x.vars.length);
    if (params.length && !isProg) {
        let n = 0;
        s += I2 + "<Parameters>\n";
        for (const x of params)
            s += I3 + "<" + PARAM_TAG[x.kind] + ">\n" + x.vars.map(v => variableXml(v, I4, ++n, p)).join("") + I3 + "</" + PARAM_TAG[x.kind] + ">\n";
        s += I2 + "</Parameters>\n";
    }
    /* program čte globální proměnné (IEC VAR_EXTERNAL) — jen ty, které tělo opravdu používá */
    if (isProg && p.externals) {
        const used = globals.filter(g => new RegExp("\\b" + g.name + "\\b").test(pou.body));
        if (used.length)
            s += I2 + "<ExternalVars>\n" + used.map(g => I3 + '<Variable name="' + esc(g.name) + '">' + typeRef(g.type) + "</Variable>\n").join("") + I2 + "</ExternalVars>\n";
    }
    for (const x of secs.filter(y => y.kind === "var" && y.vars.length))
        s += I2 + '<Vars accessSpecifier="private">\n' + x.vars.map(v => variableXml(v, I3, null, p)).join("") + I2 + "</Vars>\n";
    for (const x of secs.filter(y => y.kind === "temp" && y.vars.length))
        s += I2 + "<TempVars>\n" + x.vars.map(v => variableXml(v, I3, null, p)).join("") + I2 + "</TempVars>\n";
    s += I2 + "<MainBody>\n" + I3 + '<BodyContent xsi:type="ST">\n' + I4 + "<ST>" + esc(pou.body) + "</ST>\n" + I3 + "</BodyContent>\n" + I2 + "</MainBody>\n";
    return s + I + "</" + tag + ">\n";
}
/**
 * IEC 61131-10 XML projektu pro cíl `target`. `files` = už vygenerované soubory platformy
 * (genFor je předává, aby XML vzniklo z téhož textu); bez nich se texty vygenerují.
 */
export function iec61131_10Xml(prj, target, files) {
    const p = IEC10_PROFILES[target];
    const src = iec10Source(prj, target, files);
    const now = new Date().toISOString().slice(0, 19) + "Z";
    const fbs = splitLibrary(src.lib);
    const prog = pouXml(src.main, p, src.globals);
    const progName = p.program || parseStPou(src.main).name;
    const gl = src.globals.length
        ? "<GlobalVars>\n" + src.globals.map(g => variableXml(g, p.globalsIn === "resource" ? "          " : "        ", null, p)).join("")
        : "";
    const glXml = (ind) => gl ? ind + gl + ind + "</GlobalVars>\n" : "";
    let res = '      <Resource name="' + esc(p.resource) + '" resourceTypeName="' + esc(p.resourceType) + '">\n';
    if (p.globalsIn === "resource")
        res += glXml("        ");
    if (p.task)
        res += '        <Task xsi:type="StandardTask" name="' + esc(p.task.name) + '" interval="' + esc(p.task.interval) + '" priority="' + p.task.priority + '" />\n';
    res += '        <ProgramInstance name="' + esc(progName) + '" typeName="' + esc(progName) + '"' + (p.task ? ' associatedTaskName="' + esc(p.task.name) + '"' : "") + " />\n";
    res += "      </Resource>\n";
    return `<?xml version="1.0" encoding="utf-8"?>
<!-- PLCdesk - IEC 61131-10 Ed. 1.0 XML (${target}) -->
<Project xmlns="${IEC10_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" schemaVersion="1.0">
  <FileHeader companyName="PLCdesk" productName="PLCdesk" productVersion="0.1" />
  <ContentHeader name="${esc(prj.meta.name || "PLCdesk-Project")}" creationDateTime="${now}" />
  <Types>
    <GlobalNamespace>
${fbs.map(f => pouXml(f, p, src.globals)).join("")}${prog}    </GlobalNamespace>
  </Types>
  <Instances>
    <Configuration name="PLCdesk">
${res}${p.globalsIn === "configuration" ? glXml("      ") : ""}    </Configuration>
  </Instances>
</Project>
`;
}
