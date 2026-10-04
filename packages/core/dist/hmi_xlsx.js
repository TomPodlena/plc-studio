/**
 * PLCdesk — minimální zapisovač XLSX bez závislostí (ZIP „stored“ + SpreadsheetML s inline
 * řetězci). Slouží importu tabulek do nástrojů, které berou jen Excel (TIA Portal WinCC:
 * „Hmi Tags“, „DiscreteAlarms“, „AnalogAlarms“). Výstup jsou bajty — klient je musí uložit
 * binárně (sada projektu `ProjectFile` nese jen text).
 * Struktura podle ECMA-376 (Office Open XML, část 1 – SpreadsheetML) a specifikace ZIP
 * (PKWARE APPNOTE 6.3.x, metoda 0 = stored).
 */
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
export function crc32(b) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++)
        c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}
/** ZIP archiv bez komprese (metoda 0). */
export function zipStored(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let off = 0;
    const u16 = (v, o, x) => v.setUint16(o, x, true);
    const u32 = (v, o, x) => v.setUint32(o, x >>> 0, true);
    for (const f of files) {
        const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
        const loc = new Uint8Array(30 + name.length), lv = new DataView(loc.buffer);
        u32(lv, 0, 0x04034b50);
        u16(lv, 4, 20);
        u16(lv, 6, 0x0800);
        u16(lv, 8, 0);
        u16(lv, 10, 0);
        u16(lv, 12, 0x21);
        u32(lv, 14, crc);
        u32(lv, 18, size);
        u32(lv, 22, size);
        u16(lv, 26, name.length);
        u16(lv, 28, 0);
        loc.set(name, 30);
        const cen = new Uint8Array(46 + name.length), cv = new DataView(cen.buffer);
        u32(cv, 0, 0x02014b50);
        u16(cv, 4, 20);
        u16(cv, 6, 20);
        u16(cv, 8, 0x0800);
        u16(cv, 10, 0);
        u16(cv, 12, 0);
        u16(cv, 14, 0x21);
        u32(cv, 16, crc);
        u32(cv, 20, size);
        u32(cv, 24, size);
        u16(cv, 28, name.length);
        u16(cv, 30, 0);
        u16(cv, 32, 0);
        u16(cv, 34, 0);
        u16(cv, 36, 0);
        u32(cv, 38, 0);
        u32(cv, 42, off);
        cen.set(name, 46);
        parts.push(loc, f.data);
        central.push(cen);
        off += loc.length + size;
    }
    const cenSize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    u32(ev, 0, 0x06054b50);
    u16(ev, 4, 0);
    u16(ev, 6, 0);
    u16(ev, 8, files.length);
    u16(ev, 10, files.length);
    u32(ev, 12, cenSize);
    u32(ev, 16, off);
    u16(ev, 20, 0);
    const all = [...parts, ...central, end];
    const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
    let p = 0;
    for (const a of all) {
        out.set(a, p);
        p += a.length;
    }
    return out;
}
const x = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
function colName(i) {
    let s = "";
    for (i++; i > 0; i = Math.floor((i - 1) / 26))
        s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
}
function sheetXml(s) {
    let o = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
    s.rows.forEach((r, ri) => {
        o += '<row r="' + (ri + 1) + '">';
        r.forEach((v, ci) => {
            const ref = colName(ci) + (ri + 1);
            if (typeof v === "number" && Number.isFinite(v))
                o += '<c r="' + ref + '"><v>' + v + "</v></c>";
            else if (String(v) !== "")
                o += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + x(String(v)) + "</t></is></c>";
        });
        o += "</row>";
    });
    return o + "</sheetData></worksheet>";
}
/** Sešit XLSX z listů (bez stylů; čísla jako čísla, ostatní jako text). */
export function xlsxWorkbook(sheets) {
    const enc = new TextEncoder();
    const f = (name, s) => ({ name, data: enc.encode(s) });
    const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    return zipStored([
        f("[Content_Types].xml", H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") +
            "</Types>"),
        f("_rels/.rels", H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
        f("xl/workbook.xml", H + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
            sheets.map((s, i) => '<sheet name="' + x(s.name.slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") + "</sheets></workbook>"),
        f("xl/_rels/workbook.xml.rels", H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") +
            "</Relationships>"),
        ...sheets.map((s, i) => f("xl/worksheets/sheet" + (i + 1) + ".xml", sheetXml(s))),
    ]);
}
