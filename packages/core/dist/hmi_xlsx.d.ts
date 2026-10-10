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
