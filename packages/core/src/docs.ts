/**
 * PLC Studio — generování projektové dokumentace
 * (FDS, I/O list, svorkovnice, alarmy, FAT, návod, SW dokumentace, přehled).
 */
import {
  Project, CLS, PLAT, devById, modules, dtFor, usedClasses,
} from "./model.js";
import { genFor } from "./codegen.js";
import { svgBlock, sheetSVG, sheetDXF } from "./drawing.js";

function dnes(): string { return new Date().toLocaleDateString("cs-CZ"); }
function estopTxt(prj: Project): string {
  const d = devById(prj, prj.program.estop);
  return d ? d.name + " – " + d.desc : "(doplnit)";
}

export const DOC_META: Array<[path: string, tab: string, title: string]> = [
  ["00_prehled_dokumentace.md", "Přehled", "obsah dokumentace a checklist chybějících dokumentů"],
  ["01_funkcni_specifikace_FDS.md", "FDS", "funkční specifikace"],
  ["02_io_list.csv", "I/O list", "kompletní I/O list"],
  ["03_svorkovnice.csv", "Svorkovnice", "svorkovnice pro projektanta elektro"],
  ["04_seznam_alarmu.csv", "Alarmy", "seznam alarmů s reakcemi a kvitací"],
  ["05_testovaci_protokol_FAT.md", "FAT", "testovací protokol (loop check, funkční testy, sekvence)"],
  ["06_navod_k_obsluze.md", "Návod", "kostra návodu k obsluze"],
  ["07_softwarova_dokumentace.md", "SW dok.", "struktura a konvence programu"],
];

export function docIndexMd(prj: Project): string {
  return `# Přehled dokumentace projektu

**Projekt:** ${prj.meta.name || "—"} · generováno ${dnes()} nástrojem PLC Studio

## Obsah
${DOC_META.map(x => "- `" + x[0] + "` — " + x[2]).join("\n")}
- schémata — blokové schéma a elektrické zapojení I/O (SVG náhled + DXF pro CAD)
- zdrojové soubory programu pro každou zvolenou platformu včetně postupu importu (README)

## Dokumenty, které sada NEOBSAHUJE a běžný projekt je vyžaduje (doplnit ručně)
- URS / FRS (požadavky zákazníka a funkční požadavky)
- Posouzení rizik a validace bezpečnostních funkcí (ISO 13849 / IEC 62061)
- Kusovník (BOM) a výkresy rozvaděče, as-built elektrodokumentace
- Síťová topologie a IP plán, specifikace HMI/SCADA
- SAT protokol, IQ/OQ (dle odvětví), zálohy programů, prohlášení o shodě (CE)

Vygenerované dokumenty jsou výchozí návrh k revizi — před předáním zákazníkovi je zkontroluj a doplň.`;
}

