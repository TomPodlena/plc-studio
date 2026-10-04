/**
 * PLCdesk — dokumenty bezpečnostního modulu a jeho přihlášení do sady projektu.
 *
 *   13_bezpecnostni_funkce.md   SRS: nebezpečí, funkce, PLr (S/F/P), architektura, komponenty,
 *                               výpočet PL, zapojení, bezpečné vzdálenosti, stav schválení
 *   14_plan_validace.md         plán ověření a validace + kontrolní seznamy po funkcích
 *   bezpecnostni_okruh.svg/.dxf výkres bezpečnostního okruhu (návrh)
 *   bezpečnostní program        safety_prog.ts (jen po schválení funkcí; jinak „čeká na schválení“)
 *   kusovník                    logika, bezpečnostní stykače, ventily, chybějící prvky
 * `registerSafetyModule()` (safety.ts) přihlásí celý modul: schvalování, oživení (fáze 10),
 * dokumenty a schémata (docs.ts) a kusovník (bom.ts); `unregisterSafetyModule()` ho odhlásí.
 */
import { Project } from "./model.js";
import { type ApprovalItem } from "./approval.js";
import { type CircuitSheet } from "./drawing.js";
import { type SafetyProposal } from "./safety.js";
export declare const SAFETY_FILE_SRS = "13_bezpecnostni_funkce.md";
export declare const SAFETY_FILE_VALIDATION = "14_plan_validace.md";
export declare function safetySrsMd(prj: Project, items?: ApprovalItem[], p?: SafetyProposal): string;
export declare function safetyValidationMd(prj: Project, items?: ApprovalItem[], p?: SafetyProposal): string;
export declare function safetyCircuitSheet(prj: Project, p?: SafetyProposal): CircuitSheet;
/** Platformy PLC, pro které má bezpečnostní program textový výstup (informace pro UI). */
export declare function safetyTargetsFor(prj: Project): Array<{
    target: string;
    label: string;
}>;
