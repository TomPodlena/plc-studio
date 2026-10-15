/**
 * Export pro CAD (cad.ts, formát plcdesk-cad v2 podle MANIFEST_SCHEMA.md): všechny vzory → manifest
 * se všemi klíči a typy, id unikátní, odkazy plc / relations na existující díly, každá kategorie
 * zařazená, díly = řádky kusovníku, moduly PLC = sestava hardwaru (nad synchronizovanými I/O),
 * GUID stabilní a jen ze vstupu, zadání (zařízení, sekvence, bezpečnost, revize), determinismus;
 * projektová složka.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Project } from "./model.js";
import { isGuid } from "./guid.js";
import { createRevision } from "./revision.js";
import { renameDevice } from "./edit.js";
import { buildBom } from "./bom.js";
import { hwLayout } from "./hardware.js";
import { CAT_LABEL, CATALOG } from "./catalog.js";
import { cadManifest, cadManifestJson, cadProject, CAD_PLACEMENT, CAD_FILE, type CadManifest } from "./cad.js";
import { projectFileFolder, projectBundle, PROJECT_DIRS } from "./project_folder.js";
import { registerSafetyModule } from "./safety.js";
import "./safety_docs.js";
import { sampleSmall, sampleComplex } from "./samples.js";
import { projectGate, entitlements, licenseFileKind, applyLicenseToFile } from "./license.js";
import { sampleNames, loadSampleFile, SAMPLE_DIR } from "./exp_util.test.js";
import { readFileSync } from "node:fs";
import { blankProject } from "./model.js";

/** Vzor tak, jak je uložený (bez `syncIO` — příklady mají `io: []`), jako ho klient předá exportu. */
function loadRaw(name: string): Project {
  const raw = JSON.parse(readFileSync(new URL(name, SAMPLE_DIR), "utf8"));
  return Object.assign(blankProject(), raw.prj || raw) as Project;
}

const PART_KEYS = ["id", "tag", "category", "label", "brand", "type", "orderCode", "supplier", "qty",
  "location", "mount", "device", "station", "slot", "sourceUrl", "guid", "deviceGuid", "safety", "instances"];
const TOP_KEYS = ["format", "version", "generator", "project", "platform", "brief", "devices", "sequence", "safety",
  "parts", "plc", "terminals", "relations"];
const DEV_KEYS = ["name", "guid", "cls", "desc", "role", "unit", "range", "limits", "setpoint", "options", "rampS", "tol",
  "tolTimeS", "selBits", "records", "travelS", "axis", "libType", "signals", "parts"];
const STEP_KEYS = ["no", "device", "deviceGuid", "act", "cond", "timeS", "sp", "rev", "rec", "pos", "posRef", "vel", "acc", "dec", "title"];
const SF_KEYS = ["id", "ref", "kind", "title", "off", "plr", "pl", "category", "stopCategory", "inputs", "actuators", "safeState", "missing"];
const isGuidOrNull = (v: unknown) => v === null || isGuid(v);
const LOCS = new Set(["cabinet", "field"]);
const MOUNTS = new Set(["din", "panel", "rack", "field", "none"]);
const KINDS = new Set(["feeds", "controls", "actuates", "senses"]);
/** kategorie řádků od modulu bezpečnosti (safety_docs.ts bomExtras) — nejsou v katalogu */
const SAFETY_CATS = ["safety_controller", "contactor_mirror", "safety_valve", "two_hand_station"];

const isStrOrNull = (v: unknown) => v === null || typeof v === "string";
const isIntOrNull = (v: unknown) => v === null || Number.isInteger(v);