export function docFDSMd(prj: Project): string {
  const mods = modules(prj);
  let s = `# Funkční specifikace (FDS)

| | |
|---|---|
| **Projekt** | ${prj.meta.name || "—"} |
| **Datum** | ${dnes()} |
| **Revize** | 0.1 — návrh (PLC Studio) |

## 1. Popis stroje a účel
${prj.meta.desc || "(doplnit)"}

## 2. Cílové řídicí systémy
${prj.platforms.map(p => "- " + PLAT[p].name + " — " + PLAT[p].ide + ", " + PLAT[p].cpu + ", jazyk " + PLAT[p].lang).join("\n")}

## 3. Zařízení
| Označení | Třída | Popis | Parametry |
|---|---|---|---|
`;
  for (const d of prj.devices) {
    const par = d.cls.startsWith("Analog")
      ? ((d.unit || "") + " " + d.rmin + "–" + d.rmax)
      : Object.entries(d.opt || {}).filter(([, v]) => v).map(([k]) => (CLS[d.cls].opts[k] || k)).join(", ");
    s += `| ${d.name} | ${CLS[d.cls].label} | ${d.desc || ""} | ${par || "—"} |\n`;
  }
  s += `
## 4. I/O bilance a moduly
${(["DI", "DO", "AI", "AO"] as const).map(dd => dd + ": " + prj.io.filter(e => e.dir === dd).length).join(" · ")}
Navržené moduly: ${mods.map((m, i) => m.dir + m.idx + " (svorkovnice X" + (i + 1) + ", " + m.ch.length + " kanálů)").join(", ") || "—"}

## 5. Režimy a ovládání
- **RUČNĚ** — povely na jednotlivá zařízení z HMI (specifikace HMI: doplnit)
- **AUTO** — automatická sekvence dle kap. 6; start podmíněn centrálním uvolněním
- **Centrální uvolnění** — ${estopTxt(prj)}; podmínky doplnit (kryty, tlak vzduchu…)

## 6. Automatická sekvence
${prj.program.seq.length ? prj.program.seq.map((sq, i) => {
    const d = devById(prj, sq.dev);
    const akce = sq.act === "wait" ? ("výdrž " + sq.timeS + " s")
      : ((d ? d.name + " (" + (d.desc || "") + ")" : "?") + " — " + ({ start: "start", stop: "stop", open: "otevřít", close: "zavřít" } as Record<string, string>)[sq.act]);
    return (i + 1) + ". " + akce + " · přechod: " + (sq.cond === "time" ? ("čas " + sq.timeS + " s") : "zpětné hlášení");
  }).join("\n") : "(bez automatické sekvence — pouze ruční režim)"}

## 7. Chování při poruše
Každé typové zařízení hlídá zpětná hlášení s timeoutem a hlásí status: \`16#0000\` OK, \`16#8001\` blokováno (enable), \`16#8002\` porucha. Porucha zastaví zařízení; kvitace povelem stop/zavřít po odstranění příčiny. Porucha kteréhokoli zařízení v AUTO zastaví sekvenci (doplnit strategii: dokončit krok / okamžitě).

## 8. Bezpečnost
Bezpečnostní funkce (nouzové zastavení, kryty, dvouruční ovládání) realizuje certifikovaná bezpečnostní technika dle posouzení rizik (ISO 13849 / IEC 62061) — nejsou předmětem tohoto programu. Signály v PLC slouží pouze k blokování technologie a diagnostice.

## 9. Mimo rozsah tohoto dokumentu
URS/FRS, posouzení rizik, HMI/SCADA specifikace, komunikace s nadřazenými systémy, recepty.`;
  return s;
}

export function docIOcsv(prj: Project): string {
  const l = ["Tag;Adresa;Směr;Datový typ;Zařízení;Komentář"];
  for (const e of prj.io) {
    const d = devById(prj, e.devId);
    l.push([e.tag, e.addr, e.dir, dtFor(e), d ? d.name : "", e.cmt || ""].join(";"));
  }
  return l.join("\n");
}

export function svorkyCSV(prj: Project): string {
  const l = ["Svorka;Modul;Kanál;Adresa;Tag;Komentář"];
  modules(prj).forEach((m, mi) => m.ch.forEach((e, i) =>
    l.push("X" + (mi + 1) + ":" + (i + 1) + ";" + m.dir + m.idx + ";" + i + ";" + e.addr + ";" + e.tag + ";" + (e.cmt || ""))));
  return l.join("\n");
}

export function docAlarmCsv(prj: Project): string {
  const l = ["Kód;Zařízení;Alarm;Příčina;Reakce systému;Kvitace"];
  for (const d of prj.devices) {
    if (d.cls === "Motor") {
      l.push(`A_${d.name}_START;${d.name};Timeout rozběhu;Nepřišlo zpětné hlášení běhu do 3 s;Stop zařízení, stop sekvence;Povel STOP po odstranění příčiny`);
      if (d.opt.fault) l.push(`A_${d.name}_FAULT;${d.name};Externí porucha;Jistič/měnič hlásí poruchu;Stop zařízení;Povel STOP po odstranění příčiny`);
      if (d.opt.fbk !== false) l.push(`A_${d.name}_RUN;${d.name};Ztráta hlášení běhu;Výpadek za chodu;Stop zařízení;Povel STOP`);
    } else if (d.cls === "Ventil") {
      l.push(`A_${d.name}_TRAVEL;${d.name};Timeout přestavení;Koncová poloha nedosažena do 5 s;Stop sekvence;Povel ZAVŘÍT`);
    } else if (d.cls === "AnalogIn") {
      l.push(`A_${d.name}_HI;${d.name};Překročena horní mez;Hodnota > limitHi (${d.unit || ""});Dle technologie (doplnit);Automaticky po návratu`);
      l.push(`A_${d.name}_LO;${d.name};Podkročena dolní mez;Hodnota < limitLo (${d.unit || ""});Dle technologie (doplnit);Automaticky po návratu`);
    }
  }
  return l.join("\n");
}

