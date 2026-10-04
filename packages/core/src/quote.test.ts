/** Testy nabídky (quote.ts) — node:test, bez závislostí. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sampleSmall } from "./samples.js";
import { buildBom } from "./bom.js";
import { docFiles } from "./docs.js";
import {
  parsePriceList, parseMoney, currencyOf, buildQuote, quoteMd, quoteCsv, round2, QUOTE_DEFAULTS,
  QUOTE_PARAM_INFO, QUOTE_FILE, docPagesEstimate, commissioningDaysEstimate,
} from "./quote.js";

const TEST_DATA = new URL("../test-data/quote/", import.meta.url);   // mimo kořen test-data (tam jsou podklady importu)
const CSV = readFileSync(new URL("cenik_ukazka.csv", TEST_DATA), "utf8");
const RATES = { prog: 950, elec: 850, comm: 1100, km: 12 };

test("ceník: český Excel (středník, úvodní řádky, desetinná čárka, měna ve sloupci i v buňce)", () => {
  const pl = parsePriceList("﻿" + CSV);
  assert.equal(pl.delimiter, ";");
  assert.equal(pl.entries.length, 8, "8 řádků s cenou, „na dotaz“ vynechán");
  const cpu = pl.entries.find(e => e.orderCode.startsWith("6ES7 212"))!;
  assert.equal(cpu.price, 8450);
  assert.equal(cpu.currency, "CZK");
  assert.equal(cpu.leadTime, "2 týdny");
  assert.equal(cpu.row, 5);
  assert.equal(pl.entries.find(e => e.orderCode === "6ES7131-6BH01-0BA0")!.price, 2310.5);
  const k = pl.entries.find(e => e.orderCode === "3RT2016-1BB41")!;
  assert.equal(k.price, 1012.4);
  assert.equal(k.currency, "CZK", "měna z buňky ceny „Kč“");
  assert.equal(pl.entries.find(e => e.orderCode === "574371")!.currency, "EUR");
  assert.ok(pl.warnings.some(w => /na dotaz/.test(w) && /12/.test(w)), "řádek 12 s nečíselnou cenou hlášen");
});

test("ceník: čárka jako oddělovač, uvozovky, anglické záhlaví, měna v záhlaví", () => {
  const txt = 'Order code,Type,Manufacturer,Price [EUR],Lead time\n"6ES7212-1AG50-0XB0","CPU 1212C",Siemens,"1.234,50",3 weeks\nA-1,X,Y,"12,5",\n';
  const pl = parsePriceList(txt);
  assert.equal(pl.delimiter, ",");
  assert.equal(pl.entries.length, 2);
  assert.equal(pl.entries[0].price, 1234.5);
  assert.equal(pl.entries[0].currency, "EUR");
  assert.equal(pl.entries[1].price, 12.5);
  /* TSV */
  const tsv = parsePriceList("kód\tcena\tměna\nABC\t10,25\tEUR\n");
  assert.equal(tsv.delimiter, "\t");
  assert.equal(tsv.entries[0].price, 10.25);
  /* bez záhlaví = nic */
  const none = parsePriceList("a;b;c\n1;2;3\n");
  assert.equal(none.entries.length, 0);
  assert.ok(none.warnings.length);
});

test("parseMoney a currencyOf", () => {
  assert.equal(parseMoney("1 234,50 Kč").value, 1234.5);
  assert.equal(parseMoney("1 234,5").value, 1234.5);
  assert.equal(parseMoney("1,234.50").value, 1234.5);
  assert.equal(parseMoney("€ 99").value, 99);
  assert.equal(parseMoney("1 500,-").value, 1500);
  assert.ok(Number.isNaN(parseMoney("na dotaz").value));
  const amb = parseMoney("1.234");
  assert.equal(amb.value, 1234);
  assert.equal(amb.ambiguous, true);
  assert.equal(currencyOf("Kč"), "CZK");
  assert.equal(currencyOf("eur"), "EUR");
  assert.equal(currencyOf("Cena [EUR]"), "EUR");
  assert.equal(currencyOf(""), "");
});

