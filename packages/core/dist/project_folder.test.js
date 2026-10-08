/**
 * Projektová složka (project_folder.ts) a číslo projektu (project_meta.ts):
 * - číslo RRNNNN: kontrola tvaru (jen varování), návrh dalšího čísla včetně přetokové řady RR+50,
 * - název projektové složky,
 * - roztřídění VŠECH souborů sady (vzory 11 a 12, všechny platformy, přihlášené moduly, revize,
 *   nabídka, OOP) — nic nezůstane nezařazené, 01_Dokumentace jen známé dokumenty,
 * - předpona čísla: kód PLC bajt po bajtu stejný (jen jméno), odkazy v README / .md přepsané,
 *   výjimka TwinCAT, bez dvojí předpony, bez čísla beze změny,
 * - celá složka (licence před přejmenováním) a ZIP.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAT, syncIO, validateProject } from "./model.js";
import { genFor } from "./codegen.js";
import { CONCEPT_FILE } from "./docs.js";
import { registerSafetyModule } from "./safety.js";
import { registerHmiModule, HMI_DOC_FILE } from "./hmi_docs.js";
import { EMU_DOC_FILE } from "./emu/doc.js";
import { createRevision, CHANGES_FILE } from "./revision.js";
import { QUOTE_FILE } from "./quote.js";
import "./eplan.js"; // export EPLAN se přihlašuje s bezpečnostním modulem
import { axisBlocked } from "./axis_gen.js";
import { entitlements, projectGate } from "./license.js";
import { isProjectNumber, projectNumberProblem, nextProjectNumber, projectFolderName } from "./project_meta.js";
import { PROJECT_DIRS, projectFileFolder, projectFolderFiles, prefixProjectFiles, projectBundle, projectZip, platformFolderName, PREFIX_EXEMPT, } from "./project_folder.js";
import { loadSampleFile } from "./exp_util.test.js";
const S11 = "11_podavaci_lisovaci_stanice_PS-11.plcstudio.json";
const S12 = "12_portalovy_manipulator_PM-12.plcstudio.json";
test("číslo projektu: tvar RRNNNN jen varuje (validateProject warn), 6 číslic bez nálezu", () => {
    assert.equal(isProjectNumber("260705"), true);
    assert.equal(isProjectNumber(" 760001 "), true);
    for (const bad of ["2610705", "26070", "26-0705", "ABC123", ""])
        assert.equal(isProjectNumber(bad), false, bad);
    assert.equal(projectNumberProblem("260705"), "");
    assert.equal(projectNumberProblem(""), "");
    assert.ok(projectNumberProblem("2610705"));
    const p = loadSampleFile("01_pasovy_dopravnik_vyhazovac.plcstudio.json");
    const base = validateProject(p).length;
    p.meta.number = "260705";
    assert.equal(validateProject(p).length, base, "6 číslic: bez nálezu");
    p.meta.number = "Z-2026/15";
    const iss = validateProject(p);
    assert.equal(iss.length, base + 1);
    const w = iss.find(i => i.where === "Z-2026/15");
    assert.equal(w.level, "warn", "jiný tvar jen varuje, neblokuje");
});
test("číslo projektu: návrh dalšího čísla letošní řady a přetoková řada RR+50", () => {
    assert.equal(nextProjectNumber([], 2026), "260001", "žádná složka → RR0001");
    assert.equal(nextProjectNumber([], 2027), "270001", "nový rok bez složek → RR0001");
    assert.equal(nextProjectNumber(["260704_Lis", "260705_Linka_A", "2607061_sedm_cislic", "Nazev", "250999_lonsky"], 2026), "260706");
    assert.equal(nextProjectNumber(["260705"], 2026), "260706", "samotné číslo (web: historie čísel)");
    assert.equal(nextProjectNumber(["269998_X"], 2026), "269999", "hranice");
    assert.equal(nextProjectNumber(["269998_X", "269999_Y"], 2026), "760001", "po 269999 přetoková řada 76");
    assert.equal(nextProjectNumber(["260010_A", "760003_B"], 2026), "760004", "existující přetoková řada pokračuje");
    assert.equal(nextProjectNumber(["269999", "760003", "760001"], 2026), "760004");
    assert.equal(nextProjectNumber(["279999_A"], 2027), "770001", "2027 → přetok 77");
    assert.equal(nextProjectNumber(["260100_A", "760002_B"], 2027), "270001", "loňské řady nového roku neovlivní");
    assert.equal(nextProjectNumber(["769999_Z"], 2026), "", "vyčerpané obě řady → bez návrhu");
    assert.equal(nextProjectNumber(["260705_x"]), nextProjectNumber(["260705_x"], new Date().getFullYear()), "výchozí rok = letošní");
});
test("projektová složka: název <číslo>_<Název>, bez diakritiky, jen [A-Za-z0-9_-]", () => {
    const p = { meta: { name: "Lisovací linka Šťastný: A/B (2. etapa)", desc: "", number: "260705" } };
    assert.equal(projectFolderName(p), "260705_Lisovaci_linka_Stastny_A_B_2_etapa");
    p.meta.number = "";
    assert.equal(projectFolderName(p), "Lisovaci_linka_Stastny_A_B_2_etapa");
    p.meta.name = "";
    assert.equal(projectFolderName(p), "plc-projekt");
    p.meta.number = "260705";
    assert.equal(projectFolderName(p), "260705");
    p.meta.name = "Podávací a lisovací stanice PS-11 (měnič, polohovací osa, proporcionální ventil)";
    const n = projectFolderName(p);
    assert.match(n, /^260705_[A-Za-z0-9_-]+$/);
    assert.ok(n.length <= 7 + 60 && !/_$/.test(n), n);
    assert.equal(n, "260705_Podavaci_a_lisovaci_stanice_PS-11_menic_polohovaci_osa", "zkráceno na celé slovo");
    /* podsložky platforem jedinečné */
    const pf = Object.keys(PLAT).map(platformFolderName);
    assert.equal(new Set(pf).size, pf.length);
    for (const f of pf)
        assert.match(f, /^[A-Za-z0-9_-]+$/);
});
/** Dokumenty, které smějí být v 01_Dokumentace — nový dokument musí dostat místo vědomě. */
const DOCS_KNOWN = new Set(["00_prehled_dokumentace.md", "01_funkcni_specifikace_FDS.md", "02_io_list.csv", "03_svorkovnice.csv",
    "04_seznam_alarmu.csv", "06_navod_k_obsluze.md", "07_softwarova_dokumentace.md", "08_overeni_simulaci.md", CONCEPT_FILE, EMU_DOC_FILE]);
