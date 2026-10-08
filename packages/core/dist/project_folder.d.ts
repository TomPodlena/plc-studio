/**
 * PLCdesk — sada souborů projektu pro složku dat projektu (`prj.meta.dataDir`, desktop „Uložit vše
 * do složky projektu“). Obsah je přesně `licensedProjectFiles` (kód všech platforem, dokumentace,
 * výkresy SVG + DXF, kusovník, HMI, exporty) — jen roztříděný do podsložek. Jména souborů v podsložkách
 * jsou původní (README a dokumenty na sebe odkazují jmény), kód platformy bez předpony platformy.
 * Soubor projektu a binární soubory (sešit HMI .xlsx) přidává klient; licenci (patička Free, zamčené
 * DXF / nad limitem) uplatňuje klient na každý soubor stejně jako u ostatního ukládání.
 */
import type { Project } from "./model.js";
import type { ProjectGate } from "./license.js";
/** Podsložky složky dat projektu (stejné názvy v každém jazyce — cesty na disku). */
export declare const PROJECT_DIRS: {
    readonly code: "kod";
    readonly docs: "dokumentace";
    readonly drawings: "vykresy";
    readonly bom: "kusovnik";
    readonly hmi: "hmi";
    readonly exports: "exporty";
};
export type ProjectDirKind = keyof typeof PROJECT_DIRS;
export interface FolderFile {
    /** Relativní cesta s „/“ (např. `kod/siemens/Gen_Main.scl`, `vykresy/01_DI1_X1.dxf`). */
    path: string;
    body: string;
    kind: "text" | "svg" | "dxf";
}
/** Sada souborů projektu roztříděná do podsložek (`PROJECT_DIRS`). `gate` = brána licence (null = bez licence). */
export declare function projectFolderFiles(prj: Project, gate?: Pick<ProjectGate, "library"> | null): FolderFile[];
