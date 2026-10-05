/**
 * IEC 61131-10 Ed. 1.0 (2019) XML — výměnný formát programů PLC podle normy (nástupce PLCopen TC6).
 *
 * Jeden importovatelný soubor `IEC61131-10_Import.xml`: bloky FB (ST), program (ST), globální
 * proměnné a programový soubor / úloha podle normy. Stejný princip jako `plcopen.ts`: zdrojem je
 * FINÁLNÍ text výstupu platformy (Gen_Library.st, MAIN.st, tabulka globálních návěští), ne surové
 * šablony — import = ručně vložené soubory (překlad komentářů, TIMER_100_FB_M, meze, rawMax, adresy).
 *
 * FORMÁT (ověřeno proti schématu normy, ne importem v IDE):
 *  - Schéma: PLCopen „IEC 61131-10 Code Components“ (iec_61131-10_ed1_fdis.zip, `IEC61131_10_Ed1_0.xsd`,
 *    vzor `IEC61131_10_Ed1_0_Example.xml`) — https://www.plcopen.org/standards/xml-echange/code-components/
 *    Licence IEC Code Components (http://www.iec.ch/CCv1) redistribuci bez zakoupené normy nedovoluje →
 *    XSD v repozitáři NENÍ; jen URL + SHA-256 (`IEC10_XSD`), test ho použije z lokální kopie (proměnná
 *    prostředí `IEC61131_10_XSD`), jinak běží jen vlastní strukturní kontrola (`emu/iec61131_10_check.ts`).
 *  - Kořen `<Project xmlns="www.iec.ch/public/TC65SC65BWG7TF10" schemaVersion="1.0">` (namespace BEZ
 *    „http://“ — tak ho má XSD i vzor), pořadí FileHeader → ContentHeader → Types/GlobalNamespace →
 *    Instances; POU `FunctionBlock` / `Program` s `Parameters` (InputVars / OutputVars / InoutVars,
 *    `orderWithinParamSet`), `Vars accessSpecifier="private"`, `MainBody/BodyContent xsi:type="ST"`;
 *    globální proměnné `Instances/Configuration[/Resource]/GlobalVars`, úloha `Task xsi:type="StandardTask"`,
 *    `ProgramInstance`.
 *
 * CÍLE:
 *  - `mitsubishi` (GX Works3, MELSEC iQ-F FX5): Project → Import File → IEC61131-10 XML Format (GX Works3
 *    od 1.110Q, všechny CPU — RCPU, LHCPU, FX5CPU; jen ST). Mapování prvků podle GX Works3 Operating
 *    Manual SH-081215ENG (AU), kap. 3.3 „Importing data (IEC61131-10 XML format)“ a Appendix 8 „XML File
 *    Formats (IEC61131-10 Format)“: Program = programový blok (příklad jména ProgPou), Resource = programový
 *    soubor (příklad MAIN), ProgramInstance = registrace programu, GlobalVars = globální návěští
 *    (Address.address = přiřazení operandu X/Y), Vars private = lokální návěští, Documentation = komentář.
 *    Tvar ověřen i proti vzorům nástroje Jiecc (graviness.com, BSD-2, cíl „MITSUBISHI“, ověřeno autorem
 *    v GX Works3 1.110Q+): globální návěští v `Configuration/GlobalVars`, adresa bez `%` jen v `address`.
 *    FX5 nepodporuje počáteční hodnoty návěští ani „Access from External Device“ (SH-081215ENG) → XML je
 *    nenese (meze a rawMax se předávají při volání; přístup z HMI viz README). Rozšíření AddData výrobce
 *    (VariableComments, ResourceExecutionType, VariableExternalDeviceAccess…) se NEgenerují — manuál
 *    neuvádí jejich jmenný prostor (URI); typ spuštění programu (Scan) se nastaví po importu (README).
 *    Jedna sada GlobalVars — každá je v GX Works3 samostatný seznam návěští s výchozím jménem „Global“
 *    a duplicitní jméno se při importu přeskočí („only the first data is imported“).
 *  - `plcnext` (PŘÍPRAVA, jen v testech — platforma zatím není): PLCnext Engineer, File → Import →
 *    Import From IEC 61131-10 (https://engineer.plcnext.help/2024.0_LTS_en/Import_Types_FromIEC61131.htm).
 *    Zdrojem je kód rodiny CODESYS bez kvalifikace `GVL_IO.` (I/O jako globální proměnné zdroje
 *    `Resource/GlobalVars` bez adres — import propojení na I/O nepřenáší, propojí se v Data List;
 *    program je čte přes `ExternalVars`), úloha + instance programu (do projektu s controllerem).
 *
 * STAV: NEOVĚŘENO importem — GX Works3 ani PLCnext Engineer nejsou k dispozici; README to uvádí.
 */