const DIR_RE = new RegExp("^(" + [
    PROJECT_DIRS.docs, PROJECT_DIRS.svg, PROJECT_DIRS.dxf, PROJECT_DIRS.code + "/[A-Za-z0-9_-]+", PROJECT_DIRS.hmi,
    PROJECT_DIRS.safety, PROJECT_DIRS.bom, PROJECT_DIRS.commission, PROJECT_DIRS.approval,
    PROJECT_DIRS.exports, PROJECT_DIRS.eplan, PROJECT_DIRS.internal,
].join("|") + ")/[^/]+$");
function fullProject(file, oop = false) {
    const p = loadSampleFile(file);
    p.platforms = Object.keys(PLAT).filter(k => !axisBlocked(p, k));
    if (oop)
        p.codeStyle = "oop";
    p.quote = { ...(p.quote || {}), inDocs: true };
    createRevision(p, "Jan Novák", "test");
    syncIO(p);
    return p;
}
for (const [file, oop] of [[S11, true], [S12, false]])
    test("roztřídění: " + file + (oop ? " (OOP)" : "") + " — všechny soubory na svém místě, nic nezařazeného", () => {
        const offS = registerSafetyModule(), offH = registerHmiModule();
        try {
            const p = fullProject(file, oop);
            const ff = projectFolderFiles(p);
            const paths = ff.map(f => f.path);
            assert.equal(new Set(paths).size, paths.length, "bez duplicit");
            for (const x of paths)
                assert.match(x, DIR_RE, x);
            const at = (dir) => paths.filter(x => x.slice(0, x.lastIndexOf("/")) === dir).map(x => x.slice(x.lastIndexOf("/") + 1));
            for (const n of at(PROJECT_DIRS.docs))
                assert.ok(DOCS_KNOWN.has(n), "nezařazený soubor v 01_Dokumentace: " + n);
            /* kód každé platformy v její podsložce s původními jmény */
            for (const pl of p.platforms)
                assert.deepEqual(at(PROJECT_DIRS.code + "/" + platformFolderName(pl)).sort(), Object.keys(genFor(p, pl)).sort(), pl);
            assert.ok(at(PROJECT_DIRS.safetyCode).length > 0, "bezpečnostní program");
            assert.ok(at(PROJECT_DIRS.svg).includes("00_blokove_schema.svg") && at(PROJECT_DIRS.dxf).some(n => /^01_.*\.dxf$/.test(n)));
            assert.ok(at(PROJECT_DIRS.svg).every(n => n.endsWith(".svg")) && at(PROJECT_DIRS.dxf).every(n => n.endsWith(".dxf")));
            if (oop)
                assert.ok(at(PROJECT_DIRS.svg).includes("00_diagram_trid.svg"));
            assert.ok(at(PROJECT_DIRS.svg).includes("00_bezpecnostni_okruh.svg"));
            assert.deepEqual(at(PROJECT_DIRS.bom).sort(), ["09_kusovnik.csv", "09_kusovnik.md"]);
            assert.deepEqual(at(PROJECT_DIRS.commission).sort(), ["05_testovaci_protokol_FAT.md", "12_protokol_ozivovani.csv", "12_protokol_ozivovani.md"]);
            assert.deepEqual(at(PROJECT_DIRS.approval).sort(), [CHANGES_FILE, "11_schvaleni.md"].sort());
            assert.deepEqual(at(PROJECT_DIRS.internal), [QUOTE_FILE]);
            const saf = at(PROJECT_DIRS.safety);
            for (const n of ["13_bezpecnostni_funkce.md", "14_plan_validace.md", "19_sistema.md", "sistema_predpis.csv"])
                assert.ok(saf.includes(n), n);
            assert.ok(saf.some(n => n.endsWith(".ssm")));
            assert.ok(at(PROJECT_DIRS.hmi).includes(HMI_DOC_FILE) && at(PROJECT_DIRS.hmi).includes("hmi_web.html"));
            assert.ok(at(PROJECT_DIRS.hmi).includes("hmi_siemens_README_HMI.txt") && at(PROJECT_DIRS.hmi).includes("hmi_siemens_HmiTags.tsv"));
            assert.ok(at(PROJECT_DIRS.eplan).includes("README_EPLAN.txt") && at(PROJECT_DIRS.eplan).some(n => n.endsWith("_AR_APC.aml")));
        }
        finally {
            offS();
            offH();
        }
    });
