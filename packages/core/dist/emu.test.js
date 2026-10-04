/**
 * Testy emulátoru překladu a běhu (packages/core/src/emu/*).
 * - všech 12 příkladů × 8 platforem × 5 jazyků: překlad bez error, běh kódu bez rozdílu proti návrhu,
 * - scénáře běhu = scénáře verifyProject, přeskočení klidu nemění výsledek,
 * - mutační testy: emulátor musí chytit vložené chyby kódu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { blankProject, syncIO, PLAT } from "./model.js";
import { genFor } from "./codegen.js";
import { setLang, LANGS } from "./i18n.js";
import { verifyProject, simulate } from "./sim.js";
import { sampleSmall, sampleComplex } from "./samples.js";
import { docFiles } from "./docs.js";
import { emulateCompile, emulateRunMany, emulateAll, emulateFiles, emulateRunFiles, EMU_DOC_FILE, registerEmuModule } from "./emu/index.js";
import { emuScenarios } from "./emu/run.js";
const SAMPLE_DIR = new URL("../../../samples/", import.meta.url); // dist/ → kořen repozitáře
const PLATS = Object.keys(PLAT);
function load(name) {
    const raw = JSON.parse(readFileSync(new URL(name, SAMPLE_DIR), "utf8"));
    const prj = Object.assign(blankProject(), raw.prj || raw);
    prj.platforms = [...PLATS];
    syncIO(prj);
    return prj;
}
const samples = () => readdirSync(SAMPLE_DIR).filter(f => f.endsWith(".plcstudio.json")).sort();
const errs = (fs) => fs.filter(f => f.level === "error").map(f => f.rule + " " + f.file + ":" + f.line + ":" + f.col + " " + f.msg);
/* ------------------------------------------------------------------ příklady */
test("emu: 12 příkladů × 8 platforem × 5 jazyků — překlad bez chyb, běh kódu = návrh", () => {
    const list = samples();
    assert.ok(list.length >= 12, "příklady v samples/");
    const t0 = Date.now();
    for (const f of list) {
        const prj = load(f);
        for (const l of Object.keys(LANGS)) {
            setLang(l);
            for (const p of PLATS) {
                const c = emulateCompile(prj, p);
                assert.deepEqual(errs(c.findings), [], f + " / " + p + " / " + l + ": nálezy překladu");
            }
            /* běh: otisk kódu bez komentářů je napříč jazyky stejný → cache, jinak se běh zopakuje */
            const r = emulateRunMany(prj, PLATS);
            for (const p of PLATS) {
                const x = r[p];
                assert.equal(x.skipped, undefined, f + " / " + p + ": běh neproběhl");
                assert.ok(x.scenarios.length > 0, f + " / " + p + ": žádné scénáře");
                assert.deepEqual(x.diffs.map(d => d.label + " t=" + d.t + " " + d.msg), [], f + " / " + p + " / " + l + ": kód se chová jinak než návrh");
                assert.deepEqual((x.runtime || []).map(e => e.msg), [], f + " / " + p + ": běhové chyby");
            }
        }
    }
    setLang("cs");
    console.log("emu: příklady × platformy × jazyky " + (Date.now() - t0) + " ms");
});
test("emu: malé ukázky (sampleSmall, sampleComplex) projdou na všech platformách", () => {
    setLang("cs");
    for (const prj of [sampleSmall(), sampleComplex()]) {
        const r = emulateAll(prj, { platforms: PLATS });
        for (const p of PLATS) {
            assert.deepEqual(errs(r.compile[p].findings), [], prj.meta.name + " / " + p);
            assert.deepEqual(r.run[p].diffs.map(d => d.msg), [], prj.meta.name + " / " + p);
        }
        assert.ok(r.ok);
    }
});
test("emu: scénáře běhu obsahují všechny scénáře verifyProject (vč. matice stavů)", () => {
    setLang("cs");
    for (const prj of [load("01_pasovy_dopravnik_vyhazovac.plcstudio.json"), load("03_nytovaci_lis_NL-1.plcstudio.json"), sampleComplex()]) {
        const mine = new Set(emuScenarios(prj, "full").map(s => JSON.stringify(s.opts)));
        const v = verifyProject(prj);
        const theirs = [...v.scenarios.map(s => s.opts)];
        for (const r of v.matrix.rows)
            for (const c of Object.values(r.cells))
                if (c.scenario)
                    theirs.push(c.scenario.opts);
        const missing = theirs.filter(o => !mine.has(JSON.stringify(o)));
        assert.deepEqual(missing, [], prj.meta.name + ": scénáře verifyProject chybí v emulaci");
    }
});
test("emu: přeskočení klidových úseků nemění výsledek (scan po scanu = přeskočení)", () => {
    setLang("cs");
    const prj = load("03_nytovaci_lis_NL-1.plcstudio.json");
    for (const p of ["codesys", "rockwell", "unitronics"]) {
        const files = genFor(prj, p);
        const a = emulateRunFiles(prj, p, files, { scope: "full" });
        const b = emulateRunFiles(prj, p, files, { scope: "full", noSkip: true });
        assert.equal(a.scenarios.length, b.scenarios.length);
        assert.deepEqual(a.diffs, [], p);
        assert.deepEqual(b.diffs, [], p);
        assert.ok(a.scans < b.scans, p + ": přeskočení ušetří scany");
        /* návrh dojde do stejného stavu (cykly, doba cyklu, krok, porucha, čas konce) */
        assert.deepEqual(a.scenarios.map(s => s.id + ":" + s.end), b.scenarios.map(s => s.id + ":" + s.end), p + ": přeskočení změnilo průběh návrhu");
        const nom = a.scenarios.find(s => s.id === "nominal");
        assert.equal(+nom.end.split("|")[1], simulate(prj).cycleTime, p + ": doba cyklu v emulaci = simulace");
        /* i s chybou v kódu je první rozdíl stejný */
        const bad = { ...files };
        const main = p === "codesys" ? "MAIN.st" : p === "rockwell" ? "PLCdesk_Program.L5X" : "Machine.st";
        bad[main] = bad[main].replace(/IF (GVL_IO\.)?(\w+_fbk\w+) THEN seqStep := (\d+);/, "IF NOT $1$2 THEN seqStep := $3;");
        if (p === "rockwell")
            bad["MainRoutine.st"] = bad["MainRoutine.st"].replace(/IF (\w+_fbk\w+) THEN seqStep := (\d+);/, "IF NOT $1 THEN seqStep := $2;");
        const c = emulateRunFiles(prj, p, bad, { scope: "quick" }), d = emulateRunFiles(prj, p, bad, { scope: "quick", noSkip: true });
        assert.ok(c.diffs.length > 0, p + ": obrácená podmínka musí dát rozdíl");
        assert.deepEqual(c.diffs.map(x => x.scenario + x.t + x.signal), d.diffs.map(x => x.scenario + x.t + x.signal), p);
    }
});
/* ------------------------------------------------------------------ mutace */
const prjM = () => { setLang("cs"); return sampleComplex(); };
/** Přeloží upravené soubory a vrátí chyby (pravidla). */
function mutate(plat, fn) {
    const prj = prjM();
    const files = { ...genFor(prj, plat) };
    fn(files);
    return emulateFiles(prj, plat, files).res.findings;
}
const has = (fs, rule, level = "error") => fs.some(f => f.rule === rule && f.level === level);
test("emu mutace: chybějící END_IF = syntaktická chyba s polohou (všechny platformy)", () => {
    for (const p of PLATS) {
        const fs = mutate(p, files => {
            const n = p === "siemens" ? "Gen_Main.scl" : p === "rockwell" ? "PLCdesk_Program.L5X" : p === "unitronics" ? "Machine.st" : "MAIN.st";
            files[n] = files[n].replace("END_IF;", ""); // první END_IF pryč
            delete files["MainRoutine.st"];
        });
        const e = fs.find(f => f.rule === "syntax" && f.level === "error");
        assert.ok(e, p + ": chybějící END_IF nenalezen");
        assert.ok(e.line > 0 && e.col > 0, p + ": nález bez polohy");
    }
});
test("emu mutace: END_IF bez středníku — chyba u GX Works3, Sysmac, Logix; CODESYS toleruje", () => {
    const strip = (files, n) => { files[n] = files[n].replace(/END_IF;/g, "END_IF"); };
    assert.ok(has(mutate("mitsubishi", f => strip(f, "MAIN.st")), "end-semicolon"));
    assert.ok(has(mutate("omron", f => strip(f, "MAIN.st")), "end-semicolon"));
    assert.ok(has(mutate("rockwell", f => { strip(f, "PLCdesk_Program.L5X"); delete f["MainRoutine.st"]; }), "end-semicolon"));
    assert.ok(!mutate("codesys", f => strip(f, "MAIN.st")).some(x => x.level === "error"), "CODESYS END_IF bez ; toleruje");
});
test("emu mutace: nedeklarovaná proměnná", () => {
    for (const p of PLATS) {
        const fs = mutate(p, files => {
            for (const n of Object.keys(files))
                if (/MAIN|Main|Machine|L5X/.test(n))
                    files[n] = files[n].replace(/(#?)machineFault := (TRUE|1);/, "$1machineFaultX := $2;");
        });
        assert.ok(has(fs, "undeclared"), p + ": nedeklarovaná proměnná nenalezena");
    }
});
test("emu mutace: TIME do INT (implicitní převod) — chyba", () => {
    assert.ok(has(mutate("codesys", f => { f["MAIN.st"] = f["MAIN.st"].replace("enable := ", "faultStep := T#5S;\nenable := "); }), "type-conv"));
    assert.ok(has(mutate("siemens", f => { f["Gen_Main.scl"] = f["Gen_Main.scl"].replace("#enable := #enableIn;", "#enable := #enableIn;\n    #faultStep := T#5S;"); }), "type-conv"));
    assert.ok(has(mutate("omron", f => { f["MAIN.st"] = f["MAIN.st"].replace("enable := ", "faultStep := T#5S;\nenable := "); }), "type-conv"));
    /* a naopak: INT do TIME */
    assert.ok(has(mutate("beckhoff", f => { f["Gen_Library.st"] = f["Gen_Library.st"].replace("PT := T#3S", "PT := statStep"); }), "type-conv"));
});
test("emu mutace: neexistující parametr bloku a špatný směr parametru", () => {
    assert.ok(has(mutate("codesys", f => { f["MAIN.st"] = f["MAIN.st"].replace("reset := cmdAck", "resett := cmdAck"); }), "fb-param"));
    assert.ok(has(mutate("siemens", f => { f["Gen_Main.scl"] = f["Gen_Main.scl"].replace("reset := #cmdAck", "resett := #cmdAck"); }), "fb-param"));
    assert.ok(has(mutate("mitsubishi", f => { f["MAIN.st"] = f["MAIN.st"].replace(/outRun => (\w+)/, "outRun := $1"); }), "fb-param"));
    assert.ok(has(mutate("unitronics", f => { f["Machine.st"] = f["Machine.st"].replace("PT := T#3S", "PTX := T#3S"); }), "fb-param"));
    assert.ok(has(mutate("rockwell", f => { f["PLCdesk_Program.L5X"] = f["PLCdesk_Program.L5X"].replace(/\.cmdStart := /, ".cmdStartX := "); delete f["MainRoutine.st"]; }), "fb-member"));
});
test("emu mutace: rezervované Reset u Omronu, jméno operandu u GX Works3", () => {
    assert.ok(has(mutate("omron", f => { for (const n of ["Gen_Library.st", "MAIN.st"])
        f[n] = f[n].replace(/\bresetIn\b/g, "reset"); }), "reserved"));
    assert.ok(!mutate("codesys", () => { }).some(x => x.rule === "reserved"), "CODESYS reset smí");
    assert.ok(has(mutate("mitsubishi", f => { f["MAIN.st"] = f["MAIN.st"].replace(/\bseqStep\b/g, "D100"); }), "reserved"));
});
test("emu mutace: ne-ASCII v Unitronics a Logix", () => {
    assert.ok(has(mutate("unitronics", f => { f["Machine.st"] = f["Machine.st"].replace("(*", "(* čerpadlo"); }), "ascii"));
    assert.ok(has(mutate("rockwell", f => { f["Tags.csv"] = f["Tags.csv"].replace("remark,", "remark,é"); }), "ascii"));
});
test("emu mutace: konstrukce, které platforma nemá (Logix T#/RETURN/WORD, UniLogic FB)", () => {
    assert.ok(has(mutate("rockwell", f => { f["PLCdesk_Program.L5X"] = f["PLCdesk_Program.L5X"].replace(/\.PRE := \d+;/, ".PRE := T#5S;"); delete f["MainRoutine.st"]; }), "logix-construct"));
    assert.ok(has(mutate("rockwell", f => { f["PLCdesk_Program.L5X"] = f["PLCdesk_Program.L5X"].replace(/DataType="DINT"/, 'DataType="WORD"'); delete f["MainRoutine.st"]; }), "logix-construct"));
    assert.ok(has(mutate("rockwell", f => { f["PLCdesk_Program.L5X"] = f["PLCdesk_Program.L5X"].replace("<![CDATA[ELSE]]>", "<![CDATA[RETURN;]]></Line><Line Number=\"999\"><![CDATA[ELSE]]>"); delete f["MainRoutine.st"]; }), "logix-construct"));
    assert.ok(has(mutate("unitronics", f => { f["Machine.st"] = "FUNCTION_BLOCK X\nEND_FUNCTION_BLOCK\n" + f["Machine.st"]; }), "unitronics-fb"));
});
test("emu mutace: adresy (FX5 osmičkově, CODESYS typ × adresa, Beckhoff pevná adresa)", () => {
    assert.ok(has(mutate("mitsubishi", f => { f["GlobalLabels.csv"] = f["GlobalLabels.csv"].replace(/"X0"/, '"X8"'); }), "address"));
    assert.ok(has(mutate("codesys", f => { f["GVL_IO.st"] = f["GVL_IO.st"].replace(/AT %IX(\d+\.\d+) : BOOL/, "AT %IW$1 : BOOL"); }), "address"));
    assert.ok(has(mutate("beckhoff", f => { f["GVL_IO.st"] = f["GVL_IO.st"].replace("AT %I*", "AT %IX0.0"); }), "address", "warn"));
    assert.ok(has(mutate("siemens", f => { f["Gen_Tags.tsv"] = f["Gen_Tags.tsv"].replace(/\t%I0\.0\t/, "\t%I0.9\t"); }), "address"));
});
test("emu mutace: GVL qualified_only, duplicitní jméno, časovač FX5 nad 32 767 ms, TON v SCL", () => {
    assert.ok(has(mutate("codesys", f => { f["MAIN.st"] = f["MAIN.st"].replace(/GVL_IO\.(\w+_fbk\w+)/, "$1"); }), "qualified-only"));
    assert.ok(has(mutate("codesys", f => { f["MAIN.st"] = f["MAIN.st"].replace("    enable : BOOL;", "    enable : BOOL;\n    ENABLE : BOOL;"); }), "duplicate"));
    assert.ok(has(mutate("mitsubishi", f => { f["MAIN.st"] = f["MAIN.st"].replace(/PT := T#\w+\)/, "PT := T#60S)"); }), "timer-range", "warn"));
    assert.ok(has(mutate("siemens", f => { f["Gen_Library.scl"] = f["Gen_Library.scl"].replace("instTonFbk : TON_TIME;", "instTonFbk : TON;"); }), "ton-type", "warn"));
    assert.ok(has(mutate("rockwell", f => { f["PLCdesk_Program.L5X"] = f["PLCdesk_Program.L5X"].replace(/Tag Name="seqStep"/, 'Tag Name="seqStep_with_a_name_that_is_way_too_long_for_logix"'); delete f["MainRoutine.st"]; }), "ident-format"));
});
test("emu mutace: obrácená podmínka přechodu kroku = rozdíl kód ↔ návrh v běhu (všechny platformy)", () => {
    const prj = prjM();
    for (const p of PLATS) {
        const files = { ...genFor(prj, p) };
        let hit = 0;
        for (const n of Object.keys(files)) {
            if (n === "README.txt" || /Library|Tags|GVL|Labels|Variables|PLCopen/.test(n))
                continue;
            const before = files[n];
            files[n] = before.replace(/IF ("?(?:GVL_IO\.)?\w+_fbk\w+"?) THEN (#?)seqStep := (\d+);/, "IF NOT $1 THEN $2seqStep := $3;");
            if (files[n] !== before)
                hit++;
        }
        assert.ok(hit > 0, p + ": mutace se nepodařila");
        const c = emulateFiles(prj, p, files).res;
        assert.deepEqual(errs(c.findings), [], p + ": mutovaný kód se má přeložit");
        const r = emulateRunFiles(prj, p, files, { scope: "quick" });
        assert.ok(r.diffs.length > 0, p + ": obrácená podmínka nedala rozdíl v běhu");
        assert.ok(r.diffs.some(d => d.signal === "seqStep" || /statStep|_out/.test(d.signal)), p + ": rozdíl ve stavu sekvence / výstupech");
    }
});
test("emu mutace: změna logiky bloku (porucha se nedrží do kvitace) = rozdíl v běhu", () => {
    const prj = prjM();
    for (const p of ["codesys", "siemens", "omron"]) {
        const files = { ...genFor(prj, p) };
        const n = p === "siemens" ? "Gen_Library.scl" : "Gen_Library.st";
        files[n] = p === "siemens" ? files[n].replace("IF #instTrigReset.Q AND NOT #fault THEN", "IF NOT #fault THEN") : files[n].replace(/IF trigReset(In)? AND NOT fault THEN/, "IF NOT fault THEN");
        const r = emulateRunFiles(prj, p, files, { scope: "quick" });
        assert.ok(r.diffs.length > 0, p + ": změněná kvitace nedala rozdíl");
    }
});
test("emu: jazyk ST — TYPE/STRUCT, výčty, pole, FOR/WHILE/REPEAT, METHOD (OOP CODESYS/TwinCAT)", () => {
    setLang("cs");
    const prj = sampleSmall();
    const files = {
        "GVL_IO.st": "{attribute 'qualified_only'}\nVAR_GLOBAL\n    x AT %IX0.0 : BOOL;\nEND_VAR\n",
        "Gen_Library.st": [
            "TYPE ST_Pt : STRUCT a : INT; b : REAL; END_STRUCT END_TYPE",
            "TYPE E_Mode : (IDLE, RUN := 5, STOP) INT; END_TYPE",
            "FUNCTION_BLOCK FB_Cnt",
            "VAR_INPUT stp : INT := 1; END_VAR",
            "VAR_OUTPUT n : INT; END_VAR",
            "METHOD Inc : INT",
            "VAR_INPUT k : INT; END_VAR",
            "n := n + k * stp;",
            "Inc := n;",
            "END_METHOD",
            "END_FUNCTION_BLOCK",
            "FUNCTION_BLOCK FB_Cnt2 EXTENDS FB_Cnt",
            "VAR t : TON; e : R_TRIG; END_VAR",
            "e(CLK := GVL_IO.x);",
            "IF e.Q THEN n := n + 100; END_IF;",
            "END_FUNCTION_BLOCK",
        ].join("\n"),
        "MAIN.st": [
            "PROGRAM MAIN",
            "VAR c : FB_Cnt; c2 : FB_Cnt2; p : ST_Pt; arr : ARRAY[1..5] OF INT; i : INT; s : INT; md : E_Mode := E_Mode.RUN; r : INT; w : INT; END_VAR",
            "r := c.Inc(k := 2);",
            "FOR i := 1 TO 5 DO arr[i] := i * i; END_FOR;",
            "s := 0; i := 1;",
            "WHILE i <= 5 DO s := s + arr[i]; i := i + 1; END_WHILE;",
            "REPEAT w := w + 1; UNTIL w >= 3 END_REPEAT;",
            "p.a := s; p.b := INT_TO_REAL(s) / 2.0;",
            "IF md = E_Mode.RUN THEN md := E_Mode.STOP; END_IF;",
            "c2();",
            "END_PROGRAM",
        ].join("\n"),
    };
    const r = emulateFiles(prj, "codesys", files);
    assert.deepEqual(errs(r.res.findings), []);
    const prog = r.prog;
    const m = new Float64Array(prog.init);
    const exe = prog.make(m);
    const at = (...p) => m[prog.addr(p).slot];
    m[prog.addr(["GVL_IO", "x"]).slot] = 1;
    exe.scan(0);
    assert.equal(at("MAIN", "r"), 2);
    assert.equal(at("MAIN", "c", "n"), 2);
    assert.equal(at("MAIN", "s"), 55);
    assert.equal(at("MAIN", "p", "a"), 55);
    assert.equal(at("MAIN", "p", "b"), 27.5);
    assert.equal(at("MAIN", "w"), 3);
    assert.equal(at("MAIN", "md"), 6);
    assert.equal(at("MAIN", "c2", "n"), 100, "zděděný blok + R_TRIG");
    /* chyby v OOP: neexistující metoda / parametr metody */
    const bad = { ...files, "MAIN.st": files["MAIN.st"].replace("c.Inc(k := 2)", "c.Inc(kk := 2)") };
    assert.ok(emulateFiles(prj, "codesys", bad).res.findings.some(f => f.rule === "fb-param" && f.level === "error"));
});
/* ------------------------------------------------------------------ dokument a výkon */
test("emu: dokument 15_emulace_prekladu.md s upozorněním, že emulátor není překladač výrobce", () => {
    setLang("cs");
    const prj = sampleSmall();
    assert.ok(!docFiles(prj).some(d => d.path === EMU_DOC_FILE), "bez přihlášení modulu dokument není");
    const off = registerEmuModule();
    let doc;
    try {
        doc = docFiles(prj).find(d => d.path === EMU_DOC_FILE);
    }
    finally {
        off();
    }
    assert.ok(doc, "dokument emulace v sadě");
    assert.match(doc.body, /NENÍ překladač výrobce/);
    assert.match(doc.body, /\| Siemens/);
    assert.ok(!docFiles(prj).some(d => d.path === EMU_DOC_FILE), "po odhlášení zmizí");
});
test("emu: výkon — emulateAll největšího příkladu", () => {
    setLang("cs");
    const prj = load("10_vyrobni_hala_linka_rozdelovacu.plcstudio.json");
    const t0 = Date.now();
    const r = emulateAll(JSON.parse(JSON.stringify(prj)));
    const ms = Date.now() - t0;
    console.log("emu: emulateAll 10_vyrobni_hala (125 zařízení, 120 kroků, 8 platforem) " + ms + " ms, scénářů " + r.run.siemens.scenarios.length);
    assert.ok(r.ok);
    assert.ok(ms < 60000, "emulateAll pod 60 s (cíl < 30 s)");
});
