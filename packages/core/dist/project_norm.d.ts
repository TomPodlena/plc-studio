/**
 * PLCdesk — normalizace projektu načteného ze souboru / úložiště (web i desktop, jedno pravidlo).
 *
 * Soubor projektu může přijít odkudkoli (web, desktop, starší verze, ruční úprava, cizí JSON). Kroky
 * i jádro počítají s úplnou strukturou (`blankProject`), takže `normalizeProject`:
 * - vrátí projekt v tvaru modelu — chybějící části doplní z prázdného projektu,
 * - každou hodnotu TYPOVĚ ověří a vadné POLOŽKY zahodí (zařízení bez platného id / třídy, signál
 *   s `devId` = seznam, krok s `dev` = seznam, blokování s objektem…) — celý soubor neodmítne,
 * - jednořádková pole (název, číslo, zákazník, označení, popis zařízení, jednotka, tag, komentář I/O,
 *   adresa, názvy záznamů a poloh) vyčistí `lineSafe` (konce řádků a řídicí znaky → mezera, čistý text beze změny); popis
 *   projektu zůstává víceřádkový (`multiLineSafe`),
 * - vyhodí `Error("not a project")`, jen když vstup není objekt nebo nemá žádnou část projektu
 *   (cizí JSON nesmí přepsat rozpracovaný návrh).
 *
 * Bezpečnostní data (`safety`), revize, nabídku a kopii knihovny normalizují klienti (web `normSafety` /
 * `normBiz`, desktop `project.normalize_safety` / `normalize_biz`) — tady se nepřenášejí.
 * Pravidla vznikla sjednocením web `normProject` a desktop `project.normalize` (test odolnosti 2026-10-08:
 * desktop dřív spadl TypeError na `program.estop` = seznam a aplikace se nespustila).
 */
import { type Project } from "./model.js";
/** Akce kroků, které generátor zná (model.ts SeqAct) — jiná akce = krok se zahodí. */
export declare const SEQ_ACTS: readonly ["start", "stop", "open", "close", "wait", "waitOn", "waitOff", "home", "posRecord", "setPressure", "setFlow", "moveAbs", "moveRel", "velocity", "halt", "waitInPos"];
/**
 * Projekt z načteného JSON v bezpečném tvaru (viz hlavička souboru). Nejde-li o projekt, vyhodí chybu.
 * Vrácený projekt nese neenumerovatelné `guidsAdded` (true = doplnily se GUID / starý projekt → uložit).
 */
export declare function normalizeProject(raw: unknown): Project;
