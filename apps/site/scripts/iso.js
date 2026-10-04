#!/usr/bin/env node
// Izometricke ilustrace (inline SVG, bez textu v jazyce, bez znacek vyrobcu):
//   templates/_iso-line.html          uvod: linka - dopravnik, lis s valcem, svetelna zavora,
//                                     rozvadec s PLC a moduly, majak, HMI panel, kabelove trasy
//   templates/_spot-bezpecnost.html   Funkce: ochranny kryt se zamkem a svetelna zavora
//   templates/_spot-import.html       Funkce: otevreny rozvadec a skenovane schema
//   templates/_spot-kusovnik.html     Funkce: dily jednoho pohonu s oznacenim (-Q1, -K1, -M1)
// Jemne animace (pas, zdvih valce, LED, majak, sken) jsou tridy v assets/style.css (.iso-*);
// pri prefers-reduced-motion je globalni pravidlo vypne. Spusteni: node scripts/iso.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");
const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
const r = (n) => Math.round(n * 10) / 10;

// prostor (x doprava-dolu, y doleva-dolu, z nahoru) -> rovina
const P = (x, y, z) => [r((x - y) * C30), r((x + y) * S30 - z)];
const pts = (a) => a.map((p) => P(...p).join(",")).join(" ");

class Scene {
  constructor() { this.out = []; this.box = [Infinity, Infinity, -Infinity, -Infinity]; }
  grow(list) {
    for (const p of list) {
      const [X, Y] = P(...p);
      this.box[0] = Math.min(this.box[0], X); this.box[1] = Math.min(this.box[1], Y);
      this.box[2] = Math.max(this.box[2], X); this.box[3] = Math.max(this.box[3], Y);
    }
  }
  poly(list, cls, extra = "") { this.grow(list); this.out.push(`<polygon class="${cls}" points="${pts(list)}"${extra}/>`); }
  line(list, cls, extra = "") { this.grow(list); this.out.push(`<polyline class="${cls}" points="${pts(list)}"${extra}/>`); }
  raw(s) { this.out.push(s); }
  // kvadr: viditelne steny horni, +x (vpravo) a +y (vlevo)
  cube(x, y, z, w, d, h, c = "") {
    const k = c ? ` ${c}` : "";
    this.poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], `f-r${k}`);
    this.poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], `f-l${k}`);
    this.poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], `f-t${k}`);
  }
  // obdelnik v rovine steny: "x" = stena kolma na x (v = y, w = z), "y" = stena kolma na y
  face(plane, at, u, v, w, h, cls, extra = "") {
    const q = plane === "x"
      ? [[at, u, v], [at, u + w, v], [at, u + w, v + h], [at, u, v + h]]
      : [[u, at, v], [u + w, at, v], [u + w, at, v + h], [u, at, v + h]];
    this.poly(q, cls, extra);
  }
  // valec ve svislem smeru (elipsa + plast) - pro majak, motor, valec lisu
  cyl(x, y, z, rad, h, cls) {
    const [cx, cy] = P(x, y, z), [, ty] = P(x, y, z + h);
    const rx = r(rad * C30 * 1.41), ry = r(rad * S30 * 1.41);
    this.grow([[x - rad, y - rad, z], [x + rad, y + rad, z + h]]);
    this.out.push(`<path class="${cls} f-r" d="M${r(cx - rx)} ${ty}V${cy}A${rx} ${ry} 0 0 0 ${r(cx + rx)} ${cy}V${ty}Z"/>` +
      `<ellipse class="${cls} f-t" cx="${cx}" cy="${ty}" rx="${rx}" ry="${ry}"/>`);
  }
  svg(cls, pad = 16) {
    const [x0, y0, x1, y1] = this.box;
    const vb = `${r(x0 - pad)} ${r(y0 - pad)} ${r(x1 - x0 + 2 * pad)} ${r(y1 - y0 + 2 * pad)}`;
    return `<svg class="iso ${cls}" viewBox="${vb}" role="presentation" aria-hidden="true" focusable="false">\n${this.out.join("\n")}\n</svg>\n`;
  }
}

