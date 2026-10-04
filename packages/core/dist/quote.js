/**
 * Nabídka (interní podklad): materiál z kusovníku ocený podle VLASTNÍHO ceníku uživatele
 * + odhad hodin práce z projektu × hodinové sazby uživatele.
 *
 * Zásada: ceny se nikdy nevymýšlí. Bez ceníku (nebo bez kurzu měny, bez sazby) zůstane cena
 * prázdná a položka jde do `unpriced`. Výchozí jsou jen PARAMETRY ODHADU HODIN (editovatelné,
 * s vysvětlením v `QUOTE_PARAM_INFO`), nikdy peníze.
 *
 * Dokument `18_nabidka.md` je interní — do dokumentace pro zákazníka se přidá jen na volbu
 * (`prj.quote.inDocs`).
 */
import { N_, getLang, tr } from "./i18n.js";
import { CLS, stripDia } from "./model.js";
import { buildBom } from "./bom.js";
import { CAT_LABEL } from "./catalog.js";
import { proposeSafety } from "./safety.js";
import { registerDocProvider } from "./docs.js";
const HEAD = {
    code: ["objednacikod", "objkod", "objednacicislo", "katalogovecislo", "kod", "ordercode", "ordernumber", "orderno", "partnumber", "partno",
        "articlenumber", "artikelnummer", "bestellnummer", "sku", "mlfb", "code", "codigo", "referencia", "catalognumber"],
    type: ["typ", "type", "model", "modelo", "tipo", "typoveoznaceni", "oznacenitypu", "produkt", "product", "typbezeichnung"],
    brand: ["znacka", "vyrobce", "brand", "manufacturer", "maker", "hersteller", "marke", "fabricante", "marca"],
    cat: ["kategorie", "category", "categoria", "kat", "skupina"],
    price: ["cena", "price", "preis", "precio", "jednotkovacena", "unitprice", "netprice", "einzelpreis", "nakupnicena", "cenabezdph", "cenaks"],
    currency: ["mena", "currency", "wahrung", "waehrung", "moneda", "curr"],
    supplier: ["dodavatel", "supplier", "vendor", "lieferant", "distributor", "proveedor"],
    lead: ["dodacilhuta", "lhuta", "dodani", "leadtime", "delivery", "deliverytime", "lieferzeit", "plazo", "plazodeentrega", "termin"],
};
const normHead = (s) => stripDia(s).toLowerCase().replace(/[^a-z0-9]/g, "");
/** Sloupec podle záhlaví (přesná shoda, pak obsahuje kořen). */
function headCol(h) {
    const n = normHead(h);
    if (!n)
        return null;
    for (const c of Object.keys(HEAD))
        if (HEAD[c].includes(n))
            return c;
    if (/dodaci|lieferz|leadtime|plazo/.test(n))
        return "lead";
    if (/^(mena|curr|wahr)/.test(n))
        return "currency";
    if (/cena|price|preis|precio/.test(n))
        return "price";
    if (/objedn|kod|code|nummer|partn|artik/.test(n))
        return "code";
    if (/vyrob|znack|brand|manuf|herst/.test(n))
        return "brand";
    if (/dodav|suppl|liefer|vendor/.test(n))
        return "supplier";
    if (/^typ|^type|model/.test(n))
        return "type";
    if (/kategor|categor/.test(n))
        return "cat";
    return null;
}
/** Měna z textu („Kč“, „CZK“, „€“, „EUR“, „USD“…); prázdné = neuvedeno. */
export function currencyOf(s) {
    const t = String(s || "");
    if (/k[čc]|czk/i.test(t))
        return "CZK";
    if (/€|\beur\b|eur$/i.test(t))
        return "EUR";
    const m = t.match(/\b(USD|GBP|CHF|PLN|HUF|CNY|RMB)\b|\$/i);
    if (m)
        return m[0] === "$" ? "USD" : m[0].toUpperCase().replace("RMB", "CNY");
    return "";
}
/**
 * Číslo z ceny v zápisu českého / německého / anglického Excelu: „1 234,50 Kč“, „1.234,50“,
 * „1,234.50“, „12,5“, „€ 99“. Vrací NaN, když to číslo není. `ambiguous` = „1.234“ (bráno jako tisíce).
 */
