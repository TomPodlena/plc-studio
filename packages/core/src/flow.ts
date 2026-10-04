/**
 * PLCdesk — diagramy funkce stroje:
 *  - funkční diagram cyklu (kroky sekvence a podmínky přechodu, styl GRAFCET),
 *  - časový diagram signálů z výsledku simulace.
 * Prvky nesou odkazy data-step / data-dev / data-io pro interaktivní náhledy.
 */
import { Project, Device, DeviceClass, SeqStep, CLS, devById, ioOf, esc, enableInputs, interlockDevs } from "./model.js";
import { SimResult, stepTitle, stepCondText, stepWatchdog } from "./sim.js";
import { tr, N_ } from "./i18n.js";

const TXT = "font-family:ui-monospace,monospace;font-size:12px;fill:currentColor";
const MUT = "font-family:ui-monospace,monospace;font-size:10.5px;fill:var(--muted, #777)";
const sT = (x: number, y: number, txt: string, st?: string, anch?: string) =>
  '<text x="' + x + '" y="' + y + '" style="' + (st || TXT) + '"' + (anch ? ' text-anchor="' + anch + '"' : "") + ">" + esc(txt) + "</text>";
const ln = (x1: number, y1: number, x2: number, y2: number, stroke = "currentColor", w = 1.2, attrs = "") =>
  "<line" + attrs + ' x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + w + '"/>';
const svg = (label: string, W: number, H: number, body: string, extra = "") =>
  '<svg role="img" aria-label="' + esc(label) + '"' + extra + ' viewBox="0 0 ' + W + " " + H + '" style="max-width:100%;height:auto" width="' + W + '" xmlns="http://www.w3.org/2000/svg">' + body + "</svg>";
const r2 = (v: number) => Math.round(v * 100) / 100;

function estopTag(prj: Project): string {
  const d = devById(prj, prj.program.estop);
  if (!d) return "";
  const io = ioOf(prj, d);
  return (io.in || Object.values(io)[0] || { tag: "" }).tag;
}

/** Nadpisy skupin — klíče překladu, překládají se až při kreslení (`tr(title)`). */
const SECTIONS: Array<[cls: DeviceClass, title: string]> = [
  ["Motor", N_("Pohony (motory, čerpadla)")], ["Ventil", N_("Ventily a válce")],
  ["AnalogIn", N_("Analogová měření")], ["AnalogOut", N_("Analogové výstupy")],
  ["DI", N_("Digitální vstupy (snímače, tlačítka)")], ["DO", N_("Digitální výstupy (signalizace)")],
];

/**
 * Blokové schéma stroje: každé zařízení jako blok se svými signály, po skupinách
 * podle druhu. Kolečko u signálu slouží živé simulaci jako kontrolka stavu.
 */
