/**
 * PLCdesk — pneumatické schéma (ISO 1219-1, návrh). Stejná geometrie jako ostatní výkresy (ops → SVG + DXF R12).
 * Nic se nevymýšlí: úprava vzduchu, lištu, rozváděče, válce a snímače přebírá z kusovníku (`buildBom`);
 * typ funkce ventilu, tlak, světlost hadic a přiřazení portů 2 / 4 zadání neobsahuje → „doplní projektant“.
 * Rozváděč se kreslí jako 5/2 monostabilní jen tehdy, když to nese typ / popis / poznámka řádku kusovníku.
 * Vazba rozváděč → válec = tatáž jako `actuates` v cad.ts (díly téhož zařízení: `valve_solenoid` → `cylinder`).
 */
import { Project, devById } from "./model.js";
import { buildBom, BomLine, valveCylinder } from "./bom.js";
import { trx } from "./i18n.js";
import { SheetOps, SheetMeta, opsToSVG, opsToDXF } from "./drawing.js";
import { makeCtx, frame, hasBand, cut, Ctx, ioRefsOf, ioRefLines } from "./power_sheet.js";

export interface PneuSheet { kind: "pneu"; base: string; title: string; svg: string; dxf: string; }

interface Circuit { devId: number; name: string; valve: BomLine; cyl?: BomLine; sw: BomLine[]; }

const PER_PAGE = 4, X0 = 200, DX = 190;
const TBD = () => trx("doplní projektant");

/** Rozváděč nese údaj 5/2 monostabilní (cívka + pružina)? Jinak se funkce nedomýšlí. */
export function valveIs52Mono(l: BomLine): boolean {
  const t = [l.type, l.desc, l.note, l.item].join(" ");
  return /\b5\s*\/\s*2\b/.test(t) && /monostab|jednostran|single[- ]?solenoid|spring[- ]?return|pružin|einseitig|federr/i.test(t);
}

export function pneuCircuits(prj: Project, lines: BomLine[]): Circuit[] {
  const out: Circuit[] = [];
  const seen = new Set<number>();
  for (const v of lines) {
    if (v.cat !== "valve_solenoid" || v.devId === undefined || seen.has(v.devId)) continue;
    seen.add(v.devId);
    const ls = lines.filter(l => l.devId === v.devId);
    out.push({ devId: v.devId, name: devById(prj, v.devId)?.name || "", valve: v,
      cyl: valveCylinder(ls).cyl, sw: ls.filter(l => l.cat === "cylinder_switch") });
  }
  return out;
}

/** Rozváděč 5/2 (dvě pole), cívka vpravo, pružina vlevo; portů 1 (nahoře uprostřed), 2/4 dole, 3/5 dole krajní. Vrací y dolního okraje. */
function valve52(c: Ctx, cx: number, y: number): number {
  const w = 28, h = 36;
  c.Re(cx - w, y, w, h, "s"); c.Re(cx, y, w, h, "s");
  /* levé pole: přímé a zkřížené cesty (náznak 5/2) */
  c.Ln(cx - 20, y + h, cx - 20, y + 4, "w"); c.Ln(cx - 20, y + 4, cx - 23, y + 10, "w"); c.Ln(cx - 20, y + 4, cx - 17, y + 10, "w");
  c.Ln(cx - 8, y + 4, cx - 8, y + h, "w");
  c.Ln(cx + 8, y + h, cx + 8, y + 4, "w"); c.Ln(cx + 20, y + 4, cx + 20, y + h, "w");
  /* cívka (vpravo) a pružina (vlevo) */
  c.Re(cx + w, y + 8, 14, 20, "s"); c.Ln(cx + w, y, cx + w, y, "w");
  c.Ln(cx + w + 3, y + 10, cx + w + 11, y + 26, "s");
  c.Ln(cx - w - 14, y + 18, cx - w, y + 18, "s");
  for (let i = 0; i < 4; i++) c.Ln(cx - w - 14 + i * 3.5, y + 14 + (i % 2) * 8, cx - w - 14 + (i + 1) * 3.5, y + 14 + ((i + 1) % 2) * 8, "w");
  return y + h;
}

function silencer(c: Ctx, x: number, y: number): void {
  c.Ln(x, y, x, y + 8); c.Ln(x - 5, y + 8, x + 5, y + 8); c.Ln(x - 5, y + 8, x, y + 16); c.Ln(x + 5, y + 8, x, y + 16);
}

