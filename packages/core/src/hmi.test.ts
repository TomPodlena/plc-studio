/** Testy HMI vrstvy (hmi.ts, hmi_view.ts, hmi_export.ts, hmi_docs.ts) — node:test, bez závislostí. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { syncIO, PLAT, stripDia, type Project, type PlatformKey } from "./model.js";
import { genFor } from "./codegen.js";
import { axisBlocked } from "./axis_gen.js";
import { xmlProblems } from "./logix.js";
import { LANGS, withLang, type Lang } from "./i18n.js";
import { docFiles, allProjectFiles } from "./docs.js";
import { sampleSmall } from "./samples.js";
import { buildHmi, alarmRows, hmiPlcPath, type HmiModel, type HmiTag } from "./hmi.js";
import { hmiScreenSVG, hmiJson, hmiWebHtml, HMI_JSON_FORMAT } from "./hmi_view.js";
import { hmiFiles, hmiExportSpec } from "./hmi_export.js";
import { hmiDocMd, registerHmiModule, unregisterHmiModule, HMI_DOC_FILE } from "./hmi_docs.js";

const SAMPLE_DIR = new URL("../../../samples/", import.meta.url);   // dist/ → kořen repozitáře
const sampleNames = (): string[] => readdirSync(SAMPLE_DIR).filter(n => n.endsWith(".plcstudio.json")).sort();
function loadSample(name: string): Project {
  const j = JSON.parse(readFileSync(new URL(name, SAMPLE_DIR), "utf8"));
  const p: Project = j.prj || j;
  syncIO(p);
  return p;
}
/** Obsah projektu (názvy, popisy, komentáře) se nepřekládá → pro kontrolu češtiny přepis do ASCII. */
function asciiContent(p: Project): Project {
  const q: Project = JSON.parse(JSON.stringify(p));
  q.meta.name = stripDia(q.meta.name || ""); q.meta.desc = stripDia(q.meta.desc || "");
  for (const d of q.devices) { d.desc = stripDia(d.desc || ""); d.unit = stripDia(d.unit || ""); for (const r of d.records || []) r.name = stripDia(r.name || ""); }   // i názvy záznamů pohonu (obsah projektu)
  for (const e of q.io) e.cmt = stripDia(e.cmt || "");
  q.concept = null;
  return q;
}
const ALL = Object.keys(PLAT) as PlatformKey[];
const CZ = /[ěščřžůďťňĚŠČŘŽŮĎŤŇ]/;

/* ------------------------------------------------ deklarace generovaného programu */

interface Decls { machine: Map<string, string>; fb: Map<string, Set<string>>; io: Set<string>; flat?: Set<string>; }