// ---------- rozvadec s PLC (spolecny pro uvod a import) ----------
function cabinet(s, x, y, z, { door = true, beacon = true } = {}) {
  const W = 120, D = 70, H = 210;
  s.cube(x, y, z, W, D, 12, "c-base");                         // sokl
  s.cube(x, y, z + 12, W, D, H, "c-cab");
  const fy = y + D;                                            // predni stena (kolma na y)
  s.face("y", fy, x + 8, z + 24, W - 16, H - 26, "c-panel");   // montazni panel (otevreny)
  // DIN listy s moduly: PLC (CPU + I/O), jistice, svorky
  const rails = [z + 178, z + 128, z + 78];
  for (const rz of rails) s.face("y", fy, x + 12, rz - 2, W - 24, 3, "c-rail");
  // rada 1: zdroj, CPU, I/O moduly s LED
  s.face("y", fy, x + 14, rails[0] - 20, 16, 34, "c-mod c-psu");
  s.face("y", fy, x + 32, rails[0] - 20, 22, 34, "c-mod c-cpu");
  s.face("y", fy, x + 35, rails[0] + 2, 16, 9, "c-screen");
  for (let i = 0; i < 6; i++) {
    const mx = x + 56 + i * 8.6;
    s.face("y", fy, mx, rails[0] - 20, 7.6, 34, "c-mod");
    for (let j = 0; j < 4; j++) {
      s.face("y", fy, mx + 2.2, rails[0] + 8 - j * 5, 3, 2.4, `led led-${(i + j) % 4}`);
    }
  }
  // rada 2: jistice a stykace
  for (let i = 0; i < 8; i++) s.face("y", fy, x + 14 + i * 11.6, rails[1] - 16, 10, 28, i < 3 ? "c-brk" : "c-ctr");
  // rada 3: svorky
  for (let i = 0; i < 22; i++) s.face("y", fy, x + 14 + i * 4.3, rails[2] - 12, 3.6, 22, i % 6 === 5 ? "c-term c-term-pe" : "c-term");
  // kabelove kanaly
  s.face("y", fy, x + 12, z + 30, W - 24, 7, "c-duct");
  s.face("y", fy, x + 12, rails[1] + 18, W - 24, 6, "c-duct");
  if (door) {
    // otevrene dvere (otocene o 90 st. kolem prave hrany -> lezi v rovine kolme na x)
    s.poly([[x + W, fy, z + 14], [x + W, fy + 0, z + H + 10], [x + W, fy + W * 0.92, z + H + 10], [x + W, fy + W * 0.92, z + 14]], "f-r c-door");
    s.face("x", x + W + 0.5, fy + 14, z + 40, W * 0.92 - 28, 110, "c-doc");
    for (let i = 0; i < 6; i++) s.face("x", x + W + 1, fy + 22, z + 60 + i * 14, W * 0.92 - 46, 2, "c-docline");
  }
  if (beacon) {
    // majak na strese
    s.cyl(x + 24, y + 30, z + H + 12, 7, 6, "c-bk");
    s.cyl(x + 24, y + 30, z + H + 18, 7, 12, "c-bk-g beacon-g");
    s.cyl(x + 24, y + 30, z + H + 30, 7, 12, "c-bk-y");
    s.cyl(x + 24, y + 30, z + H + 42, 7, 12, "c-bk-r");
  }
  return { W, D, H };
}

