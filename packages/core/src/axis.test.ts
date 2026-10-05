/**
 * Servoosa (fáze 2b): podpora platforem, validace, generování, emulace běhu a mutace FB_Axis.
 *
 * - podporované platformy (Siemens S7-1200 / S7-1500 podle CPU, Beckhoff, CODESYS, WAGO, Delta, Omron,
 *   Rockwell) překládají a běží v emulátoru beze rozdílu proti návrhu (i varianta s rychlostí / HALT),
 * - nepodporované (Mitsubishi, Schneider, Unitronics) vrací jen README s důvodem a validace hlásí chybu,
 * - mutace kódu (chybí MC_Power, bloky MC před automatem, Execute bez hrany, jiný hlídací čas regulace)
 *   emulátor odhalí jako rozdíl chování.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankProject, syncIO, validateProject, devDefaults, PLAT, type Project, type PlatformKey, type DeviceClass, type SeqStep } from "./model.js";
import { genFor } from "./codegen.js";
import { axisDialect, axisSupport, axisBlocked } from "./axis_gen.js";
import { parseAxisPositions, axisPositionsText, axisCfgOf } from "./axis.js";
import { emulateCompile, emulateRunMany, emulateRunFiles } from "./emu/index.js";
import { verifyProject } from "./sim.js";
import { setLang } from "./i18n.js";
import { CDS_PROFILES, CDS_PROFILE_KEYS } from "./codesys_profiles.js";

const SUPPORTED: PlatformKey[] = ["siemens", "beckhoff", "codesys", "omron", "rockwell", "wago", "delta"];
const BLOCKED: PlatformKey[] = ["mitsubishi", "schneider", "unitronics"];
const errs = (fs: Array<{ level: string; rule: string; file: string; line: number; msg: string }>) =>
  fs.filter(f => f.level === "error").map(f => f.rule + " " + f.file + ":" + f.line + " " + f.msg);

/** Malý pick & place se servoosou (volitelně krok rychlostí + HALT, explicitní zrychlení, CPU S7-1500). */
function axisPrj(o: { vel?: boolean; acc?: number; s15?: boolean; platforms?: PlatformKey[] } = {}): Project {
  const p = blankProject();
  p.meta.name = "Test osa";
  p.platforms = o.platforms || [...SUPPORTED];
  const add = (cls: DeviceClass, name: string, desc: string, extra: Record<string, unknown> = {}) => {
    const d = { id: p.nextId++, name, cls, desc, opt: {}, unit: "", rmin: 0, rmax: 100, ...devDefaults(cls), ...extra } as Project["devices"][number];
    p.devices.push(d); return d;
  };
  const es = add("DI", "S1", "Nouzove zastaveni (NC)");
  const ax = add("Axis", "M1", "Osa X", { unit: "mm", axis: { vMax: 800, aMax: 4000, dMax: 4000, vDef: 400, limNeg: -5, limPos: 600, homePos: 0, posTol: 0.1, followMax: 5, jogVel: 50, startPos: 120,
    positions: [{ name: "prevzeti", pos: 50 }, { name: "odlozeni", pos: 450 }] } });
  const y1 = add("Ventil", "Y1", "Chapadlo", { opt: { fbkOpen: true, fbkClosed: true } });
  const y2 = add("Ventil", "Y2", "Zdvih", { opt: { fbkOpen: true, fbkClosed: true } });
  syncIO(p);
  for (const e of p.io) if (e.devId === es.id) e.nc = true;
  p.program.estop = es.id;
  const S = (dev: number, act: SeqStep["act"], extra: Partial<SeqStep> = {}): SeqStep => ({ dev, act, cond: "fbk", timeS: 5, ...extra });
  p.program.seq = [
    S(ax.id, "home"),
    S(ax.id, "moveAbs", { posRef: "prevzeti" }),
    S(y2.id, "open"), S(y1.id, "open"), S(y2.id, "close"),
    S(ax.id, "moveAbs", { posRef: "odlozeni", vel: 600, cond: "time", timeS: 0.2 }),
    S(ax.id, "waitInPos"),
    S(y2.id, "open"), S(y1.id, "close"), S(y2.id, "close"),
    S(ax.id, "moveRel", { pos: -100 }),
    ...(o.vel ? [S(ax.id, "velocity", { vel: -100 }), { dev: 0, act: "wait", cond: "time", timeS: 0.3 } as SeqStep, S(ax.id, "halt")] : []),
    S(ax.id, "moveAbs", o.acc ? { pos: 50, acc: o.acc } : { pos: 50 }),
  ];
  if (o.s15) p.bom = { plat: "siemens", brand: { "plc_cpu@siemens": "Siemens · 6ES7511-1AL03-0AB0" } };
  return p;
}

