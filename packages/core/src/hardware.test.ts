/**
 * Sestava hardwaru (hardware.ts) — jediný zdroj pravdy o modulech: kanály, adresy, kusovník,
 * výkresy, svorkovnice a EPLAN musí říkat totéž; 13 příkladů × 10 platforem.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncIO, modules, validateProject, addrFor, nativeAddr, ensureGuids, PLAT, type Project, type PlatformKey, type Dir } from "./model.js";
import { hwLayout, hwAddr, hwAssign, hwPlatform, HW_VER, HW_DIRS, lxSpecOf, type HwLayout } from "./hardware.js";
import { buildBom } from "./bom.js";
import { svorkyCSV, docIOcsv } from "./docs.js";
import { sheetSVG, svgBlock } from "./drawing.js";
import { eplanCards, eplanTerminals, eplanDevicesCsv } from "./eplan.js";
import { genEplanAml, validateEplan, amlStructure } from "./eplan_aml.js";
import { genFor } from "./codegen.js";
import { lxIoMap } from "./logix.js";
import { sampleSmall, sampleComplex } from "./samples.js";
import { sampleNames, loadSampleFile } from "./exp_util.test.js";

const PLATS = Object.keys(PLAT) as PlatformKey[];
const clone = (p: Project): Project => JSON.parse(JSON.stringify(p));
/** Projekt s platformou hardwaru `plat` (kusovník), adresy přidělené. */
function onPlat(base: Project, plat: PlatformKey): Project {
  const p = clone(base);
  p.bom = { ...(p.bom || {}), plat };
  syncIO(p);
  return p;
}
const isAn = (d: Dir) => d === "AI" || d === "AO";

/** Obsazené bajty oblastí I / Q kanálů sestavy — kolize = dvě položky v jednom bajtu / bitu. */
function collisions(L: HwLayout): string[] {
  const bits = new Map<string, string>(), out: string[] = [];
  for (const m of L.modules) for (const k of m.channels) {
    const a = k.addr, own = m.dt + " " + k.dir + k.no;
    const w = a.match(/^%([IQ])W(\d+)$/), b = a.match(/^%([IQ])(\d+)\.([0-7])$/);
    const keys = w ? [0, 1].flatMap(o => [0, 1, 2, 3, 4, 5, 6, 7].map(x => w[1] + (+w[2] + o) + "." + x))
      : b ? [b[1] + b[2] + "." + b[3]] : [];
    if (!keys.length) out.push("neplatná adresa " + a + " (" + own + ")");
    for (const key of keys) { const o = bits.get(key); if (o && o !== own) out.push(key + ": " + o + " × " + own); bits.set(key, own); }
  }
  return out;
}

test("sestava: příklady × platformy — každý signál právě jeden kanál, bez kolize adres, kanály = katalog", () => {
  for (const n of sampleNames()) {
    const base = loadSampleFile(n);
    for (const plat of PLATS) {
      const p = onPlat(base, plat), L = hwLayout(p, plat), at = n + " / " + plat;
      assert.equal(L.overflow.length, 0, at + ": nic se nevešlo");
      assert.equal(L.ch.size, p.io.length, at + ": každý signál má kanál");
      const used = L.modules.flatMap(m => m.channels.filter(k => k.io));
      assert.equal(used.length, p.io.length, at + ": kanál nese nejvýš jeden signál");
      assert.equal(new Set(used.map(k => k.io)).size, p.io.length, at + ": signál je jen na jednom kanálu");
      for (const [e, k] of L.ch) assert.equal(k.dir, e.dir, at + ": směr kanálu " + e.tag);
      assert.deepEqual(collisions(L), [], at + ": kolize adres (vč. vestavěných I/O)");
      for (const m of L.modules.filter(x => x.kind === "io")) {
        const cat = (m.builtin ? m.opt?.hw?.builtin : m.opt?.hw?.ch) || {};
        for (const d of HW_DIRS) assert.equal(m.channels.filter(k => k.dir === d).length, cat[d] || 0, at + ": " + m.dt + " " + d + " = katalog");
        if (!m.builtin) assert.ok(m.channels.some(k => k.io), at + ": " + m.dt + " bez signálu");
      }
      /* limity racků podle katalogu */
      const cpuHw = L.cpu.opt?.hw;
      if (cpuHw?.slots) for (const [bus, max] of Object.entries(cpuHw.slots)) {
        const n0 = L.stations[0].modules.filter(m => m.kind === "io" && !m.builtin && (m.bus === bus || m.opt?.hw?.also === bus)).length;
        assert.ok(n0 <= max, at + ": lokální rack " + bus + " " + n0 + " ≤ " + max);
      }
      for (const s of L.stations.filter(x => x.remote)) {
        const max = Object.values(s.head.opt?.hw?.slots || {})[0] ?? 0;
        assert.ok(s.modules.filter(m => m.kind === "io").length <= max, at + ": stanice " + s.head.dt + " ≤ " + max + " modulů");
      }
      /* uložené adresy = sestava platformy hardwaru, kód je čte přes addrFor */
      for (const e of p.io) {
        assert.equal(e.addr, hwAddr(p, plat, e), at + ": e.addr = kanál " + e.tag);
        assert.equal(addrFor(plat, e, p), nativeAddr(plat, e.addr, e.dir), at + ": addrFor " + e.tag);
      }
      assert.deepEqual(validateProject(p).filter(i => i.level === "error"), [], at + ": validace");
    }
  }
});

