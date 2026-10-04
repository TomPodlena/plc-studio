/**
 * PLCdesk — styl kódu OOP pro rodinu CODESYS (CODESYS V3.5, TwinCAT 3, Schneider Machine Expert,
 * WAGO e!COCKPIT, Delta DIADesigner-AX): JEDNO CHOVÁNÍ, DRUHÁ PODOBA ZÁPISU.
 *
 * Renderer stojí nad stejnou mezivrstvou (`buildIR`, ir.ts) a stejnými šablonami bloků
 * (`fbTemplate`) jako klasický styl — logika stavových automatů se NEOPISUJE, ale převádí ze
 * šablony: proměnné šablony se přejmenují (stav do základní třídy, vnitřní proměnné maďarskou
 * notací), tělo šablony se stane metodou `Cycle`. Pořadí vyhodnocení je totožné s klasickým
 * MAIN (enable → sekvence → bloky → porucha stroje), takže chování (výstupy, kroky, porucha,
 * stav bloků) je scan po scanu stejné — hlídá to emulátor (emu.test.ts: OOP = klasika = návrh).
 *
 * Třídy:
 *  - INTERFACE I_Device — METHOD Execute (jeden cyklus), METHOD Reset (kvitace), PROPERTY Fault,
 *    Status, Busy (jen GET),
 *  - FUNCTION_BLOCK ABSTRACT FB_DeviceBase IMPLEMENTS I_Device — stav (krok, porucha, busy,
 *    status 16#0000 / 8001 / 8002), kvitace (Reset → úroveň pro nejbližší Execute), vlastnosti,
 *    šablonová metoda Execute → abstraktní Cycle,
 *  - FB_Motor / FB_Valve / FB_AnalogIn / FB_AnalogOut EXTENDS FB_DeviceBase IMPLEMENTS I_Device
 *    — Cycle = tělo šablony třídy,
 *  - FB_Sequence — sekvence jedním CASE (`renderSeq` nad IR), krok / porucha přes VAR_IN_OUT
 *    (proměnné řízení zůstávají v MAIN — jména jsou rozhraním k HMI),
 *  - MAIN — instance (jména instM1… beze změny, HMI), `aDevices : ARRAY[1..N_DEVICES] OF I_Device`
 *    pro kvitaci a souhrn poruch v cyklu FOR s kontrolou odkazu `<> 0`.
 * Robustnost: žádné ukazatele, __NEW ani dynamická paměť, meze polí konstantou, žádné WHILE.
 *
 * Výstupy: ST výpis (Gen_Library.st, FB_Sequence.st, MAIN.st), PLCopen XML s rozšířením CODESYS
 * (`addData`: pouinheritance, method, property, interface — podle exportu CODESYS V3.5 SP20 a
 * TwinCAT; NEOVĚŘENO importem) a u TwinCATu soubory .TcPOU / .TcIO / .TcGVL (podle reálných
 * souborů TcUnit / AixOCAT; NEOVĚŘENO importem). Všechny podoby se staví z jednoho modelu
 * (`OopPou`), emulátor z XML / TcPOU výpis zpětně sestaví a porovná s ST výpisem.
 */