/** Kontrola tvaru manifestu podle schématu v2 (vrací seznam nálezů). */
function schemaProblems(m: CadManifest): string[] {
  const out: string[] = [];
  const o = m as unknown as Record<string, unknown>;
  for (const k of TOP_KEYS) if (!(k in o)) out.push("chybí " + k);
  if (Object.keys(o).some(k => !TOP_KEYS.includes(k))) out.push("klíč navíc: " + Object.keys(o).filter(k => !TOP_KEYS.includes(k)));
  if (m.format !== "plcdesk-cad" || m.version !== 2 || !/^PLCdesk \d/.test(m.generator)) out.push("hlavička");
  for (const k of ["guid", "name", "number", "customer"]) if (typeof (m.project as Record<string, unknown>)[k] !== "string") out.push("project." + k);
  if (Object.keys(m.project).join() !== "guid,name,number,customer,revision") out.push("klíče project");
  const rv = m.project.revision;
  if (rv !== null && (Object.keys(rv).join() !== "id,date,by,hash,approved,current" || typeof rv.current !== "boolean")) out.push("project.revision");
  if (typeof m.platform !== "string" || !m.platform) out.push("platform");
  if (Object.keys(m.brief).join() !== "desc,takt,startDate,modes,platforms,concept" || typeof m.brief.desc !== "string"
    || !(m.brief.takt === null || typeof m.brief.takt === "number") || !Array.isArray(m.brief.platforms)) out.push("brief");
  const devNames = new Set<string>();
  for (const d of m.devices) {
    if (Object.keys(d).join() !== DEV_KEYS.join()) out.push("klíče zařízení " + d.name + ": " + Object.keys(d).join());
    if (!isGuidOrNull(d.guid) || !Array.isArray(d.options) || !Array.isArray(d.records) || !Array.isArray(d.signals) || !Array.isArray(d.parts)) out.push("zařízení " + d.name);
    if (d.axis !== null && (d.cls !== "Axis" || !Array.isArray(d.axis.positions) || typeof d.axis.drive !== "string" || !("limNeg" in d.axis) || !("limPos" in d.axis))) out.push("osa " + d.name);
    devNames.add(d.name);
  }
  m.sequence.forEach((st, i) => {
    if (Object.keys(st).join() !== STEP_KEYS.join()) out.push("klíče kroku " + st.no);
    if (st.no !== i + 1 || !st.title || (st.device !== null && !devNames.has(st.device)) || !isGuidOrNull(st.deviceGuid)) out.push("krok " + st.no);
  });
  if (Object.keys(m.safety).join() !== "estop,interlocks,functions") out.push("klíče safety");
  if (m.safety.estop !== null && (Object.keys(m.safety.estop).join() !== "device,guid" || !devNames.has(m.safety.estop.device))) out.push("safety.estop");
  for (const x of m.safety.interlocks) if (Object.keys(x).join() !== "device,guid" || !devNames.has(x.device)) out.push("safety.interlocks");
  if (m.safety.functions !== null) for (const f of m.safety.functions) if (Object.keys(f).join() !== SF_KEYS.join()) out.push("klíče funkce " + f.id);
  const ids = new Set<string>();
  for (const p of m.parts) {
    const r = p as unknown as Record<string, unknown>;
    if (Object.keys(r).join() !== PART_KEYS.join()) out.push("klíče dílu " + p.id + ": " + Object.keys(r).join());
    for (const k of ["id", "tag", "category", "label", "brand", "type", "orderCode", "supplier", "sourceUrl"])
      if (typeof r[k] !== "string") out.push(p.id + "." + k);
    if (!p.id || !p.tag || !p.category) out.push("prázdné id/tag/kategorie " + p.id);
    if (!Number.isInteger(p.qty) || p.qty < 0) out.push(p.id + ".qty");
    if (!LOCS.has(p.location) || !MOUNTS.has(p.mount)) out.push(p.id + " umístění");
    if (!isStrOrNull(p.device) || !isIntOrNull(p.station) || !isIntOrNull(p.slot)) out.push(p.id + " device/station/slot");
    if (!isGuidOrNull(p.guid) || !isGuidOrNull(p.deviceGuid) || typeof p.safety !== "boolean" || !Array.isArray(p.instances)) out.push(p.id + " v2");
    for (const x of p.instances) if (Object.keys(x).join() !== "guid,station,slot" || !isGuidOrNull(x.guid)) out.push(p.id + " instances");
    if (ids.has(p.id)) out.push("duplicitní id " + p.id);
    ids.add(p.id);
  }
  if (!Array.isArray(m.plc?.stations) || !m.plc.stations.length) out.push("plc.stations");
  for (const s of m.plc.stations) {
    if (Object.keys(s).join() !== "index,guid,kind,head,modules" || !isGuidOrNull(s.guid)) out.push("klíče stanice " + s.index);
    if (!Number.isInteger(s.index) || (s.kind !== "local" && s.kind !== "remote")) out.push("stanice " + s.index);
    if (!ids.has(s.head)) out.push("hlava stanice " + s.index + " není díl: " + s.head);
    let last = -Infinity;
    for (const x of s.modules) {
      if (Object.keys(x).join() !== "slot,partId,guid,kind,channels" || !isGuidOrNull(x.guid)) out.push("klíče modulu");
      if (!ids.has(x.partId)) out.push("modul " + s.index + "." + x.slot + " není díl: " + x.partId);
      if (!Number.isInteger(x.slot) || x.slot <= last) out.push("pořadí slotů stanice " + s.index);
      last = x.slot;
      if (!/^(DI|DO|AI|AO)(\+(DI|DO|AI|AO))*$/.test(x.kind) || !(x.channels > 0)) out.push("modul " + x.partId + " " + x.kind);
    }
  }
  for (const t of m.terminals) if (!/^X\d+$/.test(t.strip) || !(t.count > 0) || Object.keys(t).join() !== "strip,count") out.push("svorkovnice " + t.strip);
  for (const r of m.relations) {
    if (Object.keys(r).join() !== "from,to,kind") out.push("klíče vazby");
    if (!ids.has(r.from) || !ids.has(r.to)) out.push("vazba na neexistující díl " + r.from + " → " + r.to);
    if (!KINDS.has(r.kind)) out.push("druh vazby " + r.kind);
  }
  return out;
}

