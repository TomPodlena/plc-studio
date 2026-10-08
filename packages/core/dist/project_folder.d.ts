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
import type { Project } from "./model.js";
import type { ProjectGate } from "./license.js";
/** Podsložky projektové složky (stejné názvy v každém jazyce — cesty na disku). */
export declare const PROJECT_DIRS: {
    readonly docs: "01_Dokumentace";
    readonly drawings: "02_Vykresy";
    readonly svg: "02_Vykresy/SVG";
    readonly dxf: "02_Vykresy/DXF";
    readonly code: "03_Program_PLC";
    readonly safetyCode: "03_Program_PLC/Bezpecnostni_program";
    readonly hmi: "04_HMI";
    readonly safety: "05_Bezpecnost";
    readonly bom: "06_Kusovnik";
    readonly commission: "07_Oziveni_a_FAT";
    readonly approval: "08_Schvaleni_a_revize";
    readonly exports: "09_Exporty";
    readonly eplan: "09_Exporty/EPLAN";
    readonly internal: "99_Interni";
};
export type ProjectDirKind = keyof typeof PROJECT_DIRS;
/** Název podsložky platformy („Siemens_SIMATIC“, „Rockwell_Allen-Bradley“…); neznámý klíč = klíč. */
export declare function platformFolderName(p: string): string;
/**
 * Podsložka projektové složky pro soubor `name` s druhem `hint` (`ProjectFile.dir`, u jednotlivého
 * uložení v desktopu totéž): „kod/<platforma>“, „kod/safety“, „vykresy“, „hmi“, „hmi/<platforma>“,
 * „bezpecnost“, „eplan“, „kusovnik“, „interni“, „exporty“, „dokumentace“. Dokumenty se třídí podle
 * jména (FAT → oživení, schválení → schvalování…); neznámé → 01_Dokumentace.
 */
export declare function projectFileFolder(name: string, hint?: string): string;
export interface FolderFile {
    /** Relativní cesta s „/“ (např. `03_Program_PLC/Siemens_SIMATIC/Gen_Main.scl`). */
    path: string;
    body: string;
    kind: "text" | "svg" | "dxf";
}
/** Sada souborů projektu roztříděná do podsložek (bez předpony). `gate` = brána knihovny (null = bez licence). */
export declare function projectFolderFiles(prj: Project, gate?: Pick<ProjectGate, "library"> | null): FolderFile[];
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
export declare const PREFIX_EXEMPT: RegExp;
/** Textové soubory, ve kterých se přepisují odkazy na jména souborů: dokumenty a README, ne kód PLC. */
export declare function rewritesFileRefs(name: string): boolean;
/**
 * Předpona čísla projektu „<číslo>_“ u každého souboru (`260705_01_FDS.md`, `260705_Gen_Main.scl`,
 * `260705_01_DI1_X1.dxf`) — mění se jen jméno souboru v cestě, ne podsložky. V dokumentech
 * (`rewritesFileRefs`: .md, .html, README / NAVOD / PROTOKOL .txt) se odkazy na původní jména souborů
 * sady přepíšou na nová — jen celá jména (ne část identifikátoru: „GOT_Tags.csv“ ≠ „Tags.csv“).
 * Kód PLC (.scl, .st, .L5X, .xml, .csv…) zůstává bajt po bajtu stejný. Výjimky `PREFIX_EXEMPT`
 * (objekty TwinCAT) beze změny. Soubor, který předponu už má, ji nedostane podruhé.
 * Bez čísla = kopie beze změny. Zamčené soubory (bez `body`) se jen přejmenují.
 */
export declare function prefixProjectFiles<T extends {
    path: string;
    body?: string;
}>(files: T[], number: string): T[];
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
export declare function projectBundle(prj: Project, opts?: {
    gate?: ProjectGate | null;
    projectText?: string;
}): ProjectBundle;
/** ZIP projektové složky (kořen archivu = složka projektu); zamčené soubory v něm nejsou. */
export declare function projectZip(b: ProjectBundle): Uint8Array;
