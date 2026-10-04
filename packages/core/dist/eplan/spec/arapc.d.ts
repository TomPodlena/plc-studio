/**
 * AutomationML AR APC 1.4.0 — doslovné názvy tříd a atributů pro export do EPLAN (eplan_aml.ts).
 *
 * Zdroj (zdarma, bez registrace):
 *   https://www.automationml.org/wp-content/uploads/2023/07/AR-APC-V1.4.0.zip
 *     SHA-256 a67543b500e0325af9574c93e5d96024809d995dd631dbd9df0e7175a5a33e7f
 *   → AutomationML_ARAPC_Libraries_AMLEd1_1.4.0.aml (CAEX 2.15, „AMLEd1“)
 *     SHA-256 47a0af661e35acb6532b6ea27153654eafe4eee50fa78ba42caabcea1c247059
 *   + PDF AR APC V 1.4.0 (07/2023) a rozšíření ARE APC Ethernet 1.2.1, Extension Rack 1.2.0,
 *     IO-Link 1.3.0, Profibus 1.2.0.
 *
 * Licence: archiv ani PDF neuvádějí licenci, jen „© AutomationML consortium“. Redistribuci tedy
 * výslovně nedovolují — soubor knihovny se do repozitáře NEUKLÁDÁ (zadání docs/eplan-aml-export.md §3:
 * „pokud licence dovoluje“). Tady jsou jen extrahované názvy (fakta nutná pro interoperabilitu)
 * a ve výstupu výřez definic tříd, které export skutečně používá (soubor AML musí cesty tříd
 * rozlišit — stejně to dělají exporty EPLAN / TIA). Knihovnu si lze stáhnout z odkazu výše
 * a otisk ověřit.
 *
 * Konvence převzaté z PDF (kapitola a strana):
 *  - identita objektu = atribut ID (UUID) InternalElementu / ExternalInterface; při opakovaném importu
 *    párují nástroje podle UUID, teprve pak podle jména (Appendix A „Roundtrip Engineering“, s. 57–62)
 *  - Tag patří jen do TagTable CPU; kanál (Channel) se s tagem spojí InternalLinkem (3.2.4.8, 5.2.2)
 *  - Subnet = síť pod projektem, Type „Ethernet“ (ARE Ethernet 3.1); Node patří k CommunicationInterface
 *    a s podsítí ho spojuje link LogicalEndPoint ↔ LogicalEndPoint (3.2.2, 3.2.4.12)
 *  - IoSystem = vztah master–slave (logická síť), parent = rozhraní mastera, atribut Number (3.2.4.14)
 *  - rozšiřující role sběrnice (NodeEthernet…) jako SupportedRoleClass (3.2.4.18)
 *  - TypeIdentifier s předponou „OrderNumber:“ / „GSD:“ / „System:“ / „CSP+:“; „System:Rack.Generic“ (5.1.5)
 *  - Comment podle BPR „Multilingual expressions“: hodnota ve výchozím jazyce + podatributy
 *    „aml-lang=<RFC 5646>“ (např. aml-lang=de-DE) — BPR_002E_Multilingual_Expressions_Oct2014.pdf
 *  - cesty CAEX: části s @ . : / v hranatých závorkách, „[“ „]“ escapovat (5.2.8)
 *  - ComplexTag (UDT) s povinným DataType = název struktury (3.2.4.9; EPLAN 20618/20619 od 1.3.0)
 *  - LogicalAddress tagu BEZ směru (5.2.1: „shall not contain the direction“) — %I0.0 → 0.0, %IW64 → W64;
 *    směr nese IoType (tak exportuje TIA Portal V18/V21)
 *  - TypeIdentifier stanice (Device) = rodina zařízení (5.1.4 „family identifier“): System:Device.S71200 …
 *  - BuiltIn podmodul identifikuje UUID prvního nadřazeného DeviceItem s BuiltIn=false + PositionNumber (5.1.5)
 *
 * Konvence převzaté z reálných exportů (EPLAN 2.7.3, TIA Portal V17/V18/V21, TwinCAT 3 — porovnání
 * v docs/eplan-aml-export.md): role jako <SupportedRoleClass RefRoleClassPath=…> (žádný z exportérů
 * nepíše RoleRequirements), kanály „Channel_DI_0“, rozhraní LogicalEndPoint_Subnet / _Node / _IoSystem /
 * _Interface, Siemens karty hierarchicky (karta → BuiltIn podmodul PositionNumber 1 s Address a kanály),
 * objednací čísla Siemens s mezerou po 4. znaku („6ES7 131-6BH01-0BA0“).
 */
