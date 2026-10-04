/**
 * PLCdesk — dialektové profily emulátoru překladu (8 platforem).
 *
 * Každé pravidlo nese zdroj: manuál výrobce nebo zprávu ověření dialektů (2026-10-03).
 * Kde manuál chování neuvádí, je pravidlo jen upozornění (warn) a v dokumentu se uvádí
 * jako neověřené. Emulátor NENÍ překladač výrobce — reálný import v IDE je dál nutný.
 */
import type { PlatformKey } from "../model.js";
import { N_ } from "../i18n.js";

/** Zdroje pravidel (URL). */
export const SRC = {
  iec: "https://plcopen.org/iec-61131-3",
  cdsRules: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_rules.html",
  cdsComment: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_st_comment.html",
  cdsAddr: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operands_addresses.html",
  cdsPragma: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_pragma_attribute_qualified_only.html",
  cdsConv: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_type_conversion.html",
  tcAt: "https://infosys.beckhoff.com/content/1033/tc3_plc_intro/11948825611.html",
  tcAlloc: "https://infosys.beckhoff.com/content/1033/tc3_plc_intro/12081664011.html",
  tcComment: "https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2528329355.html",
  tcOop: "https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2526090891.html",
  sieGuide: "https://support.industry.siemens.com/cs/ww/en/view/81318674",
  sieTon: "https://abedgnu.github.io/Automation-Notes/chapters/PLC/Siemens/exercises-solutions.html",
  sieScl: "https://www.solisplc.com/tutorials/case-statement-scl-efficient-plc-programming",
  fx5pd: "https://dl.mitsubishielectric.com/dl/fa/document/manual/plcf/jy997d55701/jy997d55701m.pdf",
  fx5ins: "https://dl.mitsubishielectric.com/dl/fa/document/manual/plcf/jy997d55801/jy997d55801z.pdf",
  gxw3: "https://dl.mitsubishielectric.com/dl/fa/document/manual/plc/sh081215eng/sh081215engau.pdf",
  w501: "https://files.omron.eu/downloads/latest/manual/en/w501_nj_nx-series_cpu_unit_software_users_manual_en.pdf",
  w502: "https://files.omron.eu/downloads/latest/manual/en/w502_nj_nx-series_instructions_reference_manual_en.pdf",
  w504: "https://files.omron.eu/downloads/latest/manual/en/w504_sysmac_studio_operation_manual_en.pdf",
  pm007: "https://literature.rockwellautomation.com/idc/groups/literature/documents/pm/1756-pm007_-en-p.pdf",
  rm003: "https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/1756-rm003_-en-p.pdf",
  pm010: "https://literature.rockwellautomation.com/idc/groups/literature/documents/pm/1756-pm010_-en-p.pdf",
  pm004: "https://literature.rockwellautomation.com/idc/groups/literature/documents/pm/1756-pm004_-en-p.pdf",
  rm014: "https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/1756-rm014_-en-p.pdf",
  ulSt: "https://www.unitronicsplc.com/Download/SoftwareHelp/!UniLogicWebhelp2024/Ladder/Structured_Text_Functions.htm",
  ulRef: "https://www.unitronicsplc.com/Download/SoftwareHelp/!UniLogicWebhelp2024/Ladder/Structured_Text_(ST)/ST_Language_Reference.htm",
  ulDt: "https://www.unitronicsplc.com/Download/SoftwareHelp/!UniLogicWebhelp2024/Tags/Data_Types.htm",
  ulNew: "https://www.unitronicsplc.com/Download/SoftwareHelp/!UniLogicWebhelp2024/About_UniLogic/What_s_New_.htm",
} as const;

/* ------------------------------------------------------------ datové typy */

export type Cat = "bool" | "bits" | "sint" | "uint" | "real" | "time" | "str" | "fb" | "struct" | "array" | "enum" | "void";

