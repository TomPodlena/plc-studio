/**
 * PLCdesk — projektová složka: celá sada souborů projektu roztříděná po druzích, s předponou čísla
 * projektu. Jediné místo, které určuje, kam který soubor patří — desktop („Uložit vše do složky
 * projektu“, výchozí složky dialogů Uložit) i web („Stáhnout projekt (ZIP)“) ho používají stejně.
 *
 * ```
 * <číslo>_<Název>\
 * ├─ <číslo>_<Název>.plcstudio.json
 * ├─ 01_Dokumentace\         FDS, I/O list, svorkovnice, alarmy, návod, SW dokumentace, ověření, koncept, emulace…
 * ├─ 02_Vykresy\SVG\ a DXF\  listy zapojení, blokové schéma, schéma stroje, diagramy, bezpečnostní okruh
 * ├─ 03_Program_PLC\<Platforma>\ (kód + README), 03_Program_PLC\Bezpecnostni_program\
 * ├─ 04_HMI\                 webové HMI, náhledy, dokument HMI, exporty výrobců (hmi_<platforma>_…)
 * ├─ 05_Bezpecnost\          bezpečnostní funkce, plán validace, SISTEMA (.ssm, předpis CSV, porovnání)
 * ├─ 06_Kusovnik\            kusovník MD + CSV
 * ├─ 07_Oziveni_a_FAT\       FAT, plán a protokol oživení
 * ├─ 08_Schvaleni_a_revize\  schválení, revize a změny
 * ├─ 09_Exporty\EPLAN\       AutomationML a seznamy pro EPLAN (ostatní výměnné formáty do 09_Exporty)
 * └─ 99_Interni\             nabídka (nepředávat zákazníkovi)
 * ```
 *
 * Názvy podsložek jsou cesty na disku — stejné v každém jazyce. Kód platformy, EPLAN a SISTEMA mají
 * ve vlastní podsložce původní jména souborů (README a dokumenty na ně odkazují jmény); dokumenty,
 * výkresy a HMI mají jména jako v kroku Dokumentace (`save`; exporty HMI „hmi_<platforma>_…“, na ně
 * odkazuje 16_hmi.md — README_HMI výrobce, které jmenuje původní jména, se v kopii pro složku přepíše
 * na uložená). Neznámý soubor → 01_Dokumentace (test hlídá, že nic nezůstane nezařazené).
 *
 * Předpona čísla projektu (`prefixProjectFiles`) a licence (patička Free, zamčené DXF / nad limitem)
 * se uplatňují jen tady a v klientech — výstupy jádra (`genFor`, `docFiles`) se nemění (golden).
 */
import type { Project, PlatformKey } from "./model.js";
import { PLAT } from "./model.js";
import type { ProjectGate } from "./license.js";
import { licensedProjectFiles, applyLicenseToFile } from "./license.js";
import { allProjectFiles, type ProjectFile } from "./docs.js";
import { fileSafe, folderSafe, projectFolderName, projectRef } from "./project_meta.js";
import { APPROVAL_FILE } from "./approval.js";
import { COMMISSION_FILE_MD, COMMISSION_FILE_CSV } from "./commission.js";
import { CHANGES_FILE } from "./revision.js";
import { QUOTE_FILE } from "./quote.js";
import { SAFETY_FILE_SRS, SAFETY_FILE_VALIDATION } from "./safety_docs.js";
import { SISTEMA_FILE } from "./sistema.js";
import { HMI_DOC_FILE, hmiModuleRegistered } from "./hmi_docs.js";
import { buildHmi } from "./hmi.js";
import { hmiSiemensWorkbook } from "./hmi_export.js";
import { zipStored } from "./hmi_xlsx.js";

