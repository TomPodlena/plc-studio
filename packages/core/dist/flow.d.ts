/**
 * PLCdesk — diagramy funkce stroje:
 *  - funkční diagram cyklu (kroky sekvence a podmínky přechodu, styl GRAFCET),
 *  - časový diagram signálů z výsledku simulace.
 * Prvky nesou odkazy data-step / data-dev / data-io pro interaktivní náhledy.
 */
import { Project } from "./model.js";
import { SimResult } from "./sim.js";
/**
 * Blokové schéma stroje: každé zařízení jako blok se svými signály, po skupinách
 * podle druhu. Kolečko u signálu slouží živé simulaci jako kontrolka stavu.
 */
export declare function svgMachine(prj: Project): string;
/** Funkční diagram cyklu; `run` (běžný cyklus ze simulace) doplní časy kroků. */
export declare function svgFlow(prj: Project, run?: SimResult | null): string;
/** Časový diagram: kroky sekvence, výstupy a zpětná hlášení zařízení v čase. */
export declare function svgTiming(prj: Project, run: SimResult): string;