import { Project, PlatformKey } from "./model.js";
import { type IrFbClass } from "./ir.js";
export interface OopVar {
    name: string;
    type: string;
    init?: string;
    cmt?: string;
}
export interface OopBlock {
    kind: "in" | "out" | "inout" | "var" | "const";
    vars: OopVar[];
}
export interface OopMethod {
    name: string;
    access?: "PUBLIC" | "PROTECTED" | "PRIVATE";
    abstract?: boolean;
    ret?: string;
    blocks: OopBlock[];
    body: string;
    cmt?: string[];
}
export interface OopProp {
    name: string;
    type: string;
    access?: "PUBLIC" | "PROTECTED";
    get: string;
    pragma?: string;
}
export interface OopPou {
    kind: "fb" | "program" | "interface";
    name: string;
    abstract?: boolean;
    extends?: string;
    implements?: string[];
    /** komentář pod hlavičkou: JEDEN víceřádkový komentář (řádky bez značek, ASCII) — klíč překladu šablony */
    cmt: string[];
    /** samostatné komentáře před `cmt` (poznámka firemní knihovny) */
    notes?: string[];
    blocks: OopBlock[];
    body: string;
    methods: OopMethod[];
    props: OopProp[];
}
/** Rozhraní a jeho členové — jediný zdroj pro rozhraní, základní třídu i kontrolu emulátoru. */
export declare const OOP_ITF = "I_Device";
export declare const OOP_BASE = "FB_DeviceBase";
export declare const OOP_SEQ = "FB_Sequence";
/** Třída OOP podle třídy IR (Ventil → FB_Valve, ostatní jako klasika). */
export declare const OOP_CLASSES: Record<IrFbClass, string>;
/** Pole odkazů na zařízení, index cyklu, počet, souhrn poruch, instance sekvence (maďarská notace). */
export declare const OOP_MAIN: {
    readonly devices: "aDevices";
    readonly index: "iDev";
    readonly count: "N_DEVICES";
    readonly anyFault: "bAnyFault";
    readonly seq: "fbSeq";
};
/** Platí pro platformu styl OOP? (volba projektu × schopnost platformy) */
export declare function oopActive(prj: Project, plat: PlatformKey): boolean;
/** Třída zařízení ze šablony (vstupy / výstupy beze změny jmen, stav v základní třídě, tělo = Cycle). */
export declare function oopDeviceClass(cls: IrFbClass, tpl: string): OopPou;
export declare function oopInterface(): OopPou;
export declare function oopBase(): OopPou;
interface OopProgram {
    pous: OopPou[];
    library: OopPou[];
    seq?: OopPou;
    main: OopPou;
}
export declare function oopProgram(prj: Project, plat: PlatformKey): OopProgram;
/** Deklarační část objektu (hlavička, komentář, proměnné) — totéž v ST výpisu, TcPOU i PLCopen. */
export declare function pouDecl(p: OopPou): string;
export declare function methodDecl(m: OopMethod, inItf?: boolean): string;
export declare function propDecl(pr: OopProp, inItf?: boolean): string;
/**
 * Objekt výpisu jako deklarační texty a těla — společná podoba ST výpisu, TcPOU (Declaration /
 * Implementation) a PLCopen XML (InterfaceAsPlainText / body). Emulátor ji sestaví z TcPOU / XML
 * a výpis porovná s ST souborem (`oopListing`).
 */
export interface OopListingObj {
    kind: OopPou["kind"];
    decl: string;
    body: string;
    methods: Array<{
        decl: string;
        body: string;
    }>;
    props: Array<{
        decl: string;
        get: string;
    }>;
}
export declare function listingObj(p: OopPou): OopListingObj;
/** Výpis objektu v ST (tělo bloku bez odsazení, těla metod a GET odsazená o 4). */
export declare function oopListing(o: OopListingObj): string;
export declare function pouText(p: OopPou): string;
/** Soubor .TcPOU (FB / PROGRAM) nebo .TcIO (INTERFACE) — struktura podle reálných souborů (TcUnit, AixOCAT). */
export declare function tcFile(p: OopPou): string;
/** Soubor .TcGVL (globální proměnné I/O). */
export declare function tcGvl(name: string, decl: string): string;
/**
 * PLCopen XML (TC6 v2.01, namespace tc6_0200) s rozšířením CODESYS pro OOP: dědičnost
 * (`pouinheritance`), metody (`method`), vlastnosti (`property`), rozhraní (`interface`,
 * v addData projektu) a textové deklarace (`interfaceasplaintext` — nese ABSTRACT / přístup,
 * pro které schéma strukturu nemá). NEOVĚŘENO importem v CODESYS / TwinCAT.
 */
export declare function genPLCopenOopXML(prj: Project, plat: PlatformKey, prog?: OopProgram): string;
/** README — oddíl o stylu OOP (dokument pro člověka → `tr`). */
export declare function oopReadme(prj: Project, plat: PlatformKey): string;
/** Soubory programu ve stylu OOP (rodina CODESYS). */
export declare function genForOop(prj: Project, plat: PlatformKey): Record<string, string>;
/**
 * Diagram tříd programu (zjednodušené UML) pro softwarovou dokumentaci: rozhraní, abstraktní
 * základ, třídy zařízení (realizace / dědičnost), MAIN s polem odkazů (agregace) a FB_Sequence
 * (kompozice). Atributy: + vstup / výstup, - vnitřní proměnná; operace: + PUBLIC, # PROTECTED.
 */
export declare function oopClassSvg(prj: Project, plat?: PlatformKey): string;
/** Projekt má OOP aspoň na jedné své platformě. */
export declare function oopInProject(prj: Project): PlatformKey | undefined;
/** Soubor diagramu tříd v sadě projektu. */
export declare const OOP_CLASS_SVG = "00_diagram_trid.svg";
export {};