const projects = (): Array<[string, Project]> => [
  ...sampleNames().map(n => [n, loadRaw(n)] as [string, Project]),
  ["sampleSmall", sampleSmall()], ["sampleComplex", sampleComplex()],
];

test("tabulka umístění: každá kategorie katalogu, CAT_LABEL a modulu bezpečnosti je zařazená", () => {
  const cats = new Set([...Object.keys(CATALOG).map(k => k.split("@")[0]), ...Object.keys(CAT_LABEL), ...SAFETY_CATS]);
  const missing = [...cats].filter(c => !CAD_PLACEMENT[c]);
  assert.deepEqual(missing, []);
  for (const [c, p] of Object.entries(CAD_PLACEMENT)) assert.ok(LOCS.has(p.location) && MOUNTS.has(p.mount), c);
  for (const c of Object.keys(CAD_PLACEMENT).filter(c => c.startsWith("plc_") && c !== "plc_hmi")) assert.equal(CAD_PLACEMENT[c].mount, "rack", c);
});

for (const safety of [false, true]) test("všechny vzory" + (safety ? " (s modulem bezpečnosti)" : "") + " → manifest podle schématu v2, díly = kusovník, moduly = sestava", () => {
  const off = safety ? registerSafetyModule() : () => {};
  try {
    for (const [name, p0] of projects()) {
      const before = JSON.stringify(p0);
      const m = cadManifest(p0);
      assert.equal(JSON.stringify(p0), before, name + ": vstupní projekt beze změny");
      assert.deepEqual(schemaProblems(m), [], name);
      assert.equal(m.safety.functions === null, !safety, name + ": souhrn bezpečnostních funkcí jen s modulem");
      /* výpočet nad synchronizovanými I/O (vzory mají io: []) */
      const p = cadProject(p0);
      assert.ok(p.io.length > 0 && p.io.length >= p0.io.length, name);
      const bom = buildBom(p);
      assert.equal(m.parts.length, bom.lines.length, name + ": díly = řádky kusovníku");
      assert.deepEqual(m.parts.map(x => x.id), bom.lines.map(l => l.id), name);
      for (const x of m.parts) assert.ok(CAD_PLACEMENT[x.category], name + ": nezařazená kategorie " + x.category);
      /* zařízení: řádek s vazbou na zařízení nese jeho označení */
      for (const l of bom.lines) {
        const x = m.parts.find(y => y.id === l.id)!;
        assert.equal(x.device, l.devId !== undefined ? p.devices.find(d => d.id === l.devId)!.name : null, name + " " + l.id);
      }
      /* sestava: stanice, hlavy a I/O karty v pořadí slotů = hwLayout */
      const L = hwLayout(p, m.platform);
      assert.equal(m.plc.stations.length, L.stations.length, name);
      L.stations.forEach((s, i) => {
        const cs = m.plc.stations[i];
        assert.equal(cs.kind, s.remote ? "remote" : "local");
        assert.equal(cs.head, s.head.bomTag + ":" + s.head.cat);
        const io = s.modules.filter(x => x.kind === "io" && !x.builtin);
        assert.deepEqual(cs.modules.map(x => x.slot), io.map(x => x.slot), name + " sloty");
        assert.deepEqual(cs.modules.map(x => x.partId), io.map(x => x.bomTag + ":" + x.cat), name + " moduly");
      });
      /* počet karet skupiny = množství řádku kusovníku */
      for (const x of m.parts.filter(y => /^plc_(di|do|ai|ao)$/.test(y.category)))
        assert.equal(m.plc.stations.reduce((a, s) => a + s.modules.filter(k => k.partId === x.id).length, 0), x.qty, name + " " + x.id);
      /* svorky = obsazené kanály */
      assert.equal(m.terminals.reduce((a, t) => a + t.count, 0), L.groups.reduce((a, g) => a + g.ch.length, 0), name);
      /* GUID: zařízení a karty jen ze vstupu, řádky odvozené */
      for (const d of m.devices) assert.equal(d.guid, p0.devices.find(x => x.name === d.name)!.guid ?? null, name + " " + d.name);
      const mg = new Set(Object.values(p0.moduleGuids || {}));
      for (const s of m.plc.stations) for (const x of s.modules) assert.ok(x.guid === null || mg.has(x.guid), name + " guid karty");
      for (const x of m.parts.filter(y => /^plc_(di|do|ai|ao)$/.test(y.category)))
        assert.equal(x.instances.length, x.qty, name + " kusy " + x.id);
      assert.equal(new Set(m.parts.map(x => x.guid).filter(Boolean)).size, m.parts.filter(x => x.guid).length, name + ": GUID řádků unikátní");
      if (p0.guid && p0.devices.every(d => d.guid)) assert.ok(m.parts.every(x => x.guid), name + ": každý řádek má GUID");
      /* zadání = data projektu */
      assert.deepEqual(m.devices.map(d => d.name), p0.devices.map(d => d.name), name);
      assert.equal(m.sequence.length, p0.program.seq.length, name);
      assert.equal(m.brief.desc, p0.meta.desc || "", name);
      /* výstup ovládá díl → vazby controls */
      if (p.io.some(e => e.dir === "DO" || e.dir === "AO")) assert.ok(m.relations.some(r => r.kind === "controls"), name + ": vazby controls");
      /* motory: jistič → stykač → motor */
      for (const d of p.devices.filter(x => x.cls === "Motor")) {
        const q = m.parts.find(x => x.device === d.name && x.category === "motor_protection")!;
        const k = m.parts.find(x => x.device === d.name && x.category === "contactor")!;
        assert.ok(m.relations.some(r => r.from === q.id && r.to === k.id && r.kind === "feeds"), name + " " + d.name);
      }
    }
  } finally { off(); }
});

