/**
 * IEC61131-10_Import.xml (IEC 61131-10 Ed. 1.0) — Mitsubishi GX Works3 a příprava PLCnext.
 * Struktura na vzorech 00a–12 × 5 jazyků (well-formed, kořen a namespace normy, rozhraní a tělo POU = ST,
 * globální proměnné = GlobalLabels.csv, FX5 bez počátečních hodnot), mutace strukturní kontroly emulátoru
 * a validace proti XSD normy přes Python lxml, pokud je XSD k dispozici lokálně (`IEC61131_10_XSD` =
 * cesta k IEC61131_10_Ed1_0.xsd; soubor se kvůli licenci IEC nedistribuuje — viz IEC10_XSD).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankProject, syncIO, PLAT, type Project, type PlatformKey } from "./model.js";
import { axisBlocked } from "./axis_gen.js";
import { genFor } from "./codegen.js";
import { setLang, LANGS, type Lang } from "./i18n.js";
import { splitLibrary, parseStPou } from "./plcopen.js";
import { emulateFiles } from "./emu/index.js";
import { xmlProblems } from "./logix.js";
import { iec61131_10Xml, iec10Source, gxGlobalLabels, stSections, IEC10_FILE, IEC10_NS, IEC10_XSD } from "./iec61131_10.js";
import { iec10Problems } from "./emu/iec61131_10_check.js";
import { extractFiles, inferProject } from "./reverse.js";

const SAMPLE_DIR = new URL("../../../samples/", import.meta.url);   // dist/ → kořen repozitáře
/* vzory 00a–12 (rozpracované 13+ se neberou) */
const SAMPLES = readdirSync(SAMPLE_DIR).filter(f => /^(0\d[ab]?|1[0-2])_.*\.plcstudio\.json$/.test(f)).sort();
function load(name: string): Project {
  const raw = JSON.parse(readFileSync(new URL(name, SAMPLE_DIR), "utf8"));
  const prj = Object.assign(blankProject(), raw.prj || raw) as Project;
  prj.platforms = (Object.keys(PLAT) as PlatformKey[]).filter(p => !axisBlocked(prj, p));
  syncIO(prj);
  return prj;
}
const LANG_LIST = Object.keys(LANGS) as Lang[];
const hasAxis = (prj: Project) => prj.devices.some(d => d.cls === "Axis");