test("sestava: kusovník, výkresy, svorkovnice a EPLAN = táž sestava (příklady × platformy)", () => {
  for (const n of sampleNames()) {
    const base = loadSampleFile(n);
    for (const plat of PLATS) {
      const p = onPlat(base, plat), L = hwLayout(p, plat), at = n + " / " + plat;
      const bom = buildBom(p);
      assert.equal(bom.plat, plat);
      const ios = L.modules.filter(m => m.kind === "io" && !m.builtin);
      /* kusovník: řádky karet = moduly sestavy (skupina × kategorie), CPU a hlavy stanic */
      const plcLines = bom.lines.filter(l => /^plc_(di|do|ai|ao)$/.test(l.cat));
      assert.equal(plcLines.reduce((s, l) => s + l.qty, 0), ios.length, at + ": karet v kusovníku = sestava");
      for (const l of plcLines) {
        const g = ios.filter(m => m.bomTag === l.tag && m.cat === l.cat);
        assert.equal(l.qty, g.length, at + ": " + l.id);
        assert.equal(l.orderCode, g[0].opt?.orderCode || "", at + ": " + l.id + " objednací kód");
      }
      assert.equal(bom.lines.find(l => l.id === "-A1:plc_cpu")!.orderCode, L.cpu.opt?.orderCode || "", at + ": CPU");
      assert.equal(bom.lines.filter(l => l.cat === "plc_coupler").length, L.stations.filter(s => s.remote).length, at + ": hlavy stanic");
      /* výkresy a svorkovnice: skupiny = moduly × směr, každý signál na listu svého modulu */
      const mods = modules(p);
      assert.equal(mods.reduce((s, m) => s + m.ch.length, 0), p.io.length, at + ": skupiny nesou všechny signály");
      for (const m of mods) {
        assert.ok(m.hw && m.ch.length <= (m.cap || 0) && m.ch.length === m.chNo!.length, at + ": skupina " + m.dir + m.idx);
        const svg = sheetSVG(p, m, mods.indexOf(m) + 1);
        for (const e of m.ch) assert.ok(svg.includes(">" + e.tag + "<"), at + ": list " + m.dir + m.idx + " / " + e.tag);
        assert.ok(svg.includes(m.hw!.dt + " · " + m.dir + m.idx), at + ": označení karty na listu");
      }
      assert.ok(svgBlock(p, mods).includes("CPU " + L.cpu.dt));
      assert.equal(svorkyCSV(p).split("\n").length - 1, p.io.length, at + ": svorkovnice");
      assert.equal(docIOcsv(p).split("\n").length - 1, p.io.length, at + ": I/O list");
      const cards = eplanCards(p);
      assert.equal(cards.length, mods.length, at + ": EPLAN karty = skupiny");
      const terms = eplanTerminals(p, cards);
      assert.equal(terms.length, p.io.length, at + ": EPLAN svorky");
      cards.forEach((c, i) => assert.equal(c.mod, mods[i]));
      const dev = eplanDevicesCsv(p, cards);
      for (const m of ios) assert.ok(dev.includes("\r\n" + m.dt + ","), at + ": " + m.dt + " v seznamu zařízení");
      /* EPLAN AML: moduly, kanály a stanice ze sestavy, kontrola bez chyb */
      const aml = genEplanAml(p, { now: new Date(0) });
      const st = amlStructure(aml);
      const chans = st.flatMap(el => el.ifaces.filter(i => i.cls.endsWith("/Channel")));
      assert.equal(chans.length, L.modules.reduce((s, m) => s + m.channels.length, 0), at + ": AML kanály = katalog");
      assert.equal(st.filter(el => el.roles.some(r => r.endsWith("/Device"))).length, L.stations.length + L.drives.length, at + ": AML stanice + servoměniče (uzly sítě)");
      const links = st.flatMap(el => el.links).filter(l => l.name.startsWith("Link_") && !/^Link_(PN_IE_1|IoSystem)_/.test(l.name));
      assert.equal(links.length, p.io.length, at + ": AML link kanál ↔ tag");
      const errs = validateEplan(p).filter(i => i.level === "error");
      assert.deepEqual(errs, [], at + ": validateEplan");
    }
  }
});

