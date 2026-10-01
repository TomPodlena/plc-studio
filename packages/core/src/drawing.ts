/**
 * PLC Studio — výkresy: jedna geometrie (ops) renderovaná do SVG (náhled)
 * i DXF R12 (EPLAN / AutoCAD / LibreCAD).
 * Konvence: rámeček s mřížkovými referencemi, popisové pole, značení -M1
 * (IEC 81346), čísla vodičů -W1xx, NC/NO kontakty (IEC 60617).
 */
import { Project, IoModule, Device, CLS, PLAT, devById, modules, esc, stripDia } from "./model.js";

/** `io` = klíč signálu, ke kterému prvek patří (interaktivní náhledy; DXF ho ignoruje). */
type Ref = { io?: string };
export type Op =
  | ({ t: "l"; x1: number; y1: number; x2: number; y2: number; k: string } & Ref)
  | ({ t: "c"; cx: number; cy: number; r: number } & Ref)
  | ({ t: "r"; x: number; y: number; w: number; h: number; k: string } & Ref)
  | ({ t: "t"; x: number; y: number; s: string; size: number; anchor: string; k: string } & Ref);

export interface SheetOps { W: number; H: number; O: Op[]; }

export interface SheetMeta { projectName: string; date: string; }

function todayCz(): string { return new Date().toLocaleDateString("cs-CZ"); }

