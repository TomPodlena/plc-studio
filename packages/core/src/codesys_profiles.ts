/**
 * PLCdesk — profily platformy CODESYS dalších výrobců (Turck, Festo, ABB AC500 V3, Bosch Rexroth ctrlX,
 * Inovance, Weidmüller u-OS, Eaton XC300, Lenze, Berghof, Hitachi HX / EHV+).
 *
 * Profil = položka `PLAT` s `base: "codesys"` (platBase / isCodesysFamily): STEJNÝ jazyk, šablony, GVL_IO,
 * PLCopen XML, emulátor (dialekt codesys) i export HMI jako CODESYS. Liší se jen tím, co je v této tabulce:
 * název a IDE (hlavička kódu, README), verze CODESYS → styl OOP (ABSTRACT až od V3.5 SP13), I/O v kódu
 * s pevnou adresou AT nebo bez ní (kanály se přiřadí v I/O mapování zařízení jako u WAGO), surový rozsah
 * analogu `rawMax`, servoosa (`sm3` jen tam, kde výrobce dokládá SoftMotion AXIS_REF_SM3; jinak důvod),
 * postup v README a kusovník (data/catalog/plc.json `plc_*@<klíč>`). WAGO a Delta AX jsou starší profily
 * s vlastním kódem v model.ts / codegen.ts (jejich výstup je zamčený referenčním testem).
 *
 * Zdroje (rešerše 2026-10-05) jsou u každého profilu v `src` a v data/platform_refs.json.
 * Soubor nesmí za běhu importovat model.ts (model.ts z něj staví PLAT).
 */
import { N_ } from "./i18n.js";
import type { PlatformInfo } from "./model.js";

export type CdsProfileKey =
  | "turck" | "festo" | "abb" | "rexroth" | "inovance" | "weidmueller" | "eaton" | "lenze" | "berghof"
  | "hitachi";

export interface CdsProfile {
  /** název výrobce (hlavička generovaného kódu „… - <name> *)“, nadpisy) */
  name: string;
  /** IDE a jeho báze */
  ide: string;
  /** řady CPU */
  cpu: string;
  /** verze CODESYS, na které IDE / runtime stojí (README, CLAUDE.md) */
  cdsVer: string;
  /** styl kódu OOP (ABSTRACT / PROPERTY / INTERFACE) — jen CODESYS V3.5 SP13 a novější */
  oop: boolean;
  /** I/O v GVL_IO s pevnou adresou AT (notace CODESYS); false = bez AT, kanály se přiřadí v I/O mapování */
  at: boolean;
  /** surový rozsah analogu (plný rozsah modulu z katalogu) */
  rawMax: number;
  /** modul, ke kterému `rawMax` patří (README); "" = neověřeno → výrazná poznámka TODO */
  rawMod: string;
  /** servoosa: "sm3" = CODESYS SoftMotion (AXIS_REF_SM3), null = nepodporováno (`axisWhy`) */
  axis: "sm3" | null;
  /** proč osa ne (klíč překladu) */
  axisWhy?: string;
  /** emulátor: popis dialektu */
  emu: string;
  /** export HMI: produkt (CODESYS Visualization) */
  hmi: string;
  /** README — nadpis (název produktu se nepřekládá) */
  title: string;
  /** README — příkaz importu PLCopen XML v IDE (technický text menu, nepřekládá se) */
  imp: string;
  /** README — založení projektu (klíč překladu) */
  setup: string;
  /** README — I/O (klíč překladu) */
  io: string;
  /** README — knihovny výrobce / poznámky (klíč překladu) */
  libs?: string;
  /** README — test (klíč překladu) */
  test: string;
  /** starší CODESYS než ověřený SP21 (PLCopen XML ověřit při prvním importu) */
  old?: boolean;
}