export interface ElemInfo { cat: Cat; bits: number; min?: number; max?: number; }

/** Elementární typy (klíč velkými písmeny). */
export const ELEM: Record<string, ElemInfo> = {
  BOOL: { cat: "bool", bits: 1, min: 0, max: 1 },
  BYTE: { cat: "bits", bits: 8, min: 0, max: 255 },
  WORD: { cat: "bits", bits: 16, min: 0, max: 65535 },
  DWORD: { cat: "bits", bits: 32, min: 0, max: 4294967295 },
  LWORD: { cat: "bits", bits: 64, min: 0, max: 2 ** 53 },
  SINT: { cat: "sint", bits: 8, min: -128, max: 127 },
  INT: { cat: "sint", bits: 16, min: -32768, max: 32767 },
  DINT: { cat: "sint", bits: 32, min: -2147483648, max: 2147483647 },
  LINT: { cat: "sint", bits: 64, min: -(2 ** 53), max: 2 ** 53 },
  USINT: { cat: "uint", bits: 8, min: 0, max: 255 },
  UINT: { cat: "uint", bits: 16, min: 0, max: 65535 },
  UDINT: { cat: "uint", bits: 32, min: 0, max: 4294967295 },
  ULINT: { cat: "uint", bits: 64, min: 0, max: 2 ** 53 },
  REAL: { cat: "real", bits: 32 },
  LREAL: { cat: "real", bits: 64 },
  TIME: { cat: "time", bits: 32, min: -2147483648, max: 2147483647 },
  LTIME: { cat: "time", bits: 64 },
  STRING: { cat: "str", bits: 0 },
};

/** Aliasy názvů typů v dialektech (Unitronics tagy, Siemens). */
export const TYPE_ALIAS: Record<string, string> = {
  BIT: "BOOL", INT16: "INT", UINT16: "UINT", INT32: "DINT", UINT32: "UDINT", INT8: "SINT", UINT8: "USINT",
  FLOAT: "REAL", "WORD [SIGNED]": "INT", "WORD [UNSIGNED]/BIT STRING [16-BIT]": "WORD", "DOUBLE WORD [SIGNED]": "DINT",
  "FLOAT [SINGLE PRECISION]": "REAL",
};

/** Implicitní rozšíření dle IEC 61131-3 ed. 3 (tabulka implicitních převodů). */
const WIDEN: Record<string, string[]> = {
  SINT: ["INT", "DINT", "LINT", "REAL", "LREAL"],
  INT: ["DINT", "LINT", "REAL", "LREAL"],
  DINT: ["LINT", "LREAL"],
  USINT: ["UINT", "UDINT", "ULINT", "INT", "DINT", "LINT", "REAL", "LREAL"],
  UINT: ["UDINT", "ULINT", "DINT", "LINT", "REAL", "LREAL"],
  UDINT: ["ULINT", "LINT", "LREAL"],
  REAL: ["LREAL"],
  BYTE: ["WORD", "DWORD", "LWORD"],
  WORD: ["DWORD", "LWORD"],
  DWORD: ["LWORD"],
  TIME: ["LTIME"],
};
export function isWidening(from: string, to: string): boolean { return (WIDEN[from] || []).includes(to); }

/* ------------------------------------------------------------ profil */

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
  conv: (from: ElemInfo & { name: string }, to: ElemInfo & { name: string }) => Lvl;
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
  /** Zdroj obecných pravidel (syntaxe, deklarace) pro tuto platformu. */
  src: { syntax: string; ident: string; conv: string; semi: string; reserved: string; addr?: string; ascii?: string };
}

