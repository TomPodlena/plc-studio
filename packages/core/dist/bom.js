/**
 * Kusovník komponent (BOM) z návrhu stroje.
 *
 * Z každého zařízení vznikne jedna nebo více položek (motor → motor + motorový spouštěč
 * + stykač, válec → rozváděč + válec + snímače polohy, …), k tomu PLC a I/O moduly zvolené
 * platformy a rozvaděč. Kategorie se určí z třídy zařízení, voleb, jednotky a popisu;
 * značku, typ a dodavatele nabídne katalog (`catalog.ts`), uživatel je může u kategorie
 * i u řádku změnit (`prj.bom`). Označení dle IEC 81346 (-M1, -Q1, -K1, -A1, …).
 *
 * Kusovník je podklad k poptávce, ne projekt elektro: dimenzování (výkony, průřezy,
 * jištění) a volba bezpečnostních prvků podle posouzení rizik zůstávají na projektantovi.
 * Pozn. pro verzi PRO: řádky nesou stabilní `id` (označení + kategorie), na které naváže
 * stavba zařízení v CADu.
 */
import { tr, N_ } from "./i18n.js";
import { PLAT, interlockDevs, devRef, maxRecord, ioOf, } from "./model.js";
import { CAT_LABEL, brandsFor, catKey, suppliersFor, brandOptId, SUPPLIERS } from "./catalog.js";
import { hwLayout, hwPlatform, HW_DIRS } from "./hardware.js";
import { axisCfgOf, axisObjName } from "./axis.js";
import { axisDialect, AXIS_NET } from "./axis_gen.js";
export { brandOptId };
const has = (s, re) => re.test(s.toLowerCase());
/** Kategorie snímače analogové veličiny podle jednotky a popisu. */
function analogCat(d) {
    const u = (d.unit || "").toLowerCase(), t = d.desc || "";
    if (has(t, /hladin|level|füllstand|nivel/))
        return "level_sensor";
    if (has(t, /průtok|flow|durchfluss|caudal/) || /\/h$|\/min$|l\/s/.test(u))
        return "flow_sensor";
    if (/^(bar|mbar|kpa|pa|mpa|psi)$/.test(u) || has(t, /tlak|vakuum|podtlak|pressure|druck|presi/))
        return "pressure_transmitter";
    if (/°c|^k$|°f/.test(u) || has(t, /teplot|temperat/))
        return "temperature_sensor";
    if (/^(kn|n|kg|t)$/.test(u) || has(t, /síl|váh|zatížen|force|load|kraft|gewicht/))
        return "load_cell";
    return "analog_sensor";
}
function diCat(prj, d, locks) {
    const t = d.desc || "";
    if (prj.program.estop === d.id)
        return "estop_button";
    if (locks.has(d.id))
        return has(t, /závor|mříž|curtain|lichtgitter|barrera|clona/) ? "light_curtain" : "safety_switch";
    if (has(t, /tlačítk|start|kvit|button|taster|pulsador|přepína|selector/))
        return "pushbutton";
    if (has(t, /hladin|kapacit|level|capacit/))
        return "sensor_capacitive";
    if (has(t, /optick|reflex|závor|fotobu|optical|light|licht|óptic/))
        return "sensor_optical";
    if (has(t, /koncák|koncov|limit|endschalter|final de carrera/))
        return "limit_switch";
    return "sensor_inductive";
}
function doCat(d) {
    const t = d.desc || "";
    if (d.role === "lock" || has(t, /zámek|zámk|lock|zuhalt|bloqueo/))
        return "safety_switch";
    if (has(t, /houkačk|siréna|horn|hupe|bocina|sirene/))
        return "horn";
    if (has(t, /maják|věž|beacon|signalsäule|baliza|signálka.*(zelen|červen|žlut)/))
        return "beacon";
    if (has(t, /signálk|kontrolk|pilot|leuchtmelder|piloto|indikac/))
        return "pilot_light";
    return "interface_relay";
}
function valveCats(d) {
    const t = d.desc || "";
    if (has(t, /hydraul/))
        return ["hydraulic_valve"];
    if (has(t, /přísav|vakuu|vacuum|sauger|ventosa/))
        return ["valve_solenoid"];
    if (has(t, /šoupát|klapk|kohout|uzávěr|potrubí|armatur|damper|klappe|schieber|válvula de proceso/))
        return ["process_valve"];
    return ["valve_solenoid", "cylinder"];
}
function motorCat(d) {
    const t = d.desc || "";
    if (has(t, /čerpadl|pump|pumpe|bomba/))
        return "pump";
    if (has(t, /dopravník|pás|conveyor|förder|transportad|převodov|gear/))
        return "gearmotor";
    return "motor";
}
function aoCat(d) {
    const t = d.desc || "";
    if (has(t, /ventil|tlak|valve|druck|válvula|presi/))
        return "proportional_valve";
    return "vfd";
}
/** Nabídka katalogu pro řádek kusovníku (kategorie + platforma). */
export function bomOptions(cat, plat) {
    return brandsFor(cat, plat).map(b => ({ id: brandOptId(b), brand: b }));
}
/** Výchozí platforma kusovníku: volba v `prj.bom`, jinak první zvolená platforma. */
export function bomPlatform(prj) {
    return hwPlatform(prj);
}
const DIR_TEXT = {
    DI: N_("{n} digitálních vstupů"), DO: N_("{n} digitálních výstupů"), AI: N_("{n} analogových vstupů"), AO: N_("{n} analogových výstupů"),
};
/** Popis řádku modulů: obsazené kanály skupiny podle směru (texty jsou klíče překladu). */
function modsDesc(mods) {
    return HW_DIRS.map(d => {
        const n = mods.reduce((s, m) => s + m.channels.filter(k => k.dir === d && k.io).length, 0);
        return n ? tr(DIR_TEXT[d], { n }) : "";
    }).filter(Boolean).join(", ");
}
const bomProviders = [];
/** Přihlásí zdroj dalších řádků kusovníku (`drop` = id řádků, které nahrazuje). Vrací odhlášení. */
export function registerBomProvider(fn, name) {
    const at = bomProviders.findIndex(p => p.name === name);
    if (at >= 0)
        bomProviders[at] = { name, fn };
    else
        bomProviders.push({ name, fn });
    return () => { const i = bomProviders.findIndex(p => p.name === name && p.fn === fn); if (i >= 0)
        bomProviders.splice(i, 1); };
}
/** Sestaví kusovník. Výsledek je deterministický (stejný projekt → stejné řádky). */
export function buildBom(prj) {
    const plat = bomPlatform(prj);
    const cfg = prj.bom || {};
    const locks = new Set(interlockDevs(prj).map(d => d.id));
    const raw = [];
    const add = (tag, cat, qty, desc, extra = {}) => {
        if (qty <= 0)
            return;
        /* kolize označení (např. M1 a P1 → oba -Q1; validateProject ji hlásí jako chybu): ID řádku musí zůstat
           jedinečné, jinak kusovník v UI spadne — druhý výskyt dostane příponu .2, .3 … */
        let tg = tag;
        for (let k = 2; raw.some(x => x.id === tg + ":" + cat); k++)
            tg = tag + "." + k;
        raw.push({ id: tg + ":" + cat, tag: tg, cat, qty, unit: tr("ks"), desc, note: "", ...extra });
    };
    const safetyNote = tr("Volba a zapojení podle posouzení rizik (EN ISO 13849) — návrh k revizi.");
    /* --- PLC: CPU, karty a vzdálené stanice = sestava hardwaru (hardware.ts), nic se nepočítá zvlášť */
    const L = hwLayout(prj, plat);
    const hwOf = (m) => ({ hw: { opt: m.opt, custom: m.custom } });
    const bi = L.modules.find(m => m.builtin);
    add("-A1", "plc_cpu", 1, PLAT[plat].name + " — " + PLAT[plat].cpu
        + (bi && bi.channels.some(k => k.io) ? " (" + tr("vestavěné I/O: {list}", { list: modsDesc([bi]) }) + ")" : ""), hwOf(L.cpu));
    for (const s of L.stations) {
        if (s.remote) {
            const ios = s.modules.filter(m => m.kind === "io");
            add(s.head.dt, "plc_coupler", 1, tr("Vzdálená stanice {dt}: {n} modulů, síť {net}", { dt: s.head.dt, n: ios.length, net: s.net || "—" }), hwOf(s.head));
            for (const a of s.modules.filter(m => m.kind === "acc" && m.cat === "plc_busadapter"))
                add(s.head.dt, a.cat, 1, tr("Připojení stanice {dt} na síť", { dt: s.head.dt }), hwOf(a));
            /* ET 200SP: každý modul na BaseUnit — první světlá (napájení skupiny), další tmavé */
            if (s.head.opt?.hw?.acc?.includes("plc_baseunit") && ios.length) {
                const first = brandsFor("plc_baseunit_first", plat)[0], next = brandsFor("plc_baseunit", plat)[0];
                add(s.head.dt, "plc_baseunit_first", 1, tr("Pod první modul stanice {dt}", { dt: s.head.dt }), { hw: { opt: first } });
                add(s.head.dt, "plc_baseunit", ios.length - 1, tr("Pod další moduly stanice {dt}", { dt: s.head.dt }), { hw: { opt: next } });
            }
        }
        /* karty po skupinách označení (-A2 = DI stanice CPU, -A12 = DI stanice 1 …) */
        const groups = new Map();
        for (const m of s.modules)
            if (m.kind === "io" && !m.builtin) {
                const k = m.bomTag + ":" + m.cat;
                groups.set(k, [...(groups.get(k) || []), m]);
            }
        for (const g of groups.values())
            add(g[0].bomTag, g[0].cat, g.length, modsDesc(g), hwOf(g[0]));
    }
    if (prj.program.modes !== false && plat !== "unitronics")
        add("-P1", "plc_hmi", 1, tr("Ovládání AUTO / START / kvitace, alarmy"));
    /* --- zařízení */
    let nMotor = 0;
    for (const d of prj.devices) {
        const t = "-" + d.name, desc = d.desc || d.name;
        if (d.cls === "Motor") {
            nMotor++;
            const n = d.name.replace(/^\D+/, "") || String(nMotor);
            add(t, motorCat(d), 1, desc, { devId: d.id });
            add("-Q" + n, "motor_protection", 1, tr("Jištění {dev}", { dev: d.name }), { devId: d.id, note: d.opt?.fault ? tr("pomocný kontakt = vstup poruchy") : "" });
            add("-K" + n, "contactor", 1, tr("Spínání {dev}", { dev: d.name }), { devId: d.id, note: d.opt?.fbk !== false ? tr("pomocný kontakt = zpětné hlášení běhu") : "" });
        }
        else if (d.cls === "Ventil") {
            const cats = valveCats(d);
            for (const c of cats)
                add(t, c, 1, desc, { devId: d.id });
            const sw = (d.opt?.fbkOpen !== false ? 1 : 0) + (d.opt?.fbkClosed ? 1 : 0);
            if (cats.includes("cylinder"))
                add(t, "cylinder_switch", sw, tr("Poloha {dev}", { dev: d.name }), { devId: d.id });
            else if (sw)
                add(t, "limit_switch", sw, tr("Koncové polohy {dev}", { dev: d.name }), { devId: d.id, note: tr("u procesní armatury často součástí pohonu") });
        }
        else if (d.cls === "AnalogIn") {
            add(t, analogCat(d), 1, desc + (d.unit ? " [" + d.unit + "]" : "") + " " + d.rmin + "–" + d.rmax, { devId: d.id });
        }
        else if (d.cls === "AnalogOut") {
            add(t, aoCat(d), 1, desc, { devId: d.id });
        }
        else if (d.cls === "Vfd") {
            /* měnič: motor (-M), řadič měniče (-TA, svorky řídicích signálů), jištění přívodu (-Q) */
            const n = d.name.replace(/^\D+/, "") || d.name;
            add(t, motorCat(d), 1, desc, { devId: d.id, note: tr("dimenzovat podle zátěže; motor pro provoz s měničem") });
            add("-" + devRef(d), "vfd", 1, tr("Řízení otáček {dev} ({min}–{max} {unit})", { dev: d.name, min: d.rmin, max: d.rmax, unit: d.unit || "" }).replace(/\s+\)/, ")"), { devId: d.id,
                note: tr("analogová žádaná, DI chod{rev}, reléové výstupy připraven / porucha / otáčky dosaženy", { rev: d.opt?.rev ? tr(" a směr") : "" }) });
            add("-Q" + n, "mcb", 1, tr("Jištění měniče {dev}", { dev: d.name }), { devId: d.id, note: tr("podle návodu měniče (jistič / pojistky, případně EMC filtr)") });
        }
        else if (d.cls === "PosDrive") {
            /* polohovací pohon: řadič se záznamy (-TA) a elektrická osa s motorem (-M) */
            add("-" + devRef(d), "positioning_drive", 1, tr("Řadič polohování {dev}: {n} záznamů přes I/O", { dev: d.name, n: maxRecord(d) }), { devId: d.id,
                note: tr("paralelní I/O: výběr záznamu, start, referování, HALT; tabulka záznamů v řadiči") });
            add(t, "linear_axis", 1, desc, { devId: d.id, note: (d.records || []).length ? tr("záznamy: {list}", { list: (d.records || []).map(r => r.no + " " + (r.name || "")).join(", ") }) : "" });
        }
        else if (d.cls === "Axis") {
            /* servoosa: servoměnič (-TA, uzel sítě) a servomotor (-M); mechanika osy (šroub / řemen) mimo rozsah */
            const c = axisCfgOf(d), dia = axisDialect(prj, plat);
            add("-" + devRef(d), "servo_drive", 1, tr("Servoměnič osy {dev} ({net})", { dev: d.name, net: dia ? AXIS_NET[dia] : tr("síť podle platformy") }), { devId: d.id,
                note: tr("objekt osy {obj}; STO na svorkách / bezpečná síť podle bezpečnostní funkce", { obj: axisObjName(d) }) });
            add(t, "servo_motor", 1, desc, { devId: d.id, note: tr("dimenzovat podle zátěže: max. {v} {u}/s, {a} {u}/s²; brzda u svislé osy", { v: c.vMax, a: c.aMax, u: d.unit || "mm" }) });
        }
        else if (d.cls === "PropValve") {
            add(t, "proportional_valve", 1, desc + (d.unit ? " [" + d.unit + "]" : "") + " " + d.rmin + "–" + d.rmax, { devId: d.id,
                note: ioOf(prj, d).rawAct ? tr("žádaná 0–10 V / 4–20 mA, analogový výstup skutečné hodnoty") : tr("žádaná 0–10 V / 4–20 mA") });
        }
        else if (d.cls === "DI") {
            const c = diCat(prj, d, locks);
            const safety = c === "estop_button" || c === "light_curtain" || c === "safety_switch";
            add(t, c, 1, desc, { devId: d.id, safety, note: safety ? safetyNote : "" });
        }
        else if (d.cls === "DO") {
            const c = doCat(d);
            add(t, c, 1, desc, { devId: d.id, safety: c === "safety_switch", note: c === "safety_switch" ? safetyNote : "" });
        }
    }
    /* --- rozvaděč */
    const sensors = prj.devices.filter(d => d.cls === "DI" || d.cls === "AnalogIn").length
        + prj.devices.filter(d => d.cls === "Ventil").reduce((a, d) => a + (d.opt?.fbkOpen !== false ? 1 : 0) + (d.opt?.fbkClosed ? 1 : 0), 0)
        + prj.devices.filter(d => d.cls === "PropValve" || d.cls === "PosDrive").length; // kabel M12 k ventilu, I/O kabel k řadiči pohonu
    const safetyDevs = (prj.program.estop ? 1 : 0) + locks.size;
    if (safetyDevs)
        add("-K0", "safety_relay", 1, tr("Vyhodnocení E-stopu a blokování"), { safety: true, note: safetyNote });
    add("-Q0", "main_switch", 1, tr("Hlavní vypínač rozvaděče"));
    add("-F1", "mcb", 2, tr("Jištění zdroje 24 V a řízení"));
    add("-T1", "power_supply_24v", 1, tr("Napájení PLC, snímačů a ventilů"), { note: tr("dimenzovat podle odběru") });
    add("-X1", "terminal_block", Math.ceil(prj.io.length * 1.2) + 10, tr("Svorky I/O a napájení"));
    add("-W1xx", "cable_sensor", sensors, tr("Připojení snímačů"));
    add("+1", "cabinet", 1, tr("Rozvaděč stroje"), { note: tr("velikost podle počtu modulů a stykačů") });
    /* --- řádky dalších modulů (bezpečnostní funkce…) */
    for (const p of bomProviders) {
        const r = p.fn(prj, plat);
        for (const id of r.drop || []) {
            const i = raw.findIndex(x => x.id === id);
            if (i >= 0)
                raw.splice(i, 1);
        }
        for (const e of r.add)
            if (e.qty > 0 && !raw.some(x => x.id === e.tag + ":" + e.cat))
                raw.push({ id: e.tag + ":" + e.cat, tag: e.tag, cat: e.cat, qty: e.qty, unit: tr("ks"), desc: e.desc, note: e.note || "", safety: e.safety, devId: e.devId, item: e.item, preset: e.preset });
    }
    /* --- značky z katalogu a volby uživatele */
    const lines = raw.map((r, i) => {
        const key = catKey(r.cat, plat);
        const brands = brandsFor(r.cat, plat);
        const pre = r.preset;
        let pickName = cfg.lines?.[r.id]?.brand ?? cfg.brand?.[key] ?? (pre?.brand && !brands.length ? pre.brand : undefined);
        /* bez volby uživatele: značka shodná s platformou PLC (Schneider → stykače Schneider), jinak první */
        const platBrand = PLAT[plat].name.split(" ")[0].toLowerCase();
        /* volba mimo katalog (vlastní značka) = žádná data z katalogu, jen to, co zadal uživatel;
           řádky PLC nesou položku zvolenou sestavou hardwaru (respektuje volby uživatele i rack) */
        let b = pickName !== undefined
            ? brands.find(x => brandOptId(x) === pickName) || brands.find(x => x.brand === pickName)
            : brands.find(x => x.brand.toLowerCase().startsWith(platBrand)) || brands[0];
        if (r.hw) {
            b = r.hw.opt;
            pickName = r.hw.custom ?? (b ? brandOptId(b) : pickName);
        }
        const custom = pickName !== undefined && !b;
        const over = cfg.lines?.[r.id] || {};
        const sup = (b?.suppliers?.[0] ? tr(b.suppliers[0]) : "") || (custom ? "" : tr(suppliersFor(key)[0]?.name || ""));
        /* typ od modulu (bez katalogu kategorie), dokud uživatel nezvolí jinou značku */
        const usePre = !!pre && custom && pickName === pre.brand;
        const { preset: _pre, item: ownItem, hw: _hw, ...rest } = r;
        return {
            ...rest,
            pos: i + 1,
            item: ownItem || tr(CAT_LABEL[r.cat] || r.cat),
            qty: Number.isFinite(over.qty) && over.qty >= 0 ? over.qty : r.qty,
            brand: custom ? pickName : b?.brand ?? "",
            type: over.type ?? (usePre ? pre.type || "" : b?.typical ? tr(b.typical) : (b?.series || []).map(x => tr(x)).join(" / ")),
            orderCode: over.orderCode ?? (usePre ? pre.orderCode || "" : b?.orderCode ?? ""),
            supplier: over.supplier ?? sup,
            note: [r.note, over.note].filter(Boolean).join("; "),
            optId: b ? brandOptId(b) : "",
            src: usePre ? pre.src || "" : b?.src || "",
            ...(Number.isFinite(over.qty) && over.qty === 0 ? { excluded: true } : {}),
        };
    }).filter(l => l.qty > 0 || l.excluded);
    lines.forEach((l, i) => { l.pos = i + 1; });
    return { plat, lines };
}
const csvCell = (v) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
/** CSV pro Excel (středník, UTF-8 s BOM — česká lokalizace Excelu). */
export function bomCsv(prj) {
    const lines = buildBom(prj).lines.filter(l => !l.excluded);
    const head = [tr("Pozice"), tr("Označení"), tr("Položka"), tr("Popis"), tr("Množství"), tr("Jednotka"),
        tr("Výrobce"), tr("Typ"), tr("Objednací kód"), tr("Dodavatel"), tr("Poznámka")];
    const rows = lines.map(l => [l.pos, l.tag, l.item, l.desc, l.qty, l.unit, l.brand, l.type, l.orderCode, l.supplier, l.note]);
    return "﻿" + [head, ...rows].map(r => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}
/** Sloupce tabulky kusovníku pro export (CSV i kopírování) — klíče překladu. */
const BOM_EXPORT_HEAD = [N_("Pozice"), N_("Označení"), N_("Položka"), N_("Popis"), N_("Množství"), N_("Jednotka"),
    N_("Výrobce"), N_("Typ"), N_("Objednací kód"), N_("Dodavatel"), N_("Poznámka")];
/**
 * Text tabulky ke kopírování (tabulátory, řádky \n) — Excel / e-mail. Stejné sloupce a řádky
 * jako `bomCsv` (řádky s množstvím 0 vyřazené); web i desktop volají tuto funkci, nic neskládají sami.
 */
export function bomTableText(prj) {
    const cell = (v) => String(v ?? "").replace(/[\t\r\n]+/g, " ");
    const rows = buildBom(prj).lines.filter(l => !l.excluded)
        .map(l => [l.pos, l.tag, l.item, l.desc, l.qty, l.unit, l.brand, l.type, l.orderCode, l.supplier, l.note]);
    return [BOM_EXPORT_HEAD.map(h => tr(h)), ...rows].map(r => r.map(cell).join("\t")).join("\n") + "\n";
}
/** Nejvyšší množství řádku kusovníku, které jde zadat ručně. */
export const BOM_QTY_MAX = 100000;
/**
 * Množství řádku kusovníku zadané uživatelem (text z pole nebo číslo): celé číslo 0…`BOM_QTY_MAX`
 * (0 = řádek vyřadit z CSV a dokumentu, zůstane v přehledu šedě). Prázdné pole = `reset` (zpět
 * na množství z návrhu). Jednotky kusovníku jsou kusy, proto jen celá čísla.
 */
export function bomQtyInput(v) {
    const s = typeof v === "number" ? String(v) : String(v ?? "").trim().replace(/\s/g, "").replace(",", ".");
    if (!s)
        return { reset: true };
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > BOM_QTY_MAX)
        return { error: tr("Množství zadej jako celé číslo 0 až {max}.", { max: BOM_QTY_MAX }) };
    return { qty: n };
}
/** Druhy dodavatelů z katalogu (data jsou česky) → klíč překladu. */
const SUP_KIND = {
    "distributor": N_("distributor"), "e-shop": N_("e-shop"), "výrobce": N_("výrobce"),
    "pobočka výrobce": N_("pobočka výrobce"), "pobočka výrobce (EU)": N_("pobočka výrobce (EU)"),
    "výrobce (evropská pobočka)": N_("výrobce (evropská pobočka)"),
};
/**
 * Přehled dodavatelů POUŽITÝCH v kusovníku (podklad k poptávce: koho oslovit a kolik položek).
 * Nabídku všech dodavatelů kategorie dává výběr u řádku. Dodavatelé u značek v katalogu jsou volný
 * text („Festo CZ (přímo)“) → shoda se seznamem dodavatelů i podle začátku jména.
 */