test("determinismus: dvakrát totéž, JSON s odsazením 2 mezery", () => {
  for (const [name, p] of projects().slice(0, 30)) {
    const a = cadManifestJson(p), b = cadManifestJson(JSON.parse(JSON.stringify(p)));
    assert.equal(a, b, name);
    assert.ok(a.startsWith("{\n  \"format\": \"plcdesk-cad\",\n  \"version\": 2,"), name);
    assert.ok(a.endsWith("}\n"));
  }
});

test("vzor 11 PS-11: kontrolně ručně", () => {
  const p = loadSampleFile("11_podavaci_lisovaci_stanice_PS-11.plcstudio.json");
  const m = cadManifest(p);
  const by = (id: string) => m.parts.find(x => x.id === id)!;
  assert.equal(m.platform, "siemens");
  assert.equal(by("-A1:plc_cpu").mount, "rack");
  assert.equal(by("-A1:plc_cpu").station, 0);
  /* pás na měniči: -Q jistí měnič -TA, ten napájí motor */
  const ta = m.parts.find(x => x.category === "vfd")!;
  assert.equal(ta.location, "cabinet");
  assert.equal(ta.mount, "panel");
  const mot = m.parts.find(x => x.device === ta.device && /motor|gearmotor|pump/.test(x.category))!;
  assert.equal(mot.location, "field");
  assert.ok(m.relations.some(r => r.from === ta.id && r.to === mot.id && r.kind === "feeds"));
  assert.ok(m.relations.some(r => r.to === ta.id && r.kind === "controls" && by(r.from).mount === "rack"), "výstup PLC ovládá měnič");
  /* osa se záznamy: řadič -TA → osa */
  const pd = m.parts.find(x => x.category === "positioning_drive")!;
  assert.ok(m.relations.some(r => r.from === pd.id && by(r.to).category === "linear_axis"));
  /* válec: rozváděč → válec, snímač → válec */
  const cyl = m.parts.find(x => x.category === "cylinder");
  if (cyl) {
    assert.ok(m.relations.some(r => r.to === cyl.id && r.kind === "actuates"));
    assert.ok(m.relations.some(r => r.to === cyl.id && r.kind === "senses"));
  }
});