export function svgMachine(prj: Project): string {
  const W = 980, cw = 300, gx = 20, cols = 3;
  let y = 64;
  let s = sT(20, 26, tr("Blokové schéma stroje") + (prj.meta.name ? " — " + prj.meta.name.slice(0, 60) : ""), TXT + ";font-weight:700;fill:var(--accent, #2457C5)");
  s += sT(20, 44, tr("zařízení jako bloky se svými signály; kolečko = stav signálu (v simulaci svítí při TRUE)"), MUT);
  if (!prj.devices.length) {
    s += sT(20, 80, tr("Projekt nemá žádná zařízení — přidej je v kroku Zařízení."), MUT);
    return svg(tr("Blokové schéma stroje"), W, 110, s);
  }
  const usedIn = (d: Device) => prj.program.seq.map((st, i) => st.act !== "wait" && st.dev === d.id ? i + 1 : 0).filter(Boolean);
  for (const [cls, title] of SECTIONS) {
    const devs = prj.devices.filter(d => d.cls === cls);
    if (!devs.length) continue;
    s += sT(20, y + 12, tr(title), TXT + ";font-weight:600");
    y += 22;
    for (let r = 0; r < devs.length; r += cols) {
      const row = devs.slice(r, r + cols);
      const sigs = row.map(d => prj.io.filter(e => e.devId === d.id));
      const h = 46 + Math.max(...sigs.map(x => x.length)) * 17 + 4;
      row.forEach((d, c) => {
        const x = gx + c * (cw + 20), io = sigs[c];
        const lock = interlockDevs(prj).some(x => x.id === d.id);
        const estop = prj.program.estop === d.id || lock, steps = usedIn(d);
        const clsLabel = tr(CLS[d.cls].label);
        const tip = d.name + " — " + (d.desc || clsLabel) + "\n" + clsLabel +
          (prj.program.estop === d.id ? "\n" + tr("Centrální uvolnění (E-stop) → enable všech bloků") : "") +
          (lock ? "\n" + tr("Blokovací vstup → enable: FALSE zastaví stroj") : "") +
          (steps.length ? "\n" + tr("Kroky sekvence: {list}", { list: steps.join(", ") }) : "");
        s += '<g data-dev="' + d.id + '"><title>' + esc(tip) + "</title>" +
          '<rect x="' + x + '" y="' + y + '" width="' + cw + '" height="' + h + '" rx="6" fill="none" stroke="' + (estop ? "var(--accent, #2457C5)" : "var(--line, #999)") + '"' + (estop ? ' stroke-width="1.5"' : "") + "/>" +
          sT(x + 10, y + 17, d.name, TXT + ";font-weight:600") +
          sT(x + cw - 10, y + 17, lock ? tr("blokování → enable") : estop ? tr("E-stop → enable") : steps.length ? tr("kroky {list}", { list: steps.join(", ").slice(0, 22) }) : "", MUT, "end") +
          sT(x + 10, y + 33, (d.desc || clsLabel).slice(0, 44), MUT);
        io.forEach((e, i) => {
          const yy = y + 54 + i * 17;
          s += '<g data-io="' + esc(e.key) + '"><title>' + esc(e.tag + "  " + e.addr + "\n" + (e.cmt || "")) + "</title>" +
            '<circle cx="' + (x + 16) + '" cy="' + (yy - 4) + '" r="4.5" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
            sT(x + 28, yy, e.dir, MUT) + sT(x + 52, yy, e.tag.slice(0, 26), TXT) + sT(x + cw - 10, yy, e.addr, MUT, "end") + "</g>";
        });
        s += "</g>";
      });
      y += h + 12;
    }
    y += 6;
  }
  return svg(tr("Blokové schéma stroje: zařízení a jejich signály"), W, y + 6, s);
}

