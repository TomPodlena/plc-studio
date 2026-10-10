/**
 * PLCdesk — HMI: exporty tagů a alarmů pro HMI výrobců.
 *
 * Formáty ověřené proti veřejné dokumentaci / reálným exportům (zdroje v `HMI_SPECS`), ale
 * žádný nebyl naimportován do cílového nástroje → všechny nesou stav „neověřeno importem“.
 * Kde výrobce formát nezveřejňuje, je výstup referenční seznam / kostra a README to říká.
 *
 *  Siemens WinCC Comfort/Advanced  HMI_Tags_Openness.xml (Openness, Hmi.Tag.TagTable), listy
 *                                  pro Excel import (Hmi Tags / DiscreteAlarms / AnalogAlarms)
 *                                  jako TSV + `hmiSiemensWorkbook()` = přímo .xlsx (bajty)
 *  Rockwell FactoryTalk View ME/SE FTView_Tags.csv (formát 6.x), FTView_Alarms.xml (ME Alarm Setup)
 *  CODESYS / Schneider             Symbolconfiguration (referenční), tabulka alarmů skupiny (CSV)
 *  Beckhoff TwinCAT HMI            seznam symbolů ADS s vazbou TcHmi, tabulka alarmů
 *  Mitsubishi GT Designer3         seznam tagů a komentáře alarmů (CSV, ASCII)
 *  Omron NA (Sysmac)               proměnné k vložení (TSV), uživatelské alarmy (TSV)
 *  Unitronics                      bez exportu (HMI je součástí UniLogic, tagy jsou globální)
 */