export function sheetOps(prj: Project, mod: IoModule, xnum: number, page: number, total: number, meta?: SheetMeta): SheetOps {
  const rows = mod.ch.length, rh = 40, top = 96;
  const W = 980, H = top + rows * rh + 104;
  const O: Op[] = [];
  let cur: string | undefined;                     // signál právě kresleného kanálu
  const ref = (): Ref => cur ? { io: cur } : {};
  const Ln = (x1: number, y1: number, x2: number, y2: number, k?: string) => O.push({ t: "l", x1, y1, x2, y2, k: k || "w", ...ref() });
  const Ci = (cx: number, cy: number, r: number) => O.push({ t: "c", cx, cy, r, ...ref() });
  const Re = (x: number, y: number, w: number, h: number, k?: string) => O.push({ t: "r", x, y, w, h, k: k || "s", ...ref() });
  const Tx = (x: number, y: number, s: unknown, o?: Partial<{ size: number; anchor: string; k: string }>) =>
    O.push(Object.assign({ t: "t" as const, x, y, s: String(s), size: 11, anchor: "start", k: "t" }, o || {}, ref()));

  const pname = meta?.projectName ?? prj.meta.name;
  const date = meta?.date ?? todayCz();

  /* rámeček s mřížkovými referencemi */
  Re(8, 8, W - 16, H - 16, "f"); Re(26, 26, W - 52, H - 52, "f");
  for (let i = 1; i < 8; i++) { const x = 26 + (W - 52) / 8 * i; Ln(x, 8, x, 26, "f"); Ln(x, H - 26, x, H - 8, "f"); }
  for (let i = 0; i < 8; i++) Tx(26 + (W - 52) / 8 * (i + 0.5), 20, i + 1, { anchor: "middle", k: "m", size: 9 });
  const nR = Math.max(2, Math.round((H - 52) / 140));
  for (let i = 1; i < nR; i++) { const y = 26 + (H - 52) / nR * i; Ln(8, y, 26, y, "f"); Ln(W - 26, y, W - 8, y, "f"); }
  for (let i = 0; i < nR; i++) Tx(17, 26 + (H - 52) / nR * (i + 0.5) + 3, String.fromCharCode(65 + i), { anchor: "middle", k: "m", size: 9 });

  /* popisové pole */
  const tx = W - 26 - 420, ty = H - 26 - 52;
  Re(tx, ty, 420, 52, "f"); Ln(tx, ty + 26, tx + 420, ty + 26, "f"); Ln(tx + 180, ty, tx + 180, ty + 52, "f"); Ln(tx + 330, ty, tx + 330, ty + 52, "f");
  Tx(tx + 7, ty + 10, "Projekt", { k: "m", size: 8 }); Tx(tx + 7, ty + 22, (pname || "—").slice(0, 32), { k: "b", size: 9 });
  Tx(tx + 187, ty + 10, "Výkres", { k: "m", size: 8 }); Tx(tx + 187, ty + 22, "Zapojení " + mod.dir + mod.idx + " · X" + xnum, { size: 9 });
  Tx(tx + 337, ty + 10, "List", { k: "m", size: 8 }); Tx(tx + 337, ty + 22, page + " / " + total, { size: 9 });
  Tx(tx + 7, ty + 36, "Kreslil", { k: "m", size: 8 }); Tx(tx + 7, ty + 48, "PLC Studio (návrh k revizi)", { size: 9 });
  Tx(tx + 187, ty + 36, "Datum", { k: "m", size: 8 }); Tx(tx + 187, ty + 48, date, { size: 9 });
  Tx(tx + 337, ty + 36, "Rev", { k: "m", size: 8 }); Tx(tx + 337, ty + 48, "0.1", { size: 9 });

  /* potenciály a karta PLC */
  const yEnd = top + rows * rh - 12;
  const wBase = { DI: 101, DO: 201, AI: 301, AO: 401 }[mod.dir];
  const isIn = (mod.dir === "DI" || mod.dir === "AI");
  if (isIn) {
    Ln(80, top - 28, 80, yEnd, "r"); Tx(80, top - 36, "L+ (24 V DC)", { anchor: "middle", k: "b", size: 10 });
    Re(710, top - 28, 200, rows * rh + 8, "chip"); Tx(810, top - 36, "PLC · " + mod.dir + mod.idx, { anchor: "middle", k: "b", size: 10 });
  } else {
    Re(46, top - 28, 200, rows * rh + 8, "chip"); Tx(146, top - 36, "PLC · " + mod.dir + mod.idx, { anchor: "middle", k: "b", size: 10 });
    Ln(886, top - 28, 886, yEnd, "r0"); Tx(886, top - 36, "M (0 V)", { anchor: "middle", k: "b", size: 10 });
  }

  /* kanály */
  mod.ch.forEach((e, i) => {
    cur = e.key;
    const y = top + i * rh + 12;
    const d = devById(prj, e.devId) || { name: "", desc: "" };
    const wn = "-W" + (wBase + i);
    if (mod.dir === "DI") {
      Ln(80, y, 300, y);
      Ln(300, y, 324, y - 13, "s");                       // pohyblivý kontakt (IEC 60617)
      if (e.nc) Ln(324, y, 324, y - 11, "s");             // doraz = rozpínací kontakt
      Ln(324, y, 678, y);
      Tx(298, y - 17, "-" + (d.name || ""), { k: "b", size: 10 }); Tx(340, y - 6, e.tag, { size: 10 });
      Tx(140, y - 6, (d.desc || e.cmt || "").slice(0, 25), { k: "m", size: 9 });
      Tx(500, y + 12, wn, { k: "m", size: 9 });
      Ci(686, y, 4); Tx(670, y + 14, "X" + xnum + ":" + (i + 1), { anchor: "end", k: "m", size: 9 });
      Tx(720, y + 3, mod.dir + " " + i + "  " + e.addr, { k: "m", size: 9 });
    } else if (mod.dir === "AI") {
      Ln(80, y, 262, y);
      Re(262, y - 12, 96, 24); Tx(310, y + 3, "-" + (d.name || "B?"), { anchor: "middle", k: "b", size: 10 });
      Ln(358, y, 678, y);
      Tx(140, y - 6, (d.desc || "").slice(0, 17), { k: "m", size: 9 });
      Tx(380, y - 6, e.tag, { size: 10 }); Tx(380, y + 12, "4–20 mA · " + wn, { k: "m", size: 9 });
      Ci(686, y, 4); Tx(670, y + 14, "X" + xnum + ":" + (i + 1), { anchor: "end", k: "m", size: 9 });
      Tx(720, y + 3, "AI " + i + "  " + e.addr, { k: "m", size: 9 });
    } else if (mod.dir === "DO") {
      Tx(54, y + 3, "DO " + i + "  " + e.addr, { k: "m", size: 9 });
      Ci(254, y, 4); Tx(266, y + 14, "X" + xnum + ":" + (i + 1), { k: "m", size: 9 });
      Ln(258, y, 560, y);
      Re(560, y - 9, 26, 18);                              // cívka/zátěž (IEC: obdélník)
      Tx(573, y - 14, "-" + (d.name || ""), { anchor: "middle", k: "b", size: 10 });
      Ln(586, y, 886, y);
      Tx(276, y - 6, e.tag, { size: 10 }); Tx(430, y + 12, wn, { k: "m", size: 9 });
      Tx(610, y + 14, (d.desc || e.cmt || "").slice(0, 24), { k: "m", size: 9 });
    } else {
      Tx(54, y + 3, "AO " + i + "  " + e.addr, { k: "m", size: 9 });
      Ci(254, y, 4); Tx(266, y + 14, "X" + xnum + ":" + (i + 1), { k: "m", size: 9 });
      Ln(258, y, 540, y);
      Re(540, y - 12, 116, 24); Tx(598, y + 3, "-" + (d.name || "U?"), { anchor: "middle", k: "b", size: 10 });
      Ln(656, y, 886, y);
      Tx(276, y - 6, e.tag, { size: 10 }); Tx(400, y + 12, "0/4–20 mA · 0–10 V · " + wn, { k: "m", size: 9 });
    }
  });
  cur = undefined;
  if (mod.dir === "DI") Tx(80, yEnd + 16, "Kontakty: šikmá páka s dorazem = NC (bezpečnostní prvky), bez dorazu = NO — dle sloupce NC v I/O.", { k: "m", size: 9 });
  if (mod.dir === "AI") Tx(80, yEnd + 16, "Dvouvodičové zapojení 4–20 mA; pro 0–10 V třívodičově (L+, signál, M).", { k: "m", size: 9 });
  return { W, H, O };
}

