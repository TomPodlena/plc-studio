/**
 * Profily CODESYS dalších výrobců (codesys_profiles.ts): základ codesys, rodina CODESYS, OOP podle verze
 * CODESYS, adresy (bez AT = I/O mapování), kód shodný s CODESYS (jen hlavička / rawMax / AT), README s postupem
 * IDE, osa (SM3 / důvod), kusovník z katalogu s ověřenými kódy a sestava hardwaru pro všechny příklady,
 * export HMI jako CODESYS, round-trip importu, emulátor (překlad bez chyb, běh = návrh).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PLAT, platBase, isCodesysFamily, supportsOop, codeStyleFor, addrFor, syncIO, blankProject, validateProject, type Project, type PlatformKey } from "./model.js";
import { genFor } from "./codegen.js";
import { CDS_PROFILES, CDS_PROFILE_KEYS, cdsProfile } from "./codesys_profiles.js";
import { sampleSmall, sampleComplex } from "./samples.js";
import { extractFiles, inferProject } from "./reverse.js";
import { xmlProblems } from "./logix.js";
import { hmiFiles, hmiExportSpec } from "./hmi_export.js";
import { buildBom } from "./bom.js";
import { hwLayout } from "./hardware.js";
import { brandsFor } from "./catalog.js";
import { PLATFORM_REFS } from "./platform_refs.js";
import { axisSupport, axisBlocked } from "./axis_gen.js";
import { emulateCompile, emulateRunMany } from "./emu/index.js";
import { DIALECTS } from "./emu/dialects.js";
import { setLang } from "./i18n.js";

const SAMPLE_DIR = new URL("../../../samples/", import.meta.url);
const KEYS = CDS_PROFILE_KEYS as PlatformKey[];
/* příklady 00–12 (rozpracované vzory s vyšším číslem se v tomto testu neberou) */
const samples = () => readdirSync(SAMPLE_DIR).filter(f => /^(0\d|1[0-2])[a-z]?_.*\.plcstudio\.json$/.test(f)).sort();
const load = (f: string): Project => {
  const raw = JSON.parse(readFileSync(new URL(f, SAMPLE_DIR), "utf8"));
  const p = Object.assign(blankProject(), raw.prj || raw) as Project;
  syncIO(p);
  return p;
};
const errs = (fs: Array<{ level: string; rule: string; file: string; line: number; msg: string }>) =>
  fs.filter(f => f.level === "error").map(f => f.rule + " " + f.file + ":" + f.line + " " + f.msg);

test("profily CODESYS: PLAT s base codesys, rodina CODESYS, OOP jen od CODESYS SP13 (Inovance ne), dialekt emulátoru", () => {
  setLang("cs");
  for (const k of KEYS) {
    const pr = cdsProfile(k)!;
    assert.ok(PLAT[k], k);
    assert.equal(platBase(k), "codesys", k);
    assert.ok(isCodesysFamily(k), k);
    assert.equal(supportsOop(k), pr.oop, k);
    assert.equal(DIALECTS[k].plat, k);
    assert.equal(!!DIALECTS[k].oop, pr.oop, k + ": dialekt OOP");
    assert.ok(hmiExportSpec(k), k + ": export HMI");
  }
  assert.equal(supportsOop("inovance"), false, "InoProShop: verze CODESYS nedoložena (SP11 dle třetí strany)");
  const p = { ...sampleSmall(), codeStyle: "oop" as const };
  assert.equal(codeStyleFor(p, "inovance"), "classic", "starý CODESYS: OOP se negeneruje");
  assert.equal(codeStyleFor(p, "festo"), "oop");
});

test("profily CODESYS: kód shodný s CODESYS (hlavička, rawMax, AT), README s postupem IDE, adresy přes I/O mapování", () => {
  setLang("cs");
  const p = sampleComplex();
  const c = genFor(p, "codesys");
  const norm = (s: string) => s.replace(/ - [^\n]*? \*\)/g, " - X *)").replace(/rawMax := \d+/g, "rawMax := N").replace(/(AT )?%[IQ][XW][\d.]+/g, "").replace(/[ \t]+/g, " ");
  for (const k of KEYS) {
    const pr = CDS_PROFILES[k as keyof typeof CDS_PROFILES];
    const f = genFor(p, k);
    assert.deepEqual(Object.keys(f).sort(), Object.keys(c).sort(), k + ": stejná sada souborů");
    assert.equal(norm(f["Gen_Library.st"]), norm(c["Gen_Library.st"]), k + ": knihovna");
    assert.equal(norm(f["MAIN.st"]), norm(c["MAIN.st"]), k + ": MAIN");
    assert.ok(f["MAIN.st"].includes(" - " + pr.name + " *)"), k + ": hlavička");
    assert.ok(f["MAIN.st"].includes("rawMax := " + pr.rawMax), k + ": rawMax");
    assert.deepEqual(xmlProblems(f["PLCopen_Import.xml"]), [], k);
    const e = p.io.find(x => x.dir === "DI")!;
    if (pr.at) { assert.equal(addrFor(k, e, p), addrFor("codesys", e, p)); assert.match(f["GVL_IO.st"], /AT %IX/); }
    else { assert.equal(addrFor(k, e, p), ""); assert.doesNotMatch(f["GVL_IO.st"], /\bAT\b/, k + ": GVL bez pevných adres"); }
    const rd = f["README.txt"];
    assert.ok(rd.includes(pr.title), k + ": nadpis README");
    assert.ok(rd.includes(pr.imp), k + ": import PLCopen v IDE");
    assert.match(rd, /MainTask/, k + ": krok s úlohou");
    assert.match(rd, /rawMax/, k + ": rawMax v README");
    if (!pr.rawMod) assert.match(rd, /NEOVĚŘENÝ odhad/, k + ": neověřený rozsah analogu výrazně");
    if (pr.old) assert.match(rd, /STARŠÍ CODESYS/, k);
  }
});