import { Project } from "./model.js";
import { type ParsedVar } from "./plcopen.js";
/** Cílový jmenný prostor normy (z XSD i vzoru — bez schématu URL). */
export declare const IEC10_NS = "www.iec.ch/public/TC65SC65BWG7TF10";
/** Jméno souboru ve výstupu platformy. */
export declare const IEC10_FILE = "IEC61131-10_Import.xml";
/** Schéma normy: zdroj a otisky (soubor se nedistribuuje — licence IEC Code Components). */
export declare const IEC10_XSD: {
    page: string;
    zipUrl: string;
    zip: string;
    zipSha256: string;
    file: string;
    sha256: string;
    license: string;
};
/** Zdroje formátu pro cílová IDE. */
export declare const IEC10_SRC: {
    gxw3: string;
    jiecc: string;
    plcnext: string;
    plcnextTc6: string;
};
export type Iec10Target = "mitsubishi" | "plcnext";
export type Iec10Kind = "in" | "out" | "inout" | "var" | "temp";
/** Globální proměnná (návěští): jméno, typ IEC, přiřazení operandu (bez `%`), komentář. */
export interface Iec10Global {
    name: string;
    type: string;
    address?: string;
    comment?: string;
}
/** Finální texty platformy, ze kterých se XML staví. */
export interface Iec10Source {
    lib: string;
    main: string;
    globals: Iec10Global[];
}
/** Sekce deklarací POU v pořadí, jak jsou v ST. */
export interface Iec10Section {
    kind: Iec10Kind;
    vars: ParsedVar[];
}
/** Vlastnosti cíle (co IDE z normy čte a jak). */
export interface Iec10Profile {
    /** jméno programového bloku v XML (null = jméno z ST) */
    program: string | null;
    /** programový soubor / zdroj (Resource.name) a typ zdroje (Resource.resourceTypeName) */
    resource: string;
    resourceType: string;
    /** kde jsou globální proměnné: v konfiguraci (GX Works3: jeden seznam „Global“) / ve zdroji */
    globalsIn: "configuration" | "resource";
    /** počáteční hodnoty (FX5 je nemá) */
    initValues: boolean;
    /** program čte globální proměnné přes ExternalVars (IEC; GX Works3 je nevyžaduje) */
    externals: boolean;
    /** cyklická úloha (null = žádná — GX Works3 typ spuštění bere z AddData, nastaví se ručně) */
    task: {
        name: string;
        interval: string;
        priority: number;
    } | null;
}
export declare const IEC10_PROFILES: Record<Iec10Target, Iec10Profile>;
/** Sekce deklarací POU (VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT / VAR / VAR_TEMP) v pořadí ST. */
export declare function stSections(src: string): Iec10Section[];
/** Úvodní komentář bloku (mezi hlavičkou POU a první sekcí VAR) jako prostý text, jinak "". */
export declare function stPouDoc(src: string): string;
/** Globální návěští z GlobalLabels.csv (výstup `genTagFile` pro Mitsubishi) — jméno, typ IEC, operand, komentář. */
export declare function gxGlobalLabels(csv: string): Iec10Global[];
/** Finální texty platformy pro cíl (bez `files` se vygenerují). */
export declare function iec10Source(prj: Project, target: Iec10Target, files?: Record<string, string>): Iec10Source;
/**
 * IEC 61131-10 XML projektu pro cíl `target`. `files` = už vygenerované soubory platformy
 * (genFor je předává, aby XML vzniklo z téhož textu); bez nich se texty vygenerují.
 */
export declare function iec61131_10Xml(prj: Project, target: Iec10Target, files?: Record<string, string>): string;