/** Klíčová slova IEC 61131-3 (+ OOP rozšíření ed. 3) a názvy elementárních typů. */
export const IEC_KEYWORDS = new Set(("ACTION END_ACTION ARRAY OF AT BY CASE END_CASE CONFIGURATION END_CONFIGURATION CONSTANT DO ELSE ELSIF "
  + "END_FOR END_IF END_REPEAT END_WHILE EXIT CONTINUE FALSE FOR FUNCTION END_FUNCTION FUNCTION_BLOCK END_FUNCTION_BLOCK IF THEN "
  + "PROGRAM END_PROGRAM REPEAT UNTIL RETURN STRUCT END_STRUCT TO TRUE TYPE END_TYPE VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT "
  + "VAR_GLOBAL VAR_EXTERNAL VAR_TEMP VAR_STAT VAR_INST END_VAR WHILE AND OR XOR NOT MOD RETAIN NON_RETAIN PERSISTENT "
  + "METHOD END_METHOD INTERFACE END_INTERFACE PROPERTY END_PROPERTY EXTENDS IMPLEMENTS THIS SUPER ABSTRACT FINAL "
  + "PUBLIC PRIVATE PROTECTED INTERNAL POINTER REFERENCE REF_TO RESOURCE END_RESOURCE TASK ON WITH STEP END_STEP "
  + "TRANSITION END_TRANSITION FROM INITIAL_STEP R_EDGE F_EDGE").split(" ").concat(Object.keys(ELEM)));

/** Klíčová slova navíc v SCL (TIA). */
const SCL_KEYWORDS = ["BEGIN", "VERSION", "DATA_BLOCK", "END_DATA_BLOCK", "ORGANIZATION_BLOCK", "END_ORGANIZATION_BLOCK",
  "REGION", "END_REGION", "GOTO", "TITLE", "AUTHOR", "FAMILY", "NAME", "KNOW_HOW_PROTECT", "NON_RETAIN", "DB_SPECIFIC"];

/**
 * Instrukce Sysmac (W502), se kterými se nesmí shodovat jméno proměnné (W501 6-84: Reserved Words,
 * nerozlišuje velikost písmen). Výběr instrukcí, jejichž jména se v programech strojů skutečně
 * mohou objevit jako jména proměnných.
 */
const SYSMAC_INSTR = ("RESET SET UP DOWN INC DEC CLEAR SWAP LOCK UNLOCK MOVE MOVEBIT MOVEDIGIT BAND DEADBAND ZONE SCALE LIMIT SEL MUX MAX MIN "
  + "ABS SQRT LN LOG EXP EXPT SIN COS TAN ASIN ACOS ATAN SHL SHR ROL ROR TON TOF TP TPR TONR CTU CTD CTUD R_TRIG F_TRIG RS SR "
  + "OUT OUTNOT KEEP CMP ZCP ADD SUB MUL DIV MOD AND OR XOR NOT MOVE TIMER COUNTER SIGN").split(" ");

/** Standardní FB IEC. */
const IEC_FBS = ["TON", "TOF", "TP", "R_TRIG", "F_TRIG", "RS", "SR", "CTU", "CTD", "CTUD"];
const IEC_FNS = ["ABS", "SQRT", "LN", "LOG", "EXP", "EXPT", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "MIN", "MAX", "LIMIT", "SEL",
  "MOVE", "TRUNC"];

/** Převodní úroveň podle přísnosti dialektu. */
function convBy(narrow: Lvl, cross: Lvl, realToInt: Lvl, boolNum: Lvl, widen: Lvl = "ok") {
  return (f: ElemInfo & { name: string }, t: ElemInfo & { name: string }): Lvl => {
    if (f.name === t.name) return "ok";
    if (f.cat === "time" || t.cat === "time") return f.cat === t.cat && isWidening(f.name, t.name) ? "ok" : "error";
    if (f.cat === "str" || t.cat === "str") return "error";
    if (f.cat === "bool" || t.cat === "bool") return boolNum;
    if (isWidening(f.name, t.name)) return widen;
    if (f.cat === "real" && t.cat !== "real") return realToInt;
    if (f.cat === "real" && t.cat === "real") return narrow;
    const fi = f.cat === "sint" || f.cat === "uint", ti = t.cat === "sint" || t.cat === "uint";
    if (fi && ti) return narrow;
    if (fi && t.cat === "real") return narrow;
    return cross;                                   // celé číslo ↔ bitový řetězec
  };
}

