/** Složení všech generovaných souborů programu pro jednu platformu. */
import { Project, PlatformKey } from "./model.js";
export declare function genFor(prj: Project, plat: PlatformKey): Record<string, string>;
