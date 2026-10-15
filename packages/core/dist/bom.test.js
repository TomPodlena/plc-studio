/**
 * Kusovník (bom.ts) — volba dílů podle popisu zařízení (2026-10-15, nálezy funkčního rozboru nad manifestem CAD v2):
 * signály rozhraní k jinému stroji (EUROMAP, „signál z / do lisu“, robot) nejsou snímače ani válce, vakuový úchop
 * = rozváděč + ejektor + přísavky + spínač podtlaku, chapadlo = paralelní chapadlo; pohyb nesoucí chapadlo /
 * přísavky (zdvih, pojezd…) zůstává válec. Klíčová slova jen z obsahu projektu (cs / en / de), volba uživatele
 * v `prj.bom.lines` má dál přednost.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { blankProject, syncIO } from "./model.js";
import { addDevice } from "./edit.js";
import { buildBom, bomIsInterface } from "./bom.js";
import { cadManifest } from "./cad.js";
import { setLang } from "./i18n.js";
import { loadSampleFile } from "./exp_util.test.js";
const S17 = "17_odberovy_manipulator_vstrikovaci_lis_OM-17.plcstudio.json";
const S11 = "11_podavaci_lisovaci_stanice_PS-11.plcstudio.json";
const catsOf = (p, tag) => buildBom(p).lines.filter(l => l.tag === tag).map(l => l.cat);
/** Projekt s jedním zařízením na každý popis (Ventil se dvěma hlášeními, DI). */
function prjWith(devs) {
    const p = blankProject();
    p.platforms = ["siemens"];
    for (const d of devs) {
        const r = addDevice(p, { cls: d.cls, desc: d.desc, ...(d.cls === "Ventil" ? { opt: { fbkOpen: true, fbkClosed: true } } : {}) });
        assert.ok(r.ok, d.desc + ": " + r.error);
    }
    syncIO(p);
    return p;
}
test("vzor 17: signály EUROMAP 67 = konektor rozhraní a vazební relé, ne snímače a válce", () => {
    setLang("cs");
    const p = loadSampleFile(S17);
    const b = buildBom(p);
    assert.deepEqual(catsOf(p, "-S3"), [], "S3 z lisu: žádný fyzický snímač");
    assert.deepEqual(catsOf(p, "-S4"), [], "S4 z lisu: žádný fyzický snímač");
    assert.deepEqual(catsOf(p, "-Y3"), ["interface_relay"], "Y3 do lisu: jen vazební relé (bez válce, rozváděče, snímačů)");
    assert.deepEqual(catsOf(p, "-Y4"), ["interface_relay"]);
    const x = b.lines.find(l => l.cat === "machine_interface");
    assert.ok(x && x.tag === "-XG1" && x.qty === 1, "jeden konektor rozhraní");
    assert.match(x.desc, /S3, S4, Y3, Y4/);
    assert.match(x.note, /EUROMAP/);
    assert.equal(x.orderCode, "", "bez ověřeného kódu — doplní projektant");
    assert.ok(!b.lines.some(l => l.cat === "cylinder"), "vzor 17 nemá žádný pneumatický válec");
    /* kabely M12 jen ke skutečným snímačům: S1, S2, S5, B1 + Y1 podtlak + Y2 dvě polohy + I/O kabel řadiče M2 = 8 (dřív 12) */
    assert.equal(b.lines.find(l => l.cat === "cable_sensor").qty, 8);
});
test("vzor 17: vakuum Y1 = rozváděč + ejektor + přísavky + spínač podtlaku; chapadlo Y2 = paralelní chapadlo", () => {
    setLang("cs");
    const p = loadSampleFile(S17);
    assert.deepEqual(catsOf(p, "-Y1"), ["valve_solenoid", "vacuum_ejector", "suction_cup", "vacuum_switch"]);
    assert.deepEqual(catsOf(p, "-Y2"), ["valve_solenoid", "gripper", "cylinder_switch"]);
    assert.equal(buildBom(p).lines.find(l => l.id === "-Y2:cylinder_switch").qty, 2);
});
test("vzor 11: chapadlo podavače = paralelní chapadlo, lisovací válec zůstává válec", () => {
    const p = loadSampleFile(S11);
    assert.deepEqual(catsOf(p, "-Y1"), ["valve_solenoid", "gripper", "cylinder_switch"]);
    assert.deepEqual(catsOf(p, "-Y3"), ["valve_solenoid", "cylinder", "cylinder_switch"]);
});
test("pravidla: pohyb nesoucí chapadlo / přísavky je válec; cs / en / de klíčová slova; povolení samo není rozhraní", () => {
    const p = prjWith([
        { cls: "Ventil", desc: "Zdvih chapadla dolů" }, // Y1 válec
        { cls: "Ventil", desc: "Přenos — zdvih přísavek dolů" }, // Y2 válec
        { cls: "Ventil", desc: "Greifer schließen" }, // Y3 chapadlo
        { cls: "Ventil", desc: "Gripper close" }, // Y4 chapadlo
        { cls: "Ventil", desc: "Vakuumsauger ein" }, // Y5 vakuum
        { cls: "Ventil", desc: "Vacuum cups on" }, // Y6 vakuum
        { cls: "Ventil", desc: "Povolení měniče" }, // Y7 válec (povolení ≠ rozhraní)
        { cls: "Ventil", desc: "Start program (signal to robot)" }, // Y8 rozhraní
        { cls: "Ventil", desc: "Roboter Programm starten" }, // Y9 rozhraní
        { cls: "DI", desc: "Mould open (signal from IMM, Euromap 67)" }, // S1
        { cls: "DI", desc: "Maschine bereit (Signal von der Spritzgießmaschine)" }, // S2
        { cls: "DI", desc: "Kryt dveří (signál pro obsluhu) — tlačítko kvitace" }, // S3 tlačítko má přednost
    ]);
    const names = p.devices.map(d => d.name);
    assert.deepEqual(names, ["Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "Y7", "Y8", "Y9", "S1", "S2", "S3"]);
    const cyl = ["valve_solenoid", "cylinder", "cylinder_switch"], grip = ["valve_solenoid", "gripper", "cylinder_switch"], vac = ["valve_solenoid", "vacuum_ejector", "suction_cup", "vacuum_switch"];
    assert.deepEqual(catsOf(p, "-Y1"), cyl);
    assert.deepEqual(catsOf(p, "-Y2"), cyl);
    assert.deepEqual(catsOf(p, "-Y3"), grip);
    assert.deepEqual(catsOf(p, "-Y4"), grip);
    assert.deepEqual(catsOf(p, "-Y5"), vac);
    assert.deepEqual(catsOf(p, "-Y6"), vac);
    assert.deepEqual(catsOf(p, "-Y7"), cyl);
    assert.deepEqual(catsOf(p, "-Y8"), ["interface_relay"]);
    assert.deepEqual(catsOf(p, "-Y9"), ["interface_relay"]);
    assert.deepEqual(catsOf(p, "-S1"), []);
    assert.deepEqual(catsOf(p, "-S2"), []);
    assert.deepEqual(catsOf(p, "-S3"), ["pushbutton"]);
    const x = buildBom(p).lines.find(l => l.cat === "machine_interface");
    assert.match(x.desc, /Y8, Y9, S1, S2/);
    assert.equal(p.devices.filter(bomIsInterface).length, 5, "Y8, Y9, S1, S2 a S3 (popis) — S3 ale zůstává tlačítkem");
});
test("rozhraní nepřebije bezpečnost: E-stop a blokování zůstávají bezpečnostní díly", () => {
    const p = prjWith([
        { cls: "DI", desc: "Nouzové zastavení robota (signál z robota)" },
        { cls: "DI", desc: "Dveře ohrazení robota zavřeny (signál z robota)" },
    ]);
    p.program.estop = p.devices[0].id;
    p.program.interlocks = [p.devices[1].id];
    assert.deepEqual(catsOf(p, "-S1"), ["estop_button"]);
    assert.deepEqual(catsOf(p, "-S2"), ["safety_switch"]);
    assert.ok(!buildBom(p).lines.some(l => l.cat === "machine_interface"), "bez signálů rozhraní žádný konektor");
});
test("bez klíčových slov se kusovník nemění; volba uživatele u řádku má přednost", () => {
    const p = prjWith([{ cls: "Ventil", desc: "Chapadlo sevřít" }, { cls: "DI", desc: "Díl v dorazu" }]);
    assert.deepEqual(catsOf(p, "-S1"), ["sensor_inductive"]);
    p.bom = { lines: { "-Y1:gripper": { brand: "SCHUNK", type: "PGN-plus-P 64-1", orderCode: "TEST-1" } } };
    const l = buildBom(p).lines.find(x => x.id === "-Y1:gripper");
    assert.equal(l.brand, "SCHUNK");
    assert.equal(l.type, "PGN-plus-P 64-1");
    assert.equal(l.orderCode, "TEST-1");
});
test("CAD: vazby nových dílů (rozváděč → ejektor → přísavky, spínač podtlaku, výstup PLC → vazební relé rozhraní)", () => {
    setLang("cs");
    const m = cadManifest(loadSampleFile(S17));
    const has = (from, to, kind) => m.relations.some(r => r.from === from && r.to === to && r.kind === kind);
    assert.ok(has("-Y1:valve_solenoid", "-Y1:vacuum_ejector", "actuates"));
    assert.ok(has("-Y1:vacuum_ejector", "-Y1:suction_cup", "actuates"));
    assert.ok(has("-Y1:vacuum_switch", "-Y1:vacuum_ejector", "senses"));
    assert.ok(has("-Y2:valve_solenoid", "-Y2:gripper", "actuates"));
    assert.ok(has("-Y2:cylinder_switch", "-Y2:gripper", "senses"));
    assert.ok(m.relations.some(r => r.to === "-Y3:interface_relay" && r.kind === "controls"), "výstup PLC → vazební relé Y3");
    const xg = m.parts.find(x => x.category === "machine_interface");
    assert.equal(xg.location, "field");
});
