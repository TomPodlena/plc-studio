/**
 * Kusovník (bom.ts) — volba dílů podle popisu zařízení (2026-10-15, nálezy funkčního rozboru nad manifestem CAD v2):
 * signály rozhraní k jinému stroji (EUROMAP, „signál z / do lisu“, robot) nejsou snímače ani válce, vakuový úchop
 * = rozváděč + ejektor + přísavky + spínač podtlaku, chapadlo = paralelní chapadlo; pohyb nesoucí chapadlo /
 * přísavky (zdvih, pojezd…) zůstává válec. Klíčová slova jen z obsahu projektu (cs / en / de), volba uživatele
 * v `prj.bom.lines` má dál přednost.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { blankProject, syncIO, type Project } from "./model.js";
import { addDevice } from "./edit.js";
import { buildBom, bomIsInterface, bomLineIsSafety } from "./bom.js";
import { cadManifest } from "./cad.js";
import { setLang } from "./i18n.js";
import { loadSampleFile } from "./exp_util.test.js";

const S17 = "17_odberovy_manipulator_vstrikovaci_lis_OM-17.plcstudio.json";
const S11 = "11_podavaci_lisovaci_stanice_PS-11.plcstudio.json";
const catsOf = (p: Project, tag: string) => buildBom(p).lines.filter(l => l.tag === tag).map(l => l.cat);

/** Projekt s jedním zařízením na každý popis (Ventil se dvěma hlášeními, DI). */
function prjWith(devs: Array<{ cls: "Ventil" | "DI" | "DO"; desc: string }>): Project {
  const p = blankProject();
  p.platforms = ["siemens"];
  for (const d of devs) {
    const r = addDevice(p, { cls: d.cls, desc: d.desc, ...(d.cls === "Ventil" ? { opt: { fbkOpen: true, fbkClosed: true } } : {}) });
    assert.ok(r.ok, d.desc + ": " + (r as { error?: string }).error);
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
  assert.match(x!.desc, /S3, S4, Y3, Y4/);
  assert.match(x!.note, /EUROMAP/);
  assert.equal(x!.orderCode, "", "bez ověřeného kódu — doplní projektant");
  assert.ok(!b.lines.some(l => l.cat === "cylinder"), "vzor 17 nemá žádný pneumatický válec");
  /* kabely M12 jen ke skutečným snímačům: S1, S2, S5, B1 + Y1 podtlak + Y2 dvě polohy + I/O kabel řadiče M2 = 8 (dřív 12) */
  assert.equal(b.lines.find(l => l.cat === "cable_sensor")!.qty, 8);
});

test("vzor 17: vakuum Y1 = rozváděč + ejektor + přísavky + spínač podtlaku; chapadlo Y2 = paralelní chapadlo", () => {
  setLang("cs");
  const p = loadSampleFile(S17);
  assert.deepEqual(catsOf(p, "-Y1"), ["valve_solenoid", "vacuum_ejector", "suction_cup", "vacuum_switch"]);
  assert.deepEqual(catsOf(p, "-Y2"), ["valve_solenoid", "gripper", "cylinder_switch"]);
  assert.equal(buildBom(p).lines.find(l => l.id === "-Y2:cylinder_switch")!.qty, 2);
});

test("vzor 11: chapadlo podavače = paralelní chapadlo, lisovací válec zůstává válec", () => {
  const p = loadSampleFile(S11);
  assert.deepEqual(catsOf(p, "-Y1"), ["valve_solenoid", "gripper", "cylinder_switch"]);
  assert.deepEqual(catsOf(p, "-Y3"), ["valve_solenoid", "cylinder", "cylinder_switch"]);
});