export function parseMoney(s) {
    let t = String(s ?? "").replace(/[\s  ']/g, "").replace(/k[čc]|czk|eur|€|usd|\$|,-$|-$/gi, "");
    if (!t || !/\d/.test(t))
        return { value: NaN, ambiguous: false };
    let ambiguous = false;
    const lc = t.lastIndexOf(","), ld = t.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) {
        t = lc > ld ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
    }
    else if (lc >= 0) {
        /* jen čárka: desetinná (český Excel); „1,234,567“ = tisíce */
        t = /^\d{1,3}(,\d{3}){2,}$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
    }
    else if (ld >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(t)) {
        ambiguous = true;
        t = t.replace(/\./g, "");
    }
    if (!/^-?\d+(\.\d+)?$/.test(t))
        return { value: NaN, ambiguous: false };
    return { value: Number(t), ambiguous };
}
/** Rozdělí CSV text na řádky buněk (uvozovky, zdvojené uvozovky, CRLF). */
function csvRows(text, delim) {
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i++;
                }
                else
                    q = false;
            }
            else
                cell += ch;
        }
        else if (ch === '"' && cell === "")
            q = true;
        else if (ch === delim) {
            row.push(cell);
            cell = "";
        }
        else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n")
                i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        }
        else
            cell += ch;
    }
    if (cell !== "" || row.length) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}
/** Najde řádek záhlaví (cena + kód nebo typ) — přeskočí úvodní řádky exportu (název, zakázka). */
function findHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
        const cols = new Map();
        let curCol = "";
        rows[r].forEach((h, i) => {
            const c = headCol(h);
            if (c && ![...cols.values()].includes(c)) {
                cols.set(i, c);
                if (c === "price")
                    curCol = currencyOf(h);
            }
        });
        const v = [...cols.values()];
        if (v.includes("price") && (v.includes("code") || v.includes("type") || v.includes("cat")))
            return { at: r, cols, curCol };
    }
    return null;
}
/**
 * Načte ceník z CSV / TSV (středník, čárka nebo tabulátor; UTF-8 i s BOM; desetinná čárka).
 * Sloupce se poznají podle záhlaví v češtině, angličtině, němčině nebo španělštině; povinná je
 * cena a k ní objednací kód, typ nebo kategorie. `defaultCurrency` platí pro řádky bez měny.
 */
