/** Testy exportu do SISTEMA (sistema.ts) — node:test, bez závislostí. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { withLang, type Lang } from "./i18n.js";
import { docFiles, allProjectFiles } from "./docs.js";
import { buildBom } from "./bom.js";
import { sampleSmall, sampleComplex } from "./samples.js";
import { proposeSafety, registerSafetyModule, unregisterSafetyModule } from "./safety.js";
import { sistemaExport, sistemaModel, sistemaSsm, sistemaCsv, sistemaMd, sistemaNum, sistemaParsePfh, sistemaFileName, SISTEMA_FILE } from "./sistema.js";
import "./safety_docs.js";
import { sampleNames, loadSampleFile, xmlProblem } from "./exp_util.test.js";

const TABLES = ["projectops", "sfops", "componentops", "channelops", "blocops", "elementops", "dcmeasureops", "ccfmeasureops", "libmetadata"];
const rowsOf = (ssm: string, table: string) => {
  const t = ssm.match(new RegExp('<table table_name="' + table + '"><fields>(.*?)</fields><rows>(.*?)</rows></table>'));
  assert.ok(t, "tabulka " + table);
  const fields = [...t![1].matchAll(/field_name="([^"]+)"/g)].map(m => m[1]);
  const rows = [...t![2].matchAll(/<row ([^>]*)\/>/g)].map(m => Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(x => [x[1], x[2]])));
  return { fields, rows };
};
function withSafety(fn: () => void): void { const off = registerSafetyModule(); try { fn(); } finally { off(); } }

test("SISTEMA: čísla ve zvyklosti SISTEMA a PFHd z katalogu", () => {
  assert.equal(sistemaNum(1.5e-8), "1,5E-8");
  assert.equal(sistemaNum(2.31e-9), "2,31E-9");
  assert.equal(sistemaNum(0.99), "0,99");
  assert.equal(sistemaNum(1369863), "1369863");
  assert.equal(sistemaNum(22.5), "22,5");
  assert.equal(sistemaParsePfh("2,31E-09 1/h"), 2.31e-9);
  assert.equal(sistemaParsePfh(""), null);
  assert.equal(sistemaParsePfh("CU240E-2/-2 F, CU250S-2: 5,0E-08 1/h; PM-STO PM240-2 FSD–FSF: 5,0E-09 1/h"), 5e-8, "typ CU240E-2 není číslo; víc hodnot = nejvyšší");
  assert.equal(sistemaParsePfh("EL1904: 1,11E-09 1/h (PFD 8,29E-05)"), 1.11e-9, "PFD se nebere");
});

test("SISTEMA: všech 12 příkladů — .ssm well-formed, úplné tabulky, vazby OID, PLr a označení shodné s kusovníkem", () => {
  withSafety(() => {
    const names = sampleNames();
    assert.ok(names.length >= 12, "příklady: " + names.length);
    for (const n of names) {
      const p = loadSampleFile(n);
      const ex = sistemaExport(p);
      const ssm = ex.files[sistemaFileName(p)];
      assert.ok(ssm && ex.files["sistema_predpis.csv"] && ex.files[SISTEMA_FILE], n);
      assert.equal(xmlProblem(ssm), "", n + ": XML");
      assert.ok(ssm.startsWith('<?xml version="1.0"?>\r\n<xmldocdata><tiopf version="2.1"/>'), n + ": hlavička tiOPF");
      assert.deepEqual([...ssm.matchAll(/table_name="(\w+)"/g)].map(m => m[1]), TABLES, n + ": pořadí tabulek");
      const T = Object.fromEntries(TABLES.map(t => [t, rowsOf(ssm, t)]));
      for (const t of TABLES) for (const r of T[t].rows) assert.deepEqual(Object.keys(r), T[t].fields, n + ": " + t + " — řádek má všechna pole");
      const oids = new Set(TABLES.flatMap(t => T[t].rows.map(r => r.oid)));
      assert.equal(oids.size, TABLES.reduce((s, t) => s + T[t].rows.length, 0), n + ": OID unikátní");
      const ids = (t: string) => new Set(T[t].rows.map(r => r.oid));
      for (const r of T.sfops.rows) assert.ok(ids("projectops").has(r.projectopoid));
      for (const r of T.componentops.rows) assert.ok(ids("sfops").has(r.sfopoid));
      for (const r of T.channelops.rows) assert.ok(ids("componentops").has(r.componentopoid));
      for (const r of T.blocops.rows) { assert.ok(ids("channelops").has(r.parentopoid)); assert.ok(ids("dcmeasureops").has(r.dcmeasureopoid)); }
      for (const r of T.elementops.rows) assert.ok(ids("blocops").has(r.parentopoid));
      for (const r of T.ccfmeasureops.rows) { assert.ok(ids("componentops").has(r.componentopoid)); assert.match(r.ccfmid, /^CCFMID-00[1-8]$/); }
      assert.equal(T.channelops.rows.length, T.componentops.rows.length * 3, n + ": 3 kanály na subsystém");
      assert.equal(T.elementops.rows.length, T.blocops.rows.length, n + ": prvek na blok");
      /* hodnoty */
      const sp = proposeSafety(p);
      const live = sp.fns.filter(f => !f.off && f.design && f.risk.plr);
      assert.equal(T.sfops.rows.length, live.length, n + ": počet funkcí");
      live.forEach((f, i) => assert.equal(T.sfops.rows[i].plr, "pl" + f.risk.plr!.toUpperCase(), n + " " + f.id + ": PLr"));
      for (const r of T.componentops.rows) {
        assert.match(r.cat, /^cat(B|1|2|3|4|N)$/);
        assert.match(r.pldet, /^det(Direct|SubItems)$/);
        if (r.pldet === "detDirect") assert.match(r.pfh, /^\d+(,\d+)?E-\d+$/, n + ": PFHd přístroje");
      }
      for (const r of T.blocops.rows) {
        assert.match(r.mttfddet, /^det(Direct|B10D)$/);
        if (r.mttfddet === "detB10D") { assert.ok(+r.b10d > 0 && +r.nop > 0, n + ": B10d a nop"); }
        assert.match(r.dc, /^(0|0,\d+)$/, n + ": DC jako podíl s čárkou");
      }
      /* označení = kusovník (s bezpečnostním modulem) nebo zařízení projektu */
      const tags = new Set(buildBom(p).lines.map(l => l.tag));
      for (const r of [...T.componentops.rows, ...T.blocops.rows]) for (const dt of r.equipmentid.split(", ").filter(x => x && !x.startsWith("+")))
        assert.ok(tags.has(dt), n + ": označení " + dt + " není v kusovníku");
      assert.equal(sistemaSsm(p), ssm, n + ": deterministický výstup");
    }
  });
});