/** Render ops do SVG; barvy přes CSS proměnné stránky (téma). */
export function opsToSVG(sh: SheetOps, label: string): string {
  const strokeFor = (o: { k?: string }) =>
    o.k === "f" ? "var(--line, #999)" : o.k === "r" ? "var(--warn, #b45309)" : o.k === "r0" ? "var(--muted, #777)" : "currentColor";
  let s = "";
  for (const o of sh.O) {
    const io = o.io ? ' data-io="' + esc(o.io) + '"' : "";
    if (o.t === "l") s += '<line' + io + ' x1="' + o.x1 + '" y1="' + o.y1 + '" x2="' + o.x2 + '" y2="' + o.y2 + '" stroke="' + strokeFor(o) + '" stroke-width="' + ((o.k === "r" || o.k === "r0") ? 2 : (o.k === "f" ? 1 : 1.2)) + '"/>';
    else if (o.t === "c") s += '<circle' + io + ' cx="' + o.cx + '" cy="' + o.cy + '" r="' + o.r + '" fill="none" stroke="currentColor" stroke-width="1.2"/>';
    else if (o.t === "r") s += '<rect' + io + ' x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h + '" fill="' + (o.k === "chip" ? "var(--chip, #eee)" : "none") + '" stroke="' + (o.k === "chip" || o.k === "f" ? "var(--line, #999)" : "currentColor") + '" stroke-width="' + (o.k === "f" ? 1 : 1.2) + '"/>';
    else s += '<text' + io + ' x="' + o.x + '" y="' + o.y + '" text-anchor="' + (o.anchor || "start") + '" style="font-family:ui-monospace,monospace;font-size:' + o.size + 'px;fill:' + (o.k === "m" ? "var(--muted, #777)" : "currentColor") + (o.k === "b" ? ";font-weight:600" : "") + '">' + esc(o.s) + '</text>';
  }
  return '<svg role="img" aria-label="' + esc(label) + '" viewBox="0 0 ' + sh.W + ' ' + sh.H + '" style="max-width:100%;height:auto" width="' + sh.W + '" xmlns="http://www.w3.org/2000/svg">' + s + '</svg>';
}