test("Siemens: S7-1200 G2 — vestavěné I/O od %I0.0, SM v racku CPU, přebytek do stanice ET 200SP (PROFINET)", () => {
  const big = loadSampleFile("10_vyrobni_hala_linka_rozdelovacu.plcstudio.json");
  const L = hwLayout(big, "siemens");
  assert.equal(L.cpu.opt?.orderCode, "6ES7214-1AH50-0XB0", "větší CPU G2 (10 modulů)");
  const bi = L.modules.find(m => m.builtin)!;
  assert.deepEqual([bi.ch.DI, bi.ch.DO, bi.ch.AI], [14, 10, undefined], "1214C G2: 14 DI / 10 DQ, bez analogů");
  assert.equal(bi.channels[0].addr, "%I0.0");
  const local = L.stations[0].modules.filter(m => m.kind === "io" && !m.builtin);
  assert.ok(local.length <= 10 && local.every(m => m.bus === "s71200g2" && /^6ES72/.test(m.opt!.orderCode!)), "v racku CPU jen signálové moduly S7-1200 G2");
  assert.equal(local[0].slot, 2);
  assert.equal(local[0].channels[0].addr, "%I8.0", "SM ve slotu 2 od %I8.0");
  const et = L.stations.filter(s => s.remote);
  assert.ok(et.length >= 1 && et.every(s => s.head.opt?.orderCode === "6ES7155-6AU02-0BN0" && s.net === "PROFINET" && s.family === "ET200SP"));
  assert.ok(et[0].modules.some(m => m.kind === "acc" && m.cat === "plc_busadapter" && m.slot === 127));
  assert.equal(et[0].modules.find(m => m.kind === "acc" && m.cat === "plc_server")!.slot, et[0].modules.filter(m => m.kind === "io").length + 1, "server modul za poslední kartou");
  assert.ok(et[0].modules.filter(m => m.kind === "io").every(m => m.bus === "et200sp" && /^6ES713/.test(m.opt!.orderCode!)), "ET 200SP karty jen ve stanici IM");
  const bom = buildBom(big);
  assert.ok(bom.lines.some(l => l.cat === "plc_busadapter" && l.orderCode === "6ES7193-6AR00-0AA0"));
  assert.equal(bom.lines.find(l => l.cat === "plc_baseunit_first" && l.tag === "-A10")!.qty, 1);
  assert.equal(bom.lines.find(l => l.cat === "plc_baseunit" && l.tag === "-A10")!.qty, et[0].modules.filter(m => m.kind === "io").length - 1);
  /* AML: stanice ET 200SP jako zařízení IO systému CPU (TIA V18) */
  const aml = genEplanAml(big, { now: new Date(0) });
  assert.ok(aml.includes("System:Device.ET200SP") && aml.includes("System:Rack.ET200SP") && aml.includes("<Value>HeadModule</Value>"));
  const st = amlStructure(aml);
  const project = st.find(el => el.depth === 0)!;
  assert.ok(project.links.some(l => l.name.startsWith("Link_IoSystem_") && l.b.endsWith(":LogicalEndPoint_IoSystem")), "rozhraní stanice ↔ IO systém CPU");
  const builtin = st.find(el => el.name === "DI 14/DQ 10")!;
  assert.ok(builtin && builtin.attrs.BuiltIn.value === "true" && builtin.attrs.Address.sub.length === 2, "vestavěné I/O jako BuiltIn podmodul CPU (TIA V17)");
  /* malý stroj: 1212C a vše v racku */
  const small = loadSampleFile("01_pasovy_dopravnik_vyhazovac.plcstudio.json");
  const S = hwLayout(small, "siemens");
  assert.equal(S.cpu.opt?.orderCode, "6ES7212-1AG50-0XB0");
  assert.equal(S.stations.length, 1);
  assert.ok(small.io.filter(e => e.dir === "DI").every(e => /^%I0\.[0-7]$/.test(e.addr)), "7 DI ve vestavěných I0.0–I0.7");
});

