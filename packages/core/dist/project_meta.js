import { stripDia, PROJECT_NUMBER_RE } from "./model.js";
import { tr, formatDate, dateLocale } from "./i18n.js";
/** Jeden řádek: řídicí znaky a zalomení → mezera, ořez. */
const CTRL = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127, 0x2028, 0x2029) + "]+", "g");
export function oneLine(s) {
    return String(s ?? "").replace(CTRL, " ").replace(/ {2,}/g, " ").trim();
}
/** Platné datum ISO „YYYY-MM-DD“ (skutečný den v kalendáři)? */
export function isIsoDate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s))
        return false;
    const [y, m, d] = s.split("-").map(Number);
    const t = new Date(y, m - 1, d);
    return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}
/** Datum ISO „YYYY-MM-DD“ ve zvyklosti jazyka (`tech` = technické výstupy, výkresy); neplatné "". */
export function formatIsoDate(s, tech = false) {
    return isIsoDate(s) ? formatDate(s + "T12:00:00", tech) : ""; // poledne: bez posunu dne časovým pásmem
}
/**
 * Datum zadané člověkem → ISO „YYYY-MM-DD“ ("" = nerozpoznáno). Bere ISO i zápis podle jazyka
 * (pořadí den / měsíc / rok z `formatIsoDate`, oddělovač libovolný: 8. 10. 2026, 08/10/2026, 2026/10/8).
 */
export function parseUserDate(text) {
    const s = String(text ?? "").trim();
    if (!s)
        return "";
    if (isIsoDate(s))
        return s;
    const nums = s.match(/\d+/g);
    if (!nums || nums.length !== 3)
        return "";
    /* pořadí částí podle jazyka: zformátovat známé datum a najít v něm den (22), měsíc (11) a rok (2033) */
    const probe = formatIsoDate("2033-11-22");
    const pos = { d: probe.indexOf("22"), m: probe.indexOf("11"), y: probe.indexOf("2033") };
    const order = Object.keys(pos).filter(k => pos[k] >= 0).sort((a, b) => pos[a] - pos[b]);
    const seq = order.length === 3 ? order : ["d", "m", "y"];
    const v = {};
    /* rok napřed (2026-10-08 s jiným oddělovačem) má přednost */
    const parts = nums[0].length === 4 ? ["y", "m", "d"] : [...seq];
    parts.forEach((k, i) => { v[k] = Number(nums[i]); });
    if (v.y < 100)
        v.y += 2000;
    const iso = String(v.y).padStart(4, "0") + "-" + String(v.m).padStart(2, "0") + "-" + String(v.d).padStart(2, "0");
    return isIsoDate(iso) ? iso : "";
}
/** Popisky kalendáře podle jazyka (výběr data v desktopu): názvy měsíců a dnů v týdnu od pondělí. */
export function calendarLabels() {
    const loc = dateLocale();
    const months = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1, 12).toLocaleDateString(loc, { month: "long" }));
    /* 2026-10-05 je pondělí */
    const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 5 + i, 12).toLocaleDateString(loc, { weekday: "short" }));
    return { months, weekdays, locale: loc };
}
/** Číslo projektu, zákazník (jednořádkově) a datum zahájení (ISO, jen platné); prázdné = "". */
export function projectRef(prj) {
    const m = prj.meta || {};
    return { number: oneLine(m.number), customer: oneLine(m.customer), startDate: isIsoDate(m.startDate) ? m.startDate : "" };
}
/** Řádek Markdownu pod nadpis dokumentu („**Číslo projektu:** … · **Zákazník:** …“); bez údajů "". */
export function projectMetaMd(prj) {
    const { number, customer, startDate } = projectRef(prj);
    const out = [];
    if (number)
        out.push(tr("**Číslo projektu:** {v}", { v: mdInline(number) }));
    if (customer)
        out.push(tr("**Zákazník:** {v}", { v: mdInline(customer) }));
    if (startDate)
        out.push(tr("**Zahájení projektu:** {v}", { v: formatIsoDate(startDate) }));
    return out.join(" · ");
}
/** Řádek README (prostý text) pod řádek PROJEKT; bez údajů "". */
export function projectMetaText(prj) {
    const { number, customer, startDate } = projectRef(prj);
    const out = [];
    if (number)
        out.push(tr("ČÍSLO PROJEKTU: {v}", { v: number }));
    if (customer)
        out.push(tr("ZÁKAZNÍK: {v}", { v: customer }));
    if (startDate)
        out.push(tr("ZAHÁJENÍ PROJEKTU: {v}", { v: formatIsoDate(startDate) }));
    return out.join(" · ");
}
/** Titulek pro okno / záhlaví: „číslo · název · zákazník“ (jen vyplněné části). */
export function projectTitle(prj) {
    const { number, customer } = projectRef(prj);
    return [number, oneLine(prj.meta?.name), customer].filter(Boolean).join(" · ");
}
/** Text pro jednořádkové místo v Markdownu (buňka, hlavička): svislítko a hvězdičky neutralizovat. */
function mdInline(s) {
    return s.replace(/\|/g, "\\|");
}
/**
 * Víceřádkový popis do Markdownu: prázdný řádek = nový odstavec (zůstává), jednotlivé zalomení
 * = tvrdé zalomení řádku (dvě mezery). Jednořádkový text vrací beze změny (golden).
 */