/** Render ops do DXF R12 (ENTITIES only; texty bez diakritiky kvůli kódovým stránkám CAD). */
export function opsToDXF(sh: SheetOps): string {
  const H = sh.H, out: Array<string | number> = [];
  const layer = (k?: string) => k === "f" ? "RAMECEK" : (k === "r" || k === "r0") ? "POTENCIALY" : (k === "chip") ? "PLC" : "SCHEMA";
  out.push("0", "SECTION", "2", "ENTITIES");
  for (const o of sh.O) {
    if (o.t === "l") out.push("0", "LINE", "8", layer(o.k), "10", o.x1, "20", H - o.y1, "30", 0, "11", o.x2, "21", H - o.y2, "31", 0);
    else if (o.t === "c") out.push("0", "CIRCLE", "8", "SCHEMA", "10", o.cx, "20", H - o.cy, "30", 0, "40", o.r);
    else if (o.t === "r") {
      const p = [[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h], [o.x, o.y]];
      for (let i = 0; i < 4; i++) out.push("0", "LINE", "8", layer(o.k), "10", p[i][0], "20", H - p[i][1], "30", 0, "11", p[i + 1][0], "21", H - p[i + 1][1], "31", 0);
    } else {
      const txt = stripDia(String(o.s));
      let x = o.x; const w = txt.length * o.size * 0.62;
      if (o.anchor === "middle") x -= w / 2; else if (o.anchor === "end") x -= w;
      out.push("0", "TEXT", "8", "TEXT", "10", x, "20", H - o.y, "30", 0, "40", o.size * 0.8, "1", txt);
    }
  }
  out.push("0", "ENDSEC", "0", "EOF");
  return out.join("\n");
}

export function sheetSVG(prj: Project, mod: IoModule, xnum: number, page?: number, total?: number, meta?: SheetMeta): string {
  const tot = total ?? modules(prj).length;
  return opsToSVG(sheetOps(prj, mod, xnum, page ?? xnum, tot, meta), "Zapojení modulu " + mod.dir + mod.idx + " (svorkovnice X" + xnum + ")");
}
export function sheetDXF(prj: Project, mod: IoModule, xnum: number, page?: number, total?: number, meta?: SheetMeta): string {
  const tot = total ?? modules(prj).length;
  return opsToDXF(sheetOps(prj, mod, xnum, page ?? xnum, tot, meta));
}

/* ------------------------------------------------------- blokové schéma */

const MODLBL: Record<string, string> = { DI: "digitální vstupy", DO: "digitální výstupy", AI: "analogové vstupy", AO: "analogové výstupy" };

