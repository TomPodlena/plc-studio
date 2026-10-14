/**
 * Export pro CAD (cad.ts, formát plcdesk-cad v1 podle MANIFEST_SCHEMA.md): všechny vzory → manifest
 * se všemi klíči a typy, id unikátní, odkazy plc / relations na existující díly, každá kategorie
 * zařazená, díly = řádky kusovníku, moduly PLC = sestava hardwaru, determinismus; projektová složka.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBom } from "./bom.js";
import { hwLayout } from "./hardware.js";
import { CAT_LABEL, CATALOG } from "./catalog.js";
import { cadManifest, cadManifestJson, CAD_PLACEMENT, CAD_FILE } from "./cad.js";
import { projectFileFolder, projectBundle, PROJECT_DIRS } from "./project_folder.js";
import { registerSafetyModule } from "./safety.js";
import "./safety_docs.js";
import { sampleSmall, sampleComplex } from "./samples.js";
import { projectGate, entitlements, licenseFileKind, applyLicenseToFile } from "./license.js";
import { sampleNames, loadSampleFile } from "./exp_util.test.js";
const PART_KEYS = ["id", "tag", "category", "label", "brand", "type", "orderCode", "supplier", "qty",
    "location", "mount", "device", "station", "slot", "sourceUrl"];
const TOP_KEYS = ["format", "version", "generator", "project", "platform", "parts", "plc", "terminals", "relations"];
const LOCS = new Set(["cabinet", "field"]);
const MOUNTS = new Set(["din", "panel", "rack", "field", "none"]);
const KINDS = new Set(["feeds", "controls", "actuates", "senses"]);
/** kategorie řádků od modulu bezpečnosti (safety_docs.ts bomExtras) — nejsou v katalogu */
const SAFETY_CATS = ["safety_controller", "contactor_mirror", "safety_valve", "two_hand_station"];
const isStrOrNull = (v) => v === null || typeof v === "string";
const isIntOrNull = (v) => v === null || Number.isInteger(v);
/** Kontrola tvaru manifestu podle schématu v1 (vrací seznam nálezů). */
function schemaProblems(m) {
    const out = [];
    const o = m;
    for (const k of TOP_KEYS)
        if (!(k in o))
            out.push("chybí " + k);
    if (Object.keys(o).some(k => !TOP_KEYS.includes(k)))
        out.push("klíč navíc: " + Object.keys(o).filter(k => !TOP_KEYS.includes(k)));
    if (m.format !== "plcdesk-cad" || m.version !== 1 || !/^PLCdesk \d/.test(m.generator))
        out.push("hlavička");
    for (const k of ["guid", "name", "number", "customer"])
        if (typeof m.project[k] !== "string")
            out.push("project." + k);
    if (typeof m.platform !== "string" || !m.platform)
        out.push("platform");
    const ids = new Set();
    for (const p of m.parts) {
        const r = p;
        if (Object.keys(r).join() !== PART_KEYS.join())
            out.push("klíče dílu " + p.id + ": " + Object.keys(r).join());
        for (const k of ["id", "tag", "category", "label", "brand", "type", "orderCode", "supplier", "sourceUrl"])
            if (typeof r[k] !== "string")
                out.push(p.id + "." + k);
        if (!p.id || !p.tag || !p.category)
            out.push("prázdné id/tag/kategorie " + p.id);
        if (!Number.isInteger(p.qty) || p.qty < 0)
            out.push(p.id + ".qty");
        if (!LOCS.has(p.location) || !MOUNTS.has(p.mount))
            out.push(p.id + " umístění");
        if (!isStrOrNull(p.device) || !isIntOrNull(p.station) || !isIntOrNull(p.slot))
            out.push(p.id + " device/station/slot");
        if (ids.has(p.id))
            out.push("duplicitní id " + p.id);
        ids.add(p.id);
    }
    if (!Array.isArray(m.plc?.stations) || !m.plc.stations.length)
        out.push("plc.stations");
    for (const s of m.plc.stations) {
        if (Object.keys(s).join() !== "index,kind,head,modules")
            out.push("klíče stanice " + s.index);
        if (!Number.isInteger(s.index) || (s.kind !== "local" && s.kind !== "remote"))
            out.push("stanice " + s.index);
        if (!ids.has(s.head))
            out.push("hlava stanice " + s.index + " není díl: " + s.head);
        let last = -Infinity;
        for (const x of s.modules) {
            if (Object.keys(x).join() !== "slot,partId,kind,channels")
                out.push("klíče modulu");
            if (!ids.has(x.partId))
                out.push("modul " + s.index + "." + x.slot + " není díl: " + x.partId);
            if (!Number.isInteger(x.slot) || x.slot <= last)
                out.push("pořadí slotů stanice " + s.index);
            last = x.slot;
            if (!/^(DI|DO|AI|AO)(\+(DI|DO|AI|AO))*$/.test(x.kind) || !(x.channels > 0))
                out.push("modul " + x.partId + " " + x.kind);
        }
    }
    for (const t of m.terminals)
        if (!/^X\d+$/.test(t.strip) || !(t.count > 0) || Object.keys(t).join() !== "strip,count")
            out.push("svorkovnice " + t.strip);
    for (const r of m.relations) {
        if (Object.keys(r).join() !== "from,to,kind")
            out.push("klíče vazby");
        if (!ids.has(r.from) || !ids.has(r.to))
            out.push("vazba na neexistující díl " + r.from + " → " + r.to);
        if (!KINDS.has(r.kind))
            out.push("druh vazby " + r.kind);
    }
    return out;
}
const projects = () => [
    ...sampleNames().map(n => [n, loadSampleFile(n)]),
    ["sampleSmall", sampleSmall()], ["sampleComplex", sampleComplex()],
];
test("tabulka umístění: každá kategorie katalogu, CAT_LABEL a modulu bezpečnosti je zařazená", () => {
    const cats = new Set([...Object.keys(CATALOG).map(k => k.split("@")[0]), ...Object.keys(CAT_LABEL), ...SAFETY_CATS]);
    const missing = [...cats].filter(c => !CAD_PLACEMENT[c]);
    assert.deepEqual(missing, []);
    for (const [c, p] of Object.entries(CAD_PLACEMENT))
        assert.ok(LOCS.has(p.location) && MOUNTS.has(p.mount), c);
    for (const c of Object.keys(CAD_PLACEMENT).filter(c => c.startsWith("plc_") && c !== "plc_hmi"))
        assert.equal(CAD_PLACEMENT[c].mount, "rack", c);
});
for (const safety of [false, true])
    test("všechny vzory" + (safety ? " (s modulem bezpečnosti)" : "") + " → manifest podle schématu v1, díly = kusovník, moduly = sestava", () => {
        const off = safety ? registerSafetyModule() : () => { };
        try {
            for (const [name, p] of projects()) {
                const m = cadManifest(p);
                assert.deepEqual(schemaProblems(m), [], name);
                const bom = buildBom(p);
                assert.equal(m.parts.length, bom.lines.length, name + ": díly = řádky kusovníku");
                assert.deepEqual(m.parts.map(x => x.id), bom.lines.map(l => l.id), name);
                for (const x of m.parts)
                    assert.ok(CAD_PLACEMENT[x.category], name + ": nezařazená kategorie " + x.category);
                /* zařízení: řádek s vazbou na zařízení nese jeho označení */
                for (const l of bom.lines) {
                    const x = m.parts.find(y => y.id === l.id);
                    assert.equal(x.device, l.devId !== undefined ? p.devices.find(d => d.id === l.devId).name : null, name + " " + l.id);
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
                /* motory: jistič → stykač → motor */
                for (const d of p.devices.filter(x => x.cls === "Motor")) {
                    const q = m.parts.find(x => x.device === d.name && x.category === "motor_protection");
                    const k = m.parts.find(x => x.device === d.name && x.category === "contactor");
                    assert.ok(m.relations.some(r => r.from === q.id && r.to === k.id && r.kind === "feeds"), name + " " + d.name);
                }
            }
        }
        finally {
            off();
        }
    });
test("determinismus: dvakrát totéž, JSON s odsazením 2 mezery", () => {
    for (const [name, p] of projects().slice(0, 30)) {
        const a = cadManifestJson(p), b = cadManifestJson(JSON.parse(JSON.stringify(p)));
        assert.equal(a, b, name);
        assert.ok(a.startsWith("{\n  \"format\": \"plcdesk-cad\",\n  \"version\": 1,"), name);
        assert.ok(a.endsWith("}\n"));
    }
});
test("vzor 11 PS-11: kontrolně ručně", () => {
    const p = loadSampleFile("11_podavaci_lisovaci_stanice_PS-11.plcstudio.json");
    const m = cadManifest(p);
    const by = (id) => m.parts.find(x => x.id === id);
    assert.equal(m.platform, "siemens");
    assert.equal(by("-A1:plc_cpu").mount, "rack");
    assert.equal(by("-A1:plc_cpu").station, 0);
    /* pás na měniči: -Q jistí měnič -TA, ten napájí motor */
    const ta = m.parts.find(x => x.category === "vfd");
    assert.equal(ta.location, "cabinet");
    assert.equal(ta.mount, "panel");
    const mot = m.parts.find(x => x.device === ta.device && /motor|gearmotor|pump/.test(x.category));
    assert.equal(mot.location, "field");
    assert.ok(m.relations.some(r => r.from === ta.id && r.to === mot.id && r.kind === "feeds"));
    assert.ok(m.relations.some(r => r.to === ta.id && r.kind === "controls" && by(r.from).mount === "rack"), "výstup PLC ovládá měnič");
    /* osa se záznamy: řadič -TA → osa */
    const pd = m.parts.find(x => x.category === "positioning_drive");
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
    const sd = m.parts.find(x => x.category === "servo_drive");
    const sm = m.parts.find(x => x.category === "servo_motor");
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
    const f = withCad.files.find(x => x.path === "09_Exporty/CAD/260705_" + CAD_FILE);
    assert.ok(f && f.body === cadManifestJson(p));
    assert.equal(withCad.files.length, plain.files.length + 1);
    /* nad limitem licence: projekt a manifest (data projektu) */
    const over = projectBundle(p, { projectText: "{}", cad: true, gate: { ...projectGate(p, entitlements("free")), over: true, reason: "limit" } });
    assert.ok(over.files.find(x => x.path.endsWith(CAD_FILE)).body);
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