export function pneuSheetOps(prj: Project, page: number, total: number, cs: Circuit[], lines: BomLine[], first: boolean, meta?: SheetMeta): SheetOps {
  const W = 980, H = 640 + hasBand(prj, meta);
  const c = makeCtx(W, H);
  frame(c, prj, trx("Pneumatické schéma"), trx("Pneumatické schéma"), page, total, meta,
    { warn: trx("Návrh — ověří konstruktér pneumatiky"), hint: trx("Tlak, světlost hadic a typ funkce ventilů zadání neobsahuje — doplní projektant. Označení podle kusovníku (IEC 81346).") });
  const { Ln, Tx, Re } = c;
  const busY = 196, io = ioRefsOf(prj);
  /* úprava vzduchu: přívod → uzávěr -QM1 → filtr-regulátor -HQ1 → (-YS1) → lišta -WP1 */
  const by = (cat: string) => lines.find(l => l.cat === cat);
  const chain = [by("air_shutoff"), by("air_prep"), by("safety_valve")].filter((l): l is BomLine => !!l);
  if (first) {
    let x = 70;
    Tx(40, 112, trx("Přívod stlačeného vzduchu — tlak doplní projektant"), { k: "b", size: 10 });
    Ln(x - 20, 150, x, 150);
    for (const l of chain) {
      Ln(x, 150, x + 10, 150);
      if (l.cat === "air_shutoff") { Ln(x + 10, 140, x + 10, 160); Ln(x + 30, 140, x + 30, 160); Ln(x + 10, 140, x + 30, 160, "s"); Ln(x + 10, 160, x + 30, 140, "s"); }
      else if (l.cat === "air_prep") { Ln(x + 10, 150, x + 20, 138); Ln(x + 20, 138, x + 30, 150); Ln(x + 30, 150, x + 20, 162); Ln(x + 20, 162, x + 10, 150); Ln(x + 12, 150, x + 28, 150, "r0"); }
      else { Re(x + 10, 138, 20, 24, "s"); Tx(x + 20, 154, "3/2", { anchor: "middle", size: 8 }); }
      Ln(x + 30, 150, x + 40, 150);
      Tx(x + 20, 176, l.tag, { anchor: "middle", k: "b", size: 10 });
      Tx(x + 20, 188, cut(l.type, 14), { anchor: "middle", k: "m", size: 8 });
      x += 100;
    }
  } else Tx(40, 112, trx("Pokračování z listu 1"), { k: "m", size: 9 });
  const wp = by("valve_manifold");
  const busEnd = X0 + DX * Math.max(0, cs.length - 1) + 60;
  Ln(60, busY, busEnd, busY, "w");
  Tx(64, busY - 6, "P", { size: 9, k: "m" });
  if (wp) Tx(busEnd - 6, busY - 8, wp.tag + " " + cut(wp.type, 24), { anchor: "end", k: "b", size: 9 });
  if (first && chain.length) Ln(70 + 100 * chain.length - 60, 150, 70 + 100 * chain.length - 60, busY, "w");
  cs.forEach((ci, i) => {
    const cx = X0 + i * DX, y0 = 232;
    c.setDev(ci.devId);
    const mono = valveIs52Mono(ci.valve);
    let yb: number;
    if (mono) {
      yb = valve52(c, cx, y0);
      Ln(cx - 8, busY, cx - 8, y0, "w");                            // port 1 (tlak)
      Tx(cx - 8, y0 - 3, "1", { anchor: "middle", size: 8, k: "m" });
      Ln(cx - 20, yb, cx - 20, yb + 14, "w"); Tx(cx - 24, yb + 12, "5", { anchor: "end", size: 8, k: "m" }); silencer(c, cx - 20, yb + 14);
      Ln(cx + 20, yb, cx + 20, yb + 14, "w"); Tx(cx + 24, yb + 12, "3", { size: 8, k: "m" }); silencer(c, cx + 20, yb + 14);
      Ln(cx - 8, yb, cx - 8, 330, "w"); Tx(cx - 12, yb + 10, "4", { anchor: "end", size: 8, k: "m" });
      Ln(cx + 8, yb, cx + 8, 330, "w"); Tx(cx + 12, yb + 10, "2", { size: 8, k: "m" });
    } else {
      Re(cx - 28, y0, 56, 36, "chip");
      Tx(cx, y0 + 16, "?", { anchor: "middle", size: 12, k: "b" });
      Tx(cx, y0 + 29, "1 2 3 4 5", { anchor: "middle", size: 7, k: "m" });
      yb = y0 + 36;
      Ln(cx - 8, busY, cx - 8, y0, "w");
      Ln(cx - 8, yb, cx - 8, 330, "w"); Ln(cx + 8, yb, cx + 8, 330, "w");
    }
    Tx(cx - 34, y0 - 14, ci.valve.tag + " " + trx("rozváděč"), { k: "b", size: 10 });
    Tx(cx - 34, y0 - 3, cut(ci.valve.type, 14), { k: "m", size: 8 });
    if (!mono) { Tx(cx + 34, y0 + 12, trx("funkce ventilu:"), { size: 7, k: "m" }); Tx(cx + 34, y0 + 21, TBD(), { size: 7, k: "m" }); }
    /* válec (dvojčinný) — svisle, přípoje nahoře a dole */
    if (ci.cyl && ci.cyl.cat === "cylinder") {
      Re(cx - 16, 330, 32, 70, "s"); Ln(cx - 16, 352, cx + 16, 352); Ln(cx, 352, cx, 420, "w"); Ln(cx - 8, 420, cx + 8, 420, "w");
      Tx(cx + 22, 346, ci.cyl.tag + " " + trx("válec"), { k: "b", size: 10 }); Tx(cx + 22, 358, cut(ci.cyl.type, 14), { k: "m", size: 8 });
    } else if (ci.cyl) {
      Re(cx - 24, 330, 48, 40, "chip"); Tx(cx, 354, cut(ci.cyl.item, 10), { anchor: "middle", size: 8 });
      Tx(cx + 30, 346, ci.cyl.tag + " " + trx("chapadlo"), { k: "b", size: 10 });
    } else Tx(cx - 20, 346, trx("válec: není v kusovníku"), { k: "m", size: 8 });
    let sy = 372;
    for (const s of ci.sw) { Tx(cx + 22, sy + 16, s.tag + " " + trx("snímač polohy"), { size: 9 }); Tx(cx + 22, sy + 27, cut(s.type, 14), { k: "m", size: 7 }); sy += 22; }
    Tx(cx, 452, cut(ci.name, 16), { anchor: "middle", k: "b", size: 9 });
    Tx(cx, 466, trx("porty 2 / 4: přiřazení ověřit"), { anchor: "middle", k: "m", size: 7 });
    Tx(cx, 477, trx("Ø hadic:") + " " + TBD(), { anchor: "middle", k: "m", size: 7 });
    ioRefLines(io, ci.devId, ["DO"], trx("cívka:"), 1, 34).concat(ioRefLines(io, ci.devId, ["DI"], trx("snímač:"), 3, 34))
      .forEach((t, j) => Tx(cx, 490 + j * 10, t, { anchor: "middle", k: "m", size: 7 }));
    c.setDev(undefined);
  });
  Tx(40, 560, trx("Symboly dle ISO 1219-1: rozváděč 5/2 s cívkou a pružinou, dvojčinný válec, filtr-regulátor, uzávěr, tlumič; porty 1 / 2 / 3 / 4 / 5."), { k: "m", size: 9 });
  return { W, H, O: c.O };
}

/** Listy pneumatického schématu (prázdné pole, když kusovník nemá žádný rozváděč `valve_solenoid`). */
export function pneuSheets(prj: Project, meta?: SheetMeta): PneuSheet[] {
  const lines = buildBom(prj).lines;
  const cs = pneuCircuits(prj, lines);
  if (!cs.length) return [];
  const n = Math.ceil(cs.length / PER_PAGE), out: PneuSheet[] = [];
  const label = trx("Pneumatické schéma");
  for (let i = 0; i < n; i++) {
    const sh = pneuSheetOps(prj, i + 1, n, cs.slice(i * PER_PAGE, (i + 1) * PER_PAGE), lines, i === 0, meta);
    out.push({ kind: "pneu", base: "pneu_schema_" + (i + 1), title: label + " " + (i + 1) + "/" + n, svg: opsToSVG(sh, label), dxf: opsToDXF(sh) });
  }
  return out;
}
