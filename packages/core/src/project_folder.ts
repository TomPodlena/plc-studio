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
import { licensedProjectFiles } from "./license.js";
import { allProjectFiles } from "./docs.js";

/** Podsložky složky dat projektu (stejné názvy v každém jazyce — cesty na disku). */
export const PROJECT_DIRS = {
  code: "kod", docs: "dokumentace", drawings: "vykresy", bom: "kusovnik", hmi: "hmi", exports: "exporty",
} as const;
export type ProjectDirKind = keyof typeof PROJECT_DIRS;

export interface FolderFile {
  /** Relativní cesta s „/“ (např. `kod/siemens/Gen_Main.scl`, `vykresy/01_DI1_X1.dxf`). */
  path: string;
  body: string;
  kind: "text" | "svg" | "dxf";
}

/** Sada souborů projektu roztříděná do podsložek (`PROJECT_DIRS`). `gate` = brána licence (null = bez licence). */
export function projectFolderFiles(prj: Project, gate: Pick<ProjectGate, "library"> | null = null): FolderFile[] {
  const files = gate ? licensedProjectFiles(prj, gate) : allProjectFiles(prj);
  const seen = new Set<string>();
  const out: FolderFile[] = [];
  for (const f of files) {
    const dir = f.dir || PROJECT_DIRS.exports;
    const name = dir.startsWith(PROJECT_DIRS.code + "/") ? f.name : f.save;
    const path = dir + "/" + name;
    if (seen.has(path)) continue;          // stejný soubor z víc zdrojů (nemá nastat) — první vyhrává
    seen.add(path);
    out.push({ path, body: f.body, kind: f.kind });
  }
  return out;
}
