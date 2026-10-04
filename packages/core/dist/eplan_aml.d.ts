/**
 * PLCdesk → EPLAN Electric P8: AutomationML AR APC 1.4.0 (CAEX 2.15) — zadání docs/eplan-aml-export.md.
 *
 *   genEplanAml(prj, opts)   soubor .aml (EPLAN: Import PLC dat, formát „AutomationML AR APC“)
 *   validateEplan(prj, opts) nálezy kontroly (§13): unikátní ID, rozlišitelné RefPartnerSideA/B a link
 *                            v nejbližším společném rodiči, povinné atributy, unikátní UDT + symbolická
 *                            adresa v CPU, unikátní název fyzické sítě, GUID v modelu
 *   validateAml(xml)         táž kontrola nad hotovým textem AML (i cizím)
 *
 * Hierarchie (§6) — role jako SupportedRoleClass, pořadí prvků dle XSD CAEX 2.15:
 *   InstanceHierarchy
 *   └ AutomationProject  (ID = Project.guid; konfigurační projekt EPLAN 20161 = název projektu bez „.“)
 *     ├ Subnet „PN_IE_1“ (Type Ethernet = sběrnicový systém 20308; název = fyzická síť 20413, unikátní)
 *     └ Device  stanice PLC (ID stanice 20408 bez „.“; TypeIdentifier System:Device.S71200 / S71500 / ET200SP / Generic)
 *       └ DeviceItem Rack „Rack_0“ (System:Rack.<rodina>; karta na racku 20410 = vnoření + PositionNumber)
 *         ├ DeviceItem CPU -A1 (slot 1, DeviceItemType CPU, OrderNumber s mezerou u Siemens)
 *         │ ├ CommunicationInterface „PROFINET_interface_1“ (Label X1, LogicalEndPoint_Interface)
 *         │ │ ├ Node „E1“ (Type Ethernet, NetworkAddress; NodeEthernet: maska, ProfinetDeviceName; LogicalEndPoint_Node)
 *         │ │ ├ IoSystem „PROFINET_IO_system“ (logická síť 20414; Number = MasterSystemID 20334)
 *         │ │ └ CommunicationPort „Port_1“ (Label P1 R)
 *         │ └ TagTable „PLCdesk“ → Tag (ID = GUID signálu; LogicalAddress bez směru; volitelně ComplexTag = UDT)
 *         └ DeviceItem karty -A2 … (slot 2…, ID = GUID karty)
 *           └ Siemens: BuiltIn podmodul (PositionNumber 1) s Address a kanály (jako TIA Portal V18/V21);
 *             ostatní: Address a kanály přímo na kartě (jako EPLAN 2.7.3 / TwinCAT)
 *             → ExternalInterface „Channel_DI_0“ … všechny kanály karty (ID poziční z GUID karty)
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
import { type Project, type Dir, type IoEntry, addrFor } from "./model.js";
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
/** Počet kanálů karty (stejné dělení jako `modules()` v model.ts: DI16 / DO16 / AI8 / AO4). */
export declare const CARD_CHANNELS: Record<Dir, number>;
/**
 * Objednací číslo do TypeIdentifier. Siemens (6ES7 / 6AG1 / 6GKx) s mezerou po 4. znaku — tak je
 * zapisuje TIA Portal (V17–V21) i kmenová data EPLAN (Siemens 109766653); katalog PLCdesk nese
 * tvar bez mezery, převádí se až tady. Ostatní výrobci beze změny.
 */
export declare function amlOrderNumber(code: string): string;
/**
 * LogicalAddress tagu bez směru (AR APC 1.4.0, 5.2.1): %I0.0 → 0.0, %IW64 → W64, %QW80 → W80,
 * CODESYS %IX0.0 → 0.0; TwinCAT %I* (linkování) → bez adresy; Mitsubishi X10 / Y10 beze změny
 * (písmeno je součást operandu). Směr nese IoType.
 */
export declare function amlLogicalAddress(plat: Parameters<typeof addrFor>[0], e: IoEntry): string;
/**
 * Rodina stanice pro TypeIdentifier Device / Rack (AR APC 5.1.4 „family identifier“; hodnoty jako
 * TIA Portal: System:Device.S71200, System:Rack.S71200 …). Jiní výrobci a neznámé CPU: Generic.
 */
export declare function stationFamily(plat: string, cpuOrder: string | undefined): string;
/** AutomationML AR APC 1.4.0 (CAEX 2.15): stanice, rack, CPU s rozhraním PROFINET, karty, kanály, symbolické adresy. */
export declare function genEplanAml(prj: Project, opts?: EplanAmlOptions): string;
/** Prvek instanční hierarchie AML ve zjednodušené podobě (porovnání se vzorky, budoucí import). */
export interface AmlElement {
    name: string;
    id: string;
    roles: string[];
    depth: number;
    parent: AmlElement | null;
    /** atributy: hodnota a názvy podatributů (aml-lang=…, položky Address …) */
    attrs: Record<string, {
        value: string;
        sub: string[];
    }>;
    ifaces: Array<{
        name: string;
        id: string;
        cls: string;
        attrs: Record<string, string>;
    }>;
    links: Array<{
        name: string;
        a: string;
        b: string;
    }>;
}
/** Strom InternalElementů (do hloubky, v pořadí souboru) — role ze SupportedRoleClass i RoleRequirements. */
export declare function amlStructure(xml: string): AmlElement[];
export interface ValidateAmlOptions {
    /**
     * Vlastní export (validateEplan): i odchylky od AR APC, které reálné exporty dělají (chybějící
     * „mandatory“ atribut, neznámá role, LogicalAddress se směrem, nestandardní DeviceItemType), jsou chyba.
     * Bez `strict` (cizí soubor) jsou to jen upozornění; chybou zůstává jen to, co soubor rozbíjí
     * (well-formed XML, ID, rozložitelné a existující odkazy, unikátnost).
     */
    strict?: boolean;
}
/** Kontrola hotového AML (CAEX 2.15 / AR APC) bez schématu: ID, odkazy, povinné atributy, unikátnost. */
export declare function validateAml(xml: string, opts?: ValidateAmlOptions): EplanIssue[];
/** Nálezy exportu do EPLAN: GUID v modelu (export je negeneruje) + kontrola vygenerovaného AML. */
export declare function validateEplan(prj: Project, opts?: EplanAmlOptions): EplanIssue[];
