/**
 * PLCdesk — licence v aplikaci (tarify Free / Pro / Firma).
 *
 * Server (apps/site/worker: license.js `signLicense`, index.js /api/license/activate, /check) vydává
 * licenční soubor `<base64url(JSON)>.<base64url(podpis Ed25519)>`; JSON = `{ v, key, email, plan,
 * seats, exp, iat }`, `exp` = konec platnosti licence (server už k předplatnému přidává týden navíc).
 * Aplikace podpis ověří veřejným klíčem zabudovaným tady (`LICENSE_PUBLIC_KEYS`) — offline, bez sítě.
 * Síť je jen při vložení klíče (aktivace) a občas na pozadí (`/api/license/check`, stav předplatného);
 * výpadek sítě nikdy nic nezamyká. Zamyká se až zrušené předplatné (stav „canceled“ z kontroly).
 *
 * Co tarif odemyká (`entitlements`) — přesně podle ceníku na webu (apps/site/content/cs.json `cenik`):
 *   Free   projekty do `FREE_IO_LIMIT` I/O (64, `/api/config` free_io_limit), všechny generátory,
 *          simulace, dokumentace, bezpečnost, schvalování; dokumenty a README s patičkou PLCdesk;
 *          bez exportu DXF; vlastní šablony bloků firemní knihovny se do kódu nepoužijí.
 *   Pro    bez omezení velikosti, bez patičky, DXF; 1 počítač (počet míst hlídá server při aktivaci).
 *   Firma  vše z Pro, až 5 počítačů, firemní knihovna v generátoru (vlastní šablony bloků se
 *          stavovými slovy a firemní hlavička kódu i dokumentů).
 * Tarify vydávané jen správou zákazníků: `trial` = Pro na zkoušku, `free-unlock` = odemčení
 * velikosti projektu zdarma (Free bez limitu I/O, patička a bez DXF zůstávají).
 *
 * Výchozí výstup jádra se licencí NEMĚNÍ (golden test): patičku a poznámku o knihovně přidávají jen
 * funkce tohoto modulu, které volá klient (`licensedGen`, `licensedProjectFiles`, `applyLicenseToFile`).
 * Kód PLC se nikdy nemění — patička jde jen do dokumentů (.md, .html) a README.
 */
import { tr, trx, N_, getLang } from "./i18n.js";
import { devSignals } from "./model.js";
import { genFor } from "./codegen.js";
import { allProjectFiles } from "./docs.js";
/** Web PLCdesk (licenční API, ceník, kontakt). Shodné s `PUBLIC_SITE` ve wrangler.toml. */
export const LICENSE_SITE = "https://plcdesk.podlena-t.workers.dev";
/** Limit I/O tarifu Free, když `/api/config` není dostupné. */
export const FREE_IO_LIMIT = 64;
/** Tolerance po konci platnosti licence (server ji vrací v `/api/license/check` jako grace_days). */
export const GRACE_DAYS = 30;
/** Jak často se aplikace ptá serveru na stav licence (nejvýš jednou denně). */
export const LICENSE_CHECK_EVERY_MS = 24 * 3600 * 1000;
/**
 * Veřejné klíče Ed25519 pro ověření licencí — surových 32 B v base64 (výstup `apps/site/tools/keygen.js`,
 * „Veřejný klíč (raw 32 B base64) — do aplikace“). Víc klíčů = výměna klíče bez zneplatnění starých licencí.
 * Produkční klíč = pár k LICENSE_PRIVATE_KEY Workeru plcdesk (soukromý klíč je jen v secrets Workeru
 * a v záloze provozovatele, nikdy v repu). Bez platného klíče aplikace licenci neověří a běží jako Free.
 */