test("vzor 17 OM-17: servoosa, pohon se záznamy, polní prvky", () => {
  const p = loadSampleFile("17_odberovy_manipulator_vstrikovaci_lis_OM-17.plcstudio.json");
  const m = cadManifest(p);
  const sd = m.parts.find(x => x.category === "servo_drive")!;
  const sm = m.parts.find(x => x.category === "servo_motor")!;
  assert.equal(sd.device, sm.device);
  assert.ok(m.relations.some(r => r.from === sd.id && r.to === sm.id && r.kind === "feeds"));
  assert.equal(sd.location, "cabinet");
  assert.equal(sm.location, "field");
  assert.ok(m.parts.filter(x => x.location === "field").length > 5);
});

test("projektová složka: manifest v 09_Exporty/CAD, modely 3D v 02_Vykresy/3D, bundle jen na volbu", () => {
  assert.equal(projectFileFolder(CAD_FILE), PROJECT_DIRS.cad);
  assert.equal(projectFileFolder("260705_" + CAD_FILE), "09_Exporty/CAD");
  assert.equal(projectFileFolder("x.json", "cad"), "09_Exporty/CAD");
  assert.equal(projectFileFolder("rozvadec.FCStd"), "02_Vykresy/3D");
  assert.equal(projectFileFolder("rozvadec.step"), PROJECT_DIRS.model3d);
  assert.equal(projectFileFolder("motor.stp"), PROJECT_DIRS.model3d);
  const p = loadSampleFile("11_podavaci_lisovaci_stanice_PS-11.plcstudio.json");
  p.meta.number = "260705";
  const plain = projectBundle(p, { projectText: "{}" });
  assert.ok(!plain.files.some(f => f.path.includes("09_Exporty/CAD")), "bez volby beze změny");
  const withCad = projectBundle(p, { projectText: "{}", cad: true });
  const f = withCad.files.find(x => x.path === "09_Exporty/CAD/260705_" + CAD_FILE)!;
  assert.ok(f && f.body === cadManifestJson(p));
  assert.equal(withCad.files.length, plain.files.length + 1);
  /* nad limitem licence: projekt a manifest (data projektu) */
  const over = projectBundle(p, { projectText: "{}", cad: true, gate: { ...projectGate(p, entitlements("free")), over: true, reason: "limit" } });
  assert.ok(over.files.find(x => x.path.endsWith(CAD_FILE))!.body);
});

test("licence: manifest je data projektu — bez brány ani nad limitem, beze změny", () => {
  const p = loadSampleFile("11_podavaci_lisovaci_stanice_PS-11.plcstudio.json");
  const body = cadManifestJson(p);
  for (const name of [CAD_FILE, "260705_" + CAD_FILE]) {
    assert.equal(licenseFileKind(name), "own");
    assert.deepEqual(applyLicenseToFile(name, body, { ...projectGate(p, entitlements("free")), over: true, reason: "limit" }), { body });
  }
  assert.notEqual(licenseFileKind("PLCdesk_CAD.json.bak"), "own");
});