export function docFATMd(prj: Project): string {
  const mods = modules(prj);
  let s = `# Testovací protokol FAT

**Projekt:** ${prj.meta.name || "—"} · **Datum testu:** ………… · **Testoval:** ………… · **Za zákazníka:** …………

Zaškrtni ☐→☑. Neshody zapiš do tabulky na konci. SAT = stejný rozsah po instalaci u zákazníka + skutečné akční členy a technologie.

## 1. Kontrola I/O smyček (loop check)
| Svorka | Adresa | Tag | Postup | OK |
|---|---|---|---|---|
`;
  mods.forEach((m, mi) => m.ch.forEach((e, i) => {
    const how = e.dir === "DI" ? "Sepnout snímač/kontakt, ověřit v PLC"
      : e.dir === "DO" ? "Vynutit výstup z PLC, ověřit akční člen"
      : e.dir === "AI" ? "Zdroj signálu (kalibrátor), ověřit hodnotu a škálování"
      : "Vynutit hodnotu, změřit výstup";
    s += `| X${mi + 1}:${i + 1} | ${e.addr} | ${e.tag} | ${how} | ☐ |\n`;
  }));
  s += `\n## 2. Funkční testy zařízení\n`;
  for (const d of prj.devices) {
    if (d.cls === "Motor") s += `**${d.name} — ${d.desc}**\n- Start → běží, hlášení běhu do 3 s ☐\n- Stop → zastaví ☐\n- Simulace ztráty hlášení za chodu → porucha, výstup vypnut ☐\n${d.opt.fault ? "- Simulace externí poruchy → porucha ☐\n" : ""}- Kvitace poruchy ☐\n\n`;
    else if (d.cls === "Ventil") s += `**${d.name} — ${d.desc}**\n- Otevřít → dosažena poloha otevřeno ☐\n- Zavřít → dosažena poloha zavřeno ☐\n- Simulace nedojetí → timeout, porucha ☐\n- Kvitace ☐\n\n`;
    else if (d.cls === "AnalogIn") s += `**${d.name} — ${d.desc}** (${d.unit || ""} ${d.rmin}–${d.rmax})\n- Porovnání se skutečnou/kalibrovanou hodnotou ve 3 bodech ☐\n- Test mezí Hi/Lo ☐\n\n`;
  }
  if (prj.program.seq.length) {
    s += `## 3. Test automatické sekvence\n| Krok | Očekávané chování | OK |\n|---|---|---|\n`;
    prj.program.seq.forEach((sq, i) => {
      const d = devById(prj, sq.dev);
      s += `| ${i + 1} | ${sq.act === "wait" ? ("výdrž " + sq.timeS + " s") : ((d ? d.name : "?") + " " + sq.act)} → přechod ${sq.cond === "time" ? "po čase" : "na zpětné hlášení"} | ☐ |\n`;
    });
    s += `| — | Přerušení centrálního uvolnění uprostřed cyklu → vše bezpečně zastaveno | ☐ |\n| — | Opakovaný start po kvitaci → cyklus od začátku | ☐ |\n`;
  }
  s += `\n## 4. Neshody\n| č. | Popis | Závažnost | Vyřešeno |\n|---|---|---|---|\n| | | | |\n\n**Výsledek FAT:** VYHOVĚL / VYHOVĚL S VÝHRADAMI / NEVYHOVĚL\n\nPodpisy: …………………………`;
  return s;
}

export function docManualMd(prj: Project): string {
  return `# Návod k obsluze — ${prj.meta.name || "stroj"}

Revize 0.1 (${dnes()}) — kostra k doplnění; před předáním doplnit fotografie, ovládací panel a kontakty.

## 1. Popis stroje
${prj.meta.desc || "(doplnit)"}

## 2. Ovládací prvky
(doplnit: hlavní vypínač, panel HMI, tlačítka, signalizace — ${prj.devices.filter(d => d.cls === "DO").map(d => d.name + " " + d.desc).join(", ") || "—"})

## 3. Uvedení do chodu
1. Zapnout hlavní vypínač, zkontrolovat signalizaci.
2. Odblokovat nouzové zastavení (${estopTxt(prj)}), zavřít kryty.
3. Zvolit režim RUČNĚ/AUTO.
4. V režimu AUTO spustit cyklus tlačítkem start.

## 4. Zastavení
- Provozní: tlačítko stop / dokončení cyklu.
- Nouzové: tlačítko nouzového zastavení — POUZE v nebezpečí; po použití nutná kvitace.

## 5. Poruchy a jejich odstranění
Seznam alarmů: viz \`04_seznam_alarmu.csv\`. Obecný postup: odstranit příčinu → kvitovat → znovu spustit. Opakuje-li se porucha, kontaktovat údržbu.

## 6. Údržba
(doplnit intervaly: mazání, kontrola snímačů, dotažení svorek, kalibrace analogů — doporučeno 1× ročně)

## 7. Bezpečnostní upozornění
Zásahy do elektrické výzbroje smí provádět jen osoba s odpovídající kvalifikací. Bezpečnostní prvky nesmí být vyřazovány.`;
}

