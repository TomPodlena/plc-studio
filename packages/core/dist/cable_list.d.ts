/**
 * PLCdesk — kabelový seznam (CSV, středník): jeden řádek = jeden signál v poli (kanál svorkovnice X<n>:<k>).
 * Svorky a čísla vodičů přesně jako `svorkyCSV` (`modules()` + `wireNo`), typ kabelu jen z řádku kusovníku
 * téhož zařízení. Délku a průřez zadání (bez 3D) neobsahuje → sloupce prázdné, poznámka „doplní projektant“.
 */
import { Project } from "./model.js";
export declare const CABLE_LIST_FILE = "03_kabelovy_seznam.csv";
export declare function cableListCsv(prj0: Project): string;