test("roztřídění: jednotlivá jména (dialogy Uložit v desktopu) a neznámé → 01_Dokumentace", () => {
    assert.equal(projectFileFolder("Gen_Main.scl", "kod/siemens"), "03_Program_PLC/Siemens_SIMATIC");
    assert.equal(projectFileFolder("safety_x.scl", "kod/safety"), "03_Program_PLC/Bezpecnostni_program");
    assert.equal(projectFileFolder("01_DI1_X1.dxf", "vykresy"), "02_Vykresy/DXF");
    assert.equal(projectFileFolder("00_blokove_schema.svg", "vykresy"), "02_Vykresy/SVG");
    assert.equal(projectFileFolder("05_testovaci_protokol_FAT.md", "dokumentace"), "07_Oziveni_a_FAT");
    assert.equal(projectFileFolder("11_schvaleni.md", "dokumentace"), "08_Schvaleni_a_revize");
    assert.equal(projectFileFolder("17_zmeny.md"), "08_Schvaleni_a_revize");
    assert.equal(projectFileFolder("18_nabidka.md", "dokumentace"), "99_Interni");
    assert.equal(projectFileFolder("Linka_nabidka.csv", "interni"), "99_Interni");
    assert.equal(projectFileFolder("09_kusovnik.csv", "kusovnik"), "06_Kusovnik");
    assert.equal(projectFileFolder("13_bezpecnostni_funkce.md", "dokumentace"), "05_Bezpecnost");
    assert.equal(projectFileFolder("16_hmi.md", "dokumentace"), "04_HMI");
    assert.equal(projectFileFolder("hmi_siemens_HmiTags.tsv", "hmi/siemens"), "04_HMI");
    assert.equal(projectFileFolder("x_AR_APC.aml", "eplan"), "09_Exporty/EPLAN");
    assert.equal(projectFileFolder("cokoli.bin", "exporty"), "09_Exporty");
    assert.equal(projectFileFolder("20_novy_dokument.md", "dokumentace"), "01_Dokumentace");
    assert.equal(projectFileFolder("neznamy.txt"), "01_Dokumentace");
});
test("předpona: kód PLC beze změny bajt po bajtu, odkazy v README / .md přepsané, výjimka TwinCAT", () => {
    const offH = registerHmiModule();
    try {
        const p = fullProject(S11, true);
        const ff = projectFolderFiles(p);
        const pf = prefixProjectFiles(ff, "260705");
        assert.equal(pf.length, ff.length);
        const base = (x) => x.slice(x.lastIndexOf("/") + 1);
        const dirOf = (x) => x.slice(0, x.lastIndexOf("/"));
        let code = 0, readme = 0, tc = 0;
        ff.forEach((f, i) => {
            const g = pf[i];
            assert.equal(dirOf(g.path), dirOf(f.path), "podsložka se nemění");
            const b = base(f.path);
            if (PREFIX_EXEMPT.test(b)) {
                tc++;
                assert.equal(g.path, f.path, "TwinCAT bez předpony: " + b);
            }
            else
                assert.equal(base(g.path), "260705_" + b);
            if (/\.(scl|st|L5X|xml|csv|tsv|TcPOU|TcGVL|TcIO|cs|ssm|aml|json|dxf|svg)$/i.test(b) || b === "Variables.txt") {
                assert.equal(g.body, f.body, "obsah beze změny: " + f.path);
                if (f.path.startsWith(PROJECT_DIRS.code))
                    code++;
            }
        });
        assert.ok(code > 50 && tc >= 3, "kód " + code + ", TwinCAT " + tc);
        /* README Siemens: odkazy na nová jména, ne na stará */
        const rd = pf.find(f => f.path === "03_Program_PLC/Siemens_SIMATIC/260705_README.txt");
        assert.ok(rd.body.includes("260705_Gen_Main.scl") && rd.body.includes("260705_Gen_Library.scl"));
        assert.ok(!/(?<![0-9_])Gen_Main\.scl/.test(rd.body), "žádný starý odkaz");
        readme++;
        /* README Beckhoff OOP: .st s předponou, objekty TwinCAT beze změny */
        const rb = pf.find(f => f.path === "03_Program_PLC/Beckhoff/260705_README.txt").body;
        assert.ok(rb.includes("260705_MAIN.st") && rb.includes("MAIN.TcPOU") && !rb.includes("260705_MAIN.TcPOU"));
        /* přehled dokumentace: odkazy na dokumenty v jiných podsložkách */
        const ix = pf.find(f => f.path.endsWith("260705_00_prehled_dokumentace.md")).body;
        assert.ok(ix.includes("260705_01_funkcni_specifikace_FDS.md") && ix.includes("260705_09_kusovnik.csv"));
        /* celé jméno: „GOT_Tags.csv“ / „HmiTags.tsv“ se kvůli „Tags.csv“ nerozbije */
        const hm = pf.find(f => f.path === "04_HMI/260705_16_hmi.md").body;
        assert.ok(hm.includes("260705_hmi_mitsubishi_GOT_Tags.csv") && !hm.includes("GOT_260705_") && !hm.includes("Hmi260705_"));
        const rh = pf.find(f => f.path === "04_HMI/260705_hmi_siemens_README_HMI.txt").body;
        assert.ok(rh.includes("260705_hmi_siemens_HmiTags.tsv") && rh.includes("260705_16_hmi.md"), "README_HMI: uložená jména");
        /* bez dvojí předpony: druhé použití nic nezmění */
        assert.deepEqual(prefixProjectFiles(pf, "260705"), pf);
        /* bez čísla beze změny */
        assert.deepEqual(prefixProjectFiles(ff, ""), ff);
        assert.ok(readme);
    }
    finally {
        offH();
    }
});
test("předpona: hranice jmen v textu", () => {
    const files = [
        { path: "a/README.txt", body: "Soubory: MAIN.st, Gen_Main.scl; (MAIN.st). Ne: MAIN.st.bak, xMAIN.st, MAIN.sts, _MAIN.st, MAIN.st_x\nMAIN.st", kind: "text" },
        { path: "a/MAIN.st", body: "(* README.txt *) MAIN.st", kind: "text" },
        { path: "a/Gen_Main.scl", body: "", kind: "text" },
    ];
    const [r, m] = prefixProjectFiles(files, "260705");
    assert.equal(r.body, "Soubory: 260705_MAIN.st, 260705_Gen_Main.scl; (260705_MAIN.st). Ne: MAIN.st.bak, xMAIN.st, MAIN.sts, _MAIN.st, MAIN.st_x\n260705_MAIN.st");
    assert.equal(m.path, "a/260705_MAIN.st");
    assert.equal(m.body, "(* README.txt *) MAIN.st", "kód PLC (i komentář) beze změny");
});
test("celá složka a ZIP: licence před přejmenováním, struktura, projekt vždy", () => {
    const offH = registerHmiModule();
    try {
        const p = loadSampleFile(S11);
        p.meta.number = "260705";
        syncIO(p);
        const b = projectBundle(p, { projectText: "{\"prj\":{}}" });
        assert.equal(b.folder, "260705_Podavaci_a_lisovaci_stanice_PS-11_menic_polohovaci_osa");
        assert.equal(b.projectFile, b.folder + ".plcstudio.json");
        assert.equal(b.files[0].path, b.projectFile);
        assert.ok(b.files.every(f => f.path === b.projectFile || /\/260705_[^/]+$/.test(f.path)), "předpona u všech souborů");
        const xl = b.files.find(f => f.path === "04_HMI/260705_hmi_siemens.xlsx");
        assert.ok(xl.data && xl.data.length > 1000);
        /* Free: patička v dokumentech a README, DXF zamčené, kód beze změny */
        const free = projectBundle(p, { gate: projectGate(p, entitlements("free")), projectText: "{}" });
        const fds = free.files.find(f => f.path.endsWith("260705_01_funkcni_specifikace_FDS.md"));
        assert.ok(fds.body.includes("PLCdesk") && fds.body.length > b.files.find(f => f.path === fds.path).body.length, "patička Free");
        assert.ok(free.files.filter(f => f.path.endsWith(".dxf")).every(f => f.blocked && !f.body), "DXF ve Free zamčené");
        assert.equal(free.files.find(f => f.path.endsWith("/260705_Gen_Main.scl")).body, b.files.find(f => f.path.endsWith("/260705_Gen_Main.scl")).body);
        /* ZIP: kořen = projektová složka, zamčené soubory chybí */
        const zip = projectZip(free);
        const names = zipNames(zip);
        assert.ok(names.every(n => n.startsWith(free.folder + "/")));
        assert.ok(names.includes(free.folder + "/" + free.projectFile));
        assert.ok(names.includes(free.folder + "/03_Program_PLC/Siemens_SIMATIC/260705_Gen_Main.scl"));
        assert.ok(!names.some(n => n.endsWith(".dxf")));
        assert.equal(names.length, free.files.filter(f => !f.blocked).length);
        /* nad limitem: jen projekt */
        const over = projectBundle(p, { gate: { ...projectGate(p, entitlements("free")), over: true, reason: "limit" }, projectText: "{}" });
        assert.deepEqual(zipNames(projectZip(over)), [over.folder + "/" + over.projectFile]);
    }
    finally {
        offH();
    }
});
/** Jména položek ZIP z centrálního adresáře. */
function zipNames(z) {
    const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
    let e = z.length - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50)
        e--;
    const n = v.getUint16(e + 10, true);
    let o = v.getUint32(e + 16, true);
    const out = [], dec = new TextDecoder();
    for (let i = 0; i < n; i++) {
        assert.equal(v.getUint32(o, true), 0x02014b50);
        const ln = v.getUint16(o + 28, true), lx = v.getUint16(o + 30, true), lc = v.getUint16(o + 32, true);
        out.push(dec.decode(z.subarray(o + 46, o + 46 + ln)));
        o += 46 + ln + lx + lc;
    }
    return out;
}