test("pravidla: pohyb nesoucí chapadlo / přísavky je válec; cs / en / de klíčová slova; povolení samo není rozhraní", () => {
  const p = prjWith([
    { cls: "Ventil", desc: "Zdvih chapadla dolů" },               // Y1 válec
    { cls: "Ventil", desc: "Přenos — zdvih přísavek dolů" },      // Y2 válec
    { cls: "Ventil", desc: "Greifer schließen" },                 // Y3 chapadlo
    { cls: "Ventil", desc: "Gripper close" },                     // Y4 chapadlo
    { cls: "Ventil", desc: "Vakuumsauger ein" },                  // Y5 vakuum
    { cls: "Ventil", desc: "Vacuum cups on" },                    // Y6 vakuum
    { cls: "Ventil", desc: "Povolení měniče" },                   // Y7 válec (povolení ≠ rozhraní)
    { cls: "Ventil", desc: "Start program (signal to robot)" },   // Y8 rozhraní
    { cls: "Ventil", desc: "Roboter Programm starten" },          // Y9 rozhraní
    { cls: "DI", desc: "Mould open (signal from IMM, Euromap 67)" }, // S1
    { cls: "DI", desc: "Maschine bereit (Signal von der Spritzgießmaschine)" }, // S2
    { cls: "DI", desc: "Kryt dveří (signál pro obsluhu) — tlačítko kvitace" },  // S3 tlačítko má přednost
  ]);
  const names = p.devices.map(d => d.name);
  assert.deepEqual(names, ["Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "Y7", "Y8", "Y9", "S1", "S2", "S3"]);
  const cyl = ["valve_solenoid", "cylinder", "cylinder_switch"], grip = ["valve_solenoid", "gripper", "cylinder_switch"],
    vac = ["valve_solenoid", "vacuum_ejector", "suction_cup", "vacuum_switch"];
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
  const x = buildBom(p).lines.find(l => l.cat === "machine_interface")!;
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
  const l = buildBom(p).lines.find(x => x.id === "-Y1:gripper")!;
  assert.equal(l.brand, "SCHUNK");
  assert.equal(l.type, "PGN-plus-P 64-1");
  assert.equal(l.orderCode, "TEST-1");
});

test("CAD: vazby nových dílů (rozváděč → ejektor → přísavky, spínač podtlaku, výstup PLC → vazební relé rozhraní)", () => {
  setLang("cs");
  const m = cadManifest(loadSampleFile(S17));
  const has = (from: string, to: string, kind: string) => m.relations.some(r => r.from === from && r.to === to && r.kind === kind);
  assert.ok(has("-Y1:valve_solenoid", "-Y1:vacuum_ejector", "actuates"));
  assert.ok(has("-Y1:vacuum_ejector", "-Y1:suction_cup", "actuates"));
  assert.ok(has("-Y1:vacuum_switch", "-Y1:vacuum_ejector", "senses"));
  assert.ok(has("-Y2:valve_solenoid", "-Y2:gripper", "actuates"));
  assert.ok(has("-Y2:cylinder_switch", "-Y2:gripper", "senses"));
  assert.ok(m.relations.some(r => r.to === "-Y3:interface_relay" && r.kind === "controls"), "výstup PLC → vazební relé Y3");
  const xg = m.parts.find(x => x.category === "machine_interface")!;
  assert.equal(xg.location, "field");
});

/* ---- signální věž s patry a volič (2026-11-03, nálezy přípravy modulů pult / maják PLCdesk PRO) ---- */
const S03 = "03_nytovaci_lis_NL-1.plcstudio.json";
const S20 = "20_zkusebni_stanice_tesnosti_ZT-20.plcstudio.json";

test("vzor 03: jedna signální věž se 2 patry (červená nahoře, zelená), ne věž na každý DO", () => {
  setLang("cs");
  const p = loadSampleFile(S03);
  const b = buildBom(p);
  const towers = b.lines.filter(l => l.cat === "beacon");
  assert.equal(towers.length, 1, "jedna věž");
  assert.equal(towers[0].id, "-PF1:beacon");
  assert.equal(towers[0].qty, 1);
  assert.equal(towers[0].orderCode, "64924005", "hotová věž Werma R/Y/G z katalogu");
  assert.equal(towers[0].devId, undefined, "věž nepatří jednomu DO");
  const tiers = b.lines.filter(l => l.cat === "beacon_light");
  assert.deepEqual(tiers.map(l => l.id), ["-H2:beacon_light", "-H1:beacon_light"], "patra shora: červená (fault), zelená (run)");
  assert.match(tiers[0].note, /červená/);
  assert.match(tiers[1].note, /zelená/);
  assert.equal(tiers[0].orderCode, "", "patro samo nemá objednací kód");
  assert.ok(!b.lines.some(l => l.id === "-H1:beacon" || l.id === "-H2:beacon"), "žádná věž na DO");
  assert.equal(b.lines.indexOf(tiers[0]), b.lines.indexOf(towers[0]) + 1, "patra hned za věží");
  assert.deepEqual(catsOf(p, "-S1"), ["estop_button"], "E-stop zůstává");
  assert.deepEqual(catsOf(p, "-S2"), ["pushbutton"], "tlačítko dvouručního ovládání zůstává tlačítkem");
});

test("vzor 20: tři DO majáku = jedna věž se 3 patry R / Y / G", () => {
  setLang("cs");
  const b = buildBom(loadSampleFile(S20));
  assert.equal(b.lines.filter(l => l.cat === "beacon").length, 1);
  const tiers = b.lines.filter(l => l.cat === "beacon_light");
  assert.equal(tiers.length, 3);
  assert.deepEqual(tiers.map(l => /patro věže -PF1: ([^;,\s]+)/.exec(l.note)![1]), ["červená", "žlutá", "zelená"]);
});

test("věž: barva z popisu má přednost, jinak role (ODHAD), víc věží jen výslovně; mimo R/Y/G = stavebnice", () => {
  setLang("cs");
  const p = prjWith([
    { cls: "DO", desc: "Maják — připraveno" },
    { cls: "DO", desc: "Maják modrá — výzva obsluze" },
    { cls: "DO", desc: "Maják — porucha" },
  ]);
  p.devices[0].role = "ready"; p.devices[2].role = "fault";
  let b = buildBom(p);
  assert.equal(b.lines.filter(l => l.cat === "beacon").length, 1);
  assert.deepEqual(b.lines.filter(l => l.cat === "beacon_light").map(l => l.tag), ["-H3", "-H2", "-H1"], "shora červená, modrá, bílá");
  assert.match(b.lines.find(l => l.id === "-H1:beacon_light")!.note, /výchozí PLCdesk podle role ready \(rozhodnutí uživatele\)/);
  assert.doesNotMatch(b.lines.find(l => l.id === "-H1:beacon_light")!.note, /ODHAD/);
  assert.match(b.lines.find(l => l.cat === "beacon")!.note, /stavebnicová věž/, "modrá / bílá hotová věž R/Y/G nepokryje");
  /* dvě věže jen podle popisu */
  const q = prjWith([
    { cls: "DO", desc: "Maják věž A zelená" }, { cls: "DO", desc: "Maják věž A červená" },
    { cls: "DO", desc: "Maják věž B zelená" },
  ]);
  b = buildBom(q);
  assert.deepEqual(b.lines.filter(l => l.cat === "beacon").map(l => l.id), ["-PF1:beacon", "-PF2:beacon"]);
  assert.match(b.lines.find(l => l.id === "-H3:beacon_light")!.note, /-PF2/);
});

test("volič režimů má vlastní kategorii selector_switch (cs / en / de), tlačítko zůstává", () => {
  setLang("cs");
  const p = prjWith([
    { cls: "DI", desc: "Volič režimů AUTO / RUČNĚ" },
    { cls: "DI", desc: "Mode selector switch" },
    { cls: "DI", desc: "Wahlschalter Automatik / Hand" },
    { cls: "DI", desc: "Tlačítko START" },
  ]);
  assert.deepEqual(["-S1", "-S2", "-S3", "-S4"].map(t => catsOf(p, t)), [["selector_switch"], ["selector_switch"], ["selector_switch"], ["pushbutton"]]);
  const l = buildBom(p).lines.find(x => x.id === "-S1:selector_switch")!;
  assert.equal(l.orderCode, "", "bez ověřeného kódu");
  assert.match(l.note, /doplní projektant/);
});

test("CAD: výstupní modul → patro věže (controls), věž → patro (feeds), patro se samo nemontuje", () => {
  setLang("cs");
  const m = cadManifest(loadSampleFile(S03));
  for (const t of ["-H1:beacon_light", "-H2:beacon_light"]) {
    assert.ok(m.relations.some(r => r.to === t && r.kind === "controls" && /plc_(cpu|do)/.test(r.from)), t + " controls");
    assert.ok(m.relations.some(r => r.from === "-PF1:beacon" && r.to === t && r.kind === "feeds"), t + " feeds");
  }
  const tower = m.parts.find(x => x.id === "-PF1:beacon")!;
  assert.equal(tower.mount, "field");
  assert.equal(tower.device, null);
  assert.ok(tower.guid, "GUID věže z projektu (přežije přejmenování DO)");
  const tier = m.parts.find(x => x.id === "-H1:beacon_light")!;
  assert.equal(tier.mount, "none");
  assert.equal(tier.device, "H1");
});

test("pneumatika: lišta rozváděčů -WP1, uzávěr -QM1 a filtr-regulátor -HQ1 jednou na stroj; bezpečnostní ventil jen s modulem bezpečnosti", async () => {
  const { registerSafetyModule } = await import("./safety.js");
  setLang("cs");
  const p = loadSampleFile(S11);
  const lines = buildBom(p).lines;
  const valves = lines.filter(l => l.cat === "valve_solenoid");
  assert.ok(valves.length >= 2);
  const wp = lines.filter(l => l.cat === "valve_manifold");
  assert.equal(wp.length, 1);
  assert.equal(wp[0].id, "-WP1:valve_manifold");
  assert.ok(wp[0].desc.includes(String(valves.length)), wp[0].desc);
  assert.deepEqual(lines.filter(l => l.cat === "air_shutoff").map(l => l.id), ["-QM1:air_shutoff"]);
  assert.deepEqual(lines.filter(l => l.cat === "air_prep").map(l => l.id), ["-HQ1:air_prep"]);
  assert.equal(lines.find(l => l.cat === "air_prep")!.orderCode, "529184");        // Festo MS6-LFR (první položka Festo)
  assert.equal(lines.find(l => l.cat === "air_shutoff")!.orderCode, "541267");     // Festo MS6-EM1
  assert.ok(!lines.some(l => l.cat === "safety_valve"), "bez modulu bezpečnosti žádný bezpečnostní ventil");
  const off = registerSafetyModule();
  try {
    const ls = buildBom(p).lines;
    /* bezpečnostní odvzdušňovací ventil (-YS1) přidává jen modul bezpečnosti podle navržených funkcí; úprava vzduchu jednou */
    assert.ok(ls.filter(l => l.cat === "safety_valve").every(l => l.safety));
    assert.equal(ls.filter(l => l.cat === "air_prep").length, 1);
    assert.equal(ls.filter(l => l.cat === "air_shutoff").length, 1);
  } finally { off(); }
  /* stroj bez pneumatiky: nic */
  const q = prjWith([{ cls: "DI", desc: "Díl v dorazu" }]);
  assert.ok(!buildBom(q).lines.some(l => ["valve_manifold", "air_shutoff", "air_prep"].includes(l.cat)));
  /* CAD: nové řádky jdou do pole */
  const man = cadManifest(p);
  for (const id of ["-WP1:valve_manifold", "-QM1:air_shutoff", "-HQ1:air_prep"])
    assert.equal(man.parts.find(x => x.id === id)!.location, "field", id);
});

/* ---- zámek ochranného krytu = jištěné blokovací zařízení (2026-11-04, nález modulu O3 PLCdesk PRO) ---- */
test("zámek krytu: DO zámku = guard_lock (bezpečnostní), DI „zavřeno a zamčeno“ bez vlastního spínače", () => {
  setLang("cs");
  const p = loadSampleFile("16_paletizacni_bunka_osy_PC-16.plcstudio.json");
  const b = buildBom(p);
  assert.deepEqual(catsOf(p, "-H4"), ["guard_lock"]);
  assert.deepEqual(catsOf(p, "-S2"), ["guard_lock_contact"], "S2 = kontakt zámku, ne samostatný spínač");
  const c = b.lines.find(x => x.id === "-S2:guard_lock_contact")!;
  assert.ok(bomLineIsSafety(p, c) && /-H4/.test(c.note) && !c.orderCode, "kontakt bez objednacího kódu");
  assert.deepEqual(catsOf(p, "-S3"), ["light_curtain"]);
  const l = b.lines.find(x => x.id === "-H4:guard_lock")!;
  assert.ok(bomLineIsSafety(p, l));
  assert.match(l.note, /S2/);
  assert.match(l.note, /návrh, ověřit v posouzení rizik/);
  assert.match(l.note, /13849/);
  assert.equal(l.brand, "Schmersal", "výchozí = první položka katalogu (zámek Siemens v katalogu není)");
  assert.equal(l.orderCode, "103013908");
  const m = cadManifest(p);
  assert.equal(m.parts.find(x => x.id === "-H4:guard_lock")?.safety, true);
  assert.equal(m.parts.find(x => x.id === "-S2:guard_lock_contact")?.mount, "none");
  assert.ok(!m.parts.some(x => x.category === "safety_switch"));
});

test("zámek krytu bez DI „zamčeno“: blokovací spínače zůstávají, zámek má vlastní řádek", () => {
  setLang("cs");
  const p = loadSampleFile("00b_lisovaci_linka_LL-03.plcstudio.json");
  assert.deepEqual(catsOf(p, "-H4"), ["guard_lock"]);
  assert.deepEqual(catsOf(p, "-S2"), ["safety_switch"]);
  assert.deepEqual(catsOf(p, "-S3"), ["safety_switch"]);
  const p2 = prjWith([{ cls: "DO", desc: "Guard locking solenoid" }]);
  const tag = "-" + p2.devices[0].name;
  assert.deepEqual(catsOf(p2, tag), ["guard_lock"], "anglický popis zámku");
});