export function docSWMd(prj: Project): string {
  const u = usedClasses(prj);
  return `# Softwarová dokumentace programu PLC

**Projekt:** ${prj.meta.name || "—"} · generováno ${dnes()}

## 1. Struktura programu
- **Knihovna typových bloků** (\`Gen_Library\`): ${(["Motor", "Ventil", "AnalogIn", "AnalogOut"] as const).filter(c => u.has(c)).map(c => "FB_" + c).join(", ") || "—"}
- **Strojní blok** \`FB_Machine\` / \`MAIN\`: multi-instance všech zařízení + stavový automat sekvence
- Volání: 1 instance strojního bloku v cyklickém programu (OB1 / PlcTask / MainTask)

## 2. Typové bloky
| Blok | Funkce | Stavový automat | Timeout |
|---|---|---|---|
| FB_Motor | start/stop se zpětným hlášením | IDLE→STARTING→RUNNING→ERROR | rozběh 3 s |
| FB_Ventil | otevřít/zavřít s koncáky | CLOSED→OPENING→OPEN→CLOSING→ERROR | přestavení 5 s |
| FB_AnalogIn | škálování + meze | — | — |
| FB_AnalogOut | jednotky → surová hodnota | — | — |

## 3. Instance
${prj.devices.map(d => "- inst" + d.name + " : FB_" + (d.cls === "DI" || d.cls === "DO" ? "(volný signál)" : d.cls) + " — " + (d.desc || "")).join("\n")}

## 4. Statusová slova
\`16#0000\` OK · \`16#8001\` blokováno (enable=FALSE) · \`16#8002\` porucha. Rozšíření kódů doplnit dle projektu.

## 5. Konvence
Symbolické adresování, bez M-flagů; tagy \`<Zařízení>_<signál>\`; hrany uvnitř FB; každý čekací stav má timeout do ERROR. Dle Siemens Programming Styleguide (ID 81318674) / IEC 61131-3.

## 6. Verze a zálohy
| Verze | Datum | Autor | Změna |
|---|---|---|---|
| 0.1 | ${dnes()} | PLC Studio | první generování |`;
}

export interface DocFile { path: string; tab: string; title: string; body: string; }
export function docFiles(prj: Project): DocFile[] {
  const bodies = [
    docIndexMd(prj), docFDSMd(prj), docIOcsv(prj), svorkyCSV(prj),
    docAlarmCsv(prj), docFATMd(prj), docManualMd(prj), docSWMd(prj),
  ];
  return DOC_META.map((m, i) => ({ path: m[0], tab: m[1], title: m[2], body: bodies[i] }));
}

export interface ProjectFile {
  group: string; name: string; save: string; body: string;
  kind: "text" | "svg" | "dxf"; prev?: string;
}

/** Úplná sada souborů projektu: dokumenty + schémata (SVG/DXF) + zdroje platforem. */
export function allProjectFiles(prj: Project): ProjectFile[] {
  const out: ProjectFile[] = [];
  for (const f of docFiles(prj)) out.push({ group: "Dokumentace", name: f.path, save: f.path, body: f.body, kind: "text" });
  const mods = modules(prj);
  out.push({ group: "Schémata", name: "blokove_schema.svg", save: "00_blokove_schema.svg", body: svgBlock(prj, mods), kind: "svg" });
  mods.forEach((m, i) => {
    const base = m.dir + m.idx + "_X" + (i + 1), pre = String(i + 1).padStart(2, "0") + "_";
    out.push({ group: "Schémata", name: base + ".svg", save: pre + base + ".svg", body: sheetSVG(prj, m, i + 1, i + 1, mods.length), kind: "svg" });
    out.push({ group: "Schémata", name: base + ".dxf", save: pre + base + ".dxf", body: sheetDXF(prj, m, i + 1, i + 1, mods.length), kind: "dxf", prev: sheetSVG(prj, m, i + 1, i + 1, mods.length) });
  });
  for (const p of prj.platforms) {
    const files = genFor(prj, p);
    for (const [n, b] of Object.entries(files)) out.push({ group: "PLC — " + PLAT[p].name, name: n, save: p + "_" + n, body: b, kind: "text" });
  }
  return out;
}
