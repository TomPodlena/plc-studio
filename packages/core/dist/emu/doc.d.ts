/**
 * PLCdesk — dokument 15_emulace_prekladu.md: výsledek emulace překladu a běhu pro platformy
 * projektu. Výrazně upozorňuje, že emulátor NENÍ překladač výrobce.
 */
import type { Project } from "../model.js";
export declare const EMU_DOC_FILE = "15_emulace_prekladu.md";
type EmuApi = {
    emulateAll: typeof import("./index.js").emulateAll;
};
export declare function bindEmuApi(a: EmuApi): void;
/** Markdown dokument emulace (platformy projektu; bez platforem všech 8). */
export declare function emuDocMd(prj: Project): string;
/** Přihlásí dokument emulace do dokumentace projektu. Vrací odhlášení. */
export declare function registerEmuModule(): () => void;
export declare function unregisterEmuModule(): void;
export declare function emuModuleRegistered(): boolean;
export {};