// ---------- uvod: linka ----------
{
  const s = new Scene();
  // podlaha s rastrem
  s.poly([[-210, -150, 0], [600, -150, 0], [600, 160, 0], [-210, 160, 0]], "floor");
  for (let i = -210; i <= 600; i += 45) s.line([[i, -150, 0], [i, 160, 0]], "floor-grid");
  for (let j = -150; j <= 160; j += 50) s.line([[-210, j, 0], [600, j, 0]], "floor-grid");

  // rozvadec vzadu vlevo, celem k divakovi
  cabinet(s, -185, -135, 0, { door: false, beacon: true });
  // kabelove trasy z rozvadece k lince (animovane carkovani)
  s.line([[-120, -64, 1], [-120, -20, 1], [40, -20, 1], [40, 18, 1]], "cable");
  s.line([[-100, -64, 1], [-100, -34, 1], [300, -34, 1], [300, -6, 1]], "cable");

  // dopravnik podel x
  const BX = 20, BY = 20, BW = 540, BD = 60, BZ = 70;
  for (const lx of [BX + 18, BX + 250, BX + 510]) {
    s.cube(lx, BY + 4, 0, 8, 8, BZ, "m-leg");
    s.cube(lx, BY + BD - 12, 0, 8, 8, BZ, "m-leg");
  }
  s.cube(BX, BY, BZ, BW, BD, 14, "m-frame");
  const TZ = BZ + 14.5;
  s.poly([[BX, BY + 4, TZ], [BX + BW, BY + 4, TZ], [BX + BW, BY + BD - 4, TZ], [BX, BY + BD - 4, TZ]], "belt");
  for (const yy of [BY + 12, BY + BD / 2, BY + BD - 12]) s.line([[BX + 4, yy, TZ + 0.5], [BX + BW - 4, yy, TZ + 0.5]], "belt-run");

  // zadni sloupky zavory a lisu (za dily)
  const LX = 260, PX = 340;
  s.cube(LX, BY - 26, 0, 8, 8, 150, "m-post");
  s.cube(PX, BY - 26, 0, 14, 14, 200, "m-press");
  s.cube(PX + 72, BY - 26, 0, 14, 14, 200, "m-press");

  // dily na pasu (posun v ose x)
  const DX = 470;
  s.raw(`<g class="iso-parts" style="--dx:${r(C30 * DX)}px;--dy:${r(S30 * DX)}px">`);
  for (const i of [0, 1]) {
    s.raw(`<g class="iso-part iso-part-${i}">`);
    s.cube(BX + 16, BY + 16, TZ, 32, 28, 14, "m-part");
    s.raw(`</g>`);
  }
  s.raw(`</g>`);

  // beran lisu (animovany zdvih) mezi sloupky
  s.raw(`<g class="iso-ram">`);
  s.cube(PX + 36, BY + BD / 2 - 7, 134, 14, 14, 66, "m-rod");
  s.cube(PX + 16, BY + 9, 120, 54, 42, 14, "m-ramhead");
  s.raw(`</g>`);

  // svetelna zavora: paprsky a predni sloupek
  for (let k = 0; k < 8; k++) s.line([[LX + 4, BY - 20, 36 + k * 15], [LX + 4, BY + BD + 20, 36 + k * 15]], "beam");
  s.cube(LX, BY + BD + 18, 0, 8, 8, 150, "m-post");

  // predni sloupky a horni deska lisu, valec, ventilovy ostrov
  s.cube(PX, BY + BD + 12, 0, 14, 14, 200, "m-press");
  s.cube(PX + 72, BY + BD + 12, 0, 14, 14, 200, "m-press");
  s.cube(PX - 6, BY - 32, 200, 98, BD + 64, 22, "m-press-top");
  s.cyl(PX + 43, BY + BD / 2, 222, 20, 56, "m-cyl");
  s.cube(PX + 30, BY + BD / 2 - 8, 278, 26, 16, 8, "m-cyl-cap");
  s.cube(PX + 92, BY + BD - 6, 150, 10, 30, 36, "m-valveblock");
  for (let i = 0; i < 3; i++) s.face("x", PX + 102.5, BY + BD - 2 + i * 9, 158, 6, 20, "m-valve");

  // pohon pasu na konci (prevodovka + motor)
  s.cube(BX + BW - 36, BY + BD, BZ - 6, 28, 14, 24, "m-gear");
  s.cube(BX + BW - 32, BY + BD + 14, BZ - 3, 20, 26, 18, "m-gear");

  // HMI panel na sloupku vlevo vpredu
  const HX = -60, HY = BY + BD + 40;
  s.cube(HX + 22, HY + 2, 0, 12, 12, 108, "m-post");
  s.cube(HX, HY, 108, 58, 12, 44, "m-hmi");
  s.face("y", HY + 12.4, HX + 5, 113, 48, 34, "hmi-screen");
  for (let i = 0; i < 4; i++) s.face("y", HY + 12.8, HX + 9 + i * 10.5, 118, 7, 6 + ((i * 7) % 14), `hmi-bar hmi-bar-${i}`);
  s.face("y", HY + 12.8, HX + 9, 139, 40, 2.5, "hmi-line");

  fs.writeFileSync(path.join(OUT, "_iso-line.html"), s.svg("iso-line"));
}

// ---------- Funkce: bezpecnost ----------
{
  const s = new Scene();
  s.poly([[-10, -10, 0], [300, -10, 0], [300, 230, 0], [-10, 230, 0]], "floor");
  // stroj uvnitr ohrady
  s.cube(110, 30, 0, 120, 90, 64, "m-frame");
  s.cube(150, 55, 64, 40, 40, 70, "m-press");
  s.cyl(170, 75, 134, 14, 26, "m-cyl");
  const fence = (x0, y0, x1, y1, h, n) => {
    s.poly([[x0, y0, 0], [x1, y1, 0], [x1, y1, h], [x0, y0, h]], "fence");
    for (let i = 1; i < n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      s.line([[x, y, 0], [x, y, h]], "fence-wire");
    }
    for (let k = 1; k < 7; k++) s.line([[x0, y0, (h * k) / 7], [x1, y1, (h * k) / 7]], "fence-wire");
    s.line([[x0, y0, 0], [x0, y0, h], [x1, y1, h], [x1, y1, 0]], "fence-frame");
  };
  // vpravo (rovina x = 270) plna ohrada, vpredu (y = 160) dvere se zamkem a vstup se zavorou
  fence(270, 0, 270, 160, 120, 10);
  fence(170, 160, 270, 160, 120, 6);                  // dvere
  s.cube(160, 156, 58, 10, 10, 22, "m-lock");
  s.face("y", 166.5, 162, 72, 6, 4, "led led-lock");
  s.line([[170, 160, 0], [170, 160, 120]], "fence-frame");
  // vstup x = 60 .. 150 chraneny svetelnou zavorou
  s.cube(54, 156, 0, 8, 8, 132, "m-post");
  for (let k = 0; k < 8; k++) s.line([[62, 160, 18 + k * 14], [150, 160, 18 + k * 14]], "beam");
  s.cube(150, 156, 0, 8, 8, 132, "m-post");
  // vyznaceny prostor pred vstupem
  s.poly([[60, 172, 0.5], [152, 172, 0.5], [152, 222, 0.5], [60, 222, 0.5]], "zone");
  fs.writeFileSync(path.join(OUT, "_spot-bezpecnost.html"), s.svg("iso-spot"));
}

