/**
 * PLCdesk — vícejazyčnost.
 *
 * Zdrojový jazyk je čeština: český text ve zdrojovém kódu je zároveň klíčem překladu
 * (`tr("Krok {n}: {title}", { n, title })`). Chybějící překlad se vrátí česky, takže
 * nepřeložený text nikdy nic nerozbije. Katalogy `i18n/<jazyk>.ts` sdílí jádro, web
 * i desktop; udržuje je `scripts/i18n.py` (sběr klíčů, kontrola úplnosti).
 *
 * Jazyk je stav modulu (`setLang`) — jádro je jednovláknové a každý klient (prohlížeč,
 * proces mostu desktopu) má svou instanci.
 */
import en from "./i18n/en.js";
import de from "./i18n/de.js";
import es from "./i18n/es.js";
import zh from "./i18n/zh.js";
/** Podporované jazyky a jejich názvy (v daném jazyce, pro přepínač). */
export const LANGS = {
    cs: "Čeština", en: "English", de: "Deutsch", es: "Español", zh: "中文",
};
const DICT = { en, de, es, zh };
let lang = "cs";
export function isLang(l) {
    return typeof l === "string" && Object.prototype.hasOwnProperty.call(LANGS, l);
}
/** Nastaví jazyk výstupů; neznámý kód = čeština. Vrací skutečně nastavený jazyk. */
export function setLang(l) {
    lang = isLang(l) ? l : "cs";
    return lang;
}
export function getLang() { return lang; }
/** Jazyk technických výstupů (viz `trx`): čínština se nahrazuje angličtinou. */
export function techLang() { return lang === "zh" ? "en" : lang; }
/** Dosadí `{jméno}` z `p`; neznámé zástupné znaky nechá být. */
export function fill(s, p) {
    if (!p)
        return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => Object.prototype.hasOwnProperty.call(p, k) ? String(p[k] ?? "") : m);
}
/** Překlad českého textu `cs` do jazyka `l` (bez překladu vrací češtinu). */
export function trIn(l, cs, p) {
    const d = l === "cs" ? undefined : DICT[l];
    const s = d && Object.prototype.hasOwnProperty.call(d, cs) && d[cs] ? d[cs] : cs;
    return fill(s, p);
}
/** Překlad do nastaveného jazyka — texty UI, dokumentace, hlášení simulace, diagramy. */
export function tr(cs, p) {
    return trIn(lang, cs, p);
}
/**
 * Překlad pro technické výstupy, které musí zůstat v latince: komentáře v generovaném
 * kódu PLC a texty výkresů (SVG sdílí geometrii s DXF R12). Při čínštině vrací angličtinu.
 */
export function trx(cs, p) {
    return trIn(techLang(), cs, p);
}
/**
 * Značka pro sběr klíčů: text v tabulce / konstantě, který se překládá až při použití
 * (`tr(CLS[c].label)`). Sama nic nepřekládá.
 */
export function N_(cs) { return cs; }
const LOCALE = { cs: "cs-CZ", en: "en-GB", de: "de-DE", es: "es-ES", zh: "zh-CN" };
/** Dnešní datum ve zvyklosti nastaveného jazyka; `tech` = pro technické výstupy (viz `trx`). */
export function today(tech = false) {
    return new Date().toLocaleDateString(LOCALE[tech ? techLang() : lang]);
}
/** Datum z ISO okamžiku ve zvyklosti nastaveného jazyka (neplatný vstup vrátí beze změny). */
export function formatDate(iso, tech = false) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso ?? "") : d.toLocaleDateString(LOCALE[tech ? techLang() : lang]);
}
/** Datum a čas (hodiny:minuty, místní čas) z ISO okamžiku ve zvyklosti nastaveného jazyka. */
export function formatDateTime(iso, tech = false) {
    const d = new Date(iso);
    if (isNaN(d.getTime()))
        return String(iso ?? "");
    return d.toLocaleString(LOCALE[tech ? techLang() : lang], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
/** Provede `fn` s dočasně přepnutým jazykem (např. dokumentace v jiném jazyce než UI). */
export function withLang(l, fn) {
    const prev = lang;
    setLang(l);
    try {
        return fn();
    }
    finally {
        lang = prev;
    }
}
/** Celý katalog jazyka (český text → překlad) — pro klienty s vlastním UI (desktop). */
export function catalog(l) {
    return isLang(l) && l !== "cs" ? DICT[l] : {};
}