const base = (o: Partial<Dialect> & Pick<Dialect, "plat" | "label" | "src">): Dialect => ({
  nestedComments: false, scl: false, statementsOnly: false, endSemi: "error", ascii: "ok",
  maxIdent: 127, noDoubleUnderscore: "error", noTrailingUnderscore: "ok", noLeadingUnderscore: "ok",
  reserved: new Set(), initValues: true, conv: convBy("error", "error", "error", "error"),
  stdFbs: new Set(IEC_FBS), fns: new Set(IEC_FNS), convFns: true, truncReal: false, looseBool: false,
  ...o,
});

const CDS_SRC = { syntax: SRC.cdsRules, ident: SRC.cdsRules, conv: SRC.cdsConv, semi: SRC.cdsRules, reserved: SRC.cdsRules, addr: SRC.cdsAddr };

export const DIALECTS: Record<PlatformKey, Dialect> = {
  siemens: base({
    plat: "siemens", label: "Siemens TIA Portal SCL (S7-1200/1500)", scl: true,
    maxIdent: 128, noDoubleUnderscore: "ok",
    reserved: new Set(SCL_KEYWORDS),
    /* SCL s „IEC check" — implicitní převody jen rozšiřující; TIME ↔ DINT ani REAL → INT ne */
    conv: convBy("error", "error", "error", "error"),
    stdFbs: new Set(["TON_TIME", "TOF_TIME", "TP_TIME", "TON", "TOF", "TP", "R_TRIG", "F_TRIG", "RS", "SR", "CTU", "CTD", "CTUD"]),
    fns: new Set([...IEC_FNS, "NORM_X", "SCALE_X", "ROUND", "CEIL", "FLOOR"]),
    src: { syntax: SRC.sieScl, ident: SRC.sieGuide, conv: SRC.sieGuide, semi: SRC.sieScl, reserved: SRC.sieGuide, addr: SRC.sieGuide },
  }),
  codesys: base({
    plat: "codesys", label: "CODESYS V3.5 (WAGO, Festo, Eaton…)", nestedComments: true, endSemi: "info",
    conv: convBy("warn", "warn", "error", "error"), src: CDS_SRC,
  }),
  beckhoff: base({
    plat: "beckhoff", label: "Beckhoff TwinCAT 3", nestedComments: true, endSemi: "info",
    conv: convBy("warn", "warn", "error", "error"),
    src: { ...CDS_SRC, syntax: SRC.tcComment, addr: SRC.tcAlloc },
  }),
  schneider: base({
    plat: "schneider", label: "Schneider EcoStruxure Machine Expert (CODESYS)", nestedComments: true, endSemi: "info",
    conv: convBy("warn", "warn", "error", "error"), src: CDS_SRC,
  }),
  mitsubishi: base({
    plat: "mitsubishi", label: "Mitsubishi GX Works3 (MELSEC iQ-F FX5)",
    initValues: false, timerMaxMs: 32767,
    deviceName: /^(?:(?:X|Y|B|W|SB|SW)[0-9A-F]+|(?:M|L|F|V|S|SM|D|SD|R|ZR|T|ST|C|LC|LT|LST|Z|LZ|K|H|P|I|N)[0-9]+)$/i,
    conv: convBy("error", "error", "error", "error", "warn"),
    src: { syntax: SRC.fx5pd, ident: SRC.gxw3, conv: SRC.fx5pd, semi: SRC.fx5pd, reserved: SRC.gxw3, addr: SRC.fx5ins },
  }),
  omron: base({
    plat: "omron", label: "Omron Sysmac Studio (NX/NJ)",
    noTrailingUnderscore: "error", noLeadingUnderscore: "error", maxIdent: 127,
    reserved: new Set(SYSMAC_INSTR), reservedPrefix: /^P_/i,
    src: { syntax: SRC.w501, ident: SRC.w501, conv: SRC.w501, semi: SRC.w501, reserved: SRC.w502, addr: SRC.w504 },
  }),
  rockwell: base({
    plat: "rockwell", label: "Rockwell Studio 5000 Logix Designer (L5X)", statementsOnly: true, ascii: "error",
    maxIdent: 40, noTrailingUnderscore: "error",
    conv: convBy("ok", "ok", "ok", "ok"), looseBool: true, convFns: false,
    stdFbs: new Set(["FBD_TIMER"]),
    fns: new Set(["ABS", "ACOS", "ASIN", "ATAN", "COS", "DEG", "LN", "LOG", "RAD", "SIN", "SQRT", "TAN", "TRUNC"]),
    src: { syntax: SRC.pm007, ident: SRC.pm004, conv: SRC.pm007, semi: SRC.pm007, reserved: SRC.pm007, addr: SRC.rm014, ascii: SRC.pm007 },
  }),
  unitronics: base({
    plat: "unitronics", label: "Unitronics UniLogic (UniStream), ST", statementsOnly: true, ascii: "error", endSemi: "warn",
    conv: convBy("warn", "warn", "error", "error"), truncReal: true,
    stdFbs: new Set(["TON", "TOF", "TP"]),
    fns: new Set([...IEC_FNS, "TO_REAL", "TO_INT", "TO_DINT", "TO_UINT", "TO_UDINT", "TO_BOOL"]),
    src: { syntax: SRC.ulRef, ident: SRC.ulDt, conv: SRC.ulRef, semi: SRC.ulRef, reserved: SRC.ulRef, ascii: SRC.ulSt },
  }),
};

