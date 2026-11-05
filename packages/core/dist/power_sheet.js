/**
 * PLCdesk — silové schéma a schéma rozvodu napájení 24 V DC (návrh).
 * Stejná geometrie jako ostatní výkresy (ops → SVG + DXF R12, popisové pole `titleBlock`).
 * Nic se nevymýšlí: označení a typy přebírá z kusovníku (`buildBom`, IEC 81346), sestavu PLC ze
 * `hwLayout`; proudy, průřezy a nastavení jističů zadání neobsahuje → „doplní projektant“.
 * Texty výkresu jdou přes `trx` (latinka — totéž se píše do DXF).
 */
import { devById } from "./model.js";
import { buildBom, bomPlatform } from "./bom.js";
import { hwLayout, hwTypeText } from "./hardware.js";
import { trx } from "./i18n.js";
import { projectRef } from "./project_meta.js";
import { REF_BAND, titleBlock, todayCz, sheetRevOf, opsToSVG, opsToDXF } from "./drawing.js";
/** Kategorie kusovníku, které tvoří silový vývod zařízení (podle označení -Q / -K / -TA / -M). */
const FEED_ORDER = ["Q", "K", "TA", "M"];
function partKind(l) {
    const m = /^-(Q|K|TA|M)\d/.exec(l.tag);
    return m ? m[1] : null;
}
function feedersOf(lines, prj) {
    const by = new Map();
    for (const l of lines) {
        if (l.devId === undefined)
            continue;
        const k = partKind(l);
        if (!k)
            continue;
        let f = by.get(l.devId);
        if (!f) {
            f = { devId: l.devId, name: devById(prj, l.devId)?.name || "", parts: {} };
            by.set(l.devId, f);
        }
        if (!f.parts[k])
            f.parts[k] = l;
    }
    /* nízkonapěťové polohovací řadiče nejsou silový vývod — jdou do rozvodu napájení */
    return [...by.values()].filter(f => f.parts.TA?.cat !== "positioning_drive").filter(f => f.parts.M || f.parts.TA || f.parts.K).sort((a, b) => a.devId - b.devId);
}
export function makeCtx(W, H) {
    const O = [];
    let dev;
    const ref = () => dev !== undefined ? { dev } : {};
    return {
        O, setDev: (d) => { dev = d; },
        Ln: (x1, y1, x2, y2, k) => O.push({ t: "l", x1, y1, x2, y2, k: k || "w", ...ref() }),
        Ci: (cx, cy, r) => O.push({ t: "c", cx, cy, r, ...ref() }),
        Re: (x, y, w, h, k) => O.push({ t: "r", x, y, w, h, k: k || "s", ...ref() }),
        Tx: (x, y, s, o) => O.push(Object.assign({ t: "t", x, y, s: String(s), size: 11, anchor: "start", k: "t" }, o || {}, ref())),
        W, H,
    };
}
export function frame(c, prj, title, drawing, page, total, meta, texts) {
    const { W, H, Re, Ln, Tx } = c;
    const ref0 = projectRef(prj);
    const number = meta?.number ?? ref0.number, customer = meta?.customer ?? ref0.customer, startDate = meta?.startDate ?? ref0.startDate;
    Re(8, 8, W - 16, H - 16, "f");
    Re(26, 26, W - 52, H - 52, "f");
    for (let i = 1; i < 8; i++) {
        const x = 26 + (W - 52) / 8 * i;
        Ln(x, 8, x, 26, "f");
        Ln(x, H - 26, x, H - 8, "f");
    }
    for (let i = 0; i < 8; i++)
        Tx(26 + (W - 52) / 8 * (i + 0.5), 20, i + 1, { anchor: "middle", k: "m", size: 9 });
    titleBlock(Re, Ln, Tx, W, H, { project: meta?.projectName ?? prj.meta.name, drawing, sheet: page + " / " + total,
        date: meta?.date ?? todayCz(), rev: meta?.rev ?? sheetRevOf(prj) ?? "0.1", number, customer, startDate });
    Tx(40, 52, title, { k: "b", size: 12 });
    Re(38, 58, 330, 18, "r");
    Tx(46, 71, texts ? texts.warn : trx("Návrh — ověří elektroprojektant (EN 60204-1)"), { k: "b", size: 10 });
    Tx(40, 92, texts ? texts.hint : trx("Proudy, průřezy a nastavení jističů zadání neobsahuje — doplní projektant. Označení podle kusovníku (IEC 81346)."), { k: "m", size: 9 });
}
export const hasBand = (prj, meta) => {
    const r = projectRef(prj);
    return (meta?.number ?? r.number) || (meta?.customer ?? r.customer) || (meta?.startDate ?? r.startDate) ? REF_BAND : 0;
};
export const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "~" : s);
const TBD = () => trx("doplní projektant");
/* ------------------------------------------------------------ symboly IEC 60617 */
/** Jednopólové (jednočárové) svislé vedení od y1 do y2 — pólovost a fáze zadání neurčuje. */
function tri(c, cx, y1, y2) { c.Ln(cx, y1, cx, y2); }
/** Třípólový přístroj: stykač (oblouk u pólu) nebo jistič (křížek na pólu); výška 34. */
function poles(c, cx, y, kind) {
    for (const dx of [0]) {
        const x = cx + dx;
        c.Ln(x, y, x, y + 9);
        c.Ln(x, y + 9, x - 6, y + 25, "s");
        c.Ln(x, y + 25, x, y + 34);
        if (kind === "contactor")
            c.Ci(x, y + 9, 2);
        if (kind === "breaker") {
            c.Ln(x - 3, y + 3, x + 3, y + 9, "s");
            c.Ln(x + 3, y + 3, x - 3, y + 9, "s");
        }
    }
    c.Ln(cx - 8, y + 17, cx + 4, y + 17, "r0"); // mechanická vazba
    if (kind === "switch")
        c.Ln(cx + 6, y + 17, cx + 16, y + 17, "r0");
    return y + 34;
}
function fedSymbol(c, cx, y, k, l) {
    let end;
    if (k === "Q")
        end = poles(c, cx, y, "breaker");
    else if (k === "K")
        end = poles(c, cx, y, "contactor");
    else if (k === "TA") {
        tri(c, cx, y, y + 6);
        c.Re(cx - 20, y + 6, 40, 32);
        c.Tx(cx, y + 26, "~ / ~", { anchor: "middle", size: 9 });
        tri(c, cx, y + 38, y + 44);
        end = y + 44;
    }
    else {
        tri(c, cx, y, y + 4);
        c.Ci(cx, y + 22, 18);
        c.Tx(cx, y + 22, "M", { anchor: "middle", size: 11, k: "b" });
        end = y + 44;
    }
    c.Tx(cx + 24, y + 12, l.tag, { k: "b", size: 10 });
    c.Tx(cx + 24, y + 24, cut(l.type, 14), { k: "m", size: 8 });
    return end;
}
/* ------------------------------------------------------------ silové schéma */
const PER_PAGE = 6, X0 = 150, DX = 130;
export function powerSheetOps(prj, page, total, feeders, bom, first, meta) {
    const W = 980, H = 640 + hasBand(prj, meta);
    const c = makeCtx(W, H);
    frame(c, prj, trx("Silové schéma"), trx("Silové schéma"), page, total, meta);
    const { Ln, Tx, Re, Ci } = c;
    const busY = 170, peY = 500;
    /* přívod a hlavní vypínač */
    const q0 = bom.find(l => l.cat === "main_switch");
    Tx(40, 108, trx("Přívod + PE — napětí doplní projektant"), { k: "b", size: 10 });
    const busEnd = X0 + DX * Math.max(0, feeders.length + (ctrlCols(bom, feeders) ? 0 : -1)) + 40;
    Tx(40, busY + 4, "L", { size: 9, k: "m" });
    Ln(80, busY, busEnd, busY);
    if (first && q0)
        Ln(80, 146, 80, busY);
    if (first && q0) {
        Tx(104, 124, q0.tag, { k: "b", size: 10 });
        Tx(104, 136, cut(q0.type, 14), { k: "m", size: 8 });
        poles(c, 80, 112, "switch"); // hlavní vypínač v přívodu
    }
    else if (!first)
        Tx(40, 124, trx("Pokračování z listu 1"), { k: "m", size: 9 });
    Tx(40, peY - 6, "PE", { k: "b", size: 10 });
    Ln(60, peY, W - 60, peY, "r0");
    /* vývody zařízení */
    feeders.forEach((f, i) => {
        const cx = X0 + i * DX;
        c.setDev(f.devId);
        Ln(cx, busY, cx, 190);
        let y = 190;
        for (const k of FEED_ORDER) {
            const l = f.parts[k];
            if (!l)
                continue;
            const end = fedSymbol(c, cx, y, k, l);
            y = end + 22;
            if (k !== "M" && (FEED_ORDER.slice(FEED_ORDER.indexOf(k) + 1).some(n => f.parts[n])))
                tri(c, cx, end, y);
        }
        Ln(cx - 24, 190, cx - 24, peY, "w");
        Tx(cx, 440, cut(f.name, 16), { anchor: "middle", k: "b", size: 9 });
        Tx(cx, 452, trx("Jištění, průřez:"), { anchor: "middle", k: "m", size: 8 });
        Tx(cx, 463, TBD(), { anchor: "middle", k: "m", size: 8 });
        Tx(cx, 473, trx("pólovost / fáze:"), { anchor: "middle", k: "m", size: 7 });
        Tx(cx, 482, trx("doplní projektant"), { anchor: "middle", k: "m", size: 7 });
        c.setDev(undefined);
    });
    /* řízení: jistič řízení → zdroj 24 V */
    const cc = ctrlCols(bom, feeders);
    if (cc) {
        const cx = X0 + feeders.length * DX;
        Ln(cx, busY, cx, 190);
        let y = 190;
        const fs = bom.filter(l => l.devId === undefined && /^-F\d/.test(l.tag) && l.cat === "mcb");
        for (const l of fs.slice(0, 1)) {
            const end = poles(c, cx, y, "breaker");
            Tx(cx + 24, y + 12, l.tag, { k: "b", size: 10 });
            Tx(cx + 24, y + 24, cut(l.type, 14), { k: "m", size: 8 });
            y = end + 22;
            Ln(cx, end, cx, y);
        }
        const t = bom.find(l => l.cat === "power_supply_24v");
        if (t) {
            Re(cx - 30, y, 60, 40, "chip");
            Tx(cx, y + 18, "AC / DC", { anchor: "middle", size: 9 });
            Tx(cx, y + 31, "24 V", { anchor: "middle", size: 9 });
            Tx(cx + 36, y + 14, t.tag, { k: "b", size: 10 });
            Tx(cx + 36, y + 26, cut(t.type, 12), { k: "m", size: 8 });
            Ln(cx, y + 40, cx, y + 56);
            Tx(cx, y + 70, "L+ / M", { anchor: "middle", k: "m", size: 9 });
            Tx(cx, y + 82, trx("viz rozvod napájení"), { anchor: "middle", k: "m", size: 8 });
        }
        Tx(cx, 440, trx("Řízení 24 V DC"), { anchor: "middle", k: "b", size: 9 });
        Tx(cx, 452, trx("Jištění, průřez:"), { anchor: "middle", k: "m", size: 8 });
        Tx(cx, 463, TBD(), { anchor: "middle", k: "m", size: 8 });
        Tx(cx, 473, trx("pólovost / fáze:"), { anchor: "middle", k: "m", size: 7 });
        Tx(cx, 482, trx("doplní projektant"), { anchor: "middle", k: "m", size: 7 });
    }
    Ci(60, peY, 3);
    Tx(40, 560 + 0, trx("Symboly dle IEC 60617: jistič (křížek na pólu), stykač (oblouk u pólu), motor M, měnič ~/~; jednočárově."), { k: "m", size: 9 });
    return { W, H, O: c.O };
}
/** Má stránka sloupec „řízení“ (jistič řízení + zdroj 24 V)? Jen na poslední stránce s volným místem. */
function ctrlCols(bom, feeders) {
    return feeders.length < PER_PAGE && bom.some(l => l.devId === undefined && (l.cat === "power_supply_24v" || (l.cat === "mcb" && /^-F\d/.test(l.tag))));
}
function branchesOf(prj, bom) {
    const out = [];
    const L = hwLayout(prj, bomPlatform(prj));
    for (const st of L.stations) {
        const lines = st.modules.filter(m => m !== st.head).slice(0, 8).map(m => cut(m.dt + " " + hwTypeText(m, s => trx(s)), 17));
        const rest = st.modules.filter(m => m !== st.head).length - 8;
        if (rest > 0)
            lines.push("+" + rest);
        out.push({ title: st.head.dt, sub: cut(hwTypeText(st.head, s => trx(s)), 17), lines });
    }
    const hmi = bom.find(l => l.cat === "plc_hmi");
    if (hmi)
        out.push({ title: hmi.tag, sub: cut(hmi.type, 17), lines: [] });
    const list = (re, n = 8, ok = () => true) => {
        const tags = bom.filter(l => re.test(l.tag) && l.devId !== undefined && ok(l)).map(l => l.tag);
        const uniq = [...new Set(tags)];
        const lines = [];
        for (let i = 0; i < Math.min(uniq.length, n); i += 3)
            lines.push(uniq.slice(i, Math.min(i + 3, n)).join(" "));
        if (uniq.length > n)
            lines.push("+" + (uniq.length - n));
        return { count: uniq.length, lines };
    };
    const sens = list(/^-[BS]\d/, 8, l => !/^(estop|safety|pushbutton|selector)/.test(l.cat));
    if (sens.count)
        out.push({ title: trx("Snímače"), sub: sens.count + " " + trx("ks"), lines: sens.lines });
    const valves = list(/^-Y\d/, 9);
    if (valves.count)
        out.push({ title: trx("Ventily"), sub: valves.count + " " + trx("ks"), lines: valves.lines });
    const pd = [...new Set(bom.filter(l => l.cat === "positioning_drive").map(l => l.tag))];
    if (pd.length) {
        const lines = [];
        for (let i = 0; i < Math.min(pd.length, 9); i += 3)
            lines.push(pd.slice(i, i + 3).join(" "));
        if (pd.length > 9)
            lines.push("+" + (pd.length - 9));
        out.push({ title: trx("Řadiče polohování"), sub: pd.length + " " + trx("ks"),
            lines: [...lines, trx("napájení podle"), trx("dokumentace řadiče"), trx("— doplní projektant")] });
    }
    const bc = bom.find(l => l.cat === "beacon");
    if (bc)
        out.push({ title: bc.tag, sub: trx("signální věž"), lines: [] });
    const es = bom.filter(l => l.cat === "safety_relay" || l.cat === "estop_button");
    if (es.length)
        out.push({ title: trx("E-stop větev"), sub: [...new Set(es.map(l => l.tag))].slice(0, 3).join(" "), marker: true,
            lines: [trx("jen značka vstupu"), trx("do bezpečnostního"), trx("okruhu (viz výkres)")] });
    return out;
}
export function supplySheetOps(prj, page, total, branches, bom, meta) {
    const W = 980, H = 640 + hasBand(prj, meta);
    const c = makeCtx(W, H);
    frame(c, prj, trx("Rozvod napájení 24 V DC"), trx("Rozvod napájení"), page, total, meta);
    const { Ln, Tx, Re } = c;
    const lpY = 150, mY = 170, peY = 500, bx = 230, bdx = 120;
    /* zdroj */
    const fs = bom.filter(l => l.devId === undefined && l.cat === "mcb" && /^-F\d/.test(l.tag));
    const t = bom.find(l => l.cat === "power_supply_24v");
    Re(44, 130, 120, 74, "chip");
    Tx(104, 124, trx("Zdroj 24 V DC"), { anchor: "middle", k: "b", size: 10 });
    Tx(52, 148, t ? t.tag : "-T?", { k: "b", size: 10 });
    Tx(52, 161, t ? cut(t.type, 18) : TBD(), { k: "m", size: 8 });
    Tx(52, 177, fs.length ? fs[0].tag : "-F?", { k: "b", size: 10 });
    Tx(52, 190, fs.length ? cut(fs[0].type, 18) : TBD(), { k: "m", size: 8 });
    const xEnd = bx + bdx * Math.max(1, branches.length) - 40;
    Ln(164, lpY, xEnd, lpY, "r");
    Tx(168, lpY - 6, "L+ (24 V DC)", { k: "b", size: 9 });
    Ln(164, mY, xEnd, mY, "r0");
    Tx(168, mY + 14, "M (0 V)", { k: "b", size: 9 });
    Ln(40, peY, W - 60, peY, "r0");
    Tx(40, peY - 6, "PE", { k: "b", size: 10 });
    branches.forEach((b, i) => {
        const cx = bx + i * bdx;
        Ln(cx - 6, lpY, cx - 6, 215, "w");
        Ln(cx + 6, mY, cx + 6, 215, "w");
        Tx(cx - 44, 194, trx("Jištění větve:"), { k: "m", size: 7 });
        Tx(cx - 44, 204, TBD(), { k: "m", size: 7 });
        Re(cx - 45, 215, 90, 38, b.marker ? "r" : "chip");
        Tx(cx, 230, cut(b.title, 15), { anchor: "middle", k: "b", size: 10 });
        Tx(cx, 245, cut(b.sub, 17), { anchor: "middle", k: "m", size: 8 });
        b.lines.forEach((s, j) => Tx(cx - 45, 272 + j * 13, s, { size: 8, k: b.marker ? "m" : "t" }));
        if (!b.marker)
            Ln(cx + 52, 215, cx + 52, peY, "w");
    });
    Tx(40, 560, trx("L+ / M: napájení větví; jištění větví, průřezy a rozdělení zátěže doplní projektant. PE přípojnice dole."), { k: "m", size: 9 });
    return { W, H, O: c.O };
}
/* ------------------------------------------------------------ veřejné API */
/** Listy silového schématu a rozvodu napájení (prázdné pole, když projekt nemá co kreslit). */
export function powerSheets(prj, meta) {
    const bom = buildBom(prj).lines;
    const out = [];
    const feeders = feedersOf(bom, prj);
    const ctrl = bom.some(l => l.cat === "power_supply_24v" || l.cat === "main_switch");
    if (feeders.length || ctrl) {
        const pages = [];
        for (let i = 0; i < feeders.length; i += PER_PAGE)
            pages.push(feeders.slice(i, i + PER_PAGE));
        if (!pages.length)
            pages.push([]);
        /* sloupec řízení potřebuje volné místo; jinak na další list */
        if (pages[pages.length - 1].length >= PER_PAGE && bom.some(l => l.cat === "power_supply_24v"))
            pages.push([]);
        pages.forEach((fp, i) => {
            const sh = powerSheetOps(prj, i + 1, pages.length, fp, bom, i === 0, meta);
            const label = trx("Silové schéma");
            out.push({ kind: "power", base: "silove_schema_" + (i + 1), title: label + " " + (i + 1) + "/" + pages.length, svg: opsToSVG(sh, label), dxf: opsToDXF(sh) });
        });
    }
    const br = branchesOf(prj, bom);
    if (br.length) {
        const n = Math.ceil(br.length / PER_PAGE);
        for (let i = 0; i < n; i++) {
            const sh = supplySheetOps(prj, i + 1, n, br.slice(i * PER_PAGE, (i + 1) * PER_PAGE), bom, meta);
            const label = trx("Rozvod napájení 24 V DC");
            out.push({ kind: "supply", base: "rozvod_napajeni_" + (i + 1), title: label + " " + (i + 1) + "/" + n, svg: opsToSVG(sh, label), dxf: opsToDXF(sh) });
        }
    }
    return out;
}
