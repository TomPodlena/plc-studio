#!/usr/bin/env node
// Dekorativni SVG pro web (inline v sablonach, barva = currentColor):
//   templates/_art-ladder.html   hero: vyrez ridiciho obvodu (IEC 60617: NO, NC, civka, svorky,
//                                cisla vodicu, ramecek vykresu se sloupcovym rastrem)
//   templates/_art-traces.html   tmava sekce: vedeni spoju jako v rozvadeci
// Sablony je vkladaji pres {{> art-ladder}} / {{> art-traces}}. Spusteni: node scripts/art.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates") + path.sep;
const r = (n) => Math.round(n * 10) / 10;

// ---------- hero: ridici obvod ----------
const W = 1200, H = 720, L = 70, R = 1150;
let g = [];
let t = [];
// ramecek vykresu se sloupcovym rastrem
g.push(`<path d="M20 20H${W - 20}V${H - 20}H20Z"/>`);
for (let i = 0; i < 8; i++) {
  const x = 20 + ((W - 40) / 8) * i;
  if (i) g.push(`<path d="M${r(x)} 20v12M${r(x)} ${H - 20}v-12"/>`);
  t.push(`<text x="${r(x + (W - 40) / 16)}" y="31" text-anchor="middle">${i + 1}</text>`);
}
g.push(`<path d="M20 34H${W - 20}" class="thin"/>`);
// napajeci sbernice
g.push(`<path d="M${L} 60V${H - 60}M${R} 60V${H - 60}"/>`);
t.push(`<text x="${L - 6}" y="54" text-anchor="end">L+</text><text x="${R + 6}" y="54">M</text>`);

const SYM = {
  no: (x, y) => `<path d="M${x} ${y}h20M${x + 20} ${y}l24 -12M${x + 46} ${y}h20"/>`,
  nc: (x, y) => `<path d="M${x} ${y}h20M${x + 46} ${y}h20M${x + 46} ${y}v-12M${x + 20} ${y}l30 -14"/>`,
  coil: (x, y) => `<path d="M${x} ${y}h18M${x + 48} ${y}h18"/><rect x="${x + 18}" y="${y - 10}" width="30" height="20"/>`,
  lamp: (x, y) => `<path d="M${x} ${y}h20M${x + 46} ${y}h20"/><circle cx="${x + 33}" cy="${y}" r="13"/><path d="M${x + 24} ${y - 9}l18 18M${x + 42} ${y - 9}l-18 18"/>`,
  term: (x, y) => `<path d="M${x} ${y}h66"/><circle cx="${x + 33}" cy="${y}" r="4" class="fillp"/>`,
};
const SW = 66; // sirka symbolu
const rungs = [
  [["term", "X1:1"], ["nc", "-S1"], ["nc", "-S2"], ["no", "-S3", "-K1"], ["coil", "-K1"]],
  [["term", "X1:2"], ["no", "-B1"], ["nc", "-K3"], ["coil", "-K2"]],
  [["term", "X1:3"], ["no", "-K1"], ["no", "-B2"], ["nc", "-K2"], ["coil", "-K3"]],
  [["term", "X1:4"], ["no", "-K2"], ["coil", "-Y1"]],
  [["term", "X1:5"], ["nc", "-F1"], ["no", "-K3"], ["coil", "-Y2"]],
  [["term", "X1:6"], ["no", "-K1"], ["lamp", "-P1"]],
];
let wire = 101;
rungs.forEach((els, ri) => {
  const y = 100 + ri * 96;
  const n = els.length;
  // rozmisteni: svorka u leve sbernice, civka u prave, kontakty rovnomerne mezi
  const xs = [];
  xs[0] = L + 30;
  xs[n - 1] = R - 30 - SW;
  for (let i = 1; i < n - 1; i++) xs[i] = r(xs[0] + SW + 40 + ((xs[n - 1] - xs[0] - 2 * SW - 80) * (i - 1)) / Math.max(1, n - 3));
  if (n === 3) xs[1] = r((xs[0] + xs[2]) / 2);
  g.push(`<path d="M${L} ${y}H${xs[0]}"/>`);
  g.push(`<circle cx="${L}" cy="${y}" r="3" class="fill"/>`);
  els.forEach(([kind, tag, par], i) => {
    const x = xs[i];
    g.push(SYM[kind](x, y));
    t.push(`<text x="${x + 33}" y="${y - (kind === "lamp" ? 20 : 18)}" text-anchor="middle" class="tag">${tag}</text>`);
    const nx = i < n - 1 ? xs[i + 1] : R;
    g.push(`<path d="M${x + SW} ${y}H${nx}"/>`);
    if (i < n - 1) {
      t.push(`<text x="${r((x + SW + nx) / 2)}" y="${y + 15}" text-anchor="middle" class="wn">${wire++}</text>`);
    }
    if (par) {
      // samodrzny kontakt paralelne
      const yb = y + 40;
      g.push(`<path d="M${x - 14} ${y}V${yb}H${x}M${x + SW} ${yb}H${x + SW + 14}V${y}"/>`);
      g.push(SYM.no(x, yb));
      g.push(`<circle cx="${x - 14}" cy="${y}" r="3" class="fill"/><circle cx="${x + SW + 14}" cy="${y}" r="3" class="fill"/>`);
      t.push(`<text x="${x + 33}" y="${yb + 18}" text-anchor="middle" class="tag">${par}</text>`);
    }
  });
  g.push(`<circle cx="${R}" cy="${y}" r="3" class="fill"/>`);
});
// popisove pole vpravo dole
const bx = W - 300, by = H - 70;
g.push(`<path d="M${bx} ${by}H${W - 20}M${bx} ${by}V${H - 20}M${bx + 170} ${by}V${H - 20}M${bx} ${by + 25}H${W - 20}" class="thin"/>`);
t.push(`<text x="${bx + 8}" y="${by + 16}">=LL03+CAB1</text><text x="${bx + 178}" y="${by + 16}">-W101…</text><text x="${bx + 8}" y="${by + 41}">IEC 60617 · IEC 81346</text><text x="${bx + 178}" y="${by + 41}">1 / 5</text>`);