function sample12(): Project {
  const raw = JSON.parse(readFileSync(new URL("../../../samples/12_portalovy_manipulator_PM-12.plcstudio.json", import.meta.url), "utf8"));
  const prj = Object.assign(blankProject(), raw.prj) as Project;
  syncIO(prj);
  return prj;
}

test("osa: podpora platforem a dialekty (Siemens podle CPU)", () => {
  setLang("cs");
  const p = axisPrj();
  assert.deepEqual(Object.fromEntries((Object.keys(PLAT) as PlatformKey[]).map(k => [k, axisDialect(p, k)])), {
    siemens: "s12", beckhoff: "tc", codesys: "sm3", wago: "sml", delta: "sm3", omron: "om", rockwell: "lx",
    mitsubishi: null, schneider: null, unitronics: null,
    /* profily CODESYS dalších výrobců: SM3 jen kde výrobce dokládá SoftMotion (codesys_profiles.ts) */
    ...Object.fromEntries(CDS_PROFILE_KEYS.map(k => [k, CDS_PROFILES[k].axis])),
  });
  for (const k of CDS_PROFILE_KEYS.filter(k => !CDS_PROFILES[k].axis)) assert.ok(axisSupport(axisPrj(), k).why.length > 40, k + ": důvod nepodpory osy");
  assert.equal(axisDialect(axisPrj({ s15: true }), "siemens"), "s15", "CPU S7-1500 z kusovníku → technologické objekty S7-1500");
  for (const k of BLOCKED) {
    const s = axisSupport(p, k);
    assert.equal(s.ok, false);
    assert.ok(s.why.length > 40, k + ": důvod");
    assert.ok(axisBlocked(p, k));
  }
});

test("osa: nepodporovaná platforma = jen README s důvodem, validace hlásí chybu, emulátor nic nepřekládá", () => {
  setLang("cs");
  for (const k of BLOCKED) {
    const p = axisPrj({ platforms: [...SUPPORTED, k] });
    const out = genFor(p, k);
    assert.deepEqual(Object.keys(out), ["README.txt"], k);
    assert.ok(out["README.txt"].includes(axisSupport(p, k).why), k + ": README uvádí důvod");
    assert.ok(validateProject(p).some(i => i.level === "error" && i.msg.includes(PLAT[k].name)), k + ": validace");
    const c = emulateCompile(p, k);
    assert.equal(c.ok, false);
    assert.deepEqual(c.findings.map(f => f.rule), ["axis-unsupported"]);
    assert.ok(emulateRunMany(p, [k])[k]!.skipped);
  }
  assert.deepEqual(validateProject(axisPrj()).filter(i => i.level === "error"), [], "podporované platformy bez chyb");
});

test("osa: validace kroků (poloha, S7-1200 bez dynamiky v kroku, Rockwell bez jízdy rychlostí)", () => {
  setLang("cs");
  const p = axisPrj({ acc: 3000, platforms: ["siemens"] });
  assert.ok(validateProject(p).some(i => i.level === "error" && /S7-1200/.test(i.msg)), "S7-1200: zrychlení v kroku");
  assert.deepEqual(validateProject(axisPrj({ acc: 3000, s15: true, platforms: ["siemens"] })).filter(i => i.level === "error"), [], "S7-1500 zrychlení v kroku umí");
  assert.ok(validateProject(axisPrj({ vel: true, platforms: ["rockwell"] })).some(i => i.level === "error"), "Rockwell: velocity");
  const q = axisPrj({ platforms: ["codesys"] });
  q.program.seq[1].posRef = "neni";
  assert.ok(validateProject(q).some(i => i.level === "error" && /neni/.test(i.msg)), "neznámá pojmenovaná poloha");
});

test("osa: pojmenované polohy text ↔ seznam, výchozí konfigurace", () => {
  assert.deepEqual(parseAxisPositions("vstup @ 20; výstup = 580,5\nkontrola: -3; vstup @ 99; nesmysl"),
    [{ name: "vstup", pos: 20 }, { name: "výstup", pos: 580.5 }, { name: "kontrola", pos: -3 }]);
  assert.equal(axisPositionsText([{ name: "a", pos: 1 }, { name: "b", pos: 2.5 }]), "a @ 1; b @ 2.5");
  const c = axisCfgOf({ axis: { vMax: 1000 } } as never);
  assert.equal(c.vDef, 500); assert.equal(c.dMax, c.aMax); assert.equal(c.jogVel, 100);
});

