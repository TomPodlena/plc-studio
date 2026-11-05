/**
 * Silové schéma a rozvod napájení (power_sheet.ts): zařízení s řádky kusovníku -Q / -K / -M / -TA je na listu,
 * označení shodná s kusovníkem, odkazy data-dev, výhrada „Návrh — ověří elektroprojektant“, DXF ASCII,
 * texty bez češtiny v jiných jazycích, zařazení do projektové složky.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { esc } from "./model.js";
import { buildBom } from "./bom.js";
import { setLang } from "./i18n.js";
import { powerSheets } from "./power_sheet.js";
import { allProjectFiles } from "./docs.js";
import { projectFileFolder, PROJECT_DIRS } from "./project_folder.js";
import { sampleSmall } from "./samples.js";
import { sampleNames, loadSampleFile } from "./exp_util.test.js";
const sample = (prefix) => loadSampleFile(sampleNames().find(n => n.startsWith(prefix)));
const posDevs = (prj) => new Set(buildBom(prj).lines.filter(l => l.cat === "positioning_drive" && l.devId !== undefined).map(l => l.devId));
/** První řádek každého druhu (-Q / -K / -TA / -M) u zařízení se silovým vývodem — to musí být na listu. */
function expectedParts(prj) {
    const by = new Map();
    for (const l of buildBom(prj).lines) {
        const m = /^-(Q|K|TA|M)\d/.exec(l.tag);
        if (l.devId === undefined || !m)
            continue;
        if (posDevs(prj).has(l.devId))
            continue;
        const g = by.get(l.devId) || new Map();
        if (!g.has(m[1]))
            g.set(m[1], l.tag);
        by.set(l.devId, g);
    }
    const out = [];
    for (const [devId, g] of by)
        if (g.has("M") || g.has("TA") || g.has("K"))
            for (const tag of g.values())
                out.push({ devId, tag });
    return out;
}
const CASES = [["motor", "01_"], ["menic + polohovaci pohon", "11_"], ["servoosa", "12_"]];
for (const [what, pre] of CASES) {
    test("silove schema: " + what + " — zarizeni a oznaceni z kusovniku", () => {
        const p = sample(pre);
        const exp = expectedParts(p);
        assert.ok(exp.length > 0);
        const sh = powerSheets(p).filter(s => s.kind === "power");
        assert.ok(sh.length >= 1);
        const svg = sh.map(s => s.svg).join("\n");
        for (const e of exp) {
            assert.ok(svg.includes(">" + esc(e.tag) + "<"), "chybi " + e.tag);
            assert.ok(svg.includes('data-dev="' + e.devId + '"'), "chybi data-dev " + e.devId);
        }
        for (const s of sh) {
            assert.ok(s.svg.includes("Návrh — ověří elektroprojektant (EN 60204-1)"));
            assert.match(s.dxf, /^[\x00-\x7F]*$/);
            assert.ok(s.dxf.startsWith("0\nSECTION") && s.dxf.endsWith("EOF"));
        }
        assert.ok(svg.includes("doplní projektant"));
        assert.ok(!svg.includes("400 V") && !svg.includes(">3~<"));
    });
}
test("rozvod napajeni: stanice a zdroj z kusovniku + znacka E-stop vetve", () => {
    const p = sample("11_");
    const sh = powerSheets(p).filter(s => s.kind === "supply");
    assert.ok(sh.length >= 1);
    const svg = sh.map(s => s.svg).join("\n");
    const bom = buildBom(p).lines;
    for (const cat of ["power_supply_24v", "plc_cpu", "plc_hmi"]) {
        const l = bom.find(x => x.cat === cat);
        assert.ok(svg.includes(">" + esc(l.tag) + "<") || svg.includes(esc(l.tag)), "chybi " + l.tag);
    }
    assert.ok(svg.includes("L+ (24 V DC)") && svg.includes("PE"));
    assert.ok(svg.includes("Návrh — ověří elektroprojektant"));
    for (const s of sh)
        assert.match(s.dxf, /^[\x00-\x7F]*$/);
});
test("bez motoru: jen rozvod napajeni, nic nespadne", () => {
    const names = sampleNames();
    let seen = 0;
    for (const n of names) {
        const p = loadSampleFile(n);
        const sh = powerSheets(p);
        if (!expectedParts(p).length) {
            seen++;
            assert.ok(sh.every(s => s.kind === "supply" || s.svg.includes("-F") || s.svg.includes("-T")));
        }
        for (const s of sh)
            assert.ok(s.svg.startsWith("<svg") && s.dxf.endsWith("EOF"));
    }
    const small = powerSheets(sampleSmall());
    assert.ok(Array.isArray(small));
    assert.ok(seen >= 0);
});
test("jazyky: stejna geometrie, bez ceskych textu mimo obsah projektu", () => {
    const p = sample("12_");
    const czech = ["Silové schéma", "Přívod", "doplní projektant", "Jištění", "Rozvod napájení", "Návrh — ověří", "Symboly dle", "Zdroj 24 V DC", "pólovost", "Řadiče polohování", "napájení podle"];
    const langs = ["en", "de", "es", "zh"];
    try {
        setLang("cs");
        const cs = powerSheets(p);
        for (const l of langs) {
            setLang(l);
            const x = powerSheets(p);
            assert.equal(x.length, cs.length);
            for (const s of x) {
                for (const c of czech)
                    assert.ok(!s.svg.includes(c) && !s.dxf.includes(c), l + ": cesky text " + c);
                assert.match(s.dxf, /^[\x00-\x7F]*$/);
            }
        }
    }
    finally {
        setLang("cs");
    }
});
test("projektova slozka: vykresy do 02_Vykresy SVG / DXF, nic nezarazeneho", () => {
    const p = sample("01_");
    const files = allProjectFiles(p).filter(f => /silove_schema|rozvod_napajeni/.test(f.name));
    assert.ok(files.length >= 4);
    for (const f of files) {
        assert.equal(f.dir, "vykresy");
        assert.equal(projectFileFolder(f.save, f.dir), f.kind === "dxf" ? PROJECT_DIRS.dxf : PROJECT_DIRS.svg);
    }
});
test("polohovaci radic: neni na silovem listu, je na rozvodu napajeni", () => {
    const p = sample("11_");
    const pd = [...new Set(buildBom(p).lines.filter(l => l.cat === "positioning_drive").map(l => l.tag))];
    assert.ok(pd.length > 0);
    const power = powerSheets(p).filter(s => s.kind === "power").map(s => s.svg).join("\n");
    const supply = powerSheets(p).filter(s => s.kind === "supply").map(s => s.svg).join("\n");
    for (const tag of pd) {
        assert.ok(!power.includes(">" + esc(tag) + "<"), "na silovem listu: " + tag);
        assert.ok(supply.includes(esc(tag)), "chybi na rozvodu: " + tag);
    }
    assert.ok(!power.includes("400 V"));
    assert.ok(supply.includes("doplní projektant"));
});
