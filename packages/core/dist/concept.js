/**
 * AI nadstavba: generování KONCEPTŮ řešení.
 * Z hrubého zadání vzniknou 2–3 koncepční varianty (architektura řízení, pohony,
 * bezpečnostní a HMI koncept, odhad I/O, doporučené platformy, rizika, pracnost).
 * Vybraná varianta se ukládá do Project.concept, propisuje se do FDS a dokumentace
 * a slouží jako kontext pro následný AI návrh sestavy zařízení.
 *
 * Core definuje protokol (instrukce + normalizaci + render) — samotné volání AI
 * dělá aplikace (apps/web/src/ai.js, později backend).
 */
import { PLAT } from "./model.js";
/** Instrukce pro AI (vede konverzaci nad konceptem; app přikládá turns uživatele). */
export function conceptInstructions(prj) {
    const plats = Object.keys(PLAT).join(", ");
    const ctx = prj.concept ? "\nAKTUÁLNĚ ZVOLENÝ KONCEPT (uživatel ho může chtít upravit):\n" + JSON.stringify(prj.concept) + "\n" : "";
    return "Jsi zkušený koncepční inženýr průmyslové automatizace v nástroji PLC Studio. "
        + "Z hrubého zadání stroje/linky navrhni 2–3 ODLIŠNÉ koncepční varianty řešení řízení — ne detailní sestavu, ale koncept.\n"
        + "Varianty se mají lišit přístupem (např. centrální PLC vs. decentralizovaná periferie; pneumatika vs. hydraulika vs. servopohony; "
        + "kompaktní vs. modulární CPU; míra vizualizace), ne jen slovy. Ke každé uveď:\n"
        + '- "nazev" (krátký), "shrnuti" (2–4 věty princip),\n'
        + '- "architektura": řídicí systém, rozložení I/O (centrální/vzdálené), sběrnice, rozvaděč,\n'
        + '- "pohony": technologie akčních členů a zdůvodnění,\n'
        + '- "bezpecnost": pouze KONCEPT (E-stop, kryty, kategorie odhadem) — vždy dodej, že finální řešení určí posouzení rizik dle ISO 13849,\n'
        + '- "hmi": koncept ovládání/vizualizace,\n'
        + '- "odhadIO": {"di","do","ai","ao"} čísla,\n'
        + '- "doporucenePlatformy": 1–2 klíče z: ' + plats + ",\n"
        + '- "rizika": 2–4 hlavní rizika/otevřené body,\n'
        + '- "pracnostMD": hrubý odhad člověkodnů SW části (číslo).\n'
        + "Zásady konstruování, které dodržuj: varianty liš podle os centrální vs. decentralizovaná periferie "
        + "(vzdálená I/O se vyplatí při >30–40 vodičích přes >10 m), technologie pohonů (pneumatika = 2 polohy levně; "
        + "hydraulika = síly >10 kN, lisy; servo/měnič = polohování/dopravníky; mix je normální) a třídy CPU "
        + "(kompaktní do ~100 I/O, modulární pro linky/motion). Do odhadu I/O započti 20% rezervu. "
        + "U bezpečnosti uveď kategorii zastavení dle EN 60204-1 (Stop 0/1) a orientační PLr dle ISO 13849 "
        + "(E-stop a kryty typicky PLc–d, lisy PLe) a zda stačí bezpečnostní relé (do ~3 funkcí) nebo safety PLC. "
        + "Sběrnici volej nativní pro platformu (PROFINET/EtherCAT/EtherNet/IP/CC-Link), Modbus TCP pro cizí zařízení.\n"
        + "Piš česky, věcně, pro malou integrátorskou firmu. Nenavrhuj safety logiku do PLC.\n"
        + "Chybí-li ZÁSADNÍ informace, polož nejvýše 3 otázky v \"questions\" a \"variants\" nech prázdné; jinak otázky prázdné.\n"
        + ctx
        + 'Odpověz POUZE jedním JSON objektem: {"questions":[],"variants":[…],"note":"krátké srovnání variant / doporučení"}';
}
const PLATKEYS = new Set(Object.keys(PLAT));
export function conceptNorm(r) {
    const out = { questions: [], variants: [], note: "" };
    const o = r;
    if (!o || typeof o !== "object")
        return out;
    out.questions = Array.isArray(o.questions) ? o.questions.map(String).slice(0, 3) : [];
    const vs = Array.isArray(o.variants) ? o.variants : [];
    out.variants = vs.slice(0, 4).map((v0) => {
        const v = (v0 || {});
        const io = (v.odhadIO || {});
        return {
            zadani: "",
            nazev: String(v.nazev || "Varianta").slice(0, 80),
            shrnuti: String(v.shrnuti || ""),
            architektura: String(v.architektura || ""),
            pohony: String(v.pohony || ""),
            bezpecnost: String(v.bezpecnost || ""),
            hmi: String(v.hmi || ""),
            odhadIO: { di: Number(io.di) || 0, do: Number(io.do) || 0, ai: Number(io.ai) || 0, ao: Number(io.ao) || 0 },
            doporucenePlatformy: (Array.isArray(v.doporucenePlatformy) ? v.doporucenePlatformy : [])
                .map(String).filter(k => PLATKEYS.has(k)).slice(0, 2),
            rizika: (Array.isArray(v.rizika) ? v.rizika : []).map(String).slice(0, 6),
            pracnostMD: Number(v.pracnostMD) || 0,
        };
    }).filter(v => v.nazev && (v.shrnuti || v.architektura));
    out.note = String(o.note || "");
    return out;
}
/** Markdown dokument „Koncept řešení" (součást projektové dokumentace). */
export function conceptMd(prj) {
    const c = prj.concept;
    if (!c)
        return "# Koncept řešení\n\n(Koncept zatím nebyl zvolen — vygeneruj ho v kroku AI návrh.)";
    return `# Koncept řešení — ${c.nazev}

**Projekt:** ${prj.meta.name || "—"} · návrh konceptu vygenerován AI v PLC Studio, **podléhá revizi**.

## Zadání
${c.zadani || prj.meta.desc || "(doplnit)"}

## Princip řešení
${c.shrnuti}

## Architektura řízení
${c.architektura}

## Pohony a akční členy
${c.pohony}

## Koncept bezpečnosti
${c.bezpecnost}

> Finální bezpečnostní řešení (kategorie/PL, prvky, zapojení) určí posouzení rizik dle ISO 13849 / IEC 62061 — tento koncept je pouze výchozí rámec a nenahrazuje ho.

## Koncept ovládání (HMI)
${c.hmi}

## Odhad rozsahu
- I/O: DI ${c.odhadIO.di} · DO ${c.odhadIO.do} · AI ${c.odhadIO.ai} · AO ${c.odhadIO.ao}
- Doporučené platformy: ${c.doporucenePlatformy.map(k => PLAT[k].name).join(", ") || "—"}
- Hrubý odhad pracnosti SW: ~${c.pracnostMD} člověkodnů

## Rizika a otevřené body
${c.rizika.map(r => "- " + r).join("\n") || "- (doplnit)"}
`;
}