/** Podsložky projektové složky (stejné názvy v každém jazyce — cesty na disku). */
export const PROJECT_DIRS = {
  docs: "01_Dokumentace",
  drawings: "02_Vykresy",
  svg: "02_Vykresy/SVG",
  dxf: "02_Vykresy/DXF",
  code: "03_Program_PLC",
  safetyCode: "03_Program_PLC/Bezpecnostni_program",
  hmi: "04_HMI",
  safety: "05_Bezpecnost",
  bom: "06_Kusovnik",
  commission: "07_Oziveni_a_FAT",
  approval: "08_Schvaleni_a_revize",
  exports: "09_Exporty",
  eplan: "09_Exporty/EPLAN",
  internal: "99_Interni",
} as const;
export type ProjectDirKind = keyof typeof PROJECT_DIRS;

/** Název podsložky platformy („Siemens_SIMATIC“, „Rockwell_Allen-Bradley“…); neznámý klíč = klíč. */
export function platformFolderName(p: string): string {
  const info = (PLAT as Record<string, { name: string } | undefined>)[p];
  return folderSafe(info ? info.name : p, 40) || folderSafe(p, 40) || "PLC";
}

/** Dokumenty (podle jména bez přípony) mimo 01_Dokumentace. */
function docKind(name: string): ProjectDirKind | null {
  const stem = (s: string) => s.replace(/\.[^.]+$/, "");
  const n = stem(name);
  const is = (...f: string[]) => f.some(x => stem(x) === n);
  if (n === "09_kusovnik") return "bom";
  if (is(APPROVAL_FILE, CHANGES_FILE)) return "approval";
  if (is("05_testovaci_protokol_FAT.md", COMMISSION_FILE_MD, COMMISSION_FILE_CSV)) return "commission";
  if (is(SAFETY_FILE_SRS, SAFETY_FILE_VALIDATION, SISTEMA_FILE)) return "safety";
  if (is(QUOTE_FILE) || /(^|_)nabidka$/.test(n)) return "internal";
  if (is(HMI_DOC_FILE)) return "hmi";
  return null;
}

/**
 * Podsložka projektové složky pro soubor `name` s druhem `hint` (`ProjectFile.dir`, u jednotlivého
 * uložení v desktopu totéž): „kod/<platforma>“, „kod/safety“, „vykresy“, „hmi“, „hmi/<platforma>“,
 * „bezpecnost“, „eplan“, „kusovnik“, „interni“, „exporty“, „dokumentace“. Dokumenty se třídí podle
 * jména (FAT → oživení, schválení → schvalování…); neznámé → 01_Dokumentace.
 */
export function projectFileFolder(name: string, hint = ""): string {
  const h = String(hint || "");
  const ext = (String(name).split(".").pop() || "").toLowerCase();
  if (h === "kod/safety") return PROJECT_DIRS.safetyCode;
  if (h.startsWith("kod/")) return PROJECT_DIRS.code + "/" + platformFolderName(h.slice(4));
  if (h === "vykresy") return ext === "dxf" ? PROJECT_DIRS.dxf : PROJECT_DIRS.svg;
  if (h === "hmi" || h.startsWith("hmi/")) return PROJECT_DIRS.hmi;
  if (h === "bezpecnost") return PROJECT_DIRS.safety;
  if (h === "eplan") return PROJECT_DIRS.eplan;
  if (h === "exporty") return PROJECT_DIRS.exports;
  if (h === "interni") return PROJECT_DIRS.internal;
  const k = docKind(String(name));
  if (k) return PROJECT_DIRS[k];
  if (h === "kusovnik") return PROJECT_DIRS.bom;
  return PROJECT_DIRS.docs;
}

/** Ve vlastní podsložce (kód platformy, EPLAN, SISTEMA) má soubor původní jméno. */
const OWN_NAME = (h: string) => h.startsWith("kod/") || h === "eplan" || h === "bezpecnost";

export interface FolderFile {
  /** Relativní cesta s „/“ (např. `03_Program_PLC/Siemens_SIMATIC/Gen_Main.scl`). */
  path: string;
  body: string;
  kind: "text" | "svg" | "dxf";
}