// ---------- Funkce: import ----------
{
  const s = new Scene();
  s.poly([[-10, -10, 0], [310, -10, 0], [310, 210, 0], [-10, 210, 0]], "floor");
  cabinet(s, 0, 0, 0, { door: false, beacon: false });
  // vytisteny vykres lezici pred rozvadecem + skenovaci linka
  const X = 145, Y = 95;
  s.poly([[X, Y, 0.5], [X + 150, Y, 0.5], [X + 150, Y + 100, 0.5], [X, Y + 100, 0.5]], "sheet");
  s.line([[X + 8, Y + 8, 0.8], [X + 142, Y + 8, 0.8], [X + 142, Y + 92, 0.8], [X + 8, Y + 92, 0.8], [X + 8, Y + 8, 0.8]], "sheet-line");
  for (let i = 0; i < 4; i++) s.line([[X + 20, Y + 22 + i * 18, 1], [X + 130, Y + 22 + i * 18, 1]], "sheet-line");
  for (let i = 0; i < 4; i++) s.line([[X + 34 + i * 26, Y + 22, 1], [X + 34 + i * 26, Y + 76, 1]], "sheet-line sheet-v");
  s.poly([[X + 56, Y + 36, 1], [X + 76, Y + 36, 1], [X + 76, Y + 52, 1], [X + 56, Y + 52, 1]], "sheet-mark");
  s.raw(`<g class="iso-scan" style="--sx:${r(-C30 * 96)}px;--sy:${r(S30 * 96)}px">`);
  s.line([[X - 6, Y + 2, 2], [X + 156, Y + 2, 2]], "scan-line");
  s.raw(`</g>`);
  fs.writeFileSync(path.join(OUT, "_spot-import.html"), s.svg("iso-spot"));
}

// ---------- Funkce: kusovnik ----------
{
  const s = new Scene();
  s.poly([[-10, -10, 0], [300, -10, 0], [300, 190, 0], [-10, 190, 0]], "floor");
  // montazni deska s DIN listou: jistic motoru -Q1, stykac -K1, svorky -X1
  s.cube(0, 0, 0, 190, 70, 6, "c-cab");
  s.cube(10, 26, 6, 170, 12, 3, "c-railb");
  s.cube(22, 20, 9, 30, 26, 44, "c-brk3");
  s.face("y", 46.5, 28, 34, 18, 8, "c-knob");
  s.cube(72, 20, 9, 32, 26, 40, "c-ctr3");
  s.face("y", 46.5, 80, 28, 16, 6, "c-knob");
  for (let i = 0; i < 9; i++) s.cube(118 + i * 7, 22, 9, 5.5, 22, 30, i === 8 ? "c-term3 c-term-pe" : "c-term3");
  // prevodovy motor -M1 vpravo vpredu
  s.cube(205, 95, 0, 60, 46, 46, "m-gear");
  s.cube(215, 141, 6, 40, 36, 34, "m-gear");
  s.cube(229, 177, 18, 12, 8, 10, "m-rod");
  // stitky s oznacenim podle IEC 81346 (neprekladaji se)
  const tag = (x, y, z, t) => {
    const [X, Y] = P(x, y, z);
    s.grow([[x, y, z]]);
    s.raw(`<g class="iso-tag"><path class="tag-lead" d="M${X} ${r(Y + 6)}v12"/><rect x="${r(X - 17)}" y="${r(Y - 10)}" width="34" height="16" rx="3"/><text x="${X}" y="${r(Y + 2)}" text-anchor="middle">${t}</text></g>`);
  };
  tag(37, 33, 78, "-Q1");
  tag(88, 33, 74, "-K1");
  tag(146, 33, 64, "-X1");
  tag(235, 118, 72, "-M1");
  fs.writeFileSync(path.join(OUT, "_spot-kusovnik.html"), s.svg("iso-spot"));
}

console.log("templates/_iso-line.html, _spot-bezpecnost.html, _spot-import.html, _spot-kusovnik.html");