/** Popisy pravidel (pro dokument; klíče překladu). */
export const RULES: Record<string, string> = {
  syntax: N_("Syntaxe ST / SCL (párování bloků, středníky, výrazy)"),
  "end-semicolon": N_("Středník za END_IF / END_CASE / END_FOR …"),
  undeclared: N_("Každý identifikátor je deklarovaný"),
  duplicate: N_("Jména jsou jedinečná bez ohledu na velikost písmen"),
  "type-conv": N_("Typová kontrola a implicitní převody"),
  "literal-range": N_("Literál v rozsahu cílového typu"),
  "fb-param": N_("Parametry volání bloku existují a mají správný směr"),
  "fb-member": N_("Přístup jen ke členům, které blok má"),
  reserved: N_("Rezervovaná slova a jména instrukcí"),
  "ident-format": N_("Tvar identifikátorů (znaky, podtržítka, délka)"),
  address: N_("Formát adres I/O a shoda typu s adresou"),
  ascii: N_("Soubory čisté ASCII"),
  "qualified-only": N_("Kvalifikovaný přístup ke GVL ({attribute 'qualified_only'})"),
  "init-value": N_("Počáteční hodnoty proměnných (FX5 je nepodporuje)"),
  "timer-range": N_("Rozsah předvolby časovače (FX5 TON max. 32 767 ms)"),
  "ton-type": N_("Typ časovače (TIA exportuje TON_TIME)"),
  "logix-construct": N_("Konstrukce IEC, které Logix ST nemá"),
  "unitronics-fb": N_("UniLogic: ST funkce bez instancí FB"),
  "unknown-function": N_("Funkce existuje na platformě"),
  "case-label": N_("Návěští CASE jsou konstanty bez duplicit"),
  condition: N_("Podmínky IF / WHILE jsou typu BOOL"),
  "tag-table": N_("Tabulka tagů odpovídá kódu"),
  xml: N_("XML je well-formed"),
  runtime: N_("Běhová chyba (dělení nulou, přetečení, nekonečný cyklus)"),
};