const ladder = `<svg class="art art-ladder" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">
<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${g.join("")}</g>
<g fill="currentColor" stroke="none">${t.join("")}</g>
</svg>
`;
fs.writeFileSync(OUT + "_art-ladder.html", ladder);
console.log("ladder", ladder.length);

// ---------- tmava sekce: spoje jako na desce / v rozvadeci ----------
// deterministicky "nahodne" vedene spoje s ohyby 45 stupnu a koncovymi body
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const TW = 1440, TH = 900;
const paths = [], dots = [];
for (let i = 0; i < 26; i++) {
  const left = i % 2 === 0;
  let x = left ? 0 : TW;
  let y = r(40 + rnd() * (TH - 80));
  let d = `M${x} ${y}`;
  const len = 180 + rnd() * 380;
  const dir = left ? 1 : -1;
  // vodorovne -> 45 stupnu -> vodorovne
  const a = len * (0.3 + rnd() * 0.4);
  x += dir * a; d += `H${r(x)}`;
  const dy = (rnd() > 0.5 ? 1 : -1) * (20 + rnd() * 60);
  x += dir * Math.abs(dy); y += dy; d += `L${r(x)} ${r(y)}`;
  x += dir * (len - a); d += `H${r(x)}`;
  paths.push(d);
  dots.push(`<circle cx="${r(x)}" cy="${r(y)}" r="3.5"/>`);
}
const traces = `<svg class="art art-traces" viewBox="0 0 ${TW} ${TH}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
<g fill="none" stroke="currentColor" stroke-width="1.2">${paths.map((d) => `<path d="${d}"/>`).join("")}</g>
<g fill="none" stroke="currentColor" stroke-width="1.2">${dots.join("")}</g>
</svg>
`;
fs.writeFileSync(OUT + "_art-traces.html", traces);
console.log("traces", traces.length);
