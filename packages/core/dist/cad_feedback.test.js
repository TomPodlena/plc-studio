/**
 * Zpětná vazba z CAD (cad_feedback.ts, formát plcdesk-cad-feedback v1 podle FEEDBACK_SCHEMA.md):
 * validace, otisk manifestu (zastaralé), neplatné partId / jiný projekt, přijetí / odmítnutí / alternativa,
 * změna kusovníku i manifestu, historie a 09_kusovnik.md, idempotence, vzor 11 „skříň mělká pro -TA1“
 * → větší skříň z katalogu. K tomu opravy kusovníku odhalené ve 3D: svorky = svorkovnice výkresů,
 * typ katalogu bez slepených alternativ, rozměry skříní a měničů v katalogu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncIO, validateProject } from "./model.js";
import { buildBom, bomMd, bomCsv } from "./bom.js";
import { CATALOG, brandsFor } from "./catalog.js";
import { cadManifest, cadManifestJson } from "./cad.js";
import { parseCadFeedback, cadFeedbackReview, applyCadFeedback, sha256Text, cadManifestSha256, cadFbProposalText, CAD_FEEDBACK_KINDS, CAD_FEEDBACK_KIND_LABEL, } from "./cad_feedback.js";
import { normalizeProject } from "./project_norm.js";
import { svorkyCSV } from "./docs.js";
import { setLang, LANGS } from "./i18n.js";
import { sampleSmall } from "./samples.js";
import { sampleNames, loadSampleFile } from "./exp_util.test.js";
const S11 = "11_podavaci_lisovaci_stanice_PS-11.plcstudio.json";
const clone = (o) => JSON.parse(JSON.stringify(o));
/** Zpětná vazba podle příkladu ze schématu: skříň mělká pro měnič -TA1 (vzor 11). */
function fb11(prj, over = {}) {
    return {
        format: "plcdesk-cad-feedback", version: 1, project: { guid: prj.guid || "" },
        manifest: { sha256: cadManifestSha256(prj) }, created: "2026-10-14T12:00:00Z", tool: "plcdesk_freecad 0.1",
        issues: [
            {
                id: "fit-cabinet-depth-1", kind: "cabinet_too_small", severity: "error", parts: ["+1:cabinet", "-TA1:vfd"],
                measured: { what: "hloubka", value: 226, unit: "mm", source: "model 3Dfindit V20 / G120C datasheet" },
                required: { what: "hloubka skříně (užitná)", min: 246, unit: "mm", basis: "226 mm + 20 mm rezerva (rozvadec-3d)" },
                message: "Měnič -TA1 (226 mm) se nevejde do skříně +1 (užitná hloubka 190 mm).",
            },
            {
                id: "qty-x1", kind: "qty_mismatch", severity: "warn", parts: ["-X1:terminal_block"],
                message: "Na svorkovnici X1 je v modelu 10 svorek (8 I/O + 2 napájení).",
                suggestion: { partId: "-X1:terminal_block", line: { qty: 10, note: "2 svorky napájení podle 3D" } },
            },
            {
                id: "code-ta1", kind: "ambiguous_type", severity: "info", parts: ["-TA1:vfd"],
                message: "Pro PROFINET zvaž G120C.",
                suggestion: { partId: "-TA1:vfd", line: { orderCode: "6SL3210-1KE12-3UF2" },
                    alternatives: [{ type: "Vlastní měnič XY", orderCode: "XY-1", brand: "Firma XY", why: "sklad" }] },
            },
        ],
        ...over,
    };
}
test("validace: chybějící a chybné položky → srozumitelné chyby s cestou", () => {
    assert.match(parseCadFeedback("{").errors[0], /JSON/);
    assert.match(parseCadFeedback('{"format":"plcdesk-cad","version":1}').errors[0], /plcdesk-cad-feedback/);
    assert.match(parseCadFeedback('{"format":"plcdesk-cad-feedback","version":2}').errors[0], /verze/);
    const p = loadSampleFile(S11);
    const bad = clone(fb11(p));
    bad.manifest.sha256 = "abc";
    bad.issues[0].severity = "fatal";
    bad.issues[0].measured.source = "";
    bad.issues[1].id = "fit-cabinet-depth-1";
    bad.issues[2].suggestion.line.qty = -1;
    bad.issues.push({ id: "x", kind: "nevim", severity: "info", parts: "a", message: "" });
    const r = parseCadFeedback(JSON.stringify(bad));
    assert.equal(r.fb, null);
    const all = r.errors.join("\n");
    for (const want of ["manifest.sha256", "issues[0].severity", "issues[0].measured.source", "issues[1].id",
        "issues[2].suggestion.line.qty", "issues[3].kind", "issues[3].parts", "issues[3].message"])
        assert.ok(all.includes(want), "chybí chyba " + want + "\n" + all);
    /* platný soubor (s BOM, neznámý klíč navíc) projde */
    const ok = parseCadFeedback("﻿" + JSON.stringify({ ...fb11(p), extra: 1 }));
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.fb.issues.length, 3);
    assert.deepEqual(Object.keys(CAD_FEEDBACK_KIND_LABEL).sort(), [...CAD_FEEDBACK_KINDS].sort());
});
test("SHA-256: shoda se známými vektory a s otiskem souboru manifestu", async () => {
    assert.equal(sha256Text(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert.equal(sha256Text("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const { createHash } = await import("node:crypto");
    const txt = cadManifestJson(loadSampleFile(S11));
    assert.equal(sha256Text(txt), createHash("sha256").update(txt, "utf8").digest("hex"));
    const long = "ř".repeat(1000) + "x".repeat(57);
    assert.equal(sha256Text(long), createHash("sha256").update(long, "utf8").digest("hex"));
});
test("vzor 11: skříň mělká pro -TA1 → nejmenší větší skříň z katalogu, přijetí změní kusovník i manifest", () => {
    const p = loadSampleFile(S11);
    const fb = parseCadFeedback(JSON.stringify(fb11(p))).fb;
    const rv = cadFeedbackReview(p, fb);
    assert.equal(rv.projectMatch, true);
    assert.equal(rv.stale, false);
    assert.deepEqual(rv.counts, { usable: 3, stale: 0, invalid: 0 });
    assert.equal(rv.items[0].severity, "error", "chyby první");
    const cab = rv.items.find(i => i.id === "fit-cabinet-depth-1");
    assert.equal(cab.partId, "+1:cabinet");
    assert.ok(cab.proposal, "návrh skříně z katalogu");
    assert.equal(cab.proposal.source, "catalog");
    assert.equal(cab.proposal.orderCode, "1057.000", "nejmenší Rittal AX s hloubkou ≥ 246 mm (500×700×250)");
    assert.ok(cab.alternatives.length >= 1 && cab.alternatives.every(a => a.source === "catalog"));
    const cabs = brandsFor("cabinet", buildBom(p).plat);
    for (const a of [cab.proposal, ...cab.alternatives]) {
        const b = cabs.find(x => x.orderCode === a.orderCode);
        assert.ok(b.dims && b.dims.d >= 246 && /^https?:\/\//.test(b.dims.src), a.orderCode);
        assert.match(a.why, /246/);
    }
    assert.match(cab.measuredText, /226 mm/);
    assert.match(cab.requiredText, /≥ 246/);
    /* G120C je v katalogu → výběr položky katalogu (brand = optId), alternativa mimo katalog = vlastní typ */
    const ta = rv.items.find(i => i.id === "code-ta1");
    assert.deepEqual(ta.proposal.cfg, { brand: "Siemens · 6SL3210-1KE12-3UF2" });
    assert.equal(ta.alternatives[0].optId, "");
    assert.deepEqual(ta.alternatives[0].cfg, { brand: "Firma XY", supplier: "", type: "Vlastní měnič XY", orderCode: "XY-1" });
    assert.match(cadFbProposalText(ta.proposal), /G120C/);
    const before = cadManifestJson(p);
    const res = applyCadFeedback(p, fb, ["fit-cabinet-depth-1", "qty-x1"], "Jan Novák", { rejected: ["code-ta1"], at: "2026-10-14T13:00:00Z" });
    assert.deepEqual(res.applied, ["fit-cabinet-depth-1", "qty-x1"]);
    assert.deepEqual(res.rejected, ["code-ta1"]);
    assert.equal(res.bomChanged, true);
    assert.deepEqual(p.bom.lines["+1:cabinet"], { brand: "Rittal · 1057.000" });
    assert.deepEqual(p.bom.lines["-X1:terminal_block"], { qty: 10, note: "2 svorky napájení podle 3D" });
    assert.equal(p.bom.lines["-TA1:vfd"], undefined, "odmítnuté nic nemění");
    const bom = buildBom(p).lines;
    assert.equal(bom.find(l => l.id === "+1:cabinet").orderCode, "1057.000");
    assert.equal(bom.find(l => l.id === "-X1:terminal_block").qty, 10);
    /* manifest pro CAD = nový kusovník */
    const m = cadManifest(p);
    assert.equal(m.parts.find(x => x.id === "+1:cabinet").orderCode, "1057.000");
    assert.notEqual(cadManifestJson(p), before);
    /* historie v projektu a v dokumentaci */
    const h = p.bom.cadFeedback;
    assert.deepEqual(h.map(r => [r.id, r.decision, r.by]), [["fit-cabinet-depth-1", "accepted", "Jan Novák"], ["qty-x1", "accepted", "Jan Novák"], ["code-ta1", "rejected", "Jan Novák"]]);
    assert.match(h[0].change, /1050\.000.*→.*1057\.000/);
    const md = bomMd(p);
    assert.match(md, /Změny ze zpětné vazby CAD/);
    assert.match(md, /Jan Novák/);
    assert.ok(!bomCsv(p).includes("Jan Novák"), "CSV kusovníku jen řádky");
    /* po použití je zpětná vazba zastaralá (manifest se změnil), položky jsou použité */
    const rv2 = cadFeedbackReview(p, fb);
    assert.equal(rv2.stale, true);
    assert.ok(rv2.warnings.length);
    const cab2 = rv2.items.find(i => i.id === "fit-cabinet-depth-1");
    assert.equal(cab2.state, "stale");
    assert.equal(cab2.applied, true);
    assert.equal(cab2.decided, "accepted");
    assert.match(cab2.info, /splňuje/);
    /* normalizace projektu historii zachová */
    const n = normalizeProject(JSON.parse(JSON.stringify(p)));
    assert.deepEqual(n.bom.cadFeedback, h);
});
test("idempotence: totéž rozhodnutí podruhé kusovník ani historii nezmění", () => {
    const p = loadSampleFile(S11);
    const fb = parseCadFeedback(JSON.stringify(fb11(p))).fb;
    applyCadFeedback(p, fb, ["fit-cabinet-depth-1", "qty-x1", "code-ta1#0"], "A", { at: "2026-10-14T13:00:00Z" });
    const snap = clone(p.bom);
    const res = applyCadFeedback(p, fb, ["fit-cabinet-depth-1", "qty-x1", "code-ta1#0"], "A", { at: "2026-10-14T14:00:00Z" });
    assert.equal(res.bomChanged, false);
    assert.deepEqual(p.bom, snap);
    assert.equal(buildBom(p).lines.find(l => l.id === "-TA1:vfd").type, "Vlastní měnič XY");
    assert.equal(buildBom(p).lines.find(l => l.id === "-TA1:vfd").brand, "Firma XY");
    /* změna rozhodnutí (odmítnout) se zapíše, kusovník zůstane (odmítnutí nic nevrací) */
    applyCadFeedback(p, fb, [], "B", { rejected: ["code-ta1"], at: "2026-10-14T15:00:00Z" });
    assert.equal(p.bom.cadFeedback.length, 4);
    assert.equal(cadFeedbackReview(p, fb).items.find(i => i.id === "code-ta1").decided, "rejected");
});
test("zastaralý otisk, neplatné partId a jiný projekt", () => {
    const p = loadSampleFile(S11);
    const stale = parseCadFeedback(JSON.stringify(fb11(p, { manifest: { sha256: "0".repeat(64) } }))).fb;
    const rv = cadFeedbackReview(p, stale);
    assert.equal(rv.stale, true);
    assert.ok(rv.items.every(i => i.state === "stale"));
    /* zastaralé jde přijmout (jen varování) */
    assert.equal(applyCadFeedback(clone(p), stale, ["qty-x1"], "A").applied.length, 1);
    const f = fb11(p);
    f.issues[0].parts = ["-A0:cabinet", "-TA1:vfd"];
    const inv = parseCadFeedback(JSON.stringify(f)).fb;
    const it = cadFeedbackReview(p, inv).items.find(i => i.id === "fit-cabinet-depth-1");
    assert.equal(it.state, "invalid");
    assert.match(it.stateText, /-A0:cabinet/);
    const q = clone(p);
    const res = applyCadFeedback(q, inv, ["fit-cabinet-depth-1"], "A");
    assert.equal(res.skipped[0].id, "fit-cabinet-depth-1");
    assert.equal(q.bom?.lines?.["+1:cabinet"], undefined);
    assert.ok(!(q.bom?.cadFeedback || []).some(r => r.id === "fit-cabinet-depth-1"), "neplatné se nezapisuje");
    const other = parseCadFeedback(JSON.stringify(fb11(p, { project: { guid: "11111111-2222-4333-8444-555555555555" } }))).fb;
    const rvo = cadFeedbackReview(p, other);
    assert.equal(rvo.projectMatch, false);
    assert.ok(rvo.items.every(i => i.state === "invalid"));
    const r2 = clone(p);
    assert.equal(applyCadFeedback(r2, other, ["qty-x1"], "A").skipped.length, 1);
    assert.equal(r2.bom?.lines, undefined);
});
test("otisk manifestu nezávisí na jazyku UI při exportu", () => {
    const p = loadSampleFile(S11);
    setLang("cs");
    const fb = parseCadFeedback(JSON.stringify(fb11(p))).fb;
    try {
        for (const l of Object.keys(LANGS)) {
            setLang(l);
            assert.equal(cadFeedbackReview(p, fb).stale, false, l);
        }
    }
    finally {
        setLang("cs");
    }
});
test("bez zpětné vazby beze změny: bomMd bez oddílu, prázdná historie se neukládá", () => {
    const p = sampleSmall();
    assert.ok(!bomMd(p).includes("zpětné vazby CAD"));
    const fb = parseCadFeedback(JSON.stringify({ ...fb11(p), issues: [] })).fb;
    const res = applyCadFeedback(p, fb, [], "A");
    assert.equal(res.bomChanged, false);
    assert.equal(p.bom?.cadFeedback, undefined);
});
test("oprava (a): svorky v kusovníku = svorkovnice výkresů X1…Xn (všechny vzory)", () => {
    for (const n of sampleNames()) {
        const p = loadSampleFile(n);
        const bom = buildBom(p).lines.filter(l => l.cat === "terminal_block");
        const strips = new Map();
        for (const row of svorkyCSV(p).split("\n").slice(1)) {
            const s = row.split(";")[0].split(":")[0];
            strips.set(s, (strips.get(s) || 0) + 1);
        }
        assert.deepEqual(bom.map(l => [l.tag.slice(1), l.qty]), [...strips], n);
        const m = cadManifest(p);
        assert.deepEqual(m.terminals.map(t => ["-" + t.strip + ":terminal_block", t.count]), m.parts.filter(x => x.category === "terminal_block").map(x => [x.id, x.qty]), n);
    }
});
test("oprava (b): typ katalogu nese jednu položku — alternativy jsou samostatné volby", () => {
    /* dřív „V20 …; G120C PN …“ v jednom typu (zjištěno ve 3D) — stejný vzor hlídat v celém katalogu */
    const glued = /;\s*[A-Z0-9][\w./-]*(?: [\w./-]+){0,3} — /;
    for (const old of ["V20 6SL3210-5BE17-5UV0 — 0,75 kW; G120C PN 6SL3210-1KE12-3UF2 — 0,75 kW", "3RM1001-1AA04 — přímý; 3RA2317-8XB30-1BB4 — reverzační",
        "VEGASWING 61 — spínač; VEGAPULS C 21 — radar", "Etanorm / Etabloc — čerpadlo; Movitec — vertikální"])
        assert.ok(glued.test(old), old);
    for (const [cat, brands] of Object.entries(CATALOG))
        for (const b of brands)
            assert.ok(!(b.typical && glued.test(b.typical)), cat + " / " + b.brand + ": " + b.typical);
    const vfd = brandsFor("vfd", "siemens").filter(b => b.brand === "Siemens");
    assert.deepEqual(vfd.map(b => b.orderCode), ["6SL3210-5BE17-5UV0", "6SL3210-1KE12-3UF2"]);
    const p = loadSampleFile(S11);
    const ta = buildBom(p).lines.find(l => l.id === "-TA1:vfd");
    assert.ok(!ta.type.includes(";"), ta.type);
    assert.match(ta.type, /^V20 /, "výchozí = první položka katalogu značky platformy");
});
test("oprava (c): rozměry skříní a měničů v katalogu se zdrojem", () => {
    const cabs = CATALOG.cabinet.filter(b => b.dims);
    assert.ok(cabs.length >= 8, "skříně s rozměry");
    for (const b of [...cabs, ...CATALOG.vfd.filter(x => x.dims)]) {
        assert.ok(b.dims.w > 0 && b.dims.h > 0 && b.dims.d > 0, b.orderCode);
        assert.match(b.dims.src, /^https:\/\//, b.orderCode);
    }
    assert.ok(CATALOG.vfd.some(b => b.dims), "měnič s rozměry");
});
test("druhy part_obsolete / part_not_orderable: stav u výrobce povinný, náhrada jen jako návrh", () => {
    const p = loadSampleFile(S11);
    const ta = buildBom(p).lines.find(l => l.cat === "vfd");
    const base = fb11(p);
    const obsolete = { ...base, issues: [
            { id: "eol-ta1", kind: "part_obsolete", severity: "warn", parts: [ta.id], message: "Výrobce oznámil ukončení výroby.",
                vendorStatus: { code: "PM400", date: "2026-10-01", source: "https://example.com/pm400" },
                suggestion: { partId: ta.id, alternatives: [{ type: "Nástupce XY", orderCode: "XY-2", brand: "Firma XY", why: "nástupce dle výrobce" }] } },
            { id: "no-ta1", kind: "part_not_orderable", severity: "error", parts: [ta.id], message: "Kód nelze objednat.",
                vendorStatus: { code: "PM500", source: "https://example.com/pm500" } },
        ] };
    /* validace: bez stavu u výrobce / bez dílu / bez zdroje = chyba */
    const bad = clone(obsolete);
    delete bad.issues[0].vendorStatus;
    bad.issues[1].vendorStatus.source = "";
    bad.issues[1].parts = [];
    const errs = parseCadFeedback(JSON.stringify(bad)).errors.join("\n");
    for (const want of ["issues[0].vendorStatus", "issues[1].vendorStatus.source", "issues[1].parts"])
        assert.ok(errs.includes(want), want + "\n" + errs);
    const r = parseCadFeedback(JSON.stringify(obsolete));
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.fb.issues[0].vendorStatus, { code: "PM400", date: "2026-10-01", source: "https://example.com/pm400" });
    /* přehled: nic automaticky, alternativy z CAD i z katalogu téže kategorie (bez současného kódu) */
    const rev = cadFeedbackReview(p, r.fb);
    const it = rev.items.find(i => i.id === "eol-ta1"), it2 = rev.items.find(i => i.id === "no-ta1");
    assert.equal(it.state, "usable");
    assert.equal(it.partId, ta.id);
    assert.equal(it.proposal, undefined, "bez návrhu z CAD žádný hlavní návrh");
    assert.equal(it.alternatives[0].source, "cad");
    assert.equal(it.alternatives[0].orderCode, "XY-2");
    assert.ok(it.alternatives.slice(1).every(a => a.source === "catalog" && a.orderCode && a.orderCode !== ta.orderCode));
    assert.ok(it2.alternatives.length > 0 && it2.alternatives.every(a => a.source === "catalog"));
    assert.match(it.measuredText, /PM400/);
    assert.equal(it.applied, false);
    /* bez rozhodnutí se kusovník nemění; přijetí alternativy změní jen řádek */
    const lines0 = JSON.stringify(p.bom?.lines ?? null);
    applyCadFeedback(p, r.fb, [], "Test", { rejected: [] });
    assert.equal(JSON.stringify(p.bom?.lines ?? null), lines0);
    const res = applyCadFeedback(p, r.fb, ["eol-ta1#0"], "Test");
    assert.deepEqual(res.applied, ["eol-ta1#0"]);
    assert.equal(buildBom(p).lines.find(l => l.id === ta.id).orderCode, "XY-2");
    assert.ok(CAD_FEEDBACK_KIND_LABEL.part_obsolete && CAD_FEEDBACK_KIND_LABEL.part_not_orderable);
});
test("zpětná vazba na manifest jiné verze (v1) = zastaralá, ne chyba; karty PLC známé i u io: []", () => {
    const p = loadSampleFile(S11);
    const v1 = sha256Text(JSON.stringify({ format: "plcdesk-cad", version: 1, parts: [] }, null, 2) + "\n");
    const r = cadFeedbackReview(p, fb11(p, { manifest: { sha256: v1 } }));
    assert.equal(r.stale, true);
    assert.ok(r.items.every(i => i.state === "stale"));
    const q = cadFeedbackReview(p, fb11(p, { issues: [{ id: "di", kind: "qty_mismatch", severity: "info", parts: ["-A2:plc_di"], message: "x" }] }));
    assert.equal(q.items[0].state, "usable");
});
/* ------------------------------------------------------------ málo kanálů I/O PLC (plc_io_capacity, doplněk 2026-10-16) */
const S01 = "01_pasovy_dopravnik_vyhazovac.plcstudio.json";
/** Vzor 01 (1212C G2, 7 DI) + jeden DI navíc = 8/8 vestavěných DI, jako stroj 01 po přidání -S4. */
function fullDi() {
    const p = loadSampleFile(S01);
    p.devices.push({ id: 900, name: "S99", cls: "DI", desc: "spínač navíc", opt: {}, unit: "", rmin: 0, rmax: 100 });
    syncIO(p);
    return p;
}
function fbIo(prj, over = {}) {
    return {
        format: "plcdesk-cad-feedback", version: 1, project: { guid: prj.guid || "" },
        manifest: { sha256: cadManifestSha256(prj) }, created: "2026-10-16T12:00:00Z", tool: "rozvadec-3d test",
        issues: [{
                id: "plc-di", kind: "plc_io_capacity", severity: "warn", parts: ["-A1:plc_cpu"],
                measured: { what: "DI obsazeno", value: 8, capacity: 8, unit: "ch", source: "manifest devices[].signals, CPU 1212C G2 8 DI" },
                message: "Obsazeno 8 z 8 DI — bez rezervy.", ...over,
            }],
    };
}
test("plc_io_capacity: validace směru a kapacity", () => {
    const p = fullDi();
    const ok = parseCadFeedback(JSON.stringify(fbIo(p)));
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.fb.issues[0].measured.capacity, 8);
    const noDir = parseCadFeedback(JSON.stringify(fbIo(p, { measured: { what: "vstupy do PLC", value: 8, unit: "ch", source: "x" } })));
    assert.ok(noDir.errors.some(e => /issues\[0\]\.measured\.what/.test(e)), "bez směru DI/DO/AI/AO = chyba (české „do“ se nepočítá)");
    const badCap = parseCadFeedback(JSON.stringify(fbIo(p, { measured: { what: "DI", value: 8, capacity: "8", unit: "ch", source: "x" } })));
    assert.ok(badCap.errors.some(e => /measured\.capacity/.test(e)));
    assert.ok(CAD_FEEDBACK_KINDS.includes("plc_io_capacity") && !!CAD_FEEDBACK_KIND_LABEL.plc_io_capacity);
});
test("plc_io_capacity: stroj s DI 8/8 → rezerva (karta SM) nebo větší CPU, přijetí změní sestavu i manifest", () => {
    const base = fullDi();
    assert.ok(validateProject(base).some(i => i.level === "info" && /DI/.test(i.msg) && /8\/8/.test(i.msg)), "plně obsazený směr = informace");
    const fb = fbIo(base, { required: { what: "volné DI", min: 2, unit: "ch", basis: "rezerva pro rozšíření" } });
    const rv = cadFeedbackReview(base, fb);
    const it = rv.items[0];
    assert.equal(it.state, "usable");
    assert.equal(it.partId, "-A1:plc_cpu");
    assert.match(it.info, /DI.*8\/8/);
    assert.ok(it.proposal?.reserveOnly && it.proposal.reserve?.DI === 2, "hlavní návrh = rezerva DI ≥ 2");
    assert.match(it.proposal.why, /6ES7221-1BH50-0XB0/, "PLCdesk přidá kartu SM 1221 G2");
    const cpu = it.alternatives.find(a => a.orderCode === "6ES7214-1AH50-0XB0");
    assert.ok(cpu && cpu.reserve?.DI === 2 && cpu.cfg.brand === cpu.optId, "alternativa = CPU 1214C G2 + rezerva");
    assert.ok(it.alternatives.every(a => !/6ES7511/.test(a.orderCode)), "jen CPU téže řady");
    assert.match(cadFbProposalText(cpu), /rezerva I\/O: DI ≥ 2/);
    /* hlavní návrh: rezerva → karta SM, GUID karty, manifest, validace čistá */
    const p = clone(base);
    const res = applyCadFeedback(p, fb, ["plc-di"], "Tester", { at: "2026-10-16T13:00:00Z" });
    assert.deepEqual(res.applied, ["plc-di"]);
    assert.deepEqual(p.bom.ioReserve, { DI: 2 });
    assert.equal(p.bom.lines?.["-A1:plc_cpu"], undefined, "řádek CPU beze změny");
    const m = cadManifest(p);
    const st = m.plc.stations[0];
    assert.equal(st.modules.length, 1);
    assert.equal(st.modules[0].partId, "-A2:plc_di");
    assert.match(String(st.modules[0].guid), /^[0-9a-f-]{36}$/, "nová karta má GUID hned");
    assert.ok(m.parts.some((x) => x.id === "-A2:plc_di" && x.orderCode === "6ES7221-1BH50-0XB0"));
    assert.deepEqual(validateProject(p).filter(i => / DI$/.test(i.where)), [], "bez nálezu k DI");
    assert.equal(p.bom.cadFeedback.at(-1).change, "rezerva I/O: DI ≥ 2 volných");
    /* znovu: požadavek splněn, nic dalšího, historie se nezdvojí */
    const again = cadFeedbackReview(p, fb).items[0];
    assert.ok(again.applied && !again.proposal && /už má/.test(again.info));
    const n = p.bom.cadFeedback.length;
    const r2 = applyCadFeedback(p, fb, ["plc-di"], "Tester");
    assert.equal(r2.bomChanged, false);
    assert.equal(p.bom.cadFeedback.length, n);
    /* normalizace projektu rezervu zachová */
    assert.deepEqual(normalizeProject(clone(p)).bom?.ioReserve, { DI: 2 });
    /* alternativa: větší CPU (bez karty) */
    const q = clone(base);
    const k = it.alternatives.indexOf(cpu);
    applyCadFeedback(q, fb, ["plc-di#" + k], "Tester");
    assert.equal(q.bom.lines["-A1:plc_cpu"].brand, cpu.optId);
    assert.deepEqual(q.bom.ioReserve, { DI: 2 });
    const mq = cadManifest(q);
    assert.ok(mq.parts.some((x) => x.id === "-A1:plc_cpu" && x.orderCode === "6ES7214-1AH50-0XB0"));
    assert.equal(mq.plc.stations[0].modules.length, 0);
    assert.equal(applyCadFeedback(q, fb, ["plc-di#" + k], "Tester").bomChanged, false, "alternativa podruhé = jen potvrzení");
});
test("plc_io_capacity: rezerva v %, už splněná rezerva a odmítnutí", () => {
    const base = fullDi();
    const pct = cadFeedbackReview(base, fbIo(base, { required: { what: "rezerva DI", min: 50, unit: "%", basis: "zvyklost" } })).items[0];
    assert.equal(pct.proposal?.reserve?.DI, 4, "50 % z 8 obsazených = 4 volné");
    const small = loadSampleFile(S01);
    const ok = cadFeedbackReview(small, fbIo(small)).items[0];
    assert.ok(ok.applied && !ok.proposal && /už má/.test(ok.info), "7/8 DI a požadavek 1 volný = splněno");
    const p = clone(base);
    const r = applyCadFeedback(p, fbIo(p), [], "Tester", { rejected: ["plc-di"] });
    assert.deepEqual(r.rejected, ["plc-di"]);
    assert.equal(p.bom?.ioReserve, undefined);
});