test("ostatní platformy: vestavěné I/O a čísla podle výrobce", () => {
  const p = loadSampleFile("05_paletizacni_bunka_PB-05.plcstudio.json");
  const fx = hwLayout(p, "mitsubishi");
  const xs = p.io.filter(e => e.dir === "DI").map(e => addrFor("mitsubishi", e, p));
  assert.equal(xs[0], "X0");
  assert.ok(xs.includes("X17") && xs.includes("X20") && !xs.some(x => /[89]/.test(x)), "FX5U: vestavěné X0–X17, rozšíření od X20 (osmičkově)");
  assert.equal(fx.modules.find(m => m.builtin)!.ch.AO, 1, "FX5U: vestavěný AO");
  const rw = hwLayout(p, "rockwell");
  assert.equal(rw.modules.some(m => m.builtin), false, "CompactLogix 5380: bez vestavěných I/O");
  assert.equal(rw.cpu.slot, 0);
  const sp = lxIoMap(p).spec;
  assert.equal(sp.get(p.io.find(e => e.dir === "DI")!.key), "Local:1:I.Pt00.Data");
  const om = hwLayout(p, "omron");
  assert.deepEqual([om.modules.find(m => m.builtin)!.ch.DI, om.modules.find(m => m.builtin)!.ch.DO], [14, 10], "NX1P2-9024DT1: 14 / 10");
  const un = hwLayout(p, "unitronics");
  const uia = un.modules.filter(m => m.opt?.orderCode === "UIA-0402N");
  assert.ok(uia.length && uia.every(m => m.ch.AI === 4 && m.ch.AO === 2), "UIA-0402N: 4 AI + 2 AO v jednom modulu");
  assert.equal(buildBom(onPlat(p, "unitronics")).lines.filter(l => l.orderCode === "UIA-0402N").reduce((s, l) => s + l.qty, 0), uia.length, "kombinovaný modul se nepočítá dvakrát");
  /* vzdálená stanice Rockwell: alias RIO<n>:<slot> */
  const big = loadSampleFile("10_vyrobni_hala_linka_rozdelovacu.plcstudio.json");
  big.bom = { brand: { "plc_cpu@rockwell": "Allen-Bradley (Rockwell Automation) · 5069-L306ER" } };
  const R = hwLayout(big, "rockwell");
  assert.equal(R.cpu.opt?.orderCode, "5069-L306ER", "volba CPU uživatele platí");
  assert.equal(R.stations[0].modules.length, 8, "L306ER: 8 lokálních modulů");
  const rem = R.stations[1].modules[0].channels[0];
  assert.match(lxSpecOf(rem), /^RIO1:1:[IO]\.(Pt|Ch)00\.Data$/);
});

test("validateProject: projekt se do platformy nevejde → chyba", () => {
  const p = sampleSmall();
  p.platforms = ["mitsubishi"];
  /* 300 digitálních vstupů: FX5U pojme 256 bodů a katalog nemá vzdálené I/O pro iQ-F */
  for (let i = 0; i < 300; i++) p.devices.push({ id: 1000 + i, name: "S" + (100 + i), cls: "DI", desc: "", opt: {}, unit: "", rmin: 0, rmax: 100 });
  syncIO(p);
  const L = hwLayout(p, "mitsubishi");
  assert.ok(L.overflow.length > 0);
  const err = validateProject(p).filter(i => i.level === "error" && i.msg.includes("nevejde"));
  assert.equal(err.length, 1, "jedno hlášení za platformu");
  assert.ok(L.overflow.every(e => e.addr === ""), "signál bez kanálu nemá adresu");
  assert.ok(Object.values(genFor(p, "mitsubishi")).length > 0, "generátor nespadne");
});