test("vzor 11 s io: [] → I/O karty -A2…-A5, 31 svorek, vazby controls; vstup beze změny", () => {
  const p = loadRaw("11_podavaci_lisovaci_stanice_PS-11.plcstudio.json");
  assert.equal(p.io.length, 0, "vzor ukládá io: []");
  const m = cadManifest(p);
  assert.equal(p.io.length, 0, "vstup se nemění");
  const st = m.plc.stations[0];
  assert.deepEqual(st.modules.map(x => x.partId), ["-A2:plc_di", "-A3:plc_do", "-A4:plc_ai", "-A5:plc_ao"]);
  assert.deepEqual(st.modules.map(x => x.guid), ["S0.2", "S0.3", "S0.4", "S0.5"].map(k => p.moduleGuids![k]));
  assert.equal(m.terminals.reduce((a, t) => a + t.count, 0), 31);
  const controls = m.relations.filter(r => r.kind === "controls");
  assert.ok(controls.length >= 5, "vazby výstupních modulů na akční členy");
  assert.ok(controls.every(r => /^-A[1-5]:plc_(cpu|do|ao)$/.test(r.from)), "z vestavěných výstupů CPU nebo z karet");
  /* zadání: měnič, osa se záznamy, sekvence, E-stop a blokování */
  const m1 = m.devices.find(d => d.cls === "Vfd")!;
  assert.deepEqual(m1.range, { min: 0, max: 50 });
  assert.ok(m1.signals.length > 0 && m1.parts.includes("-TA1:vfd"));
  const pd = m.devices.find(d => d.cls === "PosDrive")!;
  assert.ok(pd.records.length >= 3 && pd.travelS! > 0 && pd.selBits === 2);
  assert.equal(m.sequence[0].act, "home");
  assert.equal(m.sequence[1].sp, 40);
  assert.equal(m.safety.estop!.device, "S1");
  assert.deepEqual(m.safety.interlocks.map(x => x.device), ["S2"]);
  assert.ok(m.parts.find(x => x.id === "-S1:estop_button")?.safety, "E-stop = bezpečnostní díl");
  assert.equal(m.parts.find(x => x.category === "vfd")!.safety, false);
  assert.equal(m.project.revision, null);
});

test("GUID: stabilní při přejmenování zařízení, bez GUID ve vstupu null (export nevytváří)", () => {
  const p = loadRaw("11_podavaci_lisovaci_stanice_PS-11.plcstudio.json");
  const a = cadManifest(p);
  const ta = a.parts.find(x => x.category === "vfd")!;
  assert.equal(ta.deviceGuid, p.devices.find(d => d.cls === "Vfd")!.guid);
  const q = JSON.parse(JSON.stringify(p)) as Project;
  const r = renameDevice(q, q.devices.find(d => d.cls === "Vfd")!.id, "M9");
  assert.ok(r.ok !== false, JSON.stringify(r));
  const b = cadManifest(q);
  const tb = b.parts.find(x => x.category === "vfd")!;
  assert.notEqual(tb.id, ta.id, "označení se mění");
  assert.equal(tb.guid, ta.guid, "GUID řádku zůstává");
  /* projekt bez GUID: nic náhodného, dva exporty shodné */
  const n = JSON.parse(JSON.stringify(p)) as Project;
  delete n.guid; delete n.moduleGuids;
  for (const d of n.devices) delete d.guid;
  const x1 = cadManifestJson(n), x2 = cadManifestJson(n);
  assert.equal(x1, x2);
  const mx = JSON.parse(x1) as CadManifest;
  assert.ok(mx.parts.every(x => x.guid === null && x.deviceGuid === null));
  assert.ok(mx.plc.stations.every(s => s.guid === null && s.modules.every(k => k.guid === null)));
  assert.ok(mx.devices.every(d => d.guid === null));
});

test("revize: id, datum, kdo, otisk, stav schválení a shoda obsahu", () => {
  const p = loadRaw("11_podavaci_lisovaci_stanice_PS-11.plcstudio.json");
  const rec = createRevision(p, "Jan Novák", "první vydání", { at: "2026-10-15T08:00:00.000Z" });
  const m = cadManifest(p);
  assert.deepEqual(m.project.revision, { id: "A", date: "2026-10-15T08:00:00.000Z", by: "Jan Novák", hash: rec.hash,
    approved: { valid: rec.approved!.valid, required: rec.approved!.required }, current: true });
  p.meta.desc += " (upraveno)";
  assert.equal(cadManifest(p).project.revision!.current, false, "rozpracováno po revizi");
});

test("vzor 12 PM-12: servoosa v zadání s konfigurací a kroky pohybu", () => {
  const p = loadSampleFile("12_portalovy_manipulator_PM-12.plcstudio.json");
  const m = cadManifest(p);
  const ax = m.devices.find(d => d.cls === "Axis")!;
  assert.ok(ax.axis && ax.axis.vMax > 0 && Array.isArray(ax.axis.positions));
  assert.ok(m.sequence.some(s => s.device === ax.name && (s.pos !== null || s.posRef !== null)));
});
