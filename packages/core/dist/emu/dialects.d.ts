/**
 * PLCdesk — dialektové profily emulátoru překladu (8 platforem).
 *
 * Každé pravidlo nese zdroj: manuál výrobce nebo zprávu ověření dialektů (2026-10-03).
 * Kde manuál chování neuvádí, je pravidlo jen upozornění (warn) a v dokumentu se uvádí
 * jako neověřené. Emulátor NENÍ překladač výrobce — reálný import v IDE je dál nutný.
 */
import type { PlatformKey } from "../model.js";
/** Zdroje pravidel (URL). */
export declare const SRC: {
    readonly iec: "https://plcopen.org/iec-61131-3";
    readonly cdsRules: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_rules.html";
    readonly cdsComment: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_st_comment.html";
    readonly cdsAddr: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operands_addresses.html";
    readonly cdsPragma: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_pragma_attribute_qualified_only.html";
    readonly cdsConv: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_type_conversion.html";
    readonly tcAt: "https://infosys.beckhoff.com/content/1033/tc3_plc_intro/11948825611.html";
    readonly tcAlloc: "https://infosys.beckhoff.com/content/1033/tc3_plc_intro/12081664011.html";
    readonly tcComment: "https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2528329355.html";
    readonly tcOop: "https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2526090891.html";
    readonly cdsItf: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_obj_interface.html";
    readonly cdsItfProp: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_obj_interface_property.html";
    readonly cdsProp: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_obj_property.html";
    readonly cdsMethod: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_obj_method.html";
    readonly cdsThis: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_pointer_this.html";
    readonly tcAbstract: "https://infosys.beckhoff.com/content/1033/tc3_plc_intro/6413748235.html";
    readonly tcItfRef: "https://infosys.beckhoff.com/content/1033/tc3_plc_intro/5680748299.html";
    readonly sieGuide: "https://support.industry.siemens.com/cs/ww/en/view/81318674";
    readonly sieTon: "https://abedgnu.github.io/Automation-Notes/chapters/PLC/Siemens/exercises-solutions.html";
    readonly sieScl: "https://www.solisplc.com/tutorials/case-statement-scl-efficient-plc-programming";
    readonly fx5pd: "https://dl.mitsubishielectric.com/dl/fa/document/manual/plcf/jy997d55701/jy997d55701m.pdf";
    readonly fx5ins: "https://dl.mitsubishielectric.com/dl/fa/document/manual/plcf/jy997d55801/jy997d55801z.pdf";
    readonly gxw3: "https://dl.mitsubishielectric.com/dl/fa/document/manual/plc/sh081215eng/sh081215engau.pdf";
    readonly w501: "https://files.omron.eu/downloads/latest/manual/en/w501_nj_nx-series_cpu_unit_software_users_manual_en.pdf";
    readonly w502: "https://files.omron.eu/downloads/latest/manual/en/w502_nj_nx-series_instructions_reference_manual_en.pdf";
    readonly w504: "https://files.omron.eu/downloads/latest/manual/en/w504_sysmac_studio_operation_manual_en.pdf";
    readonly pm007: "https://literature.rockwellautomation.com/idc/groups/literature/documents/pm/1756-pm007_-en-p.pdf";
    readonly rm003: "https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/1756-rm003_-en-p.pdf";
    readonly pm010: "https://literature.rockwellautomation.com/idc/groups/literature/documents/pm/1756-pm010_-en-p.pdf";
    readonly pm004: "https://literature.rockwellautomation.com/idc/groups/literature/documents/pm/1756-pm004_-en-p.pdf";
    readonly rm014: "https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/1756-rm014_-en-p.pdf";
    readonly ulSt: "https://www.unitronicsplc.com/Download/SoftwareHelp/!UniLogicWebhelp2024/Ladder/Structured_Text_Functions.htm";
    readonly ulRef: "https://www.unitronicsplc.com/Download/SoftwareHelp/!UniLogicWebhelp2024/Ladder/Structured_Text_(ST)/ST_Language_Reference.htm";
    readonly ulDt: "https://www.unitronicsplc.com/Download/SoftwareHelp/!UniLogicWebhelp2024/Tags/Data_Types.htm";
    readonly ulNew: "https://www.unitronicsplc.com/Download/SoftwareHelp/!UniLogicWebhelp2024/About_UniLogic/What_s_New_.htm";
};
export type Cat = "bool" | "bits" | "sint" | "uint" | "real" | "time" | "str" | "fb" | "struct" | "array" | "enum" | "void";
export interface ElemInfo {
    cat: Cat;
    bits: number;
    min?: number;
    max?: number;
}
/** Elementární typy (klíč velkými písmeny). */
export declare const ELEM: Record<string, ElemInfo>;
/** Aliasy názvů typů v dialektech (Unitronics tagy, Siemens). */
export declare const TYPE_ALIAS: Record<string, string>;
export declare function isWidening(from: string, to: string): boolean;
export type Lvl = "ok" | "info" | "warn" | "error";
export interface Dialect {
    plat: PlatformKey;
    /** Název pro dokument. */
    label: string;
    /** Komentáře (* *) se vnořují (CODESYS / TwinCAT). */
    nestedComments: boolean;
    /** Siemens SCL: #lokální, "globální", BEGIN, REGION, DATA_BLOCK. */
    scl: boolean;
    /** Rutina bez deklarací (Logix, funkce UniLogic) — deklarace z tabulky tagů / L5X. */
    statementsOnly: boolean;
    /** Úroveň nálezu END_IF / END_CASE … bez středníku. */
    endSemi: Lvl;
    /** Celé soubory čisté ASCII. */
    ascii: Lvl;
    /** Pravidla identifikátorů. */
    maxIdent: number;
    noDoubleUnderscore: Lvl;
    noTrailingUnderscore: Lvl;
    noLeadingUnderscore: Lvl;
    /** Další rezervovaná jména (velkými písmeny) — např. instrukce Sysmac. */
    reserved: Set<string>;
    /** Jména, která vypadají jako operand zařízení (GX Works3: X0, M1, D100 …). */
    deviceName?: RegExp;
    /** Zakázaná předpona (Sysmac `P_`). */
    reservedPrefix?: RegExp;
    /** Podporuje počáteční hodnoty proměnných (FX5 ne). */
    initValues: boolean;
    /** Nejdelší PT časovače TON [ms] (FX5: 32767). */
    timerMaxMs?: number;
    /** Úroveň nálezu typového převodu z → do (mimo shodné typy a literály). */
    conv: (from: ElemInfo & {
        name: string;
    }, to: ElemInfo & {
        name: string;
    }) => Lvl;
    /** Standardní funkční bloky. */
    stdFbs: Set<string>;
    /** Standardní funkce (velkými písmeny); `X_TO_Y` se ověřuje zvlášť (`convFns`). */
    fns: Set<string>;
    /** Převodní funkce IEC X_TO_Y jsou k dispozici. */
    convFns: boolean;
    /** Převody REAL→celé číslo ořezávají (UniLogic TO_INT) místo zaokrouhlení. */
    truncReal: boolean;
    /** BOOL / čísla se převádějí implicitně (Logix: BOOL := 1). */
    looseBool: boolean;
    /** Rozšíření OOP (INTERFACE, METHOD, PROPERTY, EXTENDS / IMPLEMENTS) — CODESYS V3.5, TwinCAT 3. */
    oop?: boolean;
    /** Zdroj obecných pravidel (syntaxe, deklarace) pro tuto platformu. */
    src: {
        syntax: string;
        ident: string;
        conv: string;
        semi: string;
        reserved: string;
        addr?: string;
        ascii?: string;
    };
}
/** Klíčová slova IEC 61131-3 (+ OOP rozšíření ed. 3) a názvy elementárních typů. */
export declare const IEC_KEYWORDS: Set<string>;
export declare const DIALECTS: Record<PlatformKey, Dialect>;
/** Popisy pravidel (pro dokument; klíče překladu). */
export declare const RULES: Record<string, string>;
