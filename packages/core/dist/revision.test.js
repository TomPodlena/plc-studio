/** Testy revizí a změnového řízení (revision.ts) — node:test, bez externích závislostí. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { syncIO, modules, stripDia } from "./model.js";
import { setLang, withLang, LANGS } from "./i18n.js";
import { approvalItems, approve, approvalStatus } from "./approval.js";
import { registerSafetyModule, unregisterSafetyModule, proposeSafety } from "./safety.js";
import { docFiles } from "./docs.js";
import { sheetSVG, sheetDXF } from "./drawing.js";
import { sampleSmall } from "./samples.js";
import { createRevision, listRevisions, revisionSnapshot, revisionContent, nextRevisionId, latestRevision, modifiedSinceRevision, revisionLabel, diffProjects, diffRevisions, changesSinceRevision, retestScope, changesMd, revisionTableMd, CHANGES_FILE, } from "./revision.js";
const SAMPLES = new URL("../../../samples/", import.meta.url); // dist/ → kořen repozitáře
const SAMPLE_NAMES = readdirSync(SAMPLES).filter(f => f.endsWith(".plcstudio.json")).sort();
function loadSample(name) {
    const j = JSON.parse(readFileSync(new URL(name.endsWith(".json") ? name : name + ".plcstudio.json", SAMPLES), "utf8"));
    const p = j.prj || j;
    syncIO(p);
    return p;
}
const clone = (p) => JSON.parse(JSON.stringify(p));
const AT = "2026-10-03T10:00:00.000Z";
function withSafety(fn) {
    const off = registerSafetyModule();
    try {
        fn();
    }
    finally {
        off();
    }
}
unregisterSafetyModule();
/** Obraz změny nezávislý na směru: inverzní změna má prohozené přidáno / odebráno a před / po. */
const norm = (c, inv = false) => JSON.stringify({
    area: c.area, field: c.field ?? null,
    op: inv ? (c.op === "add" ? "remove" : c.op === "remove" ? "add" : "change") : c.op,
    before: inv ? c.after ?? null : c.before ?? null, after: inv ? c.before ?? null : c.after ?? null,
    cls: c.cls, affects: [...c.affects].sort(), maybe: [...c.maybe].sort(),
    stepA: inv ? c.stepB ?? null : c.stepA ?? null, stepB: inv ? c.stepA ?? null : c.stepB ?? null,
});
function assertInverse(d1, d2) {
    assert.deepEqual(d1.changes.map(c => norm(c)).sort(), d2.changes.map(c => norm(c, true)).sort(), "diff(b, a) = inverze diff(a, b)");
    assert.equal(d1.cls, d2.cls);
    assert.deepEqual([...d1.affects].sort(), [...d2.affects].sort());
    assert.deepEqual([...d1.maybe].sort(), [...d2.maybe].sort());
}
/** Úprava pro test: čas kroku, popis, adresa, takt, platforma, nové zařízení, odebraný krok. */
function mutate(p) {
    const q = clone(p);
    if (q.program.seq.length)
        q.program.seq[0].timeS = (q.program.seq[0].timeS || 1) + 0.5;
    if (q.devices.length)
        q.devices[0].desc = (q.devices[0].desc || "") + " (upraveno)";
    const e = q.io.find(x => x.dir === "DO");
    if (e)
        e.addr = "%Q99.7";
    q.meta.takt = (q.meta.takt || 10) + 1;
    q.platforms = q.platforms.includes("codesys") ? q.platforms.filter(x => x !== "codesys") : [...q.platforms, "codesys"];
    q.devices.push({ id: q.nextId++, name: "H99", cls: "DO", desc: "Signálka test", opt: {}, unit: "", rmin: 0, rmax: 0 });
    syncIO(q);
    if (q.program.seq.length > 2)
        q.program.seq.splice(1, 1);
    return q;
}
test("revize: označení A, B… a 01, 02…, jméno povinné, snímek obsahu bez revizí a schválení", () => {
    const p = sampleSmall();
    assert.throws(() => createRevision(p, " "), /name/);
    assert.equal(nextRevisionId(p), "A");
    assert.equal(nextRevisionId(p, "number"), "01");
    const a = createRevision(p, "Jan Novák", "první vydání", { at: AT });
    assert.equal(a.id, "A");
    assert.equal(nextRevisionId(p), "B");
    const b = createRevision(p, "Jan Novák", "", { at: AT });
    assert.equal(b.id, "B");
    assert.throws(() => createRevision(p, "Jan", "", { id: "b" }), /duplicate/);
    const q = sampleSmall();
    assert.equal(createRevision(q, "X", "", { scheme: "number" }).id, "01");
    assert.equal(createRevision(q, "X").id, "02", "schéma podle poslední revize");
    const z = sampleSmall();
    z.revisions = [{ ...a, id: "Z" }];
    assert.equal(nextRevisionId(z), "AA");
    /* snímek: obsah bez revizí, schválení a oživení; kanonický (pořadí klíčů nehraje roli) */
    const snap = revisionSnapshot(p, "A");
    assert.equal(snap.revisions, undefined);
    assert.deepEqual(revisionContent(snap), revisionContent(p));
    assert.ok(!a.snapshot.includes("\"revisions\""));
    assert.deepEqual(listRevisions(p).map(r => r.id), ["A", "B"]);
    assert.equal(latestRevision(p).id, "B");
    assert.equal(modifiedSinceRevision(p), false);
    assert.equal(revisionLabel(p), "B");
    p.devices[0].desc += " x";
    assert.equal(modifiedSinceRevision(p), true);
    assert.equal(revisionLabel(p), "B*");
    assert.equal(changesSinceRevision(sampleSmall()), null);
});
test("revize: stav schválení v okamžiku vydání (approvalsAt, platnost, počet)", () => {
    const p = sampleSmall();
    for (const it of approvalItems(p))
        if (it.required)
            approve(p, it.key, "Jan Novák", "", AT);
    const r = createRevision(p, "Jan Novák", "", { at: AT, items: approvalItems(p) });
    assert.ok(Object.keys(r.approvalsAt).length > 0);
    assert.ok(Object.values(r.approvalsAt).every(x => x.valid === true), "vše platně schválené");
    assert.equal(r.approved.valid, r.approved.required);
    const snap = revisionSnapshot(p, r.id);
    for (const it of approvalItems(snap))
        if (it.required)
            assert.equal(approvalStatus(snap, it), "approved", "snímek nese platná schválení " + it.key);
});
test("diff: shodné projekty → prázdný; přeuspořádání klíčů a kopie nic nemění", () => {
    for (const name of SAMPLE_NAMES.slice(0, 4)) {
        const p = loadSample(name);
        const d = diffProjects(p, clone(p));
        assert.ok(d.empty, name);
        assert.equal(d.cls, null);
        assert.deepEqual(d.affects, []);
        assert.deepEqual(d.maybe, []);
    }
    const p = sampleSmall();
    const q = JSON.parse(JSON.stringify(p, Object.keys(p).reverse()));
    Object.assign(q, clone(p));
    assert.ok(diffProjects(p, q).empty);
});
test("diff: symetrický a inverzní (přidání, odebrání, změny) — i s bezpečnostním modulem", () => {
    for (const reg of [false, true]) {
        const run = () => {
            for (const name of ["01_pasovy_dopravnik_vyhazovac", "03_nytovaci_lis_NL-1"]) {
                const a = loadSample(name), b = mutate(a);
                const d1 = diffProjects(a, b), d2 = diffProjects(b, a);
                assert.ok(d1.changes.length >= 6, name + ": " + d1.changes.map(c => c.text).join(" | "));
                assertInverse(d1, d2);
                assert.ok(d1.changes.some(c => c.area === "device" && c.op === "add" && c.ref === "dev:H99"));
                assert.ok(d2.changes.some(c => c.area === "device" && c.op === "remove" && c.ref === "dev:H99"));
                assert.ok(d1.changes.some(c => c.area === "seq" && c.op === "remove"), "odebraný krok rozpoznán (zarovnání), ne posun všech");
                assert.ok(!d1.changes.some(c => c.area === "seq" && c.op === "change" && c.field === "cond"), "zarovnání kroků bez falešných změn");
                assert.ok(d1.changes.some(c => c.area === "platform"));
            }
        };
        if (reg)
            withSafety(run);
        else
            run();
    }
});
test("diff: změna času kroku → funkční, dotčené položky = přesně ty, které approval.ts označí jako změněné po schválení", () => {
    const a = loadSample("01_pasovy_dopravnik_vyhazovac");
    for (const it of approvalItems(a))
        if (it.required)
            approve(a, it.key, "Jan Novák", "", AT);
    const b = clone(a);
    const i = b.program.seq.findIndex(s => s.cond === "fbk" && (s.act === "start" || s.act === "open"));
    b.program.seq[i].timeS = b.program.seq[i].timeS + 2;
    const d = diffProjects(a, b, { exact: true });
    assert.equal(d.cls, "functional");
    assert.equal(d.changes.length, 1);
    const c = d.changes[0];
    assert.equal(c.area, "seq");
    assert.equal(c.field, "timeS");
    assert.equal(c.stepB, i);
    assert.ok(c.affects.includes("seq") && c.affects.includes("limits"), c.affects.join(","));
    const stale = approvalItems(b).filter(it => approvalStatus(b, it) === "stale").map(it => it.key).sort();
    assert.ok(stale.length >= 2);
    assert.deepEqual([...d.invalidates].sort(), stale, "zneplatněná schválení = stale v approval.ts");
    assert.deepEqual([...c.affects].sort(), [...d.affects].sort(), "jediná změna nese všechny dotčené položky");
    /* levný výpočet: jisté položky jsou podmnožinou, ověření je „možná“ */
    const cheap = diffProjects(a, b);
    for (const k of cheap.affects)
        assert.ok(stale.includes(k) || !a.approvals[k], "levně: " + k);
    for (const k of stale)
        assert.ok(cheap.affects.includes(k) || cheap.maybe.includes(k), "levně pokryto " + k);
    /* rozsah zkoušek: krok sekvence, celý cyklus, hlídací časy; žádná bezpečnostní validace */
    const sc = retestScope(b, d, { exact: true });
    const ids = sc.commissioning.map(s => s.id);
    assert.ok(ids.some(x => x.startsWith("seq:" + (i + 1) + ":")), ids.join(","));
    assert.ok(ids.includes("seq:dry") && ids.includes("par:watchdog"), ids.join(","));
    assert.ok(!ids.some(x => x.startsWith("io:")), "smyčkový test I/O se neopakuje");
    assert.ok(!ids.some(x => x.startsWith("sf:") || x === "safety:validation"));
    assert.ok(sc.fat.some(f => f.ref === "seq:" + (i + 1)));
    assert.deepEqual(sc.safety, []);
    assert.deepEqual([...sc.approvals].sort(), stale);
});
test("diff: přejmenování popisu a komentáře → kosmetická, nic nezneplatní, žádné zkoušky", () => {
    const a = loadSample("01_pasovy_dopravnik_vyhazovac");
    for (const it of approvalItems(a))
        if (it.required)
            approve(a, it.key, "Jan Novák", "", AT);
    const b = clone(a);
    b.devices[0].desc = "Jiný popis";
    b.io[0].cmt = "Jiný komentář";
    b.meta.name = "Jiný název";
    for (const exact of [false, true]) {
        const d = diffProjects(a, b, { exact });
        assert.equal(d.cls, "cosmetic");
        assert.equal(d.changes.length, 3);
        assert.ok(d.changes.every(c => c.cls === "cosmetic" && !c.affects.length && !c.maybe.length), d.changes.map(c => c.text + c.affects).join(" | "));
        assert.deepEqual(d.invalidates, []);
        const sc = retestScope(b, d);
        assert.deepEqual(sc.commissioning, []);
        assert.deepEqual(sc.fat, []);
        assert.equal(sc.notes.length, 1);
    }
    const ch = diffProjects(a, b).changes.find(c => c.area === "device");
    assert.equal(ch.field, "desc");
    assert.match(ch.text, /Jiný popis/);
});
test("diff: změna PLr → bezpečnostní, dotčená funkce a její validace (fáze 10)", () => {
    withSafety(() => {
        const a = loadSample("03_nytovaci_lis_NL-1");
        const f = proposeSafety(a).fns.find(x => !x.off && x.risk.plr && x.risk.plr !== "e");
        assert.ok(f, "funkce s PLr");
        const b = clone(a);
        b.safety = b.safety || {};
        b.safety.fn = { ...(b.safety.fn || {}), [f.ref]: { plr: "e", plrSource: "EN ISO 16092-3 (test)" } };
        const d = diffProjects(a, b);
        assert.equal(d.cls, "safety");
        const plr = d.changes.find(c => c.field === "plr");
        assert.ok(plr, d.changes.map(c => c.text).join(" | "));
        assert.equal(plr.sf, f.ref);
        assert.equal(plr.before, f.risk.plr);
        assert.equal(plr.after, "e");
        assert.equal(plr.cls, "safety");
        assert.ok(plr.affects.includes("safety:" + f.id), plr.affects.join(","));
        assert.ok(d.changes.some(c => c.field === "cfg.plrSource"));
        assertInverse(d, diffProjects(b, a));
        /* shoda s approval.ts: schválené položky funkce jsou po změně „stale“ */
        for (const it of approvalItems(a))
            if (it.key.startsWith("safety:" + f.id))
                approve(a, it.key, "Jan Novák", "", AT);
        b.approvals = clone(a).approvals;
        const st = approvalItems(b).filter(it => it.key.startsWith("safety:" + f.id) && approvalStatus(b, it) === "stale").map(it => it.key);
        assert.ok(st.includes("safety:" + f.id));
        const d2 = diffProjects(a, b);
        for (const k of st)
            assert.ok(d2.invalidates.includes(k), k);
        const sc = retestScope(b, d2);
        const s = sc.safety.find(x => x.ref === f.ref);
        assert.ok(s && s.steps.length > 0, JSON.stringify(sc.safety));
        assert.ok(s.steps.every(x => x.startsWith("sf:" + f.ref + ":")));
        const ids = sc.commissioning.map(x => x.id);
        for (const x of s.steps)
            assert.ok(ids.includes(x));
        assert.ok(ids.includes("sf:report"), "validační zpráva");
        assert.ok(sc.notes.some(n => /ISO 13849-2/.test(n)));
    });
});
test("diff: změna adresy výstupu s bezpečnostním modulem → funkční jen pro dotčený signál", () => {
    withSafety(() => {
        for (const name of ["01_pasovy_dopravnik_vyhazovac", "03_nytovaci_lis_NL-1"]) {
            const a = loadSample(name), b = clone(a);
            const e = b.io.find(x => x.dir === "DO");
            e.addr = "%Q99.7";
            const d = diffProjects(a, b, { exact: true });
            assert.equal(d.changes.length, 1, name);
            assert.equal(d.cls, d.affects.some(k => k.startsWith("safety:")) ? "safety" : "functional", name + ": klasifikace podle skutečně dotčených položek");
            const sc = retestScope(b, d, { exact: true });
            const loops = sc.commissioning.filter(s => s.phase === 2).map(s => s.id);
            assert.equal(loops.length, 1, name + " " + loops.join(","));
            assert.ok(sc.fat.some(f => f.ref === "io:" + e.tag));
        }
    });
});
test("diff: bez bezpečnostního modulu změna vstupu E-stopu → bezpečnostní (safety:external)", () => {
    const a = loadSample("01_pasovy_dopravnik_vyhazovac");
    const b = clone(a);
    const es = b.devices.find(d => d.id === b.program.estop);
    const e = b.io.find(x => x.devId === es.id);
    e.tag = e.tag + "_X";
    const d = diffProjects(a, b);
    assert.equal(d.cls, "safety");
    assert.ok(d.affects.includes("safety:external"));
    const sc = retestScope(b, d);
    assert.ok(sc.commissioning.some(s => s.id === "safety:validation"));
});
test("revize: 12 příkladů — revize → úprava → rozdíl, zpráva 17_zmeny.md bez pádu", () => {
    assert.equal(SAMPLE_NAMES.length, 12);
    withSafety(() => {
        for (const name of SAMPLE_NAMES) {
            const p = loadSample(name);
            createRevision(p, "Jan Novák", "první vydání", { at: AT });
            const q = mutate(p);
            q.revisions = p.revisions;
            const d = diffRevisions(q, "A");
            assert.ok(d.changes.length >= 5, name);
            assert.ok(d.cls === "functional" || d.cls === "safety", name + " " + d.cls);
            assert.ok(d.changes.some(c => c.cls === "cosmetic"), name);
            const sc = retestScope(q, d);
            assert.ok(sc.commissioning.length > 0, name);
            const md = changesMd(q);
            assert.ok(md.startsWith("# Revize a změny"), name);
            assert.ok(md.includes("| **A** |") && md.includes("A*"), name);
            createRevision(q, "Jan Novák", "úprava", { at: AT });
            assert.equal(listRevisions(q, { classify: true })[1].cls, d.cls, name + ": klasifikace v tabulce revizí");
            assert.ok(diffRevisions(q, "A", "B").changes.length === d.changes.length, name);
            assert.ok(changesMd(q).includes("revize A → revize B") || changesMd(q).includes("revize A"), name);
        }
    });
});
test("dokumenty a výkresy: 17_zmeny.md jen s revizí, sloupec Rev v popisovém poli (SVG i DXF)", () => {
    const p = sampleSmall();
    assert.ok(!docFiles(p).some(f => f.path === CHANGES_FILE), "bez revize dokument není");
    const m = modules(p)[0];
    assert.match(sheetSVG(p, m, 1), />0\.1</);
    createRevision(p, "Jan Novák", "", { at: AT });
    const f = docFiles(p).find(x => x.path === CHANGES_FILE);
    assert.ok(f && /Revize a změny/.test(f.body));
    assert.match(sheetSVG(p, m, 1), />A</);
    assert.ok(sheetDXF(p, m, 1).includes("\nA\n"));
    p.devices[0].desc += " x";
    assert.match(sheetSVG(p, m, 1), />A\*</);
    assert.match(sheetSVG(p, m, 1, 1, 1, { projectName: "x", date: "1.1.2026", rev: "C" }), />C</, "meta.rev přebíjí");
    assert.match(revisionTableMd(p), /\| \*\*A\*\* \|/);
});
test("i18n: zpráva o změnách bez češtiny v cizích jazycích", () => {
    const CZ = /[ěščřžůďťňĚŠČŘŽŮĎŤŇ]/;
    /* obsah projektu se nepřekládá — pro test bez diakritiky */
    const deep = (v) => typeof v === "string" ? stripDia(v) : Array.isArray(v) ? v.map(deep)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v;
    withSafety(() => {
        const a = deep(loadSample("03_nytovaci_lis_NL-1"));
        createRevision(a, "Jan Novak", "prvni vydani", { at: AT });
        const b = mutate(a);
        b.devices[0].desc = stripDia(b.devices[0].desc);
        b.io[0].cmt = "Novy komentar";
        const f = proposeSafety(b).fns.find(x => !x.off && x.risk.plr && x.risk.plr !== "e");
        b.safety = { ...(b.safety || {}), dop: 300, fn: { ...(b.safety?.fn || {}), [f.ref]: { plr: "e", plrSource: "EN ISO 16092-3" } } };
        b.bom = { brand: { motor: "x" } };
        b.revisions = a.revisions;
        for (const l of Object.keys(LANGS).filter(l => l !== "cs")) {
            const md = withLang(l, () => changesMd(b));
            const bad = md.split("\n").filter(x => CZ.test(x));
            assert.deepEqual(bad, [], l + ": " + bad.slice(0, 5).join(" ⏎ "));
        }
    });
    setLang("cs");
});
