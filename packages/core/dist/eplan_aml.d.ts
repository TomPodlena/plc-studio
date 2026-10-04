/**
 * PLCdesk → EPLAN Electric P8: AutomationML AR APC 1.4.0 (CAEX 2.15) — zadání docs/eplan-aml-export.md.
 *
 *   genEplanAml(prj, opts)   soubor .aml (EPLAN: Import PLC dat, formát „AutomationML AR APC“)
 *   validateEplan(prj, opts) nálezy kontroly (§13): unikátní ID, rozlišitelné RefPartnerSideA/B a link
 *                            v nejbližším společném rodiči, povinné atributy, unikátní UDT + symbolická
 *                            adresa v CPU, unikátní název fyzické sítě, GUID v modelu
 *   validateAml(xml)         táž kontrola nad hotovým textem AML (i cizím)
 *
 * Hierarchie (§6):
 *   InstanceHierarchy
 *   └ AutomationProject  (ID = Project.guid; konfigurační projekt EPLAN 20161 = název projektu)
 *     ├ Subnet „PN_IE_1“ (Type Ethernet = sběrnicový systém 20308; název = fyzická síť 20413, unikátní)
 *     └ Device  stanice PLC
 *       └ DeviceItem Rack „Rack_0“ (System:Rack.Generic; karta na racku 20410 = vnoření + PositionNumber)
 *         ├ DeviceItem CPU -A1 (slot 1)
 *         │ ├ CommunicationInterface „PROFINET_interface_1“ (Label X1)
 *         │ │ ├ Node (Type Ethernet, NetworkAddress; NodeEthernet: maska, ProfinetDeviceName)
 *         │ │ ├ IoSystem „PROFINET_IO_system“ (logická síť 20414; Number = MasterSystemID 20334)
 *         │ │ └ CommunicationPort „Port_1“ (Label P1 R)
 *         │ └ TagTable „PLCdesk“ → Tag (symbolická adresa; volitelně ComplexTag = UDT 20618/20619)
 *         └ DeviceItem karty -A2 … (slot 2…, ID = GUID karty) → ExternalInterface Channel (ID = GUID signálu)
 *   InternalLink kanál ↔ tag v Rack_0, Node ↔ Subnet v AutomationProject (nejbližší společný rodič, §10).
 *
 * Model nemá vzdálené stanice ani IO-Link mastery → karty sedí v lokálním racku CPU (vnoření); síť
 * PROFINET nese jen rozhraní CPU (IO controller s IO systémem bez zařízení). Vzdálené stanice / IO-Link
 * přibudou, až je bude model znát (stejný strom: Device stanice + Node ↔ Subnet + IoSystem).
 *
 * GUID: export je jen čte (guid.ts) — chybějící GUID nahradí deterministickým zástupcem z názvu a
 * validateEplan to hlásí. Objekty bez vlastního záznamu (stanice, rack, CPU, rozhraní, síť) mají GUID
 * odvozený z GUID projektu. Stav: neověřeno importem do EPLAN (EPLAN_VERIFIED v eplan.ts).
 */
import { type Project } from "./model.js";
import { type EplanCard } from "./eplan.js";
export interface EplanAmlOptions {
    /** karty z `eplanCards` (jinak se spočítají) */
    cards?: EplanCard[];
    /** symbolické adresy jako UDT (ComplexTag = zařízení, Tag = signál) místo plochých tagů `<zařízení>_<signál>` */
    udt?: boolean;
    /** rozhraní PROFINET CPU, IO systém a podsíť (výchozí ano) */
    network?: boolean;
    /** čas zápisu do hlavičky (testy) */
    now?: Date;
}
export interface EplanIssue {
    level: "error" | "warn";
    where: string;
    msg: string;
}
/** Část cesty CAEX: při znacích @ . : / v hranatých závorkách, „[“ a „]“ escapované (AR APC 5.2.8). */
export declare const amlPathPart: (s: string) => string;
/** AutomationML AR APC 1.4.0 (CAEX 2.15): stanice, rack, CPU s rozhraním PROFINET, karty, kanály, symbolické adresy. */
export declare function genEplanAml(prj: Project, opts?: EplanAmlOptions): string;
/** Kontrola hotového AML (CAEX 2.15 / AR APC) bez schématu: ID, odkazy, povinné atributy, unikátnost. */
export declare function validateAml(xml: string): EplanIssue[];
/** Nálezy exportu do EPLAN: GUID v modelu (export je negeneruje) + kontrola vygenerovaného AML. */
export declare function validateEplan(prj: Project, opts?: EplanAmlOptions): EplanIssue[];