export function parsePriceList(text, opts = {}) {
    const src = String(text || "").replace(/^﻿/, "");
    const warnings = [];
    let best = null;
    for (const delim of [";", "\t", ","]) {
        const rows = csvRows(src, delim);
        const h = findHeader(rows);
        if (h && (!best || h.cols.size > best.h.cols.size))
            best = { delim, rows, h };
    }
    if (!best) {
        warnings.push(tr("Ceník: nenalezeno záhlaví se sloupcem ceny a objednacího kódu, typu nebo kategorie."));
        return { entries: [], warnings, delimiter: "" };
    }
    const { rows, h, delim } = best;
    const at = (r, c) => {
        for (const [i, cc] of h.cols)
            if (cc === c)
                return (r[i] ?? "").trim();
        return "";
    };
    const entries = [];
    let assumed = false;
    for (let r = h.at + 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row.some(c => c.trim()))
            continue;
        const code = at(row, "code"), type = at(row, "type"), cat = at(row, "cat"), priceTxt = at(row, "price");
        if (!code && !type && !cat)
            continue;
        const pm = parseMoney(priceTxt);
        if (!Number.isFinite(pm.value) || pm.value < 0) {
            warnings.push(tr("Ceník, řádek {row}: cena „{price}“ není číslo — řádek vynechán.", { row: r + 1, price: priceTxt }));
            continue;
        }
        if (pm.ambiguous)
            warnings.push(tr("Ceník, řádek {row}: „{price}“ bráno jako tisíce — zkontroluj.", { row: r + 1, price: priceTxt }));
        let cur = currencyOf(at(row, "currency")) || currencyOf(priceTxt) || h.curCol || opts.defaultCurrency || "";
        if (!cur) {
            cur = "CZK";
            assumed = true;
        }
        entries.push({
            orderCode: code, type, brand: at(row, "brand"), cat, price: pm.value, currency: cur,
            supplier: at(row, "supplier"), leadTime: at(row, "lead"), row: r + 1,
        });
    }
    if (assumed)
        warnings.push(tr("Ceník neuvádí měnu — u řádků bez měny se předpokládá CZK."));
    return { entries, warnings, delimiter: delim };
}
const normCode = (s) => stripDia(String(s || "")).toUpperCase().replace(/[\s\-._/]/g, "");
const normTxt = (s) => stripDia(String(s || "")).toLowerCase().replace(/\s+/g, " ").trim();
function brandOk(entry, line) {
    const a = normTxt(entry), b = normTxt(line);
    if (!a)
        return true;
    if (!b)
        return false;
    return a.startsWith(b) || b.startsWith(a);
}
function catOk(entry, line) {
    const e = normTxt(entry);
    if (!e)
        return false;
    const base = line.cat.split("@")[0];
    return e === base.toLowerCase() || e === normTxt(CAT_LABEL[base] || "") || e === normTxt(tr(CAT_LABEL[base] || "")) || e === normTxt(line.item);
}
/** Najde cenu pro řádek kusovníku: objednací kód → typ + značka → kategorie. */
export function matchPrice(line, entries) {
    const lc = normCode(line.orderCode);
    if (lc) {
        const e = entries.find(x => x.orderCode && normCode(x.orderCode) === lc);
        if (e)
            return { entry: e, match: "code" };
    }
    const types = [line.type, ...line.type.split(" / "), line.orderCode].map(normTxt).filter(Boolean);
    if (types.length) {
        const e = entries.find(x => x.type && types.includes(normTxt(x.type)) && brandOk(x.brand, line.brand));
        if (e)
            return { entry: e, match: "type" };
    }
    const e = entries.find(x => x.cat && catOk(x.cat, line) && brandOk(x.brand, line.brand))
        || entries.find(x => x.cat && !x.brand && catOk(x.cat, line));
    return e ? { entry: e, match: "cat" } : null;
}
/** Výchozí parametry odhadu — hodiny, ne peníze. Uživatel je má upravit podle své praxe. */
export const QUOTE_DEFAULTS = {
    hoursPerDevice: { Motor: 1.5, Ventil: 1.5, AnalogIn: 1, AnalogOut: 1, DI: 0.25, DO: 0.25, Vfd: 2, PosDrive: 3, PropValve: 1.5, Axis: 4 },
    hoursPerIo: 0.5,
    hoursPerStep: 0.5,
    hoursPerSafetyFn: 6,
    hoursPerDocPage: 0.5,
    docPages: null,
    hoursBase: 8,
    fatHours: 8,
    commissioningDays: null,
    hoursPerDay: 8,
    travelKm: 0,
    travelTrips: 1,
    travelSpeed: 70,
};
/** Vysvětlení parametrů pro UI (české klíče překladu — přeložit přes `tr`). */
export const QUOTE_PARAM_INFO = {
    hoursPerDevice: { label: N_("Hodiny na zařízení (podle třídy)"), unit: "h", help: N_("Programování a odladění jednoho zařízení: instance bloku, zapojení signálů, ruční povely, poruchy a test. Motor a ventil s hlášením zaberou víc než samotný snímač nebo signálka.") },
    hoursPerIo: { label: N_("Hodiny na I/O bod"), unit: "h", help: N_("Elektro: schéma zapojení, svorkovnice, I/O list, zapojení a kontrola jednoho signálu (tzv. bod I/O).") },
    hoursPerStep: { label: N_("Hodiny na krok sekvence"), unit: "h", help: N_("Návrh, naprogramování a odladění jednoho kroku cyklu včetně hlídacího času a přechodu.") },
    hoursPerSafetyFn: { label: N_("Hodiny na bezpečnostní funkci"), unit: "h", help: N_("Návrh bezpečnostní funkce (PLr, architektura, výpočet PL), zapojení a příprava validace podle EN ISO 13849.") },
    hoursPerDocPage: { label: N_("Hodiny na stranu dokumentace"), unit: "h", help: N_("Kontrola a doplnění vygenerované dokumentace (FDS, I/O list, návod, FAT) — počítá se na stranu A4.") },
    docPages: { label: N_("Strany dokumentace"), unit: N_("str."), help: N_("Počet stran dokumentace; prázdné = odhad z počtu zařízení, kroků a bezpečnostních funkcí.") },
    hoursBase: { label: N_("Příprava a koordinace"), unit: "h", help: N_("Pevná část: zadání, schůzky, správa projektu, zálohy a předání bez ohledu na velikost stroje.") },
    fatHours: { label: N_("Zkouška FAT"), unit: "h", help: N_("Příprava a provedení přejímací zkoušky u výrobce (FAT) podle vygenerovaného protokolu.") },
    commissioningDays: { label: N_("Oživení na místě"), unit: N_("dny"), help: N_("Dny oživení u zákazníka; prázdné = odhad z počtu zařízení a kroků (nejméně 1 den).") },
    hoursPerDay: { label: N_("Hodin za den oživení"), unit: "h", help: N_("Účtované hodiny za jeden den na místě.") },
    travelKm: { label: N_("Vzdálenost k zákazníkovi"), unit: "km", help: N_("Jednosměrná vzdálenost; cesta se počítá tam a zpět. 0 = bez cestovného.") },
    travelTrips: { label: N_("Počet cest"), unit: "×", help: N_("Kolikrát se jede tam a zpět (např. 1 cesta s ubytováním, nebo denní dojíždění = počet dnů).") },
    travelSpeed: { label: N_("Průměrná rychlost cesty"), unit: "km/h", help: N_("Pro výpočet času na cestě, který se účtuje sazbou oživení.") },
};
export const RATE_LABEL = {
    prog: N_("Programování a dokumentace"),
    elec: N_("Elektro projekt"),
    comm: N_("Oživení, FAT a cesta"),
    km: N_("Cestovné za km"),
};
/** Peníze na haléře / centy, zaokrouhlení half-up (bez chyb plovoucí čárky). */
export function round2(x) {
    const s = Math.sign(x) || 1;
    return s * Math.round(Number((Math.abs(x) * 100).toFixed(6))) / 100;
}
/** Odhad stran dokumentace z rozsahu projektu. */
export function docPagesEstimate(prj, safetyFns = 0) {
    return 12 + Math.ceil(prj.devices.length / 3) + Math.ceil(prj.program.seq.length / 4) + Math.ceil(prj.io.length / 25) + safetyFns * 2;
}
/** Odhad dnů oživení: nejméně 1, pak 1 den na ~12 zařízení a kroků. */
export function commissioningDaysEstimate(prj) {
    return Math.max(1, Math.ceil((prj.devices.length + prj.program.seq.length) / 12));
}
function countSafetyFns(prj) {
    try {
        return proposeSafety(prj).fns.filter(f => !f.off).length;
    }
    catch {
        return 0;
    }
}
const LOC = { cs: "cs-CZ", en: "en-GB", de: "de-DE", es: "es-ES", zh: "zh-CN" };
/** Číslo ve zvyklosti jazyka (do 2 desetinných míst). */
export function fmtNum(x, dec = 2, min = 0) {
    return new Intl.NumberFormat(LOC[getLang()] || "cs-CZ", { minimumFractionDigits: min, maximumFractionDigits: dec }).format(x);
}
export function fmtMoney(x, cur) {
    return x === undefined ? "—" : fmtNum(x, 2, 2) + " " + cur;
}
/** Parametry nabídky: výchozí ← `prj.quote` ← `opts` (hodiny po třídách se slučují). */
export function quoteParams(prj, opts = {}) {
    const a = prj.quote?.params || {}, b = opts.params || {};
    return {
        ...QUOTE_DEFAULTS, ...a, ...b,
        hoursPerDevice: { ...QUOTE_DEFAULTS.hoursPerDevice, ...(a.hoursPerDevice || {}), ...(b.hoursPerDevice || {}) },
    };
}
/** Sestaví nabídku. Výsledek je deterministický; bez ceníku a sazeb nemá žádnou cenu. */
export function buildQuote(prj, opts = {}) {
    const cfg = { ...(prj.quote || {}), ...opts };
    const currency = (cfg.currency || "CZK").toUpperCase();
    const fx = cfg.fx || {};
    const rates = { ...(prj.quote?.rates || {}), ...(opts.rates || {}) };
    const vatPct = Number.isFinite(cfg.vatPct) ? cfg.vatPct : 21;
    const marginPct = Number.isFinite(cfg.marginPct) ? cfg.marginPct : 0;
    const P = quoteParams(prj, opts);
    const prices = cfg.prices || [];
    const bom = cfg.bom || buildBom(prj);
    const unpriced = [];
    const used = new Set();
    /* --- materiál */
    const convert = (v, from) => {
        if (from === currency)
            return v;
        const k = fx[from]; // 1 jednotka `from` = k jednotek měny nabídky
        return Number.isFinite(k) && k > 0 ? v * k : undefined;
    };
    const material = [];
    for (const l of bom.lines) {
        if (l.excluded)
            continue;
        const m = prices.length ? matchPrice(l, prices) : null;
        const line = {
            bomId: l.id, pos: l.pos, tag: l.tag, item: l.item, desc: l.desc, qty: l.qty, unit: l.unit,
            brand: l.brand, type: l.type, orderCode: l.orderCode, supplier: l.supplier, leadTime: "",
            match: null, ...(l.safety ? { safety: true } : {}),
        };
        if (m) {
            used.add(m.entry.row);
            line.match = m.match;
            line.priceRow = m.entry.row;
            line.srcPrice = m.entry.price;
            line.srcCurrency = m.entry.currency;
            if (m.entry.supplier)
                line.supplier = m.entry.supplier;
            line.leadTime = m.entry.leadTime;
            const u = convert(m.entry.price, m.entry.currency);
            if (u === undefined) {
                unpriced.push({ kind: "material", id: l.id, label: l.tag + " " + l.item, reason: tr("chybí kurz {from} → {to}", { from: m.entry.currency, to: currency }) });
            }
            else {
                line.unitPrice = round2(u);
                line.total = round2(line.unitPrice * l.qty);
            }
        }
        else {
            unpriced.push({ kind: "material", id: l.id, label: l.tag + " " + l.item, reason: prices.length ? tr("není v ceníku") : tr("ceník nenačten") });
        }
        material.push(line);
    }
    /* --- práce */
    const nSafety = Number.isFinite(opts.safetyFns) ? opts.safetyFns : countSafetyFns(prj);
    const pages = P.docPages ?? docPagesEstimate(prj, nSafety);
    const days = P.commissioningDays ?? commissioningDaysEstimate(prj);
    const labor = [];
    const h = (x) => fmtNum(x) + " h";
    const add = (key, label, n, per, rateKey, help, unit = "h", basis) => {
        const qty = round2(n * per);
        if (qty <= 0)
            return;
        labor.push({ key, label, basis: basis ?? fmtNum(n) + " × " + h(per), qty, unit, rateKey, help });
    };
    add("base", tr(QUOTE_PARAM_INFO.hoursBase.label), 1, P.hoursBase, "prog", tr(QUOTE_PARAM_INFO.hoursBase.help), "h", h(P.hoursBase));
    for (const c of Object.keys(CLS)) {
        const n = prj.devices.filter(d => d.cls === c).length;
        if (n)
            add("dev:" + c, tr("Zařízení — {cls}", { cls: tr(CLS[c].label) }), n, P.hoursPerDevice[c] ?? 0, "prog", tr(QUOTE_PARAM_INFO.hoursPerDevice.help));
    }
    add("seq", tr("Kroky sekvence"), prj.program.seq.length, P.hoursPerStep, "prog", tr(QUOTE_PARAM_INFO.hoursPerStep.help));
    add("io", tr("Elektro — body I/O"), prj.io.length, P.hoursPerIo, "elec", tr(QUOTE_PARAM_INFO.hoursPerIo.help));
    add("safety", tr("Bezpečnostní funkce"), nSafety, P.hoursPerSafetyFn, "elec", tr(QUOTE_PARAM_INFO.hoursPerSafetyFn.help));
    add("docs", tr("Dokumentace ({n} str.)", { n: pages }), pages, P.hoursPerDocPage, "prog", tr(QUOTE_PARAM_INFO.hoursPerDocPage.help));
    add("fat", tr(QUOTE_PARAM_INFO.fatHours.label), 1, P.fatHours, "comm", tr(QUOTE_PARAM_INFO.fatHours.help), "h", h(P.fatHours));
    add("comm", tr("Oživení na místě ({n} dní)", { n: days }), days, P.hoursPerDay, "comm", tr(QUOTE_PARAM_INFO.commissioningDays.help));
    if (P.travelKm > 0 && P.travelTrips > 0) {
        const km = 2 * P.travelKm * P.travelTrips;
        add("travel:time", tr("Čas na cestě"), km / (P.travelSpeed > 0 ? P.travelSpeed : 70), 1, "comm", tr(QUOTE_PARAM_INFO.travelSpeed.help), "h", fmtNum(km) + " km / " + fmtNum(P.travelSpeed) + " km/h");
        add("travel:km", tr("Cestovné"), km, 1, "km", tr(QUOTE_PARAM_INFO.travelKm.help), "km", fmtNum(P.travelTrips) + " × 2 × " + fmtNum(P.travelKm) + " km");
    }
    for (const l of labor) {
        const r = rates[l.rateKey];
        if (Number.isFinite(r) && r >= 0) {
            l.rate = r;
            l.total = round2(l.qty * r);
        }
        else
            unpriced.push({ kind: "labor", id: l.key, label: l.label, reason: tr("sazba „{rate}“ nezadána", { rate: tr(RATE_LABEL[l.rateKey]) }) });
    }
    /* --- součty v haléřích */
    const cents = (x) => Math.round(x * 100);
    const matCost = material.reduce((a, l) => a + (l.total !== undefined ? cents(l.total) : 0), 0);
    const marginC = Math.round(Number((matCost * marginPct / 100).toFixed(6)));
    const laborC = labor.reduce((a, l) => a + (l.total !== undefined ? cents(l.total) : 0), 0);
    const netC = matCost + marginC + laborC;
    const vatC = Math.round(Number((netC * vatPct / 100).toFixed(6)));
    const totals = {
        materialCost: matCost / 100, margin: marginC / 100, material: (matCost + marginC) / 100, labor: laborC / 100,
        hours: round2(labor.filter(l => l.unit === "h").reduce((a, l) => a + l.qty, 0)),
        net: netC / 100, vatPct, vat: vatC / 100, gross: (netC + vatC) / 100,
        complete: unpriced.length === 0,
    };
    const unusedPrices = prices.map(p => p.row).filter(r => !used.has(r));
    return { currency, marginPct, material, labor, totals, unpriced, unusedPrices, params: P };
}
/* ================================================================ výstupy */
const mdEsc = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
/** Nabídka jako Markdown — interní podklad (ceny, hodiny, nepárované položky). */
export function quoteMd(prj, opts = {}) {
    const q = buildQuote(prj, opts);
    const cur = q.currency;
    const M = (x) => fmtMoney(x, cur);
    const matchLbl = { code: tr("kód"), type: tr("typ"), cat: tr("kategorie") };
    const out = [
        "# " + tr("Nabídka — interní podklad") + " — " + (prj.meta.name || ""),
        "",
        "> **" + tr("INTERNÍ PODKLAD — není určeno zákazníkovi.") + "** " + tr("Ceny pocházejí jen z ceníku a sazeb zadaných uživatelem; položky bez ceny jsou uvedeny níže a v součtech chybí."),
        "",
        "## " + tr("Souhrn"),
        "",
        "| | " + tr("Částka") + " |",
        "|---|---:|",
        "| " + tr("Materiál (nákup)") + " | " + M(q.totals.materialCost) + " |",
        "| " + tr("Přirážka na materiál {p} %", { p: fmtNum(q.marginPct) }) + " | " + M(q.totals.margin) + " |",
        "| " + tr("Práce ({h})", { h: fmtNum(q.totals.hours) + " h" }) + " | " + M(q.totals.labor) + " |",
        "| **" + tr("Celkem bez DPH") + "** | **" + M(q.totals.net) + "** |",
        "| " + tr("DPH {p} %", { p: fmtNum(q.totals.vatPct) }) + " | " + M(q.totals.vat) + " |",
        "| **" + tr("Celkem s DPH") + "** | **" + M(q.totals.gross) + "** |",
        "",
    ];
    if (!q.totals.complete)
        out.push("⚠ " + tr("Součty nejsou úplné: {n} položek bez ceny.", { n: q.unpriced.length }), "");
    out.push("## " + tr("Materiál"), "", "| # | " + [tr("Označení"), tr("Položka"), tr("Výrobce"), tr("Typ"), tr("Objednací kód"), tr("Ks"), tr("Cena/ks"), tr("Celkem"), tr("Dodavatel"), tr("Dodací lhůta"), tr("Párování")].join(" | ") + " |", "|---|---|---|---|---|---|---:|---:|---:|---|---|---|", ...q.material.map(l => "| " + [l.pos, l.tag, l.item + (l.safety ? " ⚠" : ""), l.brand, l.type, l.orderCode, l.qty,
        M(l.unitPrice), M(l.total), l.supplier, l.leadTime, l.match ? matchLbl[l.match] : "—"].map(mdEsc).join(" | ") + " |"), "");
    if (q.material.some(l => l.match === "cat"))
        out.push(tr("Párování „kategorie“ = cena podle kategorie, ne podle konkrétního typu — ověř."), "");
    out.push("## " + tr("Práce"), "", "| " + [tr("Položka"), tr("Výpočet"), tr("Množství"), tr("Sazba"), tr("Celkem")].join(" | ") + " |", "|---|---|---:|---:|---:|", ...q.labor.map(l => "| " + [l.label, l.basis, fmtNum(l.qty) + " " + l.unit, l.rate !== undefined ? M(l.rate) + "/" + l.unit : "—", M(l.total)].map(mdEsc).join(" | ") + " |"), "");
    if (q.unpriced.length) {
        out.push("## " + tr("Bez ceny"), "", ...q.unpriced.map(u => "- " + mdEsc(u.label) + " — " + mdEsc(u.reason)), "");
    }
    out.push("## " + tr("Parametry odhadu"), "", tr("Výchozí hodnoty jsou orientační — uprav je podle vlastní praxe."), "");
    for (const k of Object.keys(QUOTE_PARAM_INFO)) {
        const inf = QUOTE_PARAM_INFO[k], v = q.params[k];
        const val = k === "hoursPerDevice"
            ? Object.keys(CLS).map(c => tr(CLS[c].label) + " " + fmtNum(q.params.hoursPerDevice[c])).join(", ")
            : v === null ? tr("odhad") : fmtNum(v);
        out.push("- **" + tr(inf.label) + "** (" + val + " " + tr(inf.unit) + ") — " + tr(inf.help));
    }
    out.push("");
    return out.join("\n");
}
const csvCell = (v) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
/** Číslo do CSV pro český Excel: desetinná čárka, bez oddělovače tisíců. */
const csvNum = (x) => x === undefined ? "" : String(x).replace(".", ",");
/** Nabídka jako CSV (středník, UTF-8 s BOM, desetinná čárka — český Excel). */
export function quoteCsv(prj, opts = {}) {
    const q = buildQuote(prj, opts);
    const rows = [[tr("Oddíl"), tr("Označení"), tr("Položka"), tr("Výrobce"), tr("Typ"), tr("Objednací kód"),
            tr("Množství"), tr("Jednotka"), tr("Cena/jedn."), tr("Celkem"), tr("Měna"), tr("Dodavatel"), tr("Dodací lhůta"), tr("Poznámka")]];
    for (const l of q.material)
        rows.push([tr("Materiál"), l.tag, l.item, l.brand, l.type, l.orderCode, csvNum(l.qty), l.unit,
            csvNum(l.unitPrice), csvNum(l.total), q.currency, l.supplier, l.leadTime, l.match ? "" : tr("bez ceny")]);
    for (const l of q.labor)
        rows.push([tr("Práce"), "", l.label, "", "", "", csvNum(l.qty), l.unit,
            csvNum(l.rate), csvNum(l.total), q.currency, "", "", l.basis + (l.total === undefined ? " — " + tr("bez ceny") : "")]);
    const t = q.totals;
    const sum = (label, v) => rows.push([tr("Souhrn"), "", label, "", "", "", "", "", "", csvNum(v), q.currency, "", "", ""]);
    sum(tr("Materiál (nákup)"), t.materialCost);
    sum(tr("Přirážka na materiál {p} %", { p: fmtNum(q.marginPct) }), t.margin);
    sum(tr("Práce ({h})", { h: fmtNum(t.hours) + " h" }), t.labor);
    sum(tr("Celkem bez DPH"), t.net);
    sum(tr("DPH {p} %", { p: fmtNum(t.vatPct) }), t.vat);
    sum(tr("Celkem s DPH"), t.gross);
    return "﻿" + rows.map(r => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}
/** Dokument nabídky — číslo mimo pevnou sadu, jen na volbu. */
export const QUOTE_FILE = "18_nabidka.md";
/** Dokument nabídky pro samostatné uložení (UI: tlačítko v kroku Kusovník). */
export function quoteDoc(prj, opts = {}) {
    return { path: QUOTE_FILE, tab: tr("Nabídka"), title: tr("nabídka — interní podklad (ceny, hodiny)"), body: quoteMd(prj, opts) };
}
/* do dokumentace jen na výslovnou volbu uživatele */
registerDocProvider("quote", { docs: prj => prj.quote?.inDocs ? [quoteDoc(prj)] : [] });
