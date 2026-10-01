/**
 * PLC Studio — diagramy funkce stroje:
 *  - funkční diagram cyklu (kroky sekvence a podmínky přechodu, styl GRAFCET),
 *  - časový diagram signálů z výsledku simulace.
 * Prvky nesou odkazy data-step / data-dev / data-io pro interaktivní náhledy.
 */
import { CLS, devById, ioOf, esc } from "./model.js";
import { stepTitle, stepCondText } from "./sim.js";
const TXT = "font-family:ui-monospace,monospace;font-size:12px;fill:currentColor";
const MUT = "font-family:ui-monospace,monospace;font-size:10.5px;fill:var(--muted, #777)";
const sT = (x, y, txt, st, anch) => '<text x="' + x + '" y="' + y + '" style="' + (st || TXT) + '"' + (anch ? ' text-anchor="' + anch + '"' : "") + ">" + esc(txt) + "</text>";
const ln = (x1, y1, x2, y2, stroke = "currentColor", w = 1.2, attrs = "") => "<line" + attrs + ' x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + w + '"/>';
const svg = (label, W, H, body, extra = "") => '<svg role="img" aria-label="' + esc(label) + '"' + extra + ' viewBox="0 0 ' + W + " " + H + '" style="max-width:100%;height:auto" width="' + W + '" xmlns="http://www.w3.org/2000/svg">' + body + "</svg>";
const r2 = (v) => Math.round(v * 100) / 100;
function estopTag(prj) {
    const d = devById(prj, prj.program.estop);
    if (!d)
        return "";
    const io = ioOf(prj, d);
    return (io.in || Object.values(io)[0] || { tag: "" }).tag;
}
/** Funkční diagram cyklu; `run` (běžný cyklus ze simulace) doplní časy kroků. */
export function svgFlow(prj, run) {
    const seq = prj.program.seq;
    const W = 980, bx = 200, bw = 400, bh = 44, gap = 36, top = 74, cx = bx + bw / 2;
    const yy = (row) => top + row * (bh + gap);
    let s = sT(20, 26, "Funkční diagram cyklu" + (prj.meta.name ? " — " + prj.meta.name.slice(0, 60) : ""), TXT + ";font-weight:700;fill:var(--accent, #00707e)");
    const es = estopTag(prj);
    s += sT(20, 44, es ? "enable = " + es + " (centrální uvolnění): při FALSE návrat do kroku 0 a vypnutí výstupů bloků" : "enable = TRUE (centrální uvolnění není zvoleno)", MUT);
    if (!seq.length) {
        s += sT(20, 80, "Projekt nemá automatickou sekvenci — kroky přidej v kroku Program.", MUT);
        return svg("Funkční diagram cyklu", W, 110, s);
    }
    const stepBox = (row, t1, t2, attrs, title, acc) => "<g" + attrs + "><title>" + esc(title) + "</title>" +
        '<rect x="' + bx + '" y="' + yy(row) + '" width="' + bw + '" height="' + bh + '" rx="5" fill="' + (acc ? "var(--chip, #eee)" : "none") + '" stroke="' + (acc ? "var(--accent, #00707e)" : "var(--line, #999)") + '"/>' +
        sT(bx + 10, yy(row) + 18, t1, TXT + ";font-weight:600") + sT(bx + 10, yy(row) + 34, t2.slice(0, 52), MUT) + "</g>";
    const trans = (row, cond) => {
        const y1 = yy(row) + bh, ym = y1 + gap / 2;
        return ln(cx, y1, cx, y1 + gap) + ln(cx - 12, ym, cx + 12, ym, "currentColor", 2) + sT(cx + 20, ym + 4, cond, MUT);
    };
    s += stepBox(0, "0 · Klid", "režim AUTO, čeká na start", ' data-step="-1"', "Krok 0: klid\nSekvence čeká na režim AUTO a povel start (cmdAutoStart).", true);
    s += trans(0, "AUTO a start");
    seq.forEach((st, i) => {
        const d = devById(prj, st.dev);
        const cond = stepCondText(prj, st);
        const sub = st.act === "wait" ? "časová prodleva" : (d ? (d.desc || CLS[d.cls].label) : "zařízení neexistuje");
        const attrs = ' data-step="' + i + '"' + (d ? ' data-dev="' + d.id + '"' : "");
        const title = "Krok " + (i + 1) + ": " + stepTitle(prj, st) + "\nPřechod: " + cond + (d ? "\nZařízení: " + d.name + " — " + (d.desc || CLS[d.cls].label) : "");
        s += stepBox(i + 1, "Krok " + (i + 1) + " · " + stepTitle(prj, st), sub, attrs, title, false);
        const r = run ? run.steps.find(x => x.i === i) : undefined;
        if (r)
            s += sT(bx + bw + 16, yy(i + 1) + 18, "t = " + r.tStart + " s", MUT) +
                sT(bx + bw + 16, yy(i + 1) + 34, r.tEnd !== null ? "trvá " + r2(r.tEnd - r.tStart) + " s" : "nedokončen", MUT + (r.tEnd === null ? ";fill:var(--err, #b3261e)" : ""));
        if (i < seq.length - 1)
            s += trans(i + 1, cond);
    });
    /* návrat z posledního kroku do klidu */
    const last = seq.length, yb = yy(last) + bh, ym = yb + gap / 2, xl = bx - 60, y0 = yy(0) + bh / 2;
    s += ln(cx, yb, cx, yb + gap) + ln(cx - 12, ym, cx + 12, ym, "currentColor", 2) + sT(cx + 20, ym + 4, stepCondText(prj, seq[last - 1]) + "  → konec cyklu", MUT);
    s += ln(cx, yb + gap, xl, yb + gap) + ln(xl, yb + gap, xl, y0) + ln(xl, y0, bx, y0) + ln(bx - 9, y0 - 5, bx, y0) + ln(bx - 9, y0 + 5, bx, y0);
    if (run && run.cycleTime !== null)
        s += sT(xl - 8, y0 - 8, "cyklus " + run.cycleTime + " s", MUT, "end");
    return svg("Funkční diagram cyklu: kroky sekvence a podmínky přechodu", W, yb + gap + 24, s);
}
/** Časový diagram: kroky sekvence, výstupy a zpětná hlášení zařízení v čase. */
export function svgTiming(prj, run) {
    const W = 980, x0 = 190, x1 = W - 24, rh = 20, top = 52;
    const tEnd = Math.max(run.tEnd, 0.1), px = (t) => r2(x0 + (x1 - x0) * Math.min(t, tEnd) / tEnd);
    const seq = prj.program.seq;
    /* řádky: E-stop, pak zařízení v pořadí použití v sekvenci (výstup, pak vstupy) */
    const devs = [];
    const es = devById(prj, prj.program.estop);
    if (es)
        devs.push(es);
    for (const st of seq) {
        const d = devById(prj, st.dev);
        if (d && !devs.includes(d))
            devs.push(d);
    }
    const rows = devs.flatMap(d => prj.io.filter(e => e.devId === d.id && (e.dir === "DO" || e.dir === "DI"))
        .sort((a, b) => (a.dir === "DO" ? 0 : 1) - (b.dir === "DO" ? 0 : 1)).map(e => ({ e, d })));
    const H = top + (rows.length + 1) * rh + 44;
    const yRow = (i) => top + (i + 1) * rh;
    let s = sT(20, 26, "Časový diagram" + (prj.meta.name ? " — " + prj.meta.name.slice(0, 60) : ""), TXT + ";font-weight:700;fill:var(--accent, #00707e)");
    s += sT(x1, 26, "výstup = plná, vstup = šedá · " + (run.cycleTime !== null ? "cyklus " + run.cycleTime + " s" : "cyklus nedoběhl"), MUT, "end");
    /* časová osa a mřížka */
    const nice = [0.5, 1, 2, 5, 10, 20, 30, 60, 120].find(v => tEnd / v <= 12) || 300;
    for (let t = 0; t <= tEnd + 1e-9; t += nice) {
        s += ln(px(t), top - 4, px(t), H - 34, "var(--line, #999)", 0.6) + sT(px(t), H - 20, r2(t) + " s", MUT, "middle");
    }
    /* pruh kroků sekvence */
    s += sT(20, top + 14, "Krok sekvence", TXT + ";font-weight:600");
    run.steps.forEach((r, n) => {
        const a = px(r.tStart), b = px(r.tEnd ?? tEnd);
        s += '<g data-step="' + r.i + '"' + (seq[r.i]?.dev ? ' data-dev="' + seq[r.i].dev + '"' : "") + "><title>" + esc("Krok " + (r.i + 1) + ": " + stepTitle(prj, seq[r.i]) + "\n" + r.tStart + " s – " + (r.tEnd ?? "nedokončen") + (r.tEnd !== null ? " s" : "")) + "</title>" +
            '<rect x="' + a + '" y="' + (top + 2) + '" width="' + Math.max(1, r2(b - a)) + '" height="' + (rh - 4) + '" fill="' + (r.tEnd === null ? "var(--err, #b3261e)" : n % 2 ? "none" : "var(--chip, #eee)") + '" stroke="var(--line, #999)"/>' +
            (b - a >= 14 ? sT(r2((a + b) / 2), top + 15, String(r.i + 1), MUT, "middle") : "") + "</g>";
    });
    /* signály */
    rows.forEach(({ e, d }, i) => {
        const y = yRow(i);
        const ref = ' data-io="' + esc(e.key) + '" data-dev="' + d.id + '"';
        s += "<g" + ref + "><title>" + esc(e.tag + "  " + e.addr + "\n" + d.name + " — " + (e.cmt || d.desc)) + "</title>" +
            sT(20, y + 14, e.tag.slice(0, 22), TXT) + "</g>" + ln(x0, y + rh - 3, x1, y + rh - 3, "var(--line, #999)", 0.6);
        let on = null;
        const bar = (a, b) => '<rect' + ref + ' x="' + px(a) + '" y="' + (y + 5) + '" width="' + Math.max(1, r2(px(b) - px(a))) + '" height="' + (rh - 9) + '" fill="' + (e.dir === "DO" ? "var(--accent, #00707e)" : "var(--muted, #777)") + '" stroke="none"/>';
        for (const f of run.frames) {
            const v = f.io[e.key] === true;
            if (v && on === null)
                on = f.t;
            else if (!v && on !== null) {
                s += bar(on, f.t);
                on = null;
            }
        }
        if (on !== null)
            s += bar(on, tEnd);
    });
    /* poruchy bloků */
    for (const er of run.errors) {
        const i = rows.findIndex(r => r.d.id === er.dev);
        if (i < 0)
            continue;
        const d = rows[i].d;
        s += '<g data-dev="' + d.id + '"><title>' + esc(d.name + ": porucha bloku v čase " + er.t + " s") + "</title>" +
            ln(px(er.t), yRow(i) + 1, px(er.t), yRow(i) + rh - 2, "var(--err, #b3261e)", 2.5) + sT(px(er.t) + 5, yRow(i) + 14, "porucha", MUT + ";fill:var(--err, #b3261e)") + "</g>";
    }
    /* data-plot = x začátku a konce časové osy a její délka [s] (pro kurzor přehrávání) */
    return svg("Časový diagram signálů", W, H, s, ' data-plot="' + x0 + " " + x1 + " " + tEnd + '"');
}