test("osa: varianty projektu (rychlost + HALT, S7-1500 se zrychlením v kroku) — překlad i běh = návrh", () => {
  setLang("cs");
  const cases: Array<[string, Project]> = [
    ["velocity", axisPrj({ vel: true, platforms: SUPPORTED.filter(k => k !== "rockwell") })],
    ["s15", axisPrj({ vel: true, acc: 3000, s15: true, platforms: ["siemens"] })],
    ["základ", axisPrj()],
  ];
  for (const [name, p] of cases) {
    assert.deepEqual(validateProject(p).filter(i => i.level === "error").map(i => i.msg), [], name + ": validace");
    for (const k of p.platforms) assert.deepEqual(errs(emulateCompile(p, k).findings), [], name + " / " + k + ": překlad");
    const r = emulateRunMany(p, p.platforms, { scope: "full" });
    for (const k of p.platforms) {
      const x = r[k]!;
      assert.equal(x.skipped, undefined, name + " / " + k);
      assert.deepEqual(x.diffs.map(d => d.label + " t=" + d.t + " " + d.msg), [], name + " / " + k + ": běh");
      assert.deepEqual((x.runtime || []).map(e => e.msg), [], name + " / " + k + ": běhové chyby");
    }
  }
});

test("osa: ověření vzoru 12 — scénáře osy (porucha pohonu, komunikace, nepřipravený pohon, chyba sledování) bez chyb", () => {
  setLang("cs");
  const v = verifyProject(sample12());
  assert.deepEqual(v.checks.filter(c => c.level === "error").map(c => c.title), []);
  for (const id of ["fault-", "comm-", "notready-"]) assert.ok(v.checks.some(c => c.scenario?.startsWith(id) && c.level === "ok"), id);
  assert.ok(v.matrix.cols.some(c => c.id === "comm"), "matice: sloupec ztráty komunikace");
  assert.equal(v.matrix.failed, 0);
});

/* ------------------------------------------------------------------ mutace */

const MUT: Record<string, (s: string) => string> = {
  "chybí volání MC_Power": s => s.replace(/^.*(instPower\(|MSO\().*$/gm, ""),
  "bloky MC před automatem (výstupy o cyklus napřed)": s => {
    const m = s.match(/^\s*instPower\([\s\S]*?^\s*instReset\(.*\);\s*$/m);
    return m ? s.replace(m[0], "").replace(/^\(\* stav osy[^\n]*\n/m, x => m[0] + "\n" + x) : s;
  },
  "Execute bez hrany (trvale TRUE)": s => s.replace(/Execute := #?exAbs/g, "Execute := TRUE"),
  "jiný hlídací čas regulace (T#50S)": s => s.replace(/(tonPower\(IN := \(statStep = 10\), PT := )T#5S/g, "$1T#50S"),
};

test("osa: mutace FB_Axis emulátor odhalí (CODESYS všechny, ostatní chybějící MC_Power / Execute bez hrany)", () => {
  setLang("cs");
  const prj = sample12();
  const run = (plat: PlatformKey, name: string) => {
    const files = genFor(prj, plat);
    const mut = Object.fromEntries(Object.entries(files).map(([n, b]) => [n, /README/.test(n) ? b : MUT[name](b)]));
    assert.ok(JSON.stringify(mut) !== JSON.stringify(files), plat + " / " + name + ": mutace se neuplatnila");
    const r = emulateRunFiles(prj, plat, mut, { scope: "full" });
    assert.ok(r.skipped || r.diffs.length > 0, plat + " / " + name + ": emulátor změnu chování neodhalil");
  };
  for (const name of Object.keys(MUT)) run("codesys", name);
  for (const plat of ["siemens", "beckhoff", "omron", "rockwell", "wago", "delta"] as PlatformKey[]) {
    run(plat, "chybí volání MC_Power");
    if (plat !== "rockwell") run(plat, "Execute bez hrany (trvale TRUE)");
  }
  /* kontrola: nezměněný kód projde (mutace měří změnu, ne stav) */
  const ok = emulateRunFiles(prj, "codesys", genFor(prj, "codesys"), { scope: "full" });
  assert.deepEqual(ok.diffs, []);
});