/** Funkční diagram cyklu; `run` (běžný cyklus ze simulace) doplní časy kroků. */
export function svgFlow(prj: Project, run?: SimResult | null): string {
  const seq = prj.program.seq;
  const W = 980, bx = 200, bw = 400, bh = 44, gap = 36, top = 84, cx = bx + bw / 2;
  const yy = (row: number) => top + row * (bh + gap);
  let s = sT(20, 26, tr("Funkční diagram cyklu") + (prj.meta.name ? " — " + prj.meta.name.slice(0, 60) : ""), TXT + ";font-weight:700;fill:var(--accent, #2457C5)");
  const es = enableInputs(prj).map(x => x.io.tag).join(" AND ") || estopTag(prj);
  s += sT(20, 44, es ? tr("enable = {tag} (centrální uvolnění): při FALSE návrat do kroku 0 a vypnutí výstupů bloků", { tag: es }) : tr("enable = TRUE (centrální uvolnění není zvoleno)"), MUT);
  s += sT(20, 58, tr("porucha bloku nebo vypršení hlídacího času kroku → porucha stroje: krok 0, povely vypnuty, čeká na kvitaci"), MUT);
  if (!seq.length) {
    s += sT(20, 80, tr("Projekt nemá automatickou sekvenci — kroky přidej v kroku Program."), MUT);
    return svg(tr("Funkční diagram cyklu"), W, 110, s);
  }
  const stepBox = (row: number, t1: string, t2: string, attrs: string, title: string, acc: boolean) =>
    "<g" + attrs + "><title>" + esc(title) + "</title>" +
    '<rect x="' + bx + '" y="' + yy(row) + '" width="' + bw + '" height="' + bh + '" rx="5" fill="' + (acc ? "var(--chip, #eee)" : "none") + '" stroke="' + (acc ? "var(--accent, #2457C5)" : "var(--line, #999)") + '"/>' +
    sT(bx + 10, yy(row) + 18, t1, TXT + ";font-weight:600") + sT(bx + 10, yy(row) + 34, t2.slice(0, 52), MUT) + "</g>";
  const trans = (row: number, cond: string) => {
    const y1 = yy(row) + bh, ym = y1 + gap / 2;
    return ln(cx, y1, cx, y1 + gap) + ln(cx - 12, ym, cx + 12, ym, "currentColor", 2) + sT(cx + 20, ym + 4, cond, MUT);
  };

  s += stepBox(0, tr("0 · Klid"), tr("režim AUTO, čeká na start"), ' data-step="-1"',
    tr("Krok 0: klid") + "\n" + tr("Sekvence čeká na režim AUTO, uvolnění, stav bez poruchy a povel start (cmdAutoStart)."), true);
  s += trans(0, tr("AUTO, uvolnění, bez poruchy a start"));
  const condOf = (st: SeqStep) => { const wd = stepWatchdog(prj, st); return stepCondText(prj, st) + (wd ? "  " + tr("(hlídací čas {wd} s)", { wd }) : ""); };
  seq.forEach((st, i) => {
    const d: Device | undefined = devById(prj, st.dev);
    const cond = condOf(st);
    const sub = st.act === "wait" ? tr("časová prodleva") : (d ? (d.desc || tr(CLS[d.cls].label)) : tr("zařízení neexistuje"));
    const attrs = ' data-step="' + i + '"' + (d ? ' data-dev="' + d.id + '"' : "");
    const title = tr("Krok {n}: {title}", { n: i + 1, title: stepTitle(prj, st) }) + "\n" + tr("Přechod: {cond}", { cond }) +
      (d ? "\n" + tr("Zařízení: {dev}", { dev: d.name + " — " + (d.desc || tr(CLS[d.cls].label)) }) : "");
    s += stepBox(i + 1, tr("Krok {n} · {title}", { n: i + 1, title: stepTitle(prj, st) }), sub, attrs, title, false);
    const r = run ? run.steps.find(x => x.i === i) : undefined;
    if (r) s += sT(bx + bw + 16, yy(i + 1) + 18, "t = " + r.tStart + " s", MUT) +
      sT(bx + bw + 16, yy(i + 1) + 34, r.tEnd !== null ? tr("trvá {t} s", { t: r2(r.tEnd - r.tStart) }) : tr("nedokončen"), MUT + (r.tEnd === null ? ";fill:var(--err, #b3261e)" : ""));
    if (i < seq.length - 1) s += trans(i + 1, cond);
  });
  /* návrat z posledního kroku do klidu */
  const last = seq.length, yb = yy(last) + bh, ym = yb + gap / 2, xl = bx - 60, y0 = yy(0) + bh / 2;
  s += ln(cx, yb, cx, yb + gap) + ln(cx - 12, ym, cx + 12, ym, "currentColor", 2) + sT(cx + 20, ym + 4, condOf(seq[last - 1]) + "  " + tr("→ konec cyklu"), MUT);
  s += ln(cx, yb + gap, xl, yb + gap) + ln(xl, yb + gap, xl, y0) + ln(xl, y0, bx, y0) + ln(bx - 9, y0 - 5, bx, y0) + ln(bx - 9, y0 + 5, bx, y0);
  if (run && run.cycleTime !== null) s += sT(xl - 8, y0 - 8, tr("cyklus {t} s", { t: run.cycleTime }), MUT, "end");
  return svg(tr("Funkční diagram cyklu: kroky sekvence a podmínky přechodu"), W, yb + gap + 24, s);
}