import { PLAT, platBase, xmlSafe, outputSafe } from "./model.js";
import { tr, N_, getLang, withLang } from "./i18n.js";
import { buildHmi, hmiPlcPath, hmiAscii } from "./hmi.js";
import { xlsxWorkbook } from "./hmi_xlsx.js";
import { CDS_PROFILES, CDS_PROFILE_KEYS } from "./codesys_profiles.js";
import { axisBlocked } from "./axis_gen.js";
export function hmiStatusLabel(s) {
    return tr(s === "unverified" ? N_("neověřeno importem") : s === "reference" ? N_("referenční seznam (formát výrobce nezveřejněn)") : N_("kostra k doplnění"));
}
/* ================================================================ zdroje */
const SRC = {
    tiaOpenness: "https://cache.industry.siemens.com/dl/files/802/109773802/att_1007204/v1/TIAPortalOpenness_en-US.pdf",
    tiaTagXmlSample: "https://github.com/CJMORE66/Garett-GMT-OP010/blob/main/EXPORT/HMI%20tags/Mode/Mode.xml",
    tiaXlsxSheets: "https://github.com/dmc-inc/siemens-dotnet/blob/master/Dmc.Siemens/Common/Export/WinccConfiguration.cs",
    tiaAlarmForum: "https://support.industry.siemens.com/forum/WW/en/posts/how-to-export-user-alarms-by-tia-openness/198236",
    ftvCsv: "https://www.rockwellautomation.com/en-us/docs/factorytalk-view/16-00-00/tools-help-ditamap/tag-import-and-export-wizard/tag-csv-file-format/se-and-me-6-x-tag-csv-file-format.html",
    ftvImport: "https://www.rockwellautomation.com/en-nl/docs/factorytalk-view/16-00-00/tools-help-ditamap/tag-import-and-export-wizard/import-tag-csv-files.html",
    ftvAlarmXml: "https://github.com/JustinPfeiffer/FaultExtractor",
    cdsAlarm: "https://content.helpme-codesys.com/en/CODESYS%20Visualization/_cds_obj_alarm_group.html",
    cdsAlarmIo: "https://en.help.plc.abb.com/AB280/_visu%20obj%20dialog%20Exporting%20and%20importing%20of%20alarms.html",
    cdsSymbols: "https://github.com/emqx/neuron-docs/blob/main/en_US/configuration/south-devices/codesys3/demo.md",
    tcHmi: "https://www.hemelix.com/scada-hmi/twincat-hmi/twincat-hmi-symbol/",
    gtLabels: "https://www.mitsubishielectric.com/fa/products/hmi/got/smerit/gt_works3/feature/feature04.html",
    gtAccess: "https://www.manualslib.com/manual/1353729/Mitsubishi-Electric-Melsec-Iq-R-Series.html?page=31",
    naManual: "https://www.tecnical.cat/PDF/OMRON/NA/V118-E1-13.pdf",
    naPractice: "https://edata.omron.com.au/eData/NA/V417-E1-01.pdf",
    /* GX Works3 Operating Manual: CSV globálních návěští, sloupec Access from External Device (1/0); FX5 ho nemá */
    gxw3Labels: "https://dl.mitsubishielectric.com/dl/fa/document/manual/plc/sh081215eng/sh081215engau.pdf",
    /* NJ/NX Software User's Manual W501, 6-3-8 Network Publish (Publish Only / Input / Output) */
    w501Publish: "https://files.omron.eu/downloads/latest/manual/en/w501_nj_nx-series_cpu_unit_software_users_manual_en.pdf",
};
/** Odkaz na proměnnou PLC v HMI Siemens (bez uvozovek, jak ho zapisuje export TIA). */
export function tiaControllerTag(t) {
    return t.src === "io" ? t.member : "InstMachine." + t.member;
}
/** Adresa tagu zařízení FactoryTalk View (zkratka „PLC“, `::` kvůli dvojtečce v cestě programu). */
export function ftvAddress(t) {
    return t.src === "io" ? "{[PLC]" + t.member + "}" : "{::[PLC]Program:PLCdesk." + t.member + "}";
}
const SPECS = {
    siemens: {
        product: "WinCC Comfort / Advanced (TIA Portal)",
        files: [
            { name: "HMI_Tags_Openness.xml", format: N_("tabulka HMI tagů SimaticML (Openness: TagTable.Import)"), status: "unverified", sources: [SRC.tiaOpenness, SRC.tiaTagXmlSample], paths: t => "<Name>" + tiaControllerTag(t) + "</Name>" },
            { name: "HmiTags.tsv", format: N_("list „Hmi Tags“ importu Excel (TSV k vložení do .xlsx)"), status: "unverified", sources: [SRC.tiaXlsxSheets], paths: t => "\t" + tiaControllerTag(t) + "\t" },
            { name: "DiscreteAlarms.tsv", format: N_("list „DiscreteAlarms“ importu Excel (TSV)"), status: "unverified", sources: [SRC.tiaXlsxSheets, SRC.tiaAlarmForum] },
            { name: "AnalogAlarms.tsv", format: N_("list „AnalogAlarms“ importu Excel (TSV, sloupce neověřené)"), status: "unverified", sources: [SRC.tiaXlsxSheets] },
            { name: "README_HMI.txt", format: N_("postup importu a stav ověření"), status: "unverified", sources: [] },
        ],
    },
    rockwell: {
        product: "FactoryTalk View ME / SE",
        files: [
            { name: "FTView_Tags.csv", format: N_("databáze tagů CSV (Tag Import and Export Wizard, formát 6.x)"), status: "unverified", sources: [SRC.ftvCsv, SRC.ftvImport], ascii: true, paths: t => ftvAddress(t) },
            { name: "FTView_Alarms.xml", format: N_("alarmy ME (Alarm Setup → Import/Export XML)"), status: "unverified", sources: [SRC.ftvAlarmXml], ascii: true },
            { name: "README_HMI.txt", format: N_("postup importu a stav ověření"), status: "unverified", sources: [] },
        ],
    },
    codesys: {
        product: "CODESYS Visualization",
        files: [
            { name: "Symbolconfiguration_PLCdesk.xml", format: N_("očekávaná symbolová konfigurace (tvar exportu CODESYS) pro OPC UA / externí HMI"), status: "reference", sources: [SRC.cdsSymbols], paths: t => '"' + t.member.split(".").pop() + '"' },
            { name: "AlarmGroup_PLCdesk.csv", format: N_("tabulka alarmů skupiny (sloupce dle nápovědy; CSV srovnat s exportem skupiny)"), status: "unverified", sources: [SRC.cdsAlarm, SRC.cdsAlarmIo] },
            { name: "README_HMI.txt", format: N_("postup importu a stav ověření"), status: "unverified", sources: [] },
        ],
    },
    beckhoff: {
        product: "TwinCAT HMI",
        files: [
            { name: "TcHmi_Symbols.csv", format: N_("seznam symbolů ADS a vazeb TwinCAT HMI"), status: "reference", sources: [SRC.tcHmi], paths: (t, p) => hmiPlcPath(p, t) },
            { name: "AlarmList.csv", format: N_("tabulka alarmů s výrazy ST (podklad pro EventLogger / TcHmi)"), status: "reference", sources: [SRC.tcHmi] },
            { name: "README_HMI.txt", format: N_("postup importu a stav ověření"), status: "unverified", sources: [] },
        ],
    },
    mitsubishi: {
        product: "GT Designer3 (GOT2000)",
        files: [
            { name: "GOT_Tags.csv", format: N_("seznam tagů (návěští GX Works3) pro GOT"), status: "reference", sources: [SRC.gtLabels, SRC.gtAccess, SRC.gxw3Labels], ascii: true, paths: (t, p) => hmiPlcPath(p, t) },
            { name: "GOT_AlarmComments.csv", format: N_("komentáře uživatelských alarmů (skupina komentářů)"), status: "reference", sources: [SRC.gtLabels], ascii: true },
            { name: "README_HMI.txt", format: N_("postup importu a stav ověření"), status: "unverified", sources: [] },
        ],
    },
    omron: {
        product: "NA (Sysmac Studio)",
        files: [
            { name: "NA_Variables.txt", format: N_("proměnné zařízení k vložení (Name, Data Type, Comment, AT; TSV)"), status: "unverified", sources: [SRC.naManual, SRC.naPractice, SRC.w501Publish], paths: (t, p) => hmiPlcPath(p, t) + "\t" },
            { name: "NA_UserAlarms.txt", format: N_("uživatelské alarmy (TSV pro úpravu v Excelu; sloupce neověřené)"), status: "reference", sources: [SRC.naManual] },
            { name: "README_HMI.txt", format: N_("postup importu a stav ověření"), status: "unverified", sources: [] },
        ],
    },
};
SPECS.schneider = { product: "EcoStruxure Machine Expert (CODESYS Visualization)", files: SPECS.codesys.files };
/* profily CODESYS: export HMI jako CODESYS (vizualizace / symbolová konfigurace) */
SPECS.wago = { product: "WAGO e!COCKPIT / CODESYS Visualization", files: SPECS.codesys.files };
SPECS.delta = { product: "DIADesigner-AX (CODESYS Visualization)", files: SPECS.codesys.files };
for (const k of CDS_PROFILE_KEYS)
    SPECS[k] = { product: CDS_PROFILES[k].hmi, files: SPECS.codesys.files };