/** Deklarace z ST/SCL: `název : typ` v daném úseku. */
function declsIn(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of text.matchAll(/^\s*(\w+)\s*(?:AT\s+\S+\s*)?:\s*"?(\w+)"?/gm)) m.set(x[1], x[2]);
  return m;
}
/** Vstupy a výstupy bloků knihovny (FUNCTION_BLOCK FB_x … poslední END_VAR). */
function fbDecls(lib: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const part of lib.split(/^FUNCTION_BLOCK /m).slice(1)) {
    const name = part.match(/^"?(\w+)"?/)![1];
    const head = part.slice(0, part.lastIndexOf("END_VAR") + 7);
    const vars = new Set<string>();
    for (const sec of head.matchAll(/VAR_(?:INPUT|OUTPUT)\s*\n([\s\S]*?)END_VAR/g)) for (const k of declsIn(sec[1]).keys()) vars.add(k);
    out.set(name, vars);
  }
  return out;
}
function programDecls(p: Project, plat: PlatformKey): Decls {
  const f = genFor(p, plat);
  if (plat === "unitronics") {
    const flat = new Set(f["Tags.csv"].split("\n").slice(1).map(l => l.split(",")[0].replace(/"/g, "")));
    return { machine: new Map(), fb: new Map(), io: flat, flat };
  }
  if (plat === "rockwell") {
    const x = f["PLCdesk_Program.L5X"];
    const prog = x.slice(x.indexOf("<Programs"));
    const ctrl = x.slice(x.indexOf('<Tags Use="Context">'), x.indexOf("<Programs"));
    const machine = new Map<string, string>();
    for (const t of prog.matchAll(/<Tag Name="(\w+)"[^>]*DataType="(\w+)"/g)) machine.set(t[1], t[2]);
    const fb = new Map<string, Set<string>>();
    for (const a of x.matchAll(/<AddOnInstructionDefinition [^>]*Name="(\w+)"[\s\S]*?<\/AddOnInstructionDefinition>/g)) {
      fb.set(a[1], new Set([...a[0].matchAll(/<Parameter Name="(\w+)"/g)].map(q => q[1])));
    }
    return { machine, fb, io: new Set([...ctrl.matchAll(/<Tag Name="(\w+)"/g)].map(q => q[1])) };
  }
  if (plat === "siemens") {
    const main = f["Gen_Main.scl"];
    return {
      machine: declsIn(main.slice(main.indexOf('FUNCTION_BLOCK "FB_Machine"'), main.indexOf("\nBEGIN"))),
      fb: fbDecls(f["Gen_Library.scl"] || ""),
      io: new Set(f["Gen_Tags.tsv"].replace(/^﻿/, "").split("\n").slice(1).map(l => l.split("\t")[0])),
    };
  }
  const main = f["MAIN.st"];
  const tagFile = f["GVL_IO.st"] || f["GlobalLabels.csv"] || f["Variables.txt"];
  const io = f["GVL_IO.st"] ? new Set(declsIn(tagFile.slice(tagFile.indexOf("VAR_GLOBAL"))).keys())
    : f["GlobalLabels.csv"] ? new Set(tagFile.split("\n").slice(1).map(l => l.split(",")[0].replace(/"/g, "")))
    : new Set(tagFile.split("\n").map(l => l.split("\t")[0]));
  const machine = declsIn(main.slice(main.indexOf("PROGRAM MAIN"), main.indexOf("END_VAR")));
  /* Mitsubishi / Omron: HMI čte jen globální — řízení stroje a stav bloků jsou v souboru tagů,
     stav bloků MAIN zapisuje (zrcadlo instX_port := instX.port) */
  if (plat === "mitsubishi" || plat === "omron") {
    const written = new Set([...main.matchAll(/^\s*(\w+)\s*:=/gm)].map(m => m[1]));
    const flat = new Set([...io].filter(n => !/^inst\w+_\w+$/.test(n) || written.has(n)));
    return { machine, fb: fbDecls(f["Gen_Library.st"]), io, flat };
  }
  return { machine, fb: fbDecls(f["Gen_Library.st"]), io };
}

/** Existuje proměnná, na kterou tag HMI ukazuje, v programu platformy? */
function tagInProgram(d: Decls, t: HmiTag, plat: PlatformKey): string | null {
  if (t.src === "io") return d.io.has(t.member) ? null : "I/O tag " + t.member + " chybí v souboru tagů";
  if (d.flat) return d.flat.has(hmiPlcPath(plat, t)) ? null : "tag " + hmiPlcPath(plat, t) + " chybí v Tags.csv";
  const [root, sub] = t.member.split(".");
  const type = d.machine.get(root);
  if (!type) return "proměnná " + root + " není deklarovaná ve strojním bloku";
  if (sub) {
    const vars = d.fb.get(type);
    if (!vars || !vars.has(sub)) return "člen " + sub + " není vstup/výstup bloku " + type;
  }
  return null;
}

/* ------------------------------------------------------------------ testy */

test("HMI: model malé ukázky — tagy, alarmy = seznam alarmů, obrazovky", () => {
  const p = sampleSmall();
  const m = buildHmi(p);
  const names = m.tags.map(t => t.name);
  assert.equal(new Set(names.map(n => n.toLowerCase())).size, names.length, "názvy tagů unikátní");
  for (const n of ["enable", "modeAuto", "cmdAutoStart", "cmdAck", "machineFault", "seqStep", "faultStep"]) assert.ok(names.includes(n), n);
  assert.deepEqual(m.alarms.flatMap(a => a.codes).sort(), alarmRows(p).map(r => r.code).sort());
  assert.deepEqual([...new Set(m.screens.map(s => s.kind))], ["overview", "manual", "sequence", "alarms", "params"]);
  const svg = m.screens.map(hmiScreenSVG).join("");
  for (const d of p.devices) assert.ok(svg.includes('data-dev="' + d.name + '"'), "data-dev " + d.name);
  assert.ok(svg.includes("data-screen="), "navigace");
});

test("HMI: přihlášení modulu přidá 16_hmi.md a soubory HMI, odhlášení vrátí sadu", () => {
  const p = sampleSmall();
  p.platforms = ["siemens", "rockwell", "codesys"];
  const n = docFiles(p).length;
  const off = registerHmiModule();
  try {
    assert.ok(docFiles(p).some(f => f.path === HMI_DOC_FILE));
    const all = allProjectFiles(p);
    assert.ok(all.some(f => f.save === "hmi_web.html"));
    assert.ok(all.some(f => f.save === "hmi_screens.json"));
    assert.ok(all.some(f => f.save.startsWith("hmi_siemens_")) && all.some(f => f.save.startsWith("hmi_rockwell_")) && all.some(f => f.save.startsWith("hmi_codesys_")));
  } finally { off(); }
  assert.equal(docFiles(p).length, n);
  unregisterHmiModule();
});

test("HMI: všechny příklady × platformy × jazyky — tagy v programu, alarmy, ASCII, překlad", () => {
  const names = sampleNames();
  assert.ok(names.length >= 12, "příklady v samples/");
  for (const name of names) {
    const orig = loadSample(name);
    /* servoosa: platformy bez podpory osy kód negenerují (jen README) — HMI pro ně nemá program */
    const PL = ALL.filter(pl => !axisBlocked(orig, pl));
    orig.platforms = PL;
    const codes = alarmRows(orig).map(r => r.code).sort();
    /* deklarace programu nezávisí na jazyce (jen komentáře) — stačí jednou */
    const decls = Object.fromEntries(PL.map(pl => [pl, programDecls(orig, pl)])) as Record<PlatformKey, Decls>;
    for (const l of Object.keys(LANGS) as Lang[]) withLang(l, () => {
      const where = name + " / " + l;
      const p = l === "cs" ? orig : asciiContent(orig);
      p.platforms = PL;
      const m: HmiModel = buildHmi(p);
      /* tagy */
      const tn = m.tags.map(t => t.name);
      assert.equal(new Set(tn.map(n => n.toLowerCase())).size, tn.length, where + ": duplicitní tag");
      for (const t of m.tags) assert.match(t.name, /^[A-Za-z_]\w*$/, where + ": název tagu " + t.name);
      for (const pl of PL) for (const t of m.tags) {
        const err = tagInProgram(decls[pl], t, pl);
        assert.ok(!err, where + " / " + pl + ": " + err);
      }
      /* alarmy = seznam alarmů (každý kód právě jednou), spouštěcí tag existuje */
      assert.deepEqual(m.alarms.flatMap(a => a.codes).sort(), codes, where + ": alarmy ≠ seznam alarmů");
      for (const a of m.alarms) assert.ok(tn.includes(a.trigger.tag), where + ": spouštěcí tag " + a.trigger.tag);
      assert.equal(new Set(m.alarms.map(a => a.name)).size, m.alarms.length, where + ": duplicitní název alarmu");
      /* výstupy */
      const outs: Array<[string, string]> = [
        ["16_hmi.md", hmiDocMd(p, m)], ["hmi_web.html", hmiWebHtml(p, m)], ["hmi_screens.json", hmiJson(p, m)],
        ...m.screens.map((s): [string, string] => ["hmi_" + s.id + ".svg", hmiScreenSVG(s)]),
      ];
      const j = JSON.parse(outs[2][1]);
      assert.equal(j.format, HMI_JSON_FORMAT);
      for (const [n, b] of outs.slice(3)) assert.deepEqual(xmlProblems(b), [], where + " / " + n + ": SVG");
      for (const pl of PL) {
        const spec = hmiExportSpec(pl);
        const files = hmiFiles(p, pl, m);
        if (spec) for (const f of spec.files) assert.ok(f.name in files, where + " / " + pl + ": chybí " + f.name);
        for (const [n, b] of Object.entries(files)) {
          const fs = spec?.files.find(f => f.name === n);
          if (fs?.ascii) assert.ok(!/[^\x00-\x7F]/.test(b), where + " / " + pl + " / " + n + ": musí být ASCII");
          if (/\.xml$/i.test(n)) assert.deepEqual(xmlProblems(b.replace(/^﻿/, "")), [], where + " / " + pl + " / " + n + ": XML");
          for (const t of m.tags.filter(t => t.src === "machine")) if (fs?.paths) assert.ok(b.includes(fs.paths(t, pl)), where + " / " + pl + " / " + n + ": chybí tag " + t.name);
          outs.push(["hmi_" + pl + "_" + n, b]);
        }
      }
      for (const [n, b] of outs) {
        const left = b.match(/\{[a-z][A-Za-z]*\}/);
        if (/\.(md|txt|csv)$/.test(n)) assert.ok(!left, where + " / " + n + ": nevyplněný zástupný znak " + (left && left[0]));
        if (l !== "cs") {
          const c = b.match(CZ);
          assert.ok(!c, where + " / " + n + ": nepřeložený český text kolem „" + (c ? b.slice(Math.max(0, c.index! - 50), c.index! + 30) : "") + "“");
        }
      }
    });
  }
});

test("HMI Mitsubishi / Omron: řízení stroje a stav bloků jsou globální s atributem pro HMI, MAIN je zapisuje", () => {
  const p = sampleSmall();
  p.platforms = ["mitsubishi", "omron", "codesys"];
  const m = buildHmi(p);
  for (const plat of ["mitsubishi", "omron"] as PlatformKey[]) {
    const f = genFor(p, plat);
    const main = f["MAIN.st"], vars = main.slice(main.indexOf("PROGRAM MAIN"), main.indexOf("END_VAR"));
    for (const n of ["enable", "modeAuto", "cmdAutoStart", "cmdAck", "machineFault", "faultStep", "seqStep", "manRun_M1"])
      assert.ok(!new RegExp("^\\s*" + n + "\\s*:", "m").test(vars), plat + ": " + n + " nesmí být lokální");
    assert.match(vars, /tonSeq\d+ : TON;/, plat + ": časovače kroků zůstávají lokální");
    assert.match(main, /^\s*instM1_status := instM1\.status;$/m, plat + ": zrcadlo stavu bloku");
    if (plat === "mitsubishi") {
      const csv = f["GlobalLabels.csv"].split("\n");
      assert.match(csv[0], /,"Access from External Device"$/);
      assert.ok(csv.slice(1).every(l => l.endsWith(',"1"')), "Access from External Device = 1");
      assert.ok(csv.some(l => l.startsWith('"modeAuto","Bit","VAR_GLOBAL"')));
      assert.ok(csv.some(l => l.startsWith('"instM1_status","Word [Unsigned]/Bit String [16-bit]","VAR_GLOBAL"')));
    } else {
      const rows = f["Variables.txt"].split("\n").map(l => l.split("\t"));
      assert.ok(rows.every(r => r.length === 8 && r[6] === "Publish Only"), "Network Publish = Publish Only");
      assert.ok(rows.some(r => r[0] === "seqStep" && r[1] === "INT"));
    }
    /* cesty HMI = globální jména; README_HMI bez ručního přesunu do globálních */
    assert.equal(hmiPlcPath(plat, m.tags.find(x => x.member === "instM1.status")!), "instM1_status");
    assert.equal(hmiPlcPath(plat, m.tags.find(x => x.member === "modeAuto")!), "modeAuto");
    assert.doesNotMatch(hmiFiles(p, plat)["README_HMI.txt"], /přesuň/);
  }
  /* ostatní platformy beze změny: řízení v MAIN */
  assert.match(genFor(p, "codesys")["MAIN.st"], /^\s*modeAuto : BOOL;/m);
  assert.equal(hmiPlcPath("codesys", m.tags.find(x => x.member === "modeAuto")!), "MAIN.modeAuto");
});
