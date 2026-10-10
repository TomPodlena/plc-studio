/**
 * Balík k ověření pro beta testery — platformy se stavem `beta` (data/verification.json) ověří lidé,
 * kteří mají IDE výrobce oficiálně (TIA Portal, Studio 5000, GX Works3, Sysmac Studio…).
 *
 * Balík = výstupy `genFor` pro reprezentativní vzory (malý stroj, pohony přes I/O — vzor 11,
 * velký stroj, servoosa — vzor 12 jen kde ji platforma podporuje; u platforem s OOP i podoba OOP),
 * návod `NAVOD.md` (navádí na README platformy — postup importu se tu NEOPISUJE), šablona protokolu
 * `PROTOKOL.md` a `MANIFEST.json` (verze, platforma, stav ověření, otisky SHA-256 všech souborů).
 *
 * Není to export projektu uživatele (vzory jsou pevné) → licenční brána ho neblokuje.
 * ZIP skládá klient přes `verifyPackZip` (ZIP „stored“ z hmi_xlsx.ts) — jádro zůstává bez závislostí.
 * Otisky přes WebCrypto (`crypto.subtle.digest`) → funkce je asynchronní; všechny výstupy (i datum)
 * se ale počítají synchronně před prvním `await` (test s pevným časem).
 */
