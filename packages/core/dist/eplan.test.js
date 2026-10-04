/** Testy exportu do EPLAN (eplan.ts) — node:test, bez závislostí. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { withLang } from "./i18n.js";
import { modules } from "./model.js";
import { hwLayout } from "./hardware.js";
import { svorkyCSV, allProjectFiles } from "./docs.js";
import { buildBom } from "./bom.js";
import { sheetOps, opsToDXF } from "./drawing.js";
import { sampleSmall, sampleComplex } from "./samples.js";
import { registerSafetyModule } from "./safety.js";
import { eplanFiles, eplanCards, eplanTerminals, eplanAml, eplanDevicesCsv, eplanTerminalsCsv, eplanWiresCsv, eplanAmlName, eplanImportScript, eplanConverterId, EPLAN_SCRIPT_NAME } from "./eplan.js";
import { readFileSync } from "node:fs";
import "./safety_docs.js";
import { sampleNames, loadSampleFile, xmlProblem } from "./exp_util.test.js";
/** Řádky CSV s čárkou a uvozovkami. */
function csvRows(s) {
    const out = [];
    let row = [], cur = "", q = false;
    const t = s.replace(/^﻿/, "");
    for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (q) {
            if (c === '"' && t[i + 1] === '"') {
                cur += '"';
                i++;
            }
            else if (c === '"')
                q = false;
            else
                cur += c;
            continue;
        }
        if (c === '"')
            q = true;
        else if (c === ",") {
            row.push(cur);
            cur = "";
        }
        else if (c === "\r" && t[i + 1] === "\n") {
            row.push(cur);
            out.push(row);
            row = [];
            cur = "";
            i++;
        }
        else
            cur += c;
    }
    if (cur || row.length) {
        row.push(cur);
        out.push(row);
    }
    return out;
}
const ASCII = /^[\x20-\x7E]*$/;
test("EPLAN: všech 12 příkladů — AutomationML well-formed, tagy a kanály 1:1, vazby na existující ID", () => {
    for (const n of sampleNames()) {
        const p = loadSampleFile(n);
        const files = eplanFiles(p);
        assert.deepEqual(files.map(f => f.name), [eplanAmlName(p), "eplan_zarizeni.csv", "eplan_svorky.csv", "eplan_vodice.csv", "README_EPLAN.txt", EPLAN_SCRIPT_NAME], n);
        const aml = files[0].body;
        assert.equal(xmlProblem(aml), "", n + ": XML");
        assert.match(aml, /<CAEXFile FileName="[^"]+" SchemaVersion="2\.15"/);
        assert.ok(aml.includes('DocumentIdentifier="AR APC" Version="1.4.0"'));
        const tags = [...aml.matchAll(/<ExternalInterface Name="([^"]+)" ID="([^"]+)" RefBaseClassPath="AutomationProjectConfigurationInterfaceClassLib\/Tag">/g)];
        const chans = [...aml.matchAll(/RefBaseClassPath="AutomationProjectConfigurationInterfaceClassLib\/Channel"/g)];
        /* vazby kanál ↔ tag (Link_<tag>); vazba uzlu PROFINET na podsíť se počítá zvlášť */
        const links = [...aml.matchAll(/<InternalLink Name="Link_([^"]+)" RefPartnerSideA="([^":]+):([^"]+)" RefPartnerSideB="([^":]+):([^"]+)" \/>/g)]
            .filter(m => !m[1].startsWith("PN_IE_") && !m[1].startsWith("IoSystem_")).map(m => [m[0], m[2], m[3], m[4], m[5]]);
        assert.equal([...aml.matchAll(/<InternalLink Name="Link_PN_IE_1_E1"/g)].length, 1, n + ": uzel PROFINET ↔ podsíť");
        assert.equal(tags.length, p.io.length, n + ": tag na každý signál");
        /* všechny kanály modulů sestavy (počet podle katalogu, vč. vestavěných I/O CPU) */
        assert.equal(chans.length, hwLayout(p).modules.reduce((s, m) => s + m.channels.length, 0), n + ": všechny kanály karet");
        assert.equal(links.length, p.io.length, n + ": vazba kanál ↔ tag");
        assert.deepEqual(new Set(tags.map(t => t[1])), new Set(p.io.map(e => e.tag)));
        const elIds = new Set([...aml.matchAll(/<InternalElement Name="[^"]*" ID="([^"]+)"/g)].map(m => m[1]));
        for (const l of links) {
            assert.ok(elIds.has(l[1]) && elIds.has(l[3]), n + ": ID vazby");
            assert.ok(p.io.some(e => e.tag === l[4]), n + ": tag vazby");
        }
        for (const c of eplanCards(p))
            assert.ok(aml.includes('<Attribute Name="ProductDesignation IEC" AttributeDataType="xs:string"><Value>' + c.dt + "</Value>"), n + ": " + c.dt);
    }
});
test("EPLAN: označení shodná s výkresy (svorky X, vodiče -W) a kusovníkem; ASCII označení", () => {
    for (const n of sampleNames()) {
        const p = loadSampleFile(n);
        const cards = eplanCards(p);
        const mods = modules(p);
        assert.equal(cards.length, mods.length);
        const terms = eplanTerminals(p, cards);
        /* seznam svorek dokumentace (X1:1 …) = svorky EPLAN (-X1:1 …) */
        const doc = svorkyCSV(p).split("\n").slice(1).map(l => l.split(";")[0]);
        assert.deepEqual(terms.map(t => t.dt), doc.map(x => "-" + x), n + ": svorky = dokumentace");
        /* výkres modulu nese stejné svorky a čísla vodičů */
        mods.forEach((m, i) => {
            const texts = new Set(sheetOps(p, m, i + 1, i + 1, mods.length).O.filter(o => o.t === "t").map(o => o.s));
            for (const t of terms.filter(x => x.strip === "-X" + cards[i].xnum)) {
                assert.ok(texts.has(t.dt.slice(1)), n + ": svorka " + t.dt + " ve výkresu");
                assert.ok([...texts].some(s => s === t.wire || s.endsWith(" " + t.wire)), n + ": vodič " + t.wire + " ve výkresu");
            }
        });
        /* označení zařízení = řádky kusovníku (karty rozepsané -A2.1 …) */
        const bomTags = new Set(buildBom(p).lines.map(l => l.tag));
        const dev = csvRows(eplanDevicesCsv(p, cards));
        assert.equal(dev[0][0], "Device tag");
        for (const r of dev.slice(1)) {
            assert.ok(ASCII.test(r[0]), n + ": ASCII " + r[0]);
            assert.ok(bomTags.has(r[0].replace(/\.\d+$/, "")) && bomTags.has(r[9]), n + ": " + r[0] + " v kusovníku");
        }
        for (const c of cards)
            assert.ok(dev.some(r => r[0] === c.dt), n + ": karta " + c.dt + " v seznamu zařízení");
        const tr = csvRows(eplanTerminalsCsv(p, cards));
        assert.equal(tr.length - 1, p.io.length);
        for (const r of tr.slice(1))
            for (const k of [0, 2, 3, 8])
                assert.ok(ASCII.test(r[k]), n + ": ASCII " + r[k]);
        const wr = csvRows(eplanWiresCsv(p, cards));
        assert.equal(wr.length - 1, p.io.length);
        for (const r of wr.slice(1))
            assert.match(r[0], /^-W\d{3,}$/);
    }
});
test("vodiče -W: unikátní v celém projektu a shodné ve výkresech (SVG i DXF), svorkovnici a EPLAN — všechny příklady", () => {
    for (const n of sampleNames()) {
        const p = loadSampleFile(n);
        const mods = modules(p);
        /* výkresy: každý kanál nese právě jedno číslo vodiče, X<n>:<k> → -W<n·100+k> */
        const drawn = [];
        mods.forEach((m, i) => {
            const ops = sheetOps(p, m, i + 1, i + 1, mods.length);
            const ws = ops.O.filter(o => o.t === "t").flatMap(o => o.s.match(/-W\d+/g) || []);
            assert.equal(ws.length, m.ch.length, n + ": " + m.dir + m.idx + " — vodič na každém kanálu");
            ws.forEach((w, k) => assert.equal(w, "-W" + ((i + 1) * 100 + k + 1), n + ": " + m.dir + m.idx + " kanál " + k));
            const dxf = opsToDXF(ops);
            for (const w of ws)
                assert.ok(dxf.includes("\n" + w + "\n") || dxf.includes(" " + w + "\n"), n + ": " + w + " v DXF");
            drawn.push(...ws);
        });
        assert.equal(drawn.length, p.io.length, n + ": počet vodičů = počet signálů");
        const dup = drawn.filter((w, i) => drawn.indexOf(w) !== i);
        assert.deepEqual(dup, [], n + ": duplicitní čísla vodičů");
        /* svorkovnice dokumentace (sloupec Vodič) a EPLAN nesou stejná čísla ve stejném pořadí */
        const doc = svorkyCSV(p).split("\n").slice(1).map(l => l.split(";")[5]);
        assert.deepEqual(doc, drawn, n + ": svorkovnice = výkresy");
        assert.deepEqual(eplanTerminals(p).map(t => t.wire), drawn, n + ": EPLAN = výkresy");
    }
});
test("EPLAN: skript PLCdesk_ImportAML.cs = apps/eplan, ASCII, akce plcservice podle eplan.help, konvertor podle platformy", () => {
    const repo = readFileSync(new URL("../../../apps/eplan/" + EPLAN_SCRIPT_NAME, import.meta.url), "utf8");
    const s = eplanImportScript();
    assert.equal(s, repo.replace(/\r?\n/g, "\r\n"), "skript v sadě souborů = apps/eplan/" + EPLAN_SCRIPT_NAME);
    assert.ok(/^[\x09\x0A\x0D\x20-\x7E]*$/.test(s), "ASCII");
    for (const k of ['"selectionset"', '"plcservice"', '"BUSDATAIMPORT"', '"GENERATEPLCSCHEMATIC"', '"SOURCEFILE"', '"PROJECTNAME"', '"LANGUAGE"', '"CONVERTERID"', '"IMPORTMATCH"', '"CONFIGFILE"',
        '"PlcDcExchangerSiemensTIA19AML"', '"PlcDcAMLExchangerGeneral"', "[Start]"])
        assert.ok(s.includes(k), k);
    /* páry složených závorek a uvozovek (hrubá kontrola syntaxe C#) */
    assert.equal(s.split("{").length, s.split("}").length);
    assert.equal(s.split("(").length, s.split(")").length);
    /* jazyk pro LANGUAGE nese AML; konvertor odpovídá obsahu (Siemens → TIA19) */
    const sie = loadSampleFile(sampleNames()[0]);
    assert.match(eplanAml(sie), /<!-- PLCdesk language=[a-z]{2}_[A-Z]{2} -->/);
    assert.equal(eplanConverterId(sie), "PlcDcExchangerSiemensTIA19AML");
    assert.ok(/System:Device\.S71|OrderNumber:6ES7/.test(eplanAml(sie)), "skript pozná Siemens podle obsahu");
    const bk = loadSampleFile(sampleNames()[0]);
    bk.platforms = ["beckhoff"];
    if (bk.bom)
        bk.bom.plat = "beckhoff";
    assert.equal(eplanConverterId(bk), "PlcDcAMLExchangerGeneral");
});
test("EPLAN: přihlášení s modulem a bez češtiny v cizích jazycích", () => {
    const off = registerSafetyModule();
    try {
        const p = sampleComplex();
        const all = allProjectFiles(p);
        for (const s of ["eplan_" + eplanAmlName(p), "eplan_zarizeni.csv", "eplan_svorky.csv", "eplan_vodice.csv", "eplan_README_EPLAN.txt", "eplan_" + EPLAN_SCRIPT_NAME])
            assert.ok(all.some(f => f.save === s && f.group === "EPLAN"), s);
    }
    finally {
        off();
    }
    const CZ = /[ěščřžůďťňĚŠČŘŽŮĎŤŇ]/;
    for (const l of ["en", "de", "es", "zh"])
        withLang(l, () => {
            for (const mk of [sampleSmall, sampleComplex]) {
                const p = l === "zh" ? withLang("en", mk) : mk();
                for (const f of eplanFiles(p)) {
                    /* vícejazyčné texty AML nesou i češtinu záměrně (aml-lang=cs-CZ) */
                    const body = f.body.replace(/<Attribute Name="aml-lang=cs-CZ" AttributeDataType="xs:string"><Value>[^<]*<\/Value><\/Attribute>/g, "");
                    const m = body.match(CZ);
                    assert.ok(!m, l + " / " + f.name + ": „" + (m ? body.slice(Math.max(0, m.index - 60), m.index + 40) : "") + "“");
                    assert.ok(!/\{[a-z][A-Za-z]*\}/.test(f.body), l + " / " + f.name + ": zástupný znak");
                }
                assert.equal(xmlProblem(eplanAml(p)), "");
            }
        });
});