test("párování: objednací kód, typ + značka, kategorie; nepárované v unpriced", () => {
  const p = sampleSmall();
  const prices = parsePriceList(CSV).entries;
  const q = buildQuote(p, { prices, rates: RATES, fx: { EUR: 24.5 } });
  const by = (id: string) => q.material.find(l => l.bomId === id)!;
  assert.equal(by("-A1:plc_cpu").match, "code");
  assert.equal(by("-A1:plc_cpu").unitPrice, 8450);
  assert.equal(by("-K1:contactor").match, "code");
  assert.equal(by("-B1:pressure_transmitter").match, "type");
  assert.equal(by("-B1:pressure_transmitter").unitPrice, 4210);
  assert.equal(by("-X1:terminal_block").match, "cat");
  assert.equal(by("-X1:terminal_block").total, round2(24 * 18.9));
  assert.equal(by("-H1:pilot_light").match, "cat");
  const v = by("-Y1:valve_solenoid");
  assert.equal(v.match, "code");
  assert.equal(v.srcCurrency, "EUR");
  assert.equal(v.unitPrice, 2751.35, "112,30 EUR × 24,5");
  assert.equal(v.leadTime, "5 dní");
  assert.equal(by("-K0:safety_relay").unitPrice, undefined, "„na dotaz“ = bez ceny");
  assert.ok(q.unpriced.some(u => u.id === "-K0:safety_relay"));
  assert.ok(q.unpriced.some(u => u.id === "-M1:pump"));
  /* karta ET 200SP DI se nepoužije (malý stroj má DI ve vestavěných I/O CPU, sestava hardware.ts) a XYZ-999 nepasuje */
  assert.deepEqual(q.unusedPrices, [6, 13], "ET 200SP DI a XYZ-999 nepasují");
  /* bez kurzu se EUR položka neocení — kurz se nevymýšlí */
  const q2 = buildQuote(p, { prices, rates: RATES });
  assert.equal(q2.material.find(l => l.bomId === "-Y1:valve_solenoid")!.unitPrice, undefined);
  assert.ok(q2.unpriced.some(u => u.id === "-Y1:valve_solenoid" && /EUR/.test(u.reason)));
});

test("součty: přirážka, DPH 21 % a zaokrouhlení na haléře", () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(0.1 + 0.2), 0.3);
  const p = sampleSmall();
  const prices = parsePriceList(CSV).entries;
  const q = buildQuote(p, { prices, rates: RATES, fx: { EUR: 24.5 }, marginPct: 15, vatPct: 21 });
  const c = (x: number) => Math.round(x * 100);
  const mat = q.material.reduce((a, l) => a + (l.total !== undefined ? c(l.total) : 0), 0);
  const lab = q.labor.reduce((a, l) => a + c(l.total!), 0);
  assert.equal(c(q.totals.materialCost), mat);
  assert.equal(c(q.totals.margin), Math.round(mat * 0.15));
  assert.equal(c(q.totals.labor), lab);
  assert.equal(c(q.totals.net), mat + Math.round(mat * 0.15) + lab);
  assert.equal(c(q.totals.vat), Math.round(c(q.totals.net) * 0.21));
  assert.equal(c(q.totals.gross), c(q.totals.net) + c(q.totals.vat));
  assert.equal(q.totals.complete, false, "část materiálu bez ceny");
  /* malý případ s ručně spočítaným výsledkem */
  const one = buildQuote(p, {
    bom: { plat: "siemens", lines: [{ ...buildBom(p).lines[0], qty: 3 }] },
    prices: [{ orderCode: "6ES7212-1AG50-0XB0", type: "", brand: "", cat: "", price: 33.35, currency: "CZK", supplier: "", leadTime: "", row: 2 }],
    params: { hoursBase: 0, hoursPerDevice: { Motor: 0, Ventil: 0, AnalogIn: 0, AnalogOut: 0, DI: 0, DO: 0, Vfd: 0, PosDrive: 0, PropValve: 0 }, hoursPerIo: 0, hoursPerStep: 0,
      hoursPerSafetyFn: 0, hoursPerDocPage: 0, fatHours: 0, hoursPerDay: 0 },
    vatPct: 21,
  });
  assert.equal(one.totals.net, 100.05);
  assert.equal(one.totals.vat, 21.01, "100,05 × 21 % = 21,0105 → 21,01");
  assert.equal(one.totals.gross, 121.06);
  assert.equal(one.totals.complete, true);
});