export function svgBlock(prj: Project, mods: IoModule[]): string {
  const hasIn = (d: { id: number }) => prj.io.some(e => e.devId === d.id && (e.dir === "DI" || e.dir === "AI"));
  const hasOut = (d: { id: number }) => prj.io.some(e => e.devId === d.id && (e.dir === "DO" || e.dir === "AO"));
  const L = prj.devices.filter(hasIn), R = prj.devices.filter(hasOut);
  const bh = 34, g = 10, top = 56;
  const rows = Math.max(L.length, R.length, mods.length + 2);
  const H = top + rows * (bh + g) + 20;
  const yy = (i: number) => top + i * (bh + g);
  const TXT = "font-family:ui-monospace,monospace;font-size:12px;fill:currentColor";
  const MUT = "font-family:ui-monospace,monospace;font-size:10.5px;fill:var(--muted, #777)";
  const sT = (x: number, y: number, txt: string, st?: string, anch?: string) =>
    '<text x="' + x + '" y="' + y + '" style="' + (st || TXT) + '"' + (anch ? ' text-anchor="' + anch + '"' : "") + ">" + esc(txt) + "</text>";
  /* Blok = skupina <g> s odkazem (data-dev / data-mod) a popisem v <title>:
     prohlížeč z něj udělá bublinu, desktop podle něj blok rozklikne. */
  const box = (x: number, y: number, w: number, t1: string, t2: string, acc: boolean, attrs = "", title = "") =>
    "<g" + attrs + ">" + (title ? "<title>" + esc(title) + "</title>" : "") +
    '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + bh + '" rx="5" fill="' + (acc ? "var(--chip, #eee)" : "none") + '" stroke="' + (acc ? "var(--accent, #00707e)" : "var(--line, #999)") + '"/>' +
    sT(x + 8, y + 14, t1, TXT + ";font-weight:600") + (t2 ? sT(x + 8, y + 27, String(t2).slice(0, 34), MUT) : "") + "</g>";
  const devTitle = (d: Device) => d.name + " — " + (d.desc || CLS[d.cls].label) + "\n" + CLS[d.cls].label + "\n" +
    prj.io.filter(e => e.devId === d.id).map(e => e.dir + "  " + e.tag + "  " + e.addr).join("\n");
  let s = "";
  const plcH = (mods.length + 2) * (bh + g) + 14;
  s += '<rect x="340" y="' + (top - 10) + '" width="300" height="' + plcH + '" rx="8" fill="none" stroke="var(--accent, #00707e)" stroke-width="1.5"/>';
  s += sT(350, top - 18, "PLC", TXT + ";font-weight:700;fill:var(--accent, #00707e)");
  s += sT(640, top - 18, "zdroje signálů →  PLC  → akční členy", MUT, "end");
  s += box(352, yy(0), 276, "PS — zdroj 24 V DC", "napájení modulů a snímačů", false);
  s += box(352, yy(1), 276, "CPU", prj.platforms.map(p => PLAT[p].cpu).join(" · ") || "—", true);
  mods.forEach((m, i) => {
    s += box(352, yy(i + 2), 276, m.dir + m.idx + " — " + MODLBL[m.dir], m.ch.length + " kanálů · svorkovnice X" + (i + 1), false,
      ' data-mod="' + i + '"', m.dir + m.idx + " — " + MODLBL[m.dir] + "\n" + m.ch.map((e, c) => "X" + (i + 1) + ":" + (c + 1) + "  " + e.tag + "  " + e.addr).join("\n"));
  });
  L.forEach((d, i) => { s += box(20, yy(i), 250, d.name, d.desc, false, ' data-dev="' + d.id + '" data-side="in"', devTitle(d)); });
  R.forEach((d, i) => { s += box(710, yy(i), 250, d.name, d.desc, false, ' data-dev="' + d.id + '" data-side="out"', devTitle(d)); });
  for (const e of prj.io) {
    const mi = mods.findIndex(m => m.ch.includes(e)); if (mi < 0) continue;
    const yMod = yy(mi + 2) + bh / 2;
    const d = devById(prj, e.devId); if (!d) continue;
    const ref = ' data-io="' + esc(e.key) + '" data-dev="' + d.id + '" data-mod="' + mi + '"';
    if (e.dir === "DI" || e.dir === "AI") {
      const li = L.indexOf(d);
      if (li >= 0) s += '<line' + ref + ' x1="270" y1="' + (yy(li) + bh / 2) + '" x2="352" y2="' + yMod + '" stroke="var(--muted, #777)" stroke-width="1"/>';
    } else {
      const ri = R.indexOf(d);
      if (ri >= 0) s += '<line' + ref + ' x1="628" y1="' + yMod + '" x2="710" y2="' + (yy(ri) + bh / 2) + '" stroke="var(--muted, #777)" stroke-width="1"/>';
    }
  }
  return '<svg role="img" aria-label="Blokové schéma: zařízení, moduly PLC a signálové cesty" viewBox="0 0 980 ' + H + '" style="max-width:100%;height:auto" width="980" xmlns="http://www.w3.org/2000/svg">' + s + '</svg>';
}