export declare const ARAPC_VERSION = "1.4.0";
export declare const ARAPC_SOURCE = "https://www.automationml.org/wp-content/uploads/2023/07/AR-APC-V1.4.0.zip";
export declare const ARAPC_SHA256 = "47a0af661e35acb6532b6ea27153654eafe4eee50fa78ba42caabcea1c247059";
export declare const MLING_SOURCE = "https://www.automationml.org/wp-content/uploads/2021/06/BPR_002E_Multilingual_Expressions_Oct2014.pdf";
/** RefBaseRoleClassPath rolí (doslovně z knihovny). */
export declare const ROLE: {
    readonly AutomationProject: string;
    readonly DeviceUserFolder: string;
    readonly Subnet: string;
    readonly Device: string;
    readonly DeviceItem: string;
    readonly TagTable: string;
    readonly ComplexTag: string;
    readonly TagUserFolder: string;
    readonly Node: string;
    readonly CommunicationInterface: string;
    readonly IoSystem: string;
    readonly CommunicationPort: string;
    readonly NodeEthernet: "AutomationProjectConfigurationEthernetRoleClassLib/NodeEthernet";
};
/** RefBaseClassPath rozhraní (doslovně z knihovny). */
export declare const IFACE: {
    readonly Tag: string;
    readonly Channel: string;
    readonly CommunicationPortInterface: string;
    readonly ModuleAssignment: string;
    readonly LogicalEndPoint: "CommunicationInterfaceClassLib/LogicalEndPoint";
};
/**
 * Názvy instancí rozhraní LogicalEndPoint — podle reálných exportů (TIA Portal V17/V18/V21 i EPLAN 2.7.3
 * pojmenovávají LogicalEndPoint_Subnet / _Node / _IoSystem / _Interface; knihovna má jen název třídy).
 */
export declare const LEP: {
    readonly subnet: "LogicalEndPoint_Subnet";
    readonly node: "LogicalEndPoint_Node";
    readonly ioSystem: "LogicalEndPoint_IoSystem";
    readonly iface: "LogicalEndPoint_Interface";
};
/** Standardní hodnoty DeviceItemType (AR APC 5.1.5: „CPU, HeadModule, Accessory“); jiné jen s Customized=true. */
export declare const DEVICE_ITEM_TYPES: readonly ["CPU", "HeadModule", "Accessory"];
/** Hodnoty atributu Type sítě / uzlu (ARE APC Ethernet 3.1, 3.3). */
export declare const SUBNET_TYPE: {
    readonly ethernet: "Ethernet";
};
/** Výchozí jazyk atributů a značky jazyků (RFC 5646) pro „aml-lang=…“. */
export declare const AML_LANG: Record<string, string>;
/**
 * Povinné atributy podle rolí / rozhraní, jak je kontroluje validateEplan (AR APC: „mandatory“;
 * u Channel a Tag i atributy, bez nichž EPLAN připojovací bod nenaplní). Vlastní export: chyba;
 * cizí soubor (validateAml bez `strict`): upozornění — reálné exporty je vynechávají (EPLAN 2.7.3:
 * Node bez NetworkAddress u EtherCAT, IoSystem bez Number, Tag bez IoType podle AR APC 1.0.0).
 */
export declare const REQUIRED: Record<string, string[]>;
/**
 * Výřez knihoven AR APC 1.4.0 (AutomationML_ARAPC_Libraries_AMLEd1_1.4.0.aml): jen třídy a atributy,
 * které export používá, cesty a názvy beze změny (aby je importér našel).
 */
export declare const AML_LIBS: string;
