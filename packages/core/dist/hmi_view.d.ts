/**
 * PLCdesk — HMI: SVG náhledy obrazovek, JSON popis obrazovek a samostatné webové HMI.
 *
 * Jedna geometrie (`HmiScreen.elems` z hmi.ts) → SVG náhled (výkres v dokumentaci, desktop,
 * web) i webové HMI: stránka obsahuje tytéž SVG a skript jen mění barvy / hodnoty prvků
 * označených `data-k` / `data-r` podle hodnot tagů. Prvky nesou `data-dev`, `data-tag`,
 * `data-screen`, `data-step` a popis v `<title>` (jako schémata v drawing.ts).
 */
import { Project } from "./model.js";
import { type HmiModel, type HmiScreen } from "./hmi.js";
/** SVG náhled obrazovky (klidový stav: vše šedé, hodnoty „—"). */
export declare function hmiScreenSVG(s: HmiScreen): string;
export declare const HMI_JSON_FORMAT = "plcdesk-hmi";
/** JSON popis HMI (tagy, alarmy, obrazovky) pro budoucí runtime. */
export declare function hmiJson(prj: Project, m?: HmiModel): string;
/**
 * Samostatná statická stránka webového HMI (bez závislostí): SVG obrazovky, navigace,
 * živý seznam alarmů, tlačítka. Připojení: režim „demo" (lokální hodnoty) nebo WebSocket
 * s jednoduchým JSON protokolem — stub pro bránu OPC UA ↔ WebSocket (prohlížeč OPC UA
 * binárně neumí). Protokol: klient → `{op:"subscribe",tags:[…]}`, `{op:"write",tag,value}`;
 * server → `{op:"update",values:{tag:value,…}}`.
 */
export declare function hmiWebHtml(prj: Project, m?: HmiModel): string;