export function bomSuppliers(prj) {
    const lines = buildBom(prj).lines.filter(l => !l.excluded);
    const own = prj.bom?.lines || {};
    const used = [...new Set(lines.map(l => l.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const head = (s) => s.split(" (")[0].toLowerCase();
    return used.map(n => {
        const base = head(n);
        const s = SUPPLIERS.find(x => x.name === n || tr(x.name) === n) || SUPPLIERS.find(x => head(x.name) === base)
            || SUPPLIERS.find(x => base.length > 3 && (x.name.toLowerCase().startsWith(base) || base.startsWith(head(x.name))));
        const mine = lines.filter(l => l.supplier === n);
        return {
            name: n, url: s?.url || "",
            kind: s?.kind ? (SUP_KIND[s.kind] ? tr(SUP_KIND[s.kind]) : s.kind) : "",
            custom: !s && mine.some(l => own[l.id]?.supplier === n),
            rows: mine.length,
        };
    });
}
/** Kusovník do dokumentace (Markdown). */
export function bomMd(prj) {
    const { plat } = buildBom(prj);
    const lines = buildBom(prj).lines.filter(l => !l.excluded);
    const esc = (s) => String(s ?? "").replace(/\|/g, "/");
    const out = [
        "# " + tr("Kusovník komponent") + " — " + (prj.meta.name || ""),
        "",
        tr("Platforma řízení: **{plat}**. Značky a typy jsou typické volby z katalogu PLCdesk — podklad k poptávce, ne projekt elektro. Dimenzování a bezpečnostní prvky podle posouzení rizik ověří projektant (návrh k revizi).", { plat: PLAT[plat].name }),
        "",
        "| # | " + [tr("Označení"), tr("Položka"), tr("Popis"), tr("Ks"), tr("Výrobce"), tr("Typ"), tr("Objednací kód"), tr("Dodavatel")].join(" | ") + " |",
        "|---|---|---|---|---:|---|---|---|---|",
        ...lines.map(l => "| " + [l.pos, l.tag, l.item + (l.safety ? " ⚠" : ""), l.desc, l.qty, l.brand, l.type, l.orderCode, l.supplier].map(esc).join(" | ") + " |"),
        "",
    ];
    if (lines.some(l => l.safety))
        out.push("⚠ " + tr("Volba a zapojení podle posouzení rizik (EN ISO 13849) — návrh k revizi."), "");
    return out.join("\n");
}