test("IEC 61131-10 (Mitsubishi): vzory 00a–12 × 5 jazyků — struktura normy, POU = ST, globální = GlobalLabels.csv", () => {
  assert.ok(SAMPLES.length >= 14, "vzory 00a–12");
  try {
    for (const lang of LANG_LIST) {
      setLang(lang);
      for (const f of SAMPLES) {
        const prj = load(f);
        const files = genFor(prj, "mitsubishi");
        const at = lang + " " + f;
        if (axisBlocked(prj, "mitsubishi")) { assert.equal(files[IEC10_FILE], undefined, at + ": osa → jen README"); continue; }
        const x = files[IEC10_FILE];
        assert.ok(x, at + ": soubor " + IEC10_FILE);
        assert.deepEqual(xmlProblems(x), [], at + ": well-formed");
        assert.ok(x.includes('<Project xmlns="' + IEC10_NS + '"') && x.includes('schemaVersion="1.0"'), at + ": kořen a namespace");
        /* XML vzniklo z týchž souborů jako ruční cesta */
        assert.deepEqual(iec10Problems(x, iec10Source(prj, "mitsubishi", files), "mitsubishi"), [], at);
        /* POU: všechny FB z Gen_Library + program ProgPou, tělo ST beze změny */
        const fbs = splitLibrary(files["Gen_Library.st"]).map(t => parseStPou(t).name);
        const xmlFbs = [...x.matchAll(/<FunctionBlock name="([^"]+)">/g)].map(m => m[1]);
        assert.deepEqual(xmlFbs, fbs, at + ": FB");
        assert.equal([...x.matchAll(/<Program name="ProgPou">/g)].length, 1, at + ": program ProgPou");
        assert.match(x, /<Resource name="MAIN" resourceTypeName="FX5CPU">[\s\S]*<ProgramInstance name="ProgPou" typeName="ProgPou" \/>/, at + ": registrace v programovém souboru MAIN");
        assert.ok(!/<BodyContent xsi:type="(?!ST")/.test(x), at + ": jen ST");
        if (files["MAIN.st"].includes("TIMER_100_FB_M")) assert.ok(x.includes("<TypeName>TIMER_100_FB_M</TypeName>"), at + ": TIMER_100_FB_M zachován");
        /* globální návěští = GlobalLabels.csv (jména v pořadí, operand X/Y), jedna sada GlobalVars v konfiguraci */
        const csv = gxGlobalLabels(files["GlobalLabels.csv"]);
        const gv = /<Configuration name="PLCdesk">[\s\S]*?<\/Resource>\s*<GlobalVars>([\s\S]*?)<\/GlobalVars>\s*<\/Configuration>/.exec(x);
        assert.ok(gv, at + ": GlobalVars v Configuration");
        assert.deepEqual([...gv![1].matchAll(/<Variable name="([^"]+)">/g)].map(m => m[1]), csv.map(g => g.name), at + ": jména globálních");
        for (const e of prj.io) assert.ok(csv.some(g => g.name === e.tag), at + ": tag " + e.tag);
        assert.equal((x.match(/<GlobalVars>/g) || []).length, 1, at + ": jedna sada GlobalVars");
        assert.ok(!/<InitialValue\b/.test(x), at + ": FX5 bez počátečních hodnot");
        assert.ok(!/<Address address="%/.test(x), at + ": operand bez %");
        /* emulátor: pravidlo iec61131_10 bez nálezu */
        if (lang === "cs" || lang === "zh") {
          const r = emulateFiles(prj, "mitsubishi", files).res;
          assert.deepEqual(r.findings.filter(q => q.rule === "iec61131_10" || q.file === IEC10_FILE), [], at + ": emulátor");
        }
      }
    }
  } finally { setLang("cs"); }
});

test("IEC 61131-10 (Mitsubishi): vstupy FB s počáteční hodnotou se předávají při každém volání (XML je FX5 nenese)", () => {
  setLang("cs");
  for (const f of SAMPLES) {
    const prj = load(f);
    if (axisBlocked(prj, "mitsubishi")) continue;
    const files = genFor(prj, "mitsubishi");
    const main = files["MAIN.st"];
    for (const t of splitLibrary(files["Gen_Library.st"])) {
      const fb = parseStPou(t).name;
      const withInit = stSections(t).filter(s => s.kind === "in").flatMap(s => s.vars).filter(v => v.init !== undefined).map(v => v.name);
      if (!withInit.length) continue;
      for (const m of main.matchAll(new RegExp("^\\s*(\\w+)\\s*:\\s*" + fb + "\\s*;", "gm"))) {
        const call = new RegExp("\\b" + m[1] + "\\s*\\(([\\s\\S]*?)\\);").exec(main.slice(main.indexOf("END_VAR")));
        assert.ok(call, f + ": volání " + m[1]);
        for (const port of withInit) assert.match(call![1], new RegExp("\\b" + port + "\\s*:="), f + ": " + m[1] + "." + port + " předán");
      }
    }
  }
});

test("IEC 61131-10: mutace — strukturní kontrola emulátoru (pravidlo iec61131_10) chytí každou odchylku", () => {
  setLang("cs");
  const prj = load("11_podavaci_lisovaci_stanice_PS-11.plcstudio.json");
  const base = genFor(prj, "mitsubishi");
  const rule = (files: Record<string, string>) => emulateFiles(prj, "mitsubishi", files).res.findings.filter(q => q.rule === "iec61131_10");
  assert.deepEqual(rule(base), [], "výchozí stav bez nálezu");
  const X = base[IEC10_FILE];
  const mut = (name: string, x: string, other: Record<string, string> = {}) => {
    assert.notEqual(x, X, name + ": mutace se projevila");
    const r = rule({ ...base, ...other, [IEC10_FILE]: x });
    assert.ok(r.length > 0 && r.every(q => q.level === "error"), name + ": nález");
    return r.map(q => q.msg).join(" | ");
  };
  mut("namespace", X.replace('xmlns="' + IEC10_NS + '"', 'xmlns="http://www.plcopen.org/xml/tc6_0201"'));
  mut("well-formed", X.replace("</Types>", ""));
  mut("pořadí hlavních prvků", X.replace(/(<FileHeader[^>]*\/>)\s*(<ContentHeader[^>]*\/>)/, "$2\n  $1"));
  mut("počáteční hodnota (FX5)", X.replace('<Variable name="statStep">\n            <Type><TypeName>INT</TypeName></Type>', '<Variable name="statStep">\n            <Type><TypeName>INT</TypeName></Type>\n            <InitialValue><SimpleValue value="0" /></InitialValue>'));
  mut("chybějící vstup FB", X.replace(/<Variable name="cmdClose" orderWithinParamSet="3">[\s\S]*?<\/Variable>\s*/, ""));
  mut("jiný typ", X.replace('<Variable name="status" orderWithinParamSet="10">\n              <Type><TypeName>WORD</TypeName>', '<Variable name="status" orderWithinParamSet="10">\n              <Type><TypeName>INT</TypeName>'));
  mut("orderWithinParamSet", X.replace('orderWithinParamSet="2"', 'orderWithinParamSet="7"'));
  mut("Vars public", X.replace('<Vars accessSpecifier="private">', '<Vars accessSpecifier="public">'));
  mut("tělo ST", X.replace("statStep := 90;", "statStep := 91;"));
  mut("tělo jiným jazykem", X.replace('<BodyContent xsi:type="ST">', '<BodyContent xsi:type="IL">'));
  mut("duplicitní POU", X.replace(/(<FunctionBlock name="FB_Ventil">[\s\S]*?<\/FunctionBlock>\n)/, "$1$1"));
  mut("chybějící POU", X.replace(/<FunctionBlock name="FB_AnalogIn">[\s\S]*?<\/FunctionBlock>\n/, ""));
  mut("globální: operand s %", X.replace('<Address address="X0" />', '<Address address="%IX0" />'));
  mut("globální: location/size", X.replace('<Address address="X0" />', '<Address location="I" size="X" address="X0" />'));
  mut("globální: dvě sady GlobalVars", X.replace(/(<Variable name="S2_in">)/, "</GlobalVars>\n      <GlobalVars>\n        $1"));
  mut("globální: chybějící návěští", X.replace(/<Variable name="S3_in">[\s\S]*?<\/Variable>\s*/, ""));
  mut("globální: kolize s POU", X.replace('<Variable name="S1_in">', '<Variable name="FB_Ventil">'));
  mut("program neregistrovaný", X.replace(/<ProgramInstance[^>]*\/>\n/, ""));
  /* tabulka návěští změněná bez XML → rozdíl */
  const csv = base["GlobalLabels.csv"].replace('"S1_in","Bit"', '"S1_in","Word [Signed]"');
  const r = rule({ ...base, "GlobalLabels.csv": csv });
  assert.ok(r.some(q => /S1_IN/.test(q.msg)), "GlobalLabels.csv × XML");
});

test("IEC 61131-10: import (reverse) — samotné XML dá platformu, I/O s operandy X/Y, program a bloky; s ST soubory program jen jednou", () => {
  setLang("cs");
  const prj = load("03_nytovaci_lis_NL-1.plcstudio.json");
  const files = genFor(prj, "mitsubishi");
  const ex = extractFiles([{ name: IEC10_FILE, text: files[IEC10_FILE] }]);
  assert.equal(ex.platform, "mitsubishi");
  assert.equal(ex.unparsed.length, 0);
  for (const e of prj.io) assert.ok(ex.signals.some(s => s.tag === e.tag), "signál " + e.tag);
  assert.ok(ex.pous.some(p => p.name === "ProgPou" && p.kind === "program"), "program");
  assert.ok(ex.pous.some(p => p.name === "FB_Ventil" && p.kind === "functionBlock"), "FB");
  const r = inferProject(ex);
  assert.deepEqual(r.prj.devices.map(d => d.name).sort(), prj.devices.map(d => d.name).sort(), "zařízení z XML");
  /* XML + MAIN.st + CSV: program ProgPou = MAIN → sekvence jednou */
  const all = inferProject(extractFiles(Object.entries(files).map(([name, text]) => ({ name, text }))));
  assert.equal(all.prj.program.seq.length, prj.program.seq.length, "kroky sekvence jednou");
});

test("IEC 61131-10 (příprava PLCnext): kód rodiny CODESYS bez GVL_IO, I/O ve zdroji bez adres, úloha a ExternalVars", () => {
  setLang("cs");
  let n = 0;
  for (const f of SAMPLES) {
    const prj = load(f);
    if (hasAxis(prj)) { assert.throws(() => iec61131_10Xml(prj, "plcnext"), /servoosa/); continue; }
    const x = iec61131_10Xml(prj, "plcnext");
    assert.deepEqual(iec10Problems(x, iec10Source(prj, "plcnext"), "plcnext"), [], f);
    assert.ok(!/GVL_IO\./.test(x), f + ": bez kvalifikace GVL_IO");
    assert.match(x, /<Resource name="PLCdesk" resourceTypeName="PLCnext">\s*<GlobalVars>/, f + ": I/O jako globální proměnné zdroje");
    assert.ok(!/<Address\b/.test(x), f + ": bez adres (propojení v Data List)");
    assert.match(x, /<Task xsi:type="StandardTask" name="Cyclic10ms" interval="T#10ms" priority="1" \/>\s*<ProgramInstance name="MAIN" typeName="MAIN" associatedTaskName="Cyclic10ms" \/>/, f + ": úloha");
    if (prj.io.length) assert.match(x, /<Program name="MAIN">[\s\S]*?<ExternalVars>/, f + ": ExternalVars");
    if (/:=\s*27648;|:=\s*0\.0;/.test(genFor(prj, "codesys")["Gen_Library.st"])) assert.ok(x.includes("<InitialValue>"), f + ": počáteční hodnoty zůstávají");
    n++;
  }
  assert.ok(n >= 12);
});

test("IEC 61131-10: validace proti XSD normy (lxml), když je XSD lokálně (IEC61131_10_XSD)", t => {
  const xsd = process.env.IEC61131_10_XSD;
  if (!xsd) { t.skip("XSD normy není k dispozici (licence IEC — nastav IEC61131_10_XSD na IEC61131_10_Ed1_0.xsd z " + IEC10_XSD.page + ")"); return; }
  assert.equal(createHash("sha256").update(readFileSync(xsd, "utf8")).digest("hex"), IEC10_XSD.sha256, "otisk XSD");
  const dir = mkdtempSync(join(tmpdir(), "iec10-"));
  try {
    let k = 0;
    for (const lang of ["cs", "zh"] as Lang[]) {
      setLang(lang);
      for (const f of SAMPLES) {
        const prj = load(f);
        const m = genFor(prj, "mitsubishi")[IEC10_FILE];
        if (m) writeFileSync(join(dir, lang + "_m_" + (k++) + ".xml"), m);
        if (!hasAxis(prj)) writeFileSync(join(dir, lang + "_p_" + (k++) + ".xml"), iec61131_10Xml(prj, "plcnext"));
      }
    }
    setLang("cs");
    /* kontrola citlivosti: chybějící povinný atribut musí XSD odmítnout */
    writeFileSync(join(dir, "bad.xml"), genFor(load(SAMPLES[2]), "mitsubishi")[IEC10_FILE].replace(' schemaVersion="1.0"', ""));
    const py = `import sys, glob, os
from lxml import etree
s = etree.XMLSchema(etree.parse(sys.argv[1]))
bad = [os.path.basename(f) for f in sorted(glob.glob(os.path.join(sys.argv[2], "*.xml"))) if not s.validate(etree.parse(f))]
print("|".join(bad))`;
    const res = execFileSync(process.env.PYTHON || "python", ["-c", py, xsd, dir], { encoding: "utf8" }).trim();
    assert.equal(res, "bad.xml", "jen úmyslně vadný soubor neprojde XSD (" + k + " souborů)");
  } finally { setLang("cs"); rmSync(dir, { recursive: true, force: true }); }
});
