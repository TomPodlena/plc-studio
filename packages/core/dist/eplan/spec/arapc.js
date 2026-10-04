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
export const ARAPC_VERSION = "1.4.0";
export const ARAPC_SOURCE = "https://www.automationml.org/wp-content/uploads/2023/07/AR-APC-V1.4.0.zip";
export const ARAPC_SHA256 = "47a0af661e35acb6532b6ea27153654eafe4eee50fa78ba42caabcea1c247059";
export const MLING_SOURCE = "https://www.automationml.org/wp-content/uploads/2021/06/BPR_002E_Multilingual_Expressions_Oct2014.pdf";
const RCL = "AutomationProjectConfigurationRoleClassLib/";
const ICL = "AutomationProjectConfigurationInterfaceClassLib/";
/** RefBaseRoleClassPath rolí (doslovně z knihovny). */
export const ROLE = {
    AutomationProject: RCL + "AutomationProject",
    DeviceUserFolder: RCL + "DeviceUserFolder",
    Subnet: RCL + "Subnet",
    Device: RCL + "Device",
    DeviceItem: RCL + "DeviceItem",
    TagTable: RCL + "TagTable",
    ComplexTag: RCL + "ComplexTag",
    Node: RCL + "Node",
    CommunicationInterface: RCL + "CommunicationInterface",
    IoSystem: RCL + "IoSystem",
    CommunicationPort: RCL + "CommunicationPort",
    NodeEthernet: "AutomationProjectConfigurationEthernetRoleClassLib/NodeEthernet",
};
/** RefBaseClassPath rozhraní (doslovně z knihovny). */
export const IFACE = {
    Tag: ICL + "Tag",
    Channel: ICL + "Channel",
    CommunicationPortInterface: ICL + "CommunicationPortInterface",
    ModuleAssignment: ICL + "ModuleAssignment",
    LogicalEndPoint: "CommunicationInterfaceClassLib/LogicalEndPoint",
};
/** Hodnoty atributu Type sítě / uzlu (ARE APC Ethernet 3.1, 3.3). */
export const SUBNET_TYPE = { ethernet: "Ethernet" };
/** Výchozí jazyk atributů a značky jazyků (RFC 5646) pro „aml-lang=…“. */
export const AML_LANG = { cs: "cs-CZ", en: "en-US", de: "de-DE", es: "es-ES", zh: "zh-CN" };
/**
 * Povinné atributy podle rolí / rozhraní, jak je kontroluje validateEplan (AR APC: „mandatory“;
 * u Channel a Tag i atributy, bez nichž EPLAN připojovací bod nenaplní).
 */
export const REQUIRED = {
    [ROLE.AutomationProject]: ["ProjectSign"],
    [ROLE.Subnet]: ["Type"],
    [ROLE.DeviceItem]: ["PositionNumber"],
    [ROLE.CommunicationInterface]: ["Label"],
    [ROLE.CommunicationPort]: ["Label"],
    [ROLE.Node]: ["Type", "NetworkAddress"],
    [ROLE.IoSystem]: ["Number"],
    [ROLE.ComplexTag]: ["DataType"],
    [IFACE.Channel]: ["Type", "IoType", "Number", "Length"],
    [IFACE.Tag]: ["DataType", "IoType"],
};
/**
 * Výřez knihoven AR APC 1.4.0 (AutomationML_ARAPC_Libraries_AMLEd1_1.4.0.aml): jen třídy a atributy,
 * které export používá, cesty a názvy beze změny (aby je importér našel).
 */