/** Sada souborů projektu roztříděná do podsložek (bez předpony). `gate` = brána knihovny (null = bez licence). */
export function projectFolderFiles(prj: Project, gate: Pick<ProjectGate, "library"> | null = null): FolderFile[] {
  const files: ProjectFile[] = gate ? licensedProjectFiles(prj, gate) : allProjectFiles(prj);
  const seen = new Set<string>();
  const out: FolderFile[] = [];
  /* exporty HMI výrobce: původní jméno → uložené („HmiTags.tsv“ → „hmi_siemens_HmiTags.tsv“) */
  const hmiNames = new Map<string, Map<string, string>>();
  for (const f of files) if ((f.dir || "").startsWith("hmi/") && f.save !== f.name) {
    const m = hmiNames.get(f.dir!) || new Map<string, string>();
    m.set(f.name, f.save);
    hmiNames.set(f.dir!, m);
  }
  for (const f of files) {
    const h = f.dir || "";
    const name = OWN_NAME(h) ? f.name : f.save;
    const path = projectFileFolder(name, h) + "/" + name;
    if (seen.has(path)) continue;          // stejný soubor z víc zdrojů (nemá nastat) — první vyhrává
    seen.add(path);
    const map = hmiNames.get(h);
    const body = map && rewritesFileRefs(f.name) ? replaceNames(f.body, map) : f.body;
    out.push({ path, body, kind: f.kind });
  }
  return out;
}

/* ================================================================ předpona čísla projektu */

/**
 * Soubory, jejichž jméno je jménem objektu v IDE — předponu nedostanou a odkazy na ně se nemění:
 * TwinCAT 3 bere jméno souboru .TcPOU / .TcGVL / .TcIO / .TcDUT / .TcTTO jako jméno POU / GVL /
 * rozhraní / typu / úlohy (soubor „260705_MAIN.TcPOU“ by v projektu nesouhlasil s POU MAIN).
 *
 * Ostatní formáty jméno objektu nesou uvnitř, název souboru je jen kontejner — předpona je bezpečná:
 * PLCopen XML (TC6) i IEC 61131-10 XML (`<pou name=…>`, import do aplikace), L5X (`<Controller>` /
 * `<AddOnInstructionDefinition Name=…>`), externí zdroje SCL (TIA založí bloky podle
 * `FUNCTION_BLOCK "…"` v textu), Openness XML tabulky tagů (jméno v `<Name>`), ST / CSV / TXT
 * vkládané nebo importované do IDE (GX Works3, Sysmac, UniLogic, CODESYS), exporty HMI, AML, .ssm.
 */
export const PREFIX_EXEMPT = /\.(TcPOU|TcGVL|TcIO|TcDUT|TcTTO)$/i;