export function hmiExportSpec(plat) { return SPECS[plat] || null; }
/* ================================================================ pomocné */
const TIA_CULTURE = { cs: "cs-CZ", en: "en-US", de: "de-DE", es: "es-ES", zh: "zh-CN" };
const tiaType = (t) => t.type === "BOOL" ? "Bool" : t.type === "INT" ? "Int" : t.type === "WORD" ? "Word" : "Real";
const tiaLen = (t) => t.type === "BOOL" ? 1 : t.type === "REAL" ? 4 : 2;
const xe = (s) => xmlSafe(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tsv = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ");
const q = (s) => '"' + String(s ?? "").replace(/"/g, '""') + '"';
const NV = "<No Value>";
function readme(prj, plat, spec, steps, notes) {
    const L = [
        tr("PLCdesk — HMI pro {plat}: {product}", { plat: PLAT[plat].name, product: spec.product }),
        tr("Projekt: {name}", { name: prj.meta.name || "—" }),
        "",
        tr("Návrh HMI k revizi. Tagy odkazují na proměnné generovaného programu (seznam tagů, alarmů a obrazovek: 16_hmi.md)."),
        "",
        tr("Soubory a stav ověření:"),
        ...spec.files.filter(f => f.name !== "README_HMI.txt").map(f => "  - " + f.name + " — " + tr(f.format) + " — " + hmiStatusLabel(f.status) + (f.sources.length ? "\n      " + tr("zdroj formátu") + ": " + f.sources.join(" ") : "")),
        "",
        tr("Postup:"),
        ...steps.map((s, i) => "  " + (i + 1) + ". " + s),
        "",
        tr("Upozornění:"),
        ...notes.map(n => "  - " + n),
        "  - " + tr("Formát odpovídá veřejné dokumentaci / reálným exportům, ale nebyl naimportován do cílového nástroje. Po prvním importu doplň zjištěné odchylky."),
        "  - " + tr("E-stop a blokování jsou jen stavové signály; bezpečnostní funkce se z HMI neovládají."),
    ];
    return L.join("\n") + "\n";
}
/* ================================================================ Siemens */
function tiaOpennessXml(prj, m) {
    let id = 0;
    const nid = () => (id++).toString(16).toUpperCase();
    const cul = TIA_CULTURE[getLang()];
    let x = '﻿<?xml version="1.0" encoding="utf-8"?>\n<!-- ' + xe(hmiAscii(tr("PLCdesk: návrh k revizi, neověřeno importem (Openness TagTable.Import).")).replace(/--/g, "- -")) + ' -->\n<Document>\n  <Engineering version="V18" />\n';
    x += '  <Hmi.Tag.TagTable ID="' + nid() + '">\n    <AttributeList>\n      <Name>PLCdesk</Name>\n    </AttributeList>\n    <ObjectList>\n';
    for (const t of m.tags) {
        x += '      <Hmi.Tag.Tag ID="' + nid() + '" CompositionName="Tags">\n        <AttributeList>\n' +
            "          <AcquisitionTriggerMode>Visible</AcquisitionTriggerMode>\n          <AddressAccessMode>Symbolic</AddressAccessMode>\n" +
            "          <Coding>Binary</Coding>\n          <Length>" + tiaLen(t) + "</Length>\n          <LogicalAddress />\n" +
            "          <Name>" + xe(t.name) + "</Name>\n        </AttributeList>\n        <LinkList>\n" +
            '          <AcquisitionCycle TargetID="@OpenLink">\n            <Name>1 s</Name>\n          </AcquisitionCycle>\n' +
            '          <Connection TargetID="@OpenLink">\n            <Name>HMI_Connection_1</Name>\n          </Connection>\n' +
            '          <ControllerTag TargetID="@OpenLink">\n            <Name>' + xe(tiaControllerTag(t)) + "</Name>\n          </ControllerTag>\n" +
            '          <DataType TargetID="@OpenLink">\n            <Name>' + tiaType(t) + "</Name>\n          </DataType>\n" +
            '          <HmiDataType TargetID="@OpenLink">\n            <Name>' + tiaType(t) + "</Name>\n          </HmiDataType>\n" +
            "        </LinkList>\n        <ObjectList>\n" +
            '          <MultilingualText ID="' + nid() + '" CompositionName="Comment">\n            <ObjectList>\n' +
            '              <MultilingualTextItem ID="' + nid() + '" CompositionName="Items">\n                <AttributeList>\n' +
            "                  <Culture>" + cul + "</Culture>\n                  <Text>" + xe(t.desc) + "</Text>\n" +
            "                </AttributeList>\n              </MultilingualTextItem>\n            </ObjectList>\n          </MultilingualText>\n" +
            "        </ObjectList>\n      </Hmi.Tag.Tag>\n";
    }
    void prj;
    return x + "    </ObjectList>\n  </Hmi.Tag.TagTable>\n</Document>\n";
}
/** Listy importu Excel TIA (WinCC Comfort/Advanced): Hmi Tags, DiscreteAlarms, AnalogAlarms. */
export function tiaSheets(m) {
    const cul = TIA_CULTURE[getLang()];
    const tags = [[
            "Name", "Path", "Connection", "PLC tag", "DataType", "Length", "Coding", "Access Method", "Address", "Indirect addressing", "Index tag",
            "Start value", "ID tag", "Display name [" + cul + "]", "Comment [" + cul + "]", "Acquisition mode", "Acquisition cycle",
            "Limit Upper 2 Type", "Limit Upper 2", "Limit Upper 1 Type", "Limit Upper 1", "Limit Lower 2 Type", "Limit Lower 2", "Limit Lower 1 Type", "Limit Lower 1",
            "Linear scaling", "End value PLC", "Start value PLC", "End value HMI", "Start value HMI", "Gmp relevant", "Confirmation Type", "Mandatory Commenting",
        ]];
    for (const t of m.tags)
        tags.push([
            t.name, "PLCdesk", "HMI_Connection_1", tiaControllerTag(t), tiaType(t), tiaLen(t), "Binary", "Symbolic access", NV, "False", NV,
            NV, 0, NV, tsv(t.desc), "Cyclic in operation", "1 s",
            "None", NV, "None", NV, "None", NV, "None", NV,
            "False", 10, 0, 100, 0, "False", "None", "False",
        ]);
    const at = "Alarm text [" + cul + "], Alarm text", it = "Info text [" + cul + "], Info text";
    const disc = [["ID", "Name", at, "FieldInfo [Alarm text]", "Class", "Trigger tag", "Trigger bit", "Acknowledgement tag", "Acknowledgement bit", "PLC acknowledgement tag", "PLC acknowledgement bit", "Group", "Report", it]];
    const ana = [["ID", "Name", at, "FieldInfo [Alarm text]", "Class", "Trigger tag", "Limit", "Limit mode", "Delay time", "Delay time unit", "Hysteresis mode", "Hysteresis", "Hysteresis in percentage", "Group", "Report", it]];
    const cls = (a) => a.ackRequired ? "Errors" : "Warnings";
    const info = (a) => tsv(a.cause + " → " + a.reaction + " · " + a.ack);
    let di = 0, ai = 0;
    for (const a of m.alarms) {
        if (a.trigger.kind === "bit")
            disc.push([++di, a.name, tsv(a.text), NV, cls(a), a.trigger.tag, 0, NV, 0, NV, 0, NV, "False", info(a)]);
        else
            ana.push([++ai, a.name, tsv(a.text), NV, cls(a), a.trigger.tag, a.trigger.kind === "bitOff" ? 1 : a.trigger.value, a.trigger.kind === "bitOff" ? "Lower" : "Equal", 0, "Millisecond", "Off", 0, "False", NV, "False", info(a)]);
    }
    return [{ name: "Hmi Tags", rows: tags }, { name: "DiscreteAlarms", rows: disc }, { name: "AnalogAlarms", rows: ana }];
}
/** Sešit .xlsx pro import tagů a alarmů v TIA Portal (WinCC Comfort/Advanced) — bajty, ukládat binárně. */
export function hmiSiemensWorkbook(prj, m = buildHmi(prj)) {
    return xlsxWorkbook(tiaSheets(m));
}
function siemensFiles(prj, m) {
    const sh = tiaSheets(m);
    const T = (i) => "﻿" + sh[i].rows.map(r => r.map(tsv).join("\t")).join("\r\n") + "\r\n";
    return {
        "HMI_Tags_Openness.xml": tiaOpennessXml(prj, m),
        "HmiTags.tsv": T(0), "DiscreteAlarms.tsv": T(1), "AnalogAlarms.tsv": T(2),
        "README_HMI.txt": readme(prj, "siemens", SPECS.siemens, [
            tr("V TIA Portal přidej HMI (Comfort / Advanced) a spojení na CPU; spojení pojmenuj HMI_Connection_1 nebo název v souborech nahraď."),
            tr("Nejjednodušší cesta: soubor hmi_siemens.xlsx (pokud ho klient nabízí) nebo TSV vlož do listů sešitu Excel se stejnými názvy (Hmi Tags, DiscreteAlarms, AnalogAlarms) a v editoru HMI tagů / alarmů zvol Import."),
            tr("Alternativa pro tagy: HMI_Tags_Openness.xml naimportuj skriptem Openness (TagTableComposition.Import) — GUI tento soubor neimportuje."),
            tr("Instance strojního bloku musí být v PLC dostupná z HMI (výchozí: Accessible from HMI)."),
        ], [
            tr("WinCC Comfort/Advanced vyžaduje u diskrétních alarmů spouštěcí tag typu Int/Word s číslem bitu. Pokud import odmítne Bool, založ v PLC slovo alarmů a mapuj na něj bity."),
            tr("Alarmy „blokování rozpojeno“ (vstup FALSE) a „timeout kroku“ (faultStep = krok) jsou analogové alarmy s mezí; sloupce listu AnalogAlarms nejsou ověřené exportem."),
            tr("WinCC Unified: formát importu tagů a alarmů se nepodařilo ověřit — použij seznam z 16_hmi.md nebo Openness (HmiSoftware); Unified umí spouštění alarmu sestupnou hranou."),
        ]),
    };
}
/* ================================================================ Rockwell */
function ftvTagsCsv(m) {
    const A = (s) => q(hmiAscii(s));
    const L = [
        ";###002 - THIS LINE CONTAINS VERSION INFORMATION. DO NOT REMOVE!!!",
        ";Tag Type, Tag Name, Tag Description, Read Only, Data Source, Security Code, Alarmed, Native Type, Value Type, Min Analog, Max Analog, Initial Analog, Scale, Offset, DeadBand, Units, Off Label Digital, On Label Digital, Initial Digital, Length String, Initial String, Retentive, Address, System Source Name, System Source Index, RIO Address, Element Size Block, Number Elements Block, Initial Block",
        '"F","PLCdesk","","F"',
    ];
    for (const t of m.tags) {
        const name = A("PLCdesk\\" + t.name), desc = A(t.desc), addr = A(ftvAddress(t));
        if (t.type === "BOOL")
            L.push(['"D"', name, desc, '"F"', '"D"', '"*"', '"F"', '"D"', '""', "", "", "", "", "", "", '""', '"Off"', '"On"', '"Off"', "", '""', "", addr, '""', "", '""', "", "", '""'].join(","));
        else {
            const real = t.type === "REAL";
            L.push(['"A"', name, desc, '"F"', '"D"', '"*"', '"F"', '"D"', real ? '"F"' : '"L"',
                Number.isFinite(t.min) ? t.min : t.type === "REAL" ? -1000000 : -32768, Number.isFinite(t.max) ? t.max : t.type === "REAL" ? 1000000 : 65535, 0, 1, 0, 0, A(t.unit || ""),
                '""', '""', "", "", '""', "", addr, '""', "", '""', "", "", '""'].join(","));
        }
    }
    return L.join("\r\n") + "\r\n";
}
function ftvAlarmsXml(m) {
    const a = (s) => xe(hmiAscii(s));
    const tagByName = new Map(m.tags.map(t => [t.name, t]));
    const trig = [], msg = [];
    const COLOR = { fault: "#800000", stop: "#808000", warning: "#000080" };
    const seqT = new Map();
    let n = 0;
    for (const al of m.alarms) {
        const t = tagByName.get(al.trigger.tag);
        let tid, val = 1;
        if (al.trigger.kind === "value") {
            tid = seqT.get(t.name) || "";
            if (!tid) {
                tid = "T" + ++n;
                seqT.set(t.name, tid);
                trig.push('<trigger id="' + tid + '" type="value" ack-all-value="0" use-ack-all="false" ack-tag="" exp="' + a(ftvAddress(t)) + '" message-tag="" message-handshake-exp="" message-notification-tag="" remote-ack-exp="" remote-ack-handshake-tag="" label="' + a(t.name) + '" handshake-tag=""/>');
            }
            val = al.trigger.value;
        }
        else {
            tid = "T" + ++n;
            const exp = (al.trigger.kind === "bitOff" ? "NOT " : "") + ftvAddress(t);
            trig.push('<trigger id="' + tid + '" type="value" ack-all-value="0" use-ack-all="false" ack-tag="" exp="' + a(exp) + '" message-tag="" message-handshake-exp="" message-notification-tag="" remote-ack-exp="" remote-ack-handshake-tag="" label="' + a(al.name) + '" handshake-tag=""/>');
        }
        msg.push('<message id="M' + al.id + '" trigger-value="' + val + '" identifier="' + al.id + '" trigger="#' + tid + '" backcolor="' + COLOR[al.cls] + '" forecolor="#FFFFFF" audio="false" display="true" print="false" message-to-tag="false" text="' + a(al.text) + '"/>');
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!-- ' + a(tr("PLCdesk: návrh k revizi, neověřeno importem. Import nahradí celé nastavení alarmů.")).replace(/--/g, "- -") + " -->\n" +
        '<alarms version="1.0" product="{E44CB020-C21D-11D3-8A3F-0010A4EF3494}" id="Alarms">\n' +
        ' <alarm history-size="2000" capacity-high-warning="90" capacity-high-high-warning="99" display-name="[NONE]" hold-time="250" max-update-rate="0.25" embedded-server-update-rate="0.25" silence-tag="" remote-silence-exp="" remote-ack-all-exp="" status-reset-tag="" remote-status-reset-exp="" close-display-tag="" remote-close-display-exp="" use-alarm-identifier="false" capacity-high-warning-tag="" capacity-high-high-warning-tag="" capacity-overrun-tag="" remote-clear-history-exp="">\n' +
        "  <triggers>\n" + trig.map(t => "   " + t + "\n").join("") + "  </triggers>\n" +
        "  <messages>\n" + msg.map(t => "   " + t + "\n").join("") + "  </messages>\n" +
        " </alarm>\n</alarms>\n";
}
function rockwellFiles(prj, m) {
    return {
        "FTView_Tags.csv": ftvTagsCsv(m),
        "FTView_Alarms.xml": ftvAlarmsXml(m),
        "README_HMI.txt": readme(prj, "rockwell", SPECS.rockwell, [
            tr("V aplikaci FactoryTalk View vytvoř zkratku zařízení (RSLinx Enterprise) s názvem PLC na řídicí systém s programem PLCdesk."),
            tr("Tagy: Tag Import and Export Wizard → import FTView_Tags.csv (složka PLCdesk). Tagy lze vynechat a používat přímé odkazy {::[PLC]Program:PLCdesk.…}."),
            tr("Alarmy (ME): Alarm Setup → Import/Export → import FTView_Alarms.xml (nahradí celé nastavení alarmů)."),
        ], [
            tr("Tvar adresy tagů zařízení ({::[PLC]Program:…}) a typy spouštěčů alarmů nejsou ověřené importem — zkontroluj na jednom tagu a alarmu."),
            tr("FactoryTalk View ME importuje průvodcem jen tagy; alarmy se importují v Alarm Setup."),
        ]),
    };
}
/* ================================================================ CODESYS / Schneider / Beckhoff */
const CDS_T = {
    BOOL: { n: "T_BOOL", size: 1, cls: "Bool" }, INT: { n: "T_INT", size: 2, cls: "Int" },
    WORD: { n: "T_WORD", size: 2, cls: "Word" }, REAL: { n: "T_REAL", size: 4, cls: "Real" },
};
/** Výraz ST podmínky alarmu (CODESYS / TwinCAT, cesty `MAIN.` / `GVL_IO.`). */
function alarmExpr(plat, a, tags, prj) {
    const p = hmiPlcPath(plat, tags.get(a.trigger.tag), prj);
    return a.trigger.kind === "bit" ? p : a.trigger.kind === "bitOff" ? "NOT " + p : p + " = " + a.trigger.value;
}
function cdsSymbolXml(prj, plat, m) {
    const used = new Set(m.tags.map(t => t.type));
    const root = { kids: new Map() };
    const add = (path, t) => {
        let n = root;
        for (const seg of path) {
            if (!n.kids.has(seg))
                n.kids.set(seg, { kids: new Map() });
            n = n.kids.get(seg);
        }
        n.type = CDS_T[t.type].n;
        n.access = t.access === "RW" ? "ReadWrite" : "Read";
    };
    for (const t of m.tags)
        add(["Application", ...hmiPlcPath(plat, t, prj).split(".")], t);
    const ind = (d) => "  ".repeat(d);
    const nodeXml = (name, n, d) => n.kids.size
        ? ind(d) + '<Node name="' + xe(name) + '">\n' + [...n.kids].map(([k, c]) => nodeXml(k, c, d + 1)).join("") + ind(d) + "</Node>\n"
        : ind(d) + '<Node name="' + xe(name) + '" type="' + n.type + '" access="' + n.access + '" />\n';
    return '<?xml version="1.0" encoding="utf-8"?>\n<!-- ' + xe(hmiAscii(tr("PLCdesk: očekávaná symbolová konfigurace (referenční; skutečný soubor generuje CODESYS po zaškrtnutí proměnných v Symbol Configuration).")).replace(/--/g, "- -")) + " -->\n" +
        '<Symbolconfiguration xmlns="http://www.3s-software.com/schemas/Symbolconfiguration.xsd">\n' +
        '  <Header>\n    <Version>3.5.11.0</Version>\n    <ProjectInfo name="' + xe(hmiAscii(prj.meta.name || "PLCdesk")) + '" devicename="Device" appname="Application" />\n  </Header>\n' +
        "  <TypeList>\n" + [...used].map(t => '    <TypeSimple name="' + CDS_T[t].n + '" size="' + CDS_T[t].size + '" typeclass="' + CDS_T[t].cls + '" iecname="' + t + '" />\n').join("") + "  </TypeList>\n" +
        "  <NodeList>\n" + [...root.kids].map(([k, c]) => nodeXml(k, c, 2)).join("") + "  </NodeList>\n</Symbolconfiguration>\n";
}
function cdsAlarmCsv(plat, m, prj) {
    const tags = new Map(m.tags.map(t => [t.name, t]));
    const CLS = { fault: "Error", stop: "Warning", warning: "Info" };
    const L = ["ID;Observation type;Details;Deactivation;Class;Message;On-delay;Off-delay;Latch var 1;Latch var 2"];
    for (const a of m.alarms)
        L.push([a.id, "Digital", alarmExpr(plat, a, tags, prj), "", CLS[a.cls], tsv(a.text).replace(/;/g, ","), "", "", "", ""].join(";"));
    return "﻿" + L.join("\r\n") + "\r\n";
}
function codesysFiles(prj, plat, m) {
    return {
        "Symbolconfiguration_PLCdesk.xml": cdsSymbolXml(prj, plat, m),
        "AlarmGroup_PLCdesk.csv": cdsAlarmCsv(plat, m, prj),
        "README_HMI.txt": readme(prj, plat, SPECS[plat], [
            tr("Vizualizace ve stejném projektu čte proměnné přímo (MAIN.…, GVL_IO.…) — tagy není třeba zakládat; obrazovky postav podle náhledů hmi_*.svg."),
            tr("Pro OPC UA / externí HMI přidej objekt Symbol Configuration a zaškrtni proměnné ze Symbolconfiguration_PLCdesk.xml (soubor je referenční seznam, CODESYS ho generuje sám)."),
            tr("Alarmy: Alarm Configuration → Alarm Group → Import Alarms; tabulku AlarmGroup_PLCdesk.csv nejdřív srovnej s exportem jedné skupiny (sloupce CSV výrobce nezveřejňuje)."),
        ], [
            tr("Pozorování alarmu je „Digital“ s výrazem ST; třídy Error / Warning / Info založ v Alarm Configuration."),
        ]),
    };
}
function beckhoffFiles(prj, m) {
    const tags = new Map(m.tags.map(t => [t.name, t]));
    const S = ["Name;ADS symbol;TcHmi mapped symbol;TcHmi binding;Type;Access;Description"];
    for (const t of m.tags) {
        const p = hmiPlcPath("beckhoff", t, prj);
        S.push([t.name, p, "ADS.PLC1." + p, "%s%PLC1." + p + "%/s%", t.type, t.access === "RW" ? "ReadWrite" : "Read", tsv(t.desc).replace(/;/g, ",")].join(";"));
    }
    const A = ["ID;Name;Class;Priority;Condition (ST);Text;Acknowledge"];
    for (const a of m.alarms)
        A.push([a.id, a.name, a.cls, a.priority, alarmExpr("beckhoff", a, tags, prj), tsv(a.text).replace(/;/g, ","), a.ackRequired ? "cmdAck" : ""].join(";"));
    return {
        "TcHmi_Symbols.csv": "﻿" + S.join("\r\n") + "\r\n",
        "AlarmList.csv": "﻿" + A.join("\r\n") + "\r\n",
        "README_HMI.txt": readme(prj, "beckhoff", SPECS.beckhoff, [
            tr("TwinCAT HMI: v Server → ADS namapuj symboly ze sloupce „ADS symbol“ (runtime PLC1, port 851); vazby prvků mají tvar ze sloupce „TcHmi binding“."),
            tr("Obrazovky postav podle náhledů hmi_*.svg; alarmy převeď do tříd událostí TwinCAT EventLogger nebo do logiky TcHmi podle AlarmList.csv."),
        ], [
            tr("TwinCAT HMI nemá zdokumentovaný soubor pro import symbolů ani alarmů — soubory jsou referenční seznamy."),
        ]),
    };
}
/* ================================================================ Mitsubishi / Omron */
function mitsubishiFiles(prj, m) {
    const A = (s) => q(hmiAscii(s));
    const T = ['"Label","Data Type","Access","Comment"'];
    for (const t of m.tags)
        T.push([A(hmiPlcPath("mitsubishi", t)), A(t.type === "BOOL" ? "Bit" : t.type === "REAL" ? "FLOAT [Single Precision]" : "Word [Signed]"), A(t.access === "RW" ? "Read/Write" : "Read"), A(t.desc)].join(","));
    const C = ['"No.","Comment","Trigger"'];
    for (const a of m.alarms)
        C.push([a.id, A(a.text), A(a.trigger.kind === "bit" ? a.trigger.tag : a.trigger.kind === "bitOff" ? "NOT " + a.trigger.tag : a.trigger.tag + " = " + a.trigger.value)].join(","));
    return {
        "GOT_Tags.csv": T.join("\r\n") + "\r\n",
        "GOT_AlarmComments.csv": C.join("\r\n") + "\r\n",
        "README_HMI.txt": readme(prj, "mitsubishi", SPECS.mitsubishi, [
            tr("Proměnné řízení stroje (modeAuto, cmdAutoStart, cmdAck, manRun_*, …) a stav bloků (instX_status, instX_value…) jsou v generovaném programu globální návěští (GlobalLabels.csv, sloupec Access from External Device = 1) — GOT_Tags.csv na ně odkazuje přímo."),
            tr("V GT Designer3: Project → Import Other Data → Global Label (z projektu GX Works3)."),
            tr("Komentáře alarmů z GOT_AlarmComments.csv vlož do skupiny komentářů a nastav User Alarm Observation na bity ze sloupce Trigger."),
        ], [
            tr("Import globálních návěští do GT Designer3 a volba Access from External Device platí pro iQ-R (RCPU); FX5 volbu nemá — u FX5 přiřaď návěštím z GOT_Tags.csv operandy (sloupec Assign v GX Works3, např. M / D) a v GOT použij operandy."),
            tr("Rozložení CSV pro import komentářů GT Designer3 není veřejně popsané — soubory jsou referenční seznamy (ASCII)."),
        ]),
    };
}
function omronFiles(prj, m) {
    const V = [];
    for (const t of m.tags)
        V.push([hmiPlcPath("omron", t), t.type, tsv(t.desc), ""].join("\t"));
    const A = ["Name\tMessage\tVariable\tCondition\tType\tLevel"];
    for (const a of m.alarms)
        A.push([a.name, tsv(a.text), a.trigger.tag, a.trigger.kind === "bit" ? "TRUE" : a.trigger.kind === "bitOff" ? "FALSE" : "= " + a.trigger.value, "Alarm", a.priority === 1 ? "High" : a.priority === 2 ? "Medium" : "Low"].join("\t"));
    return {
        "NA_Variables.txt": V.join("\r\n") + "\r\n",
        "NA_UserAlarms.txt": A.join("\r\n") + "\r\n",
        "README_HMI.txt": readme(prj, "omron", SPECS.omron, [
            tr("Proměnné řízení stroje (modeAuto, cmdAutoStart, cmdAck, manRun_*, …) a stav bloků (instX_status, instX_value…) jsou v generovaném programu globální proměnné s Network Publish = Publish Only (Variables.txt) — NA je čte a zapisuje přes CIP."),
            tr("V Sysmac Studiu: NA → Variable Mapping; proměnné zařízení vlož z NA_Variables.txt (sloupce Name, Data Type, Comment, AT) a namapuj na globální proměnné HMI."),
            tr("Uživatelské alarmy: zkopíruj do Excelu (od Sysmac Studio 1.27) a doplň řádky z NA_UserAlarms.txt."),
        ], [
            tr("Sloupce uživatelských alarmů NA nejsou ve veřejném manuálu popsané — NA_UserAlarms.txt je referenční tabulka."),
        ]),
    };
}
/* ================================================================ vstup */
/** Výstupy jen v ASCII: při čínštině texty anglicky (jako `trx`), jinak by z nich zbyly otazníky. */
function ascii(prj, m) {
    return getLang() === "zh" ? withLang("en", () => buildHmi(prj)) : m;
}
/**
 * Soubory exportu HMI pro platformu (název → obsah). Napojení: přes `registerHmiModule()`
 * (hmi_docs.ts) se přidají do sady projektu jako skupina „HMI — <platforma>“; `genFor` se nemění.
 */
export function hmiFiles(prj0, plat, m = buildHmi(prj0)) {
    /* osa na platformě, která ji negeneruje: genFor vrátí jen README s důvodem — tagy HMI by neměly proměnné v kódu (N12) */
    if (axisBlocked(prj0, plat))
        return {};
    const prj = outputSafe(prj0);
    switch (plat) {
        case "siemens": return siemensFiles(prj, m);
        case "rockwell": return rockwellFiles(prj, ascii(prj, m));
        case "codesys":
        case "schneider":
        case "wago":
        case "delta": return codesysFiles(prj, plat, m);
        case "beckhoff": return beckhoffFiles(prj, m);
        case "mitsubishi": return mitsubishiFiles(prj, ascii(prj, m));
        case "omron": return omronFiles(prj, m);
        default: return platBase(plat) === "codesys" ? codesysFiles(prj, plat, m) : {};
    }
}