import { tr } from "./i18n.js";
import { PLAT, blankProject, syncIO, supportsOop } from "./model.js";
import { genFor } from "./codegen.js";
import { sampleSmall, sampleComplex } from "./samples.js";
import { axisSupport } from "./axis_gen.js";
import { verificationInfo } from "./verification.js";
import { licenseSiteUrl } from "./license.js";
import { zipStored } from "./hmi_xlsx.js";
import { VP_SAMPLE_PS11, VP_SAMPLE_PM12 } from "./verify_pack_samples.js";
/** Verze PLCdesk (shodná s packages/core/package.json a apps/desktop/plc_studio/__init__.py — hlídá test). */
export const PLCDESK_VERSION = "0.2.1";
/** Formát manifestu balíku (zvýšit při nekompatibilní změně). */
export const VERIFY_PACK_SCHEMA = 1;
/** Projekt z uložených dat vzoru (jako goldenProject), s jedinou platformou balíku. */
function fromData(raw) {
    return Object.assign(blankProject(), JSON.parse(JSON.stringify(raw)));
}
const SAMPLES = [
    { dir: "01_small_machine", source: "sampleSmall", make: sampleSmall,
        describe: (devs, steps) => tr("Malý stroj: {devs} zařízení, {steps} kroků sekvence — čerpadlo, ventil, analogy (vestavěná ukázka, texty v jazyce balíku).", { devs, steps }) },
    { dir: "02_drives_PS-11", source: "samples/11_podavaci_lisovaci_stanice_PS-11.plcstudio.json", make: () => fromData(VP_SAMPLE_PS11),
        describe: (devs, steps) => tr("Pohony přes I/O: frekvenční měnič, polohovací pohon se záznamy, proporcionální ventil — {devs} zařízení, {steps} kroků (vzor PS-11, obsah projektu česky).", { devs, steps }) },
    { dir: "03_large_machine_LL-03", source: "sampleComplex", make: sampleComplex,
        describe: (devs, steps) => tr("Velký stroj: {devs} zařízení, {steps} kroků sekvence, dvouruční spouštění, kryty (vestavěná ukázka, texty v jazyce balíku).", { devs, steps }) },
    { dir: "04_servo_axis_PM-12", source: "samples/12_portalovy_manipulator_PM-12.plcstudio.json", make: () => fromData(VP_SAMPLE_PM12), axis: true,
        describe: (devs, steps) => tr("Servoosa po síti (PLCopen Motion): portálový manipulátor — {devs} zařízení, {steps} kroků (vzor PM-12, obsah projektu česky).", { devs, steps }) },
];
/** Kde v IDE najít verzi, překlad a výpis hlášení (názvy nabídek IDE jsou technické — anglicky). */
const IDE_HINTS = {
    siemens: { about: "Help → Installed software", build: "PLC → Compile → Software (rebuild all blocks)", msgs: "Inspector window → Info → Compile" },
    rockwell: { about: "Help → About Logix Designer", build: "Logic → Verify → Controller", msgs: "View → Errors" },
    mitsubishi: { about: "Help → Version Information", build: "Convert → Rebuild All", msgs: "View → Docking Window → Output" },
    omron: { about: "Help → About", build: "Project → Build Controller", msgs: "View → Build" },
};
const IDE_HINT_DEFAULT = { about: "Help → About", build: "Build / Compile", msgs: "Messages / Output" };
/** Název ZIP balíku. */
export function verifyPackName(plat, version = PLCDESK_VERSION) {
    return "PLCdesk-overeni-" + plat + "-" + version + ".zip";
}
const enc = new TextEncoder();
const bytesOf = (v) => typeof v === "string" ? enc.encode(v) : v;
async function sha256Hex(data) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle)
        throw new Error(tr("Prohlížeč neumí spočítat otisk SHA-256 (WebCrypto) — otevři aplikaci přes https nebo localhost."));
    const h = new Uint8Array(await subtle.digest("SHA-256", data));
    return Array.from(h, b => b.toString(16).padStart(2, "0")).join("");
}
/** Řádek tabulky Markdownu (svislítka v textu escapovat). */
const row = (cells) => "| " + cells.map(c => String(c).replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ") + " |";
function navodMd(plat, samples, version) {
    const pf = PLAT[plat], v = verificationInfo(plat), h = IDE_HINTS[plat] || IDE_HINT_DEFAULT;
    const ide = pf.ide, kontakt = licenseSiteUrl("kontakt");
    const out = [];
    out.push("# " + tr("PLCdesk — balík k ověření: {plat}", { plat: pf.name }), "");
    out.push(tr("Děkujeme, že pomáháte ověřit výstupy PLCdesk ve vývojovém prostředí {ide}. Balík obsahuje program vygenerovaný pro několik vzorových strojů; úkolem je ho naimportovat, přeložit a zapsat, co IDE hlásí.", { ide }), "");
    out.push("## " + tr("Stav ověření platformy"), "");
    out.push("- " + tr("Stav: {label} — {hint}", { label: v.label, hint: v.hint }));
    out.push("- " + tr("Co je ověřeno: {text}.", { text: v.summary }));
    out.push("- " + tr("Co ověřit chceme: {text}.", { text: v.notVerified }));
    out.push("- " + tr("Verze PLCdesk: {v}", { v: version }), "");
    out.push("## " + tr("Obsah balíku"), "");
    out.push(row([tr("Složka"), tr("Vzor"), tr("Styl kódu")]), row(["---", "---", "---"]));
    for (const s of samples) {
        out.push(row([s.dir + "/", s.text, s.blocked ? tr("negeneruje se (servoosu platforma nepodporuje)") : s.styles.map(x => x === "oop" ? tr("OOP (podsložka oop/)") : tr("klasický")).join(", ")]));
    }
    out.push("");
    out.push("- " + tr("PROTOKOL.md — šablona protokolu, kterou vyplníte a pošlete zpět."));
    out.push("- " + tr("MANIFEST.json — verze PLCdesk, platforma a otisky SHA-256 všech souborů balíku; neupravujte ho, pošlete ho s protokolem."), "");
    const blocked = samples.filter(s => s.blocked);
    if (blocked.length)
        out.push(tr("Servoosa: {why}", { why: axisSupport(fromData(VP_SAMPLE_PM12), plat).why }), "");
    out.push("## " + tr("Než začnete"), "");
    out.push("- " + tr("Potřebujete oficiálně licencované {ide}; ověřujte na počítači, kde smíte instalovat a zkoušet cizí projekty.", { ide }));
    out.push("- " + tr("Pro každý vzor (a každý styl kódu) založte nový prázdný projekt — import do jednoho projektu by hlásil duplicitní bloky."));
    out.push("- " + tr("Soubory balíku před importem neupravujte. Když bez úpravy nejdou naimportovat nebo přeložit, je to přesně nález, který hledáme — zapište ho a teprve pak upravujte."), "");
    out.push("## " + tr("Postup pro každý vzor"), "");
    const steps = [
        tr("Otevřete README.txt ve složce vzoru. Postup importu je v oddílech „{common}“ a v oddílu platformy — cestu, kterou README doporučuje jako první, vyzkoušejte jako první; náhradní cesty volitelně.", { common: tr("SPOLEČNÉ KROKY") }),
        tr("V novém projektu nastavte CPU a moduly podle README (konfigurace hardwaru se negeneruje) a naimportujte soubory přesně podle README."),
        tr("Hned po importu zapište počet chyb a varování a zkopírujte hlášení — najdete je v {where}.", { where: h.msgs }),
        tr("Přeložte celý program: {cmd}. Zapište počet chyb a varování a zkopírujte úplný výpis hlášení (v {where}; když nejde kopírovat, pořiďte snímek obrazovky).", { cmd: h.build, where: h.msgs }),
        tr("Pokud jste museli cokoli upravit ručně (soubor, nastavení importu, kód), zapište přesně co: soubor, řádek, původní a nový text a proč."),
        tr("Volitelně: spusťte program v simulátoru podle řádku „Test:“ v README a zapište, jestli sekvence běží (AUTO, start, kroky)."),
    ];
    steps.forEach((s, i) => out.push((i + 1) + ". " + s));
    out.push("");
    out.push("## " + tr("Kde to v {ide} najdete", { ide }), "");
    out.push(row([tr("Co"), tr("Kde")]), row(["---", "---"]));
    out.push(row([tr("Verze IDE (do protokolu)"), h.about]));
    out.push(row([tr("Překlad programu"), h.build]));
    out.push(row([tr("Výpis chyb a varování"), h.msgs]));
    out.push("", tr("Názvy nabídek se mohou lišit podle verze a jazyka IDE — do protokolu zapište, kde jste hlášení našli."), "");
    out.push("## " + tr("Co nám poslat"), "");
    out.push("- " + tr("vyplněný PROTOKOL.md,"));
    out.push("- " + tr("nezměněný MANIFEST.json,"));
    out.push("- " + tr("snímky obrazovky hlášení (PNG), pokud výpis nešel zkopírovat,"));
    out.push("- " + tr("soubory, které jste museli upravit (s popisem úpravy v protokolu)."), "");
    out.push(tr("Do protokolu ani na snímky nepatří osobní údaje ani licenční a sériová čísla IDE — před odesláním je ze snímků odstraňte."), "");
    out.push(tr("Protokol pošlete přes stránku Kontakt: {url}", { url: kontakt }), "");
    out.push(tr("Za úplný protokol od vás dostanete licenci PLCdesk Pro zdarma."), "");
    return out.join("\n");
}
function protokolMd(plat, samples, version) {
    const pf = PLAT[plat], h = IDE_HINTS[plat] || IDE_HINT_DEFAULT;
    const out = [];
    const fill = "…";
    out.push("# " + tr("Protokol ověření PLCdesk — {plat}", { plat: pf.name }), "");
    out.push("> " + tr("Bez osobních údajů a licenčních čísel: nevyplňujte jméno, e-mail, název firmy, licenční ani sériová čísla IDE a odstraňte je i ze snímků. Kontakt na vás máme ze zprávy, kterou protokol pošlete."), "");
    out.push("## " + tr("Prostředí"), "");
    out.push(row([tr("Položka"), tr("Hodnota")]), row(["---", "---"]));
    out.push(row([tr("Verze PLCdesk (z MANIFEST.json)"), version]));
    out.push(row([tr("Platforma"), pf.name + " (" + plat + ")"]));
    out.push(row([tr("IDE a přesná verze ({where})", { where: h.about }), fill]));
    out.push(row([tr("Aktualizace / service pack / hotfix IDE"), fill]));
    out.push(row([tr("CPU / zařízení v projektu (typ, objednací kód, firmware)"), fill]));
    out.push(row([tr("Operační systém"), fill]));
    out.push(row([tr("Jazyk IDE"), fill]));
    out.push(row([tr("Datum ověření"), fill]));
    out.push("");
    out.push("## " + tr("Výsledky"), "");
    out.push(tr("Jeden řádek na soubor, který jste importovali. Import = hned po importu, překlad = po překladu celého programu ({cmd}). Do sloupce Poznámka napište i to, když soubor importovat nešel.", { cmd: h.build }), "");
    out.push(row([tr("Vzor"), tr("Styl"), tr("Soubor"), tr("Import: chyby"), tr("Import: varování"), tr("Překlad: chyby"), tr("Překlad: varování"), tr("Poznámka")]), row(["---", "---", "---", "---", "---", "---", "---", "---"]));
    for (const s of samples) {
        if (s.blocked) {
            out.push(row([s.dir, "—", "README.txt", "—", "—", "—", "—", tr("kód se negeneruje (servoosu platforma nepodporuje)")]));
            continue;
        }
        for (const st of s.styles) {
            for (const f of s.files[st] || []) {
                if (f === "README.txt")
                    continue;
                out.push(row([s.dir, st === "oop" ? "OOP" : tr("klasický"), (st === "oop" ? "oop/" : "") + f, "", "", "", "", ""]));
            }
        }
    }
    out.push("");
    out.push("## " + tr("Úplný výpis hlášení"), "");
    out.push(tr("Vložte celý výpis z {where} — po importu i po překladu, pro každý vzor zvlášť. Nic nezkracujte; i varování nám pomůžou.", { where: h.msgs }), "");
    for (const s of samples) {
        if (s.blocked)
            continue;
        for (const st of s.styles) {
            out.push("### " + s.dir + (st === "oop" ? " — OOP" : ""), "");
            out.push(tr("Po importu:"), "", "```", "", "```", "");
            out.push(tr("Po překladu:"), "", "```", "", "```", "");
        }
    }
    out.push("## " + tr("Ruční zásahy"), "");
    out.push(tr("Co jste museli upravit, aby import nebo překlad prošel (soubor, řádek, původní → nový text, proč). Když nic, napište „žádné“."), "", "- " + fill, "");
    out.push("## " + tr("Snímky obrazovky"), "");
    out.push(tr("Názvy přiložených snímků a co ukazují (bez osobních údajů a licenčních čísel)."), "", "- " + fill, "");
    out.push("## " + tr("Simulace (volitelné)"), "");
    out.push(tr("Simulátor a verze, co jste zkoušeli (AUTO, start, kroky sekvence, kvitace) a co se stalo."), "", "- " + fill, "");
    out.push("## " + tr("Další poznámky"), "", "- " + fill, "");
    return out.join("\n");
}
/** Soubory balíku synchronně (otisky doplní `verifyPackFiles`). */
function packContent(plat, opts) {
    const version = opts.version || PLCDESK_VERSION;
    const created = new Date(opts.now === undefined ? Date.now() : opts.now).toISOString();
    const files = {};
    const samples = [];
    for (const def of SAMPLES) {
        const prj = def.make();
        prj.platforms = [plat];
        syncIO(prj);
        if (def.axis && !axisSupport(prj, plat).ok) {
            /* servoosa na platformě bez podpory: jen README s důvodem (genFor), bez OOP */
            const g = genFor(prj, plat);
            for (const [n, b] of Object.entries(g))
                files[def.dir + "/" + n] = b;
            samples.push({ dir: def.dir, source: def.source, devices: prj.devices.length, steps: prj.program.seq.length, styles: ["classic"], blocked: true,
                text: def.describe(prj.devices.length, prj.program.seq.length), files: { classic: Object.keys(g) } });
            continue;
        }
        const styles = ["classic"];
        const byStyle = {};
        delete prj.codeStyle;
        const g = genFor(prj, plat);
        byStyle.classic = Object.keys(g);
        for (const [n, b] of Object.entries(g))
            files[def.dir + "/" + n] = b;
        /* OOP jen u platforem, které ho umějí (rodina CODESYS); projekt s osou se generuje klasicky */
        if (supportsOop(plat) && !def.axis) {
            prj.codeStyle = "oop";
            const o = genFor(prj, plat);
            byStyle.oop = Object.keys(o);
            for (const [n, b] of Object.entries(o))
                files[def.dir + "/oop/" + n] = b;
            styles.push("oop");
        }
        samples.push({ dir: def.dir, source: def.source, devices: prj.devices.length, steps: prj.program.seq.length, styles, blocked: false,
            text: def.describe(prj.devices.length, prj.program.seq.length), files: byStyle });
    }
    const head = {
        "NAVOD.md": navodMd(plat, samples, version),
        "PROTOKOL.md": protokolMd(plat, samples, version),
    };
    const v = verificationInfo(plat);
    const manifest = {
        format: "plcdesk-verify-pack", schema: VERIFY_PACK_SCHEMA, app: "PLCdesk", version, commit: opts.commit || null,
        platform: plat, platformName: PLAT[plat].name, ide: PLAT[plat].ide, created,
        verification: { state: v.state, label: v.label, date: v.date, ide: v.ide, summary: v.summary, notVerified: v.notVerified },
        samples: samples.map(({ text: _t, files: _f, ...s }) => s),
    };
    return { all: { ...head, ...files }, manifest };
}
/**
 * Soubory balíku k ověření platformy `plat`: NAVOD.md, PROTOKOL.md, složky vzorů s výstupy `genFor`
 * a MANIFEST.json (poslední; nese otisky SHA-256 všech ostatních souborů). Texty v nastaveném jazyce.
 */
export async function verifyPackFiles(plat, opts = {}) {
    if (!PLAT[plat])
        throw new Error(tr("Neznámá platforma: {plat}", { plat }));
    const { all, manifest } = packContent(plat, opts); // synchronně (pevný čas v testu)
    const list = [];
    for (const [path, body] of Object.entries(all)) {
        const b = bytesOf(body);
        list.push({ path, sha256: await sha256Hex(b), size: b.length });
    }
    return { ...all, "MANIFEST.json": JSON.stringify({ ...manifest, files: list }, null, 2) + "\n" };
}
/** ZIP balíku (bez komprese); soubory v kořenové složce pojmenované podle balíku. */
export function verifyPackZip(files, root = "") {
    const pre = root ? root.replace(/\/+$/, "") + "/" : "";
    return zipStored(Object.entries(files).map(([name, data]) => ({ name: pre + name, data: bytesOf(data) })));
}
/** Celý balík jako ZIP: název souboru a bajty (web i desktop). */
export async function verifyPackArchive(plat, opts = {}) {
    const files = await verifyPackFiles(plat, opts);
    const name = verifyPackName(plat, opts.version || PLCDESK_VERSION);
    return { name, bytes: verifyPackZip(files, name.replace(/\.zip$/, "")), files: Object.keys(files) };
}
