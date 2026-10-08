/**
 * Testy identifikace projektu (project_meta.ts, project_folder.ts):
 * - číslo projektu, zákazník a datum zahájení v popisovém poli výkresů (SVG + DXF ASCII), v hlavičce dokumentů a README,
 *   NE v kódu PLC; prázdná pole = výstup beze změny,
 * - víceřádkový popis projektu: kód všech platforem + emulace překladu, dokumentace, výkresy, EPLAN / SISTEMA,
 * - revize (kosmetická změna, složka dat není obsah), názvy souborů, složka dat projektu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAT, modules, syncIO } from "./model.js";
import { genFor } from "./codegen.js";
import { docFiles, allProjectFiles } from "./docs.js";
import { sheetSVG, sheetDXF, circuitSheetSVG, circuitSheetDXF } from "./drawing.js";
import { sampleSmall, sampleComplex } from "./samples.js";
import { setLang, getLang, LANGS } from "./i18n.js";
import { emulateCompile } from "./emu/index.js";
import { registerSafetyModule, proposeSafety } from "./safety.js";
import { safetyCircuitSheet } from "./safety_docs.js";
import { registerHmiModule } from "./hmi_docs.js";
import { sistemaExport } from "./sistema.js";
import { eplanFiles, eplanAml } from "./eplan.js";
import { diffProjects, createRevision, modifiedSinceRevision } from "./revision.js";
import { projectFilePrefix, projectFileName, withFilePrefix, projectTitle, mdMultiline, firstLine, oneLine, projectMetaMd, isIsoDate, formatIsoDate, projectRef, parseUserDate, calendarLabels } from "./project_meta.js";
import { projectFolderFiles, PROJECT_DIRS } from "./project_folder.js";
import { xmlProblem } from "./exp_util.test.js";
const NUM = "2610705", CUST = "Strojírny Šťastný a syn, s.r.o.", START = "2026-10-05";
const withRef = (p) => { p.meta.number = NUM; p.meta.customer = CUST; p.meta.startDate = START; return p; };
const MULTI = "Linka plní lahve.\nDruhý řádek: <tag> & \"uvozovky\" (* komentář *) // konec\n\nNový odstavec — 50 % výkonu.\r\nKonec $ ' ;";
function withLang(l, fn) { const o = getLang(); setLang(l); try {
    return fn();
}
finally {
    setLang(o);
} }
const allPlats = Object.keys(PLAT);
test("číslo a zákazník: prázdná pole = výstup beze změny (kód, README, dokumenty, výkresy)", () => {
    const a = sampleSmall(), b = sampleSmall();
    b.meta.number = "";
    b.meta.customer = "  ";
    b.meta.startDate = "";
    syncIO(a);
    syncIO(b);
    for (const p of a.platforms)
        assert.deepEqual(genFor(b, p), genFor(a, p), p);
    assert.deepEqual(docFiles(b).map(f => f.body), docFiles(a).map(f => f.body));
    const ma = modules(a), mb = modules(b);
    ma.forEach((m, i) => {
        assert.equal(sheetSVG(b, mb[i], i + 1), sheetSVG(a, m, i + 1));
        assert.equal(sheetDXF(b, mb[i], i + 1), sheetDXF(a, m, i + 1));
    });
    assert.equal(projectMetaMd(b), "");
    assert.equal(projectFilePrefix(b), "");
});
test("číslo a zákazník: popisové pole výkresů SVG + DXF (ASCII), bezpečnostní okruh", () => {
    for (const l of Object.keys(LANGS))
        withLang(l, () => {
            const p = withRef(sampleComplex());
            syncIO(p);
            const mods = modules(p);
            const svg = sheetSVG(p, mods[0], 1, 1, mods.length), dxf = sheetDXF(p, mods[0], 1, 1, mods.length);
            assert.ok(svg.includes(NUM) && svg.includes("Strojírny Šťastný a syn"), l + ": SVG");
            assert.ok(dxf.includes(NUM) && dxf.includes("Strojirny Stastny a syn"), l + ": DXF bez diakritiky");
            assert.ok(!/[^\x00-\x7F]/.test(dxf), l + ": DXF ASCII");
            const day = formatIsoDate(START, true);
            assert.ok(svg.includes(day) && dxf.includes(day) && /\b5\b|05/.test(day), l + ": datum zahájení " + day);
            /* list je o pruh vyšší, nic se nepřekrývá s původním polem */
            const h = (s) => +s.match(/viewBox="0 0 \d+ (\d+)"/)[1];
            const plain = sampleComplex();
            syncIO(plain);
            assert.equal(h(svg), h(sheetSVG(plain, modules(plain)[0], 1, 1, mods.length)) + 26);
            /* bezpečnostní okruh */
            const sh = safetyCircuitSheet(p, proposeSafety(p));
            assert.equal(sh.number, NUM);
            assert.ok(circuitSheetSVG(sh).includes("Strojírny Šťastný a syn"));
            assert.ok(!/[^\x00-\x7F]/.test(circuitSheetDXF(sh)) && circuitSheetDXF(sh).includes(NUM));
            const plainSh = safetyCircuitSheet(plain, proposeSafety(plain));
            assert.equal("number" in plainSh, false, "bez čísla se objekt výkresu nemění");
        });
});
test("číslo a zákazník: hlavička dokumentů a README, ne v kódu PLC", () => {
    const off = registerSafetyModule(), offH = registerHmiModule();
    try {
        for (const l of Object.keys(LANGS))
            withLang(l, () => {
                const p = withRef(sampleSmall());
                syncIO(p);
                for (const f of docFiles(p))
                    if (f.path.endsWith(".md")) {
                        const lines = f.body.split("\n");
                        const at = lines.findIndex(x => x.includes(NUM));
                        assert.ok(at > 0 && at <= 3, l + " / " + f.path + ": číslo pod nadpisem");
                        assert.ok(lines[at].includes(CUST), l + " / " + f.path + ": zákazník");
                        assert.ok(lines[at].includes(formatIsoDate(START)), l + " / " + f.path + ": datum zahájení");
                    }
                for (const pl of allPlats) {
                    const files = genFor(p, pl);
                    assert.ok(files["README.txt"].split("\n").slice(0, 4).some(x => x.includes(NUM) && x.includes(CUST) && x.includes(formatIsoDate(START))), l + " / " + pl + ": README");
                    for (const [n, b] of Object.entries(files))
                        if (!/README/.test(n)) {
                            assert.ok(!b.includes(NUM) && !b.includes("Šťastný"), l + " / " + pl + " / " + n + ": číslo / zákazník v kódu");
                        }
                }
            });
    }
    finally {
        off();
        offH();
    }
});
test("víceřádkový popis: kód všech platforem a emulace překladu bez chyb", () => {
    const p = withRef(sampleSmall());
    p.meta.desc = MULTI;
    syncIO(p);
    const ref = sampleSmall();
    syncIO(ref);
    for (const pl of allPlats) {
        const files = genFor(p, pl);
        /* popis do kódu nejde: kromě README beze změny proti projektu s jednořádkovým popisem */
        const base = genFor(ref, pl);
        for (const [n, b] of Object.entries(files))
            if (!/README/.test(n))
                assert.equal(b, base[n], pl + " / " + n);
        if (pl === "unitronics")
            for (const n of ["Machine.st", "Tags.csv"])
                assert.ok(!/[^\x00-\x7F]/.test(files[n]), n + " ASCII");
        /* README: popis se do něj nepíše, číslo a zákazník jen jako jeden řádek */
        assert.ok(!files["README.txt"].includes("Druhý řádek"), pl + ": README bez popisu");
        const c = emulateCompile(p, pl);
        assert.deepEqual(c.findings.filter(f => f.level === "error"), [], pl + ": překlad");
    }
});
test("víceřádkový popis: dokumentace (odstavce), výkresy, EPLAN, SISTEMA", () => {
    const off = registerSafetyModule(), offH = registerHmiModule();
    try {
        const p = withRef(sampleComplex());
        p.meta.desc = MULTI;
        syncIO(p);
        const docs = docFiles(p);
        const fds = docs.find(f => f.path.startsWith("01_")).body;
        assert.ok(fds.includes("Linka plní lahve.  \nDruhý řádek"), "tvrdé zalomení řádku");
        assert.ok(fds.includes("// konec\n\nNový odstavec"), "odstavec zůstává");
        assert.ok(!fds.includes("\r"), "bez CR");
        for (const f of allProjectFiles(p)) {
            if (f.kind === "dxf")
                assert.ok(!/[^\x00-\x7F]/.test(f.body), f.save + " ASCII");
            if (f.kind === "svg" || /\.(xml|aml|ssm)$/i.test(f.save))
                assert.equal(xmlProblem(f.body), "", f.save);
        }
        for (const f of eplanFiles(p))
            if (/\.aml$/i.test(f.name))
                assert.equal(xmlProblem(f.body), "", f.name);
        assert.equal(xmlProblem(eplanAml(p)), "");
        for (const [n, b] of Object.entries(sistemaExport(p).files))
            if (/\.ssm$/i.test(n))
                assert.equal(xmlProblem(b), "", n);
    }
    finally {
        off();
        offH();
    }
});
test("pomůcky: jeden řádek, Markdown, první řádek, názvy souborů, titulek", () => {
    assert.equal(mdMultiline("bez zalomení"), "bez zalomení");
    assert.equal(mdMultiline("a\r\nb\n\n\n\nc\n"), "a  \nb\n\nc");
    assert.equal(firstLine("\n  první \ndruhý"), "první");
    assert.equal(firstLine("dlouhý text", 6), "dlouh…");
    assert.equal(oneLine(" a\n\tb  c "), "a b c");
    const p = sampleSmall();
    p.meta.number = " 26/107:05 ";
    assert.equal(projectFilePrefix(p), "26_107_05_");
    assert.equal(withFilePrefix(p, "26_107_05_x.csv"), "26_107_05_x.csv", "prefix jen jednou");
    p.meta.name = "Linka A/B: 1";
    assert.equal(projectFileName(p), "26_107_05_Linka A_B_ 1.plcstudio.json");
    p.meta.customer = "ACME";
    assert.equal(projectTitle(p), "26/107:05 · Linka A/B: 1 · ACME");
    p.meta.number = "ČŘ-č. 1";
    assert.equal(projectFilePrefix(p), "CR-c._1_");
    p.meta.number = "///";
    assert.equal(projectFilePrefix(p), "");
    assert.ok(isIsoDate("2026-02-28") && !isIsoDate("2026-02-30") && !isIsoDate("8.10.2026") && !isIsoDate(""));
    p.meta.startDate = "2026-13-01";
    assert.equal(projectRef(p).startDate, "", "neplatné datum se ignoruje");
    assert.equal(projectTitle(p), "/// · Linka A/B: 1 · ACME", "datum v titulku není");
    assert.equal(withLang("cs", () => formatIsoDate("2026-10-08")), "8. 10. 2026");
    assert.equal(withLang("de", () => formatIsoDate("2026-10-08")), "8.10.2026");
});
test("revize: číslo a zákazník = kosmetická změna, složka dat není obsah", () => {
    const p = sampleSmall();
    syncIO(p);
    createRevision(p, "Tester", "A", { at: "2026-10-08T10:00:00Z" });
    p.meta.dataDir = "C:\\Projekty\\2610705";
    assert.equal(modifiedSinceRevision(p), false, "dataDir");
    const q = structuredClone(p);
    q.meta.number = NUM;
    q.meta.customer = "ACME";
    q.meta.startDate = START;
    const d = diffProjects(p, q);
    const meta = d.changes.filter(c => c.field === "meta.number" || c.field === "meta.customer" || c.field === "meta.startDate");
    assert.equal(meta.length, 3);
    for (const c of meta)
        assert.equal(c.cls, "cosmetic");
    assert.equal(modifiedSinceRevision(q), true);
});
test("složka dat projektu: podsložky, původní jména, nic navíc", () => {
    const offH = registerHmiModule();
    try {
        const p = withRef(sampleSmall());
        syncIO(p);
        const ff = projectFolderFiles(p);
        const paths = ff.map(f => f.path);
        assert.equal(new Set(paths).size, paths.length, "bez duplicit");
        for (const pl of p.platforms)
            for (const n of Object.keys(genFor(p, pl)))
                assert.ok(paths.includes(PROJECT_DIRS.code + "/" + pl + "/" + n), pl + "/" + n);
        assert.ok(paths.includes("dokumentace/01_FDS.md") || paths.some(x => /^dokumentace\/01_/.test(x)));
        assert.ok(paths.some(x => /^kusovnik\/09_kusovnik\.csv$/.test(x)));
        assert.ok(paths.some(x => /^vykresy\/.*\.dxf$/.test(x)) && paths.some(x => /^vykresy\/00_blokove_schema\.svg$/.test(x)));
        assert.ok(paths.some(x => /^hmi\//.test(x)));
        assert.ok(paths.every(x => /^(kod\/[a-z]+|dokumentace|vykresy|kusovnik|hmi|exporty)\/[^/]+$/.test(x)), paths.find(x => !/^(kod\/[a-z]+|dokumentace|vykresy|kusovnik|hmi|exporty)\/[^/]+$/.test(x)));
        assert.equal(ff.length, allProjectFiles(p).length);
    }
    finally {
        offH();
    }
});
test("datum zahájení: zápis podle jazyka → ISO, popisky kalendáře", () => {
    for (const l of ["cs", "de", "en", "es"])
        withLang(l, () => {
            assert.equal(parseUserDate(formatIsoDate("2026-10-08")), "2026-10-08", l);
            assert.equal(parseUserDate("2026-10-08"), "2026-10-08", l + " ISO");
            assert.equal(parseUserDate("31. 2. 2026"), "", l + " neplatné");
            const c = calendarLabels();
            assert.equal(c.months.length, 12);
            assert.equal(c.weekdays.length, 7);
        });
    withLang("zh", () => assert.equal(parseUserDate(formatIsoDate("2026-10-08")), "2026-10-08"));
    assert.equal(parseUserDate("text"), "");
});
