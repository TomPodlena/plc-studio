/** Sjednocení web × desktop (2026-10-10): funkce jádra, které oba klienti volají místo vlastní logiky —
 *  tabulka kusovníku ke kopírování, množství řádku, přehled dodavatelů, filtr schválení, model stroje. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncIO } from "./model.js";
import { setLang, withLang } from "./i18n.js";
import { sampleSmall } from "./samples.js";
import { buildBom, bomCsv, bomMd, bomTableText, bomQtyInput, bomSuppliers, BOM_QTY_MAX } from "./bom.js";
import { APPROVAL_FILTERS, approvalFilterLabel, approvalFilterPass } from "./approval.js";
import { setSimModel, SIM_MODEL_RANGE } from "./edit.js";
import { validateProject } from "./model.js";
function small() { setLang("cs"); const p = sampleSmall(); syncIO(p); return p; }
test("bomTableText: stejné sloupce a řádky jako CSV (tabulátor), řádek s množstvím 0 vyřazen", () => {
    const p = small();
    const lines = buildBom(p).lines;
    const first = lines[0];
    p.bom = { lines: { [first.id]: { qty: 0 } } };
    const tsv = bomTableText(p);
    const rows = tsv.trimEnd().split("\n").map(r => r.split("\t"));
    const csv = bomCsv(p).replace(/^﻿/, "").trimEnd().split("\r\n").map(r => r.split(";"));
    assert.deepEqual(rows[0], csv[0]); // záhlaví = CSV (Pozice … Jednotka … Poznámka)
    assert.equal(rows[0].length, 11);
    assert.equal(rows.length, csv.length); // bez vyřazeného řádku jako CSV
    assert.ok(!rows.slice(1).some(r => r[1] === first.tag && r[2] === first.item));
    assert.ok(buildBom(p).lines.some(l => l.id === first.id && l.excluded)); // v přehledu zůstává
    assert.ok(tsv.endsWith("\n") && !tsv.includes("\r"));
    /* tabulátor / nový řádek v textu uživatele nerozbije tabulku */
    p.bom = { lines: { [first.id]: { note: "a\tb\nc" } } };
    assert.ok(bomTableText(p).split("\n")[1].split("\t").length === 11);
    /* jazyk: záhlaví přeložené */
    assert.match(withLang("en", () => bomTableText(p)).split("\n")[0], /^Position\tDesignation|^Position\t/);
});
test("bomTableText nemění dokumentaci (bomCsv / bomMd beze změny)", () => {
    const p = small();
    const csv = bomCsv(p), md = bomMd(p);
    bomTableText(p);
    bomSuppliers(p);
    assert.equal(bomCsv(p), csv);
    assert.equal(bomMd(p), md);
});
test("bomQtyInput: celé číslo 0…100000, prázdné = zpět na návrh, jinak chyba", () => {
    setLang("cs");
    assert.deepEqual(bomQtyInput("3"), { qty: 3 });
    assert.deepEqual(bomQtyInput(" 0 "), { qty: 0 });
    assert.deepEqual(bomQtyInput(String(BOM_QTY_MAX)), { qty: BOM_QTY_MAX });
    assert.deepEqual(bomQtyInput(12), { qty: 12 });
    assert.deepEqual(bomQtyInput(""), { reset: true });
    assert.deepEqual(bomQtyInput("  "), { reset: true });
    for (const bad of ["-1", "100001", "1,5", "2.5", "abc", "inf", "NaN", "1e9"]) {
        const r = bomQtyInput(bad);
        assert.ok(r.error && r.qty === undefined, bad);
        assert.match(r.error, /100000/);
    }
});
test("bomSuppliers: jen použití dodavatelé s počtem řádků; vlastní dodavatel označený", () => {
    const p = small();
    const lines = buildBom(p).lines;
    const sups = bomSuppliers(p);
    const used = new Set(lines.filter(l => !l.excluded).map(l => l.supplier).filter(Boolean));
    assert.deepEqual(new Set(sups.map(s => s.name)), used);
    for (const s of sups)
        assert.equal(s.rows, lines.filter(l => !l.excluded && l.supplier === s.name).length);
    assert.ok(sups.some(s => s.url.startsWith("http")));
    p.bom = { lines: { [lines[0].id]: { supplier: "Elektro Novák s.r.o." } } };
    const own = bomSuppliers(p).find(s => s.name === "Elektro Novák s.r.o.");
    assert.ok(own && own.custom && own.rows === 1 && own.url === "");
    /* druhy dodavatelů přeložené — v angličtině žádná čeština */
    const en = withLang("en", () => { const q = small(); setLang("en"); return bomSuppliers(q); });
    setLang("cs");
    assert.ok(en.every(s => !/[ěščřžýáíéůú]/i.test(s.kind)), JSON.stringify(en.map(s => s.kind)));
});
test("approvalFilterPass: vše / k rozhodnutí / podle stavu (web i desktop)", () => {
    setLang("cs");
    assert.deepEqual([...APPROVAL_FILTERS], ["all", "open", "stale", "rejected", "approved"]);
    const sts = ["approved", "rejected", "stale", "missing", "proposed", "unverified"];
    const open = sts.filter(s => approvalFilterPass(s, "open"));
    assert.deepEqual(open, ["stale", "missing", "proposed"]);
    assert.ok(sts.every(s => approvalFilterPass(s, "all")));
    assert.deepEqual(sts.filter(s => approvalFilterPass(s, "rejected")), ["rejected"]);
    assert.ok(approvalFilterPass("approved", "neznámý")); // neznámý filtr = vše
    assert.equal(approvalFilterLabel("all"), "vše");
    assert.equal(approvalFilterLabel("stale"), "změněno po schválení");
});
test("setSimModel: 0,05…600 s, čárka i tečka, prázdné = beze změny, chyba nic nemění", () => {
    const p = small();
    delete p.sim;
    assert.deepEqual(setSimModel(p, { motorDelay: "", valveTravel: "" }), { ok: true, count: 0 });
    assert.equal(p.sim, undefined);
    assert.deepEqual(setSimModel(p, { valveTravel: "2,5" }), { ok: true, count: 1 });
    assert.deepEqual(p.sim, { motorDelay: 0.5, valveTravel: 2.5 });
    for (const bad of ["0", "-1", "601", "abc", "inf", "1e9"]) {
        const r = setSimModel(p, { motorDelay: bad });
        assert.ok(!r.ok && /600/.test(r.error), bad);
        assert.deepEqual(p.sim, { motorDelay: 0.5, valveTravel: 2.5 }, bad);
    }
    assert.ok(setSimModel(p, { motorDelay: SIM_MODEL_RANGE.max, valveTravel: SIM_MODEL_RANGE.min }).ok);
    assert.ok(!validateProject(p).some(i => i.where === "model stroje"));
    assert.deepEqual(setSimModel(p, { motorDelay: 600 }), { ok: true, count: 0 });
});