export const CDS_PROFILES: Record<CdsProfileKey, CdsProfile> = {
  turck: {
    name: "Turck", ide: "CODESYS V3.5 + Turck package", cpu: "TX700 / TBEN-L…-PLC + BL20", cdsVer: "3.5.14–3.5.18",
    oop: true, at: false, rawMax: 32767, rawMod: "BL20-4AI-U/I (Integer 15 bit + sign: 10 V = 32767)", axis: null,
    axisWhy: N_("SoftMotion (AXIS_REF_SM3) pro řídicí systémy Turck výrobce nedokládá — kód osy se negeneruje; použij polohovací pohon se záznamy nebo měnič přes I/O."),
    emu: "Turck (CODESYS V3.5 + Turck package)", hmi: "CODESYS Visualization (Turck TX700 / TBEN-L PLC)",
    title: "TURCK — CODESYS V3.5 + TURCK PACKAGE (TX700 / TBEN-L PLC)",
    imp: "Project → Import PLCopenXML",
    setup: N_("Nainstaluj balík Turck (Tools → CODESYS Installer / Package Manager) a založ Standard project se zařízením Turck (TX700 / TBEN-L…-PLC); stanice BL20 přidej pod EtherCAT master jako BL20-E-GW-EC (ESI) s moduly."),
    io: N_("I/O: proměnné GVL_IO jsou BEZ pevné adresy (AT). Kanály přiřaď proměnným v I/O mapování zařízení (Local_IO / BL20-E-GW-EC → modul → záložka I/O Mapping → GVL_IO.<tag>); kanál každého signálu je v I/O listu a ve výkresech PLCdesk."),
    test: N_("Test: CODESYS Control Win (soft PLC), pak řídicí systém Turck s odpojenými akčními členy."),
  },
  festo: {
    name: "Festo", ide: "Festo Automation Suite + CODESYS V3.5", cpu: "CPX-E-CEC-C1 / -M1 + CPX-E", cdsVer: "3.5.21.20 (FAS 2.8+) / 3.5.16 (FAS < 2.8)",
    oop: true, at: false, rawMax: 27648, rawMod: "CPX-E-4AI-U-I / CPX-E-4AO-U-I (10 V = 27648)", axis: "sm3",
    emu: "Festo CPX-E-CEC (CODESYS V3.5)", hmi: "CODESYS Visualization (Festo CPX-E-CEC)",
    title: "FESTO — FESTO AUTOMATION SUITE + CODESYS V3.5 (CPX-E-CEC)",
    imp: "Project → Import PLCopenXML",
    setup: N_("Projekt založ ve Festo Automation Suite (CPX-E-CEC), z FAS otevři CODESYS (od FAS 2.8 samostatná instalace CODESYS 3.5.21.20); moduly CPX-E přidej ve stromu zařízení."),
    io: N_("I/O: proměnné GVL_IO jsou BEZ pevné adresy (AT). Kanály modulů CPX-E přiřaď proměnným v záložce Festo CPX I/O Mapping (CPX-E-CEC → modul → GVL_IO.<tag>); kanál každého signálu je v I/O listu a ve výkresech PLCdesk."),
    libs: N_("Servoosy jen s CPU CPX-E-CEC-M1 (C1 SoftMotion nemá — v kusovníku zvol M1): pohon CMMT pod EtherCAT masterem jako SoftMotion osa (AXIS_REF_SM3), knihovna SM3_Basic. Vzdálené stanice CPX-E s modulem CPX-E-EC (EtherCAT); controller C1 / M1 má adresní prostor 64 B vstupů / 64 B výstupů."),
    test: N_("Test: CODESYS Control Win (soft PLC), pak CPX-E-CEC s odpojenými akčními členy."),
  },
  abb: {
    name: "ABB", ide: "Automation Builder (CODESYS V3.5)", cpu: "AC500 V3 (PM5xxx) + S500", cdsVer: "3.5 SP20 Patch 2 (Automation Builder 2.8)",
    oop: true, at: false, rawMax: 27648, rawMod: "AI523 / AO523 / AX521 (10 V = 20 mA = 27648)", axis: null,
    axisWhy: N_("AC500 V3 řídí osy knihovnou ABB PS5611-MC (bloky CMC_*, vlastní AXIS_REF, licence), ne CODESYS SoftMotion SM3 — FB_Axis by se nepřeložil; použij polohovací pohon se záznamy nebo měnič přes I/O."),
    emu: "ABB Automation Builder (AC500 V3, CODESYS V3.5)", hmi: "Automation Builder (CODESYS Visualization)",
    title: "ABB AUTOMATION BUILDER (AC500 V3, CODESYS V3.5)",
    imp: "Project → Import PLCopenXML",
    setup: N_("Projekt založ v Automation Builderu s CPU AC500 V3 (PM5xxx) a moduly S500 na I/O sběrnici CPU (AC500 V2 = CODESYS 2.3 — tento výstup pro něj není)."),
    io: N_("I/O: proměnné GVL_IO jsou BEZ pevné adresy (AT). Kanály modulů S500 přiřaď proměnným v I/O mapování modulu (IO_Bus → modul → I/O Mapping → GVL_IO.<tag>); kanál každého signálu je v I/O listu a ve výkresech PLCdesk."),
    libs: N_("Edice Basic Automation Builderu stačí pro program a I/O na sběrnici CPU; fieldbus (PROFINET, EtherCAT…) chce edici Standard. Vzdálené stanice S500 s hlavou CI502-PNIO (PROFINET) / CI522-MODTCP (Modbus TCP)."),
    test: N_("Test: simulace v Automation Builderu (Online → Simulation), pak CPU s odpojenými akčními členy."),
  },
  rexroth: {
    name: "Bosch Rexroth", ide: "ctrlX PLC Engineering (CODESYS V3.5)", cpu: "ctrlX CORE + ctrlX I/O", cdsVer: "3.5.20.50 (ctrlX PLC 3.6)",
    oop: true, at: false, rawMax: 10000, rawMod: "XI312204 (mV: 10 V = 10000; XI342204 µA: 20 mA = 20000)", axis: null,
    axisWhy: N_("ctrlX řídí osy aplikací ctrlX MOTION přes knihovnu CXA_PLCopen (osa z Data Layeru), ne CODESYS SoftMotion SM3 — FB_Axis by se nepřeložil; použij polohovací pohon se záznamy nebo měnič přes I/O."),
    emu: "Bosch Rexroth ctrlX PLC (CODESYS V3.5)", hmi: "ctrlX PLC Engineering (CODESYS Visualization)",
    title: "BOSCH REXROTH CTRLX PLC ENGINEERING (CTRLX CORE, CODESYS V3.5)",
    imp: "Project → Import PLCopenXML",
    setup: N_("Projekt založ v ctrlX WORKS → ctrlX PLC Engineering pro ctrlX CORE (nebo ctrlX COREvirtual na test); moduly ctrlX I/O (XI…) přidej pod EtherCAT master, vzdálené stanice se spojkou XB-EC-12."),
    io: N_("I/O: proměnné GVL_IO jsou BEZ pevné adresy (AT). Kanály EtherCAT modulů přiřaď proměnným v I/O mapování (EtherCAT master → modul → I/O Mapping → GVL_IO.<tag>); kanál každého signálu je v I/O listu a ve výkresech PLCdesk."),
    libs: N_("Data jiných aplikací ctrlX (pohyb, IO-Link…) jdou přes ctrlX Data Layer realtime, ne přes GVL_IO; retain paměť je omezená (~110 kB)."),
    test: N_("Test: ctrlX COREvirtual (zdarma), pak ctrlX CORE s odpojenými akčními členy."),
  },
  inovance: {
    name: "Inovance", ide: "InoProShop (CODESYS V3.5)", cpu: "AM600 + GL10", cdsVer: "V3.5 SP11? (InoProShop 1.9)",
    oop: false, at: false, rawMax: 20000, rawMod: "GL10-4AD / GL10-4DA (0–10 V = 0…20000)", axis: null, old: true,
    axisWhy: N_("SoftMotion (SM3_Basic, AXIS_REF_SM3) v InoProShop doložil jen zdroj třetí strany, dokumentace Inovance ne — kód osy se negeneruje; použij polohovací pohon se záznamy nebo měnič přes I/O."),
    emu: "Inovance InoProShop (CODESYS V3.5)", hmi: "InoProShop (CODESYS Visualization)",
    title: "INOVANCE INOPROSHOP (AM400 / AM600 / AC800, CODESYS V3.5)",
    imp: "Project → Import PLCopenXML",
    setup: N_("Projekt založ v InoProShop pro CPU AM / AC; moduly GL10 přidej na lokální sběrnici CPU, vzdálené přes GL10-RTU-ECTA pod EtherCAT master (malá PLC Easy / H5U programuje AutoShop — tento výstup pro ně není)."),
    io: N_("I/O: proměnné GVL_IO jsou BEZ pevné adresy (AT). Kanály modulů přiřaď proměnným v I/O mapování modulu (modul → I/O Mapping → GVL_IO.<tag>); kanál každého signálu je v I/O listu a ve výkresech PLCdesk."),
    test: N_("Test: simulace v InoProShop, pak CPU s odpojenými akčními členy."),
  },
  weidmueller: {
    name: "Weidmüller", ide: "CODESYS V3.5 + u-OS package", cpu: "u-control M3000 / M4000 + u-remote UR20", cdsVer: "V3.5 + CODESYS Control SL for u-OS 4.2x",
    oop: true, at: false, rawMax: 27648, rawMod: "UR20-4AI-UI-16 / UR20-4AO-UI-16 (10 V = 27648)", axis: null,
    axisWhy: N_("SoftMotion pro u-control (u-OS) výrobce nedokládá — kód osy se negeneruje; použij polohovací pohon se záznamy nebo měnič přes I/O."),
    emu: "Weidmüller u-OS (CODESYS V3.5)", hmi: "CODESYS Visualization (Weidmüller u-control)",
    title: "WEIDMÜLLER U-CONTROL M3000 / M4000 (U-OS, CODESYS V3.5)",
    imp: "Project → Import PLCopenXML",
    setup: N_("Nainstaluj balík CODESYS Control SL for Weidmüller u-OS (CODESYS Installer) a založ Standard project se zařízením u-control M3000 / M4000 (starší UC20-SL2000 / u-create studio je jiné IDE)."),
    io: N_("I/O: proměnné GVL_IO jsou BEZ pevné adresy (AT). Kanály modulů u-remote přiřaď proměnným v I/O mapování (System_Bus → modul u-remote → IoModuleInterface I/O Mapping → GVL_IO.<tag>; rozsah analogu v Module Configuration); kanál každého signálu je v I/O listu a ve výkresech PLCdesk."),
    test: N_("Test: CODESYS Control Win (soft PLC), pak u-control s odpojenými akčními členy."),
  },
  eaton: {
    name: "Eaton", ide: "XSOFT-CODESYS-3 (CODESYS V3.5)", cpu: "XC300 + XN300", cdsVer: "3.5.20 (XSOFT-CODESYS-3, runtime XC303 3.5.20.40)",
    oop: true, at: false, rawMax: 10000, rawMod: "XN-322-7AI-U2PT / XN-322-8AO-U2 (mV: 10 V = 10000)", axis: null,
    axisWhy: N_("SoftMotion pro XC300 / XV300 výrobce nedokládá — kód osy se negeneruje; použij polohovací pohon se záznamy nebo měnič přes I/O."),
    emu: "Eaton XSOFT-CODESYS-3 (CODESYS V3.5)", hmi: "XSOFT-CODESYS-3 (CODESYS Visualization)",
    title: "EATON XSOFT-CODESYS-3 (XC300 / XV300, CODESYS V3.5)",
    imp: "Project → Import PLCopenXML",
    setup: N_("Projekt založ v XSOFT-CODESYS-3 se zařízením XC300 / XV300 (balík zařízení přes Package Manager); moduly XN300 přidej ve stromu zařízení (až 32 modulů)."),
    io: N_("I/O: proměnné GVL_IO jsou BEZ pevné adresy (AT). Kanály modulů XN300 přiřaď proměnným v I/O mapování modulu (→ I/O Mapping → GVL_IO.<tag>); kanál každého signálu je v I/O listu a ve výkresech PLCdesk."),
    libs: N_("Standardní CODESYS nemá popisy zařízení Eaton — potřebuješ XSOFT-CODESYS-3 (licence pro nahrání do PLC)."),
    test: N_("Test: simulace v XSOFT-CODESYS-3, pak PLC s odpojenými akčními členy."),
  },
  lenze: {
    name: "Lenze", ide: "PLC Designer (CODESYS V3.5)", cpu: "c300 + I/O system 1000", cdsVer: "3.5.21 (PLC Designer 4.2)",
    oop: true, at: false, rawMax: 16384, rawMod: "EPM-S401 / EPM-S501 (20h: 10 V = 16384; 10h: 10 V = 27648)", axis: null,
    axisWhy: N_("Lenze řídí osy knihovnami FAST / L_MC1P (vlastní typ osy), ne CODESYS SoftMotion SM3 — FB_Axis by se nepřeložil; použij polohovací pohon se záznamy nebo měnič přes I/O."),
    emu: "Lenze PLC Designer (CODESYS V3.5)", hmi: "PLC Designer (CODESYS Visualization)",
    title: "LENZE PLC DESIGNER (C300 / C520 / C550, CODESYS V3.5)",
    imp: "Project → Import PLCopenXML",
    setup: N_("Projekt založ v PLC Designeru s controllerem Lenze (c300 / c5xx); moduly I/O system 1000 (EPM-S…) přidej ve stromu zařízení (až 64 modulů, vzdálené přes EtherCAT spojku EPM-S130)."),
    io: N_("I/O: proměnné GVL_IO jsou BEZ pevné adresy (AT). Kanály modulů přiřaď proměnným v I/O mapování modulu (→ I/O Mapping → GVL_IO.<tag>); kanál každého signálu je v I/O listu a ve výkresech PLCdesk."),
    test: N_("Test: simulace v PLC Designeru, pak controller s odpojenými akčními členy."),
  },
  berghof: {
    name: "Berghof", ide: "CODESYS V3.5 + Berghof target", cpu: "B-Nimis MC-Pi / BC-Pi + MC-I/O", cdsVer: "3.5 SP16 Patch 4 (MC-I/O 1.11; target release)",
    oop: true, at: false, rawMax: 32767, rawMod: "MC-I/O AI4-I (20 mA = 16#7FFF)", axis: null,
    axisWhy: N_("Berghof uvádí SoftMotion jen obecně (MC-Pi Plus pro SoftMotion CNC); osy AXIS_REF_SM3 a licence pro MC-Pi Pro nejsou doloženy — kód osy se negeneruje; použij polohovací pohon se záznamy nebo měnič přes I/O."),
    emu: "Berghof (CODESYS V3.5 + target)", hmi: "CODESYS Visualization (Berghof)",
    title: "BERGHOF — CODESYS V3.5 + BERGHOF TARGET (B-NIMIS MC-PI / BC-PI)",
    imp: "Project → Import PLCopenXML",
    setup: N_("Nainstaluj Berghof target package (Package Manager; target, firmware a verze CODESYS musí k sobě patřit) a založ Standard project se zařízením Berghof; moduly MC-I/O přidej pod EtherCAT master (lokálně nejvýš 10 modulů, další za bus coupler MC-I/O)."),
    io: N_("I/O: proměnné GVL_IO jsou BEZ pevné adresy (AT). Kanály EtherCAT modulů přiřaď proměnným v I/O mapování (EtherCAT master → modul → I/O Mapping → GVL_IO.<tag>); kanál každého signálu je v I/O listu a ve výkresech PLCdesk."),
    test: N_("Test: CODESYS Control Win (soft PLC), pak řídicí systém Berghof s odpojenými akčními členy."),
  },
  hitachi: {
    name: "Hitachi", ide: "HX-CODESYS (CODESYS V3.5 SP16+)", cpu: "HX-CPU + EH-150 (EHV+)", cdsVer: "3.5 SP16 Patch 2+ (HX-CPU FW 3.5.16)",
    oop: true, at: false, rawMax: 4095, rawMod: "EH-AX8V / EH-AY4V (12 bit, 10 V = 16#0FFF)", axis: null,
    axisWhy: N_("SoftMotion (SM3_Basic) mají jen CPU HX Motion / CNC Motion (HX-CP1S08M, HX-CP1H16M) a PLCdesk volbu CPU podle osy u Hitachi zatím nedělá — kód osy se negeneruje; použij polohovací pohon se záznamy nebo měnič přes I/O."),
    emu: "Hitachi HX-CODESYS (CODESYS V3.5 SP16)", hmi: "HX-CODESYS (CODESYS Visualization)",
    title: "HITACHI HX-CODESYS (HX-CPU + EH-150, CODESYS V3.5 SP16+)",
    imp: "Project → Import PLCopenXML",
    setup: N_("Projekt založ v HX-CODESYS (SP16 Patch 2 nebo novější, podle firmware CPU) s CPU HX; moduly EH-150 přidej do racku (nejvýš 11 na base, další base přes EH-IOCH2). Starší CPU EHV+ běží na CODESYS V3.5 SP5 — styl OOP (ABSTRACT) tam nejde, generuj klasicky."),
    io: N_("I/O: proměnné GVL_IO jsou BEZ pevné adresy (AT) — přímé IEC adresy se mezi EHV+ (pořadí bajtů Motorola: bit 0 karty 64 bodů = %QX7.0) a HX (lineárně) liší a počáteční adresy slotů manuál neuvádí. Kanály přiřaď proměnným v I/O-Bus Mapping modulu (sloupec Variable podle čísla bitu kanálu); kanál každého signálu je v I/O listu a ve výkresech PLCdesk."),
    test: N_("Test: simulace v HX-CODESYS, pak CPU s odpojenými akčními členy."),
  },
};

export const CDS_PROFILE_KEYS = Object.keys(CDS_PROFILES) as CdsProfileKey[];

/** Profil CODESYS platformy (jen nové profily z této tabulky; WAGO / Delta mají vlastní kód). */
export function cdsProfile(plat: string): CdsProfile | undefined {
  return (CDS_PROFILES as Record<string, CdsProfile>)[plat];
}

/** Položky `PLAT` profilů (model.ts). */
export const CDS_PROFILE_PLAT = Object.fromEntries(CDS_PROFILE_KEYS.map(k => {
  const p = CDS_PROFILES[k];
  const info: PlatformInfo = { name: p.name, ide: p.ide, cpu: p.cpu, lang: "ST", imp: N_("POU + GVL / PLCopen XML (báze CODESYS)"), base: "codesys", oop: p.oop };
  return [k, info];
})) as Record<CdsProfileKey, PlatformInfo>;
