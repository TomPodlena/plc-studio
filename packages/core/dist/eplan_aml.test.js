/** Testy GUID (guid.ts) a exportu EPLAN AutomationML AR APC v2 (eplan_aml.ts) — node:test, bez závislostí. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withLang } from "./i18n.js";
import { blankProject, syncIO, modules, ensureGuids } from "./model.js";
import { newGuid, derivedGuid, isGuid, moduleKey } from "./guid.js";
import { genEplanAml, validateEplan, validateAml } from "./eplan_aml.js";
import { approvalItems } from "./approval.js";
import { createRevision, modifiedSinceRevision, diffProjects, revisionContent } from "./revision.js";
import { genFor } from "./codegen.js";
import { sampleSmall } from "./samples.js";
import { sampleNames, loadSampleFile, xmlProblem, SAMPLE_DIR } from "./exp_util.test.js";
const NOW = new Date("2026-10-04T08:00:00Z");
const clone = (x) => JSON.parse(JSON.stringify(x));
/** ID všech InternalElementů a ExternalInterface v instanční hierarchii (bez knihoven tříd). */
function ids(aml) {
    const ih = aml.slice(aml.indexOf("<InstanceHierarchy"), aml.indexOf("</InstanceHierarchy>"));
    return [...ih.matchAll(/<(?:InternalElement|ExternalInterface) Name="[^"]*" ID="([^"]+)"/g)].map(m => m[1]);
}
/** Projekt bez jakýchkoli GUID (stav před v2). */
function stripGuids(p) {
    const q = clone(p);
    delete q.guid;
    delete q.moduleGuids;
    for (const d of q.devices)
        delete d.guid;
    for (const e of q.io)
        delete e.guid;
    return q;
}
test("GUID: formát v4, unikátnost, odvozené deterministicky (v8)", () => {
    const s = new Set();
    for (let i = 0; i < 2000; i++) {
        const g = newGuid();
        assert.match(g, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        s.add(g);
    }
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
    assert.ok(modules(p).every(m => isGuid(m.guid) && p.moduleGuids[moduleKey(m)] === m.guid));
    const before = JSON.stringify([p.guid, d.guid, p.io.map(e => e.guid), p.moduleGuids]);
    /* přejmenování zařízení i tagu GUID nemění; opakovaný syncIO / ensureGuids také ne */
    d.name = "M10";
    p.io[0].tag = "Motor10_bezi";
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
        assert.ok(raw.devices.every((d) => isGuid(d.guid)), n + ": GUID zařízení v souboru");
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
    for (const m of modules(p))
        assert.ok(ih.includes('ID="' + m.guid + '"'), "karta " + moduleKey(m));
    for (const e of p.io)
        assert.match(ih, new RegExp('<ExternalInterface Name="[A-Z]{2}_\\d+" ID="' + e.guid + '" RefBaseClassPath="AutomationProjectConfigurationInterfaceClassLib/Channel"'), e.tag);
    /* pořadí vnoření */
    const at = (s) => ih.indexOf(s);
    assert.ok(at('RefBaseRoleClassPath="AutomationProjectConfigurationRoleClassLib/Subnet"') > 0);
    assert.ok(at('<InternalElement Name="Rack_0"') < at('<InternalElement Name="-A1"') && at('<InternalElement Name="-A1"') < at('<InternalElement Name="PROFINET_interface_1"'));
    assert.ok(ih.includes('<SupportedRoleClass RefRoleClassPath="AutomationProjectConfigurationEthernetRoleClassLib/NodeEthernet" />'));
    assert.ok(ih.includes('<Attribute Name="Number" AttributeDataType="xs:int"><Value>100</Value></Attribute>'), "IoSystem / MasterSystemID");
    assert.ok(ih.includes('<Attribute Name="TypeIdentifier" AttributeDataType="xs:string"><Value>System:Rack.Generic</Value></Attribute>'));
    /* link uzel ↔ podsíť je přímo v AutomationProject (za stanicí), linky kanál ↔ tag v Rack_0 */
    const rackEnd = ih.indexOf('<RoleRequirements RefBaseRoleClassPath="AutomationProjectConfigurationRoleClassLib/DeviceItem" /></InternalElement><RoleRequirements RefBaseRoleClassPath="AutomationProjectConfigurationRoleClassLib/Device" />');
    assert.ok(rackEnd > 0 && ih.lastIndexOf('<InternalLink Name="Link_' + p.io[0].tag + '"', rackEnd) > at('<InternalElement Name="Rack_0"'));
    assert.ok(ih.indexOf('<InternalLink Name="Link_PN_IE_1_E1"') > rackEnd);
    /* vícejazyčný funkční text: výchozí + cs/en/de (+ es/zh), popis zařízení se nepřekládá */
    const d = p.devices.find(x => x.id === p.io[0].devId);
    const tagEl = ih.slice(ih.indexOf('<ExternalInterface Name="' + p.io[0].tag + '"'));
    const comment = tagEl.slice(tagEl.indexOf('<Attribute Name="Comment"'), tagEl.indexOf("</ExternalInterface>"));
    for (const l of ["cs-CZ", "en-US", "de-DE", "es-ES", "zh-CN"])
        assert.ok(comment.includes('Name="aml-lang=' + l + '"'), l);
    if (d.desc)
        assert.equal(comment.split(d.desc).length - 1, 6, "popis zařízení ve všech variantách beze změny");
    const enLbl = withLang("en", () => p.io[0].sig === "fbkRunning" ? "running" : "");
    if (enLbl)
        assert.ok(comment.includes(enLbl));
});
test("EPLAN AML: GUID stálé napříč exporty a po přejmenování tagu i zařízení (druhý import aktualizuje)", () => {
    const p = loadSampleFile(sampleNames()[3]);
    const a = ids(genEplanAml(p, { now: NOW }));
    const q = clone(p);
    const d = q.devices[0];
    const oldName = d.name;
    d.name = oldName + "X";
    for (const e of q.io.filter(x => x.devId === d.id))
        e.tag = e.tag.replace(oldName, d.name);
    q.io[q.io.length - 1].tag += "_new";
    syncIO(q);
    const b = ids(genEplanAml(q, { now: NOW }));
    assert.deepEqual(b, a, "stejná ID ve stejném pořadí");
    /* nové zařízení přidá nová ID, stávající zůstanou */
    q.devices.push({ id: q.nextId++, name: "S99", cls: "DI", desc: "nový snímač", opt: {}, unit: "", rmin: 0, rmax: 100 });
    syncIO(q);
    const c = new Set(ids(genEplanAml(q, { now: NOW })));
    for (const id of a)
        assert.ok(c.has(id), id);
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
    const hashes = (x) => approvalItems(x, { cheap: true }).map(i => i.key + "=" + i.hash).join("\n");
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
    for (const pl of ["siemens", "rockwell", "codesys", "beckhoff", "mitsubishi", "schneider", "omron", "unitronics"]) {
        assert.deepEqual(genFor(bare, pl), genFor(small, pl), pl);
    }
});
test("validateAml: odhalí duplicitní ID, neexistující partnera, link mimo nejbližšího rodiče, chybějící atribut, UDT duplicitu", () => {
    const p = loadSampleFile(sampleNames()[2]);
    const ok = genEplanAml(p, { now: NOW });
    assert.deepEqual(validateAml(ok), []);
    const has = (xml, re) => validateAml(xml).some(i => i.level === "error" && re.test(i.msg));
    const card = modules(p)[0].guid;
    /* duplicitní ID */
    assert.ok(has(ok.replace('ID="' + p.io[1].guid + '"', 'ID="' + p.io[0].guid + '"'), /Duplicitní ID/));
    /* partner neexistuje / rozhraní neexistuje */
    assert.ok(has(ok.replace('RefPartnerSideA="' + card + ':', 'RefPartnerSideA="' + newGuid() + ':'), /neexistuje/));
    assert.ok(has(ok.replace('RefPartnerSideA="' + card + ':DI_0"', 'RefPartnerSideA="' + card + ':DI_999"'), /rozhraní DI_999/));
    /* link přesunutý o úroveň výš (do stanice) */
    const m = ok.match(/<InternalLink Name="Link_[^"]+" RefPartnerSideA="[^"]+" RefPartnerSideB="[^"]+" \/>/);
    const moved = ok.replace(m[0], "").replace('<RoleRequirements RefBaseRoleClassPath="AutomationProjectConfigurationRoleClassLib/Device" />', m[0] + '<RoleRequirements RefBaseRoleClassPath="AutomationProjectConfigurationRoleClassLib/Device" />');
    assert.ok(has(moved, /nejbližším společném rodiči/));
    /* chybějící povinný atribut kanálu */
    assert.ok(has(ok.replace(/<Attribute Name="IoType" AttributeDataType="xs:string"><Value>Input<\/Value><\/Attribute><Attribute Name="Number"/, '<Attribute Name="Number"'), /IoType/));
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
    const d = p.devices.find(x => p.io.some(e => e.devId === x.id));
    assert.match(aml, new RegExp('<InternalElement Name="' + d.name + '" ID="[^"]+"><Attribute Name="DataType" AttributeDataType="xs:string"><Value>UDT_' + d.cls + "</Value>"));
    assert.ok(aml.includes('RefBaseRoleClassPath="AutomationProjectConfigurationRoleClassLib/ComplexTag"'));
    assert.deepEqual(validateAml(aml), []);
    /* ID kanálů a karet jsou v obou variantách stejná */
    const flat = new Set(ids(genEplanAml(p, { now: NOW })));
    for (const e of p.io)
        assert.ok(flat.has(e.guid));
});