test("bez ceníku a sazeb se nic nevymyslí", () => {
  const p = sampleSmall();
  const q = buildQuote(p);
  assert.ok(q.material.length > 10);
  assert.ok(q.material.every(l => l.unitPrice === undefined && l.total === undefined && l.match === null));
  assert.ok(q.labor.every(l => l.rate === undefined && l.total === undefined));
  assert.equal(q.unpriced.length, q.material.length + q.labor.length);
  assert.equal(q.totals.net, 0);
  assert.equal(q.totals.gross, 0);
  assert.equal(q.totals.complete, false);
  assert.ok(q.totals.hours > 0, "hodiny se odhadnou i bez sazeb");
  const md = quoteMd(p);
  assert.match(md, /INTERNÍ PODKLAD/);
  assert.match(md, /ceník nenačten/);
  const csv = quoteCsv(p);
  assert.equal(csv.charCodeAt(0), 0xfeff, "BOM pro český Excel");
  const mat = csv.split("\r\n").filter(r => r.startsWith("Materiál;"));
  assert.equal(mat.length, q.material.length);
  for (const r of mat) { const cells = r.split(";"); assert.equal(cells[8], ""); assert.equal(cells[9], ""); }
});

test("odhad hodin: parametry, vysvětlení, úpravy uživatele, cestovné", () => {
  for (const k of Object.keys(QUOTE_DEFAULTS)) {
    const inf = (QUOTE_PARAM_INFO as Record<string, { help: string; label: string }>)[k];
    assert.ok(inf && inf.help.length > 20 && inf.label, "vysvětlení parametru " + k);
  }
  const p = sampleSmall();
  const q = buildQuote(p, { rates: RATES, safetyFns: 2 });
  const io = q.labor.find(l => l.key === "io")!;
  assert.equal(io.qty, p.io.length * QUOTE_DEFAULTS.hoursPerIo);
  assert.equal(io.rateKey, "elec");
  assert.equal(io.total, round2(io.qty * 850));
  assert.equal(q.labor.find(l => l.key === "safety")!.qty, 12);
  assert.equal(q.labor.find(l => l.key === "dev:Motor")!.qty, 1.5);
  assert.equal(q.labor.find(l => l.key === "docs")!.qty, docPagesEstimate(p, 2) * 0.5);
  assert.equal(q.labor.find(l => l.key === "comm")!.qty, commissioningDaysEstimate(p) * 8);
  assert.ok(!q.labor.some(l => l.key.startsWith("travel")), "0 km = bez cestovného");
  assert.equal(q.totals.complete, false, "materiál bez ceníku");
  /* úpravy v projektu i v opts */
  p.quote = { params: { hoursPerIo: 1, hoursPerDevice: { Motor: 4 } as never, travelKm: 140, travelTrips: 2 } };
  const q2 = buildQuote(p, { rates: RATES, safetyFns: 0, params: { commissioningDays: 3 } });
  assert.equal(q2.labor.find(l => l.key === "io")!.qty, p.io.length);
  assert.equal(q2.labor.find(l => l.key === "dev:Motor")!.qty, 4);
  assert.equal(q2.labor.find(l => l.key === "dev:Ventil")!.qty, 1.5, "ostatní třídy výchozí");
  assert.equal(q2.labor.find(l => l.key === "comm")!.qty, 24);
  assert.ok(!q2.labor.some(l => l.key === "safety"));
  const km = q2.labor.find(l => l.key === "travel:km")!;
  assert.equal(km.qty, 560);
  assert.equal(km.total, 560 * 12);
  assert.equal(q2.labor.find(l => l.key === "travel:time")!.qty, round2(560 / 70));
  assert.equal(q2.totals.hours, round2(q2.labor.filter(l => l.unit === "h").reduce((a, l) => a + l.qty, 0)));
});

test("18_nabidka.md jen na volbu (interní podklad)", () => {
  const p = sampleSmall();
  assert.ok(!docFiles(p).some(f => f.path === QUOTE_FILE), "výchozí: ne do dokumentace");
  p.quote = { inDocs: true, rates: RATES, prices: parsePriceList(CSV).entries };
  const f = docFiles(p).find(x => x.path === QUOTE_FILE)!;
  assert.ok(f, "na volbu ano");
  assert.match(f.body, /INTERNÍ PODKLAD/);
  assert.match(f.body, /8\s450,00 CZK/);
});
