/** Testy GUID (guid.ts) a exportu EPLAN AutomationML AR APC v2 (eplan_aml.ts) — node:test, bez závislostí. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withLang } from "./i18n.js";
import { blankProject, syncIO, modules, ensureGuids, type Project, type Device } from "./model.js";
import { newGuid, derivedGuid, isGuid, moduleKey } from "./guid.js";
import { genEplanAml, validateEplan, validateAml, amlStructure, amlOrderNumber, amlLogicalAddress, stationFamily, type AmlElement } from "./eplan_aml.js";
import { approvalItems } from "./approval.js";
import { createRevision, modifiedSinceRevision, diffProjects, revisionContent } from "./revision.js";
import { genFor } from "./codegen.js";
import { sampleSmall } from "./samples.js";
import { sampleNames, loadSampleFile, xmlProblem, SAMPLE_DIR } from "./exp_util.test.js";

const NOW = new Date("2026-10-04T08:00:00Z");
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
/** ID všech InternalElementů a ExternalInterface v instanční hierarchii (bez knihoven tříd). */
function ids(aml: string): string[] {
  const ih = aml.slice(aml.indexOf("<InstanceHierarchy"), aml.indexOf("</InstanceHierarchy>"));
  return [...ih.matchAll(/<(?:InternalElement|ExternalInterface) Name="[^"]*" ID="([^"]+)"/g)].map(m => m[1]);
}
/** Projekt bez jakýchkoli GUID (stav před v2). */
function stripGuids(p: Project): Project {
  const q = clone(p);
  delete q.guid; delete q.moduleGuids;
  for (const d of q.devices) delete d.guid;
  for (const e of q.io) delete e.guid;
  return q;
}

test("GUID: formát v4, unikátnost, odvozené deterministicky (v8)", () => {
  const s = new Set<string>();
  for (let i = 0; i < 2000; i++) { const g = newGuid(); assert.match(g, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); s.add(g); }
  assert.equal(s.size, 2000);
  const p = newGuid();
  assert.equal(derivedGuid(p, "rack:0"), derivedGuid(p.toUpperCase(), "rack:0"));
  assert.notEqual(derivedGuid(p, "rack:0"), derivedGuid(p, "rack:1"));
  assert.match(derivedGuid(p, "x"), /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("GUID: přidělení při vzniku (blankProject, syncIO), stálost po přejmenování, oprava duplicit", () => {
  const p = blankProject();
  assert.ok(isGuid(p.guid));
  p.devices.push({ id: p.nextId++, name: "M1", cls: "Motor", desc: "", opt: { fault: true }, unit: "", rmin: 0, rmax: 100 });
  syncIO(p);
  const d = p.devices[0];
  assert.ok(isGuid(d.guid));
  assert.ok(p.io.every(e => isGuid(e.guid)));
  assert.ok(modules(p).every(m => isGuid(m.guid) && p.moduleGuids![moduleKey(m)] === m.guid));
  const before = JSON.stringify([p.guid, d.guid, p.io.map(e => e.guid), p.moduleGuids]);
  /* přejmenování zařízení i tagu GUID nemění; opakovaný syncIO / ensureGuids také ne */
  d.name = "M10"; p.io[0].tag = "Motor10_bezi";
  syncIO(p);
  assert.equal(ensureGuids(p), false);
  assert.equal(JSON.stringify([p.guid, d.guid, p.io.map(e => e.guid), p.moduleGuids]), before);
  /* kopie zařízení se stejným GUID (duplikace v UI) dostane nový */
  p.devices.push({ ...clone(d), id: p.nextId++, name: "M11" });
  syncIO(p);
  assert.notEqual(p.devices[1].guid, d.guid);
  const all = [p.guid, ...p.devices.map(x => x.guid), ...p.io.map(e => e.guid)];
  assert.equal(new Set(all).size, all.length);
});

test("GUID: příklady samples/ mají GUID uložené v souboru → stejné ID při každém načtení", () => {
  for (const n of sampleNames()) {
    const raw = JSON.parse(readFileSync(new URL(n, SAMPLE_DIR), "utf8")).prj;
    assert.ok(isGuid(raw.guid), n + ": GUID projektu v souboru");
    assert.ok(raw.devices.every((d: Device) => isGuid(d.guid)), n + ": GUID zařízení v souboru");
    const a = loadSampleFile(n), b = loadSampleFile(n);
    assert.equal(ensureGuids(a), false, n + ": nic nechybí");
    assert.ok(modules(a).every(m => raw.moduleGuids[moduleKey(m)] === m.guid), n + ": GUID karet v souboru");
    assert.deepEqual(ids(genEplanAml(a, { now: NOW })), ids(genEplanAml(b, { now: NOW })), n);
    assert.equal(genEplanAml(a, { now: NOW }), genEplanAml(b, { now: NOW }), n + ": export deterministický");
  }
});

test("EPLAN AML: všechny příklady — validateEplan bez chyb a upozornění (ploché tagy i UDT), XML well-formed", () => {
  for (const n of sampleNames()) {
    const p = loadSampleFile(n);
    for (const udt of [false, true]) {
      const iss = validateEplan(p, { udt });
      assert.deepEqual(iss.map(i => i.level + " " + i.where + ": " + i.msg), [], n + (udt ? " (UDT)" : ""));
      const aml = genEplanAml(p, { udt, now: NOW });
      assert.equal(xmlProblem(aml), "", n);
      const all = ids(aml);
      assert.equal(new Set(all).size, all.length, n + ": unikátní ID");
    }
  }
});

test("EPLAN AML: hierarchie stanice → rack → CPU/karty → kanál, ID z GUID modelu, síť PROFINET, linky v nejbližším rodiči", () => {
  const p = loadSampleFile(sampleNames()[2]);
  const aml = genEplanAml(p, { now: NOW });
  const ih = aml.slice(aml.indexOf("<InstanceHierarchy"));
  assert.ok(ih.includes('ID="' + p.guid + '"'), "projekt = GUID projektu");
  for (const m of modules(p)) assert.ok(ih.includes('ID="' + m.guid + '"'), "karta " + moduleKey(m));
  /* tag = GUID signálu; kanál = poziční ID z GUID karty (Channel_<směr>_<n>), všechny kanály karty */
  for (const e of p.io) assert.ok(ih.includes('<ExternalInterface Name="' + e.tag + '" ID="' + e.guid + '" RefBaseClassPath="AutomationProjectConfigurationInterfaceClassLib/Tag"'), e.tag);
  const cap = { DI: 16, DO: 16, AI: 8, AO: 4 } as const;
  for (const m of modules(p)) for (let i = 0; i < cap[m.dir]; i++)
    assert.ok(ih.includes('<ExternalInterface Name="Channel_' + m.dir + "_" + i + '" ID="' + derivedGuid(m.guid!, "ch:" + m.dir + ":" + i) + '"'), moduleKey(m) + " " + i);
  /* role jen jako SupportedRoleClass (jako exporty EPLAN / TIA), žádné RoleRequirements */
  assert.ok(!ih.includes("<RoleRequirements"));
  /* pořadí vnoření */
  const at = (s: string) => ih.indexOf(s);
  assert.ok(at('<SupportedRoleClass RefRoleClassPath="AutomationProjectConfigurationRoleClassLib/Subnet" />') > 0);
  assert.ok(at('<InternalElement Name="Rack_0"') < at('<InternalElement Name="-A1"') && at('<InternalElement Name="-A1"') < at('<InternalElement Name="PROFINET_interface_1"'));
  assert.ok(ih.includes('<SupportedRoleClass RefRoleClassPath="AutomationProjectConfigurationEthernetRoleClassLib/NodeEthernet" />'));
  assert.ok(ih.includes('<Attribute Name="Number" AttributeDataType="xs:int"><Value>100</Value></Attribute>'), "IoSystem / MasterSystemID");
  assert.ok(ih.includes('<Attribute Name="TypeIdentifier" AttributeDataType="xs:string"><Value>System:Rack.S71200</Value></Attribute>'), "rack = rodina CPU");
  assert.ok(ih.includes('<Attribute Name="TypeIdentifier" AttributeDataType="xs:string"><Value>System:Device.S71200</Value></Attribute>'), "stanice = rodina CPU");
  assert.equal([...ih.matchAll(/Name="DeviceItemType"[^>]*><Value>([^<]+)</g)].map(m => m[1]).join(), "CPU", "DeviceItemType jen u CPU");
  /* LogicalAddress bez směru, objednací čísla Siemens s mezerou po 4. znaku */
  const la = [...ih.matchAll(/Name="LogicalAddress"[^>]*><Value>([^<]+)</g)].map(m => m[1]);
  assert.ok(la.length === p.io.length && la.every(a => /^(\d+\.\d|W\d+$)/.test(a)), la.join());
  assert.match(ih, /<Value>OrderNumber:6ES7 \d{3}-/);
  assert.ok(!/OrderNumber:6ES7\d/.test(ih), "Siemens objednací číslo bez mezery");
  /* link uzel ↔ podsíť je přímo v AutomationProject (za stanicí), linky kanál ↔ tag v Rack_0 */
  const rackEnd = ih.indexOf('</InternalElement><SupportedRoleClass RefRoleClassPath="AutomationProjectConfigurationRoleClassLib/Device" />');
  assert.ok(rackEnd > 0 && ih.lastIndexOf('<InternalLink Name="Link_' + p.io[0].tag + '"', rackEnd) > at('<InternalElement Name="Rack_0"'));
  assert.ok(ih.indexOf('<InternalLink Name="Link_PN_IE_1_E1"') > rackEnd);
  /* vícejazyčný funkční text: výchozí + cs/en/de (+ es/zh), popis zařízení se nepřekládá */
  const d = p.devices.find(x => x.id === p.io[0].devId)!;
  const tagEl = ih.slice(ih.indexOf('<ExternalInterface Name="' + p.io[0].tag + '"'));
  const comment = tagEl.slice(tagEl.indexOf('<Attribute Name="Comment"'), tagEl.indexOf("</ExternalInterface>"));
  for (const l of ["cs-CZ", "en-US", "de-DE", "es-ES", "zh-CN"]) assert.ok(comment.includes('Name="aml-lang=' + l + '"'), l);
  if (d.desc) assert.equal(comment.split(d.desc).length - 1, 6, "popis zařízení ve všech variantách beze změny");
  const enLbl = withLang("en", () => p.io[0].sig === "fbkRunning" ? "running" : "");
  if (enLbl) assert.ok(comment.includes(enLbl));
});

test("EPLAN AML: GUID stálé napříč exporty a po přejmenování tagu i zařízení (druhý import aktualizuje)", () => {
  const p = loadSampleFile(sampleNames()[3]);
  const a = ids(genEplanAml(p, { now: NOW }));
  const q = clone(p);
  const d = q.devices[0];
  const oldName = d.name;
  d.name = oldName + "X";
  for (const e of q.io.filter(x => x.devId === d.id)) e.tag = e.tag.replace(oldName, d.name);
  q.io[q.io.length - 1].tag += "_new";
  syncIO(q);
  const b = ids(genEplanAml(q, { now: NOW }));
  assert.deepEqual(b, a, "stejná ID ve stejném pořadí");
  /* nové zařízení přidá nová ID, stávající zůstanou */
  q.devices.push({ id: q.nextId++, name: "S99", cls: "DI", desc: "nový snímač", opt: {}, unit: "", rmin: 0, rmax: 100 });
  syncIO(q);
  const c = new Set(ids(genEplanAml(q, { now: NOW })));
  for (const id of a) assert.ok(c.has(id), id);
  assert.ok(c.size > a.length);
});

test("GUID: migrace starého projektu, otisky schvalování a revize beze změny, výstupy genFor beze změny", () => {
  const p = loadSampleFile(sampleNames()[2]);
  const old = stripGuids(p);
  /* starý projekt: export bez GUID hlásí upozornění (nic negeneruje) */
  const warn = validateEplan(old);
  assert.ok(warn.some(i => i.level === "warn") && !warn.some(i => i.level === "error"));
  assert.equal(old.guid, undefined, "export GUID nedoplnil");
  assert.ok(old.devices.every(d => d.guid === undefined));
  /* otisky a revize před migrací */
  const hashes = (x: Project) => approvalItems(x, { cheap: true }).map(i => i.key + "=" + i.hash).join("\n");
  const h0 = hashes(old);
  const rev = createRevision(old, "Tester", "před migrací");
  old.revisions = [rev];
  const before = clone(old);
  assert.equal(ensureGuids(old), true, "migrace doplnila");
  assert.equal(ensureGuids(old), false, "podruhé nic");
  assert.ok(isGuid(old.guid) && old.devices.every(d => isGuid(d.guid)) && old.io.every(e => isGuid(e.guid)));
  assert.equal(hashes(old), h0, "otisky schvalování nezměněny");
  assert.equal(modifiedSinceRevision(old), false, "revize nehlásí změnu");
  const diff = diffProjects(before, old);
  assert.equal(diff.changes.length, 0);
  assert.deepEqual(diff.affects, []);
  assert.equal(JSON.stringify(revisionContent(before)), JSON.stringify(revisionContent(old)));
  assert.deepEqual(validateEplan(old), [], "po migraci bez nálezů");
  /* generátor kódu GUID nečte */
  const small = sampleSmall();
  const bare = stripGuids(small);
  for (const pl of ["siemens", "rockwell", "codesys", "beckhoff", "mitsubishi", "schneider", "omron", "unitronics"] as const) {
    assert.deepEqual(genFor(bare, pl), genFor(small, pl), pl);
  }
});

test("validateAml: odhalí duplicitní ID, neexistující partnera, link mimo nejbližšího rodiče, chybějící atribut, UDT duplicitu", () => {
  const p = loadSampleFile(sampleNames()[2]);
  const ok = genEplanAml(p, { now: NOW });
  assert.deepEqual(validateAml(ok, { strict: true }), []);
  const has = (xml: string, re: RegExp, level = "error") => validateAml(xml, { strict: true }).some(i => i.level === level && re.test(i.msg));
  /* Siemens: kanály na BuiltIn podmodulu karty (ID = GUID karty + PositionNumber 1) */
  const card = derivedGuid(modules(p)[0].guid!, "builtin:1");
  /* duplicitní ID */
  assert.ok(has(ok.replace('ID="' + p.io[1].guid + '"', 'ID="' + p.io[0].guid + '"'), /Duplicitní ID/));
  /* partner neexistuje / rozhraní neexistuje */
  assert.ok(has(ok.replace('RefPartnerSideA="' + card + ':', 'RefPartnerSideA="' + newGuid() + ':'), /neexistuje/));
  assert.ok(has(ok.replace('RefPartnerSideA="' + card + ':Channel_DI_0"', 'RefPartnerSideA="' + card + ':Channel_DI_999"'), /rozhraní Channel_DI_999/));
  /* link přesunutý o úroveň výš (do stanice) — jen upozornění (TIA Portal V18 dává linky do AutomationProject) */
  const m = ok.match(/<InternalLink Name="Link_[^"]+" RefPartnerSideA="[^"]+" RefPartnerSideB="[^"]+" \/>/)!;
  const dev = '<SupportedRoleClass RefRoleClassPath="AutomationProjectConfigurationRoleClassLib/Device" />';
  const moved = ok.replace(m[0], "").replace(dev, dev + m[0]);
  assert.ok(has(moved, /nejbližším společném rodiči/, "warn") && !has(moved, /nejbližším společném rodiči/));
  /* LogicalAddress se směrem: vlastní export chyba, cizí soubor upozornění */
  const dir = ok.replace(/(Name="LogicalAddress" AttributeDataType="xs:string"><Value>)0\.0</, "$1%I0.0<");
  assert.ok(has(dir, /obsahuje směr/));
  assert.ok(validateAml(dir).some(i => i.level === "warn" && /obsahuje směr/.test(i.msg)) && !validateAml(dir).some(i => i.level === "error"));
  /* chybějící povinný atribut kanálu: vlastní export chyba, cizí soubor upozornění */
  const noIo = ok.replace(/<Attribute Name="IoType" AttributeDataType="xs:string"><Value>Input<\/Value><\/Attribute><Attribute Name="Number"/, '<Attribute Name="Number"');
  assert.ok(has(noIo, /IoType/));
  assert.ok(!validateAml(noIo).some(i => i.level === "error"), "cizí soubor: chybějící atribut jen upozornění");
  /* GUID ve špatném tvaru, neplatné XML */
  assert.ok(has(ok.replace('ID="' + p.guid + '"', 'ID="abc"'), /není GUID/));
  assert.ok(has(ok.replace("</InstanceHierarchy>", ""), /well-formed/));
  /* UDT + symbolická adresa v CPU: dva stejné tagy (bez ohledu na velikost písmen) */
  const t0 = p.io[0].tag, t1 = p.io[1].tag;
  assert.ok(has(ok.split('Name="' + t1 + '"').join('Name="' + t0.toLowerCase() + '"'), /UDT a symbolická adresa/));
  /* duplicitní název fyzické sítě */
  assert.ok(has(ok.replace(/(<InternalElement Name="PN_IE_1" ID=")([^"]+)("[\s\S]*?<\/InternalElement>)/, (_m, a, id, b) => a + id + b + a + newGuid() + b.replace(/ID="[^"]+" RefBaseClassPath/, 'ID="' + newGuid() + '" RefBaseClassPath')), /fyzické sítě/));
});

test("EPLAN AML: varianta UDT — ComplexTag s DataType, link kanál ↔ tag v UDT", () => {
  const p = loadSampleFile(sampleNames()[2]);
  const aml = genEplanAml(p, { udt: true, now: NOW });
  const d = p.devices.find(x => p.io.some(e => e.devId === x.id))!;
  assert.match(aml, new RegExp('<InternalElement Name="' + d.name + '" ID="[^"]+"><Attribute Name="DataType" AttributeDataType="xs:string"><Value>UDT_' + d.cls + "</Value>"));
  assert.ok(aml.includes('<SupportedRoleClass RefRoleClassPath="AutomationProjectConfigurationRoleClassLib/ComplexTag" />'));
  assert.deepEqual(validateAml(aml, { strict: true }), []);
  /* ID kanálů a karet jsou v obou variantách stejná */
  const flat = new Set(ids(genEplanAml(p, { now: NOW })));
  for (const e of p.io) assert.ok(flat.has(e.guid!));
});

/* ================================================================ reálné exporty (test-data/real/aml, MIT) */

const AML_DIR = new URL("../test-data/real/aml/", import.meta.url);
const realAml = (f: string) => readFileSync(new URL(f, AML_DIR), "utf8");
const REAL = ["eplan_2_7_3_arapc_example.aml", "tia_v17_s71200_vformi.aml", "twincat_empty_gain.aml"];
const short = (r: string) => r.split("/").pop()!;
const roleIs = (e: AmlElement, r: string) => e.roles.some(x => short(x) === r);

test("EPLAN AML: reálné exporty (EPLAN 2.7.3, TIA V17, TwinCAT) — validateAml bez falešných chyb, odchylky jen jako upozornění", () => {
  for (const f of REAL) {
    const iss = validateAml(realAml(f));
    assert.deepEqual(iss.filter(i => i.level === "error").map(i => i.where + ": " + i.msg), [], f);
  }
  /* EPLAN 2.7.3 (AR APC 1.0.0): LogicalAddress „I“/„Q“ a linky kanál ↔ tag mimo nejbližšího rodiče = varianta → upozornění */
  const w = validateAml(realAml(REAL[0])).map(i => i.msg);
  assert.ok(w.some(m => /obsahuje směr/.test(m)) && w.some(m => /nejbližším společném rodiči/.test(m)));
  /* role ze SupportedRoleClass (exportéry RoleRequirements nepíšou) */
  for (const f of REAL.slice(0, 2)) assert.ok(amlStructure(realAml(f)).every(e => e.roles.length > 0), f);
});

test("EPLAN AML: struktura odpovídá exportu TIA Portal V17 (S7-1200) — hierarchie, role, rodina, adresy, kanály, síť", () => {
  const tia = amlStructure(realAml("tia_v17_s71200_vformi.aml"));
  const p = loadSampleFile(sampleNames()[0]);
  const ours = amlStructure(genEplanAml(p, { now: NOW }));
  for (const [who, s] of [["TIA V17", tia], ["PLCdesk", ours]] as const) {
    /* stanice S7-1200 → Rack_0 → CPU (slot 1) → rozhraní / tagy / I/O */
    const st = s.find(e => roleIs(e, "Device") && e.attrs.TypeIdentifier?.value === "System:Device.S71200");
    assert.ok(st, who + ": Device System:Device.S71200");
    const rack = s.find(e => e.parent === st)!;
    assert.equal(rack.name, "Rack_0", who);
    assert.ok(roleIs(rack, "DeviceItem") && rack.attrs.TypeIdentifier.value === "System:Rack.S71200" && rack.attrs.PositionNumber.value === "0" && rack.attrs.BuiltIn.value === "false" && !rack.attrs.DeviceItemType, who + ": rack");
    const cpu = s.find(e => e.parent === rack && e.attrs.DeviceItemType?.value === "CPU")!;
    assert.ok(cpu && cpu.attrs.PositionNumber.value === "1" && /^OrderNumber:6ES7 \d{3}-\w{5}-\w{4}$/.test(cpu.attrs.TypeIdentifier.value), who + ": CPU " + cpu?.attrs.TypeIdentifier?.value);
    assert.ok(s.some(e => e.parent === cpu && roleIs(e, "TagTable")), who + ": TagTable pod CPU");
    const pn = s.find(e => e.parent === cpu && roleIs(e, "CommunicationInterface"))!;
    assert.ok(pn.attrs.PositionNumber.value === "32768" && pn.attrs.Label.value === "X1" && pn.attrs.BuiltIn.value === "true", who + ": PROFINET X1");
    const node = s.find(e => e.parent === pn && roleIs(e, "Node"))!;
    assert.deepEqual(node.roles.map(short), ["Node", "NodeEthernet"], who + ": Node + NodeEthernet");
    assert.ok(node.attrs.Type.value === "Ethernet" && /^\d+\.\d+\.\d+\.\d+$/.test(node.attrs.NetworkAddress.value), who);
    assert.deepEqual(node.ifaces.map(i => i.name), ["LogicalEndPoint_Node"], who);
    const ios = s.find(e => e.parent === pn && roleIs(e, "IoSystem"))!;
    assert.ok(ios.attrs.Number.value === "100" && ios.ifaces[0].name === "LogicalEndPoint_IoSystem", who + ": IoSystem");
    assert.equal(s.find(e => e.parent === pn && roleIs(e, "CommunicationPort"))!.attrs.PositionNumber.value, "32769", who + ": port");
    const sub = s.find(e => roleIs(e, "Subnet"))!;
    assert.ok(sub.depth === 1 && sub.attrs.Type.value === "Ethernet" && sub.ifaces[0].name === "LogicalEndPoint_Subnet", who + ": Subnet pod projektem");
    /* link uzel ↔ podsíť v AutomationProject */
    assert.ok(s[0].links.some(l => l.a.startsWith(node.id + ":LogicalEndPoint_Node") && l.b.startsWith(sub.id + ":LogicalEndPoint_Subnet")), who + ": link Node ↔ Subnet");
    /* kanály: název Channel_<směr>_<n>, stejné atributy; nositel je BuiltIn DeviceItem s Address */
    const holders = s.filter(e => e.ifaces.some(i => short(i.cls) === "Channel"));
    assert.ok(holders.length, who);
    for (const h of holders) {
      assert.ok(h.attrs.BuiltIn.value === "true" && h.attrs.Address && h.attrs.Address.sub.length >= 1, who + ": " + h.name + " BuiltIn s Address");
      for (const c of h.ifaces.filter(i => short(i.cls) === "Channel")) {
        assert.match(c.name, /^Channel_(DI|DO|AI|AO)_\d+$/, who);
        assert.deepEqual(Object.keys(c.attrs).sort(), ["IoType", "Length", "Number", "Type"], who + ": atributy kanálu");
      }
    }
  }
});

test("EPLAN AML: struktura odpovídá exportu EPLAN 2.7.3 — atributy projektu, tagů a kanálů, vícejazyčný Comment, Address, linky kanál ↔ tag", () => {
  const ep = amlStructure(realAml("eplan_2_7_3_arapc_example.aml"));
  const p = clone(loadSampleFile(sampleNames()[4]));
  p.platforms = ["beckhoff"];
  if (p.bom) p.bom.plat = "beckhoff";
  const ours = amlStructure(genEplanAml(p, { now: NOW }));
  const keys = (s: AmlElement[], pick: (e: AmlElement) => boolean) => [...new Set(s.filter(pick).flatMap(e => Object.keys(e.attrs)))].sort();
  /* projekt: stejná sada atributů */
  assert.deepEqual(keys(ours, e => roleIs(e, "AutomationProject")), keys(ep, e => roleIs(e, "AutomationProject")));
  /* tagy: atributy EPLANu jsou podmnožinou našich (+ IoType od AR APC 1.1.0), Comment s „aml-lang=xx-XX“ */
  const tagAttrs = (s: AmlElement[]) => [...new Set(s.flatMap(e => e.ifaces.filter(i => short(i.cls) === "Tag").flatMap(i => Object.keys(i.attrs))))].sort();
  for (const a of tagAttrs(ep)) assert.ok(tagAttrs(ours).includes(a) || a === "LogicalAddress", "Tag." + a);
  const commentSubs = (s: AmlElement[]) => s.filter(e => e.attrs.Comment?.sub.length).flatMap(e => e.attrs.Comment.sub);
  assert.ok(commentSubs(ep).length && commentSubs(ours).length);
  for (const x of [...commentSubs(ep), ...commentSubs(ours)]) assert.match(x, /^aml-lang=[a-z]{2}-[A-Z]{2}$/);
  /* kanály: stejné atributy; jiný výrobce než Siemens → ploše, karta nese Address i kanály (jako EPLAN) */
  const chAttrs = (s: AmlElement[]) => [...new Set(s.flatMap(e => e.ifaces.filter(i => short(i.cls) === "Channel").flatMap(i => Object.keys(i.attrs))))].sort();
  assert.deepEqual(chAttrs(ours), chAttrs(ep));
  for (const s of [ep, ours]) for (const h of s.filter(e => e.ifaces.some(i => short(i.cls) === "Channel"))) {
    assert.ok(h.attrs.Address && h.attrs.BuiltIn?.value !== "true", h.name + ": karta s Address");
  }
  /* jiný výrobce: stanice a rack Generic (EPLAN: System:Device.Generic / System:Rack.Generic) */
  for (const s of [ep, ours]) {
    assert.ok(s.some(e => roleIs(e, "Device") && e.attrs.TypeIdentifier?.value === "System:Device.Generic"));
    assert.ok(s.some(e => roleIs(e, "DeviceItem") && e.attrs.TypeIdentifier?.value === "System:Rack.Generic"));
    /* linky kanál ↔ tag: Channel_* na kartě ↔ rozhraní Tag v tabulce */
    const tagIds = new Set(s.flatMap(e => e.ifaces.some(i => short(i.cls) === "Tag") ? [e.id.toLowerCase()] : []));
    const ln = s.flatMap(e => e.links).filter(l => /:Channel_/.test(l.a));
    assert.ok(ln.length && ln.every(l => tagIds.has(l.b.split(":")[0].toLowerCase())));
  }
});

test("EPLAN AML: objednací čísla Siemens, LogicalAddress bez směru, rodina stanice", () => {
  assert.equal(amlOrderNumber("6ES7131-6BH01-0BA0"), "6ES7 131-6BH01-0BA0");
  assert.equal(amlOrderNumber("6ES7 131-6BH01-0BA0"), "6ES7 131-6BH01-0BA0");
  assert.equal(amlOrderNumber("6AG1214-1AG40-2XB0"), "6AG1 214-1AG40-2XB0");
  assert.equal(amlOrderNumber("6GK7243-1BX30-0XE0"), "6GK7 243-1BX30-0XE0");
  assert.equal(amlOrderNumber("6EP1332-4BA00"), "6EP1332-4BA00", "SITOP beze změny (tak ho exportuje TIA V21)");
  assert.equal(amlOrderNumber("1769-L33ER"), "1769-L33ER");
  assert.equal(amlOrderNumber("EL1008"), "EL1008");
  const e = (addr: string, dir: "DI" | "DO" | "AI" | "AO") => ({ addr, dir } as unknown as Parameters<typeof amlLogicalAddress>[1]);
  assert.equal(amlLogicalAddress("siemens", e("%I0.0", "DI")), "0.0");
  assert.equal(amlLogicalAddress("siemens", e("%Q12.7", "DO")), "12.7");
  assert.equal(amlLogicalAddress("siemens", e("%IW64", "AI")), "W64");
  assert.equal(amlLogicalAddress("siemens", e("%QW80", "AO")), "W80");
  assert.equal(amlLogicalAddress("codesys", e("%I1.2", "DI")), "1.2");
  assert.equal(amlLogicalAddress("codesys", e("%IW64", "AI")), "W32");
  assert.equal(amlLogicalAddress("beckhoff", e("%I0.0", "DI")), "");
  assert.equal(amlLogicalAddress("rockwell", e("%I0.0", "DI")), "");
  assert.equal(stationFamily("siemens", "6ES7212-1AG50-0XB0"), "S71200");
  assert.equal(stationFamily("siemens", "6ES7 511-1AK02-0AB0"), "S71500");
  assert.equal(stationFamily("siemens", "6ES7512-1DK01-0AB0"), "ET200SP");
  assert.equal(stationFamily("siemens", ""), "Generic");
  assert.equal(stationFamily("beckhoff", "6ES7212-1AG50-0XB0"), "Generic");
});

test("EPLAN AML: karty se všemi kanály, neobsazené bez linku; tečka v názvu projektu a stanice nahrazena", () => {
  const p = clone(loadSampleFile(sampleNames()[0]));
  p.meta.name = "Linka 2.0 v1.3";
  const s = amlStructure(genEplanAml(p, { now: NOW }));
  assert.equal(s[0].name, "Linka 2_0 v1_3", "konfigurační projekt 20161 bez tečky");
  assert.ok(s.filter(e => roleIs(e, "Device")).every(e => !e.name.includes(".")), "ID stanice 20408 bez tečky");
  const cap = { DI: 16, DO: 16, AI: 8, AO: 4 } as const;
  for (const m of modules(p)) {
    const holder = s.find(e => e.parent?.id === m.guid && e.attrs.BuiltIn?.value === "true")!;
    assert.equal(holder.ifaces.filter(i => short(i.cls) === "Channel").length, cap[m.dir], moduleKey(m));
  }
  const links = s.flatMap(e => e.links).filter(l => /:Channel_/.test(l.a));
  assert.equal(links.length, p.io.length, "link jen u obsazených kanálů");
});
