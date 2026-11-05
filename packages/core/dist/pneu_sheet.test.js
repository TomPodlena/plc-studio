/**
 * Pneumaticke schema (pneu_sheet.ts) a kabelovy seznam (cable_list.ts): oznaceni z kusovniku, bez domyslenych hodnot,
 * DXF ASCII, jazyky bez cestiny, vodice shodne se svorkyCSV, pocet radku = pocet signalu v poli.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { esc } from "./model.js";
import { buildBom } from "./bom.js";
import { setLang } from "./i18n.js";
import { pneuSheets, valveIs52Mono } from "./pneu_sheet.js";
import { cableListCsv } from "./cable_list.js";
import { svorkyCSV, allProjectFiles } from "./docs.js";
import { projectFileFolder, PROJECT_DIRS } from "./project_folder.js";
import { sampleNames, loadSampleFile } from "./exp_util.test.js";
const sample = (prefix) => loadSampleFile(sampleNames().find(n => n.startsWith(prefix)));
const hasValves = (p) => buildBom(p).lines.some(l => l.cat === "valve_solenoid");
test("pneu schema: vzor s ventily — oznaceni z kusovniku, vyhrada, DXF ASCII, nic domysleneho", () => {
    const p = sample("20_");
    assert.ok(hasValves(p));
    const sh = pneuSheets(p);
    assert.ok(sh.length >= 1);
    const svg = sh.map(s => s.svg).join("\n");
    const bom = buildBom(p).lines;
    for (const cat of ["valve_solenoid", "air_shutoff", "air_prep", "valve_manifold"]) {
        for (const l of bom.filter(x => x.cat === cat))
            assert.ok(svg.includes(esc(l.tag)), "chybi " + l.tag);
    }
    for (const s of sh) {
        assert.ok(s.svg.includes("Návrh — ověří konstruktér pneumatiky"));
        assert.match(s.dxf, /^[\x00-\x7F]*$/);
        assert.ok(s.dxf.startsWith("0\nSECTION") && s.dxf.endsWith("EOF"));
    }
    assert.ok(svg.includes("doplní projektant"));
    assert.ok(!/\bbar\b|\bmm\b/i.test(svg.replace(/<title>[^<]*<\/title>/g, "")), "domyslena jednotka");
});
test("pneu schema: bez ventilu zadny list; 5/2 jen kdyz to nese radek", () => {
    const nov = sampleNames().map(n => loadSampleFile(n)).find(p => !hasValves(p));
    assert.equal(pneuSheets(nov).length, 0);
    const l = { type: "VUVG 5/2 monostabilni", desc: "", note: "", item: "" };
    assert.ok(valveIs52Mono(l));
    assert.ok(!valveIs52Mono({ ...l, type: "VUVG" }));
});
test("pneu schema: jazyky bez cestiny", () => {
    const p = sample("20_");
    const czech = ["Pneumatické", "doplní projektant", "Přívod"];
    try {
        for (const l of ["en", "de", "es", "zh"]) {
            setLang(l);
            for (const s of pneuSheets(p)) {
                for (const c of czech)
                    assert.ok(!s.svg.includes(c) && !s.dxf.includes(c), l + ": " + c);
                assert.match(s.dxf, /^[\x00-\x7F]*$/);
            }
        }
    }
    finally {
        setLang("cs");
    }
});
for (const pre of ["01_", "11_", "20_"]) {
    test("kabelovy seznam " + pre + ": radek na signal, vodice jako svorkyCSV, prazdna delka a prurez", () => {
        const p = sample(pre);
        const rows = cableListCsv(p).split("\n").slice(1).map(r => r.split(";"));
        const sv = svorkyCSV(p).split("\n").slice(1).map(r => r.split(";"));
        assert.equal(rows.length, sv.length);
        rows.forEach((r, i) => {
            assert.equal(r[4], sv[i][0]); // svorka
            assert.equal(r[5], sv[i][5]); // vodic
            assert.equal(r[2], sv[i][4]); // tag
            assert.equal(r[7], "");
            assert.equal(r[8], "");
            assert.ok(r[9].includes("doplní projektant"));
        });
        assert.ok(!/mm²|mm2/.test(cableListCsv(p)));
    });
}
test("projektova slozka: pneu list do vykresu, kabelovy seznam do dokumentace", () => {
    const files = allProjectFiles(sample("20_"));
    const pn = files.filter(f => /pneu_schema/.test(f.name));
    assert.ok(pn.length >= 2);
    for (const f of pn)
        assert.equal(projectFileFolder(f.save, f.dir), f.name.endsWith("dxf") ? PROJECT_DIRS.dxf : PROJECT_DIRS.svg);
    const cl = files.find(f => f.save === "03_kabelovy_seznam.csv");
    assert.equal(projectFileFolder(cl.save, cl.dir), projectFileFolder("03_svorkovnice.csv", "dokumentace"));
});