test("adresy: ruční volba kanálu se respektuje, cizí adresa zůstane s upozorněním, starší projekt se přidělí znovu", () => {
  const p = sampleComplex();
  syncIO(p);
  assert.deepEqual(p.hw, { plat: hwPlatform(p), ver: HW_VER });
  const di = p.io.filter(e => e.dir === "DI");
  /* připnutí: druhý DI na volný kanál karty SM 1221 (23 DI = 8 vestavěných + 15 na kartě, poslední volný I9.7) */
  di[1].addr = "%I9.7";
  syncIO(p);
  assert.equal(di[1].addr, "%I9.7");
  assert.equal(hwLayout(p).ch.get(di[1])!.no, 15);
  assert.equal(new Set(p.io.map(e => e.addr)).size, p.io.length, "bez duplicit");
  /* duplicitní ruční adresa zůstane a validace ji hlásí jako chybu (jako dřív) */
  const dupAt = di[4].addr;
  di[3].addr = dupAt;
  syncIO(p);
  assert.equal(di[3].addr, dupAt);
  assert.ok(validateProject(p).some(i => i.level === "error" && i.where === dupAt), "duplicitní adresa = chyba");
  assert.equal(hwLayout(p).ch.size, p.io.length, "i tak má každý signál kanál ve výkresech");
  di[3].addr = "";
  syncIO(p);
  /* cizí adresa (není kanálem sestavy) — kód ji použije, validace upozorní */
  di[2].addr = "%I40.3";
  syncIO(p);
  assert.equal(di[2].addr, "%I40.3");
  assert.equal(addrFor("siemens", di[2], p), "%I40.3");
  assert.ok(validateProject(p).some(i => i.level === "warn" && i.where === di[2].tag && i.msg.includes("%I40.3")));
  /* starší projekt (bez značky prj.hw): adresy dřívějšího dělení se přidělí podle sestavy */
  const old = sampleComplex();
  old.io.forEach((e, i) => { e.addr = e.dir === "DI" ? "%I" + (i >> 3) + "." + (i & 7) : e.addr; });
  delete old.hw;
  syncIO(old);
  assert.equal((old as Project).hw?.ver, HW_VER);
  assert.ok(old.io.every(e => e.addr === hwAddr(old, "siemens", e)));
  /* přečíslování (force, jako tlačítko „Přečíslovat adresy od nuly“) zahodí připnutí */
  for (const e of p.io) e.addr = "";
  hwAssign(p, true);
  assert.equal(di[1].addr, "%I0.1");
  /* změna platformy hardwaru = adresy jiné sestavy se přidělí znovu */
  p.bom = { plat: "rockwell" };
  syncIO(p);
  assert.equal(p.hw?.plat, "rockwell");
  assert.ok(p.io.every(e => e.addr === hwAddr(p, "rockwell", e)));
});

test("GUID modulů: klíč stanice.slot, migrace z dřívějších klíčů DI1…", () => {
  const p = sampleComplex();
  syncIO(p);
  const L = hwLayout(p);
  const own = L.modules.filter(m => (m.kind === "io" && !m.builtin) || m.kind === "head");
  assert.ok(own.length > 0 && own.every(m => /^S\d+\.\d+$/.test(m.key) && p.moduleGuids![m.key] === m.guid));
  /* dřívější klíče: n-tá karta téhož směru převezme GUID */
  const q = sampleComplex();
  syncIO(q);
  const first = hwLayout(q).modules.find(m => m.kind === "io" && !m.builtin && m.cat === "plc_ai")!;
  q.moduleGuids = { AI1: "11111111-2222-4333-8444-555555555555", DI9: "66666666-2222-4333-8444-555555555555" };
  assert.equal(ensureGuids(q), true);
  assert.equal(q.moduleGuids![first.key], "11111111-2222-4333-8444-555555555555");
  assert.ok(!Object.keys(q.moduleGuids!).some(k => /^(DI|DO|AI|AO)\d+$/.test(k)), "dřívější klíče odstraněny");
  assert.equal(ensureGuids(q), false, "podruhé už nic");
});
