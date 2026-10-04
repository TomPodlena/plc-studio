/**
 * PLCdesk — minimální zapisovač XLSX bez závislostí (ZIP „stored“ + SpreadsheetML s inline
 * řetězci). Slouží importu tabulek do nástrojů, které berou jen Excel (TIA Portal WinCC:
 * „Hmi Tags“, „DiscreteAlarms“, „AnalogAlarms“). Výstup jsou bajty — klient je musí uložit
 * binárně (sada projektu `ProjectFile` nese jen text).
 * Struktura podle ECMA-376 (Office Open XML, část 1 – SpreadsheetML) a specifikace ZIP
 * (PKWARE APPNOTE 6.3.x, metoda 0 = stored).
 */
export interface XlsxSheet {
    name: string;
    rows: Array<Array<string | number>>;
}
export declare function crc32(b: Uint8Array): number;
/** ZIP archiv bez komprese (metoda 0). */
export declare function zipStored(files: Array<{
    name: string;
    data: Uint8Array;
}>): Uint8Array;
/** Sešit XLSX z listů (bez stylů; čísla jako čísla, ostatní jako text). */
export declare function xlsxWorkbook(sheets: XlsxSheet[]): Uint8Array;
