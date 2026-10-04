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
/** Hodnoty atributu Type sítě / uzlu (ARE APC Ethernet 3.1, 3.3). */
export declare const SUBNET_TYPE: {
    readonly ethernet: "Ethernet";
};
/** Výchozí jazyk atributů a značky jazyků (RFC 5646) pro „aml-lang=…“. */
export declare const AML_LANG: Record<string, string>;
/**
 * Povinné atributy podle rolí / rozhraní, jak je kontroluje validateEplan (AR APC: „mandatory“;
 * u Channel a Tag i atributy, bez nichž EPLAN připojovací bod nenaplní).
 */
export declare const REQUIRED: Record<string, string[]>;
/**
 * Výřez knihoven AR APC 1.4.0 (AutomationML_ARAPC_Libraries_AMLEd1_1.4.0.aml): jen třídy a atributy,
 * které export používá, cesty a názvy beze změny (aby je importér našel).
 */
export declare const AML_LIBS: string;