test("SISTEMA: dokument 19 — předpis, porovnání PL a stav ověření; přihlášení s modulem", () => {
  const p = sampleComplex();
  const md = sistemaMd(p);
  const m = sistemaModel(p);
  assert.ok(m.fns.length > 0);
  for (const f of m.fns) assert.ok(md.includes("| " + f.id + " "), "funkce v porovnání: " + f.id);
  assert.ok(/PL SISTEMA/.test(md) && /neověřeno/.test(md) && md.includes(sistemaFileName(p)));
  const csv = sistemaCsv(p);
  assert.ok(csv.startsWith("﻿") && csv.split("\r\n")[0].split(";").length === 16);
  /* bez modulu se sada nemění, s modulem přibude dokument a soubory */
  unregisterSafetyModule();
  assert.ok(!docFiles(p).some(f => f.path === SISTEMA_FILE));
  withSafety(() => {
    assert.ok(docFiles(p).some(f => f.path === SISTEMA_FILE));
    const all = allProjectFiles(p);
    assert.ok(all.some(f => f.save === "sistema_" + sistemaFileName(p)) && all.some(f => f.save === "sistema_predpis.csv"));
    const dup = new Set<string>();
    for (const f of all) { assert.ok(!dup.has(f.save), "duplicitní save: " + f.save); dup.add(f.save); }
  });
});

test("SISTEMA: bez češtiny v cizích jazycích", () => {
  const CZ = /[ěščřžůďťňĚŠČŘŽŮĎŤŇ]/;
  for (const l of ["en", "de", "es", "zh"] as Lang[]) withLang(l, () => {
    for (const mk of [sampleSmall, sampleComplex]) {
      const p = l === "zh" ? withLang("en", mk) : mk();
      for (const [n, b] of Object.entries(sistemaExport(p).files)) {
        const mm = b.match(CZ);
        assert.ok(!mm, l + " / " + n + ": „" + (mm ? b.slice(Math.max(0, mm.index! - 60), mm.index! + 40) : "") + "“");
        assert.ok(!/\{[a-z][A-Za-z]*\}/.test(b), l + " / " + n + ": zástupný znak");
      }
    }
  });
});
