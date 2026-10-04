/**
 * PLCdesk — HMI: dokument `16_hmi.md`, soubory sady projektu a přihlášení modulu.
 *
 * `registerHmiModule()` přihlásí přes `registerDocProvider` (docs.ts):
 *   16_hmi.md                    seznam tagů, alarmů, obrazovek, exporty a stav jejich ověření
 *   HMI — <platforma>            soubory exportu pro HMI výrobce (hmiFiles, hmi_export.ts)
 *   HMI — web                    hmi_web.html (samostatné webové HMI), hmi_screens.json, SVG obrazovek
 * Do přihlášení (klient, až bude krok HMI v UI) je sada projektu beze změny.
 */
import { Project } from "./model.js";
import { type ProjectFile } from "./docs.js";
import { type HmiModel } from "./hmi.js";
export declare const HMI_DOC_FILE = "16_hmi.md";
/** Dokument HMI: tagy, alarmy, obrazovky, cesty v programu a exporty se stavem ověření. */
export declare function hmiDocMd(prj: Project, m?: HmiModel): string;
/** Soubory HMI do sady projektu (exporty platforem, webové HMI, JSON, náhledy obrazovek). */
export declare function hmiProjectFiles(prj: Project, m?: HmiModel): ProjectFile[];
/** Přihlásí modul HMI do dokumentace a sady projektu. Vrací odhlášení. */
export declare function registerHmiModule(): () => void;
export declare function unregisterHmiModule(): void;
export declare function hmiModuleRegistered(): boolean;