export const AML_LIBS = [
    '<InterfaceClassLib Name="AutomationMLInterfaceClassLib"><Version>2.2.2</Version>',
    '<InterfaceClass Name="AutomationMLBaseInterface">',
    '<InterfaceClass Name="ExternalDataConnector" RefBaseClassPath="AutomationMLBaseInterface"><Attribute Name="refURI" AttributeDataType="xs:anyURI" />',
    '<InterfaceClass Name="PLCopenXMLInterface" RefBaseClassPath="ExternalDataConnector">',
    '<InterfaceClass Name="VariableInterface" RefBaseClassPath="PLCopenXMLInterface" />',
    "</InterfaceClass></InterfaceClass>",
    '<InterfaceClass Name="Communication" RefBaseClassPath="AutomationMLBaseInterface"><InterfaceClass Name="SignalInterface" RefBaseClassPath="Communication" /></InterfaceClass>',
    "</InterfaceClass></InterfaceClassLib>",
    '<InterfaceClassLib Name="CommunicationInterfaceClassLib"><Version>1.0.0</Version>',
    '<InterfaceClass Name="PhysicalEndPoint" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/Communication" />',
    '<InterfaceClass Name="LogicalEndPoint" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/Communication" />',
    "</InterfaceClassLib>",
    '<InterfaceClassLib Name="AutomationProjectConfigurationInterfaceClassLib"><Version>1.4.0</Version>',
    '<InterfaceClass Name="Tag" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/ExternalDataConnector/PLCopenXMLInterface/VariableInterface">',
    '<Attribute Name="DataType" AttributeDataType="xs:string"><Attribute Name="Customized" AttributeDataType="xs:boolean"><DefaultValue>false</DefaultValue></Attribute></Attribute>',
    '<Attribute Name="IoType" AttributeDataType="xs:string" /><Attribute Name="LogicalAddress" AttributeDataType="xs:string" /><Attribute Name="Comment" AttributeDataType="xs:string" />',
    "</InterfaceClass>",
    '<InterfaceClass Name="CommunicationPortInterface" RefBaseClassPath="CommunicationInterfaceClassLib/PhysicalEndPoint" />',
    '<InterfaceClass Name="Channel" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/Communication/SignalInterface">',
    '<Attribute Name="Type" AttributeDataType="xs:string" /><Attribute Name="IoType" AttributeDataType="xs:string" /><Attribute Name="Number" AttributeDataType="xs:int" /><Attribute Name="Length" AttributeDataType="xs:int" />',
    "</InterfaceClass>",
    '<InterfaceClass Name="ModuleAssignment" RefBaseClassPath="CommunicationInterfaceClassLib/LogicalEndPoint" />',
    "</InterfaceClassLib>",
    '<RoleClassLib Name="AutomationMLBaseRoleClassLib"><Version>2.2.2</Version><RoleClass Name="AutomationMLBaseRole"><RoleClass Name="Structure" RefBaseClassPath="AutomationMLBaseRole" /></RoleClass></RoleClassLib>',
    '<RoleClassLib Name="CommunicationRoleClassLib"><Version>1.0.1</Version>',
    '<RoleClass Name="PhysicalDevice" RefBaseClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole"><RoleClass Name="VariableList" RefBaseClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole" /></RoleClass>',
    '<RoleClass Name="LogicalDevice" RefBaseClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole" />',
    '<RoleClass Name="LogicalNetwork" RefBaseClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole" />',
    "</RoleClassLib>",
    '<RoleClassLib Name="AutomationProjectConfigurationRoleClassLib"><Version>1.4.0</Version>',
    '<RoleClass Name="AutomationProject" RefBaseClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Structure"><Attribute Name="ProjectManufacturer" AttributeDataType="xs:string" /><Attribute Name="ProjectSign" AttributeDataType="xs:string" /><Attribute Name="ProjectRevision" AttributeDataType="xs:string" /><Attribute Name="ProjectInformation" AttributeDataType="xs:string" /></RoleClass>',
    '<RoleClass Name="Subnet" RefBaseClassPath="CommunicationRoleClassLib/LogicalNetwork"><Attribute Name="Type" AttributeDataType="xs:string" /><ExternalInterface Name="LogicalEndPoint" ID="3e661cba-acfc-43b8-a02b-14ad7061f137" RefBaseClassPath="CommunicationInterfaceClassLib/LogicalEndPoint" /></RoleClass>',
    '<RoleClass Name="Device" RefBaseClassPath="CommunicationRoleClassLib/PhysicalDevice"><Attribute Name="TypeIdentifier" AttributeDataType="xs:string"><Attribute Name="TemplateIdentifier" AttributeDataType="xs:string" /></Attribute><Attribute Name="Comment" AttributeDataType="xs:string" /><Attribute Name="Manufacturer" AttributeDataType="xs:string" /></RoleClass>',
    '<RoleClass Name="DeviceItem" RefBaseClassPath="CommunicationRoleClassLib/PhysicalDevice"><Attribute Name="TypeName" AttributeDataType="xs:string" /><Attribute Name="DeviceItemType" AttributeDataType="xs:string"><Attribute Name="Customized" AttributeDataType="xs:boolean"><DefaultValue>false</DefaultValue></Attribute></Attribute><Attribute Name="PositionNumber" AttributeDataType="xs:int" /><Attribute Name="BuiltIn" AttributeDataType="xs:boolean"><DefaultValue>false</DefaultValue></Attribute><Attribute Name="TypeIdentifier" AttributeDataType="xs:string"><Attribute Name="TemplateIdentifier" AttributeDataType="xs:string" /></Attribute><Attribute Name="Manufacturer" AttributeDataType="xs:string" /><Attribute Name="Comment" AttributeDataType="xs:string" /><Attribute Name="ProductDesignation IEC" AttributeDataType="xs:string" /><Attribute Name="LocationIdentifier IEC" AttributeDataType="xs:string" /></RoleClass>',
    '<RoleClass Name="TagTable" RefBaseClassPath="CommunicationRoleClassLib/PhysicalDevice/VariableList"><Attribute Name="AssignToDefault" AttributeDataType="xs:boolean" /></RoleClass>',
    '<RoleClass Name="ComplexTag" RefBaseClassPath="CommunicationRoleClassLib/PhysicalDevice/VariableList"><Attribute Name="DataType" AttributeDataType="xs:string" /><Attribute Name="Comment" AttributeDataType="xs:string" /></RoleClass>',
    '<RoleClass Name="Node" RefBaseClassPath="CommunicationRoleClassLib/LogicalDevice"><Attribute Name="Type" AttributeDataType="xs:string" /><Attribute Name="NetworkAddress" AttributeDataType="xs:string" /><ExternalInterface Name="LogicalEndPoint" ID="9562e3ae-8c2b-4055-a327-3ab66f949d5e" RefBaseClassPath="CommunicationInterfaceClassLib/LogicalEndPoint" /></RoleClass>',
    '<RoleClass Name="CommunicationInterface" RefBaseClassPath="AutomationProjectConfigurationRoleClassLib/DeviceItem"><Attribute Name="Label" AttributeDataType="xs:string" /><Attribute Name="Type" AttributeDataType="xs:string" /><ExternalInterface Name="LogicalEndPoint" ID="dedad3eb-1a51-4d7e-accb-fdc8213c6c23" RefBaseClassPath="CommunicationInterfaceClassLib/LogicalEndPoint" /></RoleClass>',
    '<RoleClass Name="IoSystem" RefBaseClassPath="CommunicationRoleClassLib/LogicalDevice"><Attribute Name="Number" AttributeDataType="xs:int" /><ExternalInterface Name="LogicalEndPoint" ID="003f6b58-c95a-4346-8a0c-aaad895a6492" RefBaseClassPath="CommunicationInterfaceClassLib/LogicalEndPoint" /></RoleClass>',
    '<RoleClass Name="CommunicationPort" RefBaseClassPath="AutomationProjectConfigurationRoleClassLib/DeviceItem"><Attribute Name="Label" AttributeDataType="xs:string" /><ExternalInterface Name="CommunicationPortInterface" ID="b0f1bb7c-1df9-494e-8352-0cae067e357d" RefBaseClassPath="AutomationProjectConfigurationInterfaceClassLib/CommunicationPortInterface" /></RoleClass>',
    '<RoleClass Name="NodeBusExtension" RefBaseClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole" />',
    "</RoleClassLib>",
    '<RoleClassLib Name="AutomationProjectConfigurationEthernetRoleClassLib"><Version>1.2.1</Version>',
    '<RoleClass Name="NodeEthernet" RefBaseClassPath="AutomationProjectConfigurationRoleClassLib/NodeBusExtension"><Attribute Name="SubnetMask" AttributeDataType="xs:string" /><Attribute Name="RouterAddress" AttributeDataType="xs:string" /><Attribute Name="DhcpClientId" AttributeDataType="xs:string" /><Attribute Name="IpProtocolSelection" AttributeDataType="xs:string" /><Attribute Name="ProfinetDeviceName" AttributeDataType="xs:string" /></RoleClass>',
    "</RoleClassLib>",
].join("");