export const LICENSE_PUBLIC_KEYS = ["ZwHWUD6QiuGah8dNQ2kW0JLt9dxtOIt5Rnzpgfi0EgE="];
/* ---------------------------------------------------------------- base64url */
function b64urlDecode(s) {
    const t = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(t + "===".slice((t.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
/** Licenční klíč z e-mailu / ceníku (PLCD-XXXX-XXXX-XXXX-XXXX, bez I, O, 0, 1). */
export function isLicenseKey(s) {
    return /^PLCD-[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(String(s || "").trim().toUpperCase());
}
export function normLicenseKey(s) { return String(s || "").trim().toUpperCase(); }
/** Licenční soubor (jeden řádek s tečkou uprostřed) — jen tvar, ne podpis. */
export function isLicenseFile(s) {
    return /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}$/.test(String(s || "").trim());
}
/** Obsah licence BEZ ověření podpisu (jen pro zobrazení; o funkcích rozhoduje `verifyLicense`). */
export function readLicense(text) {
    const t = String(text || "").trim();
    if (!isLicenseFile(t))
        return null;
    try {
        const c = JSON.parse(new TextDecoder().decode(b64urlDecode(t.split(".")[0])));
        if (!c || typeof c !== "object" || typeof c.plan !== "string" || typeof c.exp !== "string" || isNaN(Date.parse(c.exp)))
            return null;
        return {
            v: Number(c.v) || 1, key: String(c.key || ""), email: String(c.email || ""), plan: c.plan,
            seats: Number.isInteger(c.seats) && c.seats > 0 ? c.seats : 1, exp: c.exp, iat: typeof c.iat === "string" ? c.iat : undefined,
            ...(Array.isArray(c.projects) ? { projects: c.projects.filter((x) => typeof x === "string") } : {}),
        };
    }
    catch {
        return null;
    }
}
/**
 * Ověří podpis licenčního souboru (WebCrypto Ed25519 — Node 20+, Chromium 137+, Firefox 129+, Safari 17+).
 * `keys` = veřejné klíče (raw 32 B base64); výchozí `LICENSE_PUBLIC_KEYS`.
 */
export async function verifyLicense(text, keys = LICENSE_PUBLIC_KEYS) {
    const t = String(text || "").trim();
    const claims = readLicense(t);
    if (!claims)
        return { ok: false, claims: null, error: "format" };
    if (!keys.length)
        return { ok: false, claims, error: "nokey" };
    const [p, s] = t.split(".");
    const subtle = globalThis.crypto?.subtle;
    if (!subtle)
        return { ok: false, claims, error: "crypto" };
    let cryptoOk = false;
    for (const k of keys) {
        try {
            const key = await subtle.importKey("raw", b64urlDecode(k), { name: "Ed25519" }, false, ["verify"]);
            cryptoOk = true;
            if (await subtle.verify({ name: "Ed25519" }, key, b64urlDecode(s), b64urlDecode(p)))
                return { ok: true, claims };
        }
        catch { /* jiný klíč / prostředí bez Ed25519 */ }
    }
    return { ok: false, claims, error: cryptoOk ? "signature" : "crypto" };
}
/* ---------------------------------------------------------------- tarify */
const PLAN_LABEL = { free: "Free", pro: "Pro", firma: N_("Firma"), trial: N_("Pro (zkušební)"), "free-unlock": N_("Free – odemčení") };
export function planLabel(plan) {
    const l = PLAN_LABEL[plan || "free"];
    return l ? tr(l) : String(plan);
}
/** Co tarif odemyká. `ioLimit` = limit Free (z `/api/config`, jinak 64). */
export function entitlements(plan, ioLimit = FREE_IO_LIMIT) {
    const lim = Number.isInteger(ioLimit) && ioLimit > 0 ? ioLimit : FREE_IO_LIMIT;
    if (plan === "firma")
        return { plan: "firma", ioLimit: null, footer: false, dxf: true, library: true, seats: 5 };
    if (plan === "pro" || plan === "trial")
        return { plan: "pro", ioLimit: null, footer: false, dxf: true, library: false, seats: 1 };
    if (plan === "free-unlock")
        return { plan: "free", ioLimit: null, footer: true, dxf: false, library: false, seats: 1 };
    return { plan: "free", ioLimit: lim, footer: true, dxf: false, library: false, seats: 1 };
}
const DAY = 864e5;
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
/**
 * Stav licence k okamžiku `now`: ověřený soubor (`check` z `verifyLicense`) + poslední odpověď
 * serveru (`remote`, nepovinná). Platí do `exp`, pak ještě `GRACE_DAYS` dní (tolerance), pak Free.
 * Zrušené předplatné (`remote.status === "canceled"`) = Free hned. Bez sítě se nic nemění.
 */
export function licenseState(check, now = Date.now(), remote = null, ioLimit = FREE_IO_LIMIT) {
    const t = typeof now === "number" ? now : now.getTime();
    const free = entitlements("free", ioLimit);
    const base = { licPlan: null, key: null, email: null, seats: 1, exp: null, graceUntil: null, daysLeft: null, pastDue: false, projects: [] };
    const freeText = tr("Tarif Free: projekty do {n} I/O, dokumenty s patičkou PLCdesk, bez exportu DXF.", { n: free.ioLimit ?? FREE_IO_LIMIT });
    if (!check || !check.claims) {
        if (check && check.error)
            return { ...base, state: "invalid", plan: "free", planLabel: "Free", ent: free, message: licenseErrorText(check.error) + " " + freeText };
        return { ...base, state: "none", plan: "free", planLabel: "Free", ent: free, message: freeText };
    }
    const c = check.claims;
    const info = { ...base, licPlan: c.plan, key: c.key || null, email: c.email || null, seats: c.seats, exp: c.exp, projects: c.projects || [] };
    if (!check.ok)
        return { ...info, state: "invalid", plan: "free", planLabel: "Free", ent: free, message: licenseErrorText(check.error || "signature") + " " + freeText };
    const exp = Date.parse(c.exp), grace = exp + GRACE_DAYS * DAY;
    const lbl = planLabel(c.plan);
    const graceUntil = new Date(grace).toISOString();
    const pastDue = remote?.status === "past_due";
    if (remote?.status === "canceled") {
        return { ...info, graceUntil, state: "canceled", plan: "free", planLabel: "Free", ent: free, message: tr("Licence {plan} byla zrušena — aplikace běží v tarifu Free.", { plan: lbl }) + " " + freeText };
    }
    if (t <= exp) {
        const ent = entitlements(c.plan, ioLimit);
        return { ...info, graceUntil, pastDue, state: "active", plan: ent.plan, planLabel: lbl, ent, daysLeft: Math.ceil((exp - t) / DAY),
            message: tr("Licence {plan} platí do {date}.", { plan: lbl, date: isoDate(exp) }) + (pastDue ? " " + tr("Poslední platba se nezdařila — licence zatím platí dál.") : "") };
    }
    if (t <= grace) {
        const ent = entitlements(c.plan, ioLimit);
        return { ...info, graceUntil, pastDue, state: "grace", plan: ent.plan, planLabel: lbl, ent, daysLeft: Math.ceil((grace - t) / DAY),
            message: tr("Období licence {plan} skončilo {date}; licence platí ještě do {until} (tolerance {n} dní). Prodluž předplatné a licenci znovu aktivuj.", { plan: lbl, date: isoDate(exp), until: isoDate(grace), n: GRACE_DAYS }) };
    }
    return { ...info, graceUntil, state: "expired", plan: "free", planLabel: "Free", ent: free,
        message: tr("Licence {plan} vypršela {date} (i s tolerancí {n} dní) — aplikace běží v tarifu Free.", { plan: lbl, date: isoDate(grace), n: GRACE_DAYS }) + " " + freeText };
}
export function licenseErrorText(err) {
    if (err === "nokey")
        return tr("Tahle verze aplikace nemá veřejný klíč pro ověření licencí — licenci zatím nejde použít.");
    if (err === "crypto")
        return tr("Prostředí neumí ověřit podpis Ed25519 — aktualizuj prohlížeč (Chrome / Edge 137+, Firefox 129+, Safari 17+).");
    if (err === "format")
        return tr("Text není licenční soubor PLCdesk (jeden řádek s tečkou uprostřed).");
    return tr("Podpis licence nesedí — soubor je poškozený nebo upravený.");
}
/* ---------------------------------------------------------------- projekt */
/** Počet I/O projektu = signály všech zařízení (DI, DO, AI, AO; servoosa po síti žádné). */
export function projectIoCount(prj) {
    return (prj.devices || []).reduce((s, d) => s + devSignals(d).length, 0);
}
/**
 * Co je pro projekt povolené. `unlocks` = GUID odemčených projektů (z licence nebo od klienta).
 * Nad limitem bez odemčení: náhled ano, stažení a uložení výstupů ne.
 */
export function projectGate(prj, ent, unlocks = []) {
    const io = projectIoCount(prj);
    const set = new Set(unlocks);
    const unlocked = !!prj.guid && set.has(prj.guid);
    const over = ent.ioLimit != null && io > ent.ioLimit && !unlocked;
    const reasons = [];
    if (over)
        reasons.push(tr("Projekt má {io} I/O, tarif Free povoluje {n}. Náhled funguje, stažení a ukládání výstupů ne — vlož licenci Pro nebo Firma, nebo si nech první projekt nad limit odemknout zdarma.", { io, n: ent.ioLimit }));
    return { io, limit: ent.ioLimit, unlocked, over, canExport: !over, canDxf: !over && ent.dxf, footer: ent.footer, library: ent.library, plan: ent.plan, reason: reasons.join(" ") };
}
/** Odkaz na stránku webu v jazyce UI (web má cs / en / de, ostatní anglicky). `page` = cenik | kontakt | stazeni. */
export function licenseSiteUrl(page, lang = getLang(), site = LICENSE_SITE) {
    const s = (site || LICENSE_SITE).replace(/\/+$/, "");
    return lang === "cs" ? s + "/" + page + "/" : s + "/" + (lang === "de" ? "de" : "en") + "/" + page + "/";
}
/* ---------------------------------------------------------------- výstupy */
/** Druh souboru z pohledu licence: dokument (patička), DXF, projekt / knihovna (vždy volně), ostatní výstup. */
export function licenseFileKind(name) {
    const n = String(name || "").toLowerCase();
    if (n.endsWith(".plcstudio.json") || n.endsWith(".plcdesk-library.json"))
        return "own";
    if (n.endsWith(".dxf"))
        return "dxf";
    /* README platforem i dílčí README s příponou názvu (README_EPLAN.txt, hmi_siemens_README_HMI.txt) */
    if (/(^|[_/\\])readme(\.[a-z]+)?$/.test(n) || /(^|[_/\\])readme([_.-][a-z0-9]+)*\.(txt|md)$/.test(n))
        return "readme";
    if (n.endsWith(".md") || n.endsWith(".html") || n.endsWith(".htm"))
        return "doc";
    return "out";
}
const isAscii = (s) => /^[\x00-\x7F]*$/.test(s);
const toAscii = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7F]/g, "?");
/** Patička Free pro soubor `name` (prázdná, když se soubor patičkou neoznačuje). */
export function licenseFooter(name, body = "") {
    const kind = licenseFileKind(name);
    if (kind !== "doc" && kind !== "readme")
        return "";
    const n = name.toLowerCase();
    const nl = body.includes("\r\n") ? "\r\n" : "\n";
    if (n.endsWith(".html") || n.endsWith(".htm")) {
        return "<p style=\"margin:24px 0 8px;font:12px sans-serif;color:#667\">" + esc(tr("Vytvořeno v PLCdesk Free — {url}", { url: LICENSE_SITE })) + "</p>";
    }
    if (n.endsWith(".md"))
        return nl + nl + "---" + nl + "*" + tr("Vytvořeno v PLCdesk Free — {url}", { url: LICENSE_SITE }) + "*" + nl;
    /* README .txt: ASCII výstupy (Unitronics…) zůstanou ASCII */
    const text = isAscii(body) ? toAscii(trx("Vytvořeno v PLCdesk Free — {url}", { url: LICENSE_SITE })) : tr("Vytvořeno v PLCdesk Free — {url}", { url: LICENSE_SITE });
    return nl + nl + "-----" + nl + text + nl;
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Patička do těla souboru (HTML před `</body>`, jinak na konec). */
export function addLicenseFooter(name, body) {
    const f = licenseFooter(name, body);
    if (!f)
        return body;
    if (/\.html?$/i.test(name)) {
        const i = body.toLowerCase().lastIndexOf("</body>");
        return i >= 0 ? body.slice(0, i) + f + "\n" + body.slice(i) : body + f;
    }
    return body.replace(/\s+$/, "") + f;
}
/**
 * Soubor pro uložení / stažení podle brány projektu: `{ body }` (s patičkou u Free) nebo
 * `{ blocked }` s přeloženým důvodem. Projekt a firemní knihovna (.plcstudio.json, .plcdesk-library.json)
 * se ukládají vždy — jsou to data uživatele, ne výstupy.
 */
export function applyLicenseToFile(name, body, gate) {
    const kind = licenseFileKind(name);
    if (!gate || kind === "own")
        return { body };
    if (gate.over)
        return { blocked: gate.reason };
    if (kind === "dxf" && !gate.canDxf)
        return { blocked: tr("Export DXF je v tarifu Pro a Firma. Výkres si prohlédni v náhledu nebo ulož jako SVG.") };
    return { body: gate.footer ? addLicenseFooter(name, body) : body };
}
/** Projekt, ze kterého se generuje: bez tarifu Firma bez vlastních šablon bloků a firemní hlavičky knihovny. */
export function licensedProject(prj, gate) {
    const lib = prj.library;
    if (!gate || gate.library || !lib || (!(lib.fbTemplates || []).length && !lib.company))
        return { prj, libraryBlocked: null };
    const { fbTemplates: _t, company: _c, ...rest } = lib;
    const name = ((lib.name || "") + " " + (lib.version || "")).trim();
    return { prj: { ...prj, library: { ...rest, fbTemplates: [] } }, libraryBlocked: name || tr("knihovna") };
}
/** Upozornění do README, že firemní knihovna nebyla použita (prázdné, když použita byla). */
export function libraryBlockedNote(libName, body = "") {
    if (!libName)
        return "";
    const nl = body.includes("\r\n") ? "\r\n" : "\n";
    const t = trx("FIREMNÍ KNIHOVNA {name} NEPOUŽITA: vlastní šablony bloků a firemní hlavička jsou v tarifu Firma. Kód je vygenerovaný s vestavěnými bloky PLCdesk.", { name: libName });
    return (isAscii(body) ? toAscii(t) : t) + nl + nl;
}
/** Výstupy platformy podle licence (`genFor` nad `licensedProject` + poznámka do README). Bez brány = `genFor`. */
export function licensedGen(prj, plat, gate) {
    const lp = licensedProject(prj, gate);
    const files = genFor(lp.prj, plat);
    if (lp.libraryBlocked && files["README.txt"] != null)
        files["README.txt"] = libraryBlockedNote(lp.libraryBlocked, files["README.txt"]) + files["README.txt"];
    return files;
}
/** Sada souborů projektu podle licence (`allProjectFiles` nad `licensedProject` + poznámka do README). */
export function licensedProjectFiles(prj, gate) {
    const lp = licensedProject(prj, gate);
    const files = allProjectFiles(lp.prj);
    if (lp.libraryBlocked)
        for (const f of files)
            if (/README\.txt$/.test(f.save))
                f.body = libraryBlockedNote(lp.libraryBlocked, f.body) + f.body;
    return files;
}