/** Časový diagram: kroky sekvence, výstupy a zpětná hlášení zařízení v čase. */
export function svgTiming(prj: Project, run: SimResult): string {
  const W = 980, x0 = 190, x1 = W - 24, rh = 20, top = 52;
  const tEnd = Math.max(run.tEnd, 0.1), px = (t: number) => r2(x0 + (x1 - x0) * Math.min(t, tEnd) / tEnd);
  const seq = prj.program.seq;

  /* řádky: E-stop, pak zařízení v pořadí použití v sekvenci (výstup, pak vstupy) */
  const devs: Device[] = [];
  const es = devById(prj, prj.program.estop);
  if (es) devs.push(es);
  for (const st of seq) { const d = devById(prj, st.dev); if (d && !devs.includes(d)) devs.push(d); }
  const rows = devs.flatMap(d => prj.io.filter(e => e.devId === d.id && (e.dir === "DO" || e.dir === "DI"))
    .sort((a, b) => (a.dir === "DO" ? 0 : 1) - (b.dir === "DO" ? 0 : 1)).map(e => ({ e, d })));
  const H = top + (rows.length + 1) * rh + 44;
  const yRow = (i: number) => top + (i + 1) * rh;

  let s = sT(20, 26, tr("Časový diagram") + (prj.meta.name ? " — " + prj.meta.name.slice(0, 60) : ""), TXT + ";font-weight:700;fill:var(--accent, #2457C5)");
  s += sT(x1, 26, tr("výstup = plná, vstup = šedá") + " · " + (run.cycleTime !== null ? tr("cyklus {t} s", { t: run.cycleTime }) : tr("cyklus nedoběhl")), MUT, "end");

  /* časová osa a mřížka */
  const nice = [0.5, 1, 2, 5, 10, 20, 30, 60, 120].find(v => tEnd / v <= 12) || 300;
  for (let t = 0; t <= tEnd + 1e-9; t += nice) {
    s += ln(px(t), top - 4, px(t), H - 34, "var(--line, #999)", 0.6) + sT(px(t), H - 20, r2(t) + " s", MUT, "middle");
  }

  /* pruh kroků sekvence */
  s += sT(20, top + 14, tr("Krok sekvence"), TXT + ";font-weight:600");
  run.steps.forEach((r, n) => {
    const a = px(r.tStart), b = px(r.tEnd ?? tEnd);
    s += '<g data-step="' + r.i + '"' + (seq[r.i]?.dev ? ' data-dev="' + seq[r.i].dev + '"' : "") + "><title>" + esc(tr("Krok {n}: {title}", { n: r.i + 1, title: stepTitle(prj, seq[r.i]) }) + "\n" + r.tStart + " s – " + (r.tEnd ?? tr("nedokončen")) + (r.tEnd !== null ? " s" : "")) + "</title>" +
      '<rect x="' + a + '" y="' + (top + 2) + '" width="' + Math.max(1, r2(b - a)) + '" height="' + (rh - 4) + '" fill="' + (r.tEnd === null ? "var(--err, #b3261e)" : n % 2 ? "none" : "var(--chip, #eee)") + '" stroke="var(--line, #999)"/>' +
      (b - a >= 14 ? sT(r2((a + b) / 2), top + 15, String(r.i + 1), MUT, "middle") : "") + "</g>";
  });

  /* signály */
  rows.forEach(({ e, d }, i) => {
    const y = yRow(i);
    const ref = ' data-io="' + esc(e.key) + '" data-dev="' + d.id + '"';
    s += "<g" + ref + "><title>" + esc(e.tag + "  " + e.addr + "\n" + d.name + " — " + (e.cmt || d.desc)) + "</title>" +
      sT(20, y + 14, e.tag.slice(0, 22), TXT) + "</g>" + ln(x0, y + rh - 3, x1, y + rh - 3, "var(--line, #999)", 0.6);
    let on: number | null = null;
    const bar = (a: number, b: number) =>
      '<rect' + ref + ' x="' + px(a) + '" y="' + (y + 5) + '" width="' + Math.max(1, r2(px(b) - px(a))) + '" height="' + (rh - 9) + '" fill="' + (e.dir === "DO" ? "var(--sig-out, #1A7F37)" : "var(--muted, #777)") + '" stroke="none"/>';
    for (const f of run.frames) {
      const v = f.io[e.key] === true;
      if (v && on === null) on = f.t;
      else if (!v && on !== null) { s += bar(on, f.t); on = null; }
    }
    if (on !== null) s += bar(on, tEnd);
  });

  /* poruchy bloků */
  for (const er of run.errors) {
    const i = rows.findIndex(r => r.d.id === er.dev);
    if (i < 0) continue;
    const d = rows[i].d;
    s += '<g data-dev="' + d.id + '"><title>' + esc(tr("{dev}: porucha bloku v čase {t} s", { dev: d.name, t: er.t })) + "</title>" +
      ln(px(er.t), yRow(i) + 1, px(er.t), yRow(i) + rh - 2, "var(--err, #b3261e)", 2.5) + sT(px(er.t) + 5, yRow(i) + 14, tr("porucha"), MUT + ";fill:var(--err, #b3261e)") + "</g>";
  }
  /* data-plot = x začátku a konce časové osy a její délka [s] (pro kurzor přehrávání) */
  return svg(tr("Časový diagram signálů"), W, H, s, ' data-plot="' + x0 + " " + x1 + " " + tEnd + '"');
}