/** Textové soubory, ve kterých se přepisují odkazy na jména souborů: dokumenty a README, ne kód PLC. */
export function rewritesFileRefs(name: string): boolean {
  if (/\.(md|html?)$/i.test(name)) return true;
  return /\.txt$/i.test(name) && /(^|_)(README|NAVOD|PROTOKOL)/i.test(name);
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regulární výraz celých jmen souborů: před jménem není znak jména souboru, za ním ani znak jména,
 *  ani „.přípona“ (ne část jiného jména: „GOT_Tags.csv“ ≠ „Tags.csv“, „MAIN.st.bak“ ≠ „MAIN.st“). */
function nameRegex(names: Iterable<string>): RegExp | null {
  const list = [...names].sort((a, b) => b.length - a.length);
  return list.length ? new RegExp("(?<![A-Za-z0-9_.\\-])(" + list.map(reEsc).join("|") + ")(?![A-Za-z0-9_\\-]|\\.[A-Za-z0-9])", "g") : null;
}
function replaceNames(body: string, map: Map<string, string>): string {
  const re = nameRegex(map.keys());
  return re ? body.replace(re, m => map.get(m) || m) : body;
}

/**
 * Předpona čísla projektu „<číslo>_“ u každého souboru (`260705_01_FDS.md`, `260705_Gen_Main.scl`,
 * `260705_01_DI1_X1.dxf`) — mění se jen jméno souboru v cestě, ne podsložky. V dokumentech
 * (`rewritesFileRefs`: .md, .html, README / NAVOD / PROTOKOL .txt) se odkazy na původní jména souborů
 * sady přepíšou na nová — jen celá jména (ne část identifikátoru: „GOT_Tags.csv“ ≠ „Tags.csv“).
 * Kód PLC (.scl, .st, .L5X, .xml, .csv…) zůstává bajt po bajtu stejný. Výjimky `PREFIX_EXEMPT`
 * (objekty TwinCAT) beze změny. Soubor, který předponu už má, ji nedostane podruhé.
 * Bez čísla = kopie beze změny. Zamčené soubory (bez `body`) se jen přejmenují.
 */
export function prefixProjectFiles<T extends { path: string; body?: string }>(files: T[], number: string): T[] {
  const n = fileSafe(String(number ?? ""), 40);
  if (!n) return files.map(f => ({ ...f }));
  const pre = n + "_";
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const renamed = new Map<string, string>();
  for (const f of files) {
    const b = base(f.path);
    if (!PREFIX_EXEMPT.test(b) && !b.startsWith(pre)) renamed.set(b, pre + b);
  }
  const re = nameRegex(renamed.keys());
  return files.map(f => {
    const b = base(f.path);
    const nb = renamed.get(b);
    const out = { ...f, path: nb ? f.path.slice(0, f.path.length - b.length) + nb : f.path };
    if (re && typeof f.body === "string" && rewritesFileRefs(b)) out.body = f.body.replace(re, (m: string) => renamed.get(m) || m);
    return out;
  });
}

/* ================================================================ celá projektová složka (desktop, ZIP) */

export interface BundleFile {
  /** Relativní cesta v projektové složce s „/“ (s předponou čísla). */
  path: string;
  /** Text (UTF-8). */
  body?: string;
  /** Binární obsah (sešit HMI .xlsx). */
  data?: Uint8Array;
  /** Neuloží se podle licence — důvod pro uživatele. */
  blocked?: string;
}
export interface ProjectBundle {
  /** Název projektové složky („260705_Podavaci_a_lisovaci_stanice…“). */
  folder: string;
  /** Soubor projektu ve složce („<složka>.plcstudio.json“). */
  projectFile: string;
  files: BundleFile[];
}

/**
 * Celá projektová složka: soubory roztříděné do podsložek, licence (patička Free, zamčené DXF,
 * nad limitem nic kromě projektu) uplatněná PŘED přejmenováním, předpona čísla projektu, sešit HMI
 * Siemens (.xlsx, když je HMI přihlášené) a soubor projektu `projectText` (projekt se ukládá vždy).
 * `gate` = brána projektu (license.ts `projectGate`; null = bez licence).
 */
export function projectBundle(prj: Project, opts: { gate?: ProjectGate | null; projectText?: string } = {}): ProjectBundle {
  const gate = opts.gate || null;
  const files: BundleFile[] = projectFolderFiles(prj, gate).map(f => {
    if (!gate) return { path: f.path, body: f.body };
    const r = applyLicenseToFile(f.path.slice(f.path.lastIndexOf("/") + 1), f.body, gate);
    return r.blocked ? { path: f.path, blocked: r.blocked } : { path: f.path, body: r.body };
  });
  if ((prj.platforms as PlatformKey[]).includes("siemens") && hmiModuleRegistered()) {
    const path = projectFileFolder("hmi_siemens.xlsx", "hmi") + "/hmi_siemens.xlsx";
    files.push(gate && gate.over ? { path, blocked: gate.reason } : { path, data: hmiSiemensWorkbook(prj, buildHmi(prj)) });
  }
  const folder = projectFolderName(prj);
  const projectFile = folder + ".plcstudio.json";
  const out = prefixProjectFiles(files, projectRef(prj).number);
  if (opts.projectText !== undefined) out.unshift({ path: projectFile, body: opts.projectText });
  return { folder, projectFile, files: out };
}

/** ZIP projektové složky (kořen archivu = složka projektu); zamčené soubory v něm nejsou. */
export function projectZip(b: ProjectBundle): Uint8Array {
  const enc = new TextEncoder();
  return zipStored(b.files.filter(f => !f.blocked && (f.body !== undefined || f.data))
    .map(f => ({ name: b.folder + "/" + f.path, data: f.data || enc.encode(f.body as string) })));
}