test("profily CODESYS: servoosa — SM3 jen kde ji výrobce dokládá, jinak důvod a kód se negeneruje", () => {
  setLang("cs");
  const prj = load("12_portalovy_manipulator_PM-12.plcstudio.json");
  for (const k of KEYS) {
    const s = axisSupport(prj, k);
    if (CDS_PROFILES[k as keyof typeof CDS_PROFILES].axis) {
      assert.equal(s.dialect, "sm3", k);
      const f = genFor(prj, k);
      assert.match(f["Gen_Library.st"], /AXIS_REF_SM3/, k);
      assert.match(hwLayout(prj, k).drives[0]?.net || "", /EtherCAT/, k + ": síť pohonu");
    } else {
      assert.equal(s.ok, false, k);
      assert.ok(s.why.length > 40, k + ": důvod");
      assert.ok(axisBlocked(prj, k), k);
      assert.deepEqual(Object.keys(genFor(prj, k)), ["README.txt"], k + ": jen README s důvodem");
    }
  }
});

test("profily CODESYS: katalog (CPU + DI/DO/AI/AO s ověřeným kódem a zdrojem), sestava všech příkladů bez „nevejde se“, odkazy", () => {
  setLang("cs");
  for (const k of KEYS) {
    for (const cat of ["plc_cpu", "plc_di", "plc_do", "plc_ai", "plc_ao"]) {
      const opts = brandsFor(cat, k);
      assert.ok(opts.length, k + ": " + cat);
      for (const o of opts) if (o.orderCode) assert.ok(/^https?:\/\//.test(o.src || ""), k + " " + cat + " " + o.orderCode + ": kód bez zdroje");
      if (cat !== "plc_cpu") assert.ok(opts.some(o => o.hw?.ch && o.hw.bus), k + ": " + cat + " s kanály pro sestavu");
    }
    assert.ok(PLATFORM_REFS[k]?.length >= 2, k + ": odkazy na dokumentaci");
    for (const f of samples()) {
      const p = load(f);
      p.platforms = [k];
      const L = hwLayout(p, k);
      assert.deepEqual(L.overflow.map(e => e.tag), [], k + " / " + f + ": signály bez kanálu");
      assert.deepEqual(validateProject(p).filter(i => i.level === "error" && !/servoos|osa |osy /i.test(i.msg)).map(i => i.msg), [], k + " / " + f);
    }
    const p = sampleComplex(); p.platforms = [k];
    const b = buildBom(p);
    assert.equal(b.plat, k);
    assert.ok(b.lines.find(l => l.cat === "plc_cpu")?.orderCode, k + ": CPU z katalogu");
    for (const l of b.lines.filter(x => x.cat.startsWith("plc_") && x.orderCode)) assert.ok(l.src && /^https?:/.test(l.src), k + " " + l.cat + ": kód má zdroj");
    const h = hmiFiles(p, k);
    assert.ok(h["Symbolconfiguration_PLCdesk.xml"] && h["README_HMI.txt"], k + ": HMI export jako CODESYS");
  }
});

test("profily CODESYS: import vlastního výstupu pozná platformu (hlavička) a vrátí stejný projekt", () => {
  setLang("cs");
  const p = sampleSmall();
  for (const k of KEYS) {
    const files = Object.entries(genFor(p, k)).map(([name, text]) => ({ name, text }));
    const ex = extractFiles(files);
    assert.equal(ex.platform, k, k + ": platforma z hlavičky");
    const r = inferProject(ex);
    assert.deepEqual(r.prj.devices.map(d => d.name + ":" + d.cls), p.devices.map(d => d.name + ":" + d.cls), k);
  }
});

test("profily CODESYS: emulátor — překlad bez chyb a běh kódu = návrh (malý a velký příklad, klasika i OOP)", () => {
  setLang("cs");
  for (const p0 of [sampleSmall(), sampleComplex()]) for (const style of ["classic", "oop"] as const) {
    const p = { ...p0, codeStyle: style };
    for (const k of KEYS) assert.deepEqual(errs(emulateCompile(p, k).findings), [], k + " " + style);
    const r = emulateRunMany(p, KEYS);
    for (const k of KEYS) assert.deepEqual(r[k]!.diffs.map(d => d.scenario + " " + d.msg), [], k + " " + style);
  }
});