export function mdMultiline(s) {
    if (!/[\r\n]/.test(s))
        return s;
    const lines = s.replace(/\r\n?/g, "\n").split("\n").map(l => l.replace(/\s+$/, ""));
    while (lines.length && !lines[lines.length - 1])
        lines.pop();
    while (lines.length && !lines[0])
        lines.shift();
    const out = [];
    lines.forEach((l, i) => {
        const next = lines[i + 1];
        out.push(l && next ? l + "  " : l);
    });
    return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
/** První neprázdný řádek textu (pro místa na jeden řádek: popisová pole, komentáře), volitelně zkrácený. */
export function firstLine(s, max) {
    const l = String(s ?? "").split(/\r\n?|\n/).map(x => x.trim()).find(Boolean) || "";
    return max && l.length > max ? l.slice(0, Math.max(1, max - 1)).trimEnd() + "…" : l;
}
/** Část názvu souboru: bez diakritiky, jen [A-Za-z0-9._-], bez teček / podtržítek na krajích. */
export function fileSafe(s, max = 60) {
    return stripDia(oneLine(s)).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_{2,}/g, "_")
        .replace(/^[._-]+|[._-]+$/g, "").slice(0, max).replace(/[._-]+$/g, "");
}
/** Prefix názvů ukládaných souborů „<číslo>_“ (bez čísla ""). Nepřidá se dvakrát (`withFilePrefix`). */
export function projectFilePrefix(prj) {
    const n = fileSafe(projectRef(prj).number, 40);
    return n ? n + "_" : "";
}
/** Název souboru s prefixem čísla projektu (jen když ho ještě nemá). */
export function withFilePrefix(prj, name) {
    const p = projectFilePrefix(prj);
    return p && !name.startsWith(p) ? p + name : name;
}
/**
 * Výchozí název souboru projektu: „<číslo>_<název>.plcstudio.json“. Název jen bez znaků, které
 * Windows v názvu souboru nedovolí (diakritika zůstává); bez názvu „plc-projekt“.
 */
export function projectFileName(prj, ext = ".plcstudio.json") {
    const base = oneLine(prj.meta?.name).replace(/[<>:"/\\|?*]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 80);
    return withFilePrefix(prj, (base || "plc-projekt") + ext);
}
/* ================================================================ číslo projektu a projektová složka */
/**
 * Číslo projektu ve tvaru „RRNNNN“ (6 číslic: RR = rok, NNNN = pořadí v roce, např. 260705 = 2026,
 * projekt 705)? Prázdné = false. Jiné řady (např. 76NNNN) zadává uživatel ručně — platné jsou,
 * pokud mají 6 číslic.
 */
export function isProjectNumber(s) {
    return PROJECT_NUMBER_RE.test(oneLine(s));
}
/** Upozornění ke tvaru čísla (prázdné nebo 6 číslic = ""). Jen varuje — číslo se použije, jak je. */
export function projectNumberProblem(s) {
    const v = oneLine(s);
    return !v || PROJECT_NUMBER_RE.test(v) ? "" : tr("Číslo projektu nemá tvar RRNNNN (6 číslic: rok a pořadí, např. 260705) — použije se tak, jak je zapsané.");
}
/**
 * Návrh dalšího volného čísla projektu letošní řady. `existing` = dřív použitá čísla nebo názvy
 * projektových složek („260705_Lis…“ — bere se úvodních 6 číslic před „_“ nebo koncem).
 *
 * Řada roku RR = RR0001…RR9999; po vyčerpání (RR9999) pokračuje přetoková řada RR+50
 * (2026: 260001 … 269999 → 760001 …; 2027: 27xxxx → 77xxxx). Jakmile v přetokové řadě něco je,
 * navrhne se její další číslo. Bez čísel letošní řady RR0001. Vyčerpaná i přetoková řada
 * (nebo rok s RR ≥ 50, kdy RR+50 nemá dvě číslice) → "" (bez návrhu, uživatel zadá ručně).
 */
export function nextProjectNumber(existing, year = new Date().getFullYear()) {
    const rr = ((Math.trunc(year) % 100) + 100) % 100;
    const ov = rr < 50 ? rr + 50 : -1;
    let base = 0, over = 0;
    for (const x of existing) {
        const m = /^(\d{2})(\d{4})(?:_|$)/.exec(oneLine(x));
        if (!m)
            continue;
        const s = Number(m[1]), n = Number(m[2]);
        if (s === rr)
            base = Math.max(base, n);
        else if (s === ov)
            over = Math.max(over, n);
    }
    const fmt = (s, n) => String(s).padStart(2, "0") + String(n).padStart(4, "0");
    if (over > 0)
        return over < 9999 ? fmt(ov, over + 1) : "";
    if (base < 9999)
        return fmt(rr, base + 1);
    return ov >= 0 ? fmt(ov, 1) : "";
}
/** Část názvu složky / souboru: bez diakritiky, mezery a ostatní znaky → „_“, jen [A-Za-z0-9_-]. */
export function folderSafe(s, max = 60) {
    return stripDia(oneLine(s)).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/_{2,}/g, "_")
        .replace(/^[_-]+|[_-]+$/g, "").slice(0, max).replace(/[_-]+$/g, "");
}
/**
 * Název projektové složky „<číslo>_<Název>“ (název bez diakritiky, mezery → _, jen [A-Za-z0-9_-],
 * nejvýš 60 znaků); bez čísla jen „<Název>“, bez názvu jen číslo, bez obojího „plc-projekt“.
 * Soubor projektu ve složce se jmenuje stejně (+ `.plcstudio.json`).
 */
export function projectFolderName(prj) {
    const num = projectFilePrefix(prj).replace(/_$/, "");
    let name = folderSafe(prj.meta?.name, 400);
    if (name.length > 60) { // zkrátit na celé slovo, je-li rozumně dlouhé
        const cut = name.slice(0, 61), at = cut.lastIndexOf("_");
        name = (at >= 30 ? cut.slice(0, at) : name.slice(0, 60)).replace(/[_-]+$/g, "");
    }
    return [num, name].filter(Boolean).join("_") || "plc-projekt";
}
